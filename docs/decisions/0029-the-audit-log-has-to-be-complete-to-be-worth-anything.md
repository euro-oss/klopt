# 0029. An audit log with a hole in it is worse than none

Status: Accepted
Date: 2026-09-08

## Context

M5 is "Retention and WORM, sealed snapshots, audit log export, Exact importer,
multi-entity, permissions", and its milestone test is "it is adoptable by
someone who is not you". The audit log is where that starts, because it is the
thing an inspector asks for and the thing a firm taking on somebody else's
books has to be able to read.

Spec 7.6 asks for "an audit log of every state change: actor, timestamp,
entity, before and after, request id, IP. Append-only, exportable, and covering
API calls as well as UI actions."

The table has existed since M0 with the right columns and an append-only
trigger. **Three places wrote to it**: posting a journal entry, changing a
membership, and importing RGS. Issuing an invoice, approving a payment batch,
filing an aangifte, correcting an IBAN, changing the VAT rounding, matching a
bank line — none of them left a trace. And there was no way to read the log at
all.

That is the worst shape this can take. A missing log is a known gap. A log that
covers a fifth of what happens is a gap that reads as an answer: somebody looks
for who approved a payment, finds nothing, and concludes nobody did.

## The call lives in the handler, not in a wrapper

The tempting design is one wrapper around every route. It would be complete by
construction and impossible to forget, and it would record almost nothing worth
having: the actor, the URL and a status code.

`before` and `after` are the columns that make this an audit log. "The VAT
rounding went from `per_invoice` to `per_line`" is an audit entry; "a PATCH to
`/entity` returned 200" is a web-server log. Only the handler holds both sides —
the wrapper cannot see the row before the write, and by the time it runs the
before-state is gone.

There is a second reason. Server functions and REST routes call the same
handlers by design, so a wrapper would have to exist twice, at two glue layers
neither of which knows which operation it is serving. Putting the call where the
knowledge is costs one line per handler and reads correctly at each one.

**The cost is that a new handler can forget**, and that is a real hole rather
than a theoretical one. The answer is `apps/web/test/audit.test.ts`, which
drives each consequential action against a real database and asserts a row
comes out with the right shape. A test is a weaker guarantee than a type, and
it is the strongest one available here.

## Best-effort, except where it cannot be

`recordAudit` runs after the change has committed, in its own transaction, and
swallows its own failures into the log.

That reads like a compromise and it is the right one for what it covers.
Approving a batch or changing a setting is a single statement; a failure to
write the audit row afterwards means "it happened and we failed to write it
down", which is bad. Throwing instead would report "it failed" for something
that succeeded, which invites a retry of an action already taken — and for a
payment batch that is worse than bad.

**The journal is the exception and always was.** `LedgerRepository.appendAudit`
writes inside the posting transaction, because an entry in the hash chain with
no audit row beside it is exactly the discrepancy an inspector is looking for.
That one is atomic; everything else is immediately-afterwards. The two are
visible together in the log — booking a purchase invoice produces
`purchase.book` from the handler and `ledger.postJournalEntry` from the posting,
and the test asserts both.

Making everything transactional would mean threading a unit of work through
every handler so the audit row joins whatever transaction is open. That is a
real improvement and a large refactor, and it is not what makes the difference
between a log worth reading and the one that was here.

## Read on `ledger:export`, not `ledger:read`

What the books say and what everybody did are different questions. A bookkeeper
reads the books all day; reading the record of every colleague's actions,
with their IP addresses on it, is an audit. `ledger:export` is the permission
the accountant, the owner and the auditor hold, and it is the one that gates
handing an artefact to somebody outside — which is what this is.

## The export streams, and therefore cannot fail politely

Seven years of an active administration is the case an export exists for, so
the rows are walked with a cursor and written to a `ReadableStream` rather than
assembled in memory. Memory is one page regardless of the range asked for.

The consequence is that once the first byte is out, the response cannot become a
problem document — the status line is long gone. So everything that can fail
fails first: the permission check and the query parse both happen before the
stream is constructed. A failure after that errors the stream, which truncates
the download. Visibly wrong beats silently short.

Paging is a **row-value comparison** — `(occurred_at, id) > (…, …)` — not a
timestamp plus a filter. Two rows can share a microsecond, and `>` on the
timestamp alone drops the second while `>=` repeats the first. A test walks 25
rows in pages of 4 and asserts all 25 come out exactly once.

JSON Lines is the default and CSV is offered. `before` and `after` are arbitrary
objects; CSV flattens them into a quoted blob, which is why it is not the
default and why it is there at all — an inspector who asks for a spreadsheet
gets one, with every quote doubled per RFC 4180 so a value containing one does
not end the row early.

## Consequences

- **The screen exists so the log gets read before it matters.** An audit trail
  first opened during an inspection is an audit trail nobody has checked. It is
  on `g` then `l`, filterable by resource kind, and each row opens to its
  before-and-after.
- **A credential never reaches it.** Configuring a mailbox records the host, the
  user and the folder, and never the password — `config` is whitelisted on the
  way in and the secret lives in its own column. There is a test for this,
  because "we did not put the password in the audit log" is the kind of thing
  that is true until somebody adds a field.
- **What is covered is enumerated, not universal.** Contacts, invoices,
  purchase invoices, payment batches, VAT filings, bank accounts and statements,
  bank matches, inbox items, mailbox sources and entity settings. Reads are not
  logged, and neither are dry runs — a preview that changes nothing is not a
  state change. Anything added later has to remember, and the test is what makes
  it remember.
- **`actorPrincipalId` is carried through but nothing populates it yet.** It is
  the column that answers spec 10.3's "agent X acting for user Y", and it will
  be filled by the MCP write path, which is still ahead.
