/**
 * Fixture findings for Moneybird / Exact import UI (e2e + lab / screenshots).
 *
 * Shapes match FindingCardModel + honesty sources from the #57 prototype and
 * the #42/#55 wire contract — amounts already as euro display strings.
 */

import type { RankableAccount } from '@klopt/core/moneybird-account-ranker'
import type { FindingsListItem } from '~/components/findings/finding-card'
import type { HonestySource, ResolvedFindingRow } from '~/lib/import-findings'

export const FIXTURE_ACCOUNTS: readonly RankableAccount[] = [
  {
    number: '4400',
    name: 'Kantoorkosten',
    rgsCode: 'WBedKanCea',
  },
  {
    number: '4510',
    name: 'Kantoorartikelen',
    rgsCode: 'WBedKanKan',
  },
  {
    number: '4000',
    name: 'Inkoopkosten',
    rgsCode: 'WBedInk',
  },
  {
    number: '7000',
    name: 'Inkoop grondstoffen',
    rgsCode: 'WBedInkGrd',
  },
  {
    number: '1600',
    name: 'Crediteuren',
    rgsCode: 'BSchCre',
  },
]

export function moneybirdFixtureFindings(handlers?: {
  readonly onMapAccount?: () => void
  readonly onOpenFx?: () => void
  readonly onConfirmYear?: () => void
  readonly onApplyTax?: () => void | Promise<void>
  /** Guided VAT sheet (null-rate / map) — production path for unmapped_tax_rate (#90). */
  readonly onMapTax?: () => void
}): readonly FindingsListItem[] {
  const onMap = handlers?.onMapAccount ?? (() => undefined)
  const onFx = handlers?.onOpenFx ?? (() => undefined)
  const onYear = handlers?.onConfirmYear ?? (() => undefined)
  const onTax = handlers?.onApplyTax ?? (() => undefined)
  const onMapTax = handlers?.onMapTax ?? (() => undefined)

  return [
    {
      id: 'f1',
      code: 'unmapped_account',
      path: 'ledger_accounts/389114002',
      messageKey: 'moneybird.unmapped_account',
      detail: { name: 'Kantoorartikelen', number: '4510', rgsCode: 'WBedKanKan', count: '38' },
      message: "Category 'Kantoorartikelen' has no place in Klopt yet",
      severity: 'blocking',
      fix: {
        type: 'guided',
        label: 'Categorie kiezen',
        onOpen: onMap,
        steps: ['Categorie', 'Btw'],
      },
    },
    {
      id: 'f2',
      code: 'unknown_currency',
      path: 'documents/purchase_invoices/389114027',
      messageKey: 'moneybird.unknown_currency_document',
      detail: {
        reference: 'INV-20931',
        currency: 'GBP',
        functionalCurrency: 'EUR',
        amount: '1.240,00',
        date: '2026-10-16',
      },
      message: 'Purchase invoice INV-20931 from Shipton Mill is in GBP',
      severity: 'blocking',
      fix: {
        type: 'guided',
        label: 'Koers kiezen',
        onOpen: onFx,
        steps: ['Koers', 'Controleren'],
      },
    },
    {
      id: 'f3',
      code: 'unmapped_tax_rate',
      path: 'tax_rates/389113870',
      messageKey: 'moneybird.unmapped_tax_rate',
      detail: { name: 'Laag tarief', percentage: '9' },
      message: "VAT rate 'Laag tarief' is not mapped",
      severity: 'blocking',
      fix: {
        type: 'oneClick',
        label: 'Gebruik 9% btw',
        preview: {
          summary: 'Dit verandert wat er geïmporteerd wordt',
          lines: [
            { label: '12 regels krijgen', value: '9% btw' },
            { label: 'Btw over die regels', value: '€ 214,30' },
          ],
        },
        onApply: onTax,
      },
    },
    {
      // Production Moneybird path: guided sheet with steps (was empty before #90).
      id: 'f3b',
      code: 'unmapped_tax_rate',
      path: 'tax_rates/389113871',
      messageKey: 'moneybird.unmapped_tax_rate',
      detail: { name: 'Geen btw', percentage: '—' },
      message: 'Tax rate Geen btw (—) has no confirmed Klopt VAT code. Map it before importing.',
      severity: 'blocking',
      fix: {
        type: 'guided',
        label: 'Btw-tarief koppelen',
        onOpen: onMapTax,
        steps: ['Btw-code kiezen', 'Opslaan'],
      },
    },
    {
      // Documents still carry VAT on a null-% rate — explainOnly (#90 PM).
      id: 'f3c',
      code: 'null_percentage_vat_mismatch',
      path: 'taxRates.95',
      messageKey: 'moneybird.null_percentage_vat_mismatch',
      detail: { name: 'Geen btw', count: '1', references: 'LEV-VAT' },
      message:
        'Tax rate Geen btw has no percentage, but 1 document(s) still show VAT (LEV-VAT). Mapping it to 0% would drop that VAT from the return — fix the rate or the documents in Moneybird first.',
      severity: 'blocking',
      fix: {
        type: 'explainOnly',
        href: 'https://moneybird.com',
        linkLabel: 'Open in Moneybird',
      },
    },
    {
      id: 'f4',
      code: 'fiscal_year_start_unknown',
      path: 'administration',
      messageKey: 'moneybird.fiscal_year_start_unknown',
      detail: { month: '1' },
      message: 'Moneybird does not say which month the year starts',
      severity: 'warning',
      fix: {
        type: 'oneClick',
        label: 'Klopt, januari',
        onApply: onYear,
      },
    },
    {
      id: 'f5',
      code: 'draft_skipped',
      path: 'documents/sales_invoices',
      messageKey: 'moneybird.draft_skipped',
      detail: { reference: 'CONCEPT-4', count: '4', state: 'concept' },
      message: '4 invoices are still draft in Moneybird',
      severity: 'warning',
      fix: {
        type: 'explainOnly',
        href: 'https://moneybird.com',
        linkLabel: 'Open in Moneybird',
      },
    },
    {
      id: 'f6',
      code: 'period_locked',
      path: 'documents/receipts/389110551',
      messageKey: 'moneybird.period_locked',
      detail: { reference: 'MB-2025-0912', year: '2025' },
      message: 'Receipt MB-2025-0912 from 2025 will not transfer',
      severity: 'warning',
      fix: {
        type: 'explainOnly',
        href: '/fiscal-years',
        linkLabel: 'Naar Boekjaren',
      },
    },
  ]
}

