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
    operationId: 'ledger.listAccounts',
    method: 'GET',
    path: '/accounts',
    module: 'api/v1/accounts.ts',
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
