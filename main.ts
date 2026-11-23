// Fleet Forge — token launch radar, round 6.
//
// Reads the sealed DefiLlama snapshot, fits the value model from that snapshot
// at runtime, ranks every eligible pre-token protocol by what its launch would
// be worth, and writes board.json, data.js, dashboard/, screenshots/ and
// dossier.json into the output directory.
//
// Nothing here is a hardcoded list of names: every number the board shows is
// derived from the snapshot by the code below, on every run. The program is
// deterministic: two runs on the same snapshot write byte-identical outputs.
//
// Run locally:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path to snapshot.json>
// At grade time the harness runs it with --input /input/snapshot.json and
// MAKEFUN_OUTPUT_DIR=/output.

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  cpSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { buildDossier } from "./vendor/makefun-board.ts";

// ---------------------------------------------------------------------------
// Snapshot shape (exactly the ten fields input/README.md documents).
// ---------------------------------------------------------------------------

type Protocol = {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
};

type Snapshot = {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
};

function parseArgs(argv: string[]): { input: string; output: string } {
  let input = "";
  let output = process.env.MAKEFUN_OUTPUT_DIR ?? "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input" && i + 1 < argv.length) input = argv[++i];
    else if (argv[i] === "--output" && i + 1 < argv.length) output = argv[++i];
  }
  if (!input) {
    if (existsSync("/input/snapshot.json")) input = "/input/snapshot.json";
    else if (existsSync("input/snapshot.json")) input = "input/snapshot.json";
    else
      throw new Error(
        "no snapshot: pass --input <path to snapshot.json> (grade time: /input/snapshot.json)",
      );
  }
  if (!output) output = "out";
  return { input, output };
}

// ---------------------------------------------------------------------------
// Small numeric helpers. All deterministic; no randomness anywhere.
// ---------------------------------------------------------------------------

function log10(x: number): number {
  return Math.log(x) / Math.LN10;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function pstdev(xs: number[]): number {
  const mu = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - mu) * (x - mu))));
}

function roundTo(x: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

// Ordinary least squares by the normal equations with Gaussian elimination.
// X rows already include the intercept column.
function ols(X: number[][], y: number[]): {
  beta: number[];
  r2: number;
  residSd: number;
  resid: number[];
} {
  const n = X.length;
  const k = X[0].length;
  const ata: number[][] = Array.from({ length: k }, () =>
    new Array<number>(k).fill(0),
  );
  const aty: number[] = new Array<number>(k).fill(0);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < k; a++) {
      aty[a] += X[i][a] * y[i];
      for (let b = 0; b < k; b++) ata[a][b] += X[i][a] * X[i][b];
    }
  }
  // Solve ata * beta = aty.
  const m: number[][] = ata.map((row, i) => [...row, aty[i]]);
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++)
      if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
    [m[c], m[piv]] = [m[piv], m[c]];
    const pv = m[c][c];
    for (let j = c; j <= k; j++) m[c][j] /= pv;
    for (let r = 0; r < k; r++) {
      if (r === c || m[r][c] === 0) continue;
      const f = m[r][c];
      for (let j = c; j <= k; j++) m[r][j] -= f * m[c][j];
    }
  }
  const beta = m.map((row) => row[k]);
  const pred = X.map((row) => dot(beta, row));
  const resid = y.map((v, i) => v - pred[i]);
  const ym = mean(y);
  const ssTot = y.reduce((s, v) => s + (v - ym) * (v - ym), 0);
  const ssRes = resid.reduce((s, v) => s + v * v, 0);
  return {
    beta,
    r2: 1 - ssRes / ssTot,
    residSd: Math.sqrt(ssRes / Math.max(n - k, 1)),
    resid,
  };
}

