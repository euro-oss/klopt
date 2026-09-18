import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { violationMessage } from '~/i18n/labels'
import { useCallback, useEffect, useRef, useState } from 'react'
import { PageHeader } from '~/components/app-shell'
import { AccountPicker } from '~/components/finance/account-picker'
import { Money } from '~/components/finance/money'
import { SelectField, SelectOption } from '~/components/ui/select-field'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'
import { deleteLineIsOurs, whyNotPostable, type NotPostable } from '~/lib/entry-form'
import { formatMinorUnits, parseMinorUnits } from '~/lib/format'
import { useHydrated } from '~/lib/hydration'
import { isApple } from '~/lib/keyboard'
import { cn } from '~/lib/utils'
import { listAccounts, listJournals, postEntry } from '~/server/ledger'

/**
 * Manual journal entry — the screen the keyboard map was written for.
 *
 * "Every entry screen submits and creates the next row without touching the
 * mouse" (spec 11.3), and the performance budget is under 100 ms to interactive
 * on a saved line (spec 12). So line editing is entirely client-side state with
 * no round trip; the server is touched exactly once, when the entry is posted.
 *
 * The keys are in docs/keyboard-map.md, and all of them are real here:
 *
 * - `Cmd`/`Ctrl`+`↵` posts, `Cmd`/`Ctrl`+`⇧`+`↵` posts and starts another in
 *   the same dagboek. Both show what they are about to do first, because
 *   posting is irreversible and principle 4 says an irreversible act asks.
 * - `Cmd`/`Ctrl`+`D` duplicates the line the cursor is on, which is how a
 *   twelve-line allocation gets typed once.
 * - `Cmd`/`Ctrl`+`⌫` removes it — but only where the browser would not have
 *   done something with the key itself (see `~/lib/entry-form`).
 * - `=` in an amount fills in whatever makes the entry balance, which is the
 *   last line of almost every manual entry and where transposition errors get
 *   in.
 *
 * The dagboek comes from `listJournals` rather than a list of four codes in
 * this file: the four were `MEM/VRK/INK/BNK`, which omits the kasboek and every
 * dagboek anybody has added since.
 */

export const Route = createFileRoute('/_app/entries/new')({
  loader: async () => ({ accounts: await listAccounts(), journals: await listJournals() }),
  component: NewEntry,
})

interface DraftLine {
  readonly key: string
  accountNumber: string
  description: string
  debit: string
  credit: string
}

/** The dagboek a manual entry belongs in, when the books have one. */
const MEMORIAAL = 'memoriaal'

