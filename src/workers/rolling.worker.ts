/// <reference lib="webworker" />

import { runRollingBacktests } from '../engine/rolling'
import type { PriceSeries, Scenario, TreasuryRatePoint } from '../engine/types'

interface RollingRequest {
  scenario: Scenario
  prices: PriceSeries
  rates: TreasuryRatePoint[]
}

self.onmessage = (event: MessageEvent<RollingRequest>) => {
  try {
    self.postMessage({
      result: runRollingBacktests(event.data.scenario, event.data.prices, event.data.rates),
    })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Rolling analysis failed.' })
  }
}
