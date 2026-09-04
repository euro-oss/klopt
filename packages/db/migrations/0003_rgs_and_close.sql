-- RGS version tracking and year-close bookkeeping.

-- The RGS variant an entity is mapped against. The version already lives on
-- `entities.rgs_version`; the variant matters because a code can exist in the
-- full scheme and not in MKB.
ALTER TABLE "klopt"."entities"
  ADD COLUMN "rgs_variant" text NOT NULL DEFAULT 'mkb';

--> statement-breakpoint

-- A year close is two ordinary journal entries (spec 6.4). This records that
-- they happened, and which entries they were, so a close can be shown, audited
-- and — because both entries are reversible — undone.
CREATE TABLE "klopt"."year_closes" (
  "id"                  uuid PRIMARY KEY,
  "entity_id"           uuid NOT NULL REFERENCES "klopt"."entities"("id"),
  "fiscal_year_id"      uuid NOT NULL REFERENCES "klopt"."fiscal_years"("id"),
  "appropriation_entry_id" uuid REFERENCES "klopt"."journal_entries"("id"),
  "opening_entry_id"    uuid REFERENCES "klopt"."journal_entries"("id"),
  "result_minor_units"  bigint NOT NULL,
  "result_currency"     char(3) NOT NULL,
  "closed_at"           timestamptz NOT NULL DEFAULT now(),
  "closed_by"           text NOT NULL,
  -- Set when the close is reversed. The row stays: it is evidence that a close
  -- happened and was undone, which is exactly what an auditor wants to see.
  "reversed_at"         timestamptz
);

--> statement-breakpoint

-- One open close per fiscal year. A reversed one may be superseded.
CREATE UNIQUE INDEX "year_closes_one_open_per_year"
  ON "klopt"."year_closes" ("fiscal_year_id")
  WHERE "reversed_at" IS NULL;
