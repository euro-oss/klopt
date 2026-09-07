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
  ubl/2.1/                                OASIS UBL 2.1 schemas, verbatim
  peppol/bis-3/*.sch                      BIS and NLCIUS rules, executed as-is
  charts/nl-mkb.json                      the default chart, RGS-mapped
```

A chart of accounts is reference data for the same reason: a firm ships the one
it always uses as a file, not as a fork. A test validates every account in every
shipped chart against the loaded RGS scheme — real code, still active, deep
enough to post to, and agreeing about which side it sits on.

`@klopt/core/reference` loads and validates them at boot. Two versions of an
artefact can be loaded at once, which the RGS upgrade diff needs and which a
Peppol BIS transition window will need. `KLOPT_REFERENCE_DATA_DIR` moves the
directory.

An RGS release is: download the workbook, `pnpm rgs:generate`, review the diff,
commit. No deploy, no code change. See
[0011](decisions/0011-rgs-as-reference-data.md).

A Peppol BIS release is smaller still: replace the `.sch` files and restart.
They are parsed and evaluated as written, by an ISO Schematron evaluator over an
XPath 3.1 engine, with nothing compiled and nothing generated
([0017](decisions/0017-schematron-in-process.md)). The parser throws on any
construct it cannot translate rather than skipping it — a validator that quietly
checks less is the one failure mode that would matter.

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

Access is granted by inviting an email address, not by issuing a link. Klopt's
only credential is a code sent to an address, so control of the mailbox already
is the identity, and a token in a link would be a second and weaker credential
for the same fact. Signing in claims any invitation for that address. See
[0015](decisions/0015-invitations-are-addresses.md).

There is exactly one exception, and it is deliberate. **Creating an
administration** has no entity to scope to and resolves a `SetupContext`
instead: a session, and the single permission `entity:create`. A bearer token is
refused outright rather than ignored, because a token is issued _by_ an
administration and must not be able to create another. See
[0014](decisions/0014-entity-provisioning.md).

### Two rules for the web app

**Every write carries an idempotency key in its payload.** A browser cannot set
an `Idempotency-Key` header on a server-function call, and spec 10.2 makes one
mandatory on every write, so the screen generates a key per attempt and reuses
it across retries. That is what makes a double click post once. Without it no
screen can write at all — which is exactly what was true until a browser test
tried to post an entry.

**A module a route imports must export nothing but server functions and plain
data.** TanStack Start strips `createServerFn` handler bodies from the client
bundle and drops the imports only they used. An exported top-level helper cannot
be stripped, so its server-only imports follow it into the browser — and Start's
import protection then fails the build, which is the right outcome and a
baffling one if you do not know the rule.

Helpers live in `apps/web/src/server/internal.ts`, which no route imports.

**Parsing happens in the handler, not in `validator`.** A `createServerFn`
validator that throws does not go through `run`, so the rejection escapes the
server function and the screen sees nothing at all. `runWith` parses inside the
same `try`, and a bad field comes back as a problem document with its path.

## One invoice, two documents

`presentInvoice` in `@klopt/core` lays an invoice out for a human and
`@klopt/adapters/pdf` draws it, from **the same source the XML is built from**.
That is the property worth protecting: a document that says 1.755,00 to the
customer and 1750.00 to their software is worse than either being wrong alone.

The layout decisions — the wording, the VAT grouping, the notice that Wet OB
art. 35a requires when no VAT is charged — are made in core. The renderer
places text and draws lines and decides nothing, which is why a reverse-charge
invoice saying "btw verlegd" is a domain test rather than a screenshot.

Money and date formatting live in `@klopt/core/format`, a **browser-safe
subpath**: the package's main entry reads reference data with `node:fs`, so a
bundler that follows it into the client produces a module that throws on first
use. One formatter, because the screens and the PDF must agree.

## Not built yet

Banking, VAT and purchase are M2 to M4. M1 is complete: invoices go out by
email with their UBL and PDF attached, and overdue ones are chased on a derived
schedule ([0018](decisions/0018-dunning-stage-is-derived.md)).

A Peppol access point is not built. It sits behind `EInvoiceTransport` and
cannot be built without a service provider agreement and issued certificates
(spec 8) — the port's `reachable()` exists so that choosing the email fallback
is a decision made before sending rather than a recovery afterwards.

**Payments are not tracked**, so "overdue" means issued and not cancelled. The
dunning list overstates itself for anyone who has paid, and says so on the
screen. It is the one number in the product that is knowingly wrong.

The PDF is not Factur-X or PDF/A-3: those additionally want an ICC profile, an
output intent and XMP metadata. The attachment relationship is `Alternative`,
which is the truthful part of it.

In the UI: the command palette and `g`-prefix navigation are in the keyboard map
and the binding registry but not yet wired to a listener. Contacts can be
created but not edited.

Reminders are sent by hand from the Aanmaningen screen. Scheduling them is a
worker job, which is why `apps/worker` exists and is empty. In the UI: the command palette
and `g`-prefix navigation are in the keyboard map and the binding registry but
not yet wired to a listener.
