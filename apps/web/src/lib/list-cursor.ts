/**
 * Moving through a list without a mouse.
 *
 * The koppelscherm proved the shape: a cursor, `j`/`k` or the arrows, `Enter`
 * on the one you are looking at. This is that rule, pulled out of a component
 * so it can be tested by naming a key rather than by driving a browser, and so
 * the next list to earn a keyboard gets the same behaviour rather than a
 * second, slightly different one.
 *
 * Escape leaves the list rather than doing nothing: "Escape abandons the thing
 * you are in" is principle 2 of docs/keyboard-map.md, and a list that traps
 * the keyboard until you reach for the mouse breaks it.
 */

export interface ListCursorState {
  readonly index: number
  readonly count: number
}

export type ListCursorAction =
  | { readonly action: 'move'; readonly index: number }
  | { readonly action: 'open'; readonly index: number }
  | { readonly action: 'leave' }
  | { readonly action: 'ignore' }

/**
 * @param key `KeyboardEvent.key`, as it arrives.
 *
 * A modified key is always ignored: `Cmd+K` is the palette and `Ctrl+Enter`
 * posts an entry, and a list must not take either out from under them.
 */
export function resolveListKey(
  key: string,
  state: ListCursorState,
  modified = false,
): ListCursorAction {
  if (modified) return { action: 'ignore' }
  if (state.count === 0) return key === 'Escape' ? { action: 'leave' } : { action: 'ignore' }

  const last = state.count - 1
  // A cursor that has outlived its row — the list shortened underneath it —
  // moves from the end rather than from nowhere.
  const here = Math.min(Math.max(state.index, 0), last)

  switch (key) {
    case 'j':
    case 'ArrowDown':
      return { action: 'move', index: Math.min(here + 1, last) }
    case 'k':
    case 'ArrowUp':
      return { action: 'move', index: Math.max(here - 1, 0) }
    case 'Home':
      return { action: 'move', index: 0 }
    case 'End':
      return { action: 'move', index: last }
    case 'Enter':
      return { action: 'open', index: here }
    case 'Escape':
      return { action: 'leave' }
    default:
      return { action: 'ignore' }
  }
}
