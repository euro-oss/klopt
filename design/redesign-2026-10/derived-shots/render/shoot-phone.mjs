/* global window, document, getComputedStyle, requestAnimationFrame */
// Renders phone .dc.html boards headless at 390 wide and saves full-page PNGs.
// Usage: node shoot-phone.mjs <outDir> <Board.dc.html[?prop=value]>=<name> ...
// Run with `playwright` installed. Captures with prefers-reduced-motion: reduce, the pointer
// never enters the page (no hover state), and Google Fonts requests are blocked so a shot only
// renders correctly when the board's fonts are self-hosted. Each shot is audited: interactive
// elements under 44px tall and text under 4.5:1 against its background are reported.
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const shim = await readFile(fileURLToPath(new URL('./dc-shim.js', import.meta.url)))
const types = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
}

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (path.endsWith('/support.js')) {
    res.writeHead(200, { 'content-type': 'text/javascript' })
    res.end(shim)
    return
  }
  try {
    const body = await readFile(join(root, path))
    res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end()
  }
}).listen(0)
const port = server.address().port

const [outDir, ...jobs] = process.argv.slice(2)
const browser = await chromium.launch({
  args: ['--disable-lcd-text', '--font-render-hinting=none'],
})
let problems = 0
for (const job of jobs) {
  const cut = job.lastIndexOf('=')
  const board = job.slice(0, cut)
  const name = job.slice(cut + 1)
  const dark = /-dark(-|$)/.test(name)
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    colorScheme: dark ? 'dark' : 'light',
  })
  const page = await context.newPage()
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort())
  page.on('pageerror', (e) => console.error(name, 'pageerror', e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.error(name, m.text())
  })
  await page.goto(`http://localhost:${port}/screens/${board}`)
  await page.waitForFunction(() => window.__dcReady === true || window.__dcError, null, {
    timeout: 15000,
  })
  await page.addStyleTag({
    content:
      '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}',
  })
  await page.mouse.move(-1, -1)
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(
    () =>
      new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 400))),
      ),
  )
  const audit = await page.evaluate(() => {
    const rgb = (s) => (s.match(/[\d.]+/g) || []).map(Number)
    const lum = ([r, g, b]) => {
      const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }
    const bgOf = (el) => {
      for (let e = el; e; e = e.parentElement) {
        const c = rgb(getComputedStyle(e).backgroundColor)
        if (c.length === 3 || (c.length === 4 && c[3] === 1)) return c.slice(0, 3)
      }
      return [255, 255, 255]
    }
    const out = { hover: document.querySelectorAll('body :hover').length, small: [], low: [] }
    for (const el of document.querySelectorAll('a[href], button, input, select, [role="tab"]')) {
      const r = el.getBoundingClientRect()
      if (r.width && r.height < 44) out.small.push(`${el.textContent.trim().slice(0, 30)} ${r.height}px`)
    }
    const walker = document.createTreeWalker(document.body, 4)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim()) continue
      const el = n.parentElement
      if (el.closest('svg, [aria-hidden="true"]')) continue
      const fg = rgb(getComputedStyle(el).color).slice(0, 3)
      const [a, b] = [lum(fg), lum(bgOf(el))]
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
      if (ratio < 4.5) out.low.push(`${n.textContent.trim().slice(0, 30)} ${ratio.toFixed(2)}:1`)
    }
    return out
  })
  const file = join(outDir, `${name}.png`)
  await page.screenshot({ path: file, fullPage: true })
  const size = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    document.documentElement.scrollHeight,
  ])
  console.log(name, '->', file, `| ${size[0]}x${size[1]}`, `| hovered: ${audit.hover}`)
  for (const s of audit.small) console.log('  under 44px:', s)
  for (const l of audit.low) console.log('  under 4.5:1:', l)
  problems += audit.small.length + audit.low.length + audit.hover
  await context.close()
}
await browser.close()
server.close()
if (problems) process.exitCode = 1
