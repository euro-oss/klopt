# 0037. A token you cannot revoke

Status: Accepted
Date: 2026-09-10

## Context

`tokens:manage` has been in the roles since they were written. Nothing used it.

There was no handler, no route and no screen for API tokens — so the only way
to issue one was to write SQL, and the only way to take one back was the same.
Meanwhile the README told people twice to "issue a read-only token under
Toegang", which was an instruction for a screen that had no tokens on it, and
the OAuth flow had just started minting them on its own.

That last part is what made it urgent. Authorising an agent created a
credential that the product had no way to show or withdraw.

## The decision

Four operations under `tokens:manage`: list, issue, revoke, and withdraw an
authorised app. They live on the Toegang screen, which is where the README has
been pointing all along.

`agentExposure: 'none'` throughout, and not arguable: a token is the thing an
agent authenticates with, and an agent that can mint tokens can mint one with
permissions it was not given.

## A token cannot exceed the person issuing it

`handleIssueToken` refuses any permission the caller does not hold. Without
that, `tokens:manage` is an escalation: issue yourself a token carrying
`payments:approve`, present it back, and approve your own payment run — which
is exactly what the two-person rule exists to prevent.

## The secret appears once

Only a hash is stored, so there is no second chance and no endpoint that could
return one. The screen says so before the token is created rather than after
the panel is closed.

## What the tests found

Three real defects, none of which a unit test would have reached.

**Withdrawing an app crashed on a foreign key.** The first implementation
deleted the client row, and `api_tokens.oauth_client_id` references it. The
constraint was right and the design was wrong: that column is what lets the
screen say "Claude" next to a revoked token, and deleting the client throws the
provenance away. Withdrawal revokes the tokens and keeps the row.

**The revoke button did nothing, silently.** It had `disabled={busy}` but not
`disabled={!hydrated}`, so before React attached its handler the button looked
live and swallowed clicks. No error, no request, no change — the worst
available failure. The convention in `useHydrated`'s own docstring is that a
control which cannot work without JavaScript renders disabled; this one had
been written without it.

**MCP accepted any non-empty string as a token.** The tool calls go back
through the REST API, which authenticates them — but `initialize` and
`tools/list` make no API call at all, so the endpoint answered them for
anything. Anybody could enumerate the tools, and a revoked token kept working
until something asked it for data. The endpoint resolves the bearer itself now,
before dispatching.

That last one was found by a test asserting a revoked token stops working. It
did not, and nothing else would have noticed.

## Consequences

- **The screen is owner-only** and renders nothing at all for anyone else,
  because `handleListTokens` refuses without `tokens:manage` and the component
  treats a refusal as "not for you" rather than an error.
- **Revoking is not undoable and there is no confirmation.** For a credential
  that is the right default — the dangerous direction is leaving one live.
- **Expiry is 90 days by default and can be null.** Null is a real choice
  somebody has to make rather than a hidden default, which is why the schema
  has no `.optional()` on it.
- **There is still no way to see which scopes an OAuth client asked for**
  beyond the permissions on the token it holds. Those are the same thing today;
  they stop being the same thing the moment write scopes exist.
