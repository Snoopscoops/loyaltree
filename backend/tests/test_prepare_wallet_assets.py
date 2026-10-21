import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

try:
    from backend import prepare_wallet_assets as prepare
    from backend import wallet_cloudinary as cloud
except ImportError:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    import prepare_wallet_assets as prepare
    import wallet_cloudinary as cloud

try:
    from .test_wallet_cloudinary import CloudClient, Response, SOURCE, CREDENTIALS
except ImportError:
    from test_wallet_cloudinary import CloudClient, Response, SOURCE, CREDENTIALS


class ArtworkClient(CloudClient):
    def __init__(self): super().__init__(); self.gets = []
    def get(self, url, **kwargs):
        self.gets.append((url, kwargs))
        if url.endswith("businesses"):
            rows = [{"id": 1, "public_id": "test", "logo_url": SOURCE}]
        else:
            rows = [{"id": 1, "public_id": "program", "business_id": 1, "program_logo_url": SOURCE,
                     "hero_image_url": SOURCE.replace("brand.logo", "banner"), "wallet_progress_filled_icon_url": "https://external.invalid/no-fetch.png"}]
        return Response(200, rows)


class PreparationTests(unittest.TestCase):
    def test_public_scan_selects_only_branding_fields_and_follows_no_redirect(self):
        client = ArtworkClient()
        records = prepare.public_artwork_sources(client, url="https://project.supabase.co", key="private-db-key")
        self.assertEqual(len(records), 4)
        self.assertEqual(len(client.gets), 2)
        for url, options in client.gets:
            table = url.rsplit("/", 1)[-1]
            self.assertEqual(options["params"]["select"], prepare.PUBLIC_COLUMNS[table])
            self.assertNotIn("email", options["params"]["select"])
            self.assertFalse(options["follow_redirects"])
        self.assertEqual(client.calls, [])

    def test_database_credentials_never_sent_to_unapproved_host(self):
        for url in ("https://project.supabase.co.evil.invalid", "http://project.supabase.co", "https://user@project.supabase.co", "https://project.supabase.co/other", "https://project.supabase.co?x=1"):
            client = ArtworkClient()
            with self.assertRaises(ValueError): prepare.public_artwork_sources(client, url=url, key="private-db-key")
            self.assertEqual(client.gets, [])

    def test_default_plan_does_not_write_manifest_or_call_cloudinary(self):
        plans = cloud.plan_sources([{"url": SOURCE, "role": "logo"}])["plans"]; client = CloudClient()
        state = {"schema": 1, "entries": {}}
        result = prepare.prepare_plans(plans, apply=False, credentials=CREDENTIALS, client=client, manifest=state,
                                       persist=lambda _: self.fail("dry run persisted"))
        self.assertEqual(result["pending"], 1); self.assertEqual(result["requests"], 0)
        self.assertEqual(client.calls, []); self.assertEqual(state["entries"], {})

    def test_completed_manifest_resumes_without_duplicate_generation(self):
        plans = cloud.plan_sources([{"url": SOURCE, "role": "logo"}])["plans"]; client = CloudClient(); saves = []
        state = {"schema": 1, "entries": {}}
        result = prepare.prepare_plans(plans, apply=True, credentials=CREDENTIALS, client=client, manifest=state,
                                       persist=lambda value: saves.append(json.dumps(value)), sleep=lambda _: None)
        self.assertEqual((result["prepared"], len(saves)), (1, 1))
        result = prepare.prepare_plans(plans, apply=True, credentials=CREDENTIALS, client=client, manifest=state)
        self.assertEqual(result["already_prepared"], 1); self.assertEqual(result["requests"], 0)
        self.assertEqual(len(client.calls), 1)
        self.assertNotIn("private", repr(state)); self.assertNotIn("https://", repr(state))

    def test_rate_limit_stops_remaining_sends_and_saves_failure_for_retry(self):
        plans = cloud.plan_sources([{"url": SOURCE, "role": "logo"}, {"url": SOURCE.replace("brand.logo", "second"), "role": "logo"}])["plans"]
        client = CloudClient([Response(429, {"secret": "private"}), Response(429, {"secret": "private"})]); saves = []
        result = prepare.prepare_plans(plans, apply=True, credentials=CREDENTIALS, client=client,
            manifest={"entries": {}}, persist=saves.append, sleep=lambda _: None)
        self.assertTrue(result["stopped_rate_limit"]); self.assertEqual(result["requests"], 1)
        self.assertEqual(len(client.calls), 2); self.assertEqual(len(saves), 1)

    def test_manifest_is_atomic_small_private_and_invalid_manifest_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
            state = prepare.read_manifest(path); state["entries"]["hash"] = {"status": "prepared"}
            prepare.save_manifest(path, state)
            self.assertEqual(prepare.read_manifest(path), state)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(len(list(Path(directory).iterdir())), 1)
            path.write_text("{}");
            with self.assertRaises(ValueError): prepare.read_manifest(path)

    def test_cli_default_is_dry_run_and_apply_is_resumable_without_app_import(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "manifest.json"; outputs = []; clients = []
            def factory():
                client = ArtworkClient(); clients.append(client); return client
            env = {"SUPABASE_URL": "https://project.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": "private-db-key",
                   "CLOUDINARY_CLOUD_NAME": CREDENTIALS["cloud_name"], "CLOUDINARY_API_KEY": CREDENTIALS["api_key"], "CLOUDINARY_API_SECRET": CREDENTIALS["api_secret"]}
            self.assertEqual(prepare.main(["--manifest", str(path)], client_factory=factory, environ=env, emit=outputs.append), 0)
            self.assertFalse(path.exists()); self.assertEqual(clients[-1].calls, [])
            self.assertEqual(json.loads(outputs[-1])["mode"], "dry_run"); self.assertTrue(clients[-1].closed)
            args = ["--apply", "--pause-seconds", "0", "--manifest", str(path)]
            self.assertEqual(prepare.main(args, client_factory=factory, environ=env, emit=outputs.append), 0)
            self.assertTrue(path.exists()); self.assertEqual(len(clients[-1].calls), 2)
            self.assertEqual(prepare.main(args, client_factory=factory, environ=env, emit=outputs.append), 0)
            self.assertEqual(clients[-1].calls, []); self.assertEqual(json.loads(outputs[-1])["already_prepared"], 2)
            self.assertNotIn("private", repr(outputs))

    def test_cli_explicit_sources_need_no_database_and_missing_keys_never_send(self):
        with tempfile.TemporaryDirectory() as directory:
            source_path = Path(directory) / "sources.json"; source_path.write_text(json.dumps([{"url": SOURCE, "role": "logo"}]))
            client = CloudClient(); output = []
            args = ["--sources", str(source_path), "--manifest", str(Path(directory) / "state.json")]
            self.assertEqual(prepare.main(args, client_factory=lambda: client, environ={"CLOUDINARY_CLOUD_NAME": "test-account"}, emit=output.append), 0)
            self.assertEqual(prepare.main(["--apply"] + args, client_factory=lambda: self.fail("missing key made client"), environ={"CLOUDINARY_CLOUD_NAME": "test-account"}, emit=output.append), 1)
            self.assertEqual(client.calls, [])


if __name__ == "__main__": unittest.main()
