import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { bookedCountFromReport, type ImportRunReportView } from '../src/lib/import-wizard-run'
import { DATABASE_URL, signIn, uniqueEmail } from './support'
import {
  startNullRateMoneybirdStandIn,
  startOneDocumentMoneybirdStandIn,
  startPreValidFromMoneybirdStandIn,
  type MoneybirdStandIn,
} from './support/moneybird-stand-in'

/**
 * Import wizard phone layout (#134 / #180 QA blocker 7): 390 light/dark past Source.
 */

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

test.beforeEach(async ({ page }) => {
  const delayMs = process.env['KLOPT_E2E_API_DELAY_MS']
  if (delayMs === undefined || delayMs === '') return
  const ms = Number(delayMs)
  await page.route(/\/api\//, async (route) => {
    const nonGetOnly = process.env['KLOPT_E2E_API_DELAY_NON_GET_ONLY'] === '1'
    if (!nonGetOnly || route.request().method() !== 'GET') {
      await new Promise((resolve) => setTimeout(resolve, ms))
    }
    await route.continue()
  })
})

async function anAdministration(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam', { exact: true }).fill('Import Phone BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
}

async function ensureDisconnected(page: Page): Promise<void> {
  const disconnect = page.getByRole('button', { name: 'Verbinding verbreken' })
  const token = page.getByLabel('Persoonlijk API-token')
  await expect(disconnect.or(token)).toBeVisible({ timeout: 30_000 })
  if (!(await disconnect.isVisible())) return
  await disconnect.click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Verbinding verbreken' }).click()
  await expect(page.getByLabel('Persoonlijk API-token')).toBeVisible({ timeout: 30_000 })
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate((value) => {
    document.documentElement.classList.toggle('dark', value === 'dark')
  }, theme)
}

async function assertImportWizardNoOverflow(page: Page, label: string): Promise<void> {
  const fits = await page.evaluate(() => {
    const wizard = document.querySelector('[data-slot="import-wizard"]')
    if (!wizard || !(wizard instanceof HTMLElement)) {
      return { ok: false as const, detail: 'missing [data-slot="import-wizard"]' }
    }
    const body =
      wizard.querySelector('[class*="max-md:pb-28"]') ??
      wizard.querySelector('.min-w-0.flex-1') ??
      wizard
    if (!(body instanceof HTMLElement)) {
      return { ok: false as const, detail: 'missing wizard scroll body' }
    }
    const wizardRect = wizard.getBoundingClientRect()
    const right = wizardRect.left + wizard.clientWidth
    if (body.scrollWidth > body.clientWidth + 1) {
      for (const el of body.querySelectorAll('*')) {
        if (el.closest('footer')) continue
        const rect = el.getBoundingClientRect()
        if (rect.width < 1 || rect.height < 1) continue
        if (rect.right > right + 1) {
          return {
            ok: false as const,
            detail: `wizard body scrollWidth ${String(body.scrollWidth)} > clientWidth ${String(body.clientWidth)} (${el.tagName.toLowerCase()} past edge)`,
          }
        }
      }
    }
    for (const el of wizard.querySelectorAll('*')) {
      if (el.closest('footer')) continue
      const rect = el.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) continue
      if (rect.right > right + 1) {
        return {
          ok: false as const,
          detail: `${el.tagName.toLowerCase()} extends to ${String(rect.right)} past wizard ${String(right)}`,
        }
      }
    }
    return { ok: true as const, detail: 'ok' }
  })
  expect(fits.ok, `${label}: ${fits.detail}`).toBe(true)
}

