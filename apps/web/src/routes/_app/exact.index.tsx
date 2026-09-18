import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { PageHeader, Stat } from '~/components/app-shell'
import { formatDate } from '~/lib/format'
import {
  balanceSheetAccounts,
  defaultJournal,
  openingJournals,
  type AccountOption,
  type JournalOption,
} from '~/lib/account-options'
import { SelectField, SelectOption } from '~/components/ui/select-field'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'
import { useHydrated } from '~/lib/hydration'
import {
  chooseExactDivision,
  connectExact,
  disconnectExact,
  getExactConnection,
  exactDocumentStatus,
  importExactDocuments,
  listAccounts,
  listExactDivisions,
  listJournals,
  previewExactImport,
  runExactImport,
} from '~/server/ledger'

/**
 * Overzetten uit Exact Online (spec 13).
 *
 * Drie stappen, in deze volgorde, en de middelste is de belangrijkste: één
 * Exact-login bereikt élke administratie waar iemand rechten op heeft — de
 * werkmaatschappij, de holding, de oefenadministratie van een cursus, de
 * testadministratie die iemand ooit heeft aangemaakt. In een lijst zien ze er
 * hetzelfde uit, en achteraf is niet meer te zien welke het was.
 *
 * Daarom staat bij elke administratie wat er ongewoon aan is, staan de gewone
 * administraties bovenaan, en noemt de bevestiging de naam en het nummer in
 * plaats van "administratie 2 van 6".
 *
 * De proefimport is een leesactie: hij verandert hier niets en levert de
 * aansluiting op de proefbalans van Exact zelf. Dat is wat de spec vraagt
 * vóórdat er iets wordt overgezet.
 */
export const Route = createFileRoute('/_app/exact/')({
  // The chart comes along so the account fields can be pickers rather than
  // free text. See `AccountSelect`.
  loader: async () => ({
    connection: await getExactConnection(),
    documents: await exactDocumentStatus(),
    accounts: await listAccounts(),
    journals: await listJournals(),
  }),
  component: Exact,
})

/**
 * Pick a grootboekrekening.
 *
 * A `select`, not the `datalist` the journaalpost screen uses, and the
 * difference is who is typing. A bookkeeper entering lines knows the chart and
 * types `4300` faster than any menu; a datalist helps them and stays out of the
 * way. This form is filled in once, by somebody migrating out of another system
 * who has no reason to know these numbers yet — and a datalist still accepts
 * whatever you type, so it guides without constraining.
 *
 * Only balance-sheet accounts are offered. That is not a convenience: the
 * debtors position, the creditors position and the counter to them are all
 * balance-sheet positions by definition. Booking an opening balance against a
 * cost or revenue account would restate this year's result by the whole
 * imported position, and nothing on any screen would look wrong afterwards.
 *
 * Blocked accounts are offered too, marked. The ledger refuses to post to one,
 * so hiding it would turn a clear refusal into "my account is missing".
 */
function AccountSelect({
  label,
  hint,
  value,
  onChange,
  accounts,
  disabled,
}: {
  label: string
  hint?: string | undefined
  value: string
  onChange: (value: string) => void
  accounts: readonly AccountOption[]
  disabled: boolean
}) {
  const { t } = useT()
  const offered = balanceSheetAccounts(accounts)

  return (
    <SelectField
      label={label}
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      hint={hint}
    >
      <SelectOption value="">{t('exact.chooseAccount')}</SelectOption>
      {offered.map((account) => (
        <SelectOption key={account.number} value={account.number}>
          {account.number} — {account.name}
          {account.isBlocked ? t('exact.blockedSuffix') : ''}
        </SelectOption>
      ))}
    </SelectField>
  )
}

interface DivisionOption {
  readonly code: number
  readonly description: string
  readonly label: string
  readonly currency: string | null
  readonly vatNumber: string | null
  readonly cautions: readonly string[]
  readonly ordinary: boolean
}

