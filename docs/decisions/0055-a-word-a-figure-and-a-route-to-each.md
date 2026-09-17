# 0055. A word, a figure, and a route to each

Status: Accepted
Date: 2026-09-17

## Context

Spec 10.3's tool table names twelve tools. Ten shipped; `search` and
`explain_number` did not, and the MCP server carried a comment saying why:
neither had a REST endpoint, and building them inside the MCP server would
have broken the rule that server exists under — "the MCP server is a client of
the public API, not a privileged path".

That comment was right, and it was also a note that two endpoints were missing
from the REST API, not from the agent surface. So they were built as endpoints.

## The rule held, and it cost something

The shortcut was always available: fan out across the existing list endpoints
inside the MCP process, filter there, and call it `search`. It would have
worked, in the sense that an agent would have got answers.

It would also have given an agent a capability no script could get. "Anything
an agent can do, a script can do, under one permission model and one audit
trail" is not a slogan about tidiness — it is what makes the audit log complete
and what makes the permission check happen once. A second path into the domain
is a second place for both, and the one that gets forgotten is the one the
agent uses.

So `GET /api/v1/search` and `GET /api/v1/explain` exist, and the two MCP tools
are thin over them. The cost was two endpoints, a repository, and a week's
worth of the decisions below. The benefit is that there is still one path.

## `search` is five queries, not a query language

Five resources — contacts, sales invoices, purchase invoices, journal entries,
documents — each matched on a fixed list of columns, plus a `types` parameter
that can only narrow. There is no filter expression, no field selector and no
sort parameter, and that is the same decision as the absence of a `query` tool
on the MCP server: the safety model is "never expose a generic query tool", and
a `search` a caller can widen is one.

Three things are worth reading:

**Ranked across resources, not grouped by them.** Somebody who types
`F-2026-0042` wants that invoice, and it should not be fourth behind three
contacts whose notes happen to contain the string. An exact identifier ranks 0,
a prefix 1, a substring 2, and the merge sorts on that before anything else.

**`%` is a character.** A bookkeeper searching for `50%` means fifty per cent.
Unescaped, that pattern matches the entire administration and the agent
summarises a list that means nothing — a wrong answer with no error. The
pattern is escaped and there is a test that searches for a percent sign.

**Every hit carries the path that reads it.** The tool exists to turn a word
into ids the other tools take. A hit with no drill-down is a title, and
answering from titles is precisely the failure "provenance is mandatory" is
about.

## `explain` has to be able to say the lines do not add up

`ties` is the field that earns this endpoint its place.

Everything else it returns is a list, and a list is only evidence if the figure
it is offered as evidence _for_ was checked against it. So the figure comes
from the report that publishes it — the trial balance, the aangifte, the
ageing — the lines are summed independently, and the difference is reported as
`unexplainedMinorUnits`.

`ties: false` is a useful answer. It is usually a hand-typed correction, and it
is the moment somebody finds one. Returning the lines as though they accounted
for the figure would hide exactly that, and would be worse than not having the
endpoint: a second confident number with a drill-down attached.

The drill-down reads the journal rather than `account_period_balances`, which
matters for the same reason. The balances table is the maintained tally and the
journal is the thing it is a tally of; an explanation assembled from the same
table as the figure it explains cannot disagree with it, and the whole point is
that it can.

### Three kinds of evidence, one shape

A rubriek is explained by journal lines, an ageing bucket by open invoices, and
a computed rubriek by the boxes it sums. `basis` says which arrived, and all
three share a shape — a reference, an amount, a path. A client that can render
"reference, amount, drill-down" renders all three, and the differences that
matter are named rather than left in the shape.

5a and 5c have no lines of their own, because no tax code may point at a
computed box. Flattening them into their constituents' journal lines would have
been possible and would have dropped the minus sign in 5c = 5a − 5b. They are
returned as the boxes they sum, each with its own `explain` URL.

### Debit-positive everywhere

Statements present every figure positive given the side of the sheet it belongs
on, which is how a Dutch balance sheet reads and which is useless for
arithmetic across sides. Here a debit is positive throughout, so the lines
genuinely sum to the figure and `ties` means something. Revenue therefore comes
back negative, which looks wrong for about a second and is the only convention
under which the check is real.

### Truncation cuts the list, never the arithmetic

`explainedMinorUnits` sums every line, shown or not. A total that counted only
the visible rows would report `ties: false` on precisely the large figures
somebody most wants to check.

## What the walk-through found

Driving both routes over HTTP, and the MCP server over stdio against a running
instance, found two things no unit test had:

- The schema's refine messages — "figure=vat-rubriek needs a rubriek, e.g. 1a"
  — were being dropped, and a caller got "Invalid input" against a field they
  had no reason to send. Zod 4's `addIssue` takes `message`, not `error`.
- A 422 reached the agent as "The query string is not valid." and nothing else.
  The API names the fields; the MCP client was discarding them. It carries
  `violations` now, which is the difference between one retry and several.

## Consequences

- Two operations, `discovery.search` and `discovery.explainNumber`, in their
  own group: neither belongs to a module, because search crosses five tables
  and an explanation starts from a reported figure rather than from a row.
- The MCP server has twelve tools, which is the table in spec 10.3.
- `SEARCH_RESOURCE_TYPES` lives in `@klopt/core`, not in the repository that
  implements the search: the query schema reaches the browser and `@klopt/db`
  does not.
- `SalesRepository.overdueInvoices` is now a wrapper over `openInvoices`, which
  leaves the due date open. The debtor ageing's first bucket is the invoices
  that are _not_ yet due, and filtering them out in SQL would have left that
  bucket permanently empty and the total short by exactly it.
- A batch of five substring queries per search. No full-text index yet; the
  columns are indexed for their own reads and `ILIKE '%…%'` cannot use them.
  That is a real limit at a few hundred thousand rows and it is not one this
  note pretends to have solved.
