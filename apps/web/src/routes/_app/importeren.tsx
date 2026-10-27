/**
 * Import wizard — Moneybird Phase 1 (#100).
 *
 * Ten steps (bron → klaar). Exact is an honest dead-end on Bron. Reuses
 * Moneybird server functions and findings chrome rather than the old
 * `/moneybird` page layout.
 */

import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import type { MoneybirdImportDecisions, MoneybirdProblem } from '@klopt/core'
import type { RankableAccount } from '@klopt/core/moneybird-account-ranker'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import { Button } from '~/components/ui/button'
import { AccountVatSheet } from '~/components/findings/account-vat-sheet'
import { FindingCard } from '~/components/findings/finding-card'
import {
  AttentionBlock,
  WizardFooter,
  WizardProgressRail,
  WizardStatusToast,
  WizardStepHeader,
} from '~/components/import-wizard/wizard-shell'
import {
  importFailureKind,
  importProgressPercent,
  isImportRunDone,
  klaarFilingBlocked,
  klaarTransferCount,
  rebuildExcludedRates,
  type ImportRunStatusView,
} from '~/lib/import-wizard-run'
import { refusedRateMessage } from '~/lib/refused-rate-message'
import { Badge } from '~/components/ui/badge'
import { Checkbox } from '~/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '~/components/ui/radio-group'
import { useAdvancedMode } from '~/lib/advanced-mode-context'
import { useHydrated } from '~/lib/hydration'
import { importVatRulesFromListTaxCodes, type ImportVatRule } from '~/lib/import-findings'
import {
  IMPORT_WIZARD_STEP_KEYS,
  canAdvanceFromAdministratie,
  canAdvanceFromBron,
  canAdvanceFromBtw,
  canAdvanceFromProblemen,
  canAdvanceFromVerbinden,
  canAdvanceFromVoorbeeld,
  excludedYearsFromSelection,
  flowShouldAdvanceOnEnter,
  isImportWizardStep,
  isTerminalStep,
  prevStep,
  stepIndex,
  type ImportWizardSource,
  type ImportWizardStep,
} from '~/lib/import-wizard'
import {
  emptyDecisions,
  withExcludedExternalIds,
  withExcludedYears,
  withoutExcludedExternalIds,
} from '~/lib/moneybird-decisions'
import { moneybirdFindingCard, type MoneybirdFindingActions } from '~/lib/moneybird-findings'
import { moneybirdDocumentUrl, moneybirdTaxSettingsUrl } from '~/lib/moneybird-urls'
import { applyTaxMappingSaveFailure, type TaxMappingViolationView } from '~/lib/tax-mapping-save'
import { cn } from '~/lib/utils'
import { useT } from '~/i18n/provider'
import type { MessageKey } from '~/i18n/nl'
import {
  getImportAdministrationMappings,
  getImportWizardState,
  resetImportWizardState,
  saveImportWizardState,
} from '~/server/import-wizard'
import {
  chooseMoneybirdAdministration,
  connectMoneybird,
  disconnectMoneybird,
  getMoneybirdConnection,
  listAccounts,
  listMoneybirdAdministrations,
  moneybirdImportStatus,
  previewMoneybirdImport,
  runMoneybirdImport,
  saveMoneybirdMappings,
} from '~/server/ledger'
import { listTaxCodes } from '~/server/sales'

export const Route = createFileRoute('/_app/importeren')({
  validateSearch: (search: Record<string, unknown>): { bron?: 'moneybird' | 'exact' } => {
    const bron = search['bron']
    return bron === 'exact' || bron === 'moneybird' ? { bron } : {}
  },
  loader: async () => ({
    connection: await getMoneybirdConnection(),
    wizard: await getImportWizardState(),
    run: await moneybirdImportStatus(),
    accounts: await listAccounts(),
    taxCodes: await listTaxCodes(),
  }),
  component: ImportWizardPage,
})

interface AdministrationOption {
  readonly id: string
  readonly name: string
  readonly label: string
  readonly currency: string | null
  readonly country: string | null
  readonly fiscalYearStartMonth?: number | null
}

interface TaxSample {
  readonly moneybirdId: string
  readonly name: string
  readonly percentage: string
  readonly taxRateType?: string
  readonly proposedCode: string | null
  readonly mappedCode: string | null
  readonly mapped?: boolean
  readonly used: boolean
  readonly candidates?: readonly { readonly code: string; readonly group: 'primary' | 'other' }[]
}

interface AccountSample {
  readonly moneybirdId: string
  readonly number: string
  readonly proposedNumber: string
  readonly name: string
  readonly rgsCode?: string | null
}

interface YearDoc {
  readonly year: number
  readonly externalId: string
  readonly reference: string
}

