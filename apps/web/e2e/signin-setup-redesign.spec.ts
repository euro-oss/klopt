import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { closeDatabase, createDatabase, LegalAcceptancesRepository, runMigrations } from '@klopt/db'
import { findUserIdByEmail } from '@klopt/db/testing'
import { chooseOption, codeFor, DATABASE_URL, signIn, signOut, uniqueEmail } from './support'

/**
 * SignIn + Setup redesign (#138 / #140 board) — desktop light 1440.
 *
 * Covers reaching both screens, empty and filled states, legal checkbox
 * hidden when env is unset and shown+required when set, keyboard-only flow,
 * no console errors, acceptance recording, and the invitee one-time privacy
 * notice (first sign-in only + `privacy_notice` row).
 */

const PR = process.env['PR_SCREENSHOT_NUMBER'] ?? '138'
const OUT = join(import.meta.dirname, '..', '..', '..', 'docs', 'pr-screenshots', PR)
const CAPTURE = process.env['CAPTURE_PR_SCREENSHOTS'] === '1'

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  if (CAPTURE) mkdirSync(OUT, { recursive: true })
})

async function withHostedLegal(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      name: 'klopt-e2e-legal',
      value: 'on',
      url: 'http://localhost:3399',
    },
  ])
}

async function withoutHostedLegal(page: Page): Promise<void> {
  await page.context().clearCookies()
}

function trackConsole(page: Page): { errors: string[]; detach: () => void } {
  const errors: string[] = []
  const onConsole = (message: ConsoleMessage) => {
    if (message.type() === 'error') errors.push(message.text())
  }
  const onPageError = (error: Error) => {
    errors.push(error.message)
  }
  page.on('console', onConsole)
  page.on('pageerror', onPageError)
  return {
    errors,
    detach: () => {
      page.off('console', onConsole)
      page.off('pageerror', onPageError)
    },
  }
}

async function shot(page: Page, name: string): Promise<void> {
  if (!CAPTURE) return
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.screenshot({ path: join(OUT, `${name}-light-desktop-1440.png`), fullPage: true })
}

