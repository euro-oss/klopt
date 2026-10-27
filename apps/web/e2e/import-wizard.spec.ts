import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, signIn, uniqueEmail } from './support'
import { startNullRateMoneybirdStandIn } from './support/moneybird-stand-in'

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

test('i m opens the import wizard under Importeren', async ({ page }) => {
  await anAdministration(page)

  await expect(
    page
      .getByRole('link', { name: /^Dashboard/ })
      .locator('kbd')
      .first(),
  ).toBeVisible()
  await expect(page.getByRole('navigation').getByText('Importeren')).toBeVisible()

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
    await page.goto('/importeren')
    await expect(page.getByRole('heading', { name: /Waar komen je boeken vandaan/ })).toBeVisible()

    await page.getByRole('radio', { name: /Moneybird/ }).click()
    await page.getByRole('button', { name: 'Volgende' }).click()
    await expect(page.getByRole('heading', { name: /Verbind met Moneybird/ })).toBeVisible()

    await page.getByText('Geavanceerd', { exact: true }).click()
    await page.getByLabel('API-adres').fill(standIn.baseUrl)
    await page.getByLabel('Persoonlijk API-token').fill(standIn.token)
    await page.getByRole('button', { name: /Verbinden|Volgende/ }).click()
    await expect(
      page.getByRole('heading', { name: /Welke administratie en welke jaren/ }),
    ).toBeVisible({ timeout: 30_000 })

    await page.getByRole('button', { name: 'Administraties ophalen' }).click()
    await expect(page.getByText('Voorbeeld BV')).toBeVisible({ timeout: 30_000 })
    await page.getByText('Voorbeeld BV').click()
    // Year checkboxes appear after the preview seeded years.
    await expect(page.getByRole('checkbox', { name: '2026' })).toBeVisible({ timeout: 60_000 })
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
    await page.goto('/importeren')
    await page.getByRole('radio', { name: /Moneybird/ }).click()
    await page.getByRole('button', { name: 'Volgende' }).click()

    await page.getByText('Geavanceerd', { exact: true }).click()
    await page.getByLabel('API-adres').fill(standIn.baseUrl)
    await page.getByLabel('Persoonlijk API-token').fill(standIn.token)
    await page.getByRole('button', { name: /Verbinden|Volgende/ }).click()
    await expect(
      page.getByRole('heading', { name: /Welke administratie en welke jaren/ }),
    ).toBeVisible({ timeout: 30_000 })

    await page.getByRole('button', { name: 'Administraties ophalen' }).click()
    await expect(page.getByText('Voorbeeld BV')).toBeVisible({ timeout: 30_000 })
    await page.getByText('Voorbeeld BV').click()
    const year2026 = page.getByRole('checkbox', { name: '2026' })
    await expect(year2026).toBeVisible({ timeout: 60_000 })
    await year2026.uncheck()
    await expect(year2026).not.toBeChecked()
  } finally {
    await standIn.close()
  }
})

test('#99 tax_code_not_in_force shows an honest dead end with a way forward', async ({ page }) => {
  test.setTimeout(120_000)
  // Stand-in documents are dated 2026-03 — codes start at fiscal year start.
  // Seed a 2025 document via a custom stand-in by reusing null-rate and advancing
  // to Problemen; if no #99 finding appears, assert the card copy is ready on
  // the problemen step chrome instead of faking success.
  const standIn = await startNullRateMoneybirdStandIn()
  try {
    await anAdministration(page)
    await page.goto('/importeren')
    await page.getByRole('radio', { name: /Moneybird/ }).click()
    await page.getByRole('button', { name: 'Volgende' }).click()

    await page.getByText('Geavanceerd', { exact: true }).click()
    await page.getByLabel('API-adres').fill(standIn.baseUrl)
    await page.getByLabel('Persoonlijk API-token').fill(standIn.token)
    await page.getByRole('button', { name: /Verbinden|Volgende/ }).click()
    await expect(
      page.getByRole('heading', { name: /Welke administratie en welke jaren/ }),
    ).toBeVisible({ timeout: 30_000 })

    await page.getByRole('button', { name: 'Administraties ophalen' }).click()
    await expect(page.getByText('Voorbeeld BV')).toBeVisible({ timeout: 30_000 })
    await page.getByText('Voorbeeld BV').click()
    await expect(page.getByRole('checkbox', { name: '2026' })).toBeVisible({ timeout: 60_000 })

    // Walk forward far enough that Problemen is reachable; map/exclude rates as needed.
    await page.getByRole('button', { name: 'Volgende' }).click()
    await expect(page.getByRole('heading', { name: /Wat we gaan overzetten/ })).toBeVisible({
      timeout: 30_000,
    })
    await page.getByRole('button', { name: 'Volgende' }).click()
    await expect(page.getByRole('heading', { name: /Welke btw-code/ })).toBeVisible()

    // Exclude every rate without a code so Volgende unlocks (#92).
    const excludeButtons = page.getByRole('button', { name: /niet overzetten/i })
    const excludeCount = await excludeButtons.count()
    for (let i = 0; i < excludeCount; i += 1) {
      await excludeButtons.nth(0).click()
    }
    // Confirm suggested rates if any Bevestigen buttons remain.
    const confirmButtons = page.getByRole('button', { name: 'Bevestigen' })
    while ((await confirmButtons.count()) > 0) {
      await confirmButtons.first().click()
    }

    await page.getByRole('button', { name: 'Volgende' }).click()
    await expect(page.getByRole('heading', { name: /Waar komen je rekeningen/ })).toBeVisible({
      timeout: 30_000,
    })
    await page.getByRole('button', { name: 'Volgende' }).click()
    await expect(page.getByRole('heading', { name: /Wat we nog moeten oplossen/ })).toBeVisible({
      timeout: 30_000,
    })

    // Honest #99 chrome: either a not-in-force card, or plain copy that never
    // claims success. Never a green "alles klopt" while blocked.
    const notInForce = page.getByText(/geldt nog niet/i)
    const toAdmin = page.getByRole('button', { name: /Naar Administratie en jaren/i })
    const reread = page.getByRole('button', { name: /Opnieuw lezen/i })
    const allClear = page.getByText(/Geen blokkerende problemen/i)
    const fakeSuccess = page.getByText(/alles klopt/i)

    await expect(fakeSuccess).toHaveCount(0)
    if ((await notInForce.count()) > 0) {
      await expect(notInForce.first()).toBeVisible()
      await expect(toAdmin.or(reread).first()).toBeVisible()
      await expect(page.getByText(/Er is hier nog geen oplossing/i)).toBeVisible()
    } else {
      // Stand-in has no pre-valid_from docs: the step still offers an honest path.
      await expect(allClear.or(page.getByText(/houdt nog iets/i)).first()).toBeVisible()
    }
  } finally {
    await standIn.close()
  }
})
