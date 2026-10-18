-- Per-user Geavanceerd preference (issue #44 follow-up to #64).
--
-- Nullable boolean on the signed-in user:
--   NULL  → no explicit choice; derive from the role in the active administration
--   true  → user turned Geavanceerd on
--   false → user turned Geavanceerd off
--
-- Scoped to the row identified by the session user id. The application never
-- accepts a user id from the client for read or write.
--
-- Rollback: ALTER TABLE "klopt"."users" DROP COLUMN "advanced_mode";

ALTER TABLE "klopt"."users"
	ADD COLUMN "advanced_mode" boolean;
