/**
 * The domain operation registry (spec 10.1).
 *
 * Principle 3 says the API is the product and the UI is one client of it. That
 * stops being true around month six unless something mechanical keeps it true,
 * so every domain operation registers itself here, and a contract test in
 * apps/web fails the build when a registered operation has no route under
 * /api/v1.
 *
 * The registry is deliberately transport-agnostic: it records that an operation
 * exists and what shape it has, not how it is reached. Nothing here knows about
 * HTTP, MCP or the CLI.
 */

/** Reads are safe to expose broadly. Writes are narrow and named (spec 10.3). */
export type OperationKind = 'read' | 'write'

/**
 * How an agent may invoke a write (spec 10.3). `proposal` operations produce a
 * draft that a human releases; posting to the ledger, filing a return, sending
 * an invoice and initiating a payment are all `proposal`. `direct` requires a
 * token explicitly scoped for it.
 */
export type AgentExposure = 'none' | 'read' | 'proposal' | 'direct'

export interface OperationDefinition {
  /** Stable dotted id, e.g. `ledger.postJournalEntry`. Part of the public contract. */
  readonly id: string
  readonly kind: OperationKind
  /** Permission required to invoke it, checked in middleware, never in the domain. */
  readonly permission: string
  readonly summary: string
  readonly agentExposure: AgentExposure
  /** Writes must accept a client idempotency key (spec 10.2). */
  readonly idempotent: boolean
}

const registry = new Map<string, OperationDefinition>()

export class DuplicateOperationError extends Error {
  constructor(id: string) {
    super(`Operation ${id} is already registered.`)
    this.name = 'DuplicateOperationError'
  }
}

export class InvalidOperationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidOperationError'
  }
}

export function defineOperation(definition: OperationDefinition): OperationDefinition {
  if (registry.has(definition.id)) {
    throw new DuplicateOperationError(definition.id)
  }
  if (definition.kind === 'write' && !definition.idempotent) {
    // Non-negotiable in a ledger: a retried posting must never double-post.
    throw new InvalidOperationError(`Write operation ${definition.id} must be idempotent.`)
  }
  if (definition.kind === 'read' && definition.agentExposure !== 'none') {
    if (definition.agentExposure !== 'read') {
      throw new InvalidOperationError(
        `Read operation ${definition.id} cannot have agent exposure ${definition.agentExposure}.`,
      )
    }
  }

  registry.set(definition.id, definition)
  return definition
}

export function listOperations(): readonly OperationDefinition[] {
  return [...registry.values()].sort((a, b) => a.id.localeCompare(b.id))
}

export function getOperation(id: string): OperationDefinition | undefined {
  return registry.get(id)
}

/** Test seam only. Production code registers at module load and never clears. */
export function clearOperationsForTest(): void {
  registry.clear()
}
