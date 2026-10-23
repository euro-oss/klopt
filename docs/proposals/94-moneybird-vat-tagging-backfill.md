# #94 — Moneybird untagged VAT: detection SQL (future cases)

Hosted check (Neverhide, 2026-10-23): **0** Moneybird-sourced journal entries and
**0** VAT filings, so no backfill is needed now. Keep this note for later
administrations that imported before the tagging fix.

## Detection (read-only)

Run inside a `READ ONLY` transaction. VAT control accounts are those referenced
by `klopt.tax_codes.account_id` (not hard-coded 1500/1510).

```sql
-- Per entity: periods with Moneybird-imported untagged VAT-account lines,
-- and whether Klopt already has a vat_filings row for that period.
WITH control_accounts AS (
  SELECT DISTINCT tc.entity_id, a.number AS account_number
  FROM klopt.tax_codes tc
  INNER JOIN klopt.accounts a ON a.id = tc.account_id
),
moneybird_untagged AS (
  SELECT
    je.entity_id,
    je.id AS entry_id,
    je.booking_date,
    je.source_document_ref,
    jl.line_number,
    a.number AS account_number,
    jl.functional_debit_minor_units - jl.functional_credit_minor_units AS signed_minor_units
  FROM klopt.journal_lines jl
  INNER JOIN klopt.journal_entries je ON je.id = jl.entry_id
  INNER JOIN klopt.accounts a ON a.id = jl.account_id
  INNER JOIN control_accounts ca
    ON ca.entity_id = je.entity_id AND ca.account_number = a.number
  WHERE je.source_document_ref LIKE 'moneybird:%'
    AND jl.tax_code IS NULL
    AND jl.tax_role IS NULL
    AND (jl.functional_debit_minor_units - jl.functional_credit_minor_units) <> 0
)
SELECT
  e.id AS entity_id,
  e.name AS entity_name,
  date_trunc('quarter', mu.booking_date)::date AS period_from,
  (date_trunc('quarter', mu.booking_date) + INTERVAL '3 months - 1 day')::date AS period_to,
  COUNT(DISTINCT mu.entry_id) AS moneybird_untagged_entries,
  EXISTS (
    SELECT 1
    FROM klopt.vat_filings vf
    WHERE vf.entity_id = e.id
      AND vf.state IN ('filed', 'draft')
      AND vf.period_from <= MAX(mu.booking_date)
      AND vf.period_to >= MIN(mu.booking_date)
  ) AS has_klopt_filing_or_prepared
FROM moneybird_untagged mu
INNER JOIN klopt.entities e ON e.id = mu.entity_id
GROUP BY e.id, e.name, date_trunc('quarter', mu.booking_date)
ORDER BY e.name, period_from;
```

For per-rubriek deltas on periods filed through Klopt, compare
`klopt.vat_filings.rubrieken` (immutable snapshot) to a fresh `buildVatReturn`
after append-only correction. Only rows with `vat_filings.state` in
(`filed`, `draft`) and a matching Moneybird gap are in scope.

## Correction approach (when needed)

Append-only: reverse each affected entry and repost with tagged VAT lines,
linked to the original (`reverses_entry_id` / source ref) and audited. Never
`UPDATE`/`DELETE` journal rows or mutate `vat_filings` snapshots. Each
correction carries an explicit VAT period so the amount lands in exactly one
return (suppletie for the original period, or the next return — never both).
Use “voorbereid” / “prepared” in copy for returns Klopt prepared but did not
deliver.
