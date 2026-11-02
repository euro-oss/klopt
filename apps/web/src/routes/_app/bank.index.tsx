import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { Landmark, Upload } from 'lucide-react'
import { violationMessage } from '~/i18n/labels'
import { useEffect, useRef, useState } from 'react'
import { BankTabs } from '~/components/bank-tabs'
import { PageHeader } from '~/components/app-shell'
import { Money } from '~/components/finance/money'
import type { CsvMapping } from '@klopt/core'
import { formatDate } from '~/lib/format'
import { formatBankDayMonth, formatIbanDisplay } from '~/lib/bank-accounts'
import { DropZone } from '~/components/ui/drop-zone'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { SelectField, SelectOption } from '~/components/ui/select-field'
import { Tabs, TabsList, TabsTrigger } from '~/components/ui/tabs'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'
import { useHydrated } from '~/lib/hydration'
import { cn } from '~/lib/utils'
import {
  createBankAccount,
  importStatement,
  listBankAccounts,
  listBankTransactions,
  listMatchRules,
  setMatchRuleActive,
} from '~/server/bank'

/**
 * Bank — Accounts and statements (BankAccounts.dc.html, #129 / #140).
 *
 * Desktop-light board: account card, DropZone, import-a-statement card (no
 * PSD2), all-transactions list. Rename is [API] — omitted. Dark and phone
 * wait on Batch 2/3 boards (#143).
 *
 * The import is **two steps on purpose**: pick a file and see what it would do,
 * then confirm.
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

const EXAMPLE_IBAN = 'NL91ABNA0417164300'

function Bank() {
  const { accounts, transactions, rules } = Route.useLoaderData()
  const router = useRouter()
  const hydrated = useHydrated()
  const { t, tag } = useT()
  const dropInputRef = useRef<HTMLInputElement | null>(null)

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
  const [statusFilter, setStatusFilter] = useState<'all' | 'unmatched'>('all')
  const importKey = useRef<string>(crypto.randomUUID())
  const accountKey = useRef<string>(crypto.randomUUID())

  const accountsOk = accounts.ok
  const rows: Row[] = transactions.ok ? transactions.data.transactions : []
  const bankAccounts = accountsOk ? accounts.data.accounts : []
  const primaryAccount = bankAccounts[0] ?? null
  const unmatched = bankAccounts.reduce(
    (total, account) => total + account.reconciliation.unmatchedCount,
    0,
  )
  const learnedRules = rules.ok ? rules.data.rules : []
  const visibleRows =
    statusFilter === 'unmatched' ? rows.filter((row) => row.status === 'unmatched') : rows
  const unmatchedInList = rows.filter((row) => row.status === 'unmatched').length

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      if (event.key !== 'u' && event.key !== 'U') return
      if (busy || !hydrated || primaryAccount === null) return
      event.preventDefault()
      dropInputRef.current?.click()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [busy, hydrated, primaryAccount])

  if (!accountsOk) {
    return (
      <>
        <PageHeader title={t('bank.title')} />
        <p role="alert" className="text-destructive text-sm">
          {accounts.problem.detail}
        </p>
      </>
    )
  }

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

  function statusBadge(status: Row['status']) {
    if (status === 'matched') {
      return (
        <Badge variant="success" className="font-medium">
          {t('bank.status.matched')}
        </Badge>
      )
    }
    if (status === 'ignored') {
      return (
        <Badge variant="secondary" className="font-medium">
          {t('bank.status.ignored')}
        </Badge>
      )
    }
    return (
      <Badge variant="attention" className="font-medium">
        {t('bank.status.unmatched')}
      </Badge>
    )
  }

  return (
    <div data-slot="bank-accounts" className="flex flex-col gap-5">
      <div>
        <PageHeader
          title={t('bank.title')}
          actions={
            <Button
              type="button"
              variant="outline"
              disabled={!hydrated}
              className="min-h-11 md:min-h-10"
              onClick={() => {
                setShowAccountForm((value) => !value)
              }}
            >
              {showAccountForm ? t('common.cancel') : t('bank.addAccount')}
            </Button>
          }
        />
        <BankTabs active="accounts" toMatchCount={unmatched > 0 ? unmatched : undefined} />
      </div>

      {showAccountForm && (
        <form
          onSubmit={(event) => {
            void addAccount(event)
          }}
          className="border-border bg-surface grid max-w-3xl grid-cols-1 items-end gap-4 rounded-[var(--radius-lg)] border p-4 sm:grid-cols-[1fr_1fr_10rem_auto]"
        >
          <label className="block">
            <span className="text-muted-foreground mb-1 block text-xs font-medium">IBAN</span>
            <Input name="iban" required placeholder={EXAMPLE_IBAN} className="tabular" />
          </label>
          <label className="block">
            <span className="text-muted-foreground mb-1 block text-xs font-medium">
              {t('bank.accountName')}
            </span>
            <Input name="name" required placeholder={t('bank.accountNamePlaceholder')} />
          </label>
          <label className="block">
            <span className="text-muted-foreground mb-1 block text-xs font-medium">
              {t('invoice.ledgerAccount')}
            </span>
            <Input name="ledgerAccountNumber" defaultValue="1100" className="tabular" />
          </label>
          <Button type="submit" disabled={busy || !hydrated} className="min-h-11 md:min-h-10">
            {t('common.save')}
          </Button>
        </form>
      )}

      {bankAccounts.length === 0 ? (
        <p className="text-muted-foreground border-border bg-surface rounded-[var(--radius-lg)] border p-4 text-sm">
          {t('bank.noAccounts')}
        </p>
      ) : (
        <div className="flex flex-wrap items-stretch gap-5">
          {bankAccounts.map((account) => {
            const rec = account.reconciliation
            const lineTotal = rec.lineCount
            const books = rec.booksBalance
            const statement = rec.statementBalance
            const hasDiff =
              books !== null && statement !== null && BigInt(books) !== BigInt(statement)

            return (
              <section
                key={account.id}
                data-slot="bank-account-card"
                className="border-border bg-surface flex min-w-[min(100%,360px)] flex-1 flex-col gap-3.5 rounded-[var(--radius-lg)] border p-4"
              >
                <div className="flex items-start gap-3">
                  <span className="bg-surface-sunken text-ink inline-flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-md)]">
                    <Landmark className="size-[18px]" aria-hidden="true" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-ink truncate text-sm font-semibold">
                        {account.name}
                      </strong>
                      <Badge
                        data-slot="bank-account-badge"
                        variant="secondary"
                        className="shrink-0 font-medium"
                      >
                        {t('bank.fileImport')}
                      </Badge>
                    </div>
                    <span
                      data-slot="bank-account-iban"
                      className="text-ink-muted tabular whitespace-nowrap text-[13px]"
                    >
                      {formatIbanDisplay(account.iban)}
                    </span>
                  </div>
                </div>

                <p className="text-ink text-[28px] leading-[34px] font-semibold tracking-[-0.02em] tabular">
                  {statement === null ? (
                    <span className="text-muted-foreground text-sm font-medium">
                      {t('bank.noStatement')}
                    </span>
                  ) : (
                    <>
                      <span aria-hidden="true">€ </span>
                      <Money
                        amount={statement}
                        className="text-[28px] leading-[34px] font-semibold"
                      />
                    </>
                  )}
                </p>

                <dl className="text-ink grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
                  <dt className="text-ink-muted">{t('bank.statementUpTo')}</dt>
                  <dd className="tabular">
                    {rec.statementDate === null ? '—' : formatDate(rec.statementDate)}
                  </dd>
                  <dt className="text-ink-muted">{t('bank.lines')}</dt>
                  <dd>
                    {lineTotal === 0
                      ? t('bank.linesNone')
                      : t('bank.linesOfWhich', {
                          total: String(lineTotal),
                          unmatched: String(rec.unmatchedCount),
                        })}
                  </dd>
                  <dt className="text-ink-muted">{t('bank.inTheBooks')}</dt>
                  <dd className="tabular">
                    {books === null ? (
                      '—'
                    ) : (
                      <>
                        <Money amount={books} />
                        {hasDiff ? (
                          <Link
                            to="/reports/trial-balance"
                            className="text-ink ml-1.5 font-medium underline underline-offset-2"
                          >
                            {t('bank.whyDifference')}
                          </Link>
                        ) : null}
                      </>
                    )}
                  </dd>
                </dl>

                {rec.unmatchedCount > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    <Button asChild size="sm" className="min-h-11 md:min-h-9">
                      <Link to="/bank/match">
                        {t('bank.matchCount', { count: String(rec.unmatchedCount) })}
                      </Link>
                    </Button>
                  </div>
                ) : null}

                {/*
                  Import is per account card so a statement for the second
                  account does not hit the first and surface an English core
                  account_mismatch error (PM #171).
                */}
                <DropZone
                  data-account-id={account.id}
                  {...(account.id === primaryAccount?.id
                    ? { inputRef: dropInputRef, shortcut: 'U' }
                    : {})}
                  className="min-h-0 justify-center px-4 py-5"
                  title={t('bank.dropTitle')}
                  description={bankAccounts.length === 1 ? t('bank.dropDescription') : account.name}
                  accept=".xml,.940,.sta,.txt,.mt940,.csv"
                  disabled={busy || !hydrated}
                  onFiles={(files) => {
                    const file = files[0]
                    if (file !== undefined) void chooseFile(account.id, file)
                  }}
                />
              </section>
            )
          })}

          <section
            data-slot="bank-import-card"
            className="border-border bg-surface flex min-w-[min(100%,300px)] flex-1 flex-col gap-2.5 rounded-[var(--radius-lg)] border p-4"
          >
            <div className="bg-brand-tint text-brand-ink mb-1 inline-flex size-12 items-center justify-center rounded-xl">
              <Upload className="size-[22px]" aria-hidden="true" />
            </div>
            <strong className="text-ink text-[15px] font-semibold">
              {t('bank.importCardTitle')}
            </strong>
            <p className="text-ink-2 flex-1 text-sm leading-relaxed">
              {primaryAccount?.reconciliation.statementDate !== null &&
              primaryAccount?.reconciliation.statementDate !== undefined
                ? t('bank.importCardBodyDated', {
                    date: formatDate(primaryAccount.reconciliation.statementDate),
                  })
                : t('bank.importCardBody')}
            </p>
          </section>
        </div>
      )}

      {notice !== null && (
        <p className="border-border text-muted-foreground rounded-[var(--radius-md)] border p-3 text-sm">
          {notice}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      {preview !== null && preview.report.needsMapping && mapping !== null && (
        <div className="border-border bg-surface rounded-[var(--radius-lg)] border p-4">
          <h2 className="text-base font-medium">{t('bank.columns')}</h2>
          <p className="text-muted-foreground mt-1 text-sm">{t('bank.columnsIntro')}</p>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
                <Input
                  value={mapping.creditIndicator ?? ''}
                  onChange={(event) => {
                    setMapping({ ...mapping, creditIndicator: event.target.value })
                  }}
                />
              </label>
            )}
          </div>

          {preview.report.unmatched.length > 0 && (
            <p className="text-muted-foreground mt-4 text-xs">
              {t('bank.unassignedColumns', { columns: preview.report.unmatched.join(', ') })}
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              type="button"
              disabled={busy || !hydrated}
              className="min-h-11 md:min-h-10"
              onClick={() => {
                void applyMapping()
              }}
            >
              {busy ? t('common.busy') : t('bank.readFile')}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-11 md:min-h-10"
              onClick={() => {
                setPreview(null)
                setMapping(null)
              }}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}

      {preview !== null && !preview.report.needsMapping && (
        <div className="border-border bg-surface rounded-[var(--radius-lg)] border p-4">
          <h2 className="text-base font-medium">{t('bank.wouldDo')}</h2>
          <dl className="mt-3 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
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

          {preview.report.newEntries === 0 ? (
            <p className="text-muted-foreground mt-4 text-sm">
              {t('bank.nothingNew', {
                count: String(
                  preview.report.duplicates > 0
                    ? preview.report.duplicates
                    : preview.report.entries,
                ),
              })}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-3">
            {preview.report.newEntries > 0 ? (
              <Button
                type="button"
                disabled={busy}
                className="min-h-11 md:min-h-10"
                onClick={() => {
                  void confirm()
                }}
              >
                {busy ? t('common.busy') : t('bank.import')}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              className="min-h-11 md:min-h-10"
              onClick={() => {
                setPreview(null)
              }}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}

      {learnedRules.length > 0 && (
        <section>
          <h2 className="mb-1 text-base font-medium">{t('bank.rules')}</h2>
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
                      className="text-muted-foreground hover:text-foreground min-h-11 text-xs underline disabled:opacity-50 md:min-h-0"
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
        <section
          data-slot="bank-transactions"
          className="border-border bg-surface overflow-hidden rounded-[var(--radius-lg)] border"
          aria-labelledby="bank-tx-heading"
        >
          <div className="border-border flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 id="bank-tx-heading" className="text-base font-semibold">
                {t('bank.allTransactions')}
              </h2>
              {rows.length >= 200 ? (
                <span className="text-muted-foreground text-xs">{t('bank.lastTwoHundred')}</span>
              ) : null}
            </div>
            <Tabs
              value={statusFilter}
              onValueChange={(value) => {
                setStatusFilter(value === 'unmatched' ? 'unmatched' : 'all')
              }}
            >
              <TabsList variant="segmented" aria-label={t('bank.filterStatus')}>
                <TabsTrigger value="all">
                  {t('bank.filterAll')}{' '}
                  <span className="text-ink-muted ml-1 tabular">{rows.length}</span>
                </TabsTrigger>
                <TabsTrigger value="unmatched">
                  {t('bank.toMatch')}{' '}
                  <span className="text-ink-muted ml-1 tabular">{unmatchedInList}</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[640px]">
              <div
                className="text-ink-muted grid grid-cols-[72px_minmax(160px,1fr)_minmax(140px,1fr)_100px_100px] gap-3 border-b border-[var(--line-soft)] px-4 py-2 text-xs font-medium"
                role="row"
              >
                <span>{t('bank.map.bookingDate')}</span>
                <span>{t('bank.counterparty')}</span>
                <span>{t('entries.description')}</span>
                <span>{t('invoices.status')}</span>
                <span className="text-right">{t('bank.amount')}</span>
              </div>

              {visibleRows.length === 0 ? (
                <p className="text-muted-foreground px-4 py-8 text-sm">
                  {t('bank.transactionsEmpty')}
                </p>
              ) : (
                visibleRows.map((row) => {
                  const content = (
                    <>
                      <span className="tabular">{formatBankDayMonth(row.bookingDate, tag)}</span>
                      <span className="truncate">
                        {row.counterpartyName ?? (
                          <span className="text-muted-foreground">
                            {t('bank.counterpartyUnknown')}
                          </span>
                        )}
                      </span>
                      <span className="text-ink-muted truncate">{row.description}</span>
                      <span>{statusBadge(row.status)}</span>
                      <span className="text-right">
                        <Money amount={row.amount} />
                      </span>
                    </>
                  )

                  if (row.status === 'unmatched') {
                    return (
                      <Link
                        key={row.id}
                        to="/bank/match"
                        className={cn(
                          'text-ink grid grid-cols-[72px_minmax(160px,1fr)_minmax(140px,1fr)_100px_100px] items-center gap-3 border-b border-[var(--line-soft)] px-4 py-3 text-sm no-underline',
                          'hover:bg-surface-sunken min-h-11',
                        )}
                      >
                        {content}
                      </Link>
                    )
                  }

                  return (
                    <div
                      key={row.id}
                      className="text-ink grid grid-cols-[72px_minmax(160px,1fr)_minmax(140px,1fr)_100px_100px] items-center gap-3 border-b border-[var(--line-soft)] px-4 py-3 text-sm"
                    >
                      {content}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
