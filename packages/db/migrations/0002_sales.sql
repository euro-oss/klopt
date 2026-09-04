CREATE TYPE "klopt"."contact_kind" AS ENUM('company', 'person');--> statement-breakpoint
CREATE TYPE "klopt"."invoice_kind" AS ENUM('invoice', 'credit_note');--> statement-breakpoint
CREATE TYPE "klopt"."invoice_status" AS ENUM('draft', 'issued', 'cancelled');--> statement-breakpoint
CREATE TYPE "klopt"."tax_direction" AS ENUM('output', 'input');--> statement-breakpoint
CREATE TABLE "klopt"."contact_addresses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"kind" text DEFAULT 'street' NOT NULL,
	"street" text,
	"house_number" text,
	"postal_code" text,
	"city" text,
	"region" text,
	"country_code" char(2) DEFAULT 'NL' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "klopt"."contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"number" text NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"kind" "klopt"."contact_kind" DEFAULT 'company' NOT NULL,
	"is_customer" boolean DEFAULT false NOT NULL,
	"is_supplier" boolean DEFAULT false NOT NULL,
	"vat_number" text,
	"kvk_number" text,
	"country_code" char(2) DEFAULT 'NL' NOT NULL,
	"email" text,
	"phone" text,
	"iban" text,
	"payment_terms_days" smallint DEFAULT 30 NOT NULL,
	"notes" text,
	"is_blocked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contacts_entity_number" UNIQUE("entity_id","number"),
	CONSTRAINT "contacts_payment_terms_range" CHECK ("klopt"."contacts"."payment_terms_days" >= 0 and "klopt"."contacts"."payment_terms_days" <= 365)
);
--> statement-breakpoint
CREATE TABLE "klopt"."invoice_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"recipient" text NOT NULL,
	"document_hash" char(64),
	"transport" text NOT NULL,
	"transport_message_id" text,
	"delivered" boolean NOT NULL,
	"failure" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "klopt"."sales_invoice_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(20, 6) NOT NULL,
	"unit_code" text DEFAULT 'EA' NOT NULL,
	"unit_price_minor_units" bigint NOT NULL,
	"revenue_account_id" uuid NOT NULL,
	"tax_code_id" uuid NOT NULL,
	"net_minor_units" bigint NOT NULL,
	"tax_minor_units" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_invoice_lines_number" UNIQUE("invoice_id","line_number")
);
--> statement-breakpoint
CREATE TABLE "klopt"."sales_invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"kind" "klopt"."invoice_kind" DEFAULT 'invoice' NOT NULL,
	"status" "klopt"."invoice_status" DEFAULT 'draft' NOT NULL,
	"number" text,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"currency" char(3) NOT NULL,
	"net_minor_units" bigint NOT NULL,
	"tax_minor_units" bigint NOT NULL,
	"total_minor_units" bigint NOT NULL,
	"reference" text,
	"buyer_reference" text,
	"notes" text,
	"journal_entry_id" uuid,
	"credits_invoice_id" uuid,
	"issued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_invoices_entity_number" UNIQUE("entity_id","number"),
	CONSTRAINT "sales_invoices_dates" CHECK ("klopt"."sales_invoices"."due_date" >= "klopt"."sales_invoices"."issue_date"),
	CONSTRAINT "sales_invoices_issued_is_complete" CHECK (("klopt"."sales_invoices"."status" <> 'issued') or ("klopt"."sales_invoices"."number" is not null and "klopt"."sales_invoices"."journal_entry_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "klopt"."tax_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"code" text NOT NULL,
	"description" text NOT NULL,
	"rate_basis_points" integer NOT NULL,
	"direction" "klopt"."tax_direction" NOT NULL,
	"account_id" uuid,
	"is_reverse_charge" boolean DEFAULT false NOT NULL,
	"ubl_category" char(2) DEFAULT 'S' NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_codes_entity_code" UNIQUE("entity_id","code"),
	CONSTRAINT "tax_codes_rate_range" CHECK ("klopt"."tax_codes"."rate_basis_points" between 0 and 10000)
);
--> statement-breakpoint
ALTER TABLE "klopt"."contact_addresses" ADD CONSTRAINT "contact_addresses_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."contact_addresses" ADD CONSTRAINT "contact_addresses_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "klopt"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."contacts" ADD CONSTRAINT "contacts_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."invoice_deliveries" ADD CONSTRAINT "invoice_deliveries_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."invoice_deliveries" ADD CONSTRAINT "invoice_deliveries_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "klopt"."sales_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "klopt"."sales_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_revenue_account_id_accounts_id_fk" FOREIGN KEY ("revenue_account_id") REFERENCES "klopt"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_tax_code_id_tax_codes_id_fk" FOREIGN KEY ("tax_code_id") REFERENCES "klopt"."tax_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."sales_invoices" ADD CONSTRAINT "sales_invoices_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."sales_invoices" ADD CONSTRAINT "sales_invoices_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "klopt"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."sales_invoices" ADD CONSTRAINT "sales_invoices_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "klopt"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."tax_codes" ADD CONSTRAINT "tax_codes_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."tax_codes" ADD CONSTRAINT "tax_codes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "klopt"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_addresses_contact" ON "klopt"."contact_addresses" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "contacts_entity_name" ON "klopt"."contacts" USING btree ("entity_id","name");--> statement-breakpoint
CREATE INDEX "invoice_deliveries_invoice" ON "klopt"."invoice_deliveries" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "sales_invoices_contact" ON "klopt"."sales_invoices" USING btree ("entity_id","contact_id");--> statement-breakpoint
CREATE INDEX "sales_invoices_due" ON "klopt"."sales_invoices" USING btree ("entity_id","due_date");