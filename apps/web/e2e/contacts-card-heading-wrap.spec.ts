import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, enableAdvancedMode, hydrated, signIn, uniqueEmail } from './support'

/**
 * Contacts card heading wrap (#176): unbroken long supplier name must wrap
 * inside the Relatiekaart at 1440, light and dark — no page or heading
 * overflow, no ellipsis. Empty supplier line stays "Niets openstaand".
 * Below md the Relatiekaart stays hidden (phone card is #130).
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

/** No spaces in the long token so wrapping cannot cheat on word breaks. */
const LONG_NAME = 'Zandbankadviesenaccountancypartnersholdingbeheerdersmaatschappij B.V.'

async function openAdmin(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill('Relaties Wrap Demo BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
  await enableAdvancedMode(page)
  await hydrated(page)
}

async function seedLongNameSupplier(page: Page): Promise<string> {
  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('CRE-1761')
  await page.getByLabel('Naam', { exact: true }).fill(LONG_NAME)
  await page.getByRole('textbox', { name: 'Btw-nummer' }).fill('NL000001761B99')
  await page.getByLabel('E-mail').fill('inkoop@example.nl')
  await page.getByLabel('IBAN').fill('NL91ABNA0417164300')
  await page.getByRole('checkbox', { name: /Klant/ }).uncheck()
  await page.getByRole('checkbox', { name: /Leverancier/ }).check()
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(
    page.getByRole('button', {
      name: new RegExp(LONG_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    }),
  ).toBeVisible()
  const id = new URL(page.url()).searchParams.get('id')
  expect(id, 'selected contact id').toBeTruthy()
  return id!
}

async function persistThemeCookie(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.context().addCookies([
    {
      name: 'klopt_theme',
      value: theme,
      domain: 'localhost',
      path: '/',
    },
  ])
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await persistThemeCookie(page, theme)
  await page.evaluate((t) => {
    document.cookie = `klopt_theme=${t}; path=/; max-age=31536000; samesite=lax`
    document.documentElement.classList.toggle('dark', t === 'dark')
  }, theme)
  await page.waitForFunction(
    (wantDark) => document.documentElement.classList.contains('dark') === wantDark,
    theme === 'dark',
  )
}

async function assertHeadingWrapsInCard(page: Page): Promise<void> {
  const card = page.getByRole('complementary', { name: 'Relatiekaart' })
  await expect(card).toBeVisible()
  const heading = card.locator('[data-contact-name]')
  await expect(heading).toBeVisible()
  await expect(heading).toHaveText(LONG_NAME)
  await expect(heading).not.toHaveCSS('text-overflow', 'ellipsis')
  await expect(card).toContainText('Niets openstaand')

  const pageOverflow = await page.evaluate(() => {
    const root = document.documentElement
    return root.scrollWidth > root.clientWidth
  })
  expect(pageOverflow, 'page overflows horizontally').toBe(false)

  const metrics = await heading.evaluate((el) => {
    const cardEl = el.closest('[aria-label="Relatiekaart"]')
    if (!(cardEl instanceof HTMLElement)) {
      return { ok: false as const, reason: 'heading not inside card' }
    }
    const headingBox = el.getBoundingClientRect()
    const cardBox = cardEl.getBoundingClientRect()
    return {
      ok: true as const,
      headingScrollWider: el.scrollWidth > el.clientWidth + 1,
      headingRight: headingBox.right,
      cardRight: cardBox.right,
    }
  })
  expect(metrics.ok, 'ok' in metrics && !metrics.ok ? metrics.reason : 'heading metrics').toBe(true)
  if (!metrics.ok) return
  expect(metrics.headingScrollWider, 'heading still clipped').toBe(false)
  expect(metrics.headingRight, 'heading spills past card').toBeLessThanOrEqual(
    metrics.cardRight + 1,
  )
}

const THEMES = ['light', 'dark'] as const

test('card heading wraps a long unbroken name at 1440 light and dark; hidden at 390', async ({
  page,
}) => {
  await openAdmin(page)
  const id = await seedLongNameSupplier(page)

  const card = page.getByRole('complementary', { name: 'Relatiekaart' })
  await expect(card).toBeVisible()
  await expect(card).toContainText(LONG_NAME)

  for (const theme of THEMES) {
    await persistThemeCookie(page, theme)
    await page.setViewportSize({ width: 1440, height: 1040 })
    await page.goto(`/contacts?id=${id}`)
    await hydrated(page)
    await setTheme(page, theme)
    await assertHeadingWrapsInCard(page)

    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.locator('[data-phone-tab-bar]')).toBeVisible()
    // Relatiekaart is desktop-only; phone card belongs to #130.
    await expect(card).toBeHidden()
    await expect(page.getByText('Niets openstaand')).toBeHidden()
    await expect(card.locator('kbd', { hasText: 'e' })).toBeHidden()
  }
})
