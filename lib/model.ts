// Launch Radar — Signal v5 (clean rebuild).
//
// The model, in one paragraph: a protocol with no token yet is worth the
// value its token would carry if it launched, times the chance it ever
// launches. The value-if-it-launches comes from a size curve fitted on the
// snapshot's own token-bearing protocols (log market cap on log TVL). The
// launch chance comes from how often protocols of the same no-token age
// record a token, pooled so the rate never falls as age rises. Seven-day
// growth is shown on the board but never priced: on this snapshot its
// coefficient is negative, and a tilted model tests worse. Farm economics
// are costed, not asserted: a 7% drop shared by 2,000 farmers, $36 of gas,
// the deposit's opportunity cost, and the hours the plan itself takes.
//
// Nothing here names a protocol. Every number is fitted or counted from the
// snapshot passed in at run time.

export interface Protocol {
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
  protocols: Protocol[];
  watchlist: string[];
}

export interface FarmParams {
  dropShare: number; // share of the implied value paid out to farmers
  farmers: number; // farmers splitting that payout
  gasPerSessionUsd: number;
  sessions: number;
  depositUsd: number;
  apr: number; // opportunity cost of the deposit, per year
  horizonWeeks: number;
  farmThresholdUsdPerHour: number;
  stepMinutes: {
    verify: number;
    fund: number;
    inspect: number;
    review: number;
    rewardsWeekly: number;
    close: number;
  };
}

export const DEFAULT_PARAMS: FarmParams = {
  dropShare: 0.07,
  farmers: 2000,
  gasPerSessionUsd: 12,
  sessions: 3,
  depositUsd: 1000,
  apr: 0.045,
  horizonWeeks: 12,
  farmThresholdUsdPerHour: 30,
  stepMinutes: { verify: 8, fund: 15, inspect: 10, review: 15, rewardsWeekly: 15, close: 10 },
};

// ---------------------------------------------------------------- helpers

export function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function quantile(sortedAsc: number[], p: number): number {
  return sortedAsc[Math.min(sortedAsc.length - 1, Math.floor(p * (sortedAsc.length - 1)))];
}

export function hasToken(p: Protocol): boolean {
  return p.gecko_id !== null || p.symbol !== null;
}

/** Whole years between the snapshot date and the day DefiLlama began tracking the protocol. */
export function ageYears(p: Protocol, asOf: Date): number | null {
  if (!p.listed_at) return null;
  const listed = new Date(p.listed_at + "T00:00:00Z").getTime();
  return (asOf.getTime() - listed) / (365 * 86400 * 1000);
}

// ------------------------------------------------------- classification

const VERSION_TAIL = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCHANGE_NAMES = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

export function isVersioned(p: Protocol): boolean {
  return VERSION_TAIL.test(p.name);
}

export function isBridge(p: Protocol): boolean {
  return p.category === "Bridge" || p.category === "Canonical Bridge";
}

export function isLiquidStaking(p: Protocol): boolean {
  return p.category === "Liquid Staking" || p.category === "Liquid Restaking" || p.category === "Restaked BTC";
}

export function isExchange(p: Protocol): boolean {
  return p.category === "CEX" || EXCHANGE_NAMES.test(p.name);
}

/** A pre-token protocol the radar will not rank: a version of something else,
 *  a bridge, a liquid-staking product, or an exchange. Its token, if any,
 *  belongs to the product it wraps. */
export function isExcluded(p: Protocol): boolean {
  return isVersioned(p) || isBridge(p) || isLiquidStaking(p) || isExchange(p);
}

export type Tier = "watchlist" | "early" | "off-list" | "priced" | "no-cap" | "excluded";

/** Which bucket a protocol falls in. The ranked board is watchlist + early +
 *  off-list: every protocol that records no token and is not excluded. */
export function tierOf(p: Protocol, watchlist: Set<string>, floorUsd: number): Tier {
  if (isExcluded(p)) return "excluded";
  if (hasToken(p)) return p.mcap_usd !== null && p.mcap_usd > 0 ? "priced" : "no-cap";
  if (watchlist.has(p.slug)) return "watchlist";
  if (p.tvl_usd < floorUsd) return "early";
  return "off-list";
}

