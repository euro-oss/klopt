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
    {
      vp: ['04', '05', '07', '08', '10'].includes(n.slice(0, 2))
        ? ['desktop', 'mobile']
        : ['desktop'],
      themes: both,
      fullPage: true,
    },
  ]),
  ...ALL_STEPS.map(([n, h]) => [
    `${n}-moneybird`,
    h,
    { vp: ['mobile'], themes: both, fullPage: true },
  ]),
  // Dead ends
  ['deadend-eu-geen-code', '#/btw?focus=card-r6', { vp: ['desktop', 'mobile'], themes: both }],
  ['na72-eu-icv21-kiezen', '#/btw?na72=1&focus=card-r6', { vp: ['desktop'], themes: both }],
  ['na72-eu-icv21-sheet', '#/btw?na72=1&sheet=r6', { vp: ['desktop'], themes: ['light'] }],
  [
    'na72-problemen-95',
    '#/problemen?na72=1',
    { vp: ['desktop'], themes: ['light'], scrollTo: '[data-card="p-rc"]' },
  ],
  ['na72-overzicht', '#/overzicht?na72=1', { vp: ['desktop'], themes: ['light'], fullPage: true }],
  ['deadend-95-rc-eu-klaar', '#/klaar?na72=1', { vp: ['desktop', 'mobile'], themes: both }],
  [
    'deadend-96-untagged',
    '#/problemen?focus=card-p-untagged',
    { vp: ['desktop', 'mobile'], themes: both },
  ],
  [
    'deadend-99-not-in-force-busy',
    '#/problemen?busy=p-nif-H21',
    { vp: ['desktop', 'mobile'], themes: both, scrollTo: '[data-card="p-nif-H21"]' },
  ],
  ['deadend-92-93-no-code', '#/btw?focus=card-r7', { vp: ['desktop', 'mobile'], themes: both }],
  [
    'deadend-92-excluded-undo',
    '#/btw?excluded=1&toast=1',
    { vp: ['desktop', 'mobile'], themes: both },
  ],
  // PM decisions: #99 per role after release, #96 after an earlier import
  [
    'na99-eigenaar',
    '#/problemen?na99=1',
    { vp: ['desktop', 'mobile'], themes: both, scrollTo: '[data-card="p-nif-H21"]' },
  ],
  [
    'na99-boekhouder',
    '#/problemen?na99=1&role=boekhouder',
    { vp: ['desktop', 'mobile'], themes: both, scrollTo: '[data-card="p-nif-H21"]' },
  ],
  [
    'eerdere-import-overzicht',
    '#/overzicht?eerder=1',
    { vp: ['desktop', 'mobile'], themes: both, fullPage: true },
  ],
  [
    'eerdere-import-bevestigen-dialog',
    '#/overzicht?eerder=1&confirm=import',
    { vp: ['desktop'], themes: ['light'] },
  ],
  [
    'eerdere-import-klaar',
    '#/klaar?eerder=1',
    { vp: ['desktop', 'mobile'], themes: both, fullPage: true },
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
  [
    'geavanceerd-aan-problemen',
    '#/problemen?adv=1',
    { vp: ['desktop'], themes: ['light'], fullPage: true },
  ],
  ['geavanceerd-aan-klaar', '#/klaar?adv=1', { vp: ['desktop'], themes: ['light'] }],
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
  [
    'btw-nog-2-zonder-code',
    '#/btw?picked=1&focus=next',
    { vp: ['desktop', 'mobile'], themes: both },
  ],
  [
    'btw-zelf-kiezen-sheet',
    '#/btw?adv=1&sheet=r7',
    { vp: ['desktop', 'mobile'], themes: ['light'] },
  ],
  [
    'btw-code-geweigerd',
    '#/btw?adv=1&sheet=r7&error=rate',
    { vp: ['desktop', 'mobile'], themes: both },
  ],
  [
    'verbinden-moneybird-geen-sleutel',
    '#/verbinden?state=nokey',
    { vp: ['desktop', 'mobile'], themes: ['light'] },
  ],
  [
    'verbinden-verbreken-dialog-na-0037',
    '#/verbinden?state=connected&confirm=disconnect&na0037=1',
    { vp: ['desktop'], themes: ['light'] },
  ],
  [
    'problemen-exact-rechten-wel',
    '#/problemen?src=exact&rights=true',
    { vp: ['desktop'], themes: ['light'] },
  ],
  [
    'problemen-exact-rechten-onbekend',
    '#/problemen?src=exact&rights=unknown',
    { vp: ['desktop'], themes: ['light'] },
  ],
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
      const focusId = new URLSearchParams(hash.split('?')[1] || '').get('focus')
      if (opts.scrollTo)
        await page.evaluate((sel) => {
          const el = document.querySelector(sel)
          window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 16)
        }, opts.scrollTo)
      if (focusId) {
        // A key press puts Chrome in keyboard modality, so :focus-visible matches.
        await page.keyboard.press('Shift')
        await page.evaluate((id) => {
          const el = document.querySelector(`[data-focus="${id}"]`)
          el.blur()
          el.focus()
          el.scrollIntoView({ block: 'center' })
        }, focusId)
      }
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
