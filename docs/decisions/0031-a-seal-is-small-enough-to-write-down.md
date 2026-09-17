# 0031. A sealed snapshot is small enough to write down

Status: Accepted
Date: 2026-09-08

## Context

Spec 7.6's fifth bullet:

> **Periodic sealed snapshots**: a scheduled XAF export plus a manifest of
> document hashes, written to the WORM bucket. This is your "prove nothing
> changed" artefact.

The obvious reading is "take a backup on a timer". That would be a worse
artefact than it looks, because a backup proves nothing on its own: two copies
that differ tell you something changed and not which one is right, and the party
holding both copies is the party being asked to prove it did not alter either.

## What makes an artefact evidential is that it is small

A snapshot here is three hashes and a list:

- **The chain head** — one value covering every posting, because each journal
  entry hashes its own canonical content plus its predecessor (spec 6.2). An
  inspector who records it in March can check it in September without reading a
  single entry.
- **A manifest of document hashes** — because the journal chain says nothing
  about the PDFs behind it.
- **The auditfile's hash** — because the export is what gets handed over, and an
  exporter can change what it says about a closed year.

And then one hash over the canonical text of all of that: **the seal**.

The seal is sixty-four characters. It can be written down, emailed to an
accountant, put in a WORM bucket, or read out over the phone, and any of those
is enough to detect a change in seven years of books. That is the property a
copy does not have, and it is why the artefact is a manifest rather than an
archive.

The walk-through is the proof it works: `curl` the manifest, `shasum -a 256` it,
and compare with the seal the API returned. Two identical hashes, with no
software of ours in the loop. That is what "verify us rather than trust us"
means in practice.

## Growth is not drift, and getting that wrong makes it useless

The single most important behaviour. An administration is _expected_ to gain
entries and documents and to move its chain head. A snapshot that reported any
of that as tampering would fail by Tuesday and be switched off by Wednesday.

So verification only reports things that say the **past** is different:

| Reported                                             | Not reported                          |
| ---------------------------------------------------- | ------------------------------------- |
| The seal not matching its own manifest               | New entries                           |
| The chain no longer verifying against its own hashes | A moved chain head at a longer length |
| A different head at the _same_ entry count           | New documents                         |
| Fewer entries than were sealed                       | A document deleted under its term     |
| A document gone without being recorded as deleted    |                                       |
| A document back after being sealed as deleted        |                                       |
| A resized document                                   |                                       |

A broken seal is reported **alone**. Every other comparison is against that
manifest, and conclusions drawn from a manifest known to be tampered with are
worse than no conclusions.

## The head moving and the chain breaking are different questions

This is the thing the walk-through caught, and it would have shipped without it.

The chain head is the last entry's **stored** hash. So somebody who rewrites a
description and leaves the `hash` column alone changes the books and moves no
head at all — and a comparison of heads says nothing. I watched exactly that:
an entry rewritten behind the application, and `verified: true`.

What notices is recomputing each entry's hash from its content, which
`verifyHashChain` has done since M0. Verification now runs it and reports
`chain_broken`, which is the check that actually catches content tampering.
Comparing heads is the _other_ half — it catches somebody who rewrites an entry
**and** its hash, leaving a chain that verifies internally and no longer matches
what was sealed. Neither check substitutes for the other, and only having the
second one is the shape of a security control that inspects the wrong thing.

## Seals chain, for the same reason entries do

Each snapshot records the previous one's seal. Removing a snapshot from the
middle of the sequence becomes visible rather than leaving a tidy gap. The
predecessor is read inside the same transaction that writes the new row, so two
concurrent seals cannot both claim the same one and fork a chain whose whole
purpose is not to.

## The expensive half of a verification is opt-in, and says so

Re-exporting the auditfile and comparing its bytes is slow, and it is the check
that fires benignly when the exporter improves. So it is off by default — and
the result carries `auditFileChecked: false` when it was skipped.

"Verified" with a check quietly skipped is a lie by omission, and a compliance
surface that tells one is worse than one that admits its limits.

## Both artefacts become ordinary documents

The XAF and the manifest go into the content-addressed store and get rows in
`documents`, which puts them under the bewaarplicht, the append-only guard and
the deduplication rather than each needing its own version of all three.

Resealing an unchanged year stores no second copy of an identical auditfile.
That is deduplication earning its keep on precisely the case it was designed
for.

The manifest text is _also_ kept on the snapshot row. A few kilobytes, and it
means a seal stays checkable when the store is unreachable — which is exactly
the moment somebody would want to check one.

## Sealing writes; seeing is a read

Sealing needs `ledger:export`; listing needs only `ledger:read`. That asymmetry
is deliberate: producing the artefact is a compliance act, and _seeing that one
exists_ is something anybody looking at the books should be able to do. A seal
nobody can see is a seal nobody checks.

`agentExposure: 'none'` on both writes. An agent proposing "seal the year" is
harmless and an agent proposing "verify it" is noise; neither belongs in a
review queue.

## Periodic means a job, and only for years that need one

A nightly sweep seals every book year that has postings and no snapshot. A year
already sealed is **not** resealed nightly: three hundred and sixty-five
near-identical artefacts would bury the one that mattered. Resealing is
deliberate and has its own button.

That means a year sealed in March and posted into in April carries a March
snapshot, which is correct — the snapshot says what was true when it was taken,
and growth is not drift.

The sealing itself lives in `@klopt/db` rather than in a handler, for the same
reason `receiveDocument` does: the worker cannot import the web framework (spec
11.1), and two callers producing different manifests would make a snapshot mean
something different depending on who asked for it. A snapshot whose meaning
depends on its caller is not evidence.

## Consequences

- **`manifestSha256` and `seal` are the same value.** Both are the sha256 of
  the manifest text — one is its address in the store, the other is the seal.
  Kept as two columns because they answer different questions and a future
  manifest format might separate them; noted here so nobody spends an afternoon
  wondering.
- **A raw NUL byte reached the manifest and Postgres refused it.** Second
  occurrence in this repository of the same slip: a NUL written as a literal
  byte where an escape was meant. It is now a placeholder that reads as `-`, and
  `packages/core/test/source-hygiene.test.ts` walks the whole source tree and
  fails on any raw NUL — which immediately caught one in its own docstring. The
  byte is worth a guard because of how it fails: `grep` treats the file as
  binary and silently reports nothing, Postgres raises an encoding error from an
  unrelated code path, and an editor shows nothing at all.
- **The WORM half is not here yet.** Spec 7.6 says "written to the WORM
  bucket", and the default store is a directory with no object lock. The
  retention screen already says so (ADR 0030); an S3-compatible store with
  object lock is the next slice, and a sealed snapshot is exactly the artefact
  it should hold.
- **Nothing publishes a seal outside the system.** Writing it down is currently
  a human act. Emailing each new seal to the accountant, or posting it somewhere
  append-only outside the instance, is the step that turns "we can detect a
  change" into "we cannot hide one" — and it is worth doing.
