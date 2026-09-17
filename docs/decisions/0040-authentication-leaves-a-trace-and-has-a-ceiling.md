# 0040. Authentication leaves a trace, and has a ceiling

Status: Accepted
Date: 2026-09-11

## Context

Spec 14: _"Rate limiting and full audit on every authentication event."_

Neither half was true. Signing in left no trace at all — the audit log covered
every state change in the books and nothing about who had opened them. And rate
limiting was whatever better-auth defaulted to, which nothing in this
repository stated, configured or tested.

The second is the more insidious of the two. The default is real and it works,
so an audit would have found "rate limiting: yes". But nobody had chosen the
numbers, nobody could say what they were without reading a library's source,
and two of the default's properties are wrong here.

## The limits are ours now, and on in every environment

better-auth rate-limits **in production only**, holding counters **in process
memory**.

Production-only means the behaviour under test is not the behaviour shipped.
For a security control that is the same as not having tested it — and it is how
you discover, during an incident, that the thing you were relying on has never
once run.

In memory means a deploy hands everybody a fresh allowance, so the limit is
only as long as the uptime; and two replicas enforce two separate limits, so
the real allowance is whatever the operator happened to scale to. Neither is a
property anybody chose. Migration 0027 puts the counters in Postgres.

Two tiers, because the two risks are different:

- **Everything: 100 requests a minute.** A ceiling on a script hammering the
  endpoints. It is not about guessing a credential.
- **Asking for a code: six an hour.** Every one of those sends an email to
  somebody who may not have asked for it. The abuse worth preventing is using
  the sign-in form as a way to post mail to a stranger; the relay bill is
  secondary.

Guessing a code is deliberately **not** limited here. `allowedAttempts: 3`
already burns the code after three wrong tries, which is both tighter and
un-evadable — an attacker cannot reset it by changing address or IP.

### The switch, and why it is a switch

`disableRateLimit` turns it off, and the suites use it: they sign in more often
in three minutes than a person does in a year, and would otherwise spend their
time exercising the limiter rather than the thing they are about.

A switch rather than tunable numbers, on purpose. An operator who can widen a
limit from a config file widens it once, during an incident, and never narrows
it again. Off is at least legible in a deployment, and `createAuth` logs a
warning on the way past. It is not in `.env.example`: a setting listed there
reads as one you are expected to consider.

The limiter has its own test, which drives `auth.handler` rather than
`auth.api`. That distinction is the whole test: the limiter is request
middleware, so calling the server-side API directly walks straight past it —
which is exactly the mistake that would have left a green test over an open
endpoint.

## Where an authentication event belongs

The awkward part. Signing in is not an act inside a set of books: it happens
before one is chosen, and the address may reach several administrations or
none.

`entity_id = null` for everything would be honest and useless — the audit
screen filters by administration, so nobody would ever see one. Showing them
regardless of administration would be worse: one instance holds the books of
unrelated people, and an accountant's practice running two clients must not let
one read the other's sign-ins.

So: **an auth event is recorded against every administration the address can
reach**, one row each. That is the scope in which the fact matters — "who
opened my books, and when" — and it leaks nothing, because the reader already
has access to those books.

An address that reaches nothing gets a single instance-scoped row. A code
requested for an address with no account is the shape of a probe, and it is
worth keeping even though no owner's screen will show it: it is in the table
and in the export, which is where somebody investigating actually looks.

One consequence worth naming: the very first sign-in on a fresh instance, made
before any administration exists, is instance-scoped and therefore invisible on
every screen. An _invited_ user's first sign-in is not, because invitations are
claimed before the event is recorded — which is why that ordering is deliberate
rather than incidental.

## The address is the actor

`actor_id` is the email, not the user id. A failed or unrecognised attempt has
no user id, and a security log that cannot say which address was tried answers
none of the questions it exists for.

This does mean an address appears in the audit log for someone who may have no
account here. That is the same trade as ADR 0039's: the log holds what it needs
to be evidence, and an audit trail that has been pruned for tidiness is not
one.

## Consequences

- **Recording never blocks a sign-in.** Both call sites swallow and log. A log
  that cannot be written must not become a door that cannot be opened.
- **The code request is recorded after the send**, so a failed relay is not
  recorded as a code somebody could have used.
- **Signing out is not yet recorded.** The session hook fires on create, and
  better-auth has no equivalent on delete that carries the address. It is worth
  having and it is not here; the sign-in side is the half that answers "who got
  in".
