# SubNav

The vertical list of sub-pages inside one Settings area (Company, Books, Access, Data), so settings never grow the sidebar.

## Classes

`.k-subnav` with `.k-subnav-item` links; the current one gets `.is-active` and `aria-current="page"`. A count or status can sit on the right as a `.k-code` or `.k-badge`.

## Rules

- At most seven items per area. More means the area should split.
- Every sub-page is also reachable from ⌘K by name.
