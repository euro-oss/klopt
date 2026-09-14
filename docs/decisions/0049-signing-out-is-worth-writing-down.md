# 0049. Signing out is worth writing down

Status: Accepted
Date: 2026-09-14

## Context

ADR 0040 built the authentication audit spec 14 asks for and left one hole,
named in the todo list ever since:

> **Signing out is not recorded.** The session hook fires on create and
> better-auth has no equivalent on delete that carries the address.

Half of that was right. `databaseHooks` really are create-and-update only —
the session's deletion is invisible there, and that is still true in 1.7.2.

The conclusion drawn from it was not. better-auth also has **request** hooks,
`hooks.before` and `hooks.after`, which fire on every endpoint and carry the
request. That is enough, and it is better than a database hook would have
been: it sees the endpoint rather than the row, so it catches both ways this
application signs somebody out — a plain form posting to `/sign-out`, and any
API client posting to `/api/auth/sign-out`. A hook on the table would have
caught session deletions that are not sign-outs at all, like an expiry sweep.

"Who got in" without "and when they left" answers half the question an
investigator asks. A session with no sign-out is one that is still open.

## Split across two hooks, because neither knows enough alone

`before` is the last moment the session still exists, so it is the only place
that can learn whose it is. `after` is the only place that knows the sign-out
succeeded. An audit line for a sign-out that failed would say a session was
closed while it is still open, which is worse than not writing it down.

So `before` resolves the account and `after` writes it, if and only if the
endpoint answered `{ success: true }`.

Resolution goes through the library's own `getSessionFromCtx` rather than
reading the cookie here. It knows how the token is signed and which of the two
names it goes under; a regex in this file would be a second implementation of
that, wrong on the day `useSecureCookies` changes.

## The bridge between them, and the thing that had to be checked

`createAuthMiddleware` builds a fresh wrapper per invocation, so the `ctx` the
`before` hook sees is **not** the object `after` sees. A `WeakMap` keyed on it
finds nothing — which is how this was discovered, by the value never arriving.

`ctx.context` is the object the dispatcher writes `returned` onto, which makes
it the request. Keying on that works. But "which makes it the request" was an
inference, and getting it wrong would put one person's address on another
person's sign-out — a worse bug than the one being fixed.

So it was measured rather than assumed. Two sign-outs driven together print:

```
before id=92512
before id=17862
after  id=92512
after  id=17862
```

Two distinct identities, each `after` matching its own `before`, and both
`before`s running ahead of either `after` — so the interleaving that would
expose a shared key does happen. `test/auth-security.test.ts` drives exactly
that and asserts each address gets exactly one line; replacing the key with a
single shared object fails it, with the first address getting none.

## Consequences

- `auth.signedOut` joins `auth.codeRequested` and `auth.signedIn`, scoped the
  same way — one row per administration the address can reach.
- The audit screen needs no change: it renders action strings as they are, and
  those strings are explicitly not part of the public promise.
- Two `as` casts remain, for `ctx.context`, which better-auth's
  `MiddlewareInputContext` does not declare although its own dispatcher writes
  to it. Named in one helper so a version that stops providing it fails at one
  line.
- Spec 14's "full audit on every authentication event" has no exceptions left.
