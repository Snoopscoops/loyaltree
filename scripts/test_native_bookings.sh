#!/usr/bin/env bash
# Creates a disposable local PostgreSQL cluster only. No production access.
set -euo pipefail
cd "$(dirname "$0")/.."
PYTHON="${LT_TEST_PYTHON:-python3}"
if ! command -v initdb >/dev/null && command -v brew >/dev/null; then
  export PATH="$(brew --prefix postgresql@16)/bin:$PATH"
fi
for bin in initdb pg_ctl psql; do command -v "$bin" >/dev/null || { echo "Missing $bin; install PostgreSQL 16 locally."; exit 1; }; done
"$PYTHON" -c 'import pytest, psycopg2, fastapi, pydantic'
PGROOT="$(mktemp -d /tmp/lt-bookings.XXXXXX)"
mkdir "$PGROOT/socket"
cleanup() { pg_ctl -D "$PGROOT/data" -m fast -w stop >/dev/null 2>&1 || true; }
trap cleanup EXIT
initdb -D "$PGROOT/data" -A trust -E UTF8 >/dev/null
pg_ctl -D "$PGROOT/data" -l "$PGROOT/postgres.log" -o "-k $PGROOT/socket -p 55432 -c listen_addresses=''" -w start
export LT_BATCH_A_PG_SOCKET="$PGROOT/socket" LT_BATCH_A_PG_PORT=55432
psql -h "$LT_BATCH_A_PG_SOCKET" -p 55432 -d postgres -v ON_ERROR_STOP=1 -c "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;"
echo "=== BOOKING API + NATIVE POSTGRES TESTS ==="
"$PYTHON" -m pytest backend/tests/test_native_bookings.py backend/tests/test_native_bookings_postgres.py -v
echo "=== EXISTING MENU REGRESSION TESTS ==="
"$PYTHON" -m pytest backend/tests/test_menu_order_adjustments_postgres.py backend/tests/test_menu_order_insights.py -q
echo "=== WEB TESTS AND BUILD ==="
cd frontend
if [ -f package-lock.json ]; then npm ci; else npm install --no-package-lock; fi
npm test
npm run build
echo "PASS: local booking and existing menu test/build commands completed."
echo "No production SQL, merge or deployment performed. Disposable DB files: $PGROOT"
