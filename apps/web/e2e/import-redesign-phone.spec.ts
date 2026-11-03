import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, signIn, uniqueEmail } from './support'
import {
  startNullRateMoneybirdStandIn,
  startPreValidFromMoneybirdStandIn,
  type MoneybirdStandIn,
} from './support/moneybird-stand-in'

/**
 * Import wizard phone layout (#134 / #180 QA blocker 7): 390 light/dark past Source.
 */

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

async function anAdministration(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam', { exact: true }).fill('Import Phone BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
}

async function ensureDisconnected(page: Page): Promise<void> {
  const disconnect = page.getByRole('button', { name: 'Verbinding verbreken' })
  if ((await disconnect.count()) === 0) return
  await disconnect.click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Verbinding verbreken' }).click()
  await expect(page.getByLabel('Persoonlijk API-token')).toBeVisible({ timeout: 30_000 })
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate((value) => {
    document.documentElement.classList.toggle('dark', value === 'dark')
  }, theme)
}

async function assertNoOverflow(page: Page, label: string): Promise<void> {
  const fits = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )
  expect(fits, label).toBe(true)
}

async function assertVisibleStepOf(page: Page, pattern: RegExp): Promise<void> {
  await expect(
    page.getByRole('paragraph').filter({ hasText: pattern }).filter({ visible: true }),
  ).toBeVisible()
}

async function assertTokenAboveFooter(page: Page): Promise<void> {
  const token = page.getByLabel('Persoonlijk API-token')
  const footer = page.locator('button[data-focus="next"]')
  await expect(token).toBeVisible()
  await expect(footer).toBeVisible()
  const tokenBox = await token.boundingBox()
  const footerBox = await footer.boundingBox()
  expect(tokenBox).not.toBeNull()
  expect(footerBox).not.toBeNull()
  if (tokenBox !== null && footerBox !== null) {
    expect(tokenBox.y + tokenBox.height).toBeLessThanOrEqual(footerBox.y + 2)
  }
}

/** Dutch document count: singular “document”, plural “documenten” (QA blocker 7). */
function assertDocumentCountCopy(text: string, count: number): void {
  if (count === 1) {
    expect(text).toMatch(/1 document(?![en])/)
    expect(text).not.toMatch(/1 documenten/)
  } else {
    expect(text).toMatch(new RegExp(`${String(count)} documenten`))
  }
}

async function clickNext(page: Page): Promise<void> {
  const next = page.locator('button[data-focus="next"]')
  await expect
    .poll(async () => (await next.getAttribute('aria-disabled')) !== 'true', { timeout: 60_000 })
    .toBe(true)
  await next.click()
}

async function pickMoneybirdOnBron(page: Page): Promise<void> {
  await page.goto('/importeren')
  const restart = page.getByRole('button', { name: 'Opnieuw beginnen' })
  if ((await restart.count()) > 0) {
    await restart.first().click()
    const dialog = page.getByRole('alertdialog', { name: /Je voortgang wissen/ })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Opnieuw beginnen' }).click()
    await expect(page.getByRole('heading', { name: /Waar komen je boeken vandaan/ })).toBeVisible()
  }
  const moneybird = page.getByRole('radio', { name: /Moneybird/ })
  await expect(moneybird).toBeEnabled({ timeout: 15_000 })
  await moneybird.click()
  await clickNext(page)
  await expect(page.getByRole('heading', { name: /Verbind met Moneybird/ })).toBeVisible()
}

async function fillVerbindenStandIn(page: Page, standIn: MoneybirdStandIn): Promise<void> {
  await ensureDisconnected(page)
  await page.getByLabel('Persoonlijk API-token').fill(standIn.token)
  const baseUrl = page.getByLabel('API-adres')
  if (!(await baseUrl.isVisible())) {
    await page
      .locator('details')
      .filter({ hasText: /Geavanceerd|Boekhouddetails/ })
      .locator('summary')
      .click()
  }
  await baseUrl.fill(standIn.baseUrl)
}

