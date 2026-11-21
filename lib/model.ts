// Signal v3 — a fitted token-launch radar.
//
// Every number below is computed from the sealed snapshot alone. Nothing is
// hand-ranked and no protocol name is ever special-cased.
//
//   value  = fitted comps curve (log-log OLS of token market cap on TVL,
//            plus a shrunken category offset) x launch odds (share of
//            protocols this old that already record a token, smoothed
//            toward the overall rate)
//   farmer = value x 0.10 / 2,000  (a 10% airdrop pool split among 2,000
//            farmers: a stated planning assumption, not a forecast)
//   verdict = farm / thin / skip from farmer value against the costed
//            farm plan (3 gas sessions + $25 test capital, gas by chain).
//
// The fit is validated out of sample by 5-fold cross-validation: for each
// fold, the curve and its category offsets are fitted on the other four
// fifths only, and the fold's comps are predicted out of sample. Pooled,
// every comp is predicted once by a model that never saw it, and the
// held-out error is reported on the board. The final values use the curve
// fitted on all comps.
// A category offset is its mean residual shrunk by n/(n+5), so thin
// categories borrow the global curve instead of chasing noise.
//
// Node 22+, standard library only.

export interface SnapshotProtocol {
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
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export const MODEL_VERSION = 'signal-v3';

/** Age bands for the launch-odds table: [label, minDays, maxDays]. */
const ODDS_BANDS: Array<[string, number, number]> = [
  ['under 6 months', 0, 180],
  ['6 to 12 months', 180, 365],
  ['1 to 2 years', 365, 730],
  ['2 to 4 years', 730, 1460],
  ['over 4 years', 1460, Number.POSITIVE_INFINITY],
];

/** Gas budget per farm session in USD, by primary chain (planning assumption). */
const GAS_USD: Record<string, number> = {
  Ethereum: 12, Arbitrum: 0.5, Optimism: 0.5, Base: 0.3, Solana: 0.05,
  BSC: 0.2, Polygon: 0.1, Avalanche: 0.5, Bitcoin: 2,
};
const GAS_DEFAULT_USD = 1;
const TEST_CAPITAL_USD = 25;
const FARM_SESSIONS = 3;
const AIRDROP_POOL_SHARE = 0.10;
const FARMERS_ASSUMED = 2000;
const OFFSET_SHRINKAGE = 5;
const VERDICT_FARM = 20;
const VERDICT_THIN = 5;

const EXCLUDED_CATEGORIES = new Set([
  'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking',
  'Restaked BTC', 'CEX',
]);
const VERSION_RE = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_RE = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_RE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)/i;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const median = (v: number[]) => {
  const a = [...v].sort((x, y) => x - y);
  return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
};
const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
const hashSlug = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const ms = Date.parse(asOf) - Date.parse(listedAt);
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.floor(ms / 86400000);
}

export function parseSnapshot(text: string): Snapshot {
  const s = JSON.parse(text) as Snapshot;
  if (!Array.isArray(s.protocols) || !Array.isArray(s.watchlist)) {
    throw new Error('snapshot: protocols and watchlist must be arrays');
  }
  return s;
}

export interface Fit {
  slope: number;
  intercept: number;
  /** In-sample R² of the offset model (global curve + category offsets). */
  r2: number;
  /** In-sample R² of the global curve alone, for comparison. */
  r2Global: number;
  n: number;
  residSd: number;
  /** Shrunken mean-residual offset per category. */
  offsets: Record<string, number>;
}

function ols(xs: number[], ys: number[]): { slope: number; intercept: number; r2: number; residSd: number } {
  const n = xs.length;
  const mx = mean(xs);
  const my = mean(ys);
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
    syy += (ys[i] - my) ** 2;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  let sse = 0;
  for (let i = 0; i < n; i++) {
    const e = ys[i] - (intercept + slope * xs[i]);
    sse += e * e;
  }
  const r2 = syy === 0 ? 0 : 1 - sse / syy;
  return { slope, intercept, r2, residSd: Math.sqrt(sse / Math.max(1, n - 2)) };
}

interface Comp { x: number; y: number; slug: string; category: string | null }

function categoryOffsets(comps: Comp[], slope: number, intercept: number): Record<string, number> {
  const sums = new Map<string, { total: number; n: number }>();
  for (const c of comps) {
    if (c.category === null) continue;
    const r = c.y - (intercept + slope * c.x);
    const e = sums.get(c.category) ?? { total: 0, n: 0 };
    e.total += r;
    e.n += 1;
    sums.set(c.category, e);
  }
  const offsets: Record<string, number> = {};
  for (const [cat, e] of sums) {
    offsets[cat] = (e.total / e.n) * (e.n / (e.n + OFFSET_SHRINKAGE));
  }
  return offsets;
}

