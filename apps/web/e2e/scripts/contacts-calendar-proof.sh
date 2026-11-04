#!/usr/bin/env bash
# Calendar proof for contacts open-overdue styling (#195).
# One fresh dev server per Playwright invocation (KLOPT_E2E_TODAY_ISO at process start).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

SPEC=e2e/contacts-open-overdue-styling-calendar.spec.ts

DATES=(
  2026-11-04
  2027-01-01
  2027-01-02
  2027-01-15
  2027-02-20
  2027-03-05
  2027-12-31
)

fail=0
echo '| Date | Customer | Supplier |'
echo '|------|----------|----------|'

for date in "${DATES[@]}"; do
  customer=FAIL
  supplier=FAIL
  if KLOPT_E2E_TODAY_ISO="$date" pnpm exec playwright test "$SPEC" -g 'customer styling' --reporter=line; then
    customer=PASS
  else
    fail=1
  fi
  if KLOPT_E2E_TODAY_ISO="$date" pnpm exec playwright test "$SPEC" -g 'supplier styling' --reporter=line; then
    supplier=PASS
  else
    fail=1
  fi
  echo "| $date | $customer | $supplier |"
done

if [[ "$fail" -ne 0 ]]; then
  echo 'Calendar proof: at least one date failed.' >&2
  exit 1
fi

echo 'Calendar proof: all dates passed.'
