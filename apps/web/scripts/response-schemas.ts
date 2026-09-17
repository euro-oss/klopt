import ts from 'typescript'

/**
 * Response schemas, taken from the handlers' own return types.
 *
 * Spec 10.2 wants the OpenAPI document "generated from the same schemas the
 * code validates against, never hand-maintained". The request half satisfies
 * that easily, because requests are validated by Zod schemas that already
 * exist. Responses are not validated at all: a handler builds an object and
 * `handle` stringifies it.
 *
 * The obvious fix — write a Zod schema per operation and check the body
 * against it — means a hundred and fourteen schemas whose only guarantee is
 * that somebody read the handler carefully once. That is the hand-maintained
 * second source of truth the sentence rules out, arriving by a different door.
 *
 * So the schema is the handler's inferred return type, read out of the
 * TypeScript program. It cannot drift, because it is not a copy: change what a
 * handler returns and the document changes with it, in the same commit,
 * whether or not anybody remembered.
 *
 * ## Why this can work here and usually cannot
 *
 * TypeScript types are not JSON. A type containing `bigint`, `Date`, `Map`, a
 * function or a class instance describes something `JSON.stringify` will
 * mangle, and no honest schema can be produced for it.
 *
 * This codebase does not have that problem, and the conversion below refuses
 * rather than guesses when it meets one: every handler already serialises
 * money to a decimal string and dates to `YYYY-MM-DD` before returning,
 * because the wire format was decided in M0 and there is a lint rule about it.
 * A `bigint` reaching a response type is a bug, and `UNCONVERTIBLE` turns it
 * into a failed build rather than a document that quietly says `{}`.
 *
 * ## Named types stay named
 *
 * A type alias with no type parameters — `AccountType`, `TaxRole`,
 * `PaymentBatchState` — becomes a component and is referenced. Generic aliases
 * (`Record`, `Readonly`, `Immutable`) are expanded, because their names say
 * nothing to a reader of the document.
 */

/** What a converted type is: JSON Schema, as data. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue }
export type JsonObject = { [k: string]: JsonValue }

export interface ConversionResult {
  readonly schema: JsonObject
  /** Named types this schema referenced, to be merged into the document. */
  readonly components: Readonly<Record<string, JsonObject>>
}

export class UnconvertibleTypeError extends Error {
  constructor(
    readonly typeText: string,
    readonly path: string,
  ) {
    super(
      `${path}: cannot describe \`${typeText}\` in JSON Schema. ` +
        'A response type has to be something JSON.stringify produces faithfully — ' +
        'serialise it in the handler (money as a decimal string, dates as YYYY-MM-DD) ' +
        'rather than letting the shape reach the wire.',
    )
    this.name = 'UnconvertibleTypeError'
  }
}

/** Types that are legitimately not JSON, on the routes that stream bytes. */
const NOT_JSON = new Set(['Uint8Array', 'ReadableStream', 'Response', 'Blob', 'ArrayBuffer'])

export function isNotJson(type: ts.Type, checker: ts.TypeChecker): boolean {
  const name = type.getSymbol()?.getName() ?? type.aliasSymbol?.getName()
  return name !== undefined && NOT_JSON.has(name) ? true : NOT_JSON.has(checker.typeToString(type))
}

interface Context {
  readonly checker: ts.TypeChecker
  readonly components: Record<string, JsonObject>
  /** Types currently being converted, so a recursive one becomes a `$ref`. */
  readonly open: Map<ts.Type, string>
}

export function convertType(
  type: ts.Type,
  checker: ts.TypeChecker,
  path = 'response',
): ConversionResult {
  const context: Context = { checker, components: {}, open: new Map() }
  const schema = convert(type, context, path)
  return { schema, components: context.components }
}

function convert(type: ts.Type, context: Context, path: string): JsonObject {
  const { checker } = context

  // A name we can reuse, and a place to break a cycle.
  const named = nameOf(type)
  if (named !== undefined) {
    const open = context.open.get(type)
    if (open !== undefined) return { $ref: `#/components/schemas/${open}` }
    if (named in context.components) return { $ref: `#/components/schemas/${named}` }
  }

  const primitive = convertPrimitive(type, checker)
  if (primitive !== undefined) return primitive

  if (named !== undefined) {
    context.open.set(type, named)
    // Placed before conversion so a self-reference inside finds it.
    context.components[named] = {}
    const built = convertStructural(type, context, path)
    context.components[named] = built
    context.open.delete(type)
    return { $ref: `#/components/schemas/${named}` }
  }

  return convertStructural(type, context, path)
}

