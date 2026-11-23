// Northlight — Token Launch Radar (token-radar-01, R7).
//
// Reads the sealed DefiLlama snapshot, prices every pre-token protocol from
// the record of the protocols whose token already trades, and hands in a
// ranked board with a farm plan for every row.
//
// The discipline, copied from the leaderboard's top entries and tightened:
// every candidate value term is fitted and then tested held-out TWICE —
// leave-one-out over the whole priced set, and walk-forward (fit the
// earliest-listed 70%, test the latest 30%) — and a term is kept only when
// BOTH tests improve. Token odds come from the peers' own record: the share
// of similar-size, similar-age protocols that already trade. Ranges are
// conformal intervals from leave-one-out residuals, with their empirical
// coverage stated. Farm verdicts are costed in $/hour against a minimum
// viable capital. Nothing here is a hardcoded list of names: the board is
// the snapshot's own arithmetic.
//
// Node 22, standard library only. Deterministic: two runs on the same
// snapshot write byte-identical outputs. No network, no secrets.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

// ---------------------------------------------------------------------------
// Small numeric helpers (no dependencies)
// ---------------------------------------------------------------------------

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return Number.NaN;
  const pos = q * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function rmse(errs: number[]): number {
  return Math.sqrt(mean(errs.map((e) => e * e)));
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

/** Solve A x = b by Gaussian elimination with partial pivoting. */
function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    [M[col], M[piv]] = [M[piv]!, M[col]!];
    const d = M[col]![col]!;
    if (Math.abs(d) < 1e-12) continue;
    for (let r = col + 1; r < n; r++) {
      const f = M[r]![col]! / d;
      for (let c = col; c <= n; c++) M[r]![c]! -= f * M[col]![c]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r]![n]!;
    for (let c = r + 1; c < n; c++) s -= M[r]![c]! * x[c]!;
    const d = M[r]![r]!;
    x[r] = Math.abs(d) < 1e-12 ? 0 : s / d;
  }
  return x;
}

function designMatrix(rows: number[][]): number[][] {
  return rows.map((r) => [1, ...r]);
}

/** Ordinary least squares. Returns coefficients (intercept first). */
function olsFit(X: number[][], y: number[]): number[] {
  const D = designMatrix(X);
  const p = D[0]!.length;
  const XtX: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const Xty: number[] = new Array<number>(p).fill(0);
  for (let i = 0; i < D.length; i++) {
    for (let a = 0; a < p; a++) {
      Xty[a]! += D[i]![a]! * y[i]!;
      for (let b = 0; b < p; b++) XtX[a]![b]! += D[i]![a]! * D[i]![b]!;
    }
  }
  return solveLinear(XtX, Xty);
}

function predict(beta: number[], x: number[]): number {
  let s = beta[0]!;
  for (let i = 0; i < x.length; i++) s += beta[i + 1]! * x[i]!;
  return s;
}

/** Huber robust fit (c = 1.345, MAD scale), by iteratively reweighted LS. */
function huberFit(X: number[][], y: number[], c = 1.345, iters = 80): number[] {
  let beta = olsFit(X, y);
  const D = designMatrix(X);
  for (let it = 0; it < iters; it++) {
    const res = y.map((yi, i) => yi - predict(beta, X[i]!));
    const med = median(res);
    const mad = median(res.map((r) => Math.abs(r - med)));
    const scale = Math.max(1.4826 * mad, 1e-6);
    const w = res.map((r) => {
      const a = Math.abs(r) / scale;
      return a <= c ? 1 : c / a;
    });
    const p = D[0]!.length;
    const XtWX: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
    const XtWy: number[] = new Array<number>(p).fill(0);
    for (let i = 0; i < D.length; i++) {
      for (let a = 0; a < p; a++) {
        XtWy[a]! += w[i]! * D[i]![a]! * y[i]!;
        for (let b = 0; b < p; b++) XtWX[a]![b]! += w[i]! * D[i]![a]! * D[i]![b]!;
      }
    }
    const next = solveLinear(XtWX, XtWy);
    const shift = Math.max(...next.map((v, i) => Math.abs(v - beta[i]!)));
    beta = next;
    if (shift < 1e-10) break;
  }
  return beta;
}

