# 0028. Documents that arrive on their own: one queue, two doorways, at-least-once

Status: Accepted
Date: 2026-09-07

## Context

ADR 0026 built the purchase inbox and left a hole in it: everything still got
there because a person dragged a file onto a screen. Spec 6 asks for "a
purchase-invoice inbox that ingests email, PDF, and Peppol UBL into the same
queue", and the milestone table's "inbound Peppol via adapter" means documents
that arrive without anybody doing anything.

Two doorways, then, and they are shaped differently. A mailbox is **asked**; an
access point **delivers**. That difference decides most of what follows.

## The polling half is a port; the pushing half is a route

`InboundSource` describes something you ask: `available()`, `poll(cursor)`,
`acknowledge(ids)`. IMAP fits it and so does a drop directory.

Peppol does not, and forcing it in would have produced an adapter whose `poll`
returned "I am not that kind of thing". An access point posts to
`POST /api/v1/inbox` with `source=peppol` and the transmission id — the same
doorway a mail gateway uses, the same deduplication, the same queue. The
`peppol` row in `inbound_sources` exists so the screen can show the connection
and what has come through it; it builds no adapter and the poller skips it.

## The default needs no third party, and it is not a toy

Spec 8's first rule. The default source is a **directory**: files land in it,
the poller takes them, and what it took moves to `.verwerkt`.

That is not a stand-in for a real transport. It is exactly what a mail server's
delivery hook, a `procmail` recipe, a `fetchmail` run or a scanner writing to a
share already produces — and it means a self-hosted instance can receive
invoices by email **without this process ever holding an IMAP password**. The
credential stays with the thing that was always going to have it. The IMAP
adapter is for people who would rather point it at `facturen@` and be done.

## At-least-once, and the ordering that makes it safe

The order is: poll, ingest each message on its own transaction, record the
outcome, **then** acknowledge. Every part of that is load-bearing.

Acknowledging last means a crash in between leaves the message where it was and
the next poll takes it again. The alternative — mark it processed, then store
it — turns a crash into an invoice nobody will ever see. At-least-once is the
correct failure direction here, and the whole design is arranged so the
duplicate costs nothing:

> **`external_id` is what makes a repeated poll harmless.** The bytes are
> already deduplicated by their hash, but two arrivals of the same document are
> two arrivals and both belong in the queue — the same invoice by email and
> again over Peppol is exactly the case content addressing was for. So "have I
> already taken this message" cannot be answered by the content. Only by the
> transport's own name for it.

What that name is, is per transport: an IMAP UID, a filename in a directory, a
Peppol transmission id. `(entity, source, external_id, part)` is unique, and the
part is positional because two attachments on one message may share a filename.

The cursor moves only on a poll that committed everything. A failed poll that
advanced it would skip whatever arrived while the mailbox was unreachable, which
is the one outcome worse than not polling at all.

**IMAP is searched by UID, not by `\Seen`.** A flag-based search means a human
opening the mailbox in a mail client makes the poller skip messages, which is
the commonest way this goes wrong and the hardest to diagnose afterwards.

## What is filed out of a message, and what is not

An invoice does not arrive alone. It arrives with the sender's logo, their
S/MIME signature, a vCard, a disclaimer, and the thread it was forwarded
through. A queue that takes all of it is a queue nobody reads.

**Keeping is the default; skipping is the exception.** The rules say what to
leave behind — empty parts, parts over 30 MB, S/MIME and PGP signatures,
calendar and contact files, archives, inline images, images too small to be a
photograph of anything, duplicates within one message, and everything past
twenty. Whatever is left is kept, _including formats nothing here can parse_: a
`.docx` invoice is a real thing a real supplier really sends, and a document
nobody can read is still a document somebody can open.

The distinction that earns its keep is `Content-Disposition`. **An inline image
is a signature; an attached one may be a receipt.** A photograph of a petrol
receipt and a logo in a signature are the same JPEG; what tells them apart is
that the logo is marked inline and referenced by the HTML body. Size catches the
sender whose client omitted the disposition.

## Nothing vanishes, including the newsletter

