import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { SchematronError, type SchematronSchema } from './model.js'
import { parseSchematron } from './parse.js'

/**
 * Every `.sch` in a directory, in filename order.
 *
 * Order matters and filename order is the right one by accident that is not an
 * accident: `CEN-EN16931-UBL.sch` holds the EN 16931 rules and
 * `PEPPOL-EN16931-UBL.sch` the Peppol and country ones, and reporting the
 * standard's failures before the profile's is the order somebody wants to read
 * them in.
 */
export function loadSchematronFromDirectory(directory: string): readonly SchematronSchema[] {
  let files: string[]
  try {
    files = readdirSync(directory)
      .filter((name) => name.endsWith('.sch'))
      .sort((a, b) => a.localeCompare(b))
  } catch (error: unknown) {
    throw new SchematronError(
      `Cannot read ${directory}: ${error instanceof Error ? error.message : String(error)}. ` +
        'Schematron artefacts are fetched, not shipped in-repo — run `pnpm run peppol:fetch` ' +
        '(see reference-data/peppol/README.md).',
    )
  }

  if (files.length === 0) {
    throw new SchematronError(
      `${directory} contains no .sch artefacts. ` +
        'Obtain them with `pnpm run peppol:fetch` — see reference-data/peppol/README.md.',
    )
  }

  return files.map((name) => parseSchematron(readFileSync(join(directory, name), 'utf8'), name))
}
