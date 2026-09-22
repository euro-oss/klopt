# Klopt alpha codebase assessment

Status: assessment only. No product work in this change.
Date: 2026-09-18
Scope: `euro-oss/klopt` at `main` (`a77f8c2`, 0.1.0).
Audience: product and engineering leads planning a functional, pleasing alpha.

## How to read this

Klopt is **not a greenfield prototype**. 0.1.0 already implements the M0–M6
domain: an immutable Dutch ledger, sales, banking, VAT, purchase, hardening and
a public API. A credible alpha is **not** “build bookkeeping.” It is:

1. Make the existing engine usable as a daily bookkeeper tool.
2. Close the UI holes where the API already works.
3. Stop planning from stale docs (several still describe M2).

The engine is ahead of the product. That is the central finding.

Sizing used below: **S** = one focused PR; **M** = a handful of PRs / one
subsystem; **L** = a workstream spanning several screens or a third-party
dependency.

---

## 1. Stack and architecture

### Languages and frameworks

| Layer           | Choice                                                          | Pin / notes                                                      |
| --------------- | --------------------------------------------------------------- | ---------------------------------------------------------------- |
| Language        | TypeScript 5.9.3                                                | Deliberately not TS 7 (`docs/decisions/0002`)                    |
| Runtime         | Node ≥22, `.nvmrc` = 24                                         | CI matrix: Node 24 and 26                                        |
| Package manager | pnpm 10.15                                                      | Workspace, frozen lockfile, `onlyBuiltDependencies: esbuild`     |
| Web             | TanStack Start 1.168 + Router 1.170 + React 19                  | Vite 8, Nitro 3 beta, Tailwind 4, shadcn/Radix                   |
| Domain          | `@klopt/core`                                                   | Framework-free. ESLint + dependency-cruiser enforce the boundary |
| Persistence     | PostgreSQL 17 + Drizzle 0.45                                    | Schema `klopt`; queue schema `klopt_jobs`                        |
| Auth            | better-auth 1.7 + email OTP                                     | No passwords. OIDC is a comment, not a plugin                    |
| Queue           | pg-boss 12                                                      | Worker is required, not optional                                 |
| Money           | `bigint` minor units in process, decimal **string** on the wire | `klopt/no-number-money` lint                                     |
| Tests           | Vitest 5 + Playwright 1.62                                      | Playwright is **not** in CI                                      |
| MCP             | `@modelcontextprotocol/sdk` 1.30                                | Client of REST, not a privileged path                            |

Postgres is also the queue, the search index and the cache. Local extras:
MinIO (S3 + object lock) via `docker-compose.yml`. Production shape: one
container, Postgres, optional S3.

### Apps and packages

```
packages/core        Domain: ledger, VAT, UBL, XAF, bank matching, payments, …
packages/db          Drizzle schema, 31 SQL migrations, repositories
packages/adapters    Filing, email, PDF, S3, IMAP, Exact, VIES, schematron
apps/web             UI + `/api/v1` + hosted MCP + OAuth
apps/worker          inbound.poll, snapshot.sealPendingYears, oauth.purge,
                     exact.importDocuments, webhooks.deliver
apps/mcp             stdio MCP server (same 12 tools as `/api/mcp`)
apps/cli             Operator surface over the public API
tools/               eslint-plugin-klopt, rgs-import, container helpers
examples/notifier    Worked external module (must not import Klopt packages)
reference-data/      RGS 3.7, XAF XSD, UBL 2.1, Peppol/NLCIUS schematron, NT, chart
```

`apps/web` is two surfaces over one core: TanStack server functions for the UI,
and 119 route bindings under `/api/v1`. A contract test fails the build if a
domain operation has no REST route.

### How to run locally

Requires Node 22+ (24 recommended), pnpm 10, Docker.

```bash
pnpm install
cp .env.example .env                       # set KLOPT_AUTH_SECRET
docker compose up -d                       # Postgres + MinIO
pnpm run build
pnpm --filter @klopt/db run migrate
pnpm run dev                               # http://localhost:3000  (web + worker)
```

