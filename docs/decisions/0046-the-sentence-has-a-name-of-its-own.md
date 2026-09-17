# 0046. The sentence has a name of its own

Status: Accepted
Date: 2026-09-14

## Context

ADR 0045 fixed the labels the server computes and left the domain's refusals,
which are the other half and the bigger one. All 107 of them were English:

> No account 9999.
> Entry does not balance in EUR: debits minus credits is 500 minor units.

The default locale is Dutch. So a Dutch bookkeeper who mistyped an account
number got an English sentence in the middle of an otherwise entirely Dutch
screen — and Dutch is not a minority case here, it is the default and most of
the users.

## Why the error code cannot be the translation key

The obvious design is one message per `LedgerErrorCode`: sixty-six codes, sixty-
six translations, done. Counting first showed why not.

**Seventeen of the forty-eight codes in use carry more than one sentence.**
`invalid_tax_code` carries sixteen — a rate out of range, a missing rubriek, a
pro rata share at the wrong end, a scope that contradicts its base box.
`invalid_date` carries ten. Across the whole domain there are 107 call sites
and 106 distinct sentences.

Translating on the code would replace those sixteen specific messages with one
vague one. That is a worse screen bought with a better mechanism, and the
specific message is the entire value: it tells somebody which field to fix.

The code is coarse _on purpose_ — an integrator branches on it, and
`docs/api-stability.md` promises it will not be repurposed. It is the wrong
thing to hang a sentence on. So the sentence gets an identity of its own:

```ts
readonly code: LedgerErrorCode          // what you branch on
readonly messageKey: ViolationMessageKey | null  // which sentence this is
readonly message: string                 // that sentence, in English
readonly detail?: Record<string, string> // the values inside it
```

Both go out on the wire. `messageKey` is a new field, which the stability
promise permits; nothing was removed.

## The message moved out of the call site

`violation()` used to take the sentence:

```ts
violation('unknown_account', `${path}.accountNumber`, `No account ${line.accountNumber}.`, {
  accountNumber: line.accountNumber,
})
```

It now takes a key and the values, and the sentence comes from
`VIOLATION_MESSAGES`:

```ts
violation('unknown_account.account', `${path}.accountNumber`, {
  accountNumber: line.accountNumber,
})
```

One place holds every sentence the domain can say. That is what makes
translating them possible at all, and it makes a key that is not in the
catalogue a compile error rather than a screen showing a key.

The 103 entries and the 107 rewritten call sites were produced by a script that
read the existing calls, turned `${expr}` into `{name}`, and folded the
expression into `detail` — reusing an existing `detail` key when it already
carried the same value, because those keys are public and renaming one would
break a consumer.

**The proof it was faithful: 818 core tests passed unchanged.** Many of them
assert message text, and every sentence came out byte-identical.

### Three the script got wrong, and how they surfaced

Reviewing the generated catalogue rather than trusting it caught:

- A concatenated template — `` `…the ` + `${x}…` `` — that reached the
  catalogue with the backticks in it.
- `entry_unbalanced.file_control_totals` compares what an XAF file declares
  against what it contains. Both sides were named `totalDebit`, so the message
  would have printed the same number twice.
- `wrong_invoice_state` interpolated `ACTION_PAST[action]`. The namer saw
  `action`, found `action` already in `detail`, and reused it — so the sentence
  would have read "cannot be approve" rather than "cannot be approved".

None of those were caught by a test, because no test asserted those particular
sentences. They were caught by reading 103 lines of generated output, which is
the argument for generating something small enough to read.

## English in the domain, Dutch in the reader

The other way round from ADR 0038, and on purpose. `VIOLATION_MESSAGES` is
English because that is the language the API speaks — the field names, the
error codes and the operation summaries all are, and an integrator reading a
problem document should get something they can act on. The domain has no
locale. The _reader_ does, and that is the UI's problem.

So `en.ts` does not contain these sentences at all: it spreads
`VIOLATION_MESSAGES`. A hundred and three strings that are already correct in
one file do not want copying into another. `nl.ts` has the translations, and
`test/labels.test.ts` walks the catalogue — imported, not restated — so a
message added to the domain fails the build until it has Dutch.

### Through a subpath, because the barrel reaches `node:crypto`

`en.ts` is imported by the locale provider and therefore ends up in the browser
bundle. Importing `@klopt/core` there pulled the whole barrel in, and Vite
externalised `node:crypto`, leaving a page that rendered and then threw on the
first hash. The e2e suite caught it within a minute.

`@klopt/core/violations` is a new subpath alongside the `./format` one that
exists for the same reason. The built module has no imports at all.

## The eight that carry somebody else's sentence

Eight call sites turn a _finding_ — a payment problem, a UBL fault, a VAT
reconciliation warning — into a violation, and the finding already has its own
message and its own code. Copying those into the catalogue would make two
places to change one sentence.

They use `forwarded()` instead of `violation()`: `messageKey` is null,
`detail.code` is the finding's code, and the UI falls back to the English the
finding wrote. Named rather than an overload, so the exception is visible at
every site that takes it. Translating the finding codes — about forty across
purchase, VAT, ICP and payments — is the remaining work, and it will fix the
screens that show findings directly at the same time.

## A cycle worth the split

`errors.ts` needed the catalogue and the catalogue needed `LedgerErrorCode`, so
`lint:boundaries` refused the pair. `error-codes.ts` now holds the type on its
own, re-exported from `errors.ts` so nothing outside noticed. Rightly refused:
a type has no business dragging a hundred sentences behind it.

## Proof

`e2e/language.spec.ts` posts a journal entry to account 9999 in a Dutch browser
and expects **"Geen rekening 9999."** with no English on the page; switches to
English through the picker, does it again, and expects **"No account 9999."**
The number survives both, because it travels in `detail` rather than baked into
a sentence.

One existing test had recorded the old behaviour — `setup.spec.ts` asserted the
English "A KvK number is eight digits." on a Dutch page. It now asserts the
Dutch, which is the whole point.

## Consequences

- 103 domain sentences, in both languages, with the completeness enforced from
  the catalogue rather than a list somebody maintains.
- A new message in `@klopt/core` fails the build until it has Dutch. Writing
  the English is unavoidable — it is the message — and the Dutch is one line
  next to it.
- `violation()` no longer takes a sentence, so a call site cannot invent one
  that nobody can translate.
- The API gained `messageKey`. A client with its own catalogue can now write
  these sentences in a language we do not ship, from `messageKey` and `detail`.
- Eight violations still forward an English finding message, and about forty
  finding codes are still untranslated. Written down rather than rounded off.
