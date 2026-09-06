# Architecture decision records

One file per decision, numbered, never edited after acceptance — a decision that
turns out wrong gets a new record that supersedes it. This is the same rule the
journal follows, for the same reason.

| #                                                | Decision                                                            | Status   |
| ------------------------------------------------ | ------------------------------------------------------------------- | -------- |
| [0001](0001-apache-2-0-licence.md)               | Apache-2.0, no CLA, no enterprise edition                           | Accepted |
| [0002](0002-typescript-5-not-7.md)               | Pin TypeScript 5.9, not the 7.x that `latest` points at             | Accepted |
| [0003](0003-tanstack-start-version-policy.md)    | Track TanStack Start stable, pin exact, upgrade deliberately        | Accepted |
| [0004](0004-money-representation.md)             | bigint minor units in process, decimal string on the wire           | Accepted |
| [0005](0005-domain-boundary-enforcement.md)      | Enforce the core boundary with ESLint, not dependency-cruiser alone | Accepted |
| [0006](0006-tenancy-and-schema-layout.md)        | Named Postgres schema from the first table, RLS-ready               | Accepted |
| [0007](0007-postgres-only-infrastructure.md)     | Postgres is the queue, the search index and the cache               | Accepted |
| [0008](0008-adapter-ports-deferred.md)           | Adapter port signatures wait for the domain types                   | Accepted |
| [0009](0009-balance-per-currency.md)             | Balance per currency, qualified                                     | Accepted |
| [0010](0010-hand-written-migrations.md)          | One migration runner for generated and hand-written SQL             | Accepted |
| [0011](0011-rgs-as-reference-data.md)            | RGS ships as generated reference data, not as code                  | Accepted |
| [0012](0012-xaf-two-layer-validation.md)         | XAF is validated twice, by two different things                     | Accepted |
| [0013](0013-ui-comes-in-now.md)                  | The UI arrives with M0's screens, then per milestone                | Accepted |
| [0014](0014-entity-provisioning.md)              | An administration is created by a human, under an id they bring     | Accepted |
| [0015](0015-invitations-are-addresses.md)        | An invitation is an address, not a token                            | Accepted |
| [0016](0016-ubl-generation-before-schematron.md) | UBL generation lands before schematron; nothing sends until it does | Accepted |

## Template

```markdown
# NNNN. Title

Status: Proposed | Accepted | Superseded by NNNN
Date: YYYY-MM-DD

## Context

What forced a decision.

## Decision

What was decided, in the active voice.

## Consequences

What this makes easy, what it makes hard, and what it forecloses.
```
