import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { useHydrated } from '~/lib/hydration'
import { getSession } from '~/server/context'

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
 * Outside the `_app` layout, so it renders while signed out. Posts to
 * better-auth's own endpoints rather than through a server function: the
 * library owns the cookie, the rate limiting and the code storage, and a
 * wrapper in front of it would only be somewhere for a bug to live.
 */
export const Route = createFileRoute('/sign-in')({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search['redirect'] === 'string' ? search['redirect'] : undefined,
  }),
  beforeLoad: async ({ search }) => {
    // Already signed in? Nothing to do here.
    const session = await getSession()
    if (session !== null) throw redirect({ to: search.redirect ?? '/' })
  },
  component: SignIn,
})

const CODE_LENGTH = 6

function SignIn() {
  const { redirect: target } = Route.useSearch()
  const navigate = useNavigate()

  const [step, setStep] = useState<'email' | 'code'>('email')
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
      setError('De server is niet bereikbaar.')
      return null
    }
  }

  async function requestCode(address: string) {
    if (address === '') return
    setBusy(true)
    setError(null)
    setNotice(null)
    setEmail(address)

    const response = await post('/api/auth/email-otp/send-verification-otp', {
      email: address,
      type: 'sign-in',
    })
    setBusy(false)
    if (response === null) return

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { message?: string }
      setError(body.message ?? 'De code kon niet worden verstuurd.')
      return
    }

    setStep('code')
    setNotice(`We hebben een code van ${String(CODE_LENGTH)} cijfers naar ${address} gestuurd.`)
  }

  function onRequestSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = new FormData(event.currentTarget).get('email')
    void requestCode(typeof value === 'string' ? value.trim() : '')
  }

  async function submitCode(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    const response = await post('/api/auth/sign-in/email-otp', { email, otp: code })
    if (response === null) {
      setBusy(false)
      return
    }

    if (!response.ok) {
      setBusy(false)
      setCode('')
      codeRef.current?.focus()
      setError('Die code klopt niet, of is verlopen. Vraag zo nodig een nieuwe aan.')
      return
    }

    // A document navigation, so the layout's guard re-runs against the new
    // session cookie rather than a cached loader result.
    await navigate({ to: target ?? '/', reloadDocument: true })
  }

  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Klopt</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {step === 'email'
            ? 'Vul je e-mailadres in. We sturen je een code.'
            : 'Vul de code in die we je hebben gestuurd.'}
        </p>

        {step === 'email' ? (
          <form onSubmit={onRequestSubmit} className="mt-6">
            <label className="block">
              <span className="text-muted-foreground mb-1 block text-xs font-medium">E-mail</span>
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                defaultValue={email}
                className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
              />
            </label>

            {error !== null && (
              <p role="alert" className="text-destructive mt-3 text-sm">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || !hydrated}
              className="bg-primary text-primary-foreground mt-6 w-full rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {busy ? 'Bezig…' : 'Stuur me een code'}
            </button>
          </form>
        ) : (
          <form
            onSubmit={(event) => {
              void submitCode(event)
            }}
            className="mt-6"
          >
            <p className="text-muted-foreground mb-3 text-sm">
              {email}{' '}
              <button
                type="button"
                onClick={() => {
                  setStep('email')
                  setCode('')
                  setError(null)
                  setNotice(null)
                }}
                className="underline"
              >
                wijzigen
              </button>
            </p>

            <label className="block">
              <span className="text-muted-foreground mb-1 block text-xs font-medium">Code</span>
              <input
                ref={codeRef}
                name="otp"
                // `one-time-code` lets iOS and Safari offer the code straight
                // from the message, which is most of the point of doing it
                // this way.
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={CODE_LENGTH}
                required
                value={code}
                onChange={(event) => {
                  setCode(event.target.value.replace(/\D/g, ''))
                }}
                className="border-input bg-background tabular w-full rounded-md border px-3 py-2 text-center text-lg tracking-[0.4em]"
              />
            </label>

            {notice !== null && error === null && (
              <p className="text-muted-foreground mt-3 text-sm">{notice}</p>
            )}
            {error !== null && (
              <p role="alert" className="text-destructive mt-3 text-sm">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || !hydrated || code.length !== CODE_LENGTH}
              className="bg-primary text-primary-foreground mt-6 w-full rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {busy ? 'Bezig…' : 'Aanmelden'}
            </button>

            <button
              type="button"
              disabled={busy || !hydrated}
              onClick={() => {
                void requestCode(email)
              }}
              className="text-muted-foreground hover:text-foreground mt-3 w-full text-center text-xs underline"
            >
              Stuur een nieuwe code
            </button>
          </form>
        )}

        <p className="text-muted-foreground mt-8 text-xs">
          Geen wachtwoord nodig. Een code is tien minuten geldig en werkt één keer.
        </p>
      </div>
    </main>
  )
}
