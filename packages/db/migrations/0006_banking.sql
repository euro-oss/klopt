-- Banking (spec 7.4).
--
-- A transaction is a fact about the bank; a journal entry is a fact about the
-- books. They are linked, never merged: a matched statement line still says
-- exactly what the bank said, because the bank is the authority on its own
-- statement and unmatching must not require reconstructing it.
--
-- The unique index on (bank_account_id, dedupe_key) is the whole of
-- deduplication. A re-imported file conflicts row by row rather than being
-- detected as a file, which is what makes a partial re-import safe.

CREATE TYPE "klopt"."bank_transaction_status" AS ENUM('unmatched', 'matched', 'ignored');--> statement-breakpoint
CREATE TABLE "klopt"."bank_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"iban" text NOT NULL,
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"name" text NOT NULL,
	"ledger_account_id" uuid,
	"last_sequence_number" integer,
	"feed_provider" text DEFAULT 'file' NOT NULL,
	"feed_cursor" text,
	"consent_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_accounts_entity_iban" UNIQUE("entity_id","iban")
);
--> statement-breakpoint
CREATE TABLE "klopt"."bank_statements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"format" text NOT NULL,
	"external_id" text,
	"sequence_number" integer,
	"opening_balance_minor_units" bigint NOT NULL,
	"closing_balance_minor_units" bigint NOT NULL,
	"opening_date" date NOT NULL,
	"closing_date" date NOT NULL,
	"source_hash" char(64),
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_statements_dates" CHECK ("klopt"."bank_statements"."closing_date" >= "klopt"."bank_statements"."opening_date")
);
--> statement-breakpoint
CREATE TABLE "klopt"."bank_transactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"statement_id" uuid,
	"dedupe_key" text NOT NULL,
	"amount_minor_units" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"booking_date" date NOT NULL,
	"value_date" date NOT NULL,
	"bank_reference" text,
	"end_to_end_id" text,
	"counterparty_name" text,
	"counterparty_iban" text,
	"description" text DEFAULT '' NOT NULL,
	"remittance_reference" text,
	"transaction_code" text,
	"raw" text,
	"status" "klopt"."bank_transaction_status" DEFAULT 'unmatched' NOT NULL,
	"journal_entry_id" uuid,
	"matched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_transactions_dedupe" UNIQUE("bank_account_id","dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "klopt"."bank_accounts" ADD CONSTRAINT "bank_accounts_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."bank_accounts" ADD CONSTRAINT "bank_accounts_ledger_account_id_accounts_id_fk" FOREIGN KEY ("ledger_account_id") REFERENCES "klopt"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."bank_statements" ADD CONSTRAINT "bank_statements_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."bank_statements" ADD CONSTRAINT "bank_statements_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "klopt"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."bank_transactions" ADD CONSTRAINT "bank_transactions_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."bank_transactions" ADD CONSTRAINT "bank_transactions_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "klopt"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."bank_transactions" ADD CONSTRAINT "bank_transactions_statement_id_bank_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "klopt"."bank_statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."bank_transactions" ADD CONSTRAINT "bank_transactions_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "klopt"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_statements_account" ON "klopt"."bank_statements" USING btree ("bank_account_id","closing_date");--> statement-breakpoint
CREATE INDEX "bank_transactions_queue" ON "klopt"."bank_transactions" USING btree ("entity_id","status","booking_date");--> statement-breakpoint
CREATE INDEX "bank_transactions_counterparty" ON "klopt"."bank_transactions" USING btree ("entity_id","counterparty_iban");