`pnpm run verify` is what CI runs: format, build, lint, typecheck, Vitest,
dependency-cruiser. Playwright is `pnpm --filter @klopt/web run test:e2e` and
needs a live Postgres.

First sign-in: enter an email. With no SMTP the OTP is written to the log /
outbox. First user is offered `/setup` (name, optional KvK, book year) which
provisions the shipped NL MKB chart (31 accounts, five dagboeken, eight
BTW-codes, RGS-mapped).

Exact Online OAuth needs HTTPS; `pnpm run dev:https` via portless
(`https://klopt.localhost`).

Container: `docker build -t klopt .` then `docker run --rm klopt migrate` then
`docker run -p 3000:3000 klopt`. Headless target exists (`KLOPT_HEADLESS=1`);
see known limitation in §3.

---

## 2. What already works end-to-end

Verified in routes, handlers, repositories and tests — not only claimed in
README. A bookkeeper can keep a Dutch administration through these paths today.

### Identity and tenancy

- Email OTP sign-in (better-auth). No password store.
- First-account provisioning of an administration (`/setup`).
- Multi-entity, one login; switcher in the sidebar (ADR 0034).
- Roles: owner / bookkeeper / accountant / auditor. Nav hides 403 destinations.
- Invite-by-address (no invitation link). Tokens and OAuth clients on **Toegang**.
- Session cookie and scoped bearer token resolve to the same `RequestContext`.

### Ledger (M0)

- Append-only journal, hash-chained, gapless numbering. DB triggers refuse
  `UPDATE`/`DELETE` (`0001_ledger_guards.sql`).
- Manual entry screen (`/entries/new`): client-side lines, `=` to balance,
  `⌘/Ctrl+Enter` to post, idempotency key per attempt.
- Trial balance, balance sheet, P&L — same `BalanceRow` arranged three ways.
- Chain verification and RGS coverage on the dashboard.
- XAF 3.2 **export** from the dashboard (session cookie hits `/api/v1/exports/audit-file`).
- Year close, XAF import, fiscal-year create: **API + tests, no UI** (see §3).

### Sales (M1)

- Contacts: create, edit, block, GDPR-style pseudonymise.
- Draft → issue (allocates number + posts in one transaction) → UBL 2.1 /
  NLCIUS (in-process schematron) → PDF → email send with evidence hash.
- Credit notes as the only correction.
- Dunning queue (`/dunning`); stages derived, one reminder per stage (ADR 0018).
  Send is still a human click.

### Banking and payments (M2)

- Bank accounts; CAMT.053 / MT940 / CSV import with `dryRun`, sequence and
  balance checks. CSV mapping is remembered per account.
- Matching queue (`/bank/match`): suggestions with Dutch reasons; `↑↓/jk`,
  `Enter`, `1`–`9`, `x` skip. Confirm posts through the same journal API.
- Learned rules from confirmations that are not invoice-number matches.
- Payment batches: create, add approved invoices or a manual instruction,
  two-person submit/approve (a script cannot approve), SEPA `pain.001` download.

### VAT (M3)

- Tax-code engine; journal line carries `taxRole` (base vs tax).
- BTW-aangifte derived from the journal, with control-account reconciliation.
- ICP + VIES (outage ≠ proof).
- XBRL instance + human summary. **Manual filing is the default and works.**
- Filing soft-closes the period; a correction is a suppletie.

### Purchase (M4)

- One inbox: upload, maildir/IMAP poll (worker every 5 minutes), inbound UBL
  parsed to a draft with the original attached.
- Supplier totals are authoritative; checks report disagreement (ADR 0025).
- Book → approve (person only) → payment batch.
- Creditor ageing **screen exists** at `/reports/creditor-ageing` (linked from
  purchases, **not in the sidebar**).

### Hardening and platform (M5–M6)

