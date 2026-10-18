/**
 * Map Moneybird plan problems onto FindingCard models (issue #42 Phase 1).
 *
 * Fix types follow `fixSpecForProblem` in `@klopt/core`. Phase 1 wires plain
 * shadcn controls; Phase 2 reskins the guided steps from Design's Penpot boards.
 */

import type { MoneybirdProblem, MoneybirdProblemCode } from '@klopt/core'
import {
  fixSpecFor,
  fixSpecForProblem,
  honestyForFinding,
  unknownCurrencyVariantOf,
  fixForUnknownCurrency,
} from '@klopt/core/moneybird-fixes'
import type {
  FindingCardModel,
  FindingFix,
  FindingHonesty,
  FindingSeverity,
} from '~/lib/finding-card'

export interface MoneybirdFindingActions {
  readonly onMapAccount: (problem: MoneybirdProblem) => void
  readonly onMapTaxRate: (problem: MoneybirdProblem) => void
  readonly onRenumberAccount: (problem: MoneybirdProblem) => void
  readonly onRenumberContact: (problem: MoneybirdProblem) => void
  readonly onPickAccountType: (problem: MoneybirdProblem) => void
  readonly onConfirmCurrencyEur: (problem: MoneybirdProblem) => void
  readonly onOpenFxStep: (problem: MoneybirdProblem) => void
  readonly onConfirmFiscalYearStart: (problem: MoneybirdProblem) => void
  readonly onAcknowledgeEmptyYear: (problem: MoneybirdProblem) => void
  readonly onRereadResource: (problem: MoneybirdProblem) => void
  readonly onExcludeDocument: (problem: MoneybirdProblem) => void
  readonly onOpenPeriodSettings: (problem: MoneybirdProblem) => void
  readonly onDeferAttachment: (problem: MoneybirdProblem) => void
  readonly onOpenMoneybird: (problem: MoneybirdProblem) => void
  readonly onDrillUnbalanced: (problem: MoneybirdProblem) => void
  /** Opens the unbalanced-document panel (exclude + Open in Moneybird). */
  readonly onReviewUnbalanced: (problem: MoneybirdProblem) => void
  /** Absolute Moneybird web URL for a problem path, when one exists. */
  readonly moneybirdHrefFor: (problem: MoneybirdProblem) => string | null
  readonly labels: {
    readonly mapAccount: string
    readonly mapTax: string
    readonly renumberAccount: string
    readonly renumberContact: string
    readonly pickType: string
    readonly confirmEur: string
    readonly chooseRate: string
    readonly confirmYearStart: string
    readonly acknowledgeEmpty: string
    readonly reread: string
    readonly exclude: string
    readonly reopenYear: string
    readonly deferAttachment: string
    readonly openMoneybird: string
    readonly settings: string
    readonly drillDown: string
    readonly stepRate: string
    readonly stepPreview: string
    readonly stepConfirm: string
    readonly stepPermissions: string
    readonly stepOpenMoneybird: string
    readonly stepReread: string
    readonly stepDoNotTransfer: string
  }
}

function severityOf(problem: MoneybirdProblem, list: 'problems' | 'warnings'): FindingSeverity {
  if (list === 'problems') return 'blocking'
  return fixSpecForProblem(problem).severity
}

function honestyOf(code: MoneybirdProblemCode): FindingHonesty | undefined {
  const honesty = honestyForFinding(code)
  return honesty ?? undefined
}

function fixFor(problem: MoneybirdProblem, actions: MoneybirdFindingActions): FindingFix {
  const spec = fixSpecForProblem(problem)
  const { labels } = actions
  const moneybirdHref = actions.moneybirdHrefFor(problem)

  switch (problem.code) {
    case 'unmapped_account':
    case 'trial_balance_account_missing':
      return {
        type: 'guided',
        label: labels.mapAccount,
        onOpen: () => actions.onMapAccount(problem),
      }
    case 'unmapped_tax_rate':
      return {
        type: 'guided',
        label: labels.mapTax,
        onOpen: () => actions.onMapTaxRate(problem),
      }
    case 'account_number_collision':
      return {
        type: 'guided',
        label: labels.renumberAccount,
        onOpen: () => actions.onRenumberAccount(problem),
      }
    case 'contact_number_collision':
      return {
        type: 'oneClick',
        label: labels.renumberContact,
        onApply: () => actions.onRenumberContact(problem),
      }
    case 'derived_account_type':
      return {
        type: 'guided',
        label: labels.pickType,
        onOpen: () => actions.onPickAccountType(problem),
      }
    case 'unknown_currency':
      if (spec.fixType === 'oneClick') {
        return {
          type: 'oneClick',
          label: labels.confirmEur,
          onApply: () => actions.onConfirmCurrencyEur(problem),
        }
      }
      if (spec.fixType === 'explainOnly') {
        return {
          type: 'explainOnly',
          href: '/setup',
          linkLabel: labels.settings,
        }
      }
      return {
        type: 'guided',
        label: labels.chooseRate,
        onOpen: () => actions.onOpenFxStep(problem),
        steps: [labels.stepRate, labels.stepPreview, labels.stepConfirm],
      }
    case 'fiscal_year_start_unknown':
      return {
        type: 'oneClick',
        label: labels.confirmYearStart.replace('{month}', problem.detail['month'] ?? ''),
        onApply: () => actions.onConfirmFiscalYearStart(problem),
      }
    case 'fiscal_year_start_mismatch':
      return {
        type: 'explainOnly',
        href: '/fiscal-years',
        linkLabel: labels.settings,
      }
    case 'resource_unreadable':
      return {
        type: 'guided',
        label: labels.reread,
        onOpen: () => actions.onRereadResource(problem),
        steps: [labels.stepPermissions, labels.stepOpenMoneybird, labels.stepReread],
      }
    case 'trial_balance_empty':
      return {
        type: 'oneClick',
        label: labels.acknowledgeEmpty.replace('{year}', problem.detail['year'] ?? ''),
        onApply: () => actions.onAcknowledgeEmptyYear(problem),
      }
    case 'trial_balance_unbalanced':
      return {
        type: 'guided',
        label: labels.drillDown,
        onOpen: () => actions.onDrillUnbalanced(problem),
      }
    case 'period_locked':
      return {
        type: 'guided',
        label: labels.exclude,
        onOpen: () => actions.onExcludeDocument(problem),
        steps: [labels.stepDoNotTransfer, labels.reopenYear],
      }
    case 'unbalanced_document':
      return {
        type: 'guided',
        label: labels.exclude,
        onOpen: () => actions.onReviewUnbalanced(problem),
        steps: [labels.stepDoNotTransfer, labels.openMoneybird],
      }
    case 'attachment_without_url':
      return {
        type: 'oneClick',
        label: labels.deferAttachment,
        onApply: () => actions.onDeferAttachment(problem),
      }
    case 'draft_skipped':
      return {
        type: 'explainOnly',
        ...(moneybirdHref === null ? {} : { href: moneybirdHref, linkLabel: labels.openMoneybird }),
      }
    default: {
      const _exhaustive: never = problem.code
      void _exhaustive
      return { type: 'explainOnly' }
    }
  }
}

export function moneybirdFindingCard(
  problem: MoneybirdProblem,
  list: 'problems' | 'warnings',
  actions: MoneybirdFindingActions,
): FindingCardModel {
  const honesty = honestyOf(problem.code)
  // unbalanced_document: guided exclude on open; also surface Moneybird via
  // steps. draft_skipped keeps explainOnly with an absolute Moneybird href.
  return {
    code: problem.code,
    path: problem.path,
    messageKey: problem.messageKey,
    detail: problem.detail,
    message: problem.message,
    severity: severityOf(problem, list),
    fix: fixFor(problem, actions),
    ...(honesty === undefined ? {} : { honesty }),
  }
}

/** Pure: which fix type a code (+ optional unknown_currency path) gets. */
export function moneybirdFixTypeFor(
  problem: Pick<MoneybirdProblem, 'code' | 'path' | 'detail'>,
): 'oneClick' | 'guided' | 'explainOnly' {
  if (problem.code === 'unknown_currency') {
    return fixForUnknownCurrency(unknownCurrencyVariantOf(problem)).fixType
  }
  // Screen-level: unbalanced_document is guided exclude (PM #55); core catalogue
  // still documents explainOnly — moneybirdFixTypeFor follows the wired screen.
  if (problem.code === 'unbalanced_document') return 'guided'
  return fixSpecFor(problem.code).fixType
}
