# 0014. An administration is created by a signed-in human, under an id they bring

Status: Accepted
Date: 2026-09-04

## Context

Principle 4 says "self-hosted is complete, not crippled". Until this decision it
was not: there was no operation anywhere that created an entity. A fresh install
let you sign in and then showed you a screen saying to ask an owner for an
invitation — with no owner in existence, because no administration existed for
anyone to own. The only route to a first set of books was to run a test fixture
against the database.

Two things had to be settled to fix it, and neither has an obvious answer.

**Who is allowed to create one?** Every other operation resolves an `entityId`
in middleware and checks a permission scoped to it. Creation cannot: there is no
entity yet. The permission model had no shape for "instance-scoped".

**How is it made idempotent?** Every write in this system accepts an
`Idempotency-Key` and records it in `idempotency_keys`, whose primary key is
`(entity_id, key)`. That table cannot dedupe the request that creates the
entity. A double-submitted setup form producing two administrations, one of them
empty and undeletable, is not an acceptable failure.

## Decision

**Provisioning is authorised by a session and never by an API token.** A new
permission `entity:create` exists, is held by any authenticated human, and is
granted by no role and no token. `resolveSetupContext` refuses a request
carrying a bearer token outright rather than ignoring the header and falling
back to the cookie. A token is issued _by_ an administration; letting one create
another would put a second tenant behind the first one's credential, and
silently attributing a machine call to whichever human happened to be signed in
is worse than refusing it.

The route is therefore `PUT /api/v1/entities/{entityId}` with a client-chosen
id, not `POST /api/v1/entities`. **The id is the idempotency key.** A retry, or
a double-submitted form, lands on the administration the first request made; the
response is 201 the first time and 200 after that. The alternative — making
`idempotency_keys.entity_id` nullable, dropping its primary key and adding
partial unique indexes for an actor-scoped variant — is a schema change and a
second dedupe mechanism, to get a property that a caller-chosen id already has.

The id is minted by the server function that renders the setup form, not in the
browser. `@klopt/core` is a server-side domain package: it reads reference data
with `node:fs` and hashes with `node:crypto`. Importing it into a client bundle
to get `uuidv7` externalises those modules and fails at first use — a runtime
error inside a form, not a build error. This was found by the browser test, not
by the type checker, which is the argument for the browser test.

Everything the transaction writes — the entity, the owner membership, the chart
of accounts, the dagboeken, the BTW-codes, the first book year and its twelve
periods — commits together or not at all. A half-provisioned administration is
worse than none: it is reachable from the picker and rejects everything you try
to do in it, with an error about the wrong subject.

Opening a book year is a separate operation, `ledger.createFiscalYear`, for a
reason that is not symmetry: a year close posts its opening balance into the
_next_ year, so an entity that has only ever had one book year cannot close it.
Shipping provisioning without it would have replaced one dead end with another.

## Consequences

A self-hoster goes from `docker compose up` to a posted journal entry without
touching SQL, and the chart they land on is real: 31 accounts, every one mapped
to a live level-4 RGS 3.7 code, checked against all 3691 of them by a test
rather than by eye.

Headless creation of an administration is not possible, and that is deliberate
rather than an omission. It is the one place principle 8 does not hold, because
holding it would mean a cross-tenant credential. An operator provisioning
instances programmatically runs the same code through the database package.

`entity:create` is the first permission that is not entity-scoped. If a second
one appears — instance settings, a tenant list — the split between
`RequestContext` and `SetupContext` is the seam it grows along, rather than an
`entityId` that is sometimes null and sometimes checked.

Charts of accounts are reference data, on the same footing as the RGS scheme and
the XAF schema (principle 6, ADR 0011). An accountancy firm ships the chart it
always uses as a file in `reference-data/charts/`, and a self-hoster with their
own numbering does not have to fork anything.
