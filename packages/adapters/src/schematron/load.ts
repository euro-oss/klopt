import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { SchematronError, type SchematronSchema } from './model.js'
import { parseSchematron } from './parse.js'

/**
 * The Peppol BIS Billing 3 artefacts the runtime must have.
 *
 * Order matters and filename order is the right one by accident that is not an
 * accident: `CEN-EN16931-UBL.sch` holds the EN 16931 rules and
 * `PEPPOL-EN16931-UBL.sch` the Peppol and country ones, and reporting the
 * standard's failures before the profile's is the order somebody wants to read
 * them in.
 *
 * Both files are required by name. Loading "whatever `.sch` is present" would
 * let a half-fetched directory validate fewer rules and still look successful.
 */
export const REQUIRED_PEPPOL_SCHEMATRON_FILES = [
  'CEN-EN16931-UBL.sch',
  'PEPPOL-EN16931-UBL.sch',
] as const

/**
 * Every required Peppol `.sch` in a directory, in the published order.
 */
export function loadSchematronFromDirectory(directory: string): readonly SchematronSchema[] {
  let present: Set<string>
  try {
    present = new Set(readdirSync(directory).filter((name) => name.endsWith('.sch')))
  } catch (error: unknown) {
    throw new SchematronError(
      `Cannot read ${directory}: ${error instanceof Error ? error.message : String(error)}. ` +
        'Schematron artefacts are fetched, not shipped in-repo — run `pnpm run peppol:fetch` ' +
        '(see reference-data/peppol/README.md).',
    )
  }

  if (present.size === 0) {
    throw new SchematronError(
      `${directory} contains no .sch artefacts. ` +
        'Obtain them with `pnpm run peppol:fetch` — see reference-data/peppol/README.md.',
    )
  }

  const missing = REQUIRED_PEPPOL_SCHEMATRON_FILES.filter((name) => !present.has(name))
  if (missing.length > 0) {
    throw new SchematronError(
      `${directory} is missing ${missing.join(' and ')}. ` +
        'A partial Schematron set would under-validate. ' +
        'Obtain both artefacts with `pnpm run peppol:fetch` — see reference-data/peppol/README.md.',
    )
  }

  return REQUIRED_PEPPOL_SCHEMATRON_FILES.map((name) =>
    parseSchematron(readFileSync(join(directory, name), 'utf8'), name),
  )
}
