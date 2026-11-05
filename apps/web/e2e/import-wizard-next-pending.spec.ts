import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, signIn, uniqueEmail } from './support'
import {
  installWizardStateSaveDelay,
  isWizardStateSave,
  routeWizardStateSave,
} from './support/import-wizard-save-route'
import { withPngSourceChunk } from './support/png-source-chunk.js'
import { startNullRateMoneybirdStandIn, type MoneybirdStandIn } from './support/moneybird-stand-in'

const CAPTURE = process.env['CAPTURE_PR_SCREENSHOTS'] === '1'
const PR = process.env['PR_SCREENSHOT_NUMBER'] ?? '201'
const OUT = join(import.meta.dirname, '..', '..', '..', 'docs', 'pr-screenshots', PR)
const SCREENSHOT_SOURCE = 'apps/web/e2e/import-wizard-next-pending.spec.ts'

const SIZES = [
  { label: 'desktop-1440', width: 1440, height: 1040 },
  { label: 'mobile-390', width: 390, height: 844 },
] as const

const IMPORT_WIZARD_ADVANCED_CHECKBOX = /Boekhouddetails|Accounting details/i

async function waitImportWizardHydrated(page: Page): Promise<void> {
  await expect(
    page.locator('[data-slot="import-wizard"]').getByRole('checkbox', {
      name: IMPORT_WIZARD_ADVANCED_CHECKBOX,
    }),
  ).toBeEnabled({ timeout: 30_000 })
}

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

async function anAdministration(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam', { exact: true }).fill('Wizard Pending BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
}

async function clickNext(page: Page): Promise<void> {
  await waitImportWizardHydrated(page)
  const next = page.locator('button[data-focus="next"]')
  await expect
    .poll(
      async () => {
        const disabled = await next.getAttribute('aria-disabled')
        const busy = await next.getAttribute('aria-busy')
        return disabled !== 'true' && busy !== 'true'
      },
      { timeout: 60_000 },
    )
    .toBe(true)
  await next.click()
  await expect
    .poll(async () => (await next.getAttribute('aria-busy')) !== 'true', { timeout: 60_000 })
    .toBe(true)
}

async function mapAllOpenRates(page: Page): Promise<void> {
  for (let i = 0; i < 16; i += 1) {
    const confirm = page.getByRole('button', { name: 'Bevestigen' })
    if ((await confirm.count()) === 0) break
    const before = await confirm.count()
    await confirm.first().click()
    await expect(confirm).toHaveCount(before - 1, { timeout: 30_000 })
  }
  for (let i = 0; i < 16; i += 1) {
    const choose = page.getByRole('button', { name: 'Btw-code kiezen' })
    if ((await choose.count()) > 0) {
      await choose.first().click()
      const sheet = page.getByRole('dialog')
      await expect(sheet).toBeVisible()
      await sheet.getByRole('radio').first().click()
      await sheet.getByRole('button', { name: 'Opslaan' }).click()
      await expect(sheet).toHaveCount(0, { timeout: 60_000 })
      continue
    }
    const exclude = page.getByRole('button', { name: /niet overzetten/i })
    if ((await exclude.count()) > 0) {
      const before = await exclude.count()
      await exclude.first().click()
      await expect(exclude).toHaveCount(before - 1, { timeout: 30_000 })
      continue
    }
    break
  }
}

async function mapAccountsIfNeeded(page: Page): Promise<void> {
  for (let i = 0; i < 12; i += 1) {
    const confirm = page.getByRole('button', { name: 'Bevestigen' })
    if ((await confirm.count()) === 0) break
    const before = await confirm.count()
    await confirm.first().click()
    await expect(confirm).toHaveCount(before - 1, { timeout: 30_000 })
  }
}

async function connectStandIn(page: Page, standIn: MoneybirdStandIn): Promise<void> {
  await page.goto('/importeren')
  await page.getByRole('radio', { name: /Moneybird/ }).click()
  await clickNext(page)
  await page
    .locator('details')
    .filter({ hasText: /Geavanceerd|Boekhouddetails/ })
    .locator('summary')
    .click()
  await page.getByLabel('API-adres').fill(standIn.baseUrl)
  await page.getByLabel('Persoonlijk API-token').fill(standIn.token)
  await clickNext(page)
  await expect(
    page.getByRole('heading', { name: /Welke administratie en welke jaren/ }),
  ).toBeVisible({ timeout: 30_000 })
}

