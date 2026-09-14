import { z } from 'zod'
import { getOperation, type OperationDefinition } from '@klopt/core'
import { routeManifest, type HttpMethod, type RouteBinding } from './manifest.js'
import { STATUS, type ApiErrorCode } from './errors.js'
import * as schemas from './schemas.js'
import responseSchemas from './response-schemas.generated.json' with { type: 'json' }

/**
 * The OpenAPI 3.1 document (spec 10.2).
 *
 * > OpenAPI 3.1 generated from the same schemas the code validates against,
 * > never hand-maintained.
 *
 * Every field below comes from something that already had to be true:
 *
 *   - the paths and methods from `routeManifest`, which the contract test
 *     already reconciles against the operation registry in both directions;
 *   - the summary, the permission and the agent exposure from that registry,
 *     which is what the permission middleware and the MCP server read;
 *   - the request bodies and query parameters from the Zod schemas the routes
 *     parse with, converted by Zod's own `toJSONSchema`;
 *   - the error statuses from the `STATUS` map `problemResponse` uses.
 *
 * Nothing here is written twice. A description that can drift is a description
 * that will, and an OpenAPI document that lies is worse than none: a generated
 * client compiles against it and fails in production.
 *
 * ## `io: 'input'`
 *
 * Our schemas transform on the way in — a money field is a decimal string on
 * the wire and a `bigint` in the domain, and `listEntriesQuery` turns a string
 * into a number. The output type is the domain's; the *input* type is the
 * wire's, and the wire is what a document describes. Asking Zod for the output
 * side would produce a document telling integrators to send us bigints.
 *
 * ## Responses
 *
 * Also generated, and from the only description of them that exists: the
 * handlers' own inferred return types, read out of the TypeScript program by
 * `scripts/build-response-schemas.ts` into a JSON file this imports. Writing a
 * Zod schema per operation would have been the hand-maintained second source
 * of truth by a different door — accurate the day it was written. See ADR
 * 0044.
 *
 * It is a file rather than something computed here because deriving it needs
 * the compiler and the source, and a container has neither. A test regenerates
 * it and fails when the checked-in copy is stale.
 */

interface ResponseArtefact {
  readonly operations: Readonly<Record<string, { schema?: JsonObject; media?: string }>>
  readonly components: Readonly<Record<string, JsonObject>>
}

const RESPONSES = responseSchemas as ResponseArtefact

/** OpenAPI is JSON, and JSON is not something we have a type for beyond this. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue }
type JsonObject = { [k: string]: JsonValue }

export interface DocumentOptions {
  /** What goes in `info.version`. The instance's version, not the API's. */
  readonly version: string
  /** Absolute base URL of this instance, if it knows one. */
  readonly baseUrl?: string | undefined
}

/**
 * The statuses every authenticated operation can answer with.
 *
 * Not a guess: `handle` catches everything and routes it through
 * `problemResponse`, so any operation can produce these four. The rest are
 * added per operation below, only where the route can actually reach them.
 */
const ALWAYS: readonly ApiErrorCode[] = [
  'unauthenticated',
  'forbidden',
  'validation_failed',
  'internal_error',
]

/** RFC 9457 plus our `violations`, mirroring `ProblemDocument` in errors.ts. */
const PROBLEM_SCHEMA: JsonObject = {
  type: 'object',
  description:
    'RFC 9457 problem details. `violations` carries the domain codes, which are ' +
    'more specific than anything HTTP has to say, and there is usually more than ' +
    'one: an importer posting a thousand entries should learn every rejection in ' +
    'one round trip.',
  properties: {
    type: { type: 'string', format: 'uri', examples: ['https://klopt.dev/errors/not_found'] },
    title: { type: 'string' },
    status: { type: 'integer' },
    code: { type: 'string', enum: Object.keys(STATUS) },
    detail: { type: 'string' },
    requestId: {
      type: ['string', 'null'],
      description:
        'Echoes `x-request-id`, or the one this instance generated. Quote it in a bug report.',
    },
    violations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: 'A `LedgerErrorCode`, or `invalid_request` from schema parsing.',
          },
          path: { type: ['string', 'null'] },
          message: { type: 'string' },
          detail: { type: 'object', additionalProperties: { type: 'string' } },
        },
        required: ['code', 'path', 'message'],
      },
    },
  },
  required: ['type', 'title', 'status', 'code', 'detail', 'requestId', 'violations'],
}

