import { writeSession, clearSession, readSession } from '../session.js'
import type { Command } from './registry.js'
import { optionOf } from './registry.js'

/**
 * Signing in, which on a fresh instance is also "create the first user".
 *
 * Spec 10.4 lists creating the first user as a thing a self-hoster needs at
 * 23:00. The tempting way to do that is to reach into the database, and this
 * does not: it drives the same two endpoints the sign-in screen drives. A new
 * address gets an account because `disableSignUp` is false — the code still
 * has to arrive in that mailbox — so the first `klopt login` on an empty
 * instance creates the first user without a privileged path existing at all.
 *
 * With no SMTP configured the code goes to the server log, which is the
 * documented fresh-install path and exactly what you have at 23:00.
 *
 * ## Why these two requests carry an `Origin`
 *
 * better-auth refuses a state-changing request with `MISSING_OR_NULL_ORIGIN`
 * when it looks like it came from a browser and does not say where from. Node's
 * `fetch` sends `sec-fetch-*` headers, so it looks exactly like one — curl does
 * not, and gets waved through, which is why this is the sort of thing that
 * works by hand and fails from the program.
 *
 * The header is the instance's own address, which better-auth checks against
 * its `baseURL`. Claiming to be the instance we are talking to is true, and it
 * is what a same-site browser would send.
 */
export const login: Command = {
  name: 'login',
  summary: 'Sign in. Creates the account if the address is new.',
  usage: 'klopt login --email you@example.nl [--url https://books.example.nl]',
  options: { email: 'string' },
  operations: [],
  anonymous: true,

  async run({ args, out, err, prompt }) {
    const url = optionOf(args, 'url') ?? process.env['KLOPT_URL']
    if (url === undefined || url === '') {
      err('Set --url or KLOPT_URL to the address of your Klopt instance.')
      return 2
    }

    const email = optionOf(args, 'email') ?? (await prompt('E-mail: '))
    if (email.trim() === '') {
      err('An address is required.')
      return 2
    }

    const send = await fetch(new URL('/api/auth/email-otp/send-verification-otp', url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: new URL(url).origin },
      body: JSON.stringify({ email: email.trim(), type: 'sign-in' }),
    })

    if (!send.ok) {
      err(`Could not send a code: ${String(send.status)} ${send.statusText}`)
      if (send.status === 429) {
        err('That is the rate limit. Six code requests an hour, per address.')
      }
      return 1
    }

    out(`A six-digit code is on its way to ${email.trim()}.`)
    out('No mail server configured? It is in the server log.')

    const code = (await prompt('Code: ')).trim()

    const signIn = await fetch(new URL('/api/auth/sign-in/email-otp', url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: new URL(url).origin },
      body: JSON.stringify({ email: email.trim(), otp: code }),
    })

    if (!signIn.ok) {
      err('That code is wrong, or has expired. Three tries and it is burned; ask for a new one.')
      return 1
    }

    const setCookie = signIn.headers.get('set-cookie')
    if (setCookie === null) {
      err('The server accepted the code but issued no session. That is a bug worth reporting.')
      return 1
    }

    // Only the name=value pair. The attributes are a browser's business, and
    // storing `HttpOnly` in a file we then send back is noise at best.
    const cookie = setCookie.split(';')[0]!
    writeSession({ url, cookie, email: email.trim() })

    out(`Signed in as ${email.trim()}.`)
    return 0
  },
}

export const logout: Command = {
  name: 'logout',
  summary: 'Forget the stored session.',
  usage: 'klopt logout',
  operations: [],
  anonymous: true,

  async run({ out }) {
    const existing = readSession()
    clearSession()
    out(existing === null ? 'There was no stored session.' : `Signed out ${existing.email}.`)
    return Promise.resolve(0)
  },
}
