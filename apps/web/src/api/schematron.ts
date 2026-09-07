import { loadSchematronFromDirectory, createSchematronValidator } from '@klopt/adapters'
import type { SchematronValidator } from '@klopt/core'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The Peppol BIS and NLCIUS rules, parsed once at first use.
 *
 * Parsing the artefacts costs about a quarter of a second and validating a
 * document about a tenth, so the parse is cached and the validation is not. A
 * new BIS release is a new file in `reference-data/peppol/` and a restart
 * (principle 6) — there is nothing generated and nothing to compile.
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
  validator ??= createSchematronValidator(loadSchematronFromDirectory(defaultDirectory()))
  return validator
}

/** Test seam. */
export function setSchematronForTest(value: SchematronValidator | null): void {
  validator = value
}
