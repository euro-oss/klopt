import { loadReferenceDataFromDirectory, type ReferenceDataStore } from '@klopt/core'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Compliance artefacts, loaded once at first use (principle 6).
 *
 * Eager and cached: an instance that cannot load its reference data should say
 * so on the first request rather than on the first export, and re-reading 3691
 * RGS codes per request would be silly.
 */

let store: ReferenceDataStore | null = null

function defaultDirectory(): string {
  const fromEnvironment = process.env['KLOPT_REFERENCE_DATA_DIR']
  if (fromEnvironment !== undefined && fromEnvironment !== '') return resolve(fromEnvironment)

  // Repository layout: apps/web/src/api -> ../../../../reference-data
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'reference-data')
}

export function referenceData(): ReferenceDataStore {
  store ??= loadReferenceDataFromDirectory(defaultDirectory())
  return store
}

/** Test seam. */
export function setReferenceDataForTest(value: ReferenceDataStore | null): void {
  store = value
}