- Retention / WORM (filesystem default; S3 object lock when configured).
- Sealed snapshots; optional RFC 3161 timestamp (off by default).
- Audit log + CSV export.
- Exact Online importer (OAuth + division pick + dry-run + document archive job).
- Webhooks: 11 versioned event types, signed, retried, replayable.
- Generated OpenAPI 3.1 (`GET /api/v1/openapi.json` and `docs/openapi.json`).
- Module contract with ownership test; `examples/notifier` is the worked module.
- MCP: 12 tools (9 read, 3 draft-only writes).
- CLI: `login`, `check`, `export`, `bank-import`, `webhooks-replay`, `events`.
- Headless mode: non-`/api` paths 404.

### Tests (what “works” is backed by)

- Changelog claim: 1 820 unit tests, 82 browser tests. This tree has ~123
  `*.test.ts` / `*.spec.ts` files and **18 Playwright specs** covering auth,
  setup, keyboard, sales, bank, matching, payments, purchase, VAT, members,
  settings, language, Exact, audit, snapshots, retention, webhooks, OAuth.
- Contract, OpenAPI freshness, response-schema, isolation, and artefact
  golden-file jobs are real gates.

A determined user can: sign in → create books → invoice → import a statement →
match → pay a supplier (two people) → file BTW by hand → export XAF. That is
already a workable self-hosted bookkeeping loop.

---

## 3. Stubbed, broken, or missing for a credible alpha

Split by “blocks a bookkeeper this week” vs “blocked on a third party” vs
“docs/CI lie.”

### 3.1 Core bookkeeping — API done, product hole

These operations exist, are tested, and have **no first-class screen** (or the
screen is unreachable):

| Capability            | API                        | UI                                                             | Why it matters for alpha                                  |
| --------------------- | -------------------------- | -------------------------------------------------------------- | --------------------------------------------------------- |
| Close a book year     | `POST /fiscal-years/close` | None                                                           | Year-end is a first-class accountant act                  |
| Open next fiscal year | `POST /fiscal-years`       | None                                                           | Broken year / next year cannot be opened in-product       |
| Import XAF            | `POST /imports/audit-file` | None                                                           | Principle 2 is export-only in the product                 |
| Global search         | `GET /search`              | None. `/` deliberately unbound                                 | Keyboard-first claim is incomplete                        |
| Explain a figure      | `GET /explain`             | None (MCP has it)                                              | “Why is this number?” is daily work                       |
| Chart of accounts     | list + RGS coverage        | Read-only table                                                | Cannot add an account or map RGS in the UI                |
| Dimensions            | posting + XAF import       | None                                                           | Cost centre / project analytics is schema-only            |
| Creditor ageing       | yes                        | Screen exists, **not in nav**                                  | Hidden                                                    |
| Debtor ageing         | overdue + dunning          | No dedicated report                                            | Debtors live only in Aanmaningen                          |
| Report year/period    | API takes `fiscalYear`     | Hardcoded `new Date().getFullYear()` on dashboard, TB, BS, P&L | **Broken for a non-calendar boekjaar** — setup allows one |

Journal entry form gaps vs the keyboard map and the posting model:

- Journals hardcoded `MEM/VRK/INK/BNK`, not `listJournals`.
- No tax code / `taxRole` on a manual line (VAT engine expects them).
- No dimension pickers.
- No separate document date.
- `⌘D` / `⌘Backspace` registered but **not wired** on the form.
- Account “picker” is a native `<datalist>` (number only), not the designed
  type-ahead (number **and** name).

`LedgerTable`: rows are focusable and Enter opens. No arrow cursor, no
type-ahead, no `⌘A` / `⌘C` TSV. Keyboard map says those are the design.

### 3.2 UX polish — functional but not pleasing

- **Dashboard is a health panel** (trial balance, chain, RGS %). It is not a
  work queue. Inbox, unmatched bank, overdue VAT, pending approvals and
  overdue invoices are other screens. A bookkeeper opening the app does not
  see “what to do today.”
- **20+ nav destinations**, grouped, with hover-only shortcut hints. Fine for
  power users; dense for a first hour. Command palette (`⌘K`) and `g`/`n`
  prefixes **are** wired (contrary to `docs/architecture.md`).
- Dark-mode **tokens** exist in `app.css`; nothing toggles `.dark`.
- No mobile layout. Sidebar is a sticky `w-60` column. Playwright is Chromium
  desktop only.
