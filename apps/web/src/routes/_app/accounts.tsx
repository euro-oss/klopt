import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { PageHeader } from '~/components/app-shell'
import { LedgerTable, type Column } from '~/components/finance/ledger-table'
import { violationMessage } from '~/i18n/labels'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'
import { useHydrated } from '~/lib/hydration'
import { getRgsCoverage, listAccounts, setRgsMappings } from '~/server/ledger'

/**
 * Het grootboek, and the RGS code each account reports under.
 *
 * The table was read-only for four milestones while the dashboard reported RGS
 * coverage as a percentage: you could see that you were at 84% and do nothing
 * about it from the product. `rgs.setMappings` has existed the whole time.
 *
 * ## A text field, not a list
 *
 * There is no endpoint that lists the codes in a scheme — the reference data is
 * loaded at boot and read by the mapper, and publishing it is #15. So the alpha
 * asks for the code and validates it, which Product settled: a validated
 * free-text field says "BVorDebHad is not a code in 3.7-mkb" the moment you
 * save, and a picker over a list we cannot fetch would be a fiction.
 *
 * The validation is not ours. `validateMapping` in @klopt/core already knows the
 * five ways a mapping can be wrong and which of them are errors: an unknown or
 * withdrawn code is refused, while an aggregate code or a debit/credit mismatch
 * is applied and reported. That split is why this screen shows two kinds of
 * message in two colours — the status red for the refusals, the attention
 * colour for the rest. Neither is the accent: yellow does not mean error here
 * or anywhere (test/unit/theme.test.ts).
 */
export const Route = createFileRoute('/_app/accounts')({
  loader: async () => {
    const [accounts, coverage] = await Promise.all([listAccounts(), getRgsCoverage({ data: {} })])
    return { accounts, coverage }
  },
  component: Accounts,
})

interface AccountRow {
  number: string
  name: string
  type: string
  normalBalance: string
  rgsCode: string | null
  isBlocked: boolean
}

const TYPE_KEY: Record<string, MessageKey> = {
  asset: 'accounts.type.asset',
  liability: 'accounts.type.liability',
  equity: 'accounts.type.equity',
  revenue: 'accounts.type.revenue',
  expense: 'accounts.type.expense',
}

