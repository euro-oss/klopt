import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { Check } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Keycap } from '~/components/ui/keycap'
import { PrivacyNoticeLink, PrivacyStepLine } from '~/components/legal-links'
import { useT } from '~/i18n/provider'
import { useHydrated } from '~/lib/hydration'
import { cn } from '~/lib/utils'
import { getSession } from '~/server/context'
import { acknowledgePrivacyNotice, getLegalConfig, privacyNoticePending } from '~/server/legal'

/**
 * Sign in with a one-time code.
 *
 * No password, anywhere. There is nothing to store, reset, leak or get wrong —
 * see the note in `packages/db/src/auth.ts` for why that trade is the right one
 * for software holding seven years of somebody's records.
 *
 * Two steps in one screen: ask for the address, then ask for the code. The
 * address stays visible and changeable throughout, because the commonest
 * failure is typing it wrong and the commonest fix is retyping it.
 *
 * Invitees (who skip Setup) get a one-time privacy-notice step after the code
 * when KLOPT_PRIVACY_URL + KLOPT_PRIVACY_VERSION are set (#138).
 *
 * Outside the `_app` layout, so it renders while signed out. Posts to
 * better-auth's own endpoints rather than through a server function: the
 * library owns the cookie, the rate limiting and the code storage, and a
 * wrapper in front of it would only be somewhere for a bug to live.
 *
 * Desktop-light reskin of the #106 SignIn board (#138 / #140). Dark and phone
 * follow later boards.
 */
export const Route = createFileRoute('/sign-in')({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search['redirect'] === 'string' ? search['redirect'] : undefined,
  }),
  beforeLoad: async ({ search }) => {
    const session = await getSession()
    if (session === null) return
    // Stay on /sign-in when the invitee still needs the one-time privacy step.
    const pending = await privacyNoticePending()
    if (pending.show) return
    throw redirect({ to: search.redirect ?? '/' })
  },
  loader: async () => {
    const [legal, privacy] = await Promise.all([getLegalConfig(), privacyNoticePending()])
    return { legal, privacyPending: privacy.show }
  },
  component: SignIn,
})

const CODE_LENGTH = 6

/** Brand mark — export `.k-mark`. */
function BrandMark({ onBrand = false }: { readonly onBrand?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-xl font-bold',
        onBrand ? 'bg-[var(--on-brand)] text-brand' : 'bg-brand text-[var(--on-brand)]',
      )}
    >
      K
    </span>
  )
}

