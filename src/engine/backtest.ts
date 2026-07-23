import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  endOfMonth,
  format,
  isAfter,
  isValid,
  parseISO,
} from 'date-fns'
import type {
  AdjustedPricePoint,
  BacktestResult,
  DateAdjustment,
  ISODate,
  PriceSeries,
  Purchase,
  Scenario,
  StrategyMetrics,
  StrategyResult,
  TreasuryRatePoint,
  ValuePoint,
} from './types'

const YEAR_DAYS = 365.2425
const TRADING_DAYS = 252

export class BacktestError extends Error {}

const iso = (date: Date): ISODate => format(date, 'yyyy-MM-dd') as ISODate

function assertScenario(scenario: Scenario) {
  const start = parseISO(scenario.startDate)
  const end = parseISO(scenario.endDate)
  if (!isValid(start) || !isValid(end) || !isAfter(end, start)) {
    throw new BacktestError('End date must be after the start date.')
  }
  if (!Number.isFinite(scenario.capital) || scenario.capital <= 0) {
    throw new BacktestError('Starting capital must be a positive finite number.')
  }
}

function clampAnniversary(startDate: ISODate, monthOffset: number): ISODate {
  const start = parseISO(startDate)
  const targetMonth = addMonths(new Date(start.getFullYear(), start.getMonth(), 1), monthOffset)
  const day = Math.min(start.getDate(), endOfMonth(targetMonth).getDate())
  return iso(new Date(targetMonth.getFullYear(), targetMonth.getMonth(), day))
}

function firstOnOrAfter(points: AdjustedPricePoint[], date: ISODate) {
  let low = 0
  let high = points.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (points[middle].date < date) low = middle + 1
    else high = middle
  }
  return points[low]
}

function lastOnOrBefore(points: AdjustedPricePoint[], date: ISODate) {
  let low = 0
  let high = points.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (points[middle].date <= date) low = middle + 1
    else high = middle
  }
  return points[low - 1]
}

function rateOnOrBefore(rates: TreasuryRatePoint[], date: ISODate) {
  let low = 0
  let high = rates.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (rates[middle].date <= date) low = middle + 1
    else high = middle
  }
  const point = rates[low - 1]
  if (!point) throw new BacktestError(`No Treasury rate is available on or before ${date}.`)
  return point.annualRatePercent
}

