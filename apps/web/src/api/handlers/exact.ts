import { randomBytes } from 'node:crypto'
import {
  findDivision,
  planExactImport,
  selectableDivisions,
  type ExactDivision,
  type ExactImportPlan,
} from '@klopt/core'
import {
  ExactApiError,
  ExactAuthError,
  authorizeUrl,
  createExactClient,
  exchangeCode,
  readDivision,
} from '@klopt/adapters'
import {
  SecretKeyMissingError,
  secretsAvailable,
  withExactConnection,
  withExactConnectionRead,
  withReporting,
  type ExactConnectionCredentials,
} from '@klopt/db'
import { hasPermission, type RequestContext } from '../context.js'
import { ApiError } from '../errors.js'
import { recordAudit } from '../audit.js'
import type {
  ChooseExactDivisionBody,
  CompleteExactBody,
  ConnectExactBody,
  ExactPreviewQuery,
} from '../schemas.js'

/**
 * Migrating an administration out of Exact Online (spec 13).
 *
 * "Adoption is gated by getting out of the incumbent. Treat migration as a
 * product feature, not a services engagement."
 *
 * ## Why choosing the division is its own step
 *
 * One Exact login reaches every administration the user has rights to. A real
 * account has several on purpose — the operating BV, the holding, a practice
 * division from a course, the test division somebody made to try something out.
 * They look identical in a list, the test one often has plausible numbers in
 * it, and importing the wrong one is not obvious afterwards.
 *
 * So connecting and choosing are two requests, the chosen division is stored on
 * the connection rather than passed at each import, every caution Exact knows
 * about it is stored alongside, and the audit entry names the division rather
 * than its position in a list.
 *
 * ## Why the token is written down before it is used
 *
 * Exact rotates the refresh token on every refresh and kills the old one
 * immediately. Every one of these handlers hands the client an `onTokens`
 * callback that commits before the new access token is used for anything. A
 * process that died in between would otherwise leave a spent refresh token in
 * the database and a connection that fails at the next request for no
 * discoverable reason.
 */

function requirePermission(context: RequestContext, permission: string): void {
  if (!hasPermission(context, permission)) {
    throw new ApiError('forbidden', `This token does not have ${permission}.`)
  }
}

/** Everything a screen may see. No secret, no token, ever. */
function serialise(row: {
  baseUrl: string
  clientId: string
  redirectUri: string
  userName: string | null
  divisionCode: number | null
  divisionName: string | null
  divisionCautions: readonly string[]
  connected: boolean
  lastImportAt: string | null
  lastError: string | null
}) {
  return {
    baseUrl: row.baseUrl,
    clientId: row.clientId,
    redirectUri: row.redirectUri,
    userName: row.userName,
    divisionCode: row.divisionCode,
    divisionName: row.divisionName,
    divisionCautions: row.divisionCautions,
    connected: row.connected,
    // A connection with no division is connected and unusable, which is a
    // different thing for a screen to say.
    ready: row.connected && row.divisionCode !== null,
    lastImportAt: row.lastImportAt,
    lastError: row.lastError,
  }
}

export async function handleGetExactConnection(context: RequestContext) {
  requirePermission(context, 'ledger:read')

  const row = await withExactConnectionRead(context.database, (repository) =>
    repository.find(context.entityId),
  )

  return {
    status: 200,
    body: {
      connection: row === null ? null : serialise(row),
      // So a screen can refuse the client secret field before somebody pastes
      // one in, rather than after.
      canStoreSecrets: secretsAvailable(),
    },
  }
}

export async function handleConnectExact(context: RequestContext, body: ConnectExactBody) {
  requirePermission(context, 'ledger:configure')

  // A nonce with real entropy, not a timestamp: it is the only thing tying the
  // callback to the request that started it.
  const state = randomBytes(24).toString('base64url')

  try {
    await withExactConnection(context.database, async (repository) => {
      await repository.upsertApp({
        entityId: context.entityId,
        baseUrl: body.baseUrl,
        clientId: body.clientId,
        clientSecret: body.clientSecret,
        redirectUri: body.redirectUri,
      })
      await repository.beginHandshake(context.entityId, state)
    })
  } catch (error: unknown) {
    if (error instanceof SecretKeyMissingError) {
      // Refused rather than stored as typed. A client secret in a database
      // dump is discovered by somebody else, later.
      throw new ApiError('validation_failed', error.message, [
        { code: 'no_secret_key', path: 'clientSecret', message: error.message },
      ])
    }
    throw error
  }

  // The client id and the host, never the secret.
  await recordAudit(context, {
    action: 'exact.connect',
    resourceType: 'exact_connection',
    resourceId: context.entityId,
    after: { baseUrl: body.baseUrl, clientId: body.clientId, redirectUri: body.redirectUri },
  })

  return {
    status: 201,
    body: {
      authorizeUrl: authorizeUrl(
        { clientId: body.clientId, clientSecret: body.clientSecret, redirectUri: body.redirectUri },
        state,
        body.baseUrl,
      ),
    },
  }
}

