import type { OperationDefinition } from '@klopt/core'
import type * as Schemas from './schemas.js'

/**
 * The REST surface (spec 10.1, 10.2).
 *
 * Every domain operation registered in @klopt/core must appear here, and every
 * entry here must name a real operation. The contract test in
 * test/contract.test.ts enforces both directions and fails the build otherwise.
 *
 * This is the mechanism that keeps principle 3 — the API is the product, the UI
 * is one client of it — true in month six, when it would otherwise quietly stop
 * being true. It is not documentation.
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/**
 * A schema exported by `./schemas.ts`, named rather than imported.
 *
 * By name so this file does not pull in a hundred schemas to describe them,
 * and so `test/contract.test.ts` can read the route module and check that the
 * name here is the one the route actually parses with. A name that is not an
 * export of `schemas.ts` does not compile.
 */
export type SchemaName = Extract<keyof typeof Schemas, string>

export interface RouteBinding {
  /** Id of the operation in the core registry. */
  readonly operationId: string
  readonly method: HttpMethod
  /** Path under /api/v1. */
  readonly path: string
  /** Route file under src/routes, relative to the routes directory. */
  readonly module: string
  /**
   * What this route validates, which is what the OpenAPI document describes.
   *
   * Declared here rather than discovered, because a generator that read the
   * route files would be a parser of our own source and would agree with
   * whatever it managed to parse. Declaring it and checking the declaration is
   * the version that fails loudly when they diverge.
   */
  readonly request?: {
    readonly query?: SchemaName
    readonly body?: SchemaName
  }
}