- Empty states are a dashed paragraph. No illustrations, no next-step CTAs
  except setup and a few “new …” buttons.
- Profile name is never collected at sign-in (email-only), so the avatar is
  often the first letter of the address.
- Settings exist for billing identity (needed for UBL) but are easy to miss
  until issue/send fails with a BT-numbered 422.

### 3.3 Auth

**Works for a single operator / small firm:** email OTP, invitations, tokens,
OAuth-as-token-mint (ADR 0036), revoke, rate limit, auth audit events.

**Missing for a firm that is not us:**

- OIDC / “own IdP” is documented in comments and `AuthConfig.oidc` exists;
  the branch only sets `socialProviders: {}`. No env, no callback, no test.
- SMTP is log-fallback. Fine for demo; a real alpha needs a settings path
  that says “codes are going to the log” vs “SMTP is up.”
- Security contact in `MAINTAINERS.md` is still “address to be set before
  the repository is made public.”

### 3.4 Data model

The model is the strength of the repo. 31 forward-only SQL migrations
(`0000`–`0030`; Drizzle’s `_journal.json` only lists through `0010` — the
custom runner applies **filename order**, so this is hygiene, not a runtime
bug). Modules: kernel, sales, banking, payments, vat, purchase, inbox,
compliance, exact (nine, as claimed).

Not exposed as product:

- `dimension_types` / `dimension_values` / `account_dimension_requirements`
- Account create / block / RGS remap (API for mappings exists:
  `rgs.setMappings`)
- Multi-currency is in the ledger (ADR 0009); the shipped chart and UI are EUR

Stale comment in `accounts.defaultTaxCode`: “Plain text until the tax code
engine lands in M3” — the engine has landed.

### 3.5 API / MCP

API is the most finished surface. Treat it as alpha-ready for integrators.

MCP is **12 tools** (9 read, 3 draft-only writes):

Read: `describe_schema`, `search`, `get_balance`, `explain_number`,
`list_open_items`, `vat_return_preview`, `list_pending_approvals`,
`export_xaf`, `check_journal_entry`.

Write (draft only): `draft_sales_invoice`, `capture_purchase_invoice`,
`draft_from_inbox_item`.

No `query`, no post/issue/file/pay. That is the design. Do not “complete” MCP
by adding release tools.

### 3.6 Tests

Unit/integration coverage of the domain is a genuine asset. Gaps:

- **Playwright is not in CI.** Hydration and “the screen did not change” bugs
  are exactly what those 18 specs exist for. They can go red on nobody’s
  machine.
- e2e is Chromium-only, Dutch-locale, single worker.
- UBL golden test notes the XSD half is present; schematron-on-goldens is
  “not yet” in that file (runtime send path _does_ run schematron).
- Exact cumulative reconciliation cannot be tested without a live
  administration that returns `GLAccountCode` rows (changelog).

### 3.7 Docs drift (will mis-plan the backlog if believed)

| Document                                 | What it still says                                                             | What the code does                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `docs/architecture.md` § “Not built yet” | VAT/purchase not built; worker empty; contacts not editable; palette not wired | M3–M6 present; worker has 5 jobs; contact edit exists; palette + `g` prefixes work |
| `docs/decisions/README.md`               | Index stops at ADR 0017                                                        | 58 decision files exist (0001–0058)                                                |
| ADR 0025 consequences                    | Inbox not here; payment batch does not draw from approved invoices             | Inbox and `addApprovedInvoices` are in the product                                 |
| `docs/keyboard-map.md`                   | Honest: tables are the design, registry is the truth                           | Still the best UX spec; implement against it                                       |

`CHANGELOG.md` and `docs/api-stability.md` are the accurate 0.1.0 picture.
Prefer them over `architecture.md` until that file is rewritten.

### 3.8 Documented third-party stubs (do not put on the alpha critical path)

These fail closed. Manual / file paths are the product.

