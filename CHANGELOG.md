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

### Screens for the operations that had none (alpha 3)

Five operations were implemented, tested and exposed over REST, and reachable
only from a terminal (`docs/ALPHA_ASSESSMENT.md` §3.1). The product was strictly
less capable than its own API, which is an odd thing to hand to an alpha user.
Nothing in this section is a new domain operation — the API is the one that was
already there.

- **Boekjaren (`/fiscal-years`, `g s`).** What is open, what comes next, and
  closing one. The two live on one screen because they are one act in a
  particular order: the year that follows has to exist before the year before it
  can carry its balances forward. When it does not, the screen names the date
  that is missing and offers the year, with the alternative — closing without an
  opening balance — beside it as a checkbox.
- **Opening the next year is one field.** `POST /fiscal-years` takes a four-digit
  label and derives the dates from the administration's own starting month, so
  the dates are shown rather than asked for. A date input the server ignores is a
  date input that lies. The new year turns up in the shell's year picker, which
  is where #5's readers look for it.
- **A close shows both entries, line by line, before it posts either.**
  `closeYear` has always taken `dryRun` and answered in the same shape either
  way; the screen always asks that question first. The acknowledgement says what
  happens rather than "are you sure": _"Boekt twee echte journaalposten; hier zit
  geen knop om dat terug te draaien."_ There is no reopen operation by design —
  undoing a close is a reversal like any other — and no button here pretends
  otherwise.
- **A year that is already closed says so and is not offered again.** Closing
  records a row in `year_closes` and the only thing that reads it is the check
  `POST /fiscal-years/close` makes before it does anything, dry run included. So
  the dry run _is_ the question, a `conflict` is its answer, and it arrives in the
  API's own words.
- **De auditfile, er weer in (`/audit-file`, `g q`).** XAF 3.2 has gone out since
  M2 and could not come back, which made "your books are yours" a one-way claim.
  Export and import share the screen, and the dashboard points at both. Two steps
  on purpose, like the bank import: pick a file, read what it would do, confirm.
