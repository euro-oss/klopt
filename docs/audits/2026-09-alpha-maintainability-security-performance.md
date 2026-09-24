# Alpha audit: maintainability, security, performance

Status: findings only. No product changes in this document.
Date: 2026-09-24
Scope: `euro-oss/klopt` at `main` (`21d9b55`, 0.1.0 Alpha plus unreleased work on that commit).
Audience: whoever is waiting on the accounting-firm review and planning `beta-firm` (listen / stabilize).

Effort used below: **S** = one focused change, **M** = a handful of changes in one subsystem, **L** = a workstream. "Fits `beta-firm`" means hygiene or a footgun worth closing while stabilizing, not a new compliance feature.

## How this was done

Read of the architecture, security policy, ADRs, handlers, repositories, migrations, worker, and CI. `pnpm audit` against the lockfile on 2026-09-24. A search of the tree for common secret material (private keys, cloud tokens) found none; no scanner report is attached. The full `pnpm run verify` suite was not re-run: this change is a markdown file, and verify needs Postgres, a Peppol fetch, and a full build. CI on the PR is the gate.

Open issues [#14](https://github.com/euro-oss/klopt/issues/14) and [#15](https://github.com/euro-oss/klopt/issues/15) were read and not closed. Overlap is noted on the relevant findings.

## Executive summary

- No unauthenticated cross-tenant read, SQL/XML injection, or journal-mutation bypass turned up on the paths reviewed. Isolation tests, append-only triggers, hashed tokens, and hashed OTPs are real.
- The sharpest security issue is same-origin document viewing: an email attachment or upload labelled `text/html` (or SVG) is stored and served `inline`, and the inbox opens that URL in a new tab. A bookkeeper who opens it runs the sender's script as themselves.
- Webhook delivery is an authenticated blind SSRF. Registration requires `https://`, but `fetch` follows redirects, including to plain HTTP and private addresses, and nothing checks the resolved IP.
- Sign-in without SMTP writes the OTP into the process log. That is the documented bootstrap. A production container does not refuse it. There is also no switch to close self-service signup after the first administration exists.
- If `KLOPT_BASE_URL` is left unset, auth always receives `http://localhost:3000`. better-auth then issues a non-`Secure` session cookie even when `NODE_ENV=production`, because a static base URL wins over the production default.
- Every dashboard load re-reads and re-hashes the whole journal. Contact, purchase-invoice, and inbox lists have no limit; opening one inbox item reloads the entire inbox.
- `docs/ALPHA_ASSESSMENT.md` (2026-09-18) is stale, and `docs/architecture.md` still calls it the authoritative picture. Playwright is in CI. The REST surface is 118 operations, not 119. Dark mode and the bank-match keyboard described there are no longer what the code does.
- Digipoort, a Peppol access point, PSD2, and a hosted EU offering are not shipped. The README, changelog, and adapter code say so. `GOVERNANCE.md` describes a future hosted gateway and also claims signed releases with a workflow in the repo; `v0.1.0` has no checksums, signature, or release workflow.
- `pnpm audit` reported one moderate advisory, esbuild via `drizzle-kit` (a devDependency). It is not on the request path of a production image.
- [#14](https://github.com/euro-oss/klopt/issues/14) is largely done on this commit (fiscal year in the report URL). The BTW year screen still defaults to the calendar year. [#15](https://github.com/euro-oss/klopt/issues/15) is still open in code comments; this audit does not add that API work.

## Critical

None recorded. The checks that would have produced one — another entity's rows by id, a second journal write path, DTD/external entities, plaintext adapter secrets, an MCP method before the token check — are either enforced and tested or absent. See non-findings.

## High

### H1. Inbox documents render attacker-controlled HTML on the application origin

- **Area:** security
- **Evidence:** `receiveDocument` stores the caller-supplied content type, or the MIME type from the mail parser, with no allowlist (`packages/db/src/inbound/receive.ts`, `packages/adapters/src/inbound/mime.ts`). `GET /api/v1/documents/:id` returns those bytes with that `content-type` and `Content-Disposition: inline` (`apps/web/src/routes/api/v1/documents.$documentId.ts`). The inbox links there with `target="_blank"` (`apps/web/src/routes/_app/inbox.tsx`). The session cookie is `SameSite=Lax` and is sent on that same-origin navigation (`packages/db/src/auth.ts`). A `text/html` or `image/svg+xml` body can then call `/api/v1` as the signed-in user. The untrusted source is ordinary: a supplier mail dropped in the purchase inbox.
- **Fix direction:** Allowlist types that are safe to show inline (PDF, PNG, JPEG). Everything else, including XML and HTML, as `Content-Disposition: attachment` with `X-Content-Type-Options: nosniff`. A `Content-Security-Policy: sandbox` on the document response is a second line. Do not trust the client `Content-Type` or the attachment's.
- **Effort:** S
- **Milestone:** `beta-firm`

### H2. The dashboard re-verifies the entire hash chain on every load

- **Area:** performance
- **Evidence:** The dashboard loader always calls `verifyChain()` alongside the work queue and the trial balance (`apps/web/src/routes/_app/index.tsx`). That handler loads every journal entry for the entity, then every line (`packages/db/src/repositories/ledger.ts` `loadChain`, `apps/web/src/api/handlers/ledger.ts` `handleVerifyChain`). Trial balance itself is incremental and is not the problem. Chain verification is a separate, already-existing endpoint; it does not have to run to paint the queue.
- **Fix direction:** Drop `verifyChain()` from the dashboard loader. Show the last recorded head hash, or a worker result, and keep the explicit chain-verification call for when somebody asks. A checkpoint (verify only entries after the last good head) is the larger version.
- **Effort:** S to stop blocking the dashboard; L for incremental verification
- **Milestone:** `beta-firm` for the loader change

### H3. Daily lists are unbounded, and one inbox read loads all of them

- **Area:** performance
- **Evidence:** `listContacts` returns every contact (`packages/db/src/repositories/sales.ts`); `contactsQuery` has no limit (`apps/web/src/api/schemas.ts`). Purchase `list` has no limit (`packages/db/src/repositories/purchase.ts`). Inbox `list` returns every item including the `parsed` JSON (`packages/db/src/repositories/inbox.ts`). `get` is implemented as `list(entityId)` plus `.find()`, so opening one item reads the whole inbox. Journal entries, the audit log, and events already use capped cursors. These three do not.
- **Fix direction:** Default and maximum page sizes, cursor on a stable column, and a point query for inbox `get`. Leave `parsed` off the list projection.
- **Effort:** M
- **Milestone:** `beta-firm`

### H4. `ALPHA_ASSESSMENT.md` will send the backlog at the wrong work

- **Area:** maintainability
- **Evidence:** `docs/architecture.md` tells the reader that `ALPHA_ASSESSMENT.md` is the authoritative current picture. That file (2026-09-18, commit `a77f8c2`) says Playwright is not in CI; `.github/workflows/ci.yml` has an `e2e` job that runs it. It says 119 route bindings; `apps/web/src/api/manifest.ts` and the README agree on 118. It still lists year-close, XAF import, search, and a theme toggle as missing; the unreleased changelog on this commit describes those screens. It still describes bank-match keys `1`–`9` and `x`, which the changelog says were removed.
- **Fix direction:** Put a banner on the assessment: superseded for planning by the changelog and by this audit. Do not treat it as the backlog. A short rewrite of the "missing for alpha" tables can wait until someone is actually scheduling from it.
- **Effort:** S for the banner; M to rewrite
- **Milestone:** `beta-firm`

## Medium

### M1. Webhook delivery can reach internal HTTP services

- **Area:** security
- **Evidence:** Creating a webhook requires `tokens:manage` and an `https://` URL (`apps/web/src/api/handlers/webhooks.ts`, `apps/web/src/api/schemas.ts`). Delivery calls `fetch(endpoint.url)` with no `redirect` mode and no address check (`packages/db/src/webhooks/deliver.ts`). Platform `fetch` follows redirects. A subscriber can answer 302 to `http://169.254.169.254/` or to an internal host. The response body is not stored — only the status and the error string — so this is blind SSRF plus whatever a POST with the event id and `entityId` does to a service that trusts the network. It matters on a shared host with more than one administration. It matters less when the only user already administers the machine.
- **Fix direction:** Resolve the host, refuse private, link-local, and loopback addresses, set `redirect: 'manual'`, and apply the same check to each redirect. Do this at registration and again at delivery.
- **Effort:** S
- **Milestone:** `beta-firm` (cheap, and it is the difference between a self-host footgun and a hosted-tenant bug)

### M2. Production will log OTPs until SMTP is set

- **Area:** security
- **Evidence:** `resolveEmailTransport` uses SMTP, else an outbox directory, else `createLogEmailTransport`, which prints the message body (`packages/adapters/src/email/resolve.ts`, `packages/adapters/src/email/transport.ts`). The README and `.env.example` document this so a fresh install can be signed into. The Docker image sets `NODE_ENV=production` and does not require SMTP (`Dockerfile`). A container whose logs are shipped to a collector is handing out sign-in codes. OTP storage itself is hashed, with three attempts (`packages/db/src/auth.ts`).
- **Fix direction:** In production, refuse to start, or refuse to send a code, when the transport is the log. Keep the log transport for explicit local dev (`KLOPT_EMAIL_OUTBOX_DIR` already exists and does not need to print to stdout).
- **Effort:** S
- **Milestone:** `beta-firm`

### M3. Signup stays open after the first administration exists

- **Area:** security
- **Evidence:** `emailOTP({ disableSignUp: false })` (`packages/db/src/auth.ts`). The first session that calls setup becomes owner of a new entity (`apps/web/src/api/handlers/setup.ts`). That is the right bootstrap for a private install. Nothing later turns it off. An instance reachable on the internet accepts any mailbox that can receive a code, and that account can provision its own books. Cross-entity reads were not found; the cost is a shared database filling with strangers' administrations, and a firm that thought the URL was private.
- **Fix direction:** An environment switch, default open for the empty instance and documented as "set closed once the firm is on it". Invite-by-address already exists for adding people to an existing entity.
- **Effort:** S
- **Milestone:** `beta-firm`

### M4. A missing `KLOPT_BASE_URL` disables the `Secure` cookie in production

- **Area:** security
- **Evidence:** `getAuth` passes `process.env['KLOPT_BASE_URL'] ?? 'http://localhost:3000'` (`apps/web/src/api/auth-instance.ts`). better-auth 1.7.2 sets `Secure` from `advanced.useSecureCookies`, else from a static `baseURL` starting with `https://`, and only then from `NODE_ENV=production` (`packages/better-auth/src/cookies/index.ts` in that release). Because a base URL is always passed, the production fallback never runs. Klopt's `defaultCookieAttributes` set `sameSite` and `httpOnly` and do not clear `secure`, so an `https://` base URL does the right thing. The Dockerfile sets `NODE_ENV=production` and does not set `KLOPT_BASE_URL`.
- **Fix direction:** Refuse to boot when `NODE_ENV=production` and `KLOPT_BASE_URL` is missing or not `https://`. Alternatively set `useSecureCookies: true` in that case.
- **Effort:** S
- **Milestone:** `beta-firm`

### M5. One upload reads the whole file into memory

- **Area:** security (availability)
- **Evidence:** `POST /api/v1/inbox` does `await file.arrayBuffer()` and the handler only rejects an empty body (`apps/web/src/routes/api/v1/inbox.ts`, `apps/web/src/api/handlers/inbox.ts`). `SECURITY.md` puts volume denial-of-service out of scope. One request that allocates until the process dies is a different failure: the bookkeeping process is the availability of the books.
- **Fix direction:** A hard byte cap at the route, before buffering, and the same cap in the document store. Stream to disk if larger uploads are actually needed.
- **Effort:** S
- **Milestone:** `beta-firm`

### M6. Encryption accepts any non-empty key, and derivation blocks the event loop

- **Area:** security
- **Evidence:** `encryptSecret` / `decryptSecret` use AES-256-GCM with a per-value salt and `scryptSync` (`packages/db/src/secrets.ts`). There is no minimum length on `KLOPT_ENCRYPTION_KEY`. `scryptSync` runs on the thread that is delivering webhooks or reading a mailbox password. The algorithm and the fail-closed behaviour (no key, no stored secret) are right. There is no direct unit test of tamper, wrong key, or a short key (`packages/db/src/secrets.ts` has no sibling test; coverage is incidental).
- **Fix direction:** Reject keys shorter than 32 bytes of entropy (or require base64 of 32 bytes, which `.env.example` already tells people to generate). Add `secrets.test.ts` for round-trip, tamper, and missing key. Moving scrypt off the hot path can wait; the call volume is credentials, not journal lines.
- **Effort:** S
- **Milestone:** `beta-firm`

### M7. A VAT return and an XAF import do their heavy work inside the HTTP request

- **Area:** performance
- **Evidence:** `handleGetVatReturn` rebuilds the return from `periodLines` (the journal slice for the period) and puts every line in `detail` (`apps/web/src/api/handlers/vat.ts`, `packages/db/src/repositories/vat.ts`). XAF import posts every entry in a loop inside one transaction on the request (`apps/web/src/api/handlers/compliance.ts`). Export builds the year XML in memory before responding. Both are correct shapes for a small file and a bad shape for a year of a busy administration. The ledger lock that serialises posts is intentional (`packages/db/migrations/0001_ledger_guards.sql`); the problem is doing hundreds of those locks while a browser waits.
- **Fix direction:** VAT GET: summary by default, `detail` paginated or omitted. XAF import/export: a worker job with a status row, same pattern as the Exact document import. A byte cap on the import body is the small step.
- **Effort:** M for the VAT payload and the import cap; L to move import/export to the worker
- **Milestone:** cap and VAT summary in `beta-firm`; worker jobs later

### M8. `sales_invoices` has no status index; purchase invoices do

- **Area:** performance
- **Evidence:** `0016_purchase.sql` indexes `(entity_id, status)`. `0002_sales.sql` indexes `(entity_id, contact_id)` and `(entity_id, due_date)` only. `openInvoices` filters `status = 'issued'` and then filters unpaid rows in process (`packages/db/src/repositories/sales.ts`). `0029_updated_at_for_incremental_sync.sql` adds `(entity_id, updated_at)`, which does not serve that filter.
- **Fix direction:** `(entity_id, status, due_date)` or `(entity_id, status)`. Confirm with `EXPLAIN` on a database that actually has volume before adding more.
- **Effort:** S
- **Milestone:** `beta-firm`

### M9. Architecture still describes keys and a theme that the product no longer has

- **Area:** maintainability
- **Evidence:** `docs/architecture.md` still says bank match uses `1`–`9` and `x`, and that nothing toggles `.dark`. The changelog (unreleased, alpha 4) removes those keys. `apps/web/src/server/theme.ts` and the account menu set a theme cookie; `apps/web/src/lib/theme.ts` applies `.dark`. The decisions index stops at ADR 0058; `docs/decisions/0059-a-bucket-close-enough-to-test-against.md` exists and CI cites it. ADR 0025's consequences still say the inbox is not here.
- **Fix direction:** Correct the two architecture paragraphs. Add the 0059 row. Leave accepted ADR bodies alone; a one-line "superseded by the implementation" note in the index is enough for 0025.
- **Effort:** S
- **Milestone:** `beta-firm`

### M10. Governance promises signed releases; the repository does not produce them

- **Area:** maintainability
- **Evidence:** `GOVERNANCE.md` says every release ships checksums and a signature, and that the release workflow is in the repository. `.github/workflows/` contains only `ci.yml`. The GitHub release `v0.1.0` (2026-09-23) has notes and no assets. This is a honesty gap, not a claim that Digipoort shipped.
- **Fix direction:** Either add a release workflow that publishes checksums and a signature, or change the governance sentence to say that is the intent and it is not in place yet.
- **Effort:** M for the workflow; S for the sentence
- **Milestone:** `beta-firm` (the sentence is the stabilize step; the workflow can follow)

### M11. `pnpm run verify` is not what CI runs

- **Area:** maintainability
- **Evidence:** Root `package.json` `verify` is format, build, lint, typecheck, test, dependency-cruiser. CI also runs `peppol:fetch` and `pnpm --filter @klopt/db run migrate` before tests. A fresh clone has no `.sch` files (they are not in git). Schematron tests fail until the fetch. `CONTRIBUTING.md` says to fetch first; the script does not.
- **Fix direction:** Call `peppol:fetch` at the start of `verify`, or add `verify:ci` that matches the workflow and point contributors at it.
- **Effort:** S
- **Milestone:** `beta-firm`

### M12. `KLOPT_WORKER_CONCURRENCY` does nothing

- **Area:** maintainability
- **Evidence:** `loadConfig` parses it, default 4 (`.env.example`, `apps/worker/src/config.ts`). `main.ts` never passes it to pg-boss. `registerJobs` calls `boss.work` with a handler and no team size (`apps/worker/src/jobs.ts`). The header comment in that file still lists VAT close, bank sync, and subledger recon as if they were the job list; five other jobs are what actually register. Architecture already admits the comment is a future note.
- **Fix direction:** Delete the env var, or pass it through and say so in `.env.example`. Reword the jobs header to name the five jobs.
- **Effort:** S
- **Milestone:** `beta-firm`

### M13. Nitro is still a beta, and the TanStack pins are a version apart

- **Area:** maintainability
- **Evidence:** `apps/web/package.json` depends on `nitro` `3.0.260903-beta` and on `@tanstack/react-start` `1.168.49` next to `@tanstack/react-router` `1.170.32`. ADR 0003 says to pin exact and upgrade deliberately. The README already treats TanStack Start's contributor pool as a residual cost. This is a watch item, not a defect found in a code path.
- **Fix direction:** Keep the pins. Upgrade Nitro when a stable 3.x exists, and move Start and Router together, with the e2e job as the check. Do not widen ranges.
- **Effort:** M when someone does the upgrade
- **Milestone:** `beta-firm` as monitoring, not as a feature

### M14. BTW periods still default to the calendar year

- **Area:** maintainability
- **Evidence:** Report screens take `fiscalYear` from the URL (`apps/web/src/lib/fiscal-year.ts`, dashboard, balance sheet). `apps/web/src/routes/_app/vat.index.tsx` uses a separate `year` search param and defaults it with `new Date().getUTCFullYear()`. Setup using the calendar year as the suggested label for a new book year is a different, reasonable default (`apps/web/src/routes/setup.tsx`). This is the remaining slice of [#14](https://github.com/euro-oss/klopt/issues/14). `getFullYear()` itself is gone from route code; a unit test asserts that.
- **Fix direction:** Drive the BTW year from the same fiscal-year selection as the other reports, or document why a VAT year is a calendar year on purpose (Dutch aangifte periods often are). Do not close #14 until that acceptance criterion is met.
- **Effort:** S
- **Milestone:** `beta-firm`, and it belongs on #14 rather than a new issue

## Low

### L1. Dependency advisory is dev-only

- **Area:** security
- **Evidence:** `pnpm audit` on 2026-09-24: one moderate, `esbuild` `<=0.24.2` via `packages/db` → `drizzle-kit` → `@esbuild-kit` (GHSA-67mh-4wv8-2f99, the esbuild dev-server CORS issue). `drizzle-kit` is a devDependency. The production image installs with `--prod` and then prunes the store (`Dockerfile`). No high or critical advisory on the lockfile.
- **Fix direction:** Bump `drizzle-kit` when a release no longer pulls that esbuild. Not a production patch by itself.
- **Effort:** S
- **Milestone:** later, or whenever db tooling is bumped

### L2. Document filenames are copied into a response header

- **Area:** security
- **Evidence:** `Content-Disposition: inline; filename="${found.filename}"` uses the stored name (`apps/web/src/routes/api/v1/documents.$documentId.ts`). Node's `Headers` implementation rejects CR/LF, so classic response splitting should fail the request rather than inject a header. A quote in the name still breaks the parameter.
- **Fix direction:** Strip quotes and control characters, or use RFC 5987 `filename*`. Do it in the same change as H1.
- **Effort:** S
- **Milestone:** `beta-firm` (with H1)

### L3. `KLOPT_RATE_LIMIT=off` is honoured outside tests

- **Area:** security
- **Evidence:** `getAuth` sets `disableRateLimit` when the variable is `off`, and `createAuth` prints a warning (`apps/web/src/api/auth-instance.ts`, `packages/db/src/auth.ts`). The limit itself is database-backed and covered by `apps/web/test/auth-security.test.ts`. The warning is the only production brake.
- **Fix direction:** Ignore `off` unless a test-only variable is also set.
- **Effort:** S
- **Milestone:** `beta-firm`

### L4. IMAP host is whatever the bookkeeper types

- **Area:** security
- **Evidence:** An inbound source with `ledger:configure` stores a host and the worker connects (`apps/web/src/api/handlers/inbound-sources.ts`, `packages/adapters/src/inbound/imap.ts`). Same class of issue as M1, narrower: it needs a configure permission and speaks IMAP, not HTTP metadata.
- **Fix direction:** Refuse private and link-local addresses unless an explicit dev flag is set.
- **Effort:** S
- **Milestone:** `beta-firm` if M1 is done; fold it into that change

### L5. Webhook list queries once per endpoint

- **Area:** performance
- **Evidence:** `handleListWebhooks` loads endpoints, then `backlogFor` and `attemptsFor` inside `Promise.all` over that list (`apps/web/src/api/handlers/webhooks.ts`). A firm will have a handful of endpoints, so this is not the dashboard problem. It is still an N+1 on a read.
- **Fix direction:** One grouped query for backlogs when the list is next touched.
- **Effort:** S
- **Milestone:** later

### L6. The "What M0 gives you" section still says 15 operations

- **Area:** maintainability
- **Evidence:** The README intro correctly says 118 operations. The later "What M0 gives you" table says "15 operations under `/api/v1`". A reader who lands there will think that is the current API.
- **Fix direction:** Label the table as the M0 milestone snapshot, or delete the operation count from it.
- **Effort:** S
- **Milestone:** `beta-firm`

### L7. Handler helpers are copied

- **Area:** maintainability
- **Evidence:** `requirePermission` and `requireIdempotencyKey` are repeated across `apps/web/src/api/handlers/*.ts`, with slightly different error wording. Behaviour matches. This is noise, not a boundary break: routes stay thin and rules stay in `@klopt/core` / `@klopt/db`.
- **Fix direction:** One helper next to `hasPermission` in `apps/web/src/api/context.ts`, the next time a handler is edited. Not worth a drive-by PR.
- **Effort:** S
- **Milestone:** later

### L8. Filing certificates are process-wide environment variables

- **Area:** security
- **Evidence:** `apps/web/src/api/filing.ts` says so, and points at ADR 0024. Digipoort is built without a signer, so `available()` stays false until that seam exists. This is a known gap for a firm with many administrations, and it is not a shipped Digipoort.
- **Fix direction:** Leave it until a signer exists. When it does, store the certificate per entity with `encryptSecret`, the way Exact credentials already are.
- **Effort:** L
- **Milestone:** later

### L9. Large files that will hurt the next editor

- **Area:** maintainability
- **Evidence:** Rough sizes: `apps/web/src/api/schemas.ts` (~1300), `packages/db/src/repositories/sales.ts` (~1230), `apps/web/src/api/handlers/sales.ts` (~1160), `apps/web/src/routes/_app/inbox.tsx` (~1070), `apps/web/test/response-shapes.test.ts` (~1650, intentional). `routeTree.gen.ts` is generated.
- **Fix direction:** Split `schemas.ts` by domain the next time it is the conflict magnet. Do not split the response-shapes test for its own sake.
- **Effort:** M
- **Milestone:** later

## Quick wins

Each of these is one change, on the order of a day, and fits stabilize.

1. Allowlist document content types and force `attachment` otherwise (H1, L2).
2. Cap inbox upload size before `arrayBuffer()` (M5).
3. Remove `verifyChain()` from the dashboard loader (H2).
4. Replace inbox `get` with a query by id (the sharp edge of H3).
5. Add `(entity_id, status)` on `sales_invoices` (M8).
6. Banner on `ALPHA_ASSESSMENT.md`; fix the two stale paragraphs in `docs/architecture.md` (H4, M9).
7. Refuse the log mail transport when `NODE_ENV=production` (M2).
8. Webhook `redirect: 'manual'` and a private-address check (M1, L4).
9. Refuse to boot in production without an `https://` `KLOPT_BASE_URL` (M4).
10. `secrets.test.ts` plus a minimum key length (M6).
11. Point the BTW year screen at the fiscal year, on #14 (M14).

## Non-findings and strengths

Kept on purpose. Do not "clean these up" in a stabilize pass.

- **Tenancy.** Handlers take `context.entityId`. `apps/web/test/isolation.test.ts` is the check, and a missing row is `not_found` rather than `forbidden` so a probe learns nothing. A bearer token cannot create an entity.
- **Journal integrity.** One posting function. Migration `0001_ledger_guards.sql` refuses update and delete, enforces balance, and serialises the hash chain. Idempotency is required on writes.
- **Credentials at rest.** AES-256-GCM, per-value salt, no key means the write is refused (`packages/db/src/secrets.ts`). API tokens are stored as a hash and compared with `timingSafeEqual`. OTPs are stored hashed.
- **Auth limits that are actually on.** Database-backed rate limits, six code sends an hour, three guesses, then the code is burned. Covered by `apps/web/test/auth-security.test.ts`.
- **Session cookie flags when configured.** `HttpOnly` and `SameSite=Lax` are set. `Secure` follows an `https://` base URL. CSRF against cookie-authenticated `/api/v1` from another site is what `SameSite=Lax` is there for. CORS is not opened on the API; `Access-Control-Allow-Origin: *` is limited to OAuth discovery documents.
- **XML.** The in-house parser rejects a doctype (`packages/core/src/xml/parse.ts`). Queries go through Drizzle parameters. Search escapes `%` and `_`.
- **Documents on disk.** The filesystem store addresses objects by the SHA-256 hex, not by the upload name. Maildir acknowledge uses `basename`.
- **MCP.** `/api/mcp` resolves the bearer token before any method (`apps/web/src/routes/api/mcp.ts`). The server is a client of the same API.
- **Adapters that are honestly absent.** Digipoort returns unavailable without a signer (`packages/adapters/src/filing/digipoort.ts`, wired in `apps/web/src/api/filing.ts` with no signer). E-invoice send is email (`apps/web/src/api/e-invoice.ts`). `packages/adapters/src/bank-feed/` and `payment/` are README stubs; CAMT.053, MT940, and `pain.001` are the file paths in core. The README compliance table says the same thing. `GOVERNANCE.md`'s hosted gateway (PKIoverheid, bank aggregator, Peppol AP) is a business model, not a running service. Do not document any of these as shipped.
- **Reporting.** Trial balance, balance sheet, and profit and loss read `account_period_balances`, not a scan of the journal (`packages/db/src/repositories/reporting.ts`). Journal, audit, and event lists are cursor-capped. XAF export is one ordered query, not one query per entry. Audit CSV export streams.
- **Frontend weight.** PDF, Schematron, and XPath live under `packages/adapters` and `apps/web/src/api`. Route modules import domain types, not those libraries. No unbounded in-process cache showed up; reference data and the Schematron validator are parsed once.
- **Boundaries.** `@klopt/core` is banned from framework, database, and adapter imports. dependency-cruiser runs in CI. A contract test fails the build if an operation has no route. Money-as-`number` is a lint. The Docker image runs as `USER node`.
- **CI.** `verify` on Node 24 and 26, an artefacts job for the XAF schema and RGS count, and Playwright. The September assessment that says otherwise is wrong.

## Overlap with open issues

**#14 (fiscal year in the URL).** The mechanism is on `main`: `fiscalYearSearch`, year-scoped report routes, and an e2e that expects `fiscalYear=` in the dashboard URL. `getFullYear()` is gone from those routes. What is left is the BTW period screen (M14) and a pass over snapshot / Exact year inputs if a reviewer still finds a calendar-year default there; this pass did not find another `getFullYear()` in `apps/web/src/routes`. Do not close #14 from this audit.

**#15 (XAF / RGS API enrichments).** Still deferred in the product: no chart-create operation, no RGS code-list endpoint, XAF import does not extend the chart. Unreleased UI edits RGS mappings; it does not list the scheme. Nothing in this audit implements or replaces #15. Do not close it. It is feature work, not stabilize work.

## Suggested GitHub issues

Do not file these as part of this audit. Titles and bodies for whoever triages `beta-firm`.

### 1. Serve inbox documents as downloads unless the type is allowlisted

Opening a purchase-inbox file renders it on the Klopt origin. The stored content type comes from the upload or from the mail attachment, and `GET /api/v1/documents/:id` sends it back `inline`. An HTML or SVG attachment therefore runs in the bookkeeper's session and can call the API. Allowlist PDF and images for inline display, send everything else as an attachment with `nosniff`, and stop putting the raw filename into `Content-Disposition`. Cap the upload size in the same change so one request cannot buffer an unbounded body.

### 2. Stop blocking the dashboard on a full hash-chain read

`/_app/` loads the work queue, the trial balance, and `verifyChain()` together. Chain verification loads every entry and every line. The trial balance does not need that; it already reads period balances. Remove the chain call from the dashboard loader and leave verification on its own endpoint until there is a checkpointed check.

### 3. Paginate contacts, purchase invoices, and the inbox

Those three list APIs return every row. Inbox `get` is implemented by listing everything and searching in memory, and the list includes the parsed JSON. Add a default limit and a cursor, and load one inbox item by id. Journal entries and the audit log already show the pattern.

### 4. Production guards for mail, signup, and the public URL

Three defaults are right for a laptop and wrong for a container on the internet. The log mail transport prints OTP bodies when SMTP is unset, and production does not refuse it. Signup stays enabled after the first entity exists. An unset `KLOPT_BASE_URL` becomes `http://localhost:3000`, which forces a non-`Secure` session cookie even though the image sets `NODE_ENV=production`. Refuse the log transport in production, add a signup-closed switch, and refuse to boot without an `https://` base URL.

### 5. Block private addresses on webhook delivery

A webhook URL must be `https` at registration. Delivery uses `fetch` with the default redirect policy, so a 302 can land on an internal HTTP service. The body of the response is not returned, but the POST still arrives. Refuse private, link-local, and loopback targets, and do not follow redirects. Apply the same address check to IMAP hosts configured as inbound sources.

### 6. Mark the September alpha assessment as superseded

`docs/architecture.md` points at `docs/ALPHA_ASSESSMENT.md` as the current picture. That file predates Playwright-in-CI, the 118-operation count, the theme toggle, and the keyboard change. Add a banner and correct the architecture sentences for bank-match keys and dark mode. Add ADR 0059 to the decisions index. Separately, `GOVERNANCE.md` says releases are signed by a workflow in the repo; only `ci.yml` exists, and `v0.1.0` has no checksums.

### 7. Sales invoice status index, and a direct test for secret encryption

Purchase invoices are indexed by `(entity_id, status)`. Sales invoices are not, and the open-item query filters on `issued`. Add the matching index after an `EXPLAIN` on a realistic volume. Also add unit tests for `encryptSecret` / `decryptSecret` (round-trip, tampered tag, missing key) and reject an encryption key that is too short to be the `openssl rand -base64 32` value the env example asks for.

## What this pass did not do

- No dynamic exploit confirmation (no running app, no crafted HTML upload against a live session). H1 and M1 are from the code path, not from a captured request.
- No `EXPLAIN` against a populated database, so the missing sales index is a schema observation, not a measured seq scan.
- No full `pnpm run verify`, no Playwright run, no container build.
- No second secret scanner beyond a pattern search. Nothing that looked like a live credential was in the tree.