/** Leave-one-out RMSE by refitting with each row held out. */
function looRmse(fit: (X: number[][], y: number[]) => number[], X: number[][], y: number[]): { rmse: number; residuals: number[] } {
  const residuals: number[] = [];
  for (let i = 0; i < y.length; i++) {
    const Xr = X.filter((_, j) => j !== i);
    const yr = y.filter((_, j) => j !== i);
    const beta = fit(Xr, yr);
    residuals.push(y[i]! - predict(beta, X[i]!));
  }
  return { rmse: rmse(residuals), residuals };
}

/** Walk-forward RMSE: fit the earliest-listed 70% (by listed date), test the latest 30%. */
function walkForwardRmse(
  fit: (X: number[][], y: number[]) => number[],
  X: number[][],
  y: number[],
  listedAt: (string | null)[],
): { rmse: number; nTrain: number; nTest: number } {
  const dated = X.map((_, i) => i).filter((i) => listedAt[i] !== null);
  dated.sort((a, b) => (listedAt[a]! < listedAt[b]! ? -1 : listedAt[a]! > listedAt[b]! ? 1 : 0));
  const cut = Math.floor(dated.length * 0.7);
  const train = dated.slice(0, cut);
  const test = dated.slice(cut);
  const beta = fit(train.map((i) => X[i]!), train.map((i) => y[i]!));
  const errs = test.map((i) => y[i]! - predict(beta, X[i]!));
  return { rmse: rmse(errs), nTrain: train.length, nTest: test.length };
}

// ---------------------------------------------------------------------------
// Snapshot
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

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`northlight: no snapshot at ${inputFile}: pass --input <snapshot.json|directory>\n`);
  process.exit(2);
}
const outDir = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snap = JSON.parse(readFileSync(inputFile, 'utf8')) as Snapshot;
const asOfDay = new Date(`${snap.as_of}T00:00:00Z`).getTime();

function ageDays(p: Protocol): number | null {
  if (!p.listed_at) return null;
  const d = Math.round((asOfDay - new Date(`${p.listed_at}T00:00:00Z`).getTime()) / 86400000);
  return Math.max(1, d);
}

const hasToken = (p: Protocol): boolean => p.gecko_id !== null || p.symbol !== null;
const priced = snap.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
const watchSet = new Set(snap.watchlist);

const medianLogAge =
  median(
    priced
      .map(ageDays)
      .filter((a): a is number => a !== null)
      .map((a) => Math.log10(a)),
  );

// Feature builders, one per candidate value term. logTvl is the base.
function logTvl(p: Protocol): number {
  return Math.log10(p.tvl_usd);
}
function logAge(p: Protocol): number {
  const a = ageDays(p);
  return a === null ? medianLogAge : Math.log10(a);
}
function growth(p: Protocol): number {
  if (p.change_7d === null) return 0;
  return Math.max(-50, Math.min(200, p.change_7d)) / 100;
}
function logChains(p: Protocol): number {
  return Math.log10(Math.max(1, p.chains.length));
}
function isCategory(c: string): (p: Protocol) => number {
  return (p: Protocol) => (p.category === c ? 1 : 0);
}

const yPriced = priced.map((p) => Math.log10(p.mcap_usd!));
const listedPriced = priced.map((p) => p.listed_at);

// ---------------------------------------------------------------------------
// Term selection: fit every candidate, test it held-out TWICE, keep it only
// when BOTH tests improve on the base. A term that only fits in-sample is
// dropped, however plausible its story sounds.
// ---------------------------------------------------------------------------

type TermTest = {
  term: string;
  loo: number;
  walkForward: number;
  kept: boolean;
  reason: string;
};

const fitFn = (X: number[][], y: number[]): number[] => huberFit(X, y);

function featureMatrix(extra: ((p: Protocol) => number)[]): number[][] {
  return priced.map((p) => [logTvl(p), ...extra.map((f) => f(p))]);
}

const baseX = featureMatrix([]);
const baseLoo = looRmse(fitFn, baseX, yPriced);
const baseWf = walkForwardRmse(fitFn, baseX, yPriced, listedPriced);

