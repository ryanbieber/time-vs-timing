import { describe, expect, it } from 'vitest'
import { analyzeRecovery } from '../../src/engine/recovery'
import type { ISODate, PriceSeries } from '../../src/engine/types'

function series(values: Array<[ISODate, number]>): PriceSeries {
  return {
    metadata: {
      symbol: 'TEST',
      name: 'Test series',
      currency: 'USD',
      adjusted: true,
      source: 'imported',
      coverageStart: values[0][0],
      coverageEnd: values.at(-1)![0],
    },
    points: values.map(([date, adjustedClose]) => ({ date, adjustedClose })),
  }
}

describe('recovery analysis', () => {
  it('finds the first break-even session and the intervening trough', () => {
    const result = analyzeRecovery(series([
      ['2020-01-01', 100],
      ['2020-01-02', 80],
      ['2020-01-03', 90],
      ['2020-01-06', 100],
      ['2020-01-07', 110],
    ]), '2020-01-01')

    expect(result.selected).toMatchObject({
      status: 'completed',
      entryDate: '2020-01-01',
      troughDate: '2020-01-02',
      recoveryDate: '2020-01-06',
      elapsedCalendarDays: 5,
    })
    expect(result.selected.maximumDrawdown).toBeCloseTo(-0.2)
  })

  it('distinguishes unrecovered entries from entries that never initially fell', () => {
    const falling = analyzeRecovery(series([
      ['2020-01-01', 100],
      ['2020-01-02', 90],
      ['2020-01-03', 80],
    ]), '2020-01-01')
    expect(falling.selected).toMatchObject({
      status: 'unrecovered',
      troughDate: '2020-01-03',
      elapsedCalendarDays: 2,
    })
    expect(falling.selected.maximumDrawdown).toBeCloseTo(-0.2)
    expect(falling.unrecoveredEntryCount).toBe(2)

    const rising = analyzeRecovery(series([
      ['2020-01-01', 100],
      ['2020-01-02', 101],
      ['2020-01-03', 102],
    ]), '2020-01-01')
    expect(rising.selected.status).toBe('noInitialDrawdown')
    expect(rising.selected.elapsedCalendarDays).toBe(0)
  })

  it('selects the longest completed recovery and rolls a weekend entry forward', () => {
    const result = analyzeRecovery(series([
      ['2020-01-03', 100],
      ['2020-01-06', 80],
      ['2020-01-07', 90],
      ['2020-01-08', 100],
      ['2020-01-09', 95],
      ['2020-01-10', 100],
    ]), '2020-01-04')

    expect(result.selected.entryDate).toBe('2020-01-06')
    expect(result.worstCompleted).toMatchObject({
      entryDate: '2020-01-03',
      recoveryDate: '2020-01-08',
      elapsedCalendarDays: 5,
    })
  })

  it('rejects insufficient data and entries after coverage', () => {
    expect(() => analyzeRecovery(series([['2020-01-01', 100]]), '2020-01-01'))
      .toThrow('at least two')
    expect(() => analyzeRecovery(series([
      ['2020-01-01', 100],
      ['2020-01-02', 101],
    ]), '2021-01-01')).toThrow('outside price coverage')
  })
})
