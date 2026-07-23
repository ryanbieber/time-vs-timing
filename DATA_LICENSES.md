# Data licenses and attribution

The MIT license in this repository applies to application code, not automatically to bundled datasets.

## SPDR S&P 500 ETF (SPY) adjusted-price snapshot

- **Dataset:** SPDR S&P 500 ETF (SPY)
- **Creator/publisher:** Ali Raza, via Kaggle
- **Source:** <https://www.kaggle.com/datasets/aliraza948/spdr-s-and-p-500-etf-spy>
- **License:** [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/)
- **Snapshot date:** 2025-11-27
- **Bundled observations:** 1994-02-01 through 2025-11-26
- **Transformation:** The source `Date` and `AdjClose` fields were selected, renamed, type-normalized, sorted, and serialized to JSON. Rows later than the snapshot date were excluded. No prices were imputed.

November 27, 2025 was a U.S. market holiday, so the source snapshot’s last trading observation is November 26.

Attribution is provided under CC BY 4.0. No endorsement by the dataset creator, Kaggle, State Street, or the index provider is implied. SPY and related marks belong to their respective owners.

## U.S. Treasury 3-month par yields

- **Dataset:** Daily Treasury Par Yield Curve Rates, 3-month maturity
- **Publisher:** U.S. Department of the Treasury
- **Source page:** <https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve>
- **Source feeds:** Annual official XML feed URLs are enumerated in `public/data/manifest.json`
- **Retrieved:** 2026-07-23
- **Bundled observations:** 1994-01-03 through 2025-11-26
- **Transformation:** The official publication date and `BC_3MONTH` value were selected, normalized to ISO dates and percentage numbers, sorted, and serialized to JSON. No rates were imputed.

This repository records the Treasury source and transformations for provenance. U.S. federal government works are generally not eligible for U.S. copyright protection under 17 U.S.C. § 105; users outside the United States should evaluate any local restrictions.

## Integrity

Exact row counts, retrieval dates, coverage, source URLs, source-archive checksum, and normalized-file SHA-256 checksums are stored in [`public/data/manifest.json`](public/data/manifest.json).
