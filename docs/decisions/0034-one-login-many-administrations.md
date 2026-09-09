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

## Rights are per resource, so one refusal is not a failed import

A real connection read `financial/GLAccounts`, `vat/VATCodes` and
`cashflow/PaymentConditions`, then answered **403 Forbidden** for
`financial/ReportingBalance`. Exact documents `VATCodes` and `ReportingBalance`
under the same scope — "Financial accounting" — so the scope is not what
decides it. Rights are granted per resource, per user, per administration.

Nothing in this codebase can grant that right. What it can do is not throw away
the seven resources that answered because the eighth did not, which is spec 8's
fourth rule (a failing adapter never blocks bookkeeping) applied to a single
resource rather than a whole integration.

So `readDivision` attempts each resource on its own and records refusals on the
snapshot as `unreadable`. The planner decides whether what came back is enough:
the chart of accounts, the relations and the two open-item lists are the import
and their absence is a `problem`; the VAT codes, payment conditions, documents
and trial balance are proof or decoration and their absence is a `warning` that
names what the loss costs.

### Only 403 and 404 degrade

The narrowness is the point. A 400 means our query is wrong and should be loud.
A 401 means reauthorise. A 429 that reaches this far means the reset is beyond
what the client will wait for. A transport failure arrives as an
`ExactApiError` with `status: 0`, and treating that as "refused" would turn
"the network went away" into "this division has no customers" — and then import
on it. Matching on the status rather than on the error class is what separates
_Exact answered no_ from _we never got an answer_.

### An unread trial balance is not a balanced one

This is the part worth writing down, because the obvious implementation of the
above is silently wrong twice over.

Degrade by substituting an empty trial balance and:

1. `totalDebit` and `totalCredit` are both zero, so it **balances**. The report
   would tell somebody their administration reconciles without having looked at
   it.
2. Every control account holds zero, so the open items become a **difference**
   against zero — and the report would accuse their books of having postings on
   the debtors account with no open item behind them, when all that happened is
   that we were refused the page that would have shown otherwise.

The second is worse than the first. It is a confident diagnosis of somebody
else's bookkeeping, derived entirely from our own lack of access.

So `trialBalance` is `readonly ExactReportingBalance[] | null` and every total
downstream of it is nullable: `balanced` is `true | false | null`, `ledger` and
`difference` are `bigint | null`, and `ControlAccountCheck.outcome` has four
values rather than a boolean — `matches`, `differs`, `no_control_account`,
`not_reconciled`. On the wire and on the screen the missing figures are an em
dash, not `0,00`, and the tile reads "niet gelezen" in a muted tone rather than
"sluit niet" in a warning one.

The cost is that a nullable amount now has to be handled at four layers. That
is the price of not being able to express "we did not look" as a number, and it
is worth paying: the alternative is a reconciliation report that is most
confident exactly when it knows least.

## Edm.Int64 arrives quoted, and one wrong scalar took out the whole import

A real administration failed with `Id is not a GUID` on every open item.

`HID` on the receivables and payables lists is `Edm.Int64`. A 64-bit integer
does not fit a JSON number — `Number.MAX_SAFE_INTEGER` is 2^53 — so OData
quotes it, and Exact's reference documentation does not say which endpoints do.
`readNumber` requires `typeof value === 'number'`, so it returned null for
every row, and the fallback read `Id`: a column marked **Obsolete** in Exact's
own reference and not in `OPEN_ITEM_SELECT`, so never returned either. Two
mistakes in one line, and the second hid the first — the error named a field
nobody had asked for.

So there is now a `readKey` that accepts either form and returns a string,
because these values are keys to match on and never arithmetic. Keeping them as
text is also the only way a nineteen-digit id survives being read, which is the
whole reason Exact quoted it. The fallback is a composite of columns that _are_
selected, so it is stable across a re-import.

The stand-in Exact used for the walk-throughs returned `HID` unquoted, which is
why every test passed while the real thing failed on its first open item. It
quotes it now. **A fixture that is easier to satisfy than the real system is a
fixture that certifies bugs.**

`requireGuid` and `requireKey` also quote what they actually got. "HID is not a
whole number" sends somebody to look at their data; `HID was not returned`
sends them to the reader, which is where the bug is.

## Two messages for one failure

The same incident showed a second defect. `ExactReadError` was not mapped in
`refuse`, so it fell through to the generic 500 — whose message is deliberately
withheld, because a 500 can carry a connection string. The result was one
failure appearing as two unrelated problems in two places: the real cause in
the connection's `lastError` panel, and "The request could not be completed."
in the banner above it.

It is mapped now. A row we cannot parse is our defect, not Exact's, so it stays
loud rather than degrading the way a 403 does — it just says which field, what
was in it, and how far the read got before it stopped.

Every refusal now carries that last part: `Read 3 request(s) before this, last
of them bulk/Financial/GLAccounts.` A read that dies on the seventh of eight
resources is indistinguishable from one that never started, and which of those
happened is the first thing anybody wants to know.

## The bulk endpoints, and not reading pages to throw them away

Exact's ordinary collections page at sixty rows. The `bulk/` variants of the
same resources page at a thousand, which their documentation states outright.
Four of the eight resources have one — `bulk/CRM/Accounts`,
`bulk/Financial/GLAccounts`, `bulk/Documents/Documents`,
`bulk/Documents/DocumentAttachments` — and all four carry every column we
select, checked against the reference pages rather than assumed.

For an administration with five thousand relations that is six requests instead
of eighty-four. It matters beyond speed: every request spends a finite daily
budget, and a read that takes minutes is a read that outlives whatever timeout
sits between a browser and this process.