async function connectStandIn(page: Page, standIn: MoneybirdStandIn): Promise<void> {
  await pickMoneybirdOnBron(page)
  await fillVerbindenStandIn(page, standIn)
  await clickNext(page)
  await expect(
    page.getByRole('heading', { name: /Welke administratie en welke jaren/ }),
  ).toBeVisible({ timeout: 30_000 })
}

async function advanceToOverzicht(page: Page, yearLabel = '2026'): Promise<void> {
  await page.getByRole('button', { name: 'Administraties ophalen' }).click()
  await expect(page.getByText('Voorbeeld BV')).toBeVisible({ timeout: 30_000 })
  await page.getByText('Voorbeeld BV').click()
  await expect(page.getByRole('checkbox', { name: yearLabel })).toBeVisible({ timeout: 60_000 })
  await clickNext(page)
  await expect(page.getByRole('heading', { name: /Wat we gaan overzetten/ })).toBeVisible({
    timeout: 30_000,
  })
  await clickNext(page)
  await expect(page.getByRole('heading', { name: /Welke btw-code/ })).toBeVisible()
  await mapAllOpenRates(page)
  await clickNext(page)
  await expect(page.getByRole('heading', { name: /Waar komen je rekeningen/ })).toBeVisible({
    timeout: 30_000,
  })
  await mapAccountsIfNeeded(page)
  await clickNext(page)
  await expect(
    page.getByRole('heading', { name: /Wat we nog moeten oplossen|Niets houdt/ }),
  ).toBeVisible({ timeout: 30_000 })
  await clickNext(page)
  await expect(page.getByRole('heading', { name: /Klaar om over te zetten/ })).toBeVisible()
}

async function mapAllOpenRates(page: Page): Promise<void> {
  for (let i = 0; i < 16; i += 1) {
    const confirm = page.getByRole('button', { name: 'Bevestigen' })
    if ((await confirm.count()) === 0) break
    const before = await confirm.count()
    await confirm.first().click()
    await expect(confirm).toHaveCount(before - 1, { timeout: 30_000 })
  }
  for (let i = 0; i < 16; i += 1) {
    const choose = page.getByRole('button', { name: 'Btw-code kiezen' })
    if ((await choose.count()) > 0) {
      await choose.first().click()
      const sheet = page.getByRole('dialog')
      await expect(sheet).toBeVisible()
      await sheet.getByRole('radio').first().click()
      const save = sheet.getByRole('button', { name: 'Opslaan' })
      await expect(save).toBeEnabled({ timeout: 15_000 })
      await save.click()
      await expect(sheet).toHaveCount(0, { timeout: 60_000 })
      continue
    }
    const exclude = page.getByRole('button', { name: /niet overzetten/i })
    if ((await exclude.count()) > 0) {
      const before = await exclude.count()
      await exclude.first().click()
      await expect(exclude).toHaveCount(before - 1, { timeout: 30_000 })
      continue
    }
    break
  }
}

async function mapAccountsIfNeeded(page: Page): Promise<void> {
  for (let i = 0; i < 12; i += 1) {
    const confirm = page.getByRole('button', { name: 'Bevestigen' })
    if ((await confirm.count()) === 0) break
    const before = await confirm.count()
    await confirm.first().click()
    await expect(confirm).toHaveCount(before - 1, { timeout: 30_000 })
  }
}

