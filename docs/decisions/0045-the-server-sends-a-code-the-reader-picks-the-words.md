# 0045. The server sends a code, the reader picks the words

Status: Accepted
Date: 2026-09-14

## Context

ADR 0038 made the UI Dutch and English. It translated the chrome — navigation,
buttons, column headings, everything written in a `.tsx` file — and left
everything the server computes alone, which was most of a screen's nouns.

An English reader on the balance sheet saw translated headings around
**Activa**, **Schulden** and **Eigen vermogen**. On the purchase list, every
row said **geboekt** or **in geschil**. On the VAT overview, **1e kwartaal
2026**. That is worse than a screen that is honestly all Dutch: it reads as a
translation somebody abandoned halfway, and the reader stops trusting the parts
that were done.

## What was actually wrong, which was not what the todo list said

The note carried since ADR 0038 said domain error messages from `@klopt/core`
were "still Dutch for an English reader". Checking rather than trusting it:
**all 107 of them are English**, and the default locale is Dutch. So the defect
there runs the other way — a Dutch user, which is the default and most of them,
gets English validation messages.

Two opposite defects, one mechanism. This ADR covers the labels. The
violation messages are a larger piece of work and are recorded as outstanding.

## Every one of these was already a pair

The useful discovery is that almost nothing had to change on the wire. A
response that carries a computed label already carries the machine value beside
it:

| Response field                       | Was rendered | Rendered now                 |
| ------------------------------------ | ------------ | ---------------------------- |
| `statusLabel: 'in geschil'`          | that         | `status: 'disputed'`         |
| `title: 'Activa'`                    | that         | `key: 'assets'`              |
| `retentionClassLabel: 'Seven years'` | that         | `retentionClass: 'standard'` |
| `label: '1e kwartaal 2026'`          | that         | `kind` + `code: '2026-Q1'`   |
| `stageLabel: 'Laatste aanmaning'`    | that         | `tone: 'final'`              |

Two of them needed the code added — `tone` on the dunning rows and actions,
`kind` on the VAT period list. Both are new fields, which
`docs/api-stability.md` permits; nothing was removed.

**The Dutch sentences stay on the response.** Removing a field is a breaking
change under that same promise, and an integrator with no message catalogue
still needs something to print. The UI simply stops reading them.

## Keyed by what the thing is, not by where it sits

`tone`, not `stage`. The dunning schedule is three stages today and is meant to
be configurable; a translation keyed on `2` would attach itself to whatever the
second reminder becomes. `reminder`, `demand` and `final` are what the messages
_are_, and they do not move.

The month names come from `Intl` rather than the catalogue. It already knows
the twelve names in every locale, and adding twenty-four strings to keep right
would buy nothing. What is in the catalogue is the shape of the phrase, because
that genuinely differs: a Dutch bookkeeper says **1e kwartaal 2026** and an
English one says **Q1 2026**. A translated template, not a formatted number.

## What stays Dutch, on purpose

**Rubriek names.** "Leveringen/diensten belast met hoog tarief" is the text
printed next to box 1a on the Belastingdienst's own form. A bookkeeper filing a
Dutch return reads our screen and that form side by side, and translating it
would mean the two no longer match. It is a statutory label, not our prose, and
it stays in the language it is filed in. The same goes for the reconciliation
differences, which are named by rubriek.

There is a test asserting the catalogue has no `label.rubriek.*` key, so this
is a decision somebody has to overturn deliberately rather than drift into.

## The completeness mechanism

Five enumerations, all imported from `@klopt/core` by `test/labels.test.ts`
rather than listed in it. Adding a purchase status fails the build until it has
been translated into both languages.

That required exporting runtime lists for types that only existed at compile
time, and there is a wrinkle worth recording. The obvious way —

```ts
export const PURCHASE_INVOICE_STATUSES = ['draft', 'booked', …] as const
export type PurchaseInvoiceStatus = (typeof PURCHASE_INVOICE_STATUSES)[number]
```

— cost the name. An indexed access is not a named type, so ADR 0044's converter
stopped seeing an alias, and `PurchaseInvoiceStatus`, `RetentionClass` and
`VatPeriodKind` vanished from `openapi.json` and came back as inline literal
unions. The generated document is what caught it.

So it goes the other way round: the type stays a written union, and the list is
`Object.keys` of a map the compiler already keeps exhaustive —
`Record<PurchaseInvoiceStatus, string>` for the ones that had a label map,
`Record<Kind, true>` for the ones that did not. A new member fails to compile
until it is in the map, and the alias survives into the document.

## Proof

`e2e/language.spec.ts` drives a browser: an English reader on
`/reports/balance-sheet` sees **Assets** and **Equity** and no **Activa**
anywhere on the page, and on `/vat` sees **Q1 2026** with no **kwartaal**. The
companion test asserts a Dutch reader still sees both Dutch words on the same
two screens — because a translation that quietly anglicised the default would
be the same bug pointing the other way.

## Consequences

- Every label the server computes now follows the reader. The screens are
  consistently one language rather than mostly one.
- Adding a value to any of the five enumerations fails a test until it has been
  translated, in both languages.
- The API is unchanged for anyone consuming it: two fields added, none removed,
  every Dutch sentence still there.
- Statutory labels are exempt, in writing, with a test.
- The domain violation messages are still English in a Dutch-first product.
  That is 107 sentences, almost all of them distinct — 17 of the 48 error codes
  carry more than one, `invalid_tax_code` alone carries sixteen — so the code
  cannot be the translation key and the sentence needs an identity of its own.
  Left as its own slice rather than half-done here.
