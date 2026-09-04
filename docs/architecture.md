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

## Compliance artefacts

Everything in `reference-data/` is **data loaded at runtime, never code**
(principle 6), because every one of these changes on somebody else's schedule.

```
reference-data/
  rgs/rgs-3.7-mkb.json                    generated by tools/rgs-import
  xaf/XmlAuditfileFinancieel3.2.xsd       published schema, verbatim
```

`@klopt/core/reference` loads and validates them at boot. Two versions of an
artefact can be loaded at once, which the RGS upgrade diff needs and which a
Peppol BIS transition window will need. `KLOPT_REFERENCE_DATA_DIR` moves the
directory.

An RGS release is: download the workbook, `pnpm rgs:generate`, review the diff,
commit. No deploy, no code change. See
[0011](decisions/0011-rgs-as-reference-data.md).

## Two ways in, one shape out

A **bearer token** is a machine, scoped to one entity with an explicit
permission list. A **session cookie** is a human, whose role in the active
entity expands to the same permission strings.

```
Authorization: Bearer …  ─┐
                          ├─► RequestContext ─► handler ─► @klopt/core
Cookie: session …  ───────┘     { actor, entityId, permissions, … }
```

Handlers, the domain and the audit log cannot tell which it was. That is what
makes principle 3 hold: the UI has no privileged path because there is no
privileged path to have. A test asserts both contexts have the same shape.

### One rule for the web app

**A module a route imports must export nothing but server functions and plain
data.** TanStack Start strips `createServerFn` handler bodies from the client
bundle and drops the imports only they used. An exported top-level helper cannot
be stripped, so its server-only imports follow it into the browser — and Start's
import protection then fails the build, which is the right outcome and a
baffling one if you do not know the rule.

Helpers live in `apps/web/src/server/internal.ts`, which no route imports.

## Not built yet

Sales, banking, VAT and purchase are M1 to M4. In the UI: the command palette
and `g`-prefix navigation are in the keyboard map and the binding registry but
not yet wired to a listener.
