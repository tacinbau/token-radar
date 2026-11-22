# Signal v4 — token launch radar

A fitted radar over the sealed DefiLlama snapshot: 198 pre-token protocols ranked by fitted launch value × launch odds, all 40 watchlist entries covered, every one of the 758 snapshot protocols accounted for in exactly one group.

## What changed vs v3

- **Board narrowed to 198, with the ledger to prove it.** v3 ranked all 342 pre-token protocols; v4 ranks the 198 the house rules leave standing (40 watchlist + 138 early below the $50M floor + 20 off-list) and sets the other 144 aside with an explicit reason each (bridge 43, liquid staking/restaking 43, exchange custody 42, versioned or wrapped 16). The 416 that already record a token split into 128 priced comps and 288 with no usable market cap. 198 + 128 + 288 + 43 + 43 + 42 + 16 = 758.
- **Out-of-sample evidence, in three tables.** Every candidate term is tested leave-one-out AND walk-forward (earlier-listed tokens price later-listed ones). Only the size curve survives both tests for value (walk-forward miss ×3.01 vs ×5.29 flat) and only age survives for token odds (Brier 0.224 vs 0.251 base rate) — so the board prices on those two alone. Category effect, 7-day growth, chain count and a shuffled control are shown as tested-and-rejected / must-not-help. Range honesty is measured on held-out caps: 54.7% of leave-one-out caps and 56.3% of walk-forward caps fall inside the printed P25–P75 (stated 50%).
- **Integrity strip, recomputed in the browser.** The dashboard re-checks the board live: ranks 1–198 in order, values never rise, totals equal ($933.3M), checksum matches main.ts, watchlist 40 of 40, ledger 758 of 758.
- **Six KPI cards** (was four): held-out miss, range honesty, odds Brier, terms that survived both tests (1 of 5 value · 1 of 4 odds), worth farming under the default scenario (75 farm of 198), watchlist ranked 40/40.
- **Full filter bar and richer columns.** All 198 / Farm / Marginal / Skip, tiers, Watchlist, Early (&lt;$50M), Off-list, deposit plan size, drop-share slider (3.5%/7%/14%), horizon slider, search, category + chain dropdowns, Reset, CSV, JSON. Columns now include 7D, no-token age, token-odds bar, if-it-launches value, implied value with P25–P75 range and rank range, verdict with net of fees, and net/hour — all re-priced live when the scenario sliders move.
- **Costed farm verdicts.** Farmer gross is implied value × 7% drop share / 2,000 farmers; net subtracts 3 gas sessions (by chain) and the opportunity cost of the deposit plan (4.5% a year). Farm at ≥$25 net/hour, marginal at net ≥$0, skip below $0.

## The model (all numbers computed from the snapshot, none hand-set per protocol)

1. **Fitted size curve.** log10(market cap) regressed on log10(TVL) over the 128 token-bearing protocols with a market cap: log10(mcap) = 3.025 + 0.522 × log10(TVL), R² 0.194, residual sd 0.909 dex. No category offset: it helps in-sample but fails the both-tests rule held out.
2. **Launch odds.** The share of protocols this old that already record a token, by age band, smoothed toward the overall rate. The peers' record — not a promise a token will launch.
3. **Implied value and range.** Fitted value × odds; P25–P75 and P10–P90 from the residual sd, printed on every row with its rank range.

## Run (Node 22+, standard library only)

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
```

Open `out/dashboard/index.html`. Output is a deterministic `board.json` plus `data.js`; the dashboard and screenshots are copied through and `dossier.json` is built with the unchanged vendor library.

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/tacinbau/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/tacinbau/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

