import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'

/**
 * Sign in, and — on a fresh install with no users yet — sign up.
 *
 * Posts to better-auth's own endpoints rather than through a server function:
 * the library owns the cookie, the rate limiting and the password hashing, and
 * putting a wrapper in front of it would only be somewhere for a bug to live.
 */
export const Route = createFileRoute('/sign-in')({
  component: SignIn,
})

function SignIn() {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    const response = await fetch(`/api/auth/${mode}/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(mode === 'sign-up' ? { email, password, name } : { email, password }),
    })

    setBusy(false)

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { message?: string }
      setError(body.message ?? 'Aanmelden is niet gelukt.')
      return
    }

    window.location.href = '/'
  }

  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center p-8">
      <form
        onSubmit={(event) => {
          void submit(event)
        }}
        className="w-full max-w-sm"
      >
        <h1 className="text-2xl font-semibold tracking-tight">Klopt</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {mode === 'sign-in' ? 'Meld je aan.' : 'Maak het eerste account aan.'}
        </p>

        <div className="mt-6 space-y-3">
          {mode === 'sign-up' && (
            <label className="block">
              <span className="text-muted-foreground mb-1 block text-xs font-medium">Naam</span>
              <input
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                }}
                required
                className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
              />
            </label>
          )}

          <label className="block">
            <span className="text-muted-foreground mb-1 block text-xs font-medium">E-mail</span>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value)
              }}
              required
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            />
          </label>

          <label className="block">
            <span className="text-muted-foreground mb-1 block text-xs font-medium">Wachtwoord</span>
            <input
              type="password"
              autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value)
              }}
              required
              minLength={12}
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            />
            {mode === 'sign-up' && (
              <span className="text-muted-foreground mt-1 block text-xs">Minimaal 12 tekens.</span>
            )}
          </label>
        </div>

        {error !== null && <p className="text-destructive mt-3 text-sm">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="bg-primary text-primary-foreground mt-6 w-full rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {mode === 'sign-in' ? 'Aanmelden' : 'Account aanmaken'}
        </button>

        <button
          type="button"
          onClick={() => {
            setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')
          }}
          className="text-muted-foreground hover:text-foreground mt-3 w-full text-center text-xs underline"
        >
          {mode === 'sign-in'
            ? 'Nog geen account? Maak er een aan.'
            : 'Al een account? Meld je aan.'}
        </button>
      </form>
    </main>
  )
}
