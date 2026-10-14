"""Subscription access regressions without startup, secrets, or live services."""

import ast
import asyncio
from datetime import datetime, timezone
from pathlib import Path
import re
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse

from backend.trial_coupons import billing_hold


SOURCE = Path(__file__).resolve().parents[1] / "main.py"


def load_definition(name, environment):
    """Execute the complete production function with isolated dependencies."""
    node = next(
        candidate
        for candidate in ast.parse(SOURCE.read_text()).body
        if isinstance(candidate, (ast.FunctionDef, ast.AsyncFunctionDef))
        and candidate.name == name
    )
    node.decorator_list = []
    exec(
        compile(ast.Module(body=[node], type_ignores=[]), str(SOURCE), "exec"),
        environment,
    )
    return environment[name]


class BusinessAccessMiddlewareTests(unittest.TestCase):
    def setUp(self):
        self.business = {
            "id": 17,
            "public_id": "test-business",
            "last_paid_at": "2019-12-01",
            "subscription_expires_at": "2020-01-01",
        }
        self.lookup = MagicMock(side_effect=lambda slug: self.business)
        self.environment = {
            "Request": Request,
            "HTTPException": HTTPException,
            "re": re,
            "billing_hold": billing_hold,
            "JSONResponse": JSONResponse,
            "business_for_access_check": self.lookup,
            "get_admin_token": lambda: "test-admin-token",
        }
        self.guard = load_definition("overdue_business_guard", self.environment)

    def test_lookup_failure_does_not_bypass_the_hold(self):
        self.lookup.side_effect=HTTPException(503, 'Could not verify business subscription')
        response=self.check_path('/api/v1/business/test-business/customers')
        self.assertEqual(response.status_code,503)

    def check_path(self, path, method="GET", authorization=None):
        headers = []
        if authorization:
            headers.append((b"authorization", authorization.encode()))
        request = Request({
            "type": "http",
            "method": method,
            "path": path,
            "headers": headers,
            "query_string": b"",
        })

        async def route(_request):
            return JSONResponse({"route_reached": True})

        return asyncio.run(self.guard(request, route))

    def check(self, suffix, method="GET", authorization=None):
        return self.check_path(
            "/api/v1/business/test-business" + suffix, method, authorization
        )

    def test_held_account_blocks_operational_routes_and_existing_sessions(self):
        for suffix, method in (
            ("/customers", "GET"),
            ("/analytics", "GET"),
            ("/stamp", "POST"),
            ("/staff/verify-pin", "POST"),
            ("/cashier-devices/test-device/unlock", "POST"),
        ):
            with self.subTest(suffix=suffix):
                response = self.check(suffix, method, "Bearer existing-owner-session")
                self.assertEqual(response.status_code, 402)
                self.assertIn(b'"billing_hold":true', response.body)

    def test_customer_wallet_assets_and_help_remain_available(self):
        for suffix, method in (
            ("/hero-image.png", "GET"),
            ("/wallet-logo.png", "GET"),
            ("/customers/test-customer/apple-wallet-registration", "GET"),
            ("/help/question-event", "POST"),
        ):
            with self.subTest(suffix=suffix):
                self.assertEqual(self.check(suffix, method).status_code, 200)

    def test_owner_can_access_billing_and_checkout_while_held(self):
        for suffix, method in (
            ("/subscription", "GET"),
            ("/subscription/payments", "GET"),
            ("/subscription/checkout", "POST"),
        ):
            with self.subTest(suffix=suffix):
                self.assertEqual(self.check(suffix, method).status_code, 200)

    def test_current_business_and_super_admin_keep_operational_access(self):
        self.assertEqual(
            self.check("/customers", authorization="Bearer test-admin-token").status_code,
            200,
        )
        self.business["subscription_expires_at"] = "2099-01-01"
        self.assertEqual(self.check("/stamp", "POST").status_code, 200)

    def test_expired_promotional_trial_is_held_without_paid_grace(self):
        self.business.update(last_paid_at=None, trial_ends_at="2020-01-01T12:00:00Z")
        self.assertEqual(self.check("/customers").status_code, 402)

    def test_direct_agent_inventory_is_blocked_for_held_business(self):
        self.assertEqual(self.check_path("/agent/test-business").status_code, 402)
        self.business["subscription_expires_at"] = "2099-01-01"
        self.assertEqual(self.check_path("/agent/test-business").status_code, 200)