const candidateTerms: { name: string; fn: (p: Protocol) => number }[] = [
  { name: 'log10(age_days)', fn: logAge },
  { name: 'change_7d clipped /100', fn: growth },
  { name: 'log10(chain_count)', fn: logChains },
  { name: 'log10(TVL) x log10(age)', fn: (p) => logTvl(p) * logAge(p) },
  { name: 'category = Dexs', fn: isCategory('Dexs') },
  { name: 'category = Lending', fn: isCategory('Lending') },
  { name: 'category = Yield', fn: isCategory('Yield') },
  { name: 'category = Derivatives', fn: isCategory('Derivatives') },
  { name: 'category = CDP', fn: isCategory('CDP') },
  { name: 'category = Restaking', fn: isCategory('Restaking') },
  { name: 'category = RWA', fn: isCategory('RWA') },
  { name: 'category = Liquid Staking', fn: isCategory('Liquid Staking') },
];

const termTests: TermTest[] = [];
const keptTerms: ((p: Protocol) => number)[] = [];
for (const cand of candidateTerms) {
  const X = featureMatrix([cand.fn]);
  const loo = looRmse(fitFn, X, yPriced);
  const wf = walkForwardRmse(fitFn, X, yPriced, listedPriced);
  const improvesBoth = loo.rmse < baseLoo.rmse && wf.rmse < baseWf.rmse;
  const improvesOne = loo.rmse < baseLoo.rmse || wf.rmse < baseWf.rmse;
  termTests.push({
    term: cand.name,
    loo: round4(loo.rmse),
    walkForward: round4(wf.rmse),
    kept: improvesBoth,
    reason: improvesBoth
      ? 'kept: both held-out tests improve'
      : improvesOne
        ? 'dropped: only one held-out test improves'
        : 'dropped: neither held-out test improves',
  });
  if (improvesBoth) keptTerms.push(cand.fn);
}

// The final spec is the base plus whatever survived both tests.
const finalX = featureMatrix(keptTerms);
const finalBeta = huberFit(finalX, yPriced);
const finalLoo = looRmse(fitFn, finalX, yPriced);
const finalWf = walkForwardRmse(fitFn, finalX, yPriced, listedPriced);
const olsBeta = olsFit(finalX, yPriced);
const olsLoo = looRmse(olsFit, finalX, yPriced);
const olsWf = walkForwardRmse(olsFit, finalX, yPriced, listedPriced);

// Conformal intervals from the final model's leave-one-out residuals:
// the 80% band is the 80th percentile of |LOO residual|; coverage is the
// share of priced protocols whose true value lands inside it.
const absLoo = finalLoo.residuals.map((r) => Math.abs(r));
const halfWidth80 = quantile(absLoo, 0.8);
const halfWidth90 = quantile(absLoo, 0.9);
const inSample = finalX.map((x, i) => yPriced[i]! - predict(finalBeta, x));
const coverage80 = mean(inSample.map((e) => (Math.abs(e) <= halfWidth80 ? 1 : 0)));
const coverage90 = mean(inSample.map((e) => (Math.abs(e) <= halfWidth90 ? 1 : 0)));

function impliedValue(p: Protocol): number {
  return Math.pow(10, predict(finalBeta, [logTvl(p), ...keptTerms.map((f) => f(p))]));
}

// ---------------------------------------------------------------------------
// Token odds from the peers' record
// ---------------------------------------------------------------------------

type PeerOdds = { odds: number; peers: number };

function peerOdds(p: Protocol, pool: Protocol[]): PeerOdds {
  const lt = logTvl(p);
  const la = logAge(p);
  let peers = pool.filter((q) => {
    if (q.slug === p.slug) return false;
    if (Math.abs(logTvl(q) - lt) > 0.5) return false;
    if (Math.abs(logAge(q) - la) > 0.3) return false;
    return true;
  });
  if (peers.length < 10) {
    peers = pool.filter((q) => q.slug !== p.slug && Math.abs(logTvl(q) - lt) <= 0.5);
  }
  if (peers.length < 5) return { odds: 0.5, peers: peers.length };
  const withToken = peers.filter(hasToken).length;
  return { odds: withToken / peers.length, peers: peers.length };
}

const oddsBySlug = new Map<string, PeerOdds>();
for (const p of snap.protocols) oddsBySlug.set(p.slug, peerOdds(p, snap.protocols));

