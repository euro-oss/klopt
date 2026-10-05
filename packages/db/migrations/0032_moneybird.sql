-- Connecting an administration to Moneybird (issue #32).
--
-- One row per entity. The Moneybird administration is a column rather than a
-- parameter because one personal API token reaches every administration the
-- user belongs to, and importing the wrong one puts fictional invoices into
-- books that get filed.
--
-- The token is encrypted with the instance key (`KLOPT_ENCRYPTION_KEY`), the
-- same rule as Exact's client secret and a mailbox password.
CREATE TABLE "klopt"."moneybird_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"base_url" text NOT NULL,
	"api_token" text NOT NULL,
	"administration_id" text,
	"administration_name" text,
	"administration_currency" text,
	"account_mappings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tax_mappings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_import_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "klopt"."moneybird_connections"
	ADD CONSTRAINT "moneybird_connections_entity_id_entities_id_fk"
	FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id")
	ON DELETE no action ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "moneybird_connections_entity" ON "klopt"."moneybird_connections" ("entity_id");--> statement-breakpoint

-- A walk through a Moneybird administration. One row per entity: asking twice
-- while one is running joins it rather than starting a second walk.
CREATE TABLE "klopt"."moneybird_import_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"administration_id" text NOT NULL,
	"state" text NOT NULL DEFAULT 'pending',
	"report" jsonb,
	"requested_by" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"last_error" text
);--> statement-breakpoint

ALTER TABLE "klopt"."moneybird_import_runs"
	ADD CONSTRAINT "moneybird_import_runs_entity_id_entities_id_fk"
	FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id")
	ON DELETE no action ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "moneybird_import_runs_entity" ON "klopt"."moneybird_import_runs" ("entity_id");--> statement-breakpoint

-- External Moneybird ids already imported, so a re-run posts nothing twice.
CREATE TABLE "klopt"."moneybird_imported_ids" (
	"entity_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"kind" text NOT NULL,
	"journal_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moneybird_imported_ids_pk" PRIMARY KEY ("entity_id", "external_id")
);--> statement-breakpoint

ALTER TABLE "klopt"."moneybird_imported_ids"
	ADD CONSTRAINT "moneybird_imported_ids_entity_id_entities_id_fk"
	FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id")
	ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Skip list for attachments, so a resumed run does not re-download the archive.
CREATE TABLE "klopt"."moneybird_attachments" (
	"entity_id" uuid NOT NULL,
	"moneybird_attachment_id" text NOT NULL,
	"moneybird_document_id" text NOT NULL,
	"document_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moneybird_attachments_pk" PRIMARY KEY ("entity_id", "moneybird_attachment_id")
);--> statement-breakpoint

ALTER TABLE "klopt"."moneybird_attachments"
	ADD CONSTRAINT "moneybird_attachments_entity_id_entities_id_fk"
	FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id")
	ON DELETE no action ON UPDATE no action;
