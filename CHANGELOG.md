# Changelog

Notable changes, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## What a version number means here

Klopt is `0.x`, which means the shape can still move. What cannot move without a
major version is listed in [`docs/api-stability.md`](docs/api-stability.md), and
it is deliberately narrow: the routes in `/api/v1`, the event catalogue, and the
permission names. Everything else — table names, the TypeScript packages, MCP
tool names, audit `action` strings, the message catalogues — may change in any
release.

Decisions live in [`docs/decisions`](docs/decisions), one file per decision,
never edited after acceptance. Where an entry below says something surprising,
the ADR is where the reasoning is.

## Unreleased

### A product palette: white, black and yellow

- **Three colours.** `#FFFFFF`, `#000000` and `#FFD51E`, named once in
  `apps/web/src/styles/app.css` with every shadcn token an alias onto one of
  them. Yellow is the accent and nothing else claims that job. Greys are the
  two neutrals mixed — written as `color-mix`, so the file says "black at a
  quarter strength" rather than hiding a fourth colour in a hex. The
  marketing site keeps its own purple; product and site diverged on colour on
  purpose.
- **Two themes, light first.** `:root` is light and `.dark` restates only what
  differs. The theme is a cookie resolved on the server and written into
  `<html>` before the first paint, so switching is not a white flash, and it
  is in the sidebar beside the language — the other "how this looks to me"
  choice.
- **Square, and flat.** The radius scale is zero at every step and there are
  no shadows anywhere, including the two floating panels — the command palette
  and the select listbox — which are separated by a border instead.
- **Status is not the accent.** An error is not "look here", so `destructive`
  and a negative amount take a red of their own, and the "nobody has checked
  this yet" state takes an amber. Both are `--status-*`, both have a value per
  theme, and neither is the yellow: a screen where the button, the warning and
  the error are one colour says nothing three times.
- **One typeface, no monospace.** Ubuntu Sans Variable at 400, 500 and 600.
  Account numbers, RGS codes, hashes and amounts use `tabular-nums`, which is
  what a column of figures actually needs; whether anything here wants a mono
  face is a later decision.

### The day's work, on the screen it opens on (alpha 2)

- **The dashboard is a work queue.** What is waiting, in the order the day is
  worked — drafts to send, invoices past their terms, reminders ready to go,
  bank lines with no counter-entry, post waiting for a draft, purchase invoices
  to book and to approve. Each row opens the screen where that work is done,
  and a row with nothing in it is not shown, so an empty queue means an empty
  desk rather than a wall of zeroes. A row the reader may not act on is left
  out rather than shown and refused: an auditor is not told to approve four
  purchase invoices. The three health figures are still here, under it.
- **One book year for the whole application**, in the shell beside the
  administration, with the dates of the year under its label. The dashboard,
  the proefbalans, the balans, the winst-en-verliesrekening and both ageing
  reports read it, and the year they are showing is in the address as well as
  in a cookie, so a report can be sent to somebody and arrive showing the same
  figures. Momentopnames and de Exact-import default their year field from the
  same book years rather than from the clock. They all used to call
  `new Date().getFullYear()`, which is the calendar year and not the boekjaar:
  for an administration running July to June — which `/setup` offers — that was
  the wrong year for half of every year, chosen silently, and as a module-level
  constant it was also stale for anybody whose browser was open over New Year.
- **Ouderdomsanalyse is in the navigation**, on both sides. Creditor ageing
  existed and was reachable only from a button on Inkoopfacturen; debtor ageing
  is new, built on the open items `GET /reports/overdue-invoices` already
  publishes, so it reports what is _due_ and says so.
- **The queue is worked from the keyboard.** Focus lands on the first row,
  `j`/`k` and the arrows move, `Enter` opens, `Escape` hands the keyboard back.
  `g v` and `g c` go to the two ageing reports. The rest of the list keyboard
  in `docs/keyboard-map.md` is still Alpha 4's job.

## [0.1.0] — 2026-09-17

