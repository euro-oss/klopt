/**
 * The two rules the journaalpost form needs decided away from the DOM.
 *
 * One is a keyboard question — when `Cmd`+`Backspace` belongs to the line and
 * when it belongs to the text somebody is halfway through typing. The other is
 * a guard: what makes a draft postable at all, so that the shortcut and the
 * button agree about it and neither can post an entry the ledger would refuse.
 */

export interface EditingField {
  /** True for an input or a textarea: somewhere the browser edits text. */
  readonly editable: boolean
  readonly value: string
  readonly selectionStart: number | null
  readonly selectionEnd: number | null
}

/**
 * Whether `Cmd`/`Ctrl`+`Backspace` should remove the line.
 *
 * The map's modifier rule is that a modified key fires wherever the cursor is,
 * and this is the one place that would cost somebody their typing: in a text
 * field `Cmd`+`Backspace` deletes to the start of the line on a Mac and a word
 * back everywhere else, which is exactly what a bookkeeper mid-amount means by
 * it. So the line takes the key only where the browser would do nothing with
 * it — an empty field, a caret at the very start, or focus that is not in a
 * field at all. Pressed twice, it clears the field and then removes the line,
 * which is both useful and impossible to do by accident.
 */
export function deleteLineIsOurs(field: EditingField): boolean {
  if (!field.editable) return true
  if (field.value === '') return true
  return field.selectionStart === 0 && field.selectionEnd === 0
}

export interface DraftEntry {
  /** Lines with an account chosen. The empty ones at the bottom do not count. */
  readonly lineCount: number
  /** Debit minus credit, in minor units. */
  readonly difference: bigint
  readonly description: string
  readonly journalCode: string
}

export type NotPostable = 'lines' | 'balance' | 'description' | 'journal'

/**
 * Why this draft cannot be posted, or nothing.
 *
 * Checked before the confirmation rather than after it, because a confirmation
 * that shows an entry which is then refused has asked somebody to approve
 * something that was never going to happen. The order is the order a form is
 * filled in, so the first thing missing is the first thing said.
 */
export function whyNotPostable(draft: DraftEntry): NotPostable | null {
  if (draft.journalCode === '') return 'journal'
  if (draft.description.trim() === '') return 'description'
  if (draft.lineCount < 2) return 'lines'
  if (draft.difference !== 0n) return 'balance'
  return null
}