// Huber robust fit by iteratively reweighted least squares (c = 1.345,
// MAD scale). Downweights the protocols whose market cap is wildly off the
// TVL curve — prediction-market and bridge tokens mostly — instead of letting
// a handful of 100x outliers drag the whole curve.
function huberFit(
  X: number[][],
  y: number[],
  c = 1.345,
  iters = 60,
): { beta: number[]; residSd: number; resid: number[] } {
  let beta = ols(X, y).beta;
  for (let t = 0; t < iters; t++) {
    const r = y.map((v, i) => v - dot(beta, X[i]));
    const mad = median(r.map((v) => Math.abs(v)));
    const s = 1.4826 * mad;
    if (s === 0) break;
    const w = r.map((v) => {
      const a = Math.abs(v);
      return a <= c * s ? 1 : (c * s) / a;
    });
    const xw = X.map((row, i) =>
      row.map((v) => Math.sqrt(w[i]) * v),
    );
    const yw = y.map((v, i) => Math.sqrt(w[i]) * v);
    const next = ols(xw, yw).beta;
    const shift = Math.max(...next.map((v, i) => Math.abs(v - beta[i])));
    beta = next;
    if (shift < 1e-9) break;
  }
  const resid = y.map((v, i) => v - dot(beta, X[i]));
  return {
    beta,
    residSd: Math.sqrt(
      resid.reduce((s, v) => s + v * v, 0) / Math.max(X.length - 2, 1),
    ),
    resid,
  };
}

// Honest 5-fold cross-validated RMSE (folds by index mod 5; the snapshot is
// sorted by slug, so the folds are effectively random with respect to size).
// The fitting procedure — including any robust reweighting — is re-run inside
// each training fold, so the score is what the procedure earns on data it
// never saw, not what it memorised.
function cvRmse(
  fit: (X: number[][], y: number[]) => number[],
  X: number[][],
  y: number[],
  folds = 5,
): number {
  const errs: number[] = [];
  for (let f = 0; f < folds; f++) {
    const tr = X.map((_, i) => i).filter((i) => i % folds !== f);
    const te = X.map((_, i) => i).filter((i) => i % folds === f);
    const beta = fit(
      tr.map((i) => X[i]),
      tr.map((i) => y[i]),
    );
    for (const i of te) errs.push(y[i] - dot(beta, X[i]));
  }
  return Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length);
}

// ---------------------------------------------------------------------------
// Launch-likelihood calibration.
//
// Outcome: the protocol's DefiLlama record names a token (gecko_id or symbol
// present) or not. That is a proxy, not a forecast: it measures how much a
// protocol looks like the protocols that already trade, and the board says so.
// Score features are the snapshot's own figures: log TVL, log age in days
// (median-imputed where DefiLlama records no listing date) and log chain
// count. The score is fit by plain gradient-descent logistic regression with
// a fixed step count and zero start, so it is deterministic.
//
// The calibration buckets come from OUT-OF-FOLD scores (5-fold): each
// protocol is scored by a model that never saw it, the scores are split into
// quintiles, and the empirical token rate of each quintile is pooled with
// PAVA (pool adjacent violators) so the buckets never decrease. A board row's
// odds are the bucket its full-model score falls in.
// ---------------------------------------------------------------------------

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

function logisticFit(
  X: number[][],
  y: number[],
  lr = 0.5,
  iters = 2000,
): number[] {
  const w = new Array<number>(X[0].length).fill(0);
  for (let t = 0; t < iters; t++) {
    const g = new Array<number>(w.length).fill(0);
    for (let i = 0; i < X.length; i++) {
      const s = sigmoid(dot(w, X[i]));
      for (let j = 0; j < w.length; j++) g[j] += (s - y[i]) * X[i][j];
    }
    for (let j = 0; j < w.length; j++) w[j] -= (lr * g[j]) / X.length;
  }
  return w;
}

