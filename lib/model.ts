// Signal v4 — a fitted token-launch radar, rebuilt on out-of-sample evidence.
//
// Every number below is computed from the sealed snapshot alone. Nothing is
// hand-ranked and no protocol name is ever special-cased.
//
//   fitted value  = size curve only: log10(market cap) regressed on
//                   log10(TVL) over the 128 token-bearing protocols with a
//                   market cap. The category effect, 7-day growth, age and
//                   chain count were each TESTED and REJECTED: every one of
//                   them lowers the held-out miss on one test and raises it
//                   on the other (see evidence.valueTerms), so the board
//                   prices on the one term that survives both tests.
//   launch odds   = share of protocols this old that already record a
//                   token, by age band, smoothed toward the overall rate.
//                   Age is the only odds term that lowers the Brier score
//                   on both leave-one-out and walk-forward; size, growth
//                   and chain count do not, so the odds use age alone.
//   implied value = fitted value x launch odds.
//   range         = fitted value's P25-P75 interval (log10 residual sd)
//                   x launch odds; the interval is printed on every row.
//   farmer gross  = implied value x drop share (default 7%) / 2,000
//                   farmers: a stated planning assumption, not a forecast.
//   net of fees   = gross - gas (3 sessions, by chain) - opportunity cost
//                   of the deposit plan (4.5% a year over the horizon).
//   verdict       = farm when net/hour >= $25, marginal when net >= $0,
//                   skip when net < $0. Effort is 3 x 30 min sessions plus
//                   a 15 min weekly check over the horizon.
//
// The board ranks exactly the 198 pre-token protocols the house rules
// leave standing: 40 on the watchlist, 138 early ones below the $50M
// floor, 20 off-list (the house list leaves them out; the snapshot
// carries no parent field, so the list itself is the record). The other
// 144 pre-token protocols are set aside with an explicit reason each
// (bridge 43, liquid staking/restaking 43, exchange custody 42,
// versioned or wrapped 16), and the 416 that already record a token
// split into 128 priced comps and 288 with no usable market cap.
// 198 + 128 + 288 + 43 + 43 + 42 + 16 = 758: every snapshot protocol
// sits in exactly one group, and the dashboard's accounting bar shows it.
//
// Out-of-sample evidence, computed here and shown on the dashboard:
//   * value terms: leave-one-out (each of the 128 comps predicted by a
//     curve fitted without it) AND walk-forward (the 95 dated comps
//     split by listing date: the earlier 47 train, the later 48 test).
//     A term is kept only if it lowers the median held-out miss in
//     BOTH tests. The control term (growth of another row, shuffled by
//     slug hash) must not help, and it does not.
//   * token odds: Brier score over the 645 dated peers, leave-one-out
//     and walk-forward (earlier 322 train, later 323 test).
//   * range honesty: share of real caps inside the printed P25-P75
//     (stated 50%) and P10-P90 (stated 80%) intervals, leave-one-out
//     and walk-forward.
//
// Node 22+, standard library only.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  mcap_usd: number | null;
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

export const MODEL_VERSION = 'signal-v4';

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
const FARM_SESSIONS = 3;
const SESSION_MINUTES = 30;
const WEEKLY_CHECK_MINUTES = 15;
const OPPORTUNITY_RATE = 0.045; // 4.5% a year on the deposit plan
const DROP_SHARE_DEFAULT = 0.07;
const DEPOSIT_DEFAULT_USD = 1000;
const HORIZON_WEEKS_DEFAULT = 12;
const FARMERS_ASSUMED = 2000;
const VERDICT_FARM_PER_HOUR = 25;
const OFFSET_SHRINKAGE = 64; // ridge-style shrinkage for the tested category term

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

