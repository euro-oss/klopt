import { readdirSync, readFileSync } from 'node:fs'
import { join, matchesGlob, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import config from '../../playwright.config.js'

/**
 * CI runs the main Playwright suite from explicit lists in e2e/ci-shards/
 * instead of `--shard=i/4` (#228). A list is only safe if it covers the suite:
 * a spec missing from every list would silently never run in CI, and one
 * listed twice runs twice and skews the balance. So the lists must partition
 * exactly what `playwright test` would run with this config.
 */

const webRoot = resolve(import.meta.dirname, '../..')
const shardDir = join(webRoot, 'e2e/ci-shards')

const toPosix = (path: string): string => path.split('\\').join('/')

const listSpecs = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return listSpecs(path)
    return entry.name.endsWith('.spec.ts') ? [path] : []
  })

const ignore = [config.testIgnore ?? []].flat()

const mainSuite = (): string[] => {
  const testDir = resolve(webRoot, config.testDir ?? '.')
  return listSpecs(testDir)
    .filter((path) =>
      ignore.every((pattern) => {
        if (typeof pattern !== 'string')
          throw new Error('Only glob testIgnore entries are supported')
        return !matchesGlob(toPosix(path), pattern)
      }),
    )
    .map((path) => toPosix(relative(webRoot, path)))
    .sort()
}

const shardFiles = readdirSync(shardDir)
  .filter((name) => /^shard-\d+\.txt$/.test(name))
  .sort()

const listed = shardFiles.flatMap((name) =>
  readFileSync(join(shardDir, name), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((spec) => ({ shard: name, spec })),
)

describe('CI e2e shard lists', () => {
  it('has the four lists the CI matrix reads', () => {
    expect(shardFiles).toEqual(['shard-1.txt', 'shard-2.txt', 'shard-3.txt', 'shard-4.txt'])
  })

  it('lists no spec twice', () => {
    const seen = new Map<string, string>()
    const duplicates: string[] = []
    for (const { shard, spec } of listed) {
      const first = seen.get(spec)
      if (first !== undefined) duplicates.push(`${spec} (${first} and ${shard})`)
      else seen.set(spec, shard)
    }
    expect(duplicates).toEqual([])
  })

  it('lists every main-suite spec, and nothing else', () => {
    const suite = mainSuite()
    const inLists = new Set(listed.map(({ spec }) => spec))
    expect(suite.length).toBeGreaterThan(0)
    expect(suite.filter((spec) => !inLists.has(spec))).toEqual([])
    expect([...inLists].filter((spec) => !suite.includes(spec)).sort()).toEqual([])
  })
})
