import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { violationMessage } from '~/i18n/labels'
import { useRef, useState } from 'react'
import { PageHeader, Stat } from '~/components/app-shell'
import { LedgerTable, type Column } from '~/components/finance/ledger-table'
import { Money } from '~/components/finance/money'
import type { CsvMapping } from '@klopt/core'
import { formatDate } from '~/lib/format'
import { SelectField, SelectOption } from '~/components/ui/select-field'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'
import { useHydrated } from '~/lib/hydration'
import {
  createBankAccount,
  importStatement,
  listBankAccounts,
  listBankTransactions,
  listMatchRules,
  setMatchRuleActive,
} from '~/server/bank'

/**
 * Bank — accounts, statement import, and the lines that came in.
 *
 * The import is **two steps on purpose**: pick a file and see what it would do,
 * then confirm. A bank download is opaque, an accountant's export is often the
 * wrong month, and the difference between "this adds 42 transactions" and "this
 * adds 3 and 39 are already there" is worth seeing before it happens rather
 * than after.
 */
export const Route = createFileRoute('/_app/bank/')({
  loader: async () => ({
    accounts: await listBankAccounts(),
    transactions: await listBankTransactions({ data: { limit: 200 } }),
    rules: await listMatchRules(),
  }),
  component: Bank,
})

interface Row {
  id: string
  amount: string
  currency: string
  bookingDate: string
  counterpartyName: string | null
  counterpartyIban: string | null
  description: string
  status: 'unmatched' | 'matched' | 'ignored'
}

/** What the import handler reports, dry run or not. One shape, deliberately. */
interface ImportReport {
  dryRun: boolean
  /** A CSV whose layout is not yet known. `guess` is the starting point. */
  needsMapping: boolean
  guess: CsvMapping | null
  header: readonly string[]
  unmatched: readonly string[]
  statements: number
  entries: number
  newEntries: number
  duplicates: number
  imported: number
  format: string | null
  period: { from: string; to: string } | null
  problems: readonly { severity: string; code: string; message: string }[]
}

/**
 * Which fields of a mapping the form offers, and what to call them.
 *
 * Deliberately not all of them: `creditAmount` and `creditIndicator` only apply
 * to layouts the guesser recognises, and offering eleven dropdowns when eight
 * are already right is how a configuration form goes unfinished.
 */
const MAPPING_FIELDS = [
  { key: 'bookingDate', label: 'bank.map.bookingDate', required: true },
  { key: 'amount', label: 'bank.map.amount', required: true },
  { key: 'indicator', label: 'bank.map.indicator', required: false },
  { key: 'counterpartyName', label: 'bank.map.counterpartyName', required: false },
  { key: 'counterpartyIban', label: 'bank.map.counterpartyIban', required: false },
  { key: 'description', label: 'bank.map.description', required: false },
  { key: 'reference', label: 'bank.map.reference', required: false },
  { key: 'balanceAfter', label: 'bank.map.balanceAfter', required: false },
] as const satisfies readonly { key: string; label: MessageKey; required: boolean }[]

const DATE_FORMATS = [
  'yyyy-MM-dd',
  'yyyy/MM/dd',
  'yyyyMMdd',
  'dd-MM-yyyy',
  'dd/MM/yyyy',
  'dd.MM.yyyy',
] as const

const CONSENT_KEY: Record<string, MessageKey> = {
  not_required: 'bank.consent.not_required',
  active: 'bank.consent.active',
  expiring: 'bank.consent.expiring',
  expired: 'bank.consent.expired',
}