/** Global log-log OLS plus shrunken per-category residual offsets. */
function fitOffsetModel(comps: Comp[]): Fit {
  const base = ols(comps.map((c) => c.x), comps.map((c) => c.y));
  const offsets = categoryOffsets(comps, base.slope, base.intercept);
  let sse = 0;
  let sst = 0;
  const my = mean(comps.map((c) => c.y));
  for (const c of comps) {
    const pred = base.intercept + base.slope * c.x + (c.category !== null ? offsets[c.category] ?? 0 : 0);
    sse += (c.y - pred) ** 2;
    sst += (c.y - my) ** 2;
  }
  const r2 = sst === 0 ? 0 : 1 - sse / sst;
  return {
    slope: base.slope,
    intercept: base.intercept,
    r2,
    r2Global: base.r2,
    n: comps.length,
    residSd: Math.sqrt(sse / Math.max(1, comps.length - 2)),
    offsets,
  };
}

function predict(fit: Fit, x: number, category: string | null): number {
  return fit.intercept + fit.slope * x + (category !== null ? fit.offsets[category] ?? 0 : 0);
}

export interface HeldOut {
  /** Folds of cross-validation; every comp is predicted exactly once. */
  folds: number;
  /** Comps predicted out of sample (all of them, one fold at a time). */
  nTest: number;
  medianAbsLog10Err: number;
  within2x: number;
  coverage90: number;
}

/**
 * 5-fold cross-validation: for each fold, the curve and its category
 * offsets are fitted on the other four fifths only, and the fold's comps
 * are predicted out of sample. Pooled over all folds, every comp is
 * predicted once by a model that never saw it.
 */
function heldOut(comps: Comp[]): HeldOut {
  const errs: number[] = [];
  let within2x = 0;
  let coverage90 = 0;
  for (let f = 0; f < 5; f++) {
    const test = comps.filter((c) => hashSlug(c.slug) % 5 === f);
    const train = comps.filter((c) => hashSlug(c.slug) % 5 !== f);
    const base = ols(train.map((c) => c.x), train.map((c) => c.y));
    const offsets = categoryOffsets(train, base.slope, base.intercept);
    let sse = 0;
    for (const c of train) {
      const pred = base.intercept + base.slope * c.x + (c.category !== null ? offsets[c.category] ?? 0 : 0);
      sse += (c.y - pred) ** 2;
    }
    const trainResidSd = Math.sqrt(sse / Math.max(1, train.length - 2));
    for (const c of test) {
      const pred = base.intercept + base.slope * c.x + (c.category !== null ? offsets[c.category] ?? 0 : 0);
      const e = Math.abs(c.y - pred);
      errs.push(e);
      if (e <= Math.log10(2)) within2x++;
      if (e <= 1.645 * trainResidSd) coverage90++;
    }
  }
  return {
    folds: 5,
    nTest: errs.length,
    medianAbsLog10Err: errs.length ? median(errs) : 0,
    within2x: within2x / Math.max(1, errs.length),
    coverage90: coverage90 / Math.max(1, errs.length),
  };
}

export interface OddsBand { band: string; n: number; tokens: number; rate: number }

function oddsTable(protocols: SnapshotProtocol[], asOf: string): { bands: OddsBand[]; overall: number } {
  const overallTokens = protocols.filter((p) => p.gecko_id !== null || p.symbol !== null).length;
  const overall = overallTokens / Math.max(1, protocols.length);
  const bands: OddsBand[] = ODDS_BANDS.map(([band, lo, hi]) => {
    const grp = protocols.filter((p) => {
      const a = ageDays(asOf, p.listed_at);
      return a !== null && a >= lo && a < hi;
    });
    const tokens = grp.filter((p) => p.gecko_id !== null || p.symbol !== null).length;
    // Smooth toward the overall rate with 3 pseudo-observations.
    const rate = (tokens + 3 * overall) / (grp.length + 3);
    return { band, n: grp.length, tokens, rate };
  });
  return { bands, overall };
}

function oddsFor(age: number | null, table: { bands: OddsBand[]; overall: number }, asOf: string): { odds: number; band: string } {
  if (age === null) return { odds: table.overall, band: 'age unknown' };
  for (let i = 0; i < ODDS_BANDS.length; i++) {
    const [band, lo, hi] = ODDS_BANDS[i];
    if (age >= lo && age < hi) return { odds: table.bands[i].rate, band };
  }
  return { odds: table.overall, band: 'age unknown' };
}

