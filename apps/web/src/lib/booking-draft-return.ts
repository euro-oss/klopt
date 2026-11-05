const STORAGE_PREFIX = 'klopt_booking_return:'

/** Remember a draft while somebody opens a book year, keyed by the return path. */
export function saveBookingDraft<T>(returnTo: string, draft: T): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.setItem(`${STORAGE_PREFIX}${returnTo}`, JSON.stringify(draft))
}

export function loadBookingDraft<T>(returnTo: string): T | null {
  if (typeof sessionStorage === 'undefined') return null
  const raw = sessionStorage.getItem(`${STORAGE_PREFIX}${returnTo}`)
  if (raw === null) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function clearBookingDraft(returnTo: string): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.removeItem(`${STORAGE_PREFIX}${returnTo}`)
}
