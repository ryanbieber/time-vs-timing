import Papa from 'papaparse'
import { isValid, parseISO } from 'date-fns'
import type { AdjustedPricePoint, ISODate, PriceSeries } from '../engine/types'

export const MAX_CSV_BYTES = 10 * 1024 * 1024
export const MAX_CSV_ROWS = 50_000

export interface CsvPreview {
  fields: string[]
  rows: Record<string, string>[]
}

export interface CsvMapping {
  dateColumn: string
  adjustedCloseColumn: string
  symbol: string
  confirmedAdjustedUsd: boolean
}

const exactIsoDate = /^\d{4}-\d{2}-\d{2}$/

export function previewCsv(file: File): Promise<CsvPreview> {
  if (file.size > MAX_CSV_BYTES) {
    return Promise.reject(new Error('CSV files must be 10 MB or smaller.'))
  }
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim(),
      complete: ({ data, errors, meta }) => {
        if (errors.length) {
          reject(new Error(`CSV parsing failed: ${errors[0].message}`))
          return
        }
        if (data.length > MAX_CSV_ROWS) {
          reject(new Error('CSV files may contain at most 50,000 data rows.'))
          return
        }
        if (!meta.fields?.length) {
          reject(new Error('The CSV must have a header row.'))
          return
        }
        resolve({ fields: meta.fields, rows: data })
      },
      error: (error) => reject(error),
    })
  })
}

export function mapCsvToPriceSeries(preview: CsvPreview, mapping: CsvMapping): PriceSeries {
  const symbol = mapping.symbol.trim().toUpperCase()
  if (!symbol) throw new Error('Enter a symbol for this price series.')
  if (!mapping.confirmedAdjustedUsd) {
    throw new Error('Confirm that prices are USD and adjusted for dividends and splits.')
  }
  if (!preview.fields.includes(mapping.dateColumn)) throw new Error('Choose a valid date column.')
  if (!preview.fields.includes(mapping.adjustedCloseColumn)) {
    throw new Error('Choose a valid adjusted-close column.')
  }
  if (mapping.dateColumn === mapping.adjustedCloseColumn) {
    throw new Error('Date and adjusted close must use different columns.')
  }
  const seen = new Set<string>()
  const points: AdjustedPricePoint[] = preview.rows.map((row, index) => {
    const dateText = row[mapping.dateColumn]?.trim()
    const priceText = row[mapping.adjustedCloseColumn]?.trim()
    const parsedDate = parseISO(dateText)
    const price = Number(priceText)
    if (!exactIsoDate.test(dateText) || !isValid(parsedDate)) {
      throw new Error(`Row ${index + 2} has an invalid date; use YYYY-MM-DD.`)
    }
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`Row ${index + 2} has an invalid adjusted close.`)
    }
    if (seen.has(dateText)) throw new Error(`Duplicate date found: ${dateText}.`)
    seen.add(dateText)
    return { date: dateText as ISODate, adjustedClose: price }
  })
  if (points.length < 2) throw new Error('At least two valid price rows are required.')
  points.sort((a, b) => a.date.localeCompare(b.date))
  return {
    metadata: {
      symbol,
      name: `${symbol} imported adjusted prices`,
      currency: 'USD',
      adjusted: true,
      source: 'imported',
      coverageStart: points[0].date,
      coverageEnd: points.at(-1)!.date,
    },
    points,
  }
}
