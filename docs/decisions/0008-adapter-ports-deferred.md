# 0008. Adapter port signatures wait for the domain types

Status: Accepted
Date: 2026-09-04

## Context

Requirement 8 names four adapter families — filing transport, bank feed,
e-invoice transport, payment initiation — and section 7.4 goes as far as naming
the `BankFeedProvider` methods. It is tempting to write all four interfaces
during the scaffold.

Their signatures are made of domain types that do not exist yet: a VAT return, a
statement line, an invoice, a payment batch. Inventing those to satisfy an
interface inverts the dependency — the port ends up shaped like whichever
adapter was imagined first, and the domain then has to accommodate it.

## Decision

`packages/adapters` ships with its directory structure, its README and the rules
that hold for all four families. The interfaces themselves are written when the
domain types they consume exist:

| Family              | Written at   | First implementation         |
| ------------------- | ------------ | ---------------------------- |
| e-invoice transport | M1 (Sales)   | email UBL fallback           |
| bank feed           | M2 (Banking) | CAMT.053 / MT940 file import |
| filing transport    | M3 (VAT)     | manual                       |
| payment initiation  | M2           | pain.001 file export         |

In every case the **first** implementation is the one that needs no third party
and no credential, per requirement 8 rule 1. Writing the credential-free path
first is also what stops the port from acquiring an accidental dependency on a
particular vendor's API shape.

## Consequences

- `packages/adapters` is nearly empty until M1. That is honest rather than
  embarrassing.
- Requirement 7.4's `BankFeedProvider` sketch — list accounts, fetch since
  cursor, refresh consent, report consent expiry — stands as the design intent.
  It is recorded here so it is not lost, not implemented here so it is not
  guessed.
