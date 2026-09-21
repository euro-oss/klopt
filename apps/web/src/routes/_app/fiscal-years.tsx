import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { PageHeader, Stat } from '~/components/app-shell'
import { AccountPicker } from '~/components/finance/account-picker'
import { LedgerTable, type Column } from '~/components/finance/ledger-table'
import { Money } from '~/components/finance/money'
import { SelectField, SelectOption } from '~/components/ui/select-field'
import { violationMessage } from '~/i18n/labels'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'
import { defaultJournal, equityAccounts, openingJournals } from '~/lib/account-options'
import {
  dayAfter,
  hasYearAfter,
  latestFiscalYear,
  nextFiscalYear,
  plannedFiscalYear,
  startingMonth,
  type FiscalYearOption,
} from '~/lib/fiscal-year'
import { formatDate } from '~/lib/format'
import { useHydrated } from '~/lib/hydration'
import { closeYear, listAccounts, listJournals } from '~/server/ledger'
import { createFiscalYear, listFiscalYears } from '~/server/setup'

/**
 * Boekjaren — what is open, what comes next, and closing one.
 *
 * `POST /fiscal-years` and `POST /fiscal-years/close` have been implemented,
 * tested and exposed over REST since M2 and reachable only from a terminal
 * (docs/ALPHA_ASSESSMENT.md §3.1). A bookkeeper whose year rolled over could
 * not post into the new one without operator help, which is an odd thing to
 * hand somebody along with "these are your books".
 *
 * The two live on one screen because they are one act done in a particular
 * order: the year that follows has to exist before the year before it can carry
 * its balances forward, and that order is the thing people get wrong. So the
 * screen says so, in the place where it matters, with the year that is missing
 * named and one button to open it.
 *
 * ## Nothing is posted before it is shown
 *
 * `closeYear` takes `dryRun`, and the response shape is the same either way —
 * deliberately, per the handler: "that branch is exactly where a preview gets
 * mistaken for a receipt". So this screen always runs the dry run first and
 * shows the two entries line by line. A close is two ordinary journal entries
 * and there is no reopen operation, by design (`manifest.ts`: "a close is two
 * ordinary entries, and undoing it is a reversal like any other"), which is
 * what the acknowledgement says in as many words.
 *
 * ## How "already closed" is known
 *
 * `GET /fiscal-years` reports a `status` the close does not write to: closing a
 * year records a row in `year_closes`, and the only thing that reads it is
 * `rgs.findOpenClose`, which `POST /fiscal-years/close` consults before it does
 * anything — including on a dry run. So the dry run *is* the question "is this
 * year closed", and a `conflict` is its answer, carrying the API's own sentence.
 * Asking it that way needs no new endpoint; the alternative is a read-side
 * enrichment, which Product deferred for the alpha.
 */
export const Route = createFileRoute('/_app/fiscal-years')({
  loader: async () => {
    const [years, accounts, journals] = await Promise.all([
      listFiscalYears(),
      listAccounts(),
      listJournals(),
    ])
    return { years, accounts, journals }
  },
  component: FiscalYears,
})

interface YearRow extends FiscalYearOption {
  readonly periods: readonly { readonly sequence: number; readonly status: string }[]
}

/**
 * What the close reports, dry run or not — one shape, deliberately, and read
 * off the operation rather than described again here.
 *
 * Writing the fields out would be a second copy of the response schema to keep
 * in step, and the first thing to drift would be a field this screen does not
 * render.
 */
type CloseAnswer = Awaited<ReturnType<typeof closeYear>>
type ClosePlan = Extract<CloseAnswer, { ok: true }>['data']
type Problem = Extract<CloseAnswer, { ok: false }>['problem']

const STATUS_KEY: Record<string, MessageKey> = {
  open: 'fiscalYears.status.open',
  closed: 'fiscalYears.status.closed',
}

