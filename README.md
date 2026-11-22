# Signal v3 — token launch radar

A fitted radar over the sealed DefiLlama snapshot: 342 pre-token protocols ranked by fitted launch value × launch odds, all 40 watchlist entries covered, every one of the 758 snapshot protocols accounted for.

## The model (all numbers computed from the snapshot, none hand-set per protocol)

1. **Fitted comps curve.** log10(market cap) regressed on log10(TVL) over the 128 token-bearing protocols with a market cap, plus a shrunken category offset (each category's mean residual × n/(n+5)). Fit equation, R² and n are printed by `main.ts` and shown on the dashboard.
2. **Held-out test.** 5-fold cross-validation: each of the 128 comps is predicted once by a curve fitted without it. Median |log10 error|, share within 2×, and 90% interval coverage are reported.
3. **Launch odds.** The share of protocols this old that already record a token, by age band, smoothed toward the overall rate. The peers' record — not a promise a token will launch.
4. **Costed farm verdicts.** Expected farmer value assumes a 10% airdrop pool split among 2,000 farmers. Farm cost is 3 gas sessions (by chain) plus $25 test capital. Farm at ≥20× cost, thin at 5–20×, skip below 5×. Wrapped, staked, bridged and versioned products are always skip, with the reason on the row.

## Run (Node 22+, standard library only)

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
```

Open `out/dashboard/index.html`. Output is a deterministic `board.json` plus `data.js`; the dashboard and screenshots are copied through and `dossier.json` is built with the unchanged vendor library.

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/tacinbau/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/tacinbau/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
