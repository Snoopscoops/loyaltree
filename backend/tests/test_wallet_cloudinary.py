import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from urllib.parse import quote

try:
    from backend import wallet_cloudinary as cloud
except ImportError:
    path = Path(__file__).resolve().parents[1] / "wallet_cloudinary.py"
    spec = importlib.util.spec_from_file_location("wallet_cloudinary_under_test", path)
    cloud = importlib.util.module_from_spec(spec); sys.modules[spec.name] = cloud; spec.loader.exec_module(cloud)


SOURCE = "https://res.cloudinary.com/test-account/image/upload/v99/nested/brand.logo.jpg"
CREDENTIALS = dict(cloud_name="test-account", api_key="private-key", api_secret="private-secret")


class Response:
    def __init__(self, status, body): self.status_code, self.body = status, body
    def json(self): return self.body


class CloudClient:
    def __init__(self, replies=None): self.calls, self.replies, self.closed = [], list(replies or []), False
    def post(self, url, **kwargs):
        self.calls.append((url, kwargs))
        if self.replies:
            reply = self.replies.pop(0)
            if isinstance(reply, Exception): raise reply
            return reply
        payload = kwargs["data"]
        return Response(200, {"public_id": payload["public_id"], "version": 99,
            "eager": [{"format": "png", "transformation": transform,
                       "secure_url": "https://res.cloudinary.com/test-account/image/upload/" + transform + "/v99/" + quote(payload["public_id"], safe="/") + ".png"}
                      for transform in payload["eager"].split("|")]})
    def close(self): self.closed = True


