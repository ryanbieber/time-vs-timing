import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns'
import { BacktestError, runBacktest } from './backtest'
import type {
  ISODate,
  PriceSeries,
  RollingPoint,
  RollingResult,
  Scenario,
  TreasuryRatePoint,
} from './types'

const iso = (date: Date): ISODate => format(date, 'yyyy-MM-dd') as ISODate

function quantile(sorted: number[], percentile: number) {
  if (sorted.length === 1) return sorted[0]
  const index = (sorted.length - 1) * percentile
  const lower = Math.floor(index)
  const fraction = index - lower
  return sorted[lower] + (sorted[Math.min(lower + 1, sorted.length - 1)] - sorted[lower]) * fraction
}

function histogram(points: RollingPoint[], binCount = 12) {
  const values = points.map((point) => point.returnDifference)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const width = max === min ? 1 : (max - min) / binCount
  const bins = Array.from({ length: binCount }, (_, index) => ({
    from: min + index * width,
    to: min + (index + 1) * width,
    count: 0,
  }))
  for (const value of values) {
    const index = Math.min(Math.floor((value - min) / width), binCount - 1)
    bins[Math.max(index, 0)].count += 1
  }
  return bins
}

export function runRollingBacktests(
  selected: Scenario,
  priceSeries: PriceSeries,
  rates: TreasuryRatePoint[],
): RollingResult {
  const horizonDays = differenceInCalendarDays(parseISO(selected.endDate), parseISO(selected.startDate))
  const selectedEffectiveStart = priceSeries.points.find(
    (point) => point.date >= selected.startDate,
  )?.date
  const points: RollingPoint[] = []
  for (const price of priceSeries.points) {
    const endDate = iso(addDays(parseISO(price.date), horizonDays))
    if (endDate > priceSeries.metadata.coverageEnd || endDate > rates.at(-1)!.date) continue
    try {
      const result = runBacktest(
        { ...selected, startDate: price.date, endDate },
        priceSeries,
        rates,
      )
      points.push({
        startDate: price.date,
        endDate: result.effectiveEndDate,
        dollarDifference: result.difference.dollars,
        returnDifference: result.difference.percentagePoints,
        winner: result.difference.winner,
        selected: price.date === selectedEffectiveStart,
      })
    } catch (error) {
      if (!(error instanceof BacktestError)) throw error
    }
  }
  if (!points.length) throw new BacktestError('No complete rolling windows fit this horizon.')
  const sortedReturns = points.map((point) => point.returnDifference).sort((a, b) => a - b)
  const lumpWins = points.filter((point) => point.winner === 'lumpSum').length
  const dcaWins = points.filter((point) => point.winner === 'dca').length
  const ties = points.length - lumpWins - dcaWins
  const sortedPoints = [...points].sort((a, b) => a.returnDifference - b.returnDifference)
  return {
    points,
    lumpSumWinRate: lumpWins / points.length,
    dcaWinRate: dcaWins / points.length,
    tieRate: ties / points.length,
    medianReturnDifference: quantile(sortedReturns, 0.5),
    p10ReturnDifference: quantile(sortedReturns, 0.1),
    p90ReturnDifference: quantile(sortedReturns, 0.9),
    worstStart: sortedPoints[0],
    bestStart: sortedPoints.at(-1)!,
    histogram: histogram(points),
  }
}

export const rollingInternals = { quantile, histogram }
