import { addDays, format, parseISO } from 'date-fns'
import { describe, expect, it } from 'vitest'
import { engineInternals, runBacktest } from '../../src/engine/backtest'
import type {
  AdjustedPricePoint,
  ISODate,
  PriceSeries,
  PurchaseCount,
  Scenario,
  TreasuryRatePoint,
} from '../../src/engine/types'

function weekdays(start: string, end: string, priceAt: (index: number) => number) {
  const points: AdjustedPricePoint[] = []
  let cursor = parseISO(start)
  const final = parseISO(end)
  let index = 0
  while (cursor <= final) {
    if (cursor.getDay() !== 0 && cursor.getDay() !== 6) {
      points.push({
        date: format(cursor, 'yyyy-MM-dd') as ISODate,
        adjustedClose: priceAt(index),
      })
      index += 1
    }
    cursor = addDays(cursor, 1)
  }
  return points
}

function series(points: AdjustedPricePoint[]): PriceSeries {
  return {
    metadata: {
      symbol: 'TEST',
      name: 'Test adjusted series',
      currency: 'USD',
      adjusted: true,
      source: 'imported',
      coverageStart: points[0].date,
      coverageEnd: points.at(-1)!.date,
    },
    points,
  }
}

const zeroRates: TreasuryRatePoint[] = [
  { date: '2019-12-31', annualRatePercent: 0 },
  { date: '2021-12-31', annualRatePercent: 0 },
]

function scenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    symbol: 'TEST',
    capital: 12_000,
    startDate: '2020-01-31',
    endDate: '2020-06-01',
    purchaseCount: 3,
    ...overrides,
  }
}

