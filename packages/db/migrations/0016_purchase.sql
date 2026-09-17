-- Purchase invoices (spec 15, M4: "the full cycle closes").
--
-- Three differences from `sales_invoices`, each one deliberate:
--
-- 1. **The supplier's own number is the number.** There is no gapless counter
--    here, because the document is not ours -- it is theirs, and spec 14 wants
--    the original numbers preserved so matching and payment can quote them.
--    The unique index on (entity, contact, number) is the duplicate guard, and
--    paying the same invoice twice is the classic accounts-payable failure.
--
-- 2. **The stated totals are authoritative, not derived.** On a sales invoice
--    we compute the VAT; on a purchase invoice the supplier states it and our
--    job is to verify it. So the columns hold what the document says and the
--    check constraint only enforces that net + tax = total -- the arithmetic
--    the document itself must satisfy.
--
-- 3. **Approval is a column, and booking is separate from it.** An invoice
--    that has arrived is a liability whether anybody has authorised it, and its
--    VAT is deductible in the period of the invoice date. So `journal_entry_id`
--    is set at booking and `approved_by` later. Approval gates payment.

CREATE TYPE "klopt"."purchase_invoice_status" AS ENUM('draft', 'booked', 'approved', 'disputed', 'cancelled');--> statement-breakpoint

CREATE TABLE "klopt"."purchase_invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"kind" "klopt"."invoice_kind" DEFAULT 'invoice' NOT NULL,
	"status" "klopt"."purchase_invoice_status" DEFAULT 'draft' NOT NULL,
	-- The supplier's number, exactly as they wrote it.
	"supplier_invoice_number" text NOT NULL,
	"invoice_date" date NOT NULL,
	"due_date" date NOT NULL,
	"currency" char(3) NOT NULL,
	-- As stated on the document. Never recomputed.
	"net_minor_units" bigint NOT NULL,
	"tax_minor_units" bigint NOT NULL,
	"total_minor_units" bigint NOT NULL,
	-- What we quote when we pay: the supplier's payment reference.
	"payment_reference" text,
	"notes" text,
	"journal_entry_id" uuid,
	-- For a credit note, the invoice it corrects.
	"credits_invoice_id" uuid,
	"booked_by" text,
	"booked_at" timestamp with time zone,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"disputed_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "klopt"."purchase_invoices" ADD CONSTRAINT "purchase_invoices_entity_id_entities_id_fk"
	FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."purchase_invoices" ADD CONSTRAINT "purchase_invoices_contact_id_contacts_id_fk"
	FOREIGN KEY ("contact_id") REFERENCES "klopt"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."purchase_invoices" ADD CONSTRAINT "purchase_invoices_journal_entry_id_journal_entries_id_fk"
	FOREIGN KEY ("journal_entry_id") REFERENCES "klopt"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- The duplicate guard. A supplier's own numbering is the only thing that
-- identifies a document across two arrivals of it -- by email and then by post,
-- or over Peppol and then as a PDF chase.
ALTER TABLE "klopt"."purchase_invoices" ADD CONSTRAINT "purchase_invoices_supplier_number"
	UNIQUE("entity_id","contact_id","supplier_invoice_number");--> statement-breakpoint
CREATE INDEX "purchase_invoices_contact" ON "klopt"."purchase_invoices" ("entity_id","contact_id");--> statement-breakpoint
CREATE INDEX "purchase_invoices_due" ON "klopt"."purchase_invoices" ("entity_id","due_date");--> statement-breakpoint
CREATE INDEX "purchase_invoices_status" ON "klopt"."purchase_invoices" ("entity_id","status");--> statement-breakpoint
ALTER TABLE "klopt"."purchase_invoices" ADD CONSTRAINT "purchase_invoices_dates"
	CHECK ("due_date" >= "invoice_date");--> statement-breakpoint
-- The arithmetic the document itself has to satisfy.
ALTER TABLE "klopt"."purchase_invoices" ADD CONSTRAINT "purchase_invoices_totals"
	CHECK ("net_minor_units" + "tax_minor_units" = "total_minor_units");--> statement-breakpoint
