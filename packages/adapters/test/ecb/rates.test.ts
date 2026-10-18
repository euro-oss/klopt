import { describe, expect, it } from 'vitest'
import { eurPerForeign, parseEcbEurofxrefXml } from '../../src/ecb/index.js'

const SAMPLE = `<?xml version="1.0"?>
<gesmes:Envelope>
  <Cube>
    <Cube time="2026-10-16">
      <Cube currency="USD" rate="1.0856"/>
      <Cube currency="GBP" rate="0.8621"/>
    </Cube>
    <Cube time="2026-10-15">
      <Cube currency="USD" rate="1.0840"/>
    </Cube>
  </Cube>
</gesmes:Envelope>`

describe('parseEcbEurofxrefXml', () => {
  it('reads Cube time and currency rows', () => {
    const rows = parseEcbEurofxrefXml(SAMPLE)
    expect(rows).toEqual([
      { currency: 'USD', rateDate: '2026-10-16', rate: '1.0856' },
      { currency: 'GBP', rateDate: '2026-10-16', rate: '0.8621' },
      { currency: 'USD', rateDate: '2026-10-15', rate: '1.0840' },
    ])
  })
})

describe('eurPerForeign', () => {
  it('inverts the published quote for journal_lines.exchange_rate without float maths', () => {
    const inverted = eurPerForeign('1.0856')
    expect(inverted).toMatch(/^\d+\.\d+$/)
    // 1/1.0856 ≈ 0.921149… — integer reciprocal at 12dp.
    expect(inverted.startsWith('0.921')).toBe(true)
    expect(Number(inverted)).toBeCloseTo(1 / 1.0856, 10)
  })
})