async function advanceToProblemen(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Administraties ophalen' }).click()
  await page.getByText('Voorbeeld BV').click()
  await expect(page.getByRole('checkbox', { name: '2026' })).toBeVisible({ timeout: 60_000 })
  await clickNext(page)
  await expect(page.getByRole('heading', { name: /Wat we gaan overzetten/ })).toBeVisible({
    timeout: 30_000,
  })
  await clickNext(page)
  await expect(page.getByRole('heading', { name: /Welke btw-code/ })).toBeVisible()
  await mapAllOpenRates(page)
  await clickNext(page)
  await expect(page.getByRole('heading', { name: /Waar komen je rekeningen/ })).toBeVisible({
    timeout: 30_000,
  })
  await mapAccountsIfNeeded(page)
  await clickNext(page)
  await expect(
    page.getByRole('heading', { name: /Wat we nog moeten oplossen|Niets houdt/ }),
  ).toBeVisible({ timeout: 30_000 })
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate((value) => {
    document.documentElement.classList.toggle('dark', value === 'dark')
  }, theme)
}

async function shootFooter(page: Page, name: string): Promise<void> {
  if (!CAPTURE) return
  mkdirSync(OUT, { recursive: true })
  const footer = page.locator('footer').filter({ has: page.locator('button[data-focus="next"]') })
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme)
    for (const size of SIZES) {
      await page.setViewportSize({ width: size.width, height: size.height })
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      const png = await footer.last().screenshot()
      writeFileSync(
        join(OUT, `${name}-${theme}-${size.label}.png`),
        withPngSourceChunk(png, SCREENSHOT_SOURCE),
      )
    }
  }
}

function wizardStatePost(page: Page) {
  return page.waitForRequest(
    (req) => isWizardStateSave(req) && req.postData()?.includes('overzicht') === true,
  )
}

test('Volgende pending state queues one advance after delayed wizard save (#201)', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const standIn = await startNullRateMoneybirdStandIn()
  try {
    await anAdministration(page)
    await connectStandIn(page, standIn)
    await advanceToProblemen(page)

    let releaseSave: (() => void) | null = null
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve
    })

    await routeWizardStateSave(page, async (route) => {
      await saveGate
      await route.continue()
    })

    const next = page.locator('button[data-focus="next"]')
    const saveRequest = wizardStatePost(page)
    await next.click()
    await next.click()
    await expect(next).toHaveAttribute('aria-busy', 'true')
    await expect(next).toContainText('Opslaan…')
    await shootFooter(page, '01-pending')
    releaseSave!()
    await saveRequest
    await expect(page.getByRole('heading', { name: /Klaar om over te zetten/ })).toBeVisible({
      timeout: 30_000,
    })
    await expect(
      page.getByRole('heading', { name: /Wat we nog moeten oplossen|Niets houdt/ }),
    ).toHaveCount(0)
  } finally {
    await standIn.close()
  }
})

test('Enter during pending wizard save advances once (#201)', async ({ page }) => {
  test.setTimeout(120_000)
  const standIn = await startNullRateMoneybirdStandIn()
  try {
    await installWizardStateSaveDelay(page)
    await anAdministration(page)
    await connectStandIn(page, standIn)
    await advanceToProblemen(page)

    let releaseSave: (() => void) | null = null
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve
    })

    await routeWizardStateSave(page, async (route) => {
      await saveGate
      await route.continue()
    })

    const saveRequest = wizardStatePost(page)
    await page.keyboard.press('Control+Enter')
    await expect(page.locator('button[data-focus="next"]')).toHaveAttribute('aria-busy', 'true')
    releaseSave!()
    await saveRequest
    await expect(page.getByRole('heading', { name: /Klaar om over te zetten/ })).toBeVisible({
      timeout: 30_000,
    })
  } finally {
    await standIn.close()
  }
})

test('failed wizard save shows footer error and stays on the step (#201)', async ({ page }) => {
  test.setTimeout(120_000)
  const standIn = await startNullRateMoneybirdStandIn()
  try {
    await anAdministration(page)
    await connectStandIn(page, standIn)
    await advanceToProblemen(page)

    await routeWizardStateSave(page, async (route) => {
      await route.abort('failed')
    })

    const next = page.locator('button[data-focus="next"]')
    await next.click()
    await expect(
      page.getByRole('heading', { name: /Wat we nog moeten oplossen|Niets houdt/ }),
    ).toBeVisible()
    await expect(page.getByText('Opslaan is niet gelukt. Probeer het opnieuw.')).toBeVisible()
    await expect(next).not.toHaveAttribute('aria-busy', 'true')
    await next.click()
    await expect(page.getByRole('heading', { name: /Klaar om over te zetten/ })).toHaveCount(0)
    await expect(page.getByText('Opslaan is niet gelukt. Probeer het opnieuw.')).toBeVisible()
    await shootFooter(page, '02-save-failed')
  } finally {
    await standIn.close()
  }
})

test.afterAll(() => {
  if (!CAPTURE) return
  const hashes = readdirSync(OUT)
    .filter((name) => name.endsWith('.png'))
    .sort()
    .map((name) => {
      const buf = readFileSync(join(OUT, name))
      return `${name}: sha256:${createHash('sha256').update(buf).digest('hex')}`
    })
  writeFileSync(join(OUT, 'sha256.txt'), `${hashes.join('\n')}\n`)
})
