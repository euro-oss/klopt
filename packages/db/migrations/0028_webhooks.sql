-- Webhooks off the transactional outbox (spec 10.2).
--
-- > Webhooks from the transactional outbox: signed payloads, at-least-once
-- > with dedup ids, retries with backoff, and a replay endpoint.
--
-- ## One cursor per endpoint, not one row per event per endpoint
--
-- The obvious design gives every (endpoint, event) pair a delivery row and a
-- state machine. For a ledger that is the wrong shape: it turns a stream into
-- a work queue, and a work queue delivers out of order the moment one item
-- retries while the next succeeds.
--
-- An integration that learns an invoice was sent before it learns it was
-- issued has to cope with a world where effects precede causes, and most do
-- not. So each endpoint holds a cursor into the outbox and moves it forward
-- only on success. Delivery is ordered, at-least-once, and resumable.
--
-- The cost is that one poisonous event blocks the endpoint behind it. That is
-- deliberate, and it is why `consecutive_failures` and `disabled_reason`
-- exist: after enough attempts the endpoint is switched off *loudly* rather
-- than falling further and further behind in silence.

create table klopt.webhook_endpoints (
  id uuid primary key,
  entity_id uuid not null references klopt.entities(id),
  url text not null,
  -- Encrypted with KLOPT_ENCRYPTION_KEY, like every other credential here.
  -- Shown to the operator once, at creation, and never again.
  secret text not null,
  /*
    Which event types to send. Empty means all of them — including ones added
    after the endpoint was created, which is the behaviour somebody who left it
    empty is asking for.
  */
  event_types text[] not null default '{}',
  enabled boolean not null default true,

  /*
    The last event successfully delivered. Null means "from the beginning",
    which is what a new endpoint gets: an integration that has just been
    connected wants the history, not only what happens next.
  */
  cursor uuid,

  consecutive_failures integer not null default 0,
  -- When it is worth trying again. Null means "on the ordinary schedule".
  next_attempt_after timestamptz,
  -- Why it was switched off, in words an operator can act on.
  disabled_reason text,

  last_attempt_at timestamptz,
  last_success_at timestamptz,
  created_at timestamptz not null default now()
);

create index webhook_endpoints_due
  on klopt.webhook_endpoints (enabled, next_attempt_after);

/*
  What was attempted, kept for evidence rather than for control flow.

  The cursor above is the state machine; this is the log an operator reads when
  an integrator says "we never got it". Bounded by pruning, not by being
  clever: a row per attempt is cheap and the questions asked of it are recent.
*/
create table klopt.webhook_deliveries (
  id uuid primary key,
  entity_id uuid not null references klopt.entities(id),
  endpoint_id uuid not null references klopt.webhook_endpoints(id) on delete cascade,
  event_id uuid not null references klopt.outbox(id),
  attempt integer not null,
  -- Null when the request never got a reply at all.
  response_status integer,
  error text,
  duration_ms integer not null,
  at timestamptz not null default now()
);

create index webhook_deliveries_endpoint on klopt.webhook_deliveries (endpoint_id, at desc);
