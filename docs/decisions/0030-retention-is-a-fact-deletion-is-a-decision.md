# 0030. Retention is a fact about a document; deletion is a decision somebody makes

Status: Accepted
Date: 2026-09-08

## Context

Spec 7.6 asks for five things, and the wording of the fourth decides the shape
of all of them:

> - Object storage with object lock or WORM mode, with a retention date computed
>   per document from its fiscal year.
> - Legal hold: a flag that suspends deletion regardless of retention date.
> - Deletion after retention is a deliberate, audited, permissioned batch action
>   with a preview. **Never automatic.**
> - Periodic sealed snapshots …
> - GDPR tension, document it explicitly.

"Never automatic" rules out the obvious implementation. There is no expiry
sweep, no scheduled job, no S3 lifecycle rule and no cron entry anywhere in this
change. A retention date arriving in the past is not an instruction; it is a
fact somebody may act on.

## The clock starts at the end of a book year, not at a document's own date

This is the part that is easy to get wrong and expensive to get wrong quietly.

An invoice dated 28 December 2026 and one dated 3 January 2027 look a week apart
and are a whole year apart in retention, because each is kept relative to _the
book year it was posted in_. Worse, the two can disagree: an invoice dated 31
December booked into the next year's opening belongs to the year it was booked
in, which is the year an inspector will look for it under.

So a document does not date itself. It reaches a book year through what it is
**evidence for** — `document_links` to a sales invoice, a purchase invoice or a
journal entry — and the fiscal year covering that subject's date is what the
term is counted from. Where a document is evidence for several things, the
latest year wins: keeping it only for the earliest would throw away the evidence
for the later one while it still mattered.

Seven years, per article 52 AWR. Ten for onroerend goed, per article 34a Wet OB,
because the VAT revision period for a building is nine years after the year it
was first used and seven does not cover it. The arithmetic is done on date parts
rather than with `Date`: adding seven years to a `Date` drags a timezone along,
and 29 February plus seven years is a question `Date` answers by rolling into
March.

## No book year means undeletable, not deletable

The default answer for a document nobody has linked to anything is that it
**cannot** be deleted.

This is the single most important line in the change. The obvious reading of "no
retention date" is "no rule applies, so it may go" — and it is exactly backwards.
An upload sitting in the postvak, a receipt nobody has coded yet, a statement
imported but not matched: not knowing how long something must be kept is not a
licence to throw it away.

## A hold beats the clock, and the order of the checks is the order of authority

An entity-wide hold is checked before a per-document one, which is checked
before the date. A firm under a boekenonderzoek should not have to set a flag on
forty thousand rows, and lifting it should be one deliberate act rather than
forty thousand.

A hold requires a reason and lifting one does not. The reason it was set is
already in the audit log; demanding a second one just to undo is friction with
no reader.

## Deleting keeps the row

`deleted_at`, `deleted_by`, `deleted_reason` — and the hash, the size and the
content type stay exactly where they were.

Three things follow, and each is worth the column:

- An inspector asking what used to be here gets an answer.
- A document that turns up later somewhere else can be checked against what it
  claims to be.
- The deletion itself stays auditable. Erasing the row would make the one
  destructive act in this system the only one with no record.

Asking for a deleted document answers **410 Gone** with its hash, its date and
its reason, not 404. That distinction is the whole point: a bare 404 makes a
deliberate, audited deletion indistinguishable from a lost file.

The append-only trigger on `documents` was loosened by exactly the columns
retention needs to move, and tightened around everything else: the hash, the
size, the content type and the entity now raise an exception if anything tries
to change them. A store where the address can be repointed at other bytes fails
the "accessible, readable and controllable" test whatever else it does.

## Bytes are shared; rows are not

Documents are content-addressed and deduplicated across administrations, which
is what makes the inbox able to say "you already have this one". It also means
one firm's expired copy must not take another firm's records with it.

So the deletion checks, inside the same transaction that marks the rows, which
hashes any administration still holds — and skips those. The response says how
many were kept for somebody else. `keptForOthers: 1` with `bytesRemoved: 0` is a
correct and complete deletion of _our_ copy.

