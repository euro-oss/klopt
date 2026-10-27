import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, signIn, uniqueEmail } from './support'
import {
  startNullRateMoneybirdStandIn,
  startPreValidFromMoneybirdStandIn,
  type MoneybirdStandIn,
} from './support/moneybird-stand-in'

/**
 * Import wizard Phase 1 — Moneybird happy path, year selection, #99 dead end
 * (issue #100).
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

async function anAdministration(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()

  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill('Wizard BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
}

/** Reach Administratie en jaren with a stand-in Moneybird connection. */
async function connectStandIn(page: Page, standIn: MoneybirdStandIn): Promise<void> {
  await page.goto('/importeren')
  await expect(page.getByRole('heading', { name: /Waar komen je boeken vandaan/ })).toBeVisible()
  const moneybird = page.getByRole('radio', { name: /Moneybird/ })
  await expect(moneybird).toBeEnabled({ timeout: 15_000 })
  await moneybird.click()
  await expect(moneybird).toBeChecked()
  await clickNext(page)
  await expect(page.getByRole('heading', { name: /Verbind met Moneybird/ })).toBeVisible()

  await page.locator('details').filter({ hasText: 'Geavanceerd' }).locator('summary').click()
  await page.getByLabel('API-adres').fill(standIn.baseUrl)
  await page.getByLabel('Persoonlijk API-token').fill(standIn.token)
  await clickNext(page)
  await expect(
    page.getByRole('heading', { name: /Welke administratie en welke jaren/ }),
  ).toBeVisible({ timeout: 30_000 })
}

async function pickAdminAndWaitForYears(page: Page, yearLabel: string): Promise<void> {
  await page.getByRole('button', { name: 'Administraties ophalen' }).click()
  await expect(page.getByText('Voorbeeld BV')).toBeVisible({ timeout: 30_000 })
  await page.getByText('Voorbeeld BV').click()
  await expect(page.getByRole('checkbox', { name: yearLabel })).toBeVisible({
    timeout: 60_000,
  })
}

/** Map every unresolved rate via confirm / AccountVatSheet / exclude. */
async function mapAllOpenRates(page: Page): Promise<void> {
  // Confirm suggestions first — clicks queue on the client; wait for the row to leave.
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
      const radio = sheet.getByRole('radio').first()
      await expect(radio).toBeVisible()
      await radio.click()
      const save = sheet.getByRole('button', { name: 'Opslaan' })
      await expect(save).toBeEnabled({ timeout: 15_000 })
      await save.click()
      // onSave awaits the full persist queue + preview before closing.
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
  await expect(page.getByRole('button', { name: 'Btw-code kiezen' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Bevestigen' })).toHaveCount(0)
}

/** Volgende uses aria-disabled instead of the native disabled attribute. */
async function clickNext(page: Page): Promise<void> {
  const next = page.locator('button[data-focus="next"]')
  await expect
    .poll(async () => {
      const aria = await next.getAttribute('aria-disabled')
      return aria !== 'true' && aria !== ''
    }, { timeout: 60_000 })
    .toBe(true)
  await next.click()
}

test('i m opens the import wizard under Importeren', async ({ page }) => {
  await anAdministration(page)

  await expect(
    page
      .getByRole('link', { name: /^Dashboard/ })
      .locator('kbd')
      .first(),
  ).toBeVisible()
  await expect(
    page.getByRole('navigation').getByRole('link', { name: /^Moneybird(?! \(oud\))/ }),
  ).toBeVisible()

  await page.keyboard.press('i')
  await expect(page.getByText('I …')).toBeVisible()
  await page.keyboard.press('m')

  await expect(page.getByRole('heading', { name: /Waar komen je boeken vandaan/ })).toBeVisible()
})

test('Moneybird wizard happy path reaches Administratie with years (#100)', async ({ page }) => {
  test.setTimeout(120_000)
  const standIn = await startNullRateMoneybirdStandIn()
  try {
    await anAdministration(page)
    await connectStandIn(page, standIn)
    await pickAdminAndWaitForYears(page, '2026')
    await expect(page.getByRole('checkbox', { name: '2026' })).toBeChecked()
  } finally {
    await standIn.close()
  }
})

test('unchecking a year leaves it out of the selection (#100 open question 1)', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const standIn = await startNullRateMoneybirdStandIn()
  try {
    await anAdministration(page)
    await connectStandIn(page, standIn)
    await pickAdminAndWaitForYears(page, '2026')
    const year2026 = page.getByRole('checkbox', { name: '2026' })
    await year2026.uncheck()
    await expect(year2026).not.toBeChecked()
  } finally {
    await standIn.close()
  }
})

test('#99 tax_code_not_in_force shows an honest dead end with a way forward', async ({ page }) => {
  test.setTimeout(180_000)
  const standIn = await startPreValidFromMoneybirdStandIn()
  try {
    await anAdministration(page)
    await connectStandIn(page, standIn)
    await pickAdminAndWaitForYears(page, '2025')

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
    await clickNext(page)
    await expect(page.getByRole('heading', { name: /Wat we nog moeten oplossen/ })).toBeVisible({
      timeout: 30_000,
    })

    await expect(page.getByText(/geldt nog niet/i).first()).toBeVisible()
    await expect(page.getByText(/Klopt kan dit nog niet oplossen/i).first()).toBeVisible()
    await expect(page.getByText(/Waarom dit telt/i).first()).toBeVisible()
    await expect(
      page.getByRole('button', { name: /Naar Administratie en jaren/i }).first(),
    ).toBeVisible()
    await expect(page.getByText(/alles klopt/i)).toHaveCount(0)
    await expect(page.getByText(/Geen blokkerende problemen/i)).toHaveCount(0)
  } finally {
    await standIn.close()
  }
})
