import { Link } from '@tanstack/react-router'
import {
  assessDocumentFiscalYear,
  type DocumentFiscalYearGate,
  type FiscalYearGateInput,
} from '~/lib/booking-fiscal-year-gate'
import { useMemo } from 'react'
import { useT } from '~/i18n/provider'
import { cn } from '~/lib/utils'

export function documentFiscalYearGate(
  years: readonly FiscalYearGateInput[],
  documentDate: string,
  startMonth: number,
): DocumentFiscalYearGate {
  return assessDocumentFiscalYear(years, documentDate, startMonth)
}

export function DocumentFiscalYearHint({
  years,
  documentDate,
  startMonth,
  canOpenYear,
  returnTo,
  onNavigate,
  id = 'document-fiscal-year-hint',
}: {
  years: readonly FiscalYearGateInput[]
  documentDate: string
  startMonth: number
  canOpenYear: boolean
  returnTo: string
  onNavigate?: () => void
  id?: string
}) {
  const { t } = useT()
  const gate = useMemo(
    () => documentFiscalYearGate(years, documentDate, startMonth),
    [years, documentDate, startMonth],
  )

  if (gate.kind === 'ok') return null

  const message =
    gate.reason === 'closed'
      ? t('booking.fiscalYearClosed', { year: gate.code })
      : t('booking.fiscalYearNotOpen', { year: gate.code })

  const showLink = canOpenYear && gate.reason === 'missing'

  return (
    <p id={id} role="alert" className="text-destructive mt-1 text-xs">
      {message}{' '}
      {showLink ? (
        <Link
          to="/fiscal-years"
          search={{ openYear: gate.code, returnTo, focus: 'confirm' }}
          onClick={onNavigate}
          className={cn(
            'text-destructive inline-flex min-h-11 items-center font-semibold underline underline-offset-2',
            'focus-visible:ring-ring rounded-sm focus-visible:ring-2 focus-visible:outline-none',
          )}
        >
          {t('booking.fiscalYearOpenLink', { year: gate.code })}
        </Link>
      ) : null}
      {!canOpenYear && gate.reason === 'missing' ? (
        <span className="text-destructive mt-1 block">{t('booking.fiscalYearAskOwner')}</span>
      ) : null}
    </p>
  )
}
