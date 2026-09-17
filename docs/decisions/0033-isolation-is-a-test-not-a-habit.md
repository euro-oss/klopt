# 0033. Isolation is a test, not a habit

Status: Accepted
Date: 2026-09-08

## Context

Spec 14: _"Single-tenant by default. Multi-entity within one instance from v1,
because holdings and BV structures are the norm."_ And, separately:
_"Multi-tenant hosting is a phase-two deployment mode: enforce isolation with
Postgres row-level security plus a schema per tenant, decided before the first
line of data-access code, never retrofitted."_

So there is no row-level security here, and that is the spec's own call: RLS is
for the _multi-tenant hosting_ mode, not for the holding company with four BVs
in one instance. Which means isolation between administrations rests entirely on
every query filtering by `entity_id`.

That makes a missing filter the worst bug this codebase could have — and "we
have been careful about it" is not a test.

## Two shapes of leak, and only one of them is loud

A list that forgets its scope leaks everything at once. Somebody notices within
a minute, because another company's invoices are on the screen.

A **lookup by id** that forgets its scope leaks one row at a time to anybody who
has ever seen an id — a URL in a browser history, an id in an export, a
support ticket — and the screen looks perfectly normal while it happens. Nothing
about the application's behaviour reveals it. That is the one worth a test file.

So `apps/web/test/isolation.test.ts` builds two complete administrations —
contacts, invoices both ways, a journal entry, a bank account with a statement,
a payment batch, a document, an inbox item, a mailbox source, a sealed snapshot
— and then asks A for each of B's things.

Thirteen by-id read handlers, five by-id writes, eleven lists, and the entity's
own settings. A new handler that forgets its scope makes this fail.

## `not_found`, not `forbidden`

Every refusal is `not_found`. Telling somebody an id exists but is not theirs
confirms that it exists, which is a smaller leak of the same kind — enough to
enumerate another administration's invoice numbers by watching which ids give
403 and which give 404.

## What the audit found

**One real weakness, in the one query that returns a secret.**
`InboundSourceRepository.withSecret(sourceId)` took no entity and was scoped by
the _caller_ comparing `row.entityId` afterwards. It worked, and both callers
did it. It is still the wrong shape: a method that hands back a mailbox password
and trusts every future caller to remember a check is exactly the thing that
fails quietly two years later. The scope is in the `where` now.

**Twenty-six other unscoped-looking reads, all of them fine.** A static sweep
for `select` statements with no `entity_id` in them found twenty-seven. All but
the one above are either child selects under a parent that was already
entity-scoped — an invoice's lines, a batch's instructions, a contact's address
— or genuinely global reference data: RGS codes, a user by email address.

Worth writing down because the sweep will find them again next time, and the
answer to twenty-six of them is "yes, checked, that is a child of a scoped
parent".

**One test expectation that was wrong rather than one behaviour.**
`handleListDeliveries` answers with an empty list for another administration's
invoice rather than refusing, and that is correct: it is a _list_ scoped by both
the entity and the invoice, so no deliveries is the same answer as for an
invoice that has none. Asserting `not_found` there would have been asserting an
inconsistency rather than a property, so the test asserts what is actually true.

## Consequences

- **The sweep is not automated, and this test is the reason it does not need to
  be.** A static rule would have to understand which parents are already scoped,
  which is most of what a type system cannot express here. The behavioural test
  catches the same class without guessing.
- **RLS is still the right answer for hosting.** Nothing here substitutes for it
  if this ever runs as multi-tenant SaaS, and the spec is right that retrofitting
  it is the hard way. What this test does is make the _current_ deployment mode —
  one instance, several administrations, one operator — provably isolated.
- **The test needs each administration to hold something of every kind.** That
  makes it slow to set up and easy to leave a gap in: a handler whose resource
  type nobody built in the fixture is a handler the test cannot check. The
  fixture is the maintenance cost of the guarantee, and adding to it is part of
  adding a resource.
