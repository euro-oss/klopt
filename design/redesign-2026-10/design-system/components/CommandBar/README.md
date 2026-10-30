# CommandBar

The ⌘K overlay: one box that finds any contact, document, page or setting and runs actions on what it found.

## Classes

`.k-cmd` (role dialog) with `.k-cmd-input`, `.k-cmd-group` headings, `.k-cmd-item` rows (`aria-selected` on the cursor) and `.k-cmd-foot`.

## Rules

- Group results: the best match first, then actions on it, then documents, then pages and settings.
- Highlight the matched letters in bold.
- `Tab` on a result shows its actions; `>` at the start limits to commands.
- Every page, setting and import that is not in the sidebar must be reachable here.
