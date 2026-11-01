/**
 * Exact Online wizard slice (#100): verbinden → administratie → voorbeeld →
 * read-only btw. Later steps (rekeningen / openings / invoices) stay blocked.
 */

import { useEffect, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import type { ExactVatMappingSummary } from '@klopt/core'
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
import { ExactVatPreview } from '~/components/import-wizard/exact-vat-preview'
import {
  AttentionBlock,
  WizardFooter,
  WizardStatusToast,
  WizardStepHeader,
} from '~/components/import-wizard/wizard-shell'
import { useHydrated } from '~/lib/hydration'
import {
  canAdvanceFromExactAdministratie,
  canAdvanceFromVerbinden,
  canAdvanceFromVoorbeeld,
  canConnectExact,
  exactWizardStopsAfterBtw,
  isTerminalStep,
  prevStep,
  type ImportWizardStep,
} from '~/lib/import-wizard'
import { exactPreviewCounts, vatMappingFromPreview } from '~/lib/exact-wizard-vat'
import { cn } from '~/lib/utils'
import { useT } from '~/i18n/provider'
import {
  chooseExactDivision,
  connectExact,
  disconnectExact,
  listExactDivisions,
  previewExactImport,
} from '~/server/ledger'
import { saveImportWizardState } from '~/server/import-wizard'

interface ExactConnectionView {
  readonly connected: boolean
  readonly ready: boolean
  readonly baseUrl: string | null
  readonly userName: string | null
  readonly divisionCode: number | null
  readonly divisionName: string | null
  readonly divisionCautions: readonly string[]
  readonly lastError: string | null
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

export function ExactWizardFlow({
  step,
  setStep,
  connection,
  canStoreSecrets,
  defaultYear,
  titleId,
}: {
  readonly step: ImportWizardStep
  readonly setStep: (step: ImportWizardStep) => void
  readonly connection: ExactConnectionView | null
  readonly canStoreSecrets: boolean
  readonly defaultYear: string
  readonly titleId: string
}) {
  const { t } = useT()
  const router = useRouter()
  const hydrated = useHydrated()
  const connected = connection?.connected === true
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [disconnectOpen, setDisconnectOpen] = useState(false)

  const [baseUrl, setBaseUrl] = useState(connection?.baseUrl ?? 'https://start.exactonline.nl')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [editedRedirect, setEditedRedirect] = useState<string | null>(null)
  const redirectUri = editedRedirect ?? (hydrated ? `${window.location.origin}/exact/callback` : '')
  const redirectIsSecure =
    redirectUri.startsWith('https://') ||
    redirectUri.startsWith('http://localhost') ||
    redirectUri.startsWith('http://127.0.0.1')

  const [divisions, setDivisions] = useState<readonly DivisionOption[] | null>(null)
  const [pickedDivision, setPickedDivision] = useState<number | null>(null)
  const divisionCode = pickedDivision ?? connection?.divisionCode ?? null
  const [year, setYear] = useState(defaultYear)
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null)

  useEffect(() => {
    if (toast === null) return
    const timer = window.setTimeout(() => setToast(null), 4000)
    return () => window.clearTimeout(timer)
  }, [toast])

  async function persistStep(next: ImportWizardStep) {
    setStep(next)
    await saveImportWizardState({
      data: {
        source: 'exact',
        step: next,
        administrationId: divisionCode !== null ? String(divisionCode) : null,
        selectedYears: year !== '' ? [year] : [],
        idempotencyKey: crypto.randomUUID(),
      },
    })
  }

  async function goTo(next: ImportWizardStep) {
    await persistStep(next)
    const heading = document.getElementById(titleId)
    heading?.focus()
  }

  async function runPreview() {
    setBusy(true)
    setError(null)
    const result = await previewExactImport({ data: { year: Number(year) } })
    setBusy(false)
    if (!result.ok) {
      setError(result.problem?.detail ?? t('common.unknownError'))
      setPreview(null)
      return
    }
    setPreview(result.data)
  }

  const vatMapping: ExactVatMappingSummary | null = vatMappingFromPreview(preview)
  const counts = exactPreviewCounts(preview)

  const canNext = (() => {
    switch (step) {
      case 'verbinden':
        return (
          canAdvanceFromVerbinden(connected) ||
          canConnectExact({ canStoreSecrets, clientId, clientSecret, redirectIsSecure })
        )
      case 'administratie':
        return canAdvanceFromExactAdministratie({ divisionCode, year })
      case 'voorbeeld':
        return canAdvanceFromVoorbeeld(preview !== null)
      case 'btw':
        // Read-only: always advanceable, but Exact stops after btw.
        return vatMapping !== null
      default:
        return false
    }
  })()

  const nextReason = (() => {
    if (canNext) {
      if (step === 'btw' && exactWizardStopsAfterBtw('exact')) return t('wizard.status.exactLater')
      return null
    }
    if (step === 'verbinden') return t('wizard.status.exactNeedConnect')
    if (step === 'administratie') return t('wizard.status.exactNeedDivision')
    if (step === 'voorbeeld') return t('wizard.status.needPreview')
    if (step === 'btw') return t('wizard.status.needPreview')
    return t('wizard.status.exactLater')
  })()

  async function handleNext() {
    if (busy) return
    if (step === 'btw') {
      // Phase 2 slice ends here — accounts / openings land in later PRs.
      if (nextReason !== null) setToast(nextReason)
      return
    }
    if (!canNext) {
      if (nextReason !== null) setToast(nextReason)
      return
    }

    if (step === 'verbinden') {
      if (!connected) {
        setBusy(true)
        setError(null)
        const result = await connectExact({
          data: {
            baseUrl,
            clientId,
            clientSecret,
            redirectUri,
            idempotencyKey: crypto.randomUUID(),
          },
        })
        setBusy(false)
        if (!result.ok) {
          setError(result.problem?.detail ?? t('common.unknownError'))
          return
        }
        const url = (result.data as { authorizeUrl?: string }).authorizeUrl
        if (url !== undefined) {
          window.location.assign(url)
          return
        }
      }
      await goTo('administratie')
      return
    }

    if (step === 'administratie') {
      if (preview === null) await runPreview()
      await goTo('voorbeeld')
      return
    }

    if (step === 'voorbeeld') {
      if (preview === null) await runPreview()
      await goTo('btw')
    }
  }

  async function handleBack() {
    if (isTerminalStep(step)) return
    const prev = prevStep(step)
    if (prev === null || prev === 'bron') {
      await goTo('bron')
      return
    }
    await goTo(prev)
  }

  async function loadDivisions() {
    setBusy(true)
    setError(null)
    const result = await listExactDivisions()
    setBusy(false)
    if (!result.ok) {
      setError(result.problem?.detail ?? t('common.unknownError'))
      return
    }
    setDivisions((result.data as { divisions: readonly DivisionOption[] }).divisions)
  }

  async function chooseDivision(code: number) {
    setBusy(true)
    setError(null)
    const result = await chooseExactDivision({
      data: { divisionCode: code, idempotencyKey: crypto.randomUUID() },
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.problem?.detail ?? t('common.unknownError'))
      return
    }
    setPickedDivision(code)
    setPreview(null)
    await router.invalidate()
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (disconnectOpen) return
      if (event.key === 'Escape' && !isTerminalStep(step)) {
        const target = event.target
        if (
          target instanceof HTMLElement &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' ||
            target.isContentEditable)
        ) {
          return
        }
        event.preventDefault()
        void handleBack()
        return
      }
      if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
        const target = event.target
        if (
          target instanceof HTMLElement &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' ||
            target.isContentEditable ||
            target.tagName === 'BUTTON' ||
            target.getAttribute('role') === 'radio')
        ) {
          return
        }
        event.preventDefault()
        void handleNext()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <>
      {error !== null && error !== '' && (
        <p role="alert" className="text-destructive mb-4 text-sm">
          {error}
        </p>
      )}

      {step === 'verbinden' && (
        <>
          <WizardStepHeader
            titleId={titleId}
            step={step}
            title={t('wizard.verbinden.exact.title')}
            intro={t('wizard.verbinden.exact.intro')}
            source="exact"
          />
          {!canStoreSecrets && (
            <div className="mb-6">
              <AttentionBlock title={t('wizard.verbinden.noKeyTitle')}>
                <p>{t('exact.noEncryptionKey')}</p>
              </AttentionBlock>
            </div>
          )}
          {hydrated && !redirectIsSecure && (
            <p role="alert" className="text-destructive mb-4 text-sm">
              {t('wizard.verbinden.exact.needsHttps')}
            </p>
          )}
          {connected ? (
            <div className="border-border border p-4">
              <p className="font-medium">{t('wizard.verbinden.exact.connected')}</p>
              <p className="text-muted-foreground mt-1 text-sm">
                {connection?.userName ?? t('exact.unknownUser')} —{' '}
                {t('wizard.verbinden.exact.connectedHint')}
              </p>
              <Button
                type="button"
                variant="ghost"
                className="text-muted-foreground mt-3 min-h-11 md:min-h-9"
                onClick={() => setDisconnectOpen(true)}
              >
                {t('exact.disconnect')}
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
                {t('exact.clientId')}
                <input
                  value={clientId}
                  onChange={(event) => setClientId(event.target.value)}
                  disabled={!hydrated || !canStoreSecrets}
                  className="field-control mt-1.5 tabular-nums"
                  autoComplete="off"
                />
              </label>
              <label className="block text-sm font-medium">
                {t('exact.clientSecret')}
                <input
                  type="password"
                  value={clientSecret}
                  onChange={(event) => setClientSecret(event.target.value)}
                  disabled={!hydrated || !canStoreSecrets}
                  className="field-control mt-1.5 tabular-nums"
                  autoComplete="off"
                />
              </label>
              <label className="block text-sm font-medium">
                {t('exact.redirectUri')}
                <div className="mt-1.5 flex gap-2">
                  <input
                    value={redirectUri}
                    onChange={(event) => setEditedRedirect(event.target.value)}
                    disabled={!hydrated}
                    className="field-control min-w-0 flex-1 tabular-nums"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 shrink-0 md:min-h-9"
                    disabled={!hydrated || redirectUri === ''}
                    onClick={() => {
                      void navigator.clipboard.writeText(redirectUri)
                      setToast(t('wizard.verbinden.exact.copyRedirect'))
                    }}
                  >
                    {t('wizard.verbinden.exact.copyRedirect')}
                  </Button>
                </div>
                <span className="text-muted-foreground mt-1 block text-xs">
                  {t('wizard.verbinden.exact.redirectHelp')}
                </span>
              </label>
              <details className="border-border border px-4 py-3 text-sm">
                <summary className="-mx-4 -my-3 flex min-h-11 cursor-pointer items-center px-4 font-medium">
                  {t('shell.advanced')}
                </summary>
                <label className="mt-3 block text-sm font-medium">
                  {t('exact.environment')}
                  <input
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.target.value)}
                    disabled={!hydrated}
                    className="field-control mt-1.5 text-xs tabular-nums"
                  />
                </label>
              </details>
            </form>
          )}
          <WizardFooter
            showBack
            onBack={() => void handleBack()}
            nextLabel={connected ? t('wizard.next') : t('wizard.verbinden.exact.signIn')}
            nextDisabled={
              connected
                ? false
                : !canConnectExact({ canStoreSecrets, clientId, clientSecret, redirectIsSecure }) ||
                  busy
            }
            nextReason={nextReason}
            onNext={() => void handleNext()}
          />
        </>
      )}

      {step === 'administratie' && (
        <>
          <WizardStepHeader
            titleId={titleId}
            step={step}
            title={t('wizard.administratie.exact.title')}
            intro={t('wizard.administratie.exact.intro')}
            source="exact"
          />
          {connection?.divisionCode !== null && connection?.divisionName != null && (
            <p className="mb-4 text-sm">
              {t('wizard.administratie.exact.chosen')}: <strong>{connection.divisionName}</strong> (
              {connection.divisionCode})
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            className="mb-4 min-h-11 md:min-h-9"
            disabled={busy}
            onClick={() => void loadDivisions()}
          >
            {divisions === null
              ? t('wizard.administratie.exact.fetch')
              : t('wizard.administratie.exact.fetchAgain')}
          </Button>
          {divisions !== null && (
            <section className="mb-6" aria-label={t('wizard.administratie.exact.admins')}>
              <ul className="border-border divide-border divide-y border">
                {divisions.map((division) => {
                  const selected = divisionCode === division.code
                  return (
                    <li key={division.code}>
                      <button
                        type="button"
                        className={cn(
                          'flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm',
                          selected && 'bg-muted',
                        )}
                        onClick={() => void chooseDivision(division.code)}
                        disabled={busy}
                      >
                        <span>
                          <span className="block font-medium">{division.description}</span>
                          <span className="text-muted-foreground mt-0.5 block text-xs tabular-nums">
                            {division.code}
                            {division.vatNumber != null ? ` · ${division.vatNumber}` : ''}
                          </span>
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {selected
                            ? t('wizard.administratie.exact.chosen')
                            : t('wizard.administratie.exact.choose')}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
          <label className="mb-6 block max-w-xs text-sm font-medium">
            {t('wizard.administratie.exact.year')}
            <input
              value={year}
              onChange={(event) => {
                setYear(event.target.value)
                setPreview(null)
              }}
              inputMode="numeric"
              className="field-control mt-1.5 w-28 tabular-nums"
            />
          </label>
          <WizardFooter
            showBack
            onBack={() => void handleBack()}
            nextLabel={t('wizard.next')}
            nextDisabled={!canNext || busy}
            nextReason={nextReason}
            onNextBlocked={() => {
              if (nextReason !== null) setToast(nextReason)
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
            intro={t('wizard.voorbeeld.exact.intro')}
            source="exact"
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
                  ['accounts', 'wizard.voorbeeld.exact.accounts'],
                  ['contacts', 'wizard.voorbeeld.exact.contacts'],
                  ['openItems', 'wizard.voorbeeld.exact.openItems'],
                  ['taxCodes', 'wizard.voorbeeld.exact.taxCodes'],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{t(label)}</dt>
                  <dd className="tabular-nums">{String(counts[key])}</dd>
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
              if (nextReason !== null) setToast(nextReason)
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
            title={t('wizard.exact.btw.title')}
            intro={t('wizard.exact.btw.intro')}
            source="exact"
          />
          {vatMapping !== null ? (
            <ExactVatPreview summary={vatMapping} notImportedYet />
          ) : (
            <p className="text-muted-foreground mb-4 text-sm">{t('wizard.status.needPreview')}</p>
          )}
          <div className="mt-6">
            <AttentionBlock tone="info" title={t('wizard.exact.later.title')}>
              <p>{t('wizard.exact.later.body')}</p>
            </AttentionBlock>
          </div>
          <WizardFooter
            showBack
            onBack={() => void handleBack()}
            nextLabel={t('wizard.next')}
            nextDisabled
            nextReason={t('wizard.status.exactLater')}
            onNextBlocked={() => setToast(t('wizard.status.exactLater'))}
            onNext={() => undefined}
          />
        </>
      )}

      {(step === 'rekeningen' ||
        step === 'problemen' ||
        step === 'overzicht' ||
        step === 'importeren' ||
        step === 'klaar') && (
        <>
          <WizardStepHeader
            titleId={titleId}
            step={step}
            title={t('wizard.exact.later.title')}
            intro={t('wizard.exact.later.body')}
            source="exact"
          />
          <WizardFooter
            showBack
            onBack={() => void goTo('btw')}
            nextLabel={t('wizard.next')}
            nextDisabled
            nextReason={t('wizard.status.exactLater')}
            onNext={() => undefined}
          />
        </>
      )}

      <WizardStatusToast message={toast} />

      <AlertDialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('wizard.verbinden.exact.disconnectConfirm')}</AlertDialogTitle>
            <AlertDialogDescription>{t('wizard.verbinden.disconnectLegal')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                void (async () => {
                  setDisconnectOpen(false)
                  setBusy(true)
                  await disconnectExact()
                  setBusy(false)
                  setPreview(null)
                  setDivisions(null)
                  await router.invalidate()
                  await goTo('verbinden')
                  setToast(t('wizard.verbinden.disconnectToast'))
                })()
              }}
            >
              {t('exact.disconnect')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
