# 0034. One login, many administrations

Status: Accepted
Date: 2026-09-08

## Context

Spec 13: _"Exact Online importer: via their REST API, for contacts, open items,
chart of accounts and documents"_ and _"a dry-run mode producing a
reconciliation report against the source system's trial balance before anything
is committed."_

Exact's API is division-scoped: every path is `/api/v1/{division}/…`. One OAuth
login reaches **every** administration the signed-in user has rights to. The
person who asked for this importer put it plainly: _"I have multiple there are
test and production administrations all under 1 account."_

That is not an edge case. It is what a real Exact account looks like: the
operating BV, the holding, a practice division from a course, and the test
division somebody made to try something out before doing it for real.

## Choosing the division is a step, not a parameter

The failure this guards against is specific. A test division usually has
_plausible_ data in it — that is what makes it useful as a test division — so
importing the wrong one does not look wrong. There are invoices, they have
sensible numbers, the balance sheet balances. It is discovered a quarter later
by somebody reconciling a VAT return, and by then the fictional entries have
real entries booked on top of them.

Three consequences follow, and all three are in the code:

- **The division is a column on `exact_connections`**, not an argument. Chosen
  once, deliberately, and re-chosen deliberately. An importer that took a
  division per request would be one typo away from the wrong books, every time.
- **The choice is checked against what Exact offers.** `findDivision` refuses a
  code that is not in the live list, because a number in a request body is not
  evidence that this login has rights to that division.
- **Every division carries its cautions.** `system/Divisions` returns
  `IsPracticeDivision`, `IsDossierDivision`, `Status` and `ArchiveDate`. Those
  become `practice | dossier | archived | inactive`, they are stored on the
  connection alongside the code, and the audit entry records them: "somebody
  picked the test administration" is the question that entry exists to answer.

Ordinary divisions sort first and the **current** one deliberately does not
float to the top. `Current` is whichever division Exact was last pointed at — a
fact about somebody's browsing history, not about which books they want to
migrate. Putting it first would be putting a plausible wrong answer under the
cursor.

None of the cautions is a refusal. An accountant restoring an archived year
means it. What the system must not do is fail to mention it.

## What "reconciled against the trial balance" actually means here

The spec's dry-run sentence needs interpreting, because this importer brings
master data and open items across — not history. History is what the XAF import
is for. So there is no set of postings to compare line by line against a trial
balance.

What an accountant would actually ask for is three questions, and that is what
`planExactImport` answers:

1. **Does Exact's own trial balance balance?** If debit and credit do not agree
   in the source, nothing downstream of it can be trusted. This one is a
   **problem** — the import stops.
2. **Do the open items add up to the control accounts?** Exact's receivables
   list should total to what its debtors account holds, and the payables list to
   its creditors account. When they agree, the open items being imported are
   provably the _complete_ debtor and creditor position. When they do not,
   something is booked to the control account with no open item behind it, and
   importing the list would start the new ledger short.
3. **Is every account with a balance in the chart being imported?** A code with
   a balance and no account is a line with nowhere to land.

Two and three are **warnings with amounts**, not refusals. A twelve-year-old
administration often has a known and explicable difference, and refusing to
proceed on two cents would make the tool useless. Reporting it in a number
somebody can read is the whole job.

Two details in that reconciliation were wrong before they were right:

- **`ReportingBalance` is per period.** Summing one period understates every
  account. The plan sums every period of the year.
- **`Status` must include 20 as well as 50.** Exact's own note says so: _"To
  get 'after entry' results, both should be included."_ A filter on processed
  rows alone would understate anything entered but not processed, and the
  difference would look like our bug.
- **Creditors are measured in their own direction.** 1600 carries a credit
  balance. Comparing signed totals makes a correct creditors position look like
  a difference of twice its value — the same mistake that overstated the
  creditors ageing in M4.

## Money arrives as a double, and that is not fixable at the wire

Every Exact amount is `Edm.Double`. By the time `JSON.parse` has run the value
is already a float and no care downstream recovers what the float does not
hold.

What can be done is to convert once, at the edge, and refuse rather than round.
`minorFromExactAmount` multiplies by a hundred and rounds — required, not
optional: `1234567.89 * 100` is `123456788.99999999`, and truncating loses a
cent on every large invoice. Anything further than 1e-4 from a whole cent is a
`problem` naming the field, not a silent 33.33.

The tolerance sets the ceiling. A double holding a two-decimal amount is off by
about `|value| · 2⁻⁵²`, so 1e-4 holds up to roughly 2.3e11 minor units — two
billion euro. Above that the tolerance would start accepting values that are not
cent amounts at all, so that is where the refusal is, rather than at
`Number.MAX_SAFE_INTEGER`.

## The refresh token is single-use, and that shapes the whole client

Exact's access token lasts ten minutes and every refresh returns a **new**
refresh token, invalidating the one that bought it. Three real failures follow,
and each has a countermeasure:

