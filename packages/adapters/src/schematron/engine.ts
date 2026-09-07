/**
 * A default import, deliberately.
 *
 * fontoxpath ships as CommonJS with no `exports` map, and Node's lexer does
 * not find its named exports through the ESM bridge — `import { evaluateXPath }`
 * compiles and then throws at load time. The namespace object is the shape that
 * actually exists.
 */
import fontoxpath from 'fontoxpath'
import { sync as parseXml } from 'slimdom-sax-parser'
import type { Element, Node } from 'slimdom'
import type { SchematronFailure, SchematronResult, SchematronValidator } from '@klopt/core'
import { SchematronError, type SchematronLet, type SchematronSchema } from './model.js'

/**
 * An ISO Schematron evaluator, over an XPath 3.1 engine.
 *
 * The semantics that matter, and that a naive implementation gets wrong:
 *
 * **A rule's `@context` is a match pattern, not a path.** `cac:TaxSubtotal`
 * means "any element so named, anywhere", not "a child of the document node".
 * So a relative context is turned into an absolute selection before it is
 * evaluated. A context that is already absolute, or a parenthesised union of
 * absolute paths, is left alone.
 *
 * **Within a pattern, the first matching rule claims the node.** Later rules in
 * the same pattern do not see it. This is what lets the artefacts write a
 * specific rule followed by a general one, and ignoring it produces a flood of
 * spurious failures from the general rule.
 *
 * **`let` is lexically scoped and lazy.** Schema-level bindings see the
 * document node, pattern-level ones too, rule-level ones see the matched node.
 * They are evaluated per context node because most of them are relative to it.
 */

const { evaluateXPath, evaluateXPathToBoolean, evaluateXPathToNodes, registerCustomXPathFunction } =
  fontoxpath

/** Custom functions are registered globally by fontoxpath; register once. */
const registered = new Set<string>()

function registerFunctions(schema: SchematronSchema): void {
  for (const declaration of schema.functions) {
    const key = `${declaration.namespaceUri}#${declaration.localName}/${String(declaration.parameters.length)}`
    if (registered.has(key)) continue
    registered.add(key)

    // `item()*` in and out: the artefacts declare types on some parameters and
    // not others, and coercing here would change the arithmetic. The body's own
    // `xs:` casts do the work, exactly as they do under an XSLT processor.
    const argumentTypes = declaration.parameters.map(() => 'item()*')

    registerCustomXPathFunction(
      { namespaceURI: declaration.namespaceUri, localName: declaration.localName },
      argumentTypes,
      'item()*',
      (_context, ...args: unknown[]) => {
        const variables: Record<string, unknown> = {}
        declaration.parameters.forEach((name, index) => {
          variables[name] = args[index] ?? null
        })

        const value: unknown = evaluateXPath(
          declaration.body,
          null,
          null,
          variables,
          evaluateXPath.ANY_TYPE,
          { namespaceResolver: (prefix: string) => schema.namespaces[prefix] ?? null },
        )

        // `item()*` is a sequence, and fontoxpath wants sequences as arrays.
        // ANY_TYPE hands back a bare boolean, number or string for a singleton,
        // so a single value is promoted and nothing is an empty sequence twice.
        if (Array.isArray(value)) return value as unknown[]
        return value === null || value === undefined ? [] : [value]
      },
    )
  }
}

/**
 * A relative match pattern to an absolute selection.
 *
 * Deliberately conservative: anything that already starts with `/` or `(` is
 * left exactly as written, and a union of relative steps is expanded term by
 * term. Rewriting more cleverly than this is how a validator starts disagreeing
 * with the artefact it claims to run.
 */
export function absoluteContext(context: string): string {
  const trimmed = context.replace(/\s+/g, ' ').trim()

  const terms = splitUnion(trimmed)
  return terms
    .map((term) => {
      const item = term.trim()
      if (item.startsWith('/') || item.startsWith('(')) return item
      return `//${item}`
    })
    .join(' | ')
}

/** Split on `|` at depth zero, so predicates and literals are not cut apart. */
function splitUnion(expression: string): string[] {
  const terms: string[] = []
  let depth = 0
  let quote: string | null = null
  let start = 0

  for (let index = 0; index < expression.length; index += 1) {
    const character = expression[index]

    if (quote !== null) {
      if (character === quote) quote = null
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      continue
    }
    if (character === '(' || character === '[') depth += 1
    else if (character === ')' || character === ']') depth -= 1
    else if (character === '|' && depth === 0) {
      // `||` is string concatenation in XPath 3.1, not a union.
      if (expression[index + 1] === '|' || expression[index - 1] === '|') continue
      terms.push(expression.slice(start, index))
      start = index + 1
    }
  }

  terms.push(expression.slice(start))
  return terms.filter((term) => term.trim() !== '')
}

