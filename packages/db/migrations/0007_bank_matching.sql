-- Bank matching (spec 7.4).
--
-- `bank_transaction_allocations` is what finally makes "outstanding" mean
-- something: an invoice's outstanding amount is its total less the allocations
-- against it. Until this table existed, the dunning list could only say
-- "issued and not cancelled", and it said so on the screen.
--
-- `bank_match_rules` is a table rather than a model because spec 7.4 requires
-- learned rules to be "visible and editable, never a black box". Every rule can
-- be listed, explained, switched off and deleted, and times_applied is both the
-- confidence input and the honest answer to "why did it suggest that".

CREATE TABLE "klopt"."bank_match_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"source" text DEFAULT 'learned' NOT NULL,
	"counterparty_iban" text,
	"counterparty_name" text,
	"description_contains" text,
	"account_id" uuid,
	"contact_id" uuid,
	"times_applied" integer DEFAULT 0 NOT NULL,
	"last_applied_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_match_rules_conditions" UNIQUE("entity_id","counterparty_iban","counterparty_name","description_contains")
);
--> statement-breakpoint
CREATE TABLE "klopt"."bank_transaction_allocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_minor_units" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_allocations_unique" UNIQUE("transaction_id","invoice_id"),
	CONSTRAINT "bank_allocations_positive" CHECK ("klopt"."bank_transaction_allocations"."amount_minor_units" > 0)
);
--> statement-breakpoint
ALTER TABLE "klopt"."bank_match_rules" ADD CONSTRAINT "bank_match_rules_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."bank_match_rules" ADD CONSTRAINT "bank_match_rules_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "klopt"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."bank_match_rules" ADD CONSTRAINT "bank_match_rules_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "klopt"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."bank_transaction_allocations" ADD CONSTRAINT "bank_transaction_allocations_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."bank_transaction_allocations" ADD CONSTRAINT "bank_transaction_allocations_transaction_id_bank_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "klopt"."bank_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."bank_transaction_allocations" ADD CONSTRAINT "bank_transaction_allocations_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "klopt"."sales_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_match_rules_entity" ON "klopt"."bank_match_rules" USING btree ("entity_id","is_active");--> statement-breakpoint
CREATE INDEX "bank_allocations_invoice" ON "klopt"."bank_transaction_allocations" USING btree ("invoice_id");