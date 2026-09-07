-- NULLS NOT DISTINCT on the rule condition set.
--
-- A matching rule normally has one condition and two nulls. Under Postgres's
-- default NULLS DISTINCT, two such rows never conflict -- so the
-- onConflictDoUpdate that is supposed to bump times_applied inserted a new
-- rule every time instead, and the confidence never left 1. Which is exactly
-- what it did, until a test asked it to count to three.

ALTER TABLE "klopt"."bank_match_rules" DROP CONSTRAINT "bank_match_rules_conditions";--> statement-breakpoint
ALTER TABLE "klopt"."bank_match_rules" ADD CONSTRAINT "bank_match_rules_conditions" UNIQUE NULLS NOT DISTINCT("entity_id","counterparty_iban","counterparty_name","description_contains");