/** A JSON value narrowed to an object, or undefined. `typeof null` is 'object'. */
function asObject(value: JsonValue | undefined): JsonObject | undefined {
  return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : undefined
}

/** Path template placeholders: `/journal-entries/{entryId}` yields `entryId`. */
export function pathParameters(path: string): readonly string[] {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1] ?? '')
}

/**
 * The Zod schema a binding names, or undefined.
 *
 * By name rather than by reference so that `manifest.ts` does not import a
 * hundred schemas, and so that the contract test can check the name against
 * what the route file actually parses. A name that is not a schema is a type
 * error at the manifest, not a surprise here.
 */
function schemaNamed(name: string | undefined): z.ZodType | undefined {
  if (name === undefined) return undefined
  const found = (schemas as Record<string, unknown>)[name]
  return found instanceof z.ZodType ? found : undefined
}

/**
 * One Zod schema as JSON Schema, with its `$defs` lifted out.
 *
 * Zod emits `#/$defs/X` for any subschema carrying an `id`; OpenAPI wants
 * those in `components/schemas`. Lifting them is what makes a shape shared by
 * four endpoints appear once in the document rather than four times.
 */
function toJsonSchema(schema: z.ZodType, components: Record<string, JsonValue>): JsonObject {
  const generated = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io: 'input',
    // A schema Zod cannot represent should be visible in the document rather
    // than crashing the generator or, worse, silently becoming `{}`.
    unrepresentable: 'any',
  }) as JsonObject

  const { $schema: _ignored, $defs, ...rest } = generated
  for (const [name, definition] of Object.entries(asObject($defs) ?? {})) {
    components[name] = rewriteRefs(definition)
  }
  return rewriteRefs(rest) as JsonObject
}

/** `#/$defs/X` is Zod's; `#/components/schemas/X` is OpenAPI's. */
function rewriteRefs(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(rewriteRefs)
  if (value === null || typeof value !== 'object') return value

  const out: JsonObject = {}
  for (const [key, nested] of Object.entries(value)) {
    out[key] =
      key === '$ref' && typeof nested === 'string' && nested.startsWith('#/$defs/')
        ? `#/components/schemas/${nested.slice('#/$defs/'.length)}`
        : rewriteRefs(nested)
  }
  return out
}

/**
 * A query schema, split into one parameter each.
 *
 * OpenAPI has no place for "the query string as an object", and a client
 * generator given one produces a function taking a blob. The object's own
 * properties are the parameters, and its `required` list says which.
 */
function queryParameters(schema: z.ZodType, components: Record<string, JsonValue>): JsonValue[] {
  const generated = toJsonSchema(schema, components)
  const properties = asObject(generated['properties'])
  if (properties === undefined) return []
  const required = new Set(Array.isArray(generated['required']) ? generated['required'] : [])

  return Object.entries(properties).map(([name, definition]) => ({
    name,
    in: 'query',
    required: required.has(name),
    schema: definition,
  }))
}

/**
 * One reusable response per error code, referenced rather than repeated.
 *
 * Written out on every operation this was a third of the document, and a
 * reader scrolling past the same four blocks a hundred and fourteen times
 * stops reading them.
 */
function errorResponseComponents(): JsonObject {
  const components: JsonObject = {}
  for (const [code, status] of Object.entries(STATUS)) {
    components[componentNameFor(code as ApiErrorCode)] = {
      description: `${String(status)} ${code}`,
      content: {
        'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } },
      },
    }
  }
  return components
}