-- Anything past draft has an entry and says who booked it; a draft has neither.
ALTER TABLE "klopt"."purchase_invoices" ADD CONSTRAINT "purchase_invoices_booked_is_complete"
	CHECK (
		("status" IN ('draft', 'cancelled'))
		OR ("journal_entry_id" IS NOT NULL AND "booked_by" IS NOT NULL)
	);--> statement-breakpoint
-- An approval is a person and a moment, or it is neither.
ALTER TABLE "klopt"."purchase_invoices" ADD CONSTRAINT "purchase_invoices_approval_complete"
	CHECK (("approved_by" IS NULL) = ("approved_at" IS NULL));--> statement-breakpoint

CREATE TABLE "klopt"."purchase_invoice_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"description" text NOT NULL,
	-- Where the cost lands. No quantity or unit price: on a purchase invoice you
	-- code an amount to an account, and inventing a quantity to fill a column
	-- would be inventing data the document does not have.
	"account_id" uuid NOT NULL,
	"tax_code_id" uuid NOT NULL,
	"net_minor_units" bigint NOT NULL,
	-- The VAT the supplier charged on this line. Zero under a reverse charge.
	"tax_minor_units" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "klopt"."purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_entity_id_entities_id_fk"
	FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_invoice_id_purchase_invoices_id_fk"
	FOREIGN KEY ("invoice_id") REFERENCES "klopt"."purchase_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_account_id_accounts_id_fk"
	FOREIGN KEY ("account_id") REFERENCES "klopt"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_tax_code_id_tax_codes_id_fk"
	FOREIGN KEY ("tax_code_id") REFERENCES "klopt"."tax_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_number"
	UNIQUE("invoice_id","line_number");--> statement-breakpoint

-- A bank payment allocates against a purchase invoice, exactly as a receipt
-- allocates against a sales invoice. Separate table rather than a nullable
-- column on the sales one: a transaction allocating to both would be
-- expressible and meaningless.
CREATE TABLE "klopt"."purchase_invoice_allocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	-- Unsigned: the direction is the transaction's.
	"amount_minor_units" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "klopt"."purchase_invoice_allocations" ADD CONSTRAINT "purchase_allocations_entity_id_entities_id_fk"
	FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."purchase_invoice_allocations" ADD CONSTRAINT "purchase_allocations_transaction_id_fk"
	FOREIGN KEY ("transaction_id") REFERENCES "klopt"."bank_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."purchase_invoice_allocations" ADD CONSTRAINT "purchase_allocations_invoice_id_fk"
	FOREIGN KEY ("invoice_id") REFERENCES "klopt"."purchase_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."purchase_invoice_allocations" ADD CONSTRAINT "purchase_allocations_unique"
	UNIQUE("transaction_id","invoice_id");--> statement-breakpoint
CREATE INDEX "purchase_allocations_invoice" ON "klopt"."purchase_invoice_allocations" ("invoice_id");--> statement-breakpoint
ALTER TABLE "klopt"."purchase_invoice_allocations" ADD CONSTRAINT "purchase_allocations_positive"
	CHECK ("amount_minor_units" > 0);--> statement-breakpoint

-- Which purchase invoices a payment instruction settles. A batch line can pay
-- several invoices at once, which is what a supplier statement run does.
CREATE TABLE "klopt"."payment_instruction_invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"instruction_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_minor_units" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "klopt"."payment_instruction_invoices" ADD CONSTRAINT "payment_instruction_invoices_entity_fk"
	FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."payment_instruction_invoices" ADD CONSTRAINT "payment_instruction_invoices_instruction_fk"
	FOREIGN KEY ("instruction_id") REFERENCES "klopt"."payment_instructions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."payment_instruction_invoices" ADD CONSTRAINT "payment_instruction_invoices_invoice_fk"
	FOREIGN KEY ("invoice_id") REFERENCES "klopt"."purchase_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."payment_instruction_invoices" ADD CONSTRAINT "payment_instruction_invoices_unique"
	UNIQUE("instruction_id","invoice_id");--> statement-breakpoint
CREATE INDEX "payment_instruction_invoices_invoice" ON "klopt"."payment_instruction_invoices" ("invoice_id");--> statement-breakpoint
ALTER TABLE "klopt"."payment_instruction_invoices" ADD CONSTRAINT "payment_instruction_invoices_positive"
	CHECK ("amount_minor_units" > 0);
