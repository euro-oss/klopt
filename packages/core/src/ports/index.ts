export type { EmailAttachment, EmailMessage, EmailResult, EmailTransport } from './email.js'
export type {
  SchematronFailure,
  SchematronResult,
  SchematronSeverity,
  SchematronValidator,
} from './schematron.js'
export type {
  InvoiceDocumentRenderer,
  InvoiceRenderOptions,
  RenderedDocument,
} from './documents.js'
export type {
  EInvoiceAttachment,
  EInvoiceChannel,
  EInvoiceDocument,
  EInvoiceRecipient,
  EInvoiceReceipt,
  EInvoiceTransport,
} from './e-invoice.js'
export {
  type BankFeedAccount,
  type BankFeedConsent,
  type BankFeedFetch,
  type BankFeedProvider,
  type ConsentState,
  CONSENT_WARNING_DAYS,
  consentStateFor,
} from './bank-feed.js'
export {
  type ParsedVatNumber,
  type VatNumberCheck,
  type VatNumberCheckRequest,
  type VatNumberOutcome,
  type VatNumberValidator,
  isEuVatCountry,
  normaliseVatNumber,
  parseVatNumber,
} from './vat-number.js'
export type { InboundAttachment, InboundMessage, InboundPoll, InboundSource } from './inbound.js'
export type {
  FilingPayload,
  FilingReceipt,
  FilingStatus,
  FilingTransport,
  FilingTransportKind,
} from './filing.js'
export {
  type DocumentStore,
  type StoredDocument,
  contentTypeFor,
  looksLikeXml,
  sha256Hex,
} from './document-store.js'
