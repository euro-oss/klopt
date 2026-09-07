import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { PageHeader, Stat } from '~/components/app-shell'
import { LedgerTable, type Column } from '~/components/finance/ledger-table'
import { Money } from '~/components/finance/money'
import type { CsvMapping } from '@klopt/core'
import { formatDate } from '~/lib/format'
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
  { key: 'bookingDate', label: 'Datum', required: true },
  { key: 'amount', label: 'Bedrag', required: true },
  { key: 'indicator', label: 'Af/bij-kolom', required: false },
  { key: 'counterpartyName', label: 'Naam tegenpartij', required: false },
  { key: 'counterpartyIban', label: 'Tegenrekening', required: false },
  { key: 'description', label: 'Omschrijving', required: false },
  { key: 'reference', label: 'Kenmerk', required: false },
  { key: 'balanceAfter', label: 'Saldo na mutatie', required: false },
] as const

const DATE_FORMATS = [
  'yyyy-MM-dd',
  'yyyy/MM/dd',
  'yyyyMMdd',
  'dd-MM-yyyy',
  'dd/MM/yyyy',
  'dd.MM.yyyy',
] as const

const CONSENT_LABEL: Record<string, string> = {
  not_required: 'bestandsimport',
  active: 'toegang actief',
  expiring: 'toegang verloopt binnenkort',
  expired: 'toegang verlopen',
}

