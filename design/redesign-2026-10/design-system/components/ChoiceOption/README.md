# ChoiceOption

One answer to a question like "What was this?", picked with its number key; used for bank matching and any decision with a few clear paths.

## Classes

`.k-option` (a `<button>`) with `.k-option-key`, `.k-option-body` (`.k-option-title`, `.k-option-meta`) and, on the suggested one, `.is-suggested` plus a `.k-option-tag`.

## Rules

- Two to four options plus a last "Something else" that opens the full form.
- Titles describe the situation in the user's words ("Pays a purchase invoice"), the meta line says what will be booked.
- Choosing confirms and moves to the next item; `Z` undoes. No separate Save.
- At most one suggested option.