test('390 connect and VAT steps do not overflow in light and dark', async ({ page }) => {
  test.setTimeout(240_000)
  const standIn = await startPreValidFromMoneybirdStandIn()
  try {
    await anAdministration(page)
    await page.setViewportSize({ width: 390, height: 844 })
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme)
      await pickMoneybirdOnBron(page)
      await assertVisibleStepOf(page, /Stap 2 van 6:\s*Verbinden/)
      await fillVerbindenStandIn(page, standIn)
      await assertNoOverflow(page, `${theme} connect`)
      await assertTokenAboveFooter(page)

      await clickNext(page)
      await page.getByRole('button', { name: 'Administraties ophalen' }).click()
      await expect(page.getByText('Voorbeeld BV')).toBeVisible({ timeout: 30_000 })
      await page.getByText('Voorbeeld BV').click()
      await expect(page.getByRole('checkbox', { name: '2025' })).toBeVisible({ timeout: 60_000 })
      await clickNext(page)
      await clickNext(page)
      await expect(page.getByRole('heading', { name: /Welke btw-code/ })).toBeVisible()
      await assertVisibleStepOf(page, /Stap 5 van 6:\s*Problemen/)
      await mapAllOpenRates(page)
      await assertNoOverflow(page, `${theme} btw`)
    }
  } finally {
    await standIn.close()
  }
})

test('390 problems step: overflow, step-of, and document singular in light and dark', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const standIn = await startPreValidFromMoneybirdStandIn()
  try {
    await anAdministration(page)
    await page.setViewportSize({ width: 390, height: 844 })
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme)
      await connectStandIn(page, standIn)
      await page.getByRole('button', { name: 'Administraties ophalen' }).click()
      await expect(page.getByText('Voorbeeld BV')).toBeVisible({ timeout: 30_000 })
      await page.getByText('Voorbeeld BV').click()
      await expect(page.getByRole('checkbox', { name: '2025' })).toBeVisible({ timeout: 60_000 })
      await clickNext(page)
      await clickNext(page)
      await mapAllOpenRates(page)
      await clickNext(page)
      await mapAccountsIfNeeded(page)
      await clickNext(page)
      await expect(page.getByText(/geldt nog niet/i).first()).toBeVisible({ timeout: 30_000 })
      await assertVisibleStepOf(page, /Stap 5 van 6:\s*Problemen/)
      await assertNoOverflow(page, `${theme} problems`)
      const finding = page.getByText(/1 document[^e]/).first()
      await expect(finding).toBeVisible()
      assertDocumentCountCopy(await finding.innerText(), 1)
    }
  } finally {
    await standIn.close()
  }
})

test('390 running import does not overflow in light and dark', async ({ page }) => {
  test.setTimeout(180_000)
  const standIn = await startNullRateMoneybirdStandIn()
  try {
    await anAdministration(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await connectStandIn(page, standIn)
    await advanceToOverzicht(page)
    await clickNext(page)
    const confirmDialog = page.getByRole('alertdialog')
    await expect(confirmDialog).toBeVisible()
    const title = await confirmDialog.getByRole('heading').innerText()
    const countMatch = title.match(/(\d+)\s+document(en)?\s+importeren/)
    expect(countMatch).not.toBeNull()
    assertDocumentCountCopy(title, Number(countMatch![1]!))
    await confirmDialog.getByRole('button', { name: /Overzetten bevestigen/i }).click()
    await expect(page.getByRole('heading', { name: /Bezig met overzetten/ })).toBeVisible({
      timeout: 60_000,
    })
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme)
      await assertVisibleStepOf(page, /Stap 6 van 6:\s*Importeren/)
      await assertNoOverflow(page, `${theme} running`)
      await expect(page.getByRole('button', { name: 'Opnieuw proberen' })).toHaveCount(0)
    }
  } finally {
    await standIn.close()
  }
})

