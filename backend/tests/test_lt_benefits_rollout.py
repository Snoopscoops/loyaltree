"""Small operator-safety checks. All database and queue calls are in memory."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest

try:
    from backend.lt_benefits_rollout import CUSTOMER_FIELDS, ROLLOUT_REASON, main, queue_cards
except ImportError:
    # Also run directly from the staged tree before the operator copies it.
    path = Path(__file__).resolve().parents[1] / "lt_benefits_rollout.py"
    spec = importlib.util.spec_from_file_location("lt_benefits_rollout_under_test", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    CUSTOMER_FIELDS, ROLLOUT_REASON, main, queue_cards = module.CUSTOMER_FIELDS, module.ROLLOUT_REASON, module.main, module.queue_cards


class Query:
    def __init__(self, db, table):
        self.db, self.name, self.filters = db, table, []
        self.fields, self.desc, self.maximum = None, False, None
        self.patch = None

    def select(self, fields): self.fields = fields; return self
    def order(self, key, desc=False): self.desc = desc; return self
    def limit(self, number): self.maximum = number; return self
    def gt(self, key, value): self.filters.append((key, "gt", value)); return self
    def lte(self, key, value): self.filters.append((key, "lte", value)); return self
    def in_(self, key, value): self.filters.append((key, "in", value)); return self
    def eq(self, key, value): self.filters.append((key, "eq", value)); return self
    def update(self, patch): self.patch = patch; return self

    def execute(self):
        self.db.calls.append((self.name, self.fields, list(self.filters), self.maximum))
        if self.db.read_error and self.name == self.db.read_error:
            raise OSError("sensitive upstream text must never reach the report")
        if self.name == "customers" and self.fields and "lt_benefits_card_enabled" in self.fields and self.db.missing_addon:
            raise LookupError("private missing column message")
        rows = list(self.db.customers if self.name == "customers" else self.db.businesses)
        for key, operation, value in self.filters:
            rows = [row for row in rows if (row[key] > value if operation == "gt" else row[key] <= value if operation == "lte" else row.get(key) == value if operation == "eq" else row.get(key) in value)]
        if self.patch is not None:
            self.db.writes.append((self.name, dict(self.patch), list(self.filters)))
            if self.db.write_error_id and any(row["id"] == self.db.write_error_id for row in rows):
                raise OSError("secret upstream details")
            for row in rows: row.update(self.patch)
            return SimpleNamespace(data=[] if self.db.empty_write_response else [dict(row) for row in rows])
        rows.sort(key=lambda row: row["id"], reverse=self.desc)
        rows = rows[:self.maximum]
        return SimpleNamespace(data=[{key: row.get(key) for key in self.fields.split(",")} for row in rows])


class Database:
    def __init__(self, ids=(1, 2, 3)):
        self.customers = [{"id": identifier, "public_id": f"card-{identifier}", "business_id": 10, "program_id": 40 + identifier, "lt_benefits_card_enabled": None, "email": "not-selected@example.test"} for identifier in ids]
        self.businesses = [{"id": 10, "public_id": "test-business", "email": "not-selected@example.test"}]
        self.calls, self.read_error = [], None
        self.writes, self.write_error_id, self.empty_write_response, self.missing_addon = [], None, False, False

    def table(self, table): return Query(self, table)


class RolloutTests(unittest.TestCase):
    def test_default_is_read_only_bounded_keyset_scan_with_minimal_fields(self):
        db, queued, sleeps = Database((1, 3, 9)), [], []
        result = queue_cards(db, lambda *args, **kwargs: queued.append(args), batch_size=2, sleep=sleeps.append)
        self.assertEqual(result.mode, "dry_run")
        self.assertEqual((result.scanned, result.eligible, result.queued, result.resume_after_id), (3, 3, 0, 9))
        self.assertFalse(result.stopped)
        self.assertEqual(queued, [])
        self.assertEqual(db.writes, [])
        self.assertTrue(all(row["lt_benefits_card_enabled"] is None for row in db.customers))
        self.assertEqual(sleeps, [5.0])
        customer_pages = [call for call in db.calls if call[0] == "customers" and call[1] == CUSTOMER_FIELDS]
        self.assertEqual([call[2][0] for call in customer_pages], [("id", "gt", 0), ("id", "gt", 3)])
        self.assertTrue(all(call[3] <= 25 for call in db.calls))
        self.assertTrue(all("email" not in call[1] and "phone" not in call[1] for call in db.calls))

    def test_apply_preserves_customer_program_and_counts_pending_coalescing(self):
        db, queued = Database((1, 3)), []
        def enqueue(customer, business, reason):
            queued.append((customer, business, reason))
            return {"status": "queued", "job_id": 100 + customer["id"], "coalesced": customer["id"] == 3}
        result = queue_cards(db, enqueue, apply=True, sleep=lambda value: None)
        self.assertEqual((result.queued, result.coalesced), (1, 1))
        self.assertEqual(queued[0][0]["program_id"], 41)
        self.assertEqual(set(queued[0][0]), set(CUSTOMER_FIELDS.split(",")))
        self.assertEqual(queued[1][2], ROLLOUT_REASON)
        self.assertTrue(all(row[0]["lt_benefits_card_enabled"] is True for row in queued))
        self.assertEqual(db.writes, [("customers", {"lt_benefits_card_enabled": True}, [("id", "eq", 1), ("business_id", "eq", 10)]),
                                     ("customers", {"lt_benefits_card_enabled": True}, [("id", "eq", 3), ("business_id", "eq", 10)])])

    def test_enable_write_must_succeed_before_queue_and_preserves_checkpoint(self):
        db, calls = Database(), []
        db.write_error_id = 2
        result = queue_cards(db, lambda customer, *args, **kwargs: calls.append(customer["id"]) or {"status": "queued", "job_id": 1}, apply=True)
        self.assertTrue(result.stopped)
        self.assertEqual((result.resume_after_id, result.error_type), (1, "OSError"))
        self.assertEqual(calls, [1])
        self.assertIsNone(db.customers[1]["lt_benefits_card_enabled"])
        self.assertIsNone(db.customers[2]["lt_benefits_card_enabled"])
        self.assertNotIn("secret", repr(result))

    def test_missing_addon_or_unconfirmed_flag_fails_closed_without_enqueue(self):
        for mode in ("missing_addon", "empty_write_response"):
            db, calls = Database(), []
            setattr(db, mode, True)
            result = queue_cards(db, lambda *args, **kwargs: calls.append(args), apply=True)
            self.assertTrue(result.stopped)
            self.assertEqual(result.resume_after_id, 0)
            self.assertEqual(calls, [])
            if mode == "missing_addon": self.assertEqual(db.writes, [])

    def test_already_enabled_snapshot_avoids_redundant_write(self):
        db = Database((1,)); db.customers[0]["lt_benefits_card_enabled"] = True
        result = queue_cards(db, lambda *args, **kwargs: {"status": "queued", "job_id": 1}, apply=True)
        self.assertEqual(result.queued, 1)
        self.assertEqual(db.writes, [])

    def test_queue_error_stops_before_later_cards_and_leaves_resumable_checkpoint(self):
        db, calls = Database(), []
        def enqueue(customer, business, reason):
            calls.append(customer["id"])
            return {"status": "queued", "job_id": 1} if customer["id"] == 1 else {"status": "queue_error", "detail": "secret"}
        result = queue_cards(db, enqueue, apply=True)
        self.assertEqual(calls, [1, 2])
        self.assertTrue(result.stopped)
        self.assertEqual(result.error_type, "QueueRejected")
        self.assertEqual(result.resume_after_id, 1)
        self.assertNotIn("secret", repr(result))

    def test_exception_and_read_failure_never_expose_error_text(self):
        def failed(*args, **kwargs): raise RuntimeError("token=secret")
        result = queue_cards(Database(), failed, apply=True)
        self.assertEqual(result.error_type, "RuntimeError")
        self.assertEqual(result.resume_after_id, 0)
        self.assertNotIn("secret", repr(result))
        db = Database(); db.read_error = "businesses"
        result = queue_cards(db)
        self.assertEqual((result.scanned, result.resume_after_id, result.error_type), (0, 0, "OSError"))

    def test_missing_cards_or_orphan_businesses_are_skipped_without_mutation(self):
        db = Database()
        db.customers[0]["public_id"] = None
        db.customers[1]["business_id"] = 999
        calls = []
        result = queue_cards(db, lambda *args, **kwargs: calls.append(args) or {"status": "queued", "job_id": 1}, apply=True)
        self.assertEqual((result.skipped, result.eligible, result.queued), (2, 1, 1))
        self.assertEqual(result.skip_reasons, {"missing_card": 1, "missing_business": 1})
        self.assertEqual(calls[0][0]["id"], 3)

    def test_max_cards_and_high_water_bound_concurrent_new_joins(self):
        db = Database()
        def enqueue(customer, business, reason):
            if customer["id"] == 1:
                db.customers.append({"id": 100, "public_id": "new-join", "business_id": 10, "program_id": 9})
            return {"status": "queued", "job_id": customer["id"]}
        result = queue_cards(db, enqueue, apply=True, batch_size=1, max_cards=2, sleep=lambda value: None)
        self.assertEqual((result.scanned, result.resume_after_id, result.through_id), (2, 2, 3))
        resumed = queue_cards(db, after_id=2, through_id=3, sleep=lambda value: None)
        self.assertEqual((resumed.scanned, resumed.resume_after_id), (1, 3))

    def test_options_fail_before_database_calls(self):
        for change in [{"batch_size": 26}, {"batch_size": 0}, {"max_cards": 0}, {"after_id": -1}, {"pause_seconds": 0}, {"pause_seconds": float("nan")}, {"apply": True}]:
            db = Database()
            with self.assertRaises(ValueError): queue_cards(db, **change)
            self.assertEqual(db.calls, [])

    def test_cli_dry_run_initializes_only_transport_and_never_checks_or_mutates_feature(self):
        calls, output = [], []
        class Transport:
            async def start(self): calls.append("start")
            async def stop(self): calls.append("stop")
        runtime = SimpleNamespace(supabase=Database((1,)), http=Transport(), enqueue_wallet_sync=lambda *a, **k: self.fail("dry run queued"), lt_benefits_enabled=lambda: self.fail("dry run activation check"))
        code = main(["--max-cards", "1"], runtime_loader=lambda: runtime, emit=output.append)
        self.assertEqual(code, 0)
        self.assertEqual(calls, ["start", "stop"])
        result = json.loads(output[-1])
        self.assertEqual((result["mode"], result["queued"], result["scanned"]), ("dry_run", 0, 1))

    def test_cli_apply_requires_activation_and_closes_transport_after_rejection(self):
        calls, output = [], []
        class Transport:
            async def start(self): calls.append("start")
            async def stop(self): calls.append("stop")
        runtime = SimpleNamespace(supabase=Database(), http=Transport(), enqueue_wallet_sync=lambda *a, **k: self.fail("inactive queued"), lt_benefits_enabled=lambda: False)
        self.assertEqual(main(["--apply"], runtime_loader=lambda: runtime, emit=output.append), 1)
        self.assertEqual(calls, ["start", "stop"])
        self.assertEqual(runtime.supabase.calls, [])
        self.assertEqual(json.loads(output[-1])["error_type"], "RuntimeError")

    def test_cli_invalid_batch_never_imports_application(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            main(["--batch-size", "26"], runtime_loader=lambda: self.fail("invalid option imported main"))


if __name__ == "__main__":
    unittest.main()
