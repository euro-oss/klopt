-- Invitations: a membership waiting for an account to attach to.
--
-- Keyed by email rather than user id, because the person being invited usually
-- has no account yet -- and when the only credential is a code sent to an
-- address, the address is the identity. See docs/decisions/0015.

CREATE TABLE "klopt"."entity_invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"invited_by_user_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"accepted_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "klopt"."entity_invitations" ADD CONSTRAINT "entity_invitations_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."entity_invitations" ADD CONSTRAINT "entity_invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "klopt"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."entity_invitations" ADD CONSTRAINT "entity_invitations_accepted_user_id_users_id_fk" FOREIGN KEY ("accepted_user_id") REFERENCES "klopt"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "entity_invitations_pending" ON "klopt"."entity_invitations" USING btree ("entity_id","email") WHERE accepted_at is null and revoked_at is null;--> statement-breakpoint
CREATE INDEX "entity_invitations_email" ON "klopt"."entity_invitations" USING btree ("email");