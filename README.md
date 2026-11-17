[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/tacinbau/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/tacinbau/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
# Signal — token launch radar

An offline research dashboard ranking 198 farmable protocols that record no token, including all 40 snapshot watchlist entries and 158 discoveries below $50M TVL. Search, filter, sort and open shareable protocol research files with six conditional farm actions and explicit cost/time estimates.

The model multiplies TVL by the median token-market-cap/TVL ratio of token-bearing category peers, then adjusts for clamped seven-day growth and capped tracking age. Categories without peers use the global median. No protocol name determines value. Figures are this entry's hypothetical valuation claim, not a launch forecast; category-guided farm plans require checking current eligibility.

Run with Node 22+ (standard library only):

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /home/hatch/workspace/make-fun-token-radar-kit-18/token-radar-01-kit/input/snapshot.json
```

Open `out/dashboard/index.html`. Output includes deterministic board.json and data.js; source dashboard and any later screenshots are copied. Dossier generation uses the unchanged vendor library with a 65,536-byte text cap and waits until screenshots exist.

Board limits: 198 unique ranked rows, strictly decreasing positive dollar values, all 40 watchlist entries, six 20–600-character farm steps per row. Three dashboard source files total under 60,000 bytes, no external requests or links. Screenshots are intentionally pending; the screenshot and dossier gates cannot pass until they arrive. No dependencies or build step.
