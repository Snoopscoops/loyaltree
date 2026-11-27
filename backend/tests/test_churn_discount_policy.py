from datetime import date, timedelta
import unittest

try:
    from backend.churn_discount_policy import ChurnPolicy, plan_winback
except ImportError:
    from churn_discount_policy import ChurnPolicy, plan_winback


class ChurnDiscountPolicyTests(unittest.TestCase):
    today = date(2026, 11, 27)

    def member(self, customer_id=1, days=30, **overrides):
        return dict(business_id=5, customer_id=customer_id, active=True,
                    marketing_allowed=True,
                    last_verified_activity=self.today - timedelta(days=days)) | overrides

    def plan(self, members, policy=None, claimed=()):
        return plan_winback(policy or ChurnPolicy(enabled=True), members,
                            today=self.today, business_id=5, already_claimed=claimed)

    def test_disabled_by_default(self):
        self.assertEqual(self.plan([self.member()], ChurnPolicy()), [])

    def test_threshold_and_expiry(self):
        rows = self.plan([self.member(), self.member(2, 29)])
        self.assertEqual([r["customer_id"] for r in rows], [1])
        self.assertEqual(rows[0]["expires_at"], "2026-12-03")

    def test_consent_scope_and_unknown_activity(self):
        self.assertEqual(self.plan([
            self.member(marketing_allowed=False),
            self.member(2, business_id=6),
            self.member(3, last_verified_activity=None),
            self.member(4, active=False),
        ]), [])

    def test_duplicate_claim_and_latest_activity(self):
        row = self.plan([self.member()])[0]
        self.assertEqual(self.plan([self.member()], claimed=[row["claim_key"]]), [])
        self.assertEqual(self.plan([self.member(), self.member(days=1)]), [])

    def test_limit_oldest_first(self):
        rows = self.plan([self.member(1, 30), self.member(2, 60)],
                         ChurnPolicy(enabled=True, daily_limit=1))
        self.assertEqual([r["customer_id"] for r in rows], [2])

    def test_invalid_config(self):
        for kwargs in ({"enabled": 1}, {"discount_percent": 101}, {"daily_limit": 0}):
            with self.assertRaises(ValueError):
                ChurnPolicy(**kwargs)
