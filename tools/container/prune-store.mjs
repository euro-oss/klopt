#!/usr/bin/env node
/**
 * Removes the packages a runtime image does not reach.
 *
 * `pnpm install --prod --filter @klopt/worker...` links the right things into
 * the right `node_modules` — and still materialises every package the lockfile
 * mentions into the shared virtual store. Filters select importers, not store
 * entries.
 *
 * Most of what is left over arrives through optional peer dependencies, which
 * this workspace installs (`autoInstallPeers: true`). `better-auth` names
 * `drizzle-kit`, `kysely`, `pg`, `react`, `react-dom`, `@tanstack/react-start`
 * and `vitest` as peers so that it can adapt to whichever of them you brought;
 * we brought drizzle-orm and postgres, and pnpm links the other six anyway.
 * Through `@tanstack/react-start` comes Vite, and through Vite comes Rolldown,
 * esbuild and lightningcss: about 300 MB of build tooling in an image whose
 * job is to answer HTTP requests.
 *
 * So: walk out from the packages that do run, following each one's declared
 * `dependencies` and `optionalDependencies`, plus the peers it did not mark
 * optional. Delete every `.pnpm` entry the walk never reaches.
 *
 * ## What this can break
 *
 * A package that requires something it never declared works under pnpm only by
 * accident of `.pnpm/node_modules`, the hoisted fallback, which is not a root
 * here. An optional peer that turns out not to be optional would go the same
 * way. Both fail loudly at boot rather than quietly later, and the container
 * walk-through in ADR 0042 is what holds them: both images are started and
 * asked to do real work before either is published.
 *
 * Usage: node prune-store.mjs <root> <importer> [importer...]
 */
import { readFileSync, readdirSync, readlinkSync, rmSync, lstatSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

const [root, ...importers] = process.argv.slice(2)
if (root === undefined || importers.length === 0) {
  console.error('usage: prune-store.mjs <root> <importer> [importer...]')
  process.exit(2)
}

const store = join(root, 'node_modules', '.pnpm')

/** The dependency names a manifest actually needs at runtime. */
function needsOf(manifestPath) {
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    // No manifest to read means no basis for excluding anything, so follow
    // everything rather than silently dropping a package's dependencies.
    return null
  }
  const names = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ])
  const optionalPeers = manifest.peerDependenciesMeta ?? {}
  for (const peer of Object.keys(manifest.peerDependencies ?? {})) {
    if (optionalPeers[peer]?.optional !== true) names.add(peer)
  }
  return names
}

/** Every `foo` and `@scope/bar` entry directly inside one `node_modules`. */
function entriesIn(modules) {
  const found = []
  let entries
  try {
    entries = readdirSync(modules, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    if (entry.name === '.pnpm' || entry.name === '.bin') continue
    if (entry.name.startsWith('@')) {
      for (const scoped of readdirSync(join(modules, entry.name), { withFileTypes: true })) {
        found.push({
          name: `${entry.name}/${scoped.name}`,
          path: join(modules, entry.name, scoped.name),
        })
      }
    } else {
      found.push({ name: entry.name, path: join(modules, entry.name) })
    }
  }
  return found
}

/** The `.pnpm` entry a link lands in, or null when it is not a store link. */
function storeEntryOf(path) {
  let target
  try {
    if (!lstatSync(path).isSymbolicLink()) return null
    target = resolve(dirname(path), readlinkSync(path))
  } catch {
    return null
  }
  const inside = relative(store, target)
  if (inside.startsWith('..') || inside === '') return null
  return inside.split(sep)[0] ?? null
}

const reachable = new Set()
const queue = importers.map((importer) => ({
  modules: join(root, importer, 'node_modules'),
  manifest: join(root, importer, 'package.json'),
}))

while (queue.length > 0) {
  const { modules, manifest } = queue.pop()
  const needs = needsOf(manifest)

  for (const { name, path } of entriesIn(modules)) {
    if (needs !== null && !needs.has(name)) continue

    const entry = storeEntryOf(path)
    if (entry === null) {
      // A workspace package, symlinked to its source directory. Not a store
      // entry, but its dependencies are, so keep walking.
      queue.push({ modules: join(path, 'node_modules'), manifest: join(path, 'package.json') })
      continue
    }
    if (reachable.has(entry)) continue
    reachable.add(entry)
    queue.push({
      modules: join(store, entry, 'node_modules'),
      manifest: join(store, entry, 'node_modules', name, 'package.json'),
    })
  }
}

let removed = 0
for (const entry of readdirSync(store)) {
  // `.pnpm/node_modules` is the hoisted fallback. Keeping it keeps a link to
  // everything; its dangling links afterwards are harmless, because Node then
  // reports the package as missing, which is the truth.
  if (entry === 'node_modules' || reachable.has(entry)) continue
  rmSync(join(store, entry), { recursive: true, force: true })
  removed += 1
}

console.log(`pruned ${String(removed)} of ${String(removed + reachable.size)} store entries`)
