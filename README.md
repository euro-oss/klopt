# Klopt

**Open bookkeeping for the Dutch market.**

_Klopt_ is what a Dutch bookkeeper says when the reconciliation lands: it adds
up. It is also the pass/fail condition for this software.

> **Status: M0 complete.** An accountant can use this as a shadow ledger today.
> Immutable journal with a hash chain, gapless numbering, n-dimensional
> analytics, period control, foreign currency, reversals, the real RGS 3.7
> scheme with coverage reporting, year close, trial balance, balance sheet and
> P&L, and **XAF 3.2 export and import** — validated against the published
> Belastingdienst schema. All of it over a versioned REST API.
>
> There is a UI: sign in, switch between administrations, browse and post
> journal entries, read the statements, watch RGS coverage and the hash chain.
> Roles from section 4 map onto the same permissions API tokens carry, so the
> screens have no privileged path. Next: M1, Sales.

---

## Why

Dutch SMBs run their books on Exact Online, AFAS, Twinfield or Visma: entrenched,
expensive per user, slow to change, unpleasant to use. Nobody switches, because
the lock-in is the accountant's workflow and the compliance plumbing, not the
ledger.

The open-source landscape has a hole in exactly the right shape. Modern tools
(Midday, Bigcapital) have no EU VAT localisation and no Peppol. Real accounting
tools (Dolibarr, LedgerSMB, Odoo Community) are dated or have accounting behind
an Enterprise licence. ERPNext has no BTW-aangifte, no RGS, no auditfile. EekBoek
is abandoned.

Nothing is both modern and Dutch-compliant.

**The thesis:** the ledger is commodity. The moat is the compliance surface and
the accountant's trust. Build the boring compliance edges first and correctly,
then win on the parts the incumbents are worst at — speed, API, and not charging
per seat.

## Principles

These are testable design constraints, not slogans. Most of them are enforced by
something in CI.

1. **The journal is immutable.** Nothing is updated or deleted. Corrections are
   reversals. Every report derives from the journal alone.
2. **Your data leaves whenever you want.** A valid XAF 3.2 export with RGS codes,
   one click, always.
3. **The API is the product.** The UI is a client of it. If the UI can do it, a
   script can do it.
4. **Self-hosted is complete, not crippled.** No feature is withheld. The hosted
   offering sells credentials and operations, never features.
5. **One instance, few dependencies.** One container, Postgres, S3-compatible
   storage.
6. **Compliance is versioned and swappable.** Taxonomies and schematrons are data
   loaded at runtime, never code. All of them change annually.
7. **The accountant is a first-class user**, not a read-only login.
8. **Headless is a first-class mode.** Everything works over REST, MCP and CLI
   with no UI running.

## Quick start

Requires Node 22+ (24 recommended, see `.nvmrc`), pnpm 10, and Docker for the
local stack.

```bash
pnpm install
cp .env.example .env                       # set KLOPT_AUTH_SECRET
docker compose up -d                       # Postgres + MinIO with object lock
pnpm run build
pnpm --filter @klopt/db run migrate
pnpm run dev                               # http://localhost:3000
```

Open it and enter your email address. With no SMTP configured the sign-in code
is written to the container log, so a fresh install works with no mail server —
find the code and type it in.

The first account to sign in has no books yet, so it is offered a way to make
some: a name, and optionally a KvK number and a book year that need not be a
calendar year. That provisions a Dutch MKB chart of accounts — 31 accounts,
five dagboeken and eight BTW-codes, every account already mapped to RGS 3.7 —
and lands you in it as owner. The chart is reference data under
`reference-data/charts/`, so shipping your own is a file, not a fork.

Bring in your bookkeeper or your accountant from **Toegang**: type an address,
pick a role, and they are in as soon as they sign in with it. There is no
invitation link to lose — the code that proves the mailbox is the same code that
signs them in.

### Serving it over https

Only needed to connect **Exact Online**, whose OAuth redirect URI must be
https — plain `http://localhost` is refused at their end. [portless][portless]
fronts the dev server with a locally-trusted certificate on a stable
`.localhost` name:

```bash
npm install -g portless
portless proxy start                       # once; sudo, to bind 443
pnpm run dev:https                         # https://klopt.localhost
```

