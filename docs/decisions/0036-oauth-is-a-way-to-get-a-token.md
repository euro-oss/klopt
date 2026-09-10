# 0036. OAuth is a way to get a token, not a second way in

Status: Accepted
Date: 2026-09-10

## Context

Spec 10.3 asks for "the same scoped tokens as REST and OAuth where the client
supports it". MCP over HTTP shipped with bearer tokens only, which means a
customer connects an agent by generating a token in Toegang and pasting it into
a config file. Some clients cannot even do that — Claude's custom connectors
authorise over OAuth or not at all.

So without this, "hosted" still means "hosted, and then do something manual".

## The decision

Klopt is its own authorization server. There is no separate IdP to defer to in
a self-hosted bookkeeping system, and the people allowed to read the books are
exactly the people who already have an account.

**An access token is an ordinary API token.** The flow ends by calling
`issueToken`, the same function the Toegang screen calls. So permission
checking, entity scoping, the audit trail, the `last_used_at` column and
revocation are the machinery that already exists rather than a parallel set
that has to be kept in agreement. `oauth_client_id` on `api_tokens` is the only
addition, so a person looking at Toegang can tell "Claude" from "a script
somebody wrote".

That is the whole idea: OAuth is a way to _obtain_ a token, not a second way in.

## What it will not do

**No refresh tokens.** A refresh token is a long-lived credential held by
software we did not write and cannot revoke individually. Re-running a flow
that is two clicks for somebody already signed in costs less than that. If
agents start being disconnected mid-task, this is the number to revisit — an
hour, on purpose, and deliberately rather than by adding a refresh token
because it is conventional.

**No write scopes.** `ledger:read` and `ledger:export`, and nothing else. The
write operations are reachable with a token somebody issued on purpose; what is
not on offer is a browser flow that hands an agent the ability to post to the
ledger because a person clicked "allow" on a screen they skim-read.

**No client secrets.** Every client is public — an MCP client on a laptop
cannot keep one — so PKCE with S256 is the entirety of the redemption's
authentication, and `plain` is refused because it puts the verifier in the same
message as the challenge.

## Registration is open, and that is fine

Dynamic registration (RFC 7591) has to be open: a client cannot ask a human to
pre-register it, and requiring that means nobody can connect anything.

What makes it safe is that **a client id grants nothing**. It is an opaque
random string that lets a client start a flow. Until a signed-in human reads a
consent screen and approves one specific request, no code exists and no token
exists. The redirect URIs are pinned at registration and matched exactly at
both the authorize and the token endpoint.

## The order of checks is the security property

In `checkAuthorization` the client and the redirect URI are validated **first**,
and every refusal above that line is `redirectable: false`.

This is the open redirect. If an error for an unknown client were bounced to
whatever `redirect_uri` the request carried, anybody could send a browser
anywhere by inventing a client id — and the same door later carries a real
authorization code. So those two refusals are rendered on a page here; only
once both are known good may an error travel to the client.

A related choice: the non-redirectable refusal renders _before_ the sign-in
check. There is no reason to make somebody produce credentials only to be told
the request was never going to work, and the case that matters — an
unregistered redirect — has to hold for a visitor with no session at all,
because that is who would be attacked.

## Exact match, and no `localhost`

Redirect URIs are compared exactly against the registered list, not by prefix or
by host: `…/callback` and `…/callback/../..` share both.

`https` is accepted anywhere; `http` only on a loopback **literal**, which is
RFC 8252's rule for native apps. `http://localhost` is refused even though it
looks equivalent, because the name resolves through somebody else's
configuration and the literal does not.

## Single use is enforced in the `where` clause

`consumeCode` updates `… where code_hash = $1 and consumed_at is null` and
reports whether it changed a row. Two concurrent redemptions both read an
unconsumed code; exactly one of them updates it, and the loser gets nothing.
Checking first and updating after would let both through.

This was written as `eq(consumedAt, consumedAt)` first, which is `NULL = NULL`
— false for exactly the rows it needed to match and true for the spent ones it
had to refuse. The single-use guarantee, inverted, in a line that reads fine.

`code_already_used` is also reported separately from `unknown_code`, and that
is not pedantry: a code redeemed twice is a code that leaked, and the response
is to revoke what it produced. That cannot happen if it looks like a typo.

## Audience binding

The `resource` parameter (RFC 8707) is checked at both ends and the metadata
advertises support for it, so a token minted for this instance cannot be
replayed against another one. That is the confused deputy the MCP authorization
spec calls out. A client that omits it is tolerated; a client that sends the
wrong one is not.

## Consequences

- **The consent screen is the only place a human decides**, so it says the
  three things that matter: which client, which administration, and what it
  will be able to read. It shows the redirect _host_ alongside the client's
  self-declared name, because registration is open and the name is whatever the
  client called itself — the host is the part an attacker cannot fake, since
  the code goes there and nowhere else.
- **The administration comes from the session, never the request.** A client
  asking for one set of books and being handed another is the confusion the
  whole flow exists to prevent.
- **Approval is audited** as `oauth.approve`, with the client, the redirect and
  the scopes.
- **Expired codes accumulate** until something deletes them.
  `purgeExpiredCodes` exists and nothing calls it yet; it belongs on the
  worker's nightly sweep.
- **Withdrawing an app revokes its tokens and keeps the registration.**
  Deleting the client row was the first attempt and the foreign key refused,
  rightly: `api_tokens.oauth_client_id` is what lets Toegang say "Claude" next
  to a revoked token instead of an opaque name, and deleting the client takes
  that with it. It would also buy nothing — registration is open, so a deleted
  client registers again with a new id, and every grant needs a human at the
  consent screen regardless. Withdrawal means "stop it working now", and that
  is the tokens.
