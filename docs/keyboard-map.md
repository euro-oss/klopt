# Keyboard map

> "Keyboard-first is a contract, not a nice-to-have. Every list has type-ahead,
> every entry screen submits and creates the next row without touching the
> mouse, and there is a command palette. Write the keyboard map down before
> building the screens."
> — requirements, section 11.3

This is that document. It existed before the screens did, on purpose: a keyboard
map invented one screen at a time is a keyboard map with three different ways to
save. The screens have caught up with it — where a key below is deliberately
unbound, it says so where the key would be.

Bookkeepers work by keyboard all day. Exact loses on this, and it is the single
most noticeable thing about using a bookkeeping system for eight hours.

## Principles

1. **Nothing requires the mouse.** Every action reachable by clicking is
   reachable by typing. Where the two disagree, the keyboard wins.
2. **The same key does the same thing everywhere.** `Enter` commits the thing
   you are in. `Escape` abandons it. There is no screen where `Enter` means
   something else.
3. **Entry never breaks flow.** Saving a line puts you on the next one. Saving
   an entry puts you on a new entry, in the same journal, with the date carried
   forward.
4. **Destructive actions have no shortcut.** There is no key that posts without
   confirmation and none that reverses an entry. Reversal is a deliberate act.
5. **Shortcuts are discoverable.** Every one appears in the command palette with
   its key, and `?` shows this map.

## Global

| Key            | Action                                                  |
| -------------- | ------------------------------------------------------- |
| `Cmd/Ctrl` `K` | Command palette                                         |
| `?`            | Keyboard help                                           |
| `g` then `d`   | Go to dashboard                                         |
| `g` then `j`   | Go to journal entries                                   |
| `g` then `a`   | Go to chart of accounts                                 |
| `g` then `b`   | Go to balance sheet                                     |
| `g` then `w`   | Go to winst- en verliesrekening                         |
| `g` then `p`   | Go to proefbalans (trial balance)                       |
| `g` then `g`   | Go to BTW-aangifte (aan**g**ifte)                       |
| `g` then `n`   | Go to inkoopfacturen (i**n**koop)                       |
| `g` then `e`   | Go to postvak (**e**erste opvang)                       |
| `g` then `l`   | Go to wie wat deed (het **l**og)                        |
| `g` then `h`   | Go to bewaarplicht (be**h**ouden)                       |
| `g` then `z`   | Go to momentopnames (het **z**egel)                     |
| `g` then `x`   | Go to Exact Online (E**x**act)                          |
| `g` then `v`   | Go to ouderdomsanalyse debiteuren (**v**orderingen)     |
| `g` then `c`   | Go to ouderdomsanalyse crediteuren (**c**rediteuren)    |
| `g` then `s`   | Go to boekjaren (**s**luiten)                           |
| `g` then `q`   | Go to de auditfile                                      |
| `n` then `i`   | New inkoopfactuur                                       |
| `n` then `j`   | New journal entry                                       |
| `Escape`       | Close overlay, cancel edit, clear focus — in that order |

`g` and `n` are prefixes, following the convention people already know from
GitHub and Linear. A prefix times out after 1.5 seconds.

Everything in this table is wired to `apps/web/src/lib/keyboard.ts`, which is
the registry the palette and the `?` sheet are generated from. That is what
principle 5 means in practice: a binding that is not in the registry does not
appear anywhere, and one that is appears everywhere.

`g q` is the one binding here with no mnemonic, and is not pretending to have
one: every letter in _auditfile_ was taken by the time the screen arrived. The
palette prints the key beside the label, which is what makes that survivable.

**The `g` alphabet is full.** Twenty-six destinations, twenty-six letters, and
Alpha 3 took the last two. The next screen that wants a key needs a second prefix
or a different scheme rather than a letter somebody else is using.
`test/unit/shortcuts.test.ts` asserts the alphabet is exhausted, so that decision
arrives as a failing test rather than as a collision.

