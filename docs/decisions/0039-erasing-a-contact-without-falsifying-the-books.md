# 0039. Erasing a contact without falsifying the books

Status: Accepted
Date: 2026-09-11

## Context

Spec 7.6 asks for the GDPR tension to be resolved and written down:

> Implement pseudonymisation of contact records outside the ledger, keep the
> legally required invoice data intact, and ship a written policy explaining
> the position. Do not build a delete button that silently corrupts the books.

ADR 0030 wrote the position down and deferred the mechanism. This is the
mechanism.

## The invoice had to stop depending on the contact first

`sales_invoices` held only `contact_id`. Every rendering of an issued invoice
read the buyer's name and address out of the contact row **as it stands
today**. The UBL bytes are written on first _request_, not at issue — so the
guarantee in `handleGetInvoiceUbl` that "nothing is regenerated, so nothing can
drift" only held once somebody had downloaded it. Before that there was nothing
to be faithful to.

That was already a bug without anybody mentioning GDPR: a customer who moved
between issuing and downloading got last year's invoice with this year's
address on it, while the contact screen promised the opposite in as many words.

It also made the contact row load-bearing for the bewaarplicht. An invoice must
name its buyer for seven years; if that name lives only in `contacts`, then
`contacts` cannot be erased without falsifying a statutory record — and no
amount of care in the erasure path fixes that, because the erasure is not where
the fault is.

So migration 0026 snapshots the buyer onto the invoice at issue, alongside the
number and the journal entry. Those three are what an invoice acquires by
becoming a document somebody owes money on, and they are exactly the three that
must not move afterwards. The snapshot is taken inside `markIssued` rather than
passed in by the caller: the check constraint would refuse a row without it,
but a constraint that fires is a bug somebody has to debug at three in the
morning, and a snapshot that is always taken is one they never write.

## What an erasure does

`retention.pseudonymiseContact`, under `retention:manage` and therefore the
owner alone — the same permission as deletion, because it is the same kind of
act: irreversible, and about somebody's rights rather than about bookkeeping.

**Erased:** name (replaced), legal name, email, phone, IBAN, notes, electronic
address, and every address row. None of these is read by any posting.

**Kept, deliberately:**

- **The debiteurennummer.** It travels into the XAF and it is how a posting
  finds its subledger account. Erasing it would not anonymise anybody; it would
  break the invoice's link to its own history.
- **The VAT and KvK numbers.** They identify a registered business rather than
  a person, an ICP declaration is a legal record that had to name one, and the
  VIES proof stored against it is the evidence that the zero rate was allowed.

The name becomes `Gewist contact DEB-0001` rather than an empty string. The
column is `not null`, and more importantly a blank row in a contact list reads
as a bug rather than as a decision somebody took. Naming the ledger account
keeps the row identifiable as the one thing it still legitimately is.

The contact is blocked on the way out. A contact nobody can name is not one
anybody should be able to invoice again by accident.

## Refused while anything is outstanding

An erasure is refused while the contact has an open invoice in either
direction, and the refusal says so with the count.

Collecting a debt keeps the ground for processing alive, and more practically:
dunning needs somewhere to send to. Erasing mid-chase produces a receivable
nobody can pursue and a screen that cannot explain itself. Settle or write off
first.

Deliberately **not** conditioned on the retention term. The seven years protect
the invoice, and the invoice now carries its own copy; there is no ground for
holding somebody's phone number for seven years because an invoice exists.
Reading the bewaarplicht as a reason to keep everything is the error this whole
ADR is against.

## The audit log is part of the answer

The entry records what was erased — the name, the email, the phone — and the
reason given. That is what a supervisory authority asks for: not that you
complied, but that you can show when, why, and to what.

It also means the audit log now holds personal data that the contact row no
longer does, and the audit log is append-only and subject to the bewaarplicht
rather than to the erasure. That tension is real and it is resolved in favour
of being able to prove what happened: an erasure nobody can evidence is
indistinguishable from a data loss, and the person who asked for it is the one
worst served by that.

## Consequences

- **An erasure is not a deletion and the API says so.** `POST
/contacts/:id/pseudonymise`, not `DELETE /contacts/:id`. Nothing is deleted:
  the row stays, the postings stay, the invoices keep the buyer they were
  issued to. Naming it `DELETE` would describe the wrong thing to anybody
  reading the log, and would invite somebody to implement the wrong thing
  later.
- **Existing issued invoices were backfilled** from the contact as it stood.
  That is the answer they were already rendering; the migration does not change
  what they say, it stops it changing from here on.
- **`agentExposure: 'none'`.** An erasure answers a legal request made to a
  human. An assistant offering to do it is offering the wrong thing.
- **The XAF still exports the pseudonym** for a contact erased after a period
  was sealed. The sealed snapshot holds the export as it was, which is the
  artefact that proves what the books said at the time; a fresh export is a
  fresh statement about a customer who has since exercised a right.

Nothing here is legal advice and nobody should read it as any. It is the
position this codebase takes, written down so it can be argued with.
