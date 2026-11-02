/* global window, document, getComputedStyle, NodeFilter, requestAnimationFrame */
// Renders .dc.html boards headless and saves full-page PNGs.
// Usage: node shoot.mjs <outDir> [--width=1440|390] <Board.dc.html[?prop=value&...]>=<name> ...
// A --width flag applies to the jobs after it (default 1440). Run from design/redesign-2026-10/
// with `playwright` installed. Google Fonts requests are blocked so a shot only renders correctly
// when the board's fonts are self-hosted. Each shot also prints QA warnings: a number, date or
// period code broken over two lines, a dash placeholder, text in ink-faint, text under 4.5:1,
// and under 600px, a control under 44px. Each PNG gets a tEXt "Source" chunk with its path.
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { crc32 } from 'node:zlib'
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

const [outDir, ...args] = process.argv.slice(2)
const canvas = JSON.parse(await readFile(join(root, 'screens/canvas.json'), 'utf8'))
const browser = await chromium.launch({
  args: ['--disable-lcd-text', '--font-render-hinting=none'],
})
const context = await browser.newContext({ deviceScaleFactor: 1, reducedMotion: 'reduce' })
const blocked = []
let width = 1440
for (const arg of args) {
  if (arg.startsWith('--width=')) {
    width = Number(arg.slice(8))
    continue
  }
  const cut = arg.lastIndexOf('=')
  const board = arg.slice(0, cut)
  const name = arg.slice(cut + 1)
  const [file, query = ''] = board.split('?')
  const theme = new URLSearchParams(query).get('theme') ?? 'light'
  const h = width < 600 ? 844 : (canvas.boards[file]?.h ?? 1000)
  const page = await context.newPage()
  await page.setViewportSize({ width, height: h })
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => {
    blocked.push(route.request().url())
    return route.abort()
  })
  page.on('pageerror', (e) => console.error(name, 'pageerror', e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' && m.text().includes('net::ERR_FAILED')) return
    if (m.type() === 'error' || m.type() === 'warning') console.error(name, m.text())
  })
  await page.goto(`http://localhost:${port}/screens/${board}`)
  await page.waitForFunction(() => window.__dcReady === true || window.__dcError, null, {
    timeout: 15000,
  })
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme)
  await page.addStyleTag({
    content:
      '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}',
  })
  await page.mouse.move(width - 1, 0)
  await page.evaluate(() => document.fonts.ready)
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== 'running' && a.playState !== 'pending'),
  )
  await page.evaluate(
    () =>
      new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 400))),
      ),
  )
  if (width < 600) {
    // Grow the viewport to the page so the sticky action bar and tab bar sit at the end of the
    // full-page shot instead of pinned over the content at 844px.
    for (let i = 0; i < 5; i++) {
      const full = await page.evaluate(() => document.documentElement.scrollHeight)
      if (full <= page.viewportSize().height) break
      await page.setViewportSize({ width, height: full })
      await page.mouse.move(width - 1, 0)
    }
  }
  const qa = await page.evaluate(qaCheck, width)
  const fonts = await page.evaluate(() =>
    [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family} ${f.weight}`),
  )
  const png = await page.screenshot({ fullPage: true })
  await writeFile(join(outDir, `${name}.png`), withSource(png, `${outDir}/${name}.png`))
  console.log(
    name,
    '->',
    join(outDir, `${name}.png`),
    `| ${width} ${theme} | fonts loaded:`,
    [...new Set(fonts)].join(', '),
  )
  for (const w of qa) console.log('  QA', name, w)
  await page.close()
}
if (blocked.length) console.log('blocked Google Fonts requests:', blocked.length)
await browser.close()
server.close()

// Records where a shot belongs in a tEXt chunk, so two shots with the same pixels in different
// folders still differ byte for byte.
function withSource(png, source) {
  const data = Buffer.concat([Buffer.from('Source\0', 'latin1'), Buffer.from(source, 'latin1')])
  const type = Buffer.from('tEXt', 'latin1')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([type, data])))
  const iend = png.length - 12
  return Buffer.concat([png.subarray(0, iend), len, type, data, crc, png.subarray(iend)])
}

function qaCheck(width) {
  const out = []
  const rgb = (s) => (s.match(/[\d.]+/g) || []).map(Number)
  const lum = ([r, g, b]) => {
    const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m)
    return (x + 0.05) / (y + 0.05)
  }
  const bgOf = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const c = rgb(getComputedStyle(e).backgroundColor)
      if (c.length === 3 || (c.length === 4 && c[3] > 0.5)) return c.slice(0, 3)
    }
    return rgb(getComputedStyle(document.body).backgroundColor).slice(0, 3)
  }
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
  }
  const faint = getComputedStyle(document.querySelector('.k-root') || document.body)
    .getPropertyValue('--ink-faint')
    .trim()
  const probe = document.createElement('span')
  probe.style.color = faint
  document.body.appendChild(probe)
  const faintRgb = getComputedStyle(probe).color
  probe.remove()
  const token =
    /€\s?\d[\d.,]*|\d{4}-(?:Q\d|\d{2})\b|\d{1,2}-\d{2}-\d{4}|\d{1,2} (?:jan|feb|mrt|apr|mei|jun|jul|aug|sep|okt|nov|dec|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*|\d{1,2}:\d{2}|\d[\d.,]*\d%?/g
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const seen = new Set()
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement
    const text = n.textContent
    if (!el || !text.trim() || !visible(el) || el.closest('script,style')) continue
    if (/^\s*[—–-]\s*$/.test(text)) out.push(`dash placeholder in <${el.tagName.toLowerCase()}>`)
    const cs = getComputedStyle(el)
    if (cs.color === faintRgb) out.push(`ink-faint text: "${text.trim().slice(0, 40)}"`)
    if (!seen.has(el)) {
      seen.add(el)
      const cr = ratio(rgb(cs.color).slice(0, 3), bgOf(el)) * 1
      const op = Number(cs.opacity) < 1 || el.closest('[style*="opacity"]')
      if (cr < 4.5 && !op) out.push(`contrast ${cr.toFixed(2)}: "${text.trim().slice(0, 40)}"`)
    }
    for (const m of text.matchAll(token)) {
      const r = document.createRange()
      r.setStart(n, m.index)
      r.setEnd(n, m.index + m[0].length)
      const tops = new Set([...r.getClientRects()].map((q) => Math.round(q.top)))
      if (tops.size > 1) out.push(`wraps mid-token: "${m[0]}"`)
    }
  }
  if (width < 600) {
    const sel = 'a[href],button,input,select,[role="checkbox"],[tabindex="0"]'
    for (const el of document.querySelectorAll(sel)) {
      if (!visible(el)) continue
      const r = el.getBoundingClientRect()
      if (r.height < 44 || r.width < 44)
        out.push(`target ${Math.round(r.width)}x${Math.round(r.height)}: "${el.textContent.trim().slice(0, 30)}"`)
    }
  }
  const hovered = [...document.querySelectorAll(':hover')].pop()
  if (hovered && hovered.closest('a,button,[role],.k-row'))
    out.push(`mouse is over <${hovered.tagName.toLowerCase()}>`)
  return out
}
