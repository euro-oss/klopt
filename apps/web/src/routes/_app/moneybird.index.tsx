import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useMemo, useRef, useState } from 'react'
import type { AccountType, MoneybirdImportDecisions, MoneybirdProblem } from '@klopt/core'
import type { RankableAccount } from '@klopt/core/moneybird-account-ranker'
import {
  formatFxRateForDisplay,
  normalizeFxRateInput,
  previewFxEntry,
} from '@klopt/core/moneybird-fx'
import { PageHeader } from '~/components/app-shell'
import { Button } from '~/components/ui/button'
import { AccountVatSheet } from '~/components/findings/account-vat-sheet'
import { FxRateSheet } from '~/components/findings/fx-rate-sheet'
import { ImportFindingsScreen } from '~/components/findings/import-findings-screen'
import { ScrollTable, stickyFirstCol } from '~/components/ui/scroll-table'
import { cn } from '~/lib/utils'
import { detailForDisplay, formatFindingAmount, formatMonthName } from '~/lib/finding-card'
import {
  honestySourcesFromMoneybird,
  importVatRulesFromListTaxCodes,
  suggestVatCode,
  type ImportVatCode,
  type ImportVatRule,
} from '~/lib/import-findings'
import {
  applyTaxMappingSaveFailure,
  scrollTaxMappingViolationIntoView,
  type TaxMappingViolationView,
} from '~/lib/tax-mapping-save'
import { MoneybirdMappingReview } from '~/components/findings/moneybird-mapping-review'
import { listTaxCodes } from '~/server/sales'
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
import { nextFxLookupDraft, shouldApplyFxLookupResult } from '~/lib/fx-rate-lookup'
import {
  chooseMoneybirdAdministration,
  connectMoneybird,
  disconnectMoneybird,
  getMoneybirdConnection,
  listAccounts,
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
    accounts: await listAccounts(),
    taxCodes: await listTaxCodes(),
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
  const {
    connection,
    run: runResult,
    accounts: accountsResult,
    taxCodes: taxCodesResult,
  } = Route.useLoaderData()
  const { t, tag } = useT()
  const router = useRouter()
  const hydrated = useHydrated()
  const { advanced, setAdvanced, saving: advancedSaving } = useAdvancedMode()

  const kloptAccounts: readonly RankableAccount[] = useMemo(() => {
    if (!accountsResult.ok) return []
    return (accountsResult.data.accounts as readonly RankableAccount[]).map((account) => ({
      number: account.number,
      name: account.name,
      rgsCode: account.rgsCode ?? null,
    }))
  }, [accountsResult])

  const kloptTaxRules: readonly ImportVatRule[] = useMemo(() => {
    if (!taxCodesResult.ok) return []
    // Pass deductionCode (and proRata) through — without it VERL-VOOR ranks as
    // a plain standard and 21% purchase loses its VH21 preselect (#71 PM).
    const rows = taxCodesResult.data.taxCodes as readonly {
      readonly code: string
      readonly description?: string
      readonly rateBasisPoints: number
      readonly direction: 'input' | 'output'
      readonly scope?: string
      readonly reverseCharge?: string
      readonly deductibility?: string
      readonly deductionCode?: string | null
      readonly proRataBasisPoints?: number | null
    }[]
    return importVatRulesFromListTaxCodes(rows)
  }, [taxCodesResult])

  const [busy, setBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [administrations, setAdministrations] = useState<readonly AdministrationOption[] | null>(
    null,
  )
  const [accountVatDraft, setAccountVatDraft] = useState<{
    readonly moneybirdId: string
    readonly name: string
    readonly number: string
    readonly rgsCode: string | null
    readonly detailLine: string
    readonly mode: 'account' | 'tax'
    readonly taxMoneybirdId?: string
    readonly suggestedVat: ImportVatCode | null
    readonly taxRateType: string | null
    readonly percentage: string | null
    /** Preview `taxRates[].candidates` — sheet must not re-rank client-side (#86). */
    readonly serverCandidates?: readonly {
      readonly code: string
      readonly group: 'primary' | 'other'
    }[]
    /** MappingReview row id for the #42 jump-to-row fallback. */
    readonly mappingAnchor: string | null
  } | null>(null)
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null)
  const [imported, setImported] = useState<Record<string, unknown> | null>(null)
  const [apiToken, setApiToken] = useState('')
  const [baseUrl, setBaseUrl] = useState('https://moneybird.com/api/v2')
  const [accountMappings, setAccountMappings] = useState<Record<string, string>>({})
  const [taxMappings, setTaxMappings] = useState<Record<string, string>>({})
  /** Inline messages for `taxRates.<id>` after a saveMappings 422 (#71 PM). */
  const [taxViolations, setTaxViolations] = useState<
    Readonly<Record<string, TaxMappingViolationView>>
  >({})
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
    /** True once the user typed during the in-flight ECB lookup. */
    userEditedDuringLookup: boolean
  } | null>(null)
  const fxLookupGeneration = useRef(0)
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
    work: () => Promise<{
      ok: boolean
      problem?: {
        detail: string
        violations?: readonly { path?: string | null; message?: string; code?: string }[]
      }
      data?: unknown
    }>,
    onDone?: (data: unknown) => void,
  ): Promise<boolean> {
    setBusy(true)
    setError(null)
    setNote(null)
    const result = await work()
    setBusy(false)

    if (!result.ok) {
      setError(result.problem?.detail ?? t('common.unknownError'))
      return false
    }
    onDone?.(result.data)
    return true
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

  const persistAndPreview = async (next: {
    accountMappings?: Record<string, string>
    taxMappings?: Record<string, string>
    importDecisions?: MoneybirdImportDecisions
  }) => {
    const previousTax = taxMappings
    const attemptedTax = next.taxMappings ?? taxMappings
    // Optimistic UI — rolled back per rejected taxRates.<id> on 422 (#71 PM).
    if (next.taxMappings !== undefined) setTaxMappings(next.taxMappings)
    if (next.accountMappings !== undefined) setAccountMappings(next.accountMappings)
    setTaxViolations({})
    setBusy(true)
    setError(null)
    setNote(null)
    const result = await saveMoneybirdMappings({
      data: {
        accountMappings: next.accountMappings ?? accountMappings,
        taxMappings: attemptedTax,
        importDecisions: next.importDecisions ?? decisions,
        idempotencyKey: crypto.randomUUID(),
      },
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.problem?.detail ?? t('common.unknownError'))
      const applied = applyTaxMappingSaveFailure({
        previous: previousTax,
        attempted: attemptedTax,
        violations: result.problem?.violations ?? [],
        t,
      })
      setTaxViolations(applied.taxViolations)
      setTaxMappings(applied.taxMappings)
      const firstRejected = applied.rejectedIds[0]
      if (firstRejected !== undefined) scrollTaxMappingViolationIntoView(firstRejected)
      return
    }
    void runPreview()
  }

  const saveMappings = () => void persistAndPreview({})

  const applyDecisions = (next: MoneybirdImportDecisions) => {
    setDecisions(next)
    void persistAndPreview({ importDecisions: next })
  }

  const startFxLookup = (args: {
    readonly externalId: string
    readonly currency: string
    readonly documentDate: string
  }) => {
    const generation = ++fxLookupGeneration.current
    setFxRateError(null)
    setFxDraft((current) =>
      nextFxLookupDraft(
        current === null
          ? null
          : {
              externalId: current.externalId,
              currency: current.currency,
              documentDate: current.documentDate,
              rate: current.rate,
              ecbRate: current.ecbRate,
              source: current.source,
              date: current.date,
              userEditedDuringLookup: current.userEditedDuringLookup,
            },
        args,
      ),
    )
    const finishLoading = (patch: {
      readonly rate?: string
      readonly ecbRate?: string
      readonly source?: 'ecb' | 'override'
      readonly date?: string
      readonly error?: string | null
      readonly applyRate: boolean
    }) => {
      setFxDraft((current) => {
        if (current === null || current.externalId !== args.externalId) return current
        if (
          !shouldApplyFxLookupResult({
            resultGeneration: generation,
            currentGeneration: fxLookupGeneration.current,
            userEditedDuringLookup: current.userEditedDuringLookup,
          })
        ) {
          // Typed value wins: drop the network result, clear the spinner only.
          return { ...current, loading: false, error: patch.error ?? current.error }
        }
        if (!patch.applyRate) {
          return {
            ...current,
            loading: false,
            error: patch.error ?? null,
            source: 'override',
          }
        }
        return {
          ...current,
          rate: patch.rate ?? current.rate,
          ecbRate: patch.ecbRate ?? current.ecbRate,
          source: patch.source ?? current.source,
          date: patch.date ?? current.date,
          loading: false,
          error: null,
        }
      })
    }
    // GET is cache-only; on miss POST refreshes ECB then returns the rate.
    // Server functions have no AbortSignal — ignore stale generations instead.
    void moneybirdFxRate({
      data: { currency: args.currency, documentDate: args.documentDate },
    }).then((cached) => {
      if (generation !== fxLookupGeneration.current) return
      if (cached.ok) {
        finishLoading({
          applyRate: true,
          rate: cached.data.rate,
          ecbRate: cached.data.rate,
          source: 'ecb',
          date: cached.data.date,
        })
        return
      }
      void refreshMoneybirdFxRate({
        data: { currency: args.currency, documentDate: args.documentDate },
      }).then((refreshed) => {
        if (generation !== fxLookupGeneration.current) return
        if (refreshed.ok) {
          finishLoading({
            applyRate: true,
            rate: refreshed.data.rate,
            ecbRate: refreshed.data.rate,
            source: 'ecb',
            date: refreshed.data.date,
          })
          return
        }
        const code =
          'problem' in refreshed &&
          typeof refreshed.problem === 'object' &&
          refreshed.problem !== null &&
          'code' in refreshed.problem
            ? String((refreshed.problem as { code?: string }).code ?? '')
            : ''
        finishLoading({
          applyRate: false,
          error: code === 'conflict' ? t('moneybird.fx.refreshFailed') : t('moneybird.fx.noEcb'),
        })
      })
    })
  }

  const findingActions: MoneybirdFindingActions = {
    onMapAccount: (problem) => {
      const id = problem.detail['moneybirdId'] ?? problem.path?.replace(/^accounts\./, '') ?? ''
      const name = problem.detail['name'] ?? id
      const number = problem.detail['number'] ?? ''
      const rgsCode = problem.detail['rgsCode'] ?? null
      const count = problem.detail['count']
      setAccountVatDraft({
        moneybirdId: id,
        name,
        number,
        rgsCode,
        detailLine:
          count !== undefined && count !== ''
            ? t('importFindings.source.readCount', { count })
            : '',
        mode: 'account',
        suggestedVat: null,
        taxRateType: null,
        percentage: null,
        mappingAnchor: id !== '' ? `moneybird-account-${id}` : null,
      })
    },
    onMapTaxRate: (problem) => {
      const id = problem.path?.replace(/^taxRates\./, '') ?? problem.detail['moneybirdId'] ?? ''
      const name = problem.detail['name'] ?? id
      const percentage = problem.detail['percentage'] ?? ''
      const taxRates = (preview?.['taxRates'] as TaxSample[] | undefined) ?? []
      const sample = taxRates.find((rate) => rate.moneybirdId === id)
      const rawType = sample?.taxRateType ?? problem.detail['taxRateType'] ?? null
      const taxRateType =
        rawType === 'purchase_invoice' || rawType === 'sales_invoice' ? rawType : null
      // Prefer the preview's proposedCode + candidates (name-aware matcher).
      const suggestedVat =
        sample?.proposedCode ??
        suggestVatCode({
          rules: kloptTaxRules,
          taxRateType,
          percentage,
        })
      setAccountVatDraft({
        moneybirdId: id,
        name,
        number: '',
        rgsCode: null,
        detailLine: percentage !== '' ? `${percentage}%` : '',
        mode: 'tax',
        taxMoneybirdId: id,
        suggestedVat,
        taxRateType,
        percentage: percentage !== '' ? percentage : null,
        serverCandidates: sample?.candidates ?? [],
        mappingAnchor: id !== '' ? `moneybird-tax-${id}` : null,
      })
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
      startFxLookup({ externalId, currency, documentDate })
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
      toFiscalYears: t('moneybird.fix.toFiscalYears'),
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

  const commit = () => {
    setImporting(true)
    setError(null)
    setNote(null)
    void runMoneybirdImport({ data: { idempotencyKey: crypto.randomUUID() } })
      .then((result) => {
        if (!result.ok) {
          setError(result.problem?.detail ?? t('common.unknownError'))
          return
        }
        setImported(
          result.data !== undefined && result.data !== null && typeof result.data === 'object'
            ? { ...(result.data as object) }
            : {},
        )
        void router.invalidate()
      })
      .finally(() => {
        setImporting(false)
      })
  }

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

      {error !== null && preview === null && (
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
                loading={false}
                importing={importing}
                hydrated={hydrated}
                error={error}
                typeDraft={typeDraft}
                unbalancedDraft={unbalancedDraft}
                periodLockedDraft={periodLockedDraft}
                drillNote={drillNote}
                drillDocuments={drillDocuments}
                onReread={() => void runPreview()}
                onImport={() => void commit()}
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
              <MoneybirdMappingReview
                accounts={
                  (preview['accounts'] as { sample: AccountSample[] } | undefined)?.sample ?? []
                }
                taxRates={(preview['taxRates'] as TaxSample[] | undefined) ?? []}
                accountMappings={accountMappings}
                taxMappings={taxMappings}
                taxViolations={taxViolations}
                advanced={advanced}
                onAccountChange={(id, value) =>
                  setAccountMappings((current) => ({ ...current, [id]: value }))
                }
                onTaxChange={(id, value) => {
                  setTaxViolations((current) => {
                    if (current[id] === undefined) return current
                    const next = { ...current }
                    delete next[id]
                    return next
                  })
                  setTaxMappings((current) => ({ ...current, [id]: value }))
                }}
                onSave={() => void saveMappings()}
                busy={busy}
                hydrated={hydrated}
              />
            </>
          )}
        </section>
      )}

      {state?.ready === true && preview !== null && imported !== null && (
        <section className="border-border mt-6 rounded-md border p-4">
          <h2 className="text-lg font-semibold">{t('moneybird.step4')}</h2>
          <ImportProgress result={imported} status={runResult} />
        </section>
      )}

      {accountVatDraft !== null && (
        <AccountVatSheet
          open
          onOpenChange={(open) => {
            if (!open) setAccountVatDraft(null)
          }}
          sourceName={accountVatDraft.name}
          sourceDetail={accountVatDraft.detailLine}
          rgsCode={accountVatDraft.rgsCode}
          sourceNumber={accountVatDraft.number}
          accounts={kloptAccounts}
          taxRules={kloptTaxRules}
          suggestedVat={accountVatDraft.suggestedVat}
          taxRateType={accountVatDraft.taxRateType}
          percentage={accountVatDraft.percentage}
          {...(accountVatDraft.serverCandidates !== undefined
            ? { serverCandidates: accountVatDraft.serverCandidates }
            : {})}
          mode={accountVatDraft.mode}
          advanced={advanced}
          {...(accountVatDraft.mappingAnchor === null
            ? {}
            : {
                onJumpToMapping: () => {
                  const anchor = accountVatDraft.mappingAnchor
                  setAccountVatDraft(null)
                  if (anchor === null) return
                  requestAnimationFrame(() => {
                    document.getElementById(anchor)?.scrollIntoView({
                      behavior: 'smooth',
                      block: 'center',
                    })
                  })
                },
              })}
          onSave={(choice) => {
            if (accountVatDraft.mode === 'tax') {
              const taxId = accountVatDraft.taxMoneybirdId ?? accountVatDraft.moneybirdId
              if (taxId !== '' && choice.vatCode !== null) {
                const nextTax = { ...taxMappings, [taxId]: choice.vatCode }
                void persistAndPreview({ taxMappings: nextTax })
              }
            } else if (accountVatDraft.moneybirdId !== '' && choice.accountNumber !== null) {
              const nextAccounts = {
                ...accountMappings,
                [accountVatDraft.moneybirdId]: choice.accountNumber,
              }
              void persistAndPreview({ accountMappings: nextAccounts })
            }
            setAccountVatDraft(null)
          }}
        />
      )}

      {fxDraft !== null && (
        <MoneybirdFxSheet
          draft={fxDraft}
          pendingFx={readPendingFx(preview)}
          functionalCurrency={readFunctionalCurrency(preview)}
          advanced={advanced}
          fxRateError={fxRateError}
          onRateChange={(rate) =>
            setFxDraft((current) => {
              if (current === null) return null
              const normalized = normalizeFxRateInput(rate)
              const sameAsEcb =
                current.ecbRate !== '' && normalized !== null && normalized === current.ecbRate
              return {
                ...current,
                rate,
                userEditedDuringLookup: current.loading ? true : current.userEditedDuringLookup,
                source:
                  sameAsEcb || (current.ecbRate !== '' && rate === current.ecbRate)
                    ? 'ecb'
                    : 'override',
                date: sameAsEcb ? current.date : current.documentDate,
              }
            })
          }
          onRefreshEcb={() => {
            if (fxDraft === null || fxDraft.loading) return
            startFxLookup({
              externalId: fxDraft.externalId,
              currency: fxDraft.currency,
              documentDate: fxDraft.documentDate,
            })
          }}
          onResetEcb={() =>
            setFxDraft((current) =>
              current === null || current.ecbRate === ''
                ? current
                : {
                    ...current,
                    rate: current.ecbRate,
                    source: 'ecb',
                    date: current.date || current.documentDate,
                  },
            )
          }
          onAccept={() => {
            if (fxDraft === null) return
            const normalized = normalizeFxRateInput(fxDraft.rate)
            if (normalized === null) {
              setFxRateError(t('moneybird.fx.invalidRate'))
              return
            }
            setFxRateError(null)
            // Accepting a typed rate while lookup still runs drops that lookup.
            fxLookupGeneration.current += 1
            const source: 'ecb' | 'override' =
              fxDraft.ecbRate !== '' && normalized === fxDraft.ecbRate ? 'ecb' : 'override'
            applyDecisions(
              withExchangeRate(decisions, fxDraft.externalId, {
                rate: normalized,
                source,
                date:
                  source === 'ecb' ? fxDraft.date || fxDraft.documentDate : fxDraft.documentDate,
              }),
            )
            setFxDraft(null)
          }}
          onDismiss={() => {
            fxLookupGeneration.current += 1
            setFxDraft(null)
            setFxRateError(null)
          }}
        />
      )}
    </>
  )
}

