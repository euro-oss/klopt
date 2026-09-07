-- The VAT engine (spec 7.2).
--
-- Three changes, each of which the return depends on:
--
-- 1. A tax code becomes a *rule*: which rubriek its base and its VAT are
--    declared in, what kind of transaction it is, and whether the input VAT is
--    recoverable. A percentage cannot answer "1a or 4b?".
--
-- 2. `journal_lines.tax_role` says whether a line *is* the taxable base or the
--    tax on it. Without it the base is unrecoverable from the journal -- and
--    the return must come from the journal, never a parallel tally -- because
--    "the credit lines of an entry that has a tax line" breaks on the first
--    invoice mixing 21% and 9% on one revenue account. Existing tax-coded
--    lines are all tax lines, which is what the backfill says.
--
-- 3. `tax_codes` loses its unique index on (entity_id, code): a rate change is
--    a new row with a new validity window, never an update, so a code has as
--    many rows as it has had rates.

-- The hash chain covers tax_role, so this is canonical format v2 and every
-- stored hash computed under v1 no longer reproduces. Before 1.0 the format is
-- not frozen and the honest move is to refuse rather than to rewrite hashes
-- behind an append-only trigger, so an installation with books in it stops here
-- and is told what to do.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "klopt"."journal_entries") THEN
		RAISE EXCEPTION
			'klopt: migration 0012 changes the hash chain''s canonical form to v2 (it now covers a line''s tax role). Every hash stored under v1 would stop reproducing. Before 1.0 there is no rehash procedure by design -- rewriting journal_entries.hash means defeating the append-only trigger. Start from an empty database: DROP SCHEMA klopt CASCADE; DROP SCHEMA klopt_meta CASCADE; then migrate. See docs/decisions/0021-tax-code-is-a-rule.md.';
	END IF;
END $$;--> statement-breakpoint

CREATE TYPE "klopt"."tax_role" AS ENUM('base', 'tax');--> statement-breakpoint
CREATE TYPE "klopt"."tax_scope" AS ENUM('domestic', 'intra_community_supply', 'intra_community_acquisition', 'import', 'export', 'private_use', 'exempt', 'out_of_scope');--> statement-breakpoint
CREATE TYPE "klopt"."reverse_charge" AS ENUM('none', 'domestic', 'import_article_23');--> statement-breakpoint
CREATE TYPE "klopt"."deductibility" AS ENUM('full', 'pro_rata', 'none');--> statement-breakpoint
CREATE TYPE "klopt"."supply_kind" AS ENUM('goods', 'services', 'not_applicable');--> statement-breakpoint
CREATE TYPE "klopt"."vat_period_kind" AS ENUM('monthly', 'quarterly', 'annual');--> statement-breakpoint
CREATE TYPE "klopt"."vat_filing_state" AS ENUM('draft', 'filed', 'superseded');--> statement-breakpoint

ALTER TABLE "klopt"."journal_lines" ADD COLUMN "tax_role" "klopt"."tax_role";--> statement-breakpoint
UPDATE "klopt"."journal_lines" SET "tax_role" = 'tax' WHERE "tax_code" IS NOT NULL;--> statement-breakpoint

-- A tax code on a line without a role, or a role without a code, would be
-- silently dropped from the return. Refuse the half-tagged line instead.
ALTER TABLE "klopt"."journal_lines" ADD CONSTRAINT "journal_lines_tax_role_needs_code"
	CHECK (("tax_code" IS NULL) = ("tax_role" IS NULL));--> statement-breakpoint

ALTER TABLE "klopt"."tax_codes" ADD COLUMN "base_rubriek" text;--> statement-breakpoint
ALTER TABLE "klopt"."tax_codes" ADD COLUMN "vat_rubriek" text;--> statement-breakpoint
ALTER TABLE "klopt"."tax_codes" ADD COLUMN "scope" "klopt"."tax_scope" DEFAULT 'domestic' NOT NULL;--> statement-breakpoint
ALTER TABLE "klopt"."tax_codes" ADD COLUMN "reverse_charge" "klopt"."reverse_charge" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "klopt"."tax_codes" ADD COLUMN "deductibility" "klopt"."deductibility" DEFAULT 'full' NOT NULL;--> statement-breakpoint
ALTER TABLE "klopt"."tax_codes" ADD COLUMN "pro_rata_basis_points" integer;--> statement-breakpoint
ALTER TABLE "klopt"."tax_codes" ADD COLUMN "supply_kind" "klopt"."supply_kind" DEFAULT 'not_applicable' NOT NULL;--> statement-breakpoint
ALTER TABLE "klopt"."tax_codes" ADD COLUMN "deduction_code" text;--> statement-breakpoint

UPDATE "klopt"."tax_codes" SET "reverse_charge" = 'domestic' WHERE "is_reverse_charge";--> statement-breakpoint

ALTER TABLE "klopt"."tax_codes" DROP CONSTRAINT "tax_codes_entity_code";--> statement-breakpoint
ALTER TABLE "klopt"."tax_codes" ADD CONSTRAINT "tax_codes_entity_code_from" UNIQUE("entity_id","code","valid_from");--> statement-breakpoint
ALTER TABLE "klopt"."tax_codes" ADD CONSTRAINT "tax_codes_pro_rata_share"
	CHECK (("deductibility" = 'pro_rata') = ("pro_rata_basis_points" IS NOT NULL));--> statement-breakpoint

-- How often this entity files. Quarterly is the default because it is what the
-- Belastingdienst assigns to almost every new MKB registration.
ALTER TABLE "klopt"."entities" ADD COLUMN "vat_period_kind" "klopt"."vat_period_kind" DEFAULT 'quarterly' NOT NULL;--> statement-breakpoint
ALTER TABLE "klopt"."entities" ADD COLUMN "vat_pro_rata_basis_points" integer;--> statement-breakpoint

-- A filing is evidence, so it stores what was declared rather than a pointer to
-- a recomputation. The whole point of keeping the snapshot is that recomputing
-- it later may give a different answer -- and when it does, a suppletie is owed.
CREATE TABLE "klopt"."vat_filings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"kind" "klopt"."vat_period_kind" NOT NULL,
	"state" "klopt"."vat_filing_state" DEFAULT 'draft' NOT NULL,
	-- 1 is the original aangifte, 2 the first suppletie, and so on.
	"sequence" integer DEFAULT 1 NOT NULL,
	-- A suppletie points at the filing it corrects.
	"supersedes_id" uuid,
	"owed_minor_units" bigint NOT NULL,
	"deductible_minor_units" bigint NOT NULL,
	"payable_minor_units" bigint NOT NULL,
	"rubrieken" jsonb NOT NULL,
	"reconciliation" jsonb NOT NULL,
	"findings" jsonb NOT NULL,
	-- Set when the return was accepted despite warnings, with who and why.
	"accepted_warnings_by" text,
	"accepted_warnings_reason" text,
	"filed_by" text,
	"filed_at" timestamp with time zone,
	"transport" text,
	"transport_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "klopt"."vat_filings" ADD CONSTRAINT "vat_filings_entity_id_entities_id_fk"
	FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."vat_filings" ADD CONSTRAINT "vat_filings_supersedes_id_vat_filings_id_fk"
	FOREIGN KEY ("supersedes_id") REFERENCES "klopt"."vat_filings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."vat_filings" ADD CONSTRAINT "vat_filings_period" CHECK ("period_to" >= "period_from");--> statement-breakpoint
ALTER TABLE "klopt"."vat_filings" ADD CONSTRAINT "vat_filings_period_sequence"
	UNIQUE("entity_id","period_from","period_to","sequence");
