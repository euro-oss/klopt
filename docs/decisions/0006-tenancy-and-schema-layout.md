# 0006. Named Postgres schema from the first table, RLS-ready

Status: Accepted
Date: 2026-09-04

## Context

Requirement 14: single-tenant by default, multi-entity within one instance from
v1, and multi-tenant hosting as a phase-two deployment mode enforced with
row-level security plus a schema per tenant — "decided before the first line of
data-access code, never retrofitted".

This is that line of data-access code.

## Decision

- All application tables live in a named `klopt` schema, never `public`. A
  future schema-per-tenant layout then adds schemas alongside rather than
  renaming everything that exists.
- pg-boss gets its own schema, `klopt_jobs`, so queue tables never appear in a
  dump of the books or in an XAF export's blast radius.
- Every tenant-scoped table carries its entity key as a real column from the
  day it is created, even while the instance is single-tenant. RLS policies are
  then additive.
- The application connects as a role without `BYPASSRLS`. Migrations use a
  separate, more privileged role.

## Consequences

- Slightly more ceremony in every migration and query.
- The append-only journal requirement (6.2) needs database-level permissions and
  a trigger, which is far easier to express against a role that is already
  narrow. This decision is a prerequisite for that one.
- Nothing here commits us to shipping multi-tenant hosting. It only keeps the
  door open at close to zero cost, which is the whole point of deciding now.
