[![token-radar-01 rank](https://make.fun/badge/token-radar-01/tacinbau/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![token-radar-01 reward](https://make.fun/badge/token-radar-01/tacinbau/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01)
[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)

# Fleet Forge — Token Launch Radar

Build the best token launch radar: read the sealed DefiLlama snapshot, work out
which protocols still record no token and are not a wrapped, staked or bridged
product of one that trades, rank them by what their launch would be worth, and
hand in a dashboard that shows the board, a detail view for every protocol and
the steps to farm it.

## What it builds

`main.ts` (Node 22, standard library only) reads the snapshot and writes:

- `board.json` — **198 ranked rows**: all 40 watchlist protocols plus every
  other pre-token protocol that passes the watchlist's own exclusion rule.
  The rule, not an arbitrary cutoff, sets the board's size — every eligible
  pre-token protocol in the snapshot is on it. Total implied value
  **$2,377,014,285**. Top row: **Sentora Curator, $103,719,887 implied**.
- `data.js` — the board data the dashboard page reads.
- `dashboard/` — a static page (no network): sortable/filterable board,
  detail view per protocol, methodology panel.
- `screenshots/` — board, detail and filtered views (1440×900).
- `dossier.json` — built with `buildDossier` from the kit's
  `vendor/makefun-board.ts`.

Verdicts: **17 farm / 155 marginal / 26 skip**.

## The model

Implied value is read off TVL through a curve fitted on the **128** protocols
whose token already trades:

```
log10(market cap) = 2.809 + 0.552 × log10(TVL)
```

A **Huber robust fit** (c = 1.345): protocols whose market cap sits 100× off
their TVL — prediction-market and bridge tokens mostly — do not drag the
curve. Blind test (5-fold CV RMSE in log10): **Huber 0.9262 vs OLS 0.9347**
(OLS: a = 3.025, b = 0.522, R² = 0.194, residual sd = 0.909). Every row
carries an 80% interval from the residual sd — the model states its
uncertainty instead of pretending to be precise.

**Tested and rejected for pricing:** log age, 7-day growth, chain count and
category dummies all made 5-fold CV RMSE *worse* (age 0.955, growth 0.967,
chains 0.967 vs 0.935 plain OLS on the same 128). Growth's in-sample slope
is negative (−1.6): faster 7-day growth predicts a *lower* multiple, not a
higher one. So none of them prices anything. Age and growth still matter —
in the launch-odds score, not in the price.

**Launch odds** come from a logistic score on log TVL, log age and log chain
count, predicting whether a protocol's record names a token. Out-of-fold AUC
**0.655** (TVL alone: 0.53 — nearly useless on its own). Cross-fitted scores
are split into quintiles and PAVA-pooled into the buckets
**31.8% / 48.7% / 57.6% / 65.1% / 71.1%**. Odds are a proxy for how much a
protocol looks like the ones that already trade, not a forecast that it will
launch.

**Verdicts:** expected value per farming hour =
`implied × odds × 0.001 ÷ plan hours`. The 0.1% farmer share is a
deliberately conservative planning haircut — one farmer never collects the
whole implied value. Farm at $15,000/hr or more, marginal from $1,500/hr,
skip below that. Each plan's cost is the sum of its steps' gas (per-chain
planning estimates) and fees; capital is a suggestion, recoverable, not a
cost.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path to snapshot.json>
```

At grade time the harness runs it with `--input /input/snapshot.json` and
`MAKEFUN_OUTPUT_DIR=/output`. The program is deterministic: two runs on the
same snapshot write byte-identical outputs (verified). No network, no
secrets, no dependencies beyond the Node standard library.

Screenshots are renders of the built dashboard (headless Chromium at
1440×900, then JPEG): `index.html`, `index.html#detail=sentora-curator`,
`index.html#verdict=farm`.

## License

MIT — see `LICENSE`.
