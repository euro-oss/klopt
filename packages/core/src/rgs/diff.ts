import type { RgsCode, RgsScheme } from './scheme.js'

/**
 * RGS version upgrades (spec 7.1).
 *
 * "RGS version upgrades are a migration with a diff report, never a silent
 * remap."
 *
 * So the upgrade path is: load both schemes, produce this report, show the
 * accountant what it will do to their mappings, and only then write anything.
 * Nothing here mutates.
 */

export interface RgsCodeChange {
  readonly code: string
  readonly field: string
  readonly before: string
  readonly after: string
}

export interface RgsSchemeDiff {
  readonly fromVersion: string
  readonly toVersion: string
  readonly added: readonly RgsCode[]
  readonly removed: readonly RgsCode[]
  /** Present in both, but withdrawn in the newer scheme. */
  readonly deactivated: readonly RgsCode[]
  readonly reactivated: readonly RgsCode[]
  readonly changed: readonly RgsCodeChange[]
}

const COMPARED_FIELDS = [
  'omslagCode',
  'referenceNumber',
  'shortDescription',
  'description',
  'debitCredit',
  'level',
] as const

export function diffRgsSchemes(from: RgsScheme, to: RgsScheme): RgsSchemeDiff {
  const added: RgsCode[] = []
  const removed: RgsCode[] = []
  const deactivated: RgsCode[] = []
  const reactivated: RgsCode[] = []
  const changed: RgsCodeChange[] = []

  for (const code of to.codes) {
    const previous = from.get(code.code)
    if (previous === undefined) {
      added.push(code)
      continue
    }

    if (!previous.inactive && code.inactive) deactivated.push(code)
    if (previous.inactive && !code.inactive) reactivated.push(code)

    for (const field of COMPARED_FIELDS) {
      const before = previous[field]
      const after = code[field]
      if (before !== after) {
        changed.push({
          code: code.code,
          field,
          before: before === null ? '' : String(before),
          after: after === null ? '' : String(after),
        })
      }
    }
  }

  for (const code of from.codes) {
    if (to.get(code.code) === undefined) removed.push(code)
  }

  return {
    fromVersion: from.version,
    toVersion: to.version,
    added,
    removed,
    deactivated,
    reactivated,
    changed,
  }
}

export interface MappingImpact {
  readonly accountNumber: string
  readonly rgsCode: string
  readonly impact: 'removed' | 'deactivated' | 'redescribed'
  readonly detail: string
}

/**
 * What the upgrade does to the mappings this entity actually has. The full diff
 * is thousands of rows; this is the handful that need a decision.
 */
export function assessUpgradeImpact(
  mappings: readonly { readonly accountNumber: string; readonly rgsCode: string | null }[],
  diff: RgsSchemeDiff,
): readonly MappingImpact[] {
  const removed = new Map(diff.removed.map((code) => [code.code, code]))
  const deactivated = new Map(diff.deactivated.map((code) => [code.code, code]))
  const redescribed = new Map<string, RgsCodeChange[]>()

  for (const change of diff.changed) {
    if (change.field !== 'description' && change.field !== 'shortDescription') continue
    const list = redescribed.get(change.code) ?? []
    list.push(change)
    redescribed.set(change.code, list)
  }

  const impacts: MappingImpact[] = []

  for (const mapping of mappings) {
    if (mapping.rgsCode === null) continue

    const gone = removed.get(mapping.rgsCode)
    if (gone !== undefined) {
      impacts.push({
        accountNumber: mapping.accountNumber,
        rgsCode: mapping.rgsCode,
        impact: 'removed',
        detail: `${mapping.rgsCode} no longer exists in RGS ${diff.toVersion}. It must be remapped before the upgrade is applied.`,
      })
      continue
    }

    const withdrawn = deactivated.get(mapping.rgsCode)
    if (withdrawn !== undefined) {
      impacts.push({
        accountNumber: mapping.accountNumber,
        rgsCode: mapping.rgsCode,
        impact: 'deactivated',
        detail: `${mapping.rgsCode} is withdrawn in RGS ${diff.toVersion}.`,
      })
      continue
    }

    const changes = redescribed.get(mapping.rgsCode)
    if (changes !== undefined && changes.length > 0) {
      impacts.push({
        accountNumber: mapping.accountNumber,
        rgsCode: mapping.rgsCode,
        impact: 'redescribed',
        detail: changes
          .map((change) => `${change.field}: "${change.before}" -> "${change.after}"`)
          .join('; '),
      })
    }
  }

  return impacts
}
