# 0060. Moneybird history comes from the API

Status: Accepted
Date: 2026-10-05

## Context

Exact Online's importer (ADR 0034, spec 13) brings master data and open items.
Ledger history is a separate artefact: an XAF audit file. That split is honest
for Exact. Moneybird is not Exact.

Issue #32 asks to move a full Moneybird administration into Klopt, including
booked history: sales and credit notes, purchase invoices and receipts with
attachments, financial accounts and bank mutations, the general journal and
opening balances, and the document archive.

Moneybird's public REST API v2 is the source that contains those documents.
There is no Moneybird audit/export file that is sufficient for statutory ledger
history the way XAF is for Exact. Accountant exports and bank files cover a
slice; they do not replace the booked documents.

## Decision

**Snapshot the API, then plan.** The importer reads one administration into a
snapshot (`readAdministration`) and `planMoneybirdImport` is a pure function of
that snapshot plus existing Klopt state. The report a human approves is the
object the worker executes.

**History is API-sourced booked documents**, posted only through
`postJournalEntry` (VRK / INK / BNK / MEM). External Moneybird ids make a
re-run idempotent. Attachments go through the inbox, with a skip list so a
resumed run does not download twice.

**All years the API returns are in scope** for this dogfooding migration. The
planner already groups by document date; narrowing later is a filter, not a
redesign.

**Auth is a personal API token**, encrypted like other secrets. OAuth is out of
scope and listed as not imported. One token reaches every administration the
user belongs to, so choosing an administration is its own step, as with Exact.

A foreign-currency administration is refused rather than converted. A Moneybird
fiscal year that does not start in the same month as the Klopt entity is refused
(`fiscal_year_start_mismatch`) rather than posting into the wrong periods.

## Consequences

- Exact remains master data + open items + XAF. Moneybird is a second importer
  with the same shape (port, adapter, plan, worker, coded findings) and a
  larger snapshot.
- Unreadable is not empty: a 403 on sales invoices is a warning and the trial
  balance is `unreadable`, not a balanced zero.
- Recurring invoices, estimates, time, projects, products, Mollie, workflows,
  styles, templates, payroll, two-way/scheduled sync, OAuth, and a generic SaaS
  importer framework are named on the report as not imported.
- Mapping review is required for used ledger accounts and tax rates before
  commit. Proposed VAT codes come from matching existing Klopt rules on rate
  and direction.
