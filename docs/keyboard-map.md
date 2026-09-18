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
| `n` then `i`   | New inkoopfactuur                                       |
| `n` then `j`   | New journal entry                                       |
| `Escape`       | Close overlay, cancel edit, clear focus — in that order |

`g` and `n` are prefixes, following the convention people already know from
GitHub and Linear. A prefix times out after 1.5 seconds.

Everything in this table is wired to `apps/web/src/lib/keyboard.ts`, which is
the registry the palette and the `?` sheet are generated from. That is what
principle 5 means in practice: a binding that is not in the registry does not
appear anywhere, and one that is appears everywhere.

`/` for "focus search" was in this table for two milestones with nothing behind
it, and stays out until there is a global search to focus — see "What is
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
- **`/` for "focus search".** In this document for two milestones with nothing
  behind it, and out until there is a global search to focus (#6). A map that
  documents keys nobody implemented is the thing this document exists to prevent.
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

The bank matching queue is keyboard-first, because the work is repetitive and
the whole value is rhythm: a hundred lines should be a hundred keystrokes, not a
hundred round trips through a mouse.

| Key     | Does                          |
| ------- | ----------------------------- |
| `↑` `k` | Previous line                 |
| `↓` `j` | Next line                     |
| `↵`     | Book the best suggestion      |
| `1`–`9` | Book that suggestion          |
| `x`     | Skip: deliberately not booked |

The handler is bound on the window rather than on a focused element — the hands
never leave the keys, so there is nothing to focus first — and it stands down
whenever the event came from an input, a select or a textarea. It also stands
down on `Enter` and `Space` when a button or a link has the focus: somebody who
tabbed to "Boeken" means that button, not the best suggestion.

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

## Moving between screens

A navigation moves the focus onto the screen it opened. In a single-page
application nothing does that by itself: the old screen is replaced and the focus
stays on whatever opened it, or lands on `<body>` when that control went with the
screen — and the next `Tab` then starts at the top of the window. So `AppShell`
focuses `<main>` on every route change, which is what a browser does for a real
page load, and `Escape` from a dialog puts the focus back where it was rather
than nowhere.
