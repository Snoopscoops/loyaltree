"""Coupon editor and transactional weekly limits; no live providers or data."""
import ast
import asyncio
from datetime import datetime
import hashlib
import os
from pathlib import Path
import subprocess
from typing import Optional
import unittest

from fastapi import Header, HTTPException
try:
    from backend import lt_benefits as benefits
    from backend.tests.test_lt_benefits import fixture, OFFER_ID
except ImportError:
    import lt_benefits as benefits
    from test_lt_benefits import fixture, OFFER_ID


BACKEND = Path(__file__).resolve().parents[1]
IMAGE = "https://res.cloudinary.com/sample-cloud/image/upload/v1/coupon.png"


class CouponEditorTests(unittest.TestCase):
    def setUp(self):
        self.client, self.service, self.db, _, _ = fixture()
        self.path = "/api/v1/business/synthetic-cafe/lt-benefits/offers"
        self.headers = {"Authorization": "Bearer signed-owner"}
        self.offer = dict(title="Coupon", discount_centavos=2000, min_spend_centavos=15050,
                          points_cost=20, total_quantity=100, weekly_limit=5, image_url=IMAGE)

    def test_create_and_edit_save_uploaded_https_photo_minimum_and_weekly_limit(self):
        response = self.client.post(self.path, headers=self.headers, json=self.offer)
        self.assertEqual(response.status_code, 200)
        saved = self.db.calls[-1][1]["offer"]
        self.assertEqual(saved["image_url"], IMAGE)
        self.assertEqual(saved["min_spend_centavos"], 15050)
        self.assertEqual(saved["weekly_limit"], 5)
        response = self.client.patch(f"{self.path}/{OFFER_ID}", headers=self.headers,
            json=dict(image_url=IMAGE + "?v=2", min_spend_centavos=20000, weekly_limit=3))
        self.assertEqual(response.status_code, 200)
        saved = self.db.calls[-1][1]["offer"]
        self.assertEqual(saved, dict(image_url=IMAGE + "?v=2", min_spend_centavos=20000, weekly_limit=3))

    def test_weekly_limit_can_be_cleared_without_clearing_other_fields(self):
        response = self.client.patch(f"{self.path}/{OFFER_ID}", headers=self.headers, json=dict(weekly_limit=None))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.db.calls[-1][1]["offer"], {"weekly_limit": None})
        self.assertEqual(self.client.patch(f"{self.path}/{OFFER_ID}", headers=self.headers,
            json=dict(min_spend_centavos=None)).status_code, 422)

    def test_photo_and_weekly_validation_reject_invalid_create_and_edit_before_rpc(self):
        invalid = [dict(image_url=value) for value in (
            "data:image/png;base64,abcd", "http://example.invalid/photo.png",
            "https://owner:secret@example.invalid/photo.png", "https://example.invalid/a b.png",
            "https://example.invalid/" + "x" * 2048)]
        invalid += [dict(weekly_limit=value) for value in (0, -1, 1.5, True, "5", 1000001)]
        for change in invalid:
            with self.subTest(change=change):
                self.assertEqual(self.client.post(self.path, headers=self.headers, json={**self.offer, **change}).status_code, 422)
                self.assertEqual(self.client.patch(f"{self.path}/{OFFER_ID}", headers=self.headers, json=change).status_code, 422)
        self.assertFalse(self.db.calls)

    def test_weekly_claim_rejection_is_a_safe_conflict_not_a_server_error(self):
        self.db.responses["claim"] = {"error": "weekly_limit"}
        response = self.client.post(f"/api/v1/benefits/offers/{OFFER_ID}/claim",
            headers={"Authorization": "Bearer opaque-private-customer-session-token-12345", "Idempotency-Key": "weekly-claim-key"})
        self.assertEqual(response.status_code, 409)
        self.assertIn("weekly claim limit", response.json()["detail"])

    def test_coupon_upload_signature_requires_owner_and_uses_business_folder(self):
        # Extract only this route, keeping the test independent of heavy SDKs.
        tree = ast.parse((BACKEND / "main.py").read_text())
        function = next(node for node in tree.body if isinstance(node, ast.AsyncFunctionDef) and node.name == "get_cloudinary_signature")
        function.decorator_list = []
        calls = []
        def owner(slug, authorization):
            calls.append((slug, authorization))
            if authorization != "Bearer signed-owner":
                raise HTTPException(403, "Owner required")
        namespace = dict(Optional=Optional, Header=Header, HTTPException=HTTPException,
            require_owner_session=owner, safe_get_business=lambda _: {"id": 10},
            CLOUDINARY_API_KEY="public-key", CLOUDINARY_API_SECRET="synthetic-upload-secret",
            CLOUDINARY_CLOUD_NAME="sample-cloud", CLOUDINARY_UPLOAD_PRESET="images",
            datetime=datetime, hashlib=hashlib)
        exec(compile(ast.Module(body=[function], type_ignores=[]), str(BACKEND / "main.py"), "exec"), namespace)
        route = namespace["get_cloudinary_signature"]
        with self.assertRaises(HTTPException):
            asyncio.run(route("synthetic-cafe", purpose="lt_benefits", asset_role=None, authorization=""))
        result = asyncio.run(route("synthetic-cafe", purpose="lt_benefits", asset_role=None, authorization="Bearer signed-owner"))
        self.assertEqual(calls[-1], ("synthetic-cafe", "Bearer signed-owner"))
        self.assertEqual(result["folder"], "lt-benefits/synthetic-cafe")
        self.assertNotIn("synthetic-upload-secret", str(result))


class CouponSQLTests(unittest.TestCase):
    def test_actual_fresh_and_addon_sql_limits_and_idempotency(self):
        runtime = os.getenv("LT_BENEFITS_PGLITE", "/private/tmp/lt-benefits-pg/node_modules/@electric-sql/pglite/dist/index.js")
        node = os.getenv("LT_BENEFITS_NODE", "/usr/local/bin/node")
        if not Path(runtime).is_file() or not Path(node).is_file():
            self.skipTest("Optional isolated PGlite runtime not installed")
        completed = subprocess.run([node, str(Path(__file__).with_suffix(".mjs")), runtime,
            str(BACKEND / "lt_benefits.sql"), str(BACKEND / "lt_benefits_coupon_limits.sql")],
            capture_output=True, text=True, timeout=120)
        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
        self.assertIn("Coupon SQL checks passed", completed.stdout)


if __name__ == "__main__":
    unittest.main()
