import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'
import { validate } from '@readme/openapi-parser'
import { describe, expect, it } from 'vitest'
import { listOperations } from '@klopt/core'
import { routeManifest } from '../src/api/manifest.js'
import * as schemas from '../src/api/schemas.js'
import {
  BINARY_RESPONSES,
  RESPONSES_PATH,
  buildResponseSchemas,
} from '../scripts/build-response-schemas.js'
import {
  buildOpenApiDocument,
  openApiJson,
  pathParameters,
  undocumentedResponses,
  type JsonValue,
} from '../src/api/openapi.js'

/**
 * Spec 10.2's document, and the two things worth proving about it.
 *
 * The first is that it is valid OpenAPI 3.1 — checked by a real parser, not by
 * looking at it. A document that only mostly parses is a document that breaks
 * somebody's client generator on a Friday.
 *
 * The second is that it says what the code does. Every assertion below reaches
 * for the thing it is describing — the registry, the manifest, the schema —
 * rather than a literal, so a test passing means the two agree and not that
 * they were typed the same way twice.
 */

const document = buildOpenApiDocument({ version: '0.0.0' })
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/**
 * As much of an Operation Object as these tests read.
 *
 * Declared rather than reached for through `any`, so that a test asking for a
 * field the generator never emits does not silently compare `undefined` with
 * `undefined` and pass.
 */
interface Parameter {
  readonly name: string
  readonly in: 'path' | 'query' | 'header'
  readonly required?: boolean
  readonly schema?: JsonValue
}

interface Operation {
  readonly operationId: string
  readonly summary: string
  readonly parameters?: readonly Parameter[]
  readonly requestBody?: {
    readonly required: boolean
    readonly content: Record<string, { readonly schema: JsonValue }>
  }
  readonly responses: Record<string, { readonly $ref?: string }>
  readonly 'x-klopt-permission': string
  readonly 'x-klopt-kind': string
  readonly 'x-klopt-agent-exposure': string
}

/** One operation, or a failure naming what was looked for. */
function at(path: string, method: string): Operation {
  const paths = document['paths'] as Record<string, Record<string, JsonValue> | undefined>
  const operation = paths[path]?.[method]
  if (operation === undefined) throw new Error(`The document has no ${method} ${path}.`)
  return operation as unknown as Operation
}

/** The `required` list of a JSON Schema object, or an empty one. */
function required(schema: JsonValue | undefined): readonly string[] {
  if (schema === null || schema === undefined || typeof schema !== 'object') return []
  if (Array.isArray(schema)) return []
  const list = schema['required']
  return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : []
}

/** A JSON value narrowed to an object. `typeof null` is 'object'. */
function asObject(value: JsonValue | undefined): Record<string, JsonValue> | undefined {
  return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : undefined
}

function contentOf(operation: Operation, status = '200'): Record<string, JsonValue> {
  const responses = operation.responses as unknown as Record<string, JsonValue>
  return asObject(asObject(responses[status])?.['content']) ?? {}
}

function schemaOfResponse(response: unknown): Record<string, JsonValue> | undefined {
  const content = asObject(asObject(response as JsonValue)?.['content'])
  return asObject(asObject(content?.['application/json'])?.['schema'])
}

function componentsOf(section: 'schemas' | 'responses'): Record<string, JsonValue> {
  const components = document['components'] as Record<string, Record<string, JsonValue>>
  return components[section] ?? {}
}

describe('it is a valid OpenAPI 3.1 document', () => {
  it('parses', async () => {
    // The parser mutates and resolves what it is given, so it gets a copy.
    const result = await validate(structuredClone(document) as never)
    // The message before the boolean: a bare `false` tells you nothing about
    // which of two hundred and fifty thousand characters is wrong.
    expect(result.valid ? [] : result.errors).toEqual([])
    expect(result.valid).toBe(true)
  })

  it('says 3.1', () => {
    expect(document['openapi']).toMatch(/^3\.1\./)
  })
})

describe('every operation the API has, the document has', () => {
  const described = new Set<string>()
  for (const methods of Object.values(document['paths'] as Record<string, JsonValue>)) {
    for (const operation of Object.values(methods as Record<string, { operationId: string }>)) {
      described.add(operation.operationId)
    }
  }

  it('describes each registered operation exactly once', () => {
    expect([...described].sort()).toEqual(listOperations().map((item) => item.id))
  })

  it('describes as many operations as the manifest binds', () => {
    expect(described.size).toBe(routeManifest.length)
  })

  it('carries the registry summary rather than a second one', () => {
    for (const operation of listOperations()) {
      const binding = routeManifest.find((item) => item.operationId === operation.id)
      expect(binding).toBeDefined()
      const described = at(`/api/v1${binding!.path}`, binding!.method.toLowerCase())
      expect(described.summary, operation.id).toBe(operation.summary)
      expect(described['x-klopt-permission'], operation.id).toBe(operation.permission)
      expect(described['x-klopt-agent-exposure'], operation.id).toBe(operation.agentExposure)
    }
  })
})

