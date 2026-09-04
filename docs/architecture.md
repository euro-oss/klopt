# Architecture

The one-page version. Decisions and their reasoning live in
[`docs/decisions`](decisions/).

## Layout

```
packages/
  core        framework-free domain: ledger, posting, VAT engine, numbering,
              RGS, XAF, UBL, XBRL. Imports no framework, no database, no adapter.
  db          Drizzle schema, migrations, repositories.
  adapters    filing, bank feed, e-invoice transport, payment initiation.
apps/
  web         TanStack Start. Routes, server functions, UI, and the versioned
              REST API. Transport only — no business rules.
  worker      job runner. Imports the same core, none of the framework.
tools/
  eslint-plugin-klopt   project-specific lint rules.
```

The arrows only ever point inward:

```
apps/web ─┐
          ├─► @klopt/adapters ─► @klopt/core
apps/worker ─► @klopt/db ──────► @klopt/core
```

`@klopt/core` depends on nothing in this repository. That is enforced by ESLint
(see [0005](decisions/0005-domain-boundary-enforcement.md)), and it is the
property that makes the framework choice reversible.

## Three surfaces, one core

REST for systems, MCP for agents, CLI for operators — plus the web UI, which is
a fourth client and not a privileged one. All of them resolve actor, entity and
permissions in middleware and pass them to the domain as explicit arguments. The
domain has no ambient context.

`apps/web` exposes two surfaces over the same core:

- **Server functions**, an internal RPC for the app. Not a contract for third
  parties.
- **`/api/v1`**, versioned REST with a generated OpenAPI 3.1 document. This is
  the product.

Both are thin. A rule that exists in only one of them is in the wrong place.

### The mechanism that keeps that true

`apps/web/src/api/manifest.ts` binds every domain operation registered in
`@klopt/core` to a route, and `apps/web/test/contract.test.ts` fails the build
when an operation has no route or a route names an operation that does not
exist. Without it, principle 3 quietly stops being true around month six.

## What is enforced mechanically

| Rule                                                                    | Mechanism                          |
| ----------------------------------------------------------------------- | ---------------------------------- |
| `core` imports no framework, database or adapter                        | ESLint `no-restricted-imports`     |
| No cycles, no phantom dependencies, no devDependency in production code | dependency-cruiser                 |
| No `number` in the money path                                           | `klopt/no-number-money`            |
| Every domain operation has a REST route                                 | contract test                      |
| Every write operation is idempotent                                     | `defineOperation` throws otherwise |
| Ledger invariants hold for any posting sequence                         | property tests (from M0)           |
| Regulated artefacts match the official schema                           | golden files in CI (from M0)       |

Anything on that list that is only a convention is one refactor away from being
false.

## The posting path

Everything that writes to the journal goes through one function,
`postJournalEntry` in `@klopt/core`. There is no second way in, and the database
would refuse one if there were.

```
POST /api/v1/journal-entries
  │
  ├─ resolveRequestContext     bearer token -> actor, entity, permissions
  ├─ zod schema                money arrives as a string, never a number
  │
  └─ withLedger(db)            ONE transaction for everything below
       │
       └─ postJournalEntry     @klopt/core, framework-free
            ├─ idempotency replay check      a retry never double-posts
            ├─ loadPostingContext            entity, journal, period, accounts, dimensions
            ├─ validateCommandShape          balance, dates, line sanity
            ├─ resolve accounts + dimensions required-dimension rules
            ├─ convertToFunctional           FX, allocated on the entry total
            ├─ allocateChainPosition         row lock: serialises the entity's chain
            ├─ allocateEntryNumber           gapless, returns on rollback
            ├─ hashEntry                     sha256 over the canonical form
            ├─ insertEntry
            ├─ applyPeriodBalances           incremental, for sub-second reports
            ├─ recordIdempotency
            ├─ appendAudit
            └─ enqueueEvent                  outbox, same transaction
```

The database independently enforces the same invariants, because the
application's version is a good error message and the database's version is a
guarantee. See `packages/db/migrations/0001_ledger_guards.sql`: append-only,
balance, period control, chain linkage, gapless allocation.

## Not built yet

RGS reference data and the mapping UI, year close, balance sheet and P&L, and
XAF 3.2 export and import. The web UI is a placeholder page — the API is the
product, and it came first by construction.
