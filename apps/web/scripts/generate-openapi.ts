import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildOpenApiDocument, openApiJson } from '../src/api/openapi.js'

/**
 * Writes `docs/openapi.json`.
 *
 * The document is served live at `/api/v1/openapi.json`, so this file is not
 * how anybody consumes it. It is checked in so that a change to the public
 * contract shows up as a diff in review — which is what makes the promise in
 * `docs/api-stability.md` something a reviewer can hold you to rather than
 * something you meant. `test/openapi.test.ts` fails when it is stale.
 *
 * No `servers` and a fixed version, because the checked-in artefact describes
 * the API and not one deployment of it.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const target = join(repoRoot, 'docs', 'openapi.json')

writeFileSync(target, openApiJson(buildOpenApiDocument({ version: '0.0.0' })))
console.log(`wrote ${target}`)