## The order: mark, commit, then remove the bytes

1. Re-derive the terms and **re-check every id against the policy, now**. The
   caller sends ids from a preview, and a preview is a moment in the past; a
   hold set in between has to win. The ids are a request and the policy is the
   authority, and anything not deletable is refused by name.
2. Mark the rows and commit.
3. Then remove the bytes, and only the unshared ones.

Step 3 after step 2 means a crash between them leaves a row saying deleted and
bytes still on disk. That is the right way round: the other order loses bytes
that nothing records losing, and a stray file is cleaned up by running the same
deletion again — which is why the operation is idempotent, and why the second
run _refuses_ rather than deleting something else.

## `retention:manage`, and its own permission

Deleting statutory records is the only action in this system that destroys
evidence. Every other destructive-looking act is a reversal that leaves both
sides in the journal.

So it is not folded into `ledger:configure`, which a bookkeeper holds. The
preview reads on `ledger:export` — an accountant or an auditor should be able to
see what is coming up — and every change needs `retention:manage`, which only
the owner has. Not the accountant either: advising on a retention question and
pressing the button are different acts.

`agentExposure: 'none'` throughout, including the read. An agent that can see
which documents are deletable is an agent that can propose deleting them, and
there is no version of that proposal anybody wants in a queue.

## What the storage guarantees, said out loud

Spec 7.6 asks for object lock or WORM mode. The default document store is a
directory and has neither, so the retention promise there is the application's
and not the storage's.

The retention screen says so, in those words. A compliance screen that implies a
guarantee the storage does not make is the worst kind of wrong — worse than
having no screen, because somebody will rely on it. An S3-compatible store with
object lock is the next slice; until it exists, `objectLock: false` is the
honest answer and the screen prints it.

## The GDPR position, which spec 7.6 asks to be written down

A right-to-erasure request cannot remove a posted invoice. Article 17(3)(b)
GDPR excepts processing necessary for compliance with a legal obligation, and
the bewaarplicht is one: for seven years the invoice, its amounts, its date and
the counterparty's identity are records the law requires to be kept and to stay
readable.

What that means concretely, and what this change does and does not do:

- **The ledger is not erasable and will not be made so.** A delete button that
  silently corrupted the books would be worse for the data subject than a
  refusal, because it would put the administration in a state where nobody can
  prove what happened — including to them.
- **The retention term is the boundary, not a licence.** Once it has run out
  there is no legal obligation left to weigh, and the deletion path in this
  change is what makes acting on an erasure request possible at all.
- **Pseudonymisation belongs outside the ledger, and now exists.** Contact
  records hold things an invoice does not need — a phone number, an email
  address, notes — and those are erasable without touching a posting. See
  ADR 0039, which builds that path and describes the one thing that had to
  change first: an invoice used to read its buyer out of the contact row, so
  the contact was load-bearing for the bewaarplicht and could not be touched.
- **A refusal is written down.** The audit log now covers contact and document
  changes, so "we declined to erase X because of the bewaarplicht, on this
  date" is recordable — which is what a supervisory authority asks for.

Nothing here is legal advice and nobody should read it as any. It is the
position this codebase takes, written down so it can be argued with.

## Consequences

- **A document with no links has no term, forever, until it gets one.** The
  preview counts them separately (`undated`) and the screen shows the count, so
  the answer to "why can I not delete anything" is on the screen.
- **Setting a document to ten years re-derives its term immediately** rather
  than waiting for a job, because a ten-year document carrying a seven-year date
  is worse than one with no date at all.
- **Deriving terms is a read that writes.** Both the preview and the deletion
  run `dateDocuments` first. It is idempotent and only reads links that already
  exist, and evaluating the policy against a stale term would refuse a document
  for the wrong reason.
- **Sealed snapshots are next**, and they need this: a manifest of document
  hashes is what makes "prove nothing changed" checkable, and the hashes are
  what a deleted row still carries.
