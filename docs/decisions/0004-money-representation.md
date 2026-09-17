# 0004. bigint minor units in process, decimal string on the wire

Status: Accepted
Date: 2026-09-04

## Context

Requirement 6.1: integer minor units plus an ISO 4217 code, never floats, never
a language-level decimal that silently converts. Requirement 11.1 adds that
TanStack Start serialises server function results automatically and `bigint` has
no JSON representation, so a wire format has to be chosen and enforced rather
than assumed.

## Decision

- In process: `Money = { minorUnits: bigint, currency: CurrencyCode }`.
- On every boundary — REST, server functions, MCP, CLI, webhooks:
  `MoneyWire = { amount: string, currency: CurrencyCode }`, where `amount` is a
  plain decimal string. A string, so that no JSON parser anywhere can round it.
- In Postgres: two columns, `*_minor_units bigint` and `*_currency char(3)`.
  Drizzle's `bigint` must use `mode: 'bigint'`; the default number mode returns
  a float.
- `fromWire` **throws** on excess precision rather than rounding. A rounding
  difference needs a destination account (6.1) and a codec has no business
  picking one.
- `klopt/no-number-money` fails the build when a money-shaped field is typed
  `number`, including inside a Zod schema.

## Consequences

- The lint rule is name-driven, so it is a tripwire and not a proof. It catches
  the accidental `total: number`. It does not catch `x: number` holding a total.
- FX rates are deliberately outside the rule's default pattern. They are not
  money and need their own representation decision, which is an M0 problem.
- Two database columns per amount is verbose. It is also the only way the
  currency travels with the number, which is what makes a multi-currency trial
  balance checkable.
