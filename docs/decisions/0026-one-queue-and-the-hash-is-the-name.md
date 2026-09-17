# 0026. One queue for everything that arrives, and the hash is the document's name

Status: Accepted
Date: 2026-09-07

## Context

Spec 6 asks for "a purchase-invoice inbox that ingests email, PDF, and Peppol
UBL into the same queue". Spec 7.5 adds "accept UBL, parse into a draft purchase
invoice, attach the original XML, and route into the approval queue". Spec 7.6
says how the original is kept: "every source document is stored with a SHA-256
content hash and linked to its postings. Documents are content-addressed and
deduplicated."

## One queue

Not three. The work in front of a bookkeeper is the same work whatever route the
document took — look at it, decide whether it is an invoice for us, and if it is,
say what the cost was for. A UBL arrival has most of that filled in and a PDF has
none of it, and they still belong in the same list, because **a queue you have to
check in two places is a queue that gets checked in one.**

So `receiveDocument` is one operation. What differs between an upload, a mail
gateway and a Peppol access point is who calls it and what they put in `source`.

## Stored first, understood second

The bytes go into the store and get a row **before** anything is parsed. A
document we cannot read is still a document somebody can open, and the commonest
arrival — a scanned PDF — is exactly that. Losing it because the parser did not
like it would be the worst thing an inbox could do.

Reading is therefore best-effort and never a refusal. XML that turns out not to
be a UBL invoice lands in the queue with the reason attached. Only two things are
refused outright: an empty file, and a document whose parse _succeeded_ but which
somebody then tries to draft from twice.

The parse result is **stored, not recomputed**. A reader that improves next month
must not silently change what an operator was shown last week — the same reason
a filing keeps its snapshot rather than a pointer (ADR 0022).

## The hash is the name

Content addressing buys three things at once, and only one of them is disk space.

**Deduplication is how the inbox knows.** The same invoice emailed and then sent
over Peppol is one set of bytes and two arrivals. Both items point at one
document row, both say "you have seen this before", and drafting from the second
is refused because the first became an invoice. Without the hash, that is two
unrelated files with different names that somebody has to notice are the same.

**Tamper-evidence is free.** The address _is_ the digest, so a stored document
that has been altered no longer answers to its own name. The bewaarplicht runs
seven years and its test is that the administration stays accessible, readable
and controllable; bytes that can quietly change are none of those. `documents` is
append-only under the same trigger the journal uses.

**There is nothing to name.** No filename collisions, no directory scheme to
migrate, no question about two people uploading `factuur.pdf`. The filename is
metadata on the arrival, because two arrivals of the same document may well have
been called different things.

The default store is a directory, two levels of fan-out, writes renamed into
place. Spec 8's first rule: the implementation that needs no third party is the
default. Nobody should have to run object storage to keep books.

## What the reader decides and what it does not

Three rules, and the second and third are the interesting ones.

**The supplier's figures are taken as stated.** `LegalMonetaryTotal` is what we
owe. Recomputing it from the lines would replace the document with our
arithmetic, which is the same mistake ADR 0025 refuses on a typed invoice. When
the two disagree it is reported — usually a document-level charge or allowance,
which is not read here — and both figures are kept as they are.

**The account is not in the document.** Which cost account a line belongs on is a
judgement about what was bought, and no UBL field records it. So every line is
parked on the tussenrekening, visibly and wrongly, until somebody codes it.
Guessing would put a laptop in stationery, and a guess that is already made is a
guess nobody looks at.

**The tax code is ours, not theirs.** A UBL invoice carries a category and a
percentage, which say what the _sender_ did. What we may deduct depends on what
the cost is for — a lunch is not fully deductible however the restaurant
categorised it. So the parse _suggests_ and a human confirms, and drafting with
an unconfirmed code is refused rather than accepted.

The suggestion has one rule worth stating: it never offers the **deduction half
of a reverse-charge pair**. That code looks exactly like an ordinary domestic
input code — same scope, same rate, fully deductible — and in an alphabetically
sorted chart `VERL-VOOR` comes before `VH21`, so it won. Suggesting it for a
normal invoice would put the VAT in rubriek 5b with no matching liability in 2a
or 4b: an understatement nothing downstream would catch. A code that another code
names as its `deductionCode` is only ever reached through that code, so it is
excluded. Found by a browser test.

## Matching a supplier

By identifier only, in order of how much each one proves: VAT number, then KvK
number, then IBAN. **The name is not tried.** "Jansen B.V." matching the wrong
Jansen is worse than no match at all, because nobody looks at a match that has
already happened. Two suppliers sharing an identifier is a question rather than
an answer, so it resolves to nothing.

An unmatched document sits in the queue and asks. That is the correct outcome,
not a failure.

## Discarding keeps the document

Setting an arrival aside needs a reason — the next person has to know — and it
does **not** delete the bytes. Discarding says "this is not an invoice for us",
not "these bytes never existed", and the bewaarplicht does not care what somebody
meant to send. An item that already became a draft cannot be discarded at all:
that would leave an invoice with no original attached.

## Consequences

- **The round trip is now a test.** An invoice this system issues, fed back in as
  a document, matched to its sender, drafted, coded and booked — with the VAT
  landing in rubriek 5b. If the outbound and inbound halves ever disagree about
  what a UBL invoice is, that is where it shows, with a document we can
  regenerate rather than one a counterparty sent us once.
- **Email and Peppol are callers, not code.** `source` distinguishes them and the
  REST route takes `multipart/form-data`, so a mail gateway or an access point
  posts the same shape a file input does. The transports themselves — an IMAP
  poller, an inbound Peppol adapter — are separate work and belong behind the
  existing `EInvoiceTransport` port.
- **No OCR, and no attempt at one.** A PDF is stored, shown and openable, and the
  invoice behind it is typed. Reading amounts out of a scan and getting them
  nearly right is worse than not trying, because the figures are the one thing
  this system will not guess at.
- **Documents are per entity.** Two administrations that receive the same file
  each keep their own row; the bytes are shared in the store, the record of
  holding them is not. An accountancy firm's clients do not learn about each
  other's post.