export const MONEYBIRD_FIXTURE_SOURCES: readonly HonestySource[] = [
  {
    id: 'sales',
    label: 'Verkoopfacturen',
    count: '412 gelezen',
    honesty: 'reconciled',
  },
  {
    id: 'purchases',
    label: 'Inkoop en bonnen',
    count: '268 gelezen',
    honesty: 'reconciled',
  },
  {
    id: 'year-2024',
    label: 'Boekingen 2024',
    count: '0 gelezen',
    honesty: 'empty',
  },
  {
    id: 'attachments',
    label: 'Bijlagen',
    count: 'HTTP 403',
    honesty: 'unread',
  },
]

export const MONEYBIRD_FIXTURE_RESOLVED: readonly ResolvedFindingRow[] = [
  {
    id: 'r1',
    code: 'contact_number_collision',
    title: 'Relatienummer 1042 kwam twee keer voor',
    result: 'Lunchroom Het Hoekje kreeg nummer 1043',
  },
]

export function exactFixtureFindings(): readonly FindingsListItem[] {
  return [
    {
      id: 'e1',
      code: 'unmapped_gl_account',
      path: 'GLAccounts/123',
      // Exact still ships English `message` only (#46). Omit detail so a missing
      // catalogue key falls through without calling translate with values.
      messageKey: 'exact.unmapped_gl_account',
      message: 'Grootboekrekening 4510 is niet gekoppeld aan een Klopt-categorie.',
      severity: 'blocking',
      fix: { type: 'explainOnly', href: '/accounts', linkLabel: 'Naar Categorieën' },
    },
    {
      id: 'e2',
      code: 'open_item_differs',
      path: 'receivables',
      messageKey: 'exact.open_item_differs',
      message: 'Debiteuren in Exact wijken € 12,50 af van de openstaande posten.',
      severity: 'warning',
      fix: { type: 'explainOnly' },
    },
  ]
}

export const EXACT_FIXTURE_SOURCES: readonly HonestySource[] = [
  {
    id: 'exact-control',
    label: 'Openstaande posten',
    count: 'Debiteuren · Crediteuren',
    honesty: 'reconciled',
  },
]
