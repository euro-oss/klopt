## What and why

Phase 0 of #107 only: tokens/theme, all 20 mapped components, v2 shell chrome, keymap, and ⌘K. No screen-family ports (phases 1–15).

Source of truth is Designer **v2** on #106 (`design/redesign-2026-10/`, commit `85dd802`).

### What’s in

- **Tokens + theme** from the v2 export (`tokens.css` → shadcn `@theme`), dark via `.dark`, self-hosted Inter + JetBrains Mono (no font CDN)
- **All 20 components** mapped onto `ui/*` / app chrome; `/lab/primitives` shows them in light and dark
- **v2 sidebar:** Home, Inbox · Money · Books · footer **Import + Settings + Shortcuts**
- **Journal** top-level (`g j`) with SubNav **Entries / Trial balance** — Ledger is **[API]** and omitted (no tab, no placeholder)
- **PhoneTabBar** Home · Sales · Inbox · Bank · **More → existing #38 Sheet** until Batch 3
- **Keymap** per decision 3 (`⇧⌘↵`, `/` list filter, `n i` = `n r`); `docs/keyboard-map.md` updated
- **[API] hidden from nav and ⌘K:** categories (`/accounts`), Ledger, reports PDF export, reminder settings, entry attachments, bank rename, OAuth make-drafts, KvK/Peppol registration
- **Honest shell/⌘K copy:** no PDF/photo-reading promises; Peppol not shown as live; VAT leads with manual filing where it appears
- **Boekhouddetails** on Settings (switch) and as a ⌘K action for every role; wizard checkbox relabelled
- **Overstappen:** Exact Online row kept (`/importeren?bron=exact`, hint “Niet in deze wizard”); XAF and Moneybird rows updated per Legal

### A11y deviations (export → shipped)

| Token / rule           | Export                             | Shipped                     | Ratio target |
| ---------------------- | ---------------------------------- | --------------------------- | ------------ |
| Home yellow link       | brand yellow text (~1.43:1)        | `--link` (≥4.5:1)           | text AA      |
| Input / control border | `--line-control` #c9c8c1 (~1.68:1) | `--input` ≥3:1              | UI AA        |
| Phone targets          | —                                  | min 44px                    | touch        |
| Readable text          | —                                  | no `ink-faint` as body text | —            |

`--status-attention` aliases export WARN (`--brand-ink` / `--brand-tint`); red stays destructive. `#105` Geen btw stays on `--status-geen-btw`.

### Component mapping vs #107

See `docs/design/component-mapping-2026-10.md`. **No missing primitives** from the Phase 0 list of 20. Intentional limits (not list gaps): Ledger tab omitted ([API]); PhoneTabBar Receipt/More contents wait on Batch 3; DropZone/ChoiceOption/Stepper primitives ship here and wire into screens later; EntitySwitcher keeps Popover+SelectField for e2e `chooseOption` while `ui/dropdown-menu` is the Menu primitive.

### Screenshots

Pinned at the tip of this PR in `docs/pr-screenshots/107/` — 1440 and 390, light and dark: Home, Reports tabs, Journal tabs, Settings Overstappen, primitives lab, PhoneTabBar; desktop EntitySwitcher open.

## Checks

- [x] `pnpm run verify` is green
- [x] Commits are signed off (`git commit -s`) — DCO, see CONTRIBUTING.md
- [x] No `number` in the money path
- [x] New domain operations have a route in `apps/web/src/api/manifest.ts` (n/a — no new API)
- [x] Regulated artefact changed? Golden-file diff is in this PR and explained below (n/a)
- [x] Migration added? Forward-only, and it does not rewrite history (n/a)

## Regulated artefact diff

n/a

Refs #107
