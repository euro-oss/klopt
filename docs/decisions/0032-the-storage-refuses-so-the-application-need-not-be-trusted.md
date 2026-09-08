# 0032. The storage refuses, so the application need not be trusted

Status: Accepted
Date: 2026-09-08

## Context

Spec 7.6 asks for "object storage with object lock or WORM mode, with a
retention date computed per document from its fiscal year." ADR 0030 built the
date, the hold and the deliberate deletion — all enforced by the application,
over a directory that obeys whoever calls it. The retention screen said so, in
those words, because a compliance screen implying a guarantee the storage does
not make is worse than no screen.

This is the other half: a store that says no.

## Why SigV4 is written out rather than pulled in

`@aws-sdk/client-s3` would sign these requests, and a great deal else, at the
cost of a large transitive tree in the code path that holds statutory records.
For a tool whose pitch includes being auditable and self-hostable, that tree is
a real cost.

The reason it is _safe_ to write out here is the same reason the Digipoort
WS-Security signer was deliberately **not** (ADR 0024): whether a signature is
correct is either verifiable locally or it is not. Digipoort needs a PKIoverheid
certificate and a run against Logius pre-production, so an unverified signer
there would have been a guess dressed as an implementation. S3 needs MinIO,
which has been in `compose.yaml` with an object-lock bucket since M0 and is what
the tests run against. A wrong signature fails on the first request.

Scope: six operations, and keys that are always lowercase hex sha256 — which
removes the entire class of URI-encoding bugs that makes signing S3 requests
unpleasant.

## The lock is applied when the term is known, not when the bytes arrive

The awkward and load-bearing decision.

Object lock is set per object and can be **extended but never shortened**. At
the moment bytes arrive, their retention term is _unknown_: it is counted from
the book year of whatever the document turns out to be evidence for (ADR 0030),
and a receipt uploaded today may belong to 2018. Locking at PUT time with a
guess would hold that receipt until 2033 and, under a compliance lock, nothing
could ever undo it.

So bytes are stored unlocked, and the lock is applied when the term is derived —
the same moment the database column is written, in `applyRetention`. Deriving a
term and not pushing it at the store would be the application promising
something the storage had never been asked to keep.

The window between the two is real, and the screen counts it rather than hiding
it: _"the storage holds 41 of the 47 documents with a known term"_. A document
in that gap is protected by the application and not by the storage, which is a
third state and deserves to be visible as one.

## Two bugs only a real store could show

**A plain DELETE on a versioned bucket succeeds on a locked object.** Object
lock requires versioning, and on a versioned bucket `DELETE` without a version
id writes a _delete marker_ rather than removing anything. That call succeeds
even when the current version is locked, and a subsequent `HEAD` then answers
404 because the marker is current. The obvious implementation therefore reported
`deleted` about bytes still sitting there under their lock — the exact lie the
three-way outcome type was introduced to prevent. Versions have to be named and
deleted by id, markers included.

Neither the filesystem store nor a mock could have shown this.

**A refusal does not have one shape.** MinIO answers **400 InvalidRequest**
with "Object is WORM protected and cannot be overwritten"; AWS answers **403
AccessDenied**. Matching on the status alone read MinIO's refusal as a fault and
threw — a different wrong answer from the one it replaced. And matching on the
body alone would call a 200 containing the word a refusal. Both halves are
needed.

## `deleted`, `absent`, `locked` — three facts, not two

`DocumentStore.delete` used to return a boolean, which conflated "there were no
bytes" with "the store would not let go". Those are entirely different facts and
the caller has to tell them apart:

- `absent` is not an error. A store that already lost the bytes and one that
  just dropped them are the same state, and a retry of a half-finished run has
  to be able to say so.
- `locked` is **the store working**, not failing. Reporting it as success would
  tell a compliance screen that statutory records were destroyed while they are
  still there. The deletion response now carries `refusedByStorage`, the audit
  log records it, and the screen says it out loud.

The row is still marked deleted in that case, and that is right: the row is the
administration's record of _its own decision_, and the bytes outliving it is a
separate fact that is now also recorded.

## A retention class may be extended and not shortened

Closing the one reachable way the application's term and the storage's could
disagree.

A term derived from a book year only ever grows — a document linked to several
subjects takes the latest year. The only path downwards was reclassifying from
ten years back to seven, which would drop the database's term below the one the
store is holding and leave the store correctly refusing a deletion the
application had started offering. Two systems disagreeing about a statutory
obligation is the one thing this pair must never do.

Refusing it costs nothing, because under a compliance lock the storage would not
have honoured the reduction anyway.

## Compliance by default, and configurable because reality

`compliance` cannot be bypassed by anybody, including the account root.
`governance` can, by a caller holding `s3:BypassGovernanceRetention`. The
bewaarplicht wants the first.

The cost of compliance mode is that a term set too long is permanent — which
costs storage rather than compliance, and is the safe direction. It is
configurable because somebody migrating an existing bucket may not have the
choice.

## All four settings or none

Setting `KLOPT_S3_ENDPOINT` without the bucket and credentials is refused at
boot rather than falling back to a directory. A silent fallback would put
statutory records somewhere nobody meant, and the failure would surface as a
missing document years later. An endpoint with no credentials is a mistake
somebody should hear about immediately.

The choice itself lives in `@klopt/adapters`, because the worker makes it too —
the snapshot job and the mailbox poller both write documents — and two processes
disagreeing about where documents live is a class of bug worth making
impossible.

## Consequences

- **`mc mb --with-lock` only works at creation.** The compose file's
  `--ignore-existing --with-lock` will happily leave an existing bucket without
  a lock, which is a trap: the stack comes up, everything works, and nothing is
  actually held. `.env.example` says so. A bucket made before object lock was
  wanted has to be recreated.
- **A failure to lock does not fail the caller.** The callers are a preview and
  a deletion, and neither should break because the object store was briefly
  unreachable — nor is either made _unsafe_ by a missing lock, since the
  application's own policy still refuses. Refusals are counted and shown.
- **Tests now say which store they exercise.** `retention.test.ts` installs a
  filesystem store explicitly and `retention-worm.test.ts` installs an S3 one.
  Before that, the first silently switched store depending on whether the
  developer's shell had `KLOPT_S3_ENDPOINT` set — a test whose subject depends
  on the environment is a test that proves something different on every machine.
  The browser suite is pinned to a directory for the same reason plus a second
  one: it is about screens, and sending every upload over the network to MinIO
  made it slower and flakier without testing anything the S3 tests do not.
- **The exports bucket is not used yet.** `KLOPT_S3_EXPORTS_BUCKET` has existed
  since M0 and nothing reads it. A sealed snapshot's XAF and manifest currently
  go into the documents bucket, which is defensible — they are documents, and
  they inherit retention there — but "written to the WORM bucket" could mean a
  separate one, and it is worth deciding rather than drifting.
- **The bucket is asked, not assumed.** Writing the consequence above down was
  what made it obvious it should not be one: reporting `objectLock: true` on the
  strength of the store's _class_ is the same unverified claim this whole ADR is
  against. `verifyLock` calls `GetObjectLockConfiguration` once and caches it —
  the answer cannot change without recreating the bucket — and the screen prints
  what the bucket said. A bucket without a lock gets the reason and the
  instruction to recreate it, which is tested against the exports bucket that
  genuinely has none.
