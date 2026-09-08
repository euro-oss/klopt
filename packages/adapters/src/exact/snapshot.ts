import {
  ATTACHMENT_SELECT,
  CRM_ACCOUNT_SELECT,
  DOCUMENT_SELECT,
  GL_ACCOUNT_SELECT,
  OPEN_ITEM_SELECT,
  PAYMENT_CONDITION_SELECT,
  REPORTING_BALANCE_SELECT,
  VAT_CODE_SELECT,
  parseAccount,
  parseAttachment,
  parseDocument,
  parseGLAccount,
  parseOpenItem,
  parsePaymentCondition,
  parseReportingBalance,
  parseVatCode,
  trialBalanceFilter,
  type ExactClient,
  type ExactDivision,
  type ExactSnapshot,
  type UnreadableResource,
} from '@klopt/core'
import { ExactApiError, collectAll } from './client.js'

/**
 * Reading one Exact division into a snapshot (spec 13).
 *
 * Eight resources, read in one pass, and then never asked again: the planner is
 * pure and the report a human approves has to be the same thing that gets
 * executed. Re-reading between preview and commit would mean approving one
 * administration and importing another.
 *
 * ## The order is not arbitrary
 *
 * The cheap reference data comes first — the chart of accounts, the VAT codes,
 * the payment conditions — so that a connection with the wrong rights fails on
 * a small request rather than halfway through five thousand relations.
 *
 * ## Documents are the expensive half, and optional
 *
 * A division with ten years of scanned purchase invoices has tens of thousands
 * of document rows and as many attachments. That is worth importing and it is
 * not worth doing on the way to a dry-run report, so `documents` is a flag and
 * the reconciliation does not depend on it.
 *
 * ## One resource being refused is one resource being refused
 *
 * Exact grants rights **per resource, not per scope**. `vat/VATCodes` and
 * `financial/ReportingBalance` are both documented as "Financial accounting",
 * and a login can be allowed the first and answered 403 for the second — which
 * is exactly what a real connection did. Nothing here can grant that right; it
 * is the signed-in user's rights on that administration.
 *
 * What this pass can do is not throw the other seven resources away with it.
 * Each read is attempted on its own and a refusal is recorded on the snapshot,
 * so the planner decides whether what came back is enough. That is spec 8's
 * fourth rule — a failing adapter never blocks bookkeeping — and the same
 * shape `runInboundPoll` uses for a mailbox whose password expired.
 *
 * Only two statuses degrade, and the narrowness is the point:
 *
 * - **403**, "you may not read this" — the case above.
 * - **404**, "this division has not got that" — a resource behind a module the
 *   subscription does not include.
 *
 * Everything else is either our bug or a passing condition, and swallowing it
 * would produce a confidently partial import. A 400 means the query is wrong
 * and should be loud. A 401 means reauthorise. A 429 that got this far means
 * the reset is further off than the client will wait. A transport failure
 * arrives as `ExactApiError` with `status: 0`, and treating that as "refused"
 * would turn "the network went away" into "this division has no customers".
 */

export interface ReadDivisionRequest {
  readonly client: ExactClient
  readonly division: ExactDivision
  /** The book year the trial balance is read for. */
  readonly year: number
  /** Read `documents/Documents` and its attachments too. Slow. */
  readonly documents?: boolean
  /**
   * Stop after this many document rows.
   *
   * A limit rather than none, because the dry run shows a sample and the
   * commit walks the whole set; an unbounded read here would make the preview
   * as expensive as the import.
   */
  readonly documentLimit?: number
  /** Called after each resource, so a screen can say what is happening. */
  readonly onProgress?: (resource: string, rows: number) => void
}

const DEFAULT_DOCUMENT_LIMIT = 500

/**
 * The statuses a single resource is allowed to be missing over.
 *
 * 403: the signed-in user may not read it. 404: this division has not got it.
 * Both are facts about one resource that the rest of the import survives.
 */
const DEGRADES: ReadonlySet<number> = new Set([403, 404])

