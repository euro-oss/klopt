# 0044. The response schema is the return type

Status: Accepted
Date: 2026-09-14

## Context

ADR 0043 built the OpenAPI document and left half of it out. Requests,
parameters, permissions, idempotency and errors were generated from things that
already had to be true. Success bodies were a status code and a media type,
because there was nothing to generate them from: a handler builds an object,
`handle` stringifies it, and no schema is involved anywhere.

That ADR proposed closing it by declaring a Zod schema per operation and having
`handle` check the body against it under test. Building the request half made
clear why that is the wrong shape:

- It is a hundred and fourteen schemas whose only guarantee is that somebody
  read a handler carefully once. That is the hand-maintained second source of
  truth spec 10.2 rules out, arriving by a different door.
- The verification would not have worked. Every handler test in this repository
  calls the handler directly — `handleDraftInvoice(context, body)` — because the
  route files are three lines each and there is nothing in them to test. Nothing
  goes through `handle`, so a check there would have run on almost nothing while
  looking like coverage.

## The handlers already describe their responses

They are TypeScript. `handleGetJournalEntry` has an inferred return type that
names every field, its type, and whether it can be null, and that type is not a
description of the handler — it _is_ the handler. It cannot drift, disagree, or
be forgotten, because there is no second thing to keep in step.

So `scripts/build-response-schemas.ts` opens the program, finds the handler each
route calls, takes the `body` property of its return type, and converts it to
JSON Schema. All 114, no per-operation work, nothing written twice.

## Why this usually cannot be done, and can be done here

TypeScript types are not JSON. A type containing a `bigint`, a `Date`, a `Map`,
a function or a class instance describes something `JSON.stringify` mangles or
drops, and no honest schema can be produced from it. Most codebases have those
all over their response types, and a converter meeting one has to guess.

This codebase does not, and it is not luck: money became a `bigint` in the
domain and a decimal string on the wire in M0, with a lint rule about it, so
every handler already serialises before returning. The dump that started this
work found no `bigint`, no `Date`, no `any` and no `unknown` in any of the 114
return types.

The conversion refuses rather than guesses when it meets one. A `bigint`
reaching a response type is a handler that forgot to serialise an amount, and
the failure names the operation, the property and what to do:

```
ledger.postJournalEntry.total: cannot describe `bigint` in JSON Schema.
A response type has to be something JSON.stringify produces faithfully —
serialise it in the handler (money as a decimal string, dates as YYYY-MM-DD)
rather than letting the shape reach the wire.
```

That is the load-bearing part. A converter that quietly emitted `{}` for a type
it did not understand would produce a document that validates, reads plausibly
and is wrong, which is the failure mode this whole exercise exists to avoid.

## The conversions worth naming

- **Optional is absent, not null.** `a?: string` produces a property that is
  not in `required`; `a: string | null` produces `type: ["string", "null"]` and
  is required. A generated client handles the two differently and should.
- **A union of string literals is an enum**, and a nullable one is that enum
  with `null` in it, rather than an `anyOf` a reader has to decode.
- **`boolean` is one type.** TypeScript models it as `false | true`, which
  reaches a naive converter as two `const`s.
- **A named alias stays named.** `AccountType`, `TaxRole`, `PaymentBatchState`
  and thirty others become components and are referenced. Generic aliases —
  `Record`, `Readonly`, `Immutable` — are expanded, because their names tell a
  reader nothing and collide with every other use.
- **Recursion becomes a `$ref`.** The audit log's `before` and `after` are
  arbitrary JSON, and `JsonValue` refers to itself. Without cycle detection a
  converter either loops forever or gives up and says `{}`.

## Bytes are a media type, not a schema

Eight routes answer with a PDF, a UBL invoice, a pain.001, an XAF file, a
stored document or an XBRL instance. Their content type is part of the contract
— a client needs to know it is getting a PDF — but there is no schema for one,
and describing it as a base64 string would be a lie a client generator acts on.
They get their media type and `format: binary`.

`BINARY_RESPONSES` declares them, because two take their content type from the
document they are serving and there is nothing in the source to read. A test
checks it in both directions: every entry names a real binding, and every route
not on the list answers `application/json`.

## Where this is generated, and why it is a file

Deriving the schemas needs the TypeScript compiler and the source tree. A
container has neither, and `/api/v1/openapi.json` has to work in one.

So `pnpm --filter @klopt/web run openapi` writes
`src/api/response-schemas.generated.json`, which `openapi.ts` imports like any
other data, and then writes `docs/openapi.json` from the result. Both are
checked in. `test/openapi.test.ts` re-derives the first from the program and
compares — six seconds, the slowest test in the suite, and the one that makes
"cannot drift" a fact rather than an intention. Change what a handler returns
and forget to regenerate, and the build says so with a diff.

## A type is a claim, so the claims are checked against reality

Deriving from types closes drift and opens one narrower hole: a TypeScript type
is a claim, and an `as` cast is a claim made louder. There are eighty-five in
the handlers. None are `as any` or `as unknown as`, but a wrong one would put a
shape in the document that the endpoint does not return, and the derivation
would faithfully publish it.

`test/response-shapes.test.ts` runs real handlers against a real database and
validates what comes back against the schema published for that operation, with
`additionalProperties: false` at the top level. That last part is the point: a
handler that gains a field the schema does not know about means the document is
now incomplete, and JSON Schema is happy with extra keys unless told otherwise.

Eleven operations, chosen as the shapes the other hundred are made of — a
posted entry and the same entry read back, a list with a cursor, a report of
decimal strings, a chain verification, a created contact and the list it
appears in, an empty collection where every nullable is exercised at once, and
the two access surfaces that serialise dates and states. A cast leaking an
internal field into `handleVerifyChain` fails it by name.

Not all 114, because these tests need seeded data and the remaining shapes are
variations rather than kinds. Extending the coverage is worthwhile and cheap
now that the harness exists.

The other thing this does not do is say _which_ success shape you get when a
handler branches. The type is the union of everything it can return, and the
document shows the union — accurate, occasionally less specific than a reader
would like.

## Consequences

- Every one of the 114 operations has a described response body, and
  `undocumentedResponses()` is zero rather than a ceiling of 158.
- A client generator run against this document now produces typed requests
  _and_ typed responses, which was the point of writing it.
- A handler that starts returning a `bigint`, a `Date` or an `any` fails the
  build with the property named. This is a bug detector that happens to also
  produce documentation.
- A handler whose runtime value diverges from its declared type fails the
  conformance test, for the eleven operations it covers.
- The response file is regenerated by a command, and forgetting to run it fails
  a test. That is one more thing to remember, and the failure message says
  exactly what to run.
- `docs/openapi.json` went from 250 KB to 734 KB. It will show up in diffs. A
  reviewer seeing four hundred lines change when someone "just renamed a field"
  is the mechanism working.