describe('the request side comes from the schemas the routes parse', () => {
  it('turns a body schema into a request body, transforms resolved inbound', () => {
    const post = at('/api/v1/journal-entries', 'post')
    const schema = post.requestBody?.content['application/json']?.schema

    expect(post.requestBody?.required).toBe(true)
    // `minorUnits` parses a string and yields a bigint. The document must show
    // the string: it describes what a caller sends, not what we end up with.
    const serialised = JSON.stringify(schema)
    expect(serialised).toContain('MinorUnits')
    expect(serialised).not.toContain('bigint')
    expect(required(schema)).toContain('journalCode')
    // Has a default, so a caller need not send it.
    expect(required(schema)).not.toContain('dryRun')
  })

  it('splits a query schema into one parameter each, not a blob', () => {
    const parameters = at('/api/v1/journal-entries', 'get').parameters ?? []
    const names = parameters.map((parameter) => parameter.name)

    expect(names.length).toBeGreaterThan(1)
    expect(parameters.every((parameter) => parameter.in === 'query')).toBe(true)
    expect(names).not.toContain('query')
  })

  it('declares path parameters as required', () => {
    const parameters = at('/api/v1/journal-entries/{entryId}', 'get').parameters ?? []
    expect(parameters.find((parameter) => parameter.name === 'entryId')).toMatchObject({
      in: 'path',
      required: true,
    })
  })

  it('names money once, so an integrator can look it up', () => {
    expect(Object.keys(componentsOf('schemas'))).toContain('MinorUnits')
    expect(JSON.stringify(componentsOf('schemas')['MinorUnits'])).toContain('minor units')
  })
})

describe('what a write is obliged to send', () => {
  const writes = listOperations().filter((operation) => operation.kind === 'write')

  it('requires an idempotency key on every one of them', () => {
    expect(writes.length).toBeGreaterThan(10)

    for (const operation of writes) {
      const binding = routeManifest.find((item) => item.operationId === operation.id)!
      const parameters = at(`/api/v1${binding.path}`, binding.method.toLowerCase()).parameters ?? []
      const header = parameters.find(
        (parameter) => parameter.in === 'header' && parameter.name === 'idempotency-key',
      )
      expect(header, operation.id).toBeDefined()
      expect(header?.required, operation.id).toBe(true)
    }
  })

  it('does not ask a read for one', () => {
    const parameters = at('/api/v1/journal-entries', 'get').parameters ?? []
    expect(parameters.filter((parameter) => parameter.in === 'header')).toEqual([])
  })
})

describe('the errors it admits to', () => {
  it('gives every operation the four that any of them can answer with', () => {
    for (const binding of routeManifest) {
      const responses = at(`/api/v1${binding.path}`, binding.method.toLowerCase()).responses
      expect(Object.keys(responses), binding.operationId).toEqual(
        expect.arrayContaining(['401', '403', '422', '500']),
      )
    }
  })

  it('offers 404 where there is something to miss, and not otherwise', () => {
    for (const binding of routeManifest) {
      const responses = at(`/api/v1${binding.path}`, binding.method.toLowerCase()).responses
      const has404 = '404' in responses
      expect(has404, `${binding.method} ${binding.path}`).toBe(
        pathParameters(binding.path).length > 0,
      )
    }
  })

  it('points them all at one problem document rather than repeating it', () => {
    const post = at('/api/v1/journal-entries', 'post')
    expect(post.responses['401']?.$ref).toBe('#/components/responses/Unauthenticated')

    const unauthenticated = JSON.stringify(componentsOf('responses')['Unauthenticated'])
    expect(unauthenticated).toContain('#/components/schemas/Problem')
    expect(unauthenticated).toContain('401')
  })

  it('lists exactly the codes the error module can produce', () => {
    // Not a literal list: `STATUS` is what `problemResponse` switches on, and
    // a code added there without a component here would be a document that
    // omits a status the API really answers with.
    expect(Object.keys(componentsOf('responses')).sort()).toEqual(
      [
        'Conflict',
        'Forbidden',
        'Gone',
        'IdempotencyKeyRequired',
        'InternalError',
        'NotFound',
        'Unauthenticated',
        'ValidationFailed',
      ].sort(),
    )
  })
})