/** Everything with no members: primitives, literals, unions of them. */
function convertPrimitive(type: ts.Type, checker: ts.TypeChecker): JsonObject | undefined {
  const flags = type.getFlags()

  if (flags & ts.TypeFlags.StringLiteral) return { const: (type as ts.StringLiteralType).value }
  if (flags & ts.TypeFlags.NumberLiteral) return { const: (type as ts.NumberLiteralType).value }
  if (flags & ts.TypeFlags.BooleanLiteral) {
    return { const: checker.typeToString(type) === 'true' }
  }
  if (flags & ts.TypeFlags.String) return { type: 'string' }
  if (flags & ts.TypeFlags.Number) return { type: 'number' }
  if (flags & ts.TypeFlags.Boolean) return { type: 'boolean' }
  if (flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void)) {
    return { type: 'null' }
  }
  // `never` in a union is nothing; on its own it is a handler that cannot
  // return, which is not a response.
  if (flags & ts.TypeFlags.Never) return { not: {} }
  return undefined
}

function convertStructural(type: ts.Type, context: Context, path: string): JsonObject {
  const { checker } = context

  if (type.isUnion()) return convertUnion(type, context, path)

  if (type.getFlags() & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) {
    throw new UnconvertibleTypeError(checker.typeToString(type), path)
  }
  if (
    type.getFlags() &
    (ts.TypeFlags.BigInt | ts.TypeFlags.BigIntLiteral | ts.TypeFlags.ESSymbol)
  ) {
    throw new UnconvertibleTypeError(checker.typeToString(type), path)
  }

  if (checker.isArrayType(type) || checker.isTupleType(type)) {
    const [element] = checker.getTypeArguments(type as ts.TypeReference)
    return {
      type: 'array',
      items: element === undefined ? {} : convert(element, context, `${path}[]`),
    }
  }

  // A callable or constructable type is not data.
  if (type.getCallSignatures().length > 0 || type.getConstructSignatures().length > 0) {
    throw new UnconvertibleTypeError(checker.typeToString(type), path)
  }

  if (isNotJson(type, checker)) {
    throw new UnconvertibleTypeError(checker.typeToString(type), path)
  }

  return convertObject(type, context, path)
}

function convertUnion(type: ts.UnionType, context: Context, path: string): JsonObject {
  return unionOf(type.types.map((member) => convert(member, context, path)))
}

/**
 * Combines already-converted alternatives into one schema.
 *
 * Three shapes get special treatment because they are almost all of them, and
 * because the general answer — `anyOf` of everything — is correct and much
 * harder to read: a union of string literals is an enum, a nullable one is
 * that enum with `null` in it, and `X | null` is `type: [X, 'null']`.
 */
function unionOf(input: readonly JsonObject[]): JsonObject {
  // TypeScript models `boolean` as `false | true`, and a union containing both
  // literals is that type however it got there. Left alone it reaches the
  // document as two `const`s, which is true and unreadable.
  const parts = dedupe(collapseBooleans(input)) as JsonObject[]

  const nullable = parts.some((part) => part['type'] === 'null')
  const rest = parts.filter((part) => part['type'] !== 'null')

  if (rest.length === 0) return { type: 'null' }

  const enumerated = asEnum(rest)
  if (enumerated !== undefined) {
    return { enum: nullable ? [...enumerated, null] : enumerated }
  }

  const only = rest[0]
  if (rest.length === 1 && only !== undefined) {
    if (!nullable) return only
    if (Array.isArray(only['enum'])) return { enum: [...only['enum'], null] }
    // `{ type: 'string' }` and nothing else becomes `['string', 'null']`;
    // anything carrying constraints keeps them, inside an anyOf.
    if (typeof only['type'] === 'string' && Object.keys(only).length === 1) {
      return { type: [only['type'], 'null'] }
    }
    return { anyOf: [only, { type: 'null' }] }
  }

  return { anyOf: nullable ? [...rest, { type: 'null' }] : rest }
}

