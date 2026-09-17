# 0052. A tag you can hold an edit to

Status: Accepted
Date: 2026-09-16

## Context

Spec 10.2 asks for optimistic concurrency on mutable resources. The note in the
todo list added the qualification that makes it tractable:

> Posted entries are immutable so the question does not arise there, which is
> most of the ledger, but a draft invoice edited by two people still
> last-write-wins.

Counting what is actually editable in place: five operations mutate, and only
two of them have a GET returning the same resource — a **contact** and the
**administration's own settings**. Those are the two a person edits in a form,
which is where "two people had it open" happens.

The draft invoice in that note turns out not to exist: an invoice is drafted
and then issued, and there is no update operation between. So spec 10.2's
"drafts, contacts, settings" is two of three, and the third is a case this API
does not have.

The other three mutations — a member's role, a match rule's active flag, a bulk
RGS mapping — have no by-id read to take a tag from. Giving them one would mean
inventing the read first, and none of them is a form two people hold open.

## Over the resource, not the representation

The obvious implementation hashes the response body. It is wrong here, and the
test that says so is in the suite.

`GET /contacts/:id` reports how many invoices are open against them. That
number moves when somebody in another room issues one. A precondition computed
over the response would refuse an edit to a phone number because of activity
that has nothing to do with the field being edited — and the caller would have
no way to make progress except to retry until the room went quiet.

So `contactResource()` builds exactly the editable state, the GET puts it in the
body and hashes it for the tag, and `If-Match` compares against the same
function. Anything the caller cannot change is outside it.

## Why a hash and not a version column

Neither `contacts` nor `entities` has an `updated_at`, let alone a version — so
the timestamp approach is a migration on two tables plus the discipline to
maintain it forever.

A content hash needs neither and is more precise: two writes in the same
millisecond are distinguishable, and a write that changes nothing produces the
same tag, which is the right answer to "has this moved". The JSON is
key-sorted, because two code paths building the same contact in a different
order would otherwise hash differently and every edit would fail.

## Optional, and that is not a compromise

`If-Match` is honoured when sent and ignored when absent.

Requiring it would be adding a required request field, which
`docs/api-stability.md` promises v1 will not do — and on the day it shipped it
would have broken our own UI. A caller who does not ask for the check keeps the
last-write-wins they already had; a caller who does gets a 412 that names the
current tag so they can re-read and reapply in one round trip rather than two.

`*` is accepted, meaning "I only require that it still exists". Comparison is
weak, per RFC 9110's allowance: `If-Match` is defined as strong, but a proxy
that re-tags a response `W/` would otherwise fail every edit, and these are
content hashes either way.

## 412 is its own code

`precondition_failed` rather than reusing `conflict`. They mean different
things to a client: a 409 is a retried idempotency key and the fix is to stop
retrying, a 412 is somebody else's edit and the fix is to read again. A client
writing one branch for both would do the wrong thing in one of the cases.

## The document says only what is true

`SUPPORTS_IF_MATCH` and `RETURNS_ETAG` are two short lists in the generator, so
`openapi.json` advertises the header and the 412 on exactly the two operations
that implement them. A 412 documented on `members.setRole` would be a status a
client writes a branch for and never sees; the generated document asserts it is
absent there.

## Consequences

- Two resources support optimistic concurrency, tested against a real database
  including the case it exists for: two edits from the same tag, the first
  winning, the second told rather than silently losing.
- Every other write is unchanged. Nothing became required.
- `handle()` can set response headers now, which is what makes an `ETag`
  possible at all. Deliberately not applied to every response: a tag a client
  cannot send back is a promise of a precondition nobody honours.
- A third editable resource would need its own `contactResource`-shaped
  function and two list entries. That is the cost, and it is visible.
