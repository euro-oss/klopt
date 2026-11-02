import { createFileRoute, redirect } from '@tanstack/react-router'
import { localTodayIso } from '~/lib/local-clock'
import { pickDefaultVatPeriod, type VatPeriodRow } from '~/lib/vat-screen'
import { listVatPeriods } from '~/server/vat'

/**
 * BTW index — redirects into the period rail + return layout (#132).
 *
 * `/vat` always lands on a concrete `/vat/$period` so the board matches the
 * export (rail + return together). The year search param is kept for deep
 * links that already pointed at a calendar year.
 */
export const Route = createFileRoute('/_app/vat/')({
  validateSearch: (search: Record<string, unknown>): { year?: number } => {
    const year = Number(search['year'])
    return Number.isInteger(year) && year > 1900 && year < 3000 ? { year } : {}
  },
  loaderDeps: ({ search }) => ({ year: search.year }),
  loader: async ({ deps }) => {
    const today = localTodayIso()
    const year = deps.year ?? Number(today.slice(0, 4))
    const current = await listVatPeriods({ data: { year } })
    if (!current.ok) {
      return { problem: current.problem }
    }
    const previous = await listVatPeriods({ data: { year: year - 1 } })
    const periods: VatPeriodRow[] = [
      ...(previous.ok ? previous.data.periods : []),
      ...current.data.periods,
    ]
    const code = pickDefaultVatPeriod(periods, today) ?? current.data.periods[0]?.code
    if (code === undefined) {
      return { problem: null, empty: true as const, year }
    }
    throw redirect({ to: '/vat/$period', params: { period: code } })
  },
  component: VatIndexFallback,
})

function VatIndexFallback() {
  const data = Route.useLoaderData()
  if ('empty' in data && data.empty) {
    return null
  }
  if ('problem' in data && data.problem !== null && data.problem !== undefined) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {data.problem.detail}
      </p>
    )
  }
  return null
}
