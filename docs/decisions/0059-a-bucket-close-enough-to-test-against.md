# 0059. A bucket close enough to test against

Status: Accepted
Date: 2026-09-18

## Context

The object-storage specs were written against the MinIO in `docker-compose.yml`
(ADR 0032), and they fail without it. `pnpm run test` runs them, `pnpm run
verify` runs that, and CI runs `verify` — with a Postgres service and no MinIO.
So two files failed on every push for a reason that had nothing to do with the
code, and a suite that is red on nobody's machine stops being read. That is the
whole of it (issue #4).

Three ways out, and the choice between them is the decision.

**Add MinIO to the workflow.** Every pull request then waits on an image to
pull, a bucket to be created with `--with-lock`, and a health check to pass,
twice over, because `verify` runs on two Node versions. It buys a real bucket in
CI — but not a real _S3_: MinIO is itself an implementation of somebody else's
API, so a runner that goes green has proved the store works against MinIO and
nothing more. The same thing a developer's laptop already proves, at the cost of
minutes on every push and a service that can be down for reasons nobody in this
repository can fix.

**Replace the store with a stub at the port boundary.** `DocumentStore` is a
small interface and a stub of it is twenty lines. It would also delete the only
thing those specs were for. `WormDocumentStore` exists because object storage
behaves in ways the application has to cope with — versions, delete markers, two
refusal shapes, a lock that extends and never shortens — and a stub that answers
`locked` because a test told it to proves none of it. ADR 0032 records two bugs
that only a real bucket revealed; a stub is how they would come back.

**Skip them in CI.** Honest, and worthless: the specs that matter most are the
ones about a store refusing to destroy statutory records.

## Decision

The seam goes one level lower than the port: **an S3-compatible object-lock
bucket in the test process, on a loopback port.**

`startFakeS3` (`@klopt/adapters/testing`) speaks the six operations the store
makes plus the two bucket-level calls it needs. Everything above the socket is
production code — the real `createS3DocumentStore`, the real hand-written SigV4
signer, a real HTTP round trip — and only the bucket on the other end stands in.

It models the three behaviours the store exists to cope with, rather than the
happy path:

- **Versions, including delete markers.** A `DELETE` that names no version
  writes a marker and **succeeds on a locked object**, exactly as a versioned
  bucket does. That is the bug in ADR 0032: the naive implementation reported
  `deleted` about bytes still sitting there under a compliance lock, because the
  following `HEAD` answered 404. `s3.test.ts` now walks into the trap
  deliberately and asserts both halves — that the naive call succeeds and lies,
  and that the store's own delete names the version and is refused.
- **Compliance retention, monotonic.** A later date extends, an earlier one is
  refused, and an object has no lock at all until somebody asks for one, because
  bytes arrive before their term is known.
- **Both shapes a refusal comes in.** MinIO answers 400 `InvalidRequest` with
  "Object is WORM protected"; AWS answers 403 `AccessDenied`. The store matches
  on the status _and_ the body for that reason, and against a real MinIO only
  one of those branches could ever be exercised. The fake takes the shape as an
  option, so both are.

Signatures are **verified, not accepted**. The verification is written out
separately from the signer rather than calling it back, because a fake that
asked `signS3Request` what it expected would accept any signature that function
produced, including a wrong one. Deriving it from the request that arrived means
the two can disagree: a dropped signed header, a reordered query or a payload
hash that is not the payload's fails here.

**The real bucket stays, as an opt-in.** MinIO remains in `docker-compose.yml`,
and both suites run against whatever `KLOPT_S3_ENDPOINT` points at:

```
docker compose up -d minio minio-init
KLOPT_S3_ENDPOINT=http://localhost:9000 pnpm run test
```

That is not ceremony. ADR 0032 allowed a hand-written SigV4 signer on the
grounds that "whether a signature is correct is either verifiable locally or it
is not", and a fake does not settle it: a shared misreading of the algorithm
would satisfy both sides. A real bucket is still the only thing that can say
MinIO accepts these requests, so the claim moves from "CI proves it" to "a
developer with the stack up proves it, and CI proves everything else".

## Consequences

- **CI needs Postgres and nothing else.** No MinIO service was ever in
  `.github/workflows/ci.yml`; the fix was in the tests, not the workflow. The
  ledger tests still run against a real Postgres on purpose — the triggers are
  half the guarantee there, and unlike object storage, Postgres in Actions is
  one service block and no bucket to create.
- **A test double ships in `dist/`.** `@klopt/adapters/testing` is built like
  `@klopt/db/testing`, because two suites need the same double and a copy in
  each is two things to keep in step with one protocol. It is deliberately not
  re-exported from the package's main entry point: a double one import away from
  production code is a double that eventually ends up in it.
- **Two things are now tested that a real MinIO cannot test.** The AWS-shaped
  refusal, and that the bucket rejects a bad signature at all — which is what
  makes the rest of the file mean anything.
- **The fake is a thing that can be wrong.** It is roughly four hundred lines of
  somebody else's protocol, and a bug in it looks like a bug in the store. The
  mitigations are that it is only ever wrong in one direction the specs care
  about — it refuses more readily than it accepts — and that the same specs run
  against MinIO on demand, which is where a disagreement would show up.
- **The browser suite needed nothing.** It has been pinned to a directory since
  ADR 0032, with `KLOPT_S3_ENDPOINT` explicitly emptied in
  `playwright.config.ts`, because those specs are about screens and sending
  every upload over the network tested nothing the S3 specs do not. So there is
  no Playwright upload that requires object storage, and none to justify.
- **The development stack is unchanged.** `docker compose up -d` still brings up
  Postgres and MinIO with an object-lock bucket, which is what running the
  application locally against real object storage takes. What changed is that
  running the _tests_ no longer does.