/** A readable path to a node, for a report a human has to act on. */
function locationOf(node: Node): string {
  const steps: string[] = []
  let current: Node | null = node

  while (current !== null && current.nodeType === 1) {
    const element = current as Element
    const parent: Node | null = element.parentNode
    let position = 1

    if (parent !== null) {
      for (const sibling of Array.from(parent.childNodes)) {
        if (sibling === element) break
        if (
          sibling.nodeType === 1 &&
          (sibling as Element).localName === element.localName &&
          (sibling as Element).namespaceURI === element.namespaceURI
        ) {
          position += 1
        }
      }
    }

    steps.unshift(position === 1 ? element.localName : `${element.localName}[${String(position)}]`)
    current = parent
  }

  return `/${steps.join('/')}`
}

type Bindings = Readonly<Record<string, unknown>>

function bind(
  lets: readonly SchematronLet[],
  contextNode: Node,
  inherited: Bindings,
  namespaces: Readonly<Record<string, string>>,
): Bindings {
  let variables: Bindings = inherited

  for (const binding of lets) {
    const value: unknown = evaluateXPath(
      binding.value,
      contextNode,
      null,
      { ...variables },
      evaluateXPath.ANY_TYPE,
      { namespaceResolver: (prefix: string) => namespaces[prefix] ?? null },
    )
    variables = { ...variables, [binding.name]: value }
  }

  return variables
}

export function validateAgainst(
  schemas: readonly SchematronSchema[],
  xml: string,
): SchematronResult {
  let document
  try {
    document = parseXml(xml)
  } catch (error: unknown) {
    throw new SchematronError(
      `The document is not well-formed XML: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const failures: SchematronFailure[] = []
  const warnings: SchematronFailure[] = []
  let assertionsEvaluated = 0

  for (const schema of schemas) {
    registerFunctions(schema)
    const resolver = (prefix: string) => schema.namespaces[prefix] ?? null

    const schemaBindings = bind(schema.lets, document, {}, schema.namespaces)

    for (const pattern of schema.patterns) {
      const patternBindings = bind(pattern.lets, document, schemaBindings, schema.namespaces)

      // First matching rule wins, per pattern. `claimed` is what enforces it.
      const claimed = new Set<Node>()

      for (const rule of pattern.rules) {
        let matched: Node[]
        try {
          // The context can reference schema- and pattern-level `let`s — the
          // Peppol country rules do exactly that — so the bindings have to be
          // in scope before the context is selected, not only afterwards.
          matched = evaluateXPathToNodes(
            absoluteContext(rule.context),
            document,
            null,
            { ...patternBindings },
            { namespaceResolver: resolver },
          )
        } catch (error: unknown) {
          throw new SchematronError(
            `${schema.artefact}: cannot evaluate rule context "${rule.context}": ` +
              (error instanceof Error ? error.message : String(error)),
          )
        }

        for (const node of matched) {
          if (claimed.has(node)) continue
          claimed.add(node)

          const ruleBindings = bind(rule.lets, node, patternBindings, schema.namespaces)

          for (const assertion of rule.asserts) {
            assertionsEvaluated += 1

            let held: boolean
            try {
              held = evaluateXPathToBoolean(
                assertion.test,
                node,
                null,
                { ...ruleBindings },
                {
                  namespaceResolver: resolver,
                },
              )
            } catch (error: unknown) {
              throw new SchematronError(
                `${schema.artefact}: cannot evaluate ${assertion.id}: ` +
                  (error instanceof Error ? error.message : String(error)),
              )
            }

            if (held) continue

            const failure: SchematronFailure = {
              rule: assertion.id,
              message: assertion.message,
              severity: assertion.flag,
              location: locationOf(node),
              test: assertion.test,
              artefact: schema.artefact,
            }
            if (assertion.flag === 'warning') warnings.push(failure)
            else failures.push(failure)
          }
        }
      }
    }
  }

  return {
    valid: failures.length === 0,
    failures,
    warnings,
    artefacts: schemas.map((schema) => schema.artefact),
    assertionsEvaluated,
  }
}

export function createSchematronValidator(
  schemas: readonly SchematronSchema[],
): SchematronValidator {
  return { validate: (xml: string) => validateAgainst(schemas, xml) }
}
