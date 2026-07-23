# Time vs Timing

An evidence-first investing dashboard that compares putting a lump sum to work immediately with deploying the same capital through monthly dollar-cost averaging (DCA).

**Live app:** [ryanbieber.github.io/time-vs-timing](https://ryanbieber.github.io/time-vs-timing/)

Time vs Timing does two things:

1. Runs a transparent selected-window backtest with historical interest on waiting cash.
2. Repeats that exact horizon and purchase schedule from every valid SPY trading date, reducing the temptation to cherry-pick one convenient start.

The app is static, has no accounts or analytics, makes no runtime vendor API calls, and keeps imported CSVs in browser memory.

## What is included

- Bundled SPY adjusted-close snapshot, dated 2025-11-27 and licensed CC BY 4.0
- Official U.S. Treasury 3-month par yields for interest on uninvested cash
- 3, 6, 12, 24, and 36 monthly-purchase schedules
- Ending value, profit, total return, CAGR, drawdown, volatility, exposure, cash interest, and average purchase price
- Rolling win rates, percentiles, best/worst starts, histogram, and start-date timeline
- Local CSV import with explicit column mapping and adjustment/currency confirmation
- Shareable hash-query URLs for bundled SPY scenarios
- Equivalent accessible tables for every chart and a dedicated methodology route

## Backtest rules

- Lump sum invests at the first available adjusted close on or after the requested start.
- DCA buys immediately and on clamped monthly anniversaries; non-trading dates advance to the next session.
- Each regular purchase is `starting capital / purchase count`.
- The final purchase sweeps all remaining cash, including accrued interest.
- Waiting cash accrues daily from the latest Treasury rate published on or before that day, using `rate / 365.2425`.
- The requested end rolls backward to the last observation and must be after the final purchase.
- Adjusted closes are synthetic total-return units. Dividends and splits are not added again.
- Fractional units are allowed. Taxes, fees, spreads, slippage, and whole-share rules are excluded.
- Differences below one cent are ties.

See the in-app [`#/methodology`](https://ryanbieber.github.io/time-vs-timing/#/methodology) view for formulas, provenance, and limitations.

## Local development

Node 24 is configured in `.nvmrc` and `.node-version`.

```bash
npm ci
npm run dev
```

Quality checks:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

The pure TypeScript engine is independent of React and lives in `src/engine`. Coverage gates require at least 90% line and branch coverage for it.

## CSV format

Files may contain any headers because the import flow asks the user to map:

- an ISO `YYYY-MM-DD` date column
- a positive, finite adjusted-close column

A symbol and confirmation that the series is USD and adjusted for dividends and splits are required. Files are capped at 10 MB and 50,000 rows. Duplicate dates and any malformed mapped value reject the import; valid rows are sorted before analysis.

Imported files are never uploaded, persisted, or placed in the URL. Share-link generation is disabled for them.

## Data refresh

The checked-in JSON files are normalized build inputs, not live feeds. Their exact sources, retrieval dates, coverage, row counts, licenses, and SHA-256 checksums are recorded in [`public/data/manifest.json`](public/data/manifest.json). Attribution is in [`DATA_LICENSES.md`](DATA_LICENSES.md).

Maintainers with network access can regenerate them:

```bash
npm run data:normalize
```

The script downloads the Kaggle archive and official annual Treasury XML feeds into ignored `data/raw/`, normalizes the required fields, and rewrites the manifest.

## Architecture

```text
src/
├── engine/       pure strategies, metrics, and rolling analysis
├── data/         bundled-data and local-CSV adapters
├── workers/      non-blocking rolling-history calculation
├── components/   tree-shaken ECharts adapter
└── App.tsx       dashboard, import flow, and methodology route
```

Vite takes its production base path from the value reported by `actions/configure-pages`. `HashRouter` keeps both routes refresh-safe on static GitHub Pages.

## Scope and disclaimer

V1 deliberately excludes portfolios, live ticker lookup, predictions, accounts, analytics, and a backend.

**Educational only—not investment advice. Historical performance does not predict future results.**

## License

Application code is [MIT licensed](LICENSE). Bundled data has separate terms described in [DATA_LICENSES.md](DATA_LICENSES.md).
