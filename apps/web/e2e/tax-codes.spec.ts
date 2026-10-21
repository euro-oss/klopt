import { expect, test, type Page } from '@playwright/test'
import { closeDatabase, createDatabase, runMigrations } from '@klopt/db'
import { chooseOption, DATABASE_URL, hydrated, signIn, uniqueEmail } from './support'

/**
 * BTW-codes beheren: add a missing pair, and keep bookkeepers out.
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

test('an owner adds a missing pair and sees both codes on the list', async ({ page }) => {
  await anOwner(page, 'BTW Codes BV')

  const entityRes = await page.request.get('/api/v1/entity')
  expect(entityRes.ok()).toBe(true)
  const entity = (await entityRes.json()) as { id: string }
  await dropPair(entity.id)

  await page.goto('/tax-codes')
  await expect(page.getByRole('heading', { name: 'BTW-codes' })).toBeVisible()
  await hydrated(page)

  await expect(page.getByRole('cell', { name: 'VERL9-ONTV', exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: 'Code toevoegen' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('VERL9-ONTV + VERL9-VOOR', { exact: true })).toBeVisible()

  await dialog.getByRole('radio', { name: /VERL9-ONTV \+ VERL9-VOOR/ }).check()
  await dialog.getByRole('button', { name: 'Toevoegen' }).click()
  await expect(dialog).toBeHidden()

  await expect(page.getByRole('cell', { name: 'VERL9-ONTV', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'VERL9-VOOR', exact: true })).toBeVisible()
})

test('a bookkeeper cannot reach the BTW-codes screen', async ({ browser }) => {
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

    await expect(keeperPage.getByRole('link', { name: 'BTW-codes' })).toHaveCount(0)

    await keeperPage.goto('/tax-codes')
    await expect(keeperPage.getByRole('heading', { name: 'BTW-codes' })).toBeVisible()
    await expect(keeperPage.getByRole('alert')).toContainText(/eigenaar of accountant/)
    await expect(keeperPage.getByRole('button', { name: 'Code toevoegen' })).toHaveCount(0)
  } finally {
    await owner.close()
    await keeper.close()
  }
})
