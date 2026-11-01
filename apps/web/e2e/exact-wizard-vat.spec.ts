import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, signIn, uniqueEmail } from './support'
import { startExactStandIn, type ExactStandIn } from './support/exact-stand-in'

/**
 * Exact wizard — read-only VAT preview (#100 Phase 2 first slice).
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

async function anAdministration(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill('Exact Wizard BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
}

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

async function connectExactStandIn(page: Page, standIn: ExactStandIn): Promise<void> {
  await page.goto('/importeren?bron=exact')
  await expect(page.getByRole('heading', { name: /Waar komen je boeken vandaan/ })).toBeVisible()
  const exact = page.getByRole('radio', { name: /Exact Online/ })
  await expect(exact).toBeEnabled({ timeout: 15_000 })
  await exact.click()
  await clickNext(page)
  await expect(page.getByRole('heading', { name: /Verbind met Exact Online/ })).toBeVisible()

  await page
    .locator('details')
    .filter({ hasText: /Geavanceerd|Boekhouddetails/ })
    .locator('summary')
    .click()
  await page.getByLabel('Exact-omgeving').fill(standIn.baseUrl)
  await page.getByLabel('Client ID').fill(standIn.clientId)
  await page.getByLabel('Client secret').fill(standIn.clientSecret)
  // Loopback redirect for the stand-in (schema allows localhost).
  await page.getByLabel('Redirect-URI').fill(`${new URL(page.url()).origin}/exact/callback`)
  await clickNext(page)

  // OAuth round-trip via stand-in → callback → administratie (skips Welkom terug).
  const adminHeading = page.getByRole('heading', {
    name: /Welke administratie en welk boekjaar/,
  })
  const resumeHeading = page.getByRole('heading', { name: /Welkom terug/ })
  await expect(adminHeading.or(resumeHeading)).toBeVisible({ timeout: 60_000 })
  if (await resumeHeading.isVisible()) {
    await page.getByRole('button', { name: /Doorgaan/i }).click()
  }
  await expect(adminHeading).toBeVisible({ timeout: 30_000 })
}

test('Exact VAT read-only preview shows recognised and unrecognised codes (#100)', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const standIn = await startExactStandIn()
  try {
    await anAdministration(page)
    await connectExactStandIn(page, standIn)

    await page.getByRole('button', { name: /Administraties ophalen|Opnieuw ophalen/ }).click()
    await expect(page.getByRole('button', { name: /Voorbeeld BV/ })).toBeVisible({
      timeout: 30_000,
    })
    await page.getByRole('button', { name: /Voorbeeld BV/ }).click()
    await expect(page.getByText(/Gekozen: Voorbeeld BV/)).toBeVisible()

    const year = page.getByLabel(/Boekjaar om te importeren/)
    await year.fill('2026')
    await clickNext(page)

    await expect(page.getByRole('heading', { name: /Wat we gaan overzetten/ })).toBeVisible({
      timeout: 60_000,
    })
    // Preview may already have run on Volgende; ensure counts show.
    const taxTerm = page.getByRole('term').filter({ hasText: 'Btw-codes' })
    if ((await taxTerm.count()) === 0) {
      await page.getByRole('button', { name: /Opnieuw lezen/ }).click()
    }
    await expect(taxTerm).toBeVisible({ timeout: 60_000 })
    await clickNext(page)

    await expect(page.getByRole('heading', { name: /Btw-codes uit Exact/ })).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByText(/Nog niets overgezet/)).toBeVisible()
    await expect(page.getByText('BTW hoog verkoop 21%')).toBeVisible()
    await expect(page.getByText('BTW hoog 21%').first()).toBeVisible()
    await expect(page.getByText(/5 van 7 herkend/)).toBeVisible()
    await expect(page.getByText(/Klopt herkent deze niet/).first()).toBeVisible()
    await expect(page.getByText(/Verlegd inkoop EU/)).toBeVisible()
    await expect(page.getByText(/Nog niet in deze versie/)).toBeVisible()
    // Volgende stays off — accounts / openings are later PRs.
    await expect(page.locator('button[data-focus="next"]')).toHaveAttribute('aria-disabled', 'true')
  } finally {
    await standIn.close()
  }
})
