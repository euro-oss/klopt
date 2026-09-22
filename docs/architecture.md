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
  peppol/bis-3/*.sch                      BIS and NLCIUS rules — fetched, not in git
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

A Peppol BIS release is smaller still: bump the pin in
`tools/fetch-peppol-bis3.sh`, re-fetch, and restart. The `.sch` files are not
redistributed in this repository (OpenPeppol provenance — see
[`reference-data/peppol/README.md`](../reference-data/peppol/README.md)); they
are parsed and evaluated as written, by an ISO Schematron evaluator over an
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

**Capture the form element before the first `await`.** React nulls a synthetic
event's `currentTarget` once the handler returns, so `event.currentTarget.reset()`
after an `await` throws — silently, leaving the form looking as though the
submit did nothing. Read `FormData` and keep the element in a local first.

**A `<select>` inside a `<label>` needs an explicit `aria-label`.** When a
label wraps a control, the accessible name is computed from the label's text
content — which for a select includes every option, so "Datum" is announced as
"Datum, Datum, Naam, Rekening, …". Thirteen selects had this, and it broke a
browser test three separate times before it was recognised as one bug rather
than three locators. The same applies to a hint or an error message inside a
label: put them outside and attach them with `aria-describedby`.

**A React-controlled form gates its submit on hydration.** Before hydration a
controlled input accepts typing that React then discards, and the submit falls
back to a native form POST that reloads the page — so the form half-works,
which is the worst of the three states. `useHydrated` and a disabled button are
what make it either work or visibly not yet work. The sign-in screen learned
this first; the entry and invoice forms had the same bug until a browser test
set a date that never reached React's state.

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

## One transaction stream

`BankFeedProvider` has one implementation, the file one, and that is not a
placeholder: every Dutch bank exports CAMT.053 and MT940, with no licence, no
fee and no consent to renew (spec 8, rule 1).

Spec 7.4's requirement is that "API and file import must produce an identical
transaction stream so nothing downstream cares which one is in use". Both
parsers produce the same `BankStatement`, and a test gives the _same_ statement
in both formats and compares the parsed entries field by field — then the
db-backed test does it again at the far end of the pipeline. If the two ever
diverge, the matching engine is matching on whichever format happened to be
imported.

**A CSV mapping is configuration, not code.** There is no CSV standard and
every bank invents its own columns, so the layout is a `CsvMapping` stored per
account. The first import of a new bank comes back with a _guess_ from the
header row rather than an error — eleven empty dropdowns is a mapper nobody
configures — and once corrected it is remembered.

A CSV usually declares no balance, so `BankStatement.openingBalance` and
`closingBalance` are nullable and `planImport` warns that the strongest check
there is cannot run. The alternative was a fabricated zero, which would appear
on the bank screen as the account's balance.

**Amounts are signed at the edge**, positive meaning money in. MT940 and CAMT
both carry a magnitude plus a debit/credit marker, and both invert its meaning
depending on whose statement it is. Resolving it once is the difference between
one confusing bug and twenty.

**Deduplication is a unique index**, on `(bank_account_id, dedupe_key)`, with an
`onConflictDoNothing` rather than a lookup — two imports racing both pass a
lookup and only one can win an index. The key is the bank's own reference when
there is one and a content hash otherwise, and the hash includes the entry's
position in its statement: two identical card payments on the same day are an
ordinary Tuesday, and hashing them together would drop one.

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

## What is built, and what is deliberately not

M0 through M6 are complete at 0.1.0. This section used to describe M3 and M4 as
future work; that was true early and is not any more. Read
[`CHANGELOG.md`](../CHANGELOG.md) and [`ALPHA_ASSESSMENT.md`](ALPHA_ASSESSMENT.md)
for the authoritative current picture; what follows is the one-page shape.

- **M1 sales.** Invoices go out by email with their UBL and PDF attached, and
  overdue ones are chased on a derived schedule
  ([0018](decisions/0018-dunning-stage-is-derived.md)). Reminders are still a
  human click from the Aanmaningen screen.
- **M2 banking and payments.** CAMT.053, MT940 and a configurable CSV mapper,
  deduplicated per entry, a matching engine with learned rules
  ([0019](decisions/0019-matching-suggests.md)), and a keyboard queue to work
  through — `↑↓` moves, `↵` books the best suggestion, `1`–`9` pick one, `x`
  skips, and SEPA `pain.001` with a two-person approval flow
  ([0020](decisions/0020-payments-need-two-people.md)).
- **M3 VAT.** A tax-code engine, a BTW-aangifte derived from the journal with
  control-account reconciliation, ICP + VIES, and an XBRL instance. Manual
  filing is the default and works ([0024](decisions/0024-the-manual-path-is-the-default.md)).
- **M4 purchase.** One inbox (upload plus IMAP/maildir poll), inbound UBL parsed
  to a draft with the original attached, supplier-authoritative totals
  ([0025](decisions/0025-the-supplier-is-the-authority.md)), and book → approve →
  payment batch.
- **M5–M6 hardening and platform.** Retention / WORM, sealed snapshots, a
  complete audit log, an Exact Online importer, signed and replayable webhooks,
  a generated OpenAPI 3.1 document, and a module contract with an ownership test.

**Outstanding means outstanding.** An invoice's outstanding amount is its total
less the bank allocations against it, and every report that asks what is owed
joins the same subquery. Before matching existed the dunning list could only say
"issued and not cancelled" and said so on the screen; that disclaimer is gone.

### The worker is not empty

`apps/worker` runs five scheduled jobs: `inbound.poll` (every 5 minutes),
`snapshot.sealPendingYears` (04:00), `oauth.purgeExpiredCodes` (05:00),
`exact.importDocuments` (every 2 minutes) and `webhooks.deliver` (every minute).
The comment in `apps/worker/src/jobs.ts` that lists VAT period close, bank sync
and subledger recon describes work that is _not_ registered — a future note, not
a running job.

### In the UI

The command palette (`⌘K`) and the `g`-prefix / `n`-prefix navigation are wired
to a listener and work; an earlier version of this file said they were in the
registry but not yet wired, which is no longer true. Contacts can be created
**and** edited. Dark-mode tokens exist in `app.css` but nothing toggles `.dark`
yet, and there is no mobile layout — those are alpha polish, tracked in the
backlog rather than here.

### Deliberately not built (fail closed, off the alpha critical path)

A Peppol access point sits behind `EInvoiceTransport` and cannot be built
without a service provider agreement and issued certificates (spec 8) — the
port's `reachable()` exists so that choosing the email fallback is a decision
made before sending rather than a recovery afterwards. Digipoort's WS-Security
signer is a seam ([0024](decisions/0024-the-manual-path-is-the-default.md)),
PSD2 bank feeds need an AISP licence, and electronic filing stays refused while
the NT taxonomy is `verified: false`. In every case the manual or file path is
the product.

The PDF is not Factur-X or PDF/A-3: those additionally want an ICC profile, an
output intent and XMP metadata. The attachment relationship is `Alternative`,
which is the truthful part of it.
