# Klopt redesign export (30 October 2026, v2)

- `screens/`: 38 Design Component files (`.dc.html`): every route of the app, phone layouts at 390px and dark-mode boards, plus the shared `Sidebar.dc.html`. `canvas.json` holds the layout and a title per board. They render inside Claude Design; outside it, use them as markup and style reference.
- Derived boards (`"derived": true` in `canvas.json`) were made by Design from this system for flows Hidde didn't draw; `DERIVED.md` lists them, their accessibility deviations and what to check. Screenshots are in `derived-shots/`.
- `screens/ds/klopt/`: the design-system copy the screens load (`tokens.css`, `tokens.json`, `components/bundle.css`).
- `design-system/`: the Klopt Design System v2: `README.md` (brand book, layout, phone and dark-mode rules, keyboard map), `tokens.json`, `tokens.css`, `components/bundle.css` and a folder per component with guidelines and a live preview.

Every screen takes a `theme` of `light` or `dark` on its root (`data-theme`). Boards marked "Example" (inbox documents, import findings, ICP) use made-up data; everything else uses the demo administration's real figures.

To use the system in plain HTML: load `tokens.css`, then `components/bundle.css`, wrap the app in `class="k-root"` with `data-theme`, and use the `.k-*` classes described in each component README.
