import { addDays, format, parseISO } from 'date-fns'
import { describe, expect, it } from 'vitest'
import { runRollingBacktests, rollingInternals } from '../../src/engine/rolling'
import type { AdjustedPricePoint, ISODate, PriceSeries, Scenario, TreasuryRatePoint } from '../../src/engine/types'

function fixture(): { prices: PriceSeries; rates: TreasuryRatePoint[]; scenario: Scenario } {
  const points: AdjustedPricePoint[] = []
  let cursor = parseISO('2020-01-01')
  let index = 0
  while (cursor <= parseISO('2021-12-31')) {
    if (cursor.getDay() !== 0 && cursor.getDay() !== 6) {
      points.push({
        date: format(cursor, 'yyyy-MM-dd') as ISODate,
        adjustedClose: 100 + Math.sin(index / 15) * 10 + index / 10,
      })
      index += 1
    }
    cursor = addDays(cursor, 1)
  }
  return {
    prices: {
      metadata: {
        symbol: 'ROLL',
        name: 'Rolling fixture',
        currency: 'USD',
        adjusted: true,
        source: 'imported',
        coverageStart: points[0].date,
        coverageEnd: points.at(-1)!.date,
      },
      points,
    },
    rates: [
      { date: '2019-12-31', annualRatePercent: 0 },
      { date: '2021-12-31', annualRatePercent: 0 },
    ],
    scenario: {
      symbol: 'ROLL',
      capital: 10_000,
      startDate: '2020-02-01',
      endDate: '2020-08-01',
      purchaseCount: 3,
    },
  }
}

describe('runRollingBacktests', () => {
  it('includes each valid trading start once, preserves horizon, and selects the adjusted chosen start', () => {
    const { prices, rates, scenario } = fixture()
    const result = runRollingBacktests(scenario, prices, rates)
    expect(new Set(result.points.map((point) => point.startDate)).size).toBe(result.points.length)
    expect(result.points[0].startDate).toBe(prices.points[0].date)
    expect(result.points.filter((point) => point.selected)).toHaveLength(1)
    expect(result.points.find((point) => point.selected)?.startDate).toBe('2020-02-03')
    expect(result.lumpSumWinRate + result.dcaWinRate + result.tieRate).toBeCloseTo(1)
    expect(result.bestStart.returnDifference).toBeGreaterThanOrEqual(result.worstStart.returnDifference)
    expect(result.histogram.reduce((sum, bin) => sum + bin.count, 0)).toBe(result.points.length)
    expect(result.breakEven.lumpSum.histogram.reduce((sum, bin) => sum + bin.count, 0))
      .toBe(result.points.length)
    expect(result.breakEven.dca.histogram.reduce((sum, bin) => sum + bin.count, 0))
      .toBe(result.points.length)
    expect(result.breakEven.lumpSum.totalCount).toBe(result.points.length)
    expect(result.breakEven.dca.totalCount).toBe(result.points.length)
  })

  it('computes interpolated quantiles and a stable histogram for identical values', () => {
    expect(rollingInternals.quantile([0, 10], 0.1)).toBe(1)
    const bins = rollingInternals.histogram([
      { startDate: '2020-01-01', endDate: '2020-02-01', dollarDifference: 0, returnDifference: 2, winner: 'tie', selected: false },
    ], 3)
    expect(bins).toHaveLength(3)
    expect(bins[0].count).toBe(1)
    expect(rollingInternals.quantile([4], 0.9)).toBe(4)
  })

  it('summarizes resolved, recovered, zero-day, and censored break-even outcomes', () => {
    const summary = rollingInternals.summarizeBreakEven([
      { status: 'noInitialDrawdown', elapsedCalendarDays: 0 },
      { status: 'completed', elapsedCalendarDays: 6 },
      { status: 'completed', elapsedCalendarDays: 30 },
      { status: 'unrecovered', elapsedCalendarDays: 365 },
    ])
    expect(summary).toMatchObject({
      totalCount: 4,
      completedCount: 2,
      noInitialDrawdownCount: 1,
      unrecoveredCount: 1,
      averageResolvedDays: 12,
      averageRecoveryDays: 18,
      medianRecoveryDays: 18,
      p90RecoveryDays: 27.6,
    })
    expect(summary.histogram.find((bin) => bin.label === '0 days')?.count).toBe(1)
    expect(summary.histogram.find((bin) => bin.label === '1–7 days')?.count).toBe(1)
    expect(summary.histogram.find((bin) => bin.label === '8–30 days')?.count).toBe(1)
    expect(summary.histogram.find((bin) => bin.label === 'Unrecovered')?.count).toBe(1)

    expect(rollingInternals.summarizeBreakEven([
      { status: 'unrecovered', elapsedCalendarDays: 365 },
    ])).toMatchObject({
      averageResolvedDays: null,
      averageRecoveryDays: null,
      medianRecoveryDays: null,
      p90RecoveryDays: null,
    })
  })

  it('rejects a horizon with no complete windows', () => {
    const { prices, rates, scenario } = fixture()
    expect(() =>
      runRollingBacktests({ ...scenario, startDate: '2020-01-01', endDate: '2025-01-01' }, prices, rates),
    ).toThrow('No complete rolling windows')
  })
})
