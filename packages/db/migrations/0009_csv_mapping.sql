-- A per-account CSV mapping, and nullable statement balances.
--
-- There is no CSV standard: every bank invents its own columns, so the layout
-- is configuration rather than code (spec 7.4), stored per account because that
-- is the grain at which it differs.
--
-- The balances become nullable because a CSV export often carries none. The
-- alternative was a fabricated zero, which would appear on the bank screen as
-- the account's balance -- worse than admitting there is none.

ALTER TABLE "klopt"."bank_statements" ALTER COLUMN "opening_balance_minor_units" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "klopt"."bank_statements" ALTER COLUMN "closing_balance_minor_units" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "klopt"."bank_accounts" ADD COLUMN "csv_mapping" jsonb;