export async function handleCompleteExactConnection(
  context: RequestContext,
  body: CompleteExactBody,
) {
  requirePermission(context, 'ledger:configure')

  const connection = await withExactConnection(context.database, (repository) =>
    repository.consumeHandshake(context.entityId, body.state),
  )

  if (connection === null) {
    // Either there is no handshake in flight or the state does not match. Both
    // are the same refusal: a callback that cannot be tied to a request this
    // administration started is not a callback to act on.
    throw new ApiError(
      'validation_failed',
      'This authorisation does not match a connection attempt from these books. Start again.',
      [{ code: 'state_mismatch', path: 'state', message: 'Unknown or already used.' }],
    )
  }

  let tokens
  try {
    tokens = await exchangeCode(
      {
        clientId: connection.clientId,
        clientSecret: connection.clientSecret,
        redirectUri: connection.redirectUri,
      },
      body.code,
      { base: connection.baseUrl },
    )
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    await withExactConnection(context.database, (repository) =>
      repository.recordFailure(context.entityId, message),
    )
    throw new ApiError('validation_failed', `Exact Online refused the authorisation: ${message}`, [
      { code: 'exchange_failed', path: 'code', message },
    ])
  }

  await withExactConnection(context.database, (repository) =>
    repository.storeTokens({
      entityId: context.entityId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    }),
  )

  // Ask who this is, so the screen can say whose Exact account is attached
  // rather than "connected".
  let userName: string | null = null
  try {
    const { client } = await clientFor(context)
    const me = await client.me()
    userName = me.fullName
    await withExactConnection(context.database, (repository) =>
      repository.setUser(context.entityId, me.fullName),
    )
  } catch {
    // A connection that works but cannot name its user is still a connection.
    // Not worth failing the handshake over.
  }

  await recordAudit(context, {
    action: 'exact.completeConnection',
    resourceType: 'exact_connection',
    resourceId: context.entityId,
    after: { connected: true, userName },
  })

  return { status: 200, body: { connected: true, userName } }
}

/**
 * Build a client for the stored connection.
 *
 * The `onTokens` callback is the whole point of this function existing: every
 * caller gets one that commits, so there is no path through this file where a
 * rotated refresh token is used before it is stored.
 */
async function clientFor(context: RequestContext): Promise<{
  readonly client: ReturnType<typeof createExactClient>
  readonly connection: ExactConnectionCredentials
}> {
  const connection = await withExactConnection(context.database, (repository) =>
    repository.withCredentials(context.entityId),
  )

  if (connection === null) {
    throw new ApiError('not_found', 'These books are not connected to Exact Online.')
  }
  if (connection.refreshToken === null || connection.accessToken === null) {
    throw new ApiError(
      'conflict',
      'The Exact connection has not been authorised yet. Start the handshake and sign in at Exact.',
    )
  }

  const client = createExactClient({
    app: { clientId: connection.clientId, clientSecret: connection.clientSecret },
    tokens: {
      accessToken: connection.accessToken,
      refreshToken: connection.refreshToken,
      expiresAt: connection.accessTokenExpiresAt ?? '1970-01-01T00:00:00.000Z',
    },
    base: connection.baseUrl,
    onTokens: async (next) => {
      await withExactConnection(context.database, (repository) =>
        repository.storeTokens({
          entityId: context.entityId,
          accessToken: next.accessToken,
          refreshToken: next.refreshToken,
          expiresAt: next.expiresAt,
        }),
      )
    },
  })

  return { client, connection }
}

/** Turn an adapter failure into something a screen can act on. */
async function refuse(context: RequestContext, error: unknown): Promise<never> {
  const message = error instanceof Error ? error.message : String(error)

  await withExactConnection(context.database, (repository) =>
    repository.recordFailure(context.entityId, message),
  )

  if (error instanceof ExactAuthError && error.reauthorise) {
    // The refresh token has been spent or revoked. Retrying will not fix it and
    // a spinner would be a lie.
    throw new ApiError(
      'conflict',
      `Exact Online no longer accepts this connection: ${message}. Authorise it again.`,
    )
  }
  if (error instanceof ExactApiError || error instanceof ExactAuthError) {
    throw new ApiError('conflict', `Exact Online could not be read: ${message}`)
  }
  throw error
}