function ImportWizardPage() {
  const {
    connection,
    wizard,
    run: runStatus,
    accounts: accountsResult,
    taxCodes: taxCodesResult,
  } = Route.useLoaderData()
  const { bron: bronParam } = Route.useSearch()
  const { t, plural, tag } = useT()
  const router = useRouter()
  const hydrated = useHydrated()
  const { advanced } = useAdvancedMode()
  const titleId = useId()

  const saved = wizard.ok ? (wizard.data.state as WizardStateRow | null) : null
  const conn = connection.ok ? connection.data.connection : null
  const canStoreSecrets = connection.ok ? connection.data.canStoreSecrets === true : false

  const [step, setStep] = useState<ImportWizardStep>(() =>
    saved !== null && isImportWizardStep(saved.step) ? saved.step : 'bron',
  )
  const [source, setSource] = useState<ImportWizardSource | null>(
    () =>
      (saved?.source as ImportWizardSource | null) ??
      (bronParam === 'moneybird' || bronParam === 'exact' ? bronParam : null),
  )
  const [showResume, setShowResume] = useState(
    () => saved !== null && saved.step !== 'bron' && saved.step !== 'klaar',
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [apiToken, setApiToken] = useState('')
  const [baseUrl, setBaseUrl] = useState('https://moneybird.com/api/v2')
  const [disconnectOpen, setDisconnectOpen] = useState(false)
  const [restartOpen, setRestartOpen] = useState(false)
  const [importConfirmOpen, setImportConfirmOpen] = useState(false)
  const [administrations, setAdministrations] = useState<readonly AdministrationOption[] | null>(
    null,
  )
  const [administrationId, setAdministrationId] = useState<string | null>(
    () => saved?.administrationId ?? conn?.administrationId ?? null,
  )
  const [selectedYears, setSelectedYears] = useState<string[]>(() =>
    saved?.selectedYears !== undefined ? [...saved.selectedYears] : [],
  )
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null)
  const [accountMappings, setAccountMappings] = useState<Record<string, string>>({})
  const [taxMappings, setTaxMappings] = useState<Record<string, string>>({})
  /** Latest mappings + a save queue so parallel Bevestigen clicks merge. */
  const taxMappingsRef = useRef(taxMappings)
  const persistChainRef = useRef(Promise.resolve(true))
  useEffect(() => {
    taxMappingsRef.current = taxMappings
  }, [taxMappings])
  /** 0037-restored mappings awaiting Bevestigen this session (#105 PM). */
  const [previousTaxMappings, setPreviousTaxMappings] = useState<Record<string, string>>({})
  const [previousAccountMappings, setPreviousAccountMappings] = useState<Record<string, string>>({})
  const [liveRun, setLiveRun] = useState<ImportRunStatusView | null>(() =>
    runStatus.ok ? (runStatus.data as ImportRunStatusView) : null,
  )
  const [importFailed, setImportFailed] = useState(false)
  const [taxViolations, setTaxViolations] = useState<
    Readonly<Record<string, TaxMappingViolationView>>
  >({})
  const [decisions, setDecisions] = useState<MoneybirdImportDecisions>(() => {
    const fromConn = conn as { importDecisions?: MoneybirdImportDecisions } | null
    return fromConn?.importDecisions ?? emptyDecisions()
  })
  const [excludedRateIds, setExcludedRateIds] = useState<Set<string>>(() => new Set())
  const [excludedByRate, setExcludedByRate] = useState<Record<string, string[]>>({})
  const [sheetRateId, setSheetRateId] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [imported, setImported] = useState(() =>
    runStatus.ok ? (runStatus.data as ImportRunStatusView).state === 'done' : false,
  )
  const [enqueueAcked, setEnqueueAcked] = useState(false)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const importProgress = importProgressPercent(liveRun, enqueueAcked || importing)
  const failureKind = importFailureKind(liveRun)

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

  /** Earliest validFrom per code (ISO → dd-mm-yyyy) for #99 copy. */
  const taxCodeValidFromLabel = useMemo(() => {
    const map = new Map<string, string>()
    if (!taxCodesResult.ok) return map
    const rows = taxCodesResult.data.taxCodes as readonly {
      readonly code: string
      readonly validFrom?: string
    }[]
    for (const row of rows) {
      if (row.validFrom === undefined || row.validFrom === '') continue
      const existing = map.get(row.code)
      if (existing === undefined || row.validFrom < existing) map.set(row.code, row.validFrom)
    }
    const labels = new Map<string, string>()
    for (const [code, iso] of map) {
      const [y, m, d] = iso.split('-')
      labels.set(code, y && m && d ? `${d}-${m}-${y}` : iso)
    }
    return labels
  }, [taxCodesResult])

  const connected = conn?.connected === true
  const taxRates = (preview?.['taxRates'] as TaxSample[] | undefined) ?? []
  const usedRates = taxRates.filter((rate) => rate.used)
  const accountSample =
    (preview?.['accounts'] as { sample: AccountSample[] } | undefined)?.sample ?? []
  const yearDocuments = (preview?.['yearDocuments'] as YearDoc[] | undefined) ?? []
  const problems = useMemo(
    () => (preview?.['problems'] as MoneybirdProblem[] | undefined) ?? [],
    [preview],
  )
  const warnings = (preview?.['warnings'] as MoneybirdProblem[] | undefined) ?? []
  const counts = (preview?.['counts'] as Record<string, number> | undefined) ?? {}
  const previewYears = ((preview?.['years'] as number[] | undefined) ?? []).map(String)
  const lockedYears = new Set(
    ((preview?.['lockedYears'] as string[] | undefined) ?? []).map(String),
  )
  const excluded = (preview?.['excluded'] as string[] | undefined) ?? []
  const alreadyInKlopt = (preview?.['alreadyInKlopt'] as
    { count: number; sample: { externalId: string; reference: string }[] } | undefined) ?? {
    count: 0,
    sample: [],
  }
  const transferCount =
    (counts['salesInvoices'] ?? 0) +
    (counts['purchaseInvoices'] ?? 0) +
    (counts['receipts'] ?? 0) +
    (counts['bankMutations'] ?? 0) +
    (counts['journalDocuments'] ?? 0)
  const runReport = liveRun?.report ?? null
  const klaarCount = klaarTransferCount(runReport)
  const filingBlock = klaarFilingBlocked({ problems, warnings })

  /** ISO validFrom per code — compare as ISO, not DD-MM-YYYY text. */
  const taxCodeValidFromIso = useMemo(() => {
    const map = new Map<string, string>()
    if (!taxCodesResult.ok) return map
    for (const row of taxCodesResult.data.taxCodes as readonly {
      readonly code: string
      readonly validFrom?: string
    }[]) {
      if (row.validFrom === undefined || row.validFrom === '') continue
      const existing = map.get(row.code)
      if (existing === undefined || row.validFrom < existing) map.set(row.code, row.validFrom)
    }
    return map
  }, [taxCodesResult])

  const notInForceByYear = useMemo(() => {
    const map = new Map<string, { count: number; codes: Set<string> }>()
    for (const problem of problems) {
      if (problem.code !== 'tax_code_not_in_force') continue
      const date = problem.detail['bookingDate'] ?? ''
      const year = date.slice(0, 4)
      if (year.length !== 4) continue
      const row = map.get(year) ?? { count: 0, codes: new Set<string>() }
      row.count += 1
      const code = problem.detail['taxCode']
      if (code) row.codes.add(code)
      map.set(year, row)
    }
    // First visit: derive from tax-code validFrom + proposed/previous/mapped codes
    // before tax_code_not_in_force problems exist (Designer #105).
    if (map.size === 0) {
      for (const year of previewYears) {
        const yearStart = `${year}-01-01`
        const codes = new Set<string>()
        let count = 0
        for (const rate of usedRates) {
          const code =
            taxMappings[rate.moneybirdId] ??
            previousTaxMappings[rate.moneybirdId] ??
            rate.proposedCode ??
            rate.candidates?.[0]?.code ??
            null
          if (code === null || code === '') continue
          const validFrom = taxCodeValidFromIso.get(code)
          if (validFrom === undefined || validFrom <= yearStart) continue
          codes.add(code)
          count += yearDocuments.filter((doc) => String(doc.year) === year).length
        }
        if (codes.size > 0 && count > 0) {
          map.set(year, { count, codes })
        }
      }
    }
    return map
  }, [
    problems,
    previewYears,
    usedRates,
    taxMappings,
    previousTaxMappings,
    taxCodeValidFromIso,
    yearDocuments,
  ])

  const blockingProblems = problems.filter((problem) => {
    if (problem.code === 'tax_code_not_in_force') {
      const date = problem.detail['bookingDate'] ?? ''
      const year = date.slice(0, 4)
      if (year !== '' && decisions.excludedYears?.includes(year)) return false
    }
    if (problem.path !== null && (decisions.excludedExternalIds ?? []).includes(problem.path)) {
      return false
    }
    // Unmapped tax rates that were excluded via “niet overzetten” no longer block.
    if (problem.code === 'unmapped_tax_rate' || problem.code === 'null_percentage_vat_mismatch') {
      const id = problem.path?.replace(/^taxRates\./, '') ?? ''
      if (id !== '' && excludedRateIds.has(id)) return false
    }
    if (problem.code === 'incompatible_tax_rate') return true
    return true
  })

  function showToast(message: string) {
    if (toastTimer.current !== null) clearTimeout(toastTimer.current)
    setToast(message)
    toastTimer.current = setTimeout(() => setToast(null), 4000)
  }

  async function persistWizard(next: {
    step?: ImportWizardStep
    source?: ImportWizardSource | null
    administrationId?: string | null
    selectedYears?: string[]
  }) {
    const body = {
      source: next.source !== undefined ? next.source : source,
      step: next.step ?? step,
      administrationId:
        next.administrationId !== undefined ? next.administrationId : administrationId,
      selectedYears: next.selectedYears ?? selectedYears,
      idempotencyKey: crypto.randomUUID(),
    }
    await saveImportWizardState({ data: body })
  }

  async function goTo(next: ImportWizardStep) {
    setStep(next)
    setShowResume(false)
    setError(null)
    await persistWizard({ step: next })
  }

  async function runPreview() {
    setBusy(true)
    setError(null)
    const result = await previewMoneybirdImport()
    setBusy(false)
    if (!result.ok) {
      setError(result.problem?.detail ?? t('common.unknownError'))
      return null
    }
    const report = result.data as Record<string, unknown>
    setPreview(report)
    const accounts = (
      report['accounts'] as { sample: { moneybirdId: string; proposedNumber: string }[] }
    ).sample
    const nextAccounts: Record<string, string> = {}
    for (const account of accounts) nextAccounts[account.moneybirdId] = account.proposedNumber
    setAccountMappings(nextAccounts)
    const rates = report['taxRates'] as TaxSample[]
    // Never auto-confirm proposed or restored mappings (#105 PM).
    const restored: Record<string, string> = {}
    for (const rate of rates) {
      if (rate.mappedCode !== null && rate.mappedCode !== '') {
        restored[rate.moneybirdId] = rate.mappedCode
      }
    }
    if (Object.keys(restored).length > 0) {
      setPreviousTaxMappings((current) => ({ ...restored, ...current }))
    }
    const years = ((report['years'] as number[] | undefined) ?? []).map(String)
    if (selectedYears.length === 0 && years.length > 0) {
      setSelectedYears(years)
    }
    return report
  }

  /** Render-safe save (no ref access). Finding cards may close over this. */
  async function persistMappings(next?: {
    accountMappings?: Record<string, string>
    taxMappings?: Record<string, string>
    importDecisions?: MoneybirdImportDecisions
  }) {
    const previousTax = taxMappings
    const attemptedTax = next?.taxMappings ?? taxMappings
    if (next?.taxMappings !== undefined) setTaxMappings(attemptedTax)
    if (next?.accountMappings !== undefined) setAccountMappings(next.accountMappings)
    setTaxViolations({})
    setBusy(true)
    setError(null)
    const result = await saveMoneybirdMappings({
      data: {
        accountMappings: next?.accountMappings ?? accountMappings,
        taxMappings: attemptedTax,
        importDecisions: next?.importDecisions ?? decisions,
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
      return false
    }
    if (next?.importDecisions !== undefined) setDecisions(next.importDecisions)
    await runPreview()
    return true
  }

  /**
   * Event-handler-only: merge rate confirms through a queue + ref so parallel
   * Bevestigen clicks cannot clobber each other. Must not be closed over by
   * finding-card actions (react-hooks/refs).
   */
  async function confirmTaxMappingPatch(patch: Record<string, string>): Promise<boolean> {
    const run = async (): Promise<boolean> => {
      const previousTax = taxMappingsRef.current
      const attemptedTax = { ...previousTax, ...patch }
      setTaxMappings(attemptedTax)
      taxMappingsRef.current = attemptedTax
      setTaxViolations({})
      setBusy(true)
      setError(null)
      const result = await saveMoneybirdMappings({
        data: {
          accountMappings,
          taxMappings: attemptedTax,
          importDecisions: decisions,
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
        taxMappingsRef.current = applied.taxMappings
        return false
      }
      await runPreview()
      return true
    }
    const queued = persistChainRef.current.then(run, run)
    persistChainRef.current = queued.then(
      () => true,
      () => true,
    )
    return queued
  }

  const findingActions: MoneybirdFindingActions = {
    onMapAccount: () => undefined,
    onMapTaxRate: (problem) => {
      const id = problem.path?.replace(/^taxRates\./, '') ?? ''
      if (id !== '') setSheetRateId(id)
    },
    onRenumberAccount: () => undefined,
    onRenumberContact: () => undefined,
    onPickAccountType: () => undefined,
    onConfirmCurrencyEur: () => undefined,
    onOpenFxStep: () => undefined,
    onConfirmFiscalYearStart: () => undefined,
    onAcknowledgeEmptyYear: () => undefined,
    onRereadResource: () => void runPreview(),
    onExcludeDocument: (problem) => {
      if (problem.path !== null) {
        void persistMappings({
          importDecisions: withExcludedExternalIds(decisions, [problem.path]),
        })
      }
    },
    onOpenPeriodSettings: () => void router.navigate({ to: '/fiscal-years' }),
    onDeferAttachment: () => undefined,
    onOpenMoneybird: (problem) => {
      const href = moneybirdDocumentUrl(
        conn?.baseUrl ?? 'https://moneybird.com/api/v2',
        administrationId ?? conn?.administrationId,
        problem.path,
      )
      if (href !== null) window.open(href, '_blank', 'noopener,noreferrer')
    },
    onDrillUnbalanced: () => undefined,
    onReviewUnbalanced: () => undefined,
    onReviewPeriodLocked: () => undefined,
    moneybirdHrefFor: (problem) =>
      moneybirdDocumentUrl(
        conn?.baseUrl ?? 'https://moneybird.com/api/v2',
        administrationId ?? conn?.administrationId,
        problem.path,
      ),
    labels: {
      mapAccount: t('moneybird.fix.mapAccount'),
      mapTax: t('moneybird.fix.mapTax'),
      renumberAccount: t('moneybird.fix.renumberAccount'),
      renumberContact: t('moneybird.fix.renumberContact'),
      pickType: t('moneybird.fix.pickType'),
      confirmEur: t('moneybird.fix.confirmEur'),
      chooseRate: t('moneybird.fix.chooseRate'),
      confirmYearStart: t('moneybird.fix.confirmYearStart', { month: '' }),
      acknowledgeEmpty: t('moneybird.fix.acknowledgeEmpty', { year: '' }),
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
      stepMapAccount: t('moneybird.fix.stepMapAccount'),
      stepMapTax: t('moneybird.fix.stepMapTax'),
      stepSave: t('moneybird.fix.stepSave'),
    },
  }

  function docsForRate(rateId: string): string[] {
    const problem = [...problems, ...warnings].find(
      (row) =>
        (row.code === 'null_percentage_vat_mismatch' || row.code === 'unmapped_tax_rate') &&
        row.path === `taxRates.${rateId}`,
    )
    if (problem === undefined) return []
    const refs = (problem.detail['references'] ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    if (refs.length === 0) return []
    return yearDocuments
      .filter((doc) =>
        refs.some((ref) => doc.reference === ref || doc.externalId.endsWith(`:${ref}`)),
      )
      .map((doc) => doc.externalId)
  }

  async function excludeRate(rateId: string) {
    const ids = docsForRate(rateId)
    setExcludedRateIds((current) => new Set([...current, rateId]))
    setExcludedByRate((current) => ({ ...current, [rateId]: ids }))
    if (ids.length > 0) {
      await persistMappings({
        importDecisions: withExcludedExternalIds(decisions, ids),
      })
    }
    if (ids.length > 0) showToast(plural('wizard.btw.excludeDocs', ids.length))
  }

  async function undoExcludeRate(rateId: string) {
    const ids =
      excludedByRate[rateId] ??
      docsForRate(rateId).filter((id) => (decisions.excludedExternalIds ?? []).includes(id))
    setExcludedRateIds((current) => {
      const next = new Set(current)
      next.delete(rateId)
      return next
    })
    setExcludedByRate((current) => {
      const next = { ...current }
      delete next[rateId]
      return next
    })
    if (ids.length > 0) {
      await persistMappings({
        importDecisions: withoutExcludedExternalIds(decisions, ids),
      })
    }
  }

  /** Rebuild session excluded-rate chrome from persisted decisions (Legal #105). */
  useEffect(() => {
    if (usedRates.length === 0) return
    const rebuilt = rebuildExcludedRates({
      excludedExternalIds: decisions.excludedExternalIds ?? [],
      rates: usedRates,
      docsForRate,
    })
    setExcludedRateIds(rebuilt.rateIds)
    setExcludedByRate(rebuilt.byRate)
    // docsForRate closes over problems/yearDocuments; rebuild when those settle.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional on decisions + preview
  }, [decisions.excludedExternalIds, preview])

  const canNext = (() => {
    switch (step) {
      case 'bron':
        return canAdvanceFromBron(source)
      case 'verbinden':
        // Connected → Volgende; otherwise allow connecting when a token is pasted.
        return canAdvanceFromVerbinden(connected) || (canStoreSecrets && apiToken.trim() !== '')
      case 'administratie':
        return canAdvanceFromAdministratie({ administrationId, selectedYears })
      case 'voorbeeld':
        return canAdvanceFromVoorbeeld(preview !== null)
      case 'btw':
        return canAdvanceFromBtw({
          usedRates: usedRates.map((rate) => ({
            moneybirdId: rate.moneybirdId,
            mapped: Boolean(taxMappings[rate.moneybirdId]),
          })),
          excludedRateIds,
        })
      case 'rekeningen':
        return true
      case 'problemen':
        return canAdvanceFromProblemen(blockingProblems.length)
      case 'overzicht':
        return true
      case 'importeren':
        return imported || isImportRunDone(liveRun)
      case 'klaar':
        return false
    }
  })()

  const nextReason = (() => {
    if (canNext) return null
    if (step === 'bron' && source === 'exact') return t('wizard.status.exactBlocked')
    if (step === 'bron') return t('wizard.status.pickSource')
    if (step === 'verbinden') return t('wizard.status.pasteToken')
    if (step === 'administratie') return t('wizard.status.needAdmin')
    if (step === 'voorbeeld') return t('wizard.status.needPreview')
    if (step === 'btw') {
      const left = usedRates.filter(
        (rate) => !taxMappings[rate.moneybirdId] && !excludedRateIds.has(rate.moneybirdId),
      ).length
      return plural('wizard.btw.chooseFirst', left)
    }
    if (step === 'problemen') return t('wizard.problemen.stillBlocked')
    if (step === 'importeren') return t('wizard.status.importing')
    return null
  })()

  async function handleNext() {
    if (!canNext || busy) return
    if (step === 'bron' && source === 'moneybird') {
      await goTo('verbinden')
      return
    }
    if (step === 'verbinden') {
      if (!connected) {
        setBusy(true)
        setError(null)
        const result = await connectMoneybird({
          data: { baseUrl, apiToken, idempotencyKey: crypto.randomUUID() },
        })
        setBusy(false)
        if (!result.ok) {
          setError(result.problem?.detail ?? t('common.unknownError'))
          return
        }
        setApiToken('')
        await router.invalidate()
      }
      await goTo('administratie')
      return
    }
    if (step === 'administratie') {
      const years = previewYears.length > 0 ? previewYears : selectedYears
      const excludedYrs = excludedYearsFromSelection(years, selectedYears)
      await persistMappings({
        importDecisions: withExcludedYears(decisions, excludedYrs),
      })
      await persistWizard({ selectedYears, administrationId })
      if (preview === null) await runPreview()
      await goTo('voorbeeld')
      return
    }
    if (step === 'voorbeeld') {
      if (preview === null) await runPreview()
      await goTo('btw')
      return
    }
    if (step === 'btw') {
      await goTo('rekeningen')
      return
    }
    if (step === 'rekeningen') {
      await persistMappings({})
      await goTo('problemen')
      return
    }
    if (step === 'problemen') {
      await goTo('overzicht')
      return
    }
    if (step === 'overzicht') {
      setImportConfirmOpen(true)
      return
    }
    if (step === 'importeren') {
      await goTo('klaar')
    }
  }

  async function pollUntilTerminal(): Promise<ImportRunStatusView | null> {
    for (let attempt = 0; attempt < 180; attempt += 1) {
      const status = await moneybirdImportStatus()
      if (!status.ok) {
        await new Promise((resolve) => setTimeout(resolve, 2000))
        continue
      }
      const body = status.data as ImportRunStatusView
      setLiveRun(body)
      if (body.state === 'done' || body.state === 'failed') return body
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
    return liveRun
  }

  async function startImport() {
    setImportConfirmOpen(false)
    setImporting(true)
    setImportFailed(false)
    setEnqueueAcked(false)
    setImported(false)
    setError(null)
    await goTo('importeren')
    const result = await runMoneybirdImport({ data: { idempotencyKey: crypto.randomUUID() } })
    if (!result.ok) {
      setImporting(false)
      setImportFailed(true)
      setLiveRun({ state: 'failed', report: null, lastError: result.problem?.detail ?? null })
      setError(result.problem?.detail ?? t('common.unknownError'))
      return
    }
    setEnqueueAcked(true)
    setLiveRun(result.data as ImportRunStatusView)
    const terminal = await pollUntilTerminal()
    setImporting(false)
    await router.invalidate()
    if (terminal?.state === 'done') {
      setImported(true)
      await goTo('klaar')
      return
    }
    setImportFailed(true)
    setError(terminal?.lastError ?? t('common.unknownError'))
  }

  async function handleBack() {
    if (isTerminalStep(step)) return
    const prev = prevStep(step)
    if (prev === null) return
    await goTo(prev)
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (disconnectOpen || restartOpen || importConfirmOpen || sheetRateId !== null) {
        if (event.key === 'Escape') return
      }
      if (event.key === 'Escape' && !isTerminalStep(step)) {
        const target = event.target
        if (
          target instanceof HTMLElement &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' ||
            target.isContentEditable)
        ) {
          target.blur()
          event.preventDefault()
          return
        }
        event.preventDefault()
        void handleBack()
        return
      }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        void handleNext()
        return
      }
      if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
        if (!flowShouldAdvanceOnEnter(event)) return
        event.preventDefault()
        void handleNext()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers close over latest state
  }, [step, canNext, busy, disconnectOpen, restartOpen, importConfirmOpen, sheetRateId])

  if (!connection.ok) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {connection.problem.detail}
      </p>
    )
  }

  const sheetRate = taxRates.find((rate) => rate.moneybirdId === sheetRateId) ?? null
  const taxHref = moneybirdTaxSettingsUrl(
    conn?.baseUrl ?? 'https://moneybird.com/api/v2',
    administrationId ?? conn?.administrationId,
  )

  const otherBlockingCards = problems
    .filter((problem) => problem.code !== 'tax_code_not_in_force')
    .filter((problem) =>
      blockingProblems.some((row) => row.code === problem.code && row.path === problem.path),
    )
    .map((problem) => moneybirdFindingCard(problem, 'problems', findingActions))
  const infoCards = warnings.map((warning) =>
    moneybirdFindingCard(warning, 'warnings', findingActions),
  )
  const reconciliationRows =
    (preview?.['reconciliation'] as
      | {
          year: number
          source: string
          totalDebit: string | null
          totalCredit: string | null
          balanced: boolean | null
        }[]
      | undefined) ?? []

  return (
    <div
      className="mx-auto flex w-full max-w-6xl flex-col gap-6 lg:flex-row lg:items-start"
      data-slot="import-wizard"
      aria-labelledby={titleId}
    >
      <aside className="lg:sticky lg:top-4 lg:w-56 lg:shrink-0">
        <WizardProgressRail
          step={step}
          onJump={(target) => {
            if (stepIndex(target) <= stepIndex(step)) void goTo(target)
          }}
        />
      </aside>
      <div className="min-w-0 flex-1">
        {error !== null && error !== '' && step !== 'importeren' && (
          <p role="alert" className="text-destructive mb-4 text-sm">
            {error}
          </p>
        )}

        {step === 'bron' && (
          <>
            <WizardStepHeader
              titleId={titleId}
              step={step}
              title={showResume ? t('wizard.resume.title') : t('wizard.bron.title')}
              intro={
                showResume
                  ? t('wizard.resume.body', {
                      source: saved?.source === 'exact' ? 'Exact Online' : 'Moneybird',
                    })
                  : t('wizard.bron.intro')
              }
            />
            {showResume && saved !== null && (
              <section className="border-border border-accent mb-6 border border-l-[3px] p-5">
                <p className="text-muted-foreground text-xs tabular-nums">
                  {t(
                    IMPORT_WIZARD_STEP_KEYS[stepIndex(saved.step as ImportWizardStep)] ??
                      'wizard.step.bron',
                  )}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    className="min-h-11 md:min-h-9"
                    onClick={() => {
                      setShowResume(false)
                      if (isImportWizardStep(saved.step)) void goTo(saved.step)
                    }}
                  >
                    {t('wizard.resume.continue')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 md:min-h-9"
                    onClick={() => setRestartOpen(true)}
                  >
                    {t('wizard.resume.restart')}
                  </Button>
                </div>
              </section>
            )}
            {!showResume && (
              <div
                role="radiogroup"
                aria-label={t('wizard.bron.title')}
                className="grid gap-3 sm:grid-cols-2"
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
                  event.preventDefault()
                  const order = ['moneybird', 'exact'] as const
                  const current = source === null ? -1 : order.indexOf(source)
                  const delta = event.key === 'ArrowDown' ? 1 : -1
                  const next = order[(current + delta + order.length) % order.length] ?? 'moneybird'
                  setSource(next)
                  void persistWizard({ source: next, step: 'bron' })
                  const el = document.querySelector<HTMLElement>(`[data-source-card="${next}"]`)
                  el?.focus()
                }}
              >
                {(
                  [
                    {
                      id: 'moneybird' as const,
                      label: 'Moneybird',
                      scope: t('wizard.bron.moneybird.scope'),
                      notIncluded: t('wizard.bron.moneybird.notIncluded'),
                    },
                    {
                      id: 'exact' as const,
                      label: 'Exact Online',
                      scope: t('wizard.bron.exact.scope'),
                      notIncluded: t('wizard.bron.exact.notIncluded'),
                    },
                  ] as const
                ).map((item) => {
                  const selected = source === item.id
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      data-source-card={item.id}
                      disabled={!hydrated}
                      tabIndex={selected || (source === null && item.id === 'moneybird') ? 0 : -1}
                      className={cn(
                        'border-border flex min-h-11 w-full flex-col items-start border p-4 text-left',
                        selected && 'bg-muted border-2 border-foreground p-[15px]',
                      )}
                      onClick={() => {
                        setSource(item.id)
                        void persistWizard({ source: item.id, step: 'bron' })
                      }}
                    >
                      <span className="font-medium">{item.label}</span>
                      <span className="text-muted-foreground mt-1 text-sm">{item.scope}</span>
                      <span className="text-muted-foreground mt-1 text-xs">{item.notIncluded}</span>
                    </button>
                  )
                })}
              </div>
            )}
            {source === 'exact' && !showResume && (
              <div className="mt-6">
                <AttentionBlock tone="info" title={t('wizard.bron.exact.deadEnd')}>
                  <Button asChild variant="outline" className="mt-2 min-h-11 md:min-h-9">
                    <Link to="/exact">{t('wizard.bron.exact.openLegacy')}</Link>
                  </Button>
                </AttentionBlock>
              </div>
            )}
            {!showResume && (
              <WizardFooter
                showBack={false}
                nextLabel={t('wizard.next')}
                nextDisabled={!hydrated || !canNext}
                nextReason={nextReason}
                onNextBlocked={() => {
                  if (nextReason !== null && nextReason !== '') showToast(nextReason)
                }}
                onNext={() => void handleNext()}
              />
            )}
          </>
        )}

        {step === 'verbinden' && (
          <>
            <WizardStepHeader
              titleId={titleId}
              step={step}
              title={t('wizard.verbinden.title')}
              intro={t('wizard.verbinden.intro')}
            />
            {!canStoreSecrets && (
              <div className="mb-6">
                <AttentionBlock title={t('wizard.verbinden.noKeyTitle')}>
                  <p>{t('wizard.verbinden.noKeyBody')}</p>
                  <p>{t('wizard.verbinden.noKeyAdmin')}</p>
                  <p>{t('wizard.verbinden.encryptionSoft')}</p>
                </AttentionBlock>
              </div>
            )}
            {connected ? (
              <div className="border-border border p-4">
                <p className="font-medium">{t('wizard.verbinden.connected')}</p>
                <p className="text-muted-foreground mt-1 text-sm">
                  {conn?.administrationName ?? 'Moneybird'} — {t('wizard.verbinden.connectedHint')}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  className="mt-3 min-h-11 text-muted-foreground md:min-h-9"
                  onClick={() => setDisconnectOpen(true)}
                >
                  {t('moneybird.disconnect')}
                </Button>
              </div>
            ) : (
              <form
                className="max-w-lg space-y-5"
                onSubmit={(event) => {
                  event.preventDefault()
                  void handleNext()
                }}
              >
                <label className="block text-sm font-medium">
                  {t('moneybird.apiToken')}
                  <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    disabled={!hydrated || !canStoreSecrets}
                    value={apiToken}
                    onChange={(event) => setApiToken(event.target.value)}
                    className="field-control mt-1.5 tabular-nums"
                    aria-describedby="token-help"
                  />
                </label>
                <p id="token-help" className="text-muted-foreground text-sm">
                  {t('wizard.verbinden.tokenHelp')}
                </p>
                <details className="border-border border px-4 py-3 text-sm">
                  <summary className="-mx-4 -my-3 flex min-h-11 cursor-pointer items-center px-4 font-medium">
                    {t('wizard.verbinden.tokenWhere')}
                  </summary>
                  <p className="text-muted-foreground mt-3">{t('wizard.verbinden.tokenSteps')}</p>
                </details>
                <details className="border-border border px-4 py-3 text-sm" open={advanced}>
                  <summary className="-mx-4 -my-3 flex min-h-11 cursor-pointer items-center px-4 font-medium">
                    {t('shell.advanced')}
                  </summary>
                  <label className="mt-3 block text-sm font-medium">
                    {t('moneybird.baseUrl')}
                    <input
                      value={baseUrl}
                      onChange={(event) => setBaseUrl(event.target.value)}
                      disabled={!hydrated}
                      className="field-control mt-1.5 text-xs tabular-nums"
                    />
                    <span className="text-muted-foreground mt-1 block text-xs">
                      {t('wizard.verbinden.baseUrlHelp')}
                    </span>
                  </label>
                </details>
              </form>
            )}
            <WizardFooter
              showBack
              onBack={() => void handleBack()}
              nextLabel={connected ? t('wizard.next') : t('wizard.connect')}
              nextDisabled={connected ? false : !canStoreSecrets || apiToken === '' || busy}
              nextReason={!canStoreSecrets ? t('wizard.verbinden.noKeyTitle') : null}
              onNext={() => void handleNext()}
            />
          </>
        )}

        {step === 'administratie' && (
          <>
            <WizardStepHeader
              titleId={titleId}
              step={step}
              title={t('wizard.administratie.title')}
              intro={t('wizard.administratie.intro')}
            />
            <section className="mb-6">
              <h2 className="mb-2 text-sm font-medium">{t('wizard.administratie.admins')}</h2>
              <Button
                type="button"
                variant="outline"
                className="mb-3 min-h-11 md:min-h-9"
                disabled={busy}
                onClick={() => {
                  setBusy(true)
                  void listMoneybirdAdministrations().then((result) => {
                    setBusy(false)
                    if (!result.ok) {
                      setError(result.problem?.detail ?? t('common.unknownError'))
                      return
                    }
                    setAdministrations(
                      (result.data as { administrations: readonly AdministrationOption[] })
                        .administrations,
                    )
                  })
                }}
              >
                {t('wizard.administratie.fetch')}
              </Button>
              {administrations !== null && (
                <RadioGroup
                  value={administrationId}
                  onValueChange={(id) => {
                    setAdministrationId(id)
                    setBusy(true)
                    void chooseMoneybirdAdministration({
                      data: { administrationId: id, idempotencyKey: crypto.randomUUID() },
                    }).then(async (result) => {
                      setBusy(false)
                      if (!result.ok) {
                        setError(result.problem?.detail ?? t('common.unknownError'))
                        return
                      }
                      const mapped = await getImportAdministrationMappings({
                        data: { source: 'moneybird', administrationId: id },
                      })
                      if (mapped.ok && mapped.data.mappings !== null) {
                        const row = mapped.data.mappings as {
                          accountMappings: Record<string, string>
                          taxMappings: Record<string, string>
                          importDecisions: MoneybirdImportDecisions
                        }
                        setAccountMappings({})
                        setPreviousAccountMappings(row.accountMappings)
                        setPreviousTaxMappings(row.taxMappings)
                        setTaxMappings({})
                        setExcludedRateIds(new Set())
                        setExcludedByRate({})
                        setDecisions(row.importDecisions)
                      } else {
                        setAccountMappings({})
                        setPreviousAccountMappings({})
                        setPreviousTaxMappings({})
                        setTaxMappings({})
                        setDecisions(emptyDecisions())
                      }
                      await router.invalidate()
                      await runPreview()
                    })
                  }}
                  className="border-border divide-y border"
                  aria-label={t('wizard.administratie.admins')}
                >
                  {administrations.map((admin) => {
                    const monthKey =
                      admin.fiscalYearStartMonth !== undefined &&
                      admin.fiscalYearStartMonth !== null &&
                      admin.fiscalYearStartMonth >= 1 &&
                      admin.fiscalYearStartMonth <= 12
                        ? (`wizard.administratie.month.${String(admin.fiscalYearStartMonth)}` as MessageKey)
                        : null
                    const docsForAdmin =
                      administrationId === admin.id && preview !== null ? yearDocuments.length : 0
                    const monthLabel = monthKey !== null ? t(monthKey) : null
                    return (
                      <label
                        key={admin.id}
                        className={cn(
                          'flex min-h-11 cursor-pointer items-start gap-3 px-4 py-3',
                          administrationId === admin.id ? 'bg-muted' : 'hover:bg-muted',
                        )}
                      >
                        <RadioGroupItem value={admin.id} className="mt-1" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{admin.name}</span>
                          <span className="text-muted-foreground block text-xs tabular-nums">
                            {monthLabel === null
                              ? t('wizard.administratie.docsLineUnknown', {
                                  currency: admin.currency ?? 'EUR',
                                })
                              : administrationId === admin.id && preview !== null
                                ? plural('wizard.administratie.docsLine', docsForAdmin, {
                                    currency: admin.currency ?? 'EUR',
                                    month: monthLabel,
                                    count: String(docsForAdmin),
                                  })
                                : t('wizard.administratie.docsLine_zero', {
                                    currency: admin.currency ?? 'EUR',
                                    month: monthLabel,
                                    count: '0',
                                  })}
                            {advanced ? ` · ${admin.id}` : ''}
                          </span>
                        </span>
                      </label>
                    )
                  })}
                </RadioGroup>
              )}
            </section>
            {(previewYears.length > 0 || selectedYears.length > 0) && (
              <section className="mb-6">
                <h2 className="mb-2 text-sm font-medium">{t('wizard.administratie.years')}</h2>
                <div className="border-border overflow-x-auto border">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-muted text-muted-foreground text-xs">
                      <tr>
                        <th className="w-10 py-2 pl-4">
                          <span className="sr-only">{t('wizard.overzicht.transfer')}</span>
                        </th>
                        <th className="py-2 pr-3 font-medium">{t('wizard.administratie.years')}</th>
                        <th className="py-2 pr-3 text-right font-medium">
                          {t('wizard.administratie.docs')}
                        </th>
                        <th className="py-2 pr-4 font-medium">
                          {t('wizard.administratie.inKlopt')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {(previewYears.length > 0 ? previewYears : selectedYears).map((year) => {
                        const docs = yearDocuments.filter((doc) => String(doc.year) === year).length
                        const nif = notInForceByYear.get(year)
                        const closed = lockedYears.has(year)
                        const checked = !closed && selectedYears.includes(year)
                        const warnId = `year-warn-${year}`
                        const helpId = `year-help-${year}`
                        const emptyRates = usedRates.filter(
                          (rate) => (rate.candidates ?? []).length === 0,
                        )
                        const noFitCount =
                          emptyRates.length === 0
                            ? 0
                            : yearDocuments.filter(
                                (doc) =>
                                  String(doc.year) === year &&
                                  emptyRates.some((rate) =>
                                    docsForRate(rate.moneybirdId).includes(doc.externalId),
                                  ),
                              ).length
                        const nifCodes = nif !== undefined ? [...nif.codes] : []
                        const earliestIso =
                          nifCodes
                            .map((code) => taxCodeValidFromIso.get(code))
                            .filter((iso): iso is string => iso !== undefined)
                            .sort()[0] ?? null
                        const validFrom =
                          earliestIso !== null
                            ? (taxCodeValidFromLabel.get(nifCodes[0] ?? '') ??
                              (() => {
                                const [y, m, d] = earliestIso.split('-')
                                return y && m && d ? `${d}-${m}-${y}` : earliestIso
                              })())
                            : `01-01-${year}`
                        return (
                          <tr key={year} className="border-border border-t align-top">
                            <td className="px-4 py-3">
                              <Checkbox
                                checked={checked}
                                disabled={closed}
                                aria-label={year}
                                aria-describedby={
                                  nif !== undefined && nif.count > 0
                                    ? `${warnId} ${helpId}`
                                    : undefined
                                }
                                onCheckedChange={(value) => {
                                  if (closed) return
                                  const on = value === true
                                  setSelectedYears((current) =>
                                    on
                                      ? [...new Set([...current, year])]
                                      : current.filter((item) => item !== year),
                                  )
                                }}
                              />
                            </td>
                            <td className="py-3 pr-3 align-top">
                              <span
                                className={cn(
                                  'font-medium tabular-nums',
                                  nif !== undefined && nif.count > 0 && 'text-destructive',
                                )}
                              >
                                {year}
                              </span>
                              {nif !== undefined && nif.count > 0 && (
                                <div className="mt-2">
                                  <Badge variant="destructive">{t('findingCard.blocking')}</Badge>
                                  <p
                                    id={warnId}
                                    className="text-destructive mt-1 text-xs font-medium"
                                  >
                                    {plural('wizard.year.notInForce', nif.count, {
                                      year,
                                      count: String(nif.count),
                                    })}
                                  </p>
                                  <p id={helpId} className="text-muted-foreground mt-0.5 text-xs">
                                    {t('wizard.year.notInForceHelp', { validFrom, year })}
                                  </p>
                                </div>
                              )}
                              {noFitCount > 0 && (
                                <p className="text-warning mt-2 text-xs">
                                  {plural('wizard.year.noFittingCode', noFitCount, {
                                    count: String(noFitCount),
                                  })}
                                </p>
                              )}
                            </td>
                            <td className="py-3 pr-3 text-right align-top tabular-nums">{docs}</td>
                            <td className="py-3 pr-4 align-top">
                              <span className="block">
                                {closed
                                  ? t('wizard.administratie.closed')
                                  : t('wizard.administratie.open')}
                              </span>
                              {closed && (
                                <p className="text-muted-foreground mt-1 text-xs">
                                  {t('wizard.administratie.closedHint')}
                                </p>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
            <WizardFooter
              showBack
              onBack={() => void handleBack()}
              nextLabel={t('wizard.next')}
              nextDisabled={!canNext || busy}
              nextReason={nextReason}
              onNextBlocked={() => {
                if (nextReason !== null && nextReason !== '') showToast(nextReason)
              }}
              onNext={() => void handleNext()}
            />
          </>
        )}

        {step === 'voorbeeld' && (
          <>
            <WizardStepHeader
              titleId={titleId}
              step={step}
              title={t('wizard.voorbeeld.title')}
              intro={t('wizard.voorbeeld.intro')}
            />
            <div className="mb-4 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="min-h-11 md:min-h-9"
                disabled={busy}
                onClick={() => void runPreview()}
              >
                {busy ? t('wizard.voorbeeld.reading') : t('wizard.voorbeeld.reread')}
              </Button>
            </div>
            {preview !== null && (
              <dl className="border-border grid gap-2 border p-4 text-sm sm:grid-cols-2">
                {(
                  [
                    ['salesInvoices', 'moneybird.salesInvoices'],
                    ['purchaseInvoices', 'moneybird.purchaseInvoices'],
                    ['receipts', 'moneybird.receipts'],
                    ['contacts', 'moneybird.contacts'],
                    ['ledgerAccounts', 'moneybird.ledgerAccounts'],
                    ['bankMutations', 'moneybird.bankMutations'],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">{t(label)}</dt>
                    <dd className="tabular-nums">
                      {String(
                        key === 'ledgerAccounts' ? (counts['accounts'] ?? 0) : (counts[key] ?? 0),
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            <WizardFooter
              showBack
              onBack={() => void handleBack()}
              nextLabel={t('wizard.next')}
              nextDisabled={!canNext || busy}
              nextReason={nextReason}
              onNextBlocked={() => {
                if (nextReason !== null && nextReason !== '') showToast(nextReason)
              }}
              onNext={() => void handleNext()}
            />
          </>
        )}

        {step === 'btw' && (
          <>
            <WizardStepHeader
              titleId={titleId}
              step={step}
              title={t('wizard.btw.title')}
              intro={t('wizard.btw.intro')}
            />
            <ul role="list" aria-label={t('wizard.step.btw')} className="space-y-3">
              {usedRates.map((rate) => {
                const confirmed = taxMappings[rate.moneybirdId]
                const previous = previousTaxMappings[rate.moneybirdId]
                const excluded = excludedRateIds.has(rate.moneybirdId)
                const empty = (rate.candidates ?? []).length === 0
                const suggested =
                  confirmed === undefined &&
                  rate.proposedCode !== null &&
                  (rate.candidates ?? []).some(
                    (c) => c.code === rate.proposedCode && c.group === 'primary',
                  )
                const showPrevious =
                  confirmed === undefined && previous !== undefined && previous !== '' && !suggested
                const docs = docsForRate(rate.moneybirdId)
                const excludeCount = docs.length || excludedByRate[rate.moneybirdId]?.length || 0
                return (
                  <li key={rate.moneybirdId}>
                    <article
                      className={cn(
                        'border-border border border-l-4 bg-card p-4 md:p-5',
                        excluded
                          ? 'border-l-[var(--border)]'
                          : empty || confirmed === undefined
                            ? 'border-l-warning'
                            : 'border-l-success',
                      )}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="text-[15px] font-medium">{rate.name}</h3>
                          <p className="text-muted-foreground text-xs tabular-nums">
                            {rate.percentage === '' ||
                            rate.percentage === null ||
                            rate.percentage === undefined ||
                            rate.percentage === '—'
                              ? t('wizard.btw.nullPercent')
                              : `${rate.percentage}%`}
                            {advanced ? ` · ${rate.moneybirdId}` : ''}
                          </p>
                        </div>
                        {excluded ? (
                          <Badge variant="outline">{t('wizard.btw.excluded')}</Badge>
                        ) : confirmed !== undefined ? (
                          <Badge variant="success">{t('wizard.btw.chosen')}</Badge>
                        ) : showPrevious ? (
                          <Badge variant="outline">{t('wizard.btw.previous')}</Badge>
                        ) : suggested ? (
                          <Badge variant="outline">{t('wizard.btw.suggested')}</Badge>
                        ) : empty ? (
                          <Badge variant="attention">{t('wizard.btw.noCode')}</Badge>
                        ) : (
                          <Badge variant="attention">{t('wizard.btw.needChoice')}</Badge>
                        )}
                      </div>
                      {excluded ? (
                        <div className="mt-3">
                          <p className="text-sm">
                            {plural(
                              'wizard.btw.excludedBody',
                              excludeCount > 0 ? excludeCount : 1,
                              {
                                count: String(excludeCount > 0 ? excludeCount : 1),
                              },
                            )}
                          </p>
                          <Button
                            type="button"
                            variant="outline"
                            className="mt-3 min-h-11 md:min-h-9"
                            onClick={() => void undoExcludeRate(rate.moneybirdId)}
                          >
                            {t('wizard.btw.excludeUndo')}
                          </Button>
                        </div>
                      ) : empty ? (
                        <div className="mt-3">
                          <AttentionBlock title={t('wizard.btw.fixRateInMoneybird')}>
                            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                              {taxHref !== null && (
                                <Button asChild variant="outline" className="min-h-11 md:min-h-9">
                                  <a href={taxHref} target="_blank" rel="noreferrer">
                                    {t('moneybird.fix.openMoneybird')}
                                  </a>
                                </Button>
                              )}
                              <Button
                                type="button"
                                variant="outline"
                                className="min-h-11 md:min-h-9"
                                onClick={() => void runPreview()}
                              >
                                {t('moneybird.fix.reread')}
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                className="min-h-11 md:min-h-9"
                                onClick={() => void excludeRate(rate.moneybirdId)}
                              >
                                {plural(
                                  'wizard.btw.excludeDocs',
                                  docs.length ||
                                    problemCountForRate(problems, rate.moneybirdId) ||
                                    1,
                                )}
                              </Button>
                              {advanced && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  className="min-h-11 md:min-h-9"
                                  onClick={() => setSheetRateId(rate.moneybirdId)}
                                >
                                  {t('wizard.btw.chooseInTable')}
                                </Button>
                              )}
                            </div>
                          </AttentionBlock>
                        </div>
                      ) : showPrevious && previous !== undefined ? (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <p className="text-muted-foreground text-sm tabular-nums">{previous}</p>
                          <Button
                            type="button"
                            variant="outline"
                            className="min-h-11 md:min-h-9"
                            onClick={() =>
                              void confirmTaxMappingPatch({ [rate.moneybirdId]: previous })
                            }
                          >
                            {t('wizard.btw.confirm')}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            className="min-h-11 md:min-h-9"
                            onClick={() => setSheetRateId(rate.moneybirdId)}
                          >
                            {t('wizard.btw.chooseOther')}
                          </Button>
                        </div>
                      ) : suggested && rate.proposedCode !== null ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            className="min-h-11 md:min-h-9"
                            onClick={() =>
                              void confirmTaxMappingPatch({
                                [rate.moneybirdId]: rate.proposedCode!,
                              })
                            }
                          >
                            {t('wizard.btw.confirm')}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            className="min-h-11 md:min-h-9"
                            onClick={() => setSheetRateId(rate.moneybirdId)}
                          >
                            {t('wizard.btw.chooseOther')}
                          </Button>
                        </div>
                      ) : confirmed === undefined ? (
                        <div className="mt-3">
                          <Button
                            type="button"
                            variant="outline"
                            className="min-h-11 md:min-h-9"
                            onClick={() => setSheetRateId(rate.moneybirdId)}
                          >
                            {t('wizard.btw.chooseCode')}
                          </Button>
                        </div>
                      ) : (
                        <p className="text-muted-foreground mt-3 text-sm tabular-nums">
                          {confirmed}
                        </p>
                      )}
                      {taxViolations[rate.moneybirdId] !== undefined &&
                        sheetRateId !== rate.moneybirdId && (
                          <p role="alert" className="text-destructive mt-2 text-sm">
                            {refusedRateMessage(
                              rate,
                              taxViolations[rate.moneybirdId]!,
                              t,
                              kloptTaxRules,
                            )}
                            <span className="text-muted-foreground mt-1 block text-xs">
                              {t('wizard.btw.refusedRateFootnote')}
                            </span>
                          </p>
                        )}
                    </article>
                  </li>
                )
              })}
            </ul>
            <WizardFooter
              showBack
              onBack={() => void handleBack()}
              nextLabel={t('wizard.next')}
              nextDisabled={!canNext || busy}
              nextReason={nextReason}
              onNextBlocked={() => {
                if (nextReason !== null && nextReason !== '') showToast(nextReason)
              }}
              onNext={() => void handleNext()}
            />
          </>
        )}

        {step === 'rekeningen' && (
          <>
            <WizardStepHeader
              titleId={titleId}
              step={step}
              title={t('wizard.rekeningen.title')}
              intro={t('wizard.rekeningen.intro')}
            />
            {preview !== null ? (
              <ul role="list" className="mb-6 divide-y overflow-x-hidden border">
                {accountSample.map((account) => {
                  const confirmed = accountMappings[account.moneybirdId]
                  const previous = previousAccountMappings[account.moneybirdId]
                  const proposed = account.proposedNumber
                  const chosenNumber = confirmed ?? previous ?? proposed
                  const kloptName =
                    kloptAccounts.find((row) => row.number === chosenNumber)?.name ?? chosenNumber
                  const badge =
                    confirmed !== undefined
                      ? t('wizard.rekeningen.chosen')
                      : previous !== undefined
                        ? t('wizard.rekeningen.previous')
                        : t('wizard.rekeningen.suggested')
                  return (
                    <li key={account.moneybirdId} className="px-4 py-3">
                      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium break-words">
                            {account.name}
                            <span className="text-muted-foreground font-normal"> → </span>
                            {kloptName}
                          </p>
                          <p className="text-muted-foreground mt-0.5 text-xs tabular-nums">
                            {advanced ? `${account.number} → ${chosenNumber}` : chosenNumber}
                            {advanced && account.rgsCode ? ` · ${account.rgsCode}` : ''}
                          </p>
                          <Badge variant="secondary" className="mt-2">
                            {badge}
                          </Badge>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2">
                          {confirmed === undefined && (
                            <Button
                              type="button"
                              className="min-h-11 md:min-h-9"
                              disabled={busy}
                              onClick={() => {
                                const next = {
                                  ...accountMappings,
                                  [account.moneybirdId]: chosenNumber,
                                }
                                setAccountMappings(next)
                                void persistMappings({ accountMappings: next })
                              }}
                            >
                              {t('wizard.rekeningen.confirm')}
                            </Button>
                          )}
                          {advanced && (
                            <label className="flex min-h-11 items-center gap-2 text-sm md:min-h-9">
                              <span className="sr-only">{t('wizard.rekeningen.title')}</span>
                              <input
                                className="border-input bg-background h-9 w-24 border px-2 tabular-nums"
                                value={accountMappings[account.moneybirdId] ?? chosenNumber}
                                onChange={(event) =>
                                  setAccountMappings((current) => ({
                                    ...current,
                                    [account.moneybirdId]: event.target.value,
                                  }))
                                }
                              />
                            </label>
                          )}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <Button type="button" onClick={() => void runPreview()}>
                {t('wizard.voorbeeld.reread')}
              </Button>
            )}
            <WizardFooter
              showBack
              onBack={() => void handleBack()}
              nextLabel={t('wizard.next')}
              nextDisabled={busy}
              onNext={() => void handleNext()}
            />
          </>
        )}

        {step === 'problemen' && (
          <>
            <WizardStepHeader
              titleId={titleId}
              step={step}
              title={t('wizard.problemen.title')}
              intro={t('wizard.problemen.intro')}
            />
            {groupNotInForce(problems).map((group) => {
              const validFrom = taxCodeValidFromLabel.get(group.code)
              return (
                <div key={`${group.code}-${group.year}`} className="mb-4">
                  <AttentionBlock
                    tone="error"
                    badge={<Badge variant="destructive">{t('findingCard.blocking')}</Badge>}
                    title={t('wizard.notInForce.title', {
                      code: advanced ? group.code : group.code,
                      year: group.year,
                    })}
                  >
                    <p>
                      {plural('wizard.notInForce.body', group.count, {
                        count: String(group.count),
                        year: group.year,
                        code: group.code,
                        validFrom: validFrom ?? '',
                      })}
                    </p>
                    {validFrom === undefined || validFrom === '' ? null : (
                      <p className="text-xs tabular-nums">{advanced ? group.code : null}</p>
                    )}
                    <p className="mt-2 text-sm text-foreground">{t('wizard.notInForce.why')}</p>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-11 md:min-h-9"
                        onClick={() => void runPreview()}
                      >
                        {t('moneybird.fix.reread')}
                      </Button>
                      {taxHref !== null && (
                        <Button asChild variant="outline" className="min-h-11 md:min-h-9">
                          <a href={taxHref} target="_blank" rel="noreferrer">
                            {t('moneybird.fix.openMoneybird')}
                          </a>
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-11 md:min-h-9"
                        onClick={() => void goTo('administratie')}
                      >
                        {t('wizard.problemen.toAdministratie')}
                      </Button>
                    </div>
                  </AttentionBlock>
                </div>
              )
            })}
            {otherBlockingCards.length > 0 && (
              <section className="mb-6">
                <h2 className="mb-2 text-base">{t('wizard.problemen.blockingSection')}</h2>
                <ul role="list" className="space-y-3">
                  {otherBlockingCards.map((card) => (
                    <li key={`${card.code}:${card.path ?? ''}`}>
                      <FindingCard {...card} showPath={advanced} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {infoCards.length > 0 && (
              <section className="mb-6">
                <h2 className="mb-2 text-base">{t('wizard.problemen.infoSection')}</h2>
                <ul role="list" className="space-y-3">
                  {infoCards.map((card) => (
                    <li key={`${card.code}:${card.path ?? ''}`}>
                      <FindingCard {...card} showPath={advanced} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {reconciliationRows.length > 0 && (
              <section className="mb-6">
                <h2 className="mb-2 text-base">{t('wizard.problemen.reconciliation')}</h2>
                <ul className="text-muted-foreground space-y-1 text-sm tabular-nums">
                  {reconciliationRows.map((row) => {
                    const sourceKey =
                      row.source === 'read'
                        ? 'wizard.problemen.reconciliationRead'
                        : row.source === 'empty'
                          ? 'wizard.overzicht.notTransferredEmpty'
                          : row.source === 'unreadable'
                            ? 'wizard.problemen.reconciliationFailed'
                            : null
                    const sourceLabel =
                      sourceKey !== null ? t(sourceKey as MessageKey) : String(row.source)
                    const money = (value: string | null) => {
                      if (value === null || value === '') return null
                      const amount = Number.parseFloat(value)
                      if (!Number.isFinite(amount)) return value
                      return new Intl.NumberFormat(tag, {
                        style: 'currency',
                        currency: 'EUR',
                      }).format(amount)
                    }
                    const debit = money(row.totalDebit)
                    const credit = money(row.totalCredit)
                    return (
                      <li key={row.year}>
                        {row.year}: {sourceLabel}
                        {advanced && debit !== null ? ` · D ${debit}` : ''}
                        {advanced && credit !== null ? ` · C ${credit}` : ''}
                        {!advanced && debit !== null ? ` · ${debit}` : ''}
                      </li>
                    )
                  })}
                </ul>
              </section>
            )}
            {blockingProblems.length === 0 && groupNotInForce(problems).length === 0 && (
              <p className="text-muted-foreground mt-4 text-sm">{t('wizard.problemen.allClear')}</p>
            )}
            <WizardFooter
              showBack
              onBack={() => void handleBack()}
              nextLabel={t('wizard.next')}
              nextDisabled={!canNext || busy}
              nextReason={nextReason}
              onNextBlocked={() => {
                if (nextReason !== null && nextReason !== '') showToast(nextReason)
              }}
              onNext={() => void handleNext()}
            />
          </>
        )}

        {step === 'overzicht' && (
          <>
            <WizardStepHeader
              titleId={titleId}
              step={step}
              title={t('wizard.overzicht.title')}
              intro={t('wizard.overzicht.intro')}
            />
            <dl className="border-border space-y-2 border-y py-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t('wizard.overzicht.transfer')}</dt>
                <dd className="tabular-nums">{String(transferCount)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t('wizard.overzicht.skip')}</dt>
                <dd className="tabular-nums">{String(excluded.length)}</dd>
              </div>
            </dl>
            <section className="mt-6">
              <h2 className="mb-2 text-base">{t('wizard.overzicht.notTransferred')}</h2>
              {excludedRateIds.size === 0 &&
              (decisions.excludedExternalIds ?? []).length === 0 &&
              excluded.length === 0 ? (
                <p className="text-sm">{t('wizard.overzicht.notTransferredEmpty')}</p>
              ) : (
                <div className="space-y-4">
                  {excludedRateIds.size > 0 && (
                    <div>
                      <h3 className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
                        {t('wizard.overzicht.notTransferredRates')}
                      </h3>
                      <ul role="list" className="divide-y border">
                        {[...excludedRateIds].map((rateId) => {
                          const rate = taxRates.find((row) => row.moneybirdId === rateId)
                          const n = excludedByRate[rateId]?.length ?? 0
                          return (
                            <li
                              key={rateId}
                              className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
                            >
                              <span>
                                <span className="font-medium">{rate?.name ?? rateId}</span>
                                <span className="text-muted-foreground mt-0.5 block text-xs">
                                  {t('wizard.overzicht.reasonExcluded')}
                                  {n > 0 ? ` · ${String(n)}` : ''}
                                </span>
                              </span>
                              <Button
                                type="button"
                                variant="outline"
                                className="min-h-11 md:min-h-9"
                                onClick={() => void undoExcludeRate(rateId)}
                              >
                                {t('wizard.btw.excludeUndo')}
                              </Button>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  )}
                  {(() => {
                    const rateDocIds = new Set(Object.values(excludedByRate).flat())
                    const docIds = [
                      ...new Set([...(decisions.excludedExternalIds ?? []), ...excluded]),
                    ].filter((id) => !rateDocIds.has(id))
                    if (docIds.length === 0) return null
                    return (
                      <div>
                        <h3 className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
                          {t('wizard.overzicht.notTransferredDocs')}
                        </h3>
                        <ul role="list" className="divide-y border">
                          {docIds.map((id) => {
                            const doc = yearDocuments.find((row) => row.externalId === id)
                            return (
                              <li key={id} className="px-4 py-3 text-sm">
                                <span className="font-medium">{doc?.reference ?? id}</span>
                                <span className="text-muted-foreground mt-0.5 block text-xs">
                                  {t('wizard.overzicht.reasonExcluded')}
                                </span>
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                    )
                  })()}
                </div>
              )}
            </section>
            <section className="mt-6">
              <h2 className="mb-2 text-base">{t('wizard.overzicht.alreadyInKlopt')}</h2>
              {alreadyInKlopt.count === 0 ? (
                <p className="text-sm">{t('wizard.overzicht.alreadyInKloptEmpty')}</p>
              ) : (
                <p className="text-sm">
                  {plural('wizard.overzicht.alreadyInKloptCount', alreadyInKlopt.count, {
                    count: String(alreadyInKlopt.count),
                  })}
                </p>
              )}
              <p className="text-muted-foreground mt-2 text-sm">
                {t('wizard.overzicht.dedupLegal')}
              </p>
            </section>
            <WizardFooter
              showBack
              onBack={() => void handleBack()}
              nextLabel={t('wizard.overzicht.confirm')}
              onNext={() => void handleNext()}
            />
          </>
        )}

        {step === 'importeren' && (
          <>
            <WizardStepHeader
              titleId={titleId}
              step={step}
              title={
                importFailed || failureKind !== 'none'
                  ? failureKind === 'failedPartial'
                    ? t('wizard.importeren.failedPartial')
                    : t('wizard.importeren.failed')
                  : imported
                    ? t('wizard.status.done')
                    : t('wizard.importeren.title')
              }
              {...(importFailed || failureKind !== 'none'
                ? {}
                : { intro: t('wizard.importeren.intro') })}
            />
            {importFailed || failureKind !== 'none' ? (
              <AttentionBlock
                tone="error"
                title={
                  failureKind === 'failedPartial'
                    ? t('wizard.importeren.failedPartial')
                    : t('wizard.importeren.failed')
                }
              >
                {failureKind === 'failedPartial' ? (
                  <p>{t('wizard.importeren.failedPartialBody')}</p>
                ) : (
                  <p>{error ?? liveRun?.lastError ?? t('common.unknownError')}</p>
                )}
                <Button
                  type="button"
                  className="mt-3 min-h-11 md:min-h-9"
                  onClick={() => void goTo('problemen')}
                >
                  {t('wizard.problemen.title')}
                </Button>
              </AttentionBlock>
            ) : (
              <>
                <div className="border p-5">
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-medium">
                      {imported
                        ? t('wizard.status.done')
                        : liveRun?.state === 'running'
                          ? t('wizard.importeren.running')
                          : liveRun?.state === 'pending'
                            ? t('wizard.importeren.pending')
                            : importing
                              ? t('wizard.status.importing')
                              : t('wizard.importeren.busy')}
                    </span>
                    <span className="tabular-nums">{importProgress}%</span>
                  </div>
                  <div className="bg-border mt-2 h-2">
                    <div
                      className="bg-foreground h-2 transition-[width] motion-reduce:transition-none"
                      style={{ width: `${String(importProgress)}%` }}
                    />
                  </div>
                  <p className="sr-only" aria-live="polite">
                    {t('wizard.importeren.pctLive', { pct: String(importProgress) })}
                  </p>
                </div>
                <p className="text-muted-foreground mt-4 text-sm">
                  {t('wizard.overzicht.dedupLegal')}
                </p>
              </>
            )}
            <WizardFooter
              showBack={false}
              nextLabel={t('wizard.next')}
              nextDisabled={!canNext}
              nextReason={nextReason}
              onNextBlocked={() => {
                if (nextReason !== null && nextReason !== '') showToast(nextReason)
              }}
              onNext={() => void handleNext()}
            />
          </>
        )}

        {step === 'klaar' && imported && isImportRunDone(liveRun) && (
          <>
            <WizardStepHeader
              titleId={titleId}
              step={step}
              title={t('wizard.klaar.title')}
              intro={
                klaarCount === 0
                  ? t('wizard.klaar.summaryNone')
                  : plural('wizard.klaar.summary', klaarCount, {
                      count: String(klaarCount),
                    })
              }
            />
            <p className="text-muted-foreground mb-4 text-sm">{t('wizard.klaar.booksInKlopt')}</p>
            {filingBlock.blocked && (
              <AttentionBlock
                tone="error"
                badge={<Badge variant="destructive">{t('wizard.klaar.blockedBadge')}</Badge>}
                title={t('wizard.klaar.blocked')}
              >
                <p>{t('wizard.klaar.whyBlocked')}</p>
                {filingBlock.showDeadline && (
                  <p className="mt-2">{t('wizard.klaar.whyBlockedDeadline')}</p>
                )}
              </AttentionBlock>
            )}
            {(() => {
              const excludedDocs = [
                ...new Set([...(decisions.excludedExternalIds ?? []), ...excluded]),
              ]
              const rateCount = excludedRateIds.size
              if (excludedDocs.length === 0 && rateCount === 0) return null
              return (
                <ul role="list" className="mt-6 divide-y border">
                  <li>
                    <button
                      type="button"
                      className="hover:bg-muted flex min-h-11 w-full items-center justify-between px-4 py-3 text-left text-sm"
                      onClick={() => void goTo('overzicht')}
                    >
                      <span>
                        <span className="block font-medium">
                          {t('wizard.klaar.viewNotTransferred')}
                        </span>
                        <span className="text-muted-foreground block text-xs">
                          {plural(
                            'wizard.klaar.viewNotTransferredDetail',
                            excludedDocs.length || 1,
                            {
                              docs: String(excludedDocs.length),
                              rates: String(rateCount),
                            },
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                </ul>
              )
            })()}
            <div className="mt-6 flex flex-wrap gap-2">
              <Button asChild className="min-h-11 md:min-h-9">
                <Link to="/vat">{t('wizard.klaar.nextVat')}</Link>
              </Button>
              <Button asChild variant="outline" className="min-h-11 md:min-h-9">
                <Link to="/entries">{t('wizard.klaar.nextEntries')}</Link>
              </Button>
            </div>
          </>
        )}

        {sheetRate !== null && (
          <AccountVatSheet
            open
            onOpenChange={(open) => {
              if (!open) setSheetRateId(null)
            }}
            mode="tax"
            sourceName={sheetRate.name}
            accounts={kloptAccounts}
            taxRules={kloptTaxRules}
            serverCandidates={sheetRate.candidates ?? []}
            suggestedVat={sheetRate.proposedCode}
            taxRateType={sheetRate.taxRateType ?? null}
            percentage={sheetRate.percentage}
            advanced={advanced}
            {...(taxHref !== null ? { moneybirdHref: taxHref } : {})}
            onReread={() => void runPreview()}
            onExcludeRate={() => void excludeRate(sheetRate.moneybirdId)}
            excludeCount={docsForRate(sheetRate.moneybirdId).length}
            saveError={
              taxViolations[sheetRate.moneybirdId] !== undefined
                ? refusedRateMessage(
                    sheetRate,
                    taxViolations[sheetRate.moneybirdId]!,
                    t,
                    kloptTaxRules,
                  )
                : null
            }
            saveErrorFootnote={
              taxViolations[sheetRate.moneybirdId] !== undefined
                ? t('wizard.btw.refusedRateFootnote')
                : null
            }
            {...(advanced
              ? {
                  onJumpToMapping: () => {
                    setSheetRateId(null)
                    void goTo('rekeningen')
                  },
                }
              : {})}
            onSave={async (choice) => {
              if (choice.vatCode === null) return false
              const ok = await confirmTaxMappingPatch({
                [sheetRate.moneybirdId]: choice.vatCode,
              })
              if (!ok) return false
              setSheetRateId(null)
              return true
            }}
          />
        )}

        <AlertDialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('wizard.verbinden.disconnectConfirm')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('wizard.verbinden.disconnectLegal')}
                <span className="mt-2 block">{t('wizard.verbinden.mappingsKept')}</span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  setDisconnectOpen(false)
                  void disconnectMoneybird().then(() => {
                    showToast(t('wizard.verbinden.disconnectToast'))
                    void router.invalidate()
                  })
                }}
              >
                {t('moneybird.disconnect')}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={restartOpen} onOpenChange={setRestartOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('wizard.resume.restartConfirm')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('wizard.resume.restartConfirmBody')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <Button
                type="button"
                onClick={() => {
                  setRestartOpen(false)
                  void resetImportWizardState({
                    data: { confirm: true, idempotencyKey: crypto.randomUUID() },
                  }).then(() => {
                    setShowResume(false)
                    setStep('bron')
                    setSource(null)
                    setSelectedYears([])
                    setPreview(null)
                  })
                }}
              >
                {t('wizard.resume.restart')}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={importConfirmOpen} onOpenChange={setImportConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {transferCount === 0
                  ? t('wizard.klaar.summaryNone')
                  : plural('wizard.overzicht.confirmTitleCount', transferCount, {
                      count: String(transferCount),
                    })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t('wizard.overzicht.undoLegal')}
                <span className="mt-2 block tabular-nums">
                  {t('wizard.overzicht.transfer')}: {String(transferCount)} ·{' '}
                  {t('wizard.overzicht.notTransferred')}: {String(excluded.length)}
                </span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <Button type="button" onClick={() => void startImport()}>
                {t('wizard.overzicht.confirm')}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <WizardStatusToast message={toast} />
      </div>
    </div>
  )
}

interface WizardStateRow {
  readonly source: string | null
  readonly step: string
  readonly administrationId: string | null
  readonly selectedYears: readonly string[]
}

function problemCountForRate(problems: readonly MoneybirdProblem[], rateId: string): number {
  const problem = problems.find((row) => row.path === `taxRates.${rateId}`)
  if (problem === undefined) return 0
  const count = problem.detail['count']
  return count !== undefined && count !== '' ? Number(count) || 0 : 0
}

function groupNotInForce(
  problems: readonly MoneybirdProblem[],
): readonly { code: string; year: string; count: number }[] {
  const map = new Map<string, { code: string; year: string; count: number }>()
  for (const problem of problems) {
    if (problem.code !== 'tax_code_not_in_force') continue
    const code = problem.detail['taxCode'] ?? '?'
    const year = (problem.detail['bookingDate'] ?? '').slice(0, 4) || '?'
    const key = `${code}:${year}`
    const row = map.get(key) ?? { code, year, count: 0 }
    row.count += 1
    map.set(key, row)
  }
  return [...map.values()]
}