The first version worth a number. Milestones M0 through M6 of the specification
are complete: an immutable ledger, sales, banking, VAT, purchase, hardening and
the platform surface. 118 REST operations, 11 event types, 12 MCP tools, nine
modules, 31 migrations, 58 architecture decisions, 1 820 tests and 82
browser tests.

An accountant can keep a Dutch administration in this today. The four things
that are still missing are at the bottom, with why — a changelog that lists only
wins is a sales document.

### The ledger (M0)

- **An append-only journal, hash-chained.** Every entry hashes its own canonical
  content plus its predecessor, so one head hash covers the whole journal and
  `GET /ledger/chain-verification` recomputes it. Database triggers refuse an
  `UPDATE` or a `DELETE`: append-only is a property of the table, not a habit of
  the code.
- **Money is `bigint` minor units in process and a decimal string on the wire**
  (ADR 0004). A lint rule fails the build on `z.number()` for a money field, so
  it is enforced rather than remembered.
- **Gapless numbering per journal and per year**, because a gap in a series is a
  question from the Belastingdienst.
- **N-dimensional analytics**, period control with soft close, foreign currency
  with balances qualified per currency (ADR 0009), and reversals.
- **RGS 3.7** as generated reference data rather than code (ADR 0011), with a
  coverage report and a mapping upgrade preview.
- **Year close**, trial balance, balance sheet and profit-and-loss — the same
  `BalanceRow` arranged three ways, so the sheet's result and the P&L's bottom
  line are provably the same number.
- **XAF 3.2 export and import**, validated twice: against the published
  Belastingdienst schema and against our own rules (ADR 0012). An invalid
  auditfile is a build-breaking bug, not a warning, and it is never offered for
  download.

### Sales (M1)

- Contacts, draft invoices priced by the engine rather than by the caller,
  issuing that allocates the number and posts the entry in one transaction.
- **UBL 2.1 / NLCIUS**, with the Peppol schematron running in process on an
  XPath 3.1 engine as data rather than as a generated stylesheet (ADR 0017).
  Nothing sends until it validates.
- PDF rendering, email delivery, and an evidence chain recording the hash of
  the exact document that went out.
- **Dunning stages are derived, and a failed send is a record** (ADR 0018) — a
  reminder that bounced is a fact about the debtor relationship, not a retry.

### Banking (M2)

- CAMT.053 and MT940 import, refusing a file whose balances do not add up rather
  than importing a wrong one.
- A matching engine that **suggests**, with the confirmation being what teaches
  the rule (ADR 0019). A payment quoting an invoice number teaches nothing,
  because the next one will quote its own.
- pain.001 payment files, which **need two people and neither may be a script**
  (ADR 0020).
- A payment run pays suppliers rather than invoices, and scheduling is not
  paying (ADR 0027).

### VAT (M3)

- A tax-code engine where **a journal line says whether it is the base or the
  tax** (ADR 0021), because inferring it from the account breaks on the first
  invoice carrying 21% and 9% on one revenue account.
- The BTW-aangifte derived from the journal every time it is read, never from a
  stored tally, with a control-account reconciliation on the face of the report.
- ICP opgaaf with VIES validation, where **an unproven VAT number blocks the
  opgaaf and an outage is not proof** (ADR 0023).
- XBRL generation, and **filing soft-closes the period; a correction is a
  suppletie** (ADR 0022).
- The manual filing path is the default and Digipoort's signature is a seam
  (ADR 0024).

### Purchase (M4)

- **On a purchase invoice the supplier is the authority** (ADR 0025): their
  stated net, VAT and total are recorded as given, and the checks say what
  disagrees rather than silently recomputing.
- Booking precedes approval, and approval is deliberately something only a
  person may do.
- **One inbox for everything that arrives** (ADR 0026) — upload, email, Peppol —
  with the content hash as the document's name, and two doorways with
  at-least-once delivery (ADR 0028).

### Hardening (M5)

- **Retention and WORM.** A retention term is a fact derived from the book year
  of whatever a document is evidence for; deletion is a decision somebody makes,
  audited, permissioned and previewed (ADR 0030). With S3 object lock, the
  storage refuses so the application need not be trusted (ADR 0032).