// ------------------------------------------------------------- the fit

export interface LineFit {
  intercept: number;
  slope: number;
  r2: number;
  sd: number;
  n: number;
}

/** Ordinary least squares of y on x. */
export function fitLine(xs: number[], ys: number[]): LineFit {
  const n = xs.length;
  const mx = mean(xs);
  const my = mean(ys);
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) * (xs[i] - mx);
    sxy += (xs[i] - mx) * (ys[i] - my);
    syy += (ys[i] - my) * (ys[i] - my);
  }
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let ssr = 0;
  for (let i = 0; i < n; i++) {
    const resid = ys[i] - (intercept + slope * xs[i]);
    ssr += resid * resid;
  }
  return { intercept, slope, r2: 1 - ssr / syy, sd: Math.sqrt(ssr / (n - 2)), n };
}

/** OLS of y on two predictors, solved by the 2x2 normal equations. */
export function fitTwo(x1: number[], x2: number[], y: number[]): { intercept: number; b1: number; b2: number; n: number } {
  const n = x1.length;
  const m1 = mean(x1);
  const m2 = mean(x2);
  const my = mean(y);
  let s11 = 0;
  let s12 = 0;
  let s22 = 0;
  let t1 = 0;
  let t2 = 0;
  for (let i = 0; i < n; i++) {
    const a = x1[i] - m1;
    const b = x2[i] - m2;
    const c = y[i] - my;
    s11 += a * a;
    s12 += a * b;
    s22 += b * b;
    t1 += a * c;
    t2 += b * c;
  }
  const det = s11 * s22 - s12 * s12;
  const b1 = (t1 * s22 - t2 * s12) / det;
  const b2 = (t2 * s11 - t1 * s12) / det;
  return { intercept: my - b1 * m1 - b2 * m2, b1, b2, n };
}

// ----------------------------------------------------------- launch odds

export interface AgeBand {
  label: string;
  lo: number;
  hi: number;
  n: number;
  withToken: number;
  rawRate: number;
  rate: number; // after monotone pooling
}

const BAND_EDGES: Array<[number, number, string]> = [
  [0, 0.5, "<6mo"],
  [0.5, 1, "6–12mo"],
  [1, 2, "1–2y"],
  [2, 4, "2–4y"],
  [4, Infinity, ">4y"],
];

/** Share of protocols in each no-token-age band that record a token, pooled
 *  with the pool-adjacent-violators rule so the rate never falls with age.
 *  A band with no protocols keeps the previous band's rate. */
export function ageBandRates(protocols: Protocol[], asOf: Date): AgeBand[] {
  const bands: AgeBand[] = BAND_EDGES.map(([lo, hi, label]) => {
    const inBand = protocols.filter((p) => {
      const age = ageYears(p, asOf);
      return age !== null && age >= lo && age < hi;
    });
    const withToken = inBand.filter(hasToken).length;
    return { label, lo, hi, n: inBand.length, withToken, rawRate: inBand.length ? withToken / inBand.length : 0, rate: 0 };
  });
  // Pool adjacent violators, weighted by band size.
  const blocks: Array<{ rate: number; n: number; count: number }> = bands.map((b) => ({ rate: b.rawRate, n: b.n, count: 1 }));
  for (let i = 1; i < blocks.length; i++) {
    let j = i;
    while (j > 0 && blocks[j - 1].rate > blocks[j].rate) {
      const total = blocks[j - 1].n + blocks[j].n;
      const pooled = total ? (blocks[j - 1].rate * blocks[j - 1].n + blocks[j].rate * blocks[j].n) / total : blocks[j - 1].rate;
      blocks[j - 1] = { rate: pooled, n: total, count: blocks[j - 1].count + blocks[j].count };
      blocks.splice(j, 1);
      j--;
    }
  }
  let idx = 0;
  for (const block of blocks) {
    for (let k = 0; k < block.count; k++) bands[idx++].rate = block.rate;
  }
  return bands;
}

