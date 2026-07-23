import { differenceInCalendarDays } from 'date-fns'
import type {
  AccountBreakEvenObservation,
  AdjustedPricePoint,
  ISODate,
  PriceSeries,
  RecoveryAnalysis,
  RecoveryEpisode,
  ValuePoint,
} from './types'

function calendarDays(from: ISODate, to: ISODate): number {
  return differenceInCalendarDays(
    new Date(`${to}T00:00:00Z`),
    new Date(`${from}T00:00:00Z`),
  )
}

function episodeAt(
  points: AdjustedPricePoint[],
  entryIndex: number,
  knownRecoveryIndex?: number,
): RecoveryEpisode {
  const entry = points[entryIndex]
  let troughIndex = entryIndex

  const recoveryIndex = knownRecoveryIndex ?? points.findIndex(
    (point, index) => index > entryIndex && point.adjustedClose >= entry.adjustedClose,
  )
  const searchEnd = recoveryIndex >= 0 ? recoveryIndex : points.length - 1

  for (let index = entryIndex + 1; index <= searchEnd; index += 1) {
    if (points[index].adjustedClose < points[troughIndex].adjustedClose) {
      troughIndex = index
    }
  }

  const trough = points[troughIndex]
  const wentUnderwater = trough.adjustedClose < entry.adjustedClose

  if (!wentUnderwater) {
    return {
      status: 'noInitialDrawdown',
      entryDate: entry.date,
      entryPrice: entry.adjustedClose,
      troughDate: entry.date,
      troughPrice: entry.adjustedClose,
      maximumDrawdown: 0,
      elapsedCalendarDays: 0,
    }
  }

  if (recoveryIndex >= 0) {
    const recovery = points[recoveryIndex]
    return {
      status: 'completed',
      entryDate: entry.date,
      entryPrice: entry.adjustedClose,
      troughDate: trough.date,
      troughPrice: trough.adjustedClose,
      maximumDrawdown: trough.adjustedClose / entry.adjustedClose - 1,
      recoveryDate: recovery.date,
      elapsedCalendarDays: calendarDays(entry.date, recovery.date),
    }
  }

  return {
    status: 'unrecovered',
    entryDate: entry.date,
    entryPrice: entry.adjustedClose,
    troughDate: trough.date,
    troughPrice: trough.adjustedClose,
    maximumDrawdown: trough.adjustedClose / entry.adjustedClose - 1,
    elapsedCalendarDays: calendarDays(entry.date, points.at(-1)!.date),
  }
}

function firstIndexOnOrAfter(points: AdjustedPricePoint[], date: ISODate): number {
  let low = 0
  let high = points.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (points[middle].date < date) low = middle + 1
    else high = middle
  }
  return low
}

export function analyzeAccountBreakEven(
  values: ValuePoint[],
  capital: number,
): AccountBreakEvenObservation {
  if (values.length < 2) {
    throw new Error('Account break-even analysis requires at least two value observations.')
  }

  const isAtPrincipal = (value: number) => capital - value < 0.01
  if (isAtPrincipal(values[1].value)) {
    return { status: 'noInitialDrawdown', elapsedCalendarDays: 0 }
  }

  const recovery = values.find(
    (point, index) => index > 1 && isAtPrincipal(point.value),
  )
  if (recovery) {
    return {
      status: 'completed',
      elapsedCalendarDays: calendarDays(values[0].date, recovery.date),
    }
  }

  return {
    status: 'unrecovered',
    elapsedCalendarDays: calendarDays(values[0].date, values.at(-1)!.date),
  }
}

export function analyzeRecovery(series: PriceSeries, selectedEntryDate: ISODate): RecoveryAnalysis {
  const { points } = series
  if (points.length < 2) {
    throw new Error('Recovery analysis requires at least two price observations.')
  }

  const selectedIndex = firstIndexOnOrAfter(points, selectedEntryDate)
  if (selectedIndex >= points.length) {
    throw new Error('The selected entry is outside price coverage.')
  }

  // First future observation at or above each entry price. This monotonic stack
  // keeps the full-history scan linear instead of comparing every pair of dates.
  const nextAtOrAbove = new Array<number | undefined>(points.length)
  const stack: number[] = []
  for (let index = points.length - 1; index >= 0; index -= 1) {
    while (
      stack.length > 0
      && points[stack[stack.length - 1]].adjustedClose < points[index].adjustedClose
    ) {
      stack.pop()
    }
    nextAtOrAbove[index] = stack[stack.length - 1]
    stack.push(index)
  }

  let worstEntryIndex: number | undefined
  let worstRecoveryIndex: number | undefined
  let longestRecovery = -1
  let unrecoveredEntryCount = 0
  let minimumFuturePrice = Number.POSITIVE_INFINITY

  for (let index = points.length - 2; index >= 0; index -= 1) {
    minimumFuturePrice = Math.min(minimumFuturePrice, points[index + 1].adjustedClose)
    const recoveryIndex = nextAtOrAbove[index]

    if (recoveryIndex === undefined) {
      if (minimumFuturePrice < points[index].adjustedClose) unrecoveredEntryCount += 1
      continue
    }

    // A recovery on the next observation means the position never first went
    // underwater. Longer gaps necessarily contain a lower intervening price.
    if (recoveryIndex === index + 1) continue
    const elapsed = calendarDays(points[index].date, points[recoveryIndex].date)
    if (elapsed >= longestRecovery) {
      longestRecovery = elapsed
      worstEntryIndex = index
      worstRecoveryIndex = recoveryIndex
    }
  }

  return {
    selected: episodeAt(points, selectedIndex, nextAtOrAbove[selectedIndex]),
    worstCompleted: worstEntryIndex === undefined
      ? undefined
      : episodeAt(points, worstEntryIndex, worstRecoveryIndex),
    unrecoveredEntryCount,
    coverageEnd: points.at(-1)!.date,
  }
}