Then set `KLOPT_BASE_URL=https://klopt.localhost` so the session cookie is
issued `secure` and sign-in links point at the right host, and register
`https://klopt.localhost/exact/callback` as the redirect URI of your Exact app.
`portless service install` starts the proxy at boot so the sudo prompt happens
once.

The name is pinned to `klopt` in the script. A bare `portless` prefixes the git
branch onto the host, which would move the URL every time the branch changed —
and Exact compares its redirect URI literally.

[portless]: https://portless.sh

### Driving it from an agent

Klopt ships an MCP server, so an assistant can read the books without anybody
pasting figures into a chat window. Build it, issue a **read-only** token under
**Toegang**, and point a client at it:

```json
{
  "mcpServers": {
    "klopt": {
      "command": "node",
      "args": ["/path/to/klopt/apps/mcp/dist/main.js"],
      "env": {
        "KLOPT_API_URL": "http://localhost:3000",
        "KLOPT_TOKEN": "klopt_…"
      }
    }
  }
}
```

Six tools, all read-only: `describe_schema`, `get_balance`, `list_open_items`,
`vat_return_preview`, `list_pending_approvals`, `export_xaf`. There is no
generic query tool and nothing that files, sends, posts or pays — writes arrive
later as drafts a human releases.

The server is a client of the same REST API as everything else, so an agent has
exactly the permissions its token has, and its actions land in the same audit
log under a distinct actor kind. See
[ADR 0035](docs/decisions/0035-an-agent-is-a-client-not-a-shortcut.md).

Or skip the browser entirely; the UI is a client of the same API:

Then post something. Issue a token, and:

```bash
curl -X POST localhost:3000/api/v1/journal-entries \
  -H "authorization: Bearer $KLOPT_TOKEN" \
  -H "idempotency-key: $(uuidgen)" \
  -H 'content-type: application/json' \
  -d '{
        "journalCode": "VRK",
        "bookingDate": "2026-03-15",
        "documentDate": "2026-03-15",
        "description": "Factuur 2026-001",
        "lines": [
          { "accountNumber": "1300", "debit":  "121000" },
          { "accountNumber": "8000", "credit": "100000" },
          { "accountNumber": "1500", "credit":  "21000" }
        ]
      }'
```

Amounts are integer minor units **as strings**. A JSON number in the money path
is rejected, because by the time it reached us it would already have been
rounded.

Invoice somebody from **Verkoopfacturen** — record the customer, draft, then
issue, which is the deliberate second click that allocates a gapless number and
posts the entry. Corrections are credit notes; there is no edit and no delete,
for the same reason the journal has neither.

Or take the XML:

```bash
curl -O -J "localhost:3000/api/v1/sales-invoices/$INVOICE_ID/ubl" \
  -H "authorization: Bearer $KLOPT_TOKEN"

xmllint --noout --schema reference-data/ubl/2.1/maindoc/UBL-Invoice-2.1.xsd *.ubl.xml
```

That is UBL 2.1 in the Peppol BIS Billing 3.0 shape with the NLCIUS rules
applied — the legal invoice, of which a PDF would be a rendering. Nothing comes
out of that endpoint that has not passed the **published** BIS and NLCIUS
schematron, run as data by an evaluator in the box: no JVM, no proprietary
runtime, nothing compiled ahead of time
([ADR 0017](docs/decisions/0017-schematron-in-process.md)). An invoice that
breaks a rule comes back as a 422 naming each one by its official identifier
(`NL-R-002`, `BR-S-09`, `BR-CL-14`) rather than as a document your customer's
system rejects next week.

And the rendering, with the XML inside it:

```bash
curl -O -J "localhost:3000/api/v1/sales-invoices/$INVOICE_ID/pdf?embedUbl=true" \
  -H "authorization: Bearer $KLOPT_TOKEN"
```

One file with both invoices in it — the one a person reads and the one their
software parses, built from the same source so they cannot disagree. The bare
PDF is available whatever the schematron thinks, because somebody printing a
copy for a customer who wants paper should not be stopped by a code-list rule;
attach the XML and the rules apply again.

Then send it:

```bash
curl -X POST "localhost:3000/api/v1/sales-invoices/$INVOICE_ID/send" \
  -H "authorization: Bearer $KLOPT_TOKEN" \
  -H "idempotency-key: $(uuidgen)" \
  -H 'content-type: application/json' -d '{}'
```