async function assertWizardContentAboveFooter(page: Page, label: string): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await page.waitForTimeout(200)
  const result = await page.evaluate(() => {
    const wizard = document.querySelector('[data-slot="import-wizard"]')
    const body = wizard?.querySelector(':scope > .min-w-0.flex-1')
    const footer = wizard?.querySelector('footer')
    if (!wizard || !body || !footer) {
      return { ok: false as const, detail: 'missing wizard body or footer' }
    }
    const footerTop = footer.getBoundingClientRect().top
    const bodyStyle = window.getComputedStyle(body)
    const paddingBottom = Number.parseFloat(bodyStyle.paddingBottom) || 0
    if (paddingBottom < 80 && window.matchMedia('(max-width: 767px)').matches) {
      return {
        ok: false as const,
        detail: `wizard body padding-bottom ${String(paddingBottom)}px (expected mobile clearance above footer)`,
      }
    }
    for (const el of body.querySelectorAll('*')) {
      if (el.closest('footer')) continue
      const style = window.getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') continue
      const rect = el.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) continue
      if (rect.top < footerTop && rect.bottom > footerTop + 2) {
        return {
          ok: false as const,
          detail: `${el.tagName.toLowerCase()} overlaps footer (${String(rect.top)}–${String(rect.bottom)} vs ${String(footerTop)})`,
        }
      }
    }
    return { ok: true as const, detail: 'ok' }
  })
  expect(result.ok, `${label}: ${result.detail}`).toBe(true)
}

async function assertPhoneWizardLayout(page: Page, label: string): Promise<void> {
  await assertImportWizardNoOverflow(page, label)
  await assertWizardContentAboveFooter(page, label)
}

async function assertVisibleStepOf(page: Page, pattern: RegExp): Promise<void> {
  await expect(
    page.getByRole('paragraph').filter({ hasText: pattern }).filter({ visible: true }),
  ).toBeVisible()
}

async function assertTokenAboveFooter(page: Page): Promise<void> {
  const token = page.getByLabel('Persoonlijk API-token')
  const footer = page.locator('button[data-focus="next"]')
  await expect(token).toBeVisible()
  await expect(footer).toBeVisible()
  const tokenBox = await token.boundingBox()
  const footerBox = await footer.boundingBox()
  expect(tokenBox).not.toBeNull()
  expect(footerBox).not.toBeNull()
  if (tokenBox !== null && footerBox !== null) {
    expect(tokenBox.y + tokenBox.height).toBeLessThanOrEqual(footerBox.y + 2)
  }
}

/** Dutch document count: singular “document”, plural “documenten” (QA blocker 7). */
function assertDocumentCountCopy(text: string, count: number): void {
  if (count === 1) {
    expect(text).toMatch(/1 document(?![en])/)
    expect(text).not.toMatch(/1 documenten/)
  } else {
    expect(text).toMatch(new RegExp(`${String(count)} documenten`))
  }
}

/** Stable label for the visible wizard step (phone step-of line plus main h2 when present). */
async function visibleWizardStepMarker(page: Page): Promise<string> {
  const parts: string[] = []
  const stepOf = page
    .getByRole('paragraph')
    .filter({ hasText: /^Stap \d+ van 6:/ })
    .filter({ visible: true })
  if ((await stepOf.count()) > 0) {
    parts.push((await stepOf.first().innerText()).trim())
  }
  const wizard = page.locator('[data-slot="import-wizard"]')
  for (const pattern of [
    /Waar komen je boeken vandaan/,
    /Verbind met Moneybird/,
    /Welke administratie en welke jaren/,
    /Wat we gaan overzetten/,
    /Welke btw-code/,
    /Waar komen je rekeningen/,
    /Wat we nog moeten oplossen|Niets houdt/,
    /Klaar om over te zetten/,
    /Bezig met overzetten/,
  ] as const) {
    const heading = wizard.getByRole('heading', { name: pattern }).filter({ visible: true })
    if ((await heading.count()) > 0) {
      parts.push((await heading.first().innerText()).trim())
      break
    }
  }
  return parts.join('|')
}

