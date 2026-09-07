import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { PageHeader, Stat } from '~/components/app-shell'
import { LedgerTable, type Column } from '~/components/finance/ledger-table'
import { Money } from '~/components/finance/money'
import { formatDate } from '~/lib/format'
import { useHydrated } from '~/lib/hydration'
import { listVatPeriods } from '~/server/vat'

/**
 * BTW — the declaration periods of a year.
 *
 * The list is the year's calendar, not a list of things that have been done:
 * an aangifte that has not been filed is the one worth seeing, so an empty
 * period is a row with a deadline rather than an absence.
 */
export const Route = createFileRoute('/_app/vat/')({
  validateSearch: (search: Record<string, unknown>): { year?: number } => {
    const year = Number(search['year'])
    return Number.isInteger(year) && year > 1900 && year < 3000 ? { year } : {}
  },
  loaderDeps: ({ search }) => ({ year: search.year }),
  loader: async ({ deps }) => ({
    year: deps.year ?? new Date().getUTCFullYear(),
    periods: await listVatPeriods({ data: { year: deps.year ?? new Date().getUTCFullYear() } }),
  }),
  component: VatPeriods,
})

interface Row {
  code: string
  label: string
  from: string
  to: string
  deadline: string
  filed: boolean
  sequence: number
  filedAt: string | null
  payable: string | null
}

const KIND_LABEL: Record<string, string> = {
  monthly: 'per maand',
  quarterly: 'per kwartaal',
  annual: 'per jaar',
}

function VatPeriods() {
  const { periods, year } = Route.useLoaderData()
  const navigate = useNavigate()
  const hydrated = useHydrated()

  if (!periods.ok) {
    return (
      <>
        <PageHeader title="BTW" />
        <p role="alert" className="text-destructive text-sm">
          {periods.problem.detail}
        </p>
      </>
    )
  }

  const rows = periods.data.periods
  const today = new Date().toISOString().slice(0, 10)
  const overdue = rows.filter((row) => !row.filed && row.deadline < today)

  const columns: readonly Column<Row>[] = [
    {
      key: 'label',
      header: 'Periode',
      width: '14rem',
      cell: (row) => (
        <Link
          to="/vat/$period"
          params={{ period: row.code }}
          className="underline-offset-2 hover:underline"
        >
          {row.label}
        </Link>
      ),
    },
    {
      key: 'deadline',
      header: 'Uiterlijk',
      width: '9rem',
      cell: (row) => (
        <span
          className={!row.filed && row.deadline < today ? 'text-destructive tabular' : 'tabular'}
        >
          {formatDate(row.deadline)}
        </span>
      ),
    },
    {
      key: 'state',
      header: 'Status',
      width: '14rem',
      cell: (row) =>
        row.filed ? (
          <span>
            {row.sequence > 1 ? `suppletie ${String(row.sequence - 1)} ingediend` : 'ingediend'}
            {row.filedAt !== null && (
              <span className="text-muted-foreground">
                {' '}
                op {formatDate(row.filedAt.slice(0, 10))}
              </span>
            )}
          </span>
        ) : (
          <span className={row.deadline < today ? 'text-destructive' : 'text-unreconciled'}>
            {row.deadline < today ? 'te laat' : 'nog niet ingediend'}
          </span>
        ),
    },
    {
      key: 'payable',
      header: 'Te betalen',
      width: '10rem',
      align: 'right',
      cell: (row) =>
        row.payable === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <Money amount={row.payable} />
        ),
    },
  ]

  return (
    <>
      <PageHeader
        title="BTW"
        description={`Aangifte ${KIND_LABEL[periods.data.kind] ?? periods.data.kind}. Elke aangifte wordt uit het grootboek berekend, niet uit een aparte telling.`}
        actions={
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground text-xs font-medium">Jaar</span>
            <select
              aria-label="Jaar"
              disabled={!hydrated}
              value={String(year)}
              onChange={(event) => {
                void navigate({ to: '/vat', search: { year: Number(event.target.value) } })
              }}
              className="border-input bg-background rounded-md border px-3 py-2 text-sm disabled:opacity-50"
            >
              {[year + 1, year, year - 1, year - 2].map((option) => (
                <option key={option} value={String(option)}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        }
      />

      <div className="mb-8 flex flex-wrap gap-8">
        <Stat label="Periodes" value={String(rows.length)} />
        <Stat label="Ingediend" value={String(rows.filter((row) => row.filed).length)} />
        <Stat label="Te laat" value={String(overdue.length)} />
      </div>

      <LedgerTable
        caption={`BTW-periodes ${String(year)}`}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.code}
        empty="Geen periodes."
      />
    </>
  )
}
