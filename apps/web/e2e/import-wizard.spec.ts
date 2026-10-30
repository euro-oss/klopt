import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, signIn, uniqueEmail } from './support'
import {
  startNullRateMoneybirdStandIn,
  startPreValidFromMoneybirdStandIn,
  startSelfAssessedVatMoneybirdStandIn,
  startUnreachableMoneybirdStandIn,
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
    .poll(
      async () => {
        const aria = await next.getAttribute('aria-disabled')
        return aria !== 'true' && aria !== ''
      },
      { timeout: 60_000 },
    )
    .toBe(true)
  await next.click()
}

test('i m opens the import wizard under Importeren', async ({ page }) => {
  await anAdministration(page)

  await expect(
    page
      .getByRole('link', { name: /^Home/ })
      .locator('kbd')
      .first(),
  ).toBeVisible()
  // Accessible name includes the printed chord; allow trailing text, never "(oud)".
  await expect(
    page.getByRole('navigation').getByRole('link', { name: /^Moneybird(?! \(oud\))/ }),
  ).toBeVisible()

  await page.keyboard.press('i')
  await expect(page.getByText('I …')).toBeVisible()
  await page.keyboard.press('m')

  await expect(page.getByRole('heading', { name: /Waar komen je boeken vandaan/ })).toBeVisible()
})