const CAUTION_KEY: Record<string, MessageKey> = {
  practice: 'exact.caution.practice',
  dossier: 'exact.caution.dossier',
  archived: 'exact.caution.archived',
  inactive: 'exact.caution.inactive',
  blocked: 'exact.caution.blocked',
}

function Exact() {
  const {
    connection,
    accounts: accountsResult,
    journals: journalsResult,
    documents: documentsResult,
  } = Route.useLoaderData()
  const { t } = useT()

  /** An unrecognised caution is shown raw rather than as a blank. */
  const cautionOf = (caution: string) => {
    const key = CAUTION_KEY[caution]
    return key === undefined ? caution : t(key)
  }

  // The pickers are only as good as the chart behind them. A failed load leaves
  // them empty rather than falling back to free text, because a field that
  // silently becomes typeable is worse than one that is visibly unavailable.
  const accounts: readonly AccountOption[] = accountsResult.ok ? accountsResult.data.accounts : []
  // Only a memoriaal: an opening balance is a memoriaalpost, and offering the
  // verkoopboek would let somebody file a migration as sales.
  const journals: readonly JournalOption[] = journalsResult.ok
    ? openingJournals(journalsResult.data.journals)
    : []
  const router = useRouter()
  const hydrated = useHydrated()

  const [busy, setBusy] = useState(false)
  const [imported, setImported] = useState<Record<string, unknown> | null>(null)
  // Defaults that match the chart this system ships, so the ordinary case is
  // one field to fill in rather than five. The counter-account is not one of
  // them, on purpose.
  const [openingDate, setOpeningDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [journalCode, setJournalCode] = useState('')
  const [receivableAccount, setReceivableAccount] = useState('1300')
  const [payableAccount, setPayableAccount] = useState('1600')
  const [openingBalanceAccount, setOpeningBalanceAccount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [divisions, setDivisions] = useState<readonly DivisionOption[] | null>(null)
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null)
  const [year, setYear] = useState(String(new Date().getFullYear()))

  const [baseUrl, setBaseUrl] = useState('https://start.exactonline.nl')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  /**
   * The redirect URI, defaulted to this instance's own origin.
   *
   * `null` means nobody has edited it, so it follows the origin. Derived rather
   * than seeded into state from `window`, because the server has no `window`
   * and a value that appears only on the client is a hydration mismatch — the
   * markup differs, React throws the tree away and rebuilds it.
   */
  const [editedRedirect, setEditedRedirect] = useState<string | null>(null)
  const redirectUri = editedRedirect ?? (hydrated ? `${window.location.origin}/exact/callback` : '')

  // Exact will not register a plain-http redirect, and this page is where that
  // is discoverable — rather than in their App Center, where the error is
  // somebody else's. Read from the field rather than from the origin, because
  // the field is what gets sent and somebody may have edited it.
  //
  // Before hydration the field is empty and nothing is claimed either way: a
  // warning rendered on the server about an origin the server cannot see would
  // be the same mismatch in a different place.
  const redirectIsSecure = redirectUri.startsWith('https://')

  if (!connection.ok) {
    return (
      <>
        <PageHeader title={t('exact.title')} />
        <p role="alert" className="text-destructive text-sm">
          {connection.problem.detail}
        </p>
      </>
    )
  }

  const state = connection.data.connection
  const canStoreSecrets = connection.data.canStoreSecrets

  async function run(
    work: () => Promise<{ ok: boolean; problem?: { detail: string }; data?: unknown }>,
    onDone?: (data: unknown) => void,
  ) {
    setBusy(true)
    setError(null)
    setNote(null)
    const result = await work()
    setBusy(false)

    if (!result.ok) {
      setError(result.problem?.detail ?? t('common.unknownError'))
      return
    }
    onDone?.(result.data)
  }

  const connect = () =>
    run(
      () =>
        connectExact({
          data: {
            baseUrl,
            clientId,
            clientSecret,
            redirectUri,
            idempotencyKey: crypto.randomUUID(),
          },
        }),
      (data) => {
        // Exact's own consent screen. Leaving is the only way to get a code,
        // and the state in this URL is what ties the return trip back here.
        const url = (data as { authorizeUrl?: string }).authorizeUrl
        if (url !== undefined) window.location.assign(url)
      },
    )

  const loadDivisions = () =>
    run(listExactDivisions, (data) => {
      setDivisions((data as { divisions: readonly DivisionOption[] }).divisions)
    })

  const choose = (code: number) =>
    run(
      () =>
        chooseExactDivision({ data: { divisionCode: code, idempotencyKey: crypto.randomUUID() } }),
      (data) => {
        const chosen = data as { divisionName: string; cautions: readonly string[] }
        setNote(
          chosen.cautions.length === 0
            ? t('exact.divisionChosen', { name: chosen.divisionName })
            : t('exact.divisionChosenCaution', {
                name: chosen.divisionName,
                cautions: chosen.cautions.map(cautionOf).join(', '),
              }),
        )
        void router.invalidate()
      },
    )

  const runPreview = () =>
    run(
      () => previewExactImport({ data: { year: Number(year) } }),
      (data) => {
        setPreview(data as Record<string, unknown>)
        // A fresh report supersedes whatever the last import said, so the two
        // are never on the screen describing different runs.
        setImported(null)
      },
    )

  // What the journal select actually shows: a single memoriaal needs no choice.
  const effectiveJournal = journalCode === '' ? defaultJournal(journals) : journalCode

  const runImport = () =>
    run(
      () =>
        runExactImport({
          data: {
            year: Number(year),
            openingDate,
            journalCode: effectiveJournal,
            receivableAccount,
            payableAccount,
            openingBalanceAccount,
            idempotencyKey: crypto.randomUUID(),
          },
        }),
      (data) => {
        setImported(data as Record<string, unknown>)
        // The chart, the relations and the ledger all moved.
        void router.invalidate()
      },
    )

  return (
    <>
      <PageHeader
        title={t('exact.title')}
        description={t('exact.intro')}
        actions={
          state?.connected === true ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(disconnectExact, () => void router.invalidate())}
              className="border-border rounded-md border px-3 py-1.5 text-sm"
            >
              {t('exact.disconnect')}
            </button>
          ) : undefined
        }
      />

      {error !== null && (
        <p role="alert" className="text-destructive mb-4 text-sm">
          {error}
        </p>
      )}
      {note !== null && (
        <p role="status" className="mb-4 text-sm">
          {note}
        </p>
      )}

      {/* Stap 1 — de OAuth-app. */}
      {state === null || state.connected !== true ? (
        <section className="border-border mb-8 rounded-md border p-4">
          <h2 className="text-lg font-semibold">{t('exact.step1Connect')}</h2>
          <p className="text-muted-foreground mt-1 mb-4 text-sm">{t('exact.step1Intro')}</p>

          {!canStoreSecrets && (
            <p role="alert" className="text-destructive mb-4 text-sm">
              {t('exact.noEncryptionKey')}
            </p>
          )}

          {hydrated && !redirectIsSecure && (
            <p role="alert" className="text-destructive mb-4 text-sm">
              {t('exact.needsHttps')} <code>pnpm dev:https</code> {t('exact.needsHttpsAfter')}
            </p>
          )}

          {/*
            The fields are disabled until React has taken over. A value typed
            before hydration is discarded when the controlled input takes over,
            and a client secret is the worst thing in here to lose silently.
          */}
          <div className="grid max-w-2xl gap-3">
            <label className="text-sm">
              {t('exact.environment')}
              <input
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                disabled={!hydrated}
                className="border-border mt-1 w-full rounded-md border px-2 py-1.5"
              />
            </label>
            <label className="text-sm">
              {t('exact.clientId')}
              <input
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                disabled={!hydrated}
                className="border-border mt-1 w-full rounded-md border px-2 py-1.5 font-mono"
              />
            </label>
            <label className="text-sm">
              {t('exact.clientSecret')}
              <input
                type="password"
                value={clientSecret}
                onChange={(event) => setClientSecret(event.target.value)}
                disabled={!hydrated}
                className="border-border mt-1 w-full rounded-md border px-2 py-1.5 font-mono"
              />
            </label>
            <label className="text-sm">
              {t('exact.redirectUri')}
              <input
                value={redirectUri}
                onChange={(event) => setEditedRedirect(event.target.value)}
                disabled={!hydrated}
                className="border-border mt-1 w-full rounded-md border px-2 py-1.5 font-mono"
              />
            </label>
            <div>
              <button
                type="button"
                disabled={
                  busy ||
                  !hydrated ||
                  !canStoreSecrets ||
                  !redirectIsSecure ||
                  clientId === '' ||
                  clientSecret === ''
                }
                onClick={() => void connect()}
                className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
              >
                {t('exact.signIn')}
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section className="border-border mb-8 rounded-md border p-4">
          <h2 className="text-lg font-semibold">{t('exact.step1Connected')}</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {state.userName ?? t('exact.unknownUser')} — {state.baseUrl}
            {state.lastImportAt !== null &&
              t('exact.lastImported', { date: formatDate(state.lastImportAt) })}
          </p>
          {state.lastError !== null && (
            <p role="alert" className="text-destructive mt-2 text-sm">
              {state.lastError}
            </p>
          )}
        </section>
      )}

      {/* Stap 2 — welke administratie. De hele reden dat dit een eigen stap is. */}
      {state?.connected === true && (
        <section className="border-border mb-8 rounded-md border p-4">
          <h2 className="text-lg font-semibold">{t('exact.step2')}</h2>
          <p className="text-muted-foreground mt-1 mb-4 text-sm">{t('exact.step2Intro')}</p>

          {state.divisionCode !== null && (
            <p className="mb-4 text-sm">
              {t('exact.chosen')} <strong>{state.divisionName}</strong> ({state.divisionCode})
              {state.divisionCautions.length > 0 && (
                <span className="text-unreconciled">
                  {' '}
                  — {state.divisionCautions.map(cautionOf).join(', ')}
                </span>
              )}
            </p>
          )}

          <button
            type="button"
            disabled={busy}
            onClick={() => void loadDivisions()}
            className="border-border rounded-md border px-3 py-1.5 text-sm"
          >
            {divisions === null ? t('exact.fetchDivisions') : t('exact.fetchAgain')}
          </button>

          {divisions !== null && (
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="border-border border-b text-left">
                  <th className="py-2">{t('exact.division')}</th>
                  <th className="py-2">{t('exact.divisionNumber')}</th>
                  <th className="py-2">{t('exact.divisionVat')}</th>
                  <th className="py-2">{t('exact.caution')}</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {divisions.map((division) => (
                  <tr key={division.code} className="border-border border-b">
                    <td className="py-2">{division.description}</td>
                    <td className="py-2 tabular">{division.code}</td>
                    <td className="py-2 font-mono text-xs">{division.vatNumber ?? '—'}</td>
                    <td className="text-unreconciled py-2">
                      {division.cautions.length === 0
                        ? ''
                        : division.cautions.map(cautionOf).join(', ')}
                    </td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        disabled={busy || state.divisionCode === division.code}
                        onClick={() => void choose(division.code)}
                        className="border-border rounded-md border px-2 py-1 text-xs disabled:opacity-50"
                      >
                        {state.divisionCode === division.code
                          ? t('exact.isChosen')
                          : t('exact.chooseThis')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {/* Stap 3 — de proefimport. */}
      {state?.ready === true && (
        <section className="border-border rounded-md border p-4">
          <h2 className="text-lg font-semibold">{t('exact.step3')}</h2>
          <p className="text-muted-foreground mt-1 mb-4 text-sm">{t('exact.step3Intro')}</p>

          <div className="mb-4 flex items-end gap-3">
            <label className="text-sm">
              {/* "Boekjaar om te importeren" rather than "Boekjaar": the shell
                  carries the book year the screens are read in, and two
                  controls of that name on one page is one too many. */}
              {t('exact.yearToImport')}
              <input
                value={year}
                onChange={(event) => setYear(event.target.value)}
                inputMode="numeric"
                className="border-border mt-1 w-24 rounded-md border px-2 py-1.5 tabular"
              />
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => void runPreview()}
              className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {busy ? t('common.busy') : t('exact.runPreview')}
            </button>
          </div>

          {preview !== null && <PreviewReport report={preview} />}
        </section>
      )}

      {/*
        Step four exists only once a dry run has been read. The import writes a
        chart of accounts, every relation and an opening entry carrying the
        whole debtor and creditor position — committing that from a screen
        nobody has seen a report on is how a migration goes wrong quietly.
      */}
      {state?.ready === true && <DocumentArchive result={documentsResult} />}

      {state?.ready === true && preview !== null && (
        <section className="border-border mt-6 rounded-md border p-4">
          <h2 className="text-lg font-semibold">{t('exact.step4')}</h2>
          <p className="text-muted-foreground mt-1 mb-4 text-sm">{t('exact.step4Intro')}</p>

          {imported === null ? (
            <>
              <div className="mb-4 grid max-w-2xl gap-3 md:grid-cols-2">
                <label className="text-sm">
                  {t('exact.openingDate')}
                  <input
                    type="date"
                    value={openingDate}
                    onChange={(event) => setOpeningDate(event.target.value)}
                    disabled={!hydrated}
                    className="border-border mt-1 w-full rounded-md border px-2 py-1.5"
                  />
                </label>
                <SelectField
                  label={t('exact.journal')}
                  value={effectiveJournal}
                  onValueChange={setJournalCode}
                  disabled={!hydrated}
                >
                  {journals.length === 1 ? null : (
                    <SelectOption value="">{t('exact.chooseJournal')}</SelectOption>
                  )}
                  {journals.map((journal) => (
                    <SelectOption key={journal.code} value={journal.code}>
                      {journal.code} — {journal.name}
                    </SelectOption>
                  ))}
                </SelectField>
                <AccountSelect
                  label={t('exact.receivableAccount')}
                  value={receivableAccount}
                  onChange={setReceivableAccount}
                  accounts={accounts}
                  disabled={!hydrated}
                />
                <AccountSelect
                  label={t('exact.payableAccount')}
                  value={payableAccount}
                  onChange={setPayableAccount}
                  accounts={accounts}
                  disabled={!hydrated}
                />
                <div className="md:col-span-2">
                  <AccountSelect
                    label={t('exact.openingAccount')}
                    value={openingBalanceAccount}
                    onChange={setOpeningBalanceAccount}
                    accounts={accounts}
                    disabled={!hydrated}
                    hint={t('exact.openingAccountHint')}
                  />
                </div>
              </div>

              <button
                type="button"
                disabled={
                  busy ||
                  !hydrated ||
                  openingBalanceAccount === '' ||
                  receivableAccount === '' ||
                  payableAccount === '' ||
                  journalCode === ''
                }
                onClick={() => void runImport()}
                className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
              >
                {busy ? t('common.busy') : t('exact.commit')}
              </button>
            </>
          ) : (
            <ImportResult result={imported} />
          )}
        </section>
      )}
    </>
  )
}

function ImportResult({ result }: { result: Record<string, unknown> }) {
  const { t } = useT()
  const number = (key: string): string => String((result[key] as number | undefined) ?? 0)

  return (
    <div>
      <p role="status" className="mb-4 text-sm">
        {t('exact.imported', {
          accounts: number('accountsCreated'),
          contacts: number('contactsCreated'),
          openItems: number('openItemsImported'),
          receivables: number('receivableCount'),
          payables: number('payableCount'),
        })}
      </p>
      {typeof result['openingEntryId'] === 'string' && (
        <p className="text-muted-foreground text-sm">
          {t('exact.openingIn')}{' '}
          <Link
            to="/entries/$entryId"
            params={{ entryId: result['openingEntryId'] }}
            className="underline"
          >
            {result['openingEntryId'].slice(0, 8)}
          </Link>
          {t('exact.openingInAfter')}
        </p>
      )}
    </div>
  )
}

interface ControlCheck {
  readonly accountCodes: readonly string[]
  /** Null when the proefbalans could not be read. Not zero. */
  readonly ledger: string | null
  readonly openItems: string
  readonly difference: string | null
  readonly outcome: 'matches' | 'differs' | 'no_control_account' | 'not_reconciled'
  readonly itemCount: number
}

interface Reconciliation {
  readonly year: number
  readonly source: 'read' | 'empty' | 'unreadable'
  readonly totalDebit: string | null
  readonly totalCredit: string | null
  readonly balanced: boolean | null
  readonly accountCount: number | null
  readonly orphanAccountCodes: readonly string[]
  readonly receivable: ControlCheck
  readonly payable: ControlCheck
}

/**
 * Het aansluitverslag.
 *
 * Drie vragen, in deze volgorde, omdat de tweede niets waard is als de eerste
 * niet klopt: sluit de proefbalans van Exact zelf, sluiten de openstaande
 * posten aan op de tussenrekeningen, en bestaat elke rekening met een saldo ook
 * in het schema.
 */
function PreviewReport({ report }: { report: Record<string, unknown> }) {
  const { t } = useT()
  const reconciliation = report['reconciliation'] as Reconciliation
  const accounts = report['accounts'] as { count: number; new: number; derived: number }
  const contacts = report['contacts'] as { count: number; new: number }
  const openItems = report['openItems'] as {
    receivable: { count: number; total: string }
    payable: { count: number; total: string }
  }
  const warnings = report['warnings'] as readonly { code: string; message: string }[]
  const problems = report['problems'] as readonly { code: string; message: string }[]
  const requests = (report['requests'] ?? []) as readonly {
    path: string
    status: number
    rows: number
    durationMs: number
  }[]

  return (
    <div>
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        {/*
          Three states, not two. "Niet gelezen" is not "sluit niet": Exact
          refusing to show us the proefbalans says nothing about whether it
          balances, and a warn tone would report our lack of rights as a defect
          in somebody's books.
        */}
        <Stat
          label={t('exact.trialBalanceLabel', { year: String(reconciliation.year) })}
          value={
            reconciliation.source === 'unreadable'
              ? t('exact.notRead')
              : reconciliation.source === 'empty'
                ? t('exact.noBalances')
                : reconciliation.balanced
                  ? t('exact.balances')
                  : t('exact.doesNotBalance')
          }
          tone={
            reconciliation.source !== 'read' ? 'muted' : reconciliation.balanced ? 'good' : 'warn'
          }
          hint={
            reconciliation.source === 'read'
              ? t('exact.debitCredit', {
                  debit: reconciliation.totalDebit ?? '—',
                  credit: reconciliation.totalCredit ?? '—',
                })
              : reconciliation.source === 'unreadable'
                ? t('exact.noAccessToReporting')
                : t('exact.noRowsForYear')
          }
        />
        <Stat
          label={t('exact.ledgerAccounts')}
          value={accounts.count}
          hint={
            accounts.derived > 0
              ? t('exact.newAndDerived', {
                  count: String(accounts.new),
                  derived: String(accounts.derived),
                })
              : t('exact.newCount', { count: String(accounts.new) })
          }
        />
        <Stat
          label={t('exact.contacts')}
          value={contacts.count}
          hint={t('exact.newCount', { count: String(contacts.new) })}
        />
        <Stat
          label={t('exact.outstanding')}
          value={`${openItems.receivable.total} / ${openItems.payable.total}`}
          hint={t('exact.outstandingHint', {
            receivables: String(openItems.receivable.count),
            payables: String(openItems.payable.count),
          })}
        />
      </div>

      <h3 className="mb-2 text-sm font-semibold">{t('exact.openItemsReconciliation')}</h3>
      {reconciliation.source !== 'read' && (
        <p role="status" className="text-muted-foreground mb-2 text-sm">
          {reconciliation.source === 'unreadable'
            ? t('exact.unreadableTrialBalance')
            : t('exact.emptyTrialBalance', { year: String(reconciliation.year) })}{' '}
          {t('exact.reconciliationCaveat')}
        </p>
      )}
      <table className="mb-6 w-full text-sm">
        <thead>
          <tr className="border-border border-b text-left">
            <th className="py-2">{t('exact.side')}</th>
            <th className="py-2">{t('exact.accountsColumn')}</th>
            <th className="py-2 text-right">{t('exact.ledgerColumn')}</th>
            <th className="py-2 text-right">{t('exact.openItemsColumn')}</th>
            <th className="py-2 text-right">{t('exact.differenceColumn')}</th>
          </tr>
        </thead>
        <tbody>
          {(
            [
              ['exact.receivables', reconciliation.receivable],
              ['exact.payables', reconciliation.payable],
            ] as const satisfies readonly (readonly [MessageKey, ControlCheck])[]
          ).map(([label, check]) => (
            <tr key={label} className="border-border border-b">
              <td className="py-2">{t(label)}</td>
              <td className="py-2 font-mono text-xs">
                {check.accountCodes.length === 0
                  ? t('exact.noneFound')
                  : check.accountCodes.join(', ')}
              </td>
              {/*
                An em dash rather than 0,00 where there is no number. A zero
                here would read as "the control account is empty", which is a
                claim about somebody's books that we did not get to look at.
              */}
              <td className="py-2 text-right tabular">{check.ledger ?? '—'}</td>
              <td className="py-2 text-right tabular">{check.openItems}</td>
              <td
                className={`py-2 text-right tabular ${
                  check.outcome === 'differs' ? 'text-unreconciled' : ''
                }`}
              >
                {check.difference ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {problems.length > 0 && (
        <>
          <h3 className="text-destructive mb-2 text-sm font-semibold">
            {t('exact.blocking', { count: String(problems.length) })}
          </h3>
          <ul className="text-destructive mb-6 list-disc pl-5 text-sm">
            {problems.map((problem, index) => (
              <li key={`${problem.code}-${String(index)}`}>{problem.message}</li>
            ))}
          </ul>
        </>
      )}

      {/*
        What the read actually cost. Shown rather than logged because "how many
        requests is this" is the question somebody asks while watching it run —
        and because Exact's daily budget is finite, so a resource that quietly
        pages eighty times is worth seeing.
      */}
      {requests.length > 0 && (
        <details className="mb-6">
          <summary className="cursor-pointer text-sm font-semibold">
            {t('exact.requests', {
              count: String(requests.length),
              rows: String(requests.reduce((sum, entry) => sum + entry.rows, 0)),
              seconds: String(
                Math.round(requests.reduce((sum, entry) => sum + entry.durationMs, 0) / 100) / 10,
              ),
            })}
          </summary>
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="border-border border-b text-left">
                <th className="py-2">{t('exact.resource')}</th>
                <th className="py-2 text-right">{t('exact.statusColumn')}</th>
                <th className="py-2 text-right">{t('exact.rowsColumn')}</th>
                <th className="py-2 text-right">{t('exact.durationColumn')}</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((entry, index) => (
                <tr key={`${entry.path}-${String(index)}`} className="border-border border-b">
                  <td className="py-1 font-mono text-xs">{entry.path}</td>
                  <td
                    className={`py-1 text-right tabular ${
                      entry.status >= 400 ? 'text-destructive' : ''
                    }`}
                  >
                    {String(entry.status)}
                  </td>
                  <td className="py-1 text-right tabular">{String(entry.rows)}</td>
                  <td className="py-1 text-right tabular">{String(entry.durationMs)} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {warnings.length > 0 && (
        <>
          <h3 className="mb-2 text-sm font-semibold">
            {t('exact.warnings', { count: String(warnings.length) })}
          </h3>
          <ul className="text-muted-foreground list-disc pl-5 text-sm">
            {warnings.map((warning, index) => (
              <li key={`${warning.code}-${String(index)}`}>{warning.message}</li>
            ))}
          </ul>
        </>
      )}

      {problems.length === 0 && warnings.length === 0 && (
        <p className="text-muted-foreground text-sm">{t('exact.nothingToReport')}</p>
      )}
    </div>
  )
}

interface DocumentRun {
  readonly requested: boolean
  readonly state?: 'pending' | 'running' | 'paused' | 'done' | 'failed'
  readonly documentsSeen?: number
  readonly attachmentsStored?: number
  readonly attachmentsSkipped?: number
  readonly bytesStored?: string
  readonly lastError?: string | null
  /** Requested a while ago and never claimed: the worker is probably not up. */
  readonly workerSilent?: boolean
}

const RUN_KEY: Record<string, MessageKey> = {
  pending: 'docs.run.pending',
  running: 'docs.run.running',
  paused: 'docs.run.paused',
  done: 'docs.run.done',
  failed: 'docs.run.failed',
}

/**
 * Het documentarchief overhalen.
 *
 * Een aparte stap, want het is een ander soort werk: tien jaar gescande
 * facturen zijn tienduizenden bestanden achter een daglimiet, dus dit draait op
 * de achtergrond en gaat verder waar het gebleven was.
 */
function DocumentArchive({ result }: { result: { ok: boolean; data?: unknown } }) {
  const router = useRouter()
  const hydrated = useHydrated()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { t } = useT()

  /** An unrecognised state is shown raw rather than as a blank. */
  const runOf = (state: string) => {
    const key = RUN_KEY[state]
    return key === undefined ? state : t(key)
  }

  if (!result.ok) return null
  const run = result.data as DocumentRun

  const start = async () => {
    setBusy(true)
    setError(null)
    const response = await importExactDocuments({ data: { idempotencyKey: crypto.randomUUID() } })
    setBusy(false)
    if (response.ok === false) {
      setError(response.problem?.detail ?? t('common.unknownError'))
      return
    }
    await router.invalidate()
  }

  const running = run.requested && run.state !== 'done' && run.state !== 'failed'

  return (
    <section className="border-border mt-6 rounded-md border p-4">
      <h2 className="text-lg font-semibold">{t('docs.title')}</h2>
      <p className="text-muted-foreground mt-1 mb-4 max-w-2xl text-sm">{t('docs.intro')}</p>

      {error !== null && (
        <p role="alert" className="text-destructive mb-4 text-sm">
          {error}
        </p>
      )}

      {run.workerSilent === true && (
        <p role="alert" className="text-destructive mb-4 text-sm">
          {t('docs.workerSilent')} <code>pnpm run dev</code> {t('docs.workerSilentMiddle')}{' '}
          <code>pnpm run dev:worker</code>.
        </p>
      )}

      {run.requested && (
        <p className="mb-4 text-sm">
          {t('docs.status')} <strong>{runOf(run.state ?? '')}</strong>
          {t('docs.storedAndSkipped', {
            stored: String(run.attachmentsStored ?? 0),
            skipped: String(run.attachmentsSkipped ?? 0),
          })}
          {run.lastError != null && (
            <span className="text-muted-foreground block text-xs">{run.lastError}</span>
          )}
        </p>
      )}

      <button
        type="button"
        disabled={busy || !hydrated}
        onClick={() => void start()}
        className="border-border rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
      >
        {busy ? t('common.busy') : running ? t('docs.refresh') : t('docs.fetch')}
      </button>
    </section>
  )
}
