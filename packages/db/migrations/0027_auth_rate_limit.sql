-- Rate limiting that survives a restart (spec 14).
--
-- better-auth rate-limits by default, in production only, holding the counters
-- in process memory. Both halves of that are wrong for this system.
--
-- In memory means a deploy resets every counter, so the limit is only as long
-- as the uptime; and it means two replicas enforce two separate limits, so the
-- effective allowance is whatever the operator happened to scale to. Neither
-- is a property anybody chose.
--
-- Production only means the behaviour under test is not the behaviour shipped,
-- which for a security control is the same as not having tested it.
--
-- So the counters live here. One row per key — better-auth composes the key
-- from the client address and the path — holding a count and when the window
-- last moved.

create table klopt.auth_rate_limit (
  -- Text rather than uuid: better-auth generates the id, as with its other
  -- tables, and overriding that everywhere buys nothing.
  id text primary key,
  key text not null,
  count integer not null default 0,
  -- Epoch milliseconds, which is what better-auth reads and writes. Not a
  -- timestamptz: the library compares it arithmetically against Date.now().
  last_request bigint not null
);

create unique index auth_rate_limit_key on klopt.auth_rate_limit (key);
