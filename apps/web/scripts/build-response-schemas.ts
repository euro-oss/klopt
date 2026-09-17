import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { routeManifest, type RouteBinding } from '../src/api/manifest.js'
import { convertType, UnconvertibleTypeError, type JsonObject } from './response-schemas.js'

/**
 * Turns every handler's return type into a response schema.
 *
 * The conversion itself is in `response-schemas.ts`. This is the wiring: find
 * the handler each route calls, ask the TypeScript program what it returns,
 * take the `body`, and key the result by operation id.
 *
 * ## Reading the route source, and why that is safe here
 *
 * The request schemas are *declared* in the manifest and checked against the
 * source, because a declaration that silently disagrees with the code would
 * put a lie in the document. There is no declaration to make here — the schema
 * is the handler's type, and the only question is which handler.
 *
 * So this reads it, and `buildResponseSchemas` throws when any JSON route
 * yields nothing. A route written in a shape this cannot read becomes a failed
 * build naming the route, not a gap in the document nobody notices.
 */

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ROUTES = join(WEB_ROOT, 'src', 'routes')

/**
 * Where the derived schemas are written, relative to `apps/web`.
 *
 * Inside `src` rather than beside this script, because the server imports it:
 * deriving these needs the TypeScript compiler and the source tree, and a
 * container has neither.
 */
export const RESPONSES_PATH = 'src/api/response-schemas.generated.json'

export interface ResponseArtefact {
  /** Keyed by operation id. Either a JSON schema or a media type. */
  readonly operations: Readonly<Record<string, { schema: JsonObject } | { media: string }>>
  readonly components: Readonly<Record<string, JsonObject>>
}

/**
 * The routes that answer with bytes rather than JSON, and what they answer
 * with.
 *
 * Declared, not read: two of them take their content type from the document
 * they are serving, so there is nothing in the source to extract. The media
 * type is part of the contract either way — a client needs to know it is
 * getting a PDF — and `test/openapi.test.ts` requires every entry here to be a
 * real binding and every non-JSON route to have an entry.
 */
export const BINARY_RESPONSES: Readonly<Record<string, string>> = {
  'audit.export': 'text/csv',
  'export.auditFile': 'application/xml',
  'inbox.getDocument': 'application/octet-stream',
  'payments.getBatchPain001': 'application/xml',
  'sales.getInvoiceUbl': 'application/xml',
  'sales.getInvoicePdf': 'application/pdf',
  'snapshot.getManifest': 'application/json',
  'snapshot.getTimestamp': 'application/timestamp-reply',
  'vat.getFiledInstance': 'application/xml',
}

/** The handler each method of a route file calls, read out of the source. */
export function handlersIn(module: string): Record<string, string> {
  const source = readFileSync(join(ROUTES, module), 'utf8')
  const found: Record<string, string> = {}
  let method: string | null = null

  for (const line of source.split('\n')) {
    const isMethod = /^ {6}(GET|POST|PUT|PATCH|DELETE):/.exec(line)
    if (isMethod?.[1] !== undefined) method = isMethod[1]

    for (const [, name] of line.matchAll(/\b(handle[A-Z][A-Za-z0-9]*)\s*\(/g)) {
      // `handleUnscoped` is the runtime glue, not a handler.
      if (name === undefined || name === 'handleUnscoped' || method === null) continue
      found[method] ??= name
    }
  }
  return found
}

function createProgram(): ts.Program {
  const configPath = join(WEB_ROOT, 'tsconfig.json')
  // Wrapped rather than passed: `ts.sys.readFile` is a method, and handing it
  // over unbound is the kind of thing that works until the day it does not.
  const config = ts.readConfigFile(configPath, (path) => ts.sys.readFile(path))
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, WEB_ROOT)
  return ts.createProgram(parsed.fileNames, parsed.options)
}

/** Every exported `handle*` in `src/api/handlers`, by name. */
function handlerReturnTypes(program: ts.Program): Map<string, ts.Type> {
  const checker = program.getTypeChecker()
  const types = new Map<string, ts.Type>()
  const directory = join(WEB_ROOT, 'src', 'api', 'handlers')

  for (const source of program.getSourceFiles()) {
    if (!source.fileName.startsWith(directory)) continue

    ts.forEachChild(source, (node) => {
      if (!ts.isFunctionDeclaration(node) || node.name === undefined) return
      const name = node.name.text
      if (!name.startsWith('handle')) return

      const signature = checker.getSignatureFromDeclaration(node)
      if (signature === undefined) return

      const returned = checker.getReturnTypeOfSignature(signature)
      types.set(name, checker.getAwaitedType(returned) ?? returned)
    })
  }
  return types
}

export function buildResponseSchemas(
  manifest: readonly RouteBinding[] = routeManifest,
  program: ts.Program = createProgram(),
): ResponseArtefact {
  const checker = program.getTypeChecker()
  const returns = handlerReturnTypes(program)

  const operations: Record<string, { schema: JsonObject } | { media: string }> = {}
  const components: Record<string, JsonObject> = {}
  const failures: string[] = []

  for (const binding of manifest) {
    const media = BINARY_RESPONSES[binding.operationId]
    if (media !== undefined) {
      operations[binding.operationId] = { media }
      continue
    }

    const handler = handlersIn(binding.module)[binding.method]
    if (handler === undefined) {
      failures.push(`${binding.operationId}: no handler call found in ${binding.module}`)
      continue
    }

    const returned = returns.get(handler)
    if (returned === undefined) {
      failures.push(`${binding.operationId}: ${handler} is not a function in src/api/handlers`)
      continue
    }

    const body = checker.getPropertyOfType(returned, 'body')
    if (body === undefined) {
      failures.push(
        `${binding.operationId}: ${handler} returns ${checker.typeToString(returned)}, ` +
          'which has no `body`. If it answers with bytes, add it to BINARY_RESPONSES.',
      )
      continue
    }

    try {
      const converted = convertType(checker.getTypeOfSymbol(body), checker, binding.operationId)
      operations[binding.operationId] = { schema: converted.schema }
      Object.assign(components, converted.components)
    } catch (error: unknown) {
      failures.push(
        error instanceof UnconvertibleTypeError
          ? error.message
          : `${binding.operationId}: ${String(error)}`,
      )
    }
  }

  if (failures.length > 0) {
    // Loud, and with all of them at once: fixing these one build at a time is
    // how a person gives up and hard-codes something.
    throw new Error(
      `${String(failures.length)} response schema(s) could not be derived:\n  ${failures.join('\n  ')}`,
    )
  }

  return {
    operations: Object.fromEntries(
      Object.entries(operations).sort(([a], [b]) => a.localeCompare(b)),
    ),
    components: Object.fromEntries(
      Object.entries(components).sort(([a], [b]) => a.localeCompare(b)),
    ),
  }
}
