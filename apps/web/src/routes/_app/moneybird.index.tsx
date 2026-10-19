import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import type { AccountType, MoneybirdImportDecisions, MoneybirdProblem } from '@klopt/core'
import {
  formatFxRateForDisplay,
  normalizeFxRateInput,
  previewFxEntry,
} from '@klopt/core/moneybird-fx'
import { PageHeader, Stat } from '~/components/app-shell'
import {
  FindingsList,
  FindingHonestyState,
  honestyFromReconciliation,
} from '~/components/findings/finding-card'
import { detailForDisplay, formatFindingAmount, formatMonthName } from '~/lib/finding-card'
import { formatDate } from '~/lib/format'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'
import { useAdvancedMode } from '~/lib/advanced-mode-context'
import { useHydrated } from '~/lib/hydration'
import {
  emptyDecisions,
  withAccountType,
  withAcknowledgedEmptyYear,
  withConfirmedCurrency,
  withConfirmedFiscalYearStart,
  withContactNumber,
  withDeferredAttachment,
  withExchangeRate,
  withExcludedExternalId,
  withExcludedLockedYear,
} from '~/lib/moneybird-decisions'
import { moneybirdFindingCard, type MoneybirdFindingActions } from '~/lib/moneybird-findings'
import { moneybirdDocumentUrl } from '~/lib/moneybird-urls'
import {
  chooseMoneybirdAdministration,
  connectMoneybird,
  disconnectMoneybird,
  getMoneybirdConnection,
  listMoneybirdAdministrations,
  moneybirdFxRate,
  moneybirdImportStatus,
  previewMoneybirdImport,
  refreshMoneybirdFxRate,
  runMoneybirdImport,
  saveMoneybirdMappings,
} from '~/server/ledger'

const ACCOUNT_TYPES_SET = new Set<AccountType>([
  'asset',
  'liability',
  'equity',
  'revenue',
  'expense',
])

function suggestedAccountType(detail: Readonly<Record<string, string>>): AccountType {
  const raw = detail['suggestedType']
  if (raw !== undefined && ACCOUNT_TYPES_SET.has(raw as AccountType)) return raw as AccountType
  return 'asset'
}

/**
 * Overzetten uit Moneybird (issue #32).
 *
 * Same three steps as Exact, for the same reason: one personal API token
 * reaches every administration the user belongs to. Booked history is in the
 * dry-run report rather than a later XAF step — see ADR 0060.
 */
export const Route = createFileRoute('/_app/moneybird/')({
  loader: async () => ({
    connection: await getMoneybirdConnection(),
    run: await moneybirdImportStatus(),
  }),
  component: Moneybird,
})

const ACCOUNT_TYPES: readonly AccountType[] = ['asset', 'liability', 'equity', 'revenue', 'expense']

interface AdministrationOption {
  readonly id: string
  readonly name: string
  readonly label: string
  readonly currency: string | null
  readonly country: string | null
}

