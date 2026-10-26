# Klopt import wizard: HTML design mocks (#100)

Static design mocks for the guided Moneybird / Exact Online import in #100. They
are for review only. Nothing here is imported by `apps/web`.

They are built on the approved redesign (#57): `src/app.css` imports
[`../redesign/src/tokens.css`](../redesign/src/tokens.css) directly, and the shell,
nav, keycaps, badges, FindingCard, Sheet and AlertDialog are the redesign's.

## Open it

Double-click `index.html`, or open it from `file://`. No server, build or network
needed (`styles.css` is prebuilt, Ubuntu Sans ships in `assets/fonts/`).

Every state is a URL hash. The dashed **Mock** bar at the top (not app chrome)
switches step, source and state. Add `theme=dark`, `adv=1` (Geavanceerd),
`src=exact`, `notes=0` (hide design notes) or `proto=0` (hide the Mock bar) to any
link.

| Step                      | Hash                                                                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Bron                   | `#/bron`, resume entry `#/bron?resume=1`, restart dialog `#/bron?resume=1&confirm=restart`                                             |
| 2. Verbinden              | `#/verbinden`, `?state=error`, `?state=connected`, `?state=connected&confirm=disconnect`; Exact `?src=exact`, `?src=exact&state=nokey` |
| 3. Administratie en jaren | `#/administratie` (Exact: `?src=exact`)                                                                                                |
| 4. Voorbeeld              | `#/voorbeeld`, `?state=reading`                                                                                                        |
| 5. Btw-codes              | `#/btw`, `?excluded=1&toast=1` (#92), `?sheet=r5` (picker), `?resumed=1` (back after a break); Exact read-only list `?src=exact`       |
| 6. Rekeningen en relaties | `#/rekeningen` (Exact takeover accounts: `?src=exact`)                                                                                 |
| 7. Problemen              | `#/problemen`, `?busy=p-nif` (#99 Opnieuw lezen busy), `?sheet=fx`, `?resolved=1`                                                      |
| 8. Overzicht              | `#/overzicht`, `?confirm=import`                                                                                                       |
| 9. Importeren             | `#/importeren` (live), `?pct=61` (frozen), `?state=refused`                                                                            |
| 10. Klaar                 | `#/klaar` (period blocked, #95), `?state=clean`                                                                                        |

## Keyboard

Follows `docs/keyboard-map.md` and the redesign's guided invoice: `Enter` commits
the thing you are in, `Escape` abandons it.

| Key            | Action                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `↵`            | Volgende, when focus is not on a field, button or card                                                                          |
| `⌘↵` / `Ctrl↵` | Volgende from anywhere, including inside a field                                                                                |
| `Esc`          | Closes a sheet, dialog or popover first; in a field it only leaves the field; never Terug from a combobox, or on steps 9 and 10 |
| `↑` `↓`        | Move between the source cards (step 1)                                                                                          |
| `j` `k`        | Next / previous card (steps 5 and 7)                                                                                            |
| `↵` on a card  | That card's first action only. One `Enter` never confirms more than the focused rate.                                           |

Keycaps are printed on desktop and hidden below 768 px. Focus moves to the step
heading on every step change and returns to the trigger when a sheet closes.
Geavanceerd has no shortcut, as in the redesign.

## Screenshots

`npm install && npm run screenshots` writes every captured state to
`docs/pr-screenshots/100/` at 1440 and 390, light and dark. It fails on page
errors and on sideways scroll at 390. Rebuild the CSS with `npm run build:css`
after changing classes.