test('390 stopped import with nothing booked shows one Opnieuw proberen in light and dark', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const standIn = await startNullRateMoneybirdStandIn()
  try {
    await anAdministration(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await connectStandIn(page, standIn)
    await advanceToOverzicht(page)
    await clickNext(page)
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: /Overzetten bevestigen/i })
      .click()
    await expect(page.getByRole('heading', { name: /Bezig met overzetten/ })).toBeVisible({
      timeout: 60_000,
    })

    process.env['KLOPT_ENCRYPTION_KEY'] = 'e2e-encryption-key-not-for-production-01234'
    const { importMoneybirdAdministration } = await import('../../worker/src/moneybird.js')
    const { createFilesystemDocumentStore } = await import('@klopt/adapters')
    const { createDatabase, closeDatabase } = await import('@klopt/db')
    const directory = mkdtempSync(join(tmpdir(), 'mb-phone-stopped-'))
    const db = createDatabase({ url: DATABASE_URL, maxConnections: 2 })
    const rejectingFetch: typeof globalThis.fetch = () =>
      Promise.reject(new Error('forced pre-commit network failure'))
    try {
      const store = createFilesystemDocumentStore({ directory })
      for (let i = 0; i < 8; i += 1) {
        const result = await importMoneybirdAdministration(db, store, rejectingFetch)
        if (result.state === 'idle') break
      }
    } finally {
      await closeDatabase(db)
    }

    await expect(page.getByText(/We hebben niets geboekt/i)).toBeVisible({ timeout: 120_000 })
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme)
      await expect(page.getByRole('button', { name: 'Opnieuw proberen' })).toHaveCount(1)
      await assertNoOverflow(page, `${theme} stopped-nothing`)
    }
  } finally {
    await standIn.close()
  }
})

test('390 stopped partway shows booked plural and one retry path in light and dark', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const standIn = await startNullRateMoneybirdStandIn()
  try {
    await anAdministration(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await connectStandIn(page, standIn)
    await advanceToOverzicht(page)
    await clickNext(page)
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: /Overzetten bevestigen/i })
      .click()
    await expect(page.getByRole('heading', { name: /Bezig met overzetten/ })).toBeVisible({
      timeout: 60_000,
    })

    process.env['KLOPT_ENCRYPTION_KEY'] = 'e2e-encryption-key-not-for-production-01234'
    const { importMoneybirdAdministration } = await import('../../worker/src/moneybird.js')
    const { createFilesystemDocumentStore } = await import('@klopt/adapters')
    const { createDatabase, closeDatabase, MoneybirdImportRepository } = await import('@klopt/db')
    const directory = mkdtempSync(join(tmpdir(), 'mb-phone-partial-'))
    const db = createDatabase({ url: DATABASE_URL, maxConnections: 2 })
    // eslint-disable-next-line @typescript-eslint/unbound-method -- prototype stub
    const originalFinish = MoneybirdImportRepository.prototype.finish
    let blockedRunning = false
    MoneybirdImportRepository.prototype.finish = async function finishOverride(
      this: InstanceType<typeof MoneybirdImportRepository>,
      request: Parameters<typeof originalFinish>[0],
    ) {
      if (!blockedRunning && request.state === 'running') {
        blockedRunning = true
        throw new Error('report save failed after commit')
      }
      return originalFinish.call(this, request)
    }
    try {
      const store = createFilesystemDocumentStore({ directory })
      for (let i = 0; i < 8; i += 1) {
        const result = await importMoneybirdAdministration(db, store)
        if (result.state === 'idle') break
      }
    } finally {
      MoneybirdImportRepository.prototype.finish = originalFinish
      await closeDatabase(db)
    }

    await expect(page.getByText(/staan al in Klopt/i)).toBeVisible({ timeout: 120_000 })
    const bookedLine = page.getByText(/document staat al in Klopt|documenten staan al in Klopt/)
    await expect(bookedLine.first()).toBeVisible()
    const bookedText = await bookedLine.first().innerText()
    const bookedCountMatch = bookedText.match(/(\d+)/)
    expect(bookedCountMatch).not.toBeNull()
    assertDocumentCountCopy(bookedText, Number(bookedCountMatch![1]!))
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme)
      await expect(page.getByRole('button', { name: 'De rest overzetten' })).toHaveCount(1)
      await expect(page.getByRole('button', { name: 'Opnieuw proberen' })).toHaveCount(0)
      await assertNoOverflow(page, `${theme} stopped-partial`)
    }
  } finally {
    await standIn.close()
  }
})
