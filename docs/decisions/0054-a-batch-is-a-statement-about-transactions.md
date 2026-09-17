# 0054. A batch is a statement about transactions

Status: Accepted
Date: 2026-09-17

## Context

Spec 10.2 asks for bulk endpoints for "import-shaped work, with per-item
results rather than all-or-nothing". The note carried since M6 said there were
none.

`POST /api/v1/journal-entries/batch` takes up to 500 entries and answers with a
result per entry.

## Per-item results is the transaction boundary, not the response shape

The temptation is to read the requirement as "return an array". It is not. A
response listing which items failed is meaningless if the failures rolled the
successes back — the array would be a receipt for nothing.

So each entry gets **its own transaction**. Entry 7 being refused leaves
entries 1 through 6 posted and 8 onwards still attempted. That is the property
worth having: somebody importing four hundred lines from a spreadsheet fixes
the three that are wrong and re-sends those three, rather than fixing one,
re-sending four hundred, and discovering the next one.

The cost is that a batch has no atomicity. It is not a unit of work; it is a
saving on round trips. Anybody who needs several postings to succeed or fail
together must put them in one entry, which is what an entry is for.

## 200, not 207

207 Multi-Status is the obvious-looking answer and the wrong one. It is a WebDAV
status whose body is defined as XML, most HTTP clients treat it as an
unfamiliar 2xx, and it invites the reading that the request partly failed at
the HTTP layer. It did not: the batch was accepted and processed in full, and
the question of which entries were refused is domain content.

The status line describes what happened to the request. `failed` in the body
describes what happened to the entries. A client that wants "did all of it
work" reads `failed === 0` rather than reducing an array — because a client
made to reduce an array is a client that checks `results[0]`.

## Failures carry the same problem document

A refused entry inside a batch produces exactly the problem document the single
endpoint would have answered with, code and all. One error shape to learn, not
two. It also means the translated message catalogue reaches batch failures with
no extra work.

## The idempotency key is per entry

`Idempotency-Key` is still required, and each entry derives its own key by
index: `${key}:${index}`. Two identical entries in one batch are two entries,
which is correct — a spreadsheet may legitimately contain the same posting
twice. Re-sending the whole batch with the same header replays rather than
duplicates, per entry, and an entry that failed the first time is retried.

This does mean the batch's own key is not itself recorded, so a re-send with
different content under the same key is not caught. The per-entry keys are
where the guarantee that matters lives.

## `dryRun` on the batch

`dryRun` on the body validates every entry and commits none, and still reports
per item — which is the useful thing before an import: the whole list of what
is wrong, not the first failure. An entry may also set its own `dryRun`, and either
one being set makes that entry a dry run — there is no way to force a commit
of one entry inside a dry-run batch, which is the safe direction to fail.

## Consequences

- One bulk endpoint, not one per resource. Journal entries are the
  import-shaped work; contacts and invoices are entered, not bulk-loaded. The
  shape here is the pattern for the next one if it is needed.
- 500 entries is the ceiling, enforced by the schema, because 500 sequential
  transactions is already a slow request and the honest answer to a larger
  import is more than one call.
- Entries are processed in order and the results carry their index, so a client
  can match them back without relying on position alone.
