import PDFDocument from 'pdfkit'
import type {
  InvoiceDocumentRenderer,
  InvoicePresentation,
  InvoiceRenderOptions,
  RenderedDocument,
} from '@klopt/core'

/**
 * An invoice as a PDF.
 *
 * Drawn with pdfkit rather than rendered from HTML by a headless browser. A
 * Chromium in the image is three hundred megabytes and a second per document
 * against principle 5's "one container, Postgres, S3", to lay out a page that
 * is a header, a table and a totals block. The standard fonts are built into
 * every PDF reader, so there are no font files to ship either.
 *
 * This file makes no decisions. Every string it draws was decided by
 * `presentInvoice` in `@klopt/core` — including the legal notices a reverse
 * charge obliges — so what is here is geometry.
 */

const PAGE_MARGIN = 50
const CONTENT_WIDTH = 595.28 - PAGE_MARGIN * 2

const FONT = 'Helvetica'
const BOLD = 'Helvetica-Bold'

/** Description, quantity, unit price, VAT, line total. */
const COLUMNS = [
  { key: 'description', header: 'Omschrijving', width: 215, align: 'left' },
  { key: 'quantity', header: 'Aantal', width: 70, align: 'right' },
  { key: 'unitPrice', header: 'Prijs', width: 75, align: 'right' },
  { key: 'taxCode', header: 'Btw', width: 45, align: 'right' },
  { key: 'net', header: 'Bedrag', width: 90, align: 'right' },
] as const

type Doc = InstanceType<typeof PDFDocument>

function columnX(index: number): number {
  let x = PAGE_MARGIN
  for (let position = 0; position < index; position += 1) x += COLUMNS[position]!.width
  return x
}

function rule(doc: Doc, y: number, weight = 0.5): void {
  doc
    .save()
    .lineWidth(weight)
    .strokeColor('#c8c8c8')
    .moveTo(PAGE_MARGIN, y)
    .lineTo(PAGE_MARGIN + CONTENT_WIDTH, y)
    .stroke()
    .restore()
}

function header(doc: Doc, invoice: InvoicePresentation): void {
  doc.font(BOLD).fontSize(18).text(invoice.seller.name, PAGE_MARGIN, PAGE_MARGIN)
  doc.font(FONT).fontSize(9).fillColor('#555555')
  for (const line of invoice.seller.addressLines) doc.text(line)
  for (const line of invoice.seller.identifiers) doc.text(line)
  doc.fillColor('#000000')

  // The document's own title, top right, where an eye looks first.
  doc
    .font(BOLD)
    .fontSize(20)
    .text(invoice.title, PAGE_MARGIN, PAGE_MARGIN, { width: CONTENT_WIDTH, align: 'right' })
  doc
    .font(FONT)
    .fontSize(11)
    .text(invoice.number, PAGE_MARGIN, PAGE_MARGIN + 24, {
      width: CONTENT_WIDTH,
      align: 'right',
    })
}

function parties(doc: Doc, invoice: InvoicePresentation): number {
  const top = 150

  doc.font(BOLD).fontSize(9).text('Factuuradres', PAGE_MARGIN, top)
  doc
    .font(FONT)
    .fontSize(10)
    .text(invoice.buyer.name, PAGE_MARGIN, top + 14)
  let y = top + 28
  for (const line of [...invoice.buyer.addressLines, ...invoice.buyer.identifiers]) {
    doc.fontSize(9).text(line, PAGE_MARGIN, y)
    y += 12
  }

  // The metadata block sits opposite, as a two-column label/value list.
  const metaX = PAGE_MARGIN + 320
  let metaY = top
  for (const item of invoice.meta) {
    doc.font(BOLD).fontSize(9).text(item.label, metaX, metaY, { width: 100 })
    doc
      .font(FONT)
      .fontSize(9)
      .text(item.value, metaX + 105, metaY, { width: 90, align: 'right' })
    metaY += 14
  }

  return Math.max(y, metaY) + 20
}

