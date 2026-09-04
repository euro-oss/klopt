# 0013. The UI arrives with M0's screens, then per milestone

Status: Accepted
Date: 2026-09-04

## Context

The delivery order in section 15 never mentions the UI. Read literally, it could
be built at the end. Three things say otherwise:

- **M0's promise is "an accountant can already use it as a shadow ledger."** An
  accountant will not `curl`. Without screens, that promise is half-delivered.
- **Section 11.3 says the conventions must be fixed early** — you own the
  shadcn/ui source, so tokens, a financial primitives layer and the keyboard map
  have to be deliberate or the app drifts. It explicitly says to write the
  keyboard map before building screens.
- **M2 and M4 are irreducibly interactive.** A matching queue with one-keystroke
  confirm and a purchase-invoice approval inbox _are_ UI features. Deferring the
  UI past them defers their value entirely.

## Decision

**The UI arrives now, and each milestone ships its own screens with its own
domain.** The ordering rule inside a milestone does not change: domain first,
API second, screens third. The contract test already makes it structurally
impossible to have a screen without an API operation behind it.

Three things fixed now, because they are the ones that are expensive to change
later:

1. **`docs/keyboard-map.md`, written before any screen.** Screens declare intent
   (`entry.post`), never keys. `Cmd` versus `Ctrl` is resolved in one module.
2. **The financial primitives layer.** `Money` renders every figure in the
   application — tabular, right-aligned, one negative convention, parsed from a
   minor-unit string to `bigint` and never through `Number`. `LedgerTable` is a
   semantic `<table>`, so copy-to-spreadsheet, browser find and screen readers
   work without being features.
3. **Authentication, because the UI cannot exist without it.** better-auth with
   local accounts, per-entity membership, and roles from section 4.

## The rule that makes principle 3 survivable

A session and an API token resolve to **the same `RequestContext`**, differing
only in `actor.kind`. A role is a named bundle of the same permission strings a
token carries. Handlers, the domain and the audit log cannot tell which one they
are serving.

So the UI has no privileged path — not by convention, but because there is no
privileged path to have. Server functions call the same handlers `/api/v1`
calls. A test asserts the two context shapes are identical.

## Consequences

- **A module a route imports must export nothing but server functions and plain
  data.** TanStack Start strips handler bodies from the client bundle and drops
  the imports only they used; an exported top-level helper cannot be stripped,
  and its server-only imports follow it into the browser. Start's import
  protection then fails the build — correctly, and confusingly if you do not
  know the rule. Helpers live in `~/server/internal.ts`, which no route imports.
- Email verification is off. It needs an email transport, which arrives with
  Sales in M1, and until then it would just be a lockout for a self-hoster
  creating their own first account.
- OIDC is a configuration seam, not an implementation. Self-hosters want their
  own IdP (spec 11) and both paths land in the same `users` table.
- No command palette yet, and no `g`-prefix navigation, though both are in the
  map and in the binding registry. The registry is the contract; wiring the
  listener is small and lands with M1's screens.
