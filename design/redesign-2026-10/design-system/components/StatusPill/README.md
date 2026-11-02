# StatusPill

The state of one document (invoice, bill, VAT return), always as a word, never colour alone.

## Classes

`.k-pill` plus one of `--paid` (success), `--late` (danger), `--open` (info), `--draft` (neutral).

## Rules

- Say how bad it is when it is bad: "76 days late" in lists, "76 days overdue" in a detail header.
- Paid in a detail header carries the date: "Paid 12 Dec".
- One pill per row. If a row needs two states, the second is meta text, not a pill.
