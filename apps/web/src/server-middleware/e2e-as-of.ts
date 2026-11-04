/**
 * Playwright calendar tests send `X-Klopt-E2e-As-Of: YYYY-MM-DD` so loaders
 * and `localTodayIso()` match `page.clock` (see e2e/support/contacts-overdue-fixture-dates.ts).
 * Active only when `KLOPT_E2E_LEGAL_TOGGLE=1` (same gate as legal fixture URLs).
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/

export default function e2eAsOfMiddleware(event: {
  req: { headers: { get(name: string): string | null } }
}): void {
  if (process.env['KLOPT_E2E_LEGAL_TOGGLE'] !== '1') return
  if (process.env['NODE_ENV'] === 'production') return
  const raw = event.req.headers.get('x-klopt-e2e-as-of')?.trim()
  if (raw !== undefined && raw !== '' && ISO.test(raw)) {
    process.env['KLOPT_E2E_TODAY_ISO'] = raw
    return
  }
  delete process.env['KLOPT_E2E_TODAY_ISO']
}
