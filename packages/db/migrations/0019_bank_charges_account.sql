-- Which account bank charges are split off to (spec 7.4).

-- `4900` was hard-coded in the matching handler with a comment saying it wanted
-- to be a setting. A firm that brings its own chart is exactly the case
-- reference-data/charts/ exists for, and for them the guess is wrong — charge
-- splitting was simply never offered, silently, with no way to say otherwise.
--
-- The guess moves here, where it is a defensible default for the chart we ship
-- rather than an assumption made on every request.
ALTER TABLE "klopt"."entities" ADD COLUMN "bank_charges_account_number" text;--> statement-breakpoint

-- Every administration on the shipped Dutch chart keeps the behaviour it had.
-- One that never had a 4900 is left null, which is the same "not offered" as
-- before — but now it is visible in Instellingen and can be set.
UPDATE "klopt"."entities" e
SET "bank_charges_account_number" = '4900'
WHERE EXISTS (
  SELECT 1 FROM "klopt"."accounts" a
  WHERE a."entity_id" = e."id" AND a."number" = '4900'
);
