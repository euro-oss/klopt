import type {
  PurchaseInvoiceStatus,
  RetentionClass,
  StatementSectionKey,
  VatPeriodKind,
} from '@klopt/core'
import type { MessageKey } from './nl.js'
import type { Values } from './locale.js'

/**
 * Labels the server computes, translated from the code it sends alongside
 * them (ADR 0045).
 *
 * Every one of these arrives on a response as a pair: a machine value and a
 * Dutch sentence. `status: 'disputed'` and `statusLabel: 'in geschil'`; `key:
 * 'assets'` and `title: 'Activa'`. The sentence stays on the response —
 * removing a field is a breaking change under `docs/api-stability.md`, and an
 * integrator with no message catalogue still needs something to print — but
 * the UI stops reading it and translates the code instead.
 *
 * The functions are here rather than inline at each screen so that
 * `test/labels.test.ts` can hold one property: every value of every one of
 * these enumerations has a translation, in both languages. A `t()` call
 * scattered through a component cannot be checked that way, and the failure
 * mode — one status out of five falling back to a key — is exactly the kind
 * nobody notices.
 *
 * ## What is deliberately not here
 *
 * **Rubriek names.** "Leveringen/diensten belast met hoog tarief" is the text
 * printed next to box 1a on the Belastingdienst's own form. An English-
 * speaking bookkeeper filing a Dutch return is reading our screen and the form
 * side by side, and translating it would mean the two no longer match. It is a
 * statutory label, not our prose, and it stays in the language it is filed in.
 */

type Translate = (key: MessageKey, values?: Values) => string

export function purchaseStatusLabel(t: Translate, status: PurchaseInvoiceStatus): string {
  return t(`label.purchaseStatus.${status}`)
}

export function statementSectionLabel(t: Translate, key: StatementSectionKey): string {
  return t(`label.statementSection.${key}`)
}

export function retentionClassLabel(t: Translate, retentionClass: RetentionClass): string {
  return t(`label.retentionClass.${retentionClass}`)
}

/** Which of the three reminders this is. */
export type DunningTone = 'reminder' | 'demand' | 'final'

export const DUNNING_TONES: readonly DunningTone[] = ['reminder', 'demand', 'final']

/**
 * Keyed by tone rather than by stage number.
 *
 * The schedule is three stages today and is meant to be configurable; a
 * translation keyed on `2` would attach to whatever the second stage becomes.
 * The tone is what the message *is*, and it does not move.
 */
export function dunningStageLabel(t: Translate, tone: DunningTone): string {
  return t(`label.dunningTone.${tone}`)
}

/**
 * "1e kwartaal 2026", "Q1 2026", "maart 2026", "March 2026".
 *
 * Built from the period code rather than from a sentence, because the month
 * name is `Intl`'s job: it already knows the twelve names in every locale, and
 * putting them in the catalogue would be twenty-four strings to keep right for
 * no gain.
 */
export function vatPeriodLabel(
  t: Translate,
  tag: string,
  kind: VatPeriodKind,
  code: string,
): string {
  const [yearPart = code, rest] = code.split('-')

  if (kind === 'annual') return t('label.vatPeriod.annual', { year: yearPart })

  if (kind === 'quarterly') {
    return t('label.vatPeriod.quarterly', { year: yearPart, quarter: rest?.replace('Q', '') ?? '' })
  }

  const month = Number(rest)
  const name = Number.isFinite(month)
    ? new Intl.DateTimeFormat(tag, { month: 'long', timeZone: 'UTC' }).format(
        new Date(Date.UTC(2000, month - 1, 1)),
      )
    : (rest ?? '')

  return t('label.vatPeriod.monthly', { year: yearPart, month: name })
}
