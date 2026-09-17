-- Documents that arrive on their own: a mailbox and a Peppol access point
-- (spec 6, 7.5). The upload path already exists; this is the other doorway
-- into the same queue.

-- What the transport called this arrival: a Message-ID, a Peppol transmission
-- id, a filename in a drop directory.
--
-- The bytes are already deduplicated by their hash, but two arrivals of the
-- same document are two arrivals and both belong in the queue. So "have I
-- already taken this message" cannot be answered by the content — only by the
-- transport's own name for it. Without this, every poll that failed to
-- acknowledge would file the same invoice again.
ALTER TABLE "klopt"."inbox_items" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "klopt"."inbox_items" ADD COLUMN "external_part" text;--> statement-breakpoint

-- One message can carry several documents, so the pair identifies an arrival.
-- Partial, because an upload has no external id and two uploads of the same
-- file are two deliberate acts.
CREATE UNIQUE INDEX "inbox_items_external" ON "klopt"."inbox_items"
	("entity_id", "source", "external_id", "external_part")
	WHERE "external_id" IS NOT NULL;--> statement-breakpoint

CREATE TYPE "klopt"."inbound_source_kind" AS ENUM ('maildir', 'imap', 'peppol');--> statement-breakpoint

-- A mailbox belongs to an administration.
--
-- `facturen@ditbedrijf.nl` is not an instance-wide fact the way a signing
-- certificate nearly is, so a source is a row against an entity rather than an
-- environment variable (spec 8, rule 2). The secret is held separately from the
-- rest of the configuration so that showing somebody their settings never has
-- to load it.
CREATE TABLE "klopt"."inbound_sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"kind" "klopt"."inbound_source_kind" NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	-- Host, port, mailbox, directory. Nothing secret.
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	-- The password or token. Encrypted at rest by the application; null for a
	-- drop directory, which has nothing to authenticate to.
	"secret" text,
	-- Where the last poll got to. Opaque to everything but its own adapter.
	"cursor" text,
	"last_polled_at" timestamp with time zone,
	"last_error" text,
	-- How many arrivals the last poll produced. Shown so an operator can see a
	-- mailbox is alive without opening it.
	"last_message_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "klopt"."inbound_sources" ADD CONSTRAINT "inbound_sources_entity_id_entities_id_fk"
	FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Two sources with the same name in one administration is a configuration
-- mistake somebody should be told about at the point they make it.
CREATE UNIQUE INDEX "inbound_sources_entity_name" ON "klopt"."inbound_sources"
	("entity_id", "name");--> statement-breakpoint

CREATE INDEX "inbound_sources_due" ON "klopt"."inbound_sources"
	("enabled", "last_polled_at");