class CloudinaryTests(unittest.TestCase):
    def test_exact_profiles_dimensions_and_alpha_policy(self):
        profiles = cloud.profile_transforms()
        self.assertEqual(len(profiles), 13)
        self.assertIn("h_87,w_87", profiles["apple_icon_3x"])
        self.assertIn("b_white", profiles["apple_icon_3x"])
        self.assertIn("b_transparent,c_pad,g_west,h_150,w_480", profiles["apple_logo_3x"])
        self.assertEqual(profiles["apple_strip_3x"], "c_fill,g_center,h_369,w_1125/f_png")
        self.assertEqual(profiles["google_hero_source"], "c_fill,g_center,h_336,w_1032/f_png")
        self.assertTrue(all(value.endswith("f_png") for value in profiles.values()))
        self.assertFalse(any("q_auto" in value or "e_trim" in value for value in profiles.values()))

    def test_url_preserves_existing_edits_version_nested_id_query_and_periods(self):
        source = SOURCE.replace("/v99/", "/c_crop,h_300,w_800/g_west,e_grayscale/v99/") + "?_a=publicanalytics"
        derived = cloud.delivery_url(source, "apple_logo_3x")
        self.assertIn("/c_crop,h_300,w_800/g_west,e_grayscale/b_transparent,c_pad,g_west,h_150,w_480/f_png/v99/nested/brand.logo.png", derived)
        self.assertTrue(derived.endswith("?_a=publicanalytics"))
        asset = cloud.parse_public_asset(source)
        self.assertEqual(asset.public_id, "nested/brand.logo")
        self.assertEqual(cloud.delivery_url(derived, "apple_logo_3x"), derived)

    def test_simple_versionless_and_encoded_ids_are_supported(self):
        self.assertEqual(cloud.parse_public_asset("https://res.cloudinary.com/test-account/image/upload/simple.png").public_id, "simple")
        self.assertEqual(cloud.parse_public_asset("https://res.cloudinary.com/test-account/image/upload/v1/c_fill/my%20logo.png").public_id, "c_fill/my logo")
        derived = cloud.delivery_url("https://res.cloudinary.com/test-account/image/upload/folder/my%20logo.jpg", "apple_icon_1x")
        self.assertTrue(derived.endswith("/folder/my%20logo.png"))

    def test_signed_private_fetch_external_malformed_and_nonimage_urls_are_unchanged(self):
        unsupported = [SOURCE.replace("res.cloudinary.com", "res.cloudinary.com.evil.invalid"),
            SOURCE.replace("res.cloudinary.com", "res.cloudinary.com:443"),
            SOURCE.replace("https://", "http://"), SOURCE.replace("https://", "https://user:password@"),
            SOURCE.replace("/upload/", "/authenticated/"), SOURCE.replace("/upload/", "/fetch/"),
            SOURCE.replace("/v99/", "/s--signed--/v99/"), SOURCE + "?__cld_token__=private",
            SOURCE + "?signature=private", SOURCE + "#fragment", SOURCE.replace(".jpg", ".pkpass"),
            SOURCE.replace("/v99/", "/l_fetch:aHR0cHM6Ly9leGFtcGxlLmNvbQ==/v99/"),
            SOURCE.replace("/v99/", "/c_fill%0A/v99/"), SOURCE.replace("nested/", "../")]
        for source in unsupported:
            with self.subTest(source=source):
                self.assertIsNone(cloud.parse_public_asset(source))
                self.assertEqual(cloud.delivery_url(source, "apple_logo_3x"), source)

    def test_planner_unions_roles_dedupes_sources_and_does_not_mutate_input(self):
        sources = [{"url": SOURCE, "role": "logo"}, {"url": SOURCE, "role": "logo"}, {"url": SOURCE, "role": "hero"}, {"url": "https://external.invalid/a.png", "role": "logo"}]
        before = json.dumps(sources)
        planned = cloud.plan_sources(sources)
        self.assertEqual(planned["skipped"], 1)
        self.assertEqual(len(planned["plans"]), 1)
        self.assertEqual(len(planned["plans"][0]["transforms"]), 12)
        self.assertEqual(before, json.dumps(sources))
        self.assertEqual(planned, cloud.plan_sources(list(reversed(sources))))

    def test_planner_preserves_distinct_edited_source_and_version(self):
        sources = [{"url": SOURCE, "role": "logo"}, {"url": SOURCE.replace("v99", "v100"), "role": "logo"}, {"url": SOURCE.replace("/v99/", "/c_crop,w_100,h_100/v99/"), "role": "logo"}]
        self.assertEqual(len(cloud.plan_sources(sources)["plans"]), 3)

    def test_explicit_uses_only_own_api_signed_parameters_and_no_upload(self):
        client = CloudClient(); plan = cloud.make_plan(SOURCE, ["apple_icon_3x", "apple_logo_3x"])
        result = cloud.send_eager_plan(plan, client=client, now=lambda: 1000, **CREDENTIALS)
        self.assertEqual((result["status"], result["prepared_count"]), ("prepared", 2))
        url, options = client.calls[0]
        self.assertEqual(url, "https://api.cloudinary.com/v1_1/test-account/image/explicit")
        self.assertFalse(options["follow_redirects"])
        payload = options["data"]
        self.assertEqual(set(payload), {"public_id", "type", "eager", "eager_async", "timestamp", "api_key", "signature"})
        self.assertNotIn("file", payload); self.assertNotIn("overwrite", payload)
        signed = {key: value for key, value in payload.items() if key not in ("api_key", "signature")}
        expected = hashlib.sha256(("&".join(f"{key}={signed[key]}" for key in sorted(signed)) + CREDENTIALS["api_secret"]).encode()).hexdigest()
        self.assertEqual(payload["signature"], expected)
        self.assertNotIn("private", repr(result)); self.assertNotIn("https://", repr(result))

    def test_other_cloud_and_injected_plan_cannot_send_credentials(self):
        client = CloudClient(); plan = cloud.make_plan(SOURCE, ["apple_logo_3x"])
        result = cloud.send_eager_plan(plan, client=client, **dict(CREDENTIALS, cloud_name="other"))
        self.assertEqual(result["status"], "skipped_account"); self.assertEqual(client.calls, [])
        plan["transforms"] = ["l_fetch:aHR0cHM6Ly9ldmlsLmludmFsaWQ=/f_png"]
        with self.assertRaises(ValueError): cloud.send_eager_plan(plan, client=client, **CREDENTIALS)
        self.assertEqual(client.calls, [])

    def test_transient_retry_is_bounded_and_permanent_failure_never_reveals_body(self):
        plan = cloud.make_plan(SOURCE, ["apple_logo_3x"]); sleeps = []
        client = CloudClient([Response(503, {"error": "private-secret"})])
        result = cloud.send_eager_plan(plan, client=client, sleep=sleeps.append, **CREDENTIALS)
        self.assertEqual((result["status"], result["attempts"]), ("prepared", 2)); self.assertEqual(sleeps, [.5])
        client = CloudClient([Response(400, {"error": "private-secret"})])
        result = cloud.send_eager_plan(plan, client=client, sleep=lambda _: self.fail("permanent retry"), **CREDENTIALS)
        self.assertEqual(result["status_code"], 400); self.assertNotIn("private", repr(result))
        client = CloudClient([TimeoutError("private-secret"), TimeoutError("private-secret")])
        result = cloud.send_eager_plan(plan, client=client, sleep=lambda _: None, **CREDENTIALS)
        self.assertEqual(len(client.calls), 2); self.assertEqual(result["error_type"], "TimeoutError"); self.assertNotIn("private", repr(result))

    def test_missing_or_wrong_version_derivatives_never_report_prepared(self):
        plan = cloud.make_plan(SOURCE, ["apple_logo_3x"])
        for body, expected in (({"public_id": plan["public_id"], "version": 100, "eager": []}, "version_mismatch"),
                               ({"public_id": plan["public_id"], "version": 99, "eager": []}, "incomplete")):
            result = cloud.send_eager_plan(plan, client=CloudClient([Response(200, body)]), **CREDENTIALS)
            self.assertEqual(result["status"], expected); self.assertEqual(result["prepared_count"], 0)


if __name__ == "__main__": unittest.main()