describe('the checked-in copies are the current ones', () => {
  /**
   * Re-derives every response schema from the TypeScript program.
   *
   * Six seconds, which is the slowest thing in this suite and worth it: this
   * is the test that makes "the document cannot drift from the handlers" a
   * fact rather than an intention. Change what a handler returns and forget to
   * regenerate, and the build says so.
   */
  it('has response schemas matching the handlers as they are now', () => {
    const derived = buildResponseSchemas()
    const onDisk = JSON.parse(
      readFileSync(join(REPO, 'apps', 'web', RESPONSES_PATH), 'utf8'),
    ) as unknown

    // If this fails, run `pnpm --filter @klopt/web run openapi`.
    expect(onDisk).toEqual(derived)
  }, 60_000)

  it('matches what the generator produces', () => {
    const onDisk = readFileSync(join(REPO, 'docs', 'openapi.json'), 'utf8')
    // If this fails, run `pnpm --filter @klopt/web run openapi`. It failing is
    // the point: a change to the public contract should appear in a diff that
    // a reviewer sees, not only in a response nobody looked at.
    expect(onDisk).toBe(openApiJson(buildOpenApiDocument({ version: '0.0.0' })))
  })

  it('carries no instance-specific server', () => {
    expect(document['servers']).toBeUndefined()
    expect(
      buildOpenApiDocument({ version: '1.2.3', baseUrl: 'https://x.test' })['servers'],
    ).toEqual([{ url: 'https://x.test' }])
  })
})

describe('the response side', () => {
  it('gives every success response a schema', () => {
    // Zero, not a ceiling. It was 158 before the schemas were derived from the
    // handlers' return types; the assertion stays because a route added in a
    // shape the generator cannot read would show up here.
    expect(undocumentedResponses(document)).toBe(0)
  })

  it('describes a body with the fields the handler actually returns', () => {
    const schema = at('/api/v1/journal-entries/{entryId}', 'get').responses['200']
    const body = schemaOfResponse(schema)
    const entry = asObject(asObject(body?.['properties'])?.['entry'])

    expect(Object.keys(asObject(entry?.['properties']) ?? {})).toEqual(
      expect.arrayContaining(['id', 'journalCode', 'bookingDate', 'description', 'lines']),
    )
    // Money out is a string, the same as money in. If a handler ever returns a
    // bigint the generator refuses outright, so this is the weaker restatement
    // of that: whatever it returns, it is not a number.
    const lines = asObject(asObject(entry?.['properties'])?.['lines'])
    expect(JSON.stringify(asObject(lines?.['items'])?.['properties'])).toContain(
      '"debit":{"type":"string"}',
    )
  })

  it('answers bytes with a media type and no JSON schema', () => {
    for (const [operationId, media] of Object.entries(BINARY_RESPONSES)) {
      const binding = routeManifest.find((item) => item.operationId === operationId)
      expect(binding, operationId).toBeDefined()
      const content = contentOf(at(`/api/v1${binding!.path}`, binding!.method.toLowerCase()))
      expect(Object.keys(content), operationId).toEqual([media])
      expect(content[media], operationId).toEqual({ schema: { type: 'string', format: 'binary' } })
    }
  })

  it('has an entry for every route that answers with bytes, and no stale ones', () => {
    // The list is declared, because two of those routes take their content
    // type from the document they serve. This is what keeps it honest in both
    // directions.
    const declared = new Set(Object.keys(BINARY_RESPONSES))
    for (const operationId of declared) {
      expect(routeManifest.some((item) => item.operationId === operationId)).toBe(true)
    }
    const json = routeManifest.filter((item) => !declared.has(item.operationId))
    for (const binding of json) {
      const content = contentOf(at(`/api/v1${binding.path}`, binding.method.toLowerCase()))
      expect(Object.keys(content), binding.operationId).toEqual(['application/json'])
    }
  })

  it('gives a write the same body on 200 and 201', () => {
    // A replayed write returns what the first one returned. Describing them
    // differently would send a client looking for a difference that is not
    // there.
    const post = at('/api/v1/journal-entries', 'post')
    expect(JSON.stringify(contentOf(post, '200'))).toBe(JSON.stringify(contentOf(post, '201')))
  })

  it('names the types the domain names, rather than repeating their literals', () => {
    const schemas = componentsOf('schemas')
    expect(Object.keys(schemas)).toEqual(expect.arrayContaining(['AccountType', 'TaxRole']))
    expect(schemas['AccountType']).toEqual({
      enum: ['asset', 'liability', 'equity', 'revenue', 'expense'],
    })
  })

  it('resolves the recursive one into a reference rather than giving up', () => {
    // The audit log's before/after are arbitrary JSON. A converter without
    // cycle detection either loops forever or emits `{}`.
    const jsonValue = JSON.stringify(componentsOf('schemas')['JsonValue'])
    expect(jsonValue).toContain('#/components/schemas/JsonValue')
    expect(jsonValue).not.toBe('{}')
  })

  it('says in the document that the responses are the return types', () => {
    const info = document['info'] as Record<string, JsonValue>
    expect(info['description']).toContain('inferred return types')
    expect(info['description']).not.toContain('not described yet')
  })
})