async function clickNext(page: Page): Promise<void> {
  const next = page.locator('button[data-focus="next"]')
  await expect
    .poll(async () => (await next.getAttribute('aria-disabled')) !== 'true', { timeout: 60_000 })
    .toBe(true)
  const before = await visibleWizardStepMarker(page)
  await next.click()
  await expect
    .poll(
      async () => {
        if (await page.getByRole('alertdialog').isVisible()) return true
        const after = await visibleWizardStepMarker(page)
        if (before === '' && after !== '') return true
        return after !== before && after !== ''
      },
      { timeout: 30_000 },
    )
    .toBe(true)
}

/** Fresh Bron (source pick), clearing saved wizard progress when the resume card is shown. */
async function ensureFreshBronStep(page: Page): Promise<void> {
  await page.goto('/importeren')
  const bronHeading = page.getByRole('heading', { name: /Waar komen je boeken vandaan/ })
  const resumeSection = page.locator('section').filter({
    has: page.getByRole('button', { name: 'Doorgaan' }),
  })
  await expect(bronHeading.or(resumeSection)).toBeVisible({ timeout: 30_000 })
  if (await bronHeading.isVisible()) return

  const clearDialog = page.getByRole('alertdialog', { name: /Je voortgang wissen/ })
  const restartBtn = resumeSection.getByRole('button', { name: 'Opnieuw beginnen' })
  await expect(async () => {
    await restartBtn.click()
    await expect(clearDialog.or(bronHeading)).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })

  if (!(await bronHeading.isVisible())) {
    await expect(clearDialog).toBeVisible()
    await clearDialog.getByRole('button', { name: 'Opnieuw beginnen' }).click()
  }
  await expect(bronHeading).toBeVisible({ timeout: 30_000 })
}

async function waitForYearCheckbox(page: Page, yearLabel: string): Promise<void> {
  await expect(page.getByRole('checkbox', { name: /^202\d$/ }).first()).toBeVisible({
    timeout: 60_000,
  })
  await expect(page.getByRole('checkbox', { name: yearLabel })).toBeVisible({ timeout: 60_000 })
}

async function pickMoneybirdOnBron(page: Page): Promise<void> {
  await ensureFreshBronStep(page)
  const moneybird = page.getByRole('radio', { name: /Moneybird/ })
  await expect(moneybird).toBeEnabled({ timeout: 15_000 })
  await moneybird.click()
  await clickNext(page)
  await expect(page.getByRole('heading', { name: /Verbind met Moneybird/ })).toBeVisible()
}

async function fillVerbindenStandIn(page: Page, standIn: MoneybirdStandIn): Promise<void> {
  await ensureDisconnected(page)
  await expect(page.getByLabel('Persoonlijk API-token')).toBeVisible({ timeout: 30_000 })
  await page.getByLabel('Persoonlijk API-token').fill(standIn.token)
  const baseUrl = page.getByLabel('API-adres')
  if (!(await baseUrl.isVisible())) {
    await page
      .locator('details')
      .filter({ hasText: /Geavanceerd|Boekhouddetails/ })
      .locator('summary')
      .click()
  }
  await expect(baseUrl).toBeVisible()
  await baseUrl.fill(standIn.baseUrl)
}

async function connectStandIn(page: Page, standIn: MoneybirdStandIn): Promise<void> {
  await pickMoneybirdOnBron(page)
  await fillVerbindenStandIn(page, standIn)
  await clickNext(page)
  await expect(
    page.getByRole('heading', { name: /Welke administratie en welke jaren/ }),
  ).toBeVisible({ timeout: 30_000 })
}

