import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EVENT_TYPES, MODULES, PERMISSIONS, ownerOf } from '@klopt/core'

/**
 * The module contract, enforced (spec 9.5).
 *
 * > Enforce it from the first module you write, which should be Sales, so the
 * > contract is real and not aspirational.
 *
 * This test is the difference between the two. It lives in `packages/db`
 * rather than `packages/core` because the thing it has to compare the
 * declaration against is the schema, and the schema is here.
 */

const SCHEMA = join(import.meta.dirname, '..', 'src', 'schema')

/** Every table the schema actually defines, read out of the source. */
function tablesInSchema(): string[] {
  const names = new Set<string>()

  for (const file of readdirSync(SCHEMA).filter((name) => name.endsWith('.ts'))) {
    const source = readFileSync(join(SCHEMA, file), 'utf8')
    // Both forms Drizzle is written in here: on one line, and wrapped.
    for (const match of source.matchAll(/klopt\.table\(\s*'([a-z_]+)'/g)) names.add(match[1]!)
    for (const match of source.matchAll(/klopt\.table\(\s*\n\s*'([a-z_]+)'/g)) names.add(match[1]!)
  }

  return [...names].sort()
}

describe('every table has an owner', () => {
  it('claims each one exactly once', () => {
    // The property that rots. A table added without a home is a module that
    // was never declared, and this is where that gets noticed — at the point
    // somebody adds it, not eighteen months later.
    const orphans = tablesInSchema().filter((table) => ownerOf(table) === undefined)

    expect(orphans, `add these to a module in packages/core/src/modules/contract.ts`).toEqual([])
  })

  it('does not let two modules claim the same table', () => {
    const seen = new Map<string, string>()
    const clashes: string[] = []

    for (const module of MODULES) {
      for (const table of module.tables) {
        const already = seen.get(table)
        if (already !== undefined) clashes.push(`${table}: ${already} and ${module.name}`)
        else seen.set(table, module.name)
      }
    }

    expect(clashes).toEqual([])
  })

  it('does not claim a table that no longer exists', () => {
    // The other direction, and the one that quietly leaves a lie behind after
    // a table is renamed.
    const real = new Set(tablesInSchema())
    const ghosts = MODULES.flatMap((module) =>
      module.tables.filter((table) => !real.has(table)).map((table) => `${module.name}: ${table}`),
    )

    expect(ghosts).toEqual([])
  })
})

describe('what a module declares', () => {
  it('emits only events in the catalogue', () => {
    const unknown = MODULES.flatMap((module) =>
      module.emits
        .filter((type) => !(type in EVENT_TYPES))
        .map((type) => `${module.name}: ${type}`),
    )

    expect(unknown).toEqual([])
  })

  it('consumes only events in the catalogue', () => {
    const unknown = MODULES.flatMap((module) =>
      module.consumes
        .filter((type) => !(type in EVENT_TYPES))
        .map((type) => `${module.name}: ${type}`),
    )

    expect(unknown).toEqual([])
  })

  it('leaves no event with nobody to emit it', () => {
    // A type in the catalogue that no module claims is either a dead name a
    // consumer is waiting on forever, or an emit somebody forgot to declare.
    const declared = new Set(MODULES.flatMap((module) => module.emits))
    const unclaimed = Object.keys(EVENT_TYPES).filter((type) => !declared.has(type as never))

    expect(unclaimed).toEqual([])
  })

  it('names only permissions that exist', () => {
    const real = new Set<string>(Object.values(PERMISSIONS))
    const invented = MODULES.flatMap((module) =>
      module.permissions
        .filter((permission) => !real.has(permission))
        .map((permission) => `${module.name}: ${permission}`),
    )

    expect(invented).toEqual([])
  })

  it('gives every module a name somebody could say out loud', () => {
    for (const module of MODULES) {
      expect(module.name).toMatch(/^[a-z]+$/)
      expect(module.summary.length).toBeGreaterThan(20)
    }

    const names = MODULES.map((module) => module.name)
    expect(new Set(names).size).toBe(names.length)
  })
})
