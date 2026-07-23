export type ISODate = `${number}-${number}-${number}`

export interface PriceSeriesMetadata {
  symbol: string
  name: string
  currency: 'USD'
  adjusted: true
  source: 'bundled' | 'imported'
  snapshotDate?: ISODate
  coverageStart: ISODate
  coverageEnd: ISODate
}

export interface AdjustedPricePoint {
  date: ISODate
  adjustedClose: number
}

export interface PriceSeries {
  metadata: PriceSeriesMetadata
  points: AdjustedPricePoint[]
}

export interface TreasuryRatePoint {
  date: ISODate
  annualRatePercent: number
}

export type PurchaseCount = 3 | 6 | 12 | 24 | 36

export interface Scenario {
  symbol: string
  capital: number
  startDate: ISODate
  endDate: ISODate
  purchaseCount: PurchaseCount
}

export interface Purchase {
  scheduledDate: ISODate
  executionDate: ISODate
  price: number
  dollars: number
  units: number
}

export interface ValuePoint {
  date: ISODate
  value: number
  equityValue: number
  cash: number
}

export interface StrategyMetrics {
  endingValue: number
  profit: number
  totalReturn: number
  cagr: number
  maximumDrawdown: number
  annualizedVolatility: number
  averageEquityExposure: number
  totalCashInterest: number
  averagePurchasePrice: number
}

export interface StrategyResult {
  strategy: 'lumpSum' | 'dca'
  units: number
  endingCash: number
  purchases: Purchase[]
  values: ValuePoint[]
  metrics: StrategyMetrics
}

export interface DateAdjustment {
  boundary: 'start' | 'end' | 'purchase'
  requested: ISODate
  actual: ISODate
}

export interface BacktestResult {
  scenario: Scenario
  effectiveStartDate: ISODate
  effectiveEndDate: ISODate
  adjustments: DateAdjustment[]
  lumpSum: StrategyResult
  dca: StrategyResult
  difference: {
    dollars: number
    percentagePoints: number
    winner: 'lumpSum' | 'dca' | 'tie'
  }
}

export interface RollingPoint {
  startDate: ISODate
  endDate: ISODate
  dollarDifference: number
  returnDifference: number
  winner: 'lumpSum' | 'dca' | 'tie'
  selected: boolean
}

export interface RollingResult {
  points: RollingPoint[]
  lumpSumWinRate: number
  dcaWinRate: number
  tieRate: number
  medianReturnDifference: number
  p10ReturnDifference: number
  p90ReturnDifference: number
  bestStart: RollingPoint
  worstStart: RollingPoint
  histogram: Array<{ from: number; to: number; count: number }>
}
