import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, signIn, uniqueEmail } from './support'

/**
 * Public PNGs for #113 — icon library swap to lucide-react.
 *
 * Captures Home, nav/sidebar (desktop) / phone tab bar (390), and ⌘K palette
 * at 1440 / 390, light / dark. Prefix with before- (main tip before the swap)
 * or after- (this tip) via PR_SCREENSHOT_PHASE.
 *
 * Run with:
 *   CAPTURE_PR_SCREENSHOTS=1 PR_SCREENSHOT_NUMBER=113 PR_SCREENSHOT_PHASE=before \
 *     pnpm --filter @klopt/web exec playwright test e2e/pr-screenshots-113.spec.ts
 */

const PR = process.env['PR_SCREENSHOT_NUMBER'] ?? '113'
const PHASE = process.env['PR_SCREENSHOT_PHASE'] ?? 'after'
const OUT = join(import.meta.dirname, '..', '..', '..', 'docs', 'pr-screenshots', PR)
const CAPTURE = process.env['CAPTURE_PR_SCREENSHOTS'] === '1'

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  if (CAPTURE) mkdirSync(OUT, { recursive: true })
})

test.skip(!CAPTURE, 'Set CAPTURE_PR_SCREENSHOTS=1 to write docs/pr-screenshots/')

async function ready(page: Page, name: string): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()
  await page.goto('/setup')
  await expect(page.getByLabel('Naam van de administratie')).toBeVisible()
  await page.getByLabel('Naam van de administratie').fill(name)
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
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

async function gotoThemed(page: Page, path: string, theme: 'light' | 'dark'): Promise<void> {
  await persistThemeCookie(page, theme)
  await page.goto(path)
  await setTheme(page, theme)
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(100)
  await page.screenshot({ path: join(OUT, `${PHASE}-${name}`), fullPage: false })
}

const VIEWPORTS = [
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'mobile-390', width: 390, height: 844 },
] as const

test('icon swap screenshots: home, nav, command palette', async ({ page }) => {
  test.setTimeout(180_000)
  await ready(page, 'Icon Swap BV')

  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    for (const theme of ['light', 'dark'] as const) {
      await gotoThemed(page, '/', theme)
      await expect(
        page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
      ).toBeVisible()
      await shoot(page, `home-${theme}-${vp.name}.png`)

      if (vp.width === 1440) {
        // Sidebar is visible on desktop Home — crop-friendly full viewport already
        // shows it; capture again after focusing the nav landmark for clarity.
        await expect(page.locator('.k-nav, nav').first()).toBeVisible()
        await shoot(page, `nav-sidebar-${theme}-${vp.name}.png`)
      } else {
        await expect(page.locator('[data-phone-tab-bar]')).toBeVisible()
        await shoot(page, `nav-sidebar-${theme}-${vp.name}.png`)
      }

      await page.keyboard.press('ControlOrMeta+k')
      const palette = page.getByRole('dialog', { name: 'Commando’s' })
      await expect(palette).toBeVisible()
      await shoot(page, `command-palette-${theme}-${vp.name}.png`)
      await page.keyboard.press('Escape')
      await expect(palette).toBeHidden()
    }
  }
})
