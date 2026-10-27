/**
 * Pure helpers for the Moneybird/Exact import wizard (#100 Phase 1).
 *
 * Step ids match the design prototype and `importWizardStepSchema`. Exact is a
 * dead-end on Bron in Phase 1; Moneybird walks all ten steps.
 */

import { flowShouldAdvanceOnEnter } from './guided-invoice.js'

export const IMPORT_WIZARD_STEPS = [
  'bron',
  'verbinden',
  'administratie',
  'voorbeeld',
  'btw',
  'rekeningen',
  'problemen',
  'overzicht',
  'importeren',
  'klaar',
] as const

export type ImportWizardStep = (typeof IMPORT_WIZARD_STEPS)[number]

export type ImportWizardSource = 'moneybird' | 'exact'

export const IMPORT_WIZARD_STEP_COUNT = IMPORT_WIZARD_STEPS.length

/** Short rail labels — i18n keys under `wizard.step.*`. */
export const IMPORT_WIZARD_STEP_KEYS = [
  'wizard.step.bron',
  'wizard.step.verbinden',
  'wizard.step.administratie',
  'wizard.step.voorbeeld',
  'wizard.step.btw',
  'wizard.step.rekeningen',
  'wizard.step.problemen',
  'wizard.step.overzicht',
  'wizard.step.importeren',
  'wizard.step.klaar',
] as const

export function isImportWizardStep(value: string): value is ImportWizardStep {
  return (IMPORT_WIZARD_STEPS as readonly string[]).includes(value)
}

export function stepIndex(step: ImportWizardStep): number {
  return IMPORT_WIZARD_STEPS.indexOf(step)
}

export function stepAt(index: number): ImportWizardStep | null {
  if (index < 0 || index >= IMPORT_WIZARD_STEP_COUNT) return null
  return IMPORT_WIZARD_STEPS[index]!
}

export function nextStep(step: ImportWizardStep): ImportWizardStep | null {
  return stepAt(stepIndex(step) + 1)
}

export function prevStep(step: ImportWizardStep): ImportWizardStep | null {
  return stepAt(stepIndex(step) - 1)
}

/** Steps that never go Terug via Esc (progress / done). */
export function isTerminalStep(step: ImportWizardStep): boolean {
  return step === 'importeren' || step === 'klaar'
}

export function canAdvanceFromBron(source: ImportWizardSource | null): boolean {
  return source === 'moneybird'
}

export function canAdvanceFromVerbinden(connected: boolean): boolean {
  return connected
}

/** Step 2 before connect: token present and secrets can be stored. */
export function canConnectMoneybird(args: {
  readonly canStoreSecrets: boolean
  readonly apiToken: string
}): boolean {
  return args.canStoreSecrets && args.apiToken.trim() !== ''
}

export function canAdvanceFromAdministratie(args: {
  readonly administrationId: string | null
  readonly selectedYears: readonly string[]
}): boolean {
  return (
    args.administrationId !== null && args.administrationId !== '' && args.selectedYears.length > 0
  )
}

export function canAdvanceFromVoorbeeld(hasPreview: boolean): boolean {
  return hasPreview
}

export function canAdvanceFromBtw(args: {
  readonly usedRates: readonly { readonly moneybirdId: string; readonly mapped: boolean }[]
  readonly excludedRateIds: ReadonlySet<string>
}): boolean {
  return args.usedRates.every((rate) => rate.mapped || args.excludedRateIds.has(rate.moneybirdId))
}

export function canAdvanceFromProblemen(blockingCount: number): boolean {
  return blockingCount === 0
}

/** Years present in the Moneybird preview that the user left unchecked. */
export function excludedYearsFromSelection(
  allYears: readonly string[],
  selectedYears: readonly string[],
): string[] {
  const selected = new Set(selectedYears)
  return allYears.filter((year) => !selected.has(year))
}

export { flowShouldAdvanceOnEnter }
