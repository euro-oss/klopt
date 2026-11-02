import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import {
  chooseOption,
  DATABASE_URL,
  enableAdvancedMode,
  hydrated,
  signIn,
  uniqueEmail,
} from './support'

/**
 * Redesign Phase 6 Contacts (#130): sidebar + ⌘K route, empty + seeded,
 * keyboard, no console errors. Fixture data uses example.nl and fake names.
 *
 * Also covers #163 design (full name, no premature truncate) and Legal
 * (supplier open count/amount; overdue only after due date; no betaald claim).
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

/** Long enough that the old truncate layout clipped it at 1440 and 390. */
const LONG_NAME = 'Zandbank Advies en Accountancy Partners B.V.'

async function openContacts(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam', { exact: true }).fill('Relaties Demo BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
  await enableAdvancedMode(page)
  await hydrated(page)
}

function attachConsoleGuard(page: Page): { errors: string[] } {
  const errors: string[] = []
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() !== 'error') return
    const text = message.text()
    // Vite / React dev noise that is not a product failure.
    if (text.includes('Download the React DevTools')) return
    if (text.includes('third-party cookie')) return
    errors.push(text)
  })
  page.on('pageerror', (error) => {
    errors.push(error.message)
  })
  return { errors }
}

async function seedContact(page: Page, name = 'Windvaan Workshops (demo)'): Promise<void> {
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('DEB-1301')
  await page.getByLabel('Naam', { exact: true }).fill(name)
  await page.getByLabel('E-mail').fill('facturen@example.nl')
  await page.getByLabel('Straat').fill('Voorbeeldstraat')
  await page.getByLabel('Huisnr.').fill('1')
  await page.getByLabel('Postcode').fill('1000 AA')
  await page.getByLabel('Plaats').fill('Amsterdam')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(
    page.getByRole('button', { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }),
  ).toBeVisible()
}

async function assertNameRendersInFull(page: Page, name: string): Promise<void> {
  const nameEl = page.locator('[data-contact-name]', { hasText: name }).first()
  await expect(nameEl).toBeVisible()
  await expect(nameEl).toHaveText(name)
  await expect(nameEl).toHaveAttribute('title', name)
  // No CSS ellipsis clipping: the full string must fit the box (wrapping OK).
  const clipped = await nameEl.evaluate((el) => el.scrollWidth > el.clientWidth + 1)
  expect(clipped, `name still clipped: ${name}`).toBe(false)
}

test('Contacts opens from the sidebar and from the command bar', async ({ page }) => {
  const { errors } = attachConsoleGuard(page)
  await openContacts(page)

  await page
    .getByRole('navigation', { name: 'Hoofdnavigatie' })
    .getByRole('link', { name: /Relaties/ })
    .click()
  await expect(page).toHaveURL(/\/contacts/)
  await expect(page.getByRole('heading', { name: 'Relaties' })).toBeVisible()
  await expect(page.getByRole('tablist', { name: 'Rol' })).toBeVisible()

  await page.goto('/')
  await hydrated(page)
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Commando’s' })
  await expect(palette).toBeVisible()
  await page.getByLabel('Zoek een scherm of een boeking').fill('Relaties')
  await expect(palette.getByRole('option', { name: /Relaties/ }).first()).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/contacts/)
  await expect(page.getByRole('heading', { name: 'Relaties' })).toBeVisible()

  expect(errors, errors.join('\n')).toEqual([])
})

test('empty state, seeded list + card, and keyboard navigation', async ({ page }) => {
  const { errors } = attachConsoleGuard(page)
  await openContacts(page)

  await page.getByRole('link', { name: /Relaties/ }).click()
  await hydrated(page)
  await expect(page.getByText('Nog geen relaties')).toBeVisible()

  await seedContact(page)
  await expect(page.getByRole('tab', { name: /Alles/ })).toContainText('1')
  await expect(page.getByRole('tab', { name: /Klanten/ })).toContainText('1')

  // Card opens after create (selected id in the URL).
  const card = page.getByRole('complementary', { name: 'Relatiekaart' })
  await expect(card).toBeVisible()
  await expect(card).toContainText('Windvaan Workshops (demo)')
  await expect(card).toContainText('DEB-1301')
  // Honest copy: no live-connection / gekoppeld claims.
  await expect(card).not.toContainText(/gekoppeld|live connection/i)

  // Segments 1–3 and j/k.
  await page.keyboard.press('2')
  await expect(page).toHaveURL(/role=customers/)
  await page.keyboard.press('1')
  await expect(page.getByRole('button', { name: /Windvaan Workshops \(demo\)/ })).toBeVisible()

  await page.keyboard.press('j')
  await expect(page).toHaveURL(/id=/)
  await page.keyboard.press('e')
  await expect(page).toHaveURL(/\/contacts\/[0-9a-f-]+/)
  await expect(page.getByRole('heading', { name: /DEB-1301/ })).toBeVisible()

  expect(errors, errors.join('\n')).toEqual([])
})