function Moneybird() {
  const { connection, run: runResult } = Route.useLoaderData()
  const { t, tag } = useT()
  const router = useRouter()
  const hydrated = useHydrated()
  const { advanced, setAdvanced, saving: advancedSaving } = useAdvancedMode()

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [administrations, setAdministrations] = useState<readonly AdministrationOption[] | null>(
    null,
  )
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null)
  const [imported, setImported] = useState<Record<string, unknown> | null>(null)
  const [apiToken, setApiToken] = useState('')
  const [baseUrl, setBaseUrl] = useState('https://moneybird.com/api/v2')
  const [accountMappings, setAccountMappings] = useState<Record<string, string>>({})
  const [taxMappings, setTaxMappings] = useState<Record<string, string>>({})
  const [decisions, setDecisions] = useState<MoneybirdImportDecisions>(() => {
    const fromConnection = connection.ok
      ? (connection.data.connection as { importDecisions?: MoneybirdImportDecisions } | null)
          ?.importDecisions
      : undefined
    return fromConnection ?? emptyDecisions()
  })
  const [fxDraft, setFxDraft] = useState<{
    externalId: string
    currency: string
    documentDate: string
    rate: string
    /** Rate as last suggested by ECB (empty when none); override only if different. */
    ecbRate: string
    source: 'ecb' | 'override'
    date: string
    loading: boolean
    error: string | null
  } | null>(null)
  const [typeDraft, setTypeDraft] = useState<{
    moneybirdId: string
    name: string
    type: AccountType
  } | null>(null)
  const [unbalancedDraft, setUnbalancedDraft] = useState<MoneybirdProblem | null>(null)
  const [periodLockedDraft, setPeriodLockedDraft] = useState<MoneybirdProblem | null>(null)
  const [drillNote, setDrillNote] = useState<string | null>(null)
  const [drillDocuments, setDrillDocuments] = useState<
    readonly { reference: string; description: string; documentDate: string; externalId: string }[]
  >([])
  const [fxRateError, setFxRateError] = useState<string | null>(null)

  if (!connection.ok) {
    return (
      <>
        <PageHeader title={t('moneybird.title')} />
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
        connectMoneybird({
          data: { baseUrl, apiToken, idempotencyKey: crypto.randomUUID() },
        }),
      () => void router.invalidate(),
    )

  const loadAdministrations = () =>
    run(listMoneybirdAdministrations, (data) => {
      setAdministrations(
        (data as { administrations: readonly AdministrationOption[] }).administrations,
      )
    })

  const choose = (id: string) =>
    run(
      () =>
        chooseMoneybirdAdministration({
          data: { administrationId: id, idempotencyKey: crypto.randomUUID() },
        }),
      (data) => {
        const chosen = data as { administrationName: string }
        setNote(t('moneybird.administrationChosen', { name: chosen.administrationName }))
        void router.invalidate()
      },
    )

  const runPreview = () =>
    run(previewMoneybirdImport, (data) => {
      const report = data as Record<string, unknown>
      setPreview(report)
      setImported(null)
      const accounts = (
        report['accounts'] as { sample: { moneybirdId: string; proposedNumber: string }[] }
      ).sample
      const nextAccounts: Record<string, string> = {}
      for (const account of accounts) {
        nextAccounts[account.moneybirdId] = account.proposedNumber
      }
      setAccountMappings(nextAccounts)
      const rates = report['taxRates'] as {
        moneybirdId: string
        proposedCode: string | null
        mappedCode: string | null
      }[]
      const nextTax: Record<string, string> = {}
      for (const rate of rates) {
        const code = rate.mappedCode ?? rate.proposedCode
        if (code !== null && code !== '') nextTax[rate.moneybirdId] = code
      }
      setTaxMappings(nextTax)
    })

  const persistAndPreview = (next: {
    accountMappings?: Record<string, string>
    taxMappings?: Record<string, string>
    importDecisions?: MoneybirdImportDecisions
  }) =>
    run(
      () =>
        saveMoneybirdMappings({
          data: {
            accountMappings: next.accountMappings ?? accountMappings,
            taxMappings: next.taxMappings ?? taxMappings,
            importDecisions: next.importDecisions ?? decisions,
            idempotencyKey: crypto.randomUUID(),
          },
        }),
      () => void runPreview(),
    )

  const saveMappings = () => void persistAndPreview({})

  const applyDecisions = (next: MoneybirdImportDecisions) => {
    setDecisions(next)
    void persistAndPreview({ importDecisions: next })
  }

  const findingActions: MoneybirdFindingActions = {
    onMapAccount: (problem) => {
      const id = problem.detail['moneybirdId'] ?? problem.path?.replace(/^accounts\./, '') ?? ''
      if (id !== '') {
        document.getElementById(`moneybird-account-${id}`)?.scrollIntoView({ behavior: 'smooth' })
      }
    },
    onMapTaxRate: (problem) => {
      const id = problem.path?.replace(/^taxRates\./, '') ?? ''
      if (id !== '') {
        document.getElementById(`moneybird-tax-${id}`)?.scrollIntoView({ behavior: 'smooth' })
      }
    },
    onRenumberAccount: (problem) => {
      const suggested = problem.detail['suggested'] ?? ''
      const id = problem.path?.replace(/^accounts\./, '') ?? ''
      if (id !== '' && suggested !== '') {
        setAccountMappings((current) => ({ ...current, [id]: suggested }))
      }
    },
    onRenumberContact: (problem) => {
      const moneybirdId = problem.detail['moneybirdId'] ?? ''
      const suggested = problem.detail['suggested'] ?? ''
      if (moneybirdId !== '' && suggested !== '') {
        applyDecisions(withContactNumber(decisions, moneybirdId, suggested))
      }
    },
    onPickAccountType: (problem) => {
      // Picking a ledger type needs Geavanceerd labels — same shell preference.
      void setAdvanced(true)
      const moneybirdId =
        problem.detail['moneybirdId'] ?? problem.path?.replace(/^accounts\./, '') ?? ''
      if (moneybirdId === '') return
      setTypeDraft({
        moneybirdId,
        name: problem.detail['name'] ?? moneybirdId,
        type: suggestedAccountType(problem.detail),
      })
    },
    onConfirmCurrencyEur: () => applyDecisions(withConfirmedCurrency(decisions)),
    onOpenFxStep: (problem) => {
      const externalId = problem.path ?? ''
      const currency = problem.detail['currency'] ?? ''
      const documentDate = problem.detail['documentDate'] ?? ''
      setFxRateError(null)
      setFxDraft({
        externalId,
        currency,
        documentDate,
        rate: '',
        ecbRate: '',
        source: 'ecb',
        date: documentDate,
        loading: true,
        error: null,
      })
      const applyOk = (body: { rate: string; date: string }) => {
        setFxDraft((current) =>
          current === null || current.externalId !== externalId
            ? current
            : {
                ...current,
                rate: body.rate,
                ecbRate: body.rate,
                source: 'ecb',
                date: body.date,
                loading: false,
                error: null,
              },
        )
      }
      const applyFail = (message: string) => {
        setFxDraft((current) =>
          current === null || current.externalId !== externalId
            ? current
            : {
                ...current,
                rate: '',
                ecbRate: '',
                source: 'override',
                loading: false,
                error: message,
              },
        )
      }
      // GET is cache-only; on miss POST refreshes ECB then returns the rate.
      void moneybirdFxRate({ data: { currency, documentDate } }).then((cached) => {
        if (cached.ok) {
          applyOk(cached.data)
          return
        }
        void refreshMoneybirdFxRate({ data: { currency, documentDate } }).then((refreshed) => {
          if (refreshed.ok) {
            applyOk(refreshed.data)
            return
          }
          const code =
            'problem' in refreshed &&
            typeof refreshed.problem === 'object' &&
            refreshed.problem !== null &&
            'code' in refreshed.problem
              ? String((refreshed.problem as { code?: string }).code ?? '')
              : ''
          applyFail(code === 'conflict' ? t('moneybird.fx.refreshFailed') : t('moneybird.fx.noEcb'))
        })
      })
    },
    onConfirmFiscalYearStart: () => applyDecisions(withConfirmedFiscalYearStart(decisions)),
    onAcknowledgeEmptyYear: (problem) =>
      applyDecisions(withAcknowledgedEmptyYear(decisions, problem.detail['year'] ?? '(none)')),
    onRereadResource: () => void runPreview(),
    onExcludeDocument: (problem) => {
      const year = problem.detail['year']
      if (problem.code === 'period_locked' && year !== undefined) {
        applyDecisions(withExcludedLockedYear(decisions, year))
        return
      }
      if (problem.path !== null) {
        applyDecisions(withExcludedExternalId(decisions, problem.path))
      }
      setUnbalancedDraft(null)
    },
    onOpenPeriodSettings: () => {
      void router.navigate({ to: '/fiscal-years' })
    },
    onReviewPeriodLocked: (problem) => {
      setPeriodLockedDraft(problem)
    },
    onDeferAttachment: (problem) => {
      const id = problem.detail['attachmentId']
      if (id !== undefined) applyDecisions(withDeferredAttachment(decisions, id))
    },
    onOpenMoneybird: (problem) => {
      const href = moneybirdDocumentUrl(
        state?.baseUrl ?? 'https://moneybird.com/api/v2',
        state?.administrationId,
        problem.path,
      )
      if (href !== null) window.open(href, '_blank', 'noopener,noreferrer')
    },
    onDrillUnbalanced: (problem) => {
      const detail = detailForDisplay(problem.detail, tag)
      setDrillNote(
        t('moneybird.drillUnbalancedHint', {
          year: detail['year'] ?? '—',
          debit: detail['debit'] ?? '—',
          credit: detail['credit'] ?? '—',
        }),
      )
      const year = Number(problem.detail['year'])
      // Only documents behind the difference (debit ≠ credit), not every doc in the year.
      const docs =
        preview === null
          ? []
          : (
              (preview['yearDocuments'] as
                | {
                    year: number
                    externalId: string
                    reference: string
                    description: string
                    documentDate: string
                    debit: string
                    credit: string
                    balanced: boolean
                  }[]
                | undefined) ?? []
            )
              .filter((doc) => doc.year === year && !doc.balanced)
              .map((doc) => ({
                reference: doc.reference,
                description: doc.description,
                documentDate: doc.documentDate,
                externalId: doc.externalId,
              }))
      setDrillDocuments(docs)
      document.getElementById('moneybird-reconciliation')?.scrollIntoView({ behavior: 'smooth' })
    },
    onReviewUnbalanced: (problem) => setUnbalancedDraft(problem),
    moneybirdHrefFor: (problem) =>
      moneybirdDocumentUrl(
        state?.baseUrl ?? 'https://moneybird.com/api/v2',
        state?.administrationId,
        problem.path,
      ),
    labels: {
      formatMonth: (month) => formatMonthName(month, tag),
      mapAccount: t('moneybird.fix.mapAccount'),
      mapTax: t('moneybird.fix.mapTax'),
      renumberAccount: t('moneybird.fix.renumberAccount'),
      renumberContact: t('moneybird.fix.renumberContact'),
      pickType: t('moneybird.fix.pickType'),
      confirmEur: t('moneybird.fix.confirmEur'),
      chooseRate: t('moneybird.fix.chooseRate'),
      confirmYearStart: t('moneybird.fix.confirmYearStart'),
      acknowledgeEmpty: t('moneybird.fix.acknowledgeEmpty'),
      reread: t('moneybird.fix.reread'),
      exclude: t('moneybird.fix.exclude'),
      reopenYear: t('moneybird.fix.reopenYear'),
      deferAttachment: t('moneybird.fix.deferAttachment'),
      openMoneybird: t('moneybird.fix.openMoneybird'),
      settings: t('moneybird.fix.settings'),
      drillDown: t('moneybird.fix.drillDown'),
      stepRate: t('moneybird.fix.stepRate'),
      stepPreview: t('moneybird.fix.stepPreview'),
      stepConfirm: t('moneybird.fix.stepConfirm'),
      stepPermissions: t('moneybird.fix.stepPermissions'),
      stepOpenMoneybird: t('moneybird.fix.stepOpenMoneybird'),
      stepReread: t('moneybird.fix.stepReread'),
      stepDoNotTransfer: t('moneybird.fix.stepDoNotTransfer'),
    },
  }

  const commit = () =>
    run(
      () => runMoneybirdImport({ data: { idempotencyKey: crypto.randomUUID() } }),
      (data) => {
        setImported(data as Record<string, unknown>)
        void router.invalidate()
      },
    )

  return (
    <>
      <PageHeader
        title={t('moneybird.title')}
        description={t('moneybird.intro')}
        actions={
          state?.connected === true ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(disconnectMoneybird, () => void router.invalidate())}
              className="border-border rounded-md border px-3 py-1.5 text-sm"
            >
              {t('moneybird.disconnect')}
            </button>
          ) : undefined
        }
      />

      {/*
        Same Geavanceerd preference as the shell (#44). Always on this screen so
        toggling here updates the account-menu switch without a reload — and so
        e2e can assert the single source of truth without a live Moneybird token.
      */}
      <div className="mb-4 flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={advanced}
            disabled={!hydrated}
            aria-busy={advancedSaving || undefined}
            onChange={(event) => {
              void setAdvanced(event.target.checked)
            }}
            className="border-border size-4 rounded-none"
          />
          {t('moneybird.advanced')}
        </label>
        <span className="text-muted-foreground text-xs">{t('moneybird.advancedHint')}</span>
      </div>

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

      {state === null || state.connected !== true ? (
        <section className="border-border mb-8 rounded-md border p-4">
          <h2 className="text-lg font-semibold">{t('moneybird.step1Connect')}</h2>
          <p className="text-muted-foreground mt-1 mb-4 text-sm">{t('moneybird.step1Intro')}</p>

          {!canStoreSecrets && (
            <p role="alert" className="text-destructive mb-4 text-sm">
              {t('moneybird.noEncryptionKey')}
            </p>
          )}

          <div className="grid max-w-2xl gap-3">
            <label className="text-sm">
              {t('moneybird.baseUrl')}
              <input
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                disabled={!hydrated}
                className="field-control mt-1"
              />
            </label>
            <label className="text-sm">
              {t('moneybird.apiToken')}
              <input
                type="password"
                value={apiToken}
                onChange={(event) => setApiToken(event.target.value)}
                disabled={!hydrated}
                className="field-control mt-1 tabular"
              />
            </label>
            <div className="form-actions">
              <button
                type="button"
                disabled={busy || !hydrated || !canStoreSecrets || apiToken === ''}
                onClick={() => void connect()}
                className="touch-cta touch-cta-primary"
              >
                {t('moneybird.connect')}
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section className="border-border mb-8 rounded-md border p-4">
          <h2 className="text-lg font-semibold">{t('moneybird.step1Connected')}</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {state.administrationName ?? t('moneybird.unknownUser')} — {state.baseUrl}
            {state.lastImportAt !== null &&
              t('moneybird.lastImported', { date: formatDate(state.lastImportAt) })}
          </p>
          {state.lastError !== null && (
            <p role="alert" className="text-destructive mt-2 text-sm">
              {state.lastError}
            </p>
          )}
        </section>
      )}

      {state?.connected === true && (
        <section className="border-border mb-8 rounded-md border p-4">
          <h2 className="text-lg font-semibold">{t('moneybird.step2')}</h2>
          <p className="text-muted-foreground mt-1 mb-4 text-sm">{t('moneybird.step2Intro')}</p>

          {state.administrationId !== null && (
            <p className="mb-4 text-sm">
              {t('moneybird.chosen')} <strong>{state.administrationName}</strong> (
              {state.administrationId})
            </p>
          )}

          <button
            type="button"
            disabled={busy}
            onClick={() => void loadAdministrations()}
            className="border-border rounded-md border px-3 py-1.5 text-sm"
          >
            {administrations === null
              ? t('moneybird.fetchAdministrations')
              : t('moneybird.fetchAgain')}
          </button>

          {administrations !== null && (
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="border-border border-b text-left">
                  <th className="py-2">{t('moneybird.administration')}</th>
                  <th className="py-2">{t('moneybird.currency')}</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {administrations.map((administration) => (
                  <tr key={administration.id} className="border-border border-b">
                    <td className="py-2">{administration.label}</td>
                    <td className="py-2 tabular">{administration.currency ?? '—'}</td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        disabled={busy || state.administrationId === administration.id}
                        onClick={() => void choose(administration.id)}
                        className="border-border rounded-md border px-2 py-1 text-xs disabled:opacity-50"
                      >
                        {state.administrationId === administration.id
                          ? t('moneybird.isChosen')
                          : t('moneybird.chooseThis')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {state?.ready === true && (
        <section className="border-border rounded-md border p-4">
          <h2 className="text-lg font-semibold">{t('moneybird.step3')}</h2>
          <p className="text-muted-foreground mt-1 mb-4 text-sm">{t('moneybird.step3Intro')}</p>

          <button
            type="button"
            disabled={busy}
            onClick={() => void runPreview()}
            className="touch-cta touch-cta-primary"
          >
            {busy ? t('common.busy') : t('moneybird.runPreview')}
          </button>

          {preview !== null && (
            <>
              <PreviewReport
                report={preview}
                actions={findingActions}
                advanced={advanced}
                fxDraft={fxDraft}
                typeDraft={typeDraft}
                unbalancedDraft={unbalancedDraft}
                periodLockedDraft={periodLockedDraft}
                drillNote={drillNote}
                drillDocuments={drillDocuments}
                fxRateError={fxRateError}
                onFxRateChange={(rate) =>
                  setFxDraft((current) => {
                    if (current === null) return null
                    const normalized = normalizeFxRateInput(rate)
                    const sameAsEcb =
                      current.ecbRate !== '' &&
                      normalized !== null &&
                      normalized === current.ecbRate
                    return {
                      ...current,
                      rate,
                      source:
                        sameAsEcb || (current.ecbRate !== '' && rate === current.ecbRate)
                          ? 'ecb'
                          : 'override',
                      date: sameAsEcb ? current.date : current.documentDate,
                    }
                  })
                }
                onFxAccept={() => {
                  if (fxDraft === null) return
                  const normalized = normalizeFxRateInput(fxDraft.rate)
                  if (normalized === null) {
                    setFxRateError(t('moneybird.fx.invalidRate'))
                    return
                  }
                  setFxRateError(null)
                  const source: 'ecb' | 'override' =
                    fxDraft.ecbRate !== '' && normalized === fxDraft.ecbRate ? 'ecb' : 'override'
                  applyDecisions(
                    withExchangeRate(decisions, fxDraft.externalId, {
                      rate: normalized,
                      source,
                      date:
                        source === 'ecb'
                          ? fxDraft.date || fxDraft.documentDate
                          : fxDraft.documentDate,
                    }),
                  )
                  setFxDraft(null)
                }}
                onFxDismiss={() => {
                  setFxDraft(null)
                  setFxRateError(null)
                }}
                onTypeChange={(type) =>
                  setTypeDraft((current) => (current === null ? null : { ...current, type }))
                }
                onTypeAccept={() => {
                  if (typeDraft === null) return
                  applyDecisions(withAccountType(decisions, typeDraft.moneybirdId, typeDraft.type))
                  setTypeDraft(null)
                }}
                onTypeDismiss={() => setTypeDraft(null)}
                onUnbalancedExclude={() => {
                  if (unbalancedDraft === null) return
                  findingActions.onExcludeDocument(unbalancedDraft)
                }}
                onUnbalancedOpenMoneybird={() => {
                  if (unbalancedDraft === null) return
                  findingActions.onOpenMoneybird(unbalancedDraft)
                }}
                onUnbalancedDismiss={() => setUnbalancedDraft(null)}
                onPeriodLockedExclude={() => {
                  if (periodLockedDraft === null) return
                  findingActions.onExcludeDocument(periodLockedDraft)
                  setPeriodLockedDraft(null)
                }}
                onPeriodLockedDismiss={() => setPeriodLockedDraft(null)}
                onDrillDismiss={() => {
                  setDrillNote(null)
                  setDrillDocuments([])
                }}
              />
              <MappingReview
                report={preview}
                accountMappings={accountMappings}
                taxMappings={taxMappings}
                advanced={advanced}
                onAccountChange={(id, value) =>
                  setAccountMappings((current) => ({ ...current, [id]: value }))
                }
                onTaxChange={(id, value) =>
                  setTaxMappings((current) => ({ ...current, [id]: value }))
                }
                onSave={() => void saveMappings()}
                busy={busy}
                hydrated={hydrated}
              />
            </>
          )}
        </section>
      )}

      {state?.ready === true && preview !== null && (
        <section className="border-border mt-6 rounded-md border p-4">
          <h2 className="text-lg font-semibold">{t('moneybird.step4')}</h2>
          <p className="text-muted-foreground mt-1 mb-4 text-sm">{t('moneybird.step4Intro')}</p>
          {imported === null ? (
            <button
              type="button"
              disabled={busy || !hydrated}
              onClick={() => void commit()}
              className="touch-cta touch-cta-primary"
            >
              {busy ? t('common.busy') : t('moneybird.commit')}
            </button>
          ) : (
            <ImportProgress result={imported} status={runResult} />
          )}
        </section>
      )}
    </>
  )
}

function MappingReview({
  report,
  accountMappings,
  taxMappings,
  advanced,
  onAccountChange,
  onTaxChange,
  onSave,
  busy,
  hydrated,
}: {
  report: Record<string, unknown>
  accountMappings: Record<string, string>
  taxMappings: Record<string, string>
  advanced: boolean
  onAccountChange: (id: string, value: string) => void
  onTaxChange: (id: string, value: string) => void
  onSave: () => void
  busy: boolean
  hydrated: boolean
}) {
  const { t } = useT()
  const accounts = (report['accounts'] as { sample: AccountSample[] }).sample
  const taxRates = report['taxRates'] as TaxSample[]
  const unmapped =
    accounts.filter((account) => (accountMappings[account.moneybirdId] ?? '').trim() === '')
      .length +
    taxRates.filter((rate) => rate.used && (taxMappings[rate.moneybirdId] ?? '').trim() === '')
      .length
  // Simple mode: Moneybird name → Klopt Categorie. Geavanceerd: Grootboek → Klopt-rekening.
  const sourceColumn = advanced ? t('moneybird.ledgerAccounts') : t('moneybird.moneybirdName')
  const accountColumn = advanced ? t('moneybird.kloptAccount') : t('moneybird.category')

  return (
    <div className="mt-6">
      <h3 className="mb-2 text-sm font-semibold">{t('moneybird.mapping')}</h3>
      <p className="text-muted-foreground mb-4 text-sm">
        {t('moneybird.mappingIntro')}
        {unmapped > 0 ? ` ${t('moneybird.unmappedCount', { count: String(unmapped) })}` : ''}
      </p>
      <table className="mb-4 w-full text-sm">
        <thead>
          <tr className="border-border border-b text-left">
            <th className="py-2">{sourceColumn}</th>
            <th className="py-2">{accountColumn}</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => (
            <tr
              key={account.moneybirdId}
              id={`moneybird-account-${account.moneybirdId}`}
              className="border-border border-b"
            >
              <td className="py-2">
                {advanced ? `${account.number} — ${account.name}` : account.name}
                {advanced && account.rgsCode !== null && account.rgsCode !== undefined ? (
                  <span className="text-muted-foreground ml-2 text-xs tabular-nums">
                    {account.rgsCode}
                  </span>
                ) : null}
              </td>
              <td className="py-2">
                <input
                  value={accountMappings[account.moneybirdId] ?? account.proposedNumber}
                  onChange={(event) => onAccountChange(account.moneybirdId, event.target.value)}
                  disabled={!hydrated}
                  className="border-border w-32 rounded-none border px-2 py-1 tabular-nums"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="mb-4 w-full text-sm">
        <thead>
          <tr className="border-border border-b text-left">
            <th className="py-2">{t('moneybird.taxRates')}</th>
            <th className="py-2">{t('moneybird.kloptTax')}</th>
          </tr>
        </thead>
        <tbody>
          {taxRates.map((rate) => (
            <tr
              key={rate.moneybirdId}
              id={`moneybird-tax-${rate.moneybirdId}`}
              className="border-border border-b"
            >
              <td className="py-2">
                {rate.name} ({rate.percentage}%)
              </td>
              <td className="py-2">
                <input
                  value={
                    taxMappings[rate.moneybirdId] ?? rate.mappedCode ?? rate.proposedCode ?? ''
                  }
                  onChange={(event) => onTaxChange(rate.moneybirdId, event.target.value)}
                  disabled={!hydrated}
                  className="border-border w-32 rounded-none border px-2 py-1 tabular-nums"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        disabled={busy || !hydrated}
        onClick={onSave}
        className="border-border rounded-none border px-3 py-1.5 text-sm disabled:opacity-50"
      >
        {t('moneybird.saveMappings')}
      </button>
    </div>
  )
}

interface AccountSample {
  readonly moneybirdId: string
  readonly number: string
  readonly proposedNumber: string
  readonly name: string
  readonly rgsCode?: string | null
}

interface TaxSample {
  readonly moneybirdId: string
  readonly name: string
  readonly percentage: string
  readonly proposedCode: string | null
  readonly mappedCode: string | null
  readonly used: boolean
}

interface PendingFxEntry {
  readonly externalId: string
  readonly documentNumber: string
  readonly documentDate: string
  readonly currency: string
  readonly kind: string
  readonly lines: readonly {
    readonly accountNumber: string
    readonly description: string
    readonly debit: string | null
    readonly credit: string | null
    readonly debitMinor: string
    readonly creditMinor: string
  }[]
}

function PreviewReport({
  report,
  actions,
  advanced,
  fxDraft,
  typeDraft,
  unbalancedDraft,
  periodLockedDraft,
  drillNote,
  drillDocuments,
  fxRateError,
  onFxRateChange,
  onFxAccept,
  onFxDismiss,
  onTypeChange,
  onTypeAccept,
  onTypeDismiss,
  onUnbalancedExclude,
  onUnbalancedOpenMoneybird,
  onUnbalancedDismiss,
  onPeriodLockedExclude,
  onPeriodLockedDismiss,
  onDrillDismiss,
}: {
  report: Record<string, unknown>
  actions: MoneybirdFindingActions
  advanced: boolean
  fxDraft: {
    externalId: string
    currency: string
    documentDate: string
    rate: string
    ecbRate: string
    source: 'ecb' | 'override'
    date: string
    loading: boolean
    error: string | null
  } | null
  typeDraft: { moneybirdId: string; name: string; type: AccountType } | null
  unbalancedDraft: MoneybirdProblem | null
  periodLockedDraft: MoneybirdProblem | null
  drillNote: string | null
  drillDocuments: readonly {
    reference: string
    description: string
    documentDate: string
    externalId: string
  }[]
  fxRateError: string | null
  onFxRateChange: (rate: string) => void
  onFxAccept: () => void
  onFxDismiss: () => void
  onTypeChange: (type: AccountType) => void
  onTypeAccept: () => void
  onTypeDismiss: () => void
  onUnbalancedExclude: () => void
  onUnbalancedOpenMoneybird: () => void
  onUnbalancedDismiss: () => void
  onPeriodLockedExclude: () => void
  onPeriodLockedDismiss: () => void
  onDrillDismiss: () => void
}) {
  const { t } = useT()
  // Entry/preview tables: Bij/Af in simple mode; Debet/Credit under Geavanceerd (#43 product call).
  // Uitgave/Inkomst is reserved for expense/income entry forms, not these columns.
  const debitLabel = advanced ? t('moneybird.side.debit') : t('moneybird.side.in')
  const creditLabel = advanced ? t('moneybird.side.credit') : t('moneybird.side.out')
  const functionalCurrency =
    typeof report['functionalCurrency'] === 'string' && report['functionalCurrency'] !== ''
      ? report['functionalCurrency']
      : 'EUR'
  const counts = report['counts'] as Record<string, number>
  const years = (report['years'] as number[]) ?? []
  const reconciliation = (report['reconciliation'] as ReconciliationYear[]) ?? []
  const warnings = (report['warnings'] as MoneybirdProblem[]) ?? []
  const problems = (report['problems'] as MoneybirdProblem[]) ?? []
  const notImported = (report['notImported'] as string[]) ?? []
  const excluded = (report['excluded'] as string[]) ?? []
  const pendingFx = (report['pendingFx'] as PendingFxEntry[] | undefined) ?? []
  const requests = (report['requests'] ?? []) as {
    path: string
    status: number
    rows: number
    durationMs: number
  }[]
  const first = reconciliation[0]
  const honesty =
    first === undefined ? null : honestyFromReconciliation(first.source, first.balanced)

  const fxEntry =
    fxDraft === null
      ? undefined
      : pendingFx.find((entry) => entry.externalId === fxDraft.externalId)
  const fxNormalized = fxDraft === null ? null : normalizeFxRateInput(fxDraft.rate)
  const fxPreviewLines =
    fxEntry === undefined || fxNormalized === null || fxDraft === null
      ? []
      : previewFxEntry(
          fxEntry.lines.map((line) => ({
            label: `${line.accountNumber} ${line.description}`,
            debit: BigInt(line.debitMinor),
            credit: BigInt(line.creditMinor),
          })),
          fxDraft.currency,
          fxNormalized,
        )

  return (
    <div className="mt-6">
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
        <Stat
          label={
            first === undefined
              ? t('moneybird.years')
              : t('moneybird.trialBalanceLabel', { year: String(first.year) })
          }
          value={
            first === undefined
              ? years.join(', ') || '—'
              : first.source === 'unreadable'
                ? t('moneybird.notRead')
                : first.source === 'empty'
                  ? t('moneybird.noBalances')
                  : first.balanced
                    ? t('moneybird.balances')
                    : t('moneybird.doesNotBalance')
          }
          tone={
            first === undefined || first.source !== 'read'
              ? 'muted'
              : first.balanced
                ? 'good'
                : 'warn'
          }
          hint={
            first?.source === 'read'
              ? t('moneybird.debitCredit', {
                  debit: first.totalDebit ?? '—',
                  credit: first.totalCredit ?? '—',
                })
              : t('moneybird.years') + ': ' + (years.join(', ') || '—')
          }
        />
        <Stat
          label={t('moneybird.ledgerAccounts')}
          value={counts['accounts'] ?? 0}
          hint={t('moneybird.contacts') + ': ' + String(counts['contacts'] ?? 0)}
        />
        <Stat
          label={t('moneybird.salesInvoices')}
          value={counts['salesInvoices'] ?? 0}
          hint={t('moneybird.purchaseInvoices') + ': ' + String(counts['purchaseInvoices'] ?? 0)}
        />
        <Stat
          label={t('moneybird.bankMutations')}
          value={counts['bankMutations'] ?? 0}
          hint={t('moneybird.documents') + ': ' + String(counts['documents'] ?? 0)}
        />
      </div>

      {/* Unread ≠ empty ≠ reconciled — three claims, three looks (#41). */}
      {honesty !== null && (
        <div className="mb-6 max-w-md">
          <FindingHonestyState honesty={honesty} />
        </div>
      )}

      {fxDraft !== null && (
        <div className="border-border mb-6 rounded-none border p-4">
          <p className="mb-1 text-sm font-semibold">
            {fxDraft.ecbRate === '' ? t('moneybird.fx.badgeManual') : t('moneybird.fx.badge')}
          </p>
          <p className="text-muted-foreground mb-3 text-xs">
            {fxDraft.loading
              ? t('moneybird.fx.loading')
              : fxDraft.ecbRate === ''
                ? t('moneybird.fx.noEcb')
                : t('moneybird.fx.sourceEcbDated', { date: fxDraft.date })}
            {fxDraft.source === 'override' ? ` · ${t('moneybird.fx.override')}` : ''}
          </p>
          {fxDraft.error !== null && (
            <p role="alert" className="text-destructive mb-2 text-sm">
              {fxDraft.error}
            </p>
          )}
          {fxRateError !== null && (
            <p role="alert" className="text-destructive mb-2 text-sm">
              {fxRateError}
            </p>
          )}
          <label className="text-sm">
            {t('moneybird.fx.rateLabel')} ({fxDraft.currency})
            <input
              value={fxDraft.rate}
              onChange={(event) => onFxRateChange(event.target.value)}
              disabled={fxDraft.loading}
              className="border-border mt-1 block w-40 rounded-none border px-2 py-2 tabular-nums"
              inputMode="decimal"
            />
          </label>
          {fxNormalized !== null && fxPreviewLines.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-sm font-semibold">{t('moneybird.fx.entryPreview')}</p>
              <ul className="mb-2 space-y-1 text-sm tabular-nums">
                {fxPreviewLines.map((line) => {
                  const foreign = line.foreignDebit > 0n ? line.foreignDebit : line.foreignCredit
                  const functional =
                    line.functionalDebit > 0n ? line.functionalDebit : line.functionalCredit
                  return (
                    <li key={line.label}>
                      {t('moneybird.fx.conversion', {
                        foreign: formatFindingAmount(foreign, fxDraft.currency),
                        rate: formatFxRateForDisplay(fxNormalized),
                        functional: formatFindingAmount(functional, functionalCurrency),
                      })}{' '}
                      <span className="text-muted-foreground">— {line.label}</span>
                    </li>
                  )
                })}
              </ul>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-border border-b text-left">
                    <th className="py-1">{t('moneybird.category')}</th>
                    <th className="py-1 text-right">{debitLabel}</th>
                    <th className="py-1 text-right">{creditLabel}</th>
                  </tr>
                </thead>
                <tbody>
                  {fxPreviewLines.map((line) => (
                    <tr key={line.label} className="border-border border-b">
                      <td className="py-1">{line.label}</td>
                      <td className="py-1 text-right tabular-nums">
                        {line.functionalDebit > 0n
                          ? formatFindingAmount(line.functionalDebit, functionalCurrency)
                          : '—'}
                      </td>
                      <td className="py-1 text-right tabular-nums">
                        {line.functionalCredit > 0n
                          ? formatFindingAmount(line.functionalCredit, functionalCurrency)
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={onFxAccept}
              disabled={fxDraft.loading || fxDraft.rate === ''}
              className="bg-primary text-primary-foreground rounded-none px-3 py-2 text-sm disabled:opacity-50"
            >
              {t('moneybird.fx.accept')}
            </button>
            <button
              type="button"
              onClick={onFxDismiss}
              className="border-border rounded-none border px-3 py-2 text-sm"
            >
              {t('findingCard.close')}
            </button>
          </div>
        </div>
      )}

      {typeDraft !== null && (
        <div className="border-border mb-6 rounded-none border p-4">
          <p className="mb-2 text-sm font-semibold">
            {t('moneybird.typePicker')}: {typeDraft.name}
          </p>
          <label className="text-sm">
            {t('moneybird.typePicker')}
            <select
              value={typeDraft.type}
              onChange={(event) => onTypeChange(event.target.value as AccountType)}
              className="border-border mt-1 block rounded-none border px-2 py-2"
            >
              {ACCOUNT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`accounts.type.${type}` as MessageKey)}
                </option>
              ))}
            </select>
          </label>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={onTypeAccept}
              className="bg-primary text-primary-foreground rounded-none px-3 py-2 text-sm"
            >
              {t('moneybird.typeSave')}
            </button>
            <button
              type="button"
              onClick={onTypeDismiss}
              className="border-border rounded-none border px-3 py-2 text-sm"
            >
              {t('findingCard.close')}
            </button>
          </div>
        </div>
      )}

      {unbalancedDraft !== null && (
        <div className="border-border mb-6 rounded-none border p-4">
          <p className="mb-2 text-sm font-semibold">{t('moneybird.unbalancedPanel')}</p>
          <p className="text-muted-foreground mb-3 text-sm">
            {(() => {
              const detail = detailForDisplay(unbalancedDraft.detail)
              return t('moneybird.unbalancedSides', {
                reference: detail['reference'] ?? unbalancedDraft.path ?? '—',
                debitLabel,
                debit: detail['debit'] ?? '—',
                creditLabel,
                credit: detail['credit'] ?? '—',
              })
            })()}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onUnbalancedExclude}
              className="bg-primary text-primary-foreground rounded-none px-3 py-2 text-sm"
            >
              {t('moneybird.fix.exclude')}
            </button>
            <button
              type="button"
              onClick={onUnbalancedOpenMoneybird}
              className="border-border rounded-none border px-3 py-2 text-sm"
            >
              {t('moneybird.fix.openMoneybird')} ↗
            </button>
            <button
              type="button"
              onClick={onUnbalancedDismiss}
              className="border-border rounded-none border px-3 py-2 text-sm"
            >
              {t('findingCard.close')}
            </button>
          </div>
        </div>
      )}

      {periodLockedDraft !== null && (
        <div className="border-border mb-6 rounded-none border p-4">
          <p className="mb-2 text-sm font-semibold">{t('moneybird.fix.exclude')}</p>
          <p className="text-muted-foreground mb-3 text-sm">
            {t('finding.why.moneybird.period_locked', {
              year: periodLockedDraft.detail['year'] ?? '—',
            })}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onPeriodLockedExclude}
              className="bg-primary text-primary-foreground rounded-none px-3 py-2 text-sm"
            >
              {t('moneybird.fix.exclude')}
            </button>
            <Link
              to="/fiscal-years"
              className="border-border inline-flex items-center rounded-none border px-3 py-2 text-sm"
            >
              {t('moneybird.fix.reopenYear')}
            </Link>
            <button
              type="button"
              onClick={onPeriodLockedDismiss}
              className="border-border rounded-none border px-3 py-2 text-sm"
            >
              {t('findingCard.close')}
            </button>
          </div>
        </div>
      )}

      {drillNote !== null && (
        <div
          id="moneybird-reconciliation"
          className="border-border mb-6 rounded-none border p-4"
          role="status"
        >
          <p className="mb-1 text-sm font-semibold">{t('moneybird.drillUnbalanced')}</p>
          <p className="text-muted-foreground mb-3 text-sm">{drillNote}</p>
          {drillDocuments.length > 0 ? (
            <ul className="mb-3 space-y-1 text-sm">
              {drillDocuments.map((doc) => (
                <li key={doc.externalId} className="tabular-nums">
                  <span className="font-medium">{doc.reference}</span>
                  <span className="text-muted-foreground">
                    {' '}
                    · {doc.documentDate} — {doc.description}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground mb-3 text-sm">{t('moneybird.drillNoDocuments')}</p>
          )}
          <button
            type="button"
            onClick={onDrillDismiss}
            className="border-border rounded-none border px-3 py-2 text-sm"
          >
            {t('findingCard.close')}
          </button>
        </div>
      )}

      {problems.length > 0 && (
        <div className="mb-6">
          <h3 className="text-destructive mb-2 text-sm font-semibold">
            {t('moneybird.blocking', { count: String(problems.length) })}
          </h3>
          <FindingsList
            aria-label={t('moneybird.blocking', { count: String(problems.length) })}
            findings={problems.map((problem) => moneybirdFindingCard(problem, 'problems', actions))}
          />
        </div>
      )}

      {warnings.length > 0 && (
        <div className="mb-6">
          <h3 className="mb-2 text-sm font-semibold">
            {t('moneybird.warnings', { count: String(warnings.length) })}
          </h3>
          <FindingsList
            aria-label={t('moneybird.warnings', { count: String(warnings.length) })}
            findings={warnings.map((warning) => moneybirdFindingCard(warning, 'warnings', actions))}
          />
        </div>
      )}

      {excluded.length > 0 && (
        <>
          <h3 className="mb-2 text-sm font-semibold">{t('moneybird.excluded')}</h3>
          <ul className="text-muted-foreground mb-6 list-disc pl-5 text-sm">
            {excluded.map((item) => (
              <li key={item} className="tabular-nums">
                {item}
              </li>
            ))}
          </ul>
        </>
      )}

      {notImported.length > 0 && (
        <>
          <h3 className="mb-2 text-sm font-semibold">{t('moneybird.notImported')}</h3>
          <ul className="text-muted-foreground mb-6 list-disc pl-5 text-sm">
            {notImported.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </>
      )}

      {requests.length > 0 && (
        <details className="mb-6">
          <summary className="cursor-pointer text-sm font-semibold">
            {t('moneybird.requests', {
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
                <th className="py-2">{t('moneybird.resource')}</th>
                <th className="py-2 text-right">{t('moneybird.statusColumn')}</th>
                <th className="py-2 text-right">{t('moneybird.rowsColumn')}</th>
                <th className="py-2 text-right">{t('moneybird.durationColumn')}</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((entry, index) => (
                <tr key={`${entry.path}-${String(index)}`} className="border-border border-b">
                  <td className="py-1 tabular text-xs">{entry.path}</td>
                  <td className="py-1 text-right tabular">{String(entry.status)}</td>
                  <td className="py-1 text-right tabular">{String(entry.rows)}</td>
                  <td className="py-1 text-right tabular">{String(entry.durationMs)} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {problems.length === 0 && warnings.length === 0 && (
        <p className="text-muted-foreground text-sm">{t('moneybird.nothingToReport')}</p>
      )}
    </div>
  )
}

interface ReconciliationYear {
  readonly year: number
  readonly source: 'read' | 'empty' | 'unreadable'
  readonly totalDebit: string | null
  readonly totalCredit: string | null
  readonly balanced: boolean | null
}

const RUN_KEY: Record<string, MessageKey> = {
  pending: 'docs.run.pending',
  running: 'docs.run.running',
  paused: 'docs.run.paused',
  done: 'docs.run.done',
  failed: 'docs.run.failed',
}

function ImportProgress({
  result,
  status,
}: {
  result: Record<string, unknown>
  status: { ok: boolean; data?: unknown }
}) {
  const { t } = useT()
  const run = status.ok ? (status.data as Record<string, unknown>) : result
  const state = typeof run['state'] === 'string' ? run['state'] : 'pending'
  const key = RUN_KEY[state]
  const report =
    run['report'] !== null && typeof run['report'] === 'object'
      ? (run['report'] as Record<string, unknown>)
      : null
  const years =
    report !== null && Array.isArray(report['reconciliation'])
      ? (report['reconciliation'] as CommitYear[])
      : []
  const opening =
    report !== null && report['opening'] !== null && typeof report['opening'] === 'object'
      ? (report['opening'] as { year: number; accounts: CommitAccount[] })
      : null

  return (
    <div>
      {run['workerSilent'] === true && (
        <p role="alert" className="text-destructive mb-4 text-sm">
          {t('moneybird.workerSilent')} <code>pnpm run dev</code>.
        </p>
      )}
      <p role="status" className="mb-4 text-sm">
        {t('moneybird.status')} <strong>{key === undefined ? state : t(key)}</strong>
      </p>
      {years.length > 0 && (
        <div className="mt-4">
          <p className="text-muted-foreground mb-3 text-sm">{t('moneybird.reconciliationIntro')}</p>
          {years.map((year) => (
            <div key={year.year} className="mb-4">
              <h3 className="mb-2 text-sm font-semibold">
                {t('moneybird.trialBalanceLabel', { year: String(year.year) })}
                {year.source === 'unreadable'
                  ? ` — ${t('moneybird.notRead')}`
                  : year.balanced === true
                    ? ` — ${t('moneybird.balances')}`
                    : year.balanced === false
                      ? ` — ${t('moneybird.doesNotBalance')}`
                      : ''}
              </h3>
              {year.accounts.length > 0 && (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-border text-muted-foreground border-b text-left">
                      <th className="py-2">{t('moneybird.accountColumn')}</th>
                      <th className="py-2 text-right">{t('moneybird.plannedColumn')}</th>
                      <th className="py-2 text-right">{t('moneybird.kloptColumn')}</th>
                      <th className="py-2 text-right">{t('moneybird.differenceColumn')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {year.accounts.map((row) => (
                      <tr key={row.accountNumber} className="border-border border-b">
                        <td className="py-1.5 tabular-nums">{row.accountNumber}</td>
                        <td className="py-1.5 text-right tabular-nums">{row.planned}</td>
                        <td className="py-1.5 text-right tabular-nums">{row.klopt}</td>
                        <td className="py-1.5 text-right tabular-nums">{row.difference}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
          {opening !== null && opening.accounts.length > 0 && (
            <div className="mb-4">
              <h3 className="mb-2 text-sm font-semibold">
                {t('moneybird.openingLabel', { year: String(opening.year) })}
              </h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-border text-muted-foreground border-b text-left">
                    <th className="py-2">{t('moneybird.accountColumn')}</th>
                    <th className="py-2 text-right">{t('moneybird.plannedColumn')}</th>
                    <th className="py-2 text-right">{t('moneybird.kloptColumn')}</th>
                    <th className="py-2 text-right">{t('moneybird.differenceColumn')}</th>
                  </tr>
                </thead>
                <tbody>
                  {opening.accounts.map((row) => (
                    <tr key={row.accountNumber} className="border-border border-b">
                      <td className="py-1.5 tabular-nums">{row.accountNumber}</td>
                      <td className="py-1.5 text-right tabular-nums">{row.planned}</td>
                      <td className="py-1.5 text-right tabular-nums">{row.klopt}</td>
                      <td className="py-1.5 text-right tabular-nums">{row.difference}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface CommitAccount {
  readonly accountNumber: string
  readonly planned: string
  readonly klopt: string
  readonly difference: string
}

interface CommitYear {
  readonly year: number
  readonly source: string
  readonly balanced: boolean | null
  readonly accounts: readonly CommitAccount[]
}
