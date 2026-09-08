import type { OperationDefinition } from '@klopt/core'

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

export interface RouteBinding {
  /** Id of the operation in the core registry. */
  readonly operationId: string
  readonly method: HttpMethod
  /** Path under /api/v1. */
  readonly path: string
  /** Route file under src/routes, relative to the routes directory. */
  readonly module: string
}

export const routeManifest: readonly RouteBinding[] = [
  {
    operationId: 'ledger.postJournalEntry',
    method: 'POST',
    path: '/journal-entries',
    module: 'api/v1/journal-entries.ts',
  },
  {
    operationId: 'ledger.listJournalEntries',
    method: 'GET',
    path: '/journal-entries',
    module: 'api/v1/journal-entries.ts',
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
  },
  {
    operationId: 'ledger.getTrialBalance',
    method: 'GET',
    path: '/reports/trial-balance',
    module: 'api/v1/reports.trial-balance.ts',
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
  },
  {
    operationId: 'members.setRole',
    method: 'PATCH',
    path: '/members/{memberId}',
    module: 'api/v1/members.$memberId.ts',
  },
  {
    operationId: 'members.remove',
    method: 'DELETE',
    path: '/members/{memberId}',
    module: 'api/v1/members.$memberId.ts',
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
  },
  {
    operationId: 'bank.importStatement',
    method: 'POST',
    path: '/bank-statements',
    module: 'api/v1/bank-statements.ts',
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
  },
  {
    operationId: 'bank.listTransactions',
    method: 'GET',
    path: '/bank-transactions',
    module: 'api/v1/bank-transactions.ts',
  },
  {
    operationId: 'sales.sendInvoice',
    method: 'POST',
    path: '/sales-invoices/{invoiceId}/send',
    module: 'api/v1/sales-invoices.$invoiceId.send.ts',
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
  },
  {
    operationId: 'sales.getDunningQueue',
    method: 'GET',
    path: '/reports/dunning',
    module: 'api/v1/reports.dunning.ts',
  },
  {
    operationId: 'sales.getInvoicePdf',
    method: 'GET',
    path: '/sales-invoices/{invoiceId}/pdf',
    module: 'api/v1/sales-invoices.$invoiceId.pdf.ts',
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
  },
  {
    operationId: 'ledger.listAccounts',
    method: 'GET',
    path: '/accounts',
    module: 'api/v1/accounts.ts',
  },
  {
    operationId: 'ledger.getBalanceSheet',
    method: 'GET',
    path: '/reports/balance-sheet',
    module: 'api/v1/reports.balance-sheet.ts',
  },
  {
    operationId: 'ledger.getProfitAndLoss',
    method: 'GET',
    path: '/reports/profit-and-loss',
    module: 'api/v1/reports.profit-and-loss.ts',
  },
  {
    // Not "reopen": a close is two ordinary entries, and undoing it is a
    // reversal like any other.
    operationId: 'ledger.closeYear',
    method: 'POST',
    path: '/fiscal-years/close',
    module: 'api/v1/fiscal-years.close.ts',
  },
  {
    operationId: 'rgs.getCoverage',
    method: 'GET',
    path: '/rgs/coverage',
    module: 'api/v1/rgs.coverage.ts',
  },
  {
    operationId: 'rgs.setMappings',
    method: 'PUT',
    path: '/rgs/mappings',
    module: 'api/v1/rgs.mappings.ts',
  },
  {
    operationId: 'rgs.previewUpgrade',
    method: 'GET',
    path: '/rgs/upgrade-preview',
    module: 'api/v1/rgs.upgrade-preview.ts',
  },
  {
    // Returns XML, not JSON. Leaving is one request (principle 2).
    operationId: 'export.auditFile',
    method: 'GET',
    path: '/exports/audit-file',
    module: 'api/v1/exports.audit-file.ts',
  },
  {
    operationId: 'import.auditFile',
    method: 'POST',
    path: '/imports/audit-file',
    module: 'api/v1/imports.audit-file.ts',
  },

  // Sales (M1).
  {
    operationId: 'sales.listContacts',
    method: 'GET',
    path: '/contacts',
    module: 'api/v1/contacts.ts',
  },
  {
    operationId: 'sales.createContact',
    method: 'POST',
    path: '/contacts',
    module: 'api/v1/contacts.ts',
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
  },
  {
    operationId: 'sales.draftInvoice',
    method: 'POST',
    path: '/sales-invoices',
    module: 'api/v1/sales-invoices.ts',
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
  },
  {
    operationId: 'sales.listOverdueInvoices',
    method: 'GET',
    path: '/reports/overdue-invoices',
    module: 'api/v1/reports.overdue-invoices.ts',
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
  },
  {
    operationId: 'purchase.transitionInvoice',
    method: 'POST',
    path: '/purchase-invoices/{invoiceId}/transitions',
    module: 'api/v1/purchase-invoices.$invoiceId.transitions.ts',
  },
  {
    operationId: 'purchase.getCreditorAgeing',
    method: 'GET',
    path: '/reports/creditor-ageing',
    module: 'api/v1/reports.creditor-ageing.ts',
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
  },
  {
    operationId: 'inbox.draftFromItem',
    method: 'POST',
    path: '/inbox/{itemId}/draft',
    module: 'api/v1/inbox.$itemId.draft.ts',
  },
  {
    operationId: 'inbox.discardItem',
    method: 'POST',
    path: '/inbox/{itemId}/discard',
    module: 'api/v1/inbox.$itemId.discard.ts',
  },
  {
    operationId: 'inbox.getDocument',
    method: 'GET',
    path: '/documents/{documentId}',
    module: 'api/v1/documents.$documentId.ts',
  },
  {
    operationId: 'audit.list',
    method: 'GET',
    path: '/audit-log',
    module: 'api/v1/audit-log.ts',
  },
  {
    operationId: 'audit.export',
    method: 'GET',
    path: '/audit-log/export',
    module: 'api/v1/audit-log.export.ts',
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
