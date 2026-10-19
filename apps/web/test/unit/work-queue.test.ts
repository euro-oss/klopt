import { describe, expect, it } from 'vitest'
import {
  buildWorkQueue,
  WORK_QUEUE_ORDER,
  WORK_QUEUE_PERMISSION,
  type WorkQueueCounts,
} from '../../src/lib/work-queue.js'
import { resolveListKey } from '../../src/lib/list-cursor.js'
import { permissionsForRole, grants } from '@klopt/core'

/**
 * The dashboard queue, and moving through it.
 *
 * Both halves are here because both are the same claim: opening Klopt should
 * answer "what do I do today?" and answer it without a mouse.
 */

const nothing: WorkQueueCounts = {
  importBlocking: 0,
  importSource: null,
  salesDrafts: 0,
  salesOverdue: 0,
  salesOverdueTotal: '0',
  salesOverdueTop: null,
  dunningWaiting: 0,
  bankUnmatched: 0,
  inboxWaiting: 0,
  purchaseToBook: 0,
  purchaseToApprove: 0,
  vatFiling: 0,
  vatPeriod: null,
  vatDeadline: null,
  vatPayable: null,
}

const everything: WorkQueueCounts = {
  importBlocking: 3,
  importSource: 'moneybird',
  salesDrafts: 1,
  salesOverdue: 9,
  salesOverdueTotal: '250000',
  salesOverdueTop: {
    contactName: 'Hotel Zeezicht',
    number: '2026-0131',
    daysOverdue: 12,
    total: '145200',
  },
  dunningWaiting: 4,
  bankUnmatched: 40,
  inboxWaiting: 3,
  purchaseToBook: 2,
  purchaseToApprove: 7,
  vatFiling: 1,
  vatPeriod: 'Q3',
  vatDeadline: '2026-10-31',
  vatPayable: '391800',
}

describe('what the queue shows', () => {
  it('shows nothing at all when nothing is waiting', () => {
    // Which is what makes the empty state honest: it is reached by having no
    // work, not by having no data.
    expect(buildWorkQueue(nothing)).toEqual([])
  })

  it('leaves out the rows with nothing in them', () => {
    // "0 unmatched bank lines" is a status wall. Everything on this list is
    // something to do.
    const rows = buildWorkQueue({ ...nothing, inboxWaiting: 2 })
    expect(rows.map((row) => row.kind)).toEqual(['inbox.waiting'])
  })

  it('keeps the daily order rather than sorting by size', () => {
    // Blocking import first, then invoice, bank, suppliers, btw. A queue that
    // reorders itself as the numbers move is a queue nobody can learn.
    expect(buildWorkQueue(everything).map((row) => row.kind)).toEqual([...WORK_QUEUE_ORDER])
  })

  it('carries the overdue total, because a count of late invoices is not the news', () => {
    const [row] = buildWorkQueue({ ...nothing, salesOverdue: 3, salesOverdueTotal: '1234567' })
    expect(row).toEqual({
      kind: 'sales.overdue',
      count: 3,
      amount: '1234567',
      detail: undefined,
    })
  })

  it('puts the richest overdue on the row for the redesigned subtitle', () => {
    const [row] = buildWorkQueue({
      ...nothing,
      salesOverdue: 1,
      salesOverdueTotal: '145200',
      salesOverdueTop: everything.salesOverdueTop,
    })
    expect(row?.detail).toEqual({
      contactName: 'Hotel Zeezicht',
      invoiceNumber: '2026-0131',
      daysOverdue: 12,
    })
  })

  it('puts no figure on the rows where a count is the whole story', () => {
    const [row] = buildWorkQueue({ ...nothing, bankUnmatched: 12 })
    expect(row?.amount).toBeNull()
  })

  it('separates being late from being unchased', () => {
    // Two jobs, two rows: an invoice a week late has a reminder waiting, and
    // the same invoice after the letter went out is still late and no longer
    // anybody's next action.
    const rows = buildWorkQueue({
      ...nothing,
      salesOverdue: 3,
      salesOverdueTotal: '100',
      dunningWaiting: 1,
    })
    expect(rows.map((row) => row.kind)).toEqual(['sales.overdue', 'dunning.waiting'])
  })

  it('surfaces a stored Moneybird dry-run that still blocks', () => {
    const [row] = buildWorkQueue({
      ...nothing,
      importBlocking: 3,
      importSource: 'moneybird',
    })
    expect(row).toMatchObject({
      kind: 'import.blocking',
      count: 3,
      detail: { source: 'moneybird' },
    })
  })
})

