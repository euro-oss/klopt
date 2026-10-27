-- Import wizard: per-administration mappings and server-side wizard state
-- (issue #100 phase 1).
--
-- Today account/tax mappings and import_decisions live on moneybird_connections
-- (one row per entity) and disappear on disconnect. The wizard needs them keyed
-- by (entity, source, administration), kept across disconnect and reconnect,
-- and offered back on re-import with an explicit confirm when the source changed.
--
-- The live working copy on moneybird_connections stays: saveMappings still
-- writes there, and also upserts this table for the chosen administration.
-- Disconnect deletes the connection row only; these rows remain.

CREATE TABLE "klopt"."import_administration_mappings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"source" text NOT NULL,
	"administration_id" text NOT NULL,
	"account_mappings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tax_mappings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"import_decisions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "klopt"."import_administration_mappings"
	ADD CONSTRAINT "import_administration_mappings_entity_id_entities_id_fk"
	FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id")
	ON DELETE no action ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "import_administration_mappings_entity_source_admin"
	ON "klopt"."import_administration_mappings" ("entity_id", "source", "administration_id");--> statement-breakpoint

-- One wizard resume row per entity. Safe to close the browser and come back
-- on another device; Terug never loses mappings (those live above).
CREATE TABLE "klopt"."import_wizard_states" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"source" text,
	"step" text NOT NULL DEFAULT 'bron',
	"administration_id" text,
	"selected_years" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preview_hash" text,
	"preview_stale" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "klopt"."import_wizard_states"
	ADD CONSTRAINT "import_wizard_states_entity_id_entities_id_fk"
	FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id")
	ON DELETE no action ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "import_wizard_states_entity"
	ON "klopt"."import_wizard_states" ("entity_id");
