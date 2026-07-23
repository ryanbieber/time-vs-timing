import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns'
import { BacktestError, runBacktest } from './backtest'
import { analyzeAccountBreakEven } from './recovery'
import type {
  AccountBreakEvenObservation,
  BreakEvenBin,
  BreakEvenDistribution,
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

const breakEvenBins = [
  { label: '0 days', minimum: 0, maximum: 0 },
  { label: '1–7 days', minimum: 1, maximum: 7 },
  { label: '8–30 days', minimum: 8, maximum: 30 },
  { label: '31–90 days', minimum: 31, maximum: 90 },
  { label: '91–180 days', minimum: 91, maximum: 180 },
  { label: '181–365 days', minimum: 181, maximum: 365 },
  { label: '1–2 years', minimum: 366, maximum: 730 },
  { label: '2–5 years', minimum: 731, maximum: 1_826 },
  { label: '5+ years', minimum: 1_827, maximum: Number.POSITIVE_INFINITY },
] as const

function average(values: number[]) {
  return values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length
}

function summarizeBreakEven(
  observations: AccountBreakEvenObservation[],
): BreakEvenDistribution {
  const completedDays = observations
    .filter((observation) => observation.status === 'completed')
    .map((observation) => observation.elapsedCalendarDays)
    .sort((a, b) => a - b)
  const resolvedDays = observations
    .filter((observation) => observation.status !== 'unrecovered')
    .map((observation) => observation.elapsedCalendarDays)
  const unrecoveredCount = observations.filter(
    (observation) => observation.status === 'unrecovered',
  ).length
  const histogram: BreakEvenBin[] = breakEvenBins.map((bin) => ({
    label: bin.label,
    count: observations.filter(
      (observation) => observation.status !== 'unrecovered'
        && observation.elapsedCalendarDays >= bin.minimum
        && observation.elapsedCalendarDays <= bin.maximum,
    ).length,
  }))
  histogram.push({ label: 'Unrecovered', count: unrecoveredCount })

  return {
    totalCount: observations.length,
    completedCount: completedDays.length,
    noInitialDrawdownCount: observations.filter(
      (observation) => observation.status === 'noInitialDrawdown',
    ).length,
    unrecoveredCount,
    averageResolvedDays: average(resolvedDays),
    averageRecoveryDays: average(completedDays),
    medianRecoveryDays: completedDays.length > 0 ? quantile(completedDays, 0.5) : null,
    p90RecoveryDays: completedDays.length > 0 ? quantile(completedDays, 0.9) : null,
    histogram,
  }
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
  const lumpSumBreakEvens: AccountBreakEvenObservation[] = []
  const dcaBreakEvens: AccountBreakEvenObservation[] = []
  for (const price of priceSeries.points) {
    const endDate = iso(addDays(parseISO(price.date), horizonDays))
    if (endDate > priceSeries.metadata.coverageEnd || endDate > rates.at(-1)!.date) continue
    try {
      const result = runBacktest(
        { ...selected, startDate: price.date, endDate },
        priceSeries,
        rates,
      )
      lumpSumBreakEvens.push(analyzeAccountBreakEven(result.lumpSum.values, selected.capital))
      dcaBreakEvens.push(analyzeAccountBreakEven(result.dca.values, selected.capital))
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
    breakEven: {
      lumpSum: summarizeBreakEven(lumpSumBreakEvens),
      dca: summarizeBreakEven(dcaBreakEvens),
    },
  }
}

export const rollingInternals = { quantile, histogram, summarizeBreakEven }
