import { loadTaxonomyMappingsFromDirectory, type TaxonomyMapping } from '@klopt/core'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The Nederlandse Taxonomie mappings, loaded once at first use.
 *
 * Reference data, like RGS and the Peppol schematrons: a new NT is a new file
 * in `reference-data/nt/` and a restart (principle 6). Nothing is generated and
 * nothing is compiled.
 *
 * Loaded lazily rather than at boot, unlike RGS. An installation that files by
 * hand and never generates an instance needs no mapping at all, and refusing to
 * start over a missing one would be the wrong trade for the commonest setup.
 */

let mappings: readonly TaxonomyMapping[] | null = null

function defaultDirectory(): string {
  const fromEnvironment = process.env['KLOPT_REFERENCE_DATA_DIR']
  return fromEnvironment !== undefined && fromEnvironment !== ''
    ? resolve(fromEnvironment)
    : // Repository layout: apps/web/src/api -> ../../../../reference-data
      join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'reference-data')
}

export function taxonomyMappings(): readonly TaxonomyMapping[] {
  mappings ??= loadTaxonomyMappingsFromDirectory(defaultDirectory())
  return mappings
}

/** Test seam. */
export function setTaxonomyMappingsForTest(value: readonly TaxonomyMapping[] | null): void {
  mappings = value
}