The whole message is stored as `message/rfc822` whatever happens, and a message
every part of which was skipped **still becomes an inbox item** — a discarded
one, holding the message, with the reason on it.

This is the answer to "I emailed it, where is it?". Without it the honest reply
is a shrug, and a shrug about an invoice is how a supplier ends up unpaid. With
it, the newsletter sent to `facturen@` is out of the way rather than gone, and
the day somebody swears they sent something there is a place to look that
answers the question in a sentence.

## Where the receiving logic lives

`receiveDocument` and `ingestInboundMessage` moved out of the web app into
`@klopt/db`, and the handler is now a caller rather than an implementation.

Two doorways into one queue must not drift. If the parsing, the supplier
matching or the deduplication differed between an upload and a poll, an invoice
would behave differently depending on how it arrived — which is the exact thing
"one queue" was meant to rule out. The worker cannot call a server function
(spec 11.1) and the web app should not reimplement the worker, so the shared
step sits below both.

The same applies to the _Nu ophalen_ button: it runs `runInboundPoll`, the code
the schedule runs, so pressing it proves the schedule works rather than proving
something else does.

## A mailbox belongs to an administration, so its password does too

`facturen@ditbedrijf.nl` is not an instance-wide fact the way a signing
certificate nearly is, so a source is a row against an entity rather than an
environment variable. Which means this is the first place spec 8's second rule —
"credentials are per entity, encrypted, entered by the operator" — actually
bites, and it has been an open gap since the filing adapters.

`packages/db/src/secrets.ts` is AES-256-GCM with the key from
`KLOPT_ENCRYPTION_KEY`, which `.env.example` has described since M0 and nothing
read until now. Salted per value through scrypt, so two identical passwords do
not produce identical ciphertext, and authenticated, so a tampered ciphertext
fails to decrypt rather than decrypting to something else.

What it buys, said plainly: a dump, a replica or a backup tape does not hand
somebody a mailbox password. A compromised application process does, because it
holds the key. That is what "encrypted at rest" means everywhere and pretending
otherwise would be worse than not encrypting.

**With no key configured, a password is refused rather than stored as typed.**
Falling back to plaintext is the kind of quiet degradation that is discovered by
somebody else, later, in a dump. Refusing is visible at the moment the mailbox
is set up, which is when it can still be fixed — and it costs a default install
nothing, because the drop directory that ships as the default has no credential
at all. The screen says so before anybody types one in.

Configuration is validated when the source is saved, not at the first poll: a
mailbox that silently never runs is the failure nobody notices for a month.

## Consequences

- **A poll's outcome is on the screen, not in a log.** `last_polled_at`,
  `last_error` and the count are on the row and on the Postvak page, because the
  question this screen raises — the queue is empty, is that because nothing
  arrived or because the mailbox has been refusing a password since Tuesday? —
  cannot be answered by a queue alone.
- **One source failing is one source failing.** Every poll is recorded on its
  own row, and neither a broken mailbox nor an unreachable directory stops the
  one next to it or anybody uploading by hand (spec 8, rule 4).
- **A source never decides what a document means.** It hands over what arrived.
  Whether the sender is a known supplier is settled by the identifiers _in the
  document_ — VAT number, KvK, IBAN — exactly as ADR 0026 set out, and not by
  the email address it came from, which proves nothing. The temptation to let a
  known sender skip the queue is the temptation to file documents nobody looks
  at.
- **Two new dependencies**, `mailparser` and `imapflow`, both MIT and both from
  nodemailer's author, which this repository already depends on. MIME is not
  worth reimplementing: encoded-word filenames, folded base64, nested
  `multipart/related` inside `multipart/mixed` — every one of them is a way to
  lose an invoice, and all of them are already solved.
- **Archives are not unpacked.** Unpacking untrusted archives from a public
  mailbox has a security cost, and a zip of twelve invoices is something
  somebody should look at anyway. It is set aside with a reason that says so.
- **The IMAP adapter is written but not run against a server here.** Its
  configuration handling, its availability rules and its cursor arithmetic are
  tested; the protocol is `imapflow`'s. The drop directory is what the tests and
  the walk-through exercise end to end, and it is the default for that reason.