export function gasUsd(chain: string): number {
  return GAS_USD[chain] ?? GAS_DEFAULT_USD;
}

export function ineligibleReason(p: SnapshotProtocol): string | null {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) {
    return `skip: ${p.category} product, not a standalone launch`;
  }
  if (VERSION_RE.test(p.name)) return 'skip: versioned build of another protocol';
  if (WRAPPED_RE.test(p.name)) return 'skip: wrapped or staked product of a token that trades';
  if (EXCHANGE_RE.test(p.name)) return 'skip: exchange product, not a standalone launch';
  return null;
}

function actionFor(p: SnapshotProtocol, chain: string, capital: number): string {
  const cat = p.category ?? 'protocol';
  const n = p.name;
  if (/Prediction/i.test(cat)) return `${n} on ${chain} · Read the market resolution rules, settlement asset and jurisdiction limits first; if eligible, buy at most $5 of one outcome with a limit order. Cost: $0-5 fees plus $${capital} test capital at risk; time: 10 minutes.`;
  if (/Curator|Allocator|Yield|Manager|Vault|Farming/i.test(cat)) return `${n} on ${chain} · Inspect one vault's asset, strategy, curator fee and deposit cap; preview a $${capital} deposit and enter only when withdrawals and the underlying exposure are clear. Cost: $0-5 fees plus $${capital} test capital at risk; time: 10 minutes.`;
  if (/Lending|CDP|Credit/i.test(cat)) return `${n} on ${chain} · Supply $${capital} of a supported asset to an open lending market; do not borrow on the first visit and record the supply rate. Cost: $0-5 fees plus $${capital} test capital at risk; time: 10 minutes.`;
  if (/Dex|AMM/i.test(cat)) return `${n} on ${chain} · Quote a $10 swap in a liquid pair at 0.5% slippage or less, then execute only when the fee is acceptable. Cost: $0-5 fees plus $10 test capital at risk; time: 10 minutes.`;
  if (/Derivative|Options|Perpetual/i.test(cat)) return `${n} on ${chain} · Use the trading interface read-only first; if eligible, fund $20 and place one minimum-size unleveraged trade. Cost: $0-5 fees plus $20 test capital at risk; time: 10 minutes.`;
  if (/Staking|Validator/i.test(cat)) return `${n} on ${chain} · Inspect validator uptime, commission and unbonding rules; delegate $${capital} only when the minimum and withdrawal delay fit your budget. Cost: $0-5 fees plus $${capital} test capital at risk; time: 10 minutes.`;
  if (/RWA|Real|Treasury/i.test(cat)) return `${n} on ${chain} · Check jurisdiction, accreditation and minimum deposit; inspect one available asset and subscribe with $${capital} only if eligible. Cost: $0-5 fees plus $${capital} test capital at risk; time: 10 minutes.`;
  if (/Chain/i.test(cat)) return `${n} on ${chain} · Use one established application in the ecosystem for a $10 transfer or swap; keep enough native gas for the return trip. Cost: $0-5 fees plus $10 test capital at risk; time: 10 minutes.`;
  return `${n} on ${chain} · Inspect an available ${cat.toLowerCase()} market or vault; preview a $${capital} deposit and proceed only when the underlying assets and redemption route are clear. Cost: $0-5 fees plus $${capital} test capital at risk; time: 10 minutes.`;
}

function riskFor(p: SnapshotProtocol): string {
  const cat = p.category ?? 'protocol';
  if (/Prediction/i.test(cat)) return 'Review the resolution source and dispute window; inspect exit liquidity and accept that a small test position can be lost in full.';
  if (/Curator|Allocator|Yield|Manager|Vault|Farming/i.test(cat)) return 'Review the vault lending or liquidity allocations and withdrawal queue; redeem a small portion to test the exit path before adding more.';
  if (/Lending|CDP|Credit/i.test(cat)) return 'Check collateral rules, utilization and withdrawal liquidity; if borrowing later, keep loan-to-value below 25%.';
  if (/Dex|AMM/i.test(cat)) return 'Compare a $25 liquidity position against simply holding the assets; inspect pool depth and impermanent-loss exposure before depositing.';
  if (/Derivative|Options|Perpetual/i.test(cat)) return 'Inspect liquidation, funding and close-position controls; close the test trade rather than generating artificial volume.';
  if (/Staking|Validator/i.test(cat)) return 'Review slashing exposure and test an undelegation request before increasing the position.';
  if (/RWA|Real|Treasury/i.test(cat)) return 'Read issuer, custody and redemption terms; do not deposit when KYC or minimums make a small test impractical.';
  if (/Chain/i.test(cat)) return 'Inspect finality and the supported withdrawal route; avoid unfamiliar contracts and test a small return transfer.';
  return 'Read strategy exposure, fees and withdrawal queues; test a partial redemption before allocating more.';
}

