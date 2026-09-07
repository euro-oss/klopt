import { createInvoicePdfRenderer } from '@klopt/adapters'
import type { InvoiceDocumentRenderer } from '@klopt/core'

/** The PDF renderer. Stateless, so one is enough. */

let renderer: InvoiceDocumentRenderer | null = null

export function invoiceRenderer(): InvoiceDocumentRenderer {
  renderer ??= createInvoicePdfRenderer()
  return renderer
}

/** Test seam. */
export function setInvoiceRendererForTest(value: InvoiceDocumentRenderer | null): void {
  renderer = value
}
