const ISO = /^(\d{4})-(\d{2})-(\d{2})$/

/** True when `iso` is a real Gregorian calendar date (not merely digit-shaped). */
export function isValidCalendarIsoDate(iso: string): boolean {
  const match = ISO.exec(iso)
  if (match === null) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const probe = new Date(Date.UTC(year, month - 1, day))
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  )
}

export function parseCalendarIsoDate(raw: string | null | undefined): string | undefined {
  const trimmed = raw?.trim()
  if (trimmed === undefined || trimmed === '') return undefined
  if (!ISO.test(trimmed)) return undefined
  return isValidCalendarIsoDate(trimmed) ? trimmed : undefined
}
