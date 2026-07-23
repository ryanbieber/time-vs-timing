import { useEffect, useMemo, useState } from 'react'
import { Link, Route, Routes, useSearchParams } from 'react-router-dom'
import { format, formatDuration, intervalToDuration, subYears } from 'date-fns'
import type { EChartsCoreOption } from 'echarts/core'
import { Chart } from './components/Chart'
import { mapCsvToPriceSeries, previewCsv, type CsvPreview } from './data/csv'
import { loadBundledData } from './data/load'
import { runBacktest } from './engine/backtest'
import { analyzeRecovery } from './engine/recovery'
import type {
  BacktestResult,
  BreakEvenDistribution,
  ISODate,
  PriceSeries,
  PurchaseCount,
  RecoveryAnalysis,
  RecoveryEpisode,
  RollingResult,
  Scenario,
  StrategyMetrics,
  TreasuryRatePoint,
} from './engine/types'
import './App.css'

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})
const moneyPrecise = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const percent = new Intl.NumberFormat('en-US', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })

const purchasePresets: PurchaseCount[] = [3, 6, 12, 24, 36]
const defaultScenario: Scenario = {
  symbol: 'SPY',
  capital: 10_000,
  startDate: '2015-11-26',
  endDate: '2025-11-26',
  purchaseCount: 12,
}

function parseScenario(params: URLSearchParams): Scenario {
  const purchaseCount = Number(params.get('purchases'))
  const capital = Number(params.get('capital'))
  const start = params.get('start')
  const end = params.get('end')
  return {
    symbol: 'SPY',
    capital: Number.isFinite(capital) && capital > 0 ? capital : defaultScenario.capital,
    startDate: (start?.match(/^\d{4}-\d{2}-\d{2}$/) ? start : defaultScenario.startDate) as ISODate,
    endDate: (end?.match(/^\d{4}-\d{2}-\d{2}$/) ? end : defaultScenario.endDate) as ISODate,
    purchaseCount: purchasePresets.includes(purchaseCount as PurchaseCount)
      ? (purchaseCount as PurchaseCount)
      : defaultScenario.purchaseCount,
  }
}

function Spinner() {
  return (
    <div className="loading" role="status">
      <span aria-hidden="true" />
      Loading the historical record…
    </div>
  )
}

function ErrorNotice({ children }: { children: string }) {
  return (
    <div className="notice error" role="alert">
      <strong>We couldn’t run that comparison.</strong>
      <span>{children}</span>
    </div>
  )
}

function LazyDetails({
  summary,
  children,
}: {
  summary: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <details
      className="accessible-data"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{summary}</summary>
      {open && children}
    </details>
  )
}

function Header() {
  return (
    <header className="site-header">
      <Link className="brand" to="/" aria-label="Time versus Timing home">
        <span className="brand-mark" aria-hidden="true">
          T<span>/</span>T
        </span>
        <span>Time vs Timing</span>
      </Link>
      <nav aria-label="Primary navigation">
        <Link to="/">Compare</Link>
        <Link to="/methodology">Methodology</Link>
        <a href="https://github.com/ryanbieber/time-vs-timing">Source</a>
      </nav>
    </header>
  )
}

function CsvImporter({
  onImport,
}: {
  onImport: (series: PriceSeries) => void
}) {
  const [preview, setPreview] = useState<CsvPreview>()
  const [fileName, setFileName] = useState('')
  const [dateColumn, setDateColumn] = useState('')
  const [priceColumn, setPriceColumn] = useState('')
  const [symbol, setSymbol] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState('')

  async function chooseFile(file?: File) {
    if (!file) return
    setError('')
    try {
      const next = await previewCsv(file)
      setPreview(next)
      setFileName(file.name)
      setDateColumn(next.fields.find((field) => /date/i.test(field)) ?? '')
      setPriceColumn(next.fields.find((field) => /adj.*close|adjusted/i.test(field)) ?? '')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'CSV import failed.')
    }
  }

  function finishImport() {
    if (!preview) return
    try {
      onImport(
        mapCsvToPriceSeries(preview, {
          dateColumn,
          adjustedCloseColumn: priceColumn,
          symbol,
          confirmedAdjustedUsd: confirmed,
        }),
      )
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'CSV import failed.')
    }
  }

  return (
    <div className="importer">
      <label className="file-picker">
        <span>{fileName || 'Choose a CSV file'}</span>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => void chooseFile(event.target.files?.[0])}
        />
      </label>
      <p className="field-hint">Up to 50,000 rows and 10 MB. The file stays in this browser tab.</p>
      {preview && (
        <div className="mapping-grid">
          <label>
            Symbol
            <input value={symbol} onChange={(event) => setSymbol(event.target.value)} placeholder="e.g. VTI" />
          </label>
          <label>
            Date column
            <select value={dateColumn} onChange={(event) => setDateColumn(event.target.value)}>
              <option value="">Select a column</option>
              {preview.fields.map((field) => <option key={field}>{field}</option>)}
            </select>
          </label>
          <label>
            Adjusted close column
            <select value={priceColumn} onChange={(event) => setPriceColumn(event.target.value)}>
              <option value="">Select a column</option>
              {preview.fields.map((field) => <option key={field}>{field}</option>)}
            </select>
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>These are USD prices adjusted for dividends and splits.</span>
          </label>
          <button type="button" className="secondary-button" onClick={finishImport}>
            Use this dataset
          </button>
        </div>
      )}
      {error && <ErrorNotice>{error}</ErrorNotice>}
    </div>
  )
}