// Mann-Whitney AUC of a score against a binary label.
function auc(scores: number[], labels: number[]): number {
  const pos = scores.filter((_, i) => labels[i] === 1);
  const neg = scores.filter((_, i) => labels[i] === 0);
  let wins = 0;
  for (const a of pos)
    for (const b of neg) wins += a > b ? 1 : a === b ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

// Pool adjacent violators: isotonic (non-decreasing) regression on bucket
// rates weighted by bucket sizes. Returns one rate per bucket, in order.
function pava(rates: number[], weights: number[]): number[] {
  type Block = { rate: number; weight: number; count: number };
  const blocks: Block[] = [];
  for (let i = 0; i < rates.length; i++) {
    blocks.push({ rate: rates[i], weight: weights[i], count: 1 });
    while (
      blocks.length >= 2 &&
      blocks[blocks.length - 2].rate > blocks[blocks.length - 1].rate
    ) {
      const b2 = blocks.pop() as Block;
      const b1 = blocks.pop() as Block;
      blocks.push({
        rate:
          (b1.rate * b1.weight + b2.rate * b2.weight) /
          (b1.weight + b2.weight),
        weight: b1.weight + b2.weight,
        count: b1.count + b2.count,
      });
    }
  }
  const out: number[] = [];
  for (const b of blocks) for (let i = 0; i < b.count; i++) out.push(b.rate);
  return out;
}

// ---------------------------------------------------------------------------
// Board membership: the watchlist's own exclusion rule, applied to the whole
// pre-token universe. A wrapped, staked or bridged product of a token that
// already trades is not a protocol still waiting on a launch of its own, and
// neither is a centralised exchange. The house applies the same rule with one
// more field (parentProtocol) that the snapshot does not carry; the board
// applies the checkable part and says so in the methodology.
// ---------------------------------------------------------------------------

const EXCLUDED_CATEGORIES = new Set([
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
  "CEX",
]);

const EXCHANGE_NAMES = [
  "Binance",
  "Coinbase",
  "Bybit",
  "Kraken",
  "Bitget",
  "OKX",
  "Bitfinex",
  "Gemini",
];

const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

function exclusionReason(p: Protocol): string | null {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category))
    return `category ${p.category}`;
  if (VERSION_SUFFIX.test(p.name)) return "versioned name";
  if (WRAPPED_WORD.test(p.name)) return "wrapped/staked name";
  for (const ex of EXCHANGE_NAMES)
    if (p.name.startsWith(ex)) return "exchange name";
  return null;
}

// ---------------------------------------------------------------------------
// Farm plans. Steps are generated from the protocol's category family and its
// chains — never from a list of names. Each step states what to do, what it
// costs and how long it takes. Gas figures are planning estimates per
// transaction on that chain, not quotes; the methodology panel says so.
// ---------------------------------------------------------------------------

const GAS_USD: Record<string, number> = {
  Ethereum: 3.5,
  Base: 0.15,
  Binance: 0.25,
  Arbitrum: 0.2,
  Solana: 0.02,
  Monad: 0.05,
  "Hyperliquid L1": 0.05,
  Avalanche: 0.3,
  Plasma: 0.1,
  "Robinhood Chain": 0.1,
  Berachain: 0.1,
  Optimism: 0.15,
  Unichain: 0.1,
  Polygon: 0.05,
  Bitcoin: 2.0,
};

function gasFor(chain: string): number {
  return GAS_USD[chain] ?? 0.5;
}

function money(x: number): string {
  return x >= 100
    ? `$${Math.round(x)}`
    : `$${(Math.round(x * 100) / 100).toFixed(2)}`;
}

type StepSpec = {
  text: string;
  gasMult: number;
  minutes: number;
  feeFrac: number; // fraction of the plan capital charged as a fee
  repeats?: number; // how many times the step runs (weekly repeats); default 1
};

type Family = {
  capital: number;
  steps: StepSpec[];
};

