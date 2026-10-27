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
import { ImportFindingsScreen } from '~/components/findings/import-findings-screen'
import { MoneybirdMappingReview } from '~/components/findings/moneybird-mapping-review'
import {
  AttentionBlock,
  WizardFooter,
  WizardProgressRail,
  WizardStatusToast,
  WizardStepHeader,
} from '~/components/import-wizard/wizard-shell'
import { Badge } from '~/components/ui/badge'
import { useAdvancedMode } from '~/lib/advanced-mode-context'
import { useHydrated } from '~/lib/hydration'
import {
  honestySourcesFromMoneybird,
  importVatRulesFromListTaxCodes,
  type ImportVatRule,
} from '~/lib/import-findings'
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
  const { t } = useT()
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
    () => (saved?.source as ImportWizardSource | null) ?? null,
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
  const [imported, setImported] = useState(false)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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
  const excluded = (preview?.['excluded'] as string[] | undefined) ?? []

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
    return map
  }, [problems])

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
    const nextTax: Record<string, string> = {}
    for (const rate of rates) {
      const code = rate.mappedCode ?? rate.proposedCode
      if (code !== null && code !== '') nextTax[rate.moneybirdId] = code
    }
    setTaxMappings(nextTax)
    const years = ((report['years'] as number[] | undefined) ?? []).map(String)
    if (selectedYears.length === 0 && years.length > 0) {
      setSelectedYears(years)
    }
    return report
  }

  async function persistMappings(next?: {
    accountMappings?: Record<string, string>
    taxMappings?: Record<string, string>
    importDecisions?: MoneybirdImportDecisions
  }) {
    const previousTax = taxMappings
    const attemptedTax = next?.taxMappings ?? taxMappings
    if (next?.taxMappings !== undefined) setTaxMappings(next.taxMappings)
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
    showToast(t('wizard.btw.excludeDocs', { count: String(ids.length || '—') }))
  }

  async function undoExcludeRate(rateId: string) {
    const ids = excludedByRate[rateId] ?? []
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
            mapped: Boolean(rate.mappedCode ?? taxMappings[rate.moneybirdId]),
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
        return imported || (runStatus.ok && (runStatus.data as { state?: string }).state === 'done')
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
    if (step === 'btw') return t('wizard.btw.chooseFirst')
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

  async function startImport() {
    setImportConfirmOpen(false)
    setImporting(true)
    setError(null)
    await goTo('importeren')
    const result = await runMoneybirdImport({ data: { idempotencyKey: crypto.randomUUID() } })
    setImporting(false)
    if (!result.ok) {
      setError(result.problem?.detail ?? t('common.unknownError'))
      return
    }
    setImported(true)
    await router.invalidate()
    // Auto-advance when the job finishes quickly; otherwise klaar waits for status.
    await goTo('klaar')
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

  return (
    <div className="mx-auto w-full max-w-4xl" data-slot="import-wizard" aria-labelledby={titleId}>
      <WizardProgressRail step={step} />
      {error !== null && (
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
            <ul role="list" className="grid gap-3 sm:grid-cols-2">
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
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      className={cn(
                        'border-border flex min-h-11 w-full flex-col items-start border p-4 text-left',
                        selected && 'bg-muted border-foreground',
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
                  </li>
                )
              })}
            </ul>
          )}
          {source === 'exact' && !showResume && (
            <div className="mt-6">
              <AttentionBlock title={t('wizard.bron.exact.deadEnd')}>
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
              nextDisabled={!canNext}
              nextReason={nextReason}
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
              <fieldset className="border-border divide-y border">
                <legend className="sr-only">{t('wizard.administratie.admins')}</legend>
                {administrations.map((admin) => (
                  <label
                    key={admin.id}
                    className={cn(
                      'flex min-h-11 cursor-pointer items-start gap-3 px-4 py-3',
                      administrationId === admin.id ? 'bg-muted' : 'hover:bg-muted',
                    )}
                  >
                    <input
                      type="radio"
                      name="admin"
                      className="mt-1 size-4"
                      checked={administrationId === admin.id}
                      onChange={() => {
                        setAdministrationId(admin.id)
                        setBusy(true)
                        void chooseMoneybirdAdministration({
                          data: { administrationId: admin.id, idempotencyKey: crypto.randomUUID() },
                        }).then(async (result) => {
                          setBusy(false)
                          if (!result.ok) {
                            setError(result.problem?.detail ?? t('common.unknownError'))
                            return
                          }
                          const mapped = await getImportAdministrationMappings({
                            data: { source: 'moneybird', administrationId: admin.id },
                          })
                          if (mapped.ok && mapped.data.mappings !== null) {
                            const row = mapped.data.mappings as {
                              accountMappings: Record<string, string>
                              taxMappings: Record<string, string>
                              importDecisions: MoneybirdImportDecisions
                            }
                            setAccountMappings(row.accountMappings)
                            setTaxMappings(row.taxMappings)
                            setDecisions(row.importDecisions)
                          }
                          await router.invalidate()
                          await runPreview()
                        })
                      }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{admin.label}</span>
                      <span className="text-muted-foreground block text-xs tabular-nums">
                        {admin.currency ?? '—'}
                        {advanced ? ` · ${admin.id}` : ''}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
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
                      <th className="py-2 pr-4 font-medium">{t('wizard.administratie.inKlopt')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(previewYears.length > 0 ? previewYears : selectedYears).map((year) => {
                      const docs = yearDocuments.filter((doc) => String(doc.year) === year).length
                      const nif = notInForceByYear.get(year)
                      const checked = selectedYears.includes(year)
                      return (
                        <tr key={year} className="border-border border-t align-top">
                          <td className="py-3 pr-3 pl-4">
                            <input
                              type="checkbox"
                              className="mt-0.5 size-4"
                              checked={checked}
                              aria-label={year}
                              onChange={(event) => {
                                setSelectedYears((current) =>
                                  event.target.checked
                                    ? [...new Set([...current, year])]
                                    : current.filter((item) => item !== year),
                                )
                              }}
                            />
                          </td>
                          <td className="py-3 pr-3 font-medium tabular-nums">{year}</td>
                          <td className="py-3 pr-3 text-right tabular-nums">{docs}</td>
                          <td className="py-3 pr-4">
                            <span className="block">{t('wizard.administratie.open')}</span>
                            {nif !== undefined && nif.count > 0 && (
                              <div className="mt-2">
                                <Badge variant="attention">{t('findingCard.blocking')}</Badge>
                                <p className="mt-1 text-xs font-medium">
                                  {t('wizard.year.notInForce', {
                                    year,
                                    count: String(nif.count),
                                  })}
                                </p>
                                <p className="text-muted-foreground mt-0.5 text-xs">
                                  {t('wizard.year.notInForceHelp')}
                                </p>
                              </div>
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
              const mapped = taxMappings[rate.moneybirdId] ?? rate.mappedCode
              const excluded = excludedRateIds.has(rate.moneybirdId)
              const empty = (rate.candidates ?? []).length === 0
              const suggested =
                !mapped &&
                rate.proposedCode !== null &&
                (rate.candidates ?? []).some(
                  (c) => c.code === rate.proposedCode && c.group === 'primary',
                )
              const docs = docsForRate(rate.moneybirdId)
              return (
                <li key={rate.moneybirdId}>
                  <article
                    className={cn(
                      'border-border border border-l-4 bg-card p-4 md:p-5',
                      excluded
                        ? 'border-l-[var(--border)]'
                        : empty || !mapped
                          ? 'border-l-warning'
                          : 'border-l-success',
                    )}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="text-[15px] font-medium">{rate.name}</h3>
                        <p className="text-muted-foreground text-xs tabular-nums">
                          {rate.percentage || '—'}%{advanced ? ` · ${rate.moneybirdId}` : ''}
                        </p>
                      </div>
                      {excluded ? (
                        <Badge variant="outline">{t('wizard.btw.excluded')}</Badge>
                      ) : mapped ? (
                        <Badge variant="success">{t('wizard.btw.chosen')}</Badge>
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
                          {t('wizard.btw.excludedBody', {
                            count: String(
                              docs.length || excludedByRate[rate.moneybirdId]?.length || 0,
                            ),
                          })}
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
                              {t('wizard.btw.excludeDocs', {
                                count: String(
                                  docs.length || problemCountForRate(problems, rate.moneybirdId),
                                ),
                              })}
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
                    ) : suggested && rate.proposedCode !== null ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="min-h-11 md:min-h-9"
                          onClick={() =>
                            void persistMappings({
                              taxMappings: {
                                ...taxMappings,
                                [rate.moneybirdId]: rate.proposedCode!,
                              },
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
                    ) : !mapped ? (
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
                      <p className="text-muted-foreground mt-3 text-sm tabular-nums">{mapped}</p>
                    )}
                    {taxViolations[rate.moneybirdId] !== undefined && (
                      <p role="alert" className="text-destructive mt-2 text-sm">
                        {t('wizard.btw.refusedRate')}
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
            <MoneybirdMappingReview
              accounts={accountSample}
              taxRates={taxRates}
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
              onSave={() => void persistMappings({})}
              busy={busy}
              hydrated={hydrated}
            />
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
          {groupNotInForce(problems).map((group) => (
            <div key={`${group.code}-${group.year}`} className="mb-4">
              <AttentionBlock
                tone="error"
                title={t('wizard.notInForce.title', { code: group.code, year: group.year })}
              >
                <p>
                  {t('wizard.notInForce.body', {
                    count: String(group.count),
                    year: group.year,
                    code: group.code,
                    validFrom: '01-01-2026',
                  })}
                </p>
                <p className="text-xs">{t('wizard.notInForce.boekhouder')}</p>
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
          ))}
          {preview !== null && (
            <ImportFindingsScreen
              connected
              hasPreview
              loading={busy}
              hydrated={hydrated}
              error={error}
              advanced={advanced}
              findings={[
                ...problems
                  .filter((problem) => problem.code !== 'tax_code_not_in_force')
                  .map((problem) => moneybirdFindingCard(problem, 'problems', findingActions)),
                ...warnings.map((warning) =>
                  moneybirdFindingCard(warning, 'warnings', findingActions),
                ),
              ]}
              sources={honestySourcesFromMoneybird({
                counts,
                reconciliation:
                  (preview['reconciliation'] as {
                    year: number
                    source: 'read' | 'empty' | 'unreadable'
                    totalDebit: string | null
                    totalCredit: string | null
                    balanced: boolean | null
                  }[]) ?? [],
                unreadResource: null,
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
                onReread: () => void runPreview(),
              })}
              onReread={() => void runPreview()}
            />
          )}
          {blockingProblems.length === 0 && (
            <p className="text-muted-foreground mt-4 text-sm">{t('wizard.problemen.allClear')}</p>
          )}
          <WizardFooter
            showBack
            onBack={() => void handleBack()}
            nextLabel={t('wizard.next')}
            nextDisabled={!canNext || busy}
            nextReason={nextReason}
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
              <dd className="tabular-nums">
                {String(
                  (counts['salesInvoices'] ?? 0) +
                    (counts['purchaseInvoices'] ?? 0) +
                    (counts['receipts'] ?? 0) +
                    (counts['bankMutations'] ?? 0) +
                    (counts['journalDocuments'] ?? 0),
                )}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t('wizard.overzicht.skip')}</dt>
              <dd className="tabular-nums">{String(excluded.length)}</dd>
            </div>
          </dl>
          <p className="text-muted-foreground mt-4 text-sm">{t('wizard.overzicht.dedupLegal')}</p>
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
            title={t('wizard.importeren.title')}
            intro={t('wizard.importeren.intro')}
          />
          <p className="text-muted-foreground mb-4 text-sm">{t('wizard.overzicht.dedupLegal')}</p>
          <p role="status" className="text-sm">
            {importing ? t('wizard.status.importing') : t('wizard.status.done')}
          </p>
          <WizardFooter
            showBack={false}
            nextLabel={t('wizard.next')}
            nextDisabled={!canNext}
            nextReason={nextReason}
            onNext={() => void handleNext()}
          />
        </>
      )}

      {step === 'klaar' && (
        <>
          <WizardStepHeader
            titleId={titleId}
            step={step}
            title={t('wizard.klaar.title')}
            intro={t('wizard.klaar.intro')}
          />
          {blockingProblems.length > 0 || groupNotInForce(problems).length > 0 ? (
            <AttentionBlock title={t('wizard.klaar.noGreen')}>
              <p>{t('wizard.klaar.blocked')}</p>
            </AttentionBlock>
          ) : null}
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
          {...(advanced
            ? {
                onJumpToMapping: () => {
                  setSheetRateId(null)
                  void goTo('rekeningen')
                },
              }
            : {})}
          onSave={(choice) => {
            if (choice.vatCode === null) return
            setSheetRateId(null)
            void persistMappings({
              taxMappings: { ...taxMappings, [sheetRate.moneybirdId]: choice.vatCode },
            })
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
            <AlertDialogDescription>{t('wizard.resume.restartConfirmBody')}</AlertDialogDescription>
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
            <AlertDialogTitle>{t('wizard.overzicht.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('wizard.overzicht.undoLegal')}</AlertDialogDescription>
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
