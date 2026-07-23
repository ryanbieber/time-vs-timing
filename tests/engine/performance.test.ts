import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { runRollingBacktests } from '../../src/engine/rolling'
import type { PriceSeries, TreasuryRatePoint } from '../../src/engine/types'

describe('bundled rolling performance', () => {
  it('evaluates the full default record in a practical amount of time', async () => {
    const prices = JSON.parse(
      await readFile('public/data/spy.json', 'utf8'),
    ) as PriceSeries
    const rates = JSON.parse(
      await readFile('public/data/treasury-3m.json', 'utf8'),
    ) as TreasuryRatePoint[]
    const started = Date.now()
    const result = runRollingBacktests(
      {
        symbol: 'SPY',
        capital: 10_000,
        startDate: '2015-11-26',
        endDate: '2025-11-26',
        purchaseCount: 12,
      },
      prices,
      rates,
    )
    expect(result.points.length).toBeGreaterThan(5_000)
    expect(Date.now() - started).toBeLessThan(30_000)
  }, 35_000)
})