const PERIOD_STATUS_KEY: Record<string, MessageKey> = {
  open: 'fiscalYears.period.open',
  soft_closed: 'fiscalYears.period.softClosed',
  hard_closed: 'fiscalYears.period.hardClosed',
}

/** Today, as the books write it. Read once per render rather than per row. */
function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * The year a bookkeeper opening this screen means to close.
 *
 * The most recent one that has finished, because a year still running is not a
 * year anybody closes. Falls back to the latest there is, so the field is never
 * empty on an administration whose years all lie ahead.
 */
function yearToClose(years: readonly FiscalYearOption[], now: string): string {
  const ended = years.filter((year) => year.endsOn < now)
  const candidate =
    ended.length > 0
      ? ended.reduce((latest, year) => (year.endsOn > latest.endsOn ? year : latest))
      : latestFiscalYear(years)
  return candidate?.code ?? ''
}

function FiscalYears() {
  const { years, accounts, journals } = Route.useLoaderData()
  const { t } = useT()

  if (!years.ok) {
    return (
      <>
        <PageHeader title={t('fiscalYears.title')} />
        <p role="alert" className="text-destructive text-sm">
          {years.problem.detail}
        </p>
      </>
    )
  }

  const rows = years.data.fiscalYears as readonly YearRow[]
  const now = today()

  const columns: readonly Column<YearRow>[] = [
    {
      key: 'code',
      header: t('fiscalYears.year'),
      width: '6rem',
      cell: (row) => <span className="tabular">{row.code}</span>,
    },
    {
      key: 'range',
      header: t('fiscalYears.range'),
      cell: (row) => (
        <span className="tabular">
          {formatDate(row.startsOn)} – {formatDate(row.endsOn)}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('fiscalYears.statusHeader'),
      width: '8rem',
      cell: (row) => {
        const key = STATUS_KEY[row.status]
        return key === undefined ? row.status : t(key)
      },
    },
    {
      key: 'periods',
      header: t('fiscalYears.periods'),
      width: '14rem',
      cell: (row) => {
        const counts = new Map<string, number>()
        for (const period of row.periods)
          counts.set(period.status, (counts.get(period.status) ?? 0) + 1)

        return (
          <span className="text-muted-foreground text-xs">
            {[...counts]
              .map(([status, count]) => {
                const key = PERIOD_STATUS_KEY[status]
                return `${String(count)} ${key === undefined ? status : t(key)}`
              })
              .join(' · ')}
          </span>
        )
      },
    },
    {
      key: 'current',
      header: '',
      width: '7rem',
      cell: (row) =>
        row.startsOn <= now && now <= row.endsOn ? (
          <span className="bg-primary/15 px-1.5 py-0.5 text-xs">{t('fiscalYears.current')}</span>
        ) : null,
    },
  ]

  return (
    <>
      <PageHeader title={t('fiscalYears.title')} description={t('fiscalYears.intro')} />

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat label={t('fiscalYears.count')} value={String(rows.length)} />
        <Stat
          label={t('fiscalYears.firstDay')}
          value={
            <span className="tabular">
              {rows.length === 0
                ? '—'
                : formatDate(
                    rows.reduce(
                      (first, row) => (row.startsOn < first ? row.startsOn : first),
                      '9999',
                    ),
                  )}
            </span>
          }
        />
        <Stat
          label={t('fiscalYears.lastDay')}
          value={
            <span className="tabular">
              {rows.length === 0
                ? '—'
                : formatDate(
                    rows.reduce((last, row) => (row.endsOn > last ? row.endsOn : last), ''),
                  )}
            </span>
          }
        />
      </div>

      <LedgerTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.code}
        caption={t('fiscalYears.caption')}
        empty={t('fiscalYears.empty')}
      />

      <OpenNextYear years={rows} />

      <CloseYear
        years={rows}
        accounts={accounts.ok ? accounts.data.accounts : []}
        journals={journals.ok ? journals.data.journals : []}
        now={now}
      />
    </>
  )
}

