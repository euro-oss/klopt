# 0043. The document is generated, or it is fiction

Status: Accepted
Date: 2026-09-14

## Context

Spec 10.2, and the clause after the comma is the whole requirement:

> OpenAPI 3.1 generated from the same schemas the code validates against, never
> hand-maintained.

A hand-written OpenAPI document is accurate on the day it is written. Six
months later a field is optional in the code and required in the document, and
the integrator who trusted it has a client that fails on the one request that
mattered. That failure is worse than having no document, because a generated
client compiles against the lie.

Three things already existed and had to be true, and the document is assembled
out of them rather than described alongside them:

- `routeManifest` — paths and methods, reconciled against the operation
  registry in both directions by the contract test since M0.
- `listOperations()` — the summary, the permission and the agent exposure. The
  same registry the permission middleware and the MCP server read.
- `apps/web/src/api/schemas.ts` — the Zod schemas the routes parse with.

Plus `STATUS` in `errors.ts`, exported for this, so the statuses the document
lists are the ones `problemResponse` actually answers with.

## The link the manifest was missing

The manifest knew which route served which operation. It did not know which
schema that route parsed, and without that there is no request body to
describe.

The tempting fix is for the generator to read the route files. That produces a
parser of our own source which agrees with whatever it manages to parse, and
fails silently on the day somebody writes a route slightly differently.

So the binding declares it — `request: { query, body }`, as a name typed
`keyof typeof Schemas`, so a name that is not a schema does not compile — and
`test/contract.test.ts` reads the route source and checks the declaration
against what the route really does. Declaring and checking, rather than
inferring. When they diverge the build says which route, which method, what was
declared and what was found.

## What the contract test now refuses

Writing that check turned up a hole that had been there since M0. The manifest
maps operations to routes; nothing had ever looked for a _route with no
operation_. `/api/v1/health` was one, correctly, but by nobody's decision that
survived in writing — and a route that skipped the permission middleware could
have been another without a test noticing.

`NOT_DOMAIN_ROUTES` now lists the exceptions with their reasons, the same shape
as the CLI's `NOT_DOMAIN_OPERATIONS`, and every other file under
`src/routes/api/v1` must be in the manifest. So must every HTTP method in those
files: a route can grow a second handler, and that used to be invisible too.

## `io: 'input'`

Our schemas transform. A money field is a decimal string of minor units on the
wire and a `bigint` in the domain; `listEntriesQuery` turns a string into a
number. Zod can emit either side, and the difference is not cosmetic — asking
for the output side produces a document instructing integrators to send us
bigints, which is not a thing JSON has.

The document describes the wire. `io: 'input'`, everywhere.

## Proving it, rather than asserting it

"Generated from the validating schemas" is not by itself a proof that the two
agree. The conversion could drop a constraint, or resolve the wrong side of a
transform, and the document would still look plausible and still validate as
OpenAPI.

So `test/openapi.test.ts` runs bodies through both. Zod parses them; ajv
validates them against the schema lifted out of the generated document; the two
must give the same answer. A well-formed entry passes both. An entry with
`debit: 12500` as a number — the one mistake every integrator makes once —
fails both. A missing required field fails both; an omitted field with a
default passes both. Every request schema in the document is compiled by ajv,
because a schema ajv refuses is one no client generator will read either.

The document is also handed to a real OpenAPI parser rather than eyeballed. It
is valid 3.1, and the test fails with the offending path when it is not.

### Where the two do not agree, and why that is written down

JSON Schema cannot express `.refine()`. The rule that a journal line's tax code
needs a tax role and vice versa is enforced by the API and invisible in the
document, so a caller who follows the document exactly can still be refused.
There is a test asserting precisely that divergence — Zod rejects, ajv accepts
— so it is a known gap rather than a discovered one, and it is why 422 appears
on every operation.

The relationship is one-directional and stated as such: everything the API
accepts, the document accepts.

## What it does not describe: success bodies

The handlers return plain objects. There is no schema on the way out, so there
is nothing to generate one from, and writing one by hand here is exactly the
second source of truth this ADR exists to prevent. It would be accurate the day
it was written.

`info.description` says so, in the document, where an integrator will read it
rather than in a file they will not. `undocumentedResponses()` counts them and
`test/openapi.test.ts` holds that count as a ceiling — currently 158, which is
every success response the API has. It may fall. It may not rise, which means a
new endpoint has to move the number deliberately.

The way to close it is to make responses validated rather than described:
declare the shapes and have `handle` — the single choke point every API
response passes through — check them under test, so the existing db-backed
handler tests correct the schemas rather than a human guessing at them. That is
the next slice, not this one, and the ceiling is what keeps it from being
forgotten.

Until then the document is honest about being half a contract. Requests,
parameters, permissions, idempotency and errors are complete and machine-
checked; responses are a status code and a media type.

## Two copies, on purpose

`GET /api/v1/openapi.json` serves it live, unauthenticated, with this
instance's version and its own URL in `servers`. Unauthenticated because an
integrator needs the contract before they have a token, and there is nothing in
it that is not the same on every Klopt instance.

`docs/openapi.json` is the same document with a fixed version and no `servers`,
checked in and compared byte for byte by a test. Not because anybody consumes
the file — they should use the endpoint — but because it makes the promises in
`docs/api-stability.md` reviewable. "A field will not be removed from a
response" is a sentence until removing one shows up as a red line in a pull
request.

It is in `.prettierignore`: Prettier collapses short arrays, which would make
the checked-in copy differ from the served one for no gain, since nobody
hand-edits it.

## Named types, because one of them matters more than the rest

Six schemas carry `.meta({ id })`, so the document says `MinorUnits` in ninety
places instead of repeating a regex. That is not tidiness. The single most
important thing to notice about this API — money is a string of unsigned
integer minor units, never a number — now has a name an integrator can look up
and a description that explains why.

Error responses are components too, referenced rather than repeated. Written
out on every operation they were a third of the document, and a reader
scrolling past the same four blocks a hundred and fourteen times stops reading
them.

## Consequences

- The document cannot drift from the code without a test failing. That is the
  whole point, and it is the only reason to trust a generated one.
- Adding a route means adding a manifest entry with its schemas, or the build
  fails naming the route. Adding one under `/api/v1` that is not an operation
  means saying so, in writing, with a reason.
- Two new dev dependencies: `@readme/openapi-parser` to validate the document,
  `ajv` to cross-check it against Zod. Both are test-only. Validating an OpenAPI
  document by reading it is not validating it.
- The response half is missing and the document admits it. A client generator
  run against this produces typed requests and untyped responses, which is more
  useful than nothing and less useful than it should be.
- `docs/openapi.json` is 250 KB and will show up in diffs. That is the feature.
