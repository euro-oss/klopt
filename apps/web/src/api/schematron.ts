import {
  loadSchematronFromDirectory,
  createSchematronValidator,
  SchematronError,
} from '@klopt/adapters'
import type { SchematronValidator } from '@klopt/core'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ApiError } from './errors.js'

/**
 * The Peppol BIS and NLCIUS rules, parsed once at first use.
 *
 * Parsing the artefacts costs about a quarter of a second and validating a
 * document about a tenth, so the parse is cached and the validation is not. A
 * new BIS release is a new file under `reference-data/peppol/` (fetched via
 * `pnpm run peppol:fetch`, not committed) and a restart (principle 6) — there
 * is nothing generated and nothing to compile.
 *
 * Missing artefacts are an error, not a skip: a successful UBL response means
 * the published rules ran. `SchematronError` is rethrown as `ApiError` so the
 * problem detail names the gap instead of collapsing into a generic 500.
 */

let validator: SchematronValidator | null = null

function defaultDirectory(): string {
  const fromEnvironment = process.env['KLOPT_REFERENCE_DATA_DIR']
  const root =
    fromEnvironment !== undefined && fromEnvironment !== ''
      ? resolve(fromEnvironment)
      : // Repository layout: apps/web/src/api -> ../../../../reference-data
        join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'reference-data')

  return join(root, 'peppol', 'bis-3')
}

export function schematron(): SchematronValidator {
  if (validator !== null) return validator

  try {
    validator = createSchematronValidator(loadSchematronFromDirectory(defaultDirectory()))
  } catch (error: unknown) {
    if (error instanceof SchematronError) {
      throw new ApiError(
        'internal_error',
        `Peppol Schematron artefacts are not available: ${error.message}`,
      )
    }
    throw error
  }

  return validator
}

/** Test seam. */
export function setSchematronForTest(value: SchematronValidator | null): void {
  validator = value
}
