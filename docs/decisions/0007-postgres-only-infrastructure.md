# 0007. Postgres is the queue, the search index and the cache

Status: Accepted
Date: 2026-09-04

## Context

Principle 5: a working install is one application container, Postgres, and
S3-compatible storage. Nothing else. Every additional service is a self-hosting
tax, and self-hosting completeness is the product's pitch.

## Decision

- Jobs and scheduling: pg-boss, in the `klopt_jobs` schema.
- Search: Postgres full-text.
- Cache: Postgres, or nothing. Most of what would be cached should instead be an
  incrementally maintained period balance (requirement 12).
- The transactional outbox (requirement 9.3) is a Postgres table written in the
  same transaction as the state change it describes. This is the reason not to
  reach for a broker: the outbox pattern only gives its guarantee when the event
  and the state change share a transaction.

No Redis, no Kafka, no Elasticsearch.

## Consequences

- A ceiling exists. Postgres full-text will not do fuzzy multilingual search
  well, and pg-boss is not Kafka. The scale target is 5 million journal lines
  per entity, and Postgres is comfortable there.
- When something does need to be swapped, it should be swapped behind a port so
  that a hosted deployment can use a different implementation without the
  self-hosted install growing a dependency.
