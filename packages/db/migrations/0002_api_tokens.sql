-- Scoped API tokens (spec 14).
--
-- "Scoped API tokens with expiry, per-entity and per-permission, so the
-- accountant gets read plus export and nothing more."
--
-- Only the SHA-256 of a token is stored. A database dump therefore does not
-- hand anyone a working credential, and a lost token cannot be recovered — only
-- reissued, which is the correct behaviour.

CREATE TABLE "klopt"."api_tokens" (
  "id"           uuid PRIMARY KEY,
  "entity_id"    uuid NOT NULL REFERENCES "klopt"."entities"("id"),
  "name"         text NOT NULL,
  "token_hash"   char(64) NOT NULL UNIQUE,
  -- Enough of the token to identify it in a list, never enough to use it.
  "token_prefix" text NOT NULL,
  "permissions"  text[] NOT NULL,
  -- 'human' for a personal access token, 'script' for an integration, 'agent'
  -- for an LLM. The audit log keeps them apart, because "an AI did it" is not
  -- an answer an inspector accepts (spec 10.3).
  "actor_kind"   "klopt"."actor_kind" NOT NULL,
  "actor_id"     text NOT NULL,
  -- For an agent token, the human whose authority it borrows.
  "principal_id" text,
  "expires_at"   timestamptz,
  "revoked_at"   timestamptz,
  "last_used_at" timestamptz,
  "created_at"   timestamptz NOT NULL DEFAULT now()
);

--> statement-breakpoint

CREATE INDEX "api_tokens_entity" ON "klopt"."api_tokens" ("entity_id");

--> statement-breakpoint

-- An agent token without a principal is an unattributable action.
ALTER TABLE "klopt"."api_tokens"
  ADD CONSTRAINT "api_tokens_agent_has_principal"
  CHECK ("actor_kind" <> 'agent' OR "principal_id" IS NOT NULL);