1. **Digipoort.** Envelopes and mTLS exist; WS-Security signer is a seam.
   `available()` is false until a signer + PKIoverheid cert + Logius
   pre-prod run exist. Manual filing is the default (ADR 0024).
2. **NT taxonomy `verified: false`.** Amounts are generated; element names
   have not been checked against the published Nederlandse Taxonomie.
   Electronic filing is refused while this is true.
3. **Peppol access point.** Port exists; email UBL is the default. Needs an
   NPa / OpenPeppol agreement.
4. **PSD2 bank feeds.** File import (CAMT/MT940/CSV) is the default. AISP
   licence required for a live feed.
5. **Exact cumulative reconciliation.** Importer works; one recon check
   cannot be proven here.
6. **Headless image.** ~1.2 MB smaller, not more. TanStack Start ignores
   `routeFileIgnorePattern` (ADR 0042). Not an alpha user problem.

---

## 4. Repo hygiene

| Item                                      | State                                                                                                                                                             |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LICENSE`                                 | Apache-2.0, complete                                                                                                                                              |
| `NOTICE`, `TRADEMARK.md`, `GOVERNANCE.md` | Present. Trademark clearance **not run**                                                                                                                          |
| `README.md`                               | Excellent operator onboarding; MCP count stale                                                                                                                    |
| `CONTRIBUTING.md`                         | DCO, `pnpm verify`, area conventions                                                                                                                              |
| `CHANGELOG.md`                            | Honest 0.1.0, including four unfinished items                                                                                                                     |
| `SECURITY.md`                             | Coordinated disclosure process. Contact unset                                                                                                                     |
| `MAINTAINERS.md`                          | **Every area unassigned**, including compliance calendar                                                                                                          |
| `docs/compliance-calendar.md`             | Treadmill listed; **dates and owners blank**                                                                                                                      |
| CI                                        | `.github/workflows/ci.yml`: format, build, lint, typecheck, migrate, Vitest, depcruise; separate XAF golden job. **No Playwright. No UBL schematron-on-goldens.** |
| PR template                               | Yes (DCO, money lint, manifest, golden diffs)                                                                                                                     |
| Issue templates                           | **None**                                                                                                                                                          |
| Code of conduct                           | None                                                                                                                                                              |
| Branch protection / CODEOWNERS            | Not in tree                                                                                                                                                       |

For an open-source alpha, the hygiene gap that will hurt is not LICENSE — it
is **unowned compliance calendar + no issue templates + e2e not in CI**.

---

## 5. Top risks and unknowns

1. **Planning from stale architecture docs.** Highest process risk. The
   backlog will reinvent M3–M4 if someone reads `architecture.md` first.
2. **Reports pinned to the calendar year.** Functional bug for any
   administration whose boekjaar is not 1 Jan–31 Dec. Setup already allows
   that. Alpha users will hit it.
3. **UI lag as “it doesn’t work.”** Year close, XAF import, add-account, and
   search exist as APIs. Testers who only click will file them as missing
   product.
4. **NT mapping unverified.** Shipping “file to the Belastingdienst” as a
   button is unsafe until `verified: true`. Manual path is fine for alpha.
5. **Playwright not in CI.** The class of bug this repo has already hit
   (hydration eating input, shortcuts printed but dead) can regress silently.
6. **TanStack Start contributor pool + Nitro 3 beta.** Domain is insulated;
   `apps/web` is not. Residual hiring / drive-by-PR risk, bounded by
   `packages/core`.
7. **OIDC advertised in comments, not implemented.** A self-hosting firm
   that expected “own IdP” will bounce.
8. **Exact importer vs a real dirty admin.** Cumulative recon untested;
   treat first live import as a spike, not a demo.
9. **Trademark not cleared.** Fine for private alpha; a public launch risk.
10. **Compliance owner vacant.** Annual NT / Peppol / RGS updates have no
    named human. This is the failure mode `GOVERNANCE.md` itself names.
11. **Money lint is a tripwire, not a proof.** Still the right rule; reviews
    must watch bypasses.
12. **No interactive verification in this assessment.** Screens were read,
    not clicked. e2e specs are the substitute; they do not cover year close,
    XAF import, search, or report year pickers because those UIs do not exist.

---

## 6. Recommended workstreams for alpha (ordered)

Goal of this sequence: a bookkeeper can run a month of books **in the
browser**, without curl, and the app feels fast and honest. Do **not**
schedule Digipoort, Peppol AP, or PSD2 as alpha gates.

### WS1 — Stop the docs from lying; put e2e in CI — **S**

- Rewrite `docs/architecture.md` “Not built yet” to match 0.1.0.
- Align MCP tool count to 9 read / 3 draft-only writes (README already correct).
- Extend `docs/decisions/README.md` through ADR 0058 (or generate it).
- Add GitHub issue templates: bug, alpha-gap, compliance-artefact.
- Run Playwright on CI (Postgres service already there; add a job or a
  second step). Accept ~10 extra minutes; this repo’s history justifies it.
- Assign a compliance owner in `MAINTAINERS.md` even if that is one person.

Outcome: the next planning session uses the same map as the code.

### WS2 — Daily work queue and honest reports — **M** (alpha-critical)

The product already has the data (`list_pending_approvals`, inbox, bank
unmatched, VAT periods, dunning). Wire it.

- Dashboard: counts + links for inbox, unmatched bank, overdue invoices,
  VAT deadlines, payment batches waiting on _you_. Keep the three health
  stats; they are not enough alone.
- Year / period picker on dashboard, trial balance, balance sheet, P&L
  (read `listFiscalYears`; stop using `new Date().getFullYear()`).
- Put creditor ageing in the Reports nav. Add a debtors ageing (or promote
  dunning + open items so the name matches what accountants look for).
- Empty-state CTAs that start the next real action (“Import a statement”,
  “Draft an invoice”) rather than a dashed box.

Outcome: opening the app answers “what do I do today?” and reports the year
the books are actually in.

### WS3 — Close the accountant UI holes (API already exists) — **M**

- Year close screen: dry-run preview, then confirm (no keyboard shortcut;
  keyboard map forbids it).
- Create next fiscal year from Settings or a Years screen.
- XAF import: upload + dry-run reconciliation + commit (mirror the bank
  import pattern).
- Chart: add account, block, set RGS mapping (coverage problems are already
  on the accounts page).
- Global search: `/` focuses a palette that hits `GET /search` (contacts,
  invoices, entries, documents). Command palette today only searches
  **screens**.
- Optional but high leverage: “explain this figure” from a report cell
  (`GET /explain`). MCP already has the tool.

Dimensions can wait unless an alpha firm needs cost centres. Schema is ready.

Outcome: the API/UI contract is true for year-end and “find this.”

### WS4 — Keyboard-first completion on the screens that earn it — **M**

Implement `docs/keyboard-map.md` against the **registry**, not the design
tables that are still aspirational.

- Account picker: filter by number **and** name (`1300`, `deb`, `debiteuren`).
  Replace `<datalist>` on journal + invoice + purchase lines.
- Journal form: load journals from the API; wire `⌘D` / `⌘Backspace`;
  optional tax code + `taxRole` for VAT-sensitive memoriaal postings.
- `LedgerTable`: one row cursor, arrows, Enter, type-ahead on the sort
  column. Matching queue is the quality bar; lists should feel like it.
- Discoverability: shortcut hints visible without hover, or a persistent
  `?` affordance.

Do not add shortcuts for post-without-confirm, reverse, or year close.

Outcome: a hundred journal lines / matches feel like Exact’s best day, not
a CRUD app.

### WS5 — Visual and interaction polish — **M**

Not a redesign. The type (IBM Plex / Manrope), money formatting, and Dutch
source strings are already opinionated.

- Light/dark toggle (tokens exist).
- Collapse or overflow the sidebar on narrow viewports; do not pretend
  mobile is a target until the column layout breaks less badly.
- Invoice/purchase line entry: same picker and amount rules as the journal.
- Setup: optional display name so the profile block is not an email initial.
- Settings: surface “your UBL identity is incomplete” before the first
  send, not as a 422.
- Pass the existing e2e suite after each visual change.

Outcome: the app looks finished rather than “correct forms in a shell.”

### WS6 — Auth that a second firm can live with — **M**

- SMTP status on Settings / sign-in (“codes are in the server log” vs
  configured).
- OIDC: either implement the better-auth generic plugin end-to-end or
  remove the promise from comments until a named firm needs it.
- Fill `SECURITY.md` / `MAINTAINERS.md` contact before any public repo
  announcement.

Passwordless OTP is the right default. Do not add passwords for alpha.

### WS7 — Compliance credibility (parallel, not a UI gate) — **M** (review) / **L** (Digipoort)

- Verify NT mapping against the published taxonomy; flip `verified` only
  after a named review. Unblocks electronic filing later; does not change
  the manual path.
- Fill `docs/compliance-calendar.md` dates for the current NT / Peppol / RGS
  cycle.
- Digipoort signer + Logius pre-prod: **L**, blocked on a certificate.
  Keep it off the alpha launch checklist.
- Peppol AP and PSD2: same. Email and file import are the alpha story.

### WS8 — Explicitly out of alpha

- Headless image slimming (ADR 0042).
- Factur-X / PDF/A-3.
- Generic MCP `query`.
- Enterprise / feature-gating (forbidden by governance).
- Trademark clearance can run in parallel; it is legal, not product.

---

## Suggested alpha definition of done

A person who is not the author can, **only using the UI**:

1. Sign in, create a (possibly broken) book year, invite a second human.
2. See today’s work on the dashboard.
3. Draft and issue a sales invoice, download UBL + PDF, send (or see the
   outbox receipt).
4. Capture a purchase (upload or inbox), book, approve.
5. Import CAMT/MT940/CSV, match a hundred lines from the keyboard, export
   a two-person `pain.001`.
6. Open the BTW-aangifte for the correct period, reconcile, file by hand,
   download XBRL.
7. Switch report year, close the year with a preview, export **and import**
   XAF.
8. Search for a contact or invoice from `/` or `⌘K`.
9. Add a grootboekrekening and map it to RGS when coverage is not 100%.

Items 1 and 3–6 already work. Items 2, 7–9 are the alpha delta.

API / MCP / CLI can stay as they are. Do not grow the operation list until
the screens catch up.

---

## Appendix — inventory for backlog tickets

### UI routes that exist (`apps/web/src/routes/_app`)

Dashboard; entries list/new/detail; accounts; invoices list/new/detail;
contacts list/detail; dunning; inbox; purchases list/new/detail; bank +
match; payments list/detail; VAT index/period/ICP; trial balance; balance
sheet; P&L; creditor ageing; members (incl. tokens); settings; webhooks;
audit log; retention; snapshots; Exact + callback.

### API-only (no dedicated screen)

Year close; fiscal year create; XAF import; search; explain; RGS mapping
write; RGS upgrade preview; events list; health; OpenAPI; several Exact
and snapshot sub-resources (partial UI).

### Worker jobs

`webhooks.deliver` (every minute), `inbound.poll` (_/5),
`snapshot.sealPendingYears` (04:00), `oauth.purgeExpiredCodes` (05:00),
`exact.importDocuments` (_/2). Comment in `jobs.ts` still mentions VAT
period close / bank sync / subledger recon as future — those are not
registered.

### Roles vs screens

Owner-only: members, webhooks. Owner/accountant/auditor: audit, retention.
Snapshots: those plus bookkeeper. Exact + settings: owner/accountant/bookkeeper.
Auditor does not get Exact or settings in the nav.

---

## Sources

Primary: `README.md`, `CHANGELOG.md`, `docs/api-stability.md`,
`docs/keyboard-map.md`, `docs/architecture.md` (partially stale),
`package.json` workspace, `apps/*`, `packages/{core,db,adapters}`,
`.github/workflows/ci.yml`, `packages/db/migrations/*.sql`,
`apps/web/src/api/manifest.ts`, `apps/mcp/src/server.ts`,
`apps/worker/src/jobs.ts`.

Not used: live browser, GitHub issues (API not readable from this
environment).
