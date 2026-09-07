import {
  isEditable,
  nextState,
  uuidv7,
  type PaymentAction,
  type PaymentBatch,
  type PaymentBatchState,
} from '@klopt/core'
import { and, asc, desc, eq } from 'drizzle-orm'
import type { Transaction } from '../client.js'
import { bankAccounts, paymentBatches, paymentInstructions } from '../schema/index.js'

/**
 * Payment batches.
 *
 * The state machine and the two-person rule are decided by `@klopt/core`; this
 * reads the batch, hands it over, and writes the answer. Every transition
 * records **who** as well as **what**, because the whole value of a two-person
 * flow is being able to say afterwards which two.
 */

export interface BatchSummary {
  readonly id: string
  readonly reference: string
  readonly state: PaymentBatchState
  readonly bankAccountId: string
  readonly bankAccountIban: string
  readonly requestedExecutionDate: string
  readonly instructionCount: number
  readonly total: string
  readonly submittedBy: string | null
  readonly approvedBy: string | null
  readonly exportedAt: string | null
  readonly rejectionReason: string | null
  readonly editable: boolean
}

export class PaymentsRepository {
  constructor(private readonly tx: Transaction) {}

  async createBatch(request: {
    readonly entityId: string
    readonly reference: string
    readonly bankAccountId: string
    readonly requestedExecutionDate: string
  }): Promise<string> {
    const id = uuidv7()
    await this.tx.insert(paymentBatches).values({ id, ...request })
    return id
  }

  async listBatches(entityId: string): Promise<readonly BatchSummary[]> {
    const rows = await this.tx
      .select({
        id: paymentBatches.id,
        reference: paymentBatches.reference,
        state: paymentBatches.state,
        bankAccountId: paymentBatches.bankAccountId,
        bankAccountIban: bankAccounts.iban,
        requestedExecutionDate: paymentBatches.requestedExecutionDate,
        submittedBy: paymentBatches.submittedBy,
        approvedBy: paymentBatches.approvedBy,
        exportedAt: paymentBatches.exportedAt,
        rejectionReason: paymentBatches.rejectionReason,
      })
      .from(paymentBatches)
      .innerJoin(bankAccounts, eq(bankAccounts.id, paymentBatches.bankAccountId))
      .where(eq(paymentBatches.entityId, entityId))
      .orderBy(desc(paymentBatches.requestedExecutionDate), desc(paymentBatches.id))

    const instructions = await this.tx
      .select({
        batchId: paymentInstructions.batchId,
        amount: paymentInstructions.amountMinorUnits,
      })
      .from(paymentInstructions)
      .where(eq(paymentInstructions.entityId, entityId))

    const totals = new Map<string, { count: number; total: bigint }>()
    for (const instruction of instructions) {
      const existing = totals.get(instruction.batchId) ?? { count: 0, total: 0n }
      totals.set(instruction.batchId, {
        count: existing.count + 1,
        total: existing.total + instruction.amount,
      })
    }

    return rows.map((row) => ({
      ...row,
      instructionCount: totals.get(row.id)?.count ?? 0,
      total: (totals.get(row.id)?.total ?? 0n).toString(),
      exportedAt: row.exportedAt?.toISOString() ?? null,
      editable: isEditable(row.state),
    }))
  }

  /** The batch in the shape `generatePain001` takes, plus who did what. */
  async findBatch(
    entityId: string,
    batchId: string,
  ): Promise<{
    batch: PaymentBatch
    submittedBy: string | null
    approvedBy: string | null
    bankAccountId: string
    exportedHash: string | null
  } | null> {
    const [row] = await this.tx
      .select({
        id: paymentBatches.id,
        reference: paymentBatches.reference,
        state: paymentBatches.state,
        bankAccountId: paymentBatches.bankAccountId,
        requestedExecutionDate: paymentBatches.requestedExecutionDate,
        submittedBy: paymentBatches.submittedBy,
        approvedBy: paymentBatches.approvedBy,
        approvedAt: paymentBatches.approvedAt,
        exportedHash: paymentBatches.exportedHash,
        debtorIban: bankAccounts.iban,
        debtorName: bankAccounts.name,
      })
      .from(paymentBatches)
      .innerJoin(bankAccounts, eq(bankAccounts.id, paymentBatches.bankAccountId))
      .where(and(eq(paymentBatches.entityId, entityId), eq(paymentBatches.id, batchId)))
      .limit(1)

    if (row === undefined) return null

    const instructions = await this.tx
      .select()
      .from(paymentInstructions)
      .where(eq(paymentInstructions.batchId, batchId))
      .orderBy(asc(paymentInstructions.createdAt), asc(paymentInstructions.id))

    return {
      submittedBy: row.submittedBy,
      approvedBy: row.approvedBy,
      bankAccountId: row.bankAccountId,
      exportedHash: row.exportedHash,
      batch: {
        id: row.id,
        reference: row.reference,
        state: row.state,
        debtorName: row.debtorName,
        debtorIban: row.debtorIban,
        // A BIC is optional for a domestic SEPA transfer, and the bank account
        // table does not carry one. `NOTPROVIDED` is written instead.
        debtorBic: null,
        requestedExecutionDate: row.requestedExecutionDate,
        // Stamped into `CreDtTm`, so the file is byte-identical however often
        // it is downloaded. See the note in `pain001.ts`.
        approvedAt: row.approvedAt?.toISOString() ?? null,
        instructions: instructions.map((instruction) => ({
          id: instruction.id,
          endToEndId: instruction.endToEndId,
          creditorName: instruction.creditorName,
          creditorIban: instruction.creditorIban,
          creditorBic: instruction.creditorBic,
          amount: instruction.amountMinorUnits,
          currency: instruction.currency,
          remittanceInformation: instruction.remittanceInformation,
          remittanceReference: instruction.remittanceReference,
        })),
      },
    }
  }

