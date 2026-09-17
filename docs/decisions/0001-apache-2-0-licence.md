# 0001. Apache-2.0, no CLA, no enterprise edition

Status: Accepted
Date: 2026-09-04

## Context

Settled in the requirements (section 11.5) before the repository existed. It is
recorded here because a permissive licence gets relitigated by every newcomer
unless the reasoning is written down where they will find it.

## Decision

Apache-2.0. DCO sign-off rather than a CLA. No feature gating, ever.

Apache-2.0 over MIT for three things MIT lacks: an express patent grant from
contributors, which matters because e-invoicing, payments and document
processing are patent-active areas; section 5, which aligns inbound
contributions with outbound licensing and removes the need for a CLA; and an
explicit trademark carve-out, which is the split we want — the code is given
away, the name is not.

## Consequences

- Anyone may take Klopt closed and sell it, including an incumbent.
- Relicensing later needs every contributor's agreement. This is close to a
  one-way door.
- A CLA would only buy the option to relicense, which we have just given up, so
  it would be friction for nothing.
- The trademark becomes the only retained exclusivity, which makes the clearance
  check (open decision 17.7) load-bearing rather than housekeeping.