function Bank() {
  const { accounts, transactions, rules } = Route.useLoaderData()
  const router = useRouter()
  const hydrated = useHydrated()
  const { t } = useT()

  /** An unrecognised consent state is shown raw rather than as a blank. */
  const consentOf = (state: string) => {
    const key = CONSENT_KEY[state]
    return key === undefined ? state : t(key)
  }

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [preview, setPreview] = useState<{
    content: string
    accountId: string
    report: ImportReport
  } | null>(null)
  const [showAccountForm, setShowAccountForm] = useState(false)
  const [mapping, setMapping] = useState<CsvMapping | null>(null)
  const importKey = useRef<string>(crypto.randomUUID())
  const accountKey = useRef<string>(crypto.randomUUID())

  if (!accounts.ok) {
    return (
      <>
        <PageHeader title={t('bank.title')} />
        <p role="alert" className="text-destructive text-sm">
          {accounts.problem.detail}
        </p>
      </>
    )
  }

  const rows: Row[] = transactions.ok ? transactions.data.transactions : []
  const bankAccounts = accounts.data.accounts
  const unmatched = bankAccounts.reduce(
    (total, account) => total + account.reconciliation.unmatchedCount,
    0,
  )
  const learnedRules = rules.ok ? rules.data.rules : []

  async function toggleRule(ruleId: string, isActive: boolean) {
    setBusy(true)
    setError(null)
    const result = await setMatchRuleActive({ data: { ruleId, isActive } })
    setBusy(false)
    if (!result.ok) {
      setError(result.problem.detail)
      return
    }
    await router.invalidate()
  }

  async function chooseFile(accountId: string, file: File) {
    setBusy(true)
    setError(null)
    setNotice(null)
    setPreview(null)

    const content = await file.text()
    const result = await importStatement({
      data: { bankAccountId: accountId, content, dryRun: true },
    })
    setBusy(false)

    if (!result.ok) {
      setError(
        result.problem.violations.length > 0
          ? result.problem.violations.map((item) => violationMessage(t, item)).join(' ')
          : result.problem.detail,
      )
      return
    }

    const report = result.data
    setPreview({ content, accountId, report })
    setMapping(report.needsMapping ? report.guess : null)
  }

  /** Re-run the dry run with the mapping the operator has corrected. */
  async function applyMapping() {
    if (preview === null || mapping === null) return

    setBusy(true)
    setError(null)

    const result = await importStatement({
      data: {
        bankAccountId: preview.accountId,
        content: preview.content,
        format: 'csv',
        mapping,
        dryRun: true,
      },
    })
    setBusy(false)

    if (!result.ok) {
      setError(
        result.problem.violations.length > 0
          ? result.problem.violations.map((item) => violationMessage(t, item)).join(' ')
          : result.problem.detail,
      )
      return
    }

    setPreview({ ...preview, report: result.data })
  }

  async function confirm() {
    if (preview === null) return
    setBusy(true)
    setError(null)

    const result = await importStatement({
      data: {
        bankAccountId: preview.accountId,
        content: preview.content,
        idempotencyKey: importKey.current,
        ...(mapping === null ? {} : { format: 'csv', mapping }),
      },
    })
    setBusy(false)

    if (!result.ok) {
      setError(result.problem.detail)
      return
    }

    importKey.current = crypto.randomUUID()
    const body = result.data
    setPreview(null)
    setMapping(null)
    setNotice(
      t('bank.imported', { count: String(body.imported) }) +
        (body.duplicates > 0
          ? t('bank.importedDuplicates', { count: String(body.duplicates) })
          : '.'),
    )
    await router.invalidate()
  }

  async function addAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const text = (key: string): string => {
      const value = form.get(key)
      return typeof value === 'string' ? value.trim() : ''
    }

    setBusy(true)
    setError(null)

    const result = await createBankAccount({
      data: {
        idempotencyKey: accountKey.current,
        iban: text('iban'),
        name: text('name'),
        ledgerAccountNumber:
          text('ledgerAccountNumber') === '' ? null : text('ledgerAccountNumber'),
      },
    })
    setBusy(false)

    if (!result.ok) {
      setError(
        result.problem.violations.length > 0
          ? result.problem.violations.map((item) => violationMessage(t, item)).join(' ')
          : result.problem.detail,
      )
      return
    }

    accountKey.current = crypto.randomUUID()
    setShowAccountForm(false)
    await router.invalidate()
  }

  const columns: readonly Column<Row>[] = [
    {
      key: 'date',
      header: t('bank.map.bookingDate'),
      width: '7rem',
      cell: (row) => <span className="tabular">{formatDate(row.bookingDate)}</span>,
    },
    {
      key: 'counterparty',
      header: t('bank.counterparty'),
      width: '16rem',
      cell: (row) =>
        row.counterpartyName ?? (
          <span className="text-muted-foreground">{t('bank.counterpartyUnknown')}</span>
        ),
    },
    { key: 'description', header: t('entries.description'), cell: (row) => row.description },
    {
      key: 'status',
      header: t('invoices.status'),
      width: '7rem',
      cell: (row) =>
        row.status === 'matched' ? (
          t('bank.status.matched')
        ) : row.status === 'ignored' ? (
          <span className="text-muted-foreground">{t('bank.status.ignored')}</span>
        ) : (
          <span className="text-unreconciled">{t('bank.status.unmatched')}</span>
        ),
    },
    {
      key: 'amount',
      header: t('bank.amount'),
      width: '9rem',
      align: 'right',
      cell: (row) => <Money amount={row.amount} />,
    },
  ]

  return (
    <>
      <PageHeader
        title={t('bank.title')}
        description={t('bank.intro')}
        actions={
          <>
            {unmatched > 0 && (
              <Link
                to="/bank/match"
                className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium"
              >
                {t('bank.matchCount', { count: String(unmatched) })}
              </Link>
            )}
            <button
              type="button"
              disabled={!hydrated}
              onClick={() => {
                setShowAccountForm((value) => !value)
              }}
              className="border-input rounded-md border px-4 py-2 text-sm disabled:opacity-50"
            >
              {showAccountForm ? t('common.cancel') : t('bank.addAccount')}
            </button>
          </>
        }
      />

      {showAccountForm && (
        <form
          onSubmit={(event) => {
            void addAccount(event)
          }}
          className="border-border mb-8 grid max-w-3xl grid-cols-[1fr_1fr_10rem_auto] items-end gap-4 rounded-md border p-4"
        >
          <label className="block">
            <span className="text-muted-foreground mb-1 block text-xs font-medium">IBAN</span>
            <input
              name="iban"
              required
              placeholder="NL02ABNA0123456789"
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-muted-foreground mb-1 block text-xs font-medium">
              {t('bank.accountName')}
            </span>
            <input
              name="name"
              required
              placeholder={t('bank.accountNamePlaceholder')}
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-muted-foreground mb-1 block text-xs font-medium">
              {t('invoice.ledgerAccount')}
            </span>
            <input
              name="ledgerAccountNumber"
              defaultValue="1100"
              className="border-input bg-background tabular w-full rounded-md border px-3 py-2 text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={busy || !hydrated}
            className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {t('common.save')}
          </button>
        </form>
      )}

      {bankAccounts.length === 0 ? (
        <p className="text-muted-foreground border-border mb-8 rounded-md border border-dashed p-6 text-sm">
          {t('bank.noAccounts')}
        </p>
      ) : (
        <div className="mb-8 grid grid-cols-3 gap-4">
          {bankAccounts.map((account) => (
            <div key={account.id} className="border-border rounded-md border p-4">
              <p className="text-sm font-medium">{account.name}</p>
              <p className="text-muted-foreground tabular text-xs">{account.iban}</p>
              <p className="mt-3 text-2xl font-semibold tabular">
                {account.reconciliation.statementBalance === null ? (
                  <span className="text-muted-foreground text-sm">{t('bank.noStatement')}</span>
                ) : (
                  <Money amount={account.reconciliation.statementBalance} />
                )}
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                {account.reconciliation.statementDate === null
                  ? consentOf(account.consentState)
                  : t('bank.asAt', {
                      date: formatDate(account.reconciliation.statementDate),
                      consent: consentOf(account.consentState),
                    })}
              </p>
              {account.reconciliation.unmatchedCount > 0 && (
                <p className="text-unreconciled mt-2 text-xs">
                  {t('bank.unmatchedLines', {
                    count: String(account.reconciliation.unmatchedCount),
                  })}
                </p>
              )}

              <label className="mt-4 block">
                <span className="text-muted-foreground mb-1 block text-xs font-medium">
                  {t('bank.importStatement')}
                </span>
                <input
                  type="file"
                  accept=".xml,.940,.sta,.txt,.mt940"
                  disabled={busy || !hydrated}
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file !== undefined) void chooseFile(account.id, file)
                    event.target.value = ''
                  }}
                  className="w-full text-xs"
                />
              </label>
            </div>
          ))}
        </div>
      )}

      {notice !== null && (
        <p className="border-border text-muted-foreground mb-4 rounded-md border p-3 text-sm">
          {notice}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="text-destructive mb-4 text-sm">
          {error}
        </p>
      )}

      {preview !== null && preview.report.needsMapping && mapping !== null && (
        <div className="border-border mb-8 rounded-md border p-4">
          <h2 className="text-base font-medium">{t('bank.columns')}</h2>
          {/* A guess to correct, not a form to fill in: spec 7.4 asks for a
              configurable mapper, and eleven empty dropdowns is a mapper
              nobody configures. */}
          <p className="text-muted-foreground mt-1 text-sm">{t('bank.columnsIntro')}</p>

          <div className="mt-4 grid grid-cols-4 gap-4">
            {MAPPING_FIELDS.map((field) => (
              <SelectField
                key={field.key}
                label={`${t(field.label)}${field.required ? '' : t('bank.optionalSuffix')}`}
                value={mapping[field.key] ?? ''}
                disabled={!hydrated}
                onValueChange={(next) => {
                  const value = next === '' ? null : next
                  setMapping({
                    ...mapping,
                    [field.key]: value,
                    // An af/bij column is what decides the style; without one
                    // the sign has to be in the amount itself.
                    ...(field.key === 'indicator'
                      ? { amountStyle: value === null ? 'signed' : 'indicator' }
                      : {}),
                  })
                }}
              >
                <SelectOption value="">—</SelectOption>
                {preview.report.header.map((column) => (
                  <SelectOption key={column} value={column}>
                    {column}
                  </SelectOption>
                ))}
              </SelectField>
            ))}

            <SelectField
              label={t('bank.dateFormat')}
              value={mapping.dateFormat}
              disabled={!hydrated}
              onValueChange={(next) => {
                setMapping({ ...mapping, dateFormat: next })
              }}
            >
              {DATE_FORMATS.map((format) => (
                <SelectOption key={format} value={format}>
                  {format}
                </SelectOption>
              ))}
            </SelectField>

            <SelectField
              label={t('bank.decimalSeparator')}
              value={mapping.decimalSeparator}
              disabled={!hydrated}
              onValueChange={(next) => {
                setMapping({ ...mapping, decimalSeparator: next === '.' ? '.' : ',' })
              }}
            >
              <SelectOption value=",">1.234,56</SelectOption>
              <SelectOption value=".">1,234.56</SelectOption>
            </SelectField>

            {mapping.amountStyle === 'indicator' && (
              <label className="block">
                <span className="text-muted-foreground mb-1 block text-xs font-medium">
                  {t('bank.creditIndicator')}
                </span>
                <input
                  value={mapping.creditIndicator ?? ''}
                  onChange={(event) => {
                    setMapping({ ...mapping, creditIndicator: event.target.value })
                  }}
                  className="border-input bg-background w-full rounded-md border px-2 py-1.5 text-sm"
                />
              </label>
            )}
          </div>

          {preview.report.unmatched.length > 0 && (
            <p className="text-muted-foreground mt-4 text-xs">
              {t('bank.unassignedColumns', { columns: preview.report.unmatched.join(', ') })}
            </p>
          )}

          <div className="mt-4 flex gap-3">
            <button
              type="button"
              disabled={busy || !hydrated}
              onClick={() => {
                void applyMapping()
              }}
              className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {busy ? t('common.busy') : t('bank.readFile')}
            </button>
            <button
              type="button"
              onClick={() => {
                setPreview(null)
                setMapping(null)
              }}
              className="border-input rounded-md border px-4 py-2 text-sm"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {preview !== null && !preview.report.needsMapping && (
        <div className="border-border mb-8 rounded-md border p-4">
          <h2 className="text-base font-medium">{t('bank.wouldDo')}</h2>
          <dl className="mt-3 grid grid-cols-4 gap-4 text-sm">
            <div>
              <dt className="text-muted-foreground text-xs">{t('bank.format')}</dt>
              <dd>{preview.report.format ?? t('bank.formatUnknown')}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">{t('bank.periodLabel')}</dt>
              <dd className="tabular">
                {preview.report.period === null
                  ? '—'
                  : `${formatDate(preview.report.period.from)} – ${formatDate(preview.report.period.to)}`}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">{t('bank.newCount')}</dt>
              <dd className="tabular font-medium">{preview.report.newEntries}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">{t('bank.alreadyImported')}</dt>
              <dd className="tabular">{preview.report.duplicates}</dd>
            </div>
          </dl>

          {preview.report.problems.length > 0 && (
            <ul className="mt-4 space-y-1 text-sm">
              {preview.report.problems.map((problem, index) => (
                <li
                  key={index}
                  className={
                    problem.severity === 'error' ? 'text-destructive' : 'text-unreconciled'
                  }
                >
                  {problem.message}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 flex gap-3">
            <button
              type="button"
              disabled={busy || preview.report.newEntries === 0}
              onClick={() => {
                void confirm()
              }}
              className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {busy ? t('common.busy') : t('bank.import')}
            </button>
            <button
              type="button"
              onClick={() => {
                setPreview(null)
              }}
              className="border-input rounded-md border px-4 py-2 text-sm"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {learnedRules.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-1 text-base font-medium">{t('bank.rules')}</h2>
          {/* Spec 7.4: "visible and editable, never a black box". A rule you
              cannot read is one you cannot disagree with. */}
          <p className="text-muted-foreground mb-3 text-sm">{t('bank.rulesIntro')}</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border text-muted-foreground border-b text-left text-xs">
                <th className="py-2 font-medium">{t('bank.ruleIf')}</th>
                <th className="py-2 font-medium">{t('bank.ruleThen')}</th>
                <th className="py-2 text-right font-medium">{t('bank.ruleApplied')}</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {learnedRules.map((rule) => (
                <tr key={rule.id} className="border-border border-b">
                  <td className="py-2">
                    {[
                      rule.counterpartyIban === null
                        ? null
                        : t('bank.ruleAccount', { iban: rule.counterpartyIban }),
                      rule.counterpartyName === null
                        ? null
                        : t('bank.ruleName', { name: rule.counterpartyName }),
                      rule.descriptionContains === null
                        ? null
                        : t('bank.ruleDescription', { text: rule.descriptionContains }),
                    ]
                      .filter((part) => part !== null)
                      .join(t('bank.ruleAnd'))}
                  </td>
                  <td className="tabular py-2">{rule.accountNumber ?? '—'}</td>
                  <td className="tabular py-2 text-right">{rule.timesApplied}×</td>
                  <td className="py-2 text-right">
                    <button
                      type="button"
                      disabled={busy || !hydrated}
                      onClick={() => {
                        void toggleRule(rule.id, !rule.isActive)
                      }}
                      className="text-muted-foreground hover:text-foreground text-xs underline disabled:opacity-50"
                    >
                      {rule.isActive ? t('bank.ruleDisable') : t('bank.ruleEnable')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {bankAccounts.length > 0 && (
        <>
          <div className="mb-4 grid grid-cols-3 gap-4">
            <Stat
              label={t('bank.lines')}
              value={String(rows.length)}
              hint={t('bank.lastTwoHundred')}
            />
            <Stat
              label={t('bank.toMatch')}
              value={String(unmatched)}
              tone={unmatched > 0 ? 'warn' : 'neutral'}
              hint={t('bank.toMatchHint')}
            />
            <Stat label={t('bank.accounts')} value={String(bankAccounts.length)} />
          </div>

          <LedgerTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            caption={t('bank.transactions')}
            empty={t('bank.transactionsEmpty')}
          />

          <p className="text-muted-foreground mt-6 max-w-2xl text-xs">
            {t('bank.footerNote')}{' '}
            <Link to="/bank/match" className="underline">
              {t('bank.footerLink')}
            </Link>
            .
          </p>
        </>
      )}
    </>
  )
}
