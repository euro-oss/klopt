/* global window, document, requestAnimationFrame */
// Renders .dc.html boards headless at a given width and saves full-page PNGs.
// Usage: node shoot-widths.mjs <outDir> <Board.dc.html[?prop=value]>@<width>=<name> ...
// Run from design/redesign-2026-10/ with `playwright` installed (CHROME=/path/to/chrome to use a
// local browser). It serves the folder with dc-shim.js standing in for support.js, blocks Google
// Fonts, sizes the viewport to the board's own $preview height, and adds:
// prefers-reduced-motion: reduce, a wait until every CSS transition and animation has finished,
// the mouse parked on a point with nothing interactive under it, and a duplicate-md5 check.
import { chromium } from 'playwright'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, readFile } from 'node:fs/promises'
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
await mkdir(outDir, { recursive: true })
const canvas = JSON.parse(await readFile(join(root, 'screens/canvas.json'), 'utf8'))
const browser = await chromium.launch({
  executablePath: process.env.CHROME || undefined,
  args: ['--disable-lcd-text', '--font-render-hinting=none'],
})
const context = await browser.newContext({ reducedMotion: 'reduce', deviceScaleFactor: 1 })
const blocked = []
const hashes = new Map()
let failed = false
for (const job of jobs) {
  const cut = job.lastIndexOf('=')
  const [board, width] = job.slice(0, cut).split('@')
  const name = job.slice(cut + 1)
  const w = Number(width)
  const file = board.split('?')[0]
  const props = (await readFile(join(root, 'screens', file), 'utf8')).match(/data-props='([^']*)'/)
  const h =
    (props && JSON.parse(props[1]).$preview?.height) ?? canvas.boards[file]?.h ?? (w < 600 ? 844 : 1000)
  const page = await context.newPage()
  await page.setViewportSize({ width: w, height: h })
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => {
    blocked.push(route.request().url())
    return route.abort()
  })
  page.on('pageerror', (e) => console.error(name, 'pageerror', e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.error(name, m.text())
  })
  await page.goto(`http://localhost:${port}/screens/${board}`)
  await page.waitForFunction(() => window.__dcReady === true || window.__dcError, null, {
    timeout: 15000,
  })
  await page.addStyleTag({ content: '*{caret-color:transparent!important}' })
  const spot = await page.evaluate(() => {
    const hot = 'a,button,input,select,textarea,label,summary,[role],[tabindex],.k-nav,.k-tabbar'
    for (let y = window.innerHeight - 2; y > 0; y -= 8)
      for (let x = window.innerWidth - 2; x > 0; x -= 8) {
        const el = document.elementFromPoint(x, y)
        if (el && !el.closest(hot)) return { x, y }
      }
    return null
  })
  if (!spot) {
    console.error(name, 'no point without a control under it')
    failed = true
  } else await page.mouse.move(spot.x, spot.y)
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)))
  await page.evaluate(
    () =>
      new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 400))),
      ),
  )
  const hovered = await page.evaluate(() => [...document.querySelectorAll(':hover')].at(-1)?.closest('a,button,input,select,label')?.outerHTML.slice(0, 80) ?? null)
  if (hovered) {
    console.error(name, 'mouse is over', hovered)
    failed = true
  }
  const fonts = await page.evaluate(() =>
    [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family} ${f.weight}`),
  )
  const path = join(outDir, `${name}.png`)
  const png = await page.screenshot({ path, fullPage: true })
  const md5 = createHash('md5').update(png).digest('hex')
  if (hashes.has(md5)) {
    console.error(name, 'same md5 as', hashes.get(md5))
    failed = true
  }
  hashes.set(md5, name)
  const size = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight])
  console.log(name, '->', path, size.join('x'), md5, '| fonts:', [...new Set(fonts)].join(', '))
  await page.close()
}
if (blocked.length) console.log('blocked Google Fonts requests:', blocked.length)
await browser.close()
server.close()
if (failed) process.exit(1)
