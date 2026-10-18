// Captures every screen at 1440 (desktop) and 390 (mobile), light and dark.
// Usage: node tools/screenshots.mjs [filter]   (needs playwright-core + a Chrome)
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(here, '..')
const outDir = path.join(rootDir, 'screenshots')
const indexUrl = pathToFileURL(path.join(rootDir, 'index.html')).href

const chrome =
  process.env.CHROME_PATH ||
  ['/usr/local/bin/google-chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync)

// [name, hash, { only: 'desktop' | 'mobile', fullPage, keys: [...] }]
const SCREENS = [
  ['01-dashboard', '#/dashboard', { fullPage: true }],
  ['02-nav-sheet', '#/dashboard?menu=1', { only: 'mobile' }],
  ['02b-nav-sheet-importeren', '#/findings?menu=1&navscroll=1', { only: 'mobile' }],
  ['03-user-menu', '#/dashboard?usermenu=1', {}],
  ['04-command-palette', '#/dashboard?palette=1', {}],
  ['05-findings', '#/findings', { fullPage: true }],
  ['06-finding-one-click-preview', '#/findings?preview=f3&nofocus=1', { fullPage: true }],
  ['07-fix-account-vat', '#/findings?fix=f1', {}],
  ['08-fix-currency-ecb', '#/findings?fix=f2&notes=1', {}],
  ['09-fix-currency-override', '#/findings?fix=f2&fxo=1', {}],
  ['10-findings-all-resolved', '#/findings?state=done', { fullPage: true }],
  ['11-invoice-1-klant', '#/invoice?step=1&q=ho', {}],
  ['12-invoice-2-wat', '#/invoice?step=2', {}],
  ['13-invoice-3-controleren', '#/invoice?step=3', { fullPage: true }],
  ['14-invoice-4-bevestigen', '#/invoice?step=4&confirm=1', {}],
  ['15-invoice-verstuurd', '#/invoice?done=1', {}],
  ['16-bank-match', '#/bank', {}],
  ['17-bank-panel-two-candidates', '#/bank?row=b5&panel=1', {}],
  ['18-bank-uitgave', '#/bank?row=b3&panel=1', {}],
  [
    '19-bank-matched',
    '#/bank?matched=1&toast=Gekoppeld%3A%20Shipton%20Mill%20Ltd%20%E2%86%92%20Inkoopfactuur%20INV-20931',
    {},
  ],
  ['20-keyboard-help', '#/findings?help=1', { only: 'desktop' }],
]

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
}

const filter = process.argv[2]
await mkdir(outDir, { recursive: true })
const browser = await chromium.launch({ executablePath: chrome })
const errors = []

for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: vpName === 'mobile' ? 2 : 1,
      reducedMotion: 'reduce',
      hasTouch: vpName === 'mobile',
      isMobile: vpName === 'mobile',
    })
    for (const [name, hash, opts] of SCREENS) {
      if (opts.only && opts.only !== vpName) continue
      if (filter && !name.includes(filter)) continue
      const page = await context.newPage()
      page.on('pageerror', (err) => errors.push(`${name} ${vpName} ${theme}: ${err.message}`))
      const sep = hash.includes('?') ? '&' : '?'
      await page.goto(indexUrl + hash + sep + 'theme=' + theme)
      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(150)
      const file = path.join(outDir, `${name}--${vpName}-${theme}.png`)
      await page.screenshot({ path: file, fullPage: Boolean(opts.fullPage) })
      console.log('saved', path.relative(rootDir, file))
      await page.close()
    }
    await context.close()
  }
}

await browser.close()
if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
