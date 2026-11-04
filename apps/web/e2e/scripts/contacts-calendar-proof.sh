#!/usr/bin/env bash
# Calendar proof for contacts open-overdue styling (#195).
# One fresh dev server per Playwright invocation (KLOPT_E2E_TODAY_ISO at process start).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

SPEC=e2e/contacts-open-overdue-styling-calendar.spec.ts
PORT=3399
BASE_URL="http://localhost:${PORT}"

DATES=(
  2026-11-04
  2027-01-01
  2027-01-02
  2027-01-15
  2027-02-20
  2027-03-05
  2027-12-31
)

WEB_SERVER_PID=""

port_in_use() {
  curl -sS --connect-timeout 1 -o /dev/null "http://127.0.0.1:${PORT}/" 2>/dev/null
}

assert_port_free() {
  if port_in_use; then
    echo "ERROR: port ${PORT} is already in use. Stop the other listener before running calendar proof." >&2
    exit 1
  fi
}

wait_for_port() {
  local attempt
  for attempt in $(seq 1 60); do
    if port_in_use; then
      return 0
    fi
    sleep 2
  done
  echo "ERROR: timed out waiting for dev server on ${BASE_URL}" >&2
  return 1
}

stop_owned_web_server() {
  if [[ -n "${WEB_SERVER_PID}" ]] && kill -0 "${WEB_SERVER_PID}" 2>/dev/null; then
    kill "${WEB_SERVER_PID}" 2>/dev/null || true
    wait "${WEB_SERVER_PID}" 2>/dev/null || true
  fi
  WEB_SERVER_PID=""
}

start_owned_web_server() {
  local date=$1
  stop_owned_web_server
  assert_port_free
  eval "$(pnpm exec tsx e2e/scripts/calendar-proof-export-env.ts "$date")"
  pnpm exec vite dev --host 127.0.0.1 --port "${PORT}" &
  WEB_SERVER_PID=$!
  wait_for_port
}

trap 'stop_owned_web_server' EXIT

fail=0
echo '| Date | Customer | Supplier |'
echo '|------|----------|----------|'

assert_port_free

for date in "${DATES[@]}"; do
  customer=FAIL
  supplier=FAIL
  start_owned_web_server "$date"
  if KLOPT_E2E_TODAY_ISO="$date" KLOPT_E2E_BASE_URL="$BASE_URL" pnpm exec playwright test "$SPEC" -g 'customer styling' --reporter=line; then
    customer=PASS
  else
    fail=1
  fi
  stop_owned_web_server
  start_owned_web_server "$date"
  if KLOPT_E2E_TODAY_ISO="$date" KLOPT_E2E_BASE_URL="$BASE_URL" pnpm exec playwright test "$SPEC" -g 'supplier styling' --reporter=line; then
    supplier=PASS
  else
    fail=1
  fi
  stop_owned_web_server
  echo "| $date | $customer | $supplier |"
done

if [[ "$fail" -ne 0 ]]; then
  echo 'Calendar proof: at least one date failed.' >&2
  exit 1
fi

echo 'Calendar proof: all dates passed.'
