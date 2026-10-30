# Klopt redesign export (30 October 2026)

- `screens/`: the 12 screens plus the sidebar component from the Klopt redesign canvas, as Design Component files (`.dc.html`), with `canvas.json` for the layout. They render inside the Claude Design canvas; outside it, use them as markup and style reference.
- `screens/ds/klopt/`: the design-system copy the screens load (`tokens.css`, `tokens.json`, `components/bundle.css`).
- `design-system/`: the Klopt Design System: `README.md` (brand book), `tokens.json`, `tokens.css`, `components/bundle.css` and a folder per component with guidelines and a live HTML preview.

To use the system in plain HTML: load `tokens.css`, then `components/bundle.css`, wrap the app in `class="k-root"`, and use the `.k-*` classes described in each component README.