async function advanceToOverzicht(page: Page, yearLabel = '2026'): Promise<void> {
  await page.getByRole('button', { name: 'Administraties ophalen' }).click()
  await expect(page.getByText('Voorbeeld BV')).toBeVisible({ timeout: 30_000 })
  await page.getByText('Voorbeeld BV').click()
  await waitForYearCheckbox(page, yearLabel)
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
  await clickNext(page)
  await expect(page.getByRole('heading', { name: /Klaar om over te zetten/ })).toBeVisible()
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
      const save = sheet.getByRole('button', { name: 'Opslaan' })
      await expect(save).toBeEnabled({ timeout: 15_000 })
      await save.click()
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

async function installPartialImportFinishHook(
  mode: number | 'first-running' | 'when-booked',
): Promise<() => void> {
  process.env['KLOPT_ENCRYPTION_KEY'] = 'e2e-encryption-key-not-for-production-01234'
  const { MoneybirdImportRepository } = await import('@klopt/db')
  // eslint-disable-next-line @typescript-eslint/unbound-method -- prototype stub
  const originalFinish = MoneybirdImportRepository.prototype.finish
  let blocked = false

  const reportBookedCount = (report: Parameters<typeof originalFinish>[0]['report']): number => {
    if (report === null || report === undefined || typeof report !== 'object') return 0
    const commit =
      'commit' in report && report.commit !== null && typeof report.commit === 'object'
        ? (report.commit as ImportRunReportView)
        : null
    if (commit !== null) {
      return bookedCountFromReport(commit)
    }
    return bookedCountFromReport(report)
  }

  MoneybirdImportRepository.prototype.finish = async function finishOverride(
    this: InstanceType<typeof MoneybirdImportRepository>,
    request: Parameters<typeof originalFinish>[0],
  ) {
    if (mode === 'first-running') {
      if (!blocked && request.state === 'running') {
        blocked = true
        throw new Error('report save failed after commit')
      }
    } else if (mode === 'when-booked') {
      if (!blocked && request.state === 'running' && reportBookedCount(request.report) >= 1) {
        blocked = true
        throw new Error('report save failed after commit')
      }
    } else if (!blocked) {
      const count = reportBookedCount(request.report)
      if (
        count === mode &&
        (request.state === 'running' || request.state === 'done' || request.state === 'failed')
      ) {
        blocked = true
        throw new Error('report save failed after commit')
      }
    }
    return originalFinish.call(this, request)
  }
  return () => {
    MoneybirdImportRepository.prototype.finish = originalFinish
  }
}

async function tickMoneybirdImportWorker(): Promise<void> {
  const { importMoneybirdAdministration } = await import('../../worker/src/moneybird.js')
  const { createFilesystemDocumentStore } = await import('@klopt/adapters')
  const { createDatabase, closeDatabase } = await import('@klopt/db')
  const directory = mkdtempSync(join(tmpdir(), 'mb-phone-worker-tick-'))
  const db = createDatabase({ url: DATABASE_URL, maxConnections: 2 })
  try {
    const store = createFilesystemDocumentStore({ directory })
    for (let i = 0; i < 8; i += 1) {
      const result = await importMoneybirdAdministration(db, store)
      if (result.state === 'idle') break
    }
  } finally {
    await closeDatabase(db)
  }
}

async function drivePartialImportStop(_page: Page): Promise<void> {
  await tickMoneybirdImportWorker()
}

test('390 connect and VAT steps do not overflow in light and dark', async ({ page }) => {
  test.setTimeout(240_000)
  const standIn = await startPreValidFromMoneybirdStandIn()
  try {
    await anAdministration(page)
    await page.setViewportSize({ width: 390, height: 844 })
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme)
      await pickMoneybirdOnBron(page)
      await assertVisibleStepOf(page, /Stap 2 van 6:\s*Verbinden/)
      await fillVerbindenStandIn(page, standIn)
      await assertPhoneWizardLayout(page, `${theme} connect`)
      await assertTokenAboveFooter(page)

      await clickNext(page)
      await page.getByRole('button', { name: 'Administraties ophalen' }).click()
      await expect(page.getByText('Voorbeeld BV')).toBeVisible({ timeout: 30_000 })
      await page.getByText('Voorbeeld BV').click()
      await waitForYearCheckbox(page, '2025')
      await clickNext(page)
      await clickNext(page)
      await expect(page.getByRole('heading', { name: /Welke btw-code/ })).toBeVisible()
      await assertVisibleStepOf(page, /Stap 5 van 6:\s*Problemen/)
      await mapAllOpenRates(page)
      await assertPhoneWizardLayout(page, `${theme} btw`)
    }
  } finally {
    await standIn.close()
  }
})