- **Sealed snapshots** small enough to write down (ADR 0031): a chain head, a
  manifest of document hashes, an auditfile hash, and one hash over all of it.
- **An audit log with no holes** (ADR 0029), covering API calls as well as UI
  actions, exportable as CSV.
- **The Exact Online importer**, including the document archive.
- **Multi-entity with one login** (ADR 0034), with isolation asserted as a test
  rather than left as a habit (ADR 0033).
- **Contact pseudonymisation** that answers a right-to-erasure request without
  falsifying the books (ADR 0039).

### Platform (M6)

- **A public API stability commitment** — `docs/api-stability.md` — and an
  OpenAPI document that is generated from the route manifest, the operation
  registry, the Zod schemas and the handlers' own return types, with a test that
  refuses a stale copy (ADR 0043, ADR 0044).
- **The event stream and webhooks.** Eleven versioned event types, each emitted
  inside the transaction that made the change. Webhooks are signed with the
  timestamp inside the signed material, ordered per endpoint, retried with
  backoff, switched off loudly, and replayable.
- **A module contract with teeth** (ADR 0041): nine modules declaring their
  tables, events, postings and permissions, with a test that reads the schema
  and fails on an unowned table. `examples/notifier` is the worked example, and
  a lint rule forbids it from importing any Klopt package.
- **An MCP server that is a client of the public API, not a privileged path**
  (ADR 0035). Twelve tools, read broad and write narrow, with every write
  producing a draft a human releases. There is no `query` tool and never will
  be.
- **OAuth as a way to get a token, not a second way in** (ADR 0036), and tokens
  that can actually be revoked (ADR 0037).
- **Headless mode.** `klopt serve --headless` mounts the API and no web app, and
  the gate is the first thing any request meets (ADR 0056).

### Language

- **Dutch is the source and English is a translation** (ADR 0038). The domain
  sends a message key and the reader picks the words: 103 refusals and 71
  findings, the auditfile import's problems among them, each carrying a key
  that names the sentence rather than a code (ADR 0045 through 0048). A test
  walks the catalogue, so a new message fails the build until it has Dutch.
- Rubriek names stay Dutch on purpose — they are the words on the
  Belastingdienst's form.

### For integrators

- **`updatedSince`** on the four lists whose rows change in place (ADR 0053). It
  is a filter, not a subscription; `/events` remains the feed with the ordering
  guarantee, and the documentation says which is for what.
- **ETags and `If-Match`** on the two resources that have an edit to hold (ADR
  0052).
- **`POST /journal-entries/batch`**, up to 500 entries, each in its own
  transaction (ADR 0054). Per-item results is a statement about transaction
  boundaries, not about the response shape.
- **`GET /search`** across contacts, invoices, entries and documents, and
  **`GET /explain`**, which returns the lines behind a reported figure _and
  whether they add up to it_ (ADR 0055). `ties: false` is a useful answer.
- **`GET /snapshots/{id}/timestamp`** — an RFC 3161 authority's signed "I saw
  this hash at this time", as the file `openssl ts -verify` takes (ADR 0058).
  Off by default; an unreachable authority never fails a seal.

### Known limitations

Four things are specified and not finished. Each is blocked on something that
cannot be obtained or tested here, and each fails closed rather than guessing:

- **Digipoort electronic filing** is stubbed behind the filing port. It needs a
  PKIoverheid certificate and a Logius pre-production run. Filing by hand works
  and is the documented default.
- **The NT taxonomy mapping is `verified: false`.** Amounts are right; XBRL
  element names have not been checked against the published Nederlandse
  Taxonomie. Electronic filing is refused while this is true.
- **The Exact cumulative reconciliation** cannot be tested against an
  administration that returns rows for the `GLAccountCode` filter.
- **The headless image is 1.2 MB smaller, not more.** The saving is the client
  assets; the server bundle still carries SSR code for routes the middleware
  refuses, because the TanStack Start plugin accepts `routeFileIgnorePattern`
  and ignores it. The remaining prize is about 1.4 MB of 11 MB (ADR 0042).

[0.1.0]: https://github.com/euro-oss/klopt/releases/tag/v0.1.0
