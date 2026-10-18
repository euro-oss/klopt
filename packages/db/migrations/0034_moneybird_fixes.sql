-- Moneybird finding fixes (issue #42 Phase 1).
--
-- 1. `import_decisions` on the connection: confirmations, exclusions, FX rates
--    and renumbers from the finding cards. Nothing in this JSON posts; commit
--    still goes through `postJournalEntry`.
-- 2. `ecb_reference_rates`: cached ECB daily reference rates so a look-up for
--    an already-fetched date never depends on the ECB being reachable.

ALTER TABLE "klopt"."moneybird_connections"
	ADD COLUMN "import_decisions" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint

CREATE TABLE "klopt"."ecb_reference_rates" (
	"currency" char(3) NOT NULL,
	"rate_date" date NOT NULL,
	"rate" numeric(24, 12) NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ecb_reference_rates_pk" PRIMARY KEY ("currency", "rate_date")
);