/**
 * The claim that makes the document worth having.
 *
 * A description generated from the validating schemas is only useful if the
 * two agree, and "generated from" is not by itself a proof of that: the
 * conversion could drop a constraint, or resolve the wrong side of a
 * transform, and the document would still look plausible.
 *
 * So: run a body through Zod, run it through the document's JSON Schema, and
 * require the same answer. In one direction only — see the last test.
 */
describe('the document accepts what the API accepts', () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true })

  /**
   * One request schema, carrying the components its `$ref`s point at.
   *
   * A fragment lifted out of the document refers to `#/components/schemas/...`
   * — the document's root, not its own. Re-attaching `components` makes those
   * pointers resolve, which is exactly what a client generator does when it
   * reads the whole file.
   */
  const schemaFor = (path: string, method: string): object =>
    withComponents(at(path, method).requestBody?.content['application/json']?.schema)

  const withComponents = (schema: unknown): object => ({
    ...(structuredClone(schema) as object),
    components: structuredClone(document['components']),
  })

  const entry = (overrides: Record<string, unknown> = {}) => ({
    journalCode: 'MEM',
    bookingDate: '2026-03-31',
    documentDate: '2026-03-31',
    description: 'Afschrijving maart',
    lines: [
      { accountNumber: '4800', debit: '12500' },
      { accountNumber: '0220', credit: '12500' },
    ],
    ...overrides,
  })

  it('compiles every request schema in the document', () => {
    // A schema ajv refuses to compile is one no client generator will read
    // either, however valid the surrounding document is.
    let compiled = 0
    for (const binding of routeManifest) {
      const operation = at(`/api/v1${binding.path}`, binding.method.toLowerCase())
      const schema = operation.requestBody?.content['application/json']?.schema
      if (schema === undefined) continue
      expect(() => ajv.compile(withComponents(schema)), binding.operationId).not.toThrow()
      compiled += 1
    }
    expect(compiled).toBe(routeManifest.filter((b) => b.request?.body !== undefined).length)
    expect(compiled).toBeGreaterThan(30)
  })

  it('agrees on a body the domain accepts', () => {
    const body = entry()
    expect(schemas.postJournalEntryBody.safeParse(body).success).toBe(true)
    expect(ajv.validate(schemaFor('/api/v1/journal-entries', 'post'), body)).toBe(true)
  })

  it('agrees that money is not a number', () => {
    // The one mistake every integrator makes once. Both sides must refuse it,
    // or the document invites the bug the lint rule exists to prevent.
    const body = entry({
      lines: [
        { accountNumber: '4800', debit: 12500 },
        { accountNumber: '0220', credit: '12500' },
      ],
    })
    expect(schemas.postJournalEntryBody.safeParse(body).success).toBe(false)
    expect(ajv.validate(schemaFor('/api/v1/journal-entries', 'post'), body)).toBe(false)
  })

  it('agrees on a missing required field, and on an omitted default', () => {
    const schema = schemaFor('/api/v1/journal-entries', 'post')
    const { journalCode: _removed, ...withoutJournal } = entry()

    expect(schemas.postJournalEntryBody.safeParse(withoutJournal).success).toBe(false)
    expect(ajv.validate(schema, withoutJournal)).toBe(false)

    // `dryRun` has a default, so neither side may insist on it.
    expect(schemas.postJournalEntryBody.safeParse(entry()).success).toBe(true)
    expect(ajv.validate(schema, entry())).toBe(true)
  })

  it('agrees on a malformed date', () => {
    const body = entry({ bookingDate: '31-03-2026' })
    expect(schemas.postJournalEntryBody.safeParse(body).success).toBe(false)
    expect(ajv.validate(schemaFor('/api/v1/journal-entries', 'post'), body)).toBe(false)
  })

  /**
   * The direction that does not hold, stated rather than hidden.
   *
   * JSON Schema cannot express `.refine()`, so a cross-field rule — here, that
   * a tax code needs a tax role and vice versa — is enforced by the API and
   * invisible in the document. A caller following the document can still be
   * refused with a 422, which is why the 422 is on every operation.
   *
   * This test exists so that the gap is a known one. If Zod ever learns to
   * emit these, it fails, and the paragraph above comes out.
   */
  it('is looser than the API where a rule spans two fields', () => {
    const body = entry({
      lines: [
        { accountNumber: '8000', credit: '12500', taxCode: 'HOOG' },
        { accountNumber: '1300', debit: '12500' },
      ],
    })
    expect(schemas.postJournalEntryBody.safeParse(body).success).toBe(false)
    expect(ajv.validate(schemaFor('/api/v1/journal-entries', 'post'), body)).toBe(true)
  })
})