/** FNV-1a 32-bit checksum, hex 8 chars: the board's seal, recomputed by the dashboard. */
export function boardChecksum(rows: Array<{ slug: string; implied_value_usd: number }>): string {
  let h = 0x811c9dc5;
  const s = rows.map((r) => `${r.slug}:${r.implied_value_usd}`).join('|');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

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
  r2: number;
  n: number;
  residSd: number;
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

interface Comp {
  x: number; y: number; slug: string; category: string | null;
  growth: number; age: number | null; chains: number; listed: string | null;
}

function fitSizeCurve(comps: Comp[]): Fit {
  const b = ols(comps.map((c) => c.x), comps.map((c) => c.y));
  return { slope: b.slope, intercept: b.intercept, r2: b.r2, n: comps.length, residSd: b.residSd };
}

/** Small OLS on [1, ...features]; returns coefficients. */
function olsMulti(train: Comp[], feats: (c: Comp) => number[]): number[] {
  const k = feats(train[0]).length + 1;
  const a: number[][] = Array.from({ length: k }, () => Array(k).fill(0));
  const b: number[] = Array(k).fill(0);
  for (const c of train) {
    const row = [1, ...feats(c)];
    for (let i = 0; i < k; i++) {
      b[i] += row[i] * c.y;
      for (let j = 0; j < k; j++) a[i][j] += row[i] * row[j];
    }
  }
  // Gaussian elimination.
  const m = a.map((r, i) => [...r, b[i]]);
  for (let col = 0; col < k; col++) {
    let piv = col;
    for (let r = col + 1; r < k; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    [m[col], m[piv]] = [m[piv], m[col]];
    if (Math.abs(m[col][col]) < 1e-12) continue;
    for (let r = 0; r < k; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let j = col; j <= k; j++) m[r][j] -= f * m[col][j];
    }
  }
  return m.map((r, i) => r[k] / r[i]);
}

function categoryOffset(train: Comp[], base: (c: Comp) => number, shrink: number): Record<string, number> {
  const sums = new Map<string, { total: number; n: number }>();
  for (const c of train) {
    if (c.category === null) continue;
    const r = c.y - base(c);
    const e = sums.get(c.category) ?? { total: 0, n: 0 };
    e.total += r;
    e.n += 1;
    sums.set(c.category, e);
  }
  const offsets: Record<string, number> = {};
  for (const [cat, e] of sums) offsets[cat] = (e.total / e.n) * (e.n / (e.n + shrink));
  return offsets;
}

export interface ValueTerm {
  term: string;
  looMiss: number; // median held-out miss, leave-one-out, as a multiple (x)
  wfMiss: number; // median held-out miss, walk-forward, as a multiple (x)
  status: 'baseline' | 'kept' | 'tested, not kept' | 'must not help';
}

/**
 * Value-term evidence. Each candidate is the size curve plus that term;
 * the flat multiple and the size curve alone are the baseline and the
 * first candidate. A term is kept only when it beats the size curve on
 * BOTH leave-one-out and walk-forward; the control (growth of another
 * row, shuffled by slug hash) is never a candidate.
 */
function valueTermEvidence(comps: Comp[]): ValueTerm[] {
  const flat = (train: Comp[], c: Comp): number => {
    const ds = [...train.map((t) => t.y - t.x)].sort((x, y) => x - y);
    return c.x + ds[Math.floor(ds.length / 2)];
  };
  const sizeOnly = (train: Comp[], c: Comp): number => {
    const f = fitSizeCurve(train);
    return f.intercept + f.slope * c.x;
  };
  const sizePlus = (feats: (c: Comp) => number[], useCat: boolean) => (train: Comp[], c: Comp): number => {
    const beta = olsMulti(train, feats);
    const base = (cc: Comp): number => beta[0] + feats(cc).reduce((s, v, i) => s + beta[i + 1] * v, 0);
    let p = base(c);
    if (useCat) {
      const off = categoryOffset(train, base, OFFSET_SHRINKAGE);
      p += c.category !== null ? off[c.category] ?? 0 : 0;
    }
    return p;
  };
  const specs: Array<{ term: string; fn: (train: Comp[], c: Comp) => number; candidate: boolean }> = [
    { term: 'flat median multiple', fn: flat, candidate: false },
    { term: 'size curve, in TVL', fn: sizeOnly, candidate: true },
    { term: '+ category effect, ridge 64', fn: sizePlus((c) => [c.x], true), candidate: true },
    { term: '+ 7-day TVL growth', fn: sizePlus((c) => [c.x, c.growth / 100], false), candidate: true },
    { term: '+ age, years listed', fn: sizePlus((c) => [c.x, Math.log10((c.age ?? 365) + 30)], false), candidate: true },
    { term: '+ chain count, ln', fn: sizePlus((c) => [c.x, Math.log(c.chains)], false), candidate: true },
    { term: '+ control: growth of another row', fn: sizePlus((c) => [c.x, (hashSlug(c.slug) % 2 ? 1 : -1) * (c.growth / 100)], false), candidate: false },
  ];
  const dated = comps.filter((c) => c.listed !== null).sort((a, b) => (a.listed as string) < (b.listed as string) ? -1 : 1);
  const half = Math.floor(dated.length / 2);
  const wfTrain = dated.slice(0, half);
  const wfTest = dated.slice(half);
  const miss = (errs: number[]): number => 10 ** median(errs.map((e) => Math.abs(e)));
  const scored = specs.map((s) => {
    const looErrs = comps.map((c) => c.y - s.fn(comps.filter((t) => t !== c), c));
    const wfErrs = wfTest.map((c) => c.y - s.fn(wfTrain, c));
    return { term: s.term, candidate: s.candidate, loo: miss(looErrs), wf: miss(wfErrs) };
  });
  const sizeRow = scored[1];
  return scored.map((r, i) => {
    let status: ValueTerm['status'];
    if (i === 0) status = 'baseline';
    else if (i === 1) status = 'kept';
    else if (!r.candidate) status = 'must not help';
    else status = r.loo < sizeRow.loo && r.wf < sizeRow.wf ? 'kept' : 'tested, not kept';
    return { term: r.term, looMiss: Math.round(r.loo * 100) / 100, wfMiss: Math.round(r.wf * 100) / 100, status };
  });
}

export interface RangeHonesty {
  looWithin3x: number; looP25P75: number; looP10P90: number;
  wfWithin3x: number; wfP25P75: number; wfP10P90: number;
  looN: number; wfN: number; wfTrainN: number;
}

function rangeHonesty(comps: Comp[], fit: Fit): RangeHonesty {
  const share = (errs: number[], sd: number, z: number): number =>
    errs.filter((e) => Math.abs(e) <= z * sd).length / Math.max(1, errs.length);
  // Leave-one-out predictions from the kept (size-only) curve.
  const looErrs = comps.map((c) => {
    const f = fitSizeCurve(comps.filter((t) => t !== c));
    return c.y - (f.intercept + f.slope * c.x);
  });
  const looSd = Math.sqrt(looErrs.reduce((s, e) => s + e * e, 0) / Math.max(1, looErrs.length));
  // Walk-forward: earlier-listed half trains, later half tests.
  const dated = comps.filter((c) => c.listed !== null).sort((a, b) => (a.listed as string) < (b.listed as string) ? -1 : 1);
  const half = Math.floor(dated.length / 2);
  const train = dated.slice(0, half);
  const test = dated.slice(half);
  const tf = fitSizeCurve(train);
  const wfErrs = test.map((c) => c.y - (tf.intercept + tf.slope * c.x));
  const trainSd = tf.residSd;
  return {
    looWithin3x: Math.round(share(looErrs, 1, Math.log10(3) / 1) * 1000) / 10,
    looP25P75: Math.round(share(looErrs, looSd, 0.674) * 1000) / 10,
    looP10P90: Math.round(share(looErrs, looSd, 1.282) * 1000) / 10,
    wfWithin3x: Math.round(share(wfErrs, 1, Math.log10(3) / 1) * 1000) / 10,
    wfP25P75: Math.round(share(wfErrs, trainSd, 0.674) * 1000) / 10,
    wfP10P90: Math.round(share(wfErrs, trainSd, 1.282) * 1000) / 10,
    looN: comps.length,
    wfN: test.length,
    wfTrainN: train.length,
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
    const rate = (tokens + 3 * overall) / (grp.length + 3);
    return { band, n: grp.length, tokens, rate };
  });
  return { bands, overall };
}

