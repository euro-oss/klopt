# FindingCard props contract

> Issue #41 Phase 1. Phase 2 (Design Penpot boards) may reskin visuals only —
> callers must not need to change.

`FindingCard` / `FindingsList` live under `apps/web/src/components/findings/`.
The typed contract and pure helpers live in `apps/web/src/lib/finding-card.ts`.

## Data

Every card renders from the wire shape already on Moneybird / inbound findings:

| Field        | Role                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------- |
| `code`       | Machine code (branching, keys, tests)                                                    |
| `path`       | Optional locator in the source                                                           |
| `messageKey` | Catalogue key; explanation is `t('finding.' + messageKey, detail)`                       |
| `detail`     | Placeholder values; amount fields as `€ 1.234,56` (finding currency, nl-NL), never cents |
| `message`    | English fallback from the API when no translation exists                                 |

Exact dry-run problems today ship `{ code, path, message }` only. Until #46
adds `messageKey`, callers pass a stable placeholder key and rely on `message`.

## Severity

- `blocking` — red leading bar + “Blokkeert import” badge
- `warning` — neutral grey leading bar + “Let op” badge

**Yellow is the product accent and never means error.**

Card chrome (aligned with Design Phase 2 naming): badge + mono `code` top-right,
plain explanation, “Waarom dit telt: …”, fix row with Enter keycap. Full Penpot
visual fidelity is Phase 2.

## Fix slot (`FindingFix`)

Discriminated on `type`. Phase 2 must keep these three variants:

### `oneClick`

```ts
{ type: 'oneClick'; label: string; preview?: FindingFixPreview; onApply: () => void | Promise<void> }
```

- Never posts on the first activation when `preview` is set: the card shows the
  preview, and only confirm calls `onApply`.
- If the action does not change the books, omit `preview`. `onApply` must still
  not post journal entries by itself without going through a preview flow
  elsewhere.
- Amounts in `preview.lines` are already euro strings.

### `guided`

```ts
{ type: 'guided'; label: string; onOpen: () => void; steps?: readonly string[] }
```

Opens a multi-step flow. Enter opens; Escape closes.

### `explainOnly`

```ts
{ type: 'explainOnly'; href?: string; linkLabel?: string }
```

Honest “you cannot fix this here”, with an optional link to where it can be
fixed. Phase 1 maps existing Moneybird / Exact / inbound rows here until
per-code fixes land (#42 / #46).

## Honesty states

Unread ≠ empty ≠ reconciled (`FindingHonesty`):

| State        | Meaning                                          |
| ------------ | ------------------------------------------------ |
| `unread`     | Source could not be read (not the same as empty) |
| `empty`      | Read, and there was nothing                      |
| `reconciled` | Read and balanced / matched to control           |

Rendered by `FindingHonestyState`. Never uses yellow or destructive for the
mere fact of being unread.

## Keyboard

| Key       | Binding id         | Action        |
| --------- | ------------------ | ------------- |
| `j` / `↓` | `finding.next`     | Next finding  |
| `k` / `↑` | `finding.previous` | Previous      |
| `Enter`   | `finding.openFix`  | Open the fix  |
| `Escape`  | `finding.closeFix` | Close the fix |

Documented in `docs/keyboard-map.md`, registered in `apps/web/src/lib/keyboard.ts`.

## i18n

- Explanation: `finding.<messageKey>` (NL in `nl.ts`, EN from core + overrides)
- Why it matters: `finding.why.<messageKey>`, label `findingCard.whyItMatters`
- Chrome: `findingCard.*` in both locales

## Phase 2 visual deltas (Design Penpot boards)

Phase 1 matched cheap naming/layout from the Design comment on #41. Left for
the visual reskin (props stay stable):

- Full board fidelity for light/dark desktop cards
- Phone boards (390 wide, #38): Sheet ☰ nav, 44×44 targets, stacked cards
- Dark-mode focus tint (yellow accent on the 2px focus border)
- Green “Klopt” honesty badge (Phase 1 uses foreground, not a new status colour)
- Honesty action affordances (“Opnieuw lezen” as a control, not only a hint)
- Thicker status bars / badge chrome polish beyond the leading `border-l-4`
