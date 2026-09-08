# Keyboard map

> "Keyboard-first is a contract, not a nice-to-have. Every list has type-ahead,
> every entry screen submits and creates the next row without touching the
> mouse, and there is a command palette. Write the keyboard map down before
> building the screens."
> — requirements, section 11.3

This is that document. It exists before the screens do, on purpose: a keyboard
map invented one screen at a time is a keyboard map with three different ways
to save.

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
it, and is out until there is a global search to focus. A keyboard map that
documents keys nobody implemented is the thing this document exists to prevent.

## Not yet built

The tables below are the design, not the state of the code. They were written
before the screens on purpose (section 11.3), and the screens have caught up
unevenly: the journal-entry keys are real, the list cursor and the pickers are
partly there, and type-ahead is not. Where the two disagree the registry wins,
because the registry is what runs.

## Lists and tables

| Key                 | Action                                                          |
| ------------------- | --------------------------------------------------------------- |
| `↑` `↓`             | Move the row cursor                                             |
| `←` `→`             | Move the column cursor, when cells are individually addressable |
| `PageUp` `PageDown` | Move by a viewport                                              |
| `Home` `End`        | First / last row                                                |
| `Enter`             | Open the focused row                                            |
| `Space`             | Select the focused row                                          |
| `Shift` `↑`/`↓`     | Extend the selection                                            |
| `Cmd/Ctrl` `A`      | Select every loaded row                                         |
| type any letter     | Type-ahead on the sort column                                   |
| `Cmd/Ctrl` `C`      | Copy the selection as TSV, ready for a spreadsheet              |

Type-ahead searches the column the table is sorted by, which for a chart of
accounts is the account number and for a journal is the entry number. That is
what a bookkeeper expects, because it is what a paper ledger does.

## Journal entry

The screen this whole document exists for.

| Key                        | Action                                            |
| -------------------------- | ------------------------------------------------- |
| `Tab` `Shift`+`Tab`        | Next / previous field                             |
| `Enter`                    | Commit the line and open the next one             |
| `Cmd/Ctrl` `Enter`         | Post the entry                                    |
| `Cmd/Ctrl` `Shift` `Enter` | Post, and start another in the same journal       |
| `Cmd/Ctrl` `D`             | Duplicate the focused line                        |
| `Cmd/Ctrl` `Backspace`     | Delete the focused line                           |
| `Escape`                   | Abandon the draft, after confirming               |
| `=` in an amount           | Fill with the amount that would balance the entry |

`=` is the one non-obvious key and it earns its place: the last line of almost
every manual entry is whatever makes it balance, and typing that number by hand
is both slow and how transposition errors get in.

## Pickers (account, dimension, VAT code)

| Key      | Action                                   |
| -------- | ---------------------------------------- |
| type     | Filter by code, number and name at once  |
| `↑` `↓`  | Move through matches                     |
| `Enter`  | Choose the highlighted match             |
| `Tab`    | Choose the highlighted match and move on |
| `Escape` | Close, keeping what was there before     |

An account picker matches on number **and** name simultaneously: `1300`, `deb`
and `debiteuren` all find Debiteuren. Bookkeepers who have used the same chart
for years type numbers; everyone else types words.

## Amounts

| Key        | Action                                               |
| ---------- | ---------------------------------------------------- |
| `-`        | Toggle the sign, wherever the cursor is in the field |
| `.` or `,` | Decimal separator — both, always                     |
| `Enter`    | Commit                                               |

Dutch keyboards and Dutch habits produce both separators, often in the same
session. Accepting only one is a papercut a hundred times a day.

## What is deliberately not bound

- **Posting without confirmation.** `Cmd`+`Enter` posts, and posting is
  irreversible by design, so it shows what it is about to do.
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
whenever the event came from an input, a select or a textarea.
