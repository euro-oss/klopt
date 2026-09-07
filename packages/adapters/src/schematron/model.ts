/**
 * A Schematron schema, as data.
 *
 * ISO Schematron is a small language and this is all of it that the Peppol
 * artefacts use: namespace bindings, `let` variables at three levels, patterns
 * of rules, and assertions. Anything the artefacts do not use is deliberately
 * absent — a half-implemented `<sch:include>` would be worse than none, because
 * it would look supported.
 */

export interface SchematronLet {
  readonly name: string
  readonly value: string
}

export interface SchematronAssert {
  /** `@id`, which is the official rule identifier. */
  readonly id: string
  readonly test: string
  readonly message: string
  /** `@flag`. Peppol uses `fatal` and `warning`. */
  readonly flag: 'fatal' | 'warning'
}

export interface SchematronRule {
  readonly context: string
  readonly lets: readonly SchematronLet[]
  readonly asserts: readonly SchematronAssert[]
}

export interface SchematronPattern {
  readonly id: string | null
  readonly lets: readonly SchematronLet[]
  readonly rules: readonly SchematronRule[]
}

/**
 * An `xsl:function`, translated to a single XPath expression.
 *
 * The Peppol functions are all `param* variable* sequence`, which is exactly a
 * `let … return` chain. Translating rather than reimplementing is the point:
 * the mod-97 arithmetic that decides whether a Belgian company number is valid
 * stays the arithmetic CEN published, not our reading of it.
 */
export interface SchematronFunction {
  /** Namespace-qualified, e.g. `utils`/`slack`. */
  readonly namespaceUri: string
  readonly localName: string
  readonly parameters: readonly string[]
  /** The whole body as one XPath expression. */
  readonly body: string
}

export interface SchematronSchema {
  /** Where it came from, so a failure can say which artefact judged it. */
  readonly artefact: string
  readonly namespaces: Readonly<Record<string, string>>
  readonly lets: readonly SchematronLet[]
  readonly functions: readonly SchematronFunction[]
  readonly patterns: readonly SchematronPattern[]
}

export class SchematronError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SchematronError'
  }
}