function emptyLine(): DraftLine {
  return { key: crypto.randomUUID(), accountNumber: '', description: '', debit: '', credit: '' }
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

const WHY: Record<NotPostable, MessageKey> = {
  journal: 'entryNew.whyJournal',
  description: 'entryNew.whyDescription',
  lines: 'entryNew.whyLines',
  balance: 'entryNew.whyBalance',
}

function NewEntry() {
  const { accounts: accountsResult, journals: journalsResult } = Route.useLoaderData()
  const navigate = useNavigate()
  const { t } = useT()

  const accounts = accountsResult.ok ? accountsResult.data.accounts : []
  const journals = journalsResult.ok ? journalsResult.data.journals : []
  const defaultJournal =
    journals.find((journal) => journal.type === MEMORIAAL)?.code ?? journals[0]?.code ?? ''

  const [journalCode, setJournalCode] = useState<string>(defaultJournal)
  const [bookingDate, setBookingDate] = useState(today)
  /**
   * The date on the paper, which is not always the date it is booked on.
   *
   * It follows the boekdatum until somebody says otherwise, because for most
   * entries they are the same day and asking twice is asking somebody to
   * confirm a fact. An invoice received in January and booked in February is
   * the case this exists for.
   */
  const [documentDate, setDocumentDate] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [lines, setLines] = useState<DraftLine[]>(() => [emptyLine(), emptyLine()])
  const [problems, setProblems] = useState<{ path: string | null; message: string }[]>([])
  const [posting, setPosting] = useState(false)
  /** The confirmation, and whether it was asked for by the post-and-next key. */
  const [confirming, setConfirming] = useState<{ startAnother: boolean } | null>(null)
  const [announcement, setAnnouncement] = useState('')

  const formRef = useRef<HTMLFormElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  /**
   * The amount fields are controlled and parsed as they are typed, so before
   * hydration anything entered is discarded and the submit reloads the page.
   * Same reasoning as the sign-in screen: half-working is the worst state.
   */
  const hydrated = useHydrated()

  const parsed = lines.map((line) => ({
    debit: parseMinorUnits(line.debit) ?? 0n,
    credit: parseMinorUnits(line.credit) ?? 0n,
  }))
  const totalDebit = parsed.reduce((total, line) => total + line.debit, 0n)
  const totalCredit = parsed.reduce((total, line) => total + line.credit, 0n)
  const difference = totalDebit - totalCredit
  const booked = lines.filter((line) => line.accountNumber !== '')

  const refusal = whyNotPostable({
    lineCount: booked.length,
    difference,
    description,
    journalCode,
  })

  const update = useCallback((index: number, patch: Partial<DraftLine>) => {
    setLines((current) =>
      current.map((line, position) => (position === index ? { ...line, ...patch } : line)),
    )
  }, [])

  const addLine = useCallback(() => {
    setLines((current) => [...current, emptyLine()])
  }, [])

  /**
   * `=` fills the amount that balances the entry. The difference is computed
   * from every *other* line, so pressing it twice does not compound.
   */
  const balancingAmount = useCallback(
    (index: number, side: 'debit' | 'credit'): string => {
      let others = 0n
      lines.forEach((line, position) => {
        if (position === index) return
        others += (parseMinorUnits(line.debit) ?? 0n) - (parseMinorUnits(line.credit) ?? 0n)
      })
      const needed = side === 'debit' ? -others : others
      return needed > 0n ? formatMinorUnits(needed) : ''
    },
    [lines],
  )

  /**
   * One key per attempt at posting, held until that attempt succeeds.
   *
   * This is what makes a double click, or an impatient second `Cmd`+`Enter`,
   * post once rather than twice. It is regenerated after a successful post and
   * kept across a failed one, because a retry of a rejected entry is the same
   * intent — see spec 10.2.
   */
  const idempotencyKey = useRef<string>(crypto.randomUUID())

  const submit = useCallback(
    async (startAnother: boolean) => {
      setPosting(true)
      setProblems([])

      const result = await postEntry({
        data: {
          idempotencyKey: idempotencyKey.current,
          journalCode,
          bookingDate,
          documentDate: documentDate ?? bookingDate,
          description,
          lines: lines
            .filter((line) => line.accountNumber !== '')
            .map((line) => ({
              accountNumber: line.accountNumber,
              description: line.description === '' ? null : line.description,
              debit: (parseMinorUnits(line.debit) ?? 0n).toString(),
              credit: (parseMinorUnits(line.credit) ?? 0n).toString(),
            })),
        },
      })

      setPosting(false)
      setConfirming(null)

      if (!result.ok) {
        setProblems(
          result.problem.violations.length > 0
            ? result.problem.violations.map((violation) => ({
                path: violation.path,
                message: violationMessage(t, violation),
              }))
            : [{ path: null, message: result.problem.detail }],
        )
        return
      }

      idempotencyKey.current = crypto.randomUUID()

      if (startAnother) {
        // Flow is the whole point: same journal, same date, empty lines, focus
        // back at the top.
        setDescription('')
        setLines([emptyLine(), emptyLine()])
        formRef.current?.querySelector<HTMLInputElement>('input[name="description"]')?.focus()
        return
      }

      await navigate({ to: '/entries/$entryId', params: { entryId: result.data.entry.id } })
    },
    [bookingDate, description, documentDate, journalCode, lines, navigate, t],
  )

  /**
   * Ask before posting.
   *
   * `Cmd`+`Enter` does not post: it shows what it is about to post and puts the
   * cursor on the button that does. That is the one thing docs/keyboard-map.md
   * says about this key — an irreversible act shows what it is about to do —
   * and it is the same path the button takes, so there is one truth about when
   * an entry can be posted rather than two.
   */
  const ask = useCallback(
    (startAnother: boolean) => {
      if (posting) return
      if (refusal !== null) {
        setConfirming(null)
        setProblems([{ path: null, message: t(WHY[refusal]) }])
        return
      }
      setProblems([])
      setConfirming({ startAnother })
    },
    [posting, refusal, t],
  )

  useEffect(() => {
    if (confirming !== null) confirmRef.current?.focus()
  }, [confirming])

  /** The line the cursor is in, from the row the focused field sits in. */
  function focusedLine(target: EventTarget | null): number | null {
    if (!(target instanceof HTMLElement)) return null
    const row = target.closest('tr[data-line]')
    const index = Number(row?.getAttribute('data-line'))
    return Number.isInteger(index) ? index : null
  }

  function duplicateLine(index: number): void {
    setLines((current) => {
      const line = current[index]
      if (line === undefined) return current
      const copy = { ...line, key: crypto.randomUUID() }
      return [...current.slice(0, index + 1), copy, ...current.slice(index + 1)]
    })
    setAnnouncement(t('entryNew.lineDuplicated', { line: String(index + 1) }))
  }

  function removeLine(index: number): void {
    setLines((current) => {
      // An entry has two sides, so the form never drops below two rows: the
      // last two are emptied rather than removed, which is what somebody
      // clearing a mistake means anyway.
      if (current.length <= 2)
        return current.map((line, position) => (position === index ? emptyLine() : line))
      return current.filter((_, position) => position !== index)
    })
    setAnnouncement(t('entryNew.lineDeleted', { line: String(index + 1) }))
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const mod = isApple() ? event.metaKey : event.ctrlKey
    if (!mod) return
    // Holding a shortcut down is one intent, not forty.
    if (event.repeat) return

    if (event.key === 'Enter') {
      event.preventDefault()
      // Pressed again while the confirmation is up, it confirms: the summary
      // has been on screen since the first press, which is what being asked
      // means. Two deliberate keystrokes, no mouse, nothing posted by accident.
      if (confirming !== null) void submit(confirming.startAnother)
      else ask(event.shiftKey)
      return
    }

    const line = focusedLine(event.target)
    if (line === null) return

    if (event.key.toLowerCase() === 'd') {
      event.preventDefault()
      duplicateLine(line)
      return
    }

    if (event.key === 'Backspace') {
      const field = event.target instanceof HTMLInputElement ? event.target : null
      const ours = deleteLineIsOurs({
        editable: field !== null,
        value: field?.value ?? '',
        selectionStart: field?.selectionStart ?? 0,
        selectionEnd: field?.selectionEnd ?? 0,
      })
      if (!ours) return
      event.preventDefault()
      removeLine(line)
    }
  }

  const modLabel = isApple() ? '⌘' : 'Ctrl'

  return (
    <form
      ref={formRef}
      onKeyDown={onKeyDown}
      onSubmit={(event) => {
        event.preventDefault()
        ask(false)
      }}
    >
      <PageHeader
        title={t('entryNew.title')}
        description={t('entryNew.intro', { mod: modLabel })}
      />

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <div className="mb-4 grid gap-4 sm:grid-cols-4">
        <SelectField
          label={t('entryNew.journal')}
          value={journalCode}
          onValueChange={setJournalCode}
          disabled={!hydrated}
        >
          {journals.map((journal) => (
            <SelectOption key={journal.code} value={journal.code}>
              {journal.code} · {journal.name}
            </SelectOption>
          ))}
        </SelectField>

        <label className="block">
          <span className="text-muted-foreground mb-1 block text-xs font-medium">
            {t('entry.bookingDate')}
          </span>
          <input
            type="date"
            value={bookingDate}
            onChange={(event) => {
              setBookingDate(event.target.value)
            }}
            className="border-input bg-background tabular w-full rounded-md border px-2 py-1.5 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-muted-foreground mb-1 block text-xs font-medium">
            {t('entry.documentDate')}
          </span>
          <input
            type="date"
            value={documentDate ?? bookingDate}
            onChange={(event) => {
              setDocumentDate(event.target.value)
            }}
            className="border-input bg-background tabular w-full rounded-md border px-2 py-1.5 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-muted-foreground mb-1 block text-xs font-medium">
            {t('entries.description')}
          </span>
          <input
            name="description"
            value={description}
            onChange={(event) => {
              setDescription(event.target.value)
            }}
            autoFocus
            className="border-input bg-background w-full rounded-md border px-2 py-1.5 text-sm"
          />
        </label>
      </div>

      <table className="border-border w-full border-collapse rounded-md border text-sm">
        <thead>
          <tr className="border-border bg-muted/50 border-b">
            <th scope="col" className="text-muted-foreground w-64 px-3 py-2 text-left font-medium">
              {t('entryNew.account')}
            </th>
            <th scope="col" className="text-muted-foreground px-3 py-2 text-left font-medium">
              {t('entries.description')}
            </th>
            <th scope="col" className="text-muted-foreground w-36 px-3 py-2 text-right font-medium">
              {t('trial.debit')}
            </th>
            <th scope="col" className="text-muted-foreground w-36 px-3 py-2 text-right font-medium">
              {t('trial.credit')}
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr
              key={line.key}
              data-line={index}
              className="border-border/60 border-b last:border-0"
            >
              <td className="px-2 py-1">
                <AccountPicker
                  label={t('entryNew.accountLine', { line: String(index + 1) })}
                  labelHidden
                  accounts={accounts}
                  value={line.accountNumber}
                  onValueChange={(next) => {
                    update(index, { accountNumber: next })
                  }}
                  disabled={!hydrated}
                  inputClassName="border-0 bg-transparent px-1 py-1"
                />
              </td>
              <td className="px-2 py-1">
                <input
                  value={line.description}
                  onChange={(event) => {
                    update(index, { description: event.target.value })
                  }}
                  aria-label={t('entryNew.descriptionLine', { line: String(index + 1) })}
                  className="focus:bg-accent w-full rounded bg-transparent px-1 py-1 outline-none"
                />
              </td>
              {(['debit', 'credit'] as const).map((side) => (
                <td key={side} className="px-2 py-1">
                  <input
                    inputMode="decimal"
                    value={line[side]}
                    aria-label={t(side === 'debit' ? 'entryNew.debitLine' : 'entryNew.creditLine', {
                      line: String(index + 1),
                    })}
                    onChange={(event) => {
                      update(index, {
                        [side]: event.target.value,
                        // One side or the other, never both.
                        [side === 'debit' ? 'credit' : 'debit']: '',
                      })
                    }}
                    onKeyDown={(event) => {
                      if (event.key === '=') {
                        event.preventDefault()
                        update(index, { [side]: balancingAmount(index, side) })
                        return
                      }
                      if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
                        event.preventDefault()
                        if (index === lines.length - 1) addLine()
                      }
                    }}
                    className="tabular focus:bg-accent w-full rounded bg-transparent px-1 py-1 text-right outline-none"
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot className="border-border bg-muted/30 border-t">
          <tr>
            <td colSpan={2} className="px-3 py-2">
              <button type="button" onClick={addLine} className="text-sm underline">
                {t('entryNew.addLine')}
              </button>
            </td>
            <td className="px-3 py-2 text-right font-medium">
              <Money amount={totalDebit} />
            </td>
            <td className="px-3 py-2 text-right font-medium">
              <Money amount={totalCredit} />
            </td>
          </tr>
          <tr>
            <td colSpan={2} className="text-muted-foreground px-3 pb-2 text-xs">
              {difference === 0n ? t('entryNew.balances') : t('entryNew.difference')}
            </td>
            <td
              colSpan={2}
              className={cn('px-3 pb-2 text-right', difference !== 0n && 'text-amount-negative')}
            >
              {difference === 0n ? null : <Money amount={difference} />}
            </td>
          </tr>
        </tfoot>
      </table>

      {problems.length > 0 && (
        <ul className="border-destructive/40 bg-destructive/5 mt-4 space-y-1 rounded-md border p-3 text-sm">
          {problems.map((problem, index) => (
            <li key={index}>
              {problem.path !== null && <span className="tabular text-xs">{problem.path}: </span>}
              {problem.message}
            </li>
          ))}
        </ul>
      )}

      {confirming !== null && (
        <Confirmation
          journalCode={journalCode}
          bookingDate={bookingDate}
          description={description}
          lineCount={booked.length}
          total={totalDebit}
          startAnother={confirming.startAnother}
          posting={posting}
          primaryRef={confirmRef}
          onConfirm={() => {
            void submit(confirming.startAnother)
          }}
          onCancel={() => {
            setConfirming(null)
          }}
        />
      )}

      <div className="mt-6 flex gap-2">
        <button
          type="submit"
          disabled={posting || !hydrated}
          className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {t('entryNew.post')}
        </button>
        <button
          type="button"
          disabled={posting || !hydrated}
          onClick={() => {
            ask(true)
          }}
          className="border-input rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {t('entryNew.postAndNext')}
        </button>
      </div>
    </form>
  )
}

/**
 * What is about to be posted, and the key that posts it.
 *
 * A dialog rather than a line of small print: the journal is append-only, so
 * this is the last moment anything can be changed, and `Escape` has to get back
 * to the draft with everything still in it.
 */
function Confirmation({
  journalCode,
  bookingDate,
  description,
  lineCount,
  total,
  startAnother,
  posting,
  primaryRef,
  onConfirm,
  onCancel,
}: {
  readonly journalCode: string
  readonly bookingDate: string
  readonly description: string
  readonly lineCount: number
  readonly total: bigint
  readonly startAnother: boolean
  readonly posting: boolean
  readonly primaryRef: React.RefObject<HTMLButtonElement | null>
  readonly onConfirm: () => void
  readonly onCancel: () => void
}) {
  const { t } = useT()

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('entryNew.confirmTitle')}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onCancel()
        }
      }}
      className="border-border mt-4 border p-4"
    >
      <h2 className="font-medium">{t('entryNew.confirmTitle')}</h2>
      <p className="text-muted-foreground mt-1 text-sm">
        {t('entryNew.confirmBody', {
          journal: journalCode,
          date: bookingDate,
          lines: String(lineCount),
          description,
        })}{' '}
        <Money amount={total} />
      </p>
      <p className="text-muted-foreground mt-2 max-w-2xl text-xs">{t('entryNew.confirmHint')}</p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          ref={primaryRef}
          disabled={posting}
          onClick={onConfirm}
          className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {startAnother ? t('entryNew.confirmAndNext') : t('entryNew.confirm')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="border-input rounded-md border px-4 py-2 text-sm font-medium"
        >
          {t('entryNew.confirmBack')}
        </button>
      </div>
    </div>
  )
}