The paths are written out rather than derived, because they are not a prefix
away from the ordinary ones: it is `bulk/CRM/Accounts`, not `bulk/CRMAccounts`.
The resource names in `REQUIRED_RESOURCES` and the consequence table had to
move with them — they are matched as strings, and a rename that missed one
would have quietly reclassified a blocking failure as a warning.

`collectAll` also takes a `limit` now. The document read asks for the newest
five hundred, and used to page through the division's entire history before
slicing — fifty requests to answer a question that needed one.

### What a full read costs

Nine requests for a small administration, and the report shows every one of
them with its status, row count and duration. That is there because "how many
requests is this" is the question somebody asks while watching it run, and
because a resource that quietly pages eighty times is worth being able to see.

## An open item is two facts, and importing one of them is worse than neither

An outstanding invoice is a **document** somebody owes on — which dunning and
bank matching read out of `sales_invoices` and `purchase_invoices` — and a
**balance** on the debtors or creditors account, which the trial balance reads
out of the journal. Import the first without the second and the ageing is full
while account 1300 says nothing; import the second without the first and 1300
says thirty thousand with nobody to chase for it.

So `commitExactImport` writes both, from the same list, in one transaction. The
creditor ageing's own reconciliation is the check that they agree, and it reads
`subledger 60500, controlAccount 60500` on a walked-through import.

### One transaction

The chart, the relations, the opening entry and every invoice, or none of them.
A half-imported administration is worse than one that failed, because the
failure is visible and the half is not.

### One opening entry, not one per invoice

Every open item is a line on a single entry — a line per invoice on its control
account, and one counter-line for the difference. That is how a bookkeeper
books an overname, it makes the balance explicable line by line, and it means
the whole migration reverses as one storno if it turns out to be wrong.

### The counter-account has no default

The other side of every open item is a bookkeeping decision. Defaulting it to
equity would be right often enough to be dangerous: an import that quietly
balanced itself against the wrong account understates the result by the entire
debtor position, and **nothing on any screen would look wrong afterwards** —
every number is plausible. So it is a required field with no suggested value,
and the screen says why.

The control accounts and the memoriaal are defaulted, because those are
identifiable facts about a chart rather than judgements, and being wrong about
them fails loudly at the first posting.

### Exact's numbers are kept, and our counter is not touched

An imported receivable does not go through the issuing path. Our invoice series
is a legal claim about invoices _we_ raised and the law requires it to be
gapless; spending numbers out of it on another system's history is exactly the
corruption the counter exists to prevent. So the imported invoice carries
Exact's own number — which is also the number the customer will quote — and
`allocate_number` still returns `2026-0001` afterwards. There is a test for
that, because it is the kind of thing that is only noticed a year later.

The purchase side needs no such argument: "the supplier's number is the
number" was already true, so preserving `YourRef` is the ordinary case.

### Imported open items have no lines, and no VAT

Exact's receivables list carries an outstanding amount, not a document. There
is no net/VAT split in it, and a line needs a tax code — inventing a zero-rate
one would put a number in the BTW-aangifte nobody is entitled to. So the
denormalised totals are all there is and `taxMinorUnits` is zero: the VAT on
these invoices was declared in the old system, in the period it belonged to.

For the same reason the opening entry carries no tax codes at all. Tagging it
would claim the VAT a second time.

### The dates

The entry is booked on one `openingDate` the caller chooses. The invoices keep
their own issue and due dates, because those drive the ageing and the dunning
clock — an invoice that was late in November should still look late. The
entry's _document_ date is the opening date too, not the invoice date: a
document date after its booking date is a ledger violation, and a migration
necessarily books old documents on a new day.

### What is not imported yet

**Documents.** A division with ten years of scanned purchase invoices has tens
of thousands of attachments to fetch and store, which is a worker job rather
than something to do inside an HTTP request. The plan already lists them and
the dry run counts them; nothing writes them yet.

## Asking Exact why, instead of listing what it might be

"What permission do I need?" turned out to have no answer in Exact's
documentation. They publish a `Scope` per resource, but scope is demonstrably
not the discriminator — `vat/VATCodes` and `financial/ReportingBalance` are both
"Financial accounting" and one answered 200 while the other answered 403 for the
same token in the same administration. There is no published resource-to-right
mapping.

There are **four** independent layers that produce an identical `Forbidden`
body: the signed-in user's roles on that administration, the subscription's
modules, the administration itself, and the app registration's data scoping.
Each is fixed in a different place, and guessing wrong costs an afternoon
spent on roles that were already correct.

Exact will answer one of the four directly. `users/UserHasRights` takes an
endpoint and an action and returns a boolean: _may this user GET this
resource_. So a 403 now costs one extra request, and the report says which of
the three sentences applies rather than listing all four possibilities:

- **Right is missing** — go to the user's roles, and where.
- **Right is present** — explicitly _not_ the roles; it is the subscription's
  modules or the app's data scoping.
- **Probe unanswered** — say so. `UserHasRights` is scoped `Organization
administration`, so a login refused the resource can be refused the question
  about it, and reporting that as "this user lacks the right" would send
  somebody to fix a thing that is not broken. Not knowing is not a "no".

Only on a 403. A 404 is not a rights question and the probe spends a request
against a finite daily budget.

### The scalar that was being dropped

`UserHasRights` is an OData _function_, so it answers `{"d": true}` rather than
`{"d": {"results": [...]}}`. The unwrapper returned an empty page for anything
whose `d` was not an object, which meant a definite "no" arrived as "no
answer" and the report hedged when it had been told the truth. A primitive `d`
is now one row under `value`.
