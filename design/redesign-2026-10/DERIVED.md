# Derived boards

Boards Hidde did not draw, derived by Design from his v2 system on his request. They use only `tokens.css`, `components/bundle.css` and the existing `.k-*` components, in the same `.dc.html` format, and are registered in `screens/canvas.json` with `"derived": true`. Batch 1 leaves Hidde's own boards unchanged, apart from the keymap fix, the XAF copy and the Sidebar fixture below.

## Command bar and shortcut sheet: dark and phone (#149)

Hidde's desktop-light `Command` board (the command bar with the query "zand", next to the keyboard shortcut sheet) gets a dark 1440 board and a phone 390 search sheet in light and dark. His file is not edited. Screenshots are in `derived-shots/command-149/`.

| Board | What it is | Screenshots in `derived-shots/command-149/` |
| --- | --- | --- |
| `CommandDark.dc.html`, `theme` prop (default dark) | Own file: Hidde's `Command` at 1440, Inter on the invoice tiles, the shortcut sheet matched to the real keymap, self-hosted fonts | `Command-dark-1440` |
| `PhoneCommand.dc.html`, `theme` and `view` props | The command bar at 390 as a full-screen search sheet. `view` = `results` (default: the query "zand") or `start` (empty: Create and Recent) | `Command-{results,start}-light-390` |
| `PhoneCommandDark.dc.html`, `view` prop | `PhoneCommand` with `theme="dark"`, passes `view` on | `Command-{results,start}-dark-390` |

All three are registered in `canvas.json` (note `t149` at y 41700, boards at y 42000): `CommandDark` at x 0 (1440 × 960, Hidde's size), the phone boards at x 1520 and 1990. Each entry has `"derived": true` and a `derivedNote`. Tapping the clear button on `PhoneCommand` switches from `results` to `start`.

### Why the dark board is a copy

A thin wrapper would keep two things the derived boards don't allow:

- Hidde's three invoice tiles set the "#" glyph in JetBrains Mono (`font: 600 10px var(--font-mono)`). On derived boards mono is only for `.k-code` and the keycaps (`.k-kbd`, which the bundle sets in JetBrains Mono and which stay as drawn). The copy uses Inter 600 11px and hides the glyph from screen readers.
- The shortcut sheet doesn't match the app's keymap (`apps/web/src/lib/keyboard.ts`). See "Keymap departures" below. Hidde's "Switch tab" hint also had a dash as a keycap of its own (`1 – 4`), which `shoot.mjs` flags.

Also in the copy: amounts get `nowrap`, and the fonts are self-hosted (a wrapper can't remove Hidde's Google Fonts link). Apart from the keymap departures, the layout, rows, keys and copy are Hidde's. The backdrop stays `--ink-faint`, which is #5a5a62 in dark. In dark the yellow selected row (`selection` with the `selection-edge` bar) keeps `ink` and muted text at 13.38 and 5.74:1.

### Keymap departures from Hidde's `Command`

Made on `CommandDark` to match the real keymap in `apps/web/src/lib/keyboard.ts` (and `docs/keyboard-map.md`, which says the sheet lists tabs as `1`–`5` and includes `G J`). Hidde's light board is unchanged and still shows his version.

1. **Switch tab: `1 2 3 4 5`** (Hidde: `1 – 4`). `tabs.switch` has keys `1-5` (keyboard.ts:46): Reports has five tabs.
2. **Journal `G J` in Go to**, after Bank and before VAT, where Journal sits in the sidebar (Books: Journal, VAT, Reports). `go.journal` (keyboard.ts:53). Hidde's sheet has no Journal row.
3. **`N C` moves from Create to Go to, as "Contacts".** `new.contact` goes to `/contacts`, the list, not a new-contact form (keyboard.ts:280–285; the app's label is "Go to contacts"). It shares the Contacts row with `G R`: "`G R` or `N C`". Create keeps Invoice and Receipt or bill.
4. **`⌘ ↵` is "Save (on each screen)"** (Hidde: "Save and continue"). There is no global ⌘↵. Each form binds its own: `invoiceForm.save`, `invoice.issue`, `entry.post` (keyboard.ts:388–414).

### Not built yet

| Command-bar hint on `CommandDark` (and Hidde's `Command`) | State in the app |
| --- | --- |
| `Tab` "actions for this item", `⌘ ↵` on "New invoice for Zandbank Advies", and "Type > for commands only" | Not built. `keyboard.ts` has no palette binding for Tab, ⌘↵ or a `>` prefix (the palette group has only `palette` ⌘K and `help` ?, keyboard.ts:35–42), and the palette handles only Escape, ↑, ↓ and Enter (`components/command-palette.tsx`). They stay visible on the board as design targets. |

### Phone: what the command bar becomes

A phone has no keyboard shortcuts, so on phone the command bar is a **search sheet**:

- **Full screen, over the tab bar.** A 48px search field (`--ink-muted` border, 17px text) with a 44px clear button, and Cancel (44px) to the right. The field holds the focus, so the phone keyboard is open; the board doesn't draw it. Cancel closes the sheet and goes back to where it was opened.
- **No key hints.** No `Esc`, `↵` or `⌘ ↵` chips, no ↑ ↓ / ↵ / Tab footer and no "Type > for commands only". Commands appear in the results as rows, as they do on desktop.
- **Nothing pre-selected.** On desktop the yellow row is the keyboard cursor. A phone has no cursor, so every row looks the same and tapping one opens it.
- **Rows are links, 56px or more,** with a 32px tile and a chevron, in Hidde's groups: Contact, "Do something with it", Invoices. A row's trailing detail moves to a second line ("Customer · 4 invoices · € 958,34 overdue", "128 days late", "28 Nov · paid"). The amount stays on the right in Inter tabular, and "€ 958,34 overdue" doesn't wrap.
- **"New contact" stays on `view=start`.** `N C` only opens the list, but the app does have a create-contact flow: the New contact button on `/contacts` opens the form (`contacts.new`, `routes/_app/contacts.index.tsx`). So the row stays and goes to `PhoneContacts`, where that button is.
- **`view=start`** is the empty sheet: placeholder "Search or jump to" (the sidebar's label), then **Create** (New invoice, Receipt or bill, New contact) and **Recent** (a contact, an invoice, a page). This shows how actions work on phone without a query.

### Phone: no shortcut sheet

The shortcut sheet has no phone board, on purpose. It only lists keys, and phones show no key hints (#149). `PhoneMore` (#150) already leaves Shortcuts out of More for the same reason, and `?` has nothing to open on phone. On phone the Create and "Do something with it" rows in the search sheet take its place. A tablet with a hardware keyboard gets the desktop layout, so it isn't covered here.

### Rules for these boards

- Control borders: `.k-root[data-theme]{--line-control:var(--ink-muted)}`, the same rule as #145 to #148. On phone it is used for the search field.
- Targets are 44px or more on phone (field 48px, clear and Cancel 44px, rows 56px or more). There are no text links, so nothing is yellow. No `ink-faint` for text. No new status colours: "overdue" stays `danger`, as on Hidde's board.
- Amounts, dates and invoice numbers are Inter with tabular figures (`.k-num`, `nw` on amounts). JetBrains Mono is only on the desktop keycaps.
- `shoot.mjs` printed no QA warnings for the five shots.

### Invented, for Hidde to check

- **Where the sheet opens from.** It isn't drawn. The proposal is a 44px search button in the top bar of Home and More, the phone equivalent of the sidebar's "Search or jump to". `PhoneMore` (#150) and `PhoneHome` aren't changed in this PR.
- **`view=start`.** The Create rows (New invoice, Receipt or bill with "Take a photo or choose a file", New contact) and the Recent rows (Zandbank Advies "Contact", 2025-0036 "Invoice · Zandbank Advies" € 958,34, Bank "Page") are invented. Hidde's board only shows results.
- **Cancel and the clear button**, and "Customer" with a capital C on the second line.
- **Where the rows go.** The contact goes to `PhoneContactCard`, invoices and the final notice to `PhoneInvoice`, Receipt or bill to `PhoneReceipt`, Bank to `PhoneMatch` and New contact to `PhoneContacts`. New invoice goes to the desktop `Editor`, because there is no phone invoice editor yet.

### Contrast (WCAG 2.x)

| Pair | Light | Dark |
| --- | --- | --- |
| Search field border (`ink-muted`) on `ground` | 5.45:1 | 7.36:1 |
| Muted second line (`ink-muted`) on `surface` | 5.95:1 | 6.77:1 |
| "overdue" (`danger`) on `surface` | 6.57:1 | 6.28:1 |
| Amounts (`ink-2`) on `surface` | 10.44:1 | 11.75:1 |
| Desktop selected row: `ink` / muted text on `selection` | 16.62 / 5.59:1 | 13.38 / 5.74:1 |

### Shooting

From `design/redesign-2026-10/`:

```sh
O=derived-shots/command-149
node derived-shots/render/shoot.mjs $O --width=1440 'CommandDark.dc.html?theme=dark=Command-dark-1440'
node derived-shots/render/shoot.mjs $O --width=390 \
  $(for v in results start; do echo "PhoneCommand.dc.html?view=$v=Command-$v-light-390" "PhoneCommandDark.dc.html?theme=dark&view=$v=Command-$v-dark-390"; done)
```

### Copy, English and Dutch

Strings Hidde already has on `Command` are not repeated here.

| English (board) | Nederlands |
| --- | --- |
| Search or jump to | Zoek of ga naar |
| Clear search | Zoekopdracht wissen |
| Cancel | Annuleren |
| Customer · 4 invoices · € 958,34 overdue | Klant · 4 facturen · € 958,34 te laat |
| 128 days late | 128 dagen te laat |
| 28 Nov · paid / 26 Jul · overdue | 28 nov · betaald / 26 jul · te laat |
| Create | Nieuw |
| New invoice / Receipt or bill / New contact | Nieuwe factuur / Bon of factuur / Nieuw contact |
| Journal (Go to) | Journaal |
| Contacts: G R or N C | Relaties: G R of N C |
| Save (on each screen) | Opslaan (op elk scherm) |
| Take a photo or choose a file | Maak een foto of kies een bestand |
| Recent | Recent |
| Contact / Invoice · Zandbank Advies / Page | Contact / Factuur · Zandbank Advies / Pagina |

## Inbox: first run and check-and-book, dark and phone (#148)

Hidde's two desktop-light Inbox boards (`Inbox`, `InboxReview`) get a dark 1440 board and phone 390 boards in light and dark. His files are not edited. Screenshots are in `derived-shots/inbox-148/`.

| Board | What it is | Screenshots in `derived-shots/inbox-148/` |
| --- | --- | --- |
| `InboxDark.dc.html`, `theme` prop (default dark) | Own file: Hidde's `Inbox` with honest copy, `--line-control` on `--ink-muted`, outlined key hints in the primary button, self-hosted fonts | `Inbox-dark-1440` |
| `InboxReviewDark.dc.html`, `theme` (default dark) and `view` props | Own file: Hidde's `InboxReview` in the honest PDF state (`view=pdf`, default) or with the e-invoice open (`view=ubl`), same overrides | `InboxReview-{pdf,ubl}-dark-1440` |
| `PhoneInbox.dc.html`, `theme` prop | First run at 390: status chips, the empty card with Take a photo and Choose files, three sources, three steps | `Inbox-light-390` |
| `PhoneInboxDark.dc.html` | `PhoneInbox` with `theme="dark"` | `Inbox-dark-390` |
| `PhoneInboxReview.dc.html`, `theme` and `view` props | Check and book at 390: documents, the open document, the form, sticky Book and next | `InboxReview-{pdf,ubl}-light-390` |
| `PhoneInboxReviewDark.dc.html`, `view` prop | `PhoneInboxReview` with `theme="dark"`, passes `view` on | `InboxReview-{pdf,ubl}-dark-390` |

`view` on `InboxReviewDark` and `PhoneInboxReview` is `pdf` (Hidde's Telecom Fictief PDF is open; the default) or `ubl` (the Internet Voorbeeld e-invoice is open). Tapping either document switches.

All six boards are registered in `canvas.json` (note `t148` at y 37700, boards at y 38000, under the #147 rows): the two dark desktop boards at x 0 and 1520, the four phone boards at x 3040 to 4450. Each entry has `"derived": true` and a `derivedNote`.

### Why both dark boards are copies

A first version of this PR made them thin wrappers, which kept Hidde's copy: "Klopt reads them", "Klopt reads it", and highlights with ✓ checks on a PDF. `POST /inbox` reads only UBL and Peppol, and #107 Phase 5 says derived boards drop claims like that while Hidde's boards stay as drawn. A wrapper can't change copy, so both are now own files copied from Hidde's boards, with the copy of the phone boards (below). Hidde's `Inbox` and `InboxReview` are unchanged and still need the same fix in whichever PR owns them.

- `InboxDark`: same layout, sources and steps. The drop, paste (⌘V) and screenshot intake stay, but the text no longer says they get read: "Drop PDFs, photos or e-invoices anywhere on this page, paste a screenshot with ⌘V, or connect a source below so they arrive by themselves. E-invoices (UBL) are read for you; for a PDF, photo or screenshot you fill in what it says." The header, the three source cards and step 1 use the phone copy. The text block is 520px wide (Hidde: 460px) for the longer line.
- `InboxReviewDark`: same three columns. With `view=pdf` (default) the PDF has no highlights, its footer is "factuur-november.pdf · 1 page", and the form starts empty under "Klopt doesn't read PDFs or photos. Fill in what the document says." With `view=ubl` the Internet Voorbeeld e-invoice is open, highlighted, with Hidde's ✓ labels and "check this" category. The documents list matches the phone board; clicking the PDF or the e-invoice switches.
- Kept from the wrappers: control borders on `--ink-muted`, outlined key hints in the dark primary button. The suggested category keeps Hidde's 2px yellow `selection-edge` border in dark (10.65:1); in light it is drawn as the inner ring over the `--ink-muted` border, as on phone. Fonts are self-hosted (`fonts.css`) instead of Google Fonts. Cross-links go to `InboxReviewDark` and `BillNewDark`.

### Honest copy (#107 Phase 5, #148)

`POST /inbox` reads UBL and Peppol only. On all six boards:

- Nothing promises reading PDFs, photos or screenshots. "Klopt reads them" becomes "You check them and book"; step 1 is "It lands here: an e-invoice is read… For a PDF or photo, you fill these in"; the empty card says "E-invoices (UBL) are read for you. For a PDF or photo, you fill in supplier, amount and VAT next to it."
- Highlights, "Highlighted: what Klopt read" and the ✓ checks appear only for the e-invoice (`view=ubl`). With the PDF open (`view=pdf`), the document has no highlights and the form starts empty under "Klopt doesn't read PDFs or photos. Fill in what the document says."
- For the same reason the documents list shows file names (`factuur-november.pdf`, `IMG_2041.jpg`) with a "To fill in" pill, not a read supplier and amount; the e-invoice shows its supplier and "Ready", as on Hidde's board.
- The Peppol card says "Not set up" and "Once Peppol receiving is set up…", matching "Not reachable yet" on SettingsCompany. The mailbox card drops "every five minutes" (no timing promise). The folder card says "the usual choice when you run Klopt on your own server".
- On the dark desktop boards the drop, paste and screenshot intake stay, without a promise that they get read. No paste-a-screenshot and no key hints on phone.

### Rules for these boards

- Control borders: `.k-root[data-theme]{--line-control:var(--ink-muted)}`, the same rule as #145 to #147. Inputs, selects, chips, secondary buttons and the drop card use it.
- The suggested category keeps the `--ink-muted` border and gets Hidde's yellow as a 1px inner ring (`selection-edge`), as on `SettingsCompanyDark`.
- Links are ink and underlined, 44px tall on phone ("See it with example documents", the three source links, "‹ Inbox"). No `ink-faint` for text. No new status colours: "To fill in" is the draft pill, "Ready" the paid pill, "check this" stays `brand-ink`, the ✓ stays `success`.
- Phone: `.k-phone` at 390, Hidde's five-tab bar with More active (Inbox lives under More), sticky at the bottom. Targets are 44px or more; document rows are 60px. Book and next is 48px; Set aside and Not a bill are 44px, all in a sticky bar above the tab bar.
- Amounts and dates are Inter with tabular figures (`.k-num`, `nw` on amounts). The step numbers are Inter (Hidde's `.k-option-key` is JetBrains Mono). `.k-paper` stays white in both themes.
- `shoot.mjs` printed no QA warnings for the nine shots.

### Invented, for Hidde to check

- **The e-invoice's content.** Hidde draws Internet Voorbeeld only as a "Ready" row. `view=ubl` opens it as INK-DEMO-2025-0003, 15-11-2025, due 15-12-2025, "Zakelijk internet, november" 208,95 + 21% 43,88 = 252,83 (the amount Internet Voorbeeld has outstanding on Reports' "You owe"), with the same ✓ labels and the "check this" category as his PDF.
- **The photo row.** Hidde's "Brandstof Teststation · photo · phone · € 159,21" becomes `IMG_2041.jpg`, "Photo · from your phone", "To fill in" (the file name is the one on `PhoneReceipt`).
- **Phone first run.** Take a photo (primary, to `PhoneReceipt`) and Choose files in the empty card. "See it with example documents" is an underlined link under the chips instead of a fourth segment. "Finish company details" goes to `PhoneSettingsCompany` (#147, PR #190).
- **Phone review.** "‹ Inbox" back link; the paper is full width with the file name and page count under it ("factuur-november.pdf · 1 page"); Total gets "Including VAT" as help; empty fields have the placeholders "Start typing a name", "dd-mm-yyyy", "0,00" and "Choose a category".

### Contrast (WCAG 2.x)

| Pair | Light | Dark |
| --- | --- | --- |
| Control, chip and drop-card border (`ink-muted`) on `surface` | 5.95:1 | 6.77:1 |
| v2 `line-control` on `surface` (replaced) | 1.68:1 | 1.98:1 |
| Hidde's category border (`selection-edge`) on `surface` | 1.90:1 (phone keeps `ink-muted` under it) | 10.65:1 |
| "check this" (`brand-ink`) on `surface` | 5.07:1 | 10.65:1 |
| Selected document: `ink` / muted text on `selection` | 16.62 / 5.59:1 | 13.38 / 5.74:1 |
| "To fill in" (`ink-2` on `neutral-bg`) | 8.98:1 | 9.66:1 |
| "Ready" (`success` on `success-bg`) | 5.48:1 | 8.90:1 |
| Honest note (`ink-2`) on `surface-sunken` | 9.14:1 | 12.34:1 |

### Shooting

From `design/redesign-2026-10/`:

```sh
O=derived-shots/inbox-148
node derived-shots/render/shoot.mjs $O --width=1440 'InboxDark.dc.html?theme=dark=Inbox-dark-1440' 'InboxReviewDark.dc.html?theme=dark&view=pdf=InboxReview-pdf-dark-1440' 'InboxReviewDark.dc.html?theme=dark&view=ubl=InboxReview-ubl-dark-1440'
node derived-shots/render/shoot.mjs $O --width=390 'PhoneInbox.dc.html=Inbox-light-390' 'PhoneInboxDark.dc.html?theme=dark=Inbox-dark-390' \
  $(for v in pdf ubl; do echo "PhoneInboxReview.dc.html?view=$v=InboxReview-$v-light-390" "PhoneInboxReviewDark.dc.html?theme=dark&view=$v=InboxReview-$v-dark-390"; done)
```

The dark phone shots go through the `Phone…Dark` wrappers, so they also check that `view` is passed on.

### Copy, English and Dutch

Strings Hidde already has on his Inbox boards are not repeated here.

| English (board) | Nederlands |
| --- | --- |
| Drop PDFs, photos or e-invoices anywhere on this page, paste a screenshot with ⌘V, or connect a source below so they arrive by themselves. E-invoices (UBL) are read for you; for a PDF, photo or screenshot you fill in what it says. | Sleep pdf's, foto's of e-facturen ergens op deze pagina, plak een screenshot met ⌘V, of stel hieronder een bron in zodat ze vanzelf binnenkomen. E-facturen (UBL) worden voor je gelezen; bij een pdf, foto of screenshot vul je zelf in wat erop staat. |
| Receipts and bills land here. You check them and book. | Bonnen en facturen komen hier binnen. Jij controleert en boekt ze. |
| See it with example documents | Bekijk het met voorbeelddocumenten |
| Take a photo, add a PDF or UBL file, or connect a source below so they arrive by themselves. | Maak een foto, voeg een pdf of UBL-bestand toe, of stel hieronder een bron in zodat ze vanzelf binnenkomen. |
| Take a photo / Choose files | Maak een foto / Kies bestanden |
| E-invoices (UBL) are read for you. For a PDF or photo, you fill in supplier, amount and VAT next to it. | E-facturen (UBL) worden voor je gelezen. Bij een pdf of foto vul je leverancier, bedrag en btw ernaast in. |
| Forward bills to a mailbox Klopt checks for you. | Stuur facturen door naar een mailbox die Klopt voor je controleert. |
| …the usual choice when you run Klopt on your own server. | …de gebruikelijke keuze als je Klopt op je eigen server draait. |
| Not set up | Niet ingesteld |
| Once Peppol receiving is set up, suppliers who send e-invoices reach you directly, already read. It needs your KvK number first. | Zodra ontvangen via Peppol is ingesteld, komen e-facturen van leveranciers direct binnen, al gelezen. Daarvoor is eerst je KvK-nummer nodig. |
| It lands here / An e-invoice is read: supplier, date, amounts and VAT. For a PDF or photo, you fill these in. | Het komt hier binnen / Een e-factuur wordt gelezen: leverancier, datum, bedragen en btw. Bij een pdf of foto vul je die zelf in. |
| Next to the document. Book it, or set it aside. | Naast het document. Boek het, of leg het apart. |
| ‹ Inbox | ‹ Inbox |
| To fill in | Nog invullen |
| PDF · from email / Photo · from your phone / E-invoice · UBL (desktop: PDF · email / photo · phone / e-invoice · UBL) | Pdf · uit e-mail / Foto · van je telefoon / E-factuur · UBL (desktop: pdf · e-mail / foto · telefoon / e-factuur · UBL) |
| e-invoice · UBL (the Internet Voorbeeld row; it names the format, not Peppol, which is not set up) | e-factuur · UBL |
| factuur-november.pdf · 1 page | factuur-november.pdf · 1 pagina |
| Klopt doesn't read PDFs or photos. Fill in what the document says. | Klopt leest geen pdf's of foto's. Vul in wat er op het document staat. |
| Start typing a name / dd-mm-yyyy / Choose a category | Begin een naam te typen / dd-mm-jjjj / Kies een categorie |
| Including VAT | Inclusief btw |
| Highlighted: what Klopt read from the e-invoice | Gemarkeerd: wat Klopt uit de e-factuur las |

## Settings: hub, company, books, access and data, dark and phone (#147)

Hidde's five desktop-light Settings boards (`Settings`, `SettingsCompany`, `SettingsBooks`, `SettingsAccess`, `SettingsData`) get a dark 1440 board and phone 390 boards in light and dark, covering every tab. His files are not edited. Screenshots are in `derived-shots/settings-147/`.

| Board | What it is | Screenshots in `derived-shots/settings-147/` |
| --- | --- | --- |
| `SettingsDark.dc.html` | Thin wrapper: Hidde's `Settings` hub with `theme="dark"` and `--line-control` on `--ink-muted` | `Settings-dark-1440` |
| `SettingsCompanyDark.dc.html`, `theme` and `view` props (default dark, `details`) | Hidde's `SettingsCompany` at 1440, own file | `SettingsCompany-{details,bank,peppol,defaults}-dark-1440` |
| `SettingsBooksDark.dc.html`, `theme` and `view` (default `years`) | Hidde's `SettingsBooks` at 1440, own file | `SettingsBooks-{years,chart,vat}-dark-1440` |
| `SettingsAccessDark.dc.html`, `theme` and `view` (default `people`) | Hidde's `SettingsAccess` at 1440, own file | `SettingsAccess-{people,tokens,log}-dark-1440` |
| `SettingsDataDark.dc.html`, `theme` and `view` (default `xaf`) | Hidde's `SettingsData` at 1440, own file | `SettingsData-{xaf,hooks,ret,seal}-dark-1440` |
| `PhoneSettings.dc.html`, `theme` prop | The hub at 390: six groups as cards, one 56px switch row | `Settings-light-390` |
| `PhoneSettingsCompany.dc.html`, `theme` and `view` | Company at 390: section chips, stacked fields, sticky Save | `SettingsCompany-{details,bank,peppol,defaults}-light-390` |
| `PhoneSettingsBooks.dc.html`, `theme` and `view` | Books at 390: book years, categories and VAT codes as stacked rows | `SettingsBooks-{years,chart,vat}-light-390` |
| `PhoneSettingsAccess.dc.html`, `theme` and `view` | People, tokens and assistants, the log | `SettingsAccess-{people,tokens,log}-light-390` |
| `PhoneSettingsData.dc.html`, `theme` and `view` | Audit file, webhooks, retention, seals | `SettingsData-{xaf,hooks,ret,seal}-light-390` |
| `PhoneSettingsDark.dc.html` and `PhoneSettings{Company,Books,Access,Data}Dark.dc.html` | The phone boards with `theme="dark"`; the four with tabs pass `view` on | the `-dark-390` shots |

`view` values are the tab keys on Hidde's boards: `details`, `bank`, `peppol`, `defaults` (Company); `years`, `chart`, `vat` (Books); `people`, `tokens`, `log` (Access); `xaf`, `hooks`, `ret`, `seal` (Data). Tapping a tab or chip still switches on the board.

All fifteen boards are registered in `canvas.json` (note `t147` at y 33700, boards at y 34000, under the #146 rows): the five dark desktop boards at x 0 to 6080, the ten phone boards at x 7600 to 11830. Each entry has `"derived": true` and a `derivedNote`.

### Why four dark boards are their own file

`SettingsDark` is a thin wrapper, like `HomeDark`, because the hub holds up in dark once the control border token is fixed (the `VatDark` override); that also gives the switch track 3:1. The four sub-pages are copies, because a wrapper only ever shows a board's first tab (the tab is in state) and because his light boards have things these rules don't allow, and editing his files is out of scope here:

- All four: the "Settings" breadcrumb is `ink-2` and not underlined. The copies make it an underlined ink link to `SettingsDark`, and add a `view` prop that sets the first tab.
- `SettingsCompany`: missing fields are outlined in `selection-edge` on `brand-tint`, 1.75:1 in light, which replaces the control border. The copy keeps the `--ink-muted` border and draws the yellow as an inner ring. The "2 missing" badge is cut off inside the 36px subnav item; the copy lets the item grow and keeps the badge on one line. The invoice email placeholder `invoices@…` reads `facturen@example.nl`.
- `SettingsBooks`: open periods are outlined in `--line` (about 1.2:1), so open and closed can't be told apart; the copy outlines them in `--ink-muted`. Period numbers use Inter tabular figures instead of JetBrains Mono.
- `SettingsAccess`: the second person is the seed user `owner@demo.invalid · Demo Seed Owner`; the copy uses a second owner, Jan Visser (`jan@bakkerij.example`), so the hub's "2 people, both owner" still holds. The invite placeholder `name@company.nl` (a real domain) reads `name@example.nl`. The OAuth link goes to `OAuthDark`.
- `SettingsData`: the empty Book year cells show a dash; the copy says "None". The import link goes to `ImportFindingsDark`.

All four also load Google Fonts; the copies load `../design-system/fonts/fonts.css`. Hidde's light boards still have these issues and should get the same fixes in whichever PR owns them.

### Rules for these boards

- Control borders: `.k-root[data-theme]{--line-control:var(--ink-muted)}`, the same rule as #145, #146, #152, #153 and #155. Inputs, selects, switches, chips, secondary buttons and the import drop zone use it.
- In dark, key hints in a primary button are outlined in `--on-primary` (desktop only; phones show no key hints).
- Links are ink and underlined. No `ink-faint` for text. No new status colours: "Incomplete" and "2 details missing" stay `brand-ink`, "mapped to RGS" and "no drift" stay `success`, the pills are Hidde's.
- Phone: `.k-phone` at 390, Hidde's five-tab bar with More active (Settings lives under More), sticky at the bottom. No key hints. Targets are 44px or more: the back link, chips, every input and select, Remove and Hide, and full-width buttons. Each switch is a 56px row that is the switch (`role="switch"`), so the whole row is the target. Company's Save is 48px in a sticky bar above the tab bar.
- Numbers are Inter with tabular figures (`.k-num`, `nw` where they must not wrap). JetBrains Mono is only for codes: ledger numbers, RGS codes, VAT codes and the seal (`.k-code`).
- No hosting claims. Hidde drew no `edition="hosted"` states on these boards, and the derived copy adds none.
- **Legal edits (decided via CoS, 2 Nov 2026), derived boards only:**
  - Retention (`ret` tab, dark and phone): Hidde's "Storage is locked in compliance mode, so not even Klopt can delete early" reads "Storage: S3 with object lock in compliance mode, so nobody can delete early." **This line must follow the configured store; it is never fixed text.** A fresh install stores files in a folder with no object lock, as the /retention screen shows, so there the line must say that instead of naming S3 and object lock.
  - Peppol (`peppol` tab, dark and phone): Hidde's "With Peppol, invoices go straight into your customer's books…" reads "Peppol isn't connected yet. Invoices go out by email as UBL and PDF. Your network address will be your KvK number unless you choose another."
- Sample people: Eva (`eva@bakkerij.example`) and Jan Visser (`jan@bakkerij.example`). Companies and accounts are Hidde's demo fixtures.
- `shoot.mjs` printed no QA warnings for the 45 shots.

### Invented, for Hidde to check

- **Section chips on phone.** Each sub-page's side menu becomes wrapping 44px chips under the title, the selected one `primary`. Company keeps its "2 missing" badge in the chip. Books and Access show their counts (1, 31, 27; 2, 0, 200) in Inter, not as code chips.
- **Back link.** "‹ Settings" (underlined, 44px) above each sub-page title on phone, to `PhoneSettings`.
- **Hub on phone.** One card per group: tile, title and status line, then 56px rows with each row's detail under its name and a chevron. The ⌘K footnote is left out (no keyboard shortcuts on phone). Import rows go to `PhoneImportSource`, the rest to the phone sub-pages.
- **Company on phone.** One column; street and number share a row (2:1), postcode and town too (1:2). Save sits in a sticky bar; "Changes apply to new invoices…" is the last line of the page. The Peppol electronic-address placeholder is shorter: "Empty: uses the KvK number".
- **Books on phone.** The 12 periods are a 6 by 2 grid with the closed and open styles from the desktop copy. Categories are rows: number and name, "Equity · Credit" under it (D/C spelled out), the RGS code on the right; "Tap a category to change its name or RGS code." VAT codes: name, then code chip and "Sales · 21%", the pill on the right with a 44px Hide for unused codes. Add a category and Open 2026 are full-width buttons.
- **Access on phone.** Each person: avatar, email, "You · since 17-10-2026" or "Jan Visser · since 17-10-2026", then a labelled Role select with Remove (secondary button, so it reads as a button) beside it. The four role cards are a 2 by 2 grid. The token name field label is "Name", with "What will use it" as help and "e.g. Monthly export" as placeholder. The log's five kind segments become a labelled "Show" select next to Export; each line has what and who on the left, date and time on the right.
- **Data on phone.** Download 2025.xaf and Choose a file are full-width buttons. The webhook address placeholder is `https://boeken.example.nl/hook`. Retention counts are a 2 by 2 grid; the documents table becomes rows with the pill under the name and the size on the right (the empty Book year column is left out). The 64-character seal shows as two code lines of 32, with the full seal as the accessible name. Check it now, Check with the audit file and Manifest stack.

### Contrast (WCAG 2.x)

| Pair | Light | Dark |
| --- | --- | --- |
| Control, chip, switch and open-period border (`ink-muted`) on `surface` | 5.95:1 | 6.77:1 |
| v2 `line-control` on `surface` (replaced) | 1.68:1 | 1.98:1 |
| Open period number (`ink-muted`) on `surface-sunken` | 5.21:1 | 7.12:1 |
| Missing-field border (`ink-muted`) on `brand-tint` / the yellow ring (`selection-edge`) | 5.49 / 1.75:1 | 5.60 / 8.81:1 |
| "Incomplete", "2 details missing" (`brand-ink`) on `surface` | 5.07:1 | 10.65:1 |
| "mapped to RGS", "no drift" (`success`) on `surface` / on `ground` | 6.16 / 5.64:1 | 9.96 / 10.82:1 |
| Callout title (`ink`) on `brand-tint` | 16.33:1 | 13.07:1 |
| Switch row text (`ink-2`) on `surface-sunken` | 9.14:1 | 12.34:1 |

In light, the yellow ring is extra; the `ink-muted` border under it carries the 3:1.

### Shooting

From `design/redesign-2026-10/`:

```sh
O=derived-shots/settings-147
node derived-shots/render/shoot.mjs $O --width=1440 'SettingsDark.dc.html?theme=dark=Settings-dark-1440' \
  $(for v in details bank peppol defaults; do echo "SettingsCompanyDark.dc.html?theme=dark&view=$v=SettingsCompany-$v-dark-1440"; done) \
  $(for v in years chart vat; do echo "SettingsBooksDark.dc.html?theme=dark&view=$v=SettingsBooks-$v-dark-1440"; done) \
  $(for v in people tokens log; do echo "SettingsAccessDark.dc.html?theme=dark&view=$v=SettingsAccess-$v-dark-1440"; done) \
  $(for v in xaf hooks ret seal; do echo "SettingsDataDark.dc.html?theme=dark&view=$v=SettingsData-$v-dark-1440"; done)
A=('PhoneSettings.dc.html=Settings-light-390' 'PhoneSettingsDark.dc.html?theme=dark=Settings-dark-390')
for b in "Company:details bank peppol defaults" "Books:years chart vat" "Access:people tokens log" "Data:xaf hooks ret seal"; do n=${b%%:*}
  for v in ${b#*:}; do A+=("PhoneSettings$n.dc.html?view=$v=Settings$n-$v-light-390" "PhoneSettings${n}Dark.dc.html?theme=dark&view=$v=Settings$n-$v-dark-390"); done; done
node derived-shots/render/shoot.mjs $O --width=390 "${A[@]}"
```

The dark phone shots go through the `Phone…Dark` wrappers, so they also check that `view` is passed on.

### Copy, English and Dutch

Strings Hidde already has on his Settings boards are not repeated here.

| English (board) | Nederlands |
| --- | --- |
| ‹ Settings | ‹ Instellingen |
| facturen@example.nl (placeholder) | facturen@example.nl |
| Empty: uses the KvK number | Leeg: gebruikt het KvK-nummer |
| Equity · Credit / Assets · Debit | Eigen vermogen · Credit / Activa · Debet |
| Showing 12 of 31. Tap a category to change its name or RGS code. | 12 van 31. Tik op een categorie om de naam of RGS-code te wijzigen. |
| Hide ICP (screen reader) | ICP verbergen |
| You · since 17-10-2026 | Jij · sinds 17-10-2026 |
| Jan Visser · since 17-10-2026 | Jan Visser · sinds 17-10-2026 |
| Role | Rol |
| Remove jan@bakkerij.example (screen reader) | jan@bakkerij.example verwijderen |
| What will use it | Wat gaat hem gebruiken |
| e.g. Monthly export | bijv. Maandexport |
| Show (log filter) | Toon |
| https://boeken.example.nl/hook (placeholder) | https://boeken.example.nl/hook |
| Documents (retention list) | Documenten |
| Seal (label) | Zegel |
| None (empty book year) | Geen |
| Storage: S3 with object lock in compliance mode, so nobody can delete early. | Opslag: S3 met object lock in compliance-modus, dus niemand kan eerder verwijderen. |
| Peppol isn't connected yet. Invoices go out by email as UBL and PDF. Your network address will be your KvK number unless you choose another. | Peppol is nog niet aangesloten. Facturen gaan per e-mail als UBL en PDF. Je netwerkadres wordt je KvK-nummer, tenzij je een ander kiest. |

## Reports: profit and loss, balance sheet, ageing and trial balance, dark and phone (#146)

Hidde's desktop-light `Reports` board gets a dark 1440 board and phone 390 boards in light and dark, covering all five tabs. His file is not edited. Screenshots are in `derived-shots/reports-146/`.

| Board | What it is | Screenshots in `derived-shots/reports-146/` |
| --- | --- | --- |
| `ReportsDark.dc.html`, `theme` and `view` props (default dark, `pl`) | Hidde's `Reports` at 1440, own file: underlined "Match now", self-hosted fonts, a `view` prop to pick the tab | `Reports-{pl,bs,deb,cred,tb}-dark-1440` |
| `PhoneReports.dc.html`, `theme` and `view` props | All five reports at 390: period, report chips, stacked rows | `PhoneReports-{pl,bs,deb,cred,tb}-light-390` |
| `PhoneReportsDark.dc.html`, `view` prop | `PhoneReports` with `theme="dark"`, passes `view` on | `PhoneReports-{pl,bs,deb,cred,tb}-dark-390` |

`view` is `pl` (profit and loss), `bs` (balance sheet), `deb` (customers owe you), `cred` (you owe) or `tb` (trial balance). Tapping a tab or chip still switches on the board.

All three boards are registered in `canvas.json` (note `t146` at y 30700, boards at y 31000, under the #145 rows): `ReportsDark` at x 0, the two phone boards at x 1520 and 1990. Each entry has `"derived": true` and a `derivedNote`.

### Why the dark board is its own file

A thin wrapper (like `HomeDark`) would only ever show the first tab: Hidde's board keeps the tab in state, and a wrapper can't pick one, while #146 asks for all five tabs. Hidde's board also breaks one rule: the "Match now" link in the balance sheet callout is bold but not underlined. `ReportsDark` therefore is a copy with:

- a `view` prop that sets the first tab (`this.state = { view: props.view ?? 'pl' }`);
- "Match now" as an underlined ink link, pointing at `MatchDark`;
- control borders on `--ink-muted` (the #152/#153/#155 rule) and self-hosted fonts instead of Google Fonts;
- links to the dark boards (`InvoicesDark`, `CostsDark`, `ContactsDark`, `MatchDark`, `LedgerDark`).

Hidde's light board still has the "Match now" link and the Google Fonts link, and should get the same fixes in whichever PR owns it.

### Rules for these boards

- Control borders: `.k-root[data-theme]{--line-control:var(--ink-muted)}`. The period select, report chips and secondary buttons use it.
- Links are ink and underlined. No `ink-faint` for text. No new status colours: days late and "All of it past due" are `danger`, "Debit equals credit" and "Yes" are `success`, as on Hidde's board.
- Phone: `.k-phone` at 390, Hidde's five-tab bar with More active (Reports lives under More), sticky at the bottom. No key hints. Targets are 44px or more: PDF, CSV, the chips, "Match now", and the two full-width actions.
- Amounts are Inter with tabular figures (`.k-num nw`, never wrapped), right-aligned, the same class as `PhoneCosts` and `PhoneBillNew`. JetBrains Mono is only for ledger numbers and RGS codes (`.k-code`).
- The P&L bars are decoration (`aria-hidden`), since every bar has its amount beside it. On phone each bar spans the full row width, so lengths compare.
- `shoot.mjs` printed no QA warnings for the fifteen shots.

### Invented, for Hidde to check

- **Report chips on phone.** Five tabs don't fit one row at 390, so they are wrapping 44px chips (3 + 2) under the period select; the selected chip is `primary` with `on-primary` text. The 1–5 key hints are dropped.
- **PDF and CSV labels on phone.** Desktop says "Download PDF"; phone says "PDF" next to "CSV" in the header to fit.
- **P&L order on phone.** Profit before tax first, full width, then Income and Costs side by side; the desktop has three stats in one row.
- **"Tap a line" copy.** Desktop "↵ on a line shows its bookings" / "opens that account's ledger" become "Tap a line to see its bookings" / "Tap a line to open that account's ledger". Cost lines point to `#`; Hidde's board has no target for them either.
- **Ageing on phone.** Each customer or supplier row shows the name (and for customers the days late in `danger`), the total on the right with its age bucket under it ("90+ days"). The ageing columns become a "By age" card under the list; empty buckets show € 0,00 in `ink-muted`. "Oldest first" and "Largest first" captions describe Hidde's order.
- **Debtor and creditor row targets.** Customers open `PhoneContactCard`, suppliers `PhoneCosts`. "Send reminders to all 5" goes to `PhoneSales`, "Prepare a payment batch" to `PhonePaymentBatch`.
- **Balance sheet callout on phone.** "Match now" is an underlined 44px link under the text, to `PhoneMatch`.
- **Trial balance on phone.** Each account is a row: ledger number and name (wrapping), RGS code under it; the closing balance bold on the right with labelled Debit and Credit under it. The Opening column is left out: it is 0,00 on every line, and the intro says so ("Opening is 0,00 for each, as 2025 is the first year"; Hidde's "For your accountant: debit and credit must agree, and they do" is dropped to keep it short). Empty Debit or Credit cells show 0,00. Totals are a three-line footer.
- **Links to the #145 boards.** `ReportsDark` trial balance rows link to `LedgerDark` and phone rows to `PhoneLedger`; both came with #145 (PR #188, now on main).
- **Legal: the opening line comes from the data.** "Opening is 0,00 for each, as 2025 is the first year" (NL "Het beginsaldo is overal 0,00, want 2025 is het eerste jaar.") must be generated from the books, not hard-coded: it may only show when every opening balance is 0,00 and the book year is the administration's first. For a later year, or an import with opening balances, the line is different or left out and the Opening column comes back.

### Contrast (WCAG 2.x)

| Pair | Light | Dark |
| --- | --- | --- |
| Control and chip border (`ink-muted`) on `surface` | 5.95:1 | 6.77:1 |
| Selected chip (`on-primary` on `primary`) | 17.72:1 | 16.12:1 |
| Amounts (`ink`) on `surface` / totals on `surface-hover` | 17.72 / 16.94:1 | 15.80 / 14.42:1 |
| Labels and muted text (`ink-muted`) on `surface` / `surface-hover` | 5.95 / 5.69:1 | 6.77 / 6.18:1 |
| Callout title (`ink`) / text (`ink-2`) on `brand-tint` | 16.33 / 9.63:1 | 13.07 / 9.72:1 |
| Days late (`danger`) on `surface` | 6.57:1 | 6.28:1 |
| "Debit equals credit" (`success`) on `ground` | 5.64:1 | 10.82:1 |
| Cost bar (`chart-2`) on its track (`line-soft`), decoration only | 2.21:1 | 3.12:1 |

### Shooting

From `design/redesign-2026-10/`:

```sh
O=derived-shots/reports-146
node derived-shots/render/shoot.mjs $O --width=1440 $(for v in pl bs deb cred tb; do echo "ReportsDark.dc.html?theme=dark&view=$v=Reports-$v-dark-1440"; done)
node derived-shots/render/shoot.mjs $O --width=390 $(for v in pl bs deb cred tb; do echo "PhoneReports.dc.html?view=$v=PhoneReports-$v-light-390" "PhoneReportsDark.dc.html?theme=dark&view=$v=PhoneReports-$v-dark-390"; done)
```

The dark phone shots go through the `PhoneReportsDark` wrapper, so they also check that `view` is passed on.

### Copy, English and Dutch

Strings Hidde already has on `Reports` are not repeated here.

| English (board) | Nederlands |
| --- | --- |
| PDF / CSV | PDF / CSV |
| Report (chips, screen reader) | Rapport |
| Total income | Totaal opbrengsten |
| Largest first. Tap a line to see its bookings. | Grootste eerst. Tik op een regel voor de boekingen. |
| Customers / Suppliers | Klanten / Leveranciers |
| Oldest first / Largest first | Oudste eerst / Grootste eerst |
| By age | Naar ouderdom |
| 1–30 days / 31–60 days / 61–90 days / 90+ days | 1–30 dagen / 31–60 dagen / 61–90 dagen / 90+ dagen |
| Accounts | Rekeningen |
| Closing balance on the right, debit and credit under it. | Eindsaldo rechts, debet en credit eronder. |
| Opening is 0,00 for each, as 2025 is the first year. | Het beginsaldo is overal 0,00, want 2025 is het eerste jaar. |
| Total debit / Total credit / Closing | Totaal debet / Totaal credit / Eindsaldo |
| Tap a line to open that account's ledger. | Tik op een regel voor het grootboek van die rekening. |

## Journal: entries, new entry and ledger, dark and phone (#145)

Hidde's three desktop-light boards (`Journal`, `EntryNew`, `Ledger`) get a dark 1440 board and phone 390 boards in light and dark. His files are not edited. Screenshots are in `derived-shots/journal-145/`.

| Board | What it is | Screenshots in `derived-shots/journal-145/` |
| --- | --- | --- |
| `JournalDark.dc.html`, `theme` prop (default dark) | Hidde's `Journal` at 1440, own file: entry panel wide enough for its Credit column, no placeholders, self-hosted fonts | `Journal-dark-1440` |
| `EntryNewDark.dc.html`, `theme` prop (default dark) | Hidde's `EntryNew` at 1440, own file: bordered line cells, no ink-faint, self-hosted fonts | `EntryNew-dark-1440` |
| `LedgerDark.dc.html` | Thin wrapper: Hidde's `Ledger` with `theme="dark"` and `--line-control` on `--ink-muted` | `Ledger-dark-1440` |
| `PhoneJournal.dc.html`, `theme` prop | Entries at 390: the open entry (17) as a card on top, then all 17 entries as stacked rows | `Journal-light-390`, `Journal-dark-390` |
| `PhoneJournalDark.dc.html` | `PhoneJournal` with `theme="dark"` | the `Journal-dark-390` shot |
| `PhoneEntryNew.dc.html`, `theme` prop | New entry at 390: fields, three line cards with visible labels, totals, sticky Post bar | `EntryNew-light-390`, `EntryNew-dark-390` |
| `PhoneEntryNewDark.dc.html` | `PhoneEntryNew` with `theme="dark"` | the `EntryNew-dark-390` shot |
| `PhoneLedger.dc.html`, `theme` prop | Ledger for 1300 Debiteuren, Q4 2025, at 390: totals, movements with running balance, all accounts | `Ledger-light-390`, `Ledger-dark-390` |
| `PhoneLedgerDark.dc.html` | `PhoneLedger` with `theme="dark"` | the `Ledger-dark-390` shot |

All twelve boards are registered in `canvas.json` (note `t145` at y 26700, boards at y 27000, under the #153 rows): the three dark desktop boards at x 0 to 3040, the six phone boards at x 4560 to 6910. Each entry has `"derived": true` and a `derivedNote`.

### Why two dark boards are their own file

`LedgerDark` is a thin wrapper, like `HomeDark`, because Hidde's markup is right in dark once the control border token is fixed (the same override as `VatDark`). `JournalDark` and `EntryNewDark` are copies, because his light boards have things these rules don't allow, and editing his files is out of scope here:

- `Journal`: the entry panel is 380px wide, but its Account, Debit and Credit grid needs about 420px, so the Credit column is cut off at 1440. Every sales entry except 17 shows `[net]` and `[VAT]` as its revenue and VAT amounts, the opening entry is posted by `owner@demo.invalid`, entry 1 shows a dash for "chained to", and the count line says 16 shown while 17 rows are drawn. `JournalDark` has a 420px panel with 96px Debit and Credit columns and slightly narrower list columns, lets account names wrap to a second line ("1500 Te betalen omzetbelasting" is no longer cut off), splits every sales entry into revenue and 21% VAT, uses `eva@bakkerij.example`, says "genesis · first entry", and "Showing 17 of 216".
- `EntryNew`: the line cells have no border of their own, only a `--line-soft` divider (about 1.2:1), and the breadcrumb slash is `ink-faint`. In `EntryNewDark` each cell is a bordered input inside its row (`--ink-muted`, 32px tall, 48px rows), the slash is `ink-muted`, and the Journal crumb is an underlined ink link.

Both also load Google Fonts; the copies load `../design-system/fonts/fonts.css`, and their links point to the dark boards. Hidde's light boards still have these issues and should get the same fixes in whichever PR owns them.

### Rules for these boards

- Control borders: `.k-root[data-theme]{--line-control:var(--ink-muted)}`, the same rule as #152, #153 and #155. Inputs, selects, the search field and secondary buttons use it.
- In dark, key hints in a primary button are outlined in `--on-primary` (desktop only; phones show no key hints).
- Links are ink and underlined. No `ink-faint` for text. No new status colours: `Posted` is the `--paid` pill and "Balances" is `success`, as on Hidde's boards.
- Phone: `.k-phone` at 390, Hidde's five-tab bar with More active (Journal lives under More), sticky at the bottom. No key hints, chips or keycaps. Targets are 44px or more; list rows 56 to 60px; EntryNew's Post and Post and next are 48px in a sticky bar above the tab bar.
- Amounts are Inter with tabular figures (`.k-num`, with `nw` so they never wrap), right-aligned, the same class as `PhoneCosts` and `PhoneBillNew` and Hidde's desktop boards; decided via CoS on 2 Nov 2026. JetBrains Mono is only for codes: account numbers, journal codes, RGS codes and fingerprints (`.k-code`). Dates on phone read "28 Nov"; the book year is in the list footer.
- EntryNew phone labels (Account, Line description, Debit, Credit) are visible on every line card. They carry `md-sr`, which hides them visually from 768px up, where the desktop table has column headers (the `md:sr-only` pattern). No input relies on an `aria-label` alone.
- Sample user: Eva (`eva@bakkerij.example`). Companies and accounts are Hidde's demo fixtures.
- `shoot.mjs` printed no QA warnings for the nine shots.

### Invented, for Hidde to check

- **Open entry on top (Journal phone).** The selected entry shows as a card above the list: lines stacked with the account on the left and Debit or Credit, labelled, on the right; then Balances, the booking details and Open invoice, Reverse and Copy as new. Entry 17 is the newest, so it reads as the first row opened. Tapping a row opens it in the card, as on `PhoneImportFindings`. In the app this could be its own page.
- **Journal filter as a select on phone.** The five desktop segments (All, Sales, Purchases, Bank, Memorial) don't fit 390, so phone has a labelled Journal select, "All journals · 216".
- **Phone entry rows.** The contact (or "Demo openingsbalans") in bold, the journal code and document under it, the amount on the right with "#17 · 28 Nov" under it.
- **Sales entries split at 21%.** Every sales entry on the dark and phone boards splits into 8000 Omzet and 1500 VAT at 21%, the way Hidde's entry 17 does.
- **Ledger tab label.** On phone the tab is "Ledger" (desktop "Ledger per account"); Trial balance points to `#`, because Reports has no phone board yet.
- **Ledger phone.** Previous and next buttons around the account name instead of the account side panel (desktop `[` and `]`), with the side panel moved under the movements as "All accounts" and "Show 21 accounts without movement" as an underlined link. The four totals are a 2 by 2 grid, the two balances first. Each movement has the day and month on the left, "Invoice 2025-0022" (VRK) or "Paid 2025-0035" (BNK) with the contact under it, Debit or Credit with the amount on the right, and the running balance under it, with one line above the list that says so. Journal code chips are left off the phone rows. CSV stays as a button.
- **EntryNew phone.** Each line is a card ("Line 1" with a 44px remove button). The description is a two-line field so it isn't cut off. Account 1510 shows its ledger name "Te vorderen btw", as on `Ledger`; Hidde's `EntryNew` calls it "Terug te vorderen omzetbelasting", so his two boards disagree. The "=" state of line 3 keeps Hidde's yellow outline on `brand-tint`; the field's own `--ink-muted` border stays under it, so the 3:1 edge holds. The new intro line is "Debit and credit must be equal before you can post." The "Posting is final" text is shorter and drops the fingerprint clause. The document card has Take a photo and Choose a file, as on `PhoneBillNew`. The back link replaces Cancel.

### Contrast (WCAG 2.x)

| Pair | Light | Dark |
| --- | --- | --- |
| Control border (`ink-muted`) on `surface` | 5.95:1 | 6.77:1 |
| v2 `line-control` on `surface` (replaced) | 1.68:1 | 1.98:1 |
| Amounts (`ink`) on `surface` | 17.72:1 | 15.80:1 |
| Running balance (`ink-2`) on `surface` | 10.44:1 | 11.75:1 |
| Labels and muted text (`ink-muted`) on `surface` / `surface-hover` | 5.95 / 5.69:1 | 6.77 / 6.18:1 |
| Muted text on `selection` (selected row and account) | 5.59:1 | 5.74:1 |
| `ink` on `brand-tint` (the "=" cell) | 16.33:1 | 13.07:1 |
| "Balances" (`success`) on `surface` | 6.16:1 | 9.96:1 |
| `Posted` pill (`success` on `success-bg`) | 5.48:1 | 8.90:1 |

### Shooting

From `design/redesign-2026-10/`:

```sh
node derived-shots/render/shoot.mjs derived-shots/journal-145 'JournalDark.dc.html?theme=dark=Journal-dark-1440' 'EntryNewDark.dc.html?theme=dark=EntryNew-dark-1440' 'LedgerDark.dc.html?theme=dark=Ledger-dark-1440' --width=390 'PhoneJournal.dc.html=Journal-light-390' 'PhoneJournal.dc.html?theme=dark=Journal-dark-390' 'PhoneEntryNew.dc.html=EntryNew-light-390' 'PhoneEntryNew.dc.html?theme=dark=EntryNew-dark-390' 'PhoneLedger.dc.html=Ledger-light-390' 'PhoneLedger.dc.html?theme=dark=Ledger-dark-390'
```

The `Phone…Dark` wrappers render the same pixels as `?theme=dark`; they were checked against these shots and are not shot separately.

### Copy, English and Dutch

Strings Hidde already has on his boards are not repeated here.

| English (board) | Nederlands |
| --- | --- |
| + Entry | + Journaalpost |
| Ledger (phone tab) | Grootboek |
| Every booking, in order. A correction is a new entry that reverses the old one. | Elke boeking, op volgorde. Een correctie is een nieuwe journaalpost die de oude terugdraait. |
| All journals · 216 | Alle dagboeken · 216 |
| All entries | Alle journaalposten |
| Opening balance | Openingsbalans |
| #17 · 28 Nov | #17 · 28 nov |
| genesis · first entry | genesis · eerste journaalpost |
| Each fingerprint includes the one before it, so a changed entry shows. | Elke vingerafdruk bevat de vorige, dus een gewijzigde journaalpost valt op. |
| Showing 17 of 216, in entry order | 17 van 216, op volgorde van boeken |
| ‹ Journal | ‹ Journaal |
| Debit and credit must be equal before you can post. | Debet en credit moeten gelijk zijn voordat je kunt boeken. |
| Line 1 (2, 3) | Regel 1 (2, 3) |
| + Add a line | + Regel toevoegen |
| Total debit / Total credit | Totaal debet / Totaal credit |
| Once posted, the entry can't be edited or deleted. A mistake is fixed with a reversing entry. | Een geboekte journaalpost kun je niet wijzigen of verwijderen. Een fout herstel je met een tegenboeking. |
| Movements | Mutaties |
| 19 lines | 19 regels |
| The running balance is under each amount. | Het lopende saldo staat onder elk bedrag. |
| Brought forward | Beginsaldo |
| Invoice 2025-0022 / Paid 2025-0035 | Factuur 2025-0022 / Betaald 2025-0035 |
| At period end · 31 Dec | Eind van de periode · 31 dec |
| All accounts | Alle rekeningen |
| Show 21 accounts without movement | Toon 21 rekeningen zonder mutaties |
| Previous account: 1100 Bank / Next account: 1500 Te betalen btw (screen reader) | Vorige rekening: 1100 Bank / Volgende rekening: 1500 Te betalen btw |

## Import source and problems: dark and phone (#152)

| Board | What it is | Screenshots in `derived-shots/import-152/` |
| --- | --- | --- |
| `ImportSourceDark.dc.html`, `theme` prop (default dark) | Hidde's `ImportSource` at 1440, own file: self-hosted fonts, placeholder redirect URI | `ImportSource-dark-1440` |
| `ImportFindingsDark.dc.html`, `theme` prop (default dark) | Hidde's `ImportFindings` at 1440, own file: self-hosted fonts, one reworded title | `ImportFindings-dark-1440` |
| `PhoneImportSource.dc.html`, `theme` prop | Source and connect (steps 1 and 2) at 390; Exact Online selected, Moneybird on tap | `ImportSource-light-390` |
| `PhoneImportSourceDark.dc.html` | `PhoneImportSource` with `theme="dark"` | `ImportSource-dark-390` |
| `PhoneImportFindings.dc.html`, `theme` prop | Problems (step 5) at 390, the same five example findings | `ImportFindings-light-390` |
| `PhoneImportFindingsDark.dc.html` | `PhoneImportFindings` with `theme="dark"` | `ImportFindings-dark-390` |

The two dark desktop boards are copies, not thin wrappers, because Hidde's light boards load Google Fonts and `ImportSource` shows a real installation URL as the Exact redirect URI. The copies use `https://boeken.example.nl/exact/callback`. The Exact intro on the new boards is "Exact needs an app registration. Register Klopt once in the Exact App Center.", without Hidde's hosting sentence. On `ImportFindingsDark` and `PhoneImportFindings` the bank finding reads "12 bank lines each pay two invoices" (Hidde: "are linked to"), and the `1`–`3` key hint shows the three keys. Hidde's light boards are unchanged.

- Phone follows batch 2: `.k-phone` at 390, a ghost back link top left (`‹ More`, `‹ Preview`), a "step N of 6" line instead of the stepper, one column, the primary action in a sticky bar above the tab bar, More active.
- On phone the source options and the connect card stack; the Exact fields stack and Copy sits under the redirect URI. The problems board shows the three counts in a row, then the selected finding with its fixes, then all findings. Tapping a finding opens it above; choosing a fix moves to the next open one.
- No key hints or option keys on phone. Targets are 44px or more, the sticky action 48px. Control and option borders use `--ink-muted`; the disabled primary uses the batch-2 style.
- `shoot.mjs` printed no QA warnings for the six boards. Shot with `shoot-widths.mjs` as on #153: `node --import ./derived-shots/render/hide-scrollbars.mjs derived-shots/render/shoot-widths.mjs derived-shots/import-152 'PhoneImportFindings.dc.html@390=ImportFindings-light-390' ...`.

### Copy, English and Dutch

| English (board) | Nederlands |
| --- | --- |
| Import · step 2 of 6 | Importeren · stap 2 van 6 |
| Import from Moneybird · step 5 of 6 | Importeren uit Moneybird · stap 5 van 6 |
| Problems | Problemen |
| Finding 1 of 5 | Bevinding 1 van 5 |
| All findings | Alle bevindingen |
| 12 bank lines each pay two invoices | 12 bankregels betalen elk twee facturen |
| Exact needs an app registration. Register Klopt once in the Exact App Center. | Exact vraagt om een app-registratie. Registreer Klopt één keer in het Exact App Center. |
| Nothing is booked until the last step. You can stop at any point. | Er wordt pas bij de laatste stap geboekt. Je kunt altijd stoppen. |

## Contacts, VAT and ICP: dark and phone (#155)

| Board | What it is | Screenshots in `derived-shots/contacts-vat/` |
| --- | --- | --- |
| `Contacts.dc.html`, `theme` prop | Hidde's board; `ContactsDark.dc.html` sets `theme="dark"` | `Contacts-light-1440`, `Contacts-dark-1440` |
| `PhoneContacts.dc.html`, `theme` prop | Contact list at 390 | `Contacts-light-390`, `Contacts-dark-390` |
| `PhoneContactCard.dc.html`, `theme` prop | Contact card (Zandbank Advies) at 390 | `ContactCard-light-390`, `ContactCard-dark-390` |
| `Vat.dc.html`, `theme` prop | Hidde's board; `VatDark.dc.html` sets `theme="dark"` | `Vat-light-1440`, `Vat-dark-1440` |
| `PhoneVat.dc.html`, `theme` prop | Return Q4 2025 at 390 | `Vat-light-390`, `Vat-dark-390` |
| `PhoneVatPeriods.dc.html`, `theme` prop | VAT periods at 390 | `VatPeriods-light-390`, `VatPeriods-dark-390` |
| `Icp.dc.html`, `theme` prop | Hidde's board; `IcpDark.dc.html` sets `theme="dark"` | `Icp-light-1440`, `Icp-dark-1440` |
| `PhoneIcp.dc.html`, `theme` prop | ICP return (example data) at 390 | `Icp-light-390`, `Icp-dark-390` |

The `*Dark.dc.html` files are thin wrappers, like Hidde's `InvoicesDark`, that set the prop for the screenshots. They have no canvas entries: on the canvas, dark is the `theme` prop.

### Today

The sample "today" is **Friday 30 October 2026**, as on `PhoneHome` ("Friday 30 October") and the audit log in `SettingsAccess` (30-10-2026). The book year is 2025 and VAT is quarterly. A quarter's return is due at the end of the month after the quarter, so on that day:

| Period | Due | Status |
| --- | --- | --- |
| 2026-Q4 | 31-01-2027 | Opens 1 Jan (still running) |
| 2026-Q3 | 31-10-2026 | Due tomorrow |
| 2026-Q2 | 31-07-2026 | Late |
| 2026-Q1 | 30-04-2026 | Late |
| 2025-Q4 | 31-01-2026 | Late, ready to file |
| 2025-Q1 to Q3 | | Marked as filed |

This applies to the phone boards. Hidde's desktop `Vat` (Q4 2025 "Ready to file", "file and pay by 31 January 2026"), `Main` and `PhoneHome` ("to pay by 31 Jan") still read as if it were January 2026, and the invoice ageing ("76 days late" on an invoice of 16 Sep) points to about 31 December 2025.

### Rules for these boards

- Status copy for VAT and ICP is "Ready to file", "Mark as filed" and "Marked as filed", never "Filed" on its own and never as if Klopt sent the return. On phone there is no disabled filing button: "Download for manual filing" first, then "Mark as filed".
- Control and input borders use `--ink-muted` (Hidde's muted grey) instead of `--line-control`: 5.95:1 on white, about 7:1 on dark surface. No new greys.
- Links are `ink`, underlined. Phone targets are at least 44px. No `ink-faint` text, no keyboard hints on phone, no em dash placeholders.
- The phone tab bar is pinned (`position: sticky; bottom: 0`, with `overflow: clip` on `.k-phone`); More is active because Contacts and VAT live under More.
- The sample user is Eva, `eva@bakkerij.example`.
- A log-out action, where one shows, is "Sign out" / "Uitloggen". None of these boards shows one.

### Copy, English and Dutch

Strings Hidde already has on his boards are not repeated here.

| English (board) | Nederlands |
| --- | --- |
| Ready to file | Klaar om in te dienen |
| Mark as filed | Markeren als ingediend |
| Marked as filed | Gemarkeerd als ingediend |
| Late | Te laat |
| Due tomorrow | Morgen de deadline |
| Opens 1 Jan | Opent 1 jan |
| Running, due 31 Jan 2027 | Loopt nog, uiterlijk 31 jan 2027 |
| Due 31 Oct | Uiterlijk 31 okt |
| Was due 31 Jul / 30 Apr | Moest uiterlijk 31 jul / 30 apr |
| Ready to file, was due 31 Jan 2026 | Klaar om in te dienen, moest uiterlijk 31 jan 2026 |
| 1 Oct to 31 Dec 2025 · was due 31 Jan 2026 | 1 okt t/m 31 dec 2025 · moest uiterlijk 31 jan 2026 |
| Was due 31 January 2026 | Moest uiterlijk 31 januari 2026 |
| Download for manual filing | Downloaden om zelf in te dienen |
| After you send the return in Mijn Belastingdienst Zakelijk, mark it as filed here so the period closes. | Verstuur de aangifte in Mijn Belastingdienst Zakelijk en markeer hem daarna hier als ingediend, dan sluit de periode. |
| After you send the ICP return in Mijn Belastingdienst Zakelijk, mark it as filed here. | Verstuur de ICP-opgaaf in Mijn Belastingdienst Zakelijk en markeer hem daarna hier als ingediend. |
| Prepared by eva@bakkerij.example on 30-10-2026 | Voorbereid door eva@bakkerij.example op 30-10-2026 |
| ‹ VAT / ‹ Contacts | ‹ Btw / ‹ Contacten |
| + Contact | + Contact |
| Nothing open | Niets open |
| Past due | Over de vervaldatum |
| N days late | N dagen te laat |
| Customer · Amsterdam / Supplier · 4 bills in 2025 | Klant · Amsterdam / Leverancier · 4 rekeningen in 2025 |
| Needed for e-invoicing. | Nodig voor e-facturen. |
| Goods / Services | Goederen / Diensten |
| Sign out | Uitloggen |

## PhoneTabBar: Receipt and More (#150)

Hidde's four phone boards (`PhoneHome`, `PhoneSales`, `PhoneInvoice`, `PhoneMatch`) draw the tab bar Home · Sales · Receipt · Bank · More, but not what Receipt and More open. These boards draw both, at 390, light and dark. The tab bar on them is Hidde's markup unchanged, with the current tab set `is-active` and `aria-current="page"`.

| Board                              | Variant                                                       | Derived from                                                | Screenshots (390)                                                                                       |
| ---------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `PhoneReceipt.dc.html`             | choose (default `state`)                                      | PhoneSales layout, DropZone rules, `.k-card`, `.k-pill`     | `derived-shots/phonetabbar/PhoneReceipt-light-390.png`, `PhoneReceipt-dark-390.png`                     |
| `PhoneReceiptUploaded.dc.html`     | PhoneReceipt, `state="uploaded"`                              | same; paper rule for the thumbnail                          | `derived-shots/phonetabbar/PhoneReceiptUploaded-light-390.png`, `PhoneReceiptUploaded-dark-390.png`     |
| `PhoneReceiptFailed.dc.html`       | PhoneReceipt, `state="failed" reason="too-large"`             | same; Callout `--danger`                                    | `derived-shots/phonetabbar/PhoneReceiptFailed-light-390.png`, `PhoneReceiptFailed-dark-390.png`         |
| `PhoneMore.dc.html`                | default                                                       | Sidebar groups, order and icons; PhoneHome rows             | `derived-shots/phonetabbar/PhoneMore-light-390.png`, `PhoneMore-dark-390.png`                           |
| `PhoneReceiptDark.dc.html` and the other three `…Dark.dc.html` | the four boards above with `theme="dark"` | the `HomeDark` wrapper pattern                              | the `-dark-390` shots above                                                                             |

Variant and dark boards are thin wrappers that `dc-import` the main board with props, the same way `HomeDark.dc.html` wraps `Main`. `PhoneReceipt` also takes `reason="wrong-type"`, for a HEIC photo; that variant is drawn but not shot.

Shots are made with `derived-shots/render/shoot-phone.mjs` (needs `playwright`): 390 wide, full page, `prefers-reduced-motion: reduce`, matching `prefers-color-scheme`, transitions off, the pointer kept off the page so nothing is hovered, and Google Fonts blocked so only the self-hosted faces can render. The script also reports any link or button under 44px tall and any text under 4.5:1 against its background; all eight shots report none. `dc-shim.js` and `design-system/fonts/` are the same files as in #109.

### Accessibility deviations (new boards only)

| Rule                         | What the new boards do                                                                                                                                                       | Value                                                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Control borders at least 3:1 | On the Receipt board, `--line-control` is set to the theme's own `--ink-muted` (the colour v2 already gives `.k-btn:hover` borders), so no new colour is added. Decided by Hidde | Light `#63636b`: 5.95:1 on `surface`. Dark `#a1a1aa`: 6.77:1 on `surface`. v2's `line-control` is 1.68:1 light, 1.98:1 dark |
| Links in ink, underlined     | "Open in Inbox" is `ink`, underlined with a 2px offset, and 44px tall                                                                                                        | 17.7:1 light, 15.8:1 dark                                                                                                   |
| Targets at least 44px        | Primary actions 56px, secondary 48px, list rows 48px (account rows 60px), link 44px. Hidde's tab bar items are 48px                                                          | 44px minimum                                                                                                                |
| No `ink-faint` for text      | Not used. Muted text is `ink-muted`, status text uses the existing pill pairs and `danger`                                                                                   | `danger` 6.57:1 light, 6.28:1 dark; `In Inbox` (`--open`) 5.87:1 / 7.64:1; `Booked` (`--paid`) 5.48:1 / 8.90:1              |
| Self-hosted fonts            | New boards load `../design-system/fonts/fonts.css` instead of the Google Fonts link. `bundle.css` still `@import`s Google Fonts; that line is Hidde's and is left alone      | Fontsource 5.3.0, OFL 1.1                                                                                                   |
| Paper stays white            | The receipt thumbnail is paper, so it is white with light-theme `line` and `ink` marks in both themes, like `.k-paper`                                                        | `#ffffff`, `#e4e3dd`, `#18181b`                                                                                             |

### Decided by Hidde (via CoS, 1 Nov 2026)

- **Middle tab stays Receipt.** The phone tab bar is Home · Sales · Receipt · Bank · More, as on Hidde's boards. Inbox is not a tab; it is the first row of More, so it is always one tap from the More tab.
- **Sign out.** "Sign out" in English and "Uitloggen" in Dutch, everywhere. Not "Log out" or "Afmelden".
- **Control borders use `--ink-muted`.** The existing muted grey of each theme, as these boards already do. No new grey.

### Still open for Hidde

- **Switcher placement.** In More, the administration switcher row (Bakkerij Voorbeeld B.V., book year 2026, opening `Switcher.dc.html`) and Sign out, with the signed-in address under it, sit together in an Account group at the bottom. On desktop the switcher is at the top of the sidebar.
- **File-type rule.** The Receipt page accepts PDF, JPG or PNG, up to 30 MB, and the `reason="wrong-type"` variant rejects a HEIC photo. 30 MB is the app's real cap (`MAX_DOCUMENT_BYTES` in `packages/core/src/inbound/attachments.ts`), but the app doesn't check the type today, so the PDF/JPG/PNG list and the HEIC error are new rules for #139.

### Invented, for Hidde to check

- **Receipt is a page, not the camera straight away.** Tapping Receipt opens a page with Take photo as the one primary button and Choose file as the secondary. Opening the camera at once would save a tap, but there would be nowhere to choose a PDF or see what went where.
- **No promise to read the photo.** Only UBL and Peppol are read, so the page says "Goes to Inbox for booking. You enter the amount there." and the uploaded state says "pick the supplier, then enter the amount and VAT".
- **"Sent this week" on the choose page.** The last two uploads with their status (`In Inbox` as the `--open` pill, `Booked` as `--paid`), linking to the Inbox. New, so you can see a receipt landed without leaving the tab.
- **Uploaded state.** Title "Receipt sent", a thumbnail, file name, size, type and time, status `In Inbox`, the "Open in Inbox" link and "Add another" as the primary button, because the next receipt is the likelier next step than booking. No success callout, per the Callout rule.
- **Failed state.** The file row says "Not sent", a danger callout gives the reason in numbers and what to do, then "Try again" (primary, opens the file picker) and "Take photo instead". The callout carries no button of its own because both fixes sit right under it. Too large is the drawn case: `bonnen-oktober.pdf`, 41,6 MB. Wrong type is the `reason="wrong-type"` variant: `IMG_2051.HEIC`.
- **More lists every sidebar destination the tab bar lacks.** The tab bar has Home, Sales and Bank, and Receipt only adds to the Inbox, so More has Inbox, Costs, Contacts, Journal, VAT, Reports, Import and Settings, in the sidebar's groups and order: Inbox on its own, **Money** (Costs, Contacts), **Books** (Journal, VAT, Reports), then Import and Settings as the pinned pair. The icons are the Sidebar's, at 20px. Shortcuts is left out because phones show no keyboard hints.
- **Badges in More.** Inbox 3 and Costs 40 as neutral badges, like Costs in the Sidebar, so the only yellow on screen stays Hidde's Bank badge in the tab bar.
- **Sign out keeps ink**, not `danger`: signing out loses nothing.
- **Fixtures.** Bakkerij Voorbeeld B.V., `eva@bakkerij.example`, `IMG_2041.jpg`, `IMG_2047.jpg`, `bon-groothandel-meel.pdf`, `bonnen-oktober.pdf` and `IMG_2051.HEIC` are made up. The tab bar badges (Sales 5, Bank 15) are Hidde's demo figures, kept so the bar matches his boards.
- **Canvas placement.** A new row titled "Phone tab bar: Receipt and More (derived)" at y 16700, below the Bank and Costs rows of #160 (y 12880 to 16300) so the two PRs don't overlap: the four light boards at x 0 to 1410, the dark ones at x 1960 to 3370. Each entry has `"derived": true` and a `derivedNote`. Dark is the `theme` prop of `PhoneReceipt` and `PhoneMore`; the `…Dark` boards only set it.
- **Hidde's tab bar links are untouched.** Receipt and More still point to `#` on his four phone boards; pointing them at `PhoneReceipt.dc.html` and `PhoneMore.dc.html` is a one-line change per board, left to him.

### Copy, Dutch and English

NL first. App strings are quoted from `apps/web/src/i18n/{nl,en}.ts`; the rest is _new_. The app calls the Inbox "Postvak" in Dutch, so these strings do too.

| Nederlands                                                                                                                 | English (board)                                                                                                         | Source                   |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Home                                                                                                                       | Home                                                                                                                    | new (tab bar)            |
| Verkoop                                                                                                                    | Sales                                                                                                                   | nav.group.sales          |
| Bon                                                                                                                        | Receipt                                                                                                                 | new (tab bar, page title) |
| Bank                                                                                                                       | Bank                                                                                                                    | nav.bank                 |
| Meer                                                                                                                       | More                                                                                                                    | new (tab bar, page title) |
| Bonnetje toevoegen                                                                                                         | Add a receipt                                                                                                           | dash.addReceipt          |
| Gaat naar het Postvak om te boeken.                                                                                        | Goes to Inbox for booking.                                                                                              | new                      |
| Daar vul je het bedrag in.                                                                                                 | You enter the amount there.                                                                                             | new                      |
| Foto maken                                                                                                                 | Take photo                                                                                                              | new                      |
| Bestand kiezen                                                                                                             | Choose file                                                                                                             | new                      |
| PDF, JPG of PNG, tot 30 MB                                                                                                 | PDF, JPG or PNG, up to 30 MB                                                                                            | new                      |
| Deze week verstuurd                                                                                                        | Sent this week                                                                                                          | new                      |
| Vandaag 07:02 · 1,8 MB / do 29 okt · 240 KB                                                                                | Today 07:02 · 1,8 MB / Thu 29 Oct · 240 KB                                                                              | new                      |
| In Postvak                                                                                                                 | In Inbox                                                                                                                | new (status)             |
| Geboekt                                                                                                                    | Booked                                                                                                                  | new (status)             |
| Bon verstuurd                                                                                                              | Receipt sent                                                                                                            | new                      |
| 2,4 MB · JPG · vandaag 07:16                                                                                               | 2,4 MB · JPG · today 07:16                                                                                              | new                      |
| Status                                                                                                                     | Status                                                                                                                  | new                      |
| Openen in Postvak                                                                                                          | Open in Inbox                                                                                                           | new                      |
| Boek hem vanuit het Postvak: kies de leverancier en vul dan het bedrag en de btw in.                                       | Book it from the Inbox: pick the supplier, then enter the amount and VAT.                                               | new                      |
| Nog een toevoegen                                                                                                          | Add another                                                                                                             | new                      |
| Bestand niet verstuurd                                                                                                     | File not sent                                                                                                           | new (screen reader)      |
| Niet verstuurd                                                                                                             | Not sent                                                                                                                | new                      |
| Te groot voor het Postvak                                                                                                  | Too large for the Inbox                                                                                                 | new                      |
| bonnen-oktober.pdf is 41,6 MB en het Postvak neemt tot 30 MB aan. Stuur de bonnen een voor een, of sla de PDF kleiner op. Er is niets verstuurd. | bonnen-oktober.pdf is 41,6 MB and the Inbox takes up to 30 MB. Send the receipts one at a time, or save the PDF smaller. Nothing was sent. | new |
| HEIC-foto's kunnen niet in het Postvak                                                                                     | HEIC photos can’t go in the Inbox                                                                                       | new                      |
| IMG_2051.HEIC is een fotoformaat van de iPhone. Stuur een PDF, JPG of PNG, of maak de foto hier. Er is niets verstuurd.    | IMG_2051.HEIC is an iPhone photo format. Send a PDF, JPG or PNG, or take the photo here. Nothing was sent.              | new                      |
| Opnieuw proberen                                                                                                           | Try again                                                                                                               | new                      |
| Maak liever een foto                                                                                                       | Take photo instead                                                                                                      | new                      |
| Postvak                                                                                                                    | Inbox                                                                                                                   | nav.inbox                |
| Postvak, 3 documenten wachten                                                                                              | Inbox, 3 documents waiting                                                                                              | new (screen reader)      |
| Geld                                                                                                                       | Money                                                                                                                   | nav.group.money          |
| Kosten                                                                                                                     | Costs                                                                                                                   | new (sidebar label)      |
| Kosten, 40 rekeningen goed te keuren                                                                                       | Costs, 40 bills to approve                                                                                              | new (screen reader)      |
| Relaties                                                                                                                   | Contacts                                                                                                                | nav.contacts             |
| Boekhouden                                                                                                                 | Books                                                                                                                   | nav.group.books          |
| Journaal                                                                                                                   | Journal                                                                                                                 | new (sidebar label)      |
| BTW                                                                                                                        | VAT                                                                                                                     | nav.vat                  |
| Rapporten                                                                                                                  | Reports                                                                                                                 | nav.group.reports        |
| Importeren                                                                                                                 | Import                                                                                                                  | nav.group.import         |
| Instellingen                                                                                                               | Settings                                                                                                                | nav.settings             |
| Account                                                                                                                    | Account                                                                                                                 | new                      |
| Boekjaar 2026                                                                                                              | Book year 2026                                                                                                          | shell.fiscalYear         |
| Bakkerij Voorbeeld B.V., boekjaar 2026. Wissel van administratie of boekjaar                                               | Bakkerij Voorbeeld B.V., book year 2026. Switch administration or book year                                             | new (screen reader)      |
| Uitloggen                                                                                                                  | Sign out                                                                                                                | decided (Hidde)          |

## Batch 1: year close, import steps 3, 4 and 6

| Board                             | Variant                                              | Derived from                                                           | Screenshot (1440, light)                            |
| --------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------- |
| `YearCloseProposal.dc.html`       | ready (default `variant`)                            | SettingsBooks shell and SubNav; copy from `apps/web` fiscal years      | `derived-shots/batch-1/YearCloseProposal.png`       |
| `YearCloseBlocked.dc.html`        | YearCloseProposal, `variant="blocked"`               | same                                                                   | `derived-shots/batch-1/YearCloseBlocked.png`        |
| `YearCloseBlockedMonthly.dc.html` | YearCloseProposal, `variant="blocked" vat="monthly"` | same                                                                   | `derived-shots/batch-1/YearCloseBlockedMonthly.png` |
| `YearCloseBlockedAnnual.dc.html`  | YearCloseProposal, `variant="blocked" vat="annual"`  | same                                                                   | `derived-shots/batch-1/YearCloseBlockedAnnual.png`  |
| `ImportYears.dc.html`             | step 3, Years                                        | ImportSource layout; `/importeren` step "administratie"                | `derived-shots/batch-1/ImportYears.png`             |
| `ImportPreview.dc.html`           | step 4, Preview                                      | ImportFindings layout; `/importeren` steps "voorbeeld" and "overzicht" | `derived-shots/batch-1/ImportPreview.png`           |
| `ImportConfirm.dc.html`           | ImportRun, `variant="confirm"`                       | `/importeren` step "overzicht" confirm                                 | `derived-shots/batch-1/ImportConfirm.png`           |
| `ImportRun.dc.html`               | step 6, transferring (default `variant`)             | `/importeren` step "importeren"                                        | `derived-shots/batch-1/ImportRun.png`               |
| `ImportStopped.dc.html`           | ImportRun, `variant="stopped-nothing"`               | same, failure "We booked nothing"                                      | `derived-shots/batch-1/ImportStopped.png`           |
| `ImportStoppedPartial.dc.html`    | ImportRun, `variant="stopped-partial"`               | same, failure "Part of it may already be booked"                       | `derived-shots/batch-1/ImportStoppedPartial.png`    |

Variant boards are thin wrappers that `dc-import` the main board with a prop, the same way `HomeDark.dc.html` wraps `Main`.

## Accessibility deviations (new boards only)

| Rule                                 | What the new boards do                                                                                                                                                                                                                                                                            | Value                                                                                                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Control borders at least 3:1         | `--line-control` is set to Hidde's `--ink-muted` on `.k-root[data-theme]`, in light and dark, as a token rather than a hex value; `.k-option` and the checkbox use it too (v2 gives options the `line` border, 1.3:1)                                                                             | light `#63636b`: 5.95:1 on `surface`, 5.45:1 on `ground`, 5.21:1 on `surface-sunken` and `danger-bg`, 5.49:1 on `brand-tint`, 5.12:1 on `neutral-bg`. v2's `#c9c8c1` is 1.68:1 on white |
| Text links not yellow on white       | Links are `ink`, underlined (`.lnk`, offset 2px)                                                                                                                                                                                                                                                  | `#18181b`, 17.7:1                                                                                                                                                                       |
| Targets at least 44px at phone width | Under 600px, buttons, inputs, options, rows, sub-nav items and links get `min-height: 44px`                                                                                                                                                                                                       | 44px                                                                                                                                                                                    |
| No `ink-faint` for text              | Not used anywhere; muted text is `ink-muted`                                                                                                                                                                                                                                                      | `#63636b`, 5.95:1 on white                                                                                                                                                              |
| Self-hosted fonts                    | New boards load `../design-system/fonts/fonts.css` (Inter 400, 500, 600, 700 and JetBrains Mono 500, latin subset, woff2, OFL 1.1 licences included) instead of the Google Fonts link                                                                                                             | Fontsource 5.3.0                                                                                                                                                                        |
| VAT period cells                     | Open cells in the year-close strip are links: `ink` text, underlined, on `danger-bg` with a 1px `danger` inset border. Every link gets the v2 `--focus-ring` outline (2px, offset 2px) on `:focus-visible`. Under 600px the cells wrap (quarterly 2 a row, monthly 4, annual 1) and are 44px tall | `#18181b` on `danger-bg`; ring `#18181b`                                                                                                                                                |
| No dimming                           | The blocked year close keeps the entries at full contrast instead of fading them                                                                                                                                                                                                                  | n/a                                                                                                                                                                                     |

The fonts are not fully off the CDN yet. `components/bundle.css` still starts with an `@import` of Google Fonts, and `Sidebar.dc.html` adds a Google Fonts `<link>` in its helmet, so a request still goes out. The local faces load after them and win, and the screenshots were rendered with Google Fonts blocked to prove the boards don't need it. Removing the CDN completely means dropping line 2 of `bundle.css` (both copies) and the Sidebar link. That changes Hidde's files, so it's left to him.

The same `--ink-muted` rule fixes the dark theme, where v2's `--line-control` (`#4a4a51` on `#1a1a1d`) is about 2:1.

## Invented, for Hidde to check

- **Year close as a page inside Book years.** The proposal opens from "See the proposal" on SettingsBooks, under the Book years sub-page. Its sub-nav count goes from 1 to 2 because 2026 is open.
- **The three "Before you close" checks.** These are 2026 open, no open VAT period overlapping 2025, and all bank lines of the year matched. The app only enforces "open the next year first". The other two preconditions are new.
- **Year-close figures.** These come from the demo trial balance on the Reports board: profit € 14.162,11 = revenue € 23.164,83 − costs € 9.002,72, and an opening balance of € 69.085,93 over 7 accounts. The result account `0600 Overige reserves` is the one ImportFindings mentions. `0700 Onverdeelde winst` as the second option, journal `MEM · Memorial` and entry numbers 217 and 218 (the Journal shows 216 entries) are invented.
- **The two entries.** They are "Appropriation 2025" on 31-12-2025 (P&L accounts into the result account) and "Opening balance 2026" on 01-01-2026, as the app posts them. The acknowledgement is a checkbox with the app's exact text "Posts two real entries; no undo button here." It's shown ticked so the confirm button is live. In the app it starts unticked.
- **Blocked year close.** The rule is overlap: any VAT period that overlaps the book year and isn't filed blocks the close. VAT periods are calendar periods, and the filing frequency is set per administration: monthly, quarterly (the default) or annual. The strip shows the periods that overlap the book year, labelled with codes that include the year (`2025-Q4`, `2025-11`, `2025`), never a bare `Q4`, and the copy uses the same codes. With a calendar book year that is 2025-Q1 to 2025-Q4. With a non-calendar book year, for example 01-07-2026 to 30-06-2027, the strip shows the overlapping periods, 2026-Q3 to 2027-Q2 (or 2026-07 to 2027-06 monthly); an annual filer then sees both 2026 and 2027. The `vat` prop picks the frequency. Quarterly (`YearCloseBlocked`) has 2025-Q4 open, monthly (`YearCloseBlockedMonthly`) has 2025-11 and 2025-12 open, annual (`YearCloseBlockedAnnual`) has 2025 open. Each open cell links to that period's VAT page, as does the fix link ("Open VAT period 2025-Q4", the earliest open period when there are more); `Vat.dc.html?period=2025-Q4` is invented, Hidde's VAT board has no period parameter. 4 bank lines from December 2025 (€ 1.271,00) are unmatched; "Match 4 lines" opens Match filtered to 2025 (`Match.dc.html?year=2025`; Hidde's Match board has no year filter drawn yet). The blockers stay on the proposal screen, above the entries, before confirming.
- **Years step.** The administrations "Demo BV" (1.096 documents) and "Demo Holding BV" are made up, as are 2023 (296 documents), 2024 (388) and 2025 (412). Klopt's VAT codes start at 01-01-2025 because that is the first book year. The red not-in-force line shows on every affected year, as in the app. The "Blocks import" pill shows only when the year is ticked, which is new. An unticked year says it stays in Moneybird.
- **Preview step.** It merges the app's "voorbeeld" counts with the "overzicht" sections "Already in Klopt" and "Not transferred", because v2 has no separate summary step. The per-type table (In Moneybird / Already in Klopt / Comes over) and all counts are invented. The not-transferred reasons are: year unticked, drafts, quotes. "Read again" gets the key `R`.
- **Confirm as the first state of step 6.** v2's stepper has no Summary step, so "Ready to transfer?" with "Confirm transfer ⌘↵" opens step 6. The callout title "No undo for an import" is new. Its text is the app's legal copy.
- **Progress per type.** The app shows one bar. The per-type rows, the "Started 30-10-2026 at 10:44 by …" line and "At purchase invoice 2024-0158" are new.
- **Failure states.** Both Stopped boards keep the page heading "Import stopped" (Import gestopt), and their callout titles say something else, so no wording shows twice. The partly-booked callout drops the app's hedge ("Part of it may already be booked") for a count: "271 documents are already booked". That number is the worker's booked count in the run report (documents actually booked before the run stopped), not a count from the preview; the title has `_one` and `_other` forms. Its body is Legal's text, verbatim in EN and NL (see the copy table), and replaces the app's `failedPartialBody`. The duplicate-bookings note is left off that board because the body covers it. The reason "Moneybird didn't answer" and the buttons "Try again" and "Transfer the rest" are invented. The app only offers "What we still need to fix".
- **Keymap: submit is ⌘↵ everywhere.** The new steps show `⌘ ↵` for Next and Confirm. In Hidde's ImportSource (step 2, Connect) and ImportFindings (step 5, Problems), the plain `↵` chip in the submit button was changed to the `⌘ ↵` chord, the same markup as on BillNew and Setup. Neither board had a `↵` in its hint row.
- **XAF copy (Legal).** On Hidde's ImportSource, Setup and SettingsData, "every Dutch package can export" and "every Dutch package can read it" now say "most Dutch packages" (NL "de meeste Nederlandse pakketten"); see the copy table.
- **Fixture.** The owner in the Sidebar and in ImportRun's "Started … by …" line is `eva@bakkerij.example` with an `E` avatar. `Sidebar.dc.html` is byte-identical to the copy at 4433734 on `cursor/contacts-vat-dark-phone-boards-cec3`, so Hidde's other boards show Eva in the Sidebar too.
- **Sign out.** No board in this batch has a log-out action. Hidde's Setup and Switcher already say "Sign out"; in Dutch it is "Uitloggen".
- **Canvas placement.** Import steps 3, 4 and 6 sit right of ImportFindings (step 5), because Hidde's boards keep their positions. Moving ImportFindings to the right of ImportPreview would make the row read in order. The year-close boards are about 2.300px tall, so they start at x 6560 to clear the phone and dark row under the Settings row; the monthly and annual variants follow at x 9600 and 11120. Note widths for "Import" and "Settings" were widened to cover the new boards.

## Copy, English and Dutch

App strings are quoted from `apps/web/src/i18n/{en,nl}.ts`. Strings marked _new_ are Design's.

### Year close

| English (board)                                                                                                                                         | Nederlands                                                                                                                                                                                  | Source                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Close book year 2025                                                                                                                                    | Boekjaar 2025 afsluiten                                                                                                                                                                     | fiscalYears.close                   |
| The proposal first, then close.                                                                                                                         | Eerst het voorstel, dan afsluiten.                                                                                                                                                          | fiscalYears.closeBody               |
| Klopt sets the profit and loss to zero on 31-12-2025, moves the result to equity and opens 2026 with the balances.                                      | Klopt zet de winst-en-verliesrekening op 31-12-2025 op nul, boekt het resultaat naar het eigen vermogen en opent 2026 met de saldi.                                                         | new                                 |
| Proposal / Blocked                                                                                                                                      | Voorstel / Geblokkeerd                                                                                                                                                                      | new                                 |
| Before you close                                                                                                                                        | Voordat je afsluit                                                                                                                                                                          | new                                 |
| Book year 2026 is open                                                                                                                                  | Boekjaar 2026 is geopend                                                                                                                                                                    | new                                 |
| All four VAT periods of 2025 are closed                                                                                                                 | Alle vier btw-periodes van 2025 zijn afgesloten                                                                                                                                             | new                                 |
| All twelve VAT periods of 2025 are closed / VAT period 2025 is closed                                                                                   | Alle twaalf btw-periodes van 2025 zijn afgesloten / Btw-periode 2025 is afgesloten                                                                                                          | new                                 |
| 2025-Q1 to 2025-Q4 are closed, so no VAT can land in 2025 any more and the figures below stay put.                                                      | 2025-Q1 tot en met 2025-Q4 zijn afgesloten, dus er komt geen btw meer in 2025 en de bedragen hieronder blijven staan.                                                                       | new                                 |
| VAT periods overlapping 2025, quarterly VAT returns (set per administration). Grey: closed. (Monthly: monthly VAT returns; annual: annual VAT returns.) | Btw-periodes die overlappen met 2025, btw-aangifte per kwartaal (per administratie in te stellen). Grijs: afgesloten. (Per maand: btw-aangifte per maand; per jaar: btw-aangifte per jaar.) | new                                 |
| Red and underlined: still open, so 2025 can't close. Select one to open it.                                                                             | Rood en onderstreept: staat nog open, dus 2025 kan niet worden afgesloten. Kies er een om hem te openen.                                                                                    | new                                 |
| All are closed / It is closed, so nothing changes under the proposal.                                                                                   | Alle zijn afgesloten / Hij is afgesloten, dus er verandert niets aan het voorstel.                                                                                                          | new                                 |
| Every 2025 bank line is matched                                                                                                                         | Elke bankregel van 2025 is afgeletterd                                                                                                                                                      | new                                 |
| VAT period 2025-Q4 is still open                                                                                                                        | Btw-periode 2025-Q4 staat nog open                                                                                                                                                          | new                                 |
| VAT periods 2025-11 and 2025-12 are still open                                                                                                          | Btw-periodes 2025-11 en 2025-12 staan nog open                                                                                                                                              | new                                 |
| VAT period 2025 is still open                                                                                                                           | Btw-periode 2025 staat nog open                                                                                                                                                             | new                                 |
| Every VAT period that overlaps book year 2025 has to be closed first, or VAT could still land in 2025 after it closes.                                  | Elke btw-periode die overlapt met boekjaar 2025 moet eerst zijn afgesloten, anders kan er na het afsluiten nog btw in 2025 terechtkomen.                                                    | new                                 |
| Open VAT period 2025-Q4 / 2025-11 / 2025                                                                                                                | Naar btw-periode 2025-Q4 / 2025-11 / 2025                                                                                                                                                   | new                                 |
| 4 bank lines from 2025 are not matched                                                                                                                  | 4 bankregels uit 2025 zijn niet afgeletterd                                                                                                                                                 | new                                 |
| Match 4 lines                                                                                                                                           | 4 regels koppelen                                                                                                                                                                           | new                                 |
| Book year 2025 can't close yet                                                                                                                          | Boekjaar 2025 kan nog niet worden afgesloten                                                                                                                                                | new                                 |
| Profit for 2025 / Moves to equity / 2026 opens with                                                                                                     | Winst over 2025 / Naar eigen vermogen / 2026 opent met                                                                                                                                      | new (fiscalYears.result: Resultaat) |
| Result account                                                                                                                                          | Resultaatrekening                                                                                                                                                                           | fiscalYears.resultAccount           |
| An equity account; anything else is refused.                                                                                                            | Een eigen-vermogenrekening; andere worden geweigerd.                                                                                                                                        | fiscalYears.resultAccountHint       |
| Journal                                                                                                                                                 | Dagboek                                                                                                                                                                                     | fiscalYears.journal                 |
| What closing 2025 books                                                                                                                                 | Wat het afsluiten van 2025 boekt                                                                                                                                                            | fiscalYears.wouldPost               |
| Appropriation 2025                                                                                                                                      | Resultaatbestemming 2025                                                                                                                                                                    | fiscalYears.appropriation           |
| Opening balance 2026                                                                                                                                    | Beginbalans 2026                                                                                                                                                                            | fiscalYears.openingBalance          |
| Account / Debit / Credit                                                                                                                                | Rekening / Debet / Credit                                                                                                                                                                   | fiscalYears.account, debit, credit  |
| Not booked                                                                                                                                              | Niet geboekt                                                                                                                                                                                | new                                 |
| Posts two real entries; no undo button here.                                                                                                            | Boekt twee echte journaalposten; hier zit geen knop om dat terug te draaien.                                                                                                                | fiscalYears.ack                     |
| Fix the 2 things above first.                                                                                                                           | Los eerst de 2 punten hierboven op.                                                                                                                                                         | new                                 |

### Import, step 3 Years (Boekjaren)

| English (board)                                                                           | Nederlands                                                                                  | Source                                                            |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Years                                                                                     | Jaren                                                                                       | wizard.administratie.years (the stepper label "Boekjaren" is new) |
| Administration in Moneybird                                                               | Administratie in Moneybird                                                                  | wizard.administratie.admins                                       |
| EUR · fiscal year starts in January · 1.096 documents                                     | EUR · boekjaar begint in januari · 1.096 documenten                                         | wizard.administratie.docsLine                                     |
| Choose which books we transfer. You can still change this until the import.               | Kies welke boeken we overzetten. Je kunt dit tot de import nog aanpassen.                   | wizard.administratie.intro                                        |
| Documents / In Klopt / Open                                                               | Documenten / In Klopt / Open                                                                | wizard.administratie.*                                            |
| Blocks import                                                                             | Blokkeert import                                                                            | findingCard.blocking                                              |
| In 2024 Klopt's VAT codes are not in force yet: 371 documents.                            | In 2024 gelden de btw-codes van Klopt nog niet: 371 documenten.                             | wizard.year.notInForce                                            |
| They apply from 01-01-2025, the start of your first fiscal year in Klopt. … Uncheck 2024. | Ze gelden vanaf 01-01-2025, het begin van je eerste boekjaar in Klopt. … Vink 2024 dan uit. | wizard.year.notInForceHelp                                        |
| Unchecked, so 2023 stays in Moneybird and doesn't block the import.                       | Uitgevinkt, dus 2023 blijft in Moneybird en blokkeert de import niet.                       | new                                                               |
| 2 years · 800 documents                                                                   | 2 jaren · 800 documenten                                                                    | wizard.administratie.selectedSummary                              |
| Next / Back                                                                               | Volgende / Terug                                                                            | wizard.next, wizard.back                                          |

### Import, step 4 Preview (Voorbeeld)

| English (board)                                                                           | Nederlands                                                                                    | Source                                 |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------- |
| What we will transfer                                                                     | Wat we gaan overzetten                                                                        | wizard.voorbeeld.title                 |
| This is a preview: nothing is transferred yet. Check the counts.                          | Dit is een voorbeeld: er wordt nog niets overgezet. Controleer de aantallen.                  | wizard.voorbeeld.intro                 |
| Read again                                                                                | Opnieuw lezen                                                                                 | wizard.voorbeeld.reread                |
| Comes over                                                                                | Komt mee                                                                                      | new                                    |
| Already in Klopt                                                                          | Al in Klopt                                                                                   | wizard.overzicht.alreadyInKlopt        |
| Not transferred                                                                           | Niet overgezet                                                                                | wizard.overzicht.notTransferred        |
| Sales invoices, Purchase invoices, Receipts, Bank mutations, Journal entries              | Verkoopfacturen, Inkoopfacturen, Bonnen, Bankmutaties, Memoriaalposten                        | moneybird.*                            |
| 38 documents from this administration are already in Klopt. We won't transfer them again. | 38 documenten uit deze administratie staan al in Klopt. Die zetten we niet nog een keer over. | wizard.overzicht.alreadyInKloptCount   |
| What you previously transferred … check for duplicate bookings.                           | Wat je eerder uit deze administratie hebt overgezet … controleer dat op dubbele boekingen.    | wizard.overzicht.dedupLegal            |
| You left 2023 unchecked. It stays in Moneybird.                                           | Je hebt 2023 uitgevinkt. Het blijft in Moneybird.                                             | new                                    |
| Drafts are not transferred. / Quotes are not transferred.                                 | Concepten komen niet mee. / Offertes komen niet mee.                                          | from wizard.bron.moneybird.notIncluded |

### Import, step 6 Import (Importeren)

| English (board)                                                                                                                                                                                 | Nederlands                                                                                                                                                                                                         | Source                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Ready to transfer?                                                                                                                                                                              | Klaar om over te zetten?                                                                                                                                                                                           | wizard.overzicht.title                                                                |
| Check the summary. Then the import starts.                                                                                                                                                      | Controleer de samenvatting. Daarna begint de import.                                                                                                                                                               | wizard.overzicht.intro                                                                |
| Import 800 documents?                                                                                                                                                                           | 800 documenten importeren?                                                                                                                                                                                         | wizard.overzicht.confirmTitleCount                                                    |
| Transfer / Do not transfer                                                                                                                                                                      | Overzetten / Niet overzetten                                                                                                                                                                                       | wizard.overzicht.transfer, skip                                                       |
| No undo for an import                                                                                                                                                                           | Een import draai je niet terug                                                                                                                                                                                     | new                                                                                   |
| You cannot undo an import in one go. … together with your accountant.                                                                                                                           | Een import kun je niet in één keer ongedaan maken. … eventueel samen met je accountant.                                                                                                                            | wizard.overzicht.undoLegal                                                            |
| Confirm transfer                                                                                                                                                                                | Overzetten bevestigen                                                                                                                                                                                              | wizard.overzicht.confirm                                                              |
| Transferring                                                                                                                                                                                    | Bezig met overzetten                                                                                                                                                                                               | wizard.importeren.title                                                               |
| You can close this screen; we continue. When you return, you see how far we are.                                                                                                                | Je kunt dit scherm sluiten; we gaan door. Kom je terug, dan zie je hier hoe ver we zijn.                                                                                                                           | wizard.importeren.intro                                                               |
| 62% · 497 of 800                                                                                                                                                                                | 62% · 497 van 800                                                                                                                                                                                                  | wizard.importeren.progress                                                            |
| Started 30-10-2026 at 10:44 by eva@bakkerij.example                                                                                                                                             | Gestart op 30-10-2026 om 10:44 door eva@bakkerij.example                                                                                                                                                           | new                                                                                   |
| Booking… / Queued… / Done                                                                                                                                                                       | Bezig met boeken… / In de wachtrij… / Klaar                                                                                                                                                                        | wizard.importeren.running, pending, wizard.status.done                                |
| Importing…                                                                                                                                                                                      | Bezig met importeren…                                                                                                                                                                                              | wizard.status.importing                                                               |
| Import stopped                                                                                                                                                                                  | Import gestopt                                                                                                                                                                                                     | wizard.importeren.stoppedTitle                                                        |
| We booked nothing                                                                                                                                                                               | We hebben niets geboekt                                                                                                                                                                                            | wizard.importeren.failed                                                              |
| 1 document is already booked (`_one`)                                                                                                                                                           | 1 document staat al in Klopt                                                                                                                                                                                       | new, replaces wizard.importeren.failedPartial; count = booked count in the run report |
| 271 documents are already booked (`_other`, `{count} documents are already booked`)                                                                                                             | 271 documenten staan al in Klopt (`{count} documenten staan al in Klopt`)                                                                                                                                          | new, replaces wizard.importeren.failedPartial; count = booked count in the run report |
| Transferring again skips what's already in Klopt from Moneybird. We don't recognise anything you booked yourself, so check Journal for duplicates. Fix a mistake per booking with a correction. | Opnieuw overzetten slaat over wat al uit Moneybird in Klopt staat. Wat je zelf hebt geboekt, herkennen we niet: controleer Journaalposten op dubbele boekingen. Een fout herstel je per boeking met een correctie. | **Legal verbatim** (EN and NL); replaces wizard.importeren.failedPartialBody          |
| What we still need to fix                                                                                                                                                                       | Wat we nog moeten oplossen                                                                                                                                                                                         | wizard.problemen.title                                                                |
| Open journal entries                                                                                                                                                                            | Naar journaalposten                                                                                                                                                                                                | wizard.klaar.nextEntries                                                              |
| Stopped here / Not booked                                                                                                                                                                       | Hier gestopt / Niet geboekt                                                                                                                                                                                        | new                                                                                   |
| Try again / Transfer the rest                                                                                                                                                                   | Opnieuw proberen / De rest overzetten                                                                                                                                                                              | new                                                                                   |

### Hidde's boards

| English (board)                                                                                             | Nederlands                                                                                             | Source                      |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------- |
| An XAF audit file, which most Dutch packages can export (ImportSource, Setup)                               | Een XAF-auditfile, die de meeste Nederlandse pakketten kunnen exporteren                               | Legal: "most", not "every"  |
| Your accountant, the tax office and most Dutch packages can read it, including Klopt itself. (SettingsData) | Je accountant, de Belastingdienst en de meeste Nederlandse pakketten kunnen hem lezen, ook Klopt zelf. | Legal: "most", not "every"  |
| Sign out (Setup, Switcher)                                                                                  | Uitloggen                                                                                              | Hidde: every log-out action |

## Batch 2: dark and phone for the batch-1 boards

Every batch-1 board now takes `theme` (`light`, `dark`) and `layout` (`desktop`, `phone`). The four main boards (`YearCloseProposal`, `ImportYears`, `ImportPreview`, `ImportRun`) draw the phone layout themselves; the variant wrappers forward both props. No new board files: in Claude Design, flip the props. Screenshots are in `derived-shots/batch-2/`, named `<Board>-<light|dark>-<1440|390>.png`, 40 in all. The light 1440 shots were all re-shot, because the fixture email and its avatar initial show in the Sidebar on every board. The batch-1 PNGs in `derived-shots/batch-1/` were re-shot too, under their old names, so no committed shot shows the old fixture. They now show the batch-2 state of the boards and have the same pixels as the batch-2 `-light-1440` shots. Every PNG carries a tEXt `Source` chunk with its own path, so the md5s stay unique.

Phone follows the v2 phone rules: `.k-phone` at 390, Hidde's five-tab `.k-tabbar` with More active (import and year close live under More, Settings), one column, no keyboard hints or chips, no hover. A step with a primary action keeps it in a sticky bar above the tab bar. The phone shots are full page, so that bar and the tab bar end the image.

| Rule                               | What batch 2 does                                                                                                                                                                                  | Value                                                                                                                                                                                 |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Control borders at least 3:1, dark | The same `--ink-muted` rule as light (v2's `#4a4a51` is about 2:1)                                                                                                                                 | dark `#a1a1aa`: 6.77:1 on `surface`, 7.36:1 on `ground`, 7.12:1 on `surface-sunken`, 6.18:1 on `surface-hover`, 6.32:1 on `danger-bg`, 5.60:1 on `brand-tint`, 5.57:1 on `neutral-bg` |
| Disabled primary text 4.5:1        | Disabled primary buttons no longer fade to 45%; they use `neutral-bg`, `ink-muted` text and a `line-control` border, in both themes and at both widths                                             | light 5.2:1, dark 5.6:1                                                                                                                                                               |
| Disabled selects look disabled     | The Result account and Journal selects on the blocked YearClose boards sit on `neutral-bg` in `ink-muted` with `cursor: not-allowed`, in both themes and at both widths. Their labels stay `ink-2` | text light 5.12:1, dark 5.57:1 on `neutral-bg`                                                                                                                                        |
| Key hints in primary buttons, dark | The `⌘ ↵` hints in enabled primary buttons are outlined in `--on-primary` in dark; v2's white 18% border vanishes on the white `--primary` button                                                  | about 10.5:1 against `--primary` (about 1:1 before)                                                                                                                                   |
| No dash placeholders               | ImportPreview's per-type table shows `0` where it showed `–`                                                                                                                                       | n/a                                                                                                                                                                                   |
| No mid-number breaks               | Amounts, dates and period codes are `nowrap` on phone; phone strings put a word joiner (U+2060) after the hyphen in dates and codes such as `30-10-2026`                                           | n/a                                                                                                                                                                                   |
| Targets at least 44px              | Back links, buttons, selects, year rows, check rows and tab bar items are 44px or more                                                                                                             | 44px, the sticky action 48px                                                                                                                                                          |

`shoot.mjs` checks the last four on every shot and printed no warnings for the 40 shots. It also checks for `ink-faint` text and text under 4.5:1. Batch 2 uses no `ink-faint`, and status colours stay those of batch 1: green (`success`), the blocking red (`danger`) and the yellow warn callout.

### Invented in batch 2, for Hidde to check

- **Phone header.** A ghost back link top left (`‹ Connect`, `‹ Years`, `‹ Problems`, `‹ Home` while transferring, `‹ Book years`), the status pill top right, then a small "Import from Moneybird · step 3 of 6" line above the step title instead of the six-step stepper, which doesn't fit 390.
- **No sticky bar while transferring.** ImportRun (running) has no action until it's done, so its phone layout ends with the tab bar only.
- **Shorter phone copy.** Listed below; Legal's partly-booked body and the undo text stay verbatim.
- **Phone tables.** Import per type shows "Comes over" on the right and "238 in Moneybird · 24 in Klopt" under the name. The year-close entries keep Account, Debit and Credit; account names wrap by word instead of being cut.
- **The disabled-button style** in the table above. Control borders follow Hidde's decision: `--ink-muted` in both themes.

### Copy, phone only

| English (board)                                                                                                   | Nederlands                                                                                                                                  | Source                                |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Import from Moneybird · step 3 of 6 (4, 6)                                                                        | Importeren uit Moneybird · stap 3 van 6 (4, 6)                                                                                              | new                                   |
| Which years?                                                                                                      | Welke jaren?                                                                                                                                | new                                   |
| Year starts in January · 1.096 documents / Year starts in July                                                    | Boekjaar begint in januari · 1.096 documenten / Boekjaar begint in juli                                                                     | new                                   |
| Years in Demo BV                                                                                                  | Jaren in Demo BV                                                                                                                            | new                                   |
| 412 documents                                                                                                     | 412 documenten                                                                                                                              | new                                   |
| You fix them under Problems, or uncheck 2024 to leave it in Moneybird.                                            | Je lost ze op bij Problemen, of vink 2024 uit om het in Moneybird te laten.                                                                 | new                                   |
| Unchecked, so 2023 stays in Moneybird.                                                                            | Uitgevinkt, dus 2023 blijft in Moneybird.                                                                                                   | new                                   |
| Read from Demo BV at 10:42                                                                                        | Gelezen uit Demo BV om 10:42                                                                                                                | new                                   |
| Per type                                                                                                          | Per soort                                                                                                                                   | new                                   |
| 238 in Moneybird · 24 in Klopt                                                                                    | 238 in Moneybird · 24 in Klopt                                                                                                              | new                                   |
| Also: 75 contacts (12 already in Klopt) and 31 ledger accounts.                                                   | Ook: 75 contacten (12 al in Klopt) en 31 grootboekrekeningen.                                                                               | new                                   |
| Drafts are not transferred. Finish them in Moneybird first.                                                       | Concepten komen niet mee. Rond ze eerst af in Moneybird.                                                                                    | new                                   |
| Klopt has no quotes yet.                                                                                          | Klopt heeft nog geen offertes.                                                                                                              | new                                   |
| What you booked yourself in Klopt we do not recognise: check for duplicate bookings.                              | Wat je zelf in Klopt hebt geboekt, herkennen we niet: controleer op dubbele boekingen.                                                      | new, from wizard.overzicht.dedupLegal |
| Next: Problems. 2024 still blocks the import.                                                                     | Volgende: Problemen. 2024 blokkeert de import nog.                                                                                          | new                                   |
| Starts as soon as you confirm.                                                                                    | Begint zodra je bevestigt.                                                                                                                  | new                                   |
| You can close this screen; we continue.                                                                           | Je kunt dit scherm sluiten; we gaan door.                                                                                                   | from wizard.importeren.intro          |
| Moneybird didn't answer after 10:46 on 30-10-2026. Try again; if it fails again, check the problems first.        | Moneybird reageerde na 10:46 op 30-10-2026 niet meer. Probeer het opnieuw; lukt het weer niet, kijk dan eerst naar de problemen.            | new                                   |
| Settings · Books                                                                                                  | Instellingen · Boeken                                                                                                                       | new                                   |
| Klopt sets the profit and loss to zero on 31-12-2025, moves the result to equity and opens 2026.                  | Klopt zet de winst-en-verliesrekening op 31-12-2025 op nul, boekt het resultaat naar het eigen vermogen en opent 2026.                      | new                                   |
| VAT periods in 2025                                                                                               | Btw-periodes in 2025                                                                                                                        | new                                   |
| Quarterly VAT returns. (Monthly VAT returns. / Annual VAT returns.) Grey: closed. All are closed. / It is closed. | Btw-aangifte per kwartaal. (Btw-aangifte per maand. / Btw-aangifte per jaar.) Grijs: afgesloten. Alle zijn afgesloten. / Hij is afgesloten. | new                                   |
| Red: still open, so 2025 can't close. Tap one to open it.                                                         | Rood: staat nog open, dus 2025 kan niet worden afgesloten. Tik erop om hem te openen.                                                       | new                                   |
| 2 things below block it. Nothing has been booked.                                                                 | 2 punten hieronder houden het tegen. Er is niets geboekt.                                                                                   | new                                   |
| 2025 carries its balances into it.                                                                                | 2025 neemt zijn saldi daarin mee.                                                                                                           | new                                   |
| No VAT can land in 2025 any more.                                                                                 | Er kan geen btw meer in 2025 terechtkomen.                                                                                                  | new                                   |
| Close it first / Close them first, or VAT could still land in 2025.                                               | Sluit hem eerst af / Sluit ze eerst af, anders kan er nog btw in 2025 terechtkomen.                                                         | new                                   |
| Together € 1.271,00 from December 2025, not in the books yet.                                                     | Samen € 1.271,00 uit december 2025, nog niet in de boeken.                                                                                  | new                                   |
| The 15 lines waiting in Bank are from 2026.                                                                       | De 15 regels die in Bank wachten zijn uit 2026.                                                                                             | new                                   |
| 7 balance-sheet accounts                                                                                          | 7 balansrekeningen                                                                                                                          | new                                   |
| Sets the 8 profit and loss accounts to zero; the profit goes to the result account.                               | Zet de 8 winst-en-verliesrekeningen op nul; de winst gaat naar de resultaatrekening.                                                        | new                                   |
| Carries the 7 balance-sheet accounts into 2026, including the profit now in equity.                               | Neemt de 7 balansrekeningen mee naar 2026, met de winst die nu in het eigen vermogen staat.                                                 | new                                   |
| Books entry 217 and 218 and locks 2025.                                                                           | Boekt post 217 en 218 en sluit 2025 af.                                                                                                     | new                                   |

### Dark and phone in Hidde's export

An inventory only; nothing here was drawn. Every screen takes a `theme` prop, so dark "exists" as markup everywhere, but only these have their own dark or phone board:

| Export screen | Dark board                         | Phone board                          |
| ------------- | ---------------------------------- | ------------------------------------ |
| Main (Home)   | `HomeDark`                         | `PhoneHome`                          |
| Invoices      | `InvoicesDark`                     | `PhoneSales`, `PhoneInvoice`         |
| Match         | `MatchDark`                        | `PhoneMatch`                         |
| Editor        | none                               | none                                 |
| Command       | none                               | none                                 |
| Settings      | none                               | none                                 |
| Inbox         | none                               | none                                 |
| Costs         | none                               | none                                 |
| Vat           | none                               | none                                 |
| Reports       | none                               | none                                 |
| Contacts      | none                               | none                                 |
| Sidebar       | none (only inside the dark boards) | none; phone uses `.k-tabbar` instead |

The 11 screens are the first two canvas rows ("Daily flows" and "Inbox, costs, VAT, reports, contacts"). The other 20 desktop screens (sign-in to settings) have no dark or phone board either.


## Rendering the screenshots

Claude Design's `support.js` runtime isn't in this export, so `derived-shots/render/dc-shim.js` stands in for it. It covers only what the boards use (`{{}}`, `sc-for`, `sc-if`, `dc-import`, `DCLogic`), and Claude Design remains the reference. From `design/redesign-2026-10/`, with `playwright` installed:

```sh
node derived-shots/render/shoot.mjs derived-shots/batch-1 YearCloseProposal.dc.html=YearCloseProposal ImportRun.dc.html?variant=stopped-partial=ImportStoppedPartial
node derived-shots/render/shoot.mjs derived-shots/batch-2 'ImportRun.dc.html?theme=dark=ImportRun-dark-1440' --width=390 'ImportRun.dc.html?layout=phone&theme=dark=ImportRun-dark-390'
```

The script serves the folder locally, blocks Google Fonts, waits for the fonts, asks for reduced motion, turns off transitions and animations, parks the mouse off the sidebar, then takes a full-page shot at 1440 wide. Since batch 2 it also renders at 390 (`--width=390`, for the jobs after it), sets the board's theme on `<html>`, waits for animations to finish, grows phone viewports to the page height, and prints QA warnings.

## Getting in: sign-in, setup, AI consent and switcher, dark and phone (#153)

Hidde's four desktop-light boards (`SignIn`, `Setup`, `OAuth`, `Switcher`) get a dark 1440 board and phone 390 boards in light and dark. His files are not edited. Screenshots are in `derived-shots/batch-153/`.

| Board | What it is | Edition | Screenshot |
| --- | --- | --- | --- |
| `SignInDark.dc.html`, `theme` prop (default dark) | Sign-in at 1440, own file: invite-only copy, no hosting-location claim | both | `SignIn-dark-1440` |
| `SetupDark.dc.html`, `theme` and `edition` props | Setup step 1 at 1440, own file: Eva signed in, XAF copy, terms checkbox on hosted | hosted | `Setup-hosted-dark-1440` |
| `SetupSelfHostedDark.dc.html` | `SetupDark` with `edition="self-hosted"`: no checkbox, button enabled | self-hosted | `Setup-selfhosted-dark-1440` |
| `OAuthDark.dc.html` | Thin wrapper: Hidde's `OAuth` with `theme="dark"` | both | `OAuth-dark-1440` |
| `SwitcherDark.dc.html` | Thin wrapper: Hidde's `Switcher` with `theme="dark"` | both | `Switcher-dark-1440` |
| `PhoneSignIn.dc.html`, `theme` and `step` props | Sign-in, email step; `PhoneSignInDark` sets dark | both | `SignIn-light-390`, `SignIn-dark-390` |
| `PhoneSignInCode.dc.html`, `PhoneSignInCodeDark.dc.html` | `PhoneSignIn` with `step="code"` | both | `SignInCode-light-390`, `SignInCode-dark-390` |
| `PhoneSetup.dc.html`, `theme` and `edition` props | Setup step 1; `PhoneSetupDark` sets dark | hosted | `Setup-hosted-light-390`, `Setup-hosted-dark-390` |
| `PhoneSetupSelfHosted.dc.html`, `PhoneSetupSelfHostedDark.dc.html` | `PhoneSetup` with `edition="self-hosted"` | self-hosted | `Setup-selfhosted-light-390`, `Setup-selfhosted-dark-390` |
| `PhoneOAuth.dc.html`, `theme` prop | Assistant consent; `PhoneOAuthDark` sets dark | both | `OAuth-light-390`, `OAuth-dark-390` |
| `PhoneSwitcher.dc.html`, `theme` prop | Administration and book year; `PhoneSwitcherDark` sets dark | both | `Switcher-light-390`, `Switcher-dark-390` |
| `TermsConsent.dc.html`, `theme`, `lang`, `size` and URL props | Component: the terms checkbox, imported by both Setup boards | hosted | `TermsConsent-light-440` |

All new boards are registered in `canvas.json` (notes `t153a` and `t153b`, rows at y 21920 and 23480, 300px below the lowest base board after #109 and #160).

### Why some dark boards are their own file

`OAuthDark` and `SwitcherDark` are thin wrappers, like `HomeDark`, because Hidde's markup is right as it is. `SignInDark` and `SetupDark` are copies because his light boards carry copy these rules don't allow, and editing his files is out of scope here:

- `SignIn`: "New here? The same button creates your account." (signup is closed, #47) and "Hosted in Europe, or on your own server" (no hosting-location claim). Both are replaced below. His two cards also overflow 1440 (the board renders 1680 wide), so in `SignInDark` the cards are 20px narrower and the gaps tighter.
- `Setup`: the signed-in address is not the sample user, and the XAF line says "every Dutch package". `SetupDark` uses `eva@bakkerij.example` and "most Dutch packages", and names the new administration "Bakkerij Eva BV".

Hidde's light `SignIn` and `Setup` still have those lines and should get the same copy in whichever PR owns them.

### Terms checkbox (hosted only)

- One checkbox, never pre-ticked, and it only accepts the terms and the data processing agreement. No marketing opt-in, no other consent.
- Label, English: "I agree to the [terms] and the [data processing agreement]". Dutch: "Ik ga akkoord met de [voorwaarden] en de [verwerkersovereenkomst]".
- The privacy notice is a separate line to read, outside the label: "Read our [privacy notice]." / "Lees onze [privacyverklaring]."
- Placeholder hrefs are `KLOPT_TERMS_URL`, `KLOPT_DPA_URL` and `KLOPT_PRIVACY_URL`. Links are ink and underlined.
- The wording lives once, in `COPY` in `TermsConsent.dc.html` (en and nl). Both Setup boards import it, so a wording change is one line there.
- It sits on Setup step 1 because the data processing agreement belongs to the administration being created. Create administration stays disabled until the box is ticked.
- Self-hosted has no checkbox (`edition="self-hosted"`).
- Engineering note, not shown in the UI: when the box is ticked, the app records who ticked it, when, and which version of the terms and of the data processing agreement they accepted.

### Rules for these boards

- Control borders: `.k-root[data-theme]{--line-control:var(--ink-muted)}`, the same rule as #109 and #158. The checkbox and the code digits use it too.
- Disabled controls look disabled: `--ink-muted` text on `--neutral-bg`, `cursor: not-allowed`. Key hints in a disabled button are outlined in `--ink-muted`.
- In dark, key hints in a primary button are outlined in `--on-primary`.
- `OAuthDark` and `PhoneOAuth` give the switch an `--on-primary` knob when on in dark. Hidde's white knob on the dark-mode primary is about 1.1:1.
- Links are ink and underlined. No `ink-faint` for text (the decorative arrow on `SignInDark` moved to `ink-muted`). Phone targets are at least 44px. No new status colours.
- Phone boards have no key hints. Desktop keeps Hidde's (↵, ⌘↵, ⌘V, Esc).
- Sign-in, Setup and assistant consent are outside the app (signed out, no administration yet, or opened by the assistant), so their phone boards have no tab bar. `PhoneSwitcher` opens from the administration name on `PhoneHome`, so it has the tab bar with Home active. It is a page rather than a sheet, so nothing sits on the tab bar.
- `PhoneSwitcher` and `PhoneOAuth` list a second administration, "Bakkerij Eva BV". Hidde's desktop `Switcher` lists only Demo BV.
- Sample people: Eva (`eva@bakkerij.example`). No other address appears on these boards.
- Fonts are self-hosted (`design-system/fonts/fonts.css`, the same files as #157 and #160). Hidde's `OAuth`, `Switcher` and `Sidebar`, imported by the thin wrappers, still carry his Google Fonts link; the shoot blocks it.

### Contrast (WCAG 2.x)

| Pair | Light | Dark |
| --- | --- | --- |
| Control border (`ink-muted`) on `surface` | 5.95:1 | 6.77:1 |
| Control border (`ink-muted`) on `ground` | 5.45:1 | 7.36:1 |
| v2 `line-control` on `surface` (replaced) | 1.68:1 | 1.98:1 |
| Muted text on `surface` / `ground` / `surface-sunken` | 5.95 / 5.45 / 5.21:1 | 6.77 / 7.36 / 7.12:1 |
| Muted text on `selection` (switcher rows) | 5.59:1 | 5.74:1 |
| Disabled: `ink-muted` on `neutral-bg` | 5.12:1 | 5.57:1 |
| Link (`ink`) on `surface` / `ground` / `surface-sunken` | 17.72 / 16.22 / 15.51:1 | 15.80 / 17.16 / 16.59:1 |
| Key hint outline (`on-primary` on `primary`) | 17.72:1 | 16.12:1 |

### Shooting

`node --import ./derived-shots/render/hide-scrollbars.mjs derived-shots/render/shoot-widths.mjs derived-shots/batch-153 <Board>@<width>=<name> ...`, run from `design/redesign-2026-10/` with Playwright's bundled Chromium. `shoot-widths.mjs` and `dc-shim.js` are the same files as on #160. The small preload adds `--hide-scrollbars`, because tall phone boards otherwise measured with a scrollbar on some runs and came out 16px taller. Every md5 in `batch-153` is unique.

### Copy, English and Dutch

Strings Hidde already has on his boards are not repeated here.

| English (board) | Nederlands |
| --- | --- |
| Klopt is invite-only for now. Ask the person who invited you, or use the email they invited. | Klopt werkt voorlopig alleen op uitnodiging. Vraag het aan wie je heeft uitgenodigd, of gebruik het e-mailadres waarop je bent uitgenodigd. |
| Run it on your own server | Draai het op je eigen server |
| Open source, Apache-2.0. Your books leave whenever you want, as an audit file. | Open source, Apache-2.0. Je boekhouding gaat mee wanneer je wilt, als auditfile. |
| Change email | E-mailadres wijzigen |
| Paste the code or let your phone fill it in. It signs you in by itself. | Plak de code of laat je telefoon hem invullen. Je wordt vanzelf ingelogd. |
| I agree to the terms and the data processing agreement | Ik ga akkoord met de voorwaarden en de verwerkersovereenkomst |
| Read our privacy notice. | Lees onze privacyverklaring. |
| Tick the box above to continue. | Vink het vakje hierboven aan om verder te gaan. |
| Next: bring your history across, or not. | Hierna: je geschiedenis overzetten, of niet. |
| Company / History / Bank (phone steps) | Bedrijf / Geschiedenis / Bank |
| It shows in the switcher and on screens. | Zo heet hij in de wisselaar en op schermen. |
| 31 categories, 5 journals and 27 VAT codes, mapped to RGS 3.7. Currency is euro. | 31 categorieën, 5 dagboeken en 27 btw-codes, ingedeeld volgens RGS 3.7. Valuta is euro. |
| An XAF audit file, which most Dutch packages can export | Een XAF-auditfile, die de meeste Nederlandse pakketten kunnen exporteren |
| Or start empty and import later. Nothing is booked until you confirm. | Of begin leeg en importeer later. Er wordt niets geboekt tot je bevestigt. |
| An AI assistant, over MCP. It can look and prepare; you decide what gets booked. | Een AI-assistent, via MCP. Hij kan kijken en voorbereiden; jij beslist wat er geboekt wordt. |
| Post to the ledger, send, pay or change settings | Boeken in het grootboek, versturen, betalen of instellingen wijzigen |
| Take this back any time under Settings, People and access. Every change it makes shows in Who did what. | Trek dit altijd in via Instellingen, Mensen en toegang. Elke wijziging staat in Wie deed wat. |
| ‹ Home | ‹ Home |
| Administration and book year | Administratie en boekjaar |
| Owner · just you | Eigenaar · alleen jij |
| Signed in as | Ingelogd als |
| Sign out | Uitloggen |

### Invitee's first sign-in (Legal art. 13)

What an invitee sees on the code step the first time they sign in. Under the code boxes there is one line in `--ink-muted`: "Read our [privacy notice]." / "Lees onze [privacyverklaring]." Only "privacy notice" / "privacyverklaring" is a link, in ink and underlined, to `KLOPT_PRIVACY_URL`. There is no checkbox and nothing about the terms or the data processing agreement. The invitee is Ruben (`ruben@voorbeeld.example.nl`). These are new files, and no existing board changes.

| Board | What it is | Screenshot |
| --- | --- | --- |
| `SignInInvitee.dc.html`, `theme` prop (default light) | `SignInDark` layout with Ruben and the privacy line under the code boxes | `SignInInvitee-light-1440` |
| `SignInInviteeDark.dc.html` | `SignInInvitee` with `theme="dark"` | `SignInInvitee-dark-1440` |
| `PhoneSignInInvitee.dc.html`, `theme` prop | The `PhoneSignIn` code step with the privacy line; the link is 44px tall | `SignInInvitee-light-390` |
| `PhoneSignInInviteeDark.dc.html` | `PhoneSignInInvitee` with `theme="dark"` | `SignInInvitee-dark-390` |

On the canvas they sit at y 25500 under note `t153c`. The line is `ink-muted` on `surface`: 5.95:1 in light, 6.77:1 in dark. The link is `ink`: 17.72:1 and 15.80:1.

| English (board) | Nederlands |
| --- | --- |
| Read our privacy notice. | Lees onze privacyverklaring. |