/** `validation_failed` becomes `ValidationFailed`. */
function componentNameFor(code: ApiErrorCode): string {
  return code
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

function errorResponses(codes: readonly ApiErrorCode[]): JsonObject {
  const responses: JsonObject = {}
  for (const code of [...new Set(codes)].sort((a, b) => STATUS[a] - STATUS[b])) {
    responses[String(STATUS[code])] = { $ref: `#/components/responses/${componentNameFor(code)}` }
  }
  return responses
}

/** The error statuses this particular route can reach, and only those. */
function errorCodesFor(binding: RouteBinding, operation: OperationDefinition): ApiErrorCode[] {
  const codes = [...ALWAYS]

  // A path parameter is something that can fail to exist. A collection
  // endpoint has nothing to miss, so listing 404 on it would be noise.
  if (pathParameters(binding.path).length > 0) codes.push('not_found')

  if (operation.kind === 'write') {
    // Both follow from `requireIdempotencyKey`: absent is a 400, reused with a
    // different body is a 409.
    codes.push('idempotency_key_required', 'conflict')
  }

  return codes
}

function operationObject(
  binding: RouteBinding,
  operation: OperationDefinition,
  components: Record<string, JsonValue>,
): JsonObject {
  const parameters: JsonValue[] = pathParameters(binding.path).map((name) => ({
    name,
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }))

  const query = schemaNamed(binding.request?.query)
  if (query !== undefined) parameters.push(...queryParameters(query, components))

  if (operation.kind === 'write') {
    parameters.push({
      name: 'idempotency-key',
      in: 'header',
      required: true,
      description:
        'A client-chosen key. Retrying with the same key and the same body replays ' +
        'the original result rather than acting twice; the same key with a ' +
        'different body is a 409.',
      schema: { type: 'string', minLength: 1 },
    })
  }

  const object: JsonObject = {
    operationId: operation.id,
    summary: operation.summary,
    tags: [operation.id.split('.')[0] ?? 'other'],
    // Not decoration: spec 10.3's proposal model is part of the contract, and
    // an integrator writing an agent needs to know which operations it may
    // call directly and which produce a draft a human releases.
    'x-klopt-permission': operation.permission,
    'x-klopt-kind': operation.kind,
    'x-klopt-agent-exposure': operation.agentExposure,
    responses: {
      ...successResponse(binding),
      ...errorResponses(errorCodesFor(binding, operation)),
    },
  }

  if (parameters.length > 0) object['parameters'] = parameters

  const body = schemaNamed(binding.request?.body)
  if (body !== undefined) {
    object['requestBody'] = {
      required: true,
      content: { 'application/json': { schema: toJsonSchema(body, components) } },
    }
  }

  return object
}

/**
 * The success half.
 *
 * The status is `handle`'s actual behaviour: a read answers 200, and a write
 * answers 200 on a replay or a dry run and 201 otherwise. The body is the
 * handler's return type — the same shape for both, because a replayed write
 * returns what the first one did.
 *
 * A route that answers with bytes says so with its media type and nothing
 * else. There is no schema for a PDF, and pretending otherwise by describing
 * it as a base64 string would be a document a client generator acts on.
 */
function successResponse(binding: RouteBinding): JsonObject {
  const operation = getOperation(binding.operationId)
  const described = RESPONSES.operations[binding.operationId]

  const content: JsonObject =
    described?.media !== undefined
      ? { [described.media]: { schema: { type: 'string', format: 'binary' } } }
      : described?.schema !== undefined
        ? { 'application/json': { schema: described.schema } }
        : // Unreachable: the generator refuses to produce an artefact with a
          // gap in it, and a test compares the artefact to the manifest.
          { 'application/json': {} }

  if (operation?.kind === 'write' && binding.method === 'POST') {
    return {
      '200': { description: 'Replayed, or a dry run.', content },
      '201': { description: 'Created.', content },
    }
  }
  return { '200': { description: 'The request succeeded.', content } }
}

export function undocumentedResponses(document: JsonObject): number {
  let count = 0
  for (const methods of Object.values(asObject(document['paths']) ?? {})) {
    for (const operation of Object.values(asObject(methods) ?? {})) {
      const responses = asObject(asObject(operation)?.['responses'])
      for (const [status, response] of Object.entries(responses ?? {})) {
        if (!status.startsWith('2')) continue
        for (const body of Object.values(asObject(asObject(response)?.['content']) ?? {})) {
          const described = asObject(body)
          if (described !== undefined && !('schema' in described)) count += 1
        }
      }
    }
  }
  return count
}

/**
 * The document as bytes, one way, so the checked-in file and the served one
 * cannot differ by whitespace and send a reviewer looking for a change that is
 * not there.
 */
export function openApiJson(document: JsonObject): string {
  return `${JSON.stringify(document, null, 2)}\n`
}

export function buildOpenApiDocument(options: DocumentOptions): JsonObject {
  // The named types the response schemas reference — `AccountType`, `TaxRole`,
  // `JsonValue` and the rest — come along with them. Request schemas add
  // theirs as they are converted.
  const components: Record<string, JsonValue> = { Problem: PROBLEM_SCHEMA, ...RESPONSES.components }
  const paths: Record<string, JsonObject> = {}

  // Sorted, so that the document checked into the repository changes only when
  // the API does. A diff that reorders itself is a diff nobody reads.
  const sorted = [...routeManifest].sort(
    (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
  )

  for (const binding of sorted) {
    const operation = getOperation(binding.operationId)
    if (operation === undefined) {
      // Unreachable while the contract test passes, and the contract test is
      // what makes it unreachable. Skipping rather than throwing keeps a
      // half-broken manifest from taking the whole instance down.
      continue
    }
    const path = `/api/v1${binding.path}`
    const entry = (paths[path] ??= {})
    entry[binding.method.toLowerCase() as Lowercase<HttpMethod>] = operationObject(
      binding,
      operation,
      components,
    )
  }

  return {
    openapi: '3.1.1',
    info: {
      title: 'Klopt',
      version: options.version,
      summary: 'The Dutch bookkeeping API the Klopt UI is one client of.',
      description: DESCRIPTION,
      license: { name: 'Apache-2.0', identifier: 'Apache-2.0' },
    },
    ...(options.baseUrl === undefined ? {} : { servers: [{ url: options.baseUrl }] }),
    tags: [...new Set(sorted.map((binding) => binding.operationId.split('.')[0] ?? 'other'))]
      .sort()
      .map((name) => ({ name })),
    security: [{ bearerAuth: [] }, { sessionCookie: [] }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description:
            'A scoped API token. It carries its entity and its permission list, so ' +
            'there is no entity parameter anywhere in this document: a token can ' +
            'only ever see the administration it was issued by.',
        },
        sessionCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'better-auth.session_token',
          description:
            'A signed-in human. Their role in the entity they are looking at expands ' +
            'to the same permission strings a token carries. This is how the UI ' +
            'calls the API, and it is the same API.',
        },
      },
      schemas: Object.fromEntries(
        Object.entries(components).sort(([a], [b]) => a.localeCompare(b)),
      ),
      responses: errorResponseComponents(),
    },
    paths,
  }
}

const DESCRIPTION = [
  'Generated from the route manifest, the operation registry, the Zod schemas the',
  "routes validate against and the handlers' own return types — never hand-written.",
  'See ADR 0043 and ADR 0044.',
  '',
  '**Money** crosses this boundary as a string of unsigned integer minor units, never',
  'a number: `"124950"` is €1249,50. A float cannot hold a cent exactly and a ledger',
  'that is out by a cent is out.',
  '',
  '**Dates** are `YYYY-MM-DD`. **Amounts on report responses** are decimal strings.',
  '',
  '**Writes require an `idempotency-key` header.** Retrying with the same key and the',
  'same body replays the first result. This is not advisory: the request is refused',
  'without one.',
  '',
  '**Errors** are RFC 9457 problem documents with a `violations` array carrying the',
  "domain's own codes. `400 Bad Request` is not an API.",
  '',
  "**Response bodies** are the handlers' own inferred return types, read out of the",
  'TypeScript program rather than described alongside it. A field that changes shape',
  'changes here in the same commit. Endpoints that answer with bytes — a PDF, a UBL',
  'invoice, a pain.001 — give a media type and no schema.',
].join('\n')
