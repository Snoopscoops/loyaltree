#!/bin/sh
set -eu
# Must be set before the Python interpreter creates allocator arenas.
export MALLOC_ARENA_MAX="${MALLOC_ARENA_MAX:-2}"
cd "$(dirname "$0")"
exec gunicorn main:app --worker-class uvicorn_worker.UvicornWorker \
  --workers 1 --bind "0.0.0.0:${PORT:-8000}" \
  --max-requests 500 --max-requests-jitter 50 \
  --timeout 90 --graceful-timeout 30 --access-logfile - --error-logfile -