Email, with the UBL and the PDF attached — spec 7.5's fallback transport, and
the one that needs no third party. With no SMTP configured the message goes to a
directory or the log, and the receipt says so rather than pretending. A Peppol
access point slots in behind the same interface; it needs a service provider
agreement, which is the part you cannot install.

Nothing is sent that has not passed the schematron, and every attempt — sent or
bounced — leaves a row with the hash of the exact document. Overdue invoices
turn up under **Aanmaningen** with the reminder each one is due: one per stage,
ever, and never a courtesy after a final demand
([ADR 0018](docs/decisions/0018-dunning-stage-is-derived.md)).

Read a bank statement in — CAMT.053 or MT940, whichever your bank gives you:

```bash
curl -X POST localhost:3000/api/v1/bank-statements \
  -H "authorization: Bearer $KLOPT_TOKEN" \
  -H 'content-type: application/json' \
  -d "$(jq -n --arg c "$(cat statement.940)" \
        '{bankAccountId: $ENV.ACCOUNT_ID, content: $c, dryRun: true}')"
```

A CSV works the same way, except the first one comes back with a guessed column
mapping to check rather than an error — every bank invents its own columns, so
the layout is configuration, and once corrected the account remembers it.

`dryRun` says what it would do and writes nothing: how many lines are new, how
many are already there, and whether a statement is missing from the sequence. A
file whose entries do not add up to its closing balance is refused outright,
because a truncated statement becomes a wrong balance that everybody trusts.
Then ask what a line might be:

```bash
curl "localhost:3000/api/v1/bank-transactions/$TX_ID/suggestions" \
  -H "authorization: Bearer $KLOPT_TOKEN"
```

Each suggestion comes with a confidence and a reason in Dutch you can check at
a glance — "Factuurnummer 2026-0001 staat in de omschrijving en het bedrag
klopt precies". Nothing is posted until you confirm, and a confirmation with no
invoice behind it teaches a rule for next time
([ADR 0019](docs/decisions/0019-matching-suggests.md)). Confirming posts a
journal entry through the same API a manual entry uses, so period control and
the hash chain apply without banking knowing they exist.

In the browser that queue is keyboard-first: `↑↓` moves, `↵` books the best
suggestion, `1`–`9` pick one, `x` skips. A hundred lines should be a hundred
keystrokes.

Pay your suppliers, if somebody else agrees:

```bash
curl -X POST "localhost:3000/api/v1/payment-batches/$BATCH/transitions" \
  -H "authorization: Bearer $ALICE" -H "idempotency-key: $(uuidgen)" \
  -H 'content-type: application/json' -d '{"action":"submit"}'

# The same person approving their own batch is refused, and so is a script.
curl -O -J "localhost:3000/api/v1/payment-batches/$BATCH/pain001" \
  -H "authorization: Bearer $BOB"
```

A SEPA `pain.001` needs two people and neither of them can be a machine
([ADR 0020](docs/decisions/0020-payments-need-two-people.md)). The IBANs are
check-digit validated before anybody is asked to approve, because a bank
rejects the whole batch for one bad account.

Then leave with your data:

```bash
curl -O -J "localhost:3000/api/v1/exports/audit-file?fiscalYear=2026" \
  -H "authorization: Bearer $KLOPT_TOKEN"

xmllint --noout --schema reference-data/xaf/XmlAuditfileFinancieel3.2.xsd xaf-*.xml
```

That is a complete XAF 3.2 auditfile with RGS lead codes, validated against the
published schema. Principle 2, in one request.

Check everything the way CI does:

```bash
pnpm run verify               # format, build, lint, typecheck, test, boundaries
```

## Layout

```
packages/core        framework-free accounting domain
packages/db          Drizzle schema, migrations, repositories
packages/adapters    filing, bank feed, e-invoice, payments
apps/web             TanStack Start: UI + versioned REST API
apps/worker          scheduled and queued work
tools/               project-specific lint rules
```

`@klopt/core` imports no web framework, no database and no adapter — enforced by
the linter, not by good intentions. It is the part that survives if the
framework choice turns out wrong. See [`docs/architecture.md`](docs/architecture.md).

## On the stack

TypeScript, PostgreSQL, TanStack Start, shadcn/ui, Drizzle. Postgres is also the
queue, the search index and the cache, because every extra service is a
self-hosting tax.