/** The literal values, if every alternative is a bare constant of one kind. */
function asEnum(parts: readonly JsonObject[]): JsonValue[] | undefined {
  if (parts.length < 2) return undefined
  const values: JsonValue[] = []

  for (const part of parts) {
    if (Object.keys(part).length !== 1 || !('const' in part)) return undefined
    const value = part['const'] ?? null
    if (typeof value === 'object') return undefined
    values.push(value)
  }
  // Mixing `'a' | 1` in an enum is legal JSON Schema and a sign of a type
  // nobody meant; leave it as an anyOf so it reads as the oddity it is.
  return new Set(values.map((value) => typeof value)).size === 1 ? values : undefined
}

function collapseBooleans(parts: readonly JsonObject[]): JsonObject[] {
  const isConst = (value: boolean) => (part: JsonObject) =>
    Object.keys(part).length === 1 && part['const'] === value

  if (!parts.some(isConst(true)) || !parts.some(isConst(false))) return [...parts]
  return [
    { type: 'boolean' },
    ...parts.filter((part) => !isConst(true)(part) && !isConst(false)(part)),
  ]
}

function convertObject(type: ts.Type, context: Context, path: string): JsonObject {
  const { checker } = context
  const properties: JsonObject = {}
  const required: string[] = []

  for (const property of checker.getPropertiesOfType(type)) {
    const name = property.getName()
    // Location-free: a member synthesised by a mapped type — `Immutable<T>`
    // produces several here — has no declaration to resolve against.
    const propertyType = checker.getTypeOfSymbol(property)

    // `foo?: string` and `foo: string | undefined` are the same on the wire —
    // the key is simply absent — and JSON Schema says that with `required`,
    // not by admitting a null the client would then have to handle.
    // Split only when there is an `undefined` to drop. Splitting always would
    // decompose `AccountType` into its literals before `convert` could
    // recognise the alias, and the document would lose every name it has.
    const members = propertyType.isUnion() ? propertyType.types : [propertyType]
    const present = members.filter((member) => (member.getFlags() & ts.TypeFlags.Undefined) === 0)
    const complete = present.length === members.length

    properties[name] = complete
      ? convert(propertyType, context, `${path}.${name}`)
      : unionOf(present.map((member) => convert(member, context, `${path}.${name}`)))

    const optional = (property.getFlags() & ts.SymbolFlags.Optional) !== 0
    if (!optional && complete) required.push(name)
  }

  // `Record<string, T>` and index signatures.
  const stringIndex = checker.getIndexInfoOfType(type, ts.IndexKind.String)
  const schema: JsonObject = { type: 'object', properties }
  if (required.length > 0) schema['required'] = required
  if (stringIndex !== undefined) {
    schema['additionalProperties'] = convert(stringIndex.type, context, `${path}[key]`)
  } else if (Object.keys(properties).length === 0) {
    // An object with no properties and no index signature describes nothing.
    // Better to say so than to emit `{"type":"object"}` and imply a shape.
    throw new UnconvertibleTypeError(checker.typeToString(type), path)
  }

  return schema
}

/**
 * The name to publish this type under, or undefined to inline it.
 *
 * Only aliases that are already a name a reader could look up: no type
 * arguments, not one of TypeScript's own utility aliases, and not an anonymous
 * object literal type, which has no name worth having.
 */
function nameOf(type: ts.Type): string | undefined {
  const alias = type.aliasSymbol
  if (alias === undefined) return undefined
  if (type.aliasTypeArguments !== undefined && type.aliasTypeArguments.length > 0) return undefined

  const name = alias.getName()
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) return undefined
  if (UTILITY_ALIASES.has(name)) return undefined
  return name
}

const UTILITY_ALIASES = new Set([
  'Partial',
  'Required',
  'Readonly',
  'Record',
  'Pick',
  'Omit',
  'Exclude',
  'Extract',
  'NonNullable',
  'Awaited',
  'Immutable',
])

function dedupe(parts: readonly JsonObject[]): JsonValue[] {
  const seen = new Set<string>()
  const out: JsonValue[] = []
  for (const part of parts) {
    const key = JSON.stringify(part)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(part)
  }
  return out
}
