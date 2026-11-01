import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, hydrated, signIn, uniqueEmail } from './support'
import { startExactStandIn, type ExactStandIn } from './support/exact-stand-in'

/**
 * Exact wizard — read-only VAT preview (#100 Phase 2 first slice).
 *
 * Per-screen gate (#161 QA): sidebar + command bar entry, empty + seeded
 * states, keyboard navigation, no console errors.
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

function trackPageErrors(page: Page): { assertClean: () => void } {
  const errors: string[] = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
  })
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return {
    assertClean: () => {
      expect(errors, `console/page errors:\n${errors.join('\n')}`).toEqual([])
    },
  }
}

async function anAdministration(page: Page, name = 'Exact Wizard BV'): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill(name)
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

async function openExactFromSidebar(page: Page): Promise<void> {
  await page
    .getByRole('navigation')
    .getByRole('link', { name: /^Importeren/ })
    .click()
  await expect(page.getByRole('heading', { name: /Waar komen je boeken vandaan/ })).toBeVisible()
  await page.getByRole('radio', { name: /Exact Online/ }).click()
  await expect(page).toHaveURL(/bron=exact/)
}

async function openExactFromCommandBar(page: Page): Promise<void> {
  await hydrated(page)
  await page.getByRole('button', { name: /Zoeken of opdracht/ }).click()
  const palette = page.getByRole('dialog', { name: 'Commando’s' })
  await expect(palette).toBeVisible()
  await page.keyboard.type('Exact Online')
  const wizardOption = palette.getByRole('option', { name: /^Exact Online i x/ })
  await expect(wizardOption).toBeVisible()
  await wizardOption.click()
  await expect(page).toHaveURL(/bron=exact/)
  await expect(page.getByRole('banner').getByText('Exact Online', { exact: true })).toBeVisible()
}

async function fillExactStandInCredentials(page: Page, standIn: ExactStandIn): Promise<void> {
  await expect(page.getByRole('heading', { name: /Verbind met Exact Online/ })).toBeVisible()
  await page
    .locator('details')
    .filter({ hasText: /Geavanceerd|Boekhouddetails/ })
    .locator('summary')
    .click()
  await page.getByLabel('Exact-omgeving').fill(standIn.baseUrl)
  await page.getByLabel('Client ID').fill(standIn.clientId)
  await page.getByLabel('Client secret').fill(standIn.clientSecret)
  await page.getByLabel('Redirect-URI').fill(`${new URL(page.url()).origin}/exact/callback`)
}

async function connectExactStandIn(page: Page, standIn: ExactStandIn): Promise<void> {
  await fillExactStandInCredentials(page, standIn)
  await clickNext(page)

  // OAuth → administratie; skip Welkom terug right after consent (#100 PM).
  const adminHeading = page.getByRole('heading', {
    name: /Welke administratie en welk boekjaar/,
  })
  await expect(adminHeading).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('heading', { name: /Welkom terug/ })).toHaveCount(0)
}

async function reachBtw(page: Page, standIn: ExactStandIn): Promise<void> {
  await connectExactStandIn(page, standIn)

  await page.getByRole('button', { name: /Administraties ophalen|Opnieuw ophalen/ }).click()
  await expect(page.getByRole('button', { name: /Voorbeeld BV/ })).toBeVisible({
    timeout: 30_000,
  })
  await page.getByRole('button', { name: /Voorbeeld BV/ }).click()
  await expect(page.getByText(/Gekozen: Voorbeeld BV/)).toBeVisible()
  await page.getByLabel(/Boekjaar om te importeren/).fill('2026')
  await clickNext(page)

  await expect(page.getByRole('heading', { name: /Wat we gaan overzetten/ })).toBeVisible({
    timeout: 60_000,
  })
  const taxTerm = page.getByRole('term').filter({ hasText: 'Btw-codes' })
  if ((await taxTerm.count()) === 0) {
    await page.getByRole('button', { name: /Opnieuw lezen/ }).click()
  }
  await expect(taxTerm).toBeVisible({ timeout: 60_000 })
  await clickNext(page)

  await expect(page.getByRole('heading', { name: /Btw-codes uit Exact/ })).toBeVisible({
    timeout: 30_000,
  })
}

test('Exact empty Bron from sidebar and command bar (#161 QA)', async ({ page }) => {
  const tracker = trackPageErrors(page)
  await anAdministration(page, 'Exact Empty BV')

  await openExactFromSidebar(page)
  await expect(page.getByRole('radio', { name: /Exact Online/ })).toBeChecked()
  await expect(page.getByText(/Rekeningschema, relaties en openstaande posten/)).toBeVisible()
  await expect(page.getByRole('paragraph').filter({ hasText: /Stap 1 van 5/ })).toBeVisible()

  await page.goto('/')
  await openExactFromCommandBar(page)
  await expect(page.getByRole('radio', { name: /Exact Online/ })).toBeChecked()
  tracker.assertClean()
})

test('Exact VAT read-only preview: seeded mapping, rail stop, resume, keyboard (#100/#161)', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const tracker = trackPageErrors(page)
  const standIn = await startExactStandIn()
  try {
    await anAdministration(page)
    await openExactFromSidebar(page)
    await clickNext(page)

    // Empty verbinden state before OAuth.
    await expect(page.getByRole('heading', { name: /Verbind met Exact Online/ })).toBeVisible()
    await expect(page.getByLabel('Client ID')).toHaveValue('')
    await expect(page.getByRole('paragraph').filter({ hasText: /Stap 2 van 5/ })).toBeVisible()

    await reachBtw(page, standIn)

    await expect(
      page.getByText(
        /Klopt herkent een code alleen als code, tarief en soort kloppen; anders blijft hij onherkend/,
      ),
    ).toBeVisible()
    await expect(page.getByText(/Nog niets overgezet/)).toBeVisible()
    await expect(page.getByRole('paragraph').filter({ hasText: /Stap 5 van 5/ })).toBeVisible()
    await expect(page.getByText('BTW hoog verkoop 21%')).toBeVisible()
    await expect(page.getByText('BTW hoog 21%').first()).toBeVisible()
    await expect(page.getByText(/4 van 7 herkend/)).toBeVisible()
    // Sales Geen BTW and export stay unrecognised — never purchase VGEEN (#161 QA).
    await expect(page.getByText('Geen BTW', { exact: true })).toBeVisible()
    await expect(page.getByText('Inkoop zonder btw')).toHaveCount(0)
    await expect(page.getByText(/Klopt herkent deze niet/).first()).toBeVisible()
    await expect(page.getByText(/Verlegd inkoop EU/)).toBeVisible()
    await expect(page.getByText('Geen btw - export buiten de EU', { exact: true })).toBeVisible()
    await expect(page.getByText(/Nog niet in deze versie/)).toBeVisible()
    // No disabled later steps on the rail (#100 PM / #161 QA).
    const rail = page.getByRole('navigation', { name: 'Stappen' })
    await expect(rail.getByText('Rekeningen en relaties')).toHaveCount(0)
    await expect(rail.getByText('Problemen')).toHaveCount(0)
    await expect(rail.getByText(/^Importeren$/)).toHaveCount(0)
    await expect(page.locator('button[data-focus="next"]')).toHaveAttribute('aria-disabled', 'true')

    // Returning to an unfinished import shows Welkom terug (#100 PM).
    await page.goto('/importeren')
    await expect(page.getByRole('heading', { name: /Welkom terug/ })).toBeVisible({
      timeout: 30_000,
    })
    await page.getByRole('button', { name: /Doorgaan/i }).click()
    await expect(page.getByRole('heading', { name: /Btw-codes uit Exact/ })).toBeVisible({
      timeout: 30_000,
    })

    // Keyboard: Esc goes back one step; re-read then Enter advances.
    await page.locator('main').click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: /Wat we gaan overzetten/ })).toBeVisible({
      timeout: 15_000,
    })
    await page.getByRole('button', { name: /Opnieuw lezen/ }).click()
    await expect(page.getByRole('term').filter({ hasText: 'Btw-codes' })).toBeVisible({
      timeout: 60_000,
    })
    await page.locator('main').click()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: /Btw-codes uit Exact/ })).toBeVisible({
      timeout: 30_000,
    })

    tracker.assertClean()
  } finally {
    await standIn.close()
  }
})
