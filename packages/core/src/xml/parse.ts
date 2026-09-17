/**
 * A small XML reader, shared by every format that arrives from outside.
 *
 * No DTDs, no entity definitions, no external references — which is deliberate
 * rather than lazy. An auditfile arrives from an accountant and a bank
 * statement arrives from a bank, and an XML parser that resolves external
 * entities is a file-disclosure vulnerability wearing a helpful expression.
 *
 * Namespace prefixes are **stripped**. Every format this reads is defined by a
 * single schema, real files disagree about whether they declare a prefix at
 * all, and refusing one because it wrote `ns2:Ntry` helps nobody.
 *
 * Lenient about shape, strict about values: element order and optional
 * elements vary between the systems that produce these files, so the readers
 * built on this look elements up by name. Amounts and dates are checked hard by
 * the callers, because misreading one does real damage.
 */

export interface XmlElement {
  readonly name: string
  readonly attributes: Readonly<Record<string, string>>
  readonly children: readonly XmlElement[]
  readonly text: string
}

export class XmlParseError extends Error {
  constructor(
    readonly detail: string,
    readonly path: string,
  ) {
    super(`${path}: ${detail}`)
    this.name = 'XmlParseError'
  }
}

const TAG = /<(\/?)([A-Za-z_][\w.:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g
const ATTRIBUTE = /([A-Za-z_][\w.:-]*)\s*=\s*"([^"]*)"|([A-Za-z_][\w.:-]*)\s*=\s*'([^']*)'/g

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

export function decodeXmlText(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => ENTITIES[name] ?? _)
}

function readAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  ATTRIBUTE.lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = ATTRIBUTE.exec(source)) !== null) {
    const name = (match[1] ?? match[3] ?? '').split(':').pop() ?? ''
    const value = match[2] ?? match[4] ?? ''
    if (name !== '' && name !== 'xmlns') attributes[name] = decodeXmlText(value)
  }

  return attributes
}

export function parseXmlDocument(source: string): XmlElement {
  const withoutProlog = source
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    // CDATA is escaped rather than inlined. Inlining it raw would let
    // <![CDATA[<b>]]> tokenise as a real element.
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, content: string) =>
      content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    )

  if (/<!DOCTYPE/i.test(withoutProlog)) {
    throw new XmlParseError('A DOCTYPE declaration is not accepted.', 'document')
  }

  interface Frame {
    name: string
    attributes: Record<string, string>
    children: XmlElement[]
    text: string
  }

  const stack: Frame[] = []
  let root: XmlElement | null = null
  let lastIndex = 0
  let match: RegExpExecArray | null

  TAG.lastIndex = 0
  while ((match = TAG.exec(withoutProlog)) !== null) {
    const [, closing, rawName, rawAttributes, selfClosing] = match
    const name = (rawName ?? '').split(':').pop() ?? ''

    const between = withoutProlog.slice(lastIndex, match.index)
    if (stack.length > 0 && between.trim() !== '') {
      stack[stack.length - 1]!.text += between
    }
    lastIndex = TAG.lastIndex

    if (closing === '/') {
      const frame = stack.pop()
      if (frame === undefined) throw new XmlParseError(`Unexpected </${name}>.`, 'document')
      if (frame.name !== name) {
        throw new XmlParseError(`Expected </${frame.name}>, found </${name}>.`, frame.name)
      }
      const element: XmlElement = {
        name: frame.name,
        attributes: frame.attributes,
        children: frame.children,
        text: decodeXmlText(frame.text).trim(),
      }
      if (stack.length === 0) root = element
      else stack[stack.length - 1]!.children.push(element)
      continue
    }

    if (selfClosing === '/') {
      const element: XmlElement = {
        name,
        attributes: readAttributes(rawAttributes ?? ''),
        children: [],
        text: '',
      }
      if (stack.length === 0) root = element
      else stack[stack.length - 1]!.children.push(element)
      continue
    }

    stack.push({ name, attributes: readAttributes(rawAttributes ?? ''), children: [], text: '' })
  }

  if (stack.length > 0) {
    throw new XmlParseError(`Unclosed <${stack[stack.length - 1]!.name}>.`, 'document')
  }
  if (root === null) throw new XmlParseError('No root element.', 'document')
  return root
}

export function child(element: XmlElement, name: string): XmlElement | undefined {
  return element.children.find((candidate) => candidate.name === name)
}

export function childrenNamed(element: XmlElement, name: string): readonly XmlElement[] {
  return element.children.filter((candidate) => candidate.name === name)
}

export function textOf(element: XmlElement, name: string): string | null {
  const found = child(element, name)
  if (found === undefined) return null
  return found.text === '' ? null : found.text
}

/**
 * Follow a path of element names, e.g. `Acct/Id/IBAN`.
 *
 * The first match at each step. ISO 20022 nests deeply and a reader that spells
 * out four `child()` calls per field is unreadable, which is its own kind of
 * bug.
 */
export function at(element: XmlElement, path: string): XmlElement | undefined {
  let current: XmlElement | undefined = element
  for (const step of path.split('/')) {
    if (current === undefined) return undefined
    current = child(current, step)
  }
  return current
}

export function textAt(element: XmlElement, path: string): string | null {
  const found = at(element, path)
  return found === undefined || found.text === '' ? null : found.text
}

/** Every element with this name, at any depth. */
export function descendants(element: XmlElement, name: string): XmlElement[] {
  const found: XmlElement[] = []
  const walk = (node: XmlElement): void => {
    for (const candidate of node.children) {
      if (candidate.name === name) found.push(candidate)
      walk(candidate)
    }
  }
  walk(element)
  return found
}