export async function handleListExactDivisions(context: RequestContext) {
  requirePermission(context, 'ledger:configure')

  const { client, connection } = await clientFor(context)

  let divisions: readonly ExactDivision[]
  try {
    divisions = await client.divisions()
  } catch (error: unknown) {
    return refuse(context, error)
  }

  return {
    status: 200,
    body: {
      chosen: connection.divisionCode,
      // Ordinary divisions first, each labelled with whatever makes it unusual.
      // The current division is deliberately not floated to the top: that is a
      // fact about somebody's browsing, not about which books they want.
      divisions: selectableDivisions(divisions).map((division) => ({
        code: division.code,
        description: division.description,
        label: division.label,
        currency: division.currency,
        vatNumber: division.vatNumber,
        chamberOfCommerceNumber: division.chamberOfCommerceNumber,
        cautions: division.cautions,
        ordinary: division.ordinary,
        isMainDivision: division.isMainDivision,
      })),
    },
  }
}

export async function handleChooseExactDivision(
  context: RequestContext,
  body: ChooseExactDivisionBody,
) {
  requirePermission(context, 'ledger:configure')

  const { client } = await clientFor(context)

  let divisions: readonly ExactDivision[]
  try {
    divisions = await client.divisions()
  } catch (error: unknown) {
    return refuse(context, error)
  }

  // Checked against what Exact actually offers. A number in a request body is
  // not evidence that this login can reach that division.
  const chosen = findDivision(divisions, body.divisionCode)
  if (chosen === null) {
    throw new ApiError(
      'not_found',
      `This Exact login cannot reach administration ${String(body.divisionCode)}.`,
    )
  }

  await withExactConnection(context.database, (repository) =>
    repository.chooseDivision({
      entityId: context.entityId,
      code: chosen.code,
      name: chosen.description,
      cautions: chosen.cautions,
    }),
  )

  // The division by name and number, plus what was odd about it at the moment
  // it was chosen. "Somebody picked the test administration" is the question
  // this entry exists to answer six months later.
  await recordAudit(context, {
    action: 'exact.chooseDivision',
    resourceType: 'exact_connection',
    resourceId: context.entityId,
    after: {
      divisionCode: String(chosen.code),
      divisionName: chosen.description,
      cautions: chosen.cautions.join(',') || 'none',
    },
  })

  return {
    status: 200,
    body: {
      divisionCode: chosen.code,
      divisionName: chosen.description,
      cautions: chosen.cautions,
      label: chosen.label,
    },
  }
}

/** Amounts leave as decimal strings, the same as everywhere else. */
function amount(value: bigint): string {
  const negative = value < 0n
  const digits = (negative ? -value : value).toString().padStart(3, '0')
  const cut = digits.length - 2
  return `${negative ? '-' : ''}${digits.slice(0, cut)}.${digits.slice(cut)}`
}

function serialisePlan(plan: ExactImportPlan) {
  const { reconciliation } = plan

  const control = (check: typeof reconciliation.receivable) => ({
    accountCodes: check.accountCodes,
    ledger: amount(check.ledger),
    openItems: amount(check.openItems),
    difference: amount(check.difference),
    matches: check.matches,
    itemCount: check.itemCount,
  })

  return {
    division: {
      code: plan.division.code,
      description: plan.division.description,
      currency: plan.division.currency,
    },
    reconciliation: {
      year: reconciliation.year,
      totalDebit: amount(reconciliation.totalDebit),
      totalCredit: amount(reconciliation.totalCredit),
      balanced: reconciliation.balanced,
      accountCount: reconciliation.accountCount,
      transactionCount: reconciliation.transactionCount,
      orphanAccountCodes: reconciliation.orphanAccountCodes,
      receivable: control(reconciliation.receivable),
      payable: control(reconciliation.payable),
    },
    accounts: {
      // `count` rather than `total`: a count of accounts is not an amount, and
      // the money lint is right to be suspicious of `total: number`.
      count: plan.accounts.length,
      new: plan.accounts.filter((account) => !account.exists).length,
      derived: plan.accounts.filter((account) => account.derived).length,
      sample: plan.accounts.slice(0, 25).map((account) => ({
        number: account.number,
        name: account.name,
        type: account.type,
        normalBalance: account.normalBalance,
        exists: account.exists,
        derived: account.derived,
        exactTypeDescription: account.exactTypeDescription,
      })),
    },
    contacts: {
      count: plan.contacts.length,
      new: plan.contacts.filter((contact) => !contact.exists).length,
      customers: plan.contacts.filter((contact) => contact.isCustomer).length,
      suppliers: plan.contacts.filter((contact) => contact.isSupplier).length,
    },
    openItems: {
      receivable: {
        count: plan.openItems.filter((item) => item.side === 'receivable').length,
        total: amount(
          plan.openItems
            .filter((item) => item.side === 'receivable')
            .reduce((sum, item) => sum + item.outstanding, 0n),
        ),
      },
      payable: {
        count: plan.openItems.filter((item) => item.side === 'payable').length,
        total: amount(
          plan.openItems
            .filter((item) => item.side === 'payable')
            .reduce((sum, item) => sum + item.outstanding, 0n),
        ),
      },
      // The original numbers, because that is the property that matters: dunning
      // and matching are conversations with somebody reading the old number.
      sample: plan.openItems.slice(0, 25).map((item) => ({
        side: item.side,
        contactNumber: item.contactNumber,
        contactName: item.contactName,
        documentNumber: item.documentNumber,
        dueOn: item.dueOn,
        outstanding: amount(item.outstanding),
      })),
    },
    taxCodes: plan.taxCodes,
    documents: {
      count: plan.documents.length,
      attachments: plan.documents.reduce((sum, document) => sum + document.attachments.length, 0),
    },
    warnings: plan.warnings,
    problems: plan.problems,
  }
}