test('390 problems step: overflow, step-of, and document singular in light and dark', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const standIn = await startPreValidFromMoneybirdStandIn()
  try {
    await anAdministration(page)
    await page.setViewportSize({ width: 390, height: 844 })
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme)
      await connectStandIn(page, standIn)
      await page.getByRole('button', { name: 'Administraties ophalen' }).click()
      await expect(page.getByText('Voorbeeld BV')).toBeVisible({ timeout: 30_000 })
      await page.getByText('Voorbeeld BV').click()
      await waitForYearCheckbox(page, '2025')
      await clickNext(page)
      await clickNext(page)
      await mapAllOpenRates(page)
      await clickNext(page)
      await mapAccountsIfNeeded(page)
      await clickNext(page)
      await expect(page.getByText(/geldt nog niet/i).first()).toBeVisible({ timeout: 30_000 })
      await assertVisibleStepOf(page, /Stap 5 van 6:\s*Problemen/)
      await assertPhoneWizardLayout(page, `${theme} problems`)
      const finding = page.getByText(/1 document[^e]/).first()
      await expect(finding).toBeVisible()
      assertDocumentCountCopy(await finding.innerText(), 1)
    }
  } finally {
    await standIn.close()
  }
})

test('390 running import does not overflow in light and dark', async ({ page }) => {
  test.setTimeout(180_000)
  const standIn = await startNullRateMoneybirdStandIn()
  try {
    await anAdministration(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await connectStandIn(page, standIn)
    await advanceToOverzicht(page)
    await clickNext(page)
    const confirmDialog = page.getByRole('alertdialog')
    await expect(confirmDialog).toBeVisible()
    const title = await confirmDialog.getByRole('heading').innerText()
    const countMatch = title.match(/(\d+)\s+document(en)?\s+importeren/)
    expect(countMatch).not.toBeNull()
    assertDocumentCountCopy(title, Number(countMatch![1]!))
    await confirmDialog.getByRole('button', { name: /Overzetten bevestigen/i }).click()
    await expect(page.getByRole('heading', { name: /Bezig met overzetten/ })).toBeVisible({
      timeout: 60_000,
    })
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme)
      await assertVisibleStepOf(page, /Stap 6 van 6:\s*Importeren/)
      await assertPhoneWizardLayout(page, `${theme} running`)
      await expect(page.getByRole('button', { name: 'Opnieuw proberen' })).toHaveCount(0)
    }
  } finally {
    await standIn.close()
  }
})

test('390 stopped import with nothing booked shows one Opnieuw proberen in light and dark', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const standIn = await startNullRateMoneybirdStandIn()
  try {
    await anAdministration(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await connectStandIn(page, standIn)
    await advanceToOverzicht(page)
    await clickNext(page)
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: /Overzetten bevestigen/i })
      .click()
    await expect(page.getByRole('heading', { name: /Bezig met overzetten/ })).toBeVisible({
      timeout: 60_000,
    })

    process.env['KLOPT_ENCRYPTION_KEY'] = 'e2e-encryption-key-not-for-production-01234'
    const { importMoneybirdAdministration } = await import('../../worker/src/moneybird.js')
    const { createFilesystemDocumentStore } = await import('@klopt/adapters')
    const { createDatabase, closeDatabase } = await import('@klopt/db')
    const directory = mkdtempSync(join(tmpdir(), 'mb-phone-stopped-'))
    const db = createDatabase({ url: DATABASE_URL, maxConnections: 2 })
    const rejectingFetch: typeof globalThis.fetch = () =>
      Promise.reject(new Error('forced pre-commit network failure'))
    try {
      const store = createFilesystemDocumentStore({ directory })
      for (let i = 0; i < 8; i += 1) {
        const result = await importMoneybirdAdministration(db, store, rejectingFetch)
        if (result.state === 'idle') break
      }
    } finally {
      await closeDatabase(db)
    }

    await expect(page.getByText(/We hebben niets geboekt/i)).toBeVisible({ timeout: 120_000 })
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme)
      await expect(page.getByRole('button', { name: 'Opnieuw proberen' })).toHaveCount(1)
      await assertPhoneWizardLayout(page, `${theme} stopped-nothing`)
    }
  } finally {
    await standIn.close()
  }
})

