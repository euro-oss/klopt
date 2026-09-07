-- Source documents and the purchase inbox (spec 6, 7.5, 7.6).
--
-- "Every source document is stored with a SHA-256 content hash and linked to
-- its postings. Documents are content-addressed and deduplicated."
--
-- So `documents` is keyed by the hash, not by a uuid: the same invoice arriving
-- by email and again over Peppol is one row, and the two arrivals are two inbox
-- items pointing at it. Deduplication is not a space optimisation here -- it is
-- how the inbox knows the second arrival is the same document.
--
-- Append-only. A stored document that can be altered fails the bewaarplicht's
-- own test: the administration has to stay accessible, readable and
-- controllable for seven years, and bytes that can quietly change are none of
-- those things. The bytes themselves live in a DocumentStore; this table is the
-- index and the evidence of when each one first appeared.

CREATE TYPE "klopt"."document_source" AS ENUM('upload', 'email', 'peppol', 'generated');--> statement-breakpoint
CREATE TYPE "klopt"."inbox_state" AS ENUM('new', 'drafted', 'discarded');--> statement-breakpoint

CREATE TABLE "klopt"."documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	-- The address and the identity. Lowercase hex.
	"sha256" char(64) NOT NULL,
	"size_bytes" integer NOT NULL,
	"content_type" text NOT NULL,
	-- Metadata on the arrival, not on the bytes: two arrivals of the same file
	-- may have been called different things.
	"filename" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "klopt"."documents" ADD CONSTRAINT "documents_entity_id_entities_id_fk"
	FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- One row per set of bytes per administration. Two entities that receive the
-- same document each keep their own row: the bytes are shared in the store,
-- the record of holding them is not.
ALTER TABLE "klopt"."documents" ADD CONSTRAINT "documents_entity_hash" UNIQUE("entity_id","sha256");--> statement-breakpoint
ALTER TABLE "klopt"."documents" ADD CONSTRAINT "documents_hash_shape"
	CHECK ("sha256" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
CREATE TRIGGER documents_append_only
	BEFORE UPDATE OR DELETE ON "klopt"."documents"
	FOR EACH ROW EXECUTE FUNCTION klopt.reject_mutation();--> statement-breakpoint

-- What a document is evidence for. A purchase invoice's UBL, a sales invoice's
-- PDF, a bank statement's original file -- all the same shape, which is why the
-- link is a (kind, id) pair rather than seven nullable foreign keys.
CREATE TABLE "klopt"."document_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	-- `purchase_invoice`, `sales_invoice`, `journal_entry`, `bank_statement`.
	"subject_kind" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"role" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "klopt"."document_links" ADD CONSTRAINT "document_links_entity_id_entities_id_fk"
	FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."document_links" ADD CONSTRAINT "document_links_document_id_documents_id_fk"
	FOREIGN KEY ("document_id") REFERENCES "klopt"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."document_links" ADD CONSTRAINT "document_links_unique"
	UNIQUE("document_id","subject_kind","subject_id");--> statement-breakpoint
CREATE INDEX "document_links_subject" ON "klopt"."document_links" ("entity_id","subject_kind","subject_id");--> statement-breakpoint

-- The inbox: everything that has arrived and not yet been dealt with.
--
-- "A purchase-invoice inbox that ingests email, PDF and Peppol UBL into the
-- same queue." One queue, one shape, whatever the source -- because the work in
-- front of a bookkeeper is the same work regardless of how it got there.
CREATE TABLE "klopt"."inbox_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"source" "klopt"."document_source" NOT NULL,
	"state" "klopt"."inbox_state" DEFAULT 'new' NOT NULL,
	-- Who or what it came from: an email address, a Peppol participant id.
	"received_from" text,
	"subject" text,
	-- What was read out of it, when it could be read. Null for a PDF.
	"parsed" jsonb,
	"parse_error" text,
	-- The supplier it was matched to, and the draft it became.
	"contact_id" uuid,
	"purchase_invoice_id" uuid,
	"discarded_reason" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"handled_by" text,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "klopt"."inbox_items" ADD CONSTRAINT "inbox_items_entity_id_entities_id_fk"
	FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."inbox_items" ADD CONSTRAINT "inbox_items_document_id_documents_id_fk"
	FOREIGN KEY ("document_id") REFERENCES "klopt"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."inbox_items" ADD CONSTRAINT "inbox_items_contact_id_contacts_id_fk"
	FOREIGN KEY ("contact_id") REFERENCES "klopt"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."inbox_items" ADD CONSTRAINT "inbox_items_purchase_invoice_id_fk"
	FOREIGN KEY ("purchase_invoice_id") REFERENCES "klopt"."purchase_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbox_items_state" ON "klopt"."inbox_items" ("entity_id","state","received_at");--> statement-breakpoint
CREATE INDEX "inbox_items_document" ON "klopt"."inbox_items" ("entity_id","document_id");--> statement-breakpoint
-- An item that became a draft points at it; one that did not, does not.
ALTER TABLE "klopt"."inbox_items" ADD CONSTRAINT "inbox_items_drafted_has_invoice"
	CHECK (("state" = 'drafted') = ("purchase_invoice_id" IS NOT NULL));--> statement-breakpoint
-- Discarding is a decision somebody made, and it needs a reason for the same
-- reason a dispute does: the next person has to know why.
ALTER TABLE "klopt"."inbox_items" ADD CONSTRAINT "inbox_items_discarded_has_reason"
	CHECK (("state" <> 'discarded') OR ("discarded_reason" IS NOT NULL));
