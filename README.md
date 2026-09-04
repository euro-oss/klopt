# Klopt

**Open bookkeeping for the Dutch market.**

_Klopt_ is what a Dutch bookkeeper says when the reconciliation lands: it adds
up. It is also the pass/fail condition for this software.

> **Status: M0 in progress.** The ledger works: immutable journal with a hash
> chain, gapless numbering, n-dimensional analytics, period control, foreign
> currency, reversals, trial balance, and a versioned REST API over all of it.
> Still to come in M0: RGS reference data, year close, and the XAF 3.2 export
> and import. See [Roadmap](#roadmap).

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
cp .env.example .env
docker compose up -d                       # Postgres + MinIO with object lock
pnpm run build
pnpm --filter @klopt/db run migrate
pnpm run dev                               # http://localhost:3000
```

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
