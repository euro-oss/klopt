# Architecture decision records

One file per decision, numbered, never edited after acceptance — a decision that
turns out wrong gets a new record that supersedes it. This is the same rule the
journal follows, for the same reason.

| #                                             | Decision                                                            | Status   |
| --------------------------------------------- | ------------------------------------------------------------------- | -------- |
| [0001](0001-apache-2-0-licence.md)            | Apache-2.0, no CLA, no enterprise edition                           | Accepted |
| [0002](0002-typescript-5-not-7.md)            | Pin TypeScript 5.9, not the 7.x that `latest` points at             | Accepted |
| [0003](0003-tanstack-start-version-policy.md) | Track TanStack Start stable, pin exact, upgrade deliberately        | Accepted |
| [0004](0004-money-representation.md)          | bigint minor units in process, decimal string on the wire           | Accepted |
| [0005](0005-domain-boundary-enforcement.md)   | Enforce the core boundary with ESLint, not dependency-cruiser alone | Accepted |
| [0006](0006-tenancy-and-schema-layout.md)     | Named Postgres schema from the first table, RLS-ready               | Accepted |
| [0007](0007-postgres-only-infrastructure.md)  | Postgres is the queue, the search index and the cache               | Accepted |
| [0008](0008-adapter-ports-deferred.md)        | Adapter port signatures wait for the domain types                   | Accepted |

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
