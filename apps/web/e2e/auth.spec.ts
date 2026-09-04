import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { addMember, closeDatabase, createDatabase, runMigrations } from '@klopt/db'
import { findUserIdByEmail, seedEntity } from '@klopt/db/testing'

/**
 * The signed-out journey, in a real browser.
 *
 * These exist because of a specific bug: the root layout returned the
 * signed-out placeholder *instead of* rendering its children, so every route
 * looked identical while signed out — including the sign-in page. Clicking
 * "Aanmelden" changed the URL and nothing else. Server-side render assertions
 * missed it completely, because the HTML for `/sign-in` was valid HTML for a
 * different page.
 *
 * So the rule for what belongs here: **anything whose failure mode is "the
 * screen did not change"**. Navigation, redirects, the two-step sign-in.
 * Business rules are tested against the domain, not through a browser.
 */

const DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

/** Where the file email transport drops messages. See playwright.config.ts. */
const OUTBOX = join(import.meta.dirname, '.outbox')

function uniqueEmail(): string {
  return `e2e-${Date.now().toString()}-${Math.random().toString(36).slice(2, 8)}@example.test`
}

/**
 * Read the code out of the delivered message.
 *
 * Not out of the database: the codes are hashed there deliberately, so that a
 * dump contains nothing usable. The transport is the only honest place to
 * observe one, which is also true of a real mailbox.
 */
async function codeFor(email: string): Promise<string> {
  const deadline = Date.now() + 10_000

  while (Date.now() < deadline) {
    // The directory may not exist yet: nothing has been delivered.
    const files = existsSync(OUTBOX)
      ? readdirSync(OUTBOX).filter((name) => name.endsWith('.txt'))
      : []

    for (const name of files.sort().reverse()) {
      const message = readFileSync(join(OUTBOX, name), 'utf8')
      if (!message.includes(`To: ${email}`)) continue
      const match = /^\s{4}(\d{6})\s*$/m.exec(message)
      if (match?.[1] !== undefined) return match[1]
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  throw new Error(`No sign-in code was delivered to ${email}.`)
}

/** Take a brand-new address all the way to a signed-in session. */
async function signIn(page: Page, email: string): Promise<void> {
  await page.getByLabel('E-mail').fill(email)
  await page.getByRole('button', { name: 'Stuur me een code' }).click()

  await expect(page.getByLabel('Code')).toBeVisible()
  await page.getByLabel('Code').fill(await codeFor(email))
  await page.getByRole('button', { name: 'Aanmelden' }).click()
}

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  rmSync(OUTBOX, { recursive: true, force: true })
})

test('a visitor is sent to the sign-in page, and it asks for an email', async ({ page }) => {
  await page.goto('/')

  await expect(page).toHaveURL(/\/sign-in/)
  // The regression: this used to be the root layout's signed-out placeholder,
  // rendered identically on every route.
  await expect(page.getByLabel('E-mail')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stuur me een code' })).toBeVisible()
  // And no password anywhere.
  await expect(page.getByLabel('Wachtwoord')).toHaveCount(0)
})

test('asking for a code moves the form to the second step', async ({ page }) => {
  const email = uniqueEmail()
  await page.goto('/sign-in')

  await expect(page.getByLabel('Code')).toHaveCount(0)
  await page.getByLabel('E-mail').fill(email)
  await page.getByRole('button', { name: 'Stuur me een code' }).click()

  await expect(page.getByLabel('Code')).toBeVisible()
  // The address appears twice on this step — in the header and in the notice —
  // so this is deliberately not a strict match.
  await expect(page.getByText(email).first()).toBeVisible()
  // The code really was delivered, not just promised.
  expect(await codeFor(email)).toMatch(/^\d{6}$/)
})

test('a wrong code says so instead of doing nothing', async ({ page }) => {
  const email = uniqueEmail()
  await page.goto('/sign-in')

  await page.getByLabel('E-mail').fill(email)
  await page.getByRole('button', { name: 'Stuur me een code' }).click()
  await expect(page.getByLabel('Code')).toBeVisible()

  await page.getByLabel('Code').fill('000000')
  await page.getByRole('button', { name: 'Aanmelden' }).click()

  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page).toHaveURL(/\/sign-in/)
})

test('a first sign-in with no invitation is a dead end, not an error', async ({ page }) => {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())

  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()
})

test('a deep link survives the round trip through sign-in', async ({ page }) => {
  const email = uniqueEmail()
  const database = createDatabase({ url: DATABASE_URL, maxConnections: 2 })

  try {
    await page.goto('/reports/balance-sheet')
    await expect(page).toHaveURL(/\/sign-in\?redirect=%2Freports%2Fbalance-sheet/)

    await signIn(page, email)
    await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()

    // The order a real invitation would follow: the account exists, then it is
    // granted access.
    const entityId = await seedEntity(database)
    const userId = await findUserIdByEmail(database, email)
    if (userId === null) throw new Error('The sign-in did not create a user.')
    await addMember(database, { entityId, userId, role: 'bookkeeper' })

    await page.goto('/reports/balance-sheet')
    await expect(page.getByRole('heading', { name: 'Balans' })).toBeVisible()
  } finally {
    await closeDatabase(database)
  }
})

test('a member lands on the dashboard, and signing out returns to the form', async ({ page }) => {
  const email = uniqueEmail()
  const database = createDatabase({ url: DATABASE_URL, maxConnections: 2 })

  try {
    await page.goto('/sign-in')
    await signIn(page, email)
    await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()

    const entityId = await seedEntity(database)
    const userId = await findUserIdByEmail(database, email)
    if (userId === null) throw new Error('The sign-in did not create a user.')
    await addMember(database, { entityId, userId, role: 'bookkeeper' })

    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
    await expect(page.getByText('RGS-dekking')).toBeVisible()

    await page.getByRole('button', { name: 'Afmelden' }).click()
    await expect(page).toHaveURL(/\/sign-in/)
    await expect(page.getByLabel('E-mail')).toBeVisible()
  } finally {
    await closeDatabase(database)
  }
})

test('a signed-in visitor is bounced away from the sign-in page', async ({ page }) => {
  const email = uniqueEmail()
  const database = createDatabase({ url: DATABASE_URL, maxConnections: 2 })

  try {
    await page.goto('/sign-in')
    await signIn(page, email)
    await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()

    const entityId = await seedEntity(database)
    const userId = await findUserIdByEmail(database, email)
    if (userId === null) throw new Error('The sign-in did not create a user.')
    await addMember(database, { entityId, userId, role: 'bookkeeper' })

    await page.goto('/sign-in')
    await expect(page).toHaveURL(/localhost:\d+\/$/)
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  } finally {
    await closeDatabase(database)
  }
})