`/` for "focus search" was in this table for three milestones with nothing behind
it. There is a global search now — it lives in the palette, where `Cmd/Ctrl` `K`
already puts the cursor in a field — and `/` stays out anyway. See "What is
deliberately not bound" below.

## What is built, and what is not

This document used to say the tables below were "the design, not the state of
the code". They are the state of the code now: the list keyboard, the account
picker and the journal-entry keys all do what is written here. Where anything is
deliberately unbound it says so, in place, rather than leaving a reader to
discover it by pressing the key.

Where the tables and the registry disagree the registry wins, because the
registry is what runs — and `apps/web/e2e/keyboard.spec.ts` is what stops them
disagreeing quietly.

## Lists and tables

Every table built from `LedgerTable`, which is every list in the application.

| Key                 | Action                                             |
| ------------------- | -------------------------------------------------- |
| `↑` `↓` or `j` `k`  | Move the row cursor                                |
| `PageUp` `PageDown` | Move by a screenful                                |
| `Home` `End`        | First / last row                                   |
| `Enter`             | Open the focused row, where a row opens onto       |
| `Space`             | Select the focused row                             |
| `Shift` `↑`/`↓`     | Extend the selection                               |
| `Cmd/Ctrl` `A`      | Select every loaded row                            |
| type any character  | Type-ahead on the sort column                      |
| `Cmd/Ctrl` `C`      | Copy the selection as TSV, ready for a spreadsheet |
| `Escape`            | Drop the selection and leave the list              |

Type-ahead searches the column the table is sorted by, which for a chart of
accounts is the account number and for a journal is the entry number. That is
what a bookkeeper expects, because it is what a paper ledger does. `j` and `k`
belong to the cursor, so they never reach type-ahead; `Shift`+`K` does, which is
how Kantoorkosten is still one keystroke away.

One row is in the tab order at a time — the one the cursor is on — so a table of
four hundred rows is one `Tab` to enter and one `Tab` to leave. The cursor is a
row rather than a position, so a list that grows underneath it does not drag it
back to the top.

`Cmd/Ctrl`+`C` copies what the table shows, read out of the cells: the header
row, then a row per selected row, tab-separated. With nothing selected it copies
the row the cursor is on. What is copied is what was on screen, formatted for
the reader's language, because the destination is a spreadsheet somebody is
about to look at rather than a data feed.

**Not bound:** `←` `→` for a column cursor. No table in this application
addresses individual cells yet, and a key that moves an invisible cursor is
worse than no key.

## Journal entry

The screen this whole document exists for.

| Key                        | Action                                            |
| -------------------------- | ------------------------------------------------- |
| `Tab` `Shift`+`Tab`        | Next / previous field                             |
| `Enter` in an amount       | Commit the line and open the next one             |
| `Cmd/Ctrl` `Enter`         | Show what will be posted; again, post it          |
| `Cmd/Ctrl` `Shift` `Enter` | The same, and start another in the same journal   |
| `Cmd/Ctrl` `D`             | Duplicate the focused line                        |
| `Cmd/Ctrl` `Backspace`     | Delete the focused line                           |
| `Escape`                   | Close the confirmation, back to the draft         |
| `=` in an amount           | Fill with the amount that would balance the entry |

`=` is the one non-obvious key and it earns its place: the last line of almost
every manual entry is whatever makes it balance, and typing that number by hand
is both slow and how transposition errors get in.

`Cmd`+`Enter` does not post on its own, and that is principle 4 rather than an
omission: it shows the dagboek, the date, the line count and the total, with the
cursor already on the button that posts, so the second press is the confirmation.
An entry that does not balance, has no description or has fewer than two lines
with an account says so instead — the same check the button goes through, so
there is one answer to "can this be posted" rather than two.

