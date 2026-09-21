/**
 * The list keyboard from docs/keyboard-map.md, decided without a DOM.
 *
 * `~/lib/list-cursor` is the four keys two lists share — a cursor, `Enter`,
 * `Escape`. A ledger table asks for more than that: a selection, every loaded
 * row at once, type-ahead, and a copy that lands in a spreadsheet with its
 * columns intact. "Get this into Excel" is a daily move, and the answer used to
 * be a mouse drag.
 *
 * Same split as the rest of the keyboard: what a key *means* is a pure function
 * tested by naming keys, and the component is the listener and the focus.
 */

export interface TableCursorState {
  readonly index: number
  readonly count: number
  /** Rows `PageUp`/`PageDown` move by. */
  readonly page: number
}

export interface TableKeystroke {
  /** `KeyboardEvent.key`, as it arrives. */
  readonly key: string
  /** `Cmd` on a Mac and `Ctrl` elsewhere, resolved by the caller. */
  readonly modKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
}

export type TableAction =
  /** Move the cursor. `extend` means `Shift` was held: grow the selection with it. */
  | { readonly action: 'move'; readonly index: number; readonly extend: boolean }
  | { readonly action: 'open'; readonly index: number }
  /** `Space`: select or deselect the row the cursor is on. */
  | { readonly action: 'toggle'; readonly index: number }
  | { readonly action: 'selectAll' }
  | { readonly action: 'copy' }
  /** A printable character: jump to the first row that starts with what has been typed. */
  | { readonly action: 'typeAhead'; readonly character: string }
  /** `Escape`: drop the selection and give the global keys back. */
  | { readonly action: 'leave' }
  | { readonly action: 'ignore' }

/**
 * How long a type-ahead fragment lives.
 *
 * Shorter than the `g`-prefix window, because this is typing rather than a
 * two-key shortcut: `14` has to mean one fragment and `1`, four seconds later,
 * has to mean a fresh one.
 */
export const TYPE_AHEAD_TIMEOUT_MS = 1_000

export function resolveTableKey(stroke: TableKeystroke, state: TableCursorState): TableAction {
  // `Alt` combinations belong to the browser and the operating system. Taking
  // one is how a table breaks somebody's window manager.
  if (stroke.altKey) return { action: 'ignore' }

  if (stroke.modKey) {
    const key = stroke.key.toLowerCase()
    if (key === 'a' && state.count > 0) return { action: 'selectAll' }
    if (key === 'c') return { action: 'copy' }
    // Everything else modified is somebody else's: `Cmd`+`K` is the palette and
    // `Cmd`+`Enter` posts an entry.
    return { action: 'ignore' }
  }

  if (state.count === 0) return stroke.key === 'Escape' ? { action: 'leave' } : { action: 'ignore' }

  const last = state.count - 1
  // A cursor that has outlived its row — the list shortened underneath it —
  // moves from the end rather than from nowhere.
  const here = Math.min(Math.max(state.index, 0), last)
  const extend = stroke.shiftKey
  const step = Math.max(1, state.page)

  switch (stroke.key) {
    case 'ArrowDown':
      return { action: 'move', index: Math.min(here + 1, last), extend }
    case 'ArrowUp':
      return { action: 'move', index: Math.max(here - 1, 0), extend }
    // `j`/`k` are what the koppelscherm and the werklijst already move on, so
    // they move here too. The cost is that lower-case `j` and `k` cannot be
    // typed at the list — `Shift`+`K` can, and finds Kantoorkosten.
    case 'j':
      return { action: 'move', index: Math.min(here + 1, last), extend: false }
    case 'k':
      return { action: 'move', index: Math.max(here - 1, 0), extend: false }
    case 'PageDown':
      return { action: 'move', index: Math.min(here + step, last), extend }
    case 'PageUp':
      return { action: 'move', index: Math.max(here - step, 0), extend }
    case 'Home':
      return { action: 'move', index: 0, extend }
    case 'End':
      return { action: 'move', index: last, extend }
    case 'Enter':
      return { action: 'open', index: here }
    case ' ':
      return { action: 'toggle', index: here }
    case 'Escape':
      return { action: 'leave' }
    default:
      break
  }

  // One character and no modifier is somebody typing at the list. A capital
  // arrives here rather than at the cursor, which is what makes `Shift`+`K` a
  // way to reach an account whose name starts with the letter the cursor took.
  if (stroke.key.length === 1) return { action: 'typeAhead', character: stroke.key }

  return { action: 'ignore' }
}

export interface TypeAhead {
  readonly buffer: string
  /** When the last character arrived, from `Date.now()`. */
  readonly at: number
}

/**
 * The fragment after one more character.
 *
 * A pause longer than the window starts a fresh fragment rather than adding to
 * a stale one: `14` typed quickly is one search, and `1` four seconds later is
 * another.
 */
export function nextTypeAhead(previous: TypeAhead, character: string, now: number): TypeAhead {
  const stale = now - previous.at > TYPE_AHEAD_TIMEOUT_MS
  return { buffer: stale ? character : previous.buffer + character, at: now }
}

/**
 * The row a type-ahead fragment means, or nothing.
 *
 * Prefix matching on the column the table is sorted by, which for a chart of
 * accounts is the number and for a journal the entry number — what a paper
 * ledger does, and what a bookkeeper expects.
 *
 * A single character searches *after* the cursor and wraps, so pressing it
 * again walks through the rows that start with it. A longer fragment searches
 * from the cursor, so the row found by `1` stays found when `4` arrives.
 */
export function typeAheadTarget(
  texts: readonly string[],
  buffer: string,
  from: number,
): number | null {
  const needle = buffer.trim().toLowerCase()
  if (needle === '' || texts.length === 0) return null

  const start = needle.length === 1 ? from + 1 : from

  for (let step = 0; step < texts.length; step += 1) {
    const index = (((start + step) % texts.length) + texts.length) % texts.length
    if ((texts[index] ?? '').trim().toLowerCase().startsWith(needle)) return index
  }

  return null
}

/**
 * The rows as a spreadsheet would read them.
 *
 * Tab-separated because that is what a paste into Excel, LibreOffice and
 * Sheets understands without a dialogue asking about delimiters. A cell's own
 * whitespace is collapsed rather than quoted: TSV has no quoting convention,
 * so a tab inside a cell is not an escaped tab, it is a new column and a
 * silently shifted row.
 */
export function toTsv(rows: readonly (readonly string[])[]): string {
  return rows.map((cells) => cells.map(flatten).join('\t')).join('\n')
}

function flatten(cell: string): string {
  return cell.replace(/\s+/gu, ' ').trim()
}
