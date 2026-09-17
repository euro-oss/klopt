import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildResponseSchemas, RESPONSES_PATH } from './build-response-schemas.js'

/**
 * Writes the two generated files, in the order they depend on each other.
 *
 * 1. `src/api/response-schemas.generated.json` — every handler's return type,
 *    read out of the TypeScript program.
 * 2. `docs/openapi.json` — the whole document, which imports the first.
 *
 * `openapi.ts` is imported dynamically, after the first file is written,
 * because a static import would read the previous copy — or, on a fresh
 * checkout where it does not exist yet, fail to resolve at all.
 *
 * Both are checked in and both are compared by `test/openapi.test.ts`, so a
 * change to what a handler returns arrives as a diff in review. That is what
 * makes the promise in `docs/api-stability.md` — "a field will not be removed
 * from a response" — something a reviewer can see rather than something a
 * maintainer meant.
 *
 * Run it with `pnpm --filter @klopt/web run openapi`.
 */

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = join(WEB_ROOT, '..', '..')

const responses = buildResponseSchemas()
writeFileSync(join(WEB_ROOT, RESPONSES_PATH), `${JSON.stringify(responses, null, 2)}\n`)
console.log(
  `wrote ${RESPONSES_PATH}: ${String(Object.keys(responses.operations).length)} operations, ` +
    `${String(Object.keys(responses.components).length)} named types`,
)

const { KLOPT_VERSION } = await import('@klopt/core')
const { buildOpenApiDocument, openApiJson } = await import('../src/api/openapi.js')

const target = join(REPO_ROOT, 'docs', 'openapi.json')
// The product's version, so the checked-in document is the one an instance
// of this release serves. It changes on a version bump, which is a one-line
// diff and the honest one.
writeFileSync(target, openApiJson(buildOpenApiDocument({ version: KLOPT_VERSION })))
console.log(`wrote ${target}`)