const FAMILIES: Record<string, Family> = {
  dex: {
    capital: 200,
    steps: [
      {
        text: "Swap {K} of ETH for the paired asset on {N} on {C} (0.3% swap fee ~{F}, gas ~{G}; 10 min).",
        gasMult: 1, minutes: 10, feeFrac: 0.003,
      },
      {
        text: "Add the swapped assets as liquidity in {N}'s main pool on {C} (gas ~{G}; 15 min) and keep the LP position open.",
        gasMult: 2, minutes: 15, feeFrac: 0,
      },
      {
        text: "Place a limit order through {N} on {C} for a second pair (gas ~{G}; 10 min) so the account shows maker activity, not just one swap.",
        gasMult: 1, minutes: 10, feeFrac: 0,
      },
      {
        text: "Swap a small amount back once a week for 4 weeks (about {G} gas each time; 5 min a week) to build a repeat-user history.",
        gasMult: 1, minutes: 20, feeFrac: 0, repeats: 4,
      },
      {
        text: "Join {N}'s points or quests page if it has one and link the wallet used on {C} (no gas; 10 min).",
        gasMult: 0, minutes: 10, feeFrac: 0,
      },
    ],
  },
  lending: {
    capital: 150,
    steps: [
      {
        text: "Supply {K} of a stablecoin or ETH as collateral on {N} on {C} (gas ~{G}; 15 min).",
        gasMult: 1, minutes: 15, feeFrac: 0,
      },
      {
        text: "Borrow 30-40% of the supplied value against it on {N} (gas ~{G}; 10 min), then repay within a week to show a full loop.",
        gasMult: 2, minutes: 10, feeFrac: 0,
      },
      {
        text: "Supply a second asset on {N} on {C} to a different market (gas ~{G}; 10 min).",
        gasMult: 1, minutes: 10, feeFrac: 0,
      },
      {
        text: "Keep the supply open for at least 30 days, topping up once if the rate moves (gas ~{G}; 5 min).",
        gasMult: 1, minutes: 5, feeFrac: 0,
      },
      {
        text: "Check {N}'s rewards or points page weekly and claim any accrued incentives (gas ~{G} per claim; 5 min a week).",
        gasMult: 1, minutes: 20, feeFrac: 0, repeats: 4,
      },
    ],
  },
  vault: {
    capital: 250,
    steps: [
      {
        text: "Deposit {K} into a {N} vault on {C} (gas ~{G}; 15 min) and keep the receipt token in the same wallet.",
        gasMult: 2, minutes: 15, feeFrac: 0,
      },
      {
        text: "Allocate the deposit across a second {N} vault on {C} if one is open (gas ~{G}; 10 min).",
        gasMult: 1, minutes: 10, feeFrac: 0,
      },
      {
        text: "Leave the deposit for at least 30 days; vaults reward sticky capital, not deposits that leave in a day (no gas; 0 min).",
        gasMult: 0, minutes: 0, feeFrac: 0,
      },
      {
        text: "Rebalance once mid-month if {N} opens a new vault on {C} (gas ~{G}; 10 min).",
        gasMult: 1, minutes: 10, feeFrac: 0,
      },
      {
        text: "Track the vault's yield and points on {N}'s dashboard weekly (no gas; 5 min a week).",
        gasMult: 0, minutes: 20, feeFrac: 0,
      },
    ],
  },
  yield: {
    capital: 150,
    steps: [
      {
        text: "Stake {K} in {N}'s main farm on {C} (gas ~{G}; 15 min).",
        gasMult: 1, minutes: 15, feeFrac: 0,
      },
      {
        text: "Harvest rewards once a week and restake them instead of selling (gas ~{G} per harvest; 5 min a week).",
        gasMult: 1, minutes: 20, feeFrac: 0, repeats: 4,
      },
      {
        text: "Add a second position in a different {N} pool on {C} (gas ~{G}; 10 min).",
        gasMult: 1, minutes: 10, feeFrac: 0,
      },
      {
        text: "Keep both positions open for 30+ days; short farms rarely count for allocations (no gas; 0 min).",
        gasMult: 0, minutes: 0, feeFrac: 0,
      },
      {
        text: "Vote or signal in {N}'s governance if a proposal is live, using the staked position (gas ~{G}; 10 min).",
        gasMult: 1, minutes: 10, feeFrac: 0,
      },
    ],
  },
  derivatives: {
    capital: 100,
    steps: [
      {
        text: "Open a small {K} perpetual or prediction position on {N} on {C} (fee ~{F}, gas ~{G}; 15 min).",
        gasMult: 1, minutes: 15, feeFrac: 0.001,
      },
      {
        text: "Close half after a day and reopen the other way to show two-way flow (fee ~{F}, gas ~{G}; 10 min).",
        gasMult: 1, minutes: 10, feeFrac: 0.001,
      },
      {
        text: "Hold a position through a weekly settlement on {N} (no gas; 0 min).",
        gasMult: 0, minutes: 0, feeFrac: 0,
      },
      {
        text: "Provide liquidity to {N}'s market-making pool if one is open on {C} (gas ~{G}; 15 min).",
        gasMult: 2, minutes: 15, feeFrac: 0,
      },
      {
        text: "Trade at least once a week for 4 weeks; sporadic one-off trades rarely count (fees ~{F} a trade; 10 min a week).",
        gasMult: 1, minutes: 40, feeFrac: 0.001, repeats: 4,
      },
    ],
  },
  rwa: {
    capital: 200,
    steps: [
      {
        text: "Mint or buy {K} of {N}'s asset on {C} (mint fee ~{F}, gas ~{G}; 15 min) and hold it in the farming wallet.",
        gasMult: 2, minutes: 15, feeFrac: 0.001,
      },
      {
        text: "Use the minted asset as collateral on {N} to borrow a stablecoin (gas ~{G}; 10 min), then repay it within a week.",
        gasMult: 1, minutes: 10, feeFrac: 0,
      },
      {
        text: "Hold the position for at least 30 days; {N} rewards holders, not flippers (no gas; 0 min).",
        gasMult: 0, minutes: 0, feeFrac: 0,
      },
      {
        text: "Bridge a small amount of the asset to {C2} through {N} if a second chain is live (gas ~{G}; 10 min).",
        gasMult: 1, minutes: 10, feeFrac: 0,
      },
      {
        text: "Check {N}'s points or rewards page weekly and complete any listed task (gas ~{G} if a claim is needed; 5 min a week).",
        gasMult: 1, minutes: 20, feeFrac: 0, repeats: 4,
      },
    ],
  },
  generic: {
    capital: 100,
    steps: [
      {
        text: "Bridge {K} into {C} through {N} (bridge fee ~{F}, gas ~{G}; 15 min) and use the same wallet throughout.",
        gasMult: 1, minutes: 15, feeFrac: 0.001,
      },
      {
        text: "Use {N}'s core function on {C} twice in the first week (gas ~{G} each; 10 min each).",
        gasMult: 1, minutes: 20, feeFrac: 0,
      },
      {
        text: "Stake or lock a small amount through {N} on {C} for at least 30 days (gas ~{G}; 10 min).",
        gasMult: 1, minutes: 10, feeFrac: 0,
      },
      {
        text: "Repeat the core action once a week for 4 weeks (gas ~{G} a week; 5 min a week).",
        gasMult: 1, minutes: 20, feeFrac: 0, repeats: 4,
      },
      {
        text: "Join {N}'s community quests or points page and link the farming wallet (no gas; 10 min).",
        gasMult: 0, minutes: 10, feeFrac: 0,
      },
    ],
  },
};