export const routeManifest: readonly RouteBinding[] = [
  {
    operationId: 'ledger.postJournalEntry',
    method: 'POST',
    path: '/journal-entries',
    module: 'api/v1/journal-entries.ts',
    request: { body: 'postJournalEntryBody' },
  },
  {
    operationId: 'ledger.listJournalEntries',
    method: 'GET',
    path: '/journal-entries',
    module: 'api/v1/journal-entries.ts',
    request: { query: 'listEntriesQuery' },
  },
  {
    operationId: 'ledger.getJournalEntry',
    method: 'GET',
    path: '/journal-entries/{entryId}',
    module: 'api/v1/journal-entries.$entryId.ts',
  },
  {
    // Not a DELETE. Corrections are reversals, and the journal is append-only.
    operationId: 'ledger.reverseJournalEntry',
    method: 'POST',
    path: '/journal-entries/{entryId}/reversal',
    module: 'api/v1/journal-entries.$entryId.reversal.ts',
    request: { body: 'reverseJournalEntryBody' },
  },
  {
    operationId: 'ledger.getTrialBalance',
    method: 'GET',
    path: '/reports/trial-balance',
    module: 'api/v1/reports.trial-balance.ts',
    request: { query: 'trialBalanceQuery' },
  },
  {
    operationId: 'ledger.verifyChain',
    method: 'GET',
    path: '/ledger/chain-verification',
    module: 'api/v1/ledger.chain-verification.ts',
  },
  {
    operationId: 'members.list',
    method: 'GET',
    path: '/members',
    module: 'api/v1/members.ts',
  },
  {
    operationId: 'members.invite',
    method: 'POST',
    path: '/members',
    module: 'api/v1/members.ts',
    request: { body: 'inviteMemberBody' },
  },
  {
    operationId: 'members.setRole',
    method: 'PATCH',
    path: '/members/{memberId}',
    module: 'api/v1/members.$memberId.ts',
    request: { body: 'setMemberRoleBody' },
  },
  {
    operationId: 'members.remove',
    method: 'DELETE',
    path: '/members/{memberId}',
    module: 'api/v1/members.$memberId.ts',
  },
  {
    operationId: 'tokens.list',
    method: 'GET',
    path: '/tokens',
    module: 'api/v1/tokens.ts',
  },
  {
    operationId: 'tokens.issue',
    method: 'POST',
    path: '/tokens',
    module: 'api/v1/tokens.ts',
    request: { body: 'issueTokenBody' },
  },
  {
    operationId: 'tokens.revoke',
    method: 'DELETE',
    path: '/tokens/{tokenId}',
    module: 'api/v1/tokens.$tokenId.ts',
  },
  {
    operationId: 'tokens.revokeClient',
    method: 'DELETE',
    path: '/oauth-clients/{clientId}',
    module: 'api/v1/oauth-clients.$clientId.ts',
  },
  {
    operationId: 'setup.listCharts',
    method: 'GET',
    path: '/setup/charts',
    module: 'api/v1/setup.charts.ts',
  },
  {
    // PUT with a client-chosen id: the one write that cannot use the
    // idempotency table, because that table is keyed by entity.
    operationId: 'setup.createEntity',
    method: 'PUT',
    path: '/entities/{entityId}',
    module: 'api/v1/entities.$entityId.ts',
    request: { body: 'createEntityBody' },
  },
  {
    operationId: 'ledger.getEntity',
    method: 'GET',
    path: '/entity',
    module: 'api/v1/entity.ts',
  },
  {
    operationId: 'ledger.updateEntity',
    method: 'PATCH',
    path: '/entity',
    module: 'api/v1/entity.ts',
    request: { body: 'updateEntityBody' },
  },
  {
    operationId: 'sales.getInvoiceUbl',
    method: 'GET',
    path: '/sales-invoices/{invoiceId}/ubl',
    module: 'api/v1/sales-invoices.$invoiceId.ubl.ts',
  },
  {
    operationId: 'payments.listBatches',
    method: 'GET',
    path: '/payment-batches',
    module: 'api/v1/payment-batches.ts',
  },
  {
    operationId: 'payments.createBatch',
    method: 'POST',
    path: '/payment-batches',
    module: 'api/v1/payment-batches.ts',
    request: { body: 'createBatchBody' },
  },
  {
    operationId: 'payments.getBatch',
    method: 'GET',
    path: '/payment-batches/{batchId}',
    module: 'api/v1/payment-batches.$batchId.ts',
  },
  {
    operationId: 'payments.addInstruction',
    method: 'POST',
    path: '/payment-batches/{batchId}/instructions',
    module: 'api/v1/payment-batches.$batchId.instructions.ts',
    request: { body: 'addInstructionBody' },
  },
  {
    operationId: 'payments.removeInstruction',
    method: 'DELETE',
    path: '/payment-batches/{batchId}/instructions/{instructionId}',
    module: 'api/v1/payment-batches.$batchId.instructions.$instructionId.ts',
  },
  {
    operationId: 'payments.transitionBatch',
    method: 'POST',
    path: '/payment-batches/{batchId}/transitions',
    module: 'api/v1/payment-batches.$batchId.transitions.ts',
    request: { body: 'transitionBatchBody' },
  },
  {
    operationId: 'payments.getBatchPain001',
    method: 'GET',
    path: '/payment-batches/{batchId}/pain001',
    module: 'api/v1/payment-batches.$batchId.pain001.ts',
  },
  {
    operationId: 'bank.listAccounts',
    method: 'GET',
    path: '/bank-accounts',
    module: 'api/v1/bank-accounts.ts',
  },
  {
    operationId: 'bank.createAccount',
    method: 'POST',
    path: '/bank-accounts',
    module: 'api/v1/bank-accounts.ts',
    request: { body: 'createBankAccountBody' },
  },
  {
    operationId: 'bank.importStatement',
    method: 'POST',
    path: '/bank-statements',
    module: 'api/v1/bank-statements.ts',
    request: { body: 'importStatementBody' },
  },
  {
    operationId: 'bank.suggestMatches',
    method: 'GET',
    path: '/bank-transactions/{transactionId}/suggestions',
    module: 'api/v1/bank-transactions.$transactionId.suggestions.ts',
  },
  {
    operationId: 'bank.confirmMatch',
    method: 'POST',
    path: '/bank-transactions/{transactionId}/match',
    module: 'api/v1/bank-transactions.$transactionId.match.ts',
    request: { body: 'confirmMatchBody' },
  },
  {
    operationId: 'bank.ignoreTransaction',
    method: 'POST',
    path: '/bank-transactions/{transactionId}/ignore',
    module: 'api/v1/bank-transactions.$transactionId.ignore.ts',
  },
  {
    operationId: 'bank.listMatchRules',
    method: 'GET',
    path: '/bank-match-rules',
    module: 'api/v1/bank-match-rules.ts',
  },
  {
    operationId: 'bank.setMatchRuleActive',
    method: 'PATCH',
    path: '/bank-match-rules/{ruleId}',
    module: 'api/v1/bank-match-rules.$ruleId.ts',
    request: { body: 'setRuleActiveBody' },
  },
  {
    operationId: 'bank.listTransactions',
    method: 'GET',
    path: '/bank-transactions',
    module: 'api/v1/bank-transactions.ts',
    request: { query: 'transactionsQuery' },
  },
  {
    operationId: 'sales.sendInvoice',
    method: 'POST',
    path: '/sales-invoices/{invoiceId}/send',
    module: 'api/v1/sales-invoices.$invoiceId.send.ts',
    request: { body: 'sendInvoiceBody' },
  },
  {
    operationId: 'sales.listDeliveries',
    method: 'GET',
    path: '/sales-invoices/{invoiceId}/deliveries',
    module: 'api/v1/sales-invoices.$invoiceId.deliveries.ts',
  },
  {
    operationId: 'sales.sendDunningReminder',
    method: 'POST',
    path: '/sales-invoices/{invoiceId}/reminders',
    module: 'api/v1/sales-invoices.$invoiceId.reminders.ts',
    request: { body: 'sendReminderBody' },
  },
  {
    operationId: 'sales.getDunningQueue',
    method: 'GET',
    path: '/reports/dunning',
    module: 'api/v1/reports.dunning.ts',
    request: { query: 'dunningQuery' },
  },
  {
    operationId: 'sales.getInvoicePdf',
    method: 'GET',
    path: '/sales-invoices/{invoiceId}/pdf',
    module: 'api/v1/sales-invoices.$invoiceId.pdf.ts',
    request: { query: 'invoicePdfQuery' },
  },
  {
    operationId: 'ledger.listFiscalYears',
    method: 'GET',
    path: '/fiscal-years',
    module: 'api/v1/fiscal-years.ts',
  },
  {
    operationId: 'ledger.createFiscalYear',
    method: 'POST',
    path: '/fiscal-years',
    module: 'api/v1/fiscal-years.ts',
    request: { body: 'createFiscalYearBody' },
  },
  {
    operationId: 'ledger.listAccounts',
    method: 'GET',
    path: '/accounts',
    module: 'api/v1/accounts.ts',
  },
  {
    operationId: 'ledger.listJournals',
    method: 'GET',
    path: '/journals',
    module: 'api/v1/journals.ts',
  },
  {
    operationId: 'ledger.getBalanceSheet',
    method: 'GET',
    path: '/reports/balance-sheet',
    module: 'api/v1/reports.balance-sheet.ts',
    request: { query: 'statementQuery' },
  },
  {
    operationId: 'ledger.getProfitAndLoss',
    method: 'GET',
    path: '/reports/profit-and-loss',
    module: 'api/v1/reports.profit-and-loss.ts',
    request: { query: 'statementQuery' },
  },
  {
    // Not "reopen": a close is two ordinary entries, and undoing it is a
    // reversal like any other.
    operationId: 'ledger.closeYear',
    method: 'POST',
    path: '/fiscal-years/close',
    module: 'api/v1/fiscal-years.close.ts',
    request: { body: 'closeYearBody' },
  },
  {
    operationId: 'rgs.getCoverage',
    method: 'GET',
    path: '/rgs/coverage',
    module: 'api/v1/rgs.coverage.ts',
    request: { query: 'rgsCoverageQuery' },
  },
  {
    operationId: 'rgs.setMappings',
    method: 'PUT',
    path: '/rgs/mappings',
    module: 'api/v1/rgs.mappings.ts',
    request: { body: 'rgsMappingsBody' },
  },
  {
    operationId: 'rgs.previewUpgrade',
    method: 'GET',
    path: '/rgs/upgrade-preview',
    module: 'api/v1/rgs.upgrade-preview.ts',
    request: { query: 'rgsUpgradeQuery' },
  },
  {
    // Returns XML, not JSON. Leaving is one request (principle 2).
    operationId: 'export.auditFile',
    method: 'GET',
    path: '/exports/audit-file',
    module: 'api/v1/exports.audit-file.ts',
    request: { query: 'auditFileQuery' },
  },
  {
    operationId: 'import.auditFile',
    method: 'POST',
    path: '/imports/audit-file',
    module: 'api/v1/imports.audit-file.ts',
    request: { body: 'auditFileImportBody' },
  },

  // Exact Online (M5, spec 13). Connecting, choosing a division and previewing
  // are three requests rather than one, because the middle one is the one that
  // goes wrong: a login reaches every administration the user has rights to,
  // and nothing about the data says which was the test one afterwards.
  {
    operationId: 'exact.getConnection',
    method: 'GET',
    path: '/exact/connection',
    module: 'api/v1/exact.connection.ts',
  },
  {
    operationId: 'exact.connect',
    method: 'POST',
    path: '/exact/connection',
    module: 'api/v1/exact.connection.ts',
    request: { body: 'connectExactBody' },
  },
  {
    operationId: 'exact.disconnect',
    method: 'DELETE',
    path: '/exact/connection',
    module: 'api/v1/exact.connection.ts',
  },
  {
    // The browser lands on the /exact/callback page, which posts here. The
    // OAuth redirect target is a screen rather than an API route so that the
    // API surface stays methods-and-bodies rather than growing a doorway that
    // only makes sense to a redirect.
    operationId: 'exact.completeConnection',
    method: 'POST',
    path: '/exact/callback',
    module: 'api/v1/exact.callback.ts',
    request: { body: 'completeExactBody' },
  },
  {
    operationId: 'exact.listDivisions',
    method: 'GET',
    path: '/exact/divisions',
    module: 'api/v1/exact.divisions.ts',
  },
  {
    operationId: 'exact.chooseDivision',
    method: 'POST',
    path: '/exact/division',
    module: 'api/v1/exact.division.ts',
    request: { body: 'chooseExactDivisionBody' },
  },
  {
    // A GET, because it is a read: nothing here changes. The one thing it does
    // write is a rotated refresh token, which is plumbing rather than a
    // domain effect — and not writing it would break the connection.
    operationId: 'exact.previewImport',
    method: 'GET',
    path: '/exact/import/preview',
    module: 'api/v1/exact.import.preview.ts',
    request: { query: 'exactPreviewQuery' },
  },
  {
    operationId: 'exact.runImport',
    method: 'POST',
    path: '/exact/import',
    module: 'api/v1/exact.import.ts',
    request: { body: 'runExactImportBody' },
  },
  {
    operationId: 'exact.importDocuments',
    method: 'POST',
    path: '/exact/documents',
    module: 'api/v1/exact.documents.ts',
  },
  {
    operationId: 'exact.documentImportStatus',
    method: 'GET',
    path: '/exact/documents',
    module: 'api/v1/exact.documents.ts',
  },

  // Sales (M1).
  {
    operationId: 'sales.listContacts',
    method: 'GET',
    path: '/contacts',
    module: 'api/v1/contacts.ts',
    request: { query: 'contactsQuery' },
  },
  {
    operationId: 'sales.createContact',
    method: 'POST',
    path: '/contacts',
    module: 'api/v1/contacts.ts',
    request: { body: 'createContactBody' },
  },
  {
    operationId: 'sales.getContact',
    method: 'GET',
    path: '/contacts/{contactId}',
    module: 'api/v1/contacts.$contactId.ts',
  },
  {
    operationId: 'sales.updateContact',
    method: 'PATCH',
    path: '/contacts/{contactId}',
    module: 'api/v1/contacts.$contactId.ts',
    request: { body: 'updateContactBody' },
  },
  {
    operationId: 'sales.listTaxCodes',
    method: 'GET',
    path: '/tax-codes',
    module: 'api/v1/tax-codes.ts',
  },
  {
    operationId: 'sales.listInvoices',
    method: 'GET',
    path: '/sales-invoices',
    module: 'api/v1/sales-invoices.ts',
    request: { query: 'invoicesQuery' },
  },
  {
    operationId: 'sales.draftInvoice',
    method: 'POST',
    path: '/sales-invoices',
    module: 'api/v1/sales-invoices.ts',
    request: { body: 'draftInvoiceBody' },
  },
  {
    operationId: 'sales.getInvoice',
    method: 'GET',
    path: '/sales-invoices/{invoiceId}',
    module: 'api/v1/sales-invoices.$invoiceId.ts',
  },
  {
    operationId: 'sales.issueInvoice',
    method: 'POST',
    path: '/sales-invoices/{invoiceId}/issue',
    module: 'api/v1/sales-invoices.$invoiceId.issue.ts',
    request: { body: 'issueInvoiceBody' },
  },
  {
    operationId: 'sales.listOverdueInvoices',
    method: 'GET',
    path: '/reports/overdue-invoices',
    module: 'api/v1/reports.overdue-invoices.ts',
    request: { query: 'overdueQuery' },
  },
  {
    operationId: 'vat.listPeriods',
    method: 'GET',
    path: '/vat/periods',
    module: 'api/v1/vat.periods.ts',
  },
  {
    operationId: 'vat.getReturn',
    method: 'GET',
    path: '/vat/returns/{period}',
    module: 'api/v1/vat.returns.$period.ts',
  },
  {
    operationId: 'vat.listFilings',
    method: 'GET',
    path: '/vat/filings',
    module: 'api/v1/vat.filings.ts',
  },
  {
    operationId: 'vat.fileReturn',
    method: 'POST',
    path: '/vat/filings',
    module: 'api/v1/vat.filings.ts',
    request: { body: 'fileVatReturnBody' },
  },
  {
    operationId: 'vat.getIcp',
    method: 'GET',
    path: '/vat/icp/{period}',
    module: 'api/v1/vat.icp.$period.ts',
  },
  {
    operationId: 'vat.checkVatNumber',
    method: 'POST',
    path: '/vat/number-checks',
    module: 'api/v1/vat.number-checks.ts',
    request: { body: 'checkVatNumbersBody' },
  },
  {
    operationId: 'vat.listSubmissions',
    method: 'GET',
    path: '/vat/filings/{filingId}/submissions',
    module: 'api/v1/vat.filings.$filingId.submissions.ts',
  },
  {
    operationId: 'vat.getFiledInstance',
    method: 'GET',
    path: '/vat/submissions/{submissionId}/instance',
    module: 'api/v1/vat.submissions.$submissionId.instance.ts',
  },
  {
    operationId: 'vat.pollStatus',
    method: 'POST',
    path: '/vat/filings/{filingId}/status',
    module: 'api/v1/vat.filings.$filingId.status.ts',
  },
  {
    operationId: 'purchase.listInvoices',
    method: 'GET',
    path: '/purchase-invoices',
    module: 'api/v1/purchase-invoices.ts',
  },
  {
    operationId: 'purchase.captureInvoice',
    method: 'POST',
    path: '/purchase-invoices',
    module: 'api/v1/purchase-invoices.ts',
    request: { body: 'capturePurchaseInvoiceBody' },
  },
  {
    operationId: 'purchase.getInvoice',
    method: 'GET',
    path: '/purchase-invoices/{invoiceId}',
    module: 'api/v1/purchase-invoices.$invoiceId.ts',
  },
  {
    operationId: 'purchase.bookInvoice',
    method: 'POST',
    path: '/purchase-invoices/{invoiceId}/booking',
    module: 'api/v1/purchase-invoices.$invoiceId.booking.ts',
    request: { body: 'bookPurchaseInvoiceBody' },
  },
  {
    operationId: 'purchase.transitionInvoice',
    method: 'POST',
    path: '/purchase-invoices/{invoiceId}/transitions',
    module: 'api/v1/purchase-invoices.$invoiceId.transitions.ts',
    request: { body: 'transitionPurchaseInvoiceBody' },
  },
  {
    operationId: 'purchase.getCreditorAgeing',
    method: 'GET',
    path: '/reports/creditor-ageing',
    module: 'api/v1/reports.creditor-ageing.ts',
    request: { query: 'creditorAgeingQuery' },
  },
  {
    operationId: 'inbox.receiveDocument',
    method: 'POST',
    path: '/inbox',
    module: 'api/v1/inbox.ts',
  },
  {
    operationId: 'inbox.listItems',
    method: 'GET',
    path: '/inbox',
    module: 'api/v1/inbox.ts',
    request: { query: 'inboxQuery' },
  },
  {
    operationId: 'inbox.draftFromItem',
    method: 'POST',
    path: '/inbox/{itemId}/draft',
    module: 'api/v1/inbox.$itemId.draft.ts',
    request: { body: 'draftFromInboxBody' },
  },
  {
    operationId: 'inbox.discardItem',
    method: 'POST',
    path: '/inbox/{itemId}/discard',
    module: 'api/v1/inbox.$itemId.discard.ts',
    request: { body: 'discardInboxItemBody' },
  },
  {
    operationId: 'inbox.getDocument',
    method: 'GET',
    path: '/documents/{documentId}',
    module: 'api/v1/documents.$documentId.ts',
  },
  {
    operationId: 'snapshot.seal',
    method: 'POST',
    path: '/snapshots',
    module: 'api/v1/snapshots.ts',
    request: { body: 'sealSnapshotBody' },
  },
  {
    operationId: 'snapshot.list',
    method: 'GET',
    path: '/snapshots',
    module: 'api/v1/snapshots.ts',
  },
  {
    operationId: 'snapshot.getManifest',
    method: 'GET',
    path: '/snapshots/{snapshotId}/manifest',
    module: 'api/v1/snapshots.$snapshotId.manifest.ts',
  },
  {
    operationId: 'snapshot.verify',
    method: 'POST',
    path: '/snapshots/{snapshotId}/verifications',
    module: 'api/v1/snapshots.$snapshotId.verifications.ts',
    request: { query: 'verifySnapshotQuery' },
  },
  {
    operationId: 'retention.get',
    method: 'GET',
    path: '/retention',
    module: 'api/v1/retention.ts',
    request: { query: 'retentionQuery' },
  },
  {
    operationId: 'retention.setLegalHold',
    method: 'POST',
    path: '/retention/legal-hold',
    module: 'api/v1/retention.legal-hold.ts',
    request: { body: 'setLegalHoldBody' },
  },
  {
    operationId: 'retention.setClass',
    method: 'POST',
    path: '/retention/class',
    module: 'api/v1/retention.class.ts',
    request: { body: 'setRetentionClassBody' },
  },
  {
    operationId: 'retention.pseudonymiseContact',
    method: 'POST',
    path: '/contacts/:contactId/pseudonymise',
    module: 'api/v1/contacts.$contactId.pseudonymise.ts',
    request: { body: 'pseudonymiseContactBody' },
  },
  {
    operationId: 'retention.deleteDocuments',
    method: 'POST',
    path: '/retention/deletions',
    module: 'api/v1/retention.deletions.ts',
    request: { body: 'deleteDocumentsBody' },
  },
  {
    operationId: 'webhooks.list',
    method: 'GET',
    path: '/webhooks',
    module: 'api/v1/webhooks.ts',
  },
  {
    operationId: 'webhooks.create',
    method: 'POST',
    path: '/webhooks',
    module: 'api/v1/webhooks.ts',
    request: { body: 'createWebhookBody' },
  },
  {
    operationId: 'webhooks.delete',
    method: 'DELETE',
    path: '/webhooks/:endpointId',
    module: 'api/v1/webhooks.$endpointId.ts',
  },
  {
    operationId: 'webhooks.replay',
    method: 'POST',
    path: '/webhooks/:endpointId/replay',
    module: 'api/v1/webhooks.$endpointId.replay.ts',
    request: { body: 'replayWebhookBody' },
  },
  {
    operationId: 'events.list',
    method: 'GET',
    path: '/events',
    module: 'api/v1/events.ts',
    request: { query: 'eventsQuery' },
  },
  {
    operationId: 'audit.list',
    method: 'GET',
    path: '/audit-log',
    module: 'api/v1/audit-log.ts',
    request: { query: 'auditLogQuery' },
  },
  {
    operationId: 'audit.export',
    method: 'GET',
    path: '/audit-log/export',
    module: 'api/v1/audit-log.export.ts',
    request: { query: 'auditLogExportQuery' },
  },
  {
    operationId: 'inbox.listSources',
    method: 'GET',
    path: '/inbox/sources',
    module: 'api/v1/inbox.sources.ts',
  },
  {
    operationId: 'inbox.addSource',
    method: 'POST',
    path: '/inbox/sources',
    module: 'api/v1/inbox.sources.ts',
    request: { body: 'addInboundSourceBody' },
  },
  {
    operationId: 'inbox.removeSource',
    method: 'DELETE',
    path: '/inbox/sources/{sourceId}',
    module: 'api/v1/inbox.sources.$sourceId.ts',
  },
  {
    operationId: 'inbox.pollSource',
    method: 'POST',
    path: '/inbox/sources/{sourceId}/poll',
    module: 'api/v1/inbox.sources.$sourceId.poll.ts',
  },
  {
    operationId: 'payments.previewRun',
    method: 'GET',
    path: '/payment-batches/{batchId}/run',
    module: 'api/v1/payment-batches.$batchId.run.ts',
  },
  {
    operationId: 'payments.addApprovedInvoices',
    method: 'POST',
    path: '/payment-batches/{batchId}/run',
    module: 'api/v1/payment-batches.$batchId.run.ts',
  },
]