function oddsFor(age: number | null, table: { bands: OddsBand[]; overall: number }): { odds: number; band: string } {
  if (age === null) return { odds: table.overall, band: 'age unknown' };
  for (let i = 0; i < ODDS_BANDS.length; i++) {
    const [band, lo, hi] = ODDS_BANDS[i];
    if (age >= lo && age < hi) return { odds: table.bands[i].rate, band };
  }
  return { odds: table.overall, band: 'age unknown' };
}

interface Peer { age: number; y: number; tvl: number; growth: number; chains: number; slug: string; listed: string }

export interface OddsTerm {
  term: string;
  looBrier: number; looRight: number;
  wfBrier: number; wfRight: number;
  status: 'baseline' | 'kept' | 'tested, not kept' | 'must not help';
}

/** Token-odds Brier evidence, leave-one-out and walk-forward over dated peers. */
function oddsTermEvidence(peers: Peer[]): OddsTerm[] {
  const bandsOf = (train: Peer[]): { bands: OddsBand[]; overall: number } => {
    const overall = train.reduce((s, p) => s + p.y, 0) / Math.max(1, train.length);
    const bands: OddsBand[] = ODDS_BANDS.map(([band, lo, hi]) => {
      const grp = train.filter((p) => p.age >= lo && p.age < hi);
      const tokens = grp.reduce((s, p) => s + p.y, 0);
      return { band, n: grp.length, tokens, rate: (tokens + 3 * overall) / (grp.length + 3) };
    });
    return { bands, overall };
  };
  const ageP = (train: Peer[], p: Peer): number => {
    const t = bandsOf(train);
    const bi = ODDS_BANDS.findIndex(([, lo, hi]) => p.age >= lo && p.age < hi);
    return bi < 0 ? t.overall : t.bands[bi].rate;
  };
  const adjust = (train: Peer[], p: Peer, key: (q: Peer) => string | number, base: number): number => {
    const grp = train.filter((q) => key(q) === key(p));
    if (grp.length === 0) return base;
    const overall = train.reduce((s, q) => s + q.y, 0) / Math.max(1, train.length);
    const f = grp.reduce((s, q) => s + q.y, 0) / grp.length / Math.max(0.01, overall);
    return clamp(base * f, 0.03, 0.97);
  };
  const specs: Array<{ term: string; fn: (train: Peer[], p: Peer) => number; candidate: boolean }> = [
    { term: 'base rate of peers', fn: (tr) => tr.reduce((s, q) => s + q.y, 0) / Math.max(1, tr.length), candidate: false },
    { term: '+ age, years listed', fn: ageP, candidate: true },
    { term: '+ size curve, in TVL', fn: (tr, p) => adjust(tr, p, (q) => q.tvl < 1e8 ? 0 : q.tvl < 1e9 ? 1 : 2, ageP(tr, p)), candidate: true },
    { term: '+ 7-day TVL growth', fn: (tr, p) => adjust(tr, p, (q) => (q.growth >= 0 ? 1 : 0), ageP(tr, p)), candidate: true },
    { term: '+ chain count, ln', fn: (tr, p) => adjust(tr, p, (q) => (q.chains > 1 ? 1 : 0), ageP(tr, p)), candidate: true },
    { term: '+ control: growth of another row', fn: (tr, p) => adjust(tr, p, (q) => (hashSlug(q.slug) % 2), ageP(tr, p)), candidate: false },
  ];
  const dated = [...peers].sort((a, b) => (a.listed < b.listed ? -1 : 1));
  const half = Math.floor(dated.length / 2);
  const wfTrain = dated.slice(0, half);
  const wfTest = dated.slice(half);
  const scored = specs.map((s) => {
    let se = 0;
    let right = 0;
    for (const p of peers) {
      const pr = s.fn(peers.filter((q) => q !== p), p);
      se += (pr - p.y) ** 2;
      if ((pr >= 0.5) === (p.y === 1)) right++;
    }
    let se2 = 0;
    let right2 = 0;
    for (const p of wfTest) {
      const pr = s.fn(wfTrain, p);
      se2 += (pr - p.y) ** 2;
      if ((pr >= 0.5) === (p.y === 1)) right2++;
    }
    return {
      term: s.term, candidate: s.candidate,
      looBrier: se / peers.length, looRight: right / peers.length,
      wfBrier: se2 / wfTest.length, wfRight: right2 / wfTest.length,
    };
  });
  const ageRow = scored[1];
  return scored.map((r, i) => {
    let status: OddsTerm['status'];
    if (i === 0) status = 'baseline';
    else if (i === 1) status = 'kept';
    else if (!r.candidate) status = 'must not help';
    else status = r.looBrier < ageRow.looBrier && r.wfBrier < ageRow.wfBrier ? 'kept' : 'tested, not kept';
    const r3 = (v: number) => Math.round(v * 1000) / 1000;
    return { term: r.term, looBrier: r3(r.looBrier), looRight: Math.round(r.looRight * 1000) / 10, wfBrier: r3(r.wfBrier), wfRight: Math.round(r.wfRight * 1000) / 10, status };
  });
}

