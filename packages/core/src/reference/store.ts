import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadRgsScheme, type RgsScheme } from '../rgs/scheme.js'
import { loadChartsFromDirectory, type Chart } from '../setup/chart.js'

/**
 * Versioned compliance artefacts, loaded at runtime (principle 6).
 *
 * "Taxonomies, schematrons and validation artefacts are data loaded at runtime,
 * never code. Every one of them changes annually."
 *
 * Today that means RGS. The Nederlandse Taxonomie (M3) and the Peppol BIS
 * schematrons (M1) land in the same directory under their own subdirectories,
 * and load through the same store — which is the reason it exists now rather
 * than being a `Map` inside the RGS module.
 *
 * Two artefact versions must be loadable at once: an RGS upgrade needs both
 * schemes to produce its diff, and a Peppol BIS transition window needs two
 * validators live simultaneously.
 */

export class ReferenceDataError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReferenceDataError'
  }
}

export interface ReferenceDataStore {
  /** `3.7` or `3.7-mkb`; the variant is optional when only one is loaded. */
  rgs(version: string): RgsScheme
  hasRgs(version: string): boolean
  readonly rgsVersions: readonly string[]
  /** Default charts of accounts, for provisioning a new entity (spec 6.3). */
  chart(code: string): Chart
  readonly charts: readonly Chart[]
}

export interface ReferenceDataContents {
  readonly rgs: ReadonlyMap<string, RgsScheme>
  readonly charts?: ReadonlyMap<string, Chart>
}

export function createReferenceDataStore(contents: ReferenceDataContents): ReferenceDataStore {
  const byKey = new Map(contents.rgs)

  // `3.7` resolves to `3.7-mkb` when that is the only variant loaded, so a
  // single-variant install does not have to spell out the variant everywhere.
  const aliases = new Map<string, string>()
  for (const key of byKey.keys()) {
    const version = key.split('-')[0]
    if (version === undefined || version === key) continue
    aliases.set(version, aliases.has(version) ? '' : key)
  }

  const resolve = (version: string): RgsScheme | undefined => {
    const direct = byKey.get(version)
    if (direct !== undefined) return direct
    const alias = aliases.get(version)
    return alias === undefined || alias === '' ? undefined : byKey.get(alias)
  }

  const charts = new Map(contents.charts ?? [])

  return {
    rgsVersions: [...byKey.keys()].sort((a, b) => a.localeCompare(b)),

    charts: [...charts.values()].sort((a, b) => a.code.localeCompare(b.code)),

    chart(code) {
      const chart = charts.get(code)
      if (chart === undefined) {
        const available = [...charts.keys()].join(', ') || '(none)'
        throw new ReferenceDataError(`No chart of accounts "${code}". Available: ${available}.`)
      }
      return chart
    },

    hasRgs: (version) => resolve(version) !== undefined,

    rgs(version) {
      const scheme = resolve(version)
      if (scheme === undefined) {
        const available = [...byKey.keys()].join(', ') || '(none)'
        throw new ReferenceDataError(
          `RGS ${version} is not loaded. Available: ${available}. ` +
            'Reference data is a data release — see docs/compliance-calendar.md.',
        )
      }
      return scheme
    },
  }
}

/**
 * Load everything under a reference-data directory.
 *
 * Synchronous and eager on purpose: this runs once at boot, and an instance
 * that cannot load its compliance artefacts should fail to start rather than
 * discover the problem when someone asks for an export.
 */
export function loadReferenceDataFromDirectory(directory: string): ReferenceDataStore {
  const rgs = new Map<string, RgsScheme>()
  const rgsDirectory = join(directory, 'rgs')

  let files: string[]
  try {
    files = readdirSync(rgsDirectory).filter((name) => name.endsWith('.json'))
  } catch (error: unknown) {
    throw new ReferenceDataError(
      `Cannot read ${rgsDirectory}: ${error instanceof Error ? error.message : String(error)}. ` +
        'Set KLOPT_REFERENCE_DATA_DIR, or ship the reference-data directory with the image.',
    )
  }

  for (const name of files) {
    const path = join(rgsDirectory, name)
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8'))
    } catch (error: unknown) {
      throw new ReferenceDataError(
        `${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    const scheme = loadRgsScheme(parsed)
    const key = `${scheme.version}-${scheme.variant}`
    if (rgs.has(key)) throw new ReferenceDataError(`RGS ${key} is loaded twice.`)
    rgs.set(key, scheme)
  }

  return createReferenceDataStore({ rgs, charts: loadChartsFromDirectory(directory) })
}
