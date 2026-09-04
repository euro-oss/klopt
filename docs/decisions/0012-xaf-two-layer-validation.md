# 0012. XAF is validated twice, by two different things

Status: Accepted
Date: 2026-09-04

## Context

Spec 7.3: "Validates against the published schema before it is offered for
download. An invalid XAF is a build-breaking bug, not a warning."

XSD validation in Node means either a native binding (`libxmljs`, needs a build
toolchain), a Java process, or an external `xmllint`. None of those belongs in
the request path of a self-hosted install whose pitch is one container and
Postgres.

There is also a more useful observation: **XSD cannot check the things that
actually go wrong.** It cannot check that `linesCount` matches the number of
lines, that the file balances, that every `accID` on a line resolves to a
declared account, or that a transaction's own debits equal its credits. Those
are what an accountant or an inspector notices.

## Decision

Two layers, each doing what it is good at:

**A semantic validator in `@klopt/core`,** run before every download, with no
external dependency. It checks control totals against contents, per-transaction
balance, whole-file balance, reference integrity for accounts, parties and VAT
codes, field lengths, and dates inside the declared fiscal year. A file that
fails is **not offered for download** — the endpoint returns 422 with the
problems, because an invalid auditfile is a bug and not a warning.

**XSD validation in CI,** with `xmllint` against the published schema in
`reference-data/xaf/`. It runs over the golden files and over an export built
from real posted data. This is what catches structural drift and what turns a
schema release into a red build.

The golden-file test also asserts the **negative**: it swaps two elements and
requires the schema check to reject the result. A validation step that cannot
be made to fail is theatre.

## Consequences

- `xmllint` is a CI dependency, not a runtime one. Present on ubuntu-latest and
  on macOS; the tests skip cleanly where it is absent, and CI is where it
  matters.
- A structurally invalid file could in principle reach a user if the generator
  broke in a way the semantic validator does not model. The golden-file test is
  the guard, and the generator is a single ordered list of writes precisely so
  that this stays reviewable.
- Import is deliberately the other way round: lenient about shape, strict about
  values. Real files from Exact, AFAS and Twinfield differ in namespace,
  whitespace and which optional elements they emit. Refusing an accountant's
  file over element order helps nobody; misreading an amount does real damage.
