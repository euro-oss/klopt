/**
 * Gate that the web production bundle keeps `/lab/*` fixtures unreachable unless
 * `KLOPT_E2E_BUILT_SERVER=1` at build time (`__KLOPT_LAB_ROUTES__`).
 *
 * TanStack bakes `beforeLoad` at build time: prod gets `throw notFound()`, the CI
 * lab bundle gets a no-op `beforeLoad`.
 *
 * Usage:
 *   pnpm exec tsx e2e/scripts/assert-lab-build-output.ts          # after normal vite build
 *   pnpm exec tsx e2e/scripts/assert-lab-build-output.ts --expect-lab
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const WEB_ROOT = join(import.meta.dirname, '..', '..')
const OUT = join(WEB_ROOT, '.output')

const LAB_ROUTE_PATHS = [
  '/lab/primitives',
  '/_app/lab/guided-invoice',
  '/_app/lab/import-findings',
] as const

const LAB_PATH_MARKERS = [
  '/lab/primitives',
  '/lab/guided-invoice',
  '/lab/import-findings',
  'lab.primitives',
  'lab.guided-invoice',
  'lab.import-findings',
] as const

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

function listFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) listFiles(path, acc)
    else acc.push(path)
  }
  return acc
}

function routerBundles(): string[] {
  const ssr = join(OUT, 'server', '_ssr')
  if (!existsSync(ssr)) return []
  return readdirSync(ssr)
    .filter((name) => name.startsWith('router-') && name.endsWith('.mjs'))
    .map((name) => join(ssr, name))
}

function readText(path: string): string | null {
  try {
    if (!statSync(path).isFile()) return null
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/** True when the route's baked `beforeLoad` is a no-op (lab routes on). */
function labRouteEnabledInText(text: string, routePath: string): boolean {
  const escaped = routePath.replace(/\//g, '\\/')
  const block = new RegExp(
    `createFileRoute\\("${escaped}"\\)\\(\\{[\\s\\S]*?beforeLoad:\\s*\\(\\)\\s*=>\\s*\\{\\s*\\}`,
  )
  return block.test(text)
}

/** True when the route's baked `beforeLoad` throws `notFound()`. */
function labRouteDisabledInText(text: string, routePath: string): boolean {
  const escaped = routePath.replace(/\//g, '\\/')
  const block = new RegExp(
    `createFileRoute\\("${escaped}"\\)\\(\\{[\\s\\S]*?beforeLoad:[\\s\\S]*?throw notFound\\(\\)`,
  )
  return block.test(text)
}

function rel(path: string): string {
  return relative(WEB_ROOT, path)
}

function main(): void {
  const expectLab = process.argv.includes('--expect-lab')

  if (!existsSync(OUT)) {
    fail(`Missing ${rel(OUT)}. Run vite build in apps/web first.`)
  }

  const routers = routerBundles()
  if (routers.length === 0) {
    fail(`No router-*.mjs under ${rel(join(OUT, 'server', '_ssr'))}.`)
  }
  const routerText = routers
    .map((path) => readText(path))
    .filter((text): text is string => text !== null)
    .join('\n')

  const pathHits: string[] = []
  for (const file of listFiles(OUT)) {
    if (file.endsWith('.map')) continue
    const text = readText(file)
    if (text === null) continue
    for (const marker of LAB_PATH_MARKERS) {
      if (text.includes(marker)) pathHits.push(marker)
    }
  }
  const uniquePathHits = [...new Set(pathHits)]

  const enabled: string[] = []
  const disabled: string[] = []
  for (const routePath of LAB_ROUTE_PATHS) {
    if (labRouteEnabledInText(routerText, routePath)) enabled.push(routePath)
    if (labRouteDisabledInText(routerText, routePath)) disabled.push(routePath)
  }

  if (expectLab) {
    if (uniquePathHits.length === 0) {
      fail('Expected /lab paths or ids in build output, found none.')
    }
    if (enabled.length !== LAB_ROUTE_PATHS.length) {
      fail(
        `Expected all ${LAB_ROUTE_PATHS.length} lab routes enabled; enabled: ${enabled.join(', ') || '(none)'}`,
      )
    }
    console.log(
      `Lab build OK: ${uniquePathHits.length} path/id marker(s), routes enabled: ${enabled.join(', ')}`,
    )
    return
  }

  if (enabled.length > 0) {
    fail(`Production bundle enables lab routes: ${enabled.join(', ')}`)
  }
  if (disabled.length !== LAB_ROUTE_PATHS.length) {
    fail(
      `Expected all ${LAB_ROUTE_PATHS.length} lab routes disabled via notFound(); disabled: ${disabled.join(', ') || '(none)'}`,
    )
  }
  console.log(
    `Production bundle OK: /lab paths present, all ${disabled.length} routes throw notFound() at build time.`,
  )
}

main()
