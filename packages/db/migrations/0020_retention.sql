-- The bewaarplicht, as columns (spec 7.6).
--
-- Seven years, ten for onroerend goed, counted from the end of the book year
-- the document belongs to. A legal hold suspends the whole thing, and deletion
-- after the term is a deliberate batch action somebody presses — never
-- automatic, so nothing here is a trigger.

CREATE TYPE "klopt"."retention_class" AS ENUM ('standard', 'immovable_property');--> statement-breakpoint

-- Ten years rather than seven, for a document about immovable property. The
-- VAT revision period for a building is nine years after the year it was first
-- used, which outlives the ordinary term.
ALTER TABLE "klopt"."documents"
	ADD COLUMN "retention_class" "klopt"."retention_class" DEFAULT 'standard' NOT NULL;--> statement-breakpoint

-- The last day this has to be kept. Null means the book year is not known yet,
-- which makes the document *undeletable* rather than deletable: not knowing how
-- long to keep something is not a licence to throw it away.
ALTER TABLE "klopt"."documents" ADD COLUMN "retain_until" date;--> statement-breakpoint

-- Which book year it was derived from, so the number can be checked rather than
-- taken on faith — and recomputed when a document is linked to a posting in a
-- different year than the one first guessed.
ALTER TABLE "klopt"."documents" ADD COLUMN "retention_fiscal_year" text;--> statement-breakpoint

-- Suspends deletion regardless of the date. A dispute or an investigation
-- outlives the bewaarplicht, and the whole point of a hold is that the clock
-- stops mattering.
ALTER TABLE "klopt"."documents" ADD COLUMN "legal_hold" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "klopt"."documents" ADD COLUMN "legal_hold_reason" text;--> statement-breakpoint

-- Deleted means the *bytes* are gone from the store. The row stays, with its
-- hash: an inspector asking what used to be here gets an answer, and a document
-- that was deleted and later turns up can be checked against what it claims to
-- be. Erasing the row as well would make the deletion itself unauditable.
ALTER TABLE "klopt"."documents" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "klopt"."documents" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "klopt"."documents" ADD COLUMN "deleted_reason" text;--> statement-breakpoint

ALTER TABLE "klopt"."documents" ADD CONSTRAINT "documents_deleted_has_reason"
	CHECK (("deleted_at" IS NULL) = ("deleted_reason" IS NULL));--> statement-breakpoint

-- What a deletion preview scans. Partial, because the interesting rows are the
-- ones still here.
CREATE INDEX "documents_retention" ON "klopt"."documents"
	("entity_id", "retain_until") WHERE "deleted_at" IS NULL;--> statement-breakpoint

-- A hold over the whole administration.
--
-- Separate from the per-document flag and checked first, because a firm under
-- investigation should not have to set a flag on forty thousand rows — and
-- because lifting it should be one deliberate act rather than forty thousand.
ALTER TABLE "klopt"."entities" ADD COLUMN "legal_hold" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "klopt"."entities" ADD COLUMN "legal_hold_reason" text;--> statement-breakpoint

-- `documents` is append-only, guarded by the same trigger the journal uses
-- (0001_ledger_guards.sql). Retention needs three of its columns to move —
-- setting a hold, recording a computed term, marking the bytes gone — and the
-- guard has to know that or none of this can be written.
--
-- The identity of a document does not move: the hash, the size, the content
-- type and the entity are as immutable as they ever were, and this says so
-- rather than trusting that nobody will.
CREATE OR REPLACE FUNCTION klopt.reject_document_mutation() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'klopt.documents is append-only: a document is deleted by clearing its bytes, not its row';
	END IF;

	IF NEW.sha256 IS DISTINCT FROM OLD.sha256
		OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
		OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes
		OR NEW.content_type IS DISTINCT FROM OLD.content_type
		OR NEW.first_seen_at IS DISTINCT FROM OLD.first_seen_at THEN
		RAISE EXCEPTION 'klopt.documents: what a document *is* cannot change; only its retention can';
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS documents_append_only ON klopt.documents;--> statement-breakpoint

CREATE TRIGGER documents_retention_only
	BEFORE UPDATE OR DELETE ON klopt.documents
	FOR EACH ROW EXECUTE FUNCTION klopt.reject_document_mutation();
