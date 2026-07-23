import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const root = new URL('../', import.meta.url)
const rawDir = new URL('data/raw/', root)
const publicDir = new URL('public/data/', root)
const spyZip = new URL('spy-kaggle.zip', rawDir)
const snapshotEnd = '2025-11-27'
const retrievalDate = '2026-07-23'

await mkdir(rawDir, { recursive: true })
await mkdir(publicDir, { recursive: true })

async function download(url, output) {
  await exec('curl', ['-fsSL', url, '-o', output.pathname])
}

async function checksum(file) {
  const bytes = await readFile(file)
  return createHash('sha256').update(bytes).digest('hex')
}

await download(
  'https://www.kaggle.com/api/v1/datasets/download/aliraza948/spdr-s-and-p-500-etf-spy',
  spyZip,
)
const { stdout: spyRaw } = await exec('unzip', ['-p', spyZip.pathname, '_spy.csv'], {
  maxBuffer: 2_000_000,
})
const spyLines = spyRaw.trim().split(/\r?\n/)
const spyHeader = spyLines[0].split(',')
const dateIndex = spyHeader.indexOf('Date')
const adjustedIndex = spyHeader.indexOf('AdjClose')
const spyPoints = spyLines
  .slice(1)
  .map((line) => line.split(','))
  .filter((row) => row[dateIndex] <= snapshotEnd)
  .map((row) => ({ date: row[dateIndex], adjustedClose: Number(row[adjustedIndex]) }))
const spyOutput = new URL('spy.json', publicDir)
await writeFile(
  spyOutput,
  `${JSON.stringify({
    metadata: {
      symbol: 'SPY',
      name: 'SPDR S&P 500 ETF Trust',
      currency: 'USD',
      adjusted: true,
      source: 'bundled',
      snapshotDate: snapshotEnd,
      coverageStart: spyPoints[0].date,
      coverageEnd: spyPoints.at(-1).date,
    },
    points: spyPoints,
  })}\n`,
)

const treasuryPoints = []
const treasurySourceUrls = []
for (let year = 1994; year <= 2025; year += 1) {
  const url =
    'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml' +
    `?data=daily_treasury_yield_curve&field_tdr_date_value=${year}`
  treasurySourceUrls.push(url)
  const output = new URL(`treasury-${year}.xml`, rawDir)
  await download(url, output)
  const xml = await readFile(output, 'utf8')
  for (const entry of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const date = entry[1].match(/<d:NEW_DATE[^>]*>(\d{4}-\d{2}-\d{2})T/)?.[1]
    const rate = entry[1].match(/<d:BC_3MONTH[^>]*>([\d.]+)<\/d:BC_3MONTH>/)?.[1]
    if (date && rate && date <= snapshotEnd) {
      treasuryPoints.push({ date, annualRatePercent: Number(rate) })
    }
  }
}
treasuryPoints.sort((a, b) => a.date.localeCompare(b.date))
const treasuryOutput = new URL('treasury-3m.json', publicDir)
await writeFile(treasuryOutput, `${JSON.stringify(treasuryPoints)}\n`)

const manifest = {
  generatedAt: retrievalDate,
  datasets: [
    {
      id: 'spy-adjusted-prices',
      file: basename(spyOutput.pathname),
      sourceUrl: 'https://www.kaggle.com/datasets/aliraza948/spdr-s-and-p-500-etf-spy',
      retrievalDate,
      coverage: [spyPoints[0].date, spyPoints.at(-1).date],
      rows: spyPoints.length,
      license: 'CC BY 4.0',
      sha256: await checksum(spyOutput),
      sourceArchiveSha256: await checksum(spyZip),
    },
    {
      id: 'treasury-3-month-par-yield',
      file: basename(treasuryOutput.pathname),
      sourceUrl:
        'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve',
      retrievalDate,
      coverage: [treasuryPoints[0].date, treasuryPoints.at(-1).date],
      rows: treasuryPoints.length,
      license: 'U.S. federal government public data; see source terms',
      sha256: await checksum(treasuryOutput),
      sourceFeeds: treasurySourceUrls,
    },
  ],
}
await writeFile(new URL('manifest.json', publicDir), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(
  `Normalized ${spyPoints.length} SPY prices and ${treasuryPoints.length} Treasury rates.`,
)