describe('runBacktest', () => {
  it('makes lump sum win in steadily rising adjusted prices', () => {
    const result = runBacktest(
      scenario(),
      series(weekdays('2020-01-31', '2020-06-01', (index) => 100 + index)),
      zeroRates,
    )
    expect(result.difference.winner).toBe('lumpSum')
    expect(result.lumpSum.units).toBe(120)
    expect(result.dca.purchases).toHaveLength(3)
    expect(result.dca.endingCash).toBeCloseTo(0, 10)
  })

  it('makes DCA win in steadily falling adjusted prices', () => {
    const result = runBacktest(
      scenario(),
      series(weekdays('2020-01-31', '2020-06-01', (index) => 300 - index)),
      zeroRates,
    )
    expect(result.difference.winner).toBe('dca')
  })

  it('ties to the cent in flat adjusted prices', () => {
    const result = runBacktest(
      scenario(),
      series(weekdays('2020-01-31', '2020-06-01', () => 100)),
      zeroRates,
    )
    expect(result.difference.winner).toBe('tie')
    expect(result.lumpSum.metrics.endingValue).toBeCloseTo(12_000)
    expect(result.dca.metrics.averagePurchasePrice).toBe(100)
    expect(result.dca.metrics.maximumDrawdown).toBe(0)
    expect(result.dca.metrics.annualizedVolatility).toBe(0)
  })

  it('clamps January 31 anniversaries and advances weekend purchases', () => {
    const result = runBacktest(
      scenario(),
      series(weekdays('2020-01-31', '2020-06-01', () => 100)),
      zeroRates,
    )
    expect(result.dca.purchases.map((purchase) => purchase.scheduledDate)).toEqual([
      '2020-01-31',
      '2020-02-29',
      '2020-03-31',
    ])
    expect(result.dca.purchases.map((purchase) => purchase.executionDate)).toEqual([
      '2020-01-31',
      '2020-03-02',
      '2020-03-31',
    ])
    expect(result.adjustments).toContainEqual({
      boundary: 'purchase',
      requested: '2020-02-29',
      actual: '2020-03-02',
    })
  })

  it('rolls start forward and end backward to observations', () => {
    const result = runBacktest(
      scenario({ startDate: '2020-02-01', endDate: '2020-05-31' }),
      series(weekdays('2020-01-31', '2020-06-01', () => 100)),
      zeroRates,
    )
    expect(result.effectiveStartDate).toBe('2020-02-03')
    expect(result.effectiveEndDate).toBe('2020-05-29')
    expect(result.adjustments).toEqual(expect.arrayContaining([
      { boundary: 'start', requested: '2020-02-01', actual: '2020-02-03' },
      { boundary: 'end', requested: '2020-05-31', actual: '2020-05-29' },
    ]))
  })

  it('uses historical rates without look-ahead and sweeps interest in the final purchase', () => {
    const rates: TreasuryRatePoint[] = [
      { date: '2020-01-30', annualRatePercent: 3.652425 },
      { date: '2020-03-01', annualRatePercent: 7.30485 },
      { date: '2020-12-31', annualRatePercent: 7.30485 },
    ]
    const result = runBacktest(
      scenario(),
      series(weekdays('2020-01-31', '2020-06-01', () => 100)),
      rates,
    )
    expect(engineInternals.rateOnOrBefore(rates, '2020-02-29')).toBe(3.652425)
    expect(result.dca.metrics.totalCashInterest).toBeGreaterThan(0)
    expect(result.dca.purchases.at(-1)!.dollars).toBeGreaterThan(4_000)
    expect(result.dca.endingCash).toBeCloseTo(0, 10)
    expect(result.dca.units).toBeCloseTo(
      result.dca.purchases.reduce((sum, purchase) => sum + purchase.units, 0),
    )
  })

  it('computes CAGR, drawdown, volatility, exposure, profit, and return deterministically', () => {
    const prices = series(weekdays('2020-01-31', '2021-02-01', (index) => index % 2 ? 110 : 100))
    const first = runBacktest(scenario({ endDate: '2021-02-01' }), prices, zeroRates)
    const second = runBacktest(scenario({ endDate: '2021-02-01' }), prices, zeroRates)
    expect(second).toEqual(first)
    expect(first.lumpSum.metrics.cagr).toBeCloseTo(first.lumpSum.metrics.totalReturn, 2)
    expect(first.lumpSum.metrics.maximumDrawdown).toBeLessThan(0)
    expect(first.lumpSum.metrics.annualizedVolatility).toBeGreaterThan(0)
    expect(first.lumpSum.metrics.averageEquityExposure).toBe(1)
    expect(first.dca.metrics.averageEquityExposure).toBeLessThan(1)
    expect(first.lumpSum.metrics.profit).toBeCloseTo(
      first.lumpSum.metrics.endingValue - first.scenario.capital,
    )
  })

  it('treats adjusted closes as total-return units without separate distributions', () => {
    const points = weekdays('2020-01-31', '2020-06-01', () => 100)
    const result = runBacktest(scenario(), series(points), zeroRates)
    expect(result.lumpSum.metrics.totalReturn).toBe(0)
    expect(result.lumpSum.units).toBe(120)
  })

  it('executes every scheduled installment when sparse observations share a session', () => {
    const points: AdjustedPricePoint[] = [
      { date: '2020-01-02', adjustedClose: 100 },
      { date: '2020-05-01', adjustedClose: 100 },
      { date: '2020-06-01', adjustedClose: 100 },
    ]
    const result = runBacktest(
      scenario({ startDate: '2020-01-02', endDate: '2020-06-01' }),
      series(points),
      zeroRates,
    )
    expect(result.dca.purchases).toHaveLength(3)
    expect(result.dca.purchases.filter((purchase) => purchase.executionDate === '2020-05-01')).toHaveLength(2)
  })

  it.each([
    [{ capital: 0 }, 'positive finite'],
    [{ capital: Number.POSITIVE_INFINITY }, 'positive finite'],
    [{ startDate: 'bad' as ISODate }, 'after the start'],
    [{ endDate: '2020-01-01' as ISODate }, 'after the start'],
  ])('rejects invalid scenarios %#', (override, message) => {
    expect(() =>
      runBacktest(
        scenario(override),
        series(weekdays('2020-01-01', '2020-12-31', () => 100)),
        zeroRates,
      ),
    ).toThrow(message)
  })

  it('rejects invalid prices, missing overlap, out-of-coverage dates, and empty windows', () => {
    const points = weekdays('2020-01-01', '2020-12-31', () => 100)
    expect(() => runBacktest(scenario(), series([{ ...points[0], adjustedClose: -1 }, ...points.slice(1)]), zeroRates)).toThrow('invalid')
    expect(() => runBacktest(scenario(), series(points), [])).toThrow('overlap')
    expect(() => runBacktest(scenario({ startDate: '2019-01-01' }), series(points), zeroRates)).toThrow('shared data coverage')
    expect(() => runBacktest(scenario({ startDate: '2020-12-30', endDate: '2020-12-31' }), series(points), zeroRates)).toThrow()
  })

  it('rejects incomplete DCA windows and an end date on the final purchase', () => {
    const prices = series(weekdays('2020-01-01', '2021-12-31', () => 100))
    expect(() => runBacktest(scenario({ endDate: '2020-02-15', purchaseCount: 6 }), prices, zeroRates)).toThrow('every DCA purchase')
    expect(() => runBacktest(scenario({ endDate: '2020-03-31' }), prices, zeroRates)).toThrow('after the final')
  })

  it('throws when a required rate is missing', () => {
    const prices = series(weekdays('2020-01-31', '2020-06-01', () => 100))
    const lateRates = [{ date: '2020-02-15' as ISODate, annualRatePercent: 1 }]
    expect(() => runBacktest(scenario(), prices, lateRates)).toThrow('shared data coverage')
    expect(() => engineInternals.rateOnOrBefore(lateRates, '2020-02-01')).toThrow('No Treasury rate')
  })

  it('handles a zero-day standard deviation input and direct interest accrual', () => {
    expect(engineInternals.standardDeviation([])).toBe(0)
    expect(engineInternals.standardDeviation([1])).toBe(0)
    const accrued = engineInternals.accrueCash(
      1_000,
      '2020-01-01',
      '2020-01-02',
      [{ date: '2020-01-01', annualRatePercent: 36.52425 }],
    )
    expect(accrued.cash).toBeCloseTo(1_001)
    expect(accrued.interest).toBeCloseTo(1)
  })

  it.each([6, 12, 24, 36] as PurchaseCount[])('supports the %i-purchase preset', (purchaseCount) => {
    const prices = series(weekdays('2020-01-01', '2024-12-31', () => 100))
    const result = runBacktest(
      scenario({ startDate: '2020-01-02', endDate: '2024-12-31', purchaseCount }),
      prices,
      [zeroRates[0], { date: '2024-12-31', annualRatePercent: 0 }],
    )
    expect(result.dca.purchases).toHaveLength(purchaseCount)
  })
})
