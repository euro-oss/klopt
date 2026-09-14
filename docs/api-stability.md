# What this project promises about its API

Klopt is meant to be built on. Spec 10 says the UI is optional and that REST,
MCP and the CLI are three surfaces over one core; spec 15's M6 asks for a
public API stability commitment, so that an ecosystem is possible.

This is that commitment. It is deliberately narrow: a promise nobody can keep
is worse than a small one kept exactly.

## Where to read it

`GET /api/v1/openapi.json`, from any instance, without a token. The same
document is checked in at [`openapi.json`](openapi.json), so a change to
anything promised below arrives as a diff in a pull request rather than as a
surprise in somebody's client.

It is generated — from the route manifest, the operation registry and the Zod
schemas the routes validate against — and a test refuses a stale copy. Nothing
in it is written twice, which is the only reason it can be trusted. See ADR
0043 for what it does and does not yet describe.

## What is public

Three things, and nothing else:

1. **`/api/v1/*`** — the routes in `apps/web/src/api/manifest.ts`, their request
   and response shapes, and their error codes.
2. **The event catalogue** — the names in `EVENT_TYPES`
   (`packages/core/src/events/catalogue.ts`), their versions, and the shape of
   what `/api/v1/events` returns.
3. **Permission names** — the values in `PERMISSIONS`, because an integrator
   asks for a token scoped to them.

Everything else is internal and may change in any release: table names, column
names, the TypeScript packages, MCP tool names, the audit log's `action`
strings, the contents of the UI's message catalogues.

If you find yourself reading `klopt.sales_invoices` directly, you are outside
the promise. Read the API — and if the API cannot tell you what the table can,
that is a bug worth reporting.

## What will not change inside `v1`

- **A route will not be removed**, and its path will not change.
- **A field will not be removed from a response**, and its type will not
  change. Fields are added; a consumer must ignore ones it does not know.
- **A required request field will not be added**, and no existing optional
  field becomes required.
- **An error code will not be repurposed.** `validation_failed` will always
  mean what it means now. New codes appear; a consumer must treat an unknown
  code as a generic failure of that HTTP status rather than crashing.
- **An event type will not be removed or renamed**, and it will not start
  meaning something else. If the meaning has to change, a new type appears
  alongside and both are emitted for at least one minor release.
- **A permission will not silently widen.** A token that could read cannot
  quietly gain the ability to write.

## What may change without notice

- **Ordering**, unless documented. Lists that promise an order say so; `/events`
  is ascending by id and always will be, because resuming depends on it.
- **Pagination sizes** and default limits.
- **Anything behind `agentExposure: 'none'`.** Those operations exist for the
  UI and are not part of the promise.
- **Prose.** Human-readable messages are for humans; branch on the code.

## How a breaking change would happen

`/api/v2`, running alongside `v1`. Not a flag day. `v1` would be supported for
at least twelve months after `v2` is announced, and the deprecation would be
visible in three places at once: the release notes, a `Deprecation` header on
the affected routes, and this file.

There is no `v2` planned. This section exists so that the answer is written
down before anybody needs it, rather than decided under pressure.

## Idempotency, concurrency and retries

- **Every write takes an `Idempotency-Key`**, and it is required rather than
  advisory — enforced by a contract test that fails the build if a `write`
  operation is not declared idempotent. Retrying a posting will never
  double-post. This is not a courtesy; in a ledger it is the difference between
  a system you can automate against and one you cannot.
- **The event stream is at-least-once.** An event may arrive twice. Its `id` is
  the dedup key, and it is monotonic, so "have I seen this?" is a comparison
  rather than a set lookup.
- **Events are thin.** An event says what happened and to what, never carrying
  the resource. Fetch it if you want it, with your own token. The reasoning is
  in `EVENT_TYPES`, and the part that matters most is that it keeps personal
  data out of payloads that get retried into other people's logs.

## Versioning of the events themselves

The version is on the event, not on the endpoint:

```json
{ "id": "…", "type": "sales.invoice.issued", "version": 1, "resource": { … } }
```

A consumer that understands version 1 keeps working when version 2 appears
next to it. Because the shape is a reference rather than a payload, a version
bump means the _meaning_ changed — "issued" coming to include something it did
not before — which is precisely the case where silently reinterpreting it
would be wrong.

## This document is not a guess

Everything above is either enforced by a test today or is a statement about
what maintainers will do. Where it is the first, the test is named:

| Promise                                    | Enforced by                             |
| ------------------------------------------ | --------------------------------------- |
| Every operation has exactly one route      | `apps/web/test/contract.test.ts`        |
| Every write is idempotent                  | `apps/web/test/contract.test.ts`        |
| No route exists outside the contract       | `apps/web/test/contract.test.ts`        |
| The document describes the real schemas    | `apps/web/test/contract.test.ts`        |
| The document is valid OpenAPI 3.1          | `apps/web/test/openapi.test.ts`         |
| It accepts exactly what the API accepts    | `apps/web/test/openapi.test.ts`         |
| The checked-in copy is current             | `apps/web/test/openapi.test.ts`         |
| Events survive only committed changes      | `apps/web/test/events.test.ts`          |
| The stream resumes without gaps or repeats | `apps/web/test/events.test.ts`          |
| Permissions do not widen by role           | `packages/core/test/auth/roles.test.ts` |

The rest is a promise made by people, which is the only kind there is.
