# 0035. An agent is a client, not a shortcut

Status: Accepted
Date: 2026-09-09

## Context

Spec 10.3 asks for a first-party MCP server, and it was due at **M2** — three
milestones ago. The machinery for it has been in place the whole time and
unused: every one of the 107 registered operations already declares an
`agentExposure` of `read`, `proposal` or `none`, the audit log already
distinguishes `human`, `script` and `agent` and records the principal behind an
agent's token, and tokens are already scoped per entity and per permission.

What was missing was the server.

## The architectural rule is the whole design

> "The MCP server is a client of the public API, not a privileged path. Anything
> an agent can do, a script can do, under one permission model and one audit
> trail."

This is not a layering preference. A second way into the domain is a second
place permissions get checked and a second place the audit log gets written,
and the one that gets forgotten is the one the agent uses. So `apps/mcp` reaches
Klopt over HTTP and nothing else — no database handle, no repository, no
`@klopt/db` import — and the lint config forbids the imports rather than trusting
a comment.

That constraint bit immediately and correctly. Driving the server end to end
needed a token, and issuing one needs `@klopt/db`, which `apps/mcp` cannot
reach. The walk-through issues it from `apps/web` and passes it in — exactly the
shape a real deployment has.

## Six tools, and two the spec names that are deliberately absent

`describe_schema`, `get_balance`, `list_open_items`, `vat_return_preview`,
`list_pending_approvals`, `export_xaf`. All read-only, matching the spec's own
staging: the MCP server ships read-only and gains write tools behind the
proposal model afterwards.

`search` and `explain_number` are missing because the REST endpoints behind
them do not exist. There is no cross-entity search and no route that takes a
reported figure and returns the lines that produced it.

The tempting shortcut was to build them _inside_ the MCP server, fanning out
across list endpoints and filtering in that process. That would have been a
capability an agent has and a script cannot get — precisely the second path the
rule forbids. They arrive when the endpoints do.

## No escape hatch, asserted rather than described

> "Never expose a generic query or SQL tool."

A claim like that stops being true the first time somebody adds a convenience
tool, and the entire safety model rests on it. So there is a test that
enumerates the registered tools and fails on a name containing `query`, `sql`,
`call`, `request`, `fetch`, `execute` or `raw`, and another that fails on
`file`, `send`, `post`, `issue`, `pay`, `approve`, `delete` or `seal`. Adding
the shortcut breaks the build.

## The hundredfold error

The most valuable thing this slice found is not in the spec.

Klopt's REST API serialises money as **minor units in a string** —
`"debit": "147425980"` — because handlers call `bigint.toString()`. That is
unambiguous to a program that knows the convention. Beside
`"currency": "EUR"`, it is catastrophic to a model: the honest reading is one
hundred and forty-seven million euro, and the real figure is €1.474.259,80.
Nothing in the payload contradicts the wrong one.

That is exactly what spec 10.3 means by "confidently wrong in a board pack",
and it is a hundredfold error that reads as plausible — the worst kind.

So amounts are converted once, at the boundary where numbers stop being data
and start being prose, and `provenance.amounts` states the unit rather than
leaving it to be inferred. `money()` passes through anything that is not an
integer string, because the one thing worse than not converting is converting
twice.

### The inconsistency underneath it

Worth writing down rather than quietly working around: `toWire()` in
`@klopt/core` produces decimal strings and is the documented convention, and
almost no handler uses it. The API is minor units nearly everywhere — and the
Exact handlers, written recently, are the outlier that emits decimals.

Two conventions in one API is a defect. Unifying 102 routes is its own piece of
work with its own risk, and the UI parses what it is given today, so it is not
done here. The MCP layer is protected; the API is not yet consistent.

## Provenance is an envelope, not a field

> "Every result carries entity, period, currency and the ids behind any number."

Making that a wrapper rather than a convention means there is nowhere to put a
bare number. A figure without the administration it belongs to, the period it
covers and the route it came from is a figure an agent will attribute to the
wrong company or the wrong quarter — and `sources` exists so a human can check
the agent's homework by asking the same question without this server in the
way.

Balances carry a `drillDown` for the same reason.

## Token discipline

> "Results are paginated and summarised by default, with an explicit expand.
> Never let a tool dump a full ledger into a context window."

`summarise` caps at 25 by default and 200 absolutely, and **says so in the
result**. Silence is the danger: an agent that does not know a debtors list was
cut will confidently name the largest debtor from the first twenty-five rows.

`describe_schema` is the exception at 500, because the chart is the vocabulary
every other question is phrased in, and truncating it is what makes an agent
guess at the account it cannot see.

`export_xaf` returns a reference and a byte count, never the file. A twelve-month
auditfile is megabytes of XML and nobody is going to read a line of it.

## Consequences

- **The write tools are the next slice**, and the proposal model is the point of
  them: `draft_journal_entry` and `draft_sales_invoice` create drafts a human
  releases. The operations registry already marks 25 operations `proposal`.
- **The CLI (spec 10.4) is still missing**, and it is the other headless surface.

## Addendum: HTTP, because stdio is the half a customer cannot use

The first cut shipped stdio only, on the reasoning that remote needed the token
story thought through. That was the wrong half to ship alone. stdio requires
the agent and the books to be on the same machine — for anybody using a hosted
Klopt it means installing a local Node process and keeping a token in a config
file, which is not a thing a customer will do. The address should just be the
instance.

So the endpoint is mounted at `POST /api/mcp` in the web app. Wherever Klopt is
hosted, MCP is there: same TLS, same tokens, nothing extra to deploy.

**Outside `/api/v1`**, because it is a protocol endpoint rather than a REST
resource. Under `/api/v1` it would look like one of the versioned operations
the contract test enumerates, and it is not one — it is a second way to reach
all of them. Its versioning is MCP's own.

**Stateless: one message per request.** No sessions, no SSE, no
server-initiated messages, so any number of instances can serve the same client
with no sticky routing and nothing to expire. Every request builds a fresh
server that has never seen an `initialize`, and there is a test asserting
`tools/list` works on one — because the day that stops being true is the day
this needs a session store to be hostable.

**Web-native rather than Node-shaped.** The SDK's own HTTP transport wants
Node's `req`/`res`; the web app speaks `Request` and `Response`. `Transport` is
four methods, so it is implemented directly instead of shimming pretend
streams.

**The loopback is deliberate.** Mounted inside the web app, the endpoint could
call the handlers directly and save a hop. It forwards the caller's token to a
client pointed back at its own origin instead, so a tool call is an ordinary
authenticated request landing on the ordinary handler, checking the ordinary
permission, writing the ordinary audit entry. Calling handlers directly is
where the second path starts — the one where an agent reaches something a
script cannot because nobody noticed the two had drifted. A few milliseconds on
the same host is a cheap price for there being exactly one way in.

### The bug this found

A notification has no reply. The transport waited for one anyway, so `initialize`
returned, the client sent `notifications/initialized`, and the connection hung
until undici gave up on headers that were never coming — **every hosted session
would have died at the handshake**. Curl never caught it, because curl does not
send the notification. Only driving the real SDK client against the real
endpoint did.

JSON-RPC defines a notification as a message with no `id`, so that is now the
test, and there is a regression test whose only real assertion is that the call
resolves at all.
