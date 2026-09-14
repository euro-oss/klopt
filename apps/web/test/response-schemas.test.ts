import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import {
  convertType,
  UnconvertibleTypeError,
  type JsonObject,
} from '../scripts/response-schemas.js'

/**
 * The TypeScript type to JSON Schema conversion, on types written here.
 *
 * Testing it against the real handlers would only prove the handlers still
 * compile. These are the shapes that decide whether the conversion is right —
 * optionality, nullability, recursion, aliases — and the ones that decide
 * whether it fails loudly when it should, which matters more: a converter that
 * quietly emits `{}` for a type it does not understand produces a document
 * that validates, reads plausibly, and is wrong.
 */

/** Converts the type of `export const value: T` in a snippet of source. */
function schemaOf(source: string): JsonObject {
  const file = 'probe.ts'
  const host = ts.createCompilerHost({}, true)
  const original = host.getSourceFile.bind(host)

  host.getSourceFile = (name, language, ...rest) =>
    name === file
      ? ts.createSourceFile(name, source, language, true)
      : original(name, language, ...rest)
  host.fileExists = (name) => name === file || ts.sys.fileExists(name)
  host.readFile = (name) => (name === file ? source : ts.sys.readFile(name))

  const program = ts.createProgram([file], { strict: true, noEmit: true }, host)
  const checker = program.getTypeChecker()
  const sourceFile = program.getSourceFile(file)
  if (sourceFile === undefined) throw new Error('the probe did not compile')

  const symbol = checker
    .getSymbolAtLocation(sourceFile)
    ?.exports?.get(ts.escapeLeadingUnderscores('value'))
  if (symbol === undefined) throw new Error('the probe exports no `value`')

  return convertType(checker.getTypeOfSymbol(symbol), checker).schema
}

function componentsOf(source: string): Readonly<Record<string, JsonObject>> {
  const file = 'probe.ts'
  const host = ts.createCompilerHost({}, true)
  const original = host.getSourceFile.bind(host)
  host.getSourceFile = (name, language, ...rest) =>
    name === file
      ? ts.createSourceFile(name, source, language, true)
      : original(name, language, ...rest)
  host.fileExists = (name) => name === file || ts.sys.fileExists(name)
  host.readFile = (name) => (name === file ? source : ts.sys.readFile(name))

  const program = ts.createProgram([file], { strict: true, noEmit: true }, host)
  const checker = program.getTypeChecker()
  const sourceFile = program.getSourceFile(file)!
  const symbol = checker
    .getSymbolAtLocation(sourceFile)!
    .exports!.get(ts.escapeLeadingUnderscores('value'))!
  return convertType(checker.getTypeOfSymbol(symbol), checker).components
}

describe('the shapes a response is made of', () => {
  it('converts an object with its required list', () => {
    expect(schemaOf('export const value: { a: string; b: number } = { a: "", b: 0 }')).toEqual({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'number' } },
      required: ['a', 'b'],
    })
  })

  it('treats an optional property as absent, not as null', () => {
    // The difference matters to a generated client: `a?: string` produces
    // `string | undefined`, and `a: string | null` produces a value you have
    // to check. Emitting the second for the first would be a lie with
    // consequences.
    const schema = schemaOf('export const value: { a?: string } = {}')
    expect(schema['required']).toBeUndefined()
    expect(schema['properties']).toEqual({ a: { type: 'string' } })
  })

  it('treats an explicit undefined the same way', () => {
    const schema = schemaOf('export const value: { a: string | undefined } = { a: undefined }')
    expect(schema['required']).toBeUndefined()
    expect(schema['properties']).toEqual({ a: { type: 'string' } })
  })

  it('keeps a null, because a null is sent', () => {
    const schema = schemaOf('export const value: { a: string | null } = { a: null }')
    expect(schema['properties']).toEqual({ a: { type: ['string', 'null'] } })
    expect(schema['required']).toEqual(['a'])
  })

  it('makes a union of string literals an enum', () => {
    expect(schemaOf('export const value: "a" | "b" | "c" = "a"')).toEqual({
      enum: ['a', 'b', 'c'],
    })
  })

  it('adds null to an enum rather than wrapping it', () => {
    expect(schemaOf('export const value: "a" | "b" | null = null')).toEqual({
      enum: ['a', 'b', null],
    })
  })

  it('collapses the two boolean literals TypeScript models a boolean as', () => {
    expect(schemaOf('export const value: boolean = true')).toEqual({ type: 'boolean' })
    const inUnion = schemaOf('export const value: boolean | string = true')
    expect(inUnion['anyOf']).toContainEqual({ type: 'boolean' })
    expect(JSON.stringify(inUnion)).not.toContain('const')
  })

  it('converts arrays and nested objects', () => {
    expect(schemaOf('export const value: { xs: { n: number }[] } = { xs: [] }')).toEqual({
      type: 'object',
      properties: {
        xs: {
          type: 'array',
          items: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] },
        },
      },
      required: ['xs'],
    })
  })

  it('converts an index signature to additionalProperties', () => {
    expect(schemaOf('export const value: Record<string, number> = {}')).toEqual({
      type: 'object',
      properties: {},
      additionalProperties: { type: 'number' },
    })
  })
})

