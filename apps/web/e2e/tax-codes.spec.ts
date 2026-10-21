import { expect, test, type Page } from '@playwright/test'
import { closeDatabase, createDatabase, runMigrations } from '@klopt/db'
import {
  chooseOption,
  DATABASE_URL,
  enableAdvancedMode,
  hydrated,
  signIn,
  uniqueEmail,
} from './support'

/**
 * Btw-codes beheren: add a missing pair, confirm end/restore, keep bookkeepers out.
 */

type SqlTag = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>
}

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

async function anOwner(page: Page, name: string): Promise<void> {
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

async function dropPair(entityId: string): Promise<void> {
  const database = createDatabase({ url: DATABASE_URL, maxConnections: 2 })
  const client = (database as unknown as { $client: SqlTag }).$client
  try {
    await client`
      delete from klopt.tax_codes
      where entity_id = ${entityId}::uuid
        and code in ('VERL9-ONTV', 'VERL9-VOOR')
    `
  } finally {
    await closeDatabase(database)
  }
}

async function endCode(entityId: string, code: string, validTo: string): Promise<void> {
  const database = createDatabase({ url: DATABASE_URL, maxConnections: 2 })
  const client = (database as unknown as { $client: SqlTag }).$client
  try {
    await client`
      update klopt.tax_codes
      set valid_to = ${validTo}::date
      where entity_id = ${entityId}::uuid
        and code = ${code}
    `
  } finally {
    await closeDatabase(database)
  }
}

test('an owner adds a missing pair and sees both codes on the list', async ({ page }) => {
  await anOwner(page, 'BTW Codes BV')

  const entityRes = await page.request.get('/api/v1/entity')
  expect(entityRes.ok()).toBe(true)
  const entity = (await entityRes.json()) as { id: string }
  await dropPair(entity.id)

  await page.goto('/tax-codes')
  await expect(page.getByRole('heading', { name: 'Btw-codes' })).toBeVisible()
  await hydrated(page)

  await expect(page.getByText('VERL9-ONTV', { exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: 'Code toevoegen' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('9% btw verlegd naar jou', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Voegt 2 codes toe')).toBeVisible()

  await dialog.getByRole('radio', { name: /9% btw verlegd naar jou/ }).click()
  await dialog.getByRole('button', { name: 'Toevoegen' }).click()
  await expect(dialog).toBeHidden()

  await expect(page.getByText(/is toegevoegd/)).toBeVisible()
  await expect(page.getByText('VERL9-ONTV', { exact: true })).toBeVisible()
  await expect(page.getByText('VERL9-VOOR', { exact: true })).toBeVisible()
})

function unusedL9EndButton(page: Page) {
  return page
    .getByRole('row')
    .filter({ has: page.getByText('L9', { exact: true }) })
    .getByRole('button', { name: 'Niet meer gebruiken' })
}

test('an owner ends a code with confirm, then restores it', async ({ page }) => {
  await anOwner(page, 'Eind Codes BV')
  await page.goto('/tax-codes')
  await expect(page.getByRole('heading', { name: 'Btw-codes' })).toBeVisible()
  await hydrated(page)

  // L9 is unused on a fresh administration.
  const endButton = unusedL9EndButton(page)
  await expect(endButton).toBeVisible()
  await endButton.click()

  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toBeVisible()
  await expect(confirm.getByRole('heading')).toContainText(/\(L9\) niet meer gebruiken\?/)
  await expect(confirm).toContainText(
    /Vanaf .+ kun je deze code niet meer kiezen\. Bestaande boekingen blijven staan\. Je kunt dit terugdraaien\./,
  )
  await confirm.getByRole('button', { name: 'Niet meer gebruiken' }).click()
  await expect(confirm).toBeHidden()
  await expect(page.getByText(/niet meer kiezen/)).toBeVisible()
  await expect(page.getByText(/Niet meer te kiezen vanaf/)).toBeVisible()

  const row = page.getByRole('row').filter({ has: page.getByText('L9', { exact: true }) })
  await expect(row.getByRole('button', { name: 'Weer gebruiken' })).toBeVisible()
  await row.getByRole('button', { name: 'Weer gebruiken' }).click()
  await expect(page.getByText(/weer kiezen/)).toBeVisible()
  await expect(unusedL9EndButton(page)).toBeVisible()
})

test('Esc closes the end confirm and returns focus to the row button', async ({ page }) => {
  await anOwner(page, 'Esc Confirm BV')
  await page.goto('/tax-codes')
  await hydrated(page)

  const endButton = unusedL9EndButton(page)
  await endButton.click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(confirm).toBeHidden()
  await expect(endButton).toBeFocused()
})

test('Enter on the confirm action ends the code', async ({ page }) => {
  await anOwner(page, 'Enter Confirm BV')
  await page.goto('/tax-codes')
  await hydrated(page)

  const endButton = unusedL9EndButton(page)
  await endButton.click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toBeVisible()
  const action = confirm.getByRole('button', { name: 'Niet meer gebruiken' })
  await expect(action).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(confirm).toBeHidden()
  await expect(
    page
      .getByRole('row')
      .filter({ has: page.getByText('L9', { exact: true }) })
      .getByRole('button', { name: 'Weer gebruiken' }),
  ).toBeVisible()
})

test('an ended H21 is not offered on a new sales invoice', async ({ page }) => {
  await anOwner(page, 'Ended H21 BV')

  const entityRes = await page.request.get('/api/v1/entity')
  expect(entityRes.ok()).toBe(true)
  const entity = (await entityRes.json()) as { id: string }
  await endCode(entity.id, 'H21', '2020-12-31')

  await enableAdvancedMode(page)
  await page.goto('/invoices/new')
  const vat = page.getByLabel(/Btw regel 1/)
  await expect(vat).toBeVisible()
  // Empty default — H21 ended, so we do not silently pick L9.
  await expect(vat).toContainText(/Kies een btw-tarief/)
  await vat.click()
  const list = page.getByRole('listbox')
  await expect(list).toBeVisible()
  await expect(list.getByRole('option', { name: /H21/ })).toHaveCount(0)
  await expect(list.getByRole('option', { name: /L9/ })).toBeVisible()
})

test('a bookkeeper cannot reach the Btw-codes screen', async ({ browser }) => {
  const owner = await browser.newContext()
  const keeper = await browser.newContext()

  try {
    const ownerPage = await owner.newPage()
    await anOwner(ownerPage, 'Gedeelde BTW BV')

    const keeperPage = await keeper.newPage()
    const keeperEmail = uniqueEmail()
    await keeperPage.goto('/sign-in')
    await signIn(keeperPage, keeperEmail)
    await expect(keeperPage.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()

    await ownerPage.goto('/members')
    const invite = ownerPage.locator('form', {
      has: ownerPage.getByRole('button', { name: 'Uitnodigen' }),
    })
    await invite.getByLabel('E-mail').fill(keeperEmail)
    await chooseOption(ownerPage, 'Rol', 'Boekhouder', invite)
    await ownerPage.getByRole('button', { name: 'Uitnodigen' }).click()
    await expect(ownerPage.getByText(new RegExp(`${keeperEmail} heeft nu toegang`))).toBeVisible()

    await expect(keeperPage.getByRole('link', { name: 'Btw-codes' })).toHaveCount(0)

    await keeperPage.goto('/tax-codes')
    await expect(keeperPage.getByRole('heading', { name: 'Btw-codes' })).toBeVisible()
    await expect(keeperPage.getByRole('alert')).toContainText(
      'Alleen de eigenaar of accountant kan btw-codes beheren.',
    )
    await expect(keeperPage.getByRole('button', { name: 'Code toevoegen' })).toHaveCount(0)
  } finally {
    await owner.close()
    await keeper.close()
  }
})