`Cmd`+`Backspace` takes the line only where the browser would not have done
something with the key: an empty field, a caret at the very start, or focus
outside a field. In a half-typed amount it clears the field, which is what it
means everywhere else; pressed again on the now-empty field, it removes the line.
The form never drops below two rows, because an entry has two sides.

## Pickers (account, dimension, VAT code)

| Key          | Action                                             |
| ------------ | -------------------------------------------------- |
| type         | Filter by code, number and name at once            |
| `↑` `↓`      | Move through matches                               |
| `Home` `End` | First / last match                                 |
| `Enter`      | Choose the highlighted match                       |
| `Tab`        | Choose the highlighted match and move on           |
| `Escape`     | Close, keeping what was there before               |
| first `⌫`    | Empty the field, rather than editing what is in it |

An account picker matches on number **and** name simultaneously: `1300`, `deb`
and `debiteuren` all find Debiteuren. Bookkeepers who have used the same chart
for years type numbers; everyone else types words.

The account picker is `AccountPicker`, used by every screen that asks for an
account. It is a combobox, not a menu: the list opens on focus, so a field
reached with `Tab` can be typed at without a click, and the first character typed
at an account already chosen replaces it rather than editing its digits.

A blocked account is listed and marked, and neither `Enter` nor a click takes it:
the ledger refuses to post to one, and a picker that offers it moves the refusal
from the field to the end of the form. A number no account answers to is kept as
typed and flagged under the field — nothing somebody typed is silently replaced,
and nothing invalid is silently accepted.

The dimension and VAT-code pickers are still `Select`s over short lists. They
follow this table through Radix's own combobox keyboard; a type-ahead over a
list of eight VAT codes is not worth a second control.

## Amounts

| Key        | Action                                               |
| ---------- | ---------------------------------------------------- |
| `-`        | Toggle the sign, wherever the cursor is in the field |
| `.` or `,` | Decimal separator — both, always                     |
| `Enter`    | Commit                                               |

Dutch keyboards and Dutch habits produce both separators, often in the same
session. Accepting only one is a papercut a hundred times a day.

## What is deliberately not bound

- **Posting without confirmation.** `Cmd`+`Enter` shows what it is about to post
  and puts the cursor on the button that posts it. Posting is irreversible by
  design, so the key that does it asks — twice deliberate, still no mouse.
