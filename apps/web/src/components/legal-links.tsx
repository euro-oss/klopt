import { Checkbox } from '~/components/ui/checkbox'
import { useT } from '~/i18n/provider'
import type { PublicLegalConfig } from '~/server/legal'
import { cn } from '~/lib/utils'

/**
 * Privacy notice link (read, not agree) and the terms/DPA checkbox (#138).
 *
 * Hidden entirely when the corresponding env URLs are unset (self-hosted).
 * The checkbox stays unticked by default; submit must refuse until it is ticked
 * when `agreementRequired` is true. No marketing or other consent is bundled.
 */

export function PrivacyNoticeLink({
  privacyUrl,
  className,
}: {
  readonly privacyUrl: string | null
  readonly className?: string
}) {
  const { t } = useT()
  if (privacyUrl === null) return null

  return (
    <p className={cn('text-ink-2 text-sm', className)}>
      {t('legal.privacyReadBefore')}
      <a
        href={privacyUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-link underline underline-offset-4"
      >
        {t('legal.privacyReadLink')}
      </a>
      {t('legal.privacyReadAfter')}
    </p>
  )
}

export function LegalAgreementCheckbox({
  legal,
  checked,
  onCheckedChange,
  disabled,
  id = 'legal-agreement',
}: {
  readonly legal: PublicLegalConfig
  readonly checked: boolean
  readonly onCheckedChange: (checked: boolean) => void
  readonly disabled?: boolean
  readonly id?: string
}) {
  const { t } = useT()
  if (!legal.agreementRequired || legal.termsUrl === null || legal.dpaUrl === null) {
    return null
  }

  return (
    <div className="flex min-h-11 items-start gap-3">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => {
          onCheckedChange(value === true)
        }}
        className="border-ink-muted mt-1 size-5"
        aria-required="true"
      />
      <label htmlFor={id} className="text-ink text-sm leading-snug">
        {t('legal.agreePrefix')}
        <a
          href={legal.termsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-link underline underline-offset-4"
          onClick={(event) => {
            event.stopPropagation()
          }}
        >
          {t('legal.terms')}
        </a>
        {t('legal.agreeMiddle')}
        <a
          href={legal.dpaUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-link underline underline-offset-4"
          onClick={(event) => {
            event.stopPropagation()
          }}
        >
          {t('legal.dpa')}
        </a>
        {t('legal.agreeSuffix')}
      </label>
    </div>
  )
}
