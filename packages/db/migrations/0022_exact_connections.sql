-- Connecting an administration to Exact Online (spec 13).
--
-- One row per entity. The division is a column rather than a parameter because
-- one Exact login reaches every administration the user has rights to — the
-- operating BV, the holding, and the practice and test divisions somebody made
-- along the way — and importing the wrong one puts fictional invoices into
-- books that get filed.
--
-- The credentials are encrypted with the instance key (`KLOPT_ENCRYPTION_KEY`)
-- rather than stored as typed, which is spec 14: "secrets and adapter
-- credentials encrypted at rest with a key from the environment or a KMS, never
-- in the database in plaintext".
CREATE TABLE "klopt"."exact_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"base_url" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"refresh_token" text,
	"access_token_expires_at" timestamp with time zone,
	"access_token" text,
	"state" text,
	"state_created_at" timestamp with time zone,
	"user_name" text,
	"division_code" integer,
	"division_name" text,
	"division_cautions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_import_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "klopt"."exact_connections"
	ADD CONSTRAINT "exact_connections_entity_id_entities_id_fk"
	FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id")
	ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- One connection per administration. Two would make "which Exact division is
-- this entity" a question with two answers.
CREATE UNIQUE INDEX "exact_connections_entity" ON "klopt"."exact_connections" ("entity_id");
