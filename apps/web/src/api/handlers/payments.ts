import { createHash } from 'node:crypto'
import {
  PERMISSIONS,
  assertRunnable,
  generatePain001,
  isEditable,
  planPaymentRun,
  validatePaymentBatch,
} from '@klopt/core'
import { withBankRead, withPayments, withPurchasePayments } from '@klopt/db'
import { hasPermission, type RequestContext } from '../context.js'
import { ApiError } from '../errors.js'
import type { AddInstructionBody, CreateBatchBody, TransitionBatchBody } from '../schemas.js'

/**
 * Outbound payments (spec 7.4).
 *
 * Two permissions, deliberately: preparing a batch and approving one are
 * different rights, because a two-person flow where one person holds both is
 * one person with two clicks. And the permission is only half of it — the other
 * half is that the approver must not be the submitter, which is a rule about
 * *this* payment and lives in `@klopt/core`.
 *
 * Exporting and downloading are also separate. The download is a read and can
 * happen twice; marking a batch exported is a state change and happens once.
 * A GET that mutates would make "did we already send this to the bank?"
 * unanswerable.
 */

function requirePermission(context: RequestContext, permission: string): void {
  if (!hasPermission(context, permission)) {
    throw new ApiError('forbidden', `This caller does not have ${permission}.`)
  }
}

function requireIdempotencyKey(context: RequestContext): string {
  if (context.idempotencyKey === null || context.idempotencyKey === '') {
    throw new ApiError('idempotency_key_required', 'Every write needs an Idempotency-Key header.')
  }
  return context.idempotencyKey
}

export async function handleListBatches(context: RequestContext) {
  requirePermission(context, PERMISSIONS.read)

  const batches = await withPayments(context.database, (repository) =>
    repository.listBatches(context.entityId),
  )

  return { status: 200, body: { batches } }
}

/**
 * One batch, with everything wrong with it.
 *
 * The problems are computed on every read rather than stored, because a batch
 * becomes invalid without being touched: a contact's IBAN is corrected, an
 * execution date passes. An approver has to see the current answer, not the one
 * from when it was submitted.
 */
export async function handleGetBatch(context: RequestContext, batchId: string) {
  requirePermission(context, PERMISSIONS.read)

  const found = await withPayments(context.database, (repository) =>
    repository.findBatch(context.entityId, batchId),
  )
  if (found === null) throw new ApiError('not_found', 'No such payment batch.')

  const problems = validatePaymentBatch(found.batch)

  return {
    status: 200,
    body: {
      batch: {
        id: found.batch.id,
        reference: found.batch.reference,
        state: found.batch.state,
        debtorName: found.batch.debtorName,
        debtorIban: found.batch.debtorIban,
        requestedExecutionDate: found.batch.requestedExecutionDate,
        editable: isEditable(found.batch.state),
        submittedBy: found.submittedBy,
        approvedBy: found.approvedBy,
        exportedHash: found.exportedHash,
        total: found.batch.instructions
          .reduce((sum, instruction) => sum + instruction.amount, 0n)
          .toString(),
        instructions: found.batch.instructions.map((instruction) => ({
          ...instruction,
          amount: instruction.amount.toString(),
        })),
      },
      problems,
      payable: problems.length === 0,
    },
  }
}

export async function handleCreateBatch(context: RequestContext, body: CreateBatchBody) {
  requirePermission(context, PERMISSIONS.preparePayments)
  requireIdempotencyKey(context)

  const account = await withBankRead(context.database, (repository) =>
    repository.findAccount(context.entityId, body.bankAccountId),
  )
  if (account === null) throw new ApiError('not_found', 'No such bank account.')

  const id = await withPayments(context.database, (repository) =>
    repository.createBatch({
      entityId: context.entityId,
      reference: body.reference,
      bankAccountId: body.bankAccountId,
      requestedExecutionDate: body.requestedExecutionDate,
    }),
  )

  return { status: 201, body: { id, reference: body.reference, state: 'draft' } }
}

export async function handleAddInstruction(
  context: RequestContext,
  batchId: string,
  body: AddInstructionBody,
) {
  requirePermission(context, PERMISSIONS.preparePayments)
  requireIdempotencyKey(context)

  return withPayments(context.database, async (repository) => {
    const found = await repository.findBatch(context.entityId, batchId)
    if (found === null) throw new ApiError('not_found', 'No such payment batch.')

    if (!isEditable(found.batch.state)) {
      // An approver who approves a batch that then changes has approved
      // nothing, so the instructions freeze the moment it is submitted.
      throw new ApiError(
        'conflict',
        `A ${found.batch.state} batch cannot be changed. Reject it first, or start another.`,
      )
    }

    const id = await repository.addInstruction({
      entityId: context.entityId,
      batchId,
      endToEndId: body.endToEndId,
      contactId: null,
      creditorName: body.creditorName,
      creditorIban: body.creditorIban,
      creditorBic: body.creditorBic,
      amount: body.amount,
      currency: body.currency,
      remittanceInformation: body.remittanceInformation,
      remittanceReference: body.remittanceReference,
    })

    return { status: 201, body: { id, batchId } }
  })
}

