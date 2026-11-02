import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { createDatabase, closeDatabase, runMigrations } from '@klopt/db'
import { findUserIdByEmail } from '@klopt/db/testing'
import {
  chooseOption,
  DATABASE_URL,
  enableAdvancedMode,
  hydrated,
  signIn,
  uniqueEmail,
} from './support'

/**
 * Desktop + phone PNGs for #175 BillNew + PaymentBatch.
 *
 *   CAPTURE_PR_SCREENSHOTS=1 PR_SCREENSHOT_NUMBER=175 \
 *     pnpm --filter @klopt/web exec playwright test e2e/pr-screenshots-175-billnew-paymentbatch.spec.ts
 */

const PR = process.env['PR_SCREENSHOT_NUMBER'] ?? '175'
const OUT = join(import.meta.dirname, '..', '..', '..', 'docs', 'pr-screenshots', PR)
const CAPTURE = process.env['CAPTURE_PR_SCREENSHOTS'] === '1'

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  if (CAPTURE) {
    rmSync(OUT, { recursive: true, force: true })
    mkdirSync(OUT, { recursive: true })
  }
})

test.skip(!CAPTURE, 'Set CAPTURE_PR_SCREENSHOTS=1 to write docs/pr-screenshots/')

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate((t) => {
    document.documentElement.classList.toggle('dark', t === 'dark')
  }, theme)
  await page.waitForFunction(
    (wantDark) => document.documentElement.classList.contains('dark') === wantDark,
    theme === 'dark',
  )
}

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => {
    const active = document.activeElement
    if (active instanceof HTMLElement) active.blur()
  })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForTimeout(50)
  await page.screenshot({
    path: join(OUT, `${name}.png`),
    fullPage: false,
    animations: 'disabled',
    caret: 'hide',
  })
}

async function shotsBothSizes(page: Page, base: string): Promise<void> {
  for (const [width, height, size] of [
    [1440, 1040, 'desktop-1440'],
    [390, 844, 'mobile-390'],
  ] as const) {
    await page.setViewportSize({ width, height })
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme)
      await shot(page, `${base}-${theme}-${size}`)
    }
  }
  await page.setViewportSize({ width: 1440, height: 1040 })
  await setTheme(page, 'light')
}

async function openAdmin(page: Page, name: string): Promise<string> {
  const email = uniqueEmail()
  await page.goto('/sign-in')
  await signIn(page, email)
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill(name)
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
  await enableAdvancedMode(page)
  await hydrated(page)
  return email
}

async function addSupplier(
  page: Page,
  opts: { number: string; name: string; email: string; iban?: string },
): Promise<void> {
  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill(opts.number)
  await page.getByLabel('Naam', { exact: true }).fill(opts.name)
  await page.getByRole('textbox', { name: 'Btw-nummer' }).fill('NL009988776B01')
  await page.getByLabel('E-mail').fill(opts.email)
  if (opts.iban !== undefined) {
    await page.getByLabel('IBAN').fill(opts.iban)
  }
  await page.getByRole('checkbox', { name: /Leverancier/ }).check()
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('button', { name: new RegExp(opts.name) })).toBeVisible()
}

async function addBank(page: Page): Promise<void> {
  await page.goto('/bank')
  await page.getByRole('button', { name: 'Rekening toevoegen' }).click()
  await page.getByLabel('IBAN').fill('NL91ABNA0417164300')
  await page.getByLabel('Naam', { exact: true }).fill('Demo bankrekening')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('NL91ABNA0417164300')).toBeVisible()
}

async function fillBill(page: Page, number: string): Promise<void> {
  await expect(page.getByRole('button', { name: 'Btw berekenen voor regel 1' })).toBeEnabled()
  await page.getByLabel('Hun nummer').fill(number)
  await page.getByLabel('Factuurdatum').fill('2026-02-10')
  await page.getByLabel('Vervaldatum').fill('2026-03-12')
  await page.getByLabel('Exclusief btw', { exact: true }).fill('200,33')
  await page.getByLabel('Btw', { exact: true }).fill('42,07')
  await page.getByLabel('Totaal', { exact: true }).fill('242,40')
  await page.getByLabel('Omschrijving regel 1').fill('Business insurance, Q1')
  await chooseOption(page, 'Grootboek regel 1', /^4400 /)
  await expect(page.getByLabel('Btw-code regel 1')).toHaveText(/^VH21/)
  await page.getByLabel('Excl. btw regel 1').fill('200,33')
  await page.getByRole('button', { name: 'Btw berekenen voor regel 1' }).click()
  await expect(page.getByRole('button', { name: 'Concept opslaan' })).toBeVisible()
}

