/* Northlight dashboard: board, filters, detail view. Reads window.RADAR from data.js. No network. */
(function () {
  var R = window.RADAR || { rows: [], model: {}, integrity: {} };
  var rows = R.rows || [];
  var model = R.model || {};
  var integ = R.integrity || {};

  function fmtUsd(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function fmtNum(n) { return n.toLocaleString('en-US'); }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  document.getElementById('asof').textContent = integ.asOf || '';
  document.getElementById('totalImplied').textContent = fmtUsd(integ.totalImpliedUsd || 0);

  var strip = document.getElementById('strip');
  var stripItems = [
    '<span>Snapshot <b>' + esc(integ.asOf || '') + '</b></span>',
    '<span><b>' + fmtNum(integ.protocols || 0) + '</b> protocols</span>',
    '<span>Watchlist <b>' + (integ.watchlistCovered || 0) + '/' + (integ.watchlist || 0) + '</b> covered</span>',
    '<span>Board <b>' + fmtNum(integ.boardRows || 0) + '</b> rows</span>',
    '<span>Model LOO RMSE <b>' + (model.looRmse != null ? model.looRmse : '—') + '</b> dex &middot; walk-forward <b>' + (model.walkForwardRmse != null ? model.walkForwardRmse : '—') + '</b></span>',
    '<span>80% range <b>&plusmn;' + (model.conformalHalfWidth80 != null ? model.conformalHalfWidth80 : '—') + ' dex</b> (covers ' + Math.round((model.conformalCoverage80 || 0) * 100) + '% in-sample)</span>',
    '<span class="warn">Odds run hot on the newest listings: walk-forward predicted ' + (model.oddsWalkForward ? model.oddsWalkForward.predicted : '—') + ' vs actual ' + (model.oddsWalkForward ? model.oddsWalkForward.actual : '—') + ' — treat young protocols&rsquo; odds as an upper bound.</span>',
    '<span>Verdicts <b>' + (integ.verdicts ? integ.verdicts.farm : 0) + ' farm / ' + (integ.verdicts ? integ.verdicts.marginal : 0) + ' marginal / ' + (integ.verdicts ? integ.verdicts.skip : 0) + ' skip</b></span>',
  ];
  strip.innerHTML = stripItems.join('');

  var catSel = document.getElementById('cat');
  var cats = [];
  rows.forEach(function (r) { if (r.category && cats.indexOf(r.category) === -1) cats.push(r.category); });
  cats.sort().forEach(function (c) {
    var o = document.createElement('option');
    o.value = c; o.textContent = c;
    catSel.appendChild(o);
  });

  var tbody = document.getElementById('rows');
  var countEl = document.getElementById('count');

  function currentFilter() {
    return {
      q: (document.getElementById('q').value || '').toLowerCase(),
      verdict: document.getElementById('verdict').value,
      cat: catSel.value,
      sort: document.getElementById('sort').value,
    };
  }

  function render() {
    var f = currentFilter();
    var list = rows.filter(function (r) {
      if (f.verdict && r.verdict !== f.verdict) return false;
      if (f.cat && r.category !== f.cat) return false;
      if (f.q && (r.name + ' ' + r.slug).toLowerCase().indexOf(f.q) === -1) return false;
      return true;
    });
    if (f.sort === 'odds') list = list.slice().sort(function (a, b) { return b.launch_odds - a.launch_odds; });
    else if (f.sort === 'perhour') list = list.slice().sort(function (a, b) { return b.net_usd_per_hour - a.net_usd_per_hour; });
    else if (f.sort === 'tvl') list = list.slice().sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
    else list = list.slice().sort(function (a, b) { return a.rank - b.rank; });
    countEl.textContent = list.length + ' of ' + rows.length + ' rows';
    tbody.innerHTML = list.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"><td>' + r.rank + '</td>' +
        '<td class="name">' + esc(r.name) + '<small>' + esc(r.slug) + '</small></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num"><b>' + fmtUsd(r.implied_value_usd) + '</b></td>' +
        '<td class="num">' + fmtUsd(r.interval_lo_usd) + ' – ' + fmtUsd(r.interval_hi_usd) + '</td>' +
        '<td class="num">' + Math.round(r.launch_odds * 100) + '% <small>(' + r.peer_count + ' peers)</small></td>' +
        '<td class="num">$' + fmtNum(r.net_usd_per_hour) + '/hr</td>' +
        '<td><span class="badge ' + r.verdict + '">' + r.verdict + '</span></td></tr>';
    }).join('');
  }

  function showDetail(slug) {
    var panel = document.getElementById('detail');
    var r = null;
    rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) { panel.hidden = true; panel.innerHTML = ''; return; }
    var steps = r.farm_steps.map(function (s, i) {
      var d = (r.plan_detail && r.plan_detail[i]) || {};
      var cost = 'gas ~$' + (d.gasUsd != null ? d.gasUsd.toFixed(2) : '—') +
        (d.minutes ? ' &middot; ' + d.minutes + ' min' : '') +
        (d.capitalUsd ? ' &middot; $' + d.capitalUsd + ' capital' : '');
      return '<li>' + esc(s) + '<br><span class="cost">' + cost + '</span></li>';
    }).join('');
    panel.innerHTML =
      '<span class="back" id="backBtn">&larr; Back to the board</span>' +
      '<h2>#' + r.rank + ' ' + esc(r.name) + ' <span class="badge ' + r.verdict + '">' + r.verdict + '</span></h2>' +
      '<p class="meta">' + esc(r.slug) + ' &middot; ' + esc(r.category || 'uncategorised') + ' &middot; chains: ' + esc((r.chains || []).join(', ')) +
      ' &middot; TVL ' + fmtUsd(r.tvl_usd) + ' &middot; ' + (r.age_days != null ? r.age_days + ' days listed' : 'listing date unreported') + '</p>' +
      '<div class="kv">' +
      '<div><b>' + fmtUsd(r.implied_value_usd) + '</b><span>implied value</span></div>' +
      '<div><b>' + fmtUsd(r.interval_lo_usd) + ' – ' + fmtUsd(r.interval_hi_usd) + '</b><span>80% conformal range</span></div>' +
      '<div><b>' + Math.round(r.launch_odds * 100) + '%</b><span>launch odds (' + r.peer_count + ' peers)</span></div>' +
      '<div><b>$' + fmtNum(r.expected_capture_usd) + '</b><span>expected capture (0.1% share)</span></div>' +
      '<div><b>$' + fmtNum(r.net_usd_per_hour) + '/hr</b><span>net, after $' + r.plan_cost_usd + ' gas &amp; fees over ' + r.plan_hours + ' active hours</span></div>' +
      '<div><b>$' + fmtNum(r.min_capital_usd) + '</b><span>minimum viable capital</span></div>' +
      '</div>' +
      '<h3>Farm plan — ' + r.farm_steps.length + ' steps</h3><ol class="steps">' + steps + '</ol>' +
      '<p class="meta">Net $/hour = (implied value &times; launch odds &times; 0.1% farmer share &minus; plan cost) &divide; active hours. ' +
      'Farm at $' + fmtNum(model.farmLine || 10000) + '/hr or more with capital under $' + fmtNum(model.maxFarmCapital || 1000) +
      '; marginal above $' + fmtNum(model.marginalLine || 2500) + '/hr; skip below.</p>';
    panel.hidden = false;
    document.getElementById('backBtn').onclick = function () { location.hash = ''; };
    panel.scrollIntoView({ block: 'start' });
  }

  function applyHash() {
    var h = location.hash || '';
    var m = h.match(/detail=([^&]+)/);
    if (m) { showDetail(decodeURIComponent(m[1])); return; }
    document.getElementById('detail').hidden = true;
    var v = h.match(/verdict=([^&]+)/);
    if (v) document.getElementById('verdict').value = decodeURIComponent(v[1]);
    render();
  }

  tbody.addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) location.hash = 'detail=' + encodeURIComponent(tr.getAttribute('data-slug'));
  });
  ['q', 'verdict', 'cat', 'sort'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', render);
    document.getElementById(id).addEventListener('change', render);
  });
  window.addEventListener('hashchange', applyHash);

  var termRows = (model.termTests || []).map(function (t) {
    return '<tr><td><code>' + esc(t.term) + '</code></td><td>' + t.loo + '</td><td>' + t.walkForward + '</td><td>' + (t.kept ? '<b>kept</b>' : 'dropped') + '</td><td>' + esc(t.reason) + '</td></tr>';
  }).join('');
  document.getElementById('methodBody').innerHTML =
    '<p><b>Value model.</b> ' + esc(model.formula || '') + ' — a Huber robust fit (c = 1.345) on the ' + (model.fittedOn || 0) +
    ' protocols whose token already trades. Base leave-one-out RMSE ' + model.baseLoo + ' dex, walk-forward RMSE ' + model.baseWalkForward + ' dex.</p>' +
    '<p><b>Every candidate term was fitted, then tested held-out twice</b> — leave-one-out over all ' + (model.fittedOn || 0) +
    ' priced protocols, and walk-forward (fit the earliest-listed 70%, test the latest 30%, ' + model.walkForwardNTrain + ' train / ' + model.walkForwardNTest + ' test). ' +
    'A term survives only when <i>both</i> tests improve. ' + model.keptTermNames.length + ' of ' + (model.termTests || []).length + ' survived:</p>' +
    '<table><thead><tr><th>Candidate term</th><th>LOO RMSE</th><th>Walk-forward RMSE</th><th>Decision</th><th>Why</th></tr></thead><tbody>' + termRows + '</tbody></table>' +
    '<p>' + (function () {
      var kept = (model.termTests || []).filter(function (t) { return t.kept; });
      if (kept.length === 0) return 'Age, 7-day growth, chain count, category flags and the TVL&times;age interaction all fit in-sample and failed out-of-sample — the board prices on TVL alone because the blind tests say the rest is noise.';
      return 'Age, 7-day growth, chain count, most category flags and the TVL&times;age interaction fit in-sample and failed out-of-sample. One term survived both blind tests: <b>' + kept.map(function (t) { return esc(t.term) + ' (LOO ' + t.loo + ', walk-forward ' + t.walkForward + ')'; }).join('; ') + '</b> — liquid-staking tokens price systematically <i>lower</i> against TVL (coefficient &minus;0.50 dex: huge TVL, small governance token), and the tests agree, so it stays in the model.';
    })() + ' ' +
    'Huber beats OLS on both tests (LOO ' + model.looRmse + ' vs ' + model.olsLoo + '; walk-forward ' + model.walkForwardRmse + ' vs ' + model.olsWalkForward + ').</p>' +
    '<p><b>Ranges are conformal, not parametric.</b> The 80% band is &plusmn;' + model.conformalHalfWidth80 + ' dex around the point estimate — the 80th percentile of the leave-one-out residuals. ' +
    'It covered ' + Math.round((model.conformalCoverage80 || 0) * 100) + '% of priced protocols in-sample; the 90% band (&plusmn;' + model.conformalHalfWidth90 + ' dex) covered ' + Math.round((model.conformalCoverage90 || 0) * 100) + '%. The model is weak (R&sup2; near 0.2) and the bands say so.</p>' +
    '<p><b>Launch odds come from the peers&rsquo; record.</b> ' + esc(model.oddsMethod || '') + '. As a classifier of &ldquo;has a token&rdquo; the odds score AUC ' + model.oddsAuc +
    ' — modest, and the page does not pretend otherwise. Walk-forward check: on the latest-listed protocols the odds predicted ' + (model.oddsWalkForward ? model.oddsWalkForward.predicted : '—') +
    ' against an actual token rate of ' + (model.oddsWalkForward ? model.oddsWalkForward.actual : '—') + ' (n=' + (model.oddsWalkForward ? model.oddsWalkForward.n : '—') +
    ') — the odds run hot on young protocols, so treat those as an upper bound.</p>' +
    '<p><b>Verdicts are costed.</b> Expected capture = implied value &times; launch odds &times; 0.1% farmer share (a stated planning haircut — one farmer never collects the whole implied value). ' +
    'Net $/hour subtracts the plan&rsquo;s gas and fees and divides by its active hours. Farm at $' + fmtNum(model.farmLine || 10000) + '/hr with capital under $' + fmtNum(model.maxFarmCapital || 1000) +
    '; marginal above $' + fmtNum(model.marginalLine || 2500) + '/hr; skip below. Minimum viable capital is the cash the steps themselves need — it is recoverable, not a cost.</p>';

  applyHash();
})();
