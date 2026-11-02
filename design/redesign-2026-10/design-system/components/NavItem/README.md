# NavItem

A destination in the sidebar: icon, label, and either a count badge or its `G` chord, revealed on hover.

## Classes

- `.k-nav`: the sidebar column on `surface-sunken`.
- `.k-nav-item` (`<a>`), current one with `aria-current="page"` (raised white, `shadow-raised`).
- `.k-nav-label`, `.k-nav-chord`, or a `.k-badge` in the chord's place.
- `.k-mark`: the yellow K in the administration switcher.

## Rules

- Exactly eight destinations: Home, Inbox, Sales, Costs, Bank, VAT, Reports, Contacts. Settings and Shortcuts sit at the bottom.
- A badge replaces the chord when there is waiting work; the chord still works.
- Anything else belongs in a page tab or in ⌘K, not in the sidebar.