export async function readDivision(request: ReadDivisionRequest): Promise<ExactSnapshot> {
  const { client, division, year } = request
  const code = division.code
  const progress = request.onProgress ?? (() => {})

  const unreadable: UnreadableResource[] = []

  /**
   * One resource, or the reason there is none.
   *
   * `null` distinguishes "refused" from "empty" for the caller that needs to
   * tell them apart. Every caller but the trial balance flattens it to an empty
   * list, because an administration with no VAT codes and one whose VAT codes
   * were refused import identically — the difference is only in the report,
   * which `unreadable` already carries.
   */
  const read = async (
    path: string,
    select: readonly string[],
    options: { readonly filter?: string; readonly orderBy?: string } = {},
  ): Promise<readonly Record<string, unknown>[] | null> => {
    try {
      const rows = await collectAll(client, { division: code, path, select, ...options })
      progress(path, rows.length)
      return rows
    } catch (error: unknown) {
      // `ExactApiError` alone is not enough: the client also uses it for a
      // transport failure (`status: 0`), a rate-limit reset too far off to wait
      // for, and its own request cap. Matching on the status is what separates
      // "Exact answered no" from "we never got an answer".
      if (!(error instanceof ExactApiError) || !DEGRADES.has(error.status)) throw error

      unreadable.push({ resource: path, status: error.status, message: error.message })
      progress(path, 0)
      return null
    }
  }

  // Reference data first: small, and it fails fast when the rights are wrong.
  const glAccounts = (
    (await read('financial/GLAccounts', GL_ACCOUNT_SELECT, {
      orderBy: 'Code',
    })) ?? []
  ).map(parseGLAccount)

  const vatCodes = ((await read('vat/VATCodes', VAT_CODE_SELECT, { orderBy: 'Code' })) ?? []).map(
    parseVatCode,
  )

  const paymentConditions = (
    (await read('cashflow/PaymentConditions', PAYMENT_CONDITION_SELECT, {
      orderBy: 'Code',
    })) ?? []
  ).map(parsePaymentCondition)

  // The trial balance for the year, both statuses. Exact's own note: "to get
  // 'after entry' results, both should be included", and a filter on processed
  // rows alone would understate every account that has unprocessed entries.
  // The one place `null` survives: an unread year is not a balanced one, and
  // the planner has to be able to tell.
  const trialBalanceRows = await read('financial/ReportingBalance', REPORTING_BALANCE_SELECT, {
    filter: trialBalanceFilter(year),
  })
  const trialBalance = trialBalanceRows?.map(parseReportingBalance) ?? null

  const accounts = (
    (await read('crm/Accounts', CRM_ACCOUNT_SELECT, { orderBy: 'Code' })) ?? []
  ).map(parseAccount)

  const receivables = ((await read('read/financial/ReceivablesList', OPEN_ITEM_SELECT)) ?? []).map(
    parseOpenItem,
  )

  const payables = ((await read('read/financial/PayablesList', OPEN_ITEM_SELECT)) ?? []).map(
    parseOpenItem,
  )

  let documents: ExactSnapshot['documents'] = []
  let attachments: ExactSnapshot['attachments'] = []

  if (request.documents === true) {
    const limit = request.documentLimit ?? DEFAULT_DOCUMENT_LIMIT
    const rows = await read('documents/Documents', DOCUMENT_SELECT, {
      orderBy: 'DocumentDate desc',
    })
    documents = (rows ?? []).slice(0, limit).map(parseDocument)

    // Attachments for the documents we kept, and only those. Reading every
    // attachment row in the division to throw most of them away is the kind of
    // thing that gets a client rate-limited for a day.
    //
    // Not asked for at all when there are no documents to attach them to: a
    // second refusal for a resource nobody needed is noise in the report.
    if (documents.length > 0) {
      const wanted = new Set(documents.map((document) => document.id))
      const attachmentRows = await read('documents/DocumentAttachments', ATTACHMENT_SELECT)
      attachments = (attachmentRows ?? [])
        .map(parseAttachment)
        .filter((attachment) => wanted.has(attachment.documentId))
    }
  }

  return {
    division,
    glAccounts,
    vatCodes,
    accounts,
    paymentConditions,
    receivables,
    payables,
    trialBalance,
    year,
    documents,
    attachments,
    unreadable,
  }
}