- **An XAF file has to match the chart, and the screen says so instead of
  failing.** There is no chart-of-accounts create operation in the API and adding
  one is a domain change with its own review (#15), so a file naming accounts
  this administration does not have gets a specific message, a count, and no
  import button — rather than a stack trace, or a partial import.
- **Zoeken in het palet.** `Cmd/Ctrl`+`K` has two halves now: **Navigatie**,
  filtered from the registry in memory, and **Inhoud**, which is `GET /search`
  across relaties, verkoop- en inkoopfacturen, journaalposten en documenten. The
  MCP `search` tool has been reading that operation since M6, so the agent could
  find a relatie by name and the bookkeeper could not. The arrows walk both halves
  as one list and `Enter` opens the record, not a list it might be on.
- **`/` is still unbound**, now on purpose rather than for want of a search:
  `Cmd`+`K` opens the palette with the cursor already in the field, and a second
  key meaning "open the thing `Cmd`+`K` opens" is not a shortcut.
- **RGS-codes are changed from `/accounts`.** The dashboard has reported coverage
  as a percentage since M0 with no way to act on the number. The code is a
  validated text field, not a picker: nothing publishes the codes in a scheme
  (#15), and a picker over a list we cannot fetch would be a fiction. An unknown
  or withdrawn code is refused in the mapper's own words; an aggregate code or a
  debit/credit mismatch saves and says so. Refusals in the status red, the rest in
  the attention colour — never the accent.

### Koppelen confirms rather than guesses (alpha 4, product call)

- **`↵` no longer books the top suggestion from the queue.** It opens the panel
  and lands on the candidate that would be booked; the next `↵` books _that_ one.
  One keystroke was faster and the line being agreed to was off to the side of the
  key being pressed — section 7.4's "one-keystroke confirm" is now one keystroke to
  confirm, with the press before it aiming and posting nothing.
- **`1`–`9` and `x` are gone**, from the behaviour, the footers, the corner panel
  and the registry. A digit booked a suggestion the eye had not settled on, and `x`
  skipped a line as cheaply as `Enter` booked one. Skipping is a button, reachable
  with `Tab`, which is what a deliberate "not this one" should cost.
- **`j`/`k`, `↵`, `u` and `Esc`** are the whole keyboard on that screen now, which
  is what the Alpha 4 board draws.

### The keyboard, on the screen (alpha 4, design pass against the Penpot boards)

- **The chrome the boards draw.** A compact strip of keycaps along the bottom of
  each pane — under the list, and again under the panel that acts on a row of it —
  and a panel in the corner with the screen's whole keyboard, on het postvak, de
  koppelwachtrij, de journaalpost and de nieuwe factuur. Panes are numbered
  (`1 · POSTVAK`, `2 · NAKIJKEN`), because the spine is a sequence and a reader
  should see which half the keyboard is in without pressing anything. The printed
  labels are terse now, because a cap with a sentence beside it is a sentence.
- **Two panes, two cursors, on the koppelscherm.** `j`/`k` move bank lines from
  the queue and candidates from inside the panel, scoped by where the focus is
  rather than by a mode. `u` drops the choice the panel is holding — on a queue of
  unbooked lines that is the only thing there is to undo, and undoing a _booked_
  match is a reversal, which stays a button that asks. (What `Enter` does was
  settled a revision later; see above.)
- **The buttons print their keys**, as the boards do: "Concept maken (a)",
  "Terzijde leggen (s)", "Keuze wissen (u)". And the invoice form
  has the Cancel the board shows, which is Escape's visible twin.

### The keyboard, on the screen (alpha 4)

- **Het postvak is worked like the other two lists.** It was a column of cards
  and a `Tab` key, which broke the invoice → koppelen → postvak spine at its last
  screen. `j`/`k` or the arrows move a cursor, `↵` opens a document, `a` makes the
  draft — once to show the coding, again to book it, because what is approved is
  the coding — `s` sets it aside and `Escape` closes the panel and then leaves the
  list. Setting aside asks for its reason in a field rather than a browser
  `prompt()`, which could not be escaped back to the card.
- **The keys are printed on the screens they work on.** Keycaps with a yellow
  outline along the bottom of the entry form, the invoice form and list, the
  koppelscherm and het postvak, and floating above the postvak queue. They are
  declared as binding ids, so a screen cannot print a key it has not registered.
  The sidebar prints its shortcuts instead of revealing them on hover — a
  keyboard user never hovers — and the `?` sheet and the palette use the same
  caps, so `SPACE` and `A-Z` are `Space` and `A–Z` now.
- **One mark for "the keyboard is here": a yellow line.** The row cursor, the
  selected koppel-line and the focused postvak card are outlined in the accent
  rather than filled with it; a selected table row is marked at its edge. A
  column of forty filled rows was a colour swatch, not a ledger.
- **The invoice screens got the rest of their keyboard.** In the form, `Enter` in
  a field no longer saves (that is "Enter on primary save, not mid-field"),
  `Cmd`+`Enter` shows what will be saved and saves on the second press, and
  `Escape` leaves — twice, if there is something to lose. On a draft invoice,
  `Cmd`+`Enter` issues it after showing what that means: a number out of a gapless
  series and an entry in the chain.
- **Square, everywhere on the spine.** The radius utilities are gone from the
  screens and components the keyboard spine runs through. The scale has been zero
  since the palette landed, so they described a curve that does not exist.
- **`u` to unmatch is not bound, and the map says why.** There is no unmatch
  operation in `/api/v1`, and a booked match is undone by a reversal — which
  principle 4 keeps as a button that asks. It is the one place the map and the
  design board disagree on purpose.

### The keyboard, finished (alpha 4)

- **One account picker, on every screen that asks for an account.** Type a number
  or a word: `1300`, `deb` and `debiteuren` all find Debiteuren, and each match
  shows both. It replaces a native `<datalist>` over account numbers on the
  journaalpost screen — perfect for somebody who knows the chart by heart, no use
  to anybody else — and a `<select>` over two hundred accounts everywhere else.
  Arrows move, `Enter` takes the highlighted match, `Tab` takes it and moves on,
  `Escape` leaves the field as it was, and the list opens on focus so a field
  reached by `Tab` can be typed at. A blocked account is listed, marked and not
  selectable, because the ledger refuses to post to one and hiding it turns that
  refusal into "my account is missing"; a number no account answers to is kept as
  typed and flagged under the field, so nothing is silently replaced and nothing
  invalid is silently accepted.
- **Every table has a cursor, type-ahead and a copy.** `↑`/`↓` or `j`/`k` move a
  visible cursor, any other character jumps to the first row that starts with it,
  `Space` selects, `Shift` and an arrow extends, `Cmd/Ctrl`+`A` takes every loaded
  row and `Cmd/Ctrl`+`C` copies the selection as TSV that pastes into a
  spreadsheet with its columns intact. "Get this into Excel" is a daily move and
  the answer used to be a mouse drag. One row is in the tab order at a time, and
  the cursor is remembered as a row rather than a position, so a list that grows
  underneath it does not jump back to the top.
- **The journal-entry keys the registry had been printing now work.**
  `Cmd/Ctrl`+`D` duplicates the line the cursor is in and `Cmd/Ctrl`+`Backspace`
  removes it — but only where the browser would not have done something with the
  key itself, so a half-typed amount is cleared rather than a line thrown away.
  `Cmd/Ctrl`+`Enter` shows the dagboek, the date, the line count and the total
  with the cursor on the button that posts, and posts on the second press: the
  journal is append-only, so the key that writes to it asks. An entry that does
  not balance says so instead, through the same check the button uses.
- **The dagboek comes from the administration**, not from `MEM/VRK/INK/BNK` in a
  constant, which omitted the kasboek and anything anybody had added. And the
  document date is its own field: an invoice received in January and booked in
  February has two dates, and the form was sending one of them twice.
- **A navigation moves the focus onto the screen it opened.** Nothing does that
  by itself in a single-page application: the focus stays on whatever opened the
  screen, or lands on `<body>` when that control went with it, and the next `Tab`
  starts at the top of the window. Closing the posting confirmation puts the
  focus back where it was, and a `Select` no longer opens its menu on
  `Cmd`+`Enter` — which used to leave the focus in a popup the navigation then
  removed.
- **`docs/keyboard-map.md` describes what ships.** It used to say the tables were
  "the design, not the state of the code"; they are the code now, and the keys
  that are deliberately unbound — `/` until there is a search to focus, `←`/`→`
  until a table addresses cells, remapping — say so where the key would be.
  `apps/web/e2e/keyboard.spec.ts` drives an invoice, a bank match and the postvak
  with no `click()` anywhere in the flow, which is the only way that claim stays
  true.

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
  `g v` and `g c` go to the two ageing reports. The rest of the list keyboard in
  `docs/keyboard-map.md` landed in alpha 4, above.

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
