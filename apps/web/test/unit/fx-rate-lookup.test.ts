import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FX_LOOKUP_SLOW_HINT_MS,
  formatFxAnnouncementDate,
  fxLookupLiveKind,
  nextFxLookupDraft,
  shouldApplyFxLookupResult,
  shouldShowFxLookupSlowHint,
  showFxSourceBadge,
} from '../../src/lib/fx-rate-lookup.js'
import { en } from '../../src/i18n/en.js'
import { nl } from '../../src/i18n/nl.js'
import { translate } from '../../src/i18n/locale.js'

describe('shouldApplyFxLookupResult', () => {
  it('applies only the current generation when the user has not typed', () => {
    expect(
      shouldApplyFxLookupResult({
        resultGeneration: 3,
        currentGeneration: 3,
        userEditedDuringLookup: false,
      }),
    ).toBe(true)
  })

  it('ignores a stale generation (superseded lookup)', () => {
    expect(
      shouldApplyFxLookupResult({
        resultGeneration: 2,
        currentGeneration: 3,
        userEditedDuringLookup: false,
      }),
    ).toBe(false)
  })

  it('ignores the lookup when the user typed during loading', () => {
    expect(
      shouldApplyFxLookupResult({
        resultGeneration: 3,
        currentGeneration: 3,
        userEditedDuringLookup: true,
      }),
    ).toBe(false)
  })
})

describe('shouldShowFxLookupSlowHint', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('stays hidden until the 3 s threshold while loading', () => {
    expect(shouldShowFxLookupSlowHint(true, 0)).toBe(false)
    expect(shouldShowFxLookupSlowHint(true, FX_LOOKUP_SLOW_HINT_MS - 1)).toBe(false)
    expect(shouldShowFxLookupSlowHint(true, FX_LOOKUP_SLOW_HINT_MS)).toBe(true)
    expect(shouldShowFxLookupSlowHint(false, FX_LOOKUP_SLOW_HINT_MS)).toBe(false)
  })

  it('uses a 3_000 ms threshold', () => {
    expect(FX_LOOKUP_SLOW_HINT_MS).toBe(3_000)
    const started = Date.now()
    vi.advanceTimersByTime(2_999)
    expect(shouldShowFxLookupSlowHint(true, Date.now() - started)).toBe(false)
    vi.advanceTimersByTime(1)
    expect(shouldShowFxLookupSlowHint(true, Date.now() - started)).toBe(true)
  })
})

describe('fxLookupLiveKind', () => {
  it('maps loading, error and success for the polite live region', () => {
    expect(fxLookupLiveKind({ loading: true, error: null, hasEcbRate: false })).toBe('loading')
    expect(fxLookupLiveKind({ loading: false, error: 'fail', hasEcbRate: false })).toBe('error')
    expect(fxLookupLiveKind({ loading: false, error: null, hasEcbRate: true })).toBe('success')
    expect(fxLookupLiveKind({ loading: false, error: null, hasEcbRate: false })).toBe('idle')
  })
})

describe('formatFxAnnouncementDate', () => {
  it('formats ISO dates as DD-MM-YYYY for NL and EN live copy', () => {
    expect(formatFxAnnouncementDate('2026-10-16')).toBe('16-10-2026')
    expect(translate('nl', 'importFindings.fx.fetchSuccess', { date: '16-10-2026' })).toBe(
      'ECB-koers geladen (16-10-2026).',
    )
    expect(translate('en', 'importFindings.fx.fetchSuccess', { date: '16-10-2026' })).toBe(
      'ECB rate loaded (16-10-2026).',
    )
    expect(translate('nl', 'importFindings.fx.badgeEcb', { date: '16-10-2026' })).toBe(
      'ECB · 16-10-2026',
    )
    expect(translate('nl', 'importFindings.fx.ecbNote', { date: '16-10-2026' })).toContain(
      '16-10-2026',
    )
  })
})

describe('showFxSourceBadge', () => {
  it('always shows the ECB badge', () => {
    expect(showFxSourceBadge('ecb', '')).toBe(true)
    expect(showFxSourceBadge('ecb', '1,1531')).toBe(true)
  })

  it('hides Aangepast when the rate field is empty', () => {
    expect(showFxSourceBadge('override', '')).toBe(false)
    expect(showFxSourceBadge('override', '   ')).toBe(false)
  })

  it('shows Aangepast once a rate is typed', () => {
    expect(showFxSourceBadge('override', '1,1490')).toBe(true)
  })
})

describe('nextFxLookupDraft', () => {
  it('starts empty for a new document', () => {
    expect(
      nextFxLookupDraft(null, {
        externalId: 'doc-1',
        currency: 'GBP',
        documentDate: '2026-10-16',
      }),
    ).toMatchObject({
      externalId: 'doc-1',
      rate: '',
      ecbRate: '',
      loading: true,
      error: null,
      userEditedDuringLookup: false,
    })
  })

  it('keeps a typed rate on Opnieuw ophalen for the same document', () => {
    const next = nextFxLookupDraft(
      {
        externalId: 'doc-1',
        currency: 'GBP',
        documentDate: '2026-10-16',
        rate: '1,1490',
        ecbRate: '',
        source: 'override',
        date: '2026-10-16',
        userEditedDuringLookup: true,
      },
      { externalId: 'doc-1', currency: 'GBP', documentDate: '2026-10-16' },
    )
    expect(next.rate).toBe('1,1490')
    expect(next.source).toBe('override')
    expect(next.loading).toBe(true)
    expect(next.error).toBeNull()
    // Intentional refresh may apply ECB; typing mid-flight sets the flag again.
    expect(next.userEditedDuringLookup).toBe(false)
  })
})

describe('Koers ECB i18n', () => {
  it('keeps NL/EN key parity for the loading, slow-hint and error copy', () => {
    const keys = [
      'importFindings.fx.fetchingEcb',
      'importFindings.fx.refreshEcb',
      'importFindings.fx.fetchSuccess',
      'importFindings.fx.slowHint',
      'moneybird.fx.refreshFailed',
    ] as const
    for (const key of keys) {
      expect(nl[key]).toBeTruthy()
      expect(en[key]).toBeTruthy()
    }
    expect(nl['importFindings.fx.fetchingEcb']).toBe('Koers ophalen bij ECB…')
    expect(en['importFindings.fx.fetchingEcb']).toBe('Fetching ECB rate…')
    expect(nl['importFindings.fx.slowHint']).toContain('zelf invullen')
    expect(nl['moneybird.fx.refreshFailed']).toContain('ECB-koers nu niet ophalen')
  })
})