test('SignIn and Setup redesign: empty/filled, legal env, keyboard, no console errors', async ({
  page,
}) => {
  const consoleProbe = trackConsole(page)

  // --- Self-hosted (env unset): legal chrome hidden ---
  await withoutHostedLegal(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/sign-in')

  await expect(page.getByRole('heading', { name: 'Aanmelden' })).toBeVisible()
  await expect(
    page.getByRole('heading', {
      name: /Boekhouden die optelt|Bookkeeping that adds up|Boekhouden dat optelt/,
    }),
  ).toBeVisible()
  await expect(page.getByRole('link', { name: /privacyverklaring|privacy notice/i })).toHaveCount(0)
  await expect(page.getByRole('checkbox')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Stuur me een code' })).toBeEnabled()
  await shot(page, '01-sign-in-empty')

  // Filled email state — unique address so a prior run's books do not divert us.
  const selfHostedEmail = uniqueEmail()
  await page.getByLabel('E-mail').fill(selfHostedEmail)
  await shot(page, '01-sign-in-filled')

  // Keyboard-only: Tab to submit, Enter to send code
  await page.getByLabel('E-mail').focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('Code')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Check je e-mail' })).toBeVisible()

  const code = await codeFor(selfHostedEmail)
  await page.getByLabel('Code').fill(code)
  await shot(page, '02-sign-in-code-filled')
  await expect(page.getByRole('button', { name: 'Aanmelden' })).toBeEnabled()
  await page.getByRole('button', { name: 'Aanmelden' }).click()

  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await expect(page).toHaveURL(/\/setup$/)
  await expect(page.getByRole('heading', { name: 'Zet je administratie op' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Opzetten' })).toBeVisible()
  await expect(page.getByRole('checkbox')).toHaveCount(0)
  await expect(page.getByRole('link', { name: /privacyverklaring|privacy notice/i })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Uitloggen' })).toBeVisible()
  await shot(page, '03-setup-empty')

  await page.getByLabel('Naam', { exact: true }).fill('Eva BV')
  await page.getByLabel(/KvK-nummer/).fill('12345678')
  await shot(page, '03-setup-filled')

  await expect(page.getByRole('button', { name: 'Administratie aanmaken' })).toBeEnabled()
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()

  // No acceptance row when legal env was unset
  const database = createDatabase({ url: DATABASE_URL, maxConnections: 2 })
  try {
    const userId = await findUserIdByEmail(database, selfHostedEmail)
    expect(userId).not.toBeNull()
    const rows = await new LegalAcceptancesRepository(database).listForUser(userId!)
    expect(rows).toEqual([])
  } finally {
    await closeDatabase(database)
  }

  // --- Hosted (cookie forces fixture URLs): checkbox shown and required ---
  await page.context().clearCookies()
  await withHostedLegal(page)

  const email = uniqueEmail()
  await page.goto('/sign-in')
  await expect(page.getByRole('link', { name: 'privacyverklaring' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'privacyverklaring' })).toHaveAttribute(
    'href',
    'https://example.test/privacy',
  )

  await expect(page.getByRole('button', { name: 'Stuur me een code' })).toBeEnabled()
  await signIn(page, email)
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()

  await expect(page.getByRole('checkbox')).toBeVisible()
  await expect(page.getByRole('checkbox')).not.toBeChecked()
  await expect(page.getByRole('link', { name: 'voorwaarden' })).toHaveAttribute(
    'href',
    'https://example.test/terms',
  )
  await expect(page.getByRole('link', { name: 'verwerkersovereenkomst' })).toHaveAttribute(
    'href',
    'https://example.test/dpa',
  )
  await expect(page.getByRole('link', { name: 'privacyverklaring' })).toBeVisible()
  await shot(page, '04-setup-legal-unticked')

  await page.getByLabel('Naam', { exact: true }).fill('Eva Hosted BV')
  const create = page.getByRole('button', { name: 'Administratie aanmaken' })
  await expect(create).toBeDisabled()

  // Keyboard: focus checkbox, Space to tick, then submit
  await page.getByRole('checkbox').focus()
  await page.keyboard.press('Space')
  await expect(page.getByRole('checkbox')).toBeChecked()
  await expect(create).toBeEnabled()
  await shot(page, '04-setup-legal-ticked')

  await create.click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()

  const database2 = createDatabase({ url: DATABASE_URL, maxConnections: 2 })
  try {
    const userId = await findUserIdByEmail(database2, email)
    expect(userId).not.toBeNull()
    const rows = await new LegalAcceptancesRepository(database2).listForUser(userId!)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind).toBe('terms_dpa')
    expect(rows[0]?.termsVersion).toBe('2026-11-02-e2e')
    expect(rows[0]?.dpaVersion).toBe('2026-11-02-dpa-e2e')
    expect(rows[0]?.privacyVersion).toBeNull()
    expect(rows[0]?.userId).toBe(userId)
    expect(rows[0]?.recordedAt).toBeInstanceOf(Date)
  } finally {
    await closeDatabase(database2)
  }

  consoleProbe.detach()
  expect(consoleProbe.errors, `console errors: ${consoleProbe.errors.join('\n')}`).toEqual([])
})

test('invitee privacy notice: shown on first sign-in only, and recorded', async ({ browser }) => {
  const owner = await browser.newContext()
  const invitee = await browser.newContext()
  const database = createDatabase({ url: DATABASE_URL, maxConnections: 2 })

  try {
    const ownerPage = await owner.newPage()
    await ownerPage.goto('/sign-in')
    await expect(ownerPage.getByRole('button', { name: 'Stuur me een code' })).toBeEnabled()
    await signIn(ownerPage, uniqueEmail())
    await expect(ownerPage.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()
    await ownerPage.getByRole('link', { name: 'Administratie opzetten' }).click()
    await ownerPage.getByLabel('Naam', { exact: true }).fill('Privacy Invitee BV')
    await expect(ownerPage.getByRole('button', { name: 'Administratie aanmaken' })).toBeEnabled()
    await ownerPage.getByRole('button', { name: 'Administratie aanmaken' }).click()
    await expect(
      ownerPage.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
    ).toBeVisible()

    const inviteeEmail = uniqueEmail()
    await ownerPage.goto('/members')
    const invite = ownerPage.locator('form', {
      has: ownerPage.getByRole('button', { name: 'Uitnodigen' }),
    })
    await invite.getByLabel('E-mail').fill(inviteeEmail)
    await chooseOption(ownerPage, 'Rol', 'Accountant', invite)
    await ownerPage.getByRole('button', { name: 'Uitnodigen' }).click()
    await expect(ownerPage.getByRole('cell', { name: inviteeEmail })).toBeVisible()

    // First sign-in with hosted privacy fixture: interstitial once, then record.
    const inviteePage = await invitee.newPage()
    await withHostedLegal(inviteePage)
    await inviteePage.goto('/sign-in')
    await expect(inviteePage.getByRole('button', { name: 'Stuur me een code' })).toBeEnabled()
    await signIn(inviteePage, inviteeEmail)

    await expect(inviteePage.getByRole('heading', { name: 'Privacyverklaring' })).toBeVisible()
    await expect(
      inviteePage.getByText(/Lees onze privacyverklaring voordat je verdergaat/),
    ).toBeVisible()
    await expect(inviteePage.getByRole('link', { name: 'privacyverklaring' })).toHaveAttribute(
      'href',
      'https://example.test/privacy',
    )
    await expect(inviteePage.getByRole('checkbox')).toHaveCount(0)
    await shot(inviteePage, '05-invitee-privacy-first')

    const beforeAck = new Date()
    await expect(inviteePage.getByRole('button', { name: 'Doorgaan' })).toBeEnabled()
    await inviteePage.getByRole('button', { name: 'Doorgaan' }).click()
    await expect(
      inviteePage.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
    ).toBeVisible()

    const userId = await findUserIdByEmail(database, inviteeEmail)
    expect(userId).not.toBeNull()
    const repository = new LegalAcceptancesRepository(database)
    const privacyRows = await repository.listPrivacyForUser(userId!)
    expect(privacyRows).toHaveLength(1)
    expect(privacyRows[0]?.kind).toBe('privacy_notice')
    expect(privacyRows[0]?.userId).toBe(userId)
    expect(privacyRows[0]?.privacyVersion).toBe('2026-11-02-privacy-e2e')
    expect(privacyRows[0]?.termsVersion).toBeNull()
    expect(privacyRows[0]?.dpaVersion).toBeNull()
    expect(privacyRows[0]?.recordedAt.getTime()).toBeGreaterThanOrEqual(beforeAck.getTime() - 1000)

    // Second sign-in: no interstitial, still a single privacy_notice row.
    await signOut(inviteePage)
    await expect(inviteePage.getByLabel('E-mail')).toBeVisible()
    await withHostedLegal(inviteePage)
    await expect(inviteePage.getByRole('button', { name: 'Stuur me een code' })).toBeEnabled()
    await signIn(inviteePage, inviteeEmail)
    await expect(inviteePage.getByRole('heading', { name: 'Privacyverklaring' })).toHaveCount(0)
    await expect(
      inviteePage.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
    ).toBeVisible()
    expect(await repository.listPrivacyForUser(userId!)).toHaveLength(1)
  } finally {
    await owner.close()
    await invitee.close()
    await closeDatabase(database)
  }
})
