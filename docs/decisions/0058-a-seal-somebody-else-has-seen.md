# 0058. A seal somebody else has seen

Status: Accepted
Date: 2026-09-17

## Context

The sealed snapshot (spec 7.6) is the "prove nothing changed" artefact, and
ADR 0032 and the manifest's own comment both make the case for why it works: a
chain head, a list of document hashes, an auditfile hash, and one hash over all
of it. Small, self-verifying, and enough to detect a change in seven years of
books.

It has one gap, and the note carried since M5 named it: **the seal is entirely
ours.** Every number in it was computed by this instance, including the date.
An inspector asking when a year was sealed has our word for it — in precisely
the situation where our word is the thing in question.

## An authority signs the hash, and learns nothing else

RFC 3161 is the standard answer and it is a good fit here. A timestamp
authority takes a hash and returns a signed "I saw this at this time". It is
one HTTP POST with no authentication, no session and no account.

What it receives is 32 bytes over a manifest that is itself a few kilobytes.
Nothing about the administration leaves the building — not a figure, not a
contact, not the size of the business. It is the smallest possible thing to
tell a third party and the largest possible thing to be able to prove.

`KLOPT_TIMESTAMP_URL` is unset by default, per spec 8's first rule: a fresh
install needs no third party.

## It may never fail a seal

`stamp` does not throw and does not reject. An unreachable authority is an
outcome — `{ kind: 'unavailable', reason }` — recorded on the snapshot.

This is the decision the rest follows from. A nightly sealing sweep that
stopped producing evidence because somebody else's HTTPS endpoint was down
would be a compliance job that fails silently for reasons nothing to do with
the books, and it would fail in exactly the months nobody is watching. A seal
without a witness still detects a change; it just cannot date itself. That is
worth having.

`timestamp_reason` is filled when there is no witness, because "there is no
authority configured" and "the authority refused" and "the authority timed
out" are three different facts and a null is none of them.

## What is verified, and what is deliberately not

The client checks three things: that the reply was granted, that the imprint in
the token is the seal we asked about, and that the nonce is the one we sent.
Those catch a refusal reported as a success, a proxy answering with somebody
else's token, and a replayed one.

It does **not** verify the TSA's signature. That needs the authority's
certificate chain and a decision about whether to trust it, and neither is ours
to make — the party checking the evidence is the party who has to trust the
authority. So the whole reply is stored verbatim and
`GET /snapshots/{id}/timestamp` hands it over as a file, which is what
`openssl ts -verify -in reply.tsr -data seal.txt -CAfile chain.pem` takes.

Claiming a verification we cannot ground would be worse than not claiming one.
"Verified" is the word an auditor stops reading after.

## Re-reading the stored token

`snapshot.verify` now re-parses the stored reply and checks it still attests to
the row's seal. That catches the one tampering the rest of the verification
cannot see: a row whose seal was edited while its token was left alone would
otherwise present a real authority's timestamp as evidence for a number it
never covered.

`ok` is `null` when there is no witness. Neither `true` nor `false` is honest
about a check that did not run, and a boolean here would make an unwitnessed
snapshot look either verified or broken.

## Hand-rolled ASN.1, tested against OpenSSL

There is no dependency for this. The request is about sixty bytes of DER and
the reply needs four fields out of a CMS structure; a general ASN.1 library
would be a large surface to add for that, and none of the small ones is
obviously maintained.

The risk with hand-rolled DER is real and specific: **an encoder tested only
against its own decoder agrees with itself and with nothing else**, and the
failure appears the first time a real authority reads it. So the fixtures are a
real `openssl ts -query` and a real `openssl ts -reply` from a throwaway TSA,
and the encoder is asserted byte-for-byte against the first.

Two DER rules are enforced rather than assumed, because they are where this
goes wrong:

- **Minimal lengths.** Accepting a non-minimal one means two byte strings can
  mean the same thing, which inside a signed structure is how a signature ends
  up covering something other than what was read.
- **Two's complement integers.** A nonce whose first bit is set needs a leading
  zero. Without it the value is negative, the authority echoes something else,
  and every reply looks replayed.

## Walked against a real authority

A throwaway TSA — `openssl ts -reply` behind an HTTP server — was stood up, a
year sealed against it over the API, and the reply downloaded from
`GET /snapshots/{id}/timestamp`:

```
$ openssl ts -verify -digest 43d43efba99a… -in downloaded.tsr \
      -CAfile ca.crt -untrusted tsa.crt
Verification: OK

$ openssl ts -verify -digest <a different hash> -in downloaded.tsr …
message imprint mismatch
Verification: FAILED
```

That is the whole claim, checked by the tool an auditor would use, with no
Klopt code in the loop. It also found the one thing the unit tests could not:
the bytes have to survive storage and base64 exactly, because the signature is
over precisely those and one byte of helpfulness in the middle breaks it.
There is now a test asserting that equality.

## Consequences

- Migration 0030 adds five nullable columns to `sealed_snapshots` and a check
  constraint: a token, its authority and its time go together or not at all.
- `sealFiscalYear` takes a witness. Both callers — the API and the worker's
  nightly sweep — resolve it from the same environment, so a year's snapshots
  do not end up half witnessed for a reason nobody can reconstruct.
- `GET /api/v1/snapshots/{snapshotId}/timestamp` is a binary read, alongside
  the manifest. 118 operations now.
- The token is not on the list response: it is a couple of kilobytes of base64
  per row and a list is not where somebody reaches for evidence.
- Nothing in the UI yet. The download is on the API, which is where an
  accountant's script or an archival job will want it; a button can follow.
