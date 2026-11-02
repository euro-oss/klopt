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
 * The whole row is the hit target; terms/DPA links stopPropagation so a tap
 * opens the document without ticking the box.
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

/** Invitee first-sign-in line: one mention of the privacy notice, with the link. */
export function PrivacyStepLine({
  privacyUrl,
  className,
}: {
  readonly privacyUrl: string | null
  readonly className?: string
}) {
  const { t } = useT()
  if (privacyUrl === null) return null

  return (
    <p id="sign-in-heading" className={cn('text-ink m-0 text-base leading-6', className)}>
      {t('legal.privacyStepBefore')}
      <a
        href={privacyUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-link underline underline-offset-4"
      >
        {t('legal.privacyReadLink')}
      </a>
      {t('legal.privacyStepAfter')}
    </p>
  )
}

export function LegalAgreementCheckbox({
  legal,
  checked,
  onCheckedChange,
  disabled,
  invalid,
  id = 'legal-agreement',
}: {
  readonly legal: PublicLegalConfig
  readonly checked: boolean
  readonly onCheckedChange: (checked: boolean) => void
  readonly disabled?: boolean
  readonly invalid?: boolean
  readonly id?: string
}) {
  const { t } = useT()
  if (!legal.agreementRequired || legal.termsUrl === null || legal.dpaUrl === null) {
    return null
  }

  return (
    <label htmlFor={id} className="flex min-h-11 w-full cursor-pointer items-start gap-3 py-2">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        aria-invalid={invalid === true ? true : undefined}
        aria-required="true"
        onCheckedChange={(value) => {
          onCheckedChange(value === true)
        }}
        className="border-ink-muted mt-0.5 size-5"
      />
      <span className="text-ink text-sm leading-snug">
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
      </span>
    </label>
  )
}