test('picking Exact on Bron updates ?bron= and the page title', async ({ page }) => {
  await anAdministration(page)
  await page.goto('/importeren')
  await expect(page.getByRole('heading', { name: /Waar komen je boeken vandaan/ })).toBeVisible()
  const moneybird = page.getByRole('radio', { name: /Moneybird/ })
  await expect(moneybird).toBeEnabled({ timeout: 15_000 })
  await moneybird.click()
  await expect(page).toHaveURL(/bron=moneybird/)
  await expect(page.getByRole('banner').getByText('Moneybird', { exact: true })).toBeVisible()

  await page.getByRole('radio', { name: /Exact Online/ }).click()
  await expect(page).toHaveURL(/bron=exact/)
  await expect(page.getByText(/kan nog niet in deze wizard/i)).toBeVisible()
  await expect(page.getByRole('banner').getByText('Exact Online', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('navigation').getByRole('link', { name: /^Exact Online(?! \(oud\))/ }),
  ).toHaveAttribute('aria-current', 'page')
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

test('a wrong Moneybird token stays on Verbinden with the token error (#105)', async ({ page }) => {
  test.setTimeout(60_000)
  const standIn = await startNullRateMoneybirdStandIn()
  try {
    await anAdministration(page)
    await page.goto('/importeren')
    await expect(page.getByRole('heading', { name: /Waar komen je boeken vandaan/ })).toBeVisible()
    const moneybird = page.getByRole('radio', { name: /Moneybird/ })
    await expect(moneybird).toBeEnabled({ timeout: 15_000 })
    await moneybird.click()
    await clickNext(page)
    await expect(page.getByRole('heading', { name: /Verbind met Moneybird/ })).toBeVisible()

    await page.locator('details').filter({ hasText: 'Geavanceerd' }).locator('summary').click()
    await page.getByLabel('API-adres').fill(standIn.baseUrl)
    await page.getByLabel('Persoonlijk API-token').fill('definitely-wrong-token')
    await clickNext(page)

    const alert = page.getByRole('alert')
    await expect(alert).toContainText(/Moneybird accepteert dit token niet/i)
    // Inline only — not also in the footer reason or a toast (Designer r5).
    await expect(page.locator('#wizard-next-why')).toHaveCount(0)
    await expect(page.locator('[data-slot="wizard-toast"]')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: /Verbind met Moneybird/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: /Welke administratie/ })).toHaveCount(0)
    await expect(page.locator('button[data-focus="next"]')).toHaveAttribute('aria-disabled', 'true')
    await expect(page.getByLabel('Persoonlijk API-token')).toHaveAttribute('aria-invalid', 'true')
  } finally {
    await standIn.close()
  }
})

test('an unreachable Moneybird stays on Verbinden with the generic try-again (#105)', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const standIn = await startUnreachableMoneybirdStandIn()
  try {
    await anAdministration(page)
    await page.goto('/importeren')
    await expect(page.getByRole('heading', { name: /Waar komen je boeken vandaan/ })).toBeVisible()
    const moneybird = page.getByRole('radio', { name: /Moneybird/ })
    await expect(moneybird).toBeEnabled({ timeout: 15_000 })
    await moneybird.click()
    await clickNext(page)
    await expect(page.getByRole('heading', { name: /Verbind met Moneybird/ })).toBeVisible()

    await page.locator('details').filter({ hasText: 'Geavanceerd' }).locator('summary').click()
    await page.getByLabel('API-adres').fill(standIn.baseUrl)
    await page.getByLabel('Persoonlijk API-token').fill(standIn.token)
    await clickNext(page)

    const alert = page.getByRole('alert')
    await expect(alert).toContainText(/We konden Moneybird nu niet bereiken/i)
    await expect(alert).not.toContainText(/nieuw token|new token/i)
    await expect(page.locator('#wizard-next-why')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: /Verbind met Moneybird/ })).toBeVisible()
    await expect(page.locator('button[data-focus="next"]')).toHaveAttribute('aria-disabled', 'true')
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

/**
 * Confirm plain proposals (H21), then map Verlegd → VERL-ONTV via Andere kiezen
 * (do not Bevestigen VH21 on that rate — that would skip #95).
 */
async function mapRatesForSelfAssessed(page: Page): Promise<void> {
  const verlCard = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: /Verlegd/i }) })
  await expect(verlCard).toBeVisible({ timeout: 30_000 })
  const openVerl =
    (await verlCard.getByRole('button', { name: 'Andere kiezen' }).count()) > 0
      ? verlCard.getByRole('button', { name: 'Andere kiezen' })
      : verlCard.getByRole('button', { name: 'Btw-code kiezen' })
  await openVerl.click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  const other = sheet.locator('[data-slot="vat-show-other"]')
  if ((await other.count()) > 0) {
    const expanded = await other.getAttribute('aria-expanded')
    if (expanded !== 'true') await other.click()
  }
  const verl = sheet.getByRole('radio', {
    name: /VERL-ONTV|verlegd naar jou|Btw verlegd naar jou/i,
  })
  await expect(verl.first()).toBeVisible({ timeout: 15_000 })
  await verl.first().click()
  const save = sheet.getByRole('button', { name: 'Opslaan' })
  await expect(save).toBeEnabled({ timeout: 15_000 })
  await save.click()
  await expect(sheet).toHaveCount(0, { timeout: 60_000 })

  for (let i = 0; i < 8; i += 1) {
    const confirm = page.getByRole('button', { name: 'Bevestigen' })
    if ((await confirm.count()) === 0) break
    const before = await confirm.count()
    await confirm.first().click()
    await expect(confirm).toHaveCount(before - 1, { timeout: 30_000 })
  }
  for (let i = 0; i < 8; i += 1) {
    const choose = page.getByRole('button', { name: 'Btw-code kiezen' })
    if ((await choose.count()) === 0) break
    await choose.first().click()
    const leftover = page.getByRole('dialog')
    await expect(leftover).toBeVisible()
    await leftover.getByRole('radio').first().click()
    const leftoverSave = leftover.getByRole('button', { name: 'Opslaan' })
    await expect(leftoverSave).toBeEnabled({ timeout: 15_000 })
    await leftoverSave.click()
    await expect(leftover).toHaveCount(0, { timeout: 60_000 })
  }
  await expect(page.getByRole('button', { name: 'Btw-code kiezen' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Bevestigen' })).toHaveCount(0)
}

test('#95 self-assessed VAT lands on Klaar with the filing block (#105)', async ({ page }) => {
  test.setTimeout(300_000)
  const standIn = await startSelfAssessedVatMoneybirdStandIn()
  try {
    await anAdministration(page)
    await connectStandIn(page, standIn)
    await pickAdminAndWaitForYears(page, '2026')
    await clickNext(page)
    await expect(page.getByRole('heading', { name: /Wat we gaan overzetten/ })).toBeVisible({
      timeout: 30_000,
    })
    await clickNext(page)
    await expect(page.getByRole('heading', { name: /Welke btw-code/ })).toBeVisible()
    await mapRatesForSelfAssessed(page)
    await clickNext(page)
    await expect(page.getByRole('heading', { name: /Waar komen je rekeningen/ })).toBeVisible({
      timeout: 30_000,
    })
    for (let i = 0; i < 12; i += 1) {
      const confirm = page.getByRole('button', { name: 'Bevestigen' })
      if ((await confirm.count()) === 0) break
      const before = await confirm.count()
      await confirm.first().click()
      await expect(confirm).toHaveCount(before - 1, { timeout: 30_000 })
    }
    await clickNext(page)
    await expect(
      page.getByRole('heading', { name: /Wat we nog moeten oplossen|Niets houdt/ }),
    ).toBeVisible({ timeout: 30_000 })
    // #95 is a warning — must not block Volgende.
    await clickNext(page)
    await expect(page.getByRole('heading', { name: /Klaar om over te zetten/ })).toBeVisible()
    await clickNext(page)
    const confirmDialog = page.getByRole('alertdialog')
    await expect(confirmDialog).toBeVisible()
    await confirmDialog.getByRole('button', { name: /Overzetten bevestigen/i }).click()
    await expect(page.getByRole('heading', { name: /Bezig met overzetten/ })).toBeVisible({
      timeout: 60_000,
    })

    process.env['KLOPT_ENCRYPTION_KEY'] = 'e2e-encryption-key-not-for-production-01234'
    const { importMoneybirdAdministration } = await import('../../worker/src/moneybird.js')
    const { createFilesystemDocumentStore } = await import('@klopt/adapters')
    const { createDatabase, closeDatabase } = await import('@klopt/db')
    const directory = mkdtempSync(join(tmpdir(), 'mb-95-'))
    const db = createDatabase({ url: DATABASE_URL, maxConnections: 2 })
    try {
      const store = createFilesystemDocumentStore({ directory })
      for (let i = 0; i < 8; i += 1) {
        const result = await importMoneybirdAdministration(db, store)
        if (result.state === 'idle') break
      }
    } finally {
      await closeDatabase(db)
    }

    await expect(page.getByRole('heading', { name: /^Import klaar$/ })).toBeVisible({
      timeout: 120_000,
    })
    await expect(page.getByText('Blokkeert indienen')).toBeVisible()
    await expect(
      page.getByText(/Sommige periodes kun je nog niet via Klopt indienen/i),
    ).toBeVisible()
    await expect(
      page.getByText(
        /Klopt past die cijfers niet zelf aan\. Je kunt de aangifte over die periodes zelf of met een belastingadviseur indienen/i,
      ),
    ).toBeVisible()
    await expect(
      page.getByText(
        /Indienen via Klopt kan zodra Klopt dit ondersteunt; wacht daar niet op als je aangiftetermijn eerder afloopt/i,
      ),
    ).toBeVisible()
  } finally {
    await standIn.close()
  }
})
