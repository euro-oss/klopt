#!/usr/bin/env bash
# Fail-fast Vitest wrapper for verify #232: cap wall time and dump Postgres
# session state when the suite hangs or times out.
set -euo pipefail

TIMEOUT_MINUTES="${KLOPT_VITEST_TIMEOUT_MINUTES:-12}"
DATABASE_URL="${DATABASE_URL:-postgres://klopt:klopt@localhost:5432/klopt}"

dump_pg_activity() {
  if ! command -v psql >/dev/null 2>&1; then
    echo "::warning::psql not installed; skipping pg_stat_activity dump"
    return 0
  fi
  echo '--- pg_stat_activity (non-idle) ---'
  PGPASSWORD=klopt psql -h localhost -U klopt -d klopt -v ON_ERROR_STOP=1 <<'SQL' || true
SELECT pid,
       state,
       wait_event_type,
       wait_event,
       now() - xact_start AS xact_age,
       now() - query_start AS query_age,
       left(query, 200) AS query
FROM pg_stat_activity
WHERE datname = current_database()
  AND pid <> pg_backend_pid()
  AND state IS DISTINCT FROM 'idle'
ORDER BY coalesce(xact_start, query_start);
SQL
  echo '--- end pg_stat_activity ---'
}

on_exit() {
  local code=$?
  if [ "$code" -ne 0 ]; then
    dump_pg_activity
  fi
  return "$code"
}

trap on_exit EXIT

echo "Running vitest (timeout ${TIMEOUT_MINUTES}m)…"
timeout --signal=TERM --kill-after=60s "${TIMEOUT_MINUTES}m" pnpm run test