export interface ContractViolation {
  readonly kind: 'unrouted-operation' | 'unknown-operation' | 'duplicate-binding'
  readonly detail: string
}

/**
 * Pure so it can be tested against fixtures. A check that can only ever pass is
 * not a check.
 */
export function findContractViolations(
  operations: readonly OperationDefinition[],
  manifest: readonly RouteBinding[],
): readonly ContractViolation[] {
  const violations: ContractViolation[] = []
  const routed = new Set<string>()
  const seenRoutes = new Set<string>()

  for (const binding of manifest) {
    const route = `${binding.method} ${binding.path}`
    if (seenRoutes.has(route)) {
      violations.push({
        kind: 'duplicate-binding',
        detail: `${route} is declared more than once.`,
      })
    }
    seenRoutes.add(route)

    if (routed.has(binding.operationId)) {
      violations.push({
        kind: 'duplicate-binding',
        detail: `${binding.operationId} is bound to more than one route.`,
      })
    }
    routed.add(binding.operationId)
  }

  const known = new Set(operations.map((operation) => operation.id))

  for (const operation of operations) {
    if (!routed.has(operation.id)) {
      violations.push({
        kind: 'unrouted-operation',
        detail: `${operation.id} has no route under /api/v1. Add one, or the UI has a privileged path.`,
      })
    }
  }

  for (const binding of manifest) {
    if (!known.has(binding.operationId)) {
      violations.push({
        kind: 'unknown-operation',
        detail: `${binding.method} /api/v1${binding.path} is bound to unknown operation ${binding.operationId}.`,
      })
    }
  }

  return violations
}