export function oddsForAge(age: number | null, bands: AgeBand[]): number {
  if (age === null) return bands[2].rate; // unknown age: the middle band
  for (const band of bands) {
    if (age >= band.lo && age < band.hi) return band.rate;
  }
  return bands[bands.length - 1].rate;
}

/** Brier score of the band odds as a token predictor, against the base rate. */
export function brierScore(protocols: Protocol[], bands: AgeBand[], asOf: Date): { model: number; base: number; n: number } {
  const dated = protocols.filter((p) => ageYears(p, asOf) !== null);
  const baseRate = dated.filter(hasToken).length / dated.length;
  let modelSum = 0;
  let baseSum = 0;
  for (const p of dated) {
    const truth = hasToken(p) ? 1 : 0;
    const pred = oddsForAge(ageYears(p, asOf), bands);
    modelSum += (pred - truth) * (pred - truth);
    baseSum += (baseRate - truth) * (baseRate - truth);
  }
  return { model: modelSum / dated.length, base: baseSum / dated.length, n: dated.length };
}

// ------------------------------------------------------------- validation

export interface Holdout {
  modelMiss: number; // median absolute miss multiple, model
  flatMiss: number; // median absolute miss multiple, flat baseline
  nTest: number;
}

/** Leave-one-out median absolute miss multiple for the size curve, against a
 *  flat baseline that predicts every protocol at the mean log-cap. */
export function looMiss(priced: Protocol[]): Holdout {
  const xs = priced.map((p) => Math.log10(p.tvl_usd));
  const ys = priced.map((p) => Math.log10(p.mcap_usd as number));
  const modelErrs: number[] = [];
  const flatErrs: number[] = [];
  for (let i = 0; i < priced.length; i++) {
    const ox = xs.filter((_, j) => j !== i);
    const oy = ys.filter((_, j) => j !== i);
    const fit = fitLine(ox, oy);
    modelErrs.push(Math.abs(ys[i] - (fit.intercept + fit.slope * xs[i])));
    flatErrs.push(Math.abs(ys[i] - mean(oy)));
  }
  return { modelMiss: Math.pow(10, median(modelErrs)), flatMiss: Math.pow(10, median(flatErrs)), nTest: priced.length };
}

/** Walk-forward: fit on the older half (by listed date), test on the newer half. */
export function walkForward(priced: Protocol[]): Holdout {
  const dated = priced.filter((p) => p.listed_at).sort((a, b) => (a.listed_at as string).localeCompare(b.listed_at as string));
  const cut = Math.floor(dated.length / 2);
  const train = dated.slice(0, cut);
  const test = dated.slice(cut);
  const fit = fitLine(
    train.map((p) => Math.log10(p.tvl_usd)),
    train.map((p) => Math.log10(p.mcap_usd as number)),
  );
  const trainMean = mean(train.map((p) => Math.log10(p.mcap_usd as number)));
  const modelErrs = test.map((p) => Math.abs(Math.log10(p.mcap_usd as number) - (fit.intercept + fit.slope * Math.log10(p.tvl_usd))));
  const flatErrs = test.map((p) => Math.abs(Math.log10(p.mcap_usd as number) - trainMean));
  return { modelMiss: Math.pow(10, median(modelErrs)), flatMiss: Math.pow(10, median(flatErrs)), nTest: test.length };
}

/** The growth experiment: add 7-day change to the size curve, at half weight
 *  and clamped, and see whether the tilted curve predicts better out of
 *  sample — and how many pre-token rows it would move by more than 10%. */