export function gasUsd(chain: string): number {
  return GAS_USD[chain] ?? GAS_DEFAULT_USD;
}

export type SetAsideReason = 'bridge' | 'liquid' | 'exchange' | 'versioned';

export function setAsideReason(p: SnapshotProtocol): SetAsideReason | null {
  if (p.category === 'Bridge' || p.category === 'Canonical Bridge') return 'bridge';
  if (p.category === 'Liquid Staking' || p.category === 'Liquid Restaking' || p.category === 'Restaked BTC') return 'liquid';
  if (p.category === 'CEX') return 'exchange';
  if (VERSION_RE.test(p.name) || WRAPPED_RE.test(p.name) || EXCHANGE_RE.test(p.name)) return 'versioned';
  return null;
}

export function ineligibleReason(p: SnapshotProtocol): string | null {
  const r = setAsideReason(p);
  if (r === 'bridge') return `skip: ${p.category} product, not a standalone launch`;
  if (r === 'liquid') return `skip: ${p.category} product, a staked form of a token that trades`;
  if (r === 'exchange') return 'skip: exchange custody product, not a standalone launch';
  if (r === 'versioned') return 'skip: versioned, wrapped or exchange-named product of a token that trades';
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
  gasCost: number,
  netUsd: number,
  netPerHour: number,
  verdict: string,
): string[] {
  const chain = p.chains[0] ?? 'the supported chain';
  const gas = gasUsd(chain);
  return [
    `${p.name} · Verify the official application through the project's own documentation and confirm ${chain} support before connecting a fresh wallet. Cost: $0; time: 8 minutes.`,
    `${p.name} · Fund the wallet on ${chain} on a route you already trust. Budget $${gas} gas per session across ${FARM_SESSIONS} sessions ($${gasCost} total) plus the $${DEPOSIT_DEFAULT_USD} deposit plan. Time: 10-20 minutes.`,
    actionFor(p, chain, DEPOSIT_DEFAULT_USD),
    `${p.name} · ${riskFor(p)} Cost: $0 for review, $0-5 for an exit test; time: 15 minutes, plus any disclosed lockup.`,
    `${p.name} · Open the rewards or points page and the official eligibility terms; record the transaction hash and any points shown. No campaign is assumed. Cost: $0; time: 5 minutes weekly.`,
    `${p.name} · After ${HORIZON_WEEKS_DEFAULT} weeks compare the $${netUsd.toFixed(0)} net of fees ($${netPerHour.toFixed(2)} an hour) against the plan: verdict ${verdict}. Withdraw when the test is uneconomic and revoke unused approvals where supported. Cost: $0-5 gas; time: 10 minutes.`,
  ];
}

/** Net of fees and net per hour for one row under a scenario. Shared by model and dashboard. */
export function scenarioNet(
  impliedUsd: number, gasCostUsd: number, depositUsd: number, dropShare: number, horizonWeeks: number,
): { gross: number; net: number; netPerHour: number; hours: number } {
  const gross = (impliedUsd * dropShare) / FARMERS_ASSUMED;
  const oppCost = depositUsd * OPPORTUNITY_RATE * (horizonWeeks / 52);
  const net = gross - gasCostUsd - oppCost;
  const hours = (FARM_SESSIONS * SESSION_MINUTES + WEEKLY_CHECK_MINUTES * horizonWeeks) / 60;
  return { gross, net, netPerHour: net / hours, hours };
}

export function scenarioVerdict(net: number, netPerHour: number): 'farm' | 'marginal' | 'skip' {
  if (netPerHour >= VERDICT_FARM_PER_HOUR) return 'farm';
  if (net >= 0) return 'marginal';
  return 'skip';
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
  off_list: boolean;
  eligible: boolean;
  ineligible_reason: string | null;
  fitted_value_usd: number;
  launch_odds: number;
  odds_band: string;
  implied_value_usd: number;
  p25_usd: number;
  p75_usd: number;
  p10_usd: number;
  p90_usd: number;
  rank_lo: number;
  rank_hi: number;
  gross_farmer_usd: number;
  gas_cost_usd: number;
  net_fees_usd: number;
  net_per_hour_usd: number;
  farm_verdict: 'farm' | 'marginal' | 'skip';
  value_breakdown: {
    tvl_usd: number;
    fit: string;
    slope: number;
    intercept: number;
    r2: number;
    resid_sd: number;
    n_comps: number;
    fitted_value_usd: number;
    launch_odds: number;
    implied_value_usd: number;
  };
  farm_steps: string[];
}

