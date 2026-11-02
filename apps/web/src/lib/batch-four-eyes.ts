/**
 * Four-eyes status line for a PaymentBatch actor.
 *
 * The API returns user IDs only. When we have a display name (or own email),
 * show "Ingediend door {who}" / "Goedgekeurd door {who}". Otherwise show the
 * nameless form — never a literal "…" (PM #175).
 */
export function batchFourEyesLine(options: {
  readonly done: boolean
  readonly who: string | null
  readonly notYet: string
  readonly withWho: string
  readonly withoutWho: string
}): string {
  if (!options.done) return options.notYet
  const who = options.who?.trim() ?? ''
  return who !== '' ? options.withWho : options.withoutWho
}