// How good are the peer odds as a classifier? AUC over the whole snapshot.
function aucScore(): number {
  const pos = snap.protocols.filter(hasToken);
  const neg = snap.protocols.filter((p) => !hasToken(p));
  let wins = 0;
  let pairs = 0;
  for (const a of pos) {
    for (const b of neg) {
      const oa = oddsBySlug.get(a.slug)!.odds;
      const ob = oddsBySlug.get(b.slug)!.odds;
      wins += oa > ob ? 1 : oa === ob ? 0.5 : 0;
      pairs++;
    }
  }
  return wins / pairs;
}

// Walk-forward calibration of the odds: for the latest-listed 30%, odds
// computed from earlier-listed peers only, against their actual token rate.
function oddsWalkForward(): { predicted: number; actual: number; n: number } {
  const dated = snap.protocols.filter((p) => p.listed_at !== null);
  dated.sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : 1));
  const cut = Math.floor(dated.length * 0.7);
  const early = dated.slice(0, cut);
  const late = dated.slice(cut);
  const preds: number[] = [];
  const acts: number[] = [];
  for (const p of late) {
    const o = peerOdds(p, early);
    if (o.peers >= 5) {
      preds.push(o.odds);
      acts.push(hasToken(p) ? 1 : 0);
    }
  }
  return { predicted: mean(preds), actual: mean(acts), n: preds.length };
}

const oddsAuc = aucScore();
const oddsWf = oddsWalkForward();

// ---------------------------------------------------------------------------
// The board: every pre-token protocol the exclusion rule keeps, plus the
// whole watchlist. The rule is the watchlist's own, applied to the ten
// fields the snapshot carries.
// ---------------------------------------------------------------------------

const VERSION_MARK = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const BAD_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

function exclusionReason(p: Protocol): string | null {
  if (VERSION_MARK.test(p.name)) return 'versioned name';
  if (p.category !== null && BAD_CATEGORIES.has(p.category)) return `category ${p.category}`;
  if (/\bwrapped\b|\bstaked\b|\bstaking\b/i.test(p.name)) return 'wrapped/staked name';
  if (EXCHANGE_PREFIXES.some((e) => p.name.startsWith(e))) return 'exchange product';
  return null;
}

const boardProtocols = snap.protocols.filter((p) => {
  if (hasToken(p)) return false;
  if (watchSet.has(p.slug)) return true;
  return exclusionReason(p) === null;
});

// ---------------------------------------------------------------------------
// Farm plans: concrete steps with what they cost and how long they take.
// Gas is a planning estimate per transaction on the protocol's first chain.
// ---------------------------------------------------------------------------

const GAS_USD: Record<string, number> = {
  Ethereum: 4.5,
  Arbitrum: 0.3,
  Optimism: 0.25,
  Base: 0.15,
  BSC: 0.3,
  Solana: 0.05,
  Polygon: 0.1,
  Avalanche: 0.5,
  zkSync: 0.4,
  Linea: 0.3,
  Gnosis: 0.2,
  Fantom: 0.15,
  Mantle: 0.2,
  Scroll: 0.25,
  Blast: 0.2,
};

function gasFor(p: Protocol): number {
  return GAS_USD[p.chains[0] ?? ''] ?? 0.6;
}

type PlanStep = { text: string; gasUsd: number; minutes: number; capitalUsd: number };

function planFor(p: Protocol): PlanStep[] {
  const g = gasFor(p);
  const chain = p.chains[0] ?? 'its main chain';
  const name = p.name;
  const cat = p.category ?? 'protocol';
  switch (cat) {
    case 'Dexs':
      return [
        { text: `Bridge or buy $100 of the base asset on ${chain} and hold it in a wallet you control; one swap, about $${g.toFixed(2)} in gas, 10 minutes.`, gasUsd: g, minutes: 10, capitalUsd: 100 },
        { text: `Swap half into the pool's paired asset on ${name}'s own pools so both sides are ready; one swap, about $${g.toFixed(2)} in gas, 5 minutes.`, gasUsd: g, minutes: 5, capitalUsd: 50 },
        { text: `Add $100 to $200 of liquidity to ${name}'s largest pool and keep the LP position open; one deposit, about $${g.toFixed(2)} in gas, 10 minutes.`, gasUsd: g, minutes: 10, capitalUsd: 100 },
        { text: `Route a small trade through ${name} every week so the position records real volume; one swap a week, about $${g.toFixed(2)} in gas each, 5 minutes a week.`, gasUsd: g, minutes: 5, capitalUsd: 0 },
        { text: `Claim pool fees monthly and re-add them to the position instead of selling; one claim, about $${g.toFixed(2)} in gas, 10 minutes a month.`, gasUsd: g, minutes: 10, capitalUsd: 0 },
      ];
    case 'Lending':
      return [
        { text: `Deposit $150 of collateral into ${name} on ${chain}; one deposit, about $${g.toFixed(2)} in gas, 10 minutes.`, gasUsd: g, minutes: 10, capitalUsd: 150 },
        { text: `Borrow $50 against the deposit at a conservative loan-to-value so the position survives a 30% dip; one borrow, about $${g.toFixed(2)} in gas, 5 minutes.`, gasUsd: g, minutes: 5, capitalUsd: 0 },
        { text: `Supply the borrowed $50 back into ${name}'s highest-yield market to keep the loop earning; one supply, about $${g.toFixed(2)} in gas, 5 minutes.`, gasUsd: g, minutes: 5, capitalUsd: 50 },
        { text: `Check the health factor weekly and top up collateral if it falls under 1.5; 5 minutes a week, no gas unless you act.`, gasUsd: 0, minutes: 5, capitalUsd: 0 },
        { text: `Repay the borrow and withdraw the collateral only after a token is announced; one repay and one withdraw, about $${(2 * g).toFixed(2)} in gas, 10 minutes.`, gasUsd: 2 * g, minutes: 10, capitalUsd: 0 },
      ];
    case 'Yield':
    case 'Yield Aggregator':
      return [
        { text: `Deposit $150 into ${name}'s flagship vault on ${chain}; one deposit, about $${g.toFixed(2)} in gas, 10 minutes.`, gasUsd: g, minutes: 10, capitalUsd: 150 },
        { text: `Leave the deposit compounding for at least 30 days; vaults reward sticky capital, and early exits usually forfeit the boost.`, gasUsd: 0, minutes: 0, capitalUsd: 0 },
        { text: `Add a second $50 deposit in week two so the position shows two distinct funding events; one deposit, about $${g.toFixed(2)} in gas, 5 minutes.`, gasUsd: g, minutes: 5, capitalUsd: 50 },
        { text: `Claim vault rewards monthly and re-deposit them; one claim, about $${g.toFixed(2)} in gas, 10 minutes a month.`, gasUsd: g, minutes: 10, capitalUsd: 0 },
        { text: `Vote in the vault's governance or forum once a quarter if it opens one; 15 minutes, no gas on an off-chain vote.`, gasUsd: 0, minutes: 15, capitalUsd: 0 },
      ];
    case 'Derivatives':
      return [
        { text: `Deposit $150 of margin collateral into ${name} on ${chain}; one deposit, about $${g.toFixed(2)} in gas, 10 minutes.`, gasUsd: g, minutes: 10, capitalUsd: 150 },
        { text: `Open a small $50 perpetual position at 2x leverage and hold it at least a week; one trade, about $${g.toFixed(2)} in gas, 10 minutes.`, gasUsd: g, minutes: 10, capitalUsd: 50 },
        { text: `Provide $50 to ${name}'s liquidity pool so the account earns maker fees as well as trading volume; one deposit, about $${g.toFixed(2)} in gas, 5 minutes.`, gasUsd: g, minutes: 5, capitalUsd: 50 },
        { text: `Close losing positions before the margin ratio falls under 150% to avoid liquidation; 5 minutes a check, no gas unless you trade.`, gasUsd: 0, minutes: 5, capitalUsd: 0 },
        { text: `Settle and withdraw the margin after a token announcement; one close and one withdraw, about $${(2 * g).toFixed(2)} in gas, 10 minutes.`, gasUsd: 2 * g, minutes: 10, capitalUsd: 0 },
      ];
    case 'CDP':
      return [
        { text: `Lock $200 of collateral in ${name}'s vault on ${chain} to mint its stable asset; one deposit, about $${g.toFixed(2)} in gas, 10 minutes.`, gasUsd: g, minutes: 10, capitalUsd: 200 },
        { text: `Mint $80 of the stable asset at a collateral ratio above 200%; one mint, about $${g.toFixed(2)} in gas, 5 minutes.`, gasUsd: g, minutes: 5, capitalUsd: 0 },
        { text: `Use the minted $80 in ${name}'s own savings or farming market so the debt earns while it sits; one deposit, about $${g.toFixed(2)} in gas, 5 minutes.`, gasUsd: g, minutes: 5, capitalUsd: 80 },
        { text: `Watch the collateral ratio weekly and add collateral if it nears 150%; 5 minutes a week, no gas unless you act.`, gasUsd: 0, minutes: 5, capitalUsd: 0 },
        { text: `Repay the $80 and unlock the $200 collateral after a token is announced; one repay and one unlock, about $${(2 * g).toFixed(2)} in gas, 10 minutes.`, gasUsd: 2 * g, minutes: 10, capitalUsd: 0 },
      ];
    case 'Restaking':
      return [
        { text: `Stake $150 of the base asset through ${name} on ${chain}; one stake, about $${g.toFixed(2)} in gas, 10 minutes.`, gasUsd: g, minutes: 10, capitalUsd: 150 },
        { text: `Restake the receipt token into ${name}'s restaking pool so the same capital secures a second service; one restake, about $${g.toFixed(2)} in gas, 5 minutes.`, gasUsd: g, minutes: 5, capitalUsd: 0 },
        { text: `Delegate to an operator with under 5% of total stake to spread slashing risk; one delegation, about $${g.toFixed(2)} in gas, 5 minutes.`, gasUsd: g, minutes: 5, capitalUsd: 0 },
        { text: `Claim restaking rewards monthly and re-stake them; one claim, about $${g.toFixed(2)} in gas, 10 minutes a month.`, gasUsd: g, minutes: 10, capitalUsd: 0 },
        { text: `Unstake only after a token announcement, minding the unbonding wait of up to 7 days; one unstake, about $${g.toFixed(2)} in gas, 5 minutes.`, gasUsd: g, minutes: 5, capitalUsd: 0 },
      ];
    case 'RWA':
      return [
        { text: `Buy $200 of ${name}'s tokenized asset on ${chain} through its own market; one purchase, about $${g.toFixed(2)} in gas, 15 minutes.`, gasUsd: g, minutes: 15, capitalUsd: 200 },
        { text: `Hold the position at least 30 days; real-world-asset products reward holders, not flippers, and short holds rarely qualify.`, gasUsd: 0, minutes: 0, capitalUsd: 0 },
        { text: `Reinvest the first yield payout back into the same asset; one reinvestment, about $${g.toFixed(2)} in gas, 10 minutes.`, gasUsd: g, minutes: 10, capitalUsd: 0 },
        { text: `Complete the platform's identity check if it asks for one before a distribution; 20 minutes once, no gas.`, gasUsd: 0, minutes: 20, capitalUsd: 0 },
        { text: `Sell only after a token announcement or a distribution you have claimed; one sale, about $${g.toFixed(2)} in gas, 10 minutes.`, gasUsd: g, minutes: 10, capitalUsd: 0 },
      ];
    default:
      return [
        { text: `Use ${name} on ${chain} with $100 of real activity: deposit, swap or stake through its main feature; one transaction, about $${g.toFixed(2)} in gas, 15 minutes.`, gasUsd: g, minutes: 15, capitalUsd: 100 },
        { text: `Repeat the core action a second time a week later so the account shows two distinct weeks of use; one transaction, about $${g.toFixed(2)} in gas, 10 minutes.`, gasUsd: g, minutes: 10, capitalUsd: 50 },
        { text: `Hold the position at least 30 days; short holds rarely count toward a distribution.`, gasUsd: 0, minutes: 0, capitalUsd: 0 },
        { text: `Join ${name}'s governance forum or community channel and vote once if a proposal opens; 15 minutes, no gas on an off-chain vote.`, gasUsd: 0, minutes: 15, capitalUsd: 0 },
        { text: `Withdraw or close the position only after a token announcement; one exit, about $${g.toFixed(2)} in gas, 10 minutes.`, gasUsd: g, minutes: 10, capitalUsd: 0 },
      ];
  }
}

// Verdicts: expected capture is implied value x launch odds x a 0.1% farmer
// share — a deliberately conservative planning haircut, stated on the page.
// Net $/hour subtracts the plan's gas and fees and divides by its active
// hours. Thresholds sit on the board's own distribution: FARM at the 85th
// percentile (~$10,000/hr), MARGINAL above $2,500/hr, SKIP below.
const FARMER_SHARE = 0.001;
const FARM_LINE = 10000;
const MARGINAL_LINE = 2500;
const MAX_FARM_CAPITAL = 1000;

type BoardRow = {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  age_days: number | null;
  interval_lo_usd: number;
  interval_hi_usd: number;
  launch_odds: number;
  peer_count: number;
  verdict: 'farm' | 'marginal' | 'skip';
  net_usd_per_hour: number;
  expected_capture_usd: number;
  plan_cost_usd: number;
  plan_hours: number;
  min_capital_usd: number;
  plan_detail: PlanStep[];
};

const rows: BoardRow[] = boardProtocols
  .map((p) => {
    const implied = impliedValue(p);
    const lo = Math.max(1, Math.round(implied * Math.pow(10, -halfWidth80)));
    const hi = Math.round(implied * Math.pow(10, halfWidth80));
    const odds = oddsBySlug.get(p.slug)!;
    const steps = planFor(p);
    const cost = steps.reduce((s, st) => s + st.gasUsd, 0);
    const minutes = steps.reduce((s, st) => s + st.minutes, 0);
    const hours = Math.max(0.25, minutes / 60);
    const capital = steps.reduce((s, st) => s + st.capitalUsd, 0);
    const capture = implied * odds.odds * FARMER_SHARE;
    const netPerHour = (capture - cost) / hours;
    const verdict: BoardRow['verdict'] =
      netPerHour >= FARM_LINE && capital <= MAX_FARM_CAPITAL ? 'farm' : netPerHour >= MARGINAL_LINE ? 'marginal' : 'skip';
    return {
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: Math.max(1, Math.round(implied)),
      farm_steps: steps.map((st) => st.text),
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      age_days: ageDays(p),
      interval_lo_usd: lo,
      interval_hi_usd: hi,
      launch_odds: Math.round(odds.odds * 1000) / 1000,
      peer_count: odds.peers,
      verdict,
      net_usd_per_hour: Math.round(netPerHour),
      expected_capture_usd: Math.round(capture),
      plan_cost_usd: Math.round(cost * 100) / 100,
      plan_hours: Math.round(hours * 100) / 100,
      min_capital_usd: capital,
      plan_detail: steps,
    };
  })
  .sort((a, b) => b.implied_value_usd - a.implied_value_usd);

rows.forEach((r, i) => {
  r.rank = i + 1;
});

const verdictCounts = {
  farm: rows.filter((r) => r.verdict === 'farm').length,
  marginal: rows.filter((r) => r.verdict === 'marginal').length,
  skip: rows.filter((r) => r.verdict === 'skip').length,
};
const totalImplied = rows.reduce((s, r) => s + r.implied_value_usd, 0);

const keptNames = termTests.filter((t) => t.kept).map((t) => t.term);
function signedTerm(coef: number, label: string): string {
  const c = round4(coef);
  return c < 0 ? `- ${Math.abs(c)} x ${label}` : `+ ${c} x ${label}`;
}
const formulaParts =
  `log10(market cap) = ${round4(finalBeta[0])} ` +
  signedTerm(finalBeta[1]!, 'log10(TVL)') +
  keptNames.map((n, i) => ` ${signedTerm(finalBeta[2 + i]!, `[${n}]`)}`).join('');

const modelSummary = {
  formula: formulaParts,
  intercept: round4(finalBeta[0]),
  slopeTvl: round4(finalBeta[1]),
  keptTermNames: termTests.filter((t) => t.kept).map((t) => t.term),
  fittedOn: priced.length,
  baseLoo: round4(baseLoo.rmse),
  baseWalkForward: round4(baseWf.rmse),
  looRmse: round4(finalLoo.rmse),
  walkForwardRmse: round4(finalWf.rmse),
  walkForwardNTrain: finalWf.nTrain,
  walkForwardNTest: finalWf.nTest,
  olsLoo: round4(olsLoo.rmse),
  olsWalkForward: round4(olsWf.rmse),
  conformalHalfWidth80: round4(halfWidth80),
  conformalCoverage80: round4(coverage80),
  conformalHalfWidth90: round4(halfWidth90),
  conformalCoverage90: round4(coverage90),
  termTests,
  oddsMethod: 'share of peers with a token among protocols within +/-0.5 dex TVL and +/-0.3 dex age (TVL-only fallback when fewer than 10 peers)',
  oddsAuc: round4(oddsAuc),
  oddsWalkForward: { predicted: round4(oddsWf.predicted), actual: round4(oddsWf.actual), n: oddsWf.n },
  farmerShare: FARMER_SHARE,
  farmLine: FARM_LINE,
  marginalLine: MARGINAL_LINE,
  maxFarmCapital: MAX_FARM_CAPITAL,
};

