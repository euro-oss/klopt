# Input

A labelled text field; the label sits above, help text below, and optional fields say "optional" instead of required ones carrying a star.

## Classes

- `.k-field` wraps `.k-label`, `.k-input` and optional `.k-help`.
- `.k-label small` marks a field optional.
- `.k-search` is a label wrapping a search icon, an input and a `/` key hint; used for list filters.
- Add `.k-num` to inputs holding amounts or dates.

## Rules

- Help text explains where a default came from ("30 days, as agreed with this customer").
- Errors replace help text, in `danger`, starting with what to do.
- Dates in forms are `dd-mm-yyyy`; amounts use a comma for decimals.