function Bank() {
  const { accounts, transactions, rules } = Route.useLoaderData()
  const router = useRouter()
  const hydrated = useHydrated()

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
        <PageHeader title="Bank" />
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
          ? result.problem.violations.map((item) => item.message).join(' ')
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
          ? result.problem.violations.map((item) => item.message).join(' ')
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
      `${String(body.imported)} transacties ingelezen` +
        (body.duplicates > 0 ? `, ${String(body.duplicates)} stonden er al.` : '.'),
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
          ? result.problem.violations.map((item) => item.message).join(' ')
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
      header: 'Datum',
      width: '7rem',
      cell: (row) => <span className="tabular">{formatDate(row.bookingDate)}</span>,
    },
    {
      key: 'counterparty',
      header: 'Tegenpartij',
      width: '16rem',
      cell: (row) =>
        row.counterpartyName ?? <span className="text-muted-foreground">onbekend</span>,
    },
    { key: 'description', header: 'Omschrijving', cell: (row) => row.description },
    {
      key: 'status',
      header: 'Status',
      width: '7rem',
      cell: (row) =>
        row.status === 'matched' ? (
          'gekoppeld'
        ) : row.status === 'ignored' ? (
          <span className="text-muted-foreground">genegeerd</span>
        ) : (
          <span className="text-unreconciled">te koppelen</span>
        ),
    },
    {
      key: 'amount',
      header: 'Bedrag',
      width: '9rem',
      align: 'right',
      cell: (row) => <Money amount={row.amount} />,
    },
  ]

  return (
    <>
      <PageHeader
        title="Bank"
        description="Rekeningen, afschriften en wat er binnenkwam."
        actions={
          <>
            {unmatched > 0 && (
              <Link
                to="/bank/match"
                className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium"
              >
                {unmatched} koppelen
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
              {showAccountForm ? 'Annuleren' : 'Rekening toevoegen'}
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
            <span className="text-muted-foreground mb-1 block text-xs font-medium">Naam</span>
            <input
              name="name"
              required
              placeholder="Rekening-courant"
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-muted-foreground mb-1 block text-xs font-medium">Grootboek</span>
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
            Opslaan
          </button>
        </form>
      )}

      {bankAccounts.length === 0 ? (
        <p className="text-muted-foreground border-border mb-8 rounded-md border border-dashed p-6 text-sm">
          Nog geen bankrekening. Voeg er een toe om afschriften te kunnen inlezen.
        </p>
      ) : (
        <div className="mb-8 grid grid-cols-3 gap-4">
          {bankAccounts.map((account) => (
            <div key={account.id} className="border-border rounded-md border p-4">
              <p className="text-sm font-medium">{account.name}</p>
              <p className="text-muted-foreground tabular text-xs">{account.iban}</p>
              <p className="mt-3 text-2xl font-semibold tabular">
                {account.reconciliation.statementBalance === null ? (
                  <span className="text-muted-foreground text-sm">nog geen afschrift</span>
                ) : (
                  <Money amount={account.reconciliation.statementBalance} />
                )}
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                {account.reconciliation.statementDate === null
                  ? CONSENT_LABEL[account.consentState]
                  : `per ${formatDate(account.reconciliation.statementDate)} · ${
                      CONSENT_LABEL[account.consentState] ?? account.consentState
                    }`}
              </p>
              {account.reconciliation.unmatchedCount > 0 && (
                <p className="text-unreconciled mt-2 text-xs">
                  {account.reconciliation.unmatchedCount} regels nog te koppelen
                </p>
              )}

              <label className="mt-4 block">
                <span className="text-muted-foreground mb-1 block text-xs font-medium">
                  Afschrift inlezen
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
          <h2 className="text-base font-medium">Kolommen van dit bestand</h2>
          {/* A guess to correct, not a form to fill in: spec 7.4 asks for a
              configurable mapper, and eleven empty dropdowns is a mapper
              nobody configures. */}
          <p className="text-muted-foreground mt-1 text-sm">
            Dit is een CSV, en elke bank verzint zijn eigen kolommen. Dit is een gok — controleer
            hem. Hij wordt onthouden, dus dit hoeft één keer.
          </p>

          <div className="mt-4 grid grid-cols-4 gap-4">
            {MAPPING_FIELDS.map((field) => (
              <label key={field.key} className="block">
                <span className="text-muted-foreground mb-1 block text-xs font-medium">
                  {field.label}
                  {field.required ? '' : ' (optioneel)'}
                </span>
                <select
                  aria-label={field.label}
                  value={mapping[field.key] ?? ''}
                  onChange={(event) => {
                    const value = event.target.value === '' ? null : event.target.value
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
                  className="border-input bg-background w-full rounded-md border px-2 py-1.5 text-sm"
                >
                  <option value="">—</option>
                  {preview.report.header.map((column) => (
                    <option key={column} value={column}>
                      {column}
                    </option>
                  ))}
                </select>
              </label>
            ))}

            <label className="block">
              <span className="text-muted-foreground mb-1 block text-xs font-medium">
                Datumnotatie
              </span>
              <select
                aria-label="Datumnotatie"
                value={mapping.dateFormat}
                onChange={(event) => {
                  setMapping({ ...mapping, dateFormat: event.target.value })
                }}
                className="border-input bg-background w-full rounded-md border px-2 py-1.5 text-sm"
              >
                {DATE_FORMATS.map((format) => (
                  <option key={format} value={format}>
                    {format}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-muted-foreground mb-1 block text-xs font-medium">
                Decimaalteken
              </span>
              <select
                aria-label="Decimaalteken"
                value={mapping.decimalSeparator}
                onChange={(event) => {
                  setMapping({
                    ...mapping,
                    decimalSeparator: event.target.value === '.' ? '.' : ',',
                  })
                }}
                className="border-input bg-background w-full rounded-md border px-2 py-1.5 text-sm"
              >
                <option value=",">1.234,56</option>
                <option value=".">1,234.56</option>
              </select>
            </label>

            {mapping.amountStyle === 'indicator' && (
              <label className="block">
                <span className="text-muted-foreground mb-1 block text-xs font-medium">
                  Waarde voor &ldquo;bij&rdquo;
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
              Niet toegewezen: {preview.report.unmatched.join(', ')}. Die kolommen worden
              overgeslagen.
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
              {busy ? 'Bezig…' : 'Bestand lezen'}
            </button>
            <button
              type="button"
              onClick={() => {
                setPreview(null)
                setMapping(null)
              }}
              className="border-input rounded-md border px-4 py-2 text-sm"
            >
              Annuleren
            </button>
          </div>
        </div>
      )}

      {preview !== null && !preview.report.needsMapping && (
        <div className="border-border mb-8 rounded-md border p-4">
          <h2 className="text-base font-medium">Wat dit bestand zou doen</h2>
          <dl className="mt-3 grid grid-cols-4 gap-4 text-sm">
            <div>
              <dt className="text-muted-foreground text-xs">Formaat</dt>
              <dd>{preview.report.format ?? 'onbekend'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Periode</dt>
              <dd className="tabular">
                {preview.report.period === null
                  ? '—'
                  : `${formatDate(preview.report.period.from)} – ${formatDate(preview.report.period.to)}`}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Nieuw</dt>
              <dd className="tabular font-medium">{preview.report.newEntries}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Al ingelezen</dt>
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
              {busy ? 'Bezig…' : 'Inlezen'}
            </button>
            <button
              type="button"
              onClick={() => {
                setPreview(null)
              }}
              className="border-input rounded-md border px-4 py-2 text-sm"
            >
              Annuleren
            </button>
          </div>
        </div>
      )}

      {learnedRules.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-1 text-base font-medium">Onthouden regels</h2>
          {/* Spec 7.4: "visible and editable, never a black box". A rule you
              cannot read is one you cannot disagree with. */}
          <p className="text-muted-foreground mb-3 text-sm">
            Wat er is onthouden van eerdere koppelingen, en hoe vaak het klopte.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border text-muted-foreground border-b text-left text-xs">
                <th className="py-2 font-medium">Als</th>
                <th className="py-2 font-medium">Dan</th>
                <th className="py-2 text-right font-medium">Toegepast</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {learnedRules.map((rule) => (
                <tr key={rule.id} className="border-border border-b">
                  <td className="py-2">
                    {[
                      rule.counterpartyIban === null ? null : `rekening ${rule.counterpartyIban}`,
                      rule.counterpartyName === null ? null : `naam "${rule.counterpartyName}"`,
                      rule.descriptionContains === null
                        ? null
                        : `omschrijving bevat "${rule.descriptionContains}"`,
                    ]
                      .filter((part) => part !== null)
                      .join(' en ')}
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
                      {rule.isActive ? 'Uitzetten' : 'Aanzetten'}
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
            <Stat label="Regels" value={String(rows.length)} hint="laatste 200" />
            <Stat
              label="Te koppelen"
              value={String(unmatched)}
              tone={unmatched > 0 ? 'warn' : 'neutral'}
              hint="nog niet aan een boeking gekoppeld"
            />
            <Stat label="Rekeningen" value={String(bankAccounts.length)} />
          </div>

          <LedgerTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            caption="Banktransacties"
            empty="Nog geen transacties. Lees een afschrift in."
          />

          <p className="text-muted-foreground mt-6 max-w-2xl text-xs">
            Wat de bank zei, precies zoals de bank het zei. Koppelen aan boekingen gaat via{' '}
            <Link to="/bank/match" className="underline">
              de koppelwachtrij
            </Link>
            .
          </p>
        </>
      )}
    </>
  )
}