function MoneybirdFxSheet({
  draft,
  pendingFx,
  functionalCurrency,
  advanced,
  fxRateError,
  onRateChange,
  onRefreshEcb,
  onResetEcb,
  onAccept,
  onDismiss,
}: {
  draft: {
    externalId: string
    currency: string
    documentDate: string
    rate: string
    ecbRate: string
    source: 'ecb' | 'override'
    date: string
    loading: boolean
    error: string | null
    userEditedDuringLookup: boolean
  }
  pendingFx: readonly PendingFxEntry[]
  functionalCurrency: string
  advanced: boolean
  fxRateError: string | null
  onRateChange: (rate: string) => void
  onRefreshEcb: () => void
  onResetEcb: () => void
  onAccept: () => void
  onDismiss: () => void
}) {
  const { t } = useT()
  const fxEntry = pendingFx.find((entry) => entry.externalId === draft.externalId)
  const fxNormalized = normalizeFxRateInput(draft.rate)
  const fxPreviewLines =
    fxEntry === undefined || fxNormalized === null
      ? []
      : previewFxEntry(
          fxEntry.lines.map((line) => ({
            label: line.description,
            debit: BigInt(line.debitMinor),
            credit: BigInt(line.creditMinor),
          })),
          draft.currency,
          fxNormalized,
        )
  const ecbInverse =
    draft.ecbRate === ''
      ? null
      : (() => {
          const normalized = normalizeFxRateInput(draft.ecbRate)
          if (normalized === null) return null
          const rate = Number(normalized)
          if (!Number.isFinite(rate) || rate <= 0) return null
          return (1 / rate).toFixed(4).replace('.', ',')
        })()
  const displayRate =
    draft.rate === '' ? '' : draft.rate.includes(',') ? draft.rate : draft.rate.replace('.', ',')
  const foreignTotal =
    fxEntry === undefined
      ? '—'
      : formatFindingAmount(
          fxEntry.lines.reduce(
            (sum, line) => sum + BigInt(line.debitMinor) + BigInt(line.creditMinor),
            0n,
          ) / 2n,
          draft.currency,
        )

  return (
    <FxRateSheet
      open
      onOpenChange={(open) => {
        if (!open) onDismiss()
      }}
      reference={fxEntry?.documentNumber ?? draft.externalId}
      documentDateLabel={draft.documentDate}
      currency={draft.currency}
      foreignAmountLabel={`${draft.currency} ${foreignTotal.replace(/^[^\d-]+/, '')}`}
      rate={displayRate}
      ecbRate={
        draft.ecbRate === ''
          ? ''
          : formatFxRateForDisplay(normalizeFxRateInput(draft.ecbRate) ?? draft.ecbRate)
      }
      source={draft.source}
      ecbDate={draft.date || draft.documentDate}
      ecbInverse={ecbInverse}
      loading={draft.loading}
      error={draft.error ?? fxRateError}
      advanced={advanced}
      previewRows={fxPreviewLines.map((line, index) => {
        const accountNumber = fxEntry?.lines[index]?.accountNumber
        return {
          label: line.label,
          ...(advanced && accountNumber !== undefined && accountNumber !== ''
            ? { accountNumber }
            : {}),
          amount:
            line.functionalDebit > 0n
              ? formatFindingAmount(line.functionalDebit, functionalCurrency)
              : line.functionalCredit > 0n
                ? formatFindingAmount(line.functionalCredit, functionalCurrency)
                : '—',
          debit:
            line.functionalDebit > 0n
              ? formatFindingAmount(line.functionalDebit, functionalCurrency)
              : '—',
          credit:
            line.functionalCredit > 0n
              ? formatFindingAmount(line.functionalCredit, functionalCurrency)
              : '—',
        }
      })}
      calcLine={
        fxNormalized === null
          ? '—'
          : t('moneybird.fx.conversion', {
              foreign: foreignTotal,
              rate: formatFxRateForDisplay(fxNormalized),
              functional:
                fxPreviewLines[0] !== undefined
                  ? formatFindingAmount(
                      fxPreviewLines[0].functionalDebit > 0n
                        ? fxPreviewLines[0].functionalDebit
                        : fxPreviewLines[0].functionalCredit,
                      functionalCurrency,
                    )
                  : '—',
            })
      }
      onRateChange={onRateChange}
      onRefreshEcb={onRefreshEcb}
      {...(draft.ecbRate === '' ? {} : { onResetEcb })}
      onAccept={onAccept}
    />
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
  readonly taxRateType?: string
  readonly proposedCode: string | null
  readonly mappedCode: string | null
  readonly used: boolean
  readonly candidates?: readonly {
    readonly code: string
    readonly group: 'primary' | 'other'
  }[]
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

function readPendingFx(preview: Record<string, unknown> | null): readonly PendingFxEntry[] {
  const raw = preview?.['pendingFx']
  return Array.isArray(raw) ? (raw as PendingFxEntry[]) : []
}

function readFunctionalCurrency(preview: Record<string, unknown> | null): string {
  const raw = preview?.['functionalCurrency']
  return typeof raw === 'string' && raw !== '' ? raw : 'EUR'
}

function PreviewReport({
  report,
  actions,
  advanced,
  loading,
  importing,
  hydrated,
  error,
  typeDraft,
  unbalancedDraft,
  periodLockedDraft,
  drillNote,
  drillDocuments,
  onReread,
  onImport,
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
  loading: boolean
  importing: boolean
  hydrated: boolean
  error: string | null
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
  onReread: () => void
  onImport: () => void
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
  const counts = report['counts'] as Record<string, number>
  const reconciliation = (report['reconciliation'] as ReconciliationYear[]) ?? []
  const warnings = (report['warnings'] as MoneybirdProblem[]) ?? []
  const problems = (report['problems'] as MoneybirdProblem[]) ?? []
  const notImported = (report['notImported'] as string[]) ?? []
  const excluded = (report['excluded'] as string[]) ?? []
  const requests = (report['requests'] ?? []) as {
    path: string
    status: number
    rows: number
    durationMs: number
  }[]
  const unreadAttachment = [...problems, ...warnings].find(
    (problem) => problem.code === 'resource_unreadable',
  )
  const sources = honestySourcesFromMoneybird({
    counts,
    reconciliation,
    unreadResource:
      unreadAttachment === undefined
        ? null
        : {
            label: t('importFindings.source.attachments'),
            detail: unreadAttachment.detail['status'] ?? unreadAttachment.message,
          },
    labels: {
      sales: t('importFindings.source.sales'),
      purchases: t('importFindings.source.purchases'),
      bookings: (year) => t('importFindings.source.bookings', { year: String(year) }),
      readCount: (n) => t('importFindings.source.readCount', { count: String(n) }),
      zeroRead: t('importFindings.source.zeroRead'),
      unreadable: t('importFindings.source.unreadable'),
      doesNotBalance: t('importFindings.source.doesNotBalance'),
      yearRead: t('importFindings.source.yearRead'),
    },
    onReread,
  })
  const findings = [
    ...problems.map((problem) => moneybirdFindingCard(problem, 'problems', actions)),
    ...warnings.map((warning) => moneybirdFindingCard(warning, 'warnings', actions)),
  ]

  return (
    <div className="mt-6">
      <ImportFindingsScreen
        subtitle={t('moneybird.step3Intro')}
        connected
        hasPreview
        loading={loading}
        importing={importing}
        hydrated={hydrated}
        error={error}
        findings={findings}
        sources={sources}
        onReread={onReread}
        onImport={onImport}
        advanced={advanced}
      >
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
              <Button type="button" onClick={onPeriodLockedExclude}>
                {t('moneybird.fix.exclude')}
              </Button>
              <Button type="button" variant="outline" asChild>
                <Link to="/fiscal-years">{t('moneybird.fix.toFiscalYears')}</Link>
              </Button>
              <Button type="button" variant="outline" onClick={onPeriodLockedDismiss}>
                {t('findingCard.close')}
              </Button>
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
              <p className="text-muted-foreground mb-3 text-sm">
                {t('moneybird.drillNoDocuments')}
              </p>
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
      </ImportFindingsScreen>

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
          <ScrollTable>
            <table className={cn('mt-2 w-full min-w-[36rem] text-sm', stickyFirstCol)}>
              <thead>
                <tr className="border-border border-b text-left">
                  <th className="py-2 pr-4">{t('moneybird.resource')}</th>
                  <th className="py-2 text-right">{t('moneybird.statusColumn')}</th>
                  <th className="py-2 text-right">{t('moneybird.rowsColumn')}</th>
                  <th className="py-2 text-right">{t('moneybird.durationColumn')}</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((entry, index) => (
                  <tr key={`${entry.path}-${String(index)}`} className="border-border border-b">
                    <td className="py-1 pr-4 text-xs tabular-nums">{entry.path}</td>
                    <td className="py-1 text-right tabular-nums">{String(entry.status)}</td>
                    <td className="py-1 text-right tabular-nums">{String(entry.rows)}</td>
                    <td className="py-1 text-right tabular-nums">{String(entry.durationMs)} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollTable>
        </details>
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
                <ScrollTable>
                  <table className={cn('w-full min-w-[36rem] text-sm', stickyFirstCol)}>
                    <thead>
                      <tr className="border-border text-muted-foreground border-b text-left">
                        <th className="py-2 pr-4">{t('moneybird.accountColumn')}</th>
                        <th className="py-2 text-right">{t('moneybird.plannedColumn')}</th>
                        <th className="py-2 text-right">{t('moneybird.kloptColumn')}</th>
                        <th className="py-2 text-right">{t('moneybird.differenceColumn')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {year.accounts.map((row) => (
                        <tr key={row.accountNumber} className="border-border border-b">
                          <td className="py-1.5 pr-4 tabular-nums">{row.accountNumber}</td>
                          <td className="py-1.5 text-right tabular-nums">{row.planned}</td>
                          <td className="py-1.5 text-right tabular-nums">{row.klopt}</td>
                          <td className="py-1.5 text-right tabular-nums">{row.difference}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollTable>
              )}
            </div>
          ))}
          {opening !== null && opening.accounts.length > 0 && (
            <div className="mb-4">
              <h3 className="mb-2 text-sm font-semibold">
                {t('moneybird.openingLabel', { year: String(opening.year) })}
              </h3>
              <ScrollTable>
                <table className={cn('w-full min-w-[36rem] text-sm', stickyFirstCol)}>
                  <thead>
                    <tr className="border-border text-muted-foreground border-b text-left">
                      <th className="py-2 pr-4">{t('moneybird.accountColumn')}</th>
                      <th className="py-2 text-right">{t('moneybird.plannedColumn')}</th>
                      <th className="py-2 text-right">{t('moneybird.kloptColumn')}</th>
                      <th className="py-2 text-right">{t('moneybird.differenceColumn')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {opening.accounts.map((row) => (
                      <tr key={row.accountNumber} className="border-border border-b">
                        <td className="py-1.5 pr-4 tabular-nums">{row.accountNumber}</td>
                        <td className="py-1.5 text-right tabular-nums">{row.planned}</td>
                        <td className="py-1.5 text-right tabular-nums">{row.klopt}</td>
                        <td className="py-1.5 text-right tabular-nums">{row.difference}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollTable>
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
