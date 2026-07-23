import { z } from 'zod'
import type { PriceSeries, TreasuryRatePoint } from '../engine/types'

const priceSeriesSchema = z.object({
  metadata: z.object({
    symbol: z.string(),
    name: z.string(),
    currency: z.literal('USD'),
    adjusted: z.literal(true),
    source: z.literal('bundled'),
    snapshotDate: z.string(),
    coverageStart: z.string(),
    coverageEnd: z.string(),
  }),
  points: z.array(
    z.object({
      date: z.string(),
      adjustedClose: z.number().positive().finite(),
    }),
  ),
})

const treasurySchema = z.array(
  z.object({
    date: z.string(),
    annualRatePercent: z.number().nonnegative().finite(),
  }),
)

export async function loadBundledData(): Promise<{
  prices: PriceSeries
  rates: TreasuryRatePoint[]
}> {
  const [priceResponse, rateResponse] = await Promise.all([
    fetch(`${import.meta.env.BASE_URL}data/spy.json`),
    fetch(`${import.meta.env.BASE_URL}data/treasury-3m.json`),
  ])
  if (!priceResponse.ok || !rateResponse.ok) {
    throw new Error('Bundled market data could not be loaded.')
  }
  const prices = priceSeriesSchema.parse(await priceResponse.json()) as PriceSeries
  const rates = treasurySchema.parse(await rateResponse.json()) as TreasuryRatePoint[]
  return { prices, rates }
}