function Controls({
  draft,
  series,
  imported,
  onChange,
  onRun,
  onImport,
  onReset,
}: {
  draft: Scenario
  series: PriceSeries
  imported: boolean
  onChange: (scenario: Scenario) => void
  onRun: () => void
  onImport: (series: PriceSeries) => void
  onReset: () => void
}) {
  return (
    <section className="controls-card" aria-labelledby="controls-title">
      <div className="section-heading compact">
        <div>
          <span className="eyebrow">Build a fair comparison</span>
          <h2 id="controls-title">Your investment scenario</h2>
        </div>
        <div className="dataset-switch" aria-label="Dataset">
          <button type="button" className={!imported ? 'active' : ''} onClick={onReset}>Bundled SPY</button>
          <span aria-hidden="true">or</span>
          <span className={imported ? 'active-label' : ''}>Your CSV</span>
        </div>
      </div>
      <div className="controls-grid">
        <label>
          Starting capital
          <div className="money-input">
            <span aria-hidden="true">$</span>
            <input
              inputMode="decimal"
              type="number"
              min="1"
              step="100"
              value={draft.capital}
              onChange={(event) => onChange({ ...draft, capital: Number(event.target.value) })}
            />
          </div>
        </label>
        <label>
          Start date
          <input
            type="date"
            min={series.metadata.coverageStart}
            max={series.metadata.coverageEnd}
            value={draft.startDate}
            onChange={(event) => onChange({ ...draft, startDate: event.target.value as ISODate })}
          />
        </label>
        <label>
          End date
          <input
            type="date"
            min={series.metadata.coverageStart}
            max={series.metadata.coverageEnd}
            value={draft.endDate}
            onChange={(event) => onChange({ ...draft, endDate: event.target.value as ISODate })}
          />
        </label>
        <fieldset>
          <legend>Monthly purchases</legend>
          <div className="preset-group">
            {purchasePresets.map((count) => (
              <button
                type="button"
                key={count}
                aria-pressed={draft.purchaseCount === count}
                onClick={() => onChange({ ...draft, purchaseCount: count })}
              >
                {count}
              </button>
            ))}
          </div>
        </fieldset>
      </div>
      <div className="control-footer">
        <p>
          Testing <strong>{series.metadata.symbol}</strong> · adjusted total-return units · shared coverage{' '}
          {series.metadata.coverageStart} to {series.metadata.coverageEnd}
        </p>
        <button type="button" className="primary-button" onClick={onRun}>
          Run comparison <span aria-hidden="true">→</span>
        </button>
      </div>
      <details className="import-disclosure">
        <summary>Analyze another ticker with a local CSV</summary>
        <CsvImporter onImport={onImport} />
      </details>
    </section>
  )
}

function WinnerCard({ result }: { result: BacktestResult }) {
  const winner = result.difference.winner
  const winnerName = winner === 'lumpSum' ? 'Investing now' : winner === 'dca' ? 'DCA' : 'Neither strategy'
  const otherName = winner === 'lumpSum' ? 'DCA' : 'investing now'
  return (
    <section className={`winner-card ${winner}`} aria-labelledby="winner-title">
      <div>
        <span className="result-kicker">
          <span className="result-symbol" aria-hidden="true">{winner === 'tie' ? '=' : '↑'}</span>
          Result for this window
        </span>
        <h2 id="winner-title">{winnerName} {winner === 'tie' ? 'finished in a tie.' : 'finished ahead.'}</h2>
        <p>
          {winner === 'tie'
            ? 'The ending values were within one cent of each other.'
            : `${winnerName} ended ${moneyPrecise.format(Math.abs(result.difference.dollars))} above ${otherName}, a ${Math.abs(result.difference.percentagePoints).toFixed(2)} percentage-point return advantage.`}
        </p>
      </div>
      <div className="winner-values" aria-label="Ending values">
        <div>
          <span>Invest now</span>
          <strong>{money.format(result.lumpSum.metrics.endingValue)}</strong>
        </div>
        <div>
          <span>DCA over {result.scenario.purchaseCount} months</span>
          <strong>{money.format(result.dca.metrics.endingValue)}</strong>
        </div>
      </div>
    </section>
  )
}

