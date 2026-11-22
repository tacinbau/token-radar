// Signal v4 dashboard: renders window.TOKEN_RADAR with no network.
// Hash routes: #detail=<slug>, #filter=farm|marginal|skip|all, #view=evidence.
// Scenario math mirrors lib/model.ts scenarioNet exactly: gross is the
// implied value x drop share / 2,000 farmers; net subtracts 3 gas
// sessions and the opportunity cost of the deposit plan (4.5% a year);
// verdict is farm at >=$25 an hour, marginal at net >= $0, else skip.
(function () {
  const D = window.TOKEN_RADAR;
  if (!D) { document.body.innerHTML = '<p style="padding:2em">No data: run main.ts first.</p>'; return; }
  const rows = D.rows, cov = D.coverage, model = D.model;
  const $ = (s) => document.querySelector(s);
  const money = (v) => {
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + v.toFixed(0);
  };
  const moneySigned = (v) => (v < 0 ? '-$' + money(-v).slice(1) : money(v));
  const pct = (v) => (v * 100).toFixed(0) + '%';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtAge = (d) => {
    if (d === null || d === undefined) return '—';
    if (d < 30) return d + ' d';
    if (d < 365) return (d / 30.4).toFixed(1) + ' mo';
    return (d / 365).toFixed(1) + ' yr';
  };

  // ---- scenario (mirrors model.ts) ----
  const GAS = model.costs.gasUsd;
  const gasFor = (r) => GAS[r.chains[0]] ?? model.costs.gasDefaultUsd;
  function scenario(r, drop, horizonWk, depositSel) {
    const deposit = depositSel === 'pct002' ? r.tvl_usd * 0.0002 : depositSel === 'pct1' ? r.tvl_usd * 0.01 : Number(depositSel);
    const gross = (r.implied_value_usd * drop) / model.costs.farmersAssumed;
    const gas = 3 * gasFor(r);
    const opp = deposit * model.costs.opportunityRate * (horizonWk / 52);
    const net = gross - gas - opp;
    const hours = (3 * 30 + 15 * horizonWk) / 60;
    const perHour = net / hours;
    const verdict = perHour >= model.costs.verdictFarmPerHour ? 'farm' : net >= 0 ? 'marginal' : 'skip';
    return { deposit, gross, gas, opp, net, perHour, hours, verdict };
  }

  // ---- header + KPI strip (6 cards) ----
  const fit = model.fit, ev = model.evidence;
  const sizeT = ev.valueTerms.find((t) => t.term === 'size curve, in TVL');
  const flatT = ev.valueTerms.find((t) => t.term === 'flat median multiple');
  const ageT = ev.oddsTerms.find((t) => t.term === '+ age, years listed');
  const baseT = ev.oddsTerms.find((t) => t.term === 'base rate of peers');
  const keptV = ev.valueTerms.filter((t) => t.status === 'kept').length;
  const candV = ev.valueTerms.filter((t) => t.status === 'kept' || t.status === 'tested, not kept').length;
  const keptO = ev.oddsTerms.filter((t) => t.status === 'kept').length;
  const candO = ev.oddsTerms.filter((t) => t.status === 'kept' || t.status === 'tested, not kept').length;
  $('#snapline').textContent = 'DefiLlama snapshot ' + D.as_of + ' · ' + cov.snapshot + ' protocols read · no network, no hand-picked names';
  $('#modelline').textContent = 'model ' + model.version + ' · fitted in this browser from board.json';
  $('#kpis').innerHTML = [
    ['Out-of-sample miss, walk-forward', '×' + sizeT.wfMiss.toFixed(2) + ' <small>vs ×' + flatT.wfMiss.toFixed(2) + ' flat</small>', '×' + sizeT.looMiss.toFixed(2) + ' leave-one-out vs ×' + flatT.looMiss.toFixed(2)],
    ['Is the printed range honest?', ev.range.wfP25P75.toFixed(0) + '% <small>· ' + ev.range.looP25P75.toFixed(0) + '%</small>', 'of later-listed caps fall inside P25–P75 (stated 50%) · P10–P90: ' + ev.range.wfP10P90.toFixed(0) + '% / ' + ev.range.looP10P90.toFixed(0) + '%'],
    ['Token odds vs base rate, Brier', ageT.looBrier.toFixed(3) + ' <small>vs ' + baseT.looBrier.toFixed(3) + '</small>', 'walk-forward: ' + ageT.wfBrier.toFixed(3) + ' vs ' + baseT.wfBrier.toFixed(3) + ' · called right ' + ageT.looRight.toFixed(0) + '% of ' + ev.peersN + ' peers'],
    ['Terms that survived both tests', keptV + ' of ' + candV + ' · ' + keptO + ' of ' + candO, 'value terms · odds terms — the rest helped one test and hurt the other'],
    ['Worth farming, this scenario', cov.farm + ' of ' + cov.ranked, 'net beats $25 an hour · ' + cov.marginal + ' marginal, ' + cov.skip + ' skip'],
    ['Watchlist ranked', cov.watchlistRanked + ' / ' + cov.watchlist, 'plus ' + (cov.ranked - cov.watchlistRanked) + ' pre-token protocols the house list leaves out'],
  ].map(([k, v, s]) => '<div class="kpi"><b>' + v + '</b><span>' + k + '</span><span class="sub2">' + s + '</span></div>').join('');

  // ---- accounting bar: all 758 in exactly one group ----
  const A = cov.accounting;
  const groups = [
    ['Ranked · watchlist', A.rankedWatchlist, '#2a9fd8'],
    ['Ranked · early, below the floor', A.rankedEarly, '#5eead4'],
    ['Ranked · off-list', A.rankedOffList, '#d8b4fe'],
    ['Token trades · priced comp', A.tokenPriced, '#ffd479'],
    ['Token recorded · no usable cap', A.tokenNoCap, '#8fa3b8'],
    ['Out · bridge', A.outBridge, '#f97316'],
    ['Out · liquid staking', A.outLiquid, '#fda4af'],
    ['Out · exchange custody', A.outExchange, '#ef4444'],
    ['Out · versioned or wrapped', A.outVersioned, '#a78bfa'],
  ];
  $('#abar').innerHTML = groups.map(([, n, c]) => '<div style="width:' + (n / A.total * 100).toFixed(2) + '%;background:' + c + '" title="' + n + '"></div>').join('');
  $('#alegend').innerHTML = groups.map(([k, n, c]) => '<span><i class="sw" style="background:' + c + '"></i>' + k + ' <b>' + n + '</b></span>').join('');

  // ---- integrity strip: recomputed here from the board rows ----
  function checksum(list) {
    let h = 0x811c9dc5;
    const s = list.map((r) => r.slug + ':' + r.implied_value_usd).join('|');
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
  }
  const totalImplied = rows.reduce((s, r) => s + r.implied_value_usd, 0);
  const ranksOk = rows.every((r, i) => r.rank === i + 1);
  const orderOk = rows.every((r, i) => i === 0 || rows[i - 1].implied_value_usd > r.implied_value_usd);
  const sumOk = totalImplied === model.integrity.totalImpliedUsd;
  const sealOk = checksum(rows) === model.integrity.checksum;
  const wlOk = rows.filter((r) => r.watchlist).length === cov.watchlist;
  const ledgerOk = groups.reduce((s, g) => s + g[1], 0) === cov.snapshot;
  const tick = (ok, label) => '<span class="' + (ok ? '' : 'bad') + '">' + (ok ? '✓' : '✗') + ' ' + label + '</span>';
  $('#integrity').innerHTML =
    tick(true, 'this table = board.json') + ' &nbsp; ' +
    tick(ranksOk, cov.ranked + ' of ' + cov.ranked + ' rows recomputed here') + ' &nbsp; ' +
    tick(orderOk, 'ranks 1–' + cov.ranked + ' in order, values never rise') + ' &nbsp; ' +
    tick(sumOk, 'totals equal: ' + money(totalImplied)) + ' &nbsp; ' +
    tick(sealOk, 'checksum ' + model.integrity.checksum + ' = main.ts') + ' &nbsp; ' +
    tick(wlOk, 'watchlist ' + cov.watchlistRanked + ' of ' + cov.watchlist + ' ranked') + ' &nbsp; ' +
    tick(ledgerOk, 'ledger ' + cov.snapshot + ' of ' + cov.snapshot + ' protocols');

  // ---- evidence tables ----
  const tagFor = (s) => s === 'kept' ? '<span class="tag kept">kept</span>' : s === 'baseline' ? '<span class="tag base">baseline</span>' : s === 'must not help' ? '<span class="tag control">must not help</span>' : '<span class="tag notkept">tested, not kept</span>';
  $('#ev-comps').textContent = ev.compsN;
  $('#ev-peers').textContent = ev.peersN;
  $('#ev-value').innerHTML = ev.valueTerms.map((t) =>
    '<tr><td>' + esc(t.term) + '</td><td>×' + t.looMiss.toFixed(2) + '</td><td>×' + t.wfMiss.toFixed(2) + '</td><td>' + tagFor(t.status) + '</td></tr>').join('');
  $('#ev-odds').innerHTML = ev.oddsTerms.map((t) =>
    '<tr><td>' + esc(t.term) + '</td><td>' + t.looBrier.toFixed(3) + ' (' + t.looRight.toFixed(0) + '%)</td><td>' + t.wfBrier.toFixed(3) + ' (' + t.wfRight.toFixed(0) + '%)</td><td>' + tagFor(t.status) + '</td></tr>').join('');
  const R = ev.range;
  $('#ev-range').innerHTML =
    '<tr><td>within ×3 of the model</td><td>' + R.looWithin3x.toFixed(1) + '%</td><td>' + R.wfWithin3x.toFixed(1) + '%</td></tr>' +
    '<tr><td>inside P25–P75, stated 50%</td><td>' + R.looP25P75.toFixed(1) + '%</td><td>' + R.wfP25P75.toFixed(1) + '%</td></tr>' +
    '<tr><td>inside P10–P90, stated 80%</td><td>' + R.looP10P90.toFixed(1) + '%</td><td>' + R.wfP10P90.toFixed(1) + '%</td></tr>';
  $('#ev-range-note').textContent = 'The printed range is the fitted value ±0.674 × residual sd (P25–P75) and ±1.282 × sd (P10–P90). At $100M TVL the fitted multiple is ×' + (10 ** fit.intercept * Math.pow(1e8, fit.slope) / 1e8).toFixed(2) + '. Range honesty is measured on held-out caps only, never in-sample.';
  $('#holdout-text').textContent = ev.holdoutNote + ' Leave-one-out (' + ev.compsN + ' comps): median miss ×' + sizeT.looMiss.toFixed(2) + ' against ×' + flatT.looMiss.toFixed(2) + ' for a flat multiple. Walk-forward (' + R.wfTrainN + ' earlier-listed train, ' + R.wfN + ' later-listed test): median miss ×' + sizeT.wfMiss.toFixed(2) + ' against ×' + flatT.wfMiss.toFixed(2) + '.';
  const datedPeers = ev.peersN;
  $('#holdout-odds').textContent = Math.round(model.odds.overall * 100) + '% of all ' + cov.snapshot + ' protocols record a token; ' + datedPeers + ' peers carry a listing date';

  // ---- method ----
  $('#m-fit-n').textContent = fit.n;
  $('#m-fit-eq').textContent = 'log10(mcap) = ' + fit.intercept.toFixed(3) + ' + ' + fit.slope.toFixed(3) + ' × log10(TVL)  (R² ' + fit.r2.toFixed(3) + ', residual sd ' + fit.residSd.toFixed(3) + ' dex, n=' + fit.n + ')';
  $('#m-odds').textContent = model.odds.bands.map((b) => b.band + ' ' + pct(b.rate) + ' (' + b.tokens + '/' + b.n + ')').join(' · ') + ' · overall ' + pct(model.odds.overall);
  $('#foot').textContent = cov.farm + ' farm · ' + cov.marginal + ' marginal · ' + cov.skip + ' skip · ' + cov.tokenRecorded + ' already record a token · checksum ' + model.integrity.checksum;

  // ---- filters + scenario state ----
  const cats = [...new Set(rows.map((r) => r.category).filter(Boolean))].sort();
  cats.forEach((c) => { const o = document.createElement('option'); o.value = c; o.textContent = c; $('#cat').appendChild(o); });
  const chains = [...new Set(rows.flatMap((r) => r.chains))].sort();
  chains.forEach((c) => { const o = document.createElement('option'); o.value = c; o.textContent = c; $('#chain').appendChild(o); });

  const state = {
    vf: 'all', tier: '', wl: false, early: false, off: false,
    deposit: '1000', drop: 0.07, horizon: 12,
    cat: '', chain: '', q: '', sort: 'implied_value_usd', dir: -1,
  };
  function scen(r) { return scenario(r, state.drop, state.horizon, state.deposit); }
  function filtered() {
    let list = rows;
    if (state.vf !== 'all') list = list.filter((r) => scen(r).verdict === state.vf);
    if (state.tier === '1') list = list.filter((r) => r.rank <= 25);
    if (state.tier === '2') list = list.filter((r) => r.rank > 25 && r.rank <= 100);
    if (state.tier === '3') list = list.filter((r) => r.rank > 100);
    if (state.wl) list = list.filter((r) => r.watchlist);
    if (state.early) list = list.filter((r) => r.tvl_usd < D.floor_usd);
    if (state.off) list = list.filter((r) => r.off_list);
    if (state.cat) list = list.filter((r) => r.category === state.cat);
    if (state.chain) list = list.filter((r) => r.chains.includes(state.chain));
    if (state.q) { const q = state.q.toLowerCase(); list = list.filter((r) => (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase().includes(q)); }
    const k = state.sort;
    const val = (r) => k === 'pos' ? r.rank : k === 'net_fees_usd' ? scen(r).net : k === 'net_per_hour_usd' ? scen(r).perHour : r[k];
    list = [...list].sort((a, b) => {
      const av = val(a), bv = val(b);
      if (typeof av === 'string') return av.localeCompare(bv) * state.dir;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      return (av - bv) * state.dir;
    });
    return list;
  }
  function render() {
    const list = filtered();
    const liveCounts = { farm: 0, marginal: 0, skip: 0 };
    rows.forEach((r) => { liveCounts[scen(r).verdict]++; });
    document.querySelectorAll('#verdict-filters button').forEach((b) => {
      const v = b.dataset.vf;
      b.textContent = v === 'all' ? 'All ' + rows.length : (v === 'farm' ? 'Farm ' : v === 'marginal' ? 'Marginal ' : 'Skip ') + liveCounts[v];
      b.classList.toggle('on', state.vf === v);
    });
    $('#count').textContent = list.length + ' of ' + rows.length + ' rows · ' + money(list.reduce((s, r) => s + r.tvl_usd, 0)) + ' TVL · ' + money(list.reduce((s, r) => s + r.implied_value_usd, 0)) + ' implied';
    $('#empty').hidden = list.length > 0;
    const chainShort = (r) => r.chains.length > 3 ? r.chains.slice(0, 3).join(', ') + ' +' + (r.chains.length - 3) : r.chains.join(', ');
    $('#rows').innerHTML = list.slice(0, 400).map((r, i) => {
      const sc = scen(r);
      const chg = r.change_7d === null ? '—' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%';
      return '<tr data-slug="' + esc(r.slug) + '" class="' + (r.watchlist ? 'wl ' : '') + sc.verdict + '">' +
        '<td>' + (i + 1) + '</td>' +
        '<td>' + r.rank + '<span class="sub2">' + r.rank_hi + '–' + r.rank_lo + '</span></td>' +
        '<td><b>' + esc(r.name) + '</b>' + (r.watchlist ? '<span class="badge wl">Watchlist</span>' : '') + (r.off_list ? '<span class="badge off">Off-list</span>' : '') +
        '<span class="sub2">' + esc(r.category || '—') + ' · ' + esc(chainShort(r)) + '</span></td>' +
        '<td>' + money(r.tvl_usd) + '</td>' +
        '<td class="' + (r.change_7d !== null && r.change_7d < 0 ? 'neg' : 'pos') + '">' + chg + '</td>' +
        '<td>' + fmtAge(r.age_days) + '</td>' +
        '<td><span class="oddsbar"><i style="width:' + Math.round(r.launch_odds * 100) + '%"></i></span>' + pct(r.launch_odds) + '</td>' +
        '<td>' + money(r.fitted_value_usd) + '</td>' +
        '<td><b>' + money(r.implied_value_usd) + '</b><span class="sub2">' + money(r.p25_usd) + '–' + money(r.p75_usd) + '</span></td>' +
        '<td><span class="v">' + sc.verdict.toUpperCase() + '</span> <b class="' + (sc.net < 0 ? 'neg' : 'pos') + '">' + moneySigned(sc.net) + '</b><span class="sub2">$' + sc.gas.toFixed(0) + ' gas · $' + sc.opp.toFixed(2) + ' opp. cost</span></td>' +
        '<td class="' + (sc.perHour < 0 ? 'neg' : 'pos') + '">$' + sc.perHour.toFixed(2) + '</td></tr>';
    }).join('');
    $('#wl-toggle').setAttribute('aria-pressed', String(state.wl));
    $('#early-toggle').setAttribute('aria-pressed', String(state.early));
    $('#offlist-toggle').setAttribute('aria-pressed', String(state.off));
    $('#tier').value = state.tier;
    $('#cat').value = state.cat;
    $('#chain').value = state.chain;
    $('#drop-val').textContent = (state.drop * 100).toFixed(1) + '%';
    $('#horizon-val').textContent = state.horizon + ' wk';
  }
  function openDetail(slug) {
    const r = rows.find((x) => x.slug === slug);
    if (!r) return;
    const b = r.value_breakdown;
    const sc = scen(r);
    $('#detail-body').innerHTML =
      '<h2>' + esc(r.name) + '</h2><p class="dsub">' + esc(r.slug) + ' · ' + esc(r.category || '—') + ' · ' + esc(r.chains.join(', ')) + (r.watchlist ? ' · ★ watchlist' : '') + (r.off_list ? ' · off-list (house list leaves it out)' : '') + '</p>' +
      '<dl>' +
      '<dt>Rank</dt><dd>#' + r.rank + ' of ' + rows.length + ' (range ' + r.rank_hi + '–' + r.rank_lo + ' at the P25–P75 interval)</dd>' +
      '<dt>TVL</dt><dd>' + money(r.tvl_usd) + '</dd>' +
      '<dt>7-day change</dt><dd>' + (r.change_7d === null ? '—' : r.change_7d.toFixed(1) + '%') + ' (shown, not priced: growth failed the both-tests rule)</dd>' +
      '<dt>No-token age</dt><dd>' + (r.age_days === null ? 'unknown' : r.age_days + ' days (' + esc(r.odds_band) + ')') + '</dd>' +
      '<dt>If it launches</dt><dd>' + money(r.fitted_value_usd) + ' — size curve: log10(mcap) = ' + b.intercept + ' + ' + b.slope + ' × log10(TVL), R² ' + b.r2 + ', residual sd ' + b.resid_sd + ' dex, n=' + b.n_comps + '</dd>' +
      '<dt>Printed range</dt><dd>P25–P75 ' + money(r.p25_usd) + '–' + money(r.p75_usd) + ' · P10–P90 ' + money(r.p10_usd) + '–' + money(r.p90_usd) + '</dd>' +
      '<dt>Launch odds</dt><dd>' + pct(r.launch_odds) + ' (' + esc(r.odds_band) + ' peers)</dd>' +
      '<dt>Implied value</dt><dd><b>' + money(r.implied_value_usd) + '</b> = fitted × odds</dd>' +
      '<dt>Farmer gross</dt><dd>' + money(sc.gross) + ' (implied × ' + (state.drop * 100).toFixed(1) + '% drop / 2,000 farmers)</dd>' +
      '<dt>Net of fees</dt><dd><b>' + moneySigned(sc.net) + '</b> — $' + sc.gas.toFixed(2) + ' gas (3 sessions) + $' + sc.opp.toFixed(2) + ' opportunity cost on a $' + sc.deposit.toFixed(0) + ' deposit over ' + state.horizon + ' weeks</dd>' +
      '<dt>Net / hour</dt><dd>$' + sc.perHour.toFixed(2) + ' over ' + sc.hours.toFixed(1) + ' hours of effort — verdict <b>' + sc.verdict.toUpperCase() + '</b> under this scenario</dd>' +
      '</dl>' +
      '<h3>Farm plan</h3><ol>' + r.farm_steps.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ol>';
    $('#detail').hidden = false;
  }
  function closeDetail() { $('#detail').hidden = true; if (location.hash.includes('detail')) history.replaceState(null, '', location.pathname + location.search); }
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  $('#rows').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-slug]');
    if (tr) { history.replaceState(null, '', '#detail=' + tr.dataset.slug); openDetail(tr.dataset.slug); }
  });
  $('#close').addEventListener('click', closeDetail);
  $('#q').addEventListener('input', (e) => { state.q = e.target.value; render(); });
  $('#cat').addEventListener('change', (e) => { state.cat = e.target.value; render(); });
  $('#chain').addEventListener('change', (e) => { state.chain = e.target.value; render(); });
  $('#tier').addEventListener('change', (e) => { state.tier = e.target.value; render(); });
  $('#deposit').addEventListener('change', (e) => { state.deposit = e.target.value; render(); });
  $('#drop').addEventListener('input', (e) => { state.drop = Number(e.target.value) / 100; render(); });
  $('#horizon').addEventListener('input', (e) => { state.horizon = Number(e.target.value); render(); });
  $('#wl-toggle').addEventListener('click', () => { state.wl = !state.wl; render(); });
  $('#early-toggle').addEventListener('click', () => { state.early = !state.early; render(); });
  $('#offlist-toggle').addEventListener('click', () => { state.off = !state.off; render(); });
  document.querySelectorAll('#verdict-filters button').forEach((b) => b.addEventListener('click', () => { state.vf = b.dataset.vf; render(); }));
  $('#reset').addEventListener('click', () => {
    Object.assign(state, { vf: 'all', tier: '', wl: false, early: false, off: false, deposit: '1000', drop: 0.07, horizon: 12, cat: '', chain: '', q: '', sort: 'implied_value_usd', dir: -1 });
    $('#q').value = ''; $('#deposit').value = '1000'; $('#drop').value = '7'; $('#horizon').value = '12';
    render();
  });
  $('#csv').addEventListener('click', () => {
    const list = filtered();
    const head = 'rank,slug,name,category,chains,tvl_usd,change_7d,age_days,launch_odds,fitted_usd,implied_usd,p25_usd,p75_usd,verdict,net_fees_usd,net_per_hour_usd';
    const lines = list.map((r) => {
      const sc = scen(r);
      return [r.rank, r.slug, '"' + r.name.replace(/"/g, '""') + '"', '"' + (r.category || '').replace(/"/g, '""') + '"', '"' + r.chains.join(';') + '"', r.tvl_usd, r.change_7d ?? '', r.age_days ?? '', r.launch_odds, r.fitted_value_usd, r.implied_value_usd, r.p25_usd, r.p75_usd, sc.verdict, sc.net.toFixed(2), sc.perHour.toFixed(2)].join(',');
    });
    download('signal-v4-board.csv', head + '\n' + lines.join('\n') + '\n', 'text/csv');
  });
  $('#json').addEventListener('click', () => {
    const list = filtered().map((r) => ({ ...r, scenario: scen(r) }));
    download('signal-v4-board.json', JSON.stringify({ title: D.title, as_of: D.as_of, rows: list }, null, 2), 'application/json');
  });
  document.querySelectorAll('#board th[data-sort]').forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.sort;
    if (state.sort === k) state.dir *= -1; else { state.sort = k; state.dir = k === 'name' ? 1 : -1; }
    render();
  }));
  function parseHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.get('filter')) state.vf = h.get('filter');
    if (h.get('detail')) openDetail(h.get('detail'));
    if (h.get('view') === 'evidence') { const el = document.getElementById('evidence'); if (el) el.scrollIntoView(); }
  }
  window.addEventListener('hashchange', parseHash);
  parseHash();
  render();
})();
