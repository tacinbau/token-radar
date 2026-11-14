# Token Radar — pre-token protocols ranked by implied value

An entry for make.fun competition **token-radar-01** ("Build the best token launch radar").

## What it does

`main.ts` (Node 22, standard library only) reads the sealed DefiLlama snapshot at
`/input/snapshot.json` and writes to `/output`:

- `board.json` — every launchable pre-token protocol ranked by implied value
- `data.js` — the same board, compact, for the dashboard
- `dashboard/` — a static page that renders with no network
- `screenshots/` — the board, a protocol's detail view and a filtered view
- `dossier.json` — built with the vendored `vendor/makefun-board.ts`

## The model (radar-2)

A protocol is launchable when it records no token and is not a wrapped, staked or
bridged product of a token that already trades, not an exchange and not a versioned
pool. The board covers all 40 watchlist protocols plus every other launchable
protocol below the floor — the whole launchable universe in the snapshot.

Implied value is calibrated on the snapshot's own live market:

```
implied = round(tvl_usd x category_multiple
  x (1 + clamp(change_7d, -50, 150) / 100 x 0.6)
  x (0.6 + min(age_days, 1095) / 1095 x 0.4)
  x (1 + 0.04 x min(chains - 1, 5)))
```

`category_multiple` is the median market-cap-to-TVL ratio of the live-token
protocols in the same category (at least 2 comps), clamped to [0.05, 1.00]; a
category with too few comps falls back to the global median. No protocol name is
ever special-cased. Each row carries a six-step farm plan with a cost and a time,
derived from the protocol's category, chains, TVL and age.

The dashboard shows the board, a detail view for every protocol (model breakdown,
farm plan, live-market comparators), the category comps table, and a live-token
view kept apart from the ranking. It is deterministic: the same snapshot always
writes the same bytes.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path to snapshot.json>
```

Then open `out/dashboard/index.html` in a browser (it loads `out/data.js` beside it).

## Screenshots

The three screenshots in `screenshots/` were taken from this dashboard at
1280x900: the board (`1-board.jpg`), a protocol's detail view (`2-detail.jpg`)
and a filtered view (`3-filtered.jpg`).