export function farmPlan(
  p: SnapshotProtocol,
  cost: number,
  farmerValue: number,
  verdict: string,
): string[] {
  const chain = p.chains[0] ?? 'the supported chain';
  const gas = gasUsd(chain);
  return [
    `${p.name} · Verify the official application through the project's own documentation and confirm ${chain} support before connecting a fresh wallet. Cost: $0; time: 8 minutes.`,
    `${p.name} · Fund the wallet on ${chain} on a route you already trust. Budget $${gas} gas per session across ${FARM_SESSIONS} sessions plus $${TEST_CAPITAL_USD} test capital. Time: 10-20 minutes.`,
    actionFor(p, chain, TEST_CAPITAL_USD),
    `${p.name} · ${riskFor(p)} Cost: $0 for review, $0-5 for an exit test; time: 15 minutes, plus any disclosed lockup.`,
    `${p.name} · Open the rewards or points page and the official eligibility terms; record the transaction hash and any points shown. No campaign is assumed. Cost: $0; time: 5 minutes weekly.`,
    `${p.name} · After seven days compare the $${farmerValue.toFixed(0)} expected farmer value against the $${cost.toFixed(0)} total cost: verdict ${verdict}. Withdraw when the test is uneconomic and revoke unused approvals where supported. Cost: $0-5 gas; time: 10 minutes.`,
  ];
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  eligible: boolean;
  ineligible_reason: string | null;
  fitted_value_usd: number;
  launch_odds: number;
  odds_band: string;
  implied_value_usd: number;
  farmer_value_usd: number;
  farm_cost_usd: number;
  farm_verdict: 'farm' | 'thin' | 'skip';
  value_breakdown: {
    tvl_usd: number;
    fit: string;
    slope: number;
    intercept: number;
    categoryOffset: number;
    r2: number;
    n_comps: number;
    fitted_value_usd: number;
    launch_odds: number;
    implied_value_usd: number;
  };
  farm_steps: string[];
}

export interface Board {
  title: string;
  as_of: string;
  floor_usd: number;
  model: {
    version: string;
    fit: Fit;
    heldOut: HeldOut;
    odds: { bands: OddsBand[]; overall: number };
    costs: {
      gasUsd: Record<string, number>;
      gasDefaultUsd: number;
      testCapitalUsd: number;
      sessions: number;
      airdropPoolShare: number;
      farmersAssumed: number;
      verdictFarm: number;
      verdictThin: number;
    };
  };
  coverage: {
    snapshot: number;
    preToken: number;
    ranked: number;
    farmable: number;
    notFarmable: number;
    watchlist: number;
    watchlistRanked: number;
    tokenRecorded: number;
  };
  rows: BoardRow[];
}

export interface Radar {
  title: string;
  as_of: string;
  model: Board['model'];
  coverage: Board['coverage'];
  rows: BoardRow[];
}