test('390 stopped partway shows booked plural and one retry path in light and dark', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const standIn = await startNullRateMoneybirdStandIn()
  try {
    await anAdministration(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await connectStandIn(page, standIn)
    await advanceToOverzicht(page)
    await clickNext(page)
    const restore = await installPartialImportFinishHook('first-running')
    try {
      await page
        .getByRole('alertdialog')
        .getByRole('button', { name: /Overzetten bevestigen/i })
        .click()
      await expect(page.getByRole('heading', { name: /Bezig met overzetten/ })).toBeVisible({
        timeout: 60_000,
      })
      await drivePartialImportStop(page)

      await expect(page.getByText(/staan al in Klopt/i)).toBeVisible({ timeout: 120_000 })
      const bookedLine = page.getByText(/document staat al in Klopt|documenten staan al in Klopt/)
      await expect(bookedLine.first()).toBeVisible()
      const bookedText = await bookedLine.first().innerText()
      const bookedCountMatch = bookedText.match(/(\d+)/)
      expect(bookedCountMatch).not.toBeNull()
      assertDocumentCountCopy(bookedText, Number(bookedCountMatch![1]!))
      for (const theme of ['light', 'dark'] as const) {
        await setTheme(page, theme)
        await expect(page.getByRole('button', { name: 'De rest overzetten' })).toHaveCount(1)
        await expect(page.getByRole('button', { name: 'Opnieuw proberen' })).toHaveCount(0)
        await assertPhoneWizardLayout(page, `${theme} stopped-partial`)
      }
    } finally {
      restore()
    }
  } finally {
    await standIn.close()
  }
})

test('390 stopped partial with one booked document shows singular bookedCount_one copy', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const standIn = await startOneDocumentMoneybirdStandIn()
  try {
    await anAdministration(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await connectStandIn(page, standIn)
    await advanceToOverzicht(page)
    await clickNext(page)
    const restore = await installPartialImportFinishHook('first-running')
    try {
      await page
        .getByRole('alertdialog')
        .getByRole('button', { name: /Overzetten bevestigen/i })
        .click()
      await expect(page.getByRole('heading', { name: /Bezig met overzetten/ })).toBeVisible({
        timeout: 60_000,
      })
      await drivePartialImportStop(page)

      const bookedLine = page.getByText(/document staat al in Klopt|documenten staan al in Klopt/)
      await expect(bookedLine.first()).toBeVisible({ timeout: 120_000 })
      const bookedText = await bookedLine.first().innerText()
      expect(bookedText).toMatch(/(\d+)/)
      const bookedCount = Number(bookedText.match(/(\d+)/)![1]!)
      expect(bookedCount, 'fixture must stop partial with exactly one booked document').toBe(1)
      await expect(page.getByText('1 document staat al in Klopt')).toBeVisible()
      for (const theme of ['light', 'dark'] as const) {
        await setTheme(page, theme)
        await assertPhoneWizardLayout(page, `${theme} stopped-partial-one`)
      }
    } finally {
      restore()
    }
  } finally {
    await standIn.close()
  }
})
