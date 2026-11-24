#!/usr/bin/env bash
# Part of #228: 20 consecutive latency-gate suite runs (20/20) at 1500 ms non-GET delay.
set -euo pipefail
cd "$(dirname "$0")/../.."
export KLOPT_E2E_API_DELAY_MS="${KLOPT_E2E_API_DELAY_MS:-1500}"
export KLOPT_E2E_API_DELAY_NON_GET_ONLY="${KLOPT_E2E_API_DELAY_NON_GET_ONLY:-1}"
SPECS=(
  e2e/setup-helpers-latency.spec.ts
  e2e/import-advanced-hydration.spec.ts
  e2e/import-wizard-exact-resume.spec.ts
  e2e/setup.spec.ts
  e2e/account-menu.spec.ts
  e2e/signin-setup-redesign.spec.ts
)
RUNS="${1:-20}"
for ((run = 1; run <= RUNS; run++)); do
  echo "=== latency gate run ${run}/${RUNS} ==="
  pnpm exec playwright test "${SPECS[@]}" --workers=1 --retries=0 --reporter=line
done
echo "=== ${RUNS}/${RUNS} latency gate runs passed ==="