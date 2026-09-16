import type { DomainEvent } from '@klopt/core'
import { uuidv7 } from '@klopt/core'
import type { Transaction } from './client.js'
import { outbox } from './schema/ledger.js'

/**
 * Writing to the transactional outbox (spec 9.3).
 *
 * A free function taking the transaction, rather than a method on one
 * repository, because the outbox belongs to no module. It lived on
 * `DrizzleLedgerRepository` for as long as the ledger was the only thing that
 * emitted, and that stopped being true the moment a second module had
 * something worth publishing — at which point the choice is either to widen
 * four unit-of-work wrappers so they all hand out a ledger repository they do
 * not otherwise need, or to admit this was never ledger-shaped.
 *
 * The rule it exists to enforce is unchanged and is the whole point: **the
 * event is written in the transaction that made the change.** An outbox gives
 * its at-least-once guarantee only when the event cannot commit without the
 * change and cannot be lost when the change commits. Taking `tx` rather than a
 * `Database` is what makes calling it outside one awkward enough to notice.
 */
export async function enqueueDomainEvent(tx: Transaction, event: DomainEvent): Promise<void> {
  await tx.insert(outbox).values({
    id: uuidv7(),
    entityId: event.entityId,
    type: event.type,
    version: event.version,
    payload: event.payload,
  })
}