/**
 * What is waiting to be paid, before anybody commits to a batch.
 *
 * A preview: the same plan `handleAddApprovedInvoices` would write, shown
 * first. A payment run somebody cannot look at before pressing the button is a
 * payment run they press the button on twice.
 */
export async function handlePreviewPaymentRun(context: RequestContext, batchId: string) {
  requirePermission(context, PERMISSIONS.preparePayments)

  return withPurchasePayments(context.database, async ({ payments, purchase }) => {
    const found = await payments.findBatch(context.entityId, batchId)
    if (found === null) throw new ApiError('not_found', 'No such payment batch.')

    const plan = planPaymentRun({
      suppliers: await purchase.payableSuppliers(context.entityId),
      currency: 'EUR',
      batchReference: found.batch.reference,
    })

    return {
      status: 200,
      body: {
        batchId,
        editable: isEditable(found.batch.state),
        instructions: plan.instructions.map((instruction) => ({
          contactNumber: instruction.contactNumber,
          creditorName: instruction.creditorName,
          creditorIban: instruction.creditorIban,
          amount: instruction.amountMinorUnits.toString(),
          remittanceInformation: instruction.remittanceInformation,
          remittanceReference: instruction.remittanceReference,
          dueDate: instruction.dueDate,
          settles: instruction.allocations.map((allocation) => ({
            invoiceId: allocation.invoiceId,
            supplierInvoiceNumber: allocation.supplierInvoiceNumber,
            kind: allocation.kind,
            amount: allocation.amountMinorUnits.toString(),
          })),
        })),
        findings: plan.findings.map((finding) => ({
          code: finding.code,
          severity: finding.severity,
          contactNumber: finding.contactNumber,
          message: finding.message,
          amount: finding.amountMinorUnits.toString(),
        })),
        total: plan.totalMinorUnits.toString(),
      },
    }
  })
}

/**
 * Put every approved, unpaid invoice into this batch.
 *
 * The step that closes the cycle. One instruction per supplier, because a credit
 * note has to be netted against something before money moves and there is no
 * such thing as a payment of minus anything — see `payments/run.ts`.
 *
 * Blocking findings refuse the whole thing rather than paying the suppliers who
 * happen to be fine: a run that silently leaves somebody out is a run whose
 * total nobody can check against the ageing.
 */
export async function handleAddApprovedInvoices(context: RequestContext, batchId: string) {
  requirePermission(context, PERMISSIONS.preparePayments)
  requireIdempotencyKey(context)

  return withPurchasePayments(context.database, async ({ payments, purchase }) => {
    const found = await payments.findBatch(context.entityId, batchId)
    if (found === null) throw new ApiError('not_found', 'No such payment batch.')

    if (!isEditable(found.batch.state)) {
      throw new ApiError(
        'conflict',
        `A ${found.batch.state} batch cannot be changed. Reject it first, or start another.`,
      )
    }

    const plan = planPaymentRun({
      suppliers: await purchase.payableSuppliers(context.entityId),
      currency: 'EUR',
      batchReference: found.batch.reference,
    })

    // Every blocked supplier at once, as a 422 naming each. Nothing is written
    // until it returns.
    assertRunnable(plan)

    if (plan.instructions.length === 0) {
      throw new ApiError(
        'validation_failed',
        'There is nothing approved and unpaid to put in this batch. An invoice has to be booked and approved before it can be paid.',
      )
    }

    const added: string[] = []
    for (const instruction of plan.instructions) {
      const id = await payments.addInstruction({
        entityId: context.entityId,
        batchId,
        endToEndId: instruction.endToEndId,
        contactId: instruction.contactId,
        creditorName: instruction.creditorName,
        creditorIban: instruction.creditorIban,
        creditorBic: instruction.creditorBic,
        amount: instruction.amountMinorUnits,
        currency: instruction.currency,
        remittanceInformation: instruction.remittanceInformation,
        remittanceReference: instruction.remittanceReference,
      })

      // What this payment settles. Recorded in the same transaction, because an
      // instruction whose allocations did not commit would put the invoices
      // back in the next run and pay them twice.
      await purchase.allocateToInstruction({
        entityId: context.entityId,
        instructionId: id,
        allocations: instruction.allocations.map((allocation) => ({
          invoiceId: allocation.invoiceId,
          amountMinorUnits: allocation.amountMinorUnits,
        })),
      })

      added.push(id)
    }

    return {
      status: 201,
      body: {
        batchId,
        added: added.length,
        total: plan.totalMinorUnits.toString(),
        // Not blocking, and worth showing: a supplier who owes us is a refund
        // to ask for rather than a payment that failed.
        notes: plan.findings.map((finding) => ({
          code: finding.code,
          contactNumber: finding.contactNumber,
          message: finding.message,
        })),
      },
    }
  })
}

