# Component mapping — redesign 2026-10 → shadcn/ui

Phase 0 of [#107](https://github.com/euro-oss/klopt/issues/107). The export’s
`.k-*` classes are a **style reference**. We map them onto
`apps/web/src/components/ui/*` and thin app components — we do **not** ship
`bundle.css` as a second system.

Reference: [#106](https://github.com/euro-oss/klopt/pull/106)
`design/redesign-2026-10/`.

## Mapping table

| Export component | shadcn / app target                                     | Status in Phase 0 | Notes                                                                                       |
| ---------------- | ------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------- |
| **Badge**        | `ui/badge`                                              | Reused            | Brand / danger / neutral count badges use existing variants + tokens                        |
| **Button**       | `ui/button`                                             | Reused            | Primary = ink (`--primary`), never yellow                                                   |
| **StatusPill**   | `ui/badge` variant                                      | Reused            | success / danger / info / neutral via badge variants                                        |
| **Input**        | `ui/input` + `.field-control`                           | Reused            | Accessible `--input` border (≥3:1); 44px touch                                              |
| **Switch**       | new `ui/switch` (later phase) / profile `role="switch"` | Reused for now    | Profile Geavanceerd switch stays; shadcn Switch when a screen needs it                      |
| **Tabs**         | underline strip (Reports) + segmented filters           | Partial           | Reports tabs in `components/reports-tabs.tsx`; full shadcn `tabs` when more screens need it |
| **Kbd**          | `ui/keycap`                                             | Reused            | Mono via `--font-mono`                                                                      |
| **ListRow**      | `scroll-table` / `item`                                 | Reused            | No screen port in Phase 0                                                                   |
| **Callout**      | `ui/alert`                                              | Reused            | attention → `--status-attention` (currently red)                                            |
| **ChoiceOption** | `ui/radio-group` styled as option                       | Deferred          | Bank Match Phase 5; option **4** will deep-link to Journaalposten                           |
| **StatTile**     | app `Stat` on `item`                                    | Reused            | `app-shell` `Stat`                                                                          |
| **TodoItem**     | app queue row                                           | Reused            | Dashboard work queue; no visual port yet                                                    |
| **NavItem**      | shell `Link` rows                                       | **New chrome**    | Flat rail in `app-shell` + `shell-nav.ts`                                                   |
| **CommandBar**   | `command-palette`                                       | Reused            | Grouped results later (Phase 9)                                                             |
| **Cover**        | `ui/empty`                                              | Reused            |                                                                                             |

## What’s new in Phase 0

- Token layer `styles/tokens.css` + self-hosted Inter / JetBrains Mono / Ubuntu Sans
- Flat shell nav (8 + Settings/Shortcuts)
- Reports tab strip (incl. Geavanceerd Proefbalans + Journaalposten)
- Settings hub seed row “Overstappen naar Klopt”
- Keyboard: `n c`, `n r`, `x` select, `/` list filter, digit tabs on Reports

## What’s reused

- All existing `ui/*` primitives and flows (import wizard, match, VAT, …) —
  reskin-only in later phases
- ⌘K, `?` help, Geavanceerd, entity switcher, phone Sheet (#38)

## Later phases (not built now)

- **Invoice editor:** the one-page export editor **replaces** the guided flow
  (#45 / `lab/guided-invoice`) — confirmed for a later phase; do not build in Phase 0
- Full Settings hub grouping (Phase 10)
- Match ChoiceOption 1–4 and option-4 → `/entries` (Phase 5)
- Screen ports Home → Inbox → … per epic order

## Sidebar config

Single array: `SHELL_NAV` in `apps/web/src/lib/shell-nav.ts`.  
`placement: 'primary' | 'footer' | 'palette'` — moving Importeren / journal /
trial balance is a one-field change.