function table(doc: Doc, invoice: InvoicePresentation, top: number): number {
  let y = top

  doc.font(BOLD).fontSize(9)
  COLUMNS.forEach((column, index) => {
    doc.text(column.header, columnX(index), y, { width: column.width - 8, align: column.align })
  })
  y += 14
  rule(doc, y, 1)
  y += 8

  doc.font(FONT).fontSize(9)
  for (const row of invoice.rows) {
    // Measure first: a long description wraps, and the row has to grow with it
    // rather than the next row landing on top of it.
    const height = doc.heightOfString(row.description, { width: COLUMNS[0].width - 8 })

    if (y + height > 700) {
      doc.addPage()
      y = PAGE_MARGIN
    }

    COLUMNS.forEach((column, index) => {
      doc.text(row[column.key], columnX(index), y, {
        width: column.width - 8,
        align: column.align,
      })
    })
    y += Math.max(height, 12) + 6
  }

  rule(doc, y)
  return y + 12
}

function totals(doc: Doc, invoice: InvoicePresentation, top: number): number {
  const labelX = PAGE_MARGIN + 300
  const amountX = PAGE_MARGIN + 400
  let y = top

  doc.font(FONT).fontSize(9)
  for (const row of invoice.taxRows) {
    doc.text(`${row.label} over ${row.base}`, labelX, y, { width: 95, align: 'right' })
    doc.text(row.amount, amountX, y, { width: 95, align: 'right' })
    y += 14
  }

  if (invoice.taxRows.length > 0) y += 4

  for (const total of invoice.totals) {
    doc.font(total.emphasis === true ? BOLD : FONT).fontSize(total.emphasis === true ? 11 : 9)
    doc.text(total.label, labelX, y, { width: 95, align: 'right' })
    doc.text(`${invoice.currency} ${total.amount}`, amountX, y, { width: 95, align: 'right' })
    y += total.emphasis === true ? 18 : 14
  }

  return y + 16
}

function footer(doc: Doc, invoice: InvoicePresentation, top: number): void {
  let y = top
  doc.font(FONT).fontSize(9).fillColor('#000000')

  for (const notice of invoice.notices) {
    doc.text(notice, PAGE_MARGIN, y, { width: CONTENT_WIDTH })
    y += 14
  }

  if (invoice.notes !== null) {
    doc.text(invoice.notes, PAGE_MARGIN, y, { width: CONTENT_WIDTH })
    y += doc.heightOfString(invoice.notes, { width: CONTENT_WIDTH }) + 6
  }

  if (invoice.payment !== null) {
    y += 6
    doc
      .font(FONT)
      .fontSize(9)
      .fillColor('#333333')
      .text(invoice.payment, PAGE_MARGIN, y, { width: CONTENT_WIDTH })
  }
}

export function createInvoicePdfRenderer(): InvoiceDocumentRenderer {
  return {
    renderInvoice(invoice: InvoicePresentation, options: InvoiceRenderOptions = {}) {
      return new Promise<RenderedDocument>((resolve, reject) => {
        const doc = new PDFDocument({
          size: 'A4',
          margin: PAGE_MARGIN,
          info: {
            Title: `${invoice.title} ${invoice.number}`,
            Author: invoice.seller.name,
            Subject: `${invoice.title} ${invoice.number}`,
            Creator: 'Klopt',
          },
        })

        const chunks: Buffer[] = []
        doc.on('data', (chunk: Buffer) => chunks.push(chunk))
        doc.on('error', reject)
        doc.on('end', () => {
          resolve({
            bytes: new Uint8Array(Buffer.concat(chunks)),
            contentType: 'application/pdf',
            filename: `${invoice.number}.pdf`,
          })
        })

        header(doc, invoice)
        const afterParties = parties(doc, invoice)
        const afterTable = table(doc, invoice, afterParties)
        const afterTotals = totals(doc, invoice, afterTable)
        footer(doc, invoice, afterTotals)

        if (options.attachUbl !== undefined) {
          doc.file(Buffer.from(options.attachUbl.xml, 'utf8'), {
            name: options.attachUbl.filename,
            type: 'application/xml',
            description: 'UBL 2.1 (Peppol BIS Billing 3.0)',
            // `AFRelationship: Alternative` is what Factur-X uses, and it is
            // the honest relationship here too: the XML is the same invoice,
            // not an extra. pdfkit writes it; @types/pdfkit has not caught up,
            // hence the cast rather than a missing feature.
            ...({ relationship: 'Alternative' } as Record<string, string>),
          })
        }

        doc.end()
      })
    },
  }
}