function Accounts() {
  const { accounts, coverage } = Route.useLoaderData()
  const { t } = useT()
  const router = useRouter()
  const hydrated = useHydrated()

  const [editing, setEditing] = useState<AccountRow | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<readonly string[] | null>(null)
  const [warnings, setWarnings] = useState<readonly string[] | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  if (!accounts.ok) return <p className="text-destructive">{accounts.problem.detail}</p>

  const problemsByAccount = new Map<string, { severity: string; message: string }[]>()
  if (coverage.ok) {
    for (const problem of coverage.data.problems) {
      const list = problemsByAccount.get(problem.accountNumber) ?? []
      list.push(problem)
      problemsByAccount.set(problem.accountNumber, list)
    }
  }

  function edit(row: AccountRow): void {
    setEditing(row)
    setCode(row.rgsCode ?? '')
    setErrors(null)
    setWarnings(null)
    setNotice(null)
  }

  function stopEditing(): void {
    setEditing(null)
    setErrors(null)
    setWarnings(null)
  }

  /**
   * Save the one mapping.
   *
   * `rgsCode: null` clears it, which is what an emptied field means — and is a
   * real thing to want: an account mapped to the wrong code reports wrongly,
   * and unmapped is at least honestly unmapped.
   */
  async function save(): Promise<void> {
    if (editing === null) return
    setBusy(true)
    setErrors(null)
    setWarnings(null)
    setNotice(null)

    const wanted = code.trim()
    const result = await setRgsMappings({
      data: {
        mappings: [{ accountNumber: editing.number, rgsCode: wanted === '' ? null : wanted }],
      },
    })
    setBusy(false)

    if (!result.ok) {
      setErrors(
        result.problem.violations.length > 0
          ? result.problem.violations.map((violation) => violationMessage(t, violation))
          : [result.problem.detail],
      )
      return
    }

    // Applied, and possibly with something to say about it: an aggregate code
    // or a direction mismatch is a warning the mapper returns *after* saving.
    setWarnings(result.data.warnings.map((warning) => warning.message))
    setNotice(
      wanted === ''
        ? t('accounts.rgsCleared', { account: editing.number })
        : t('accounts.rgsSaved', { account: editing.number, code: wanted }),
    )
    setEditing(null)
    // The coverage in this page's header and the figure on the dashboard come
    // from the same read, so both follow from reloading it.
    await router.invalidate()
  }

  const columns: readonly Column<AccountRow>[] = [
    {
      key: 'number',
      header: t('accounts.number'),
      width: '6rem',
      cell: (row) => <span className="tabular">{row.number}</span>,
    },
    { key: 'name', header: t('accounts.description'), cell: (row) => row.name },
    {
      key: 'type',
      header: t('accounts.kind'),
      width: '9rem',
      cell: (row) => {
        const key = TYPE_KEY[row.type]
        return key === undefined ? row.type : t(key)
      },
    },
    {
      key: 'dc',
      header: 'D/C',
      width: '4rem',
      cell: (row) => (row.normalBalance === 'debit' ? 'D' : 'C'),
    },
    {
      key: 'rgs',
      header: 'RGS',
      width: '11rem',
      cell: (row) =>
        row.rgsCode === null ? (
          <span className="bg-unreconciled/15 px-1.5 py-0.5 text-xs">{t('accounts.unmapped')}</span>
        ) : (
          <span className="tabular text-xs">{row.rgsCode}</span>
        ),
    },
    {
      key: 'status',
      header: '',
      cell: (row) => {
        const problems = problemsByAccount.get(row.number) ?? []
        const worst = problems.find((problem) => problem.severity === 'error') ?? problems[0]
        if (row.isBlocked)
          return <span className="text-muted-foreground text-xs">{t('accounts.blocked')}</span>
        if (worst === undefined) return null
        return (
          <span
            className={
              worst.severity === 'error'
                ? 'text-destructive text-xs'
                : 'text-muted-foreground text-xs'
            }
            title={worst.message}
          >
            {worst.message}
          </span>
        )
      },
    },
  ]

  return (
    <>
      <PageHeader
        title={t('accounts.title')}
        description={
          coverage.ok
            ? t('accounts.intro', {
                mapped: String(coverage.data.mappedCount),
                total: String(coverage.data.accountCount),
                version: coverage.data.version,
                variant: coverage.data.variant,
                percentage: String(coverage.data.mappedPercentage),
              })
            : undefined
        }
      />

      <p className="text-muted-foreground mb-4 text-sm">{t('accounts.mapHint')}</p>

      {notice !== null && (
        <p className="border-border text-muted-foreground mb-4 border p-3 text-sm">{notice}</p>
      )}

      {warnings !== null && warnings.length > 0 && (
        <ul className="text-unreconciled mb-4 space-y-1 text-sm">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      {editing !== null && (
        <section className="border-border mb-4 border p-4">
          <h2 className="text-base font-medium">
            {t('accounts.rgsFor', { account: editing.number, name: editing.name })}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {coverage.ok
              ? t('accounts.rgsScheme', {
                  version: coverage.data.version,
                  variant: coverage.data.variant,
                })
              : t('accounts.rgsSchemeUnknown')}
          </p>

          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="text-muted-foreground mb-1 block text-xs font-medium">
                {t('accounts.rgsCode')}
              </span>
              <input
                type="text"
                value={code}
                autoFocus
                onChange={(event) => {
                  setCode(event.currentTarget.value)
                }}
                onKeyDown={(event) => {
                  // The form's keys, not the table's: this input sits outside
                  // the table, and Enter commits the thing you are in.
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    if (!busy) void save()
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    stopEditing()
                  }
                }}
                className="border-input bg-background w-56 border px-3 py-2 tabular text-sm"
              />
            </label>

            <button
              type="button"
              disabled={!hydrated || busy}
              onClick={() => {
                void save()
              }}
              className="bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {busy ? t('common.busy') : t('common.save')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={stopEditing}
              className="border-input border px-4 py-2 text-sm disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
          </div>

          {errors !== null && (
            <ul role="alert" className="text-destructive mt-3 space-y-1 text-sm">
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      <LedgerTable
        columns={columns}
        rows={accounts.data.accounts}
        rowKey={(row) => row.number}
        onRowActivate={edit}
        caption={t('accounts.caption')}
      />
    </>
  )
}