/**
 * Opening the next book year.
 *
 * One field, because the operation takes one: a four-digit label. The dates
 * follow from the administration's own starting month and are shown rather than
 * asked for — a date input the server ignores is a date input that lies, and
 * this is the screen where somebody would most reasonably believe it.
 */
function OpenNextYear({ years }: { years: readonly FiscalYearOption[] }) {
  const { t } = useT()
  const router = useRouter()
  const hydrated = useHydrated()

  const suggestion = nextFiscalYear(years)
  const latest = latestFiscalYear(years)

  const [code, setCode] = useState(suggestion?.code ?? '')
  const [busy, setBusy] = useState(false)
  const [problems, setProblems] = useState<readonly string[] | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  /** What the server will make of what has been typed, while it is being typed. */
  const planned =
    /^\d{4}$/.test(code.trim()) && latest !== undefined
      ? plannedFiscalYear(code.trim(), startingMonth(latest))
      : null

  const alreadyThere = years.some((year) => year.code === code.trim())

  async function create(): Promise<void> {
    setBusy(true)
    setProblems(null)
    setNotice(null)

    const result = await createFiscalYear({ data: { code: code.trim() } })
    setBusy(false)

    if (!result.ok) {
      setProblems(
        result.problem.violations.length > 0
          ? result.problem.violations.map((violation) => violationMessage(t, violation))
          : [result.problem.detail],
      )
      return
    }

    setNotice(
      result.data.created
        ? t('fiscalYears.opened', {
            year: result.data.code,
            from: formatDate(result.data.startsOn),
            to: formatDate(result.data.endsOn),
          })
        : t('fiscalYears.alreadyOpen', { year: result.data.code }),
    )
    // The shell's year picker and every report read the same list, so the new
    // year has to appear there too — which it does by reloading it rather than
    // by this screen telling anybody about it.
    await router.invalidate()
  }

  return (
    <section className="border-border mt-8 border p-4">
      <h2 className="text-base font-medium">{t('fiscalYears.openTitle')}</h2>
      <p className="text-muted-foreground mt-1 text-sm">{t('fiscalYears.openBody')}</p>

      <div className="mt-4 flex max-w-2xl flex-wrap items-end gap-4">
        <label className="block">
          <span className="text-muted-foreground mb-1 block text-xs font-medium">
            {t('fiscalYears.code')}
          </span>
          <input
            type="text"
            inputMode="numeric"
            // Four digits is the whole field. `maxLength` rather than a number
            // input: a spinner on a year is furniture, and a year is a label.
            maxLength={4}
            value={code}
            onChange={(event) => {
              setCode(event.currentTarget.value)
            }}
            className="border-input bg-background w-28 border px-3 py-2 tabular text-sm"
          />
        </label>

        <div className="text-sm">
          <span className="text-muted-foreground mb-1 block text-xs font-medium">
            {t('fiscalYears.derivedDates')}
          </span>
          <span className="tabular" data-testid="derived-dates">
            {planned === null
              ? '—'
              : `${formatDate(planned.startsOn)} – ${formatDate(planned.endsOn)}`}
          </span>
        </div>

        <button
          type="button"
          disabled={!hydrated || busy || planned === null || alreadyThere}
          onClick={() => {
            void create()
          }}
          className="bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {busy ? t('common.busy') : t('fiscalYears.open')}
        </button>
      </div>

      {alreadyThere && (
        <p className="text-muted-foreground mt-3 text-sm">
          {t('fiscalYears.alreadyOpen', { year: code.trim() })}
        </p>
      )}

      {problems !== null && (
        <ul role="alert" className="text-destructive mt-3 space-y-1 text-sm">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}

      {notice !== null && (
        <p className="border-border text-muted-foreground mt-3 border p-3 text-sm">{notice}</p>
      )}
    </section>
  )
}

/**
 * Closing a book year.
 *
 * Three steps and none of them can be skipped: choose the year and where the
 * result goes, read the two entries that would be posted, then say out loud
 * that this is not reversible here. The last one is a checkbox rather than a
 * modal, following the BTW-aangifte — a dialogue that appears on the way to a
 * button is read as an obstacle, and a checkbox beside the button is read.
 */
function CloseYear({
  years,
  accounts,
  journals,
  now,
}: {
  years: readonly FiscalYearOption[]
  accounts: readonly {
    number: string
    name: string
    type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
    isBlocked: boolean
  }[]
  journals: readonly { code: string; name: string; type: string }[]
  now: string
}) {
  const { t } = useT()
  const router = useRouter()
  const hydrated = useHydrated()

  const memoriaal = openingJournals(
    journals as readonly { code: string; name: string; type: 'memoriaal' }[],
  )
  const equity = equityAccounts(accounts)

  const [code, setCode] = useState(() => yearToClose(years, now))
  const [resultAccountNumber, setResultAccountNumber] = useState('')
  const [journalCode, setJournalCode] = useState(() =>
    defaultJournal(journals as readonly { code: string; name: string; type: 'memoriaal' }[]),
  )
  const [carryForward, setCarryForward] = useState(true)
  const [plan, setPlan] = useState<ClosePlan | null>(null)
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problems, setProblems] = useState<readonly string[] | null>(null)
  /** The API's sentence for a year that is already closed. */
  const [closed, setClosed] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  /** One key per attempt: a confirm clicked twice closes the year once. */
  const closeKey = useRef(crypto.randomUUID())

  const chosen = years.find((year) => year.code === code) ?? null

  /**
   * Whether the balances have anywhere to land.
   *
   * The close refuses to carry them forward when no period contains the day
   * after the year ends, and it refuses before it posts anything. Working the
   * same thing out here means the screen can offer the year that is missing
   * instead of only repeating the refusal — and it is the reason the year to
   * open and the year to close share one screen.
   *
   * Two conditions rather than one: the year that is missing is a *fact*, and
   * only being stopped by it depends on still wanting an opening balance. Making
   * the panel itself depend on `carryForward` meant that ticking "close without
   * one" unmounted the checkbox that had just been ticked, which is a control
   * that vanishes when it is used.
   */
  const noNextYear = chosen !== null && !hasYearAfter(years, chosen)
  const blocked = noNextYear && carryForward
  const openingDate = chosen === null ? null : dayAfter(chosen.endsOn)

  function reset(): void {
    setPlan(null)
    setAck(false)
    setProblems(null)
    setClosed(null)
    setNotice(null)
  }

  function fail(problem: Problem): void {
    setPlan(null)
    setAck(false)

    // A year that is already closed is not a form error. It is the state of the
    // books, and the screen stops offering the action rather than inviting a
    // second attempt that will fail the same way.
    if (problem.code === 'conflict') {
      setClosed(problem.detail)
      return
    }

    setProblems(
      problem.violations.length > 0
        ? problem.violations.map((violation) => violationMessage(t, violation))
        : [problem.detail],
    )
  }

  async function preview(): Promise<void> {
    setBusy(true)
    reset()

    const result = await closeYear({
      data: {
        idempotencyKey: closeKey.current,
        fiscalYear: code,
        resultAccountNumber,
        ...(journalCode === '' ? {} : { journalCode }),
        carryForward,
        dryRun: true,
      },
    })
    setBusy(false)

    if (!result.ok) {
      fail(result.problem)
      return
    }
    setPlan(result.data)
  }

  async function commit(): Promise<void> {
    setBusy(true)
    setProblems(null)

    const result = await closeYear({
      data: {
        idempotencyKey: closeKey.current,
        fiscalYear: code,
        resultAccountNumber,
        ...(journalCode === '' ? {} : { journalCode }),
        carryForward,
        dryRun: false,
      },
    })
    setBusy(false)

    if (!result.ok) {
      fail(result.problem)
      return
    }

    // A fresh key: the next close is a different act, not a retry of this one.
    closeKey.current = crypto.randomUUID()
    setPlan(null)
    setAck(false)
    setNotice(t('fiscalYears.closedNotice', { year: code }))
    await router.invalidate()
  }

  const ready = code !== '' && resultAccountNumber !== ''

  return (
    <section className="border-border mt-8 border p-4">
      <h2 className="text-base font-medium">{t('fiscalYears.closeTitle')}</h2>
      <p className="text-muted-foreground mt-1 text-sm">{t('fiscalYears.closeBody')}</p>

      <div className="mt-4 grid max-w-3xl gap-4 sm:grid-cols-3">
        <SelectField
          label={t('fiscalYears.yearToClose')}
          value={code}
          onValueChange={(next) => {
            setCode(next)
            reset()
          }}
          disabled={!hydrated}
          placeholder={t('fiscalYears.pickYear')}
        >
          {years.map((year) => (
            <SelectOption key={year.code} value={year.code}>
              {`${year.code} (${formatDate(year.startsOn)} – ${formatDate(year.endsOn)})`}
            </SelectOption>
          ))}
        </SelectField>

        <AccountPicker
          label={t('fiscalYears.resultAccount')}
          accounts={equity}
          value={resultAccountNumber}
          onValueChange={(next) => {
            setResultAccountNumber(next)
            reset()
          }}
          disabled={!hydrated}
          hint={t('fiscalYears.resultAccountHint')}
        />

        <SelectField
          label={t('fiscalYears.journal')}
          value={journalCode}
          onValueChange={(next) => {
            setJournalCode(next)
            reset()
          }}
          disabled={!hydrated}
          placeholder={t('fiscalYears.pickJournal')}
        >
          {memoriaal.map((journal) => (
            <SelectOption key={journal.code} value={journal.code}>
              {`${journal.code} — ${journal.name}`}
            </SelectOption>
          ))}
        </SelectField>
      </div>

      {closed !== null && (
        <p role="status" className="border-border mt-4 border p-3 text-sm">
          {closed}
        </p>
      )}

      {/* The year that has to exist first, and the two honest ways past it. */}
      {noNextYear && chosen !== null && closed === null && (
        <div className="border-border mt-4 border border-dashed p-3">
          <p className="text-sm">
            {t('fiscalYears.blocked', {
              year: chosen.code,
              date: formatDate(openingDate ?? ''),
            })}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-4">
            <InlineOpenNext years={years} />

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={!carryForward}
                onChange={(event) => {
                  setCarryForward(!event.target.checked)
                  reset()
                }}
                className="mt-0.5"
              />
              <span>{t('fiscalYears.withoutCarryForward')}</span>
            </label>
          </div>
        </div>
      )}

      {!carryForward && closed === null && (
        <p className="text-unreconciled mt-3 text-sm">{t('fiscalYears.noOpeningBalance')}</p>
      )}

      {closed === null && (
        <button
          type="button"
          disabled={!hydrated || busy || !ready || blocked}
          onClick={() => {
            void preview()
          }}
          className="border-input mt-4 border px-4 py-2 text-sm disabled:opacity-50"
        >
          {busy && plan === null ? t('common.busy') : t('fiscalYears.showPlan')}
        </button>
      )}

      {problems !== null && (
        <ul role="alert" className="text-destructive mt-3 space-y-1 text-sm">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}

      {notice !== null && (
        <p className="border-border text-muted-foreground mt-3 border p-3 text-sm">{notice}</p>
      )}

      {plan !== null && (
        <div className="border-border mt-4 border p-4">
          <h3 className="text-sm font-medium">{t('fiscalYears.wouldPost', { year: code })}</h3>

          <dl className="mt-3 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground text-xs">{t('fiscalYears.result')}</dt>
              <dd>
                <Money amount={plan.result} /> {plan.currency}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">{t('fiscalYears.plAccounts')}</dt>
              <dd className="tabular">{String(plan.profitAndLossAccounts)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">{t('fiscalYears.bsAccounts')}</dt>
              <dd className="tabular">{String(plan.balanceSheetAccounts)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">{t('fiscalYears.openingDate')}</dt>
              <dd className="tabular">
                {carryForward && openingDate !== null ? formatDate(openingDate) : '—'}
              </dd>
            </div>
          </dl>

          <PlannedEntry
            title={t('fiscalYears.appropriation', { year: code })}
            lines={plan.appropriationLines}
          />
          <PlannedEntry title={t('fiscalYears.openingBalance')} lines={plan.openingLines} />

          {/* The acknowledgement, in the words Product locked: it says what is
              posted and that nothing on this screen takes it back. */}
          <div className="border-border mt-4 border border-dashed p-3">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={ack}
                onChange={(event) => {
                  setAck(event.target.checked)
                }}
                className="mt-0.5"
              />
              <span>{t('fiscalYears.ack')}</span>
            </label>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              disabled={!hydrated || busy || !ack}
              onClick={() => {
                void commit()
              }}
              className="bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {busy ? t('common.busy') : t('fiscalYears.close')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={reset}
              className="border-input border px-4 py-2 text-sm disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

/** Opening the year the close is waiting for, without leaving the close. */
function InlineOpenNext({ years }: { years: readonly FiscalYearOption[] }) {
  const { t } = useT()
  const router = useRouter()
  const hydrated = useHydrated()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const suggestion = nextFiscalYear(years)
  if (suggestion === null) return null
  const code = suggestion.code

  async function create(): Promise<void> {
    setBusy(true)
    setError(null)
    const result = await createFiscalYear({ data: { code } })
    setBusy(false)
    if (!result.ok) {
      setError(result.problem.detail)
      return
    }
    await router.invalidate()
  }

  return (
    <span>
      <button
        type="button"
        disabled={!hydrated || busy}
        onClick={() => {
          void create()
        }}
        className="bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium disabled:opacity-50"
      >
        {busy ? t('common.busy') : t('fiscalYears.openNow', { year: code })}
      </button>
      {error !== null && (
        <span role="alert" className="text-destructive ml-2 text-sm">
          {error}
        </span>
      )}
    </span>
  )
}

/**
 * One of the two entries, line by line.
 *
 * Not a summary. "Two entries totalling €40.000" is the sentence somebody
 * agrees to without reading; the account numbers are what makes it checkable
 * against the proefbalans they already have open.
 */
function PlannedEntry({
  title,
  lines,
}: {
  title: string
  lines: readonly { accountNumber: string; debit: string; credit: string }[]
}) {
  const { t } = useT()

  return (
    <div className="mt-4">
      <h4 className="text-muted-foreground text-xs font-medium">{title}</h4>
      {lines.length === 0 ? (
        <p className="text-muted-foreground mt-1 text-sm">{t('fiscalYears.nothingToPost')}</p>
      ) : (
        <table className="mt-1 w-full border-collapse text-sm">
          <thead>
            <tr className="border-border border-b">
              <th scope="col" className="text-muted-foreground px-3 py-1 text-left font-medium">
                {t('fiscalYears.account')}
              </th>
              <th scope="col" className="text-muted-foreground px-3 py-1 text-right font-medium">
                {t('fiscalYears.debit')}
              </th>
              <th scope="col" className="text-muted-foreground px-3 py-1 text-right font-medium">
                {t('fiscalYears.credit')}
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={`${line.accountNumber}-${line.debit}-${line.credit}`}>
                <td className="px-3 py-1 tabular">{line.accountNumber}</td>
                <td className="px-3 py-1 text-right">
                  <Money amount={line.debit} format={{ negative: 'minus', showZero: false }} />
                </td>
                <td className="px-3 py-1 text-right">
                  <Money amount={line.credit} format={{ negative: 'minus', showZero: false }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