test('BillNew + PaymentBatch #175 screenshots — desktop/phone, light/dark, batch states', async ({
  browser,
}) => {
  test.setTimeout(420_000)
  const database = createDatabase({ url: DATABASE_URL, maxConnections: 2 })
  const aliceCtx = await browser.newContext()
  const bobCtx = await browser.newContext()

  try {
    const page = await aliceCtx.newPage()
    await page.setViewportSize({ width: 1440, height: 1040 })
    await openAdmin(page, 'Screenshot Demo BV')

    // 01 BillNew empty
    await page.goto('/purchases/new')
    await hydrated(page)
    await expect(page.getByRole('heading', { name: 'Nieuwe inkoopfactuur' })).toBeVisible()
    await shotsBothSizes(page, '01-billnew-empty')

    await addSupplier(page, {
      number: 'CRE-175',
      name: 'Verzekering Fictief',
      email: 'eva@example.nl',
      iban: 'NL91ABNA0417164300',
    })
    await addSupplier(page, {
      number: 'CRE-NOIBAN',
      name: 'Zonder Iban BV',
      email: 'geeniban@example.nl',
    })
    await addBank(page)

    // 02 BillNew seeded
    await page.goto('/purchases/new')
    await chooseOption(page, 'Leverancier', /Verzekering Fictief/)
    await fillBill(page, 'INK-DEMO-2026-0039')
    await shotsBothSizes(page, '02-billnew-seeded')

    // 03 Payment batches empty
    await page.goto('/payments')
    await hydrated(page)
    await expect(page.getByRole('heading', { name: 'Kosten' })).toBeVisible()
    await shotsBothSizes(page, '03-paymentbatches-empty')

    // 04 PaymentBatch prepare
    await page.getByRole('button', { name: 'Nieuwe batch' }).click()
    await page.getByLabel('Kenmerk').fill('BETAAL-175')
    await page.getByRole('button', { name: 'Aanmaken' }).click()
    await page.getByRole('button', { name: 'Betaling toevoegen' }).click()
    await page.getByLabel('Begunstigde').fill('Verzekering Fictief')
    await page.getByLabel('IBAN').fill('NL91ABNA0417164300')
    await page.getByLabel('Bedrag', { exact: true }).fill('242,40')
    await page.getByLabel('Eigen kenmerk').fill('INK-DEMO-2026-0039')
    await page.getByLabel('Omschrijving').fill('Business insurance')
    await page.getByRole('button', { name: 'Toevoegen' }).click()
    await expect(page.getByText('Verzekering Fictief')).toBeVisible()
    const steps = page.getByRole('list', { name: 'Voortgang van de batch' })
    await expect(steps.getByText('Bestand gedownload')).toBeVisible()
    await expect(steps.getByText('Betaald')).toHaveCount(0)
    await expect(steps.getByText('Bij de bank')).toHaveCount(0)
    await shotsBothSizes(page, '04-paymentbatch-prepare')

    // 05 Missing-IBAN callout via approved bill from supplier without IBAN
    await page.goto('/purchases/new')
    await chooseOption(page, 'Leverancier', /Zonder Iban BV/)
    await fillBill(page, 'INK-NOIBAN-1')
    await page.getByRole('button', { name: 'Boeken' }).click()
    await expect(page.getByRole('heading', { name: /INK-NOIBAN-1/ })).toBeVisible()
    await page.getByRole('button', { name: 'Goedkeuren voor betaling' }).click()
    await expect(page.getByText(/goedgekeurd voor betaling/i)).toBeVisible()

    await page.goto('/payments')
    await page.getByRole('button', { name: 'Nieuwe batch' }).click()
    await page.getByLabel('Kenmerk').fill('BETAAL-NOIBAN')
    await page.getByRole('button', { name: 'Aanmaken' }).click()
    await expect(page.getByText(/Deze leveranciers hebben nog geen IBAN/i)).toBeVisible()
    await expect(
      page.getByText(/Zet de IBAN op de leverancier; daarna kun je de factuur/i),
    ).toBeVisible()
    await shotsBothSizes(page, '05-paymentbatch-missing-iban')

    // Invite Bob for four-eyes states
    const bobPage = await bobCtx.newPage()
    const bobEmail = uniqueEmail()
    await bobPage.goto('/sign-in')
    await signIn(bobPage, bobEmail)
    await expect(bobPage.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()

    await page.goto('/members')
    const invite = page.locator('form', {
      has: page.getByRole('button', { name: 'Uitnodigen' }),
    })
    await invite.getByLabel('E-mail').fill(bobEmail)
    await chooseOption(page, 'Rol', 'Accountant', invite)
    await page.getByRole('button', { name: 'Uitnodigen' }).click()
    await expect(page.getByText(new RegExp(`${bobEmail} heeft nu toegang`))).toBeVisible()
    expect(await findUserIdByEmail(database, bobEmail)).not.toBeNull()

    // 06 Submitted — submitter view
    await page.goto('/payments')
    await page.getByRole('button', { name: 'Nieuwe batch' }).click()
    await page.getByLabel('Kenmerk').fill('BETAAL-FLOW')
    await page.getByRole('button', { name: 'Aanmaken' }).click()
    await page.getByRole('button', { name: 'Betaling toevoegen' }).click()
    await page.getByLabel('Begunstigde').fill('Verzekering Fictief')
    await page.getByLabel('IBAN').fill('NL91ABNA0417164300')
    await page.getByLabel('Bedrag', { exact: true }).fill('242,40')
    await page.getByLabel('Eigen kenmerk').fill('INK-FLOW-1')
    await page.getByLabel('Omschrijving').fill('Flow demo')
    await page.getByRole('button', { name: 'Toevoegen' }).click()
    await page.getByRole('button', { name: 'Ter fiattering aanbieden' }).click()
    await expect(page.getByText(/Status is nu: wacht op fiat/)).toBeVisible()
    await expect(page.getByText(/Ingediend door/)).toBeVisible()
    await expect(page.getByText('Nog niet goedgekeurd')).toBeVisible()
    await expect(page.getByRole('heading', { name: /· 1 factuur\b/ })).toBeVisible()
    await shotsBothSizes(page, '06-paymentbatch-submitted-submitter')

    // 07 Submitted — approver view (no display name → nameless "Ingediend")
    await bobPage.setViewportSize({ width: 1440, height: 1040 })
    await bobPage.goto('/payments')
    await expect(bobPage.getByRole('cell', { name: 'BETAAL-FLOW' })).toBeVisible()
    await hydrated(bobPage)
    await bobPage.getByRole('cell', { name: 'BETAAL-FLOW' }).click()
    await expect(bobPage.getByRole('button', { name: /Batch fiatteren|Fiatteren/ })).toBeVisible()
    await expect(bobPage.getByText('Ingediend', { exact: true })).toBeVisible()
    await expect(bobPage.getByText('Nog niet goedgekeurd')).toBeVisible()
    await expect(bobPage.getByRole('heading', { name: /· 1 factuur\b/ })).toBeVisible()
    await shotsBothSizes(bobPage, '07-paymentbatch-submitted-approver')

    // 08 Approved — nameless "Goedgekeurd"
    await bobPage.getByRole('button', { name: /Batch fiatteren|Fiatteren/ }).click()
    await expect(bobPage.getByText(/Status is nu: gefiatteerd/)).toBeVisible()
    await expect(bobPage.getByRole('button', { name: 'Download pain.001' })).toBeVisible()
    await expect(bobPage.getByText('Goedgekeurd', { exact: true })).toBeVisible()
    await shotsBothSizes(bobPage, '08-paymentbatch-approved')

    // 09 Exported — last stepper step done
    await bobPage.getByRole('button', { name: 'Markeren als verstuurd' }).click()
    await expect(bobPage.getByText(/Status is nu: verstuurd naar de bank/)).toBeVisible()
    await expect(
      bobPage.getByRole('list', { name: 'Voortgang van de batch' }).getByText('Bestand gedownload'),
    ).toBeVisible()
    await expect(bobPage.getByText(/letter je ze af in Match/i)).toBeVisible()
    await expect(bobPage.getByText('Goedgekeurd', { exact: true })).toBeVisible()
    await shotsBothSizes(bobPage, '09-paymentbatch-exported')
  } finally {
    await aliceCtx.close()
    await bobCtx.close()
    await closeDatabase(database)
  }
})
