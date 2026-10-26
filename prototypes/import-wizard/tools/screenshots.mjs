// Captures the wizard states for the PR into docs/pr-screenshots/100/.
// Usage: node tools/screenshots.mjs [filter]   (needs playwright-core + a Chrome)
// Fails on page errors, and on sideways scroll at 390 px.
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(here, '..')
const outDir = path.resolve(rootDir, '../../docs/pr-screenshots/100')
const indexUrl = pathToFileURL(path.join(rootDir, 'index.html')).href

const chrome =
  process.env.CHROME_PATH ||
  ['/usr/local/bin/google-chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync)

const ALL_STEPS = [
  ['01-bron', '#/bron'],
  ['02-verbinden', '#/verbinden?state=connected'],
  ['03-administratie', '#/administratie'],
  ['04-voorbeeld', '#/voorbeeld'],
  ['05-btw', '#/btw'],
  ['06-rekeningen', '#/rekeningen'],
  ['07-problemen', '#/problemen'],
  ['08-overzicht', '#/overzicht'],
  ['09-importeren', '#/importeren?pct=61'],
  ['10-klaar', '#/klaar'],
]
const EXACT_STEPS = [
  ['02-verbinden', '#/verbinden?src=exact'],
  ['03-administratie', '#/administratie?src=exact'],
  ['04-voorbeeld', '#/voorbeeld?src=exact'],
  ['05-btw', '#/btw?src=exact'],
  ['06-rekeningen', '#/rekeningen?src=exact'],
  ['07-problemen', '#/problemen?src=exact'],
  ['08-overzicht', '#/overzicht?src=exact'],
  ['09-importeren', '#/importeren?src=exact&pct=58'],
  ['10-klaar', '#/klaar?src=exact'],
]

// [name, hash, { vp: ['desktop'|'mobile'], themes: [...], fullPage }]
const both = ['light', 'dark']
const SHOTS = [
  ...ALL_STEPS.map(([n, h]) => [
    `${n}-moneybird`,
    h,
    { vp: ['desktop'], themes: both, fullPage: true },
  ]),
  ...EXACT_STEPS.map(([n, h]) => [
    `${n}-exact`,
    h,
    { vp: ['desktop'], themes: ['light'], fullPage: true },
  ]),
  ...ALL_STEPS.map(([n, h]) => [
    `${n}-moneybird`,
    h,
    {
      vp: ['mobile'],
      themes: ['07-problemen', '08-overzicht', '10-klaar'].includes(n) ? both : ['light'],
      fullPage: true,
    },
  ]),
  // Dead ends
  ['deadend-95-rc-eu-btw', '#/btw?focus=card-r6', { vp: ['desktop'], themes: both }],
  ['deadend-95-rc-eu-klaar', '#/klaar', { vp: ['mobile'], themes: both }],
  [
    'deadend-96-untagged',
    '#/problemen?focus=card-p-untagged',
    { vp: ['desktop', 'mobile'], themes: both },
  ],
  [
    'deadend-99-not-in-force-busy',
    '#/problemen?busy=p-nif',
    { vp: ['desktop', 'mobile'], themes: both },
  ],
  ['deadend-92-93-no-code', '#/btw?focus=card-r7', { vp: ['desktop', 'mobile'], themes: both }],
  [
    'deadend-92-excluded-undo',
    '#/btw?excluded=1&toast=1',
    { vp: ['desktop', 'mobile'], themes: both },
  ],
  // Geavanceerd
  ['geavanceerd-uit-btw', '#/btw', { vp: ['desktop'], themes: ['light'] }],
  ['geavanceerd-aan-btw', '#/btw?adv=1', { vp: ['desktop'], themes: ['light'] }],
  [
    'geavanceerd-aan-rekeningen',
    '#/rekeningen?adv=1',
    { vp: ['desktop'], themes: ['light'], fullPage: true },
  ],
  [
    'geavanceerd-aan-voorbeeld',
    '#/voorbeeld?adv=1',
    { vp: ['desktop'], themes: ['light'], fullPage: true },
  ],
  // Focus, resume, other states
  ['focus-bron-card', '#/bron?focus=src-moneybird', { vp: ['desktop'], themes: both }],
  ['focus-btw-card', '#/btw?focus=card-r4', { vp: ['desktop'], themes: both }],
  ['resume-card', '#/bron?resume=1', { vp: ['desktop', 'mobile'], themes: both }],
  [
    'resume-restart-dialog',
    '#/bron?resume=1&confirm=restart',
    { vp: ['desktop', 'mobile'], themes: ['light'] },
  ],
  ['resume-banner-btw', '#/btw?resumed=1', { vp: ['desktop'], themes: ['light'] }],
  [
    'verbinden-fout-token',
    '#/verbinden?state=error',
    { vp: ['desktop', 'mobile'], themes: ['light'] },
  ],
  [
    'verbinden-verbreken-dialog',
    '#/verbinden?state=connected&confirm=disconnect',
    { vp: ['desktop'], themes: ['light'] },
  ],
  [
    'verbinden-exact-geen-sleutel',
    '#/verbinden?src=exact&state=nokey',
    { vp: ['desktop'], themes: ['light'] },
  ],
  [
    'voorbeeld-lezen',
    '#/voorbeeld?state=reading',
    { vp: ['desktop', 'mobile'], themes: ['light'] },
  ],
  ['btw-tarief-kiezen-sheet', '#/btw?sheet=r5', { vp: ['desktop', 'mobile'], themes: ['light'] }],
  ['problemen-koers-sheet', '#/problemen?sheet=fx', { vp: ['desktop'], themes: ['light'] }],
  [
    'problemen-alles-opgelost',
    '#/problemen?resolved=1',
    { vp: ['desktop'], themes: ['light'], fullPage: true },
  ],
  [
    'overzicht-bevestigen-dialog',
    '#/overzicht?confirm=import',
    { vp: ['desktop', 'mobile'], themes: both },
  ],
  ['importeren-geweigerd', '#/importeren?state=refused', { vp: ['desktop'], themes: ['light'] }],
  ['klaar-zonder-blokkade', '#/klaar?state=clean', { vp: ['desktop'], themes: ['light'] }],
  ['stappen-sheet', '#/btw?menu=1', { vp: ['mobile'], themes: ['light'] }],
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
    for (const [name, hash, opts] of SHOTS) {
      if (!opts.vp.includes(vpName) || !opts.themes.includes(theme)) continue
      if (filter && !name.includes(filter)) continue
      const page = await context.newPage()
      page.on('pageerror', (err) => errors.push(`${name} ${vpName} ${theme}: ${err.message}`))
      const sep = hash.includes('?') ? '&' : '?'
      await page.goto(indexUrl + hash + sep + 'theme=' + theme)
      await page.evaluate(() => document.fonts.ready)
      if (opts.fullPage) await page.evaluate(() => document.documentElement.classList.add('shot'))
      await page.waitForTimeout(150)
      if (vpName === 'mobile') {
        const sw = await page.evaluate(() => document.documentElement.scrollWidth)
        if (sw > viewport.width)
          errors.push(`${name} ${vpName} ${theme}: sideways scroll (${sw}px)`)
      }
      const vpLabel = vpName === 'mobile' ? 'mobile-390' : 'desktop-1440'
      const file = path.join(outDir, `${name}-${theme}-${vpLabel}.png`)
      await page.screenshot({ path: file, fullPage: Boolean(opts.fullPage) })
      console.log('saved', path.relative(outDir, file))
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
