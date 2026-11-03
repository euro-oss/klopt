-- Legal acceptance and privacy-notice records for hosted sign-up (issue #138).
--
-- Two kinds of row in one table:
--
--   terms_dpa       — Setup checkbox: who agreed, when, which terms and DPA
--                     versions (KLOPT_TERMS_* / KLOPT_DPA_*).
--   privacy_notice  — Invitee's first sign-in: who was shown the privacy
--                     notice, when, which privacy version (KLOPT_PRIVACY_*).
--                     At most one per user.
--
-- Self-hosted leaves those env vars unset and never writes here.
--
-- Additive only. Rollback: DROP TABLE "klopt"."legal_acceptances";

CREATE TABLE "klopt"."legal_acceptances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"terms_version" text,
	"dpa_version" text,
	"privacy_version" text,
	CONSTRAINT "legal_acceptances_kind_check" CHECK (
		(
			"kind" = 'terms_dpa'
			AND "terms_version" IS NOT NULL
			AND "dpa_version" IS NOT NULL
		)
		OR (
			"kind" = 'privacy_notice'
			AND "privacy_version" IS NOT NULL
		)
	)
);--> statement-breakpoint

ALTER TABLE "klopt"."legal_acceptances"
	ADD CONSTRAINT "legal_acceptances_user_id_users_id_fk"
	FOREIGN KEY ("user_id") REFERENCES "klopt"."users"("id")
	ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "legal_acceptances_user" ON "klopt"."legal_acceptances" USING btree ("user_id");--> statement-breakpoint

-- Invitee privacy notice is shown once; a second row would be a bug.
CREATE UNIQUE INDEX "legal_acceptances_one_privacy"
	ON "klopt"."legal_acceptances" USING btree ("user_id")
	WHERE "kind" = 'privacy_notice';
