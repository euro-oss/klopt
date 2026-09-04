# 0009. Balance per currency, qualified

Status: Accepted
Date: 2026-09-04

## Context

Requirement 6.2 says an entry must be "balanced per entry, per currency,
enforced in the database, not only in the application".

Taken literally that rule forbids the commonest foreign-currency entry there is.
Paying a USD 100 supplier invoice from a EUR bank account debits USD 100 and
credits EUR 92: the USD side has nothing to balance against, and never will.

A second problem showed up in the property tests. Converting each line to the
functional currency independently and rounding each result does not preserve
balance. Three USD debits of 3.33, 3.33 and 3.34 against a credit of 10.00, at
0.335, convert to 1.12 + 1.12 + 1.12 = 3.36 against 3.35. The entry balances
perfectly in USD and is a cent out in EUR — so the database rejects it and the
user gets an error about an entry they typed in correctly.

## Decision

**The balance rule, precisely:**

- The functional-currency total must be zero. Always. This is the authoritative
  invariant and what every report rests on.
- A **single-currency** entry must also balance in that currency. This is what
  catches a typo or a wrong rate, and it covers nearly every entry.
- A **cross-currency** entry is exempt from the second check, because it cannot
  satisfy it.

**Conversion** is done per side on the side total, and the result distributed
back over the lines by largest remainder, ties to the earlier line. The two
sides' functional totals are then equal by construction, so rounding can never
be the reason an entry fails to balance. The allocation is deterministic, which
it has to be, because the result is hashed.

**A residual after conversion is never absorbed.** It can only arise when one
currency carries more than one rate, which is a realised exchange result — a
real economic event with a real amount. The posting is rejected with
`entry_unbalanced_functional` and the amount, and the user posts it to a
koersverschil account themselves. Requirement 6.1: every rounding difference has
a destination account.

@klopt/core and the database trigger implement the identical rule.

## Consequences

- Requirement 6.2 as written is slightly wrong and this record supersedes it.
  Worth correcting in the spec.
- Cross-currency entries lose a check that single-currency entries keep. The
  functional balance still catches an unbalanced entry; what is lost is catching
  a rate that is wrong in a way that happens to balance.
- Exchange differences are visible on the face of the entry rather than smeared
  across lines or absorbed into a suspense account. That is the intent.
- An `exchange_difference_account` setting per entity would let the system post
  the koersverschil line itself. Deliberately not built: it would be the system
  choosing an account, and doing that silently is what the requirement forbids.
  Revisit when sales and banking generate these automatically.