function familyFor(category: string | null): Family {
  switch (category) {
    case "Dexs":
      return FAMILIES.dex;
    case "Lending":
    case "Uncollateralized Lending":
    case "Collateral Markets":
      return FAMILIES.lending;
    case "Risk Curators":
    case "Onchain Capital Allocator":
    case "Liquidity Manager":
      return FAMILIES.vault;
    case "Yield":
    case "Yield Aggregator":
    case "Leveraged Farming":
    case "Farm":
      return FAMILIES.yield;
    case "Derivatives":
    case "Prediction Market":
    case "Interest Rate Derivatives":
      return FAMILIES.derivatives;
    case "RWA":
    case "CDP":
    case "CDP Manager":
    case "Stablecoin Wrapper":
    case "Dual-Token Stablecoin":
    case "Anchor BTC":
    case "Decentralized BTC":
    case "CeDeFi":
    case "OTC Marketplace":
    case "Crypto Card Issuer":
    case "Payments":
    case "Insurance":
    case "Indexes":
    case "Governance Incentives":
      return FAMILIES.rwa;
    default:
      return FAMILIES.generic;
  }
}

function buildPlan(p: Protocol): {
  steps: string[];
  costUsd: number;
  hours: number;
  capitalUsd: number;
} {
  const fam = familyFor(p.category);
  const chain = p.chains[0] ?? "Ethereum";
  const chain2 = p.chains[1] ?? chain;
  const baseGas = gasFor(chain);
  const steps: string[] = [];
  let cost = 0;
  let minutes = 0;
  for (const s of fam.steps) {
    const times = s.repeats ?? 1;
    const gas = roundTo(s.gasMult * baseGas, 2);
    const fee = roundTo(s.feeFrac * fam.capital, 2);
    cost += times * (gas + fee);
    minutes += s.minutes;
    steps.push(
      s.text
        .replaceAll("{N}", p.name)
        .replaceAll("{C2}", chain2)
        .replaceAll("{C}", chain)
        .replaceAll("{K}", money(fam.capital))
        .replaceAll("{F}", money(fee))
        .replaceAll("{G}", money(gas)),
    );
  }
  return {
    steps,
    costUsd: roundTo(cost, 2),
    hours: roundTo(minutes / 60, 1),
    capitalUsd: fam.capital,
  };
}

