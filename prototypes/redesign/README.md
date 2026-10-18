# Klopt redesign: HTML prototype

The design direction for the whole-app redesign, as a clickable prototype. It is
for review only. Nothing here is imported by `apps/web`; Eng ports it screen by
screen. It replaces the Penpot boards that #40–#46 ask for.

## Open it

Double-click `index.html`, or open it in a browser from `file://`. No server,
no build and no network are needed: the stylesheet is prebuilt
(`styles.css`) and Ubuntu Sans Variable ships in `assets/fonts/`.

| Screen                                                           | Link                                              |
| ---------------------------------------------------------------- | ------------------------------------------------- |
| Dashboard                                                        | `index.html#/dashboard`                           |
| Moneybird import findings (#41, #42)                             | `index.html#/findings`                            |
| Fix: category + btw picker with RGS suggestions                  | `index.html#/findings?fix=f1`                     |
| Fix: exchange rate, ECB                                          | `index.html#/findings?fix=f2&notes=1`             |
| Fix: exchange rate, overridden                                   | `index.html#/findings?fix=f2&fxo=1`               |
| All findings resolved                                            | `index.html#/findings?state=done`                 |
| Guided sales invoice, Eigenaar, Geavanceerd off (#45), steps 1–4 | `index.html#/invoice?step=1` … `4`                |
| Bank matching                                                    | `index.html#/bank`                                |
| ⌘K palette, user menu, mobile menu, `?` help                     | add `palette=1`, `usermenu=1`, `menu=1`, `help=1` |

Any link takes `theme=dark` (light is the default). Everything is also
reachable by clicking and by keyboard: try `j`/`k`, `Enter`, `Esc`, `⌘K`,
`g d`, `g o`, `i m`, `n f` and `?`.

Screenshots of every screen at 1440 px and 390 px, light and dark, are in
[`screenshots/`](./screenshots).

## Tokens to adopt

[`src/tokens.css`](./src/tokens.css) is a drop-in replacement for the
unlayered `:root` / `.dark` blocks at the bottom of
`apps/web/src/styles/app.css`. It keeps every existing name (stock shadcn/ui
variables plus the app's `--status-*`, `--debit`, `--credit`,
`--amount-negative`, `--unreconciled`), so `shadcn add` components work
unchanged. The `@theme inline` block in [`src/app.css`](./src/app.css) is the
app's own, plus three lines for the new aliases.

What changes against today's `app.css`:

| Token                                | Today                 | Proposed                                    | Why                                                                                       |
| ------------------------------------ | --------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `--primary` / `--primary-foreground` | yellow / black        | black / white (dark: white / black)         | Yellow is a highlight, not the fill of every primary button.                              |
| `--sidebar-primary`                  | yellow                | follows `--primary`                         | Same reason.                                                                              |
| `--accent`                           | yellow                | yellow (unchanged)                          | The highlight role: current nav item bar, selected row bar, menu/option focus, key strip. |
| `--status-success`, `--success`      | –                     | green, `oklch(0.50 0.12 150)` / dark `0.74` | "Klopt", "Opgelost", "Gekoppeld", "Zeker".                                                |
| `--status-info`, `--info`            | –                     | blue, `oklch(0.50 0.14 255)` / dark `0.72`  | Neutral notices (btw-aangifte ready).                                                     |
| `--status-attention`, `--warning`    | `oklch(0.58 0.13 70)` | `oklch(0.56 0.14 55)` / dark `0.74 0.14 55` | Hue moved towards orange so it can't be mistaken for the yellow accent, mostly in dark.   |
| `--line`                             | black 25%             | black 18% (dark: white 20%)                 | Quieter dividers. Many hairlines on dense screens.                                        |
| `--input` (+ new `--line-strong`)    | = `--line`            | black 40% (dark: white 38%)                 | Form fields stay clearly visible against quieter dividers.                                |
| `--card` (dark)                      | surface               | black                                       | Cards are outlined, not filled, in both themes.                                           |

Unchanged rules: `--radius: 0`, no shadows anywhere, `--ring` black in light
and yellow in dark, one family (Ubuntu Sans Variable), weights 400/500/600, and
`.tabular` (tabular-nums) on every figure.

### How colour is used

- **Yellow `#FFD51E` is a highlight only**: the bar on the current nav item and
  the selected table row, the active option in pickers and the palette, the
  current step underline, and the keyboard strip outline. It is never a
  severity, never an error, and never a large fill.
- **Status has its own hues**: red (blocking, "Blokkeert import"), orange
  (attention, overdue, "Aangepast" rate), green (Klopt, Opgelost, Gekoppeld),
  blue (info). Warnings in findings are neutral grey, as #41 asks.
- **Unread ≠ empty ≠ reconciled**: green "Klopt", neutral "Leeg (bevestigd)",
  and a dashed neutral "Niet gelezen" with "Opnieuw lezen". Unread never uses
  red or yellow.

## Components (all shadcn/ui primitives)

| Prototype piece            | shadcn/ui                                   | Notes                                                                        |
| -------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------- |
| Sidebar, mobile menu       | `Sidebar` / `Sheet side="left"`             | Same nav list in both. Below 768 px: 48 px top bar, menu button, no tab bar. |
| FindingCard                | `Item` + `Badge` + `Button` + `Kbd`         | Props unchanged from `docs/finding-card.md`; this is the Phase 2 reskin.     |
| Guided fix                 | `Sheet side="right"`                        | 520 px on desktop, full width on phone.                                      |
| Category picker            | `Command` (combobox)                        | Ranked RGS → number → name; numbers and RGS codes only with Geavanceerd.     |
| Btw-tarief                 | `ToggleGroup` / `RadioGroup`                | "21% btw", "9% btw", "Geen btw"; codes (`VH21`) only with Geavanceerd.       |
| ⌘K palette                 | `CommandDialog`                             | Acties, Navigatie, then Inhoud from 2 characters.                            |
| User menu with Geavanceerd | `DropdownMenu` + `DropdownMenuCheckboxItem` | No shortcut, on purpose.                                                     |
| Confirm before issuing     | `AlertDialog`                               | Bottom sheet on phone.                                                       |
| Bank queue, invoice lines  | `Table` in an `overflow-x-auto` container   | Sticky first column on phone, not stacked cards.                             |
| Toast                      | `Sonner`                                    | Success feedback only; no undo on booked matches (a reversal is a button).   |

Icons are stroke placeholders; use the `@remixicon/react` equivalent.

## Data names

The prototype's data (`js/data.js`) uses the names Eng already ships:

- Findings: `{ code, path, messageKey, detail, severity, fix: { type: 'oneClick' | 'guided' | 'explainOnly' } }` and honesty `unread | empty | reconciled` (#52, `docs/finding-card.md`).
- Exchange rate (#55): `journal_lines.exchange_rate` is a decimal string, EUR per 1 unit of foreign currency (`"1.1531"`), and
  `journal_lines.exchange_rate_source` is `ecb:YYYY-MM-DD` or `override:YYYY-MM-DD`. Before commit the choice lives in
  `import_decisions.exchangeRates[externalId] = { rate, source, date }`.
  The rate sheet shows the label as **ECB · 2026-10-16** or **Aangepast · 2026-10-16**, and its "Prototype-notitie voor
  Eng" box prints exactly what would be stored, live as you type.
- ECB publishes foreign currency per euro (1 EUR = 0,8672 GBP). The sheet shows that figure for honesty and stores the
  inverse, as #55 does.

## Keyboard

Follows `docs/keyboard-map.md`; nothing new is bound.

- Findings: `j`/`k` move, `Enter` opens the fix (a one-click fix that changes the import shows a preview first, and a
  second `Enter` applies it), `Esc` closes.
- Pickers: type to filter, `↑`/`↓`, `Enter` or `Tab` chooses and moves to btw, `←`/`→` btw, `Enter` saves.
- Koppelen: `j`/`k`, `Enter` opens the panel, `Enter` again books, `u` drops the choice, `Esc` back.
- Invoice: `Enter` goes to the next step (never from inside a field except the customer search), `Esc` goes back.
- Keycaps are printed next to every nav item, in the palette, and in a yellow-outlined strip under each keyboard list.
  They are hidden below 768 px.
- **Geavanceerd has no shortcut**: `Shift`+letter is table type-ahead. It lives in the user menu and the palette, and
  is off by default for Eigenaar.

## Motion

Only where it explains a state change. All of it is off under `prefers-reduced-motion`.

| What                   | Motion                                                                       | Duration        |
| ---------------------- | ---------------------------------------------------------------------------- | --------------- |
| Sheet open             | slide from the edge; backdrop fades                                          | 200 ms          |
| Dialog, palette, menu  | fade + 4 px rise, 98% → 100% scale                                           | 160 ms          |
| Finding resolved       | green flash, check draws, "Opgelost · …" replaces the fix row, row collapses | 600 ms + 260 ms |
| Row matched            | green flash, "Gekoppeld" check draws in the Voorstel cell, row fades         | 420 ms + 200 ms |
| Counters (nav, header) | small bump when the number changes                                           | 300 ms          |
| Success screen / toast | check draws; toast rises                                                     | 320 ms / 200 ms |

## Copy

Plain Dutch for SME owners, following the glossary in #43: Categorie (not
Grootboek) in simple mode, "21% btw", Af/Bij on bank items, Uitgave/Inkomst in
forms, Klant or Leverancier per screen and "Klanten en leveranciers" where both
appear. A closed period names itself: "Dit kwartaal is afgesloten", "Dit jaar is
afgesloten".

## Decisions for review

1. Primary buttons are ink (black, white in dark), not yellow. See the token table.
2. Nav order puts the daily work first for Eigenaar: Verkoop, Inkoop, Geld, then Boekhouden, Rapporten, Importeren,
   Beheer. Ouderdomsanalyse becomes "Openstaand bij klanten" under Rapporten.
3. With Geavanceerd off, Journaalposten and Proefbalans leave the nav (still in ⌘K), and Grootboek / Debiteuren read
   as Categorieën / Openstaand bij klanten.
4. Bank items that fall in a closed period stay in the queue with the lock and the period's name, rather than
   disappearing.

## Working on the prototype

```sh
npm install            # Tailwind CLI + playwright-core, local to this folder
npm run build:css      # rebuild styles.css after changing classes
npm run screenshots    # rewrite screenshots/ (needs Chrome; CHROME_PATH to override)
npm run smoke          # keyboard walk-through of every flow
```

Files: `index.html` (shell), `js/data.js` (all copy and mock data), `js/app.js`
(screens, keyboard, motion), `src/tokens.css` (the tokens), `src/app.css`
(Tailwind entry). Fonts are Ubuntu Sans under the Ubuntu Font Licence
(`assets/fonts/LICENCE.txt`).
