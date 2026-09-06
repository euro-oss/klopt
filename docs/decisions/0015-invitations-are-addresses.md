# 0015. An invitation is an address, not a token

Status: Accepted
Date: 2026-09-06

## Context

Provisioning ([0014](0014-entity-provisioning.md)) creates exactly one member:
the owner. Everyone else — the bookkeeper, the external accountant, the auditor
who "never logs in, gets an export" (spec 4) — had to be added with SQL. The
role model was complete and there was no way to hand anybody a role.

The usual shape for this is an invitation token: generate a secret, put it in a
link, email the link, and exchange the token for a membership when it is
clicked. That is the right design when sign-in is a password, because the token
proves something the sign-in does not.

Here it does not prove anything the sign-in does not. Klopt's only credential is
a one-time code sent to an email address ([`packages/db/src/auth.ts`]). Control
of the mailbox _is_ the identity. An invitation link would be a second, weaker
credential — weaker because it sits in a mailbox indefinitely, is copied into
chat when somebody says "did you get it?", and survives being forwarded — for a
fact the sign-in already establishes.

## Decision

**An invitation is a row keyed by email address, and signing in with that
address claims it.** There is no token, no accept link and no accept endpoint.

`entity_invitations` holds the address, the role and an expiry. At sign-in — in
better-auth's `session.create.after` hook, so once per sign-in rather than once
per request — any live invitation for that address becomes a membership. The row
is kept and marked accepted rather than deleted, because "who let this
accountant in, and when" is a question an audit asks after the accountant has
been removed again.

Addresses are lower-cased on write and on match. The local part is
case-sensitive by RFC and no provider anyone uses treats it that way; an
invitation to `Jan@example.com` that a sign-in as `jan@example.com` cannot find
reads to the invitee as the invitation being ignored.

**Inviting an address that already has an account grants access immediately.**
There is nothing to wait for, and an acceptance step for somebody who already
signs in here is ceremony.

**The message is sent after the transaction commits, and a delivery failure does
not fail the invitation.** A relay that hangs would otherwise hold a serializable
transaction open, and a relay that fails would roll back an invitation that is
perfectly good — the invitee can sign in and claim it without ever seeing the
message. So the response reports the invitation and the delivery separately, and
the screen says which happened.

**An administration always has at least one owner.** Owner is the only role that
can manage membership, so losing the last one leaves books nobody can administer
and no route back that does not involve SQL. Removal and demotion can both cause
it, so the check takes the role the member would _end up with_ rather than the
name of the operation. It runs inside a serializable transaction: outside one,
two owners resigning at the same instant each see the other and both succeed.

## Consequences

There is no invitation link to leak, expire early, or support. The failure mode
that replaces it is that an invitation to a mistyped address is claimable by
whoever owns the mistyped address — which is exactly the failure mode of
emailing a sign-in code, and is why the list shows outstanding invitations by
address so a typo is visible before it is used.

Invitations cannot be used to pre-assign a role to somebody who signs in with a
_different_ address than the one invited — an OIDC deployment where the IdP
supplies a different primary address will not match. That is the same constraint
the sign-in has, and it moves when OIDC lands, not before.

Membership is owner-only (`members:manage`). An accountant can close a year but
cannot hand out keys. Widening that later is one line in `ROLE_PERMISSIONS`;
narrowing it after somebody relies on it is not.
