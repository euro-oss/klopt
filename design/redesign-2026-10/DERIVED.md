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