export function growthExperiment(priced: Protocol[], preToken: Protocol[], fit: LineFit): {
  coefficient: number;
  n: number;
  looModel: number;
  looTilted: number;
  wfModel: number;
  wfTilted: number;
  movedRows: number;
} {
  const withGrowth = priced.filter((p) => p.change_7d !== null);
  const two = fitTwo(
    withGrowth.map((p) => Math.log10(p.tvl_usd)),
    withGrowth.map((p) => (p.change_7d as number) / 100),
    withGrowth.map((p) => Math.log10(p.mcap_usd as number)),
  );
  const coefficient = two.b2;
  // Half-weight tilt, clamped to a factor of 2 either way. Takes the
  // coefficient it is fitted with, so the leave-one-out run never sees the
  // protocol it is predicting.
  const tilt = (changePct: number | null, coef: number): number => {
    if (changePct === null) return 0;
    const raw = 0.5 * coef * (changePct / 100);
    return Math.max(-0.3, Math.min(0.3, raw));
  };
  // Leave-one-out, tilted vs plain, on the growth-reporting subset.
  const xs = withGrowth.map((p) => Math.log10(p.tvl_usd));
  const ys = withGrowth.map((p) => Math.log10(p.mcap_usd as number));
  const plainErrs: number[] = [];
  const tiltErrs: number[] = [];
  for (let i = 0; i < withGrowth.length; i++) {
    const sub = fitTwo(
      xs.filter((_, j) => j !== i),
      withGrowth.filter((_, j) => j !== i).map((p) => (p.change_7d as number) / 100),
      ys.filter((_, j) => j !== i),
    );
    const plain = sub.intercept + sub.b1 * xs[i];
    plainErrs.push(Math.abs(ys[i] - plain));
    tiltErrs.push(Math.abs(ys[i] - (plain + tilt(withGrowth[i].change_7d, sub.b2))));
  }
  // Walk-forward, tilted vs plain.
  const dated = withGrowth.filter((p) => p.listed_at).sort((a, b) => (a.listed_at as string).localeCompare(b.listed_at as string));
  const cut = Math.floor(dated.length / 2);
  const train = dated.slice(0, cut);
  const test = dated.slice(cut);
  const wfFit = fitTwo(
    train.map((p) => Math.log10(p.tvl_usd)),
    train.map((p) => (p.change_7d as number) / 100),
    train.map((p) => Math.log10(p.mcap_usd as number)),
  );
  const wfPlain = test.map((p) => Math.abs(Math.log10(p.mcap_usd as number) - (wfFit.intercept + wfFit.b1 * Math.log10(p.tvl_usd))));
  const wfTilt = test.map(
    (p) => Math.abs(Math.log10(p.mcap_usd as number) - (wfFit.intercept + wfFit.b1 * Math.log10(p.tvl_usd) + tilt(p.change_7d, wfFit.b2))),
  );
  let movedRows = 0;
  for (const p of preToken) {
    const t = tilt(p.change_7d, coefficient);
    if (Math.abs(Math.pow(10, t) - 1) > 0.1) movedRows++;
  }
  return {
    coefficient,
    n: withGrowth.length,
    looModel: Math.pow(10, median(plainErrs)),
    looTilted: Math.pow(10, median(tiltErrs)),
    wfModel: Math.pow(10, median(wfPlain)),
    wfTilted: Math.pow(10, median(wfTilt)),
    movedRows,
  };
}

// ---------------------------------------------------------- farm economics

export interface Economics {
  fittedValueUsd: number;
  impliedValueUsd: number;
  rangeLoUsd: number;
  rangeHiUsd: number;
  grossUsd: number;
  gasUsd: number;
  opportunityUsd: number;
  netUsd: number;
  hours: number;
  netPerHourUsd: number;
  verdict: "FARM" | "MARGINAL" | "SKIP";
}

export function planHours(params: FarmParams): number {
  const m = params.stepMinutes;
  const minutes = m.verify + m.fund + m.inspect + m.review + m.rewardsWeekly * params.horizonWeeks + m.close;
  return minutes / 60;
}

export function economics(impliedValueUsd: number, fittedValueUsd: number, rangeLo: number, rangeHi: number, params: FarmParams): Economics {
  const grossUsd = (impliedValueUsd * params.dropShare) / params.farmers;
  const gasUsd = params.gasPerSessionUsd * params.sessions;
  const opportunityUsd = params.depositUsd * params.apr * (params.horizonWeeks / 52);
  const netUsd = grossUsd - gasUsd - opportunityUsd;
  const hours = planHours(params);
  const netPerHourUsd = netUsd / hours;
  const verdict = netPerHourUsd >= params.farmThresholdUsdPerHour ? "FARM" : netUsd > 0 ? "MARGINAL" : "SKIP";
  return { fittedValueUsd, impliedValueUsd, rangeLoUsd: rangeLo, rangeHiUsd: rangeHi, grossUsd, gasUsd, opportunityUsd, netUsd, hours, netPerHourUsd, verdict };
}

