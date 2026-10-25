"""Validate the single release SQL file without contacting any live service."""
import importlib.util
import os
from pathlib import Path
import subprocess
import unittest


BACKEND = Path(__file__).resolve().parents[1]


class SystemFollowupsSQLTests(unittest.TestCase):
    def test_bundle_is_an_exact_deterministic_copy_with_one_outer_transaction(self):
        spec = importlib.util.spec_from_file_location("followups_bundle", BACKEND / "scripts/generate_system_followups_sql.py")
        generator = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(generator)
        actual = (BACKEND / "system_followups_5_9.sql").read_text()
        self.assertEqual(actual, generator.build_bundle())
        self.assertEqual(sum(line.strip() == "BEGIN;" for line in actual.splitlines()), 1)
        self.assertEqual(sum(line.strip() == "COMMIT;" for line in actual.splitlines()), 1)
        with self.assertRaises(ValueError):
            generator.strip_outer_transaction("BEGIN;\nCOMMIT;\nCOMMIT;\n", "invalid.sql")

    def test_actual_bundle_rerun_coexistence_and_atomic_rollback(self):
        runtime = os.getenv("LT_BENEFITS_PGLITE", "/private/tmp/lt-benefits-pg/node_modules/@electric-sql/pglite/dist/index.js")
        node = os.getenv("LT_BENEFITS_NODE", "/usr/local/bin/node")
        if not Path(runtime).is_file() or not Path(node).is_file():
            self.skipTest("Optional isolated PGlite runtime unavailable")
        result = subprocess.run([node, str(Path(__file__).with_suffix(".mjs")), runtime, str(BACKEND)],
            capture_output=True, text=True, timeout=120)
        self.assertEqual(result.returncode, 0, (result.stdout + result.stderr)[-12000:])
        self.assertIn("Atomic follow-ups bundle SQL passed", result.stdout)


if __name__ == "__main__":
    unittest.main()
