import { Link, createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { PageHeader, Stat } from '~/components/app-shell'
import { LedgerTable, type Column } from '~/components/finance/ledger-table'
import { Money } from '~/components/finance/money'
import { formatDate } from '~/lib/format'
import { SelectField, SelectOption } from '~/components/ui/select-field'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'
import { useHydrated } from '~/lib/hydration'
import { createPaymentBatch, listPaymentBatches } from '~/server/payments'
import { listBankAccounts } from '~/server/bank'

/**
 * Betalingen — the payment batches.
 *
 * A batch is the unit that gets approved, so it is the unit the screen shows.
 * The state column is the whole story: who has to do what next, and by whom.
 */
export const Route = createFileRoute('/_app/payments/')({
  loader: async () => ({
    batches: await listPaymentBatches(),
    accounts: await listBankAccounts(),
  }),
  component: PaymentBatches,
})

interface Row {
  id: string
  reference: string
  state: 'draft' | 'submitted' | 'approved' | 'exported' | 'rejected'
  bankAccountIban: string
  requestedExecutionDate: string
  instructionCount: number
  total: string
  submittedBy: string | null
  approvedBy: string | null
  exportedAt: string | null
  rejectionReason: string | null
}

export const STATE_KEY: Record<Row['state'], MessageKey> = {
  draft: 'payments.state.draft',
  submitted: 'payments.state.submitted',
  approved: 'payments.state.approved',
  exported: 'payments.state.exported',
  rejected: 'payments.state.rejected',
}

const today = (): string => new Date().toISOString().slice(0, 10)

function PaymentBatches() {
  const { batches, accounts } = Route.useLoaderData()
  const router = useRouter()
  const navigate = useNavigate()
  const hydrated = useHydrated()
  const { t } = useT()

  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const key = useRef<string>(crypto.randomUUID())

  if (!batches.ok) {
    return (
      <>
        <PageHeader title={t('payments.title')} />
        <p role="alert" className="text-destructive text-sm">
          {batches.problem.detail}
        </p>
      </>
    )
  }

  const rows = batches.data.batches
  const bankAccounts = accounts.ok ? accounts.data.accounts : []
  const waiting = rows.filter((row) => row.state === 'submitted')

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const text = (name: string): string => {
      const value = form.get(name)
      return typeof value === 'string' ? value.trim() : ''
    }

    setBusy(true)
    setError(null)

    const result = await createPaymentBatch({
      data: {
        idempotencyKey: key.current,
        reference: text('reference'),
        bankAccountId: text('bankAccountId'),
        requestedExecutionDate: text('requestedExecutionDate'),
      },
    })
    setBusy(false)

    if (!result.ok) {
      setError(
        result.problem.violations.length > 0
          ? result.problem.violations.map((item) => item.message).join(' ')
          : result.problem.detail,
      )
      return
    }

    key.current = crypto.randomUUID()
    setOpen(false)
    await router.invalidate()
    await navigate({ to: '/payments/$batchId', params: { batchId: result.data.id } })
  }

  const columns: readonly Column<Row>[] = [
    {
      key: 'reference',
      header: t('payments.reference'),
      width: '12rem',
      cell: (row) => row.reference,
    },
    {
      key: 'date',
      header: t('payments.executionDate'),
      width: '9rem',
      cell: (row) => <span className="tabular">{formatDate(row.requestedExecutionDate)}</span>,
    },
    {
      key: 'account',
      header: t('payments.account'),
      width: '12rem',
      cell: (row) => <span className="tabular text-xs">{row.bankAccountIban}</span>,
    },
    {
      key: 'count',
      header: t('payments.instructions'),
      width: '5rem',
      align: 'right',
      cell: (row) => <span className="tabular">{row.instructionCount}</span>,
    },
    {
      key: 'state',
      header: t('invoices.status'),
      width: '12rem',
      cell: (row) => (
        <span className={row.state === 'submitted' ? 'text-unreconciled' : undefined}>
          {t(STATE_KEY[row.state])}
        </span>
      ),
    },
    {
      key: 'total',
      header: t('report.total'),
      width: '9rem',
      align: 'right',
      cell: (row) => <Money amount={row.total} />,
    },
  ]

  return (
    <>
      <PageHeader
        title={t('payments.title')}
        description={t('payments.intro')}
        actions={
          <button
            type="button"
            disabled={!hydrated || bankAccounts.length === 0}
            onClick={() => {
              setOpen((value) => !value)
            }}
            className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {open ? t('common.cancel') : t('payments.newBatch')}
          </button>
        }
      />

      {bankAccounts.length === 0 && (
        <p className="text-muted-foreground border-border mb-6 rounded-md border border-dashed p-4 text-sm">
          {t('payments.noBankAccount')}{' '}
          <Link to="/bank" className="underline">
            {t('nav.bank')}
          </Link>
          .
        </p>
      )}

      {open && (
        <form
          onSubmit={(event) => {
            void create(event)
          }}
          className="border-border mb-8 grid max-w-3xl grid-cols-[1fr_1fr_10rem_auto] items-end gap-4 rounded-md border p-4"
        >
          <label className="block">
            <span className="text-muted-foreground mb-1 block text-xs font-medium">
              {t('payments.reference')}
            </span>
            <input
              name="reference"
              required
              maxLength={35}
              defaultValue={`BETAAL-${today()}`}
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            />
          </label>
          <SelectField
            label={t('payments.account')}
            name="bankAccountId"
            defaultValue={bankAccounts[0]?.id ?? ''}
            disabled={!hydrated}
          >
            {bankAccounts.map((account) => (
              <SelectOption key={account.id} value={account.id}>
                {account.name} · {account.iban}
              </SelectOption>
            ))}
          </SelectField>
          <label className="block">
            <span className="text-muted-foreground mb-1 block text-xs font-medium">
              {t('payments.executionDate')}
            </span>
            <input
              type="date"
              name="requestedExecutionDate"
              defaultValue={today()}
              className="border-input bg-background tabular w-full rounded-md border px-3 py-2 text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={busy || !hydrated}
            className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {t('payments.create')}
          </button>
        </form>
      )}

      {error !== null && (
        <p role="alert" className="text-destructive mb-4 text-sm">
          {error}
        </p>
      )}

      {rows.length > 0 && (
        <div className="mb-6 grid grid-cols-3 gap-4">
          <Stat label={t('payments.batches')} value={String(rows.length)} />
          <Stat
            label={t('payments.awaitingApproval')}
            value={String(waiting.length)}
            tone={waiting.length > 0 ? 'warn' : 'neutral'}
            hint={t('payments.awaitingApprovalHint')}
          />
          <Stat
            label={t('payments.readyToPay')}
            value={<Money amount={waiting.reduce((sum, row) => sum + BigInt(row.total), 0n)} />}
          />
        </div>
      )}

      <LedgerTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        onRowActivate={(row) => {
          void navigate({ to: '/payments/$batchId', params: { batchId: row.id } })
        }}
        caption={t('payments.caption')}
        empty={t('payments.empty')}
      />
    </>
  )
}