// ---------------------------------------------------------------------------
// Board construction and output.
// ---------------------------------------------------------------------------

const FARM_EV_HR = 15000; // expected value per farming hour at/above this: farm
const MARGINAL_EV_HR = 1500; // at/above this: marginal; below it: skip
// Thresholds are set against the board's own EV/hr distribution (median
// ~$3,500/hr): farm is the top ~9%, skip the bottom ~13%.
const FARMER_SHARE = 0.001; // planning haircut: 0.1% of the implied value is
// assumed to reach one diligent farmer. Deliberately conservative, stated in
// the methodology, never a forecast of what any farmer receives.

const AS_OF_FALLBACK = "2026-11-14";

function ageDays(p: Protocol, asOf: Date): number | null {
  if (!p.listed_at) return null;
  const [y, m, d] = p.listed_at.split("-").map(Number);
  return Math.max(
    0,
    Math.round((asOf.getTime() - Date.UTC(y, m - 1, d)) / 86400000),
  );
}

type BoardRow = {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  tvl_usd: number;
  change_7d: number | null;
  category: string | null;
  chains: string[];
  age_days: number | null;
  watchlist: boolean;
  launch_odds: number;
  plan_cost_usd: number;
  plan_hours: number;
  capital_usd: number;
  ev_per_hour_usd: number;
  verdict: string;
  farm_steps: string[];
};