- **A client that does not persist the new token** loses the connection at the
  _next_ refresh, not this one — so the bug appears ten minutes after the code
  that caused it. `onTokens` is required rather than defaulted to a no-op: a
  no-op default is a connection that works today and is broken tomorrow.
- **A crash between receiving a pair and storing it** leaves a spent refresh
  token in the database. So `onTokens` is awaited _before_ the new access token
  is used for anything. One extra write closes the window.
- **Two concurrent refreshes race** and the loser's token is dead. The client
  serialises on a single in-flight refresh promise.

The db-backed test for this makes _two_ requests after forcing an expiry,
because the first one passing proves nothing — it is the second that fails when
the rotation was not written down.

## Every field name was read, not guessed

Every column in `packages/core/src/exact/resources.ts` was read off Exact's own
reference pages (`HlpRestAPIResourcesDetails.aspx`) before a line of mapping was
written. That mattered more than it sounds:

- `crm/Accounts.Code` is _"fixed length numeric string with leading spaces,
  length 18"_. Untrimmed, that is the debiteurennummer.
- `crm/Accounts.Status` is _"if the status field is filled this means the
  account is a customer"_ — `A` none, `S` suspect, `P` prospect, `C` customer.
  Not a boolean, and not the same question as `IsSales`.
- `crm/Accounts.Type` is `A` relation or `D` division. A `D` row is one of the
  user's _own_ administrations appearing among the relations; importing it
  creates a contact for the company itself.
- `financial/GLAccounts.Type` has thirty-odd values against our five. Type
  alone gets equity right, which `BalanceType` + `BalanceSide` cannot: 50 and 52
  are balance-sheet credit accounts that are not liabilities.
- `Edm.DateTime` comes back as `2026-03-31T00:00:00` from some resources and
  `/Date(1774915200000)/` from others, and which one depends on the resource
  rather than on anything a caller controls.

The `$select` lists are the other half of this. Exact returns all two-hundred-odd
columns of `crm/Accounts` when you do not ask for fewer, so naming the columns
is simultaneously the documentation and the request.

## Consequences

- **The OAuth app is the operator's, not ours.** Client id and secret are
  registered per administration and encrypted with the instance key — spec 8's
  bring-your-own-credential rule and spec 14's no-plaintext rule. With no
  `KLOPT_ENCRYPTION_KEY` the connection is **refused** rather than stored as
  typed, and the screen says so before anybody pastes a secret in.
- **`redirectUri` is asked for rather than derived, and must be https.** Exact
  compares it literally, and a mismatch fails at their end with an error that
  does not say why. Guessing it right some of the time is worse than asking.

  The https requirement is theirs, not ours, and it is why `pnpm dev:https`
  exists: portless fronts the dev server with a locally-trusted certificate on
  a stable `https://klopt.localhost`. The name is pinned in the script rather
  than inferred, because a bare `portless` prefixes the git branch onto the
  host — and a literally-compared redirect URI cannot follow a URL that moves
  every time somebody switches branch.

  The refusal lives in the schema as well as on the screen. Exact rejects a
  plain-http redirect in their App Center, where the error is somebody else's
  and does not mention what to do about it; refusing it here costs nothing and
  can name the fix.

- **The OAuth redirect lands on a screen, not on `/api/v1`.** The API surface
  stays methods and bodies; the screen posts the code and state to
  `POST /exact/callback`. A GET doorway that only makes sense to a redirect
  would be the one route in the manifest nobody could call deliberately.
- **The `state` nonce is spent in one statement.** `consumeHandshake` clears it
  in the `UPDATE … WHERE state = ?` that reads it, so two callbacks with the
  same state cannot both pass a check-then-act. The refusal is deliberately
  vague — "does not match a connection attempt from these books" — because
  distinguishing "no handshake" from "wrong state" tells a caller something.
- **Nothing is imported yet.** This slice connects, chooses, and reports. The
  commit half — writing the chart, the contacts and the open items, with an
  opening entry that will not let the books start unbalanced — is the next one,
  and the plan it executes is exactly the object this dry run returns. That is
  the point of `planExactImport` being pure: the report a human approves is the
  thing that runs, not a preview generated by a second code path that might
  disagree.
- **The document archive is behind a flag.** A division with ten years of scans
  has tens of thousands of document rows and as many attachments. The
  reconciliation needs none of them, and reading them on the way to a preview
  would make the preview as expensive as the import.
- **A request budget, and a `__next` loop is why.** `collectAll` follows every
  `__next` because Exact caps page size server-side and a client trusting `$top`
  would import part of a chart of accounts and report success. `maxRequests`
  exists because a resource whose `__next` never terminates is an infinite loop
  against somebody else's API.
- **Rate limits are read, not discovered.** Exact publishes the remaining daily
  and per-minute budget on every response. Getting throttled on a
  five-thousand-row import wastes the whole minute, and the header said so in
  advance — so the client waits for the window Exact named rather than backing
  off blindly, and refuses to sit out a reset hours away.