  async addInstruction(request: {
    readonly entityId: string
    readonly batchId: string
    readonly endToEndId: string
    readonly contactId: string | null
    readonly creditorName: string
    readonly creditorIban: string
    readonly creditorBic: string | null
    readonly amount: bigint
    readonly currency: string
    readonly remittanceInformation: string
    readonly remittanceReference: string | null
  }): Promise<string> {
    const id = uuidv7()
    const { amount, ...rest } = request
    await this.tx.insert(paymentInstructions).values({ id, amountMinorUnits: amount, ...rest })
    return id
  }

  async removeInstruction(
    entityId: string,
    batchId: string,
    instructionId: string,
  ): Promise<boolean> {
    const removed = await this.tx
      .delete(paymentInstructions)
      .where(
        and(
          eq(paymentInstructions.entityId, entityId),
          eq(paymentInstructions.batchId, batchId),
          eq(paymentInstructions.id, instructionId),
        ),
      )
      .returning({ id: paymentInstructions.id })

    return removed.length > 0
  }

  /**
   * Move a batch along.
   *
   * The rule is `nextState`'s; this records the answer and who gave it. The
   * `submittedBy` that `nextState` compares against comes out of the database
   * rather than from the caller, which is what stops a client claiming somebody
   * else submitted it.
   */
  async transition(request: {
    readonly entityId: string
    readonly batchId: string
    readonly action: PaymentAction
    readonly userId: string
    readonly actorKind: 'human' | 'script' | 'agent'
    readonly reason: string | null
  }): Promise<PaymentBatchState> {
    const [row] = await this.tx
      .select({
        state: paymentBatches.state,
        submittedBy: paymentBatches.submittedBy,
      })
      .from(paymentBatches)
      .where(
        and(eq(paymentBatches.entityId, request.entityId), eq(paymentBatches.id, request.batchId)),
      )
      .limit(1)

    if (row === undefined) throw new Error(`No payment batch ${request.batchId}.`)

    const state = nextState(request.action, row.state, {
      userId: request.userId,
      submittedBy: row.submittedBy,
      actorKind: request.actorKind,
    })

    const now = new Date()
    const patch: Record<string, unknown> = { state, updatedAt: now.toISOString() }

    if (request.action === 'submit') {
      patch['submittedBy'] = request.userId
      patch['submittedAt'] = now
    }
    if (request.action === 'approve') {
      patch['approvedBy'] = request.userId
      patch['approvedAt'] = now
    }
    if (request.action === 'reject') {
      patch['rejectedBy'] = request.userId
      patch['rejectedAt'] = now
      patch['rejectionReason'] = request.reason
    }
    if (request.action === 'reopen') {
      // A reopened batch has no history of approval, and pretending otherwise
      // would let a second submit-approve cycle inherit the first's approver.
      patch['submittedBy'] = null
      patch['submittedAt'] = null
      patch['approvedBy'] = null
      patch['approvedAt'] = null
      patch['rejectedBy'] = null
      patch['rejectedAt'] = null
      patch['rejectionReason'] = null
    }
    if (request.action === 'export') {
      patch['exportedAt'] = now
    }

    await this.tx
      .update(paymentBatches)
      .set(patch)
      .where(
        and(eq(paymentBatches.entityId, request.entityId), eq(paymentBatches.id, request.batchId)),
      )

    return state
  }

  /** The hash of the file that was handed over, for the evidence chain. */
  async recordExport(entityId: string, batchId: string, hash: string): Promise<void> {
    await this.tx
      .update(paymentBatches)
      .set({ exportedHash: hash, updatedAt: new Date().toISOString() })
      .where(and(eq(paymentBatches.entityId, entityId), eq(paymentBatches.id, batchId)))
  }
}
