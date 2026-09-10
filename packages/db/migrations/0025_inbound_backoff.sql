-- Backing off a mailbox that keeps refusing (spec 8).
--
-- Every enabled source was polled every five minutes regardless of how it went
-- last time. A mailbox with an expired password therefore produced two hundred
-- and eighty-eight identical warnings a day, and a drop directory that no
-- longer exists produced them forever — burying the one source that had
-- actually broken this morning.
--
-- Retrying is right; retrying at full volume is not.

alter table klopt.inbound_sources
  add column consecutive_failures integer not null default 0,
  -- When it is worth trying again. Null means "on the ordinary schedule",
  -- which is what a source that last succeeded gets.
  add column next_poll_after timestamptz;

-- `inbound_sources_due` is taken: 0018 created one on (enabled, last_polled_at).
-- Named for what this one is actually for.
create index inbound_sources_backoff on klopt.inbound_sources (enabled, next_poll_after);
