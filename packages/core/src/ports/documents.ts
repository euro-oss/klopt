import type { InvoicePresentation } from '../invoice/presentation.js'

/**
 * Rendering a document, as a port.
 *
 * Producing a PDF needs a PDF library, and `@klopt/core` is meant to be
 * readable arithmetic and rules. So the layout decisions — the wording, the
 * grouping, the legal notices a reverse charge obliges — are made in core by
 * `presentInvoice`, and turning that into bytes is an adapter's job.
 *
 * The split also means the rendering is testable without producing a PDF: what
 * is worth asserting is that a reverse-charge invoice says "btw verlegd" and
 * that the totals are the ledger's, not where the box is on the page.
 */

export interface RenderedDocument {
  readonly bytes: Uint8Array
  readonly contentType: string
  readonly filename: string
}

export interface InvoiceRenderOptions {
  /**
   * The UBL to embed as an attachment.
   *
   * Spec 7.5's fallback transport is "email the UBL plus a PDF rendering, and
   * optionally a PDF with the XML embedded". Attaching it means the
   * machine-readable invoice travels with the human-readable one, which is what
   * a recipient who can parse it needs. This is **not** Factur-X or PDF/A-3:
   * those additionally require an ICC profile, an output intent and XMP
   * metadata, and claiming conformance without them would be a lie.
   */
  readonly attachUbl?: { readonly filename: string; readonly xml: string } | undefined
}

export interface InvoiceDocumentRenderer {
  renderInvoice(
    invoice: InvoicePresentation,
    options?: InvoiceRenderOptions,
  ): Promise<RenderedDocument>
}
