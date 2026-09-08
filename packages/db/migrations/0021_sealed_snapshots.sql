-- Periodic sealed snapshots (spec 7.6): "a scheduled XAF export plus a
-- manifest of document hashes, written to the WORM bucket. This is your 'prove
-- nothing changed' artefact."
--
-- The row is the seal and the manifest. The XAF itself and the manifest text go
-- into the content-addressed document store like any other document, so they
-- get retention, deduplication and tamper-evidence for free — and so a snapshot
-- of a year that has already been snapshotted stores no second copy of an
-- identical auditfile.

CREATE TABLE "klopt"."sealed_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	-- The book year this covers.
	"fiscal_year" text NOT NULL,
	"sealed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sealed_by" text NOT NULL,

	-- The journal's hash-chain head and its length. One value covers every
	-- posting: an inspector who records it now can check it later without
	-- reading a single entry.
	"chain_head" char(64),
	"entry_count" integer NOT NULL,

	-- The auditfile, and the manifest, as documents in the store.
	"audit_file_sha256" char(64) NOT NULL,
	"audit_file_line_count" integer NOT NULL,
	"manifest_sha256" char(64) NOT NULL,

	-- The canonical manifest text, kept here as well as in the store. It is a
	-- few kilobytes and it is what the seal is computed over, so keeping it
	-- means a seal stays checkable even if the store is unreachable.
	"manifest" text NOT NULL,
	"seal" char(64) NOT NULL,

	-- The previous snapshot's seal. A chain of seals, for the same reason the
	-- journal has one: removing a snapshot from the middle becomes visible.
	"previous_seal" char(64),

	"document_count" integer NOT NULL,
	"deleted_document_count" integer NOT NULL,
	"total_bytes" bigint NOT NULL,

	-- Set when the snapshot has been checked against the administration since.
	"verified_at" timestamp with time zone,
	"verified_ok" boolean,
	"drift" jsonb
);--> statement-breakpoint

ALTER TABLE "klopt"."sealed_snapshots" ADD CONSTRAINT "sealed_snapshots_entity_id_entities_id_fk"
	FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "sealed_snapshots_entity_year" ON "klopt"."sealed_snapshots"
	("entity_id", "fiscal_year", "sealed_at");--> statement-breakpoint

-- One seal cannot appear twice: it is a hash over a manifest that contains the
-- sealing timestamp, so a duplicate means the same snapshot was written twice.
CREATE UNIQUE INDEX "sealed_snapshots_seal" ON "klopt"."sealed_snapshots" ("entity_id", "seal");--> statement-breakpoint

ALTER TABLE "klopt"."sealed_snapshots" ADD CONSTRAINT "sealed_snapshots_hash_shape"
	CHECK ("seal" ~ '^[0-9a-f]{64}$' AND "manifest_sha256" ~ '^[0-9a-f]{64}$');--> statement-breakpoint

-- Append-only, except for the verification columns.
--
-- A snapshot that could be edited would be a snapshot worth nothing, and a
-- verification result is not part of what was sealed — it is what somebody
-- found when they checked. So the seal, the manifest and every fact under them
-- are frozen, and the outcome of a check is allowed to be written.
CREATE OR REPLACE FUNCTION klopt.reject_snapshot_mutation() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'klopt.sealed_snapshots is append-only: a snapshot is the evidence, not a working note';
	END IF;

	IF NEW.seal IS DISTINCT FROM OLD.seal
		OR NEW.manifest IS DISTINCT FROM OLD.manifest
		OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
		OR NEW.fiscal_year IS DISTINCT FROM OLD.fiscal_year
		OR NEW.sealed_at IS DISTINCT FROM OLD.sealed_at
		OR NEW.chain_head IS DISTINCT FROM OLD.chain_head
		OR NEW.entry_count IS DISTINCT FROM OLD.entry_count
		OR NEW.audit_file_sha256 IS DISTINCT FROM OLD.audit_file_sha256
		OR NEW.manifest_sha256 IS DISTINCT FROM OLD.manifest_sha256
		OR NEW.previous_seal IS DISTINCT FROM OLD.previous_seal THEN
		RAISE EXCEPTION 'klopt.sealed_snapshots: what was sealed cannot change; only the result of checking it can';
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER sealed_snapshots_verification_only
	BEFORE UPDATE OR DELETE ON klopt.sealed_snapshots
	FOR EACH ROW EXECUTE FUNCTION klopt.reject_snapshot_mutation();
