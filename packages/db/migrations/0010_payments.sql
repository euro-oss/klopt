-- Payment batches, and the two people it takes (spec 7.4).
--
-- The check constraint on (submitted_by, approved_by) is belt and braces: the
-- rule lives in the domain, and this is the one table whose contents move money
-- out of the building, so a constraint that survives a refactor which loses a
-- call to nextState() is worth having.

CREATE TYPE "klopt"."payment_batch_state" AS ENUM('draft', 'submitted', 'approved', 'exported', 'rejected');--> statement-breakpoint
CREATE TABLE "klopt"."payment_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"state" "klopt"."payment_batch_state" DEFAULT 'draft' NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"requested_execution_date" date NOT NULL,
	"submitted_by" text,
	"submitted_at" timestamp with time zone,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"rejected_by" text,
	"rejected_at" timestamp with time zone,
	"rejection_reason" text,
	"exported_at" timestamp with time zone,
	"exported_hash" char(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_batches_entity_reference" UNIQUE("entity_id","reference"),
	CONSTRAINT "payment_batches_two_person" CHECK ("klopt"."payment_batches"."approved_by" is null or "klopt"."payment_batches"."submitted_by" is null or "klopt"."payment_batches"."approved_by" <> "klopt"."payment_batches"."submitted_by")
);
--> statement-breakpoint
CREATE TABLE "klopt"."payment_instructions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"end_to_end_id" text NOT NULL,
	"contact_id" uuid,
	"creditor_name" text NOT NULL,
	"creditor_iban" text NOT NULL,
	"creditor_bic" text,
	"amount_minor_units" bigint NOT NULL,
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"remittance_information" text DEFAULT '' NOT NULL,
	"remittance_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_instructions_end_to_end" UNIQUE("batch_id","end_to_end_id"),
	CONSTRAINT "payment_instructions_positive" CHECK ("klopt"."payment_instructions"."amount_minor_units" > 0)
);
--> statement-breakpoint
ALTER TABLE "klopt"."payment_batches" ADD CONSTRAINT "payment_batches_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."payment_batches" ADD CONSTRAINT "payment_batches_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "klopt"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."payment_batches" ADD CONSTRAINT "payment_batches_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "klopt"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."payment_batches" ADD CONSTRAINT "payment_batches_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "klopt"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."payment_batches" ADD CONSTRAINT "payment_batches_rejected_by_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "klopt"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."payment_instructions" ADD CONSTRAINT "payment_instructions_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."payment_instructions" ADD CONSTRAINT "payment_instructions_batch_id_payment_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "klopt"."payment_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."payment_instructions" ADD CONSTRAINT "payment_instructions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "klopt"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_batches_state" ON "klopt"."payment_batches" USING btree ("entity_id","state");--> statement-breakpoint
CREATE INDEX "payment_instructions_batch" ON "klopt"."payment_instructions" USING btree ("batch_id");