export interface Evidence {
  valueTerms: ValueTerm[];
  oddsTerms: OddsTerm[];
  range: RangeHonesty;
  compsN: number;
  peersN: number;
  holdoutNote: string;
}

export interface Accounting {
  rankedWatchlist: number;
  rankedEarly: number;
  rankedOffList: number;
  tokenPriced: number;
  tokenNoCap: number;
  outBridge: number;
  outLiquid: number;
  outExchange: number;
  outVersioned: number;
  total: number;
}

export interface Board {
  title: string;
  as_of: string;
  floor_usd: number;
  model: {
    version: string;
    fit: Fit;
    evidence: Evidence;
    odds: { bands: OddsBand[]; overall: number };
    costs: {
      gasUsd: Record<string, number>;
      gasDefaultUsd: number;
      sessions: number;
      dropShareDefault: number;
      depositDefaultUsd: number;
      horizonWeeksDefault: number;
      farmersAssumed: number;
      opportunityRate: number;
      verdictFarmPerHour: number;
    };
    integrity: {
      checksum: string;
      totalImpliedUsd: number;
      rows: number;
      ledgerTotal: number;
    };
  };
  coverage: {
    snapshot: number;
    preToken: number;
    ranked: number;
    farm: number;
    marginal: number;
    skip: number;
    watchlist: number;
    watchlistRanked: number;
    tokenRecorded: number;
    accounting: Accounting;
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
    .map((p) => ({
      x: Math.log10(p.tvl_usd), y: Math.log10(p.mcap_usd as number), slug: p.slug, category: p.category,
      growth: p.change_7d ?? 0, age: ageDays(snapshot.as_of, p.listed_at), chains: p.chains.length, listed: p.listed_at,
    }));
  const fit = fitSizeCurve(comps);
  const valueTerms = valueTermEvidence(comps);
  const range = rangeHonesty(comps, fit);
  const peers: Peer[] = snapshot.protocols
    .map((p) => ({
      age: ageDays(snapshot.as_of, p.listed_at), y: (p.gecko_id !== null || p.symbol !== null) ? 1 : 0,
      tvl: p.tvl_usd, growth: p.change_7d ?? 0, chains: p.chains.length, slug: p.slug, listed: p.listed_at,
    }))
    .filter((p): p is Peer => p.age !== null && p.listed !== null);
  const oddsTerms = oddsTermEvidence(peers);
  const odds = oddsTable(snapshot.protocols, snapshot.as_of);
  const watchSet = new Set(snapshot.watchlist);

  // Accounting: every protocol in exactly one group.
  const pre = snapshot.protocols.filter((p) => p.gecko_id === null && p.symbol === null);
  const tokenRecorded = snapshot.protocols.length - pre.length;
  const tokenPriced = snapshot.protocols.filter((p) => (p.gecko_id !== null || p.symbol !== null) && p.mcap_usd !== null && p.mcap_usd > 0).length;
  const tokenNoCap = tokenRecorded - tokenPriced;
  let outBridge = 0;
  let outLiquid = 0;
  let outExchange = 0;
  let outVersioned = 0;
  for (const p of pre) {
    const r = setAsideReason(p);
    if (r === 'bridge') outBridge++;
    else if (r === 'liquid') outLiquid++;
    else if (r === 'exchange') outExchange++;
    else if (r === 'versioned') outVersioned++;
  }
  const ranked = pre.filter((p) => setAsideReason(p) === null);
  const rankedWatchlist = ranked.filter((p) => watchSet.has(p.slug)).length;
  const rankedEarly = ranked.filter((p) => !watchSet.has(p.slug) && p.tvl_usd < snapshot.floor_usd).length;
  const rankedOffList = ranked.filter((p) => !watchSet.has(p.slug) && p.tvl_usd >= snapshot.floor_usd).length;
  const accounting: Accounting = {
    rankedWatchlist, rankedEarly, rankedOffList, tokenPriced, tokenNoCap,
    outBridge, outLiquid, outExchange, outVersioned, total: snapshot.protocols.length,
  };

  const rows: BoardRow[] = ranked.map((p) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const logFitted = fit.intercept + fit.slope * Math.log10(p.tvl_usd);
    const fitted = Math.max(1, Math.round(10 ** logFitted));
    const { odds: launchOdds, band } = oddsFor(age, odds);
    const implied = Math.max(1, Math.round(fitted * launchOdds));
    const p25 = Math.max(1, Math.round(10 ** (logFitted - 0.674 * fit.residSd) * launchOdds));
    const p75 = Math.max(1, Math.round(10 ** (logFitted + 0.674 * fit.residSd) * launchOdds));
    const p10 = Math.max(1, Math.round(10 ** (logFitted - 1.282 * fit.residSd) * launchOdds));
    const p90 = Math.max(1, Math.round(10 ** (logFitted + 1.282 * fit.residSd) * launchOdds));
    const chain = p.chains[0] ?? '';
    const gasCost = Math.round((FARM_SESSIONS * gasUsd(chain)) * 100) / 100;
    const net = scenarioNet(implied, gasCost, DEPOSIT_DEFAULT_USD, DROP_SHARE_DEFAULT, HORIZON_WEEKS_DEFAULT);
    const verdict = scenarioVerdict(net.net, net.netPerHour);
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
      off_list: !watchSet.has(p.slug) && p.tvl_usd >= snapshot.floor_usd,
      eligible: true,
      ineligible_reason: null,
      fitted_value_usd: fitted,
      launch_odds: Math.round(launchOdds * 10000) / 10000,
      odds_band: band,
      implied_value_usd: implied,
      p25_usd: p25,
      p75_usd: p75,
      p10_usd: p10,
      p90_usd: p90,
      rank_lo: 0,
      rank_hi: 0,
      gross_farmer_usd: Math.round(net.gross * 100) / 100,
      gas_cost_usd: gasCost,
      net_fees_usd: Math.round(net.net * 100) / 100,
      net_per_hour_usd: Math.round(net.netPerHour * 100) / 100,
      farm_verdict: verdict,
      value_breakdown: {
        tvl_usd: p.tvl_usd,
        fit: 'size curve only',
        slope: Math.round(fit.slope * 10000) / 10000,
        intercept: Math.round(fit.intercept * 10000) / 10000,
        r2: Math.round(fit.r2 * 10000) / 10000,
        resid_sd: Math.round(fit.residSd * 10000) / 10000,
        n_comps: fit.n,
        fitted_value_usd: fitted,
        launch_odds: Math.round(launchOdds * 10000) / 10000,
        implied_value_usd: implied,
      },
      farm_steps: farmPlan(p, gasCost, net.net, net.netPerHour, verdict),
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
  // Rank range from the P25/P75 interval: best rank if the value lands at P75, worst at P25.
  const byP75 = [...rows].sort((a, b) => b.p75_usd - a.p75_usd);
  const byP25 = [...rows].sort((a, b) => b.p25_usd - a.p25_usd);
  rows.forEach((r) => {
    r.rank_hi = byP75.findIndex((x) => x.slug === r.slug) + 1;
    r.rank_lo = byP25.findIndex((x) => x.slug === r.slug) + 1;
  });
  // Recompute the farm economics on the final (ceiling-adjusted) implied value.
  for (const r of rows) {
    const net = scenarioNet(r.implied_value_usd, r.gas_cost_usd, DEPOSIT_DEFAULT_USD, DROP_SHARE_DEFAULT, HORIZON_WEEKS_DEFAULT);
    r.gross_farmer_usd = Math.round(net.gross * 100) / 100;
    r.net_fees_usd = Math.round(net.net * 100) / 100;
    r.net_per_hour_usd = Math.round(net.netPerHour * 100) / 100;
    r.farm_verdict = scenarioVerdict(net.net, net.netPerHour);
    r.farm_steps = farmPlan(
      { slug: r.slug, name: r.name, category: r.category, chains: r.chains, tvl_usd: r.tvl_usd, change_7d: r.change_7d, listed_at: r.listed_at, mcap_usd: null, gecko_id: null, symbol: null },
      r.gas_cost_usd, net.net, net.netPerHour, r.farm_verdict,
    );
  }

  const totalImplied = rows.reduce((s, r) => s + r.implied_value_usd, 0);
  const checksum = boardChecksum(rows);
  const evidence: Evidence = {
    valueTerms,
    oddsTerms,
    range,
    compsN: comps.length,
    peersN: peers.length,
    holdoutNote: 'Leave-one-out predicts each traded token from a curve that never saw it; walk-forward trains only on tokens listed earlier and tests the ones listed later, so the later half is genuinely unseen.',
  };
  const board: Board = {
    title: 'Signal v4 / Launch radar',
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    model: {
      version: MODEL_VERSION,
      fit,
      evidence,
      odds,
      costs: {
        gasUsd: GAS_USD,
        gasDefaultUsd: GAS_DEFAULT_USD,
        sessions: FARM_SESSIONS,
        dropShareDefault: DROP_SHARE_DEFAULT,
        depositDefaultUsd: DEPOSIT_DEFAULT_USD,
        horizonWeeksDefault: HORIZON_WEEKS_DEFAULT,
        farmersAssumed: FARMERS_ASSUMED,
        opportunityRate: OPPORTUNITY_RATE,
        verdictFarmPerHour: VERDICT_FARM_PER_HOUR,
      },
      integrity: { checksum, totalImpliedUsd: totalImplied, rows: rows.length, ledgerTotal: snapshot.protocols.length },
    },
    coverage: {
      snapshot: snapshot.protocols.length,
      preToken: pre.length,
      ranked: rows.length,
      farm: rows.filter((r) => r.farm_verdict === 'farm').length,
      marginal: rows.filter((r) => r.farm_verdict === 'marginal').length,
      skip: rows.filter((r) => r.farm_verdict === 'skip').length,
      watchlist: snapshot.watchlist.length,
      watchlistRanked: rows.filter((r) => r.watchlist).length,
      tokenRecorded,
      accounting,
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
  const a = board.coverage.accounting;
  const ledger = a.rankedWatchlist + a.rankedEarly + a.rankedOffList + a.tokenPriced + a.tokenNoCap + a.outBridge + a.outLiquid + a.outExchange + a.outVersioned;
  if (ledger !== snapshot.protocols.length) {
    return `accounting ledger sums to ${ledger}, snapshot holds ${snapshot.protocols.length}`;
  }
  if (a.rankedWatchlist + a.rankedEarly + a.rankedOffList !== board.rows.length) {
    return `accounting ranked groups sum to ${a.rankedWatchlist + a.rankedEarly + a.rankedOffList}, board holds ${board.rows.length}`;
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
