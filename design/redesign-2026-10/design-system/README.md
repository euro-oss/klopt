# Klopt

Klopt is open-source Dutch bookkeeping, the first product of euro.computer. The interface should feel as calm and obvious as the best consumer bookkeeping apps while staying fast enough for a bookkeeper who never touches the mouse. This system is extracted from the Klopt redesign canvas, which covers every route of the app.

## Principles

1. **Work first, numbers second.** Every main screen opens on what needs doing (a to-do list, a queue of bank lines, overdue invoices), then shows the figures.
2. **Plain words, accounting detail on request.** "Customers owe you", not "Debiteuren". Ledger numbers, RGS codes and VAT codes appear only when *Show accounting detail* is on (default on for bookkeepers and accountants, off for owners).
3. **Keyboard everywhere, shown where it is used.** Every action has a key. The key sits next to the action that uses it, never in a separate legend only.
4. **One yellow thing at a time.** Yellow means "here" or "needs you". If two things on screen are yellow, one of them is wrong.
5. **Black for the one primary action.** Each view has at most one primary button.

## Voice

- Short, direct, sentence case. No exclamation marks, no "Oops".
- Say what happened and what to do: "Your company address is empty. Customers still get the PDF, but Peppol needs it."
- Numbers are Dutch: `€ 1.016,88`, dates `28-11-2025` in forms and `28 Nov` in lists.
- Name things by what the user does, not by the table they live in: *Match*, *Chase*, *Approve*, *File*.

| Instead of | Write |
| --- | --- |
| Debtor ageing | How late customers are |
| Ledger accounts | Categories (Ledger accounts with detail on) |
| Dunning | Reminders |
| Fiscal years | Book years |
| Audit log | Who did what |

## Colour

Neutral, warm-grey ground (`ground`) with white cards (`surface`). Ink is near-black (`ink`), secondary text `ink-muted`. The brand is **Klopt yellow** (`brand`), used for the K mark, count badges of work waiting, and the keyboard cursor (`selection` + `selection-edge`). The primary button is `primary` (black), never yellow.

Status always pairs colour with a word:

| State | Pill | Tokens |
| --- | --- | --- |
| Paid, matched | `Paid` | `success` on `success-bg` |
| Overdue | `76 days late` | `danger` on `danger-bg` |
| Open, to approve | `Open` | `info` on `info-bg` |
| Draft | `Draft` | `ink-2` on `neutral-bg` |

Keyboard focus is a 2px `focus-ring` outline with a 2px offset: black in light, yellow in dark. The selected row (the keyboard cursor) is a different thing from focus: `selection` background plus a 3px `selection-edge` bar on the left.

## Type

Inter for everything, JetBrains Mono for keyboard keys only. Amounts always use tabular figures (`.k-num`). One page title (`page-title`, 24px) per page; cards use `heading` (16px). Column headers use `label`: 12px uppercase, tracked.

## Space, shape, depth

4px base: `space-2` inside controls, `space-5` card padding, `space-6` between cards, `space-8` page sides. Radii step up with size: keys `radius-xs`, controls `radius-md`, options `radius-lg`, cards `radius-xl`, overlays `radius-2xl`, pills `radius-pill`. Depth is borders, not shadows: cards have a 1px `line` border and no shadow. Only three things get a shadow: the active nav item (`shadow-raised`), paper previews (`shadow-paper`) and overlays (`shadow-overlay`).

## Layout

- App shell: sidebar (`sidebar-w`, 248px) on `surface-sunken` + content on `ground`.
- The sidebar is grouped. Ungrouped at the top: Home, Inbox. **Money**: Sales, Costs, Bank, Contacts. **Books**: Journal, VAT, Reports. Pinned at the bottom: Import, Settings, Shortcuts. Group labels use `.k-nav-group`. Second-level pages are underline **tabs** on the page, not menu items.
- List pages: page header (title, filter, primary action) → section tabs → segmented status filter → list card → hint bar. A detail preview sits to the right of the list rather than on a new page.
- Wizards (import, setup, guided invoice) show their steps with `.k-steps`; one decision per step, `↵` goes forward, `Esc` back.
- Settings sub-pages use a `.k-subnav` column on the left of the page, never extra sidebar items.

## Phone

Phones get their own layout at 390px (`.k-phone`), not a squeezed desktop. A bottom `.k-tabbar` holds five destinations: Home, Sales, Inbox (the camera for receipts), Bank, More. Lists become full-width cards, the preview pane becomes a page, and there are no hover states or keyboard hints. Touch targets are at least 44px.

## Dark mode

Every screen sets `data-theme` on its root (`light` or `dark`) and uses tokens only, never hex, so the dark theme is the same markup. The exceptions are documents that are paper (`.k-paper`): an invoice stays white in both themes. The focus ring turns yellow in dark.

## Keyboard

| Keys | Does |
| --- | --- |
| `G` then a letter | Go to: `D` Home, `E` Inbox, `F` Sales, `N` Costs, `K` Bank, `R` Contacts, `J` Journal, `G` VAT, `W` Reports, `I` Settings |
| `N` then a letter | New: `F` invoice, `R` receipt or bill, `C` contact, `J` journal entry |
| `⌘K` | Search or run any command |
| `J` / `K`, `↵`, `X`, `/` | Move, open, select, filter in any list |
| `1`–`4` | Switch status tab, or pick an option in a choice list |
| `⌘↵`, `Esc` | Save and continue, close or go back |
| `?` | Shortcut sheet |

Show keys with `.k-kbd`; a chord is two keys in `.k-chord`. Inside a primary button use `.k-kbd--on-primary`.

## Iconography

Inline stroke icons, 24px grid, 2px stroke, round caps and joins, drawn at 16–18px and coloured by `currentColor` (`ink-muted` at rest, `ink` when active). No filled icons, no emoji. No icon set is bundled yet: draw them in the style of Lucide.

## Logo

The mark is a capital **K** in Inter Bold on a `brand` square with `radius-md` (`.k-mark`). No logo file exists yet; build it in type until one does.

## Using this system

Load `tokens.css`, then `components/bundle.css`. Wrap the app in `.k-root`. Components are CSS classes (`.k-btn`, `.k-row`, …); there is no JavaScript bundle. Each component's README lists its classes and markup.