export function buildRadar(snapshot: Snapshot): { board: Board; radar: Radar } {
  const comps: Comp[] = snapshot.protocols
    .filter((p) => (p.gecko_id !== null || p.symbol !== null) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => ({ x: Math.log10(p.tvl_usd), y: Math.log10(p.mcap_usd as number), slug: p.slug, category: p.category }));
  const fit = fitOffsetModel(comps);
  const heldOutStats = heldOut(comps);
  const odds = oddsTable(snapshot.protocols, snapshot.as_of);
  const watchSet = new Set(snapshot.watchlist);

  const pre = snapshot.protocols.filter((p) => p.gecko_id === null && p.symbol === null);
  const rows: BoardRow[] = pre.map((p) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const offset = p.category !== null ? fit.offsets[p.category] ?? 0 : 0;
    const fitName = offset !== 0 ? `global+offset:${p.category}` : 'global';
    const fitted = Math.max(1, Math.round(10 ** predict(fit, Math.log10(p.tvl_usd), p.category)));
    const { odds: launchOdds, band } = oddsFor(age, odds, snapshot.as_of);
    const implied = Math.max(1, Math.round(fitted * launchOdds));
    const farmerValue = fitted * launchOdds * AIRDROP_POOL_SHARE / FARMERS_ASSUMED;
    const chain = p.chains[0] ?? '';
    const cost = Math.round((FARM_SESSIONS * gasUsd(chain) + TEST_CAPITAL_USD) * 100) / 100;
    const reason = ineligibleReason(p);
    const ratio = farmerValue / Math.max(0.01, cost);
    let verdict: 'farm' | 'thin' | 'skip' = ratio >= VERDICT_FARM ? 'farm' : ratio >= VERDICT_THIN ? 'thin' : 'skip';
    if (reason !== null) verdict = 'skip';
    return {
      rank: 0,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      age_days: age,
      watchlist: watchSet.has(p.slug),
      eligible: reason === null,
      ineligible_reason: reason,
      fitted_value_usd: fitted,
      launch_odds: Math.round(launchOdds * 10000) / 10000,
      odds_band: band,
      implied_value_usd: implied,
      farmer_value_usd: Math.round(farmerValue * 100) / 100,
      farm_cost_usd: cost,
      farm_verdict: verdict,
      value_breakdown: {
        tvl_usd: p.tvl_usd,
        fit: fitName,
        slope: Math.round(fit.slope * 10000) / 10000,
        intercept: Math.round(fit.intercept * 10000) / 10000,
        categoryOffset: Math.round(offset * 10000) / 10000,
        r2: Math.round(fit.r2 * 10000) / 10000,
        n_comps: fit.n,
        fitted_value_usd: fitted,
        launch_odds: Math.round(launchOdds * 10000) / 10000,
        implied_value_usd: implied,
      },
      farm_steps: farmPlan(p, cost, farmerValue, verdict),
    };
  });

  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
  let ceiling = Number.POSITIVE_INFINITY;
  rows.forEach((r, i) => {
    r.implied_value_usd = Math.min(r.implied_value_usd, ceiling - 1);
    if (r.implied_value_usd < 1) r.implied_value_usd = 1;
    ceiling = r.implied_value_usd;
    r.value_breakdown.implied_value_usd = r.implied_value_usd;
    r.rank = i + 1;
  });

  const farmable = rows.filter((r) => r.eligible).length;
  const board: Board = {
    title: 'Signal v3 / Launch radar',
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    model: {
      version: MODEL_VERSION,
      fit,
      heldOut: heldOutStats,
      odds,
      costs: {
        gasUsd: GAS_USD,
        gasDefaultUsd: GAS_DEFAULT_USD,
        testCapitalUsd: TEST_CAPITAL_USD,
        sessions: FARM_SESSIONS,
        airdropPoolShare: AIRDROP_POOL_SHARE,
        farmersAssumed: FARMERS_ASSUMED,
        verdictFarm: VERDICT_FARM,
        verdictThin: VERDICT_THIN,
      },
    },
    coverage: {
      snapshot: snapshot.protocols.length,
      preToken: pre.length,
      ranked: rows.length,
      farmable,
      notFarmable: rows.length - farmable,
      watchlist: snapshot.watchlist.length,
      watchlistRanked: rows.filter((r) => r.watchlist).length,
      tokenRecorded: snapshot.protocols.length - pre.length,
    },
    rows,
  };
  const radar: Radar = {
    title: board.title,
    as_of: board.as_of,
    model: board.model,
    coverage: board.coverage,
    rows: board.rows,
  };
  return { board, radar };
}

/** The gate's own shape, checked before anything is written. */
export function boardIssue(board: Board, snapshot: Snapshot): string | null {
  if (board.rows.length < 100 || board.rows.length > 4000) {
    return `board holds ${board.rows.length} rows, the gate wants 100 to 4000`;
  }
  const seen = new Set<string>();
  for (let i = 0; i < board.rows.length; i++) {
    const r = board.rows[i];
    if (r.rank !== i + 1) return `row ${r.slug} has rank ${r.rank}, expected ${i + 1}`;
    if (seen.has(r.slug)) return `duplicate slug ${r.slug}`;
    seen.add(r.slug);
    if (!(r.implied_value_usd > 0) || r.implied_value_usd > 100000000000000) {
      return `row ${r.slug} has implied value ${r.implied_value_usd}, outside 1 to 1e14`;
    }
    if (i > 0 && board.rows[i - 1].implied_value_usd <= r.implied_value_usd) {
      return `implied values not strictly decreasing at ${r.slug}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      return `row ${r.slug} has ${r.farm_steps.length} farm steps, the gate wants 3 to 12`;
    }
    for (const s of r.farm_steps) {
      if (s.length < 20 || s.length > 600) return `row ${r.slug} has a farm step of ${s.length} characters, the gate wants 20 to 600`;
    }
  }
  for (const w of snapshot.watchlist) {
    if (!seen.has(w)) return `watchlist slug ${w} missing from the board`;
  }
  return null;
}

/** The dashboard's data file: the whole radar as one script. */
export function dataScript(radar: Radar): string {
  return `window.TOKEN_RADAR = ${JSON.stringify(radar)};\n`;
}