test('a long fixture name renders in full on desktop and phone', async ({ page }) => {
  await openContacts(page)
  await page.getByRole('link', { name: /Relaties/ }).click()
  await hydrated(page)
  await seedContact(page, LONG_NAME)

  await page.setViewportSize({ width: 1440, height: 1040 })
  await assertNameRendersInFull(page, LONG_NAME)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/contacts')
  // Phone chrome hides desktop Home kbd that `hydrated()` waits on.
  await expect(page.locator('[data-phone-tab-bar]')).toBeVisible()
  await assertNameRendersInFull(page, LONG_NAME)
})

test('supplier card shows open count/amount; overdue only after due date; never betaald', async ({
  page,
}) => {
  await openContacts(page)

  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('CRE-1630')
  await page.getByLabel('Naam', { exact: true }).fill('Kantoorpapier Proef B.V.')
  await page.getByRole('textbox', { name: 'Btw-nummer' }).fill('NL000001630B99')
  await page.getByLabel('E-mail').fill('inkoop@example.nl')
  await page.getByLabel('IBAN').fill('NL91ABNA0417164300')
  await page.getByRole('checkbox', { name: /Klant/ }).uncheck()
  await page.getByRole('checkbox', { name: /Leverancier/ }).check()
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('button', { name: /Kantoorpapier Proef B\.V\./ })).toBeVisible()

  const card = page.getByRole('complementary', { name: 'Relatiekaart' })
  await expect(card).toBeVisible()
  // No bills yet: honest empty, never a paid claim.
  await expect(card).toContainText('Niets openstaand')
  await expect(card).not.toContainText(/betaald/i)

  async function bookBill(opts: {
    number: string
    invoiceDate: string
    dueDate: string
    excl: string
    vat: string
    total: string
  }): Promise<void> {
    await page.goto('/purchases/new')
    await expect(page.getByRole('button', { name: 'Btw berekenen voor regel 1' })).toBeEnabled()
    // Sole supplier is the form default; confirm via combobox (not getByLabel —
    // that also matches other fields that mention Leverancier).
    await expect(page.getByRole('combobox', { name: 'Leverancier' })).toContainText(/CRE-1630/)
    await page.getByLabel('Hun nummer').fill(opts.number)
    await page.getByLabel('Factuurdatum').fill(opts.invoiceDate)
    await page.getByLabel('Vervaldatum').fill(opts.dueDate)
    await page.getByLabel('Exclusief btw', { exact: true }).fill(opts.excl)
    await page.getByLabel('Btw', { exact: true }).fill(opts.vat)
    await page.getByLabel('Totaal', { exact: true }).fill(opts.total)
    await page.getByLabel('Omschrijving regel 1').fill('Kantoorartikelen demo')
    await chooseOption(page, 'Grootboek regel 1', /^4400 /)
    await expect(page.getByLabel('Btw-code regel 1')).toHaveText(/^VH21/)
    await page.getByLabel('Excl. btw regel 1').fill(opts.excl)
    await page.getByRole('button', { name: 'Btw berekenen voor regel 1' }).click()
    await page.getByRole('button', { name: 'Concept opslaan' }).click()
    await page.getByRole('button', { name: 'Boeken', exact: true }).click()
    await expect(page.getByRole('link', { name: /^boeking \d/ })).toBeVisible()
    await page.getByRole('button', { name: 'Goedkeuren voor betaling' }).click()
    await expect(page.getByText('goedgekeurd voor betaling')).toBeVisible()
  }

  // One overdue bill (due before today) and one open but not yet due.
  // Invoice dates stay in book year 2026 so VH21 is in force.
  await bookBill({
    number: 'F-1630-1',
    invoiceDate: '2026-01-10',
    dueDate: '2026-02-10',
    excl: '100,00',
    vat: '21,00',
    total: '121,00',
  })
  await bookBill({
    number: 'F-1630-2',
    invoiceDate: '2026-10-01',
    dueDate: '2099-12-31',
    excl: '200,00',
    vat: '42,00',
    total: '242,00',
  })

  await page.goto('/contacts')
  await hydrated(page)
  await page.getByRole('button', { name: /Kantoorpapier Proef B\.V\./ }).click()
  await expect(card).toBeVisible()
  await expect(card).toContainText(/2 open · €/)
  await expect(card).toContainText(/1 te laat/)
  await expect(card).not.toContainText(/betaald/i)
})
