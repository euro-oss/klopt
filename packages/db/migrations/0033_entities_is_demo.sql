-- Demo administrations (issue #48).
--
-- A boolean rather than a separate table: the seeder, the entity picker and the
-- banner all need to know the same fact, and a flag on the row is the one place
-- that cannot drift from the books it marks.
ALTER TABLE "klopt"."entities" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- One demo administration per instance. The seeder is idempotent by looking
-- this up; the unique index is what keeps a second run from inventing another.
CREATE UNIQUE INDEX "entities_one_demo" ON "klopt"."entities" USING btree ("is_demo") WHERE "is_demo" = true;