describe('what a reader is offered', () => {
  const forRole = (role: 'owner' | 'bookkeeper' | 'accountant' | 'auditor') => {
    const held = new Set<string>(permissionsForRole(role))
    return buildWorkQueue(everything, (permission) => grants(held, permission)).map(
      (row) => row.kind,
    )
  }

  it('offers an owner everything that is waiting', () => {
    expect(forRole('owner')).toEqual([...WORK_QUEUE_ORDER])
  })

  it('does not tell a bookkeeper to approve what only an owner may approve', () => {
    // `purchase:approve` is the one the two-person rule turns on, and a row
    // that leads to a 403 is worse than no row.
    expect(forRole('bookkeeper')).not.toContain('purchase.approve')
    expect(forRole('bookkeeper')).toContain('purchase.book')
  })

  it('leaves an auditor with what an auditor can actually do', () => {
    // Read and export, and nothing else: looking at what is overdue, import
    // findings, and VAT is reading; every other row is somebody else's afternoon.
    expect(forRole('auditor')).toEqual(['import.blocking', 'sales.overdue', 'vat.filing'])
  })

  it('names, for every row, the permission the screen behind it requires', () => {
    // A row added without one would silently be shown to everybody.
    for (const kind of WORK_QUEUE_ORDER) {
      expect(WORK_QUEUE_PERMISSION[kind], kind).toMatch(/^[a-z]+:[a-z-]+$/)
    }
  })
})

describe('working a list from the keyboard', () => {
  const list = { index: 1, count: 4 }

  it('moves down on j and on the down arrow', () => {
    expect(resolveListKey('j', list)).toEqual({ action: 'move', index: 2 })
    expect(resolveListKey('ArrowDown', list)).toEqual({ action: 'move', index: 2 })
  })

  it('moves up on k and on the up arrow', () => {
    expect(resolveListKey('k', list)).toEqual({ action: 'move', index: 0 })
    expect(resolveListKey('ArrowUp', list)).toEqual({ action: 'move', index: 0 })
  })

  it('stops at both ends rather than wrapping', () => {
    // Wrapping from the last row to the first is how somebody books the wrong
    // thing while holding a key down.
    expect(resolveListKey('j', { index: 3, count: 4 })).toEqual({ action: 'move', index: 3 })
    expect(resolveListKey('k', { index: 0, count: 4 })).toEqual({ action: 'move', index: 0 })
  })

  it('opens what the cursor is on', () => {
    expect(resolveListKey('Enter', list)).toEqual({ action: 'open', index: 1 })
  })

  it('leaves the list on Escape', () => {
    expect(resolveListKey('Escape', list)).toEqual({ action: 'leave' })
  })

  it('never takes a modified key', () => {
    // Cmd+K is the palette and Ctrl+Enter posts an entry. A list that swallows
    // either of those has broken the application to scroll itself.
    expect(resolveListKey('k', list, true)).toEqual({ action: 'ignore' })
    expect(resolveListKey('Enter', list, true)).toEqual({ action: 'ignore' })
  })

  it('recovers when the list shrank under the cursor', () => {
    // The queue reloads after work is done, and a cursor left pointing past
    // the end must move from the last row rather than from nowhere.
    expect(resolveListKey('k', { index: 9, count: 3 })).toEqual({ action: 'move', index: 1 })
  })

  it('does nothing in an empty list, but still lets go of it', () => {
    expect(resolveListKey('j', { index: 0, count: 0 })).toEqual({ action: 'ignore' })
    expect(resolveListKey('Escape', { index: 0, count: 0 })).toEqual({ action: 'leave' })
  })

  it('ignores the keys it has no opinion about', () => {
    expect(resolveListKey('g', list)).toEqual({ action: 'ignore' })
  })
})
