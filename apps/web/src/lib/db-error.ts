/**
 * Walk a thrown value (and its `cause` chain) for a Postgres unique_violation.
 *
 * Drizzle / postgres.js wrap the driver error; the SQLSTATE `23505` is what we
 * branch on when two concurrent POSTs race the same tax-code insert.
 */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 6 && current !== null && typeof current === 'object'; depth += 1) {
    const code = (current as { code?: unknown }).code
    if (code === '23505') return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}
