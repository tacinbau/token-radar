[![token-radar-01 rank](https://make.fun/badge/token-radar-01/tacinbau/token-radar-01-r7/rank.svg)](https://make.fun/bounty/token-radar-01)
[![token-radar-01 reward](https://make.fun/badge/token-radar-01/tacinbau/token-radar-01-r7/reward.svg)](https://make.fun/bounty/token-radar-01)
[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)

# Northlight — Token Launch Radar

Build the best token launch radar: read the sealed DefiLlama snapshot, work out
which protocols still record no token and are not a wrapped, staked or bridged
product of one that trades, rank them by what their launch would be worth, and
hand in a dashboard that shows the board, a detail view for every protocol and
the steps to farm it — with every number carrying its own uncertainty.

## What it builds

`main.ts` (Node 22, standard library only) reads the snapshot and writes:

- `board.json` — **198 ranked rows**: all 40 watchlist protocols plus every
  other pre-token protocol that passes the watchlist's own exclusion rule.
  The rule, not an arbitrary cutoff, sets the board's size. Total implied
  value **$2,622,299,722**. Top row: **Sentora Curator, $117,981,012 implied**.
- `data.js` — the board data the dashboard page reads, plus the model summary
  and the integrity strip.
- `dashboard/` — a static page (no network): sortable/filterable board,
  detail view per protocol, methodology panel, integrity strip.
- `screenshots/` — board, detail and filtered views (1440×900).
- `dossier.json` — built with `buildDossier` from the kit's
  `vendor/makefun-board.ts`.

Verdicts: **40 farm / 113 marginal / 45 skip**.

## The model — every term tested held-out twice

Implied value is read off TVL through a curve fitted on the **128** protocols
whose token already trades:

```
log10(market cap) = 2.7732 + 0.5613 × log10(TVL) − 0.4972 × [Liquid Staking]
```

A **Huber robust fit** (c = 1.345). Every candidate value term was fitted and
then tested held-out **twice** — leave-one-out over all 128 priced protocols,
and walk-forward (fit the earliest-listed 70%, test the latest 30%: 66 train /
29 test) — and a term survives only when **both** tests improve:

| Candidate term | LOO RMSE | Walk-forward RMSE | Decision |
|---|---:|---:|---|
| log10(TVL) alone (base) | 0.9132 | 0.9952 | base |
| + log10(age_days) | 0.9191 | 1.2902 | dropped |
| + change_7d clipped /100 | 0.9167 | 1.0025 | dropped |
| + log10(chain_count) | 0.9187 | 1.0084 | dropped |
| + log10(TVL) × log10(age) | 0.9193 | 1.2940 | dropped |
| + category = Dexs | 0.9197 | 1.0065 | dropped |
| + category = Lending | 0.9200 | 1.0037 | dropped |
| + category = Yield | 0.9159 | 0.9908 | dropped |
| + category = Derivatives | 0.9119 | 1.0076 | dropped |
| + category = CDP | 0.9159 | 0.9909 | dropped |
| + category = Restaking | 0.9145 | 0.9988 | dropped |
| + category = RWA | 0.9140 | 0.9950 | dropped |
| + category = Liquid Staking | **0.9094** | **0.9680** | **kept** |

**1 of 12 terms survived.** Age, growth, chain count, most category flags and
the TVL×age interaction all fit in-sample and failed out-of-sample. One term
survived both blind tests: liquid-staking tokens price systematically
*lower* against TVL (coefficient −0.50 dex — huge TVL, small governance
token), so it stays. Huber beats OLS on the same spec on both tests
(LOO 0.9094 vs 0.9112; walk-forward 0.9680 vs 0.9781).

**Ranges are conformal, not parametric.** The 80% band is ±1.0254 dex around
the point estimate — the 80th percentile of the leave-one-out residuals. It
covered 80.5% of priced protocols in-sample; the 90% band (±1.4985 dex)
covered 89.8%. The model is weak (R² near 0.2) and the bands say so, on the
board and in the strip.

## Launch odds from the peers' record

Odds are empirical, not a fitted model: the share of peers with a token among
protocols within ±0.5 dex of TVL and ±0.3 dex of age (TVL-only fallback when
fewer than 10 peers). As a classifier of "has a token" the odds score
**AUC 0.714**. The walk-forward check is stated, not hidden: on the
latest-listed protocols the odds predicted **0.464** against an actual token
rate of **0.340** (n=194) — the odds run hot on young protocols, so the strip
and the methodology panel both say to treat those as an upper bound.

## Costed farm verdicts

Expected capture = implied value × launch odds × 0.1% farmer share — a
deliberately conservative planning haircut, stated on the page; one farmer
never collects the whole implied value. Net $/hour subtracts the plan's gas
and fees and divides by its active hours. **Farm at $10,000/hr or more with
minimum viable capital under $1,000; marginal above $2,500/hr; skip below.**
Every plan states its gas per step (per-chain planning estimates), its active
minutes and its minimum viable capital — the capital is recoverable, not a
cost. Net $/hour across the board runs $586 to $94,315.

## Integrity strip

The dashboard opens with a strip that states what can be checked without
trusting the model: snapshot date (2026-11-14), 758 protocols, watchlist
40/40 covered, 198 rows, model LOO and walk-forward RMSE, the conformal band
and its coverage, the odds walk-forward bias, and the verdict split — plus
the missing-data counts (113 protocols with no listing date, 4 with no 7-day
change, 14 token-bearing protocols with no market cap).

## What was copied from the top, what was revised

The top entries' discipline, applied: every value term fitted and tested
held-out twice; token odds from the peers' record; an integrity strip; costed
farm verdicts in $/hour sized to minimum viable capital; conformal intervals.
Revised, not cloned: the odds are empirical peer rates rather than a fitted
logistic score, and their walk-forward bias is disclosed in the strip instead
of smoothed over; the one surviving term is a *negative* Liquid Staking dummy
the top entries never named; verdict lines sit on this board's own net-$/
hour distribution; the dashboard is a fresh build ("Northlight") with its own
layout, palette and methodology panel.

## Verification

- The sealed scorer is not published in this kit (`grade-local` refuses
  program/v1 kits: "its scorer and reference data are not published in the
  kit"), so the gate was checked locally against the seven rows the rules
  publish: **7/7 pass** — dashboard files, board file, sorted-by-value,
  coverage, farm steps, screenshots, dossier byte-identical to a rebuild
  (648,123 bytes, under the 1.5 MiB cap).
- The program is deterministic: two runs on the same snapshot write
  byte-identical outputs.
- Screenshots are renders of the built dashboard (headless Chromium at
  1440×900, then JPEG): `index.html`, `index.html#detail=sentora-curator`,
  `index.html#verdict=farm`. All three were viewed and are clean.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path to snapshot.json>
```

At grade time the harness runs it with `--input /input/snapshot.json` and
`MAKEFUN_OUTPUT_DIR=/output`. No network, no secrets, no dependencies beyond
the Node standard library.

## License

MIT — see `LICENSE`.
