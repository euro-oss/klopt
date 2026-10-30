# ListRow

One record in a list or table; the row the keyboard cursor is on gets the selection background and a yellow edge.

## Classes

- `.k-row` inside a `.k-card--flush`; set the columns with an inline grid.
- `.k-row--head` for the header row.
- `aria-selected="true"` or `.is-selected` for the cursor row.

## Rules

- Rows are at least `row-h` (48px). Numbers right-aligned with `.k-num`.
- `J`/`K` move the cursor, `↵` opens, `X` selects for bulk actions.
- Opening a row shows a preview to the right of the list when the screen is wide enough; a new page only for editing.
- Wide tables scroll sideways inside their card, never the page.