class CompanionSubscriptionAccessTests(unittest.TestCase):
    def setUp(self):
        self.device = {"id": "test-device", "business_id": 17, "status": "active"}
        self.business = {
            "id": 17,
            "last_paid_at": "2026-01-01",
            "subscription_expires_at": "2099-01-01",
        }
        self.business_lookup = MagicMock(side_effect=lambda business_id: self.business)
        self.query = MagicMock()
        for operation in ("select", "eq", "limit", "update"):
            getattr(self.query, operation).return_value = self.query
        self.query.execute.return_value = SimpleNamespace(data=[self.device])
        self.db = MagicMock()
        self.db.table.return_value = self.query
        self.cached_device = MagicMock(return_value=self.device)
        self.heartbeat = MagicMock(return_value=False)
        self.environment = {
            "HTTPException": HTTPException,
            "datetime": datetime,
            "timezone": timezone,
            "supabase": self.db,
            "billing_hold": billing_hold,
            "_pos_secret_hash": lambda token: "test-token-hash",
            "_pos_device_cache_get": self.cached_device,
            "_pos_device_cache_put": MagicMock(),
            "_pos_device_heartbeat_due": self.heartbeat,
            "_pos_schema_error": lambda exc: HTTPException(503, "Test database unavailable"),
            "_pos_business_by_id": self.business_lookup,
        }
        self.authorize = load_definition("_require_pos_device", self.environment)

    def assert_held(self):
        with self.assertRaises(HTTPException) as caught:
            self.authorize("test-token")
        self.assertEqual(caught.exception.status_code, 402)

    def test_cached_device_checks_fresh_business_status_on_every_request(self):
        self.assertEqual(self.authorize("test-token"), self.device)
        self.business["subscription_expires_at"] = "2020-01-01"
        self.assert_held()
        self.assertEqual(self.business_lookup.call_args_list[0].args, (17,))
        self.assertEqual(self.business_lookup.call_count, 2)
        self.db.table.assert_not_called()

    def test_cached_device_is_blocked_after_promotional_trial_expires(self):
        self.business.update(
            last_paid_at=None,
            trial_ends_at="2020-01-01T12:00:00Z",
            subscription_expires_at="2020-01-01",
        )
        self.assert_held()
        self.business_lookup.assert_called_once_with(17)
        self.heartbeat.assert_not_called()

    def test_uncached_device_is_blocked_when_business_is_overdue(self):
        self.cached_device.return_value = None
        self.business["subscription_expires_at"] = "2020-01-01"
        self.assert_held()
        self.business_lookup.assert_called_once_with(17)
        self.db.table.assert_called_once_with("pos_devices")
        self.heartbeat.assert_not_called()

    def test_uncached_current_business_can_use_device(self):
        self.cached_device.return_value = None
        self.assertEqual(self.authorize("test-token"), self.device)
        self.business_lookup.assert_called_once_with(17)
        self.environment["_pos_device_cache_put"].assert_called_once_with(
            "test-token-hash", self.device
        )

    def test_confirmed_renewal_restores_cached_device_access_immediately(self):
        self.business["subscription_expires_at"] = "2020-01-01"
        self.assert_held()
        self.business["subscription_expires_at"] = "2099-01-01"
        self.assertEqual(self.authorize("test-token"), self.device)
        self.assertEqual(self.business_lookup.call_count, 2)

    def test_unavailable_business_check_fails_closed_for_cached_device(self):
        self.business = None
        with self.assertRaises(HTTPException) as caught:
            self.authorize("test-token")
        self.assertEqual(caught.exception.status_code, 503)
        self.heartbeat.assert_not_called()


if __name__ == "__main__":
    unittest.main()


class StrictAccessLookupTests(unittest.TestCase):
    def environment(self, db):
        return dict(supabase=db, HTTPException=HTTPException,
                    split_program_join_slug=lambda slug:(slug,None))
    def test_no_database_is_a_503(self):
        lookup=load_definition('business_for_access_check', self.environment(None))
        with self.assertRaises(HTTPException) as caught:lookup('test-business')
        self.assertEqual(caught.exception.status_code,503)
    def test_transport_error_is_a_503(self):
        db,query=MagicMock(),MagicMock()
        db.table.return_value=query
        for method in ('select','eq','limit'):getattr(query,method).return_value=query
        query.execute.side_effect=ConnectionError('test lookup outage')
        lookup=load_definition('business_for_access_check', self.environment(db))
        with self.assertRaises(HTTPException) as caught:lookup('test-business')
        self.assertEqual(caught.exception.status_code,503)
        self.assertIsInstance(caught.exception.__cause__,ConnectionError)
