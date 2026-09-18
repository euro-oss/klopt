import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { violationMessage } from '~/i18n/labels'
import { useCallback, useRef, useState } from 'react'
import { PageHeader } from '~/components/app-shell'
import { Money } from '~/components/finance/money'
import { SelectField, SelectOption } from '~/components/ui/select-field'
import { useT } from '~/i18n/provider'
import { formatMinorUnits, parseMinorUnits } from '~/lib/format'
import { useHydrated } from '~/lib/hydration'
import { isApple } from '~/lib/keyboard'
import { cn } from '~/lib/utils'
import { listAccounts, postEntry } from '~/server/ledger'

/**
 * Manual journal entry — the screen the keyboard map was written for.
 *
 * "Every entry screen submits and creates the next row without touching the
 * mouse" (spec 11.3), and the performance budget is under 100 ms to interactive
 * on a saved line (spec 12). So line editing is entirely client-side state with
 * no round trip; the server is touched exactly once, when the entry is posted.
 *
 * The keys are in docs/keyboard-map.md. The one worth knowing is `=` in an
 * amount field: it fills in whatever makes the entry balance, which is the last
 * line of almost every manual entry and the place transposition errors get in.
 */

export const Route = createFileRoute('/_app/entries/new')({
  loader: async () => listAccounts(),
  component: NewEntry,
})

interface DraftLine {
  readonly key: string
  accountNumber: string
  description: string
  debit: string
  credit: string
}

const JOURNALS = ['MEM', 'VRK', 'INK', 'BNK'] as const

function emptyLine(): DraftLine {
  return { key: crypto.randomUUID(), accountNumber: '', description: '', debit: '', credit: '' }
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function NewEntry() {
  const accountsResult = Route.useLoaderData()
  const navigate = useNavigate()

  const [journalCode, setJournalCode] = useState<string>('MEM')
  const [bookingDate, setBookingDate] = useState(today)
  const [description, setDescription] = useState('')
  const [lines, setLines] = useState<DraftLine[]>(() => [emptyLine(), emptyLine()])
  const [problems, setProblems] = useState<{ path: string | null; message: string }[]>([])
  const [posting, setPosting] = useState(false)

  const formRef = useRef<HTMLFormElement>(null)
  /**
   * The amount fields are controlled and parsed as they are typed, so before
   * hydration anything entered is discarded and the submit reloads the page.
   * Same reasoning as the sign-in screen: half-working is the worst state.
   */
  const hydrated = useHydrated()

  const accounts = accountsResult.ok ? accountsResult.data.accounts : []

  const parsed = lines.map((line) => ({
    debit: parseMinorUnits(line.debit) ?? 0n,
    credit: parseMinorUnits(line.credit) ?? 0n,
  }))
  const totalDebit = parsed.reduce((total, line) => total + line.debit, 0n)
  const totalCredit = parsed.reduce((total, line) => total + line.credit, 0n)
  const difference = totalDebit - totalCredit

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

  async function submit(startAnother: boolean) {
    setPosting(true)
    setProblems([])

    const result = await postEntry({
      data: {
        idempotencyKey: idempotencyKey.current,
        journalCode,
        bookingDate,
        documentDate: bookingDate,
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
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const mod = isApple() ? event.metaKey : event.ctrlKey
    if (mod && event.key === 'Enter') {
      event.preventDefault()
      void submit(event.shiftKey)
    }
  }

  const modLabel = isApple() ? '⌘' : 'Ctrl'
  const { t } = useT()

  return (
    <form
      ref={formRef}
      onKeyDown={onKeyDown}
      onSubmit={(event) => {
        event.preventDefault()
        void submit(false)
      }}
    >
      <PageHeader
        title={t('entryNew.title')}
        description={t('entryNew.intro', { mod: modLabel })}
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <SelectField
          label={t('entryNew.journal')}
          value={journalCode}
          onValueChange={setJournalCode}
          disabled={!hydrated}
        >
          {JOURNALS.map((code) => (
            <SelectOption key={code} value={code}>
              {code}
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

      <datalist id="accounts">
        {accounts.map((account) => (
          <option key={account.number} value={account.number}>
            {account.number} {account.name}
          </option>
        ))}
      </datalist>

      <table className="border-border w-full border-collapse rounded-md border text-sm">
        <thead>
          <tr className="border-border bg-muted/50 border-b">
            <th scope="col" className="text-muted-foreground w-32 px-3 py-2 text-left font-medium">
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
            <tr key={line.key} className="border-border/60 border-b last:border-0">
              <td className="px-2 py-1">
                <input
                  list="accounts"
                  value={line.accountNumber}
                  onChange={(event) => {
                    update(index, { accountNumber: event.target.value })
                  }}
                  aria-label={t('entryNew.accountLine', { line: String(index + 1) })}
                  className="w-full rounded bg-transparent px-1 py-1 tabular outline-none focus:bg-accent"
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
            void submit(true)
          }}
          className="border-input rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {t('entryNew.postAndNext')}
        </button>
      </div>
    </form>
  )
}
