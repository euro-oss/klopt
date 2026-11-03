import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, enableAdvancedMode, hydrated, signIn, uniqueEmail } from './support'

/**
 * PR screenshots for Contacts redesign (#130).
 *
 * Must-have: desktop 1440 light (+ dark bonus). Phone 390 light/dark are bonus
 * until Batch 3 boards. Fixture data: example.nl + fake names only.
 *
 *   CAPTURE_PR_SCREENSHOTS=1 PR_SCREENSHOT_NUMBER=<pr> \
 *     pnpm --filter @klopt/web exec playwright test e2e/pr-screenshots-contacts.spec.ts
 */

const PR = process.env['PR_SCREENSHOT_NUMBER'] ?? '130'
const OUT = join(import.meta.dirname, '..', '..', '..', 'docs', 'pr-screenshots', PR)
const CAPTURE = process.env['CAPTURE_PR_SCREENSHOTS'] === '1'

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  if (CAPTURE) mkdirSync(OUT, { recursive: true })
})

test.skip(!CAPTURE, 'Set CAPTURE_PR_SCREENSHOTS=1 to write docs/pr-screenshots/')

async function openAdmin(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam', { exact: true }).fill('Relaties Schermafdruk BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
  await enableAdvancedMode(page)
  await hydrated(page)
}

async function seedContact(page: Page): Promise<void> {
  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('DEB-1300')
  await page
    .getByLabel('Naam', { exact: true })
    .fill('Zandbank Advies en Accountancy Partners B.V.')
  await page.getByLabel('E-mail').fill('facturen@example.nl')
  await page.getByLabel('Straat').fill('Demoweg')
  await page.getByLabel('Huisnr.').fill('10')
  await page.getByLabel('Postcode').fill('1000 AA')
  await page.getByLabel('Plaats').fill('Amsterdam')
  await page.getByRole('textbox', { name: 'Btw-nummer' }).fill('NL000001006B99')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(
    page.getByRole('button', { name: /Zandbank Advies en Accountancy Partners B\.V\./ }),
  ).toBeVisible()
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
  await page.waitForTimeout(250)
}

async function shoot(
  page: Page,
  name: string,
  size: { width: number; height: number },
): Promise<void> {
  await page.setViewportSize(size)
  await page.waitForTimeout(200)
  await page.screenshot({ path: join(OUT, name), fullPage: false })
}

test('01 empty — desktop 1440 light/dark + phone bonus', async ({ page }) => {
  await openAdmin(page)
  await persistThemeCookie(page, 'light')
  await page.goto('/contacts')
  await setTheme(page, 'light')
  await expect(page.getByText('Nog geen relaties')).toBeVisible()
  await shoot(page, '01-contacts-empty-light-desktop-1440.png', { width: 1440, height: 1040 })

  await setTheme(page, 'dark')
  await shoot(page, '01-contacts-empty-dark-desktop-1440.png', { width: 1440, height: 1040 })

  await setTheme(page, 'light')
  await shoot(page, '01-contacts-empty-light-mobile-390.png', { width: 390, height: 844 })
  await setTheme(page, 'dark')
  await shoot(page, '01-contacts-empty-dark-mobile-390.png', { width: 390, height: 844 })
})

test('02 seeded — desktop 1440 light/dark + phone bonus', async ({ page }) => {
  await openAdmin(page)
  await seedContact(page)
  await persistThemeCookie(page, 'light')
  await page.goto('/contacts')
  await setTheme(page, 'light')
  await page.getByRole('button', { name: /Zandbank Advies en Accountancy Partners B\.V\./ }).click()
  await expect(page.getByRole('complementary', { name: 'Relatiekaart' })).toBeVisible()
  await shoot(page, '02-contacts-data-light-desktop-1440.png', { width: 1440, height: 1040 })

  await setTheme(page, 'dark')
  await shoot(page, '02-contacts-data-dark-desktop-1440.png', { width: 1440, height: 1040 })

  await setTheme(page, 'light')
  await page.setViewportSize({ width: 390, height: 844 })
  const id = new URL(page.url()).searchParams.get('id')
  expect(id).toBeTruthy()
  await page.goto(`/contacts/${id}`)
  await setTheme(page, 'light')
  await expect(page.getByRole('complementary', { name: 'Relatiekaart' })).toBeVisible()
  await shoot(page, '02-contacts-data-light-mobile-390.png', { width: 390, height: 844 })
  await setTheme(page, 'dark')
  await shoot(page, '02-contacts-data-dark-mobile-390.png', { width: 390, height: 844 })
})
