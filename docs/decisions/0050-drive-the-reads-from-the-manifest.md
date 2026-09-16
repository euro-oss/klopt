# 0050. Drive the reads from the manifest

Status: Accepted
Date: 2026-09-16

## Context

ADR 0044 derived every response schema from its handler's return type and
checked eleven of them against real output. The other hundred were left with a
note that extending the coverage was "cheap now the harness exists".

Writing a hundred more test cases by hand would not have been cheap, and it
would have had the failure mode every hand-maintained list has: the hundred and
first endpoint arrives and nobody adds the hundred and first case.

## The list already exists

Thirty-eight operations are reads, take no path parameter, and answer with
JSON. An empty administration can answer all of them, so they need no setup at
all — the only thing a test needs is the handler and, sometimes, a query.

Both are already written down. `routeManifest` says which handler each route
calls and which schema it parses; `build-response-schemas.ts` already resolves
the handler name from the route source, and importing that function means the
suite and the generator cannot disagree about which handler is being checked.

So the test loops over the manifest instead of over a list. Coverage went from
eleven to forty-five, and an endpoint added without a conformance case fails
the suite on the day it appears.

What is left is what genuinely needs setting up: a path parameter wants an id,
a write wants a body, and two Exact reads want a connection only OAuth can
make. Those are one test each, and `NEEDS_MORE_THAN_AN_EMPTY_ADMINISTRATION`
names the two exceptions with their reasons rather than catching and moving on.

## Two bugs it found immediately

Not the ones it was looking for. The loop could not call two handlers because
it could not work out what to pass them, and the reason was the same both
times: the route was not parsing its query the way every other route does.

- **`GET /api/v1/vat/periods`** built its query object by hand from
  `url.searchParams.get('year')` and then parsed _that_. The schema was right;
  the shape was unusual.
- **`GET /api/v1/purchase-invoices`** read `status` and `openOnly` straight off
  the URL with **no schema at all**. `status` reached the repository as
  whatever string was typed.

Both were invisible to `test/contract.test.ts`, which recognises
`parse(schema, searchParams(request))` and `parse(schema, await readJson(...))`
and treats anything else as a route with no request. So the OpenAPI document
omitted two query parameters, and one of them was unvalidated.

Neither is dramatic — an unknown `status` returns nothing rather than doing
harm, and Drizzle parameterises. But "this endpoint takes a filter" was missing
from the published contract, which is the thing ADR 0043 exists to prevent.

### The check that should have caught them

Fixing the two routes is the small half. The contract test now also asserts:

- **one declared schema per `parse(` call** in the route, counted however it is
  written. An unrecognised shape is no longer indistinguishable from an absent
  one.
- **a declared query for any method that reads `searchParams`**, which is what
  catches a route that reads the URL and never parses it at all.

Both fail when the declaration is removed.

## A thing the test got wrong about itself

`conforms()` adds `additionalProperties: false` so that a field the handler
returns and the schema does not know about is a failure. Applied at the top of
a schema that is an `anyOf` — which is what a handler with two return shapes
publishes — it has no sibling `properties` to work from, so it rejects every
field and fails a response that is perfectly correct.

`exact.documentImportStatus` failed that way and looked like a real finding for
a few minutes. It was the test. Strictness is applied per branch now.

## Consequences

- 45 of 114 operations have their real output checked against the published
  schema, and the set is derived rather than listed.
- A new collection read is covered automatically. A new write or by-id read is
  not, and needs its own case — which is honest: those need data that has to
  come from somewhere.
- Two query parameters that were missing from `openapi.json` are in it, and one
  endpoint that accepted an unvalidated string no longer does.
- The contract test has two more ways to fail, both of which would have caught
  this class a year earlier.
