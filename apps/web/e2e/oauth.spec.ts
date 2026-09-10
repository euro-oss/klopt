import { createHash, randomBytes } from 'node:crypto'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, signIn, uniqueEmail } from './support'

/**
 * The whole authorization flow, as a client actually walks it (spec 10.3).
 *
 * Registration and PKCE can be tested without a browser, and are. What cannot
 * is the middle: a human signing in, reading what is about to be given away,
 * and clicking. That is the only step that turns a client id — which grants
 * nothing — into a token, so it is the step worth driving for real.
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

const REDIRECT = 'http://127.0.0.1:9876/callback'

async function anAdministration(page: Page) {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill('OAuth BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
}

async function register(request: APIRequestContext) {
  const response = await request.post('/oauth/register', {
    data: {
      client_name: 'Claude',
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: 'none',
    },
  })
  expect(response.status()).toBe(201)
  return (await response.json()) as { client_id: string }
}

function pkce() {
  const verifier = randomBytes(48).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

function authorizeQuery(clientId: string, challenge: string, origin: string): string {
  return new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope: 'ledger:read',
    state: 'xyz',
    resource: `${origin}/api/mcp`,
  }).toString()
}

test('a human approves, and the code becomes a token that reads the books', async ({ page }) => {
  await anAdministration(page)

  const client = await register(page.request)
  const { verifier, challenge } = pkce()
  const origin = new URL(page.url()).origin

  // The client sends the browser here. Nothing has been granted yet.
  await page.goto(`/oauth/authorize?${authorizeQuery(client.client_id, challenge, origin)}`)

  await expect(page.getByRole('heading', { name: 'Toegang geven' })).toBeVisible()
  // The redirect host is the part an attacker cannot fake, so it is shown.
  await expect(page.getByText('127.0.0.1:9876')).toBeVisible()
  await expect(page.getByText('Niets wijzigen, niets boeken, niets versturen.')).toBeVisible()

  // Approving leaves for the client's own address, which is not served here.
  const approve = page.getByRole('button', { name: 'Toegang geven' })
  await expect(approve).toBeEnabled()
  await page.route(`${REDIRECT}*`, (route) => route.fulfill({ status: 200, body: 'ok' }))
  await approve.click()
  await page.waitForURL(/127\.0\.0\.1:9876/)

  const returned = new URL(page.url())
  const code = returned.searchParams.get('code')
  expect(code).not.toBeNull()
  // The state comes back untouched, which is how the client knows it is its own.
  expect(returned.searchParams.get('state')).toBe('xyz')

  // Redeem it.
  const token = await page.request.post('/oauth/token', {
    form: {
      grant_type: 'authorization_code',
      code: code!,
      client_id: client.client_id,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
    },
  })
  expect(token.status()).toBe(200)
  const grant = (await token.json()) as {
    access_token: string
    token_type: string
    expires_in: number
    scope: string
  }
  expect(grant.token_type).toBe('Bearer')
  expect(grant.scope).toBe('ledger:read')
  // An hour, and no refresh token to leave lying in a client we did not write.
  expect(grant.expires_in).toBe(3600)
  expect(grant).not.toHaveProperty('refresh_token')

  // And the point of all of it: the token works on MCP.
  const call = await page.request.post('/api/mcp', {
    headers: { authorization: `Bearer ${grant.access_token}`, 'content-type': 'application/json' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
  })
  expect(call.status()).toBe(200)
  const listed = (await call.json()) as { result: { tools: { name: string }[] } }
  expect(listed.result.tools.length).toBeGreaterThan(0)

  // Single use. A second redemption is a leaked code, not a retry.
  const replay = await page.request.post('/oauth/token', {
    form: {
      grant_type: 'authorization_code',
      code: code!,
      client_id: client.client_id,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
    },
  })
  expect(replay.status()).toBe(400)
  expect(((await replay.json()) as { error: string }).error).toBe('invalid_grant')
})

test('a code will not redeem with the wrong verifier', async ({ page }) => {
  // PKCE is the whole of a public client's authentication: without it, anybody
  // who intercepts the code can spend it.
  await anAdministration(page)

  const client = await register(page.request)
  const { challenge } = pkce()
  const origin = new URL(page.url()).origin

  await page.goto(`/oauth/authorize?${authorizeQuery(client.client_id, challenge, origin)}`)
  await page.route(`${REDIRECT}*`, (route) => route.fulfill({ status: 200, body: 'ok' }))
  await page.getByRole('button', { name: 'Toegang geven' }).click()
  await page.waitForURL(/127\.0\.0\.1:9876/)

  const code = new URL(page.url()).searchParams.get('code')
  const response = await page.request.post('/oauth/token', {
    form: {
      grant_type: 'authorization_code',
      code: code!,
      client_id: client.client_id,
      redirect_uri: REDIRECT,
      // Somebody else's verifier.
      code_verifier: randomBytes(48).toString('base64url'),
    },
  })

  expect(response.status()).toBe(400)
  expect(((await response.json()) as { error: string }).error).toBe('invalid_grant')
})

test('an unregistered redirect URI is never redirected to', async ({ page }) => {
  /**
   * The open redirect. If an error for an unknown client were bounced to
   * whatever `redirect_uri` the request carried, anybody could send a browser
   * anywhere by inventing a client id — and once a real code is involved, to
   * their own server.
   *
   * No sign-in first, deliberately: this has to hold for a visitor with no
   * session at all, which is who would be attacked.
   */
  const evil = 'http://127.0.0.1:9876/stolen'
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: 'klopt_c_does_not_exist',
    redirect_uri: evil,
    code_challenge: 'x'.repeat(43),
    code_challenge_method: 'S256',
  }).toString()

  const response = await page.goto(`/oauth/authorize?${query}`)

  expect(response?.status()).toBe(200)
  expect(page.url()).not.toContain('127.0.0.1:9876')
  await expect(page.getByText('Deze aanvraag klopt niet')).toBeVisible()
})