function AccountValueSection({ result }: { result: BacktestResult }) {
  const lumpValues = new Map(result.lumpSum.values.map((point) => [point.date, point.value]))
  const dcaValues = new Map(result.dca.values.map((point) => [point.date, point.value]))
  const purchaseDates = new Set(result.dca.purchases.map((purchase) => purchase.executionDate))
  const option: EChartsCoreOption = {
    animation: false,
    color: ['#172b4d', '#e06d3c', '#e06d3c'],
    grid: { left: 14, right: 16, top: 42, bottom: 24, containLabel: true },
    tooltip: { trigger: 'axis', valueFormatter: (value) => moneyPrecise.format(Number(value)) },
    legend: { top: 0, left: 0 },
    xAxis: { type: 'category', data: result.lumpSum.values.map((point) => point.date), axisLabel: { hideOverlap: true } },
    yAxis: { type: 'value', axisLabel: { formatter: (value: number) => `$${Math.round(value / 1000)}k` }, splitLine: { lineStyle: { color: '#e7e2d7' } } },
    series: [
      { name: 'Invest now', type: 'line', symbol: 'none', data: [...lumpValues.values()], lineStyle: { width: 2.5 } },
      { name: 'DCA', type: 'line', symbol: 'none', data: [...dcaValues.values()], lineStyle: { width: 2.5 } },
      {
        name: 'DCA purchases',
        type: 'scatter',
        symbolSize: 8,
        data: result.dca.values.map((point) => purchaseDates.has(point.date) ? point.value : '-'),
      },
    ],
  }
  return (
    <section className="content-section" aria-labelledby="growth-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">The journey</span>
          <h2 id="growth-title">How each account grew</h2>
        </div>
        <p>Dots mark each DCA purchase. Both lines include remaining cash.</p>
      </div>
      <Chart option={option} label="Account values over time for investing now and dollar-cost averaging, with DCA purchase markers." />
      <LazyDetails summary="View chart data as a table">
        <div className="table-scroll">
          <table>
            <thead><tr><th>Date</th><th>Invest now</th><th>DCA</th><th>Purchase?</th></tr></thead>
            <tbody>
              {result.lumpSum.values.map((point, index) => (
                <tr key={point.date}>
                  <td>{point.date}</td><td>{moneyPrecise.format(point.value)}</td>
                  <td>{moneyPrecise.format(result.dca.values[index].value)}</td>
                  <td>{purchaseDates.has(point.date) ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </LazyDetails>
    </section>
  )
}

const metricRows: Array<{
  label: string
  key: keyof StrategyMetrics
  format: (value: number) => string
}> = [
  { label: 'Ending value', key: 'endingValue', format: (value) => moneyPrecise.format(value) },
  { label: 'Profit', key: 'profit', format: (value) => moneyPrecise.format(value) },
  { label: 'Total return', key: 'totalReturn', format: percent.format },
  { label: 'CAGR', key: 'cagr', format: percent.format },
  { label: 'Maximum drawdown', key: 'maximumDrawdown', format: percent.format },
  { label: 'Annualized volatility', key: 'annualizedVolatility', format: percent.format },
  { label: 'Average equity exposure', key: 'averageEquityExposure', format: percent.format },
  { label: 'Cash interest', key: 'totalCashInterest', format: (value) => moneyPrecise.format(value) },
  { label: 'Average purchase price', key: 'averagePurchasePrice', format: (value) => moneyPrecise.format(value) },
]

function MetricsTable({ result }: { result: BacktestResult }) {
  return (
    <section className="content-section" aria-labelledby="metrics-title">
      <div className="section-heading">
        <div><span className="eyebrow">Side by side</span><h2 id="metrics-title">The full scorecard</h2></div>
        <p>Returns use adjusted closes and include interest on waiting cash.</p>
      </div>
      <div className="metric-table-wrap">
        <table className="metric-table">
          <thead><tr><th>Metric</th><th>Invest now</th><th>DCA</th><th>Difference</th></tr></thead>
          <tbody>
            {metricRows.map((row) => {
              const lump = result.lumpSum.metrics[row.key]
              const dca = result.dca.metrics[row.key]
              return (
                <tr key={row.key}>
                  <th scope="row">{row.label}</th>
                  <td>{row.format(lump)}</td>
                  <td>{row.format(dca)}</td>
                  <td>{row.format(lump - dca)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {result.adjustments.length > 0 && (
        <div className="adjustment-note">
          <strong>Date adjustments</strong>
          <ul>
            {result.adjustments.map((item, index) => (
              <li key={`${item.boundary}-${item.requested}-${index}`}>
                {item.boundary === 'purchase' ? 'Purchase' : item.boundary}: {item.requested} → {item.actual}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function recoveryDuration(episode: RecoveryEpisode, coverageEnd: ISODate): string {
  const end = episode.recoveryDate ?? coverageEnd
  return formatDuration(intervalToDuration({
    start: new Date(`${episode.entryDate}T00:00:00Z`),
    end: new Date(`${end}T00:00:00Z`),
  }), { format: ['years', 'months', 'days'] }) || 'less than one day'
}

function RecoveryDetails({
  episode,
  capital,
  coverageEnd,
}: {
  episode: RecoveryEpisode
  capital: number
  coverageEnd: ISODate
}) {
  const troughValue = capital * (1 + episode.maximumDrawdown)
  return (
    <dl className="recovery-details">
      <div><dt>Entry</dt><dd>{episode.entryDate}</dd></div>
      <div>
        <dt>Lowest point</dt>
        <dd>
          {episode.troughDate} · {moneyPrecise.format(troughValue)} ({percent.format(episode.maximumDrawdown)})
        </dd>
      </div>
      <div>
        <dt>Break-even</dt>
        <dd>
          {episode.status === 'noInitialDrawdown'
            ? 'No initial loss'
            : episode.recoveryDate ?? `Not by ${coverageEnd}`}
        </dd>
      </div>
      <div>
        <dt>{episode.status === 'unrecovered' ? 'Time observed' : 'Time underwater'}</dt>
        <dd>{episode.status === 'noInitialDrawdown' ? '0 days' : recoveryDuration(episode, coverageEnd)}</dd>
      </div>
    </dl>
  )
}

function RecoverySection({
  result,
  recovery,
  rolling,
  symbol,
}: {
  result: BacktestResult
  recovery: RecoveryAnalysis
  rolling?: RollingResult
  symbol: string
}) {
  const selected = recovery.selected
  const recoveredAfterSelectedWindow = selected.recoveryDate !== undefined
    && selected.recoveryDate > result.effectiveEndDate
  const selectedSummary = selected.status === 'completed'
    ? `It first reached the original ${moneyPrecise.format(result.scenario.capital)} again on ${selected.recoveryDate}, after ${recoveryDuration(selected, recovery.coverageEnd)}${recoveredAfterSelectedWindow ? `—beyond your selected end date of ${result.effectiveEndDate}` : ''}.`
    : selected.status === 'unrecovered'
      ? `It was still below the original ${moneyPrecise.format(result.scenario.capital)} when this dataset ended on ${recovery.coverageEnd}.`
      : 'It was at or above the entry value on the next session, so its initial time underwater was zero.'
  const worst = recovery.worstCompleted

  return (
    <section className="content-section recovery-section" aria-labelledby="recovery-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">The rough-entry test</span>
          <h2 id="recovery-title">How long could you be underwater?</h2>
        </div>
        <p>Break-even is the first later session when the invest-now account regains its starting value.</p>
      </div>
      <div className="recovery-grid">
        <article>
          <span className="card-label">Your selected start</span>
          <h3>What happened after investing on {selected.entryDate}</h3>
          <p className="recovery-summary">{selectedSummary}</p>
          <RecoveryDetails
            episode={selected}
            capital={result.scenario.capital}
            coverageEnd={recovery.coverageEnd}
          />
        </article>
        <article className="stress-card">
          <span className="card-label">Longest completed recovery</span>
          {worst ? (
            <>
              <h3>The hardest historical {symbol} entry was {worst.entryDate}</h3>
              <p className="recovery-summary">
                Break-even arrived {recoveryDuration(worst, recovery.coverageEnd)} later. At the bottom, {percent.format(1 + worst.maximumDrawdown)} of the initial investment remained.
              </p>
              <RecoveryDetails
                episode={worst}
                capital={result.scenario.capital}
                coverageEnd={recovery.coverageEnd}
              />
            </>
          ) : (
            <>
              <h3>No completed underwater period exists in this dataset.</h3>
              <p className="recovery-summary">There is not enough history to identify a completed recovery.</p>
            </>
          )}
        </article>
      </div>
      <p className="recovery-note">
        This uses dividend- and split-adjusted prices, so break-even includes reinvested distributions. It is historical hindsight, not a prediction.
        {recovery.unrecoveredEntryCount > 0 && ` ${number.format(recovery.unrecoveredEntryCount)} late entry dates fell below their entry value but had not recovered by the snapshot end; they are not mislabeled as completed recoveries.`}
      </p>
      {rolling && <BreakEvenDistributionSection result={result} rolling={rolling} />}
    </section>
  )
}

function breakEvenAverageLabel(distribution: BreakEvenDistribution): string {
  return distribution.unrecoveredCount > 0
    ? 'Average across resolved starts'
    : 'Average across all starts'
}

function days(value: number | null): string {
  return value === null ? 'Not available' : `${value.toFixed(1)} days`
}

function BreakEvenSummaryCard({
  distribution,
  name,
}: {
  distribution: BreakEvenDistribution
  name: string
}) {
  return (
    <article>
      <span>{name}</span>
      <strong>{days(distribution.averageResolvedDays)}</strong>
      <small>{breakEvenAverageLabel(distribution)}</small>
      <dl>
        <div><dt>Average after an initial loss</dt><dd>{days(distribution.averageRecoveryDays)}</dd></div>
        <div><dt>Median after an initial loss</dt><dd>{days(distribution.medianRecoveryDays)}</dd></div>
        <div>
          <dt>No initial drawdown</dt>
          <dd>{percent.format(distribution.noInitialDrawdownCount / distribution.totalCount)}</dd>
        </div>
        <div><dt>Unrecovered</dt><dd>{number.format(distribution.unrecoveredCount)}</dd></div>
      </dl>
    </article>
  )
}

function BreakEvenDistributionSection({
  result,
  rolling,
}: {
  result: BacktestResult
  rolling: RollingResult
}) {
  const lumpSum = rolling.breakEven.lumpSum
  const dca = rolling.breakEven.dca
  const option: EChartsCoreOption = {
    animation: false,
    color: ['#172b4d', '#e06d3c'],
    grid: { left: 12, right: 12, top: 46, bottom: 62, containLabel: true },
    tooltip: { trigger: 'axis' },
    legend: { top: 0, left: 0 },
    xAxis: {
      type: 'category',
      data: lumpSum.histogram.map((bin) => bin.label),
      axisLabel: { interval: 0, rotate: 32, fontSize: 10 },
    },
    yAxis: {
      type: 'value',
      name: 'Starting dates',
      splitLine: { lineStyle: { color: '#e7e2d7' } },
    },
    series: [
      {
        name: 'Invest fully',
        type: 'bar',
        data: lumpSum.histogram.map((bin) => bin.count),
        itemStyle: { borderRadius: [3, 3, 0, 0] },
      },
      {
        name: 'DCA',
        type: 'bar',
        data: dca.histogram.map((bin) => bin.count),
        itemStyle: {
          borderRadius: [3, 3, 0, 0],
          decal: { symbol: 'rect', dashArrayX: [2, 2], dashArrayY: [5, 3] },
        },
      },
    ],
  }

  return (
    <div className="break-even-distribution">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Every outcome</span>
          <h3>Distribution of all break-even times</h3>
        </div>
        <p>
          {number.format(rolling.points.length)} complete windows with the same horizon and {result.scenario.purchaseCount}-purchase DCA schedule.
        </p>
      </div>
      <div className="break-even-summary">
        <BreakEvenSummaryCard distribution={lumpSum} name="Invest fully" />
        <BreakEvenSummaryCard distribution={dca} name="DCA" />
      </div>
      <div className="break-even-chart">
        <Chart
          option={option}
          label="Histogram comparing break-even times for investing fully and dollar-cost averaging across every historical starting date."
          height={340}
        />
      </div>
      <LazyDetails summary="View break-even distribution as a table">
        <div className="table-scroll">
          <table aria-label="Break-even distribution data">
            <thead>
              <tr><th>Break-even time</th><th>Invest fully</th><th>DCA</th></tr>
            </thead>
            <tbody>
              {lumpSum.histogram.map((bin, index) => (
                <tr key={bin.label}>
                  <th scope="row">{bin.label}</th>
                  <td>{number.format(bin.count)}</td>
                  <td>{number.format(dca.histogram[index].count)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">All starts</th>
                <td>{number.format(lumpSum.totalCount)}</td>
                <td>{number.format(dca.totalCount)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </LazyDetails>
      <p className="recovery-note">
        Zero days means the account was at or above principal on the next observed session. A start must fall at least one cent below principal to count as underwater. Unrecovered windows stay in their own bucket and are excluded from averages.
      </p>
    </div>
  )
}

function RollingSection({ rolling }: { rolling: RollingResult }) {
  const histogramOption: EChartsCoreOption = {
    animation: false,
    color: ['#d76a3b'],
    grid: { left: 12, right: 10, top: 12, bottom: 18, containLabel: true },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: rolling.histogram.map((bin) => `${bin.from.toFixed(1)} to ${bin.to.toFixed(1)}`),
      axisLabel: { interval: 2 },
    },
    yAxis: { type: 'value', name: 'Windows', splitLine: { lineStyle: { color: '#e7e2d7' } } },
    series: [{ name: 'Historical windows', type: 'bar', data: rolling.histogram.map((bin) => bin.count) }],
  }
  const timelineOption: EChartsCoreOption = {
    animation: false,
    color: ['#74829a', '#d76a3b'],
    grid: { left: 12, right: 12, top: 18, bottom: 20, containLabel: true },
    tooltip: { trigger: 'axis', valueFormatter: (value) => `${Number(value).toFixed(2)} pp` },
    xAxis: { type: 'category', data: rolling.points.map((point) => point.startDate), axisLabel: { hideOverlap: true } },
    yAxis: { type: 'value', axisLabel: { formatter: (value: number) => `${value.toFixed(0)} pp` }, splitLine: { lineStyle: { color: '#e7e2d7' } } },
    series: [
      {
        name: 'Invest-now return advantage',
        type: 'line',
        symbol: 'none',
        data: rolling.points.map((point) => point.returnDifference),
        markLine: { silent: true, symbol: 'none', lineStyle: { color: '#6a706c' }, data: [{ yAxis: 0 }] },
      },
      {
        name: 'Selected window',
        type: 'scatter',
        symbolSize: 12,
        data: rolling.points.map((point) => point.selected ? point.returnDifference : '-'),
      },
    ],
  }
  return (
    <section className="rolling-section" aria-labelledby="rolling-title">
      <div className="section-heading">
        <div><span className="eyebrow">Zoom out</span><h2 id="rolling-title">Every historical starting point</h2></div>
        <p>{number.format(rolling.points.length)} complete windows with the same horizon and purchase schedule.</p>
      </div>
      <div className="rolling-stats">
        <div><span>Invest-now wins</span><strong>{percent.format(rolling.lumpSumWinRate)}</strong></div>
        <div><span>DCA wins</span><strong>{percent.format(rolling.dcaWinRate)}</strong></div>
        <div><span>Ties</span><strong>{percent.format(rolling.tieRate)}</strong></div>
        <div><span>Median advantage</span><strong>{rolling.medianReturnDifference.toFixed(1)} pp</strong></div>
      </div>
      <div className="rolling-grid">
        <article className="chart-card">
          <h3>How often each advantage occurred</h3>
          <p>Return difference: invest now minus DCA.</p>
          <Chart option={histogramOption} label="Histogram of return differences across all historical windows." height={280} />
        </article>
        <article className="chart-card">
          <h3>Advantage by start date</h3>
          <p>Above zero favors investing now; below zero favors DCA.</p>
          <Chart option={timelineOption} label="Timeline of return differences by historical start date; the selected window is highlighted." height={280} />
        </article>
      </div>
      <div className="range-strip">
        <div><span>10th percentile</span><strong>{rolling.p10ReturnDifference.toFixed(1)} pp</strong></div>
        <div><span>Median</span><strong>{rolling.medianReturnDifference.toFixed(1)} pp</strong></div>
        <div><span>90th percentile</span><strong>{rolling.p90ReturnDifference.toFixed(1)} pp</strong></div>
        <div><span>Worst start for investing now</span><strong>{rolling.worstStart.startDate}</strong></div>
        <div><span>Best start for investing now</span><strong>{rolling.bestStart.startDate}</strong></div>
      </div>
      <LazyDetails summary="View rolling results as a table">
        <div className="table-scroll">
          <table>
            <thead><tr><th>Start</th><th>End</th><th>Winner</th><th>Dollar difference</th><th>Return difference</th></tr></thead>
            <tbody>
              {rolling.points.map((point) => (
                <tr key={point.startDate} className={point.selected ? 'selected-row' : ''}>
                  <td>{point.startDate}{point.selected ? ' (selected)' : ''}</td><td>{point.endDate}</td>
                  <td>{point.winner === 'lumpSum' ? 'Invest now' : point.winner === 'dca' ? 'DCA' : 'Tie'}</td>
                  <td>{moneyPrecise.format(point.dollarDifference)}</td><td>{point.returnDifference.toFixed(2)} pp</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </LazyDetails>
    </section>
  )
}

function MeaningSection({ result, rolling }: { result: BacktestResult; rolling: RollingResult }) {
  const currentWinner = result.difference.winner
  return (
    <section className="meaning-section" aria-labelledby="meaning-title">
      <span className="eyebrow">What this means</span>
      <h2 id="meaning-title">This result is evidence, not a forecast.</h2>
      <div className="meaning-grid">
        <p>
          In your chosen window, {currentWinner === 'tie' ? 'the strategies tied' : currentWinner === 'lumpSum' ? 'investing immediately won' : 'DCA won'} because of the path prices took while DCA still held cash. That path cannot be known in advance.
        </p>
        <p>
          Across all comparable windows, investing now won {percent.format(rolling.lumpSumWinRate)} of the time and DCA won {percent.format(rolling.dcaWinRate)}. DCA can reduce early timing regret, but it also delays market exposure.
        </p>
      </div>
    </section>
  )
}

function MethodologyTeaser() {
  return (
    <section className="method-teaser">
      <div>
        <span className="eyebrow">Read the fine print</span>
        <h2>Transparent assumptions, reproducible math.</h2>
        <p>No forecasts, optimization, hidden fees, or live APIs. See every formula, limitation, and source.</p>
      </div>
      <Link className="secondary-button" to="/methodology">Explore methodology →</Link>
    </section>
  )
}

function Dashboard() {
  const [params, setParams] = useSearchParams()
  const [bundled, setBundled] = useState<PriceSeries>()
  const [series, setSeries] = useState<PriceSeries>()
  const [rates, setRates] = useState<TreasuryRatePoint[]>()
  const [draft, setDraft] = useState<Scenario>(() => parseScenario(params))
  const [scenario, setScenario] = useState<Scenario>(() => parseScenario(params))
  const [error, setError] = useState('')
  const [shareMessage, setShareMessage] = useState('')
  const [rolling, setRolling] = useState<RollingResult>()
  const [rollingError, setRollingError] = useState('')

  useEffect(() => {
    void loadBundledData()
      .then((data) => {
        setBundled(data.prices)
        setSeries(data.prices)
        setRates(data.rates)
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : 'Data loading failed.'))
  }, [])

  const calculation = useMemo(() => {
    if (!series || !rates) return { result: undefined, error: '' }
    try {
      return { result: runBacktest(scenario, series, rates), error: '' }
    } catch (caught) {
      return {
        result: undefined,
        error: caught instanceof Error ? caught.message : 'Backtest failed.',
      }
    }
  }, [scenario, series, rates])
  const result = calculation.result
  const recovery = useMemo(() => {
    if (!result || !series || !rates) return undefined
    const firstRateDate = rates[0].date
    const lastRateDate = rates.at(-1)!.date
    const sharedPoints = series.points.filter(
      (point) => point.date >= firstRateDate && point.date <= lastRateDate,
    )
    return analyzeRecovery({
      metadata: {
        ...series.metadata,
        coverageStart: sharedPoints[0].date,
        coverageEnd: sharedPoints.at(-1)!.date,
      },
      points: sharedPoints,
    }, result.effectiveStartDate)
  }, [result, series, rates])

  useEffect(() => {
    if (!result || !series || !rates) {
      setRolling(undefined)
      return
    }
    setRolling(undefined)
    setRollingError('')
    const worker = new Worker(new URL('./workers/rolling.worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.onmessage = (event: MessageEvent<{ result?: RollingResult; error?: string }>) => {
      if (event.data.result) setRolling(event.data.result)
      if (event.data.error) setRollingError(event.data.error)
      worker.terminate()
    }
    worker.postMessage({ scenario, prices: series, rates })
    return () => worker.terminate()
  }, [result, scenario, series, rates])

  function run() {
    setScenario({ ...draft, symbol: series!.metadata.symbol })
    if (series?.metadata.source === 'bundled') {
      setParams({
        capital: String(draft.capital),
        start: draft.startDate,
        end: draft.endDate,
        purchases: String(draft.purchaseCount),
      })
    }
  }

  function useImported(imported: PriceSeries) {
    const endDate = imported.metadata.coverageEnd
    const tenYearsEarlier = format(subYears(new Date(`${endDate}T12:00:00`), 10), 'yyyy-MM-dd') as ISODate
    const startDate = tenYearsEarlier > imported.metadata.coverageStart ? tenYearsEarlier : imported.metadata.coverageStart
    const next = { ...draft, symbol: imported.metadata.symbol, startDate, endDate }
    setSeries(imported)
    setDraft(next)
    setScenario(next)
    setParams({})
  }

  function resetBundled() {
    if (!bundled) return
    setSeries(bundled)
    setDraft(defaultScenario)
    setScenario(defaultScenario)
    setParams({})
  }

  async function share() {
    await navigator.clipboard.writeText(window.location.href)
    setShareMessage('Link copied')
    window.setTimeout(() => setShareMessage(''), 2000)
  }

  if (!series || !rates) return <Spinner />

  return (
    <>
      <main>
        <section className="hero-section">
          <div className="hero-copy">
            <span className="eyebrow">Historical investing lab</span>
            <h1>Time in the market—or timing your way in?</h1>
            <p className="hero-lede">
              Compare investing all at once with easing in monthly. Then test the same choice across every historical starting date—not just the one that tells the neatest story.
            </p>
            <div className="snapshot-badge">
              <span className="pulse" aria-hidden="true" />
              SPY snapshot through <strong>Nov 27, 2025</strong>
            </div>
          </div>
          <div className="hero-visual" aria-hidden="true">
            <div className="visual-label left">Invest now</div><div className="visual-label right">DCA</div>
            <svg viewBox="0 0 540 250">
              <path className="grid-line" d="M0 50H540M0 100H540M0 150H540M0 200H540" />
              <path className="hero-line navy" d="M0 210 C55 196,76 215,120 176 S194 160,224 138 S290 156,327 103 S390 116,425 63 S487 73,540 20" />
              <path className="hero-line coral" d="M0 218 C62 213,82 210,122 194 S192 178,225 168 S296 165,330 130 S392 135,430 91 S492 96,540 49" />
              {[0, 1, 2, 3, 4, 5].map((index) => <circle key={index} cx={26 + index * 65} cy={210 - index * 14} r="5" />)}
            </svg>
          </div>
        </section>

        <Controls
          draft={draft}
          series={series}
          imported={series.metadata.source === 'imported'}
          onChange={setDraft}
          onRun={run}
          onImport={useImported}
          onReset={resetBundled}
        />
        <div className="share-row">
          <span>All calculations run locally in your browser.</span>
          <button
            type="button"
            className="text-button"
            disabled={series.metadata.source === 'imported'}
            onClick={() => void share()}
            title={series.metadata.source === 'imported' ? 'Imported files are not persisted, so they cannot be shared.' : undefined}
          >
            {shareMessage || 'Copy share link'}
          </button>
        </div>
        {(error || calculation.error) && <ErrorNotice>{error || calculation.error}</ErrorNotice>}
        {result && (
          <div className="results" aria-live="polite">
            <WinnerCard result={result} />
            <AccountValueSection result={result} />
            <MetricsTable result={result} />
            {recovery && (
              <RecoverySection
                result={result}
                recovery={recovery}
                rolling={rolling}
                symbol={series.metadata.symbol}
              />
            )}
            {!rolling && !rollingError && <Spinner />}
            {rollingError && <ErrorNotice>{rollingError}</ErrorNotice>}
            {rolling && <RollingSection rolling={rolling} />}
            {rolling && <MeaningSection result={result} rolling={rolling} />}
            <MethodologyTeaser />
          </div>
        )}
      </main>
      <Footer />
    </>
  )
}

function Methodology() {
  return (
    <>
      <main className="methodology-page">
        <div className="methodology-hero">
          <span className="eyebrow">Methodology</span>
          <h1>The rules behind every result.</h1>
          <p>Simple inputs, deterministic calculations, and assumptions you can inspect.</p>
        </div>
        <div className="methodology-layout">
          <aside>
            <nav aria-label="Methodology sections">
              <a href="#strategies">Strategies</a><a href="#formulas">Formulas</a>
              <a href="#data">Data & provenance</a><a href="#limits">Limitations</a><a href="#disclosures">Disclosures</a>
            </nav>
          </aside>
          <article>
            <section id="strategies">
              <span className="section-number">01</span><h2>Strategy rules</h2>
              <p><strong>Invest now</strong> buys synthetic total-return units with all capital at the first adjusted close on or after the requested start.</p>
              <p><strong>DCA</strong> divides starting capital by the purchase count, buys immediately, then on monthly anniversaries. Month-end anniversaries clamp to the destination month; non-trading dates move forward to the next session. The last purchase sweeps all cash and accrued interest.</p>
              <p>The requested end must be after the final purchase. It rolls backward to the latest available observation. Fractional units are allowed.</p>
            </section>
            <section id="formulas">
              <span className="section-number">02</span><h2>Formulas</h2>
              <dl className="formula-list">
                <div><dt>Daily cash interest</dt><dd><code>cash × (latest 3-month par yield ÷ 100) ÷ 365.2425</code></dd></div>
                <div><dt>Total return</dt><dd><code>ending value ÷ starting capital − 1</code></dd></div>
                <div><dt>CAGR</dt><dd><code>(ending value ÷ capital)^(365.2425 ÷ elapsed days) − 1</code></dd></div>
                <div><dt>Volatility</dt><dd>Sample standard deviation of observation-to-observation account returns × √252.</dd></div>
                <div><dt>Maximum drawdown</dt><dd>Largest peak-to-trough percentage decline in the account-value series.</dd></div>
                <div><dt>Equity exposure</dt><dd>Average of equity value ÷ total account value on observed sessions.</dd></div>
                <div><dt>Break-even recovery</dt><dd>First later session after an initial decline when the invest-now account value is again at least the original capital. The longest completed recovery is compared across every valid entry; snapshot-censored entries remain unrecovered.</dd></div>
                <div><dt>Break-even distribution</dt><dd>Each rolling start is assigned zero days when the next observed account value is at or above principal, its calendar time to recovery after an initial loss, or unrecovered when the selected horizon ends first. Losses below one cent are treated as ties. Unrecovered starts remain visible and are excluded from averages.</dd></div>
              </dl>
              <p>Rates never look ahead: each calendar day uses the newest Treasury rate published on or before it. Differences below one cent are ties.</p>
            </section>
            <section id="data">
              <span className="section-number">03</span><h2>Data & provenance</h2>
              <p>The bundled SPY series is a CC BY 4.0 Kaggle snapshot dated November 27, 2025. Its last available trading observation is November 26 because November 27 was a U.S. market holiday. Adjusted closes represent synthetic total-return units; dividends and splits are not added again.</p>
              <p>Waiting cash uses the official U.S. Treasury Daily Treasury Par Yield Curve 3-month rate. Analysis is limited to the overlap of price and rate coverage.</p>
              <p><a href={`${import.meta.env.BASE_URL}data/manifest.json`}>Open the machine-readable data manifest</a> or read <a href="https://github.com/ryanbieber/time-vs-timing/blob/main/DATA_LICENSES.md">data licenses and attribution</a>.</p>
            </section>
            <section id="limits">
              <span className="section-number">04</span><h2>Limitations and bias</h2>
              <p>SPY is one successful, surviving U.S. equity fund. Choosing it after decades of history creates selection and survivorship bias. These results do not generalize automatically to other assets, markets, or future periods.</p>
              <p>The snapshot stops in 2025 and will become stale. Adjusted-close methods can differ by vendor. Treasury par yield is a transparent cash proxy, not a realizable money-market return, and daily simple accrual ignores product fees and settlement.</p>
              <p>The model excludes commissions, bid–ask spreads, taxes, slippage, whole-share constraints, fund expenses beyond their effect on adjusted prices, and behavioral differences.</p>
            </section>
            <section id="disclosures">
              <span className="section-number">05</span><h2>Disclosures</h2>
              <div className="disclosure-box">
                <strong>Educational only—not investment advice.</strong>
                <p>Historical performance does not predict future results. This tool does not recommend a security, allocation, account, or transaction.</p>
              </div>
            </section>
          </article>
        </div>
      </main>
      <Footer />
    </>
  )
}

function Footer() {
  return (
    <footer>
      <div><strong>Time vs Timing</strong><span>Historical evidence for curious investors.</span></div>
      <div><Link to="/methodology">Methodology</Link><a href="https://github.com/ryanbieber/time-vs-timing">GitHub</a><span>MIT licensed</span></div>
      <p>Educational only—not investment advice. Historical results do not predict future returns.</p>
    </footer>
  )
}

export default function App() {
  return (
    <div className="app-shell">
      <Header />
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/methodology" element={<Methodology />} />
      </Routes>
    </div>
  )
}
