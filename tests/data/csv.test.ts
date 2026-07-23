import { describe, expect, it } from 'vitest'
import { mapCsvToPriceSeries, previewCsv } from '../../src/data/csv'

describe('CSV import', () => {
  it('previews, maps, sorts, and keeps a valid file local', async () => {
    const file = new File(['when,total\n2020-01-03,102\n2020-01-02,101\n'], 'prices.csv', { type: 'text/csv' })
    const preview = await previewCsv(file)
    const result = mapCsvToPriceSeries(preview, {
      dateColumn: 'when',
      adjustedCloseColumn: 'total',
      symbol: 'vti',
      confirmedAdjustedUsd: true,
    })
    expect(result.metadata.source).toBe('imported')
    expect(result.metadata.symbol).toBe('VTI')
    expect(result.points.map((point) => point.date)).toEqual(['2020-01-02', '2020-01-03'])
  })

  it.each([
    ['date,price\nbad,100\n2020-01-02,101\n', 'invalid date'],
    ['date,price\n2020-01-01,0\n2020-01-02,101\n', 'invalid adjusted close'],
    ['date,price\n2020-01-01,100\n2020-01-01,101\n', 'Duplicate date'],
  ])('rejects malformed values', async (csv, message) => {
    const preview = await previewCsv(new File([csv], 'bad.csv'))
    expect(() => mapCsvToPriceSeries(preview, {
      dateColumn: 'date', adjustedCloseColumn: 'price', symbol: 'X', confirmedAdjustedUsd: true,
    })).toThrow(message)
  })

  it('requires distinct mappings, a symbol, confirmation, and two rows', async () => {
    const preview = await previewCsv(new File(['date,price\n2020-01-01,1\n'], 'one.csv'))
    const base = { dateColumn: 'date', adjustedCloseColumn: 'price', symbol: 'X', confirmedAdjustedUsd: true }
    expect(() => mapCsvToPriceSeries(preview, { ...base, symbol: '' })).toThrow('symbol')
    expect(() => mapCsvToPriceSeries(preview, { ...base, confirmedAdjustedUsd: false })).toThrow('Confirm')
    expect(() => mapCsvToPriceSeries(preview, { ...base, dateColumn: 'missing' })).toThrow('date column')
    expect(() => mapCsvToPriceSeries(preview, { ...base, adjustedCloseColumn: 'missing' })).toThrow('adjusted-close')
    expect(() => mapCsvToPriceSeries(preview, { ...base, adjustedCloseColumn: 'date' })).toThrow('different')
    expect(() => mapCsvToPriceSeries(preview, base)).toThrow('two')
  })

  it('rejects oversized and headerless CSV files', async () => {
    const oversized = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'huge.csv')
    await expect(previewCsv(oversized)).rejects.toThrow('10 MB')
    await expect(previewCsv(new File([''], 'empty.csv'))).rejects.toThrow()
  })
})
