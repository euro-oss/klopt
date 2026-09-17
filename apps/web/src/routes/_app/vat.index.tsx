import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { vatPeriodLabel } from '~/i18n/labels'
import type { VatPeriodKind } from '@klopt/core'
import { PageHeader, Stat } from '~/components/app-shell'
import { LedgerTable, type Column } from '~/components/finance/ledger-table'
import { Money } from '~/components/finance/money'
import { formatDate } from '~/lib/format'
import { SelectField, SelectOption } from '~/components/ui/select-field'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'
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
  kind: VatPeriodKind
  label: string
  from: string
  to: string
  deadline: string
  filed: boolean
  sequence: number
  filedAt: string | null
  payable: string | null
}

const KIND_KEY: Record<string, MessageKey> = {
  monthly: 'vat.kind.monthly',
  quarterly: 'vat.kind.quarterly',
  annual: 'vat.kind.annual',
}

function VatPeriods() {
  const { periods, year } = Route.useLoaderData()
  const navigate = useNavigate()
  const hydrated = useHydrated()
  const { t, tag } = useT()

  /** An unrecognised filing frequency is shown raw rather than as a blank. */
  const kindOf = (kind: string) => {
    const key = KIND_KEY[kind]
    return key === undefined ? kind : t(key)
  }

  if (!periods.ok) {
    return (
      <>
        <PageHeader title={t('vat.title')} />
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
      header: t('vat.period'),
      width: '14rem',
      cell: (row) => (
        <Link
          to="/vat/$period"
          params={{ period: row.code }}
          className="underline-offset-2 hover:underline"
        >
          {vatPeriodLabel(t, tag, row.kind, row.code)}
        </Link>
      ),
    },
    {
      key: 'deadline',
      header: t('vat.deadline'),
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
      header: t('invoices.status'),
      width: '14rem',
      cell: (row) =>
        row.filed ? (
          <span>
            {row.sequence > 1
              ? t('vat.filedSupplement', { number: String(row.sequence - 1) })
              : t('vat.filed')}
            {row.filedAt !== null && (
              <span className="text-muted-foreground">
                {t('vat.filedOn', { date: formatDate(row.filedAt.slice(0, 10)) })}
              </span>
            )}
          </span>
        ) : (
          <span className={row.deadline < today ? 'text-destructive' : 'text-unreconciled'}>
            {row.deadline < today ? t('vat.late') : t('vat.notFiled')}
          </span>
        ),
    },
    {
      key: 'payable',
      header: t('vat.payable'),
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
        title={t('vat.title')}
        description={t('vat.intro', { kind: kindOf(periods.data.kind) })}
        actions={
          <SelectField
            label={t('vat.year')}
            value={String(year)}
            disabled={!hydrated}
            triggerClassName="w-28"
            onValueChange={(chosen) => {
              void navigate({ to: '/vat', search: { year: Number(chosen) } })
            }}
          >
            {[year + 1, year, year - 1, year - 2].map((option) => (
              <SelectOption key={option} value={String(option)}>
                {String(option)}
              </SelectOption>
            ))}
          </SelectField>
        }
      />

      <div className="mb-8 flex flex-wrap gap-8">
        <Stat label={t('vat.periods')} value={String(rows.length)} />
        <Stat label={t('vat.filedCount')} value={String(rows.filter((row) => row.filed).length)} />
        <Stat label={t('vat.lateCount')} value={String(overdue.length)} />
      </div>

      <LedgerTable
        caption={t('vat.periodsCaption', { year: String(year) })}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.code}
        empty={t('vat.noPeriods')}
      />
    </>
  )
}
