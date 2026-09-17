import { sync as parseXml } from 'slimdom-sax-parser'
// slimdom's own DOM types, not the browser globals: the two are structurally
// different and TypeScript is right to refuse to mix them.
import type { Element } from 'slimdom'
import {
  SchematronError,
  type SchematronAssert,
  type SchematronFunction,
  type SchematronLet,
  type SchematronPattern,
  type SchematronRule,
  type SchematronSchema,
} from './model.js'

/**
 * Read a `.sch` artefact into the model.
 *
 * The artefacts are treated as data all the way through: nothing is compiled
 * ahead of time, nothing is generated into the repository, and a new Peppol
 * release is a new file in `reference-data/peppol/` (principle 6). The cost is
 * that this parser has to understand Schematron, which is the trade ADR 0017
 * argues for.
 */

const SCH = 'http://purl.oclc.org/dsdl/schematron'
const XSL = 'http://www.w3.org/1999/XSL/Transform'

function children(node: Element, namespaceUri: string, localName: string): Element[] {
  const found: Element[] = []
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType !== 1) continue
    const element = child as Element
    if (element.namespaceURI === namespaceUri && element.localName === localName) {
      found.push(element)
    }
  }
  return found
}

function attribute(node: Element, name: string): string | null {
  const value = node.getAttribute(name)
  return value === null || value === '' ? null : value
}

function letsOf(node: Element): SchematronLet[] {
  return children(node, SCH, 'let').map((element) => {
    const name = attribute(element, 'name')
    const value = attribute(element, 'value')
    if (name === null || value === null) {
      throw new SchematronError('A <let> needs both a name and a value.')
    }
    return { name, value }
  })
}

/**
 * The assertion's message, with `<sch:value-of>` collapsed away.
 *
 * A few Peppol messages interpolate a value into the text. Evaluating that
 * would be nice and is not worth an expression evaluator in the message path:
 * the rule id and the location already say which node, and the published
 * wording is what an integrator is looking for.
 */
function messageOf(node: Element): string {
  return (node.textContent ?? '').replace(/\s+/g, ' ').trim()
}

function assertsOf(rule: Element): SchematronAssert[] {
  const found: SchematronAssert[] = []

  for (const element of children(rule, SCH, 'assert')) {
    const test = attribute(element, 'test')
    if (test === null) throw new SchematronError('An <assert> needs a test.')

    const id = attribute(element, 'id')
    found.push({
      // Unidentified assertions exist in some artefacts. The test is a poor
      // name but a stable one, and better than an empty string in a report.
      id: id ?? test,
      test,
      message: messageOf(element),
      flag: attribute(element, 'flag') === 'warning' ? 'warning' : 'fatal',
    })
  }

  return found
}

function rulesOf(pattern: Element): SchematronRule[] {
  return children(pattern, SCH, 'rule').map((element) => {
    const context = attribute(element, 'context')
    if (context === null) throw new SchematronError('A <rule> needs a context.')
    return { context, lets: letsOf(element), asserts: assertsOf(element) }
  })
}

/**
 * `xsl:function` to a single XPath expression.
 *
 * The subset the Peppol artefacts use is small and closed: `variable`,
 * `sequence` and `choose`/`when`/`otherwise`. Each maps onto XPath 3.1 exactly
 * — a variable is a `let`, a sequence is the result, and a choose is a nested
 * `if … then … else`.
 *
 * Translating rather than reimplementing is the whole argument of ADR 0017.
 * The Luhn arithmetic that decides whether a Swedish organisation number is
 * valid stays the arithmetic CEN published, not our reading of it, so the only
 * thing that can diverge is this translation — and a translation of thirteen
 * functions is reviewable in a way thirteen reimplementations are not.
 */
function elementChildren(node: Element): Element[] {
  return Array.from(node.childNodes)
    .filter((child) => child.nodeType === 1)
    .map((child) => child as Element)
}

function stringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/** The expression a `<variable>` or `<sequence>` carries, however it carries it. */
function valueOf(node: Element, where: string): string {
  const select = attribute(node, 'select')
  if (select !== null) return select

  // `<variable><sequence select="…"/></variable>`, which is how the artefacts
  // write a variable that needs an `as` type.
  const nested = children(node, XSL, 'sequence')[0]
  if (nested !== undefined) {
    const inner = attribute(nested, 'select')
    if (inner !== null) return inner
  }

  const text = node.textContent
  if (text !== null && elementChildren(node).length === 0) return stringLiteral(text)

  throw new SchematronError(`${where}: cannot read a value from <${node.localName}>.`)
}

/** A `variable* (sequence | choose)` body, as one XPath expression. */
function compileBody(node: Element, where: string): string {
  const bindings: string[] = []
  let result: string | null = null

  for (const child of elementChildren(node)) {
    if (child.namespaceURI !== XSL) continue

    if (child.localName === 'param') continue

    if (child.localName === 'variable') {
      const name = attribute(child, 'name')
      if (name === null) throw new SchematronError(`${where}: a variable has no name.`)
      bindings.push(`let $${name} := (${valueOf(child, where)})`)
      continue
    }

    if (child.localName === 'sequence') {
      result = valueOf(child, where)
      continue
    }

    if (child.localName === 'choose') {
      const branches = elementChildren(child).filter((branch) => branch.namespaceURI === XSL)
      const whens = branches.filter((branch) => branch.localName === 'when')
      const otherwise = branches.find((branch) => branch.localName === 'otherwise')

      if (whens.length === 0 || otherwise === undefined) {
        // Without an otherwise, XSLT returns the empty sequence; XPath's `if`
        // demands an else. Refusing is better than inventing a default that
        // silently changes what a rule decides.
        throw new SchematronError(`${where}: a <choose> needs at least one when and an otherwise.`)
      }

      let expression = `(${compileBody(otherwise, where)})`
      for (const when of [...whens].reverse()) {
        const test = attribute(when, 'test')
        if (test === null) throw new SchematronError(`${where}: a <when> has no test.`)
        expression = `if (${test}) then (${compileBody(when, where)}) else ${expression}`
      }
      result = expression
      continue
    }

    throw new SchematronError(`${where}: <${child.localName}> is not translatable.`)
  }

  if (result === null) throw new SchematronError(`${where}: no result expression.`)
  return bindings.length === 0 ? result : `${bindings.join(' ')} return (${result})`
}

function functionsOf(
  schema: Element,
  namespaces: Readonly<Record<string, string>>,
): SchematronFunction[] {
  return children(schema, XSL, 'function').map((element) => {
    const qualified = attribute(element, 'name')
    if (qualified === null) throw new SchematronError('An <xsl:function> needs a name.')

    const [prefix, localName] = qualified.includes(':')
      ? (qualified.split(':') as [string, string])
      : ['', qualified]
    const namespaceUri = prefix === '' ? '' : (namespaces[prefix] ?? '')
    if (namespaceUri === '') {
      throw new SchematronError(`Function ${qualified} uses an unbound prefix.`)
    }

    const parameters = children(element, XSL, 'param').map((parameter) => {
      const name = attribute(parameter, 'name')
      if (name === null) throw new SchematronError(`A parameter of ${qualified} has no name.`)
      return name
    })

    return { namespaceUri, localName, parameters, body: compileBody(element, qualified) }
  })
}

export function parseSchematron(source: string, artefact: string): SchematronSchema {
  const document = parseXml(source)
  const schema = document.documentElement

  if (schema === null || schema.namespaceURI !== SCH || schema.localName !== 'schema') {
    throw new SchematronError(`${artefact} is not an ISO Schematron schema.`)
  }

  const namespaces: Record<string, string> = {}
  for (const element of children(schema, SCH, 'ns')) {
    const prefix = attribute(element, 'prefix')
    const uri = attribute(element, 'uri')
    if (prefix !== null && uri !== null) namespaces[prefix] = uri
  }

  const patterns: SchematronPattern[] = children(schema, SCH, 'pattern').map((element) => ({
    id: attribute(element, 'id'),
    lets: letsOf(element),
    rules: rulesOf(element),
  }))

  if (patterns.length === 0) {
    throw new SchematronError(`${artefact} declares no patterns, so it would validate nothing.`)
  }

  return {
    artefact,
    namespaces,
    lets: letsOf(schema),
    functions: functionsOf(schema, namespaces),
    patterns,
  }
}
