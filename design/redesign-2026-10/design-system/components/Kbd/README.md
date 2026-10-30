# Kbd

A keyboard key, shown next to the action it triggers; two keys in a `.k-chord` are pressed one after the other.

## Classes

- `.k-kbd`: one key, JetBrains Mono 11px, `radius-xs`, `line` border on `surface`.
- `.k-kbd--on-primary`: the same key inside a primary button.
- `.k-chord`: wraps two or more keys pressed in sequence (`G` `F`).
- `.k-hints`: a row of key + verb pairs under a list or form: the shortcuts for this view.

## Rules

- Write keys in capitals (`G F`), symbols for `↵`, `⌘`, `⌫`, `Esc` and `Tab` in words.
- Every view that has view-specific shortcuts ends with a `.k-hints` row.
- In the sidebar, chord hints show on hover or focus only (`.k-nav-chord`), so the menu stays quiet.