describe('names', () => {
  it('publishes a named alias as a component and refers to it', () => {
    const source = `
      type AccountType = 'asset' | 'liability'
      export const value: { kind: AccountType } = { kind: 'asset' }
    `
    expect(schemaOf(source)['properties']).toEqual({
      kind: { $ref: '#/components/schemas/AccountType' },
    })
    expect(componentsOf(source)['AccountType']).toEqual({ enum: ['asset', 'liability'] })
  })

  it('expands a generic alias, whose name says nothing', () => {
    // `Readonly<{ a: string }>` in a document tells a reader less than the
    // shape does, and the name collides with every other use of it.
    const source = 'export const value: Readonly<{ a: string }> = { a: "" }'
    expect(componentsOf(source)).toEqual({})
    expect(schemaOf(source)['properties']).toEqual({ a: { type: 'string' } })
  })

  it('resolves a recursive type into a $ref rather than looping', () => {
    const source = `
      type Tree = { label: string; children: Tree[] }
      export const value: { root: Tree } = { root: { label: '', children: [] } }
    `
    const tree = componentsOf(source)['Tree']
    expect(tree).toBeDefined()
    const children = (tree as { properties: Record<string, JsonObject> }).properties['children']
    expect(children).toEqual({ type: 'array', items: { $ref: '#/components/schemas/Tree' } })
  })
})

describe('what it refuses', () => {
  /**
   * The point of the whole exercise.
   *
   * A schema derived from a type is only trustworthy if the derivation refuses
   * the types it cannot represent. Every case below is one `JSON.stringify`
   * would mangle or drop, and every one of them would otherwise reach the
   * document as something a client generator acts on.
   */
  const refuses = (source: string) => {
    expect(() => schemaOf(source)).toThrow(UnconvertibleTypeError)
  }

  it('refuses a bigint, which is the money bug this is guarding against', () => {
    // `JSON.stringify` throws on a bigint. A response type containing one is a
    // handler that forgot to serialise an amount, and the build should say so
    // rather than the request failing at runtime.
    refuses('export const value: { amount: bigint } = { amount: 0n }')
  })

  it('refuses a Date, which stringifies to something no schema here describes', () => {
    refuses('export const value: { at: Date } = { at: new Date() }')
  })

  it('refuses a Map, which stringifies to {}', () => {
    refuses('export const value: { m: Map<string, string> } = { m: new Map() }')
  })

  it('refuses a function, which stringifies to nothing at all', () => {
    refuses('export const value: { f: () => void } = { f: () => {} }')
  })

  it('refuses any and unknown', () => {
    refuses('export const value: { a: any } = { a: 1 }')
    refuses('export const value: { a: unknown } = { a: 1 }')
  })

  it('refuses bytes, which are a media type and not a schema', () => {
    refuses('export const value: { b: Uint8Array } = { b: new Uint8Array() }')
  })

  it('names the property, so the failure says where to look', () => {
    try {
      schemaOf('export const value: { total: bigint } = { total: 0n }')
      expect.unreachable('it should have refused')
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(UnconvertibleTypeError)
      expect((error as UnconvertibleTypeError).message).toContain('total')
      expect((error as UnconvertibleTypeError).message).toContain('bigint')
    }
  })
})