// --------------------------------------------------------------- farm plan

const PLACE_NOUN: Record<string, string> = {
  Dexs: "pool",
  Lending: "market",
  "Risk Curators": "vault",
  CDP: "vault",
  "Prediction Market": "market",
  "Yield Aggregator": "vault",
  Yield: "vault",
  Derivatives: "market",
  RWA: "vault",
};

function placeNoun(category: string | null): string {
  if (category && PLACE_NOUN[category]) return PLACE_NOUN[category];
  return "position";
}

function money(n: number): string {
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(1) + "K";
  return "$" + n.toFixed(2);
}

function moneyExact(n: number): string {
  return "$" + n.toFixed(2);
}

/** Six concrete steps for one protocol, each carrying its own cost and time.
 *  The wording is generated from the protocol's own record — name, chain,
 *  category — never from a list of names. */
export function planSteps(
  p: Protocol,
  econ: Economics,
  params: FarmParams,
): string[] {
  const chain = p.chains[0] ?? "its main chain";
  const noun = placeNoun(p.category);
  const m = params.stepMinutes;
  const gasEach = moneyExact(params.gasPerSessionUsd);
  return [
    `Verify ${p.name} through its own documentation and confirm ${chain} support before connecting a wallet. Cost: $0. Time: ${m.verify} minutes.`,
    `Fund your wallet on ${chain} over a route you already trust. Budget ${gasEach} of gas per session across ${params.sessions} sessions (${moneyExact(econ.gasUsd)} in all) plus the ${money(params.depositUsd)} deposit plan. Time: ${m.fund} minutes.`,
    `Open one ${noun} on ${chain}: read its asset, fee and deposit cap, preview a ${money(params.depositUsd)} deposit, and enter only when the withdrawal path is clear. Cost: $0–5 in fees plus ${money(params.depositUsd)} of test capital at risk. Time: ${m.inspect} minutes.`,
    `Review the protocol's allocations and withdrawal queue, then redeem a small part to prove the exit works before adding more. Cost: $0 to review, $0–5 for the exit test. Time: ${m.review} minutes, plus any disclosed lock-up.`,
    `Open the rewards or points page and the eligibility terms; save the transaction hash and any points shown. No campaign is assumed. Cost: $0. Time: ${m.rewardsWeekly} minutes a week.`,
    `After ${params.horizonWeeks} weeks, compare the ${money(econ.netUsd)} net of fees (${moneyExact(econ.netPerHourUsd)} an hour) with this plan: verdict ${econ.verdict}. Withdraw when the test stops paying and revoke approvals you no longer use. Cost: $0–5 of gas. Time: ${m.close} minutes.`,
  ];
}

// ------------------------------------------------------------------ board

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_years: number | null;
  tier: Tier;
  fitted_value_usd: number;
  odds: number;
  range_lo_usd: number;
  range_hi_usd: number;
  gross_usd: number;
  gas_usd: number;
  opportunity_usd: number;
  net_usd: number;
  net_per_hour_usd: number;
  verdict: "FARM" | "MARGINAL" | "SKIP";
  rank_lo: number;
  rank_hi: number;
}

export interface CompRow {
  slug: string;
  name: string;
  tvl_usd: number;
  mcap_usd: number;
  fitted_usd: number;
  miss: number; // real cap divided by fitted cap
  listed_at: string | null;
}

