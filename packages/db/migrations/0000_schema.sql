CREATE SCHEMA "klopt";
--> statement-breakpoint
CREATE TYPE "klopt"."account_type" AS ENUM('asset', 'liability', 'equity', 'revenue', 'expense');--> statement-breakpoint
CREATE TYPE "klopt"."actor_kind" AS ENUM('human', 'script', 'agent');--> statement-breakpoint
CREATE TYPE "klopt"."fiscal_year_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "klopt"."journal_type" AS ENUM('memoriaal', 'verkoop', 'inkoop', 'bank', 'kas');--> statement-breakpoint
CREATE TYPE "klopt"."normal_balance" AS ENUM('debit', 'credit');--> statement-breakpoint
CREATE TYPE "klopt"."period_status" AS ENUM('open', 'soft_closed', 'hard_closed');--> statement-breakpoint
CREATE TYPE "klopt"."subledger_kind" AS ENUM('customer', 'supplier', 'asset', 'project');--> statement-breakpoint
CREATE TYPE "klopt"."vat_rounding_policy" AS ENUM('per_invoice', 'per_line');--> statement-breakpoint
CREATE TABLE "klopt"."account_dimension_requirements" (
	"account_id" uuid NOT NULL,
	"dimension_type_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	CONSTRAINT "account_dimension_requirements_account_id_dimension_type_id_pk" PRIMARY KEY("account_id","dimension_type_id")
);
--> statement-breakpoint
CREATE TABLE "klopt"."account_period_balances" (
	"entity_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"currency" char(3) NOT NULL,
	"debit_minor_units" bigint DEFAULT 0 NOT NULL,
	"credit_minor_units" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "account_period_balances_entity_id_account_id_period_id_currency_pk" PRIMARY KEY("entity_id","account_id","period_id","currency")
);
--> statement-breakpoint
CREATE TABLE "klopt"."accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"number" text NOT NULL,
	"name" text NOT NULL,
	"type" "klopt"."account_type" NOT NULL,
	"normal_balance" "klopt"."normal_balance" NOT NULL,
	"rgs_code" text,
	"is_blocked" boolean DEFAULT false NOT NULL,
	"default_tax_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_entity_number" UNIQUE("entity_id","number")
);
--> statement-breakpoint
CREATE TABLE "klopt"."api_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" char(64) NOT NULL,
	"token_prefix" text NOT NULL,
	"permissions" text[] NOT NULL,
	"actor_kind" "klopt"."actor_kind" NOT NULL,
	"actor_id" text NOT NULL,
	"principal_id" text,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "klopt"."audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_kind" "klopt"."actor_kind" NOT NULL,
	"actor_id" text NOT NULL,
	"actor_principal_id" text,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"request_id" text,
	"ip" text
);
--> statement-breakpoint
CREATE TABLE "klopt"."dimension_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dimension_types_entity_code" UNIQUE("entity_id","code")
);
--> statement-breakpoint
CREATE TABLE "klopt"."dimension_values" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"dimension_type_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_blocked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dimension_values_type_code" UNIQUE("dimension_type_id","code")
);
--> statement-breakpoint
CREATE TABLE "klopt"."entities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"legal_name" text NOT NULL,
	"kvk_number" text,
	"vat_number" text,
	"functional_currency" char(3) DEFAULT 'EUR' NOT NULL,
	"fiscal_year_start_month" smallint DEFAULT 1 NOT NULL,
	"rgs_version" text,
	"rgs_variant" text DEFAULT 'mkb' NOT NULL,
	"vat_rounding" "klopt"."vat_rounding_policy" DEFAULT 'per_invoice' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entities_fiscal_year_start_month_range" CHECK ("klopt"."entities"."fiscal_year_start_month" between 1 and 12)
);
--> statement-breakpoint
CREATE TABLE "klopt"."fiscal_years" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"code" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"status" "klopt"."fiscal_year_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_years_entity_code" UNIQUE("entity_id","code"),
	CONSTRAINT "fiscal_years_range" CHECK ("klopt"."fiscal_years"."ends_on" > "klopt"."fiscal_years"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "klopt"."idempotency_keys" (
	"entity_id" uuid NOT NULL,
	"key" text NOT NULL,
	"operation_id" text NOT NULL,
	"request_hash" char(64) NOT NULL,
	"result_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_entity_id_key_pk" PRIMARY KEY("entity_id","key")
);
--> statement-breakpoint
CREATE TABLE "klopt"."journal_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"journal_id" uuid NOT NULL,
	"fiscal_year_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"entry_number" bigint NOT NULL,
	"chain_sequence" bigint NOT NULL,
	"booking_date" date NOT NULL,
	"document_date" date NOT NULL,
	"description" text NOT NULL,
	"source_document_ref" text,
	"reverses_entry_id" uuid,
	"functional_currency" char(3) NOT NULL,
	"actor_kind" "klopt"."actor_kind" NOT NULL,
	"actor_id" text NOT NULL,
	"actor_principal_id" text,
	"previous_hash" char(64),
	"hash" char(64) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "journal_entries_entity_chain" UNIQUE("entity_id","chain_sequence"),
	CONSTRAINT "journal_entries_number" UNIQUE("entity_id","journal_id","fiscal_year_id","entry_number")
);
--> statement-breakpoint
CREATE TABLE "klopt"."journal_line_dimensions" (
	"line_id" uuid NOT NULL,
	"dimension_type_id" uuid NOT NULL,
	"dimension_value_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	CONSTRAINT "journal_line_dimensions_line_id_dimension_type_id_pk" PRIMARY KEY("line_id","dimension_type_id")
);
--> statement-breakpoint
CREATE TABLE "klopt"."journal_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"account_id" uuid NOT NULL,
	"description" text,
	"debit_minor_units" bigint NOT NULL,
	"credit_minor_units" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"functional_debit_minor_units" bigint NOT NULL,
	"functional_credit_minor_units" bigint NOT NULL,
	"exchange_rate" numeric(24, 12),
	"exchange_rate_source" text,
	"tax_code" text,
	"tax_minor_units" bigint,
	"subledger_kind" "klopt"."subledger_kind",
	"subledger_id" uuid,
	"period_id" uuid NOT NULL,
	CONSTRAINT "journal_lines_entry_line" UNIQUE("entry_id","line_number"),
	CONSTRAINT "journal_lines_single_side" CHECK (("klopt"."journal_lines"."debit_minor_units" = 0) <> ("klopt"."journal_lines"."credit_minor_units" = 0)),
	CONSTRAINT "journal_lines_unsigned" CHECK ("klopt"."journal_lines"."debit_minor_units" >= 0 and "klopt"."journal_lines"."credit_minor_units" >= 0),
	CONSTRAINT "journal_lines_rate_pairing" CHECK (("klopt"."journal_lines"."exchange_rate" is null) = ("klopt"."journal_lines"."exchange_rate_source" is null)),
	CONSTRAINT "journal_lines_subledger_pairing" CHECK (("klopt"."journal_lines"."subledger_kind" is null) = ("klopt"."journal_lines"."subledger_id" is null))
);
--> statement-breakpoint
CREATE TABLE "klopt"."journals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" "klopt"."journal_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journals_entity_code" UNIQUE("entity_id","code")
);
--> statement-breakpoint
CREATE TABLE "klopt"."number_sequences" (
	"entity_id" uuid NOT NULL,
	"document_type" text NOT NULL,
	"fiscal_year_code" text NOT NULL,
	"next_value" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "number_sequences_entity_id_document_type_fiscal_year_code_pk" PRIMARY KEY("entity_id","document_type","fiscal_year_code")
);
--> statement-breakpoint
CREATE TABLE "klopt"."outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"type" text NOT NULL,
	"version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "klopt"."periods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"fiscal_year_id" uuid NOT NULL,
	"sequence" smallint NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"status" "klopt"."period_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "periods_year_sequence" UNIQUE("fiscal_year_id","sequence"),
	CONSTRAINT "periods_range" CHECK ("klopt"."periods"."ends_on" >= "klopt"."periods"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "klopt"."year_closes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"fiscal_year_id" uuid NOT NULL,
	"appropriation_entry_id" uuid,
	"opening_entry_id" uuid,
	"result_minor_units" bigint NOT NULL,
	"result_currency" char(3) NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_by" text NOT NULL,
	"reversed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "klopt"."auth_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"issuer" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "klopt"."entity_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_members_unique" UNIQUE("entity_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "klopt"."sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"active_entity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "klopt"."users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "klopt"."verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "klopt"."account_dimension_requirements" ADD CONSTRAINT "account_dimension_requirements_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "klopt"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."account_dimension_requirements" ADD CONSTRAINT "account_dimension_requirements_dimension_type_id_dimension_types_id_fk" FOREIGN KEY ("dimension_type_id") REFERENCES "klopt"."dimension_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."account_dimension_requirements" ADD CONSTRAINT "account_dimension_requirements_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."account_period_balances" ADD CONSTRAINT "account_period_balances_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."account_period_balances" ADD CONSTRAINT "account_period_balances_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "klopt"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."account_period_balances" ADD CONSTRAINT "account_period_balances_period_id_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "klopt"."periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."accounts" ADD CONSTRAINT "accounts_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."api_tokens" ADD CONSTRAINT "api_tokens_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."audit_log" ADD CONSTRAINT "audit_log_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."dimension_types" ADD CONSTRAINT "dimension_types_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."dimension_values" ADD CONSTRAINT "dimension_values_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."dimension_values" ADD CONSTRAINT "dimension_values_dimension_type_id_dimension_types_id_fk" FOREIGN KEY ("dimension_type_id") REFERENCES "klopt"."dimension_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."fiscal_years" ADD CONSTRAINT "fiscal_years_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."idempotency_keys" ADD CONSTRAINT "idempotency_keys_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."journal_entries" ADD CONSTRAINT "journal_entries_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."journal_entries" ADD CONSTRAINT "journal_entries_journal_id_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "klopt"."journals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."journal_entries" ADD CONSTRAINT "journal_entries_fiscal_year_id_fiscal_years_id_fk" FOREIGN KEY ("fiscal_year_id") REFERENCES "klopt"."fiscal_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."journal_entries" ADD CONSTRAINT "journal_entries_period_id_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "klopt"."periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."journal_line_dimensions" ADD CONSTRAINT "journal_line_dimensions_line_id_journal_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "klopt"."journal_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."journal_line_dimensions" ADD CONSTRAINT "journal_line_dimensions_dimension_type_id_dimension_types_id_fk" FOREIGN KEY ("dimension_type_id") REFERENCES "klopt"."dimension_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."journal_line_dimensions" ADD CONSTRAINT "journal_line_dimensions_dimension_value_id_dimension_values_id_fk" FOREIGN KEY ("dimension_value_id") REFERENCES "klopt"."dimension_values"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."journal_line_dimensions" ADD CONSTRAINT "journal_line_dimensions_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."journal_line_dimensions" ADD CONSTRAINT "journal_line_dimensions_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "klopt"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."journal_lines" ADD CONSTRAINT "journal_lines_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."journal_lines" ADD CONSTRAINT "journal_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "klopt"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."journal_lines" ADD CONSTRAINT "journal_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "klopt"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."journal_lines" ADD CONSTRAINT "journal_lines_period_id_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "klopt"."periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."journals" ADD CONSTRAINT "journals_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."number_sequences" ADD CONSTRAINT "number_sequences_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."outbox" ADD CONSTRAINT "outbox_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."periods" ADD CONSTRAINT "periods_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."periods" ADD CONSTRAINT "periods_fiscal_year_id_fiscal_years_id_fk" FOREIGN KEY ("fiscal_year_id") REFERENCES "klopt"."fiscal_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."year_closes" ADD CONSTRAINT "year_closes_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."year_closes" ADD CONSTRAINT "year_closes_fiscal_year_id_fiscal_years_id_fk" FOREIGN KEY ("fiscal_year_id") REFERENCES "klopt"."fiscal_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."year_closes" ADD CONSTRAINT "year_closes_appropriation_entry_id_journal_entries_id_fk" FOREIGN KEY ("appropriation_entry_id") REFERENCES "klopt"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."year_closes" ADD CONSTRAINT "year_closes_opening_entry_id_journal_entries_id_fk" FOREIGN KEY ("opening_entry_id") REFERENCES "klopt"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "klopt"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."entity_members" ADD CONSTRAINT "entity_members_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."entity_members" ADD CONSTRAINT "entity_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "klopt"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "klopt"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."sessions" ADD CONSTRAINT "sessions_active_entity_id_entities_id_fk" FOREIGN KEY ("active_entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_entity_rgs" ON "klopt"."accounts" USING btree ("entity_id","rgs_code");--> statement-breakpoint
CREATE INDEX "api_tokens_entity" ON "klopt"."api_tokens" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_entity_time" ON "klopt"."audit_log" USING btree ("entity_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_log_resource" ON "klopt"."audit_log" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_one_reversal" ON "klopt"."journal_entries" USING btree ("entity_id","reverses_entry_id") WHERE reverses_entry_id is not null;--> statement-breakpoint
CREATE INDEX "journal_entries_period" ON "klopt"."journal_entries" USING btree ("entity_id","period_id");--> statement-breakpoint
CREATE INDEX "journal_entries_booking_date" ON "klopt"."journal_entries" USING btree ("entity_id","booking_date");--> statement-breakpoint
CREATE INDEX "journal_line_dimensions_value" ON "klopt"."journal_line_dimensions" USING btree ("entity_id","dimension_value_id");--> statement-breakpoint
CREATE INDEX "journal_lines_account_period" ON "klopt"."journal_lines" USING btree ("entity_id","account_id","period_id");--> statement-breakpoint
CREATE INDEX "journal_lines_subledger" ON "klopt"."journal_lines" USING btree ("entity_id","subledger_kind","subledger_id") WHERE subledger_id is not null;--> statement-breakpoint
CREATE INDEX "outbox_unpublished" ON "klopt"."outbox" USING btree ("occurred_at") WHERE published_at is null;--> statement-breakpoint
CREATE INDEX "periods_entity_dates" ON "klopt"."periods" USING btree ("entity_id","starts_on","ends_on");--> statement-breakpoint
CREATE UNIQUE INDEX "year_closes_one_open_per_year" ON "klopt"."year_closes" USING btree ("fiscal_year_id") WHERE reversed_at is null;--> statement-breakpoint
CREATE INDEX "auth_accounts_user" ON "klopt"."auth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "entity_members_user" ON "klopt"."entity_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user" ON "klopt"."sessions" USING btree ("user_id");