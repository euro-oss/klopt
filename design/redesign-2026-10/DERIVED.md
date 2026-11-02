# Derived boards

Boards Hidde did not draw, derived by Design from his v2 system. They use only `tokens.css`, `components/bundle.css` and the existing `.k-*` components, in the same `.dc.html` format, and are registered in `screens/canvas.json` with `"derived": true`.

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

All new boards are registered in `canvas.json` (notes `t153a` and `t153b`, rows at y 18700 and 20260, below every other open batch).

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
| Use it hosted, or run it on your own server | Gebruik het gehost, of draai het op je eigen server |
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

On the canvas they sit at y 22280 under note `t153c`. The line is `ink-muted` on `surface`: 5.95:1 in light, 6.77:1 in dark. The link is `ink`: 17.72:1 and 15.80:1.

| English (board) | Nederlands |
| --- | --- |
| Read our privacy notice. | Lees onze privacyverklaring. |
