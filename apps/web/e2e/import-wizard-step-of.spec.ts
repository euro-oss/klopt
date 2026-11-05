import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, hydrated, signIn, uniqueEmail } from './support'
import { startPreValidFromMoneybirdStandIn } from './support/moneybird-stand-in'

/**
 * Import wizard "Stap N van M" follows the six-step rail on Moneybird and XAF
 * (#180 Design review).
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

async function anAdministration(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam', { exact: true }).fill('Step Of BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
  await hydrated(page)
}

async function clickNext(page: Page): Promise<void> {
  const next = page.locator('button[data-focus="next"]')
  await expect
    .poll(
      async () => {
        const disabled = await next.getAttribute('aria-disabled')
        const busy = await next.getAttribute('aria-busy')
        return disabled !== 'true' && busy !== 'true'
      },
      { timeout: 60_000 },
    )
    .toBe(true)
  await next.click()
  await expect
    .poll(async () => (await next.getAttribute('aria-busy')) !== 'true', { timeout: 60_000 })
    .toBe(true)
}

async function expectVisibleStepOf(page: Page, pattern: RegExp): Promise<void> {
  await expect(
    page.getByRole('paragraph').filter({ hasText: pattern }).filter({ visible: true }),
  ).toBeVisible()
}

async function assertBronStepOf(page: Page, width: 390 | 1440): Promise<void> {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1040 })
  await expectVisibleStepOf(page, /Stap 1 van 6:\s*Bron/)
}

async function assertProblemsRailStepOf(page: Page, width: 390 | 1440): Promise<void> {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1040 })
  await expectVisibleStepOf(page, /Stap 5 van 6:\s*Problemen/)
}

test('XAF source step uses rail step-of on desktop and phone', async ({ page }) => {
  await anAdministration(page)
  await page.goto('/importeren')
  const xaf = page.getByRole('radio', { name: /Een ander pakket/ })
  await expect(xaf).toBeEnabled({ timeout: 15_000 })
  await xaf.click()
  await assertBronStepOf(page, 1440)
  await assertBronStepOf(page, 390)
})

async function mapOpenRates(page: Page): Promise<void> {
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

test('Moneybird rail step-of on bron and problems (#180 Design)', async ({ page }) => {
  test.setTimeout(240_000)
  const standIn = await startPreValidFromMoneybirdStandIn()
  try {
    await anAdministration(page)
    await page.goto('/importeren')
    const moneybird = page.getByRole('radio', { name: /Moneybird/ })
    await expect(moneybird).toBeEnabled({ timeout: 15_000 })
    await moneybird.click()
    await assertBronStepOf(page, 1440)
    await assertBronStepOf(page, 390)
    await clickNext(page)
    await page
      .locator('details')
      .filter({ hasText: /Geavanceerd|Boekhouddetails/ })
      .locator('summary')
      .click()
    await page.getByLabel('API-adres').fill(standIn.baseUrl)
    await page.getByLabel('Persoonlijk API-token').fill(standIn.token)
    await clickNext(page)
    await page.getByRole('button', { name: 'Administraties ophalen' }).click()
    await expect(page.getByText('Voorbeeld BV')).toBeVisible({ timeout: 30_000 })
    await page.getByText('Voorbeeld BV').click()
    await expect(page.getByRole('checkbox', { name: '2025' })).toBeVisible({ timeout: 60_000 })
    await clickNext(page)
    await expect(page.getByRole('heading', { name: /Wat we gaan overzetten/ })).toBeVisible({
      timeout: 30_000,
    })
    await clickNext(page)
    await mapOpenRates(page)
    await clickNext(page)
    await clickNext(page)
    await expect(page.getByText(/geldt nog niet/i).first()).toBeVisible({ timeout: 30_000 })
    await assertProblemsRailStepOf(page, 1440)
    await assertProblemsRailStepOf(page, 390)
  } finally {
    await standIn.close()
  }
})
