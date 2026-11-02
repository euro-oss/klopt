-- Legal acceptance records for hosted sign-up (issue #138).
--
-- When KLOPT_TERMS_URL / KLOPT_DPA_URL (and their version env vars) are set,
-- Setup requires an unticked checkbox agreeing to the terms and the data
-- processing agreement. Ticking it writes one row: who, when, and which
-- version of each document. Self-hosted instances leave those env vars unset
-- and never write here.
--
-- Additive only. Rollback: DROP TABLE "klopt"."legal_acceptances";

CREATE TABLE "klopt"."legal_acceptances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"terms_version" text NOT NULL,
	"dpa_version" text NOT NULL
);--> statement-breakpoint

ALTER TABLE "klopt"."legal_acceptances"
	ADD CONSTRAINT "legal_acceptances_user_id_users_id_fk"
	FOREIGN KEY ("user_id") REFERENCES "klopt"."users"("id")
	ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "legal_acceptances_user" ON "klopt"."legal_acceptances" USING btree ("user_id");