function SignIn() {
  const { redirect: target } = Route.useSearch()
  const { legal, privacyPending } = Route.useLoaderData()
  const navigate = useNavigate()
  const { t } = useT()

  const [step, setStep] = useState<'email' | 'code' | 'privacy'>(
    privacyPending ? 'privacy' : 'email',
  )
  /** Captured from the form on submit, not bound to the input. See below. */
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /**
   * The email field is **uncontrolled**, and that is deliberate.
   *
   * Server-rendered markup accepts typing before React hydrates. A controlled
   * input then re-renders with its empty state value and silently discards
   * what was typed — after which `required` blocks the submit and the form
   * appears to do nothing at all. So the DOM stays the source of truth for
   * this field and the value is read from it on submit.
   *
   * The submit button is separately gated on hydration, because before that
   * the browser would fall back to a native submit and reload the page.
   */
  const hydrated = useHydrated()
  const codeRef = useRef<HTMLInputElement>(null)
  const verifyingRef = useRef(false)

  useEffect(() => {
    if (step === 'code') codeRef.current?.focus()
  }, [step])

  async function post(path: string, body: unknown): Promise<Response | null> {
    try {
      return await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch {
      setError(t('signIn.unreachable'))
      return null
    }
  }

  async function requestCode(address: string, options?: { readonly resend?: boolean }) {
    if (address === '') return
    setBusy(true)
    setError(null)
    if (options?.resend !== true) setNotice(null)
    setEmail(address)

    const response = await post('/api/auth/email-otp/send-verification-otp', {
      email: address,
      type: 'sign-in',
    })
    setBusy(false)
    if (response === null) return

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { message?: string }
      setError(body.message ?? t('signIn.sendFailed'))
      return
    }

    setStep('code')
    // First send: the intro already says we sent a code. Only a resend shows
    // a notice, so the sentence does not appear twice.
    setNotice(options?.resend === true ? t('signIn.codeSent') : null)
  }

  function onRequestSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = new FormData(event.currentTarget).get('email')
    void requestCode(typeof value === 'string' ? value.trim() : '')
  }

  async function finishSignIn() {
    await navigate({ to: target ?? '/', reloadDocument: true })
  }

  async function verifyCode(otp: string) {
    if (verifyingRef.current || otp.length !== CODE_LENGTH) return
    verifyingRef.current = true
    setBusy(true)
    setError(null)

    const response = await post('/api/auth/sign-in/email-otp', { email, otp })
    if (response === null) {
      setBusy(false)
      verifyingRef.current = false
      return
    }

    if (!response.ok) {
      setBusy(false)
      verifyingRef.current = false
      setCode('')
      codeRef.current?.focus()
      setError(t('signIn.codeWrong'))
      return
    }

    // Cookie is set. Invitees with a configured privacy notice see it once
    // before entering; everyone else goes straight through.
    const pending = await privacyNoticePending()
    if (pending.show) {
      setBusy(false)
      verifyingRef.current = false
      setStep('privacy')
      return
    }

    await finishSignIn()
  }

  async function submitCode(event: React.FormEvent) {
    event.preventDefault()
    await verifyCode(code)
  }

  async function continueAfterPrivacy() {
    setBusy(true)
    setError(null)
    const result = await acknowledgePrivacyNotice()
    if (!result.ok) {
      setBusy(false)
      setError(result.detail)
      return
    }
    await finishSignIn()
  }

  const stepLabel = step === 'email' ? t('signIn.step1') : t('signIn.step2')

  return (
    <main className="bg-ground text-ink flex min-h-screen overflow-x-clip">
      <aside className="bg-brand text-[var(--on-brand)] hidden w-[min(560px,39vw)] shrink-0 flex-col gap-6 p-14 md:flex">
        <span className="flex items-center gap-3 text-[22px] font-bold">
          <BrandMark onBrand />
          Klopt
        </span>
        <div className="flex-1" />
        <h1 className="max-w-[420px] text-[44px] leading-[1.05] font-bold tracking-[-0.03em]">
          {t('signIn.tagline')}
        </h1>
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0 text-[15px] font-medium">
          {(
            ['signIn.bulletOpenSource', 'signIn.bulletExport', 'signIn.bulletSelfHost'] as const
          ).map((key) => (
            <li key={key} className="flex gap-2.5">
              <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" strokeWidth={2.5} />
              <span>{t(key)}</span>
            </li>
          ))}
        </ul>
      </aside>

      <div className="flex flex-1 items-center justify-center p-4 sm:p-12">
        <section
          className="border-line bg-surface flex w-full max-w-[380px] flex-col gap-5 rounded-[var(--radius-lg)] border p-5 sm:p-8 shadow-[var(--shadow-raised)]"
          aria-labelledby="sign-in-heading"
        >
          {step !== 'privacy' && (
            <span className="bg-surface-sunken text-ink-2 inline-flex h-[1.375rem] w-fit items-center rounded-[var(--radius-pill)] px-1.5 text-xs font-medium">
              {stepLabel}
            </span>
          )}

          {step === 'privacy' ? (
            <>
              <PrivacyStepLine privacyUrl={legal.privacyUrl} />
              {error !== null && (
                <p role="alert" className="text-destructive text-sm">
                  {error}
                </p>
              )}
              <Button
                type="button"
                disabled={busy || !hydrated}
                className="min-h-11 w-full justify-center"
                onClick={() => {
                  void continueAfterPrivacy()
                }}
              >
                {busy ? t('common.busy') : t('legal.privacyContinue')}
              </Button>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <h2 id="sign-in-heading" className="text-[22px] leading-7 font-semibold">
                  {step === 'email' ? t('signIn.title') : t('signIn.checkEmail')}
                </h2>
                {step === 'email' ? (
                  <p className="text-ink-2 m-0 text-sm">{t('signIn.introEmail')}</p>
                ) : (
                  <div className="text-ink-2 text-sm">
                    <p className="m-0">{t('signIn.introCode')}</p>
                    <p className="text-ink m-0 break-all font-medium">{email}</p>
                    <button
                      type="button"
                      onClick={() => {
                        setStep('email')
                        setCode('')
                        setError(null)
                        setNotice(null)
                      }}
                      className="text-link mt-1 min-h-11 underline underline-offset-4"
                    >
                      {t('signIn.change')}
                    </button>
                  </div>
                )}
              </div>

              {step === 'email' ? (
                <form onSubmit={onRequestSubmit} className="flex flex-col gap-5">
                  <label className="block">
                    <span className="text-ink-2 mb-1.5 block text-xs font-medium">
                      {t('signIn.email')}
                    </span>
                    <Input
                      name="email"
                      type="email"
                      autoComplete="email"
                      required
                      defaultValue={email}
                      className="border-ink-muted min-h-11"
                    />
                  </label>

                  {error !== null && (
                    <p role="alert" className="text-destructive text-sm">
                      {error}
                    </p>
                  )}

                  <Button
                    type="submit"
                    disabled={busy || !hydrated}
                    className="min-h-11 w-full justify-center gap-2"
                  >
                    {busy ? t('common.busy') : t('signIn.sendCode')}
                    {!busy && (
                      <Keycap className="border-primary-foreground/30 bg-primary text-primary-foreground">
                        ↵
                      </Keycap>
                    )}
                  </Button>

                  {legal.signupClosed && (
                    <p className="text-ink-muted m-0 text-[13px]">{t('signIn.inviteOnly')}</p>
                  )}
                </form>
              ) : (
                <form
                  onSubmit={(event) => {
                    void submitCode(event)
                  }}
                  className="flex flex-col gap-5"
                >
                  <div className="block">
                    <label className="block">
                      <span className="text-ink-2 mb-1.5 block text-xs font-medium">
                        {t('signIn.code')}
                      </span>
                      <Input
                        ref={codeRef}
                        name="otp"
                        autoComplete="one-time-code"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={CODE_LENGTH}
                        required
                        value={code}
                        onChange={(event) => {
                          const next = event.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH)
                          setCode(next)
                          if (next.length === CODE_LENGTH) {
                            void verifyCode(next)
                          }
                        }}
                        className="border-ink-muted min-h-11 text-center font-mono text-lg tracking-[0.4em] tabular-nums"
                      />
                    </label>
                    <span className="text-ink-muted mt-1.5 block text-[13px]">
                      {t('signIn.codeHelp')}
                    </span>
                  </div>

                  {notice !== null && error === null && (
                    <p className="text-ink-muted text-sm">{notice}</p>
                  )}
                  {error !== null && (
                    <p role="alert" className="text-destructive text-sm">
                      {error}
                    </p>
                  )}

                  <Button
                    type="submit"
                    disabled={busy || !hydrated || code.length !== CODE_LENGTH}
                    className="min-h-11 w-full justify-center"
                  >
                    {busy ? t('common.busy') : t('signIn.verify')}
                  </Button>

                  <div className="text-ink-muted flex flex-col items-start gap-1 text-[13px]">
                    <span>{t('signIn.codeValid')}</span>
                    <button
                      type="button"
                      disabled={busy || !hydrated}
                      onClick={() => {
                        void requestCode(email, { resend: true })
                      }}
                      className="text-link min-h-11 underline underline-offset-4"
                    >
                      {t('signIn.resend')}
                    </button>
                  </div>
                </form>
              )}

              {/* Owners / open self-hosted: privacy is a read link on the form,
                  not an interstitial. Invitees get the dedicated step above. */}
              <PrivacyNoticeLink privacyUrl={legal.privacyUrl} className="mt-1" />
            </>
          )}
        </section>
      </div>
    </main>
  )
}