export interface BoardStats {
  asOf: string;
  protocolsRead: number;
  watchlistCount: number;
  rankedCount: number;
  ledger: Record<string, number>;
  fit: LineFit;
  bands: AgeBand[];
  brier: { model: number; base: number; n: number };
  loo: Holdout;
  walkForward: Holdout;
  growth: {
    coefficient: number;
    n: number;
    looModel: number;
    looTilted: number;
    wfModel: number;
    wfTilted: number;
    movedRows: number;
  };
  rangeDex: { p10: number; p25: number; p75: number; p90: number; looCoverageP25P75: number };
  totalImpliedUsd: number;
  verdicts: { FARM: number; MARGINAL: number; SKIP: number };
  preTokenCount: number;
  params: FarmParams;
  checksum: string;
}

export interface Board {
  rows: BoardRow[];
  comps: CompRow[];
  stats: BoardStats;
}

export function buildBoard(snapshot: Snapshot, params: FarmParams = DEFAULT_PARAMS): Board {
  const asOf = new Date(snapshot.as_of + "T00:00:00Z");
  const watchlist = new Set(snapshot.watchlist);
  const protocols = snapshot.protocols;

  // Ledger: every protocol in exactly one bucket.
  const ledger: Record<string, number> = {
    watchlist: 0,
    early: 0,
    "off-list": 0,
    priced: 0,
    "no-cap": 0,
    bridge: 0,
    liquid: 0,
    exchange: 0,
    versioned: 0,
  };
  for (const p of protocols) {
    if (!hasToken(p)) {
      // No token: the exclusion buckets first, then the ranked tiers.
      if (isVersioned(p)) ledger.versioned++;
      else if (isBridge(p)) ledger.bridge++;
      else if (isLiquidStaking(p)) ledger.liquid++;
      else if (isExchange(p)) ledger.exchange++;
      else if (watchlist.has(p.slug)) ledger.watchlist++;
      else if (p.tvl_usd < snapshot.floor_usd) ledger.early++;
      else ledger["off-list"]++;
    } else if (p.mcap_usd !== null && p.mcap_usd > 0) {
      ledger.priced++;
    } else {
      ledger["no-cap"]++;
    }
  }

  // The size curve, fitted on protocols whose token trades and carries a cap.
  const priced = protocols.filter((p) => hasToken(p) && p.mcap_usd !== null && p.mcap_usd > 0);
  const fit = fitLine(
    priced.map((p) => Math.log10(p.tvl_usd)),
    priced.map((p) => Math.log10(p.mcap_usd as number)),
  );

  // Launch odds by no-token age, pooled monotone.
  const bands = ageBandRates(protocols, asOf);
  const brier = brierScore(protocols, bands, asOf);

  // Held-out checks.
  const loo = looMiss(priced);
  const wf = walkForward(priced);

  // The growth question: does 7-day change help the curve?
  const preTokenAll = protocols.filter((p) => !hasToken(p));
  const growth = growthExperiment(priced, preTokenAll, fit);

  // The range: in-sample residual quantiles of the size curve, in dex.
  const residuals = priced
    .map((p) => Math.log10(p.mcap_usd as number) - (fit.intercept + fit.slope * Math.log10(p.tvl_usd)))
    .sort((a, b) => a - b);
  const rangeDex = {
    p10: quantile(residuals, 0.1),
    p25: quantile(residuals, 0.25),
    p75: quantile(residuals, 0.75),
    p90: quantile(residuals, 0.9),
    looCoverageP25P75: 0,
  };
  // LOO coverage of that same P25–P75 band.
  const looResiduals: number[] = [];
  for (let i = 0; i < priced.length; i++) {
    const sub = fitLine(
      priced.filter((_, j) => j !== i).map((p) => Math.log10(p.tvl_usd)),
      priced.filter((_, j) => j !== i).map((p) => Math.log10(p.mcap_usd as number)),
    );
    looResiduals.push(Math.log10(priced[i].mcap_usd as number) - (sub.intercept + sub.slope * Math.log10(priced[i].tvl_usd)));
  }
  const inside = looResiduals.filter((r) => r >= rangeDex.p25 && r <= rangeDex.p75).length;
  rangeDex.looCoverageP25P75 = inside / looResiduals.length;

  // The ranked board: pre-token, not excluded, by implied value.
  const ranked = protocols.filter((p) => !hasToken(p) && !isExcluded(p));
  const scored = ranked
    .map((p) => {
      const fittedValue = Math.pow(10, fit.intercept + fit.slope * Math.log10(p.tvl_usd));
      const odds = oddsForAge(ageYears(p, asOf), bands);
      return { p, fittedValue, odds, implied: fittedValue * odds };
    })
    .sort((a, b) => b.implied - a.implied || a.p.slug.localeCompare(b.p.slug));

  const rows: BoardRow[] = scored.map((s, i) => {
    const rangeLo = s.fittedValue * Math.pow(10, rangeDex.p25) * s.odds;
    const rangeHi = s.fittedValue * Math.pow(10, rangeDex.p75) * s.odds;
    const econ = economics(s.implied, s.fittedValue, rangeLo, rangeHi, params);
    const steps = planSteps(s.p, econ, params);
    return {
      slug: s.p.slug,
      name: s.p.name,
      rank: i + 1,
      implied_value_usd: Math.round(s.implied),
      farm_steps: steps,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      age_years: ageYears(s.p, asOf),
      tier: tierOf(s.p, watchlist, snapshot.floor_usd),
      fitted_value_usd: Math.round(s.fittedValue),
      odds: s.odds,
      range_lo_usd: Math.round(rangeLo),
      range_hi_usd: Math.round(rangeHi),
      gross_usd: Math.round(econ.grossUsd * 100) / 100,
      gas_usd: econ.gasUsd,
      opportunity_usd: Math.round(econ.opportunityUsd * 100) / 100,
      net_usd: Math.round(econ.netUsd * 100) / 100,
      net_per_hour_usd: Math.round(econ.netPerHourUsd * 100) / 100,
      verdict: econ.verdict,
      rank_lo: i + 1,
      rank_hi: i + 1,
    };
  });
  // Rank range: the best rank the row could hold if its value landed at the
  // P75 edge, and the worst if it landed at the P25 edge.
  for (const row of rows) {
    const aboveBest = rows.filter((r) => r.implied_value_usd > row.range_hi_usd).length;
    const aboveWorst = rows.filter((r) => r.implied_value_usd >= row.range_lo_usd).length;
    row.rank_lo = aboveBest + 1;
    row.rank_hi = Math.max(aboveWorst, row.rank);
  }

  // Priced comps: the 128 protocols the curve was fitted on, real vs fitted.
  const comps: CompRow[] = priced
    .map((p) => {
      const fitted = Math.pow(10, fit.intercept + fit.slope * Math.log10(p.tvl_usd));
      return {
        slug: p.slug,
        name: p.name,
        tvl_usd: p.tvl_usd,
        mcap_usd: p.mcap_usd as number,
        fitted_usd: Math.round(fitted),
        miss: Math.round(((p.mcap_usd as number) / fitted) * 100) / 100,
        listed_at: p.listed_at,
      };
    })
    .sort((a, b) => b.miss - a.miss);

  const verdicts = { FARM: 0, MARGINAL: 0, SKIP: 0 };
  for (const row of rows) verdicts[row.verdict]++;
  const totalImpliedUsd = rows.reduce((sum, r) => sum + r.implied_value_usd, 0);

  // A short checksum over the ranked slugs and implied values, so a reader
  // can tell at a glance whether the board they see is the board the program wrote.
  let checksumNum = 0;
  for (const row of rows) {
    for (let i = 0; i < row.slug.length; i++) checksumNum = (checksumNum * 31 + row.slug.charCodeAt(i)) >>> 0;
    checksumNum = (checksumNum + row.implied_value_usd) >>> 0;
  }
  const checksum = checksumNum.toString(16).padStart(8, "0");

  return {
    rows,
    comps,
    stats: {
      asOf: snapshot.as_of,
      protocolsRead: protocols.length,
      watchlistCount: watchlist.size,
      rankedCount: rows.length,
      ledger,
      fit,
      bands,
      brier,
      loo,
      walkForward: wf,
      growth,
      rangeDex,
      totalImpliedUsd,
      verdicts,
      preTokenCount: preTokenAll.length,
      params,
      checksum,
    },
  };
}
