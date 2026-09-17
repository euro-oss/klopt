-- Who submitted and approved a batch is an *actor id*, not a user id.
--
-- No foreign key, for the same reason audit_log.actor_id has none: an actor is
-- not always a row in users. A scoped API token carries its own actor id, and a
-- human working through the API is a legitimate caller -- so the foreign key
-- turned "submit this batch with a token" into a 500, which is what it did
-- until an HTTP walk-through found it.

ALTER TABLE "klopt"."payment_batches" DROP CONSTRAINT "payment_batches_submitted_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "klopt"."payment_batches" DROP CONSTRAINT "payment_batches_approved_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "klopt"."payment_batches" DROP CONSTRAINT "payment_batches_rejected_by_users_id_fk";
