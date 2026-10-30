# Component mapping — redesign 2026-10-v2 → shadcn/ui

Phase 0 of [#107](https://github.com/euro-oss/klopt/issues/107). Source of truth
is **v2** (`design/redesign-2026-10/`, sha256 `45a4d567…508a`; also on PR #106
commit `85dd802`).

The export’s `.k-*` classes are a **style reference**. We map them onto
`apps/web/src/components/ui/*` and thin app components — we do **not** ship
`bundle.css` as a second system.

## Mapping table (20 components from #107)

| #107 component                          | shadcn / app target                   | Phase 0 status | Notes                                                            |
| --------------------------------------- | ------------------------------------- | -------------- | ---------------------------------------------------------------- |
| **Button**                              | `ui/button`                           | Mapped         | Primary = ink (`--primary`), never yellow                        |
| **Badge** + **StatusPill**              | `ui/badge` variants                   | Mapped         | success / danger / info / attention (WARN); late = danger        |
| **Input**                               | `ui/input` + `.field-control`         | Mapped         | Accessible `--input` border (≥3:1); 44px touch                   |
| **Switch**                              | `ui/switch`                           | Mapped         | Profile Geavanceerd + lab                                        |
| **Tabs**                                | `ui/tabs` (underline + segmented)     | Mapped         | Route strips stay Link-based (`reports-tabs`, `journal-tabs`)    |
| **Kbd**                                 | `ui/keycap`                           | Mapped         | Mono via `--font-mono`                                           |
| **ListRow**                             | `scroll-table` / `item`               | Mapped         | No screen port in Phase 0                                        |
| **Callout**                             | `ui/alert`                            | Mapped         | attention / WARN → `--status-attention`; danger = red            |
| **ChoiceOption**                        | `ui/choice-option` on `radio-group`   | Mapped         | Primitive only; Match 1–4 restyle is Phase 5                     |
| **StatTile**, **TodoItem**, **NavItem** | app `Stat` / queue row / shell `Link` | Mapped         | v2 grouped rail in `app-shell` + `shell-nav.ts`                  |
| **CommandBar**                          | `command-palette`                     | Mapped         | Grouped results later (Phase 13)                                 |
| **Cover**                               | `ui/empty`                            | Mapped         |                                                                  |
| **CodeChip**                            | `ui/code-chip`                        | Mapped         | Mono + sunken                                                    |
| **DropZone**                            | `ui/drop-zone`                        | Mapped         | Honest copy only; wired into Inbox/import in later phases        |
| **Menu**                                | `ui/dropdown-menu`                    | Mapped         | Switcher still uses Popover + SelectField for e2e `chooseOption` |
| **PhoneTabBar**                         | `components/phone-tab-bar.tsx`        | Mapped         | Home · Sales · Inbox · Bank · More→#38 Sheet until Batch 3       |
| **Stepper**                             | `ui/stepper`                          | Mapped         | Import wizard keeps its own rail until Phase 11                  |
| **SubNav**                              | `settings-subnav.tsx` + Journal tabs  | Mapped         | Settings hub areas; Journal Entries / Trial (no Ledger)          |

**GuidedInvoice** is not in the 20 — it is **dropped** (decision 1). Do not build it.

## Gaps vs #107 Phase 0 list

None missing as primitives. Intentional Phase 0 limits (not gaps in the list):

1. **Journal Ledger tab** — [API]; omitted from UI (no tab, no placeholder).
2. **PhoneTabBar Receipt / More contents** — wait on Batch 3; More opens the existing Sheet; middle tab is Inbox (honest, no photo-reading promise).
3. **ChoiceOption Match 1–4** and **DropZone** on live upload screens — later phases; primitives ship in Phase 0 / `lab.primitives`.
4. **Menu** on EntitySwitcher — Popover retained for e2e; `dropdown-menu` is the mapped Menu primitive in lab.
5. **Stepper** not yet swapped into the import wizard rail — Phase 11.

## Sidebar (v2)

Home, Inbox · **Money** (Sales, Costs, Bank, Contacts) · **Books** (Journal, VAT, Reports) · footer **Import**, Settings, Shortcuts.

- Journal is top-level (`g j`) with SubNav: Journaalposten / Proefbalans (Ledger [API] omitted).
- Proefbalans is also Reports tab 5. No Geavanceerd gating on these.
- Settings hub may show “Switching to Klopt” (v2 does). Everything stays in ⌘K except [API]-hidden items.

## [API] items hidden from nav and ⌘K

Ledger, reports PDF export, reminder settings, categories (`/accounts`), entry attachments, bank rename, OAuth “make drafts”, KvK/Peppol registration. Chord `g a` remains for alphabet fullness but is not printed in ⌘K.

## Honest copy (shell / ⌘K)

No strings that imply PDF or photo reading; Peppol is never shown as live; VAT wording leads with manual filing (screen phases refine further).

## Config

`SHELL_NAV` in `apps/web/src/lib/shell-nav.ts` (`section`, `placement`).
Phone: `PHONE_TAB_BAR`. Journal: `JOURNAL_TABS`. Settings: `SETTINGS_SUBNAV`.
`lab.primitives` shows every mapped primitive in light and dark.