export async function handleRemoveInstruction(
  context: RequestContext,
  batchId: string,
  instructionId: string,
) {
  requirePermission(context, PERMISSIONS.preparePayments)
  requireIdempotencyKey(context)

  return withPayments(context.database, async (repository) => {
    const found = await repository.findBatch(context.entityId, batchId)
    if (found === null) throw new ApiError('not_found', 'No such payment batch.')
    if (!isEditable(found.batch.state)) {
      throw new ApiError('conflict', `A ${found.batch.state} batch cannot be changed.`)
    }

    const removed = await repository.removeInstruction(context.entityId, batchId, instructionId)
    if (!removed) throw new ApiError('not_found', 'No such payment in this batch.')

    return { status: 200, body: { batchId, instructionId, removed: true } }
  })
}

/**
 * Move a batch along.
 *
 * `approve` needs `payments:approve`; everything else needs only
 * `payments:prepare`. That split is the first half of the two-person flow — a
 * bookkeeper prepares and submits and cannot approve — and the second half,
 * that the approver is not the submitter, is enforced in the domain against the
 * `submitted_by` in the database rather than anything the caller says.
 *
 * A submit also refuses an unpayable batch. Asking somebody to approve
 * something the bank will reject wastes the more expensive of the two people.
 */
export async function handleTransitionBatch(
  context: RequestContext,
  batchId: string,
  body: TransitionBatchBody,
) {
  requirePermission(
    context,
    body.action === 'approve' ? PERMISSIONS.approvePayments : PERMISSIONS.preparePayments,
  )
  requireIdempotencyKey(context)

  return withPayments(context.database, async (repository) => {
    const found = await repository.findBatch(context.entityId, batchId)
    if (found === null) throw new ApiError('not_found', 'No such payment batch.')

    if (body.action === 'submit' || body.action === 'approve') {
      const problems = validatePaymentBatch(found.batch)
      if (problems.length > 0) {
        throw new ApiError(
          'validation_failed',
          `This batch is not payable: ${String(problems.length)} problem${problems.length === 1 ? '' : 's'}.`,
          problems.map((problem) => ({
            code: problem.code,
            path: problem.path,
            message: problem.message,
          })),
        )
      }
    }

    const state = await repository.transition({
      entityId: context.entityId,
      batchId,
      action: body.action,
      userId: context.actor.id,
      actorKind: context.actor.kind,
      reason: body.reason,
    })

    return { status: 200, body: { batchId, state, action: body.action } }
  })
}

/**
 * The file itself.
 *
 * A read: downloading it twice is fine and sometimes necessary, and marking the
 * batch exported is a separate transition. Only an approved or already-exported
 * batch will produce one, because a `pain.001` for an unapproved batch is a
 * file somebody can upload to a bank.
 */
export async function handleGetBatchPain001(context: RequestContext, batchId: string) {
  requirePermission(context, PERMISSIONS.export)

  return withPayments(context.database, async (repository) => {
    const found = await repository.findBatch(context.entityId, batchId)
    if (found === null) throw new ApiError('not_found', 'No such payment batch.')

    if (found.batch.state !== 'approved' && found.batch.state !== 'exported') {
      throw new ApiError(
        'conflict',
        `A ${found.batch.state} batch has no payment file. It has to be approved first.`,
      )
    }

    const problems = validatePaymentBatch(found.batch)
    if (problems.length > 0) {
      // It was payable when it was approved and is not now — a corrected IBAN,
      // usually. Refusing is the only safe answer.
      throw new ApiError(
        'validation_failed',
        'This batch is no longer payable. Reject it, correct it and approve it again.',
        problems.map((problem) => ({
          code: problem.code,
          path: problem.path,
          message: problem.message,
        })),
      )
    }

    const xml = generatePain001(found.batch)
    const hash = createHash('sha256').update(xml, 'utf8').digest('hex')

    // "Every adapter records every request and response for the evidence
    // chain" (spec 8, rule 3). This is the request.
    await repository.recordExport(context.entityId, batchId, hash)

    return {
      xml,
      filename: `${found.batch.reference}.pain001.xml`,
      hash,
      instructionCount: found.batch.instructions.length,
    }
  })
}
