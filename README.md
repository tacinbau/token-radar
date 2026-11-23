# Launch Radar — Signal v5

[![rank](https://make.fun/badge/token-radar-01/tacinbau/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/tacinbau/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01)
[![build](https://make.fun/badge/token-radar-01/tacinbau/token-radar-01/build.svg)](https://make.fun/bounty/token-radar-01)

A token launch radar for make.fun's `token-radar-01` bounty: 203 protocols that
record no token, ranked by implied value, with a costed farm plan for each one.
Board first, evidence below the fold.

## The model

Implied value = **value if it launches × launch odds**.

- **Value if it launches** — a size curve fitted on the snapshot's own 128
  token-bearing protocols that carry a market cap:
  `log10(mcap) = 3.025 + 0.522 × log10(TVL)`, R² 0.194, residual sd 0.909 dex.
- **Launch odds** — how often protocols of the same no-token age record a
  token, pooled so the rate never falls with age:
  <6mo 26.1%, 6–12mo 38.8%, 1–2y 38.8%, 2–4y 64.0%, >4y 79.7%.
  Brier 0.220 against a base-rate 0.250 (n=645).
- **7-day growth is shown, not priced.** Adding it to the curve gives a
  coefficient of −1.613 — the wrong sign for a growth premium — and a
  half-weight, clamped tilt does not hold up out of sample: it shaves the
  leave-one-out median miss (3.65× against 3.90×) but loses walk-forward
  (3.01× against 2.83×), and it would move 214 of 342 pre-token protocols by
  more than 10%. The ranking would be a growth ranking, not a value ranking.
- **Held-out checks** (median absolute miss multiple): leave-one-out 3.40×
  against a flat 3.95×; walk-forward 3.06× against a flat 3.32×. The P25–P75
  band holds 49.2% of leave-one-out predictions (it states 50%).

## Farm economics (default scenario)

Gross = implied value × 7% ÷ 2,000 farmers. Gas $36 (3 sessions × $12).
Deposit plan $1,000, opportunity cost 4.5%/yr over 12 weeks. Hours come from
the plan's own steps (verify 8, fund 15, inspect 10, review 15, rewards
15 min/week, close 10) — about 4.0 hours over 12 weeks. Verdict: **FARM**
at $30/hr or better, **MARGINAL** when the net is positive, **SKIP** when it
is not. At the default scenario: 54 farm, 130 marginal, 19 skip.

Top 5 by implied value: Sentora Curator $35.0M ($297.25/hr), Steakhouse
Financial $35.0M ($297.03/hr), Gauntlet $26.2M ($219.10/hr), Veda $26.0M
($218.01/hr), Polymarket International $23.4M ($194.38/hr). Total implied
value $934,525,971 across 203 rows; checksum `0b2fe3b4`.

## The ledger (758 protocols read)

40 watchlist + 143 early + 20 off-list = 203 ranked. Left out: 128 priced
comps (the curve's training data), 288 with a token but no cap, 43 bridges,
43 liquid-staking products, 42 exchanges, 11 versioned names.

## Run it

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node 22.18 or later, standard library only, no network. The program reads the
sealed snapshot, writes `board.json`, `data.js`, the dashboard, the
screenshots and `dossier.json` into the output directory, and checks the
gate's own shape (ranks 1–N, implied value never rising with rank, every
watchlist slug covered, farm steps 3–12 strings of 20–600 characters) before
it writes anything. Two runs write byte-identical output.

## Layout

- `main.ts` — entry point: reads the snapshot, writes the outputs, runs the
  self-check.
- `lib/model.ts` — the whole model: classification, size curve, launch odds,
  held-out checks, farm economics, plan generator.
- `dashboard/` — the page: board-first layout, spotlight of the top 5 by net
  per hour, filter bar with live re-pricing, a full-page detail view per
  protocol, a priced-comps audit view, and a how-it-works section that states
  every number above from the run's own data.
- `vendor/makefun-board.ts` — the kit's dossier library, as shipped.
- `screenshots/` — the three screenshots of the page: board, detail, filtered.
