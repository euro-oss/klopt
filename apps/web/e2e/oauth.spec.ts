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

test('an authorised app can be withdrawn, and its token dies with it', async ({ page }) => {
  /**
   * The other half of granting access. Before this there was no way to see what
   * an administration had authorised, let alone take it back — the tokens
   * screen did not exist, so the only route was SQL.
   *
   * Withdrawing does both halves: the live token stops working now, and the
   * registration goes, so the next attempt needs a human to approve it again
   * rather than quietly getting another token.
   */
  await anAdministration(page)

  const client = await register(page.request)
  const { verifier, challenge } = pkce()
  const origin = new URL(page.url()).origin

  await page.goto(`/oauth/authorize?${authorizeQuery(client.client_id, challenge, origin)}`)
  await page.route(`${REDIRECT}*`, (route) => route.fulfill({ status: 200, body: 'ok' }))
  await page.getByRole('button', { name: 'Toegang geven' }).click()
  await page.waitForURL(/127\.0\.0\.1:9876/)

  const code = new URL(page.url()).searchParams.get('code')
  const granted = await page.request.post('/oauth/token', {
    form: {
      grant_type: 'authorization_code',
      code: code!,
      client_id: client.client_id,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
    },
  })
  const { access_token: accessToken } = (await granted.json()) as { access_token: string }

  // It works.
  const before = await page.request.post('/api/mcp', {
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
  })
  expect(before.status()).toBe(200)

  // Toegang shows it by name, as an app rather than as a token nobody recognises.
  await page.goto('/members')
  await expect(page.getByRole('heading', { name: 'Tokens en gekoppelde apps' })).toBeVisible()
  await expect(page.getByRole('cell', { name: /Claude/ })).toBeVisible()

  // Enabled, not merely present: before hydration the handler is not attached
  // and the click goes nowhere.
  const withdraw = page.getByRole('button', { name: 'App loskoppelen' })
  await expect(withdraw).toBeEnabled()
  await withdraw.click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'App loskoppelen' })).toHaveCount(0)

  // The token is dead.
  const after = await page.request.post('/api/mcp', {
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
  })
  expect(after.status()).toBe(401)
})

test('a hand-issued token appears, works, and can be revoked', async ({ page }) => {
  // What the README has been telling people to do since before the screen
  // existed: "issue a read-only token under Toegang".
  await anAdministration(page)
  await page.goto('/members')

  await expect(page.getByLabel('Naam')).toBeEnabled()
  await page.getByLabel('Naam').fill('mcp-lezen')
  await page.getByRole('button', { name: 'Token maken' }).click()

  const secret = page.locator('code', { hasText: /^klopt_/ })
  await expect(secret).toBeVisible()
  const token = (await secret.textContent())?.trim() ?? ''
  expect(token).not.toBe('')

  const works = await page.request.get('/api/v1/accounts', {
    headers: { authorization: `Bearer ${token}` },
  })
  expect(works.status()).toBe(200)

  await page.getByRole('button', { name: 'Ik heb het bewaard' }).click()
  await page.getByRole('button', { name: 'Intrekken' }).first().click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  // The row has to actually change, or the revoke did not happen.
  await expect(page.getByRole('button', { name: 'Intrekken' })).toHaveCount(0)

  const dead = await page.request.get('/api/v1/accounts', {
    headers: { authorization: `Bearer ${token}` },
  })
  expect(dead.status()).toBe(401)
})

test('MCP will not answer a made-up token, even for tools/list', async ({ page }) => {
  /**
   * `initialize` and `tools/list` make no API call, so before the endpoint
   * checked the bearer itself they were answered for **any non-empty string**.
   * Anybody could enumerate the tools, and a revoked token kept working right
   * up until something asked it for data.
   */
  await anAdministration(page)

  for (const token of ['klopt_not_a_real_token', 'nonsense']) {
    const response = await page.request.post('/api/mcp', {
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    })
    expect(response.status()).toBe(401)
    // And it says where to authenticate, rather than only saying no.
    expect(response.headers()['www-authenticate']).toContain('resource_metadata=')
  }
})

test('an agent drafts an invoice and cannot issue it', async ({ page }) => {
  /**
   * The proposal model, end to end (spec 10.3).
   *
   * A draft sales invoice has no number and no journal entry — the gapless
   * series is allocated at issue, which is the moment the invoice legally
   * exists. So an agent's mistake costs a deletion, not a gap somebody has to
   * explain.
   *
   * The other half is that there is no tool to issue it. That is asserted in
   * the MCP unit tests against the tool list; here what matters is that the
   * draft really landed and really is a draft.
   */
  await anAdministration(page)

  // A contact to invoice, and a token that may write.
  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('DEB-9001')
  await page.getByLabel('Naam', { exact: true }).fill('Agent Klant BV')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('cell', { name: 'Agent Klant BV' })).toBeVisible()

  await page.goto('/members')
  await expect(page.getByLabel('Naam')).toBeEnabled()
  await page.getByLabel('Naam').fill('agent-schrijft')
  // The proposal tools need more than an OAuth grant gives — but not much
  // more, and specifically not the ability to issue.
  await page.getByLabel('Wat het mag').selectOption('draft')
  await page.getByRole('button', { name: 'Token maken' }).click()
  const token = ((await page.locator('code', { hasText: /^klopt_/ }).textContent()) ?? '').trim()

  const call = async (name: string, args: unknown) => {
    const response = await page.request.post('/api/mcp', {
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    })
    const body = (await response.json()) as {
      result: { isError?: boolean; content: { text: string }[] }
    }
    return body.result
  }

  const drafted = await call('draft_sales_invoice', {
    contactNumber: 'DEB-9001',
    issueDate: '2026-09-10',
    lines: [
      {
        description: 'Advieswerk',
        quantity: '1',
        unitPrice: '1000.00',
        revenueAccountNumber: '8000',
        taxCode: 'H21',
      },
    ],
  })

  expect(drafted.isError).not.toBe(true)
  const payload = JSON.parse(drafted.content[0]!.text) as {
    data: { draftId: string; status: string; release: string }
  }
  expect(payload.data.status).toBe('draft')
  expect(payload.data.release).toContain('Not issued')

  // It is really there, and really a draft: no number, no journal entry.
  const listed = await page.request.get('/api/v1/sales-invoices?status=draft', {
    headers: { authorization: `Bearer ${token}` },
  })
  const invoices = (await listed.json()) as {
    invoices: { id: string; number: string | null; status: string }[]
  }
  const mine = invoices.invoices.find((invoice) => invoice.id === payload.data.draftId)
  expect(mine?.status).toBe('draft')
  expect(mine?.number).toBeNull()

  /**
   * And the half that makes it a property rather than a habit: the same token
   * is refused when it tries to release.
   *
   * Drafting and issuing both required `ledger:post` until now, which meant an
   * agent holding a drafting token could skip the MCP tools, call REST
   * directly, and issue the invoice itself. `ledger:draft` is the narrower
   * grant; `ledger:post` still satisfies it, so nothing that could draft
   * before stopped.
   */
  const issued = await page.request.post(`/api/v1/sales-invoices/${payload.data.draftId}/issue`, {
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': crypto.randomUUID() },
    data: {},
  })
  expect(issued.status()).toBe(403)
  expect(await issued.text()).toContain('ledger:post')

  // A human finds it waiting on the screen the answer named, still a draft.
  await page.goto('/invoices')
  await expect(page.getByRole('cell', { name: 'Agent Klant BV' })).toBeVisible()
})