- **`/` for "focus search".** In this document for three milestones with nothing
  behind it, and still out now that there is something. Search lives in the
  palette (#6): `Cmd/Ctrl`+`K` opens it with the cursor already in the field, so
  `/` would be a second key meaning "open the thing `Cmd`+`K` opens", aimed at a
  field that only exists inside a dialogue this key would have to open first.
  One way in, and it is the one that was already there.
- **A column cursor in tables.** `←` `→` are unbound because no table addresses
  individual cells.
- **Remapping.** One keyboard, the same on every installation. A remappable one
  is a second feature and a second support surface.
- **Reversing an entry.** Corrections are reversals and a reversal is a real
  accounting act. It is a button, and it asks.
- **Closing a year.** Same reasoning, more so.
- **Deleting anything.** There is nothing to delete. The journal is append-only.

## Implementation notes

- Bindings live in one module, `apps/web/src/lib/keyboard.ts`, and screens
  declare intent rather than keys. A screen that hard-codes `event.key === 'k'`
  is a bug.
- Every binding registered with the command palette is therefore documented
  automatically. If it is not in the palette, it does not exist.
- Radix primitives underneath shadcn/ui already give correct focus management,
  roving tabindex and screen-reader behaviour. Do not reimplement them; the
  WCAG 2.2 AA target in section 12 depends on them.
- `Cmd` on macOS, `Ctrl` elsewhere, resolved in one place.

## Koppelen

The bank matching queue is keyboard-first, because the work is repetitive and the
whole value is rhythm. Four keys, and the rhythm is two presses per line rather
than one: open the panel, then confirm the candidate it is pointing at.

| Key      | Does                                                                         |
| -------- | ---------------------------------------------------------------------------- |
| `↑` `k`  | Previous — line in the queue, candidate in the panel                         |
| `↓` `j`  | Next — line in the queue, candidate in the panel                             |
| `↵`      | From the queue: open the panel. In the panel: book the highlighted candidate |
| `u`      | Drop the choice the panel is holding                                         |
| `Escape` | Close the panel, back to the list                                            |

Two panes and two cursors, scoped by where the focus is, so `j`/`k` mean "next
thing in the pane I am in" on both sides of the screen.

**`↵` no longer books the top suggestion from the queue, and that is deliberate**
(Alpha 4 oracle, product decision). It used to: one keystroke, and the line being
agreed to was off to the side of the key being pressed. Section 7.4 asks for "a
one-keystroke confirm" and this is one keystroke to confirm — the press before it
is what aims it, and it posts nothing.

**`1`–`9` and `x` are gone.** A digit booked a suggestion the eye had not settled
on, and `x` skipped a line as cheaply as `Enter` booked one. Skipping is a button
now, reachable with `Tab` like any other, which is what a deliberate "not this
one" should cost. Neither key is bound, printed or listed, because a key that is
half-there is the thing this document exists to prevent.

**`u` drops a pending choice, and does not unmatch a booked one.** The board asks
for "unmatch"; on a queue of lines that have not been booked yet, the only thing
there is to undo is the choice in the panel, and that is what `u` does. Undoing a
_booked_ match is a reversal — the entry is posted and the journal is append-only
— and principle 4 keeps a reversal as a button that asks. There is also no
unmatch operation in `/api/v1` to call. This is the one place the map and the
board disagree, and the reason is in the ledger rather than in the keyboard.

The handler is bound on the window rather than on a focused element — the hands
never leave the keys, so there is nothing to focus first — and it stands down
whenever the event came from an input, a select or a textarea. It also stands
down on `Enter` and `Space` when a button or a link has the focus: somebody who
tabbed to "Boeken" means that button.

## De werklijst op het dashboard

The dashboard queue — what is waiting, in the order the day is worked — is the
second list with a real keyboard, and it uses the same four keys as koppelen so
that the two do not have to be learned separately.

| Key     | Does                                        |
| ------- | ------------------------------------------- |
| `↑` `k` | Previous row                                |
| `↓` `j` | Next row                                    |
| `↵`     | Open the screen where that work is done     |
| `Esc`   | Leave the list, giving the global keys back |

Focus lands on the first row as soon as the keyboard is live, so the
application opens with the hands already on the work.

Unlike koppelen, the handler is on the list rather than on the window: these
are links, the cursor is real focus with a roving `tabindex`, and `Enter` is
the browser's own — intercepting it would navigate twice for one keystroke.
Which key means what is decided in `apps/web/src/lib/list-cursor.ts`, so the
rule is tested by naming keys. The fuller list keyboard — type-ahead, selection,
TSV copy — lives in `apps/web/src/lib/table-keyboard.ts` and serves the tables;
the queue is four keys on purpose, because there is nothing here to copy.

## Het postvak

The third list with a real keyboard, and the last screen of the
invoice → koppelen → postvak spine. Same four keys as the other two, plus the two
that are this screen's own work.

| Key      | Does                                                      |
| -------- | --------------------------------------------------------- |
| `↑` `k`  | Previous document                                         |
| `↓` `j`  | Next document                                             |
| `↵`      | Open the document, or close it again                      |
| `a`      | Make the draft: once to show the coding, again to book it |
| `s`      | Set aside, with the reason field focused                  |
| `Escape` | Close the panel, then leave the list                      |

`a` twice rather than once on purpose: what is being approved is the coding, so
the first press shows it and the second submits the panel that shows it. A
document nothing could be read out of says so instead of doing nothing.

`s` opens a field rather than a browser `prompt()`. A blocking dialogue the
screen does not own cannot be escaped back to the card, and in the middle of a
keyboard flow it is a stop rather than a step.

## Verkoopfacturen

| Key               | Does                                                  |
| ----------------- | ----------------------------------------------------- |
| `n` then `f`      | New invoice, from anywhere                            |
| `↑` `↓` / `j` `k` | The list cursor, as in every table                    |
| `↵` on the list   | Open the invoice the cursor is on                     |
| `Cmd/Ctrl` `↵`    | In the form: show what will be saved; again, save it  |
| `Escape`          | In the form: leave, or twice to throw a draft away    |
| `Cmd/Ctrl` `↵`    | On a draft: show what will be issued; again, issue it |

The bare `n` on the board is `n` then `f` here, because `n` is a prefix in this
application and a screen that claimed it would be claiming a key the global
handler takes first.

In the form, `Enter` in a field does **not** save: "Enter on primary save, not
mid-field" — a form that submits from the middle of an amount saves what somebody
was still typing. The button saves without asking, because a click on
"Concept opslaan" is the confirmation; the keystroke asks, because a key that
writes without showing what it writes is what principle 4 is about. Issuing asks
either way: it takes a number out of a gapless series and posts an entry.

## Where the keys are printed

Four places, all generated from the registry:

- **A strip along the bottom of the pane the keys work in** — under the list, and
  again under the panel that acts on a row of it. Yellow outline, because the
  accent marks where the keyboard is.
- **A panel in the corner** with the screen's whole keyboard, on the screens the
  Alpha 4 boards draw it on: het postvak, de koppelwachtrij, de journaalpost and
  de nieuwe factuur. Hidden on a narrow window, where it would sit on top of the
  thing it describes.
- **In the sidebar**, next to every destination. Printed rather than revealed on
  hover: a keyboard user never hovers.
- **In the `?` sheet and the palette**, as the same caps.

A screen declares binding **ids**, never keys, so it cannot print a key it has
not registered and cannot print one that has since changed. The panes are
numbered — `1 · POSTVAK`, `2 · NAKIJKEN` — because the spine is a sequence, and a
reader should be able to see which half the keyboard is in without pressing
anything.

**Not printed, and not bound: `/` to focus a list filter.** The boards show a
search box above the invoice list with `/` focusing it. There is no filter field
on that list, and inventing one here would be inventing a feature rather than a
key. Searching the books is a palette job (see below), not a per-list one.

## Zoeken in het palet

`Cmd/Ctrl`+`K` opens two halves, and the arrows walk them as one list.

| Key            | Action                                                                        |
| -------------- | ----------------------------------------------------------------------------- |
| `Cmd/Ctrl` `K` | Open the palette, cursor in the field                                         |
| type           | Filter **Navigatie** as you type; search **Inhoud** from the second character |
| `↑` `↓`        | Move through both halves in order                                             |
| `Enter`        | Open the screen, or the record                                                |
| `Escape`       | Close, changing nothing                                                       |

Navigatie is the registry, filtered in memory on every keystroke. Inhoud is
`GET /search` across relaties, verkoop- en inkoopfacturen, journaalposten and
documenten, asked once the typing settles — two characters is what the operation
requires, so one character searches the navigation and nothing else.

`Enter` on a hit opens the **screen that shows the record**, which is not the API
path the hit carries: `~/lib/palette-search` decides which, and a document — which
has no screen of its own — opens as the file, the way het postvak opens one.

## Moving between screens

A navigation moves the focus onto the screen it opened. In a single-page
application nothing does that by itself: the old screen is replaced and the focus
stays on whatever opened it, or lands on `<body>` when that control went with the
screen — and the next `Tab` then starts at the top of the window. So `AppShell`
focuses `<main>` on every route change, which is what a browser does for a real
page load, and `Escape` from a dialog puts the focus back where it was rather
than nowhere.
