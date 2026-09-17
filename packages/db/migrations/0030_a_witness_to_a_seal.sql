-- A seal that only this instance holds proves that *we* say nothing changed
-- (spec 7.6). An RFC 3161 authority signs "I saw this hash at this time", and
-- these five columns are what it said.
--
-- All nullable, and the default install has no authority configured: a seal
-- without a witness is still a seal, and `timestamp_reason` says why there is
-- none rather than leaving a null that could mean "not asked" or "asked and
-- refused".
ALTER TABLE "klopt"."sealed_snapshots"
  ADD COLUMN "timestamp_authority" text,
  ADD COLUMN "timestamp_token" text,
  ADD COLUMN "timestamp_at" timestamptz,
  ADD COLUMN "timestamp_serial" text,
  ADD COLUMN "timestamp_reason" text;

-- A token is only evidence about a seal if it attests to that seal. Stored
-- rows are checked at write time; this is the guard that survives a code path
-- nobody has written yet.
ALTER TABLE "klopt"."sealed_snapshots"
  ADD CONSTRAINT "sealed_snapshots_timestamp_shape"
  CHECK (
    ("timestamp_token" IS NULL AND "timestamp_at" IS NULL AND "timestamp_serial" IS NULL)
    OR ("timestamp_token" IS NOT NULL AND "timestamp_at" IS NOT NULL AND "timestamp_authority" IS NOT NULL)
  );
