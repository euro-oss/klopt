/**
 * Sending an invoice, as a port (spec 8).
 *
 * Spec 8's four rules, and how they land here:
 *
 *  1. **Every adapter has a manual or file-based implementation that needs no
 *     third party, and it is the default in a fresh install.** The email
 *     transport is that: SMTP if configured, otherwise the message goes to a
 *     directory or the log, and the operator can still get the document out.
 *  2. **Credentials are per entity, encrypted, entered by the operator.** Which
 *     is why nothing here takes an API key — a transport is constructed with
 *     its configuration and the domain never sees it.
 *  3. **Every adapter records every request and response for the evidence
 *     chain.** `EInvoiceReceipt` is that record, and it is written whether the
 *     send succeeded or not.
 *  4. **A failing adapter degrades to its fallback with a visible warning and
 *     never blocks bookkeeping.** Hence `reachable()`: a Peppol transport
 *     answers "is this participant on the network" *before* anything is sent,
 *     so the fallback is a choice rather than a recovery.
 */

export type EInvoiceChannel = 'peppol' | 'email' | 'file'

export interface EInvoiceRecipient {
  readonly name: string
  readonly email: string | null
  /** BT-49 and its scheme. What a Peppol lookup needs. */
  readonly electronicAddress: string | null
  readonly electronicAddressScheme: string | null
  readonly countryCode: string
}

export interface EInvoiceAttachment {
  readonly filename: string
  readonly contentType: string
  readonly content: Uint8Array | string
}

export interface EInvoiceDocument {
  readonly invoiceNumber: string
  readonly kind: 'invoice' | 'credit_note'
  /** The UBL. This is the invoice; everything else is a rendering. */
  readonly xml: string
  readonly xmlFilename: string
  /** The human-readable rendering, when there is one. */
  readonly pdf?: EInvoiceAttachment | undefined
  /** Total and currency, for the covering message. */
  readonly total: string
  readonly currency: string
  readonly dueDate: string
  /** Who is sending, for the covering message. */
  readonly sellerName: string
  /**
   * A reminder rather than the invoice, and which one. Absent when this is the
   * invoice itself.
   */
  readonly reminder?: { readonly stage: number; readonly daysOverdue: number } | undefined
}

export interface EInvoiceReceipt {
  readonly channel: EInvoiceChannel
  /** The adapter's own name and version, e.g. `smtp` or `storecove/v2`. */
  readonly transport: string
  readonly delivered: boolean
  /** The transport's own id, for the evidence chain. Null when it has none. */
  readonly messageId: string | null
  /** Where it went — an address or a participant identifier. */
  readonly recipient: string
  /** Why not, when it did not. */
  readonly failure: string | null
}

export interface EInvoiceTransport {
  readonly channel: EInvoiceChannel
  readonly name: string
  /**
   * Can this recipient be reached on this channel at all?
   *
   * For email that is "do we have an address". For Peppol it is an SMP lookup.
   * Asked before sending so that falling back is a decision made in the open.
   */
  reachable(recipient: EInvoiceRecipient): Promise<boolean>
  send(document: EInvoiceDocument, recipient: EInvoiceRecipient): Promise<EInvoiceReceipt>
}
