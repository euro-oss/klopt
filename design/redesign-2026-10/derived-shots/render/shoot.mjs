// Renders .dc.html boards headless at 1440 wide and saves full-page PNGs.
// Usage: node shoot.mjs <outDir> <Board.dc.html[?prop=value]>=<name> ...
// Run from design/redesign-2026-10/ with `playwright` installed. Google Fonts requests are
// blocked so a shot only renders correctly when the board's fonts are self-hosted.
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const shim = await readFile(fileURLToPath(new URL('./dc-shim.js', import.meta.url)))
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2', '.json': 'application/json' }

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (path.endsWith('/support.js')) { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(shim); return }
  try {
    const body = await readFile(join(root, path))
    res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' })
    res.end(body)
  } catch { res.writeHead(404); res.end() }
}).listen(0)
const port = server.address().port

const [outDir, ...jobs] = process.argv.slice(2)
const canvas = JSON.parse(await readFile(join(root, 'screens/canvas.json'), 'utf8'))
const browser = await chromium.launch({ args: ['--disable-lcd-text', '--font-render-hinting=none'] })
const blocked = []
for (const job of jobs) {
  const cut = job.lastIndexOf('=')
  const board = job.slice(0, cut)
  const name = job.slice(cut + 1)
  const file = board.split('?')[0]
  const h = canvas.boards[file]?.h ?? 1000
  const page = await browser.newPage({ viewport: { width: 1440, height: h }, deviceScaleFactor: 1 })
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => { blocked.push(route.request().url()); return route.abort() })
  page.on('pageerror', (e) => console.error(name, 'pageerror', e.message))
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.error(name, m.text()) })
  await page.goto(`http://localhost:${port}/screens/${board}`)
  await page.waitForFunction(() => window.__dcReady === true || window.__dcError, null, { timeout: 15000 })
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}' })
  await page.mouse.move(1439, 0)
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 400)))))
  const fonts = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family} ${f.weight}`))
  await page.screenshot({ path: join(outDir, `${name}.png`), fullPage: true })
  console.log(name, '->', join(outDir, `${name}.png`), '| fonts loaded:', [...new Set(fonts)].join(', '))
  await page.close()
}
if (blocked.length) console.log('blocked Google Fonts requests:', blocked.length)
await browser.close()
server.close()
