// Keyboard smoke test for the prototype: walks each flow with keys only.
// Usage: node tools/smoke.mjs   (needs playwright-core + a Chrome)
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const indexUrl = pathToFileURL(path.resolve(here, '..', 'index.html')).href
const chrome =
  process.env.CHROME_PATH ||
  ['/usr/local/bin/google-chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync)

const browser = await chromium.launch({ executablePath: chrome })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const active = () =>
  page.evaluate(() => document.activeElement.dataset.fid || document.activeElement.id)
const step = async (name, fn) => {
  await fn()
  console.log('ok', name)
}

await page.goto(indexUrl + '#/findings?theme=light')

await step('findings: j/k move the cursor', async () => {
  assert.equal(await page.locator('[data-card]').count(), 6)
  await page.keyboard.press('j')
  assert.equal(await active(), 'card-f2')
  await page.keyboard.press('k')
  assert.equal(await active(), 'card-f1')
})

await step('account + btw picker: type, Enter, arrow, Enter resolves', async () => {
  await page.keyboard.press('Enter')
  assert.equal(await active(), 'acc-q')
  await page.keyboard.type('tel')
  await page.keyboard.press('Enter')
  assert.equal(await active(), 'vat-VH21')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(900)
  assert.equal(await page.locator('[data-card]').count(), 5)
  assert.match(await page.locator('#toast').innerText(), /Telefoon en internet · 9% btw/)
})

await step('currency: override relabels, reset returns to ECB, Esc closes', async () => {
  await page.keyboard.press('Enter')
  await page.fill('#fx-rate', '1,15')
  assert.equal(await page.locator('[data-fx=badge]').innerText(), 'Aangepast · 2026-10-16')
  assert.match(await page.locator('[data-fx=json]').textContent(), /"override:2026-10-16"/)
  await page.click('[data-action=fx-reset]')
  assert.equal(await page.locator('[data-fx=badge]').innerText(), 'ECB · 2026-10-16')
  assert.equal(await page.locator('[data-fx=reset]').isHidden(), true)
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('[role=dialog]').count(), 0)
  assert.equal(await active(), 'card-f2')
})

await step('one-click with preview: Enter previews, Enter applies', async () => {
  await page.keyboard.press('j')
  await page.keyboard.press('Enter')
  assert.equal(await page.locator('[data-action=apply]').count(), 1)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(900)
  assert.equal(await page.locator('[data-card]').count(), 4)
})

await step('palette: Geavanceerd has no shortcut and toggles the nav', async () => {
  await page.keyboard.press('Control+k')
  await page.keyboard.type('gea')
  assert.match(
    await page.locator('#pal-list').innerText(),
    /Geavanceerd aanzetten\s+Geen sneltoets/,
  )
  await page.keyboard.press('Enter')
  assert.equal(await page.locator('aside >> text=Journaalposten').count(), 1)
})

await step('chords: g o opens koppelen; Enter, Enter matches a row', async () => {
  await page.locator('body').click({ position: { x: 1300, y: 880 } })
  await page.keyboard.press('g')
  await page.keyboard.press('o')
  await page.waitForTimeout(100)
  assert.equal(await page.evaluate(() => location.hash), '#/bank')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(900)
  assert.equal(await page.locator('[data-row]').count(), 6)
})

await step('invoice: Enter through four steps, confirm, sent', async () => {
  await page.keyboard.press('n')
  await page.keyboard.press('f')
  await page.waitForTimeout(100)
  await page.locator('h1').click()
  for (let i = 0; i < 4; i++) await page.keyboard.press('Enter')
  assert.equal(await page.locator('[role=alertdialog]').count(), 1)
  await page.keyboard.press('Enter')
  assert.match(await page.locator('h1').innerText(), /Verstuurd/)
})

await step('theme toggle', async () => {
  await page.click('header.md\\:flex [data-action=theme]')
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), true)
})

await browser.close()
assert.deepEqual(errors, [])
console.log('all good')
