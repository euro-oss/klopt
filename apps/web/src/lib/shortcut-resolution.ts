import { BINDINGS, type Binding } from './keyboard'

/**
 * What a keystroke means, decided without a DOM.
 *
 * The listener that calls this is four lines of `addEventListener`; everything
 * worth being sure about — the prefix window, what fires while somebody is
 * typing, which keys get swallowed — is here, where it can be tested by naming
 * a key rather than by simulating a browser.
 *
 * Same split as everywhere else in this codebase: the decision is pure and the
 * IO is thin.
 */

/**
 * The bindings resolvable from anywhere.
 *
 * A binding with a `to` is navigation. `palette` and `help` are the two global
 * overlays. Everything else belongs to the screen that owns it — `entry.post`
 * cannot be run from a palette floating over the balance sheet, and a global
 * listener that fired `Enter` would fight every form on every page.
 */
export const GLOBAL_BINDINGS: readonly Binding[] = BINDINGS.filter(
  (binding) => binding.to !== undefined || binding.id === 'palette' || binding.id === 'help',
)

/** The distinct first keys of every two-key binding: `g` and `n`. */
export const PREFIXES: readonly string[] = [
  ...new Set(
    GLOBAL_BINDINGS.filter((binding) => binding.keys.includes(' ')).map(
      (binding) => binding.keys.split(' ')[0]!,
    ),
  ),
]

export interface Keystroke {
  /** Already lowercased. */
  readonly key: string
  readonly hasModifier: boolean
  readonly shiftKey: boolean
  /** True when the cursor is in an input, textarea, select or contenteditable. */
  readonly typing: boolean
}

export type Resolution =
  /** Nothing to do. Let the key through to whatever else wants it. */
  | { readonly action: 'ignore' }
  /** Arm a prefix and wait for the second key. */
  | { readonly action: 'arm'; readonly prefix: string }
  /** Drop the armed prefix. Nothing fires. */
  | { readonly action: 'clear' }
  /**
   * Take the key and do nothing with it — the second half of a prefix that
   * matched no binding. Swallowed rather than passed on, because the user was
   * mid-shortcut and letting `g` then `1` reach the koppelscherm would book a
   * match nobody asked for.
   */
  | { readonly action: 'swallow' }
  | { readonly action: 'trigger'; readonly binding: Binding }

export function resolveKeystroke(stroke: Keystroke, armed: string | null): Resolution {
  if (stroke.key === 'escape') {
    // Only when a prefix is armed. Otherwise Escape belongs to whatever overlay
    // or edit the user is in — principle 2: escape abandons the thing you are
    // in, and a half-typed shortcut is a thing you are in.
    return armed === null ? { action: 'ignore' } : { action: 'clear' }
  }

  if (stroke.hasModifier) {
    // A modifier combination fires wherever the cursor is: `Cmd`+`K` in a text
    // field is unambiguous and every application the user knows behaves that
    // way. A prefix cannot survive one.
    const binding = GLOBAL_BINDINGS.find(
      (entry) =>
        !entry.keys.includes(' ') &&
        (entry.modifiers?.includes('mod') ?? false) &&
        (entry.modifiers?.includes('shift') ?? false) === stroke.shiftKey &&
        entry.keys === stroke.key,
    )
    return binding === undefined ? { action: 'ignore' } : { action: 'trigger', binding }
  }

  // A bare letter never fires while somebody is typing. This is the difference
  // between `g` navigating and `g` being the first letter of "grootboek" in a
  // description field.
  if (stroke.typing) return { action: 'ignore' }

  if (armed !== null) {
    const binding = GLOBAL_BINDINGS.find((entry) => entry.keys === `${armed} ${stroke.key}`)
    return binding === undefined ? { action: 'swallow' } : { action: 'trigger', binding }
  }

  if (PREFIXES.includes(stroke.key)) return { action: 'arm', prefix: stroke.key }

  const binding = GLOBAL_BINDINGS.find(
    (entry) =>
      !entry.keys.includes(' ') && entry.modifiers === undefined && entry.keys === stroke.key,
  )
  return binding === undefined ? { action: 'ignore' } : { action: 'trigger', binding }
}
