# 0003. Track TanStack Start stable, pin exact, upgrade deliberately

Status: Accepted
Date: 2026-09-04

## Context

Open decision 17.5: pin TanStack Start to a release-candidate version, or track
its releases. The requirements were written while Start was at Release
Candidate, and section 11.2 named that as "the one real risk in this stack".

Start has since shipped stable, which removes most of that risk. What remains is
release cadence: `@tanstack/react-router` and `@tanstack/react-start` ship
frequently and their versions move independently of each other.

## Decision

- Depend on stable releases only. No release candidates, no `next`.
- Pin **exact** versions, no `^`. `pnpm-lock.yaml` is committed and CI installs
  with `--frozen-lockfile`.
- Upgrade Start deliberately, as its own pull request, never bundled with a
  feature. The PR body records what changed in the framework and what in the
  app.
- Section 11.2's mitigation still stands and is the reason this is a low-stakes
  decision: the domain lives in `packages/core` with no framework imports, and
  the boundary is enforced by the linter (see 0005). If Start turns out to be
  the wrong bet, `apps/web` is replaced and the part that took the real effort
  survives.

## Consequences

- Dependency updates are manual work rather than a Renovate range bump. That is
  the intent: a framework upgrade in an accounting system should be somebody's
  deliberate afternoon.
- Section 11.2 of the requirements is now partly stale. It should be revised to
  say that the residual risk is contributor familiarity, not framework maturity.
