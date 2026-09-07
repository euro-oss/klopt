# 0021. A journal line says whether it is the base or the tax

Status: Accepted
Date: 2026-09-07

## Context

Spec 7.2: "Generate the return from the journal, never from a parallel tally. A
VAT reconciliation report must show, for each rubriek, the exact journal lines
that produced it, and must reconcile the VAT control accounts to the declared
amounts. Any difference is blocking."

That sentence is the whole design, and it has a prerequisite nobody notices
until they try: **rubriek 1a wants the omzet as well as the BTW.** Every box in
sections 1 to 4 of the aangifte reports a taxable base, and several report only
a base — 3b, which the ICP opgaaf is cross-checked against, has no VAT amount
at all.

Before this change a journal line carried `tax_code` only where the tax itself
was posted. The revenue line carried nothing. So the base was not recoverable
from the journal, and the only ways to get it were:

1. **Infer it.** "The credit lines of an entry that has a tax line." This breaks
   on the first invoice putting 21% and 9% turnover on one revenue account,
   which is an ordinary invoice.
2. **Read it from `sales_invoice_lines`.** This is the parallel tally the spec
   forbids, dressed up. It also cannot see a purchase, a memoriaal correction,
   or an imported auditfile — and those are exactly the entries a return goes
   wrong on.

## Decision

**A tax-coded journal line carries a `tax_role` of `base` or `tax`, and both
kinds carry the tax code.** The return is then a group-by:

- a rubriek's base is the sum of `base` lines with a code pointing at it,
- its VAT is the sum of `tax` lines with a code pointing at it,

and each total keeps the lines it came from, which is the reconciliation report
the spec asks for, not a summary of it.

Three consequences, each deliberate.

**Sales postings collapse revenue per account _and_ tax code.** An invoice with
ten lines on one account is still one journal line — what a bookkeeper expects
to see — but two lines at different rates on the same account stay two, because
collapsing them makes 21% and 9% turnover indistinguishable and nothing
downstream can recover the split.

**A half-tagged line is refused,** by a check constraint in the database and a
`.refine` on the API schema. A code without a role, or a role without a code,
would be silently dropped from the return: the money would be in the books and
not in the aangifte, and the difference would surface a quarter later as a
reconciliation finding rather than now as a 422.

**The sign flip follows the line's role, not the code's direction.** Every box
should read positive in an ordinary quarter, and which side a line sits on is
not a property of the tax code: a base is revenue on a sale (credit) and a cost
on a purchase (debit), while VAT is a credit when owed and a debit when
deductible. An intra-community acquisition has both within one code — base
debited into 4b, VAT credited into 4b — so a single flip per code reports the
base as negative. The rule is: base follows `direction`, tax follows the
rubriek's `role`.

## The hash chain becomes v2

`tax_role` is a material fact: flipping a line from `base` to `tax` changes what
the return declares. If it were not hashed, somebody editing the database
directly could change an aangifte while the chain still verified — a hole in
exactly the guarantee the chain exists to give. So it is in the canonical form,
and the canonical form is therefore `klopt.journal-entry.v2`.

Migration 0012 **refuses to run on a database that already has journal
entries**, and says so with the SQL to start clean. That is the honest option
before 1.0:

- Rehashing means rewriting `journal_entries.hash`, which means defeating the
  append-only trigger. A migration that can do that is a tool that can rewrite
  history, and it would exist forever afterwards.
- There are no installations. The cost is one `DROP SCHEMA` in development.

After 1.0 this option is gone, and a further version needs a documented
rehash-and-attest procedure that verifies the existing chain **before** it
rewrites anything — otherwise it launders a chain that was already broken.

## Consequences

- The XAF export gains the base amount alongside the VAT per line, which is what
  XAF 3.2 actually models. This was a latent gap.
- XAF **import** still drops VAT codes entirely (`xaf/import.ts` sets
  `taxCode: null`). An imported year therefore produces an empty return rather
  than a wrong one. Worth fixing, and it is a separate change.
- `account_period_balances` is not used by the return and cannot be: it is per
  account and per period, which cannot answer "which lines produced 1a".
  Reading the journal directly is the point, not a performance oversight.

## What this turned up in the auditfile

An HTTP walk-through immediately after the change found that
`/api/v1/exports/audit-file` was returning 422 — and had been failing for any
entity that had ever posted an invoice, since M1.

`XafExportRepository` was assembling the document with two placeholders:

```ts
customersSuppliers: [],   // "arrive with Sales in M1"
vatCodes: [],             // "the tax code engine is M3"
```

Both notes were true when written and neither was revisited. The consequence of
the second is severe: a `vatID` on a transaction line that the `vatCodes` block
does not declare makes the file invalid, and the validator refuses to hand it
over. So the single highest-leverage feature in the product did not work as soon
as anyone used the product.

Nothing caught it because the export fixture posted a journal entry described in
its own comment as "an invoice with BTW" with no tax code on any line.

Fixed here, along with two more things the same walk showed:

- **`vatPerc` was hardcoded to `'0'`.** The line does not carry a rate, but it
  carries a code and the code has one.
- **The `<vat>` block was emitted on the VAT ledger line as well as the base
  line**, declaring the same tax twice. XAF puts it on the line whose `amnt` is
  the taxable base — which was not expressible before `tax_role` existed to
  tell the two apart.
- **`custSupID` carried the subledger uuid**, not the contact number the
  `customersSuppliers` block declares. Harmless while that block was empty; a
  dangling reference the moment it was not.

The lesson worth keeping is not about XAF. It is that a placeholder naming a
future milestone is invisible to the test suite, and the walk-through over real
HTTP is what finds them. Both M2 and M3 found a shipped-broken endpoint this
way.