function accrueCash(
  cash: number,
  afterDate: ISODate,
  throughDate: ISODate,
  rates: TreasuryRatePoint[],
) {
  let interest = 0
  let cursor = addDays(parseISO(afterDate), 1)
  const through = parseISO(throughDate)
  while (cursor <= through) {
    const dailyInterest = cash * (rateOnOrBefore(rates, iso(cursor)) / 100 / YEAR_DAYS)
    cash += dailyInterest
    interest += dailyInterest
    cursor = addDays(cursor, 1)
  }
  return { cash, interest }
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return 0
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

function metrics(
  capital: number,
  values: ValuePoint[],
  purchases: Purchase[],
  cashInterest: number,
): StrategyMetrics {
  const endingValue = values.at(-1)?.value ?? capital
  const elapsedDays = differenceInCalendarDays(
    parseISO(values.at(-1)!.date),
    parseISO(values[0].date),
  )
  const dailyReturns = values.slice(1).map((point, index) => point.value / values[index].value - 1)
  let peak = values[0].value
  let maximumDrawdown = 0
  for (const point of values) {
    peak = Math.max(peak, point.value)
    maximumDrawdown = Math.min(maximumDrawdown, point.value / peak - 1)
  }
  const invested = purchases.reduce((sum, purchase) => sum + purchase.dollars, 0)
  const units = purchases.reduce((sum, purchase) => sum + purchase.units, 0)
  return {
    endingValue,
    profit: endingValue - capital,
    totalReturn: endingValue / capital - 1,
    cagr: elapsedDays > 0 ? (endingValue / capital) ** (YEAR_DAYS / elapsedDays) - 1 : 0,
    maximumDrawdown,
    annualizedVolatility: standardDeviation(dailyReturns) * Math.sqrt(TRADING_DAYS),
    averageEquityExposure:
      values.reduce((sum, point) => sum + point.equityValue / point.value, 0) / values.length,
    totalCashInterest: cashInterest,
    averagePurchasePrice: units > 0 ? invested / units : 0,
  }
}

function buildLumpSum(
  capital: number,
  observations: AdjustedPricePoint[],
): StrategyResult {
  const first = observations[0]
  const units = capital / first.adjustedClose
  const purchases: Purchase[] = [
    {
      scheduledDate: first.date,
      executionDate: first.date,
      price: first.adjustedClose,
      dollars: capital,
      units,
    },
  ]
  const values = observations.map((point) => ({
    date: point.date,
    value: units * point.adjustedClose,
    equityValue: units * point.adjustedClose,
    cash: 0,
  }))
  return {
    strategy: 'lumpSum',
    units,
    endingCash: 0,
    purchases,
    values,
    metrics: metrics(capital, values, purchases, 0),
  }
}

function buildDca(
  scenario: Scenario,
  observations: AdjustedPricePoint[],
  rates: TreasuryRatePoint[],
  scheduledDates: ISODate[],
  executionPoints: AdjustedPricePoint[],
): StrategyResult {
  let cash = scenario.capital
  let units = 0
  let cashInterest = 0
  let lastAccrualDate = observations[0].date
  const installment = scenario.capital / scenario.purchaseCount
  const purchases: Purchase[] = []
  const purchasesByDate = new Map<ISODate, number[]>()
  executionPoints.forEach((point, index) => {
    purchasesByDate.set(point.date, [...(purchasesByDate.get(point.date) ?? []), index])
  })
  const values: ValuePoint[] = []

  for (const point of observations) {
    const purchaseIndices = purchasesByDate.get(point.date)
    if (purchaseIndices) {
      if (purchaseIndices[0] > 0) {
        const accrued = accrueCash(cash, lastAccrualDate, point.date, rates)
        cash = accrued.cash
        cashInterest += accrued.interest
      }
      purchaseIndices.forEach((purchaseIndex) => {
        const dollars =
          purchaseIndex === scenario.purchaseCount - 1 ? cash : Math.min(installment, cash)
        const purchasedUnits = dollars / point.adjustedClose
        cash -= dollars
        units += purchasedUnits
        purchases.push({
          scheduledDate: scheduledDates[purchaseIndex],
          executionDate: point.date,
          price: point.adjustedClose,
          dollars,
          units: purchasedUnits,
        })
      })
      lastAccrualDate = point.date
    } else if (cash > 0 && point.date > lastAccrualDate) {
      const accrued = accrueCash(cash, lastAccrualDate, point.date, rates)
      cash = accrued.cash
      cashInterest += accrued.interest
      lastAccrualDate = point.date
    }
    const equityValue = units * point.adjustedClose
    values.push({ date: point.date, value: equityValue + cash, equityValue, cash })
  }

  return {
    strategy: 'dca',
    units,
    endingCash: cash,
    purchases,
    values,
    metrics: metrics(scenario.capital, values, purchases, cashInterest),
  }
}

export function runBacktest(
  scenario: Scenario,
  priceSeries: PriceSeries,
  rates: TreasuryRatePoint[],
): BacktestResult {
  assertScenario(scenario)
  const validPrices = priceSeries.points.filter(
    (point) => Number.isFinite(point.adjustedClose) && point.adjustedClose > 0,
  )
  if (validPrices.length !== priceSeries.points.length) {
    throw new BacktestError('Price series contains invalid adjusted-close values.')
  }
  const coverageStart =
    priceSeries.metadata.coverageStart > rates[0]?.date
      ? priceSeries.metadata.coverageStart
      : rates[0]?.date
  const rateCoverageEnd = rates.at(-1)?.date
  const coverageEnd =
    rateCoverageEnd && priceSeries.metadata.coverageEnd < rateCoverageEnd
      ? priceSeries.metadata.coverageEnd
      : rateCoverageEnd
  if (!coverageStart || !coverageEnd) throw new BacktestError('Price and Treasury data do not overlap.')
  if (scenario.startDate < coverageStart || scenario.endDate > coverageEnd) {
    throw new BacktestError(`Choose dates within the shared data coverage: ${coverageStart}–${coverageEnd}.`)
  }

  const startPoint = firstOnOrAfter(validPrices, scenario.startDate)
  const endPoint = lastOnOrBefore(validPrices, scenario.endDate)
  if (!startPoint || !endPoint || startPoint.date >= endPoint.date) {
    throw new BacktestError('No complete price window is available for these dates.')
  }
  const scheduledDates = Array.from({ length: scenario.purchaseCount }, (_, index) =>
    clampAnniversary(scenario.startDate, index),
  )
  const executionPoints = scheduledDates.map((date) => firstOnOrAfter(validPrices, date))
  if (executionPoints.some((point) => !point || point.date > endPoint.date)) {
    throw new BacktestError('The selected end date does not include every DCA purchase.')
  }
  const completeExecutionPoints = executionPoints as AdjustedPricePoint[]
  if (!isAfter(parseISO(scenario.endDate), parseISO(completeExecutionPoints.at(-1)!.date))) {
    throw new BacktestError('End date must fall after the final DCA purchase.')
  }

  const observations = validPrices.filter(
    (point) => point.date >= startPoint.date && point.date <= endPoint.date,
  )
  const adjustments: DateAdjustment[] = []
  if (startPoint.date !== scenario.startDate) {
    adjustments.push({ boundary: 'start', requested: scenario.startDate, actual: startPoint.date })
  }
  if (endPoint.date !== scenario.endDate) {
    adjustments.push({ boundary: 'end', requested: scenario.endDate, actual: endPoint.date })
  }
  scheduledDates.forEach((date, index) => {
    if (completeExecutionPoints[index].date !== date) {
      adjustments.push({
        boundary: 'purchase',
        requested: date,
        actual: completeExecutionPoints[index].date,
      })
    }
  })
  const lumpSum = buildLumpSum(scenario.capital, observations)
  const dca = buildDca(scenario, observations, rates, scheduledDates, completeExecutionPoints)
  const dollars = lumpSum.metrics.endingValue - dca.metrics.endingValue
  return {
    scenario,
    effectiveStartDate: startPoint.date,
    effectiveEndDate: endPoint.date,
    adjustments,
    lumpSum,
    dca,
    difference: {
      dollars,
      percentagePoints: (lumpSum.metrics.totalReturn - dca.metrics.totalReturn) * 100,
      winner: Math.abs(dollars) < 0.01 ? 'tie' : dollars > 0 ? 'lumpSum' : 'dca',
    },
  }
}

export const engineInternals = {
  clampAnniversary,
  rateOnOrBefore,
  accrueCash,
  standardDeviation,
}
