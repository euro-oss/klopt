#!/usr/bin/env bash
# Fail-fast Vitest wrapper for verify #232: cap wall time and dump Postgres
# session state when the suite hangs or times out.
set -euo pipefail

TIMEOUT_MINUTES="${KLOPT_VITEST_TIMEOUT_MINUTES:-12}"
DATABASE_URL="${DATABASE_URL:-postgres://klopt:klopt@localhost:5432/klopt}"
WATCHDOG_SECONDS="${KLOPT_VITEST_WATCHDOG_SECONDS:-240}"

dump_pg_diagnostics() {
  local label="${1:-snapshot}"
  if ! command -v psql >/dev/null 2>&1; then
    echo "::warning::psql not installed; skipping Postgres diagnostics ($label)"
    return 0
  fi
  echo "--- Postgres diagnostics ($label) ---"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=0 <<'SQL' || true
\echo '::group::pg_stat_activity (all states)'
SELECT pid,
       usename,
       state,
       wait_event_type,
       wait_event,
       now() - xact_start AS xact_age,
       now() - query_start AS query_age,
       left(query, 200) AS query
FROM pg_stat_activity
WHERE datname = current_database()
  AND pid <> pg_backend_pid()
ORDER BY coalesce(xact_start, query_start) NULLS LAST;

\echo '::group::pg_locks joined to pg_stat_activity'
SELECT l.granted,
       l.mode,
       l.relation::regclass AS relation,
       l.pid,
       a.state,
       a.wait_event_type,
       a.wait_event,
       now() - a.xact_start AS xact_age,
       left(a.query, 120) AS query
FROM pg_locks l
JOIN pg_stat_activity a ON l.pid = a.pid
WHERE a.datname = current_database()
  AND a.pid <> pg_backend_pid()
ORDER BY l.granted, l.mode, l.pid;
SQL
  echo "--- end Postgres diagnostics ($label) ---"
}

on_exit() {
  local code=$?
  if [ -n "${watchdog_pid:-}" ]; then
    kill "${watchdog_pid}" 2>/dev/null || true
    wait "${watchdog_pid}" 2>/dev/null || true
  fi
  if [ "$code" -ne 0 ]; then
    dump_pg_diagnostics "exit trap"
  fi
  return "$code"
}

trap on_exit EXIT

(
  sleep "${WATCHDOG_SECONDS}"
  echo "::warning::Vitest still running after ${WATCHDOG_SECONDS}s — dumping Postgres state"
  dump_pg_diagnostics "watchdog @ ${WATCHDOG_SECONDS}s"
) &
watchdog_pid=$!

echo "Running vitest (timeout ${TIMEOUT_MINUTES}m, watchdog ${WATCHDOG_SECONDS}s)…"
timeout --signal=TERM --kill-after=60s "${TIMEOUT_MINUTES}m" pnpm run test