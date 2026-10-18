/**
 * Helpers for Moneybird import decisions (issue #42).
 *
 * Pure merges so the screen can update one finding's fix without rewriting the
 * whole decisions object by hand.
 */

import type { AccountType, FxRateChoice, MoneybirdImportDecisions } from '@klopt/core'

export function emptyDecisions(): MoneybirdImportDecisions {
  return {}
}

export function withConfirmedCurrency(
  decisions: MoneybirdImportDecisions,
): MoneybirdImportDecisions {
  return { ...decisions, confirmedCurrencyIsFunctional: true }
}

export function withConfirmedFiscalYearStart(
  decisions: MoneybirdImportDecisions,
): MoneybirdImportDecisions {
  return { ...decisions, confirmedFiscalYearStart: true }
}

export function withAcknowledgedEmptyYear(
  decisions: MoneybirdImportDecisions,
  year: string,
): MoneybirdImportDecisions {
  const existing = decisions.acknowledgedEmptyYears ?? []
  if (existing.includes(year)) return decisions
  return { ...decisions, acknowledgedEmptyYears: [...existing, year] }
}

export function withExcludedExternalId(
  decisions: MoneybirdImportDecisions,
  externalId: string,
): MoneybirdImportDecisions {
  const existing = decisions.excludedExternalIds ?? []
  if (existing.includes(externalId)) return decisions
  return { ...decisions, excludedExternalIds: [...existing, externalId] }
}

export function withExcludedLockedYear(
  decisions: MoneybirdImportDecisions,
  year: string,
): MoneybirdImportDecisions {
  const existing = decisions.excludedLockedYears ?? []
  if (existing.includes(year)) return decisions
  return { ...decisions, excludedLockedYears: [...existing, year] }
}

export function withContactNumber(
  decisions: MoneybirdImportDecisions,
  moneybirdId: string,
  number: string,
): MoneybirdImportDecisions {
  return {
    ...decisions,
    contactNumberOverrides: {
      ...(decisions.contactNumberOverrides ?? {}),
      [moneybirdId]: number,
    },
  }
}

export function withAccountType(
  decisions: MoneybirdImportDecisions,
  moneybirdId: string,
  type: AccountType,
): MoneybirdImportDecisions {
  return {
    ...decisions,
    accountTypeOverrides: {
      ...(decisions.accountTypeOverrides ?? {}),
      [moneybirdId]: type,
    },
  }
}

export function withExchangeRate(
  decisions: MoneybirdImportDecisions,
  externalId: string,
  choice: FxRateChoice,
): MoneybirdImportDecisions {
  return {
    ...decisions,
    exchangeRates: {
      ...(decisions.exchangeRates ?? {}),
      [externalId]: choice,
    },
  }
}

export function withDeferredAttachment(
  decisions: MoneybirdImportDecisions,
  attachmentId: string,
): MoneybirdImportDecisions {
  const existing = decisions.deferredAttachmentIds ?? []
  if (existing.includes(attachmentId)) return decisions
  return { ...decisions, deferredAttachmentIds: [...existing, attachmentId] }
}