/**
 * The dry run (spec 13).
 *
 * "A dry-run mode producing a reconciliation report against the source
 * system's trial balance before anything is committed."
 *
 * Nothing is written here except a rotated refresh token. What comes back is
 * the plan, the reconciliation, and every warning — including the ones that are
 * not going to stop the import, because a migration nobody was warned about is
 * a migration somebody discovers by finding a difference.
 */
export async function handlePreviewExactImport(context: RequestContext, query: ExactPreviewQuery) {
  requirePermission(context, 'ledger:import')

  const { client, connection } = await clientFor(context)

  if (connection.divisionCode === null) {
    throw new ApiError(
      'conflict',
      'No Exact administration has been chosen yet. There is more than one, so this cannot be guessed.',
    )
  }

  // What the plan needs to say "new" or "already here" about every row: the
  // entity's own currency, its chart, its tax codes and its contact numbers.
  const here = await withReporting(context.database, async (repository) => {
    const [entity, resolutions, accounts] = await Promise.all([
      repository.entity(context.entityId),
      repository.importResolutions(context.entityId),
      repository.listAccounts(context.entityId),
    ])
    return { entity, resolutions, accounts }
  })

  if (here.entity === null) throw new ApiError('not_found', 'No such administration.')

  let divisions: readonly ExactDivision[]
  try {
    divisions = await client.divisions()
  } catch (error: unknown) {
    return refuse(context, error)
  }

  const division = findDivision(divisions, connection.divisionCode)
  if (division === null) {
    // The rights changed since it was chosen. Better to say so than to import
    // whatever this login can reach now.
    throw new ApiError(
      'conflict',
      `This Exact login can no longer reach administration ${String(connection.divisionCode)}. Choose one again.`,
    )
  }

  try {
    const snapshot = await readDivision({
      client,
      division,
      year: query.year,
      documents: query.documents === true,
    })

    const plan = planExactImport(snapshot, {
      entityId: context.entityId,
      currency: here.entity.functionalCurrency,
      existingAccountNumbers: here.accounts.map((account) => account.number),
      existingContactNumbers: [...here.resolutions.contactIdsByNumber.keys()],
      existingTaxCodes: here.resolutions.taxCodes,
    })

    return {
      status: 200,
      body: {
        dryRun: true,
        ...serialisePlan(plan),
        // Spec 8, rule 3: every adapter records every request. Shown rather
        // than logged, because "which of the eight reads was slow" is the
        // question somebody asks while watching this run.
        requests: client.log,
      },
    }
  } catch (error: unknown) {
    return refuse(context, error)
  }
}

export async function handleDisconnectExact(context: RequestContext) {
  requirePermission(context, 'ledger:configure')

  await withExactConnection(context.database, (repository) => repository.remove(context.entityId))

  // What was already imported is untouched: the accounts and contacts are the
  // administration's, not Exact's.
  await recordAudit(context, {
    action: 'exact.disconnect',
    resourceType: 'exact_connection',
    resourceId: context.entityId,
    before: { connected: true },
    after: { connected: false },
  })

  return { status: 200, body: { connected: false } }
}
