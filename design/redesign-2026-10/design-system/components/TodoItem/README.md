# TodoItem

A piece of waiting work on Home: what it is, why, how much, and the one button that starts it.

## Classes

`.k-todo` (an `<a>` to where the work happens) with a `.k-tile` (`--danger`, `--brand`, `--info` or neutral), `.k-todo-body` (`.k-todo-title`, `.k-todo-meta`), an optional amount, and a small button. The first item is `.is-selected`.

## Rules

- Title starts with the verb and the count: "Match 15 bank lines".
- Order by consequence: late money first, then work that blocks others (approvals), then deadlines.
- Only the top item's button is primary.
- An item leaves the list when its count reaches zero; an empty list says "Nothing waiting".