**TanStack Start** was chosen before it was stable, on the reasoning that Vite
and plain Node underneath is worth more to self-hostable software than framework
popularity. It has since shipped stable. The residual cost is that the pool of
contributors who have shipped production TanStack Start is smaller than the
Next.js one — which is a real cost for an open-source project, and is bounded by
the `packages/core` boundary above.

Version policy, and why TypeScript is pinned to 5.9 rather than the 7.x that
`npm` calls `latest`: [`docs/decisions`](docs/decisions/).

## Roadmap

| Milestone | Content                                                                                                                                                               | Proves                                      |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **M0**    | Entities, chart of accounts, RGS mapping, manual journal entries, immutable journal with hash chain, trial balance, balance sheet, P&L, **XAF 3.2 export and import** | An accountant can use it as a shadow ledger |
| **M1**    | Sales: invoices, credit notes, UBL with NLCIUS validation, PDF, dunning                                                                                               | You can invoice for real                    |
| **M2**    | Banking: CAMT.053 / MT940 import, matching engine, learned rules, pain.001. MCP server, read-only                                                                     | The daily grind is handled                  |
| **M3**    | VAT: tax code engine, BTW-aangifte with reconciliation, ICP with VIES, XBRL, manual filing, then Digipoort                                                            | It is a legal bookkeeping system            |
| **M4**    | Purchase: supplier invoice inbox, approval flow, inbound Peppol. MCP write tools, behind the proposal model                                                           | The full cycle closes                       |
| **M5**    | Retention and WORM, sealed snapshots, audit log export, Exact importer, multi-entity, permissions                                                                     | Adoptable by someone who is not us          |
| **M6**    | API stability commitment, webhooks, module contract, first external module                                                                                            | An ecosystem is possible                    |

M0 through M3 is the credible minimum. Anything less is another invoicing tool.

The REST API is not a milestone: it exists from M0 by construction, enforced by
the contract test.

## What M0 gives you

|                |                                                                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Ledger**     | Immutable journal, hash chain per entity, gapless numbering, n-dimensional analytics, period control, multi-currency, reversals           |
| **RGS 3.7**    | The real published scheme — 3691 MKB codes — as versioned reference data, with coverage reporting, mapping validation and an upgrade diff |
| **Reports**    | Trial balance, balance sheet, profit and loss, all derived from the same figures and asserted to agree                                    |
| **Year close** | Result appropriation and opening balance, as two ordinary reversible entries                                                              |
| **XAF 3.2**    | Export with RGS lead codes, validated against the published XSD; import with a reconciliation dry run                                     |
| **API**        | 15 operations under `/api/v1`, scoped bearer tokens, idempotency keys, cursor pagination, problem+json errors                             |

Round-tripping is tested, not claimed: an export from one administration
imports into another and produces an identical balance sheet.

Keyboard-first is a contract, not a nice-to-have — see
[`docs/keyboard-map.md`](docs/keyboard-map.md), written before the screens were.

## Compliance surface

| Requirement                        | Gatekeeper                            | How Klopt handles it                               |
| ---------------------------------- | ------------------------------------- | -------------------------------------------------- |
| RGS mapping                        | none                                  | Core feature                                       |
| XAF 3.2 auditfile                  | none                                  | Core feature, built first                          |
| 7-year retention and audit trail   | none                                  | Core feature                                       |
| BTW-aangifte and ICP via Digipoort | PKIoverheid certificate               | Adapter — **manual filing is the default**         |
| PSD2 bank feeds                    | AISP licence                          | Adapter — **CAMT.053 / MT940 import always works** |
| Peppol access point                | NPa agreement + OpenPeppol membership | Adapter — **email UBL fallback**                   |

Every adapter has an implementation that needs no third party, and that
implementation is the default in a fresh install. A self-hosted instance is
complete and legal on its own. See
[`docs/decisions/0008`](docs/decisions/0008-adapter-ports-deferred.md).

## Licence and governance

[Apache-2.0](LICENSE). Anyone may fork this, sell it, or run a competing hosted
service. That was decided deliberately and is not up for discussion — see
[GOVERNANCE.md](GOVERNANCE.md) for why, and why there will never be an
enterprise edition.

Contributions take a [DCO sign-off](CONTRIBUTING.md), not a CLA.

The code is free; the name is not. See [TRADEMARK.md](TRADEMARK.md) — including
the part where trademark clearance has not yet been run.

Security policy and coordinated disclosure: [SECURITY.md](SECURITY.md).