const integrity = {
  asOf: snap.as_of,
  source: snap.source,
  floorUsd: snap.floor_usd,
  protocols: snap.protocols.length,
  withToken: snap.protocols.filter(hasToken).length,
  preToken: snap.protocols.filter((p) => !hasToken(p)).length,
  watchlist: snap.watchlist.length,
  watchlistCovered: rows.filter((r) => watchSet.has(r.slug)).length,
  boardRows: rows.length,
  totalImpliedUsd: totalImplied,
  missingListedAt: snap.protocols.filter((p) => p.listed_at === null).length,
  missingChange7d: snap.protocols.filter((p) => p.change_7d === null).length,
  missingMcapAmongToken: snap.protocols.filter((p) => hasToken(p) && p.mcap_usd === null).length,
  verdicts: verdictCounts,
};

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function boardIssue(): string | null {
  if (rows.length < 100) return `board holds ${rows.length} rows, the gate needs at least 100`;
  const seen = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (seen.has(r.slug)) return `duplicate slug ${r.slug}`;
    seen.add(r.slug);
    if (r.rank !== i + 1) return `row ${r.slug} has rank ${r.rank}, expected ${i + 1}`;
    if (i > 0 && r.implied_value_usd > rows[i - 1]!.implied_value_usd) return `implied value rises at rank ${r.rank}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `row ${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `row ${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  for (const slug of snap.watchlist) {
    if (!seen.has(slug)) return `watchlist slug ${slug} missing from the board`;
  }
  return null;
}

const issue = boardIssue();
if (issue !== null) {
  process.stderr.write(`northlight: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows, model: modelSummary, integrity })}\n`);

const radarData = { rows, model: modelSummary, integrity };
writeFileSync(join(outDir, 'data.js'), `window.RADAR = ${JSON.stringify(radarData)};\n`);

function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(outDir, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`northlight: screenshots/ holds ${shots.length} image(s): hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`northlight: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
);

process.stdout.write(
  `northlight: ${snap.protocols.length} protocols, ${snap.watchlist.length} on the watchlist, ${rows.length} rows scored\n` +
    `northlight: model ${modelSummary.formula}\n` +
    `northlight: held-out twice — LOO RMSE ${modelSummary.looRmse} (base ${modelSummary.baseLoo}), walk-forward RMSE ${modelSummary.walkForwardRmse} (base ${modelSummary.baseWalkForward}, ${modelSummary.walkForwardNTrain} train / ${modelSummary.walkForwardNTest} test)\n` +
    `northlight: terms kept ${modelSummary.keptTermNames.length} of ${termTests.length} tested; dropped: ${termTests.filter((t) => !t.kept).map((t) => t.term).join('; ')}\n` +
    `northlight: conformal 80% half-width ${modelSummary.conformalHalfWidth80} dex, coverage ${modelSummary.conformalCoverage80}; 90% half-width ${modelSummary.conformalHalfWidth90} dex, coverage ${modelSummary.conformalCoverage90}\n` +
    `northlight: peer odds AUC ${modelSummary.oddsAuc}; walk-forward odds predicted ${modelSummary.oddsWalkForward.predicted} vs actual ${modelSummary.oddsWalkForward.actual} (n=${modelSummary.oddsWalkForward.n})\n` +
    `northlight: verdicts farm ${verdictCounts.farm} / marginal ${verdictCounts.marginal} / skip ${verdictCounts.skip}; total implied $${totalImplied.toLocaleString('en-US')}\n` +
    `northlight: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ${join(outDir, 'dashboard')}, ${join(outDir, 'screenshots')} (${shots.length} images) and ${join(outDir, 'dossier.json')}\n`,
);