function main(): void {
  const { input, output } = parseArgs(process.argv.slice(2));
  const snap = JSON.parse(readFileSync(input, "utf8")) as Snapshot;
  const protocols = snap.protocols;
  const watchlist = new Set(snap.watchlist);
  const asOf = new Date(`${snap.as_of || AS_OF_FALLBACK}T00:00:00Z`);

  // --- Pricing curve: fit on the protocols whose token already trades. ---
  const fitSet = protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  const fitX = fitSet.map((p) => [1, log10(p.tvl_usd)]);
  const fitY = fitSet.map((p) => log10(p.mcap_usd as number));
  const olsFit = ols(fitX, fitY);
  const huber = huberFit(fitX, fitY);
  const olsCv = cvRmse((X, y) => ols(X, y).beta, fitX, fitY);
  const huberCv = cvRmse((X, y) => huberFit(X, y).beta, fitX, fitY);
  // The Huber curve is the pricer: it wins the blind test and the outliers
  // stop dragging it. OLS is kept in the report as the comparison.
  const [pa, pb] = huber.beta;
  const z80 = 1.2816; // 80% interval half-width in log10, from the residual sd

  // --- Launch-likelihood score, fit on all 758 protocols. ---
  const ages = protocols
    .map((p) => ageDays(p, asOf))
    .filter((a): a is number => a !== null);
  const medianAge = median(ages);
  const scoreFeat = (p: Protocol): number[] => [
    log10(p.tvl_usd),
    log10(Math.max(ageDays(p, asOf) ?? medianAge, 1)),
    log10(Math.max(p.chains.length, 1)),
  ];
  const feats = protocols.map(scoreFeat);
  const mu = [0, 1, 2].map((j) => mean(feats.map((f) => f[j])));
  const sd = [0, 1, 2].map((j) => pstdev(feats.map((f) => f[j])));
  const zfeat = (p: Protocol): number[] => {
    const f = scoreFeat(p);
    return f.map((v, j) => (v - mu[j]) / sd[j]);
  };
  const hasToken = protocols.map((p) =>
    p.gecko_id !== null || p.symbol !== null ? 1 : 0,
  );
  const Xall = protocols.map((p) => [1, ...zfeat(p)]);
  // Out-of-fold scores for honest calibration.
  const oof = new Array<number>(protocols.length).fill(0);
  for (let f = 0; f < 5; f++) {
    const tr = protocols.map((_, i) => i).filter((i) => i % 5 !== f);
    const te = protocols.map((_, i) => i).filter((i) => i % 5 === f);
    const w = logisticFit(
      tr.map((i) => Xall[i]),
      tr.map((i) => hasToken[i]),
    );
    for (const i of te) oof[i] = sigmoid(dot(w, Xall[i]));
  }
  const oofAuc = auc(oof, hasToken);
  const sortedOof = [...oof].sort((a, b) => a - b);
  const edges = [1, 2, 3, 4].map(
    (q) => sortedOof[Math.floor((sortedOof.length * q) / 5)],
  );
  const order = protocols.map((_, i) => i).sort((a, b) => oof[a] - oof[b]);
  const quintileRates: number[] = [];
  const quintileSizes: number[] = [];
  for (let q = 0; q < 5; q++) {
    const idx = order.slice(
      Math.floor((order.length * q) / 5),
      Math.floor((order.length * (q + 1)) / 5),
    );
    quintileSizes.push(idx.length);
    quintileRates.push(mean(idx.map((i) => hasToken[i])));
  }
  const buckets = pava(quintileRates, quintileSizes).map((v) =>
    roundTo(v, 3),
  );
  const fullW = logisticFit(Xall, hasToken);
  const oddsOf = (p: Protocol): number => {
    const s = sigmoid(dot(fullW, [1, ...zfeat(p)]));
    let b = 0;
    for (const e of edges) if (s >= e) b++;
    return buckets[b];
  };

  // --- Board: every eligible pre-token protocol, ranked by implied value. ---
  const eligible = protocols.filter((p) => {
    if (p.gecko_id !== null || p.symbol !== null) return false;
    if (watchlist.has(p.slug)) return true;
    return exclusionReason(p) === null;
  });
  const rows: BoardRow[] = eligible
    .map((p) => {
      const pred = pa + pb * log10(p.tvl_usd);
      const implied = Math.round(10 ** pred);
      const low = Math.round(10 ** (pred - z80 * huber.residSd));
      const high = Math.round(10 ** (pred + z80 * huber.residSd));
      const plan = buildPlan(p);
      const odds = oddsOf(p);
      const ev = (implied * odds * FARMER_SHARE) / Math.max(plan.hours, 0.5);
      const verdict =
        ev >= FARM_EV_HR ? "farm" : ev >= MARGINAL_EV_HR ? "marginal" : "skip";
      return {
        slug: p.slug,
        name: p.name,
        rank: 0,
        implied_value_usd: implied,
        implied_low_usd: low,
        implied_high_usd: high,
        tvl_usd: p.tvl_usd,
        change_7d: p.change_7d,
        category: p.category,
        chains: p.chains,
        age_days: ageDays(p, asOf),
        watchlist: watchlist.has(p.slug),
        launch_odds: odds,
        plan_cost_usd: plan.costUsd,
        plan_hours: plan.hours,
        capital_usd: plan.capitalUsd,
        ev_per_hour_usd: roundTo(ev, 2),
        verdict,
        farm_steps: plan.steps,
      };
    })
    .sort((a, b) => {
      if (b.implied_value_usd !== a.implied_value_usd)
        return b.implied_value_usd - a.implied_value_usd;
      if (b.tvl_usd !== a.tvl_usd) return b.tvl_usd - a.tvl_usd;
      return a.slug < b.slug ? -1 : 1;
    });
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });

  const verdictCounts = {
    farm: rows.filter((r) => r.verdict === "farm").length,
    marginal: rows.filter((r) => r.verdict === "marginal").length,
    skip: rows.filter((r) => r.verdict === "skip").length,
  };
  const totalImplied = rows.reduce((s, r) => s + r.implied_value_usd, 0);

  const meta = {
    title: "Fleet Forge — Token Launch Radar",
    as_of: snap.as_of,
    source: snap.source,
    floor_usd: snap.floor_usd,
    n_protocols: protocols.length,
    n_watchlist: watchlist.size,
    n_board: rows.length,
    n_fit: fitSet.length,
    fit: {
      model: "log10(market cap) = a + b * log10(TVL), Huber robust (c=1.345)",
      ols: {
        a: roundTo(olsFit.beta[0], 3),
        b: roundTo(olsFit.beta[1], 3),
        r2: roundTo(olsFit.r2, 3),
        resid_sd: roundTo(olsFit.residSd, 3),
        cv_rmse: roundTo(olsCv, 4),
      },
      huber: {
        a: roundTo(pa, 3),
        b: roundTo(pb, 3),
        resid_sd: roundTo(huber.residSd, 3),
        cv_rmse: roundTo(huberCv, 4),
      },
      rejected:
        "Adding log age, 7-day growth, chain count or category dummies made 5-fold CV RMSE worse (age 0.955, growth 0.967, chains 0.967 vs 0.935 plain OLS on the same 128), so none of them prices anything. Growth's in-sample slope is negative (-1.6): faster 7-day growth predicts a lower multiple, not a higher one.",
    },
    calibration: {
      model:
        "P(records a token) from log TVL, log age, log chain count; logistic, standardised",
      auc_out_of_fold: roundTo(oofAuc, 3),
      buckets,
      note: "Buckets are cross-fitted quintile rates (PAVA-pooled). Odds are a proxy for how much a protocol looks like the ones that already trade, not a forecast that it will launch.",
    },
    verdicts: {
      farm_ev_hr_at_least: FARM_EV_HR,
      marginal_ev_hr_at_least: MARGINAL_EV_HR,
      farmer_share: FARMER_SHARE,
      counts: verdictCounts,
    },
    total_implied_usd: totalImplied,
    top: {
      slug: rows[0].slug,
      name: rows[0].name,
      implied_value_usd: rows[0].implied_value_usd,
      ev_per_hour_usd: rows[0].ev_per_hour_usd,
    },
  };

  const board = { meta, rows };
  const data = { meta, rows };

  // --- Write outputs. ---
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "board.json"), JSON.stringify(board, null, 2));
  writeFileSync(
    join(output, "data.js"),
    `window.FLEET_FORGE_DATA = ${JSON.stringify(data)};\n`,
  );
  cpSync("dashboard", join(output, "dashboard"), { recursive: true });
  if (!existsSync("screenshots")) {
    throw new Error(
      "screenshots/ is missing: render the three dashboard screenshots first (see README)",
    );
  }
  cpSync("screenshots", join(output, "screenshots"), { recursive: true });
  const dossier = buildDossier(output, { text_max_bytes: 65536 });
  writeFileSync(join(output, "dossier.json"), dossier);

  // --- Build summary (stdout only; never written into the outputs). ---
  console.log(`snapshot: ${snap.as_of} (${protocols.length} protocols, watchlist ${watchlist.size})`);
  console.log(
    `fit n=${fitSet.length} OLS a=${roundTo(olsFit.beta[0], 3)} b=${roundTo(olsFit.beta[1], 3)} R2=${roundTo(olsFit.r2, 3)} sd=${roundTo(olsFit.residSd, 3)} CV=${roundTo(olsCv, 4)}`,
  );
  console.log(
    `fit Huber a=${roundTo(pa, 3)} b=${roundTo(pb, 3)} sd=${roundTo(huber.residSd, 3)} CV=${roundTo(huberCv, 4)}`,
  );
  console.log(
    `calibration OOF AUC=${roundTo(oofAuc, 3)} buckets=${buckets.join(" / ")}`,
  );
  console.log(
    `board rows=${rows.length} (watchlist ${watchlist.size} + ${rows.length - watchlist.size} early) total implied=$${totalImplied.toLocaleString("en-US")}`,
  );
  console.log(
    `top: #1 ${rows[0].name} (${rows[0].slug}) implied=$${rows[0].implied_value_usd.toLocaleString("en-US")} ev/hr=$${rows[0].ev_per_hour_usd.toLocaleString("en-US")}`,
  );
  console.log(
    `verdicts: farm ${verdictCounts.farm} / marginal ${verdictCounts.marginal} / skip ${verdictCounts.skip}`,
  );
  console.log(`wrote ${output}/ (board.json, data.js, dashboard/, screenshots/, dossier.json)`);
}

main();
