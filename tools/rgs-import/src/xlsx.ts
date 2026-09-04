import { unzipSync, strFromU8 } from 'fflate'

/**
 * Just enough of xlsx to read a sheet as rows of strings.
 *
 * A full spreadsheet library would be a large dependency for one maintainer
 * task that runs a few times a year. What is needed here is: unzip, resolve
 * shared strings, and read cell values as text. Formatting, formulas, dates and
 * types are all irrelevant — the RGS workbook is a table of codes.
 */

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'

export interface Workbook {
  readonly sheetNames: readonly string[]
  /** Rows of a sheet, keyed by column letter. Blank cells are absent. */
  readSheet(name: string): Record<string, string>[]
}

/** Minimal XML tag scanner. The files here are machine-generated and flat. */
function* tags(xml: string, tagName: string): Generator<{ attrs: string; body: string }> {
  const open = new RegExp(`<${tagName}(\\s[^>]*?)?(/?)>`, 'g')
  let match: RegExpExecArray | null

  while ((match = open.exec(xml)) !== null) {
    const attrs = match[1] ?? ''
    if (match[2] === '/') {
      yield { attrs, body: '' }
      continue
    }
    const close = xml.indexOf(`</${tagName}>`, open.lastIndex)
    if (close === -1) return
    yield { attrs, body: xml.slice(open.lastIndex, close) }
    open.lastIndex = close
  }
}

function attribute(attrs: string, name: string): string | null {
  const match = new RegExp(`${name}="([^"]*)"`).exec(attrs)
  return match?.[1] ?? null
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
}

function decode(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (entity) => ENTITIES[entity] ?? entity)
}

/** Concatenated text of every <t> in a fragment, which is how xlsx stores runs. */
function textOf(fragment: string): string {
  let out = ''
  for (const t of tags(fragment, 't')) out += decode(t.body)
  return out
}

export function openWorkbook(bytes: Uint8Array): Workbook {
  const files = unzipSync(bytes)

  const read = (path: string): string => {
    const file = files[path]
    if (file === undefined) throw new Error(`${path} is not in this workbook.`)
    return strFromU8(file)
  }

  const sharedStrings: string[] = []
  if (files['xl/sharedStrings.xml'] !== undefined) {
    for (const si of tags(read('xl/sharedStrings.xml'), 'si')) {
      sharedStrings.push(textOf(si.body))
    }
  }

  // Sheet name -> relationship id -> file path.
  const relationships = new Map<string, string>()
  for (const rel of tags(read('xl/_rels/workbook.xml.rels'), 'Relationship')) {
    const id = attribute(rel.attrs, 'Id')
    const target = attribute(rel.attrs, 'Target')
    if (id !== null && target !== null) {
      relationships.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target}`)
    }
  }

  const sheets = new Map<string, string>()
  for (const sheet of tags(read('xl/workbook.xml'), 'sheet')) {
    const name = attribute(sheet.attrs, 'name')
    const id = attribute(sheet.attrs, 'r:id')
    const path = id === null ? null : relationships.get(id)
    if (name !== null && path !== undefined && path !== null) sheets.set(name, path)
  }

  return {
    sheetNames: [...sheets.keys()],

    readSheet(name: string): Record<string, string>[] {
      const path = sheets.get(name)
      if (path === undefined) {
        throw new Error(`No sheet named ${name}. Found: ${[...sheets.keys()].join(', ')}`)
      }

      const xml = read(path)
      const rows: Record<string, string>[] = []

      for (const row of tags(xml, 'row')) {
        const cells: Record<string, string> = {}

        for (const cell of tags(row.body, 'c')) {
          const reference = attribute(cell.attrs, 'r')
          if (reference === null) continue
          const column = /^[A-Z]+/.exec(reference)?.[0]
          if (column === undefined) continue

          const type = attribute(cell.attrs, 't')
          let value: string

          if (type === 'inlineStr') {
            value = textOf(cell.body)
          } else {
            const v = /<v>([\s\S]*?)<\/v>/.exec(cell.body)?.[1]
            if (v === undefined) continue
            value = type === 's' ? (sharedStrings[Number(v)] ?? '') : decode(v)
          }

          if (value !== '') cells[column] = value
        }

        rows.push(cells)
      }

      return rows
    },
  }
}

export const SPREADSHEET_NAMESPACE = NS
