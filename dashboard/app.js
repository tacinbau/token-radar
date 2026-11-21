// Signal v3 dashboard: renders window.TOKEN_RADAR with no network.
// Hash routes: #detail=<slug>, #filter=farmable|all|watchlist|skip, #category=<name>.
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
  const pct = (v) => (v * 100).toFixed(0) + '%';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // KPI strip.
  const fit = model.fit, held = model.heldOut;
  $('#asof').textContent = D.as_of;
  $('#covline').textContent = cov.snapshot + ' protocols in snapshot · ' + cov.ranked + ' pre-token ranked · ' + cov.watchlistRanked + '/' + cov.watchlist + ' watchlist';
  $('#kpis').innerHTML = [
    ['Fit R²', fit.r2.toFixed(3)],
    ['Held-out err', held.medianAbsLog10Err.toFixed(2) + ' dex'],
    ['Top farmable', money(rows.find((r) => r.eligible).implied_value_usd)],
    ['Farm verdicts', rows.filter((r) => r.farm_verdict === 'farm').length + ' farm'],
  ].map(([k, v]) => '<div class="kpi"><b>' + v + '</b><span>' + k + '</span></div>').join('');
  $('#m-fit-n').textContent = fit.n;
  $('#m-fit-eq').textContent = 'log10(mcap) = ' + fit.intercept.toFixed(3) + ' + ' + fit.slope.toFixed(3) + ' × log10(TVL) + category offset  (R² ' + fit.r2.toFixed(3) + ', global alone ' + fit.r2Global.toFixed(3) + ', n=' + fit.n + ')';
  $('#m-held-err').textContent = held.medianAbsLog10Err.toFixed(3) + ' dex';
  $('#m-held-2x').textContent = pct(held.within2x);
  $('#m-held-cov').textContent = pct(held.coverage90);
  $('#m-odds').textContent = model.odds.bands.map((b) => b.band + ' ' + pct(b.rate)).join(' · ') + ' · overall ' + pct(model.odds.overall);
  $('#foot').textContent = cov.farmable + ' farmable · ' + cov.notFarmable + ' not farmable · ' + cov.tokenRecorded + ' already record a token';

  // Category select.
  const cats = [...new Set(rows.map((r) => r.category).filter(Boolean))].sort();
  cats.forEach((c) => { const o = document.createElement('option'); o.value = c; o.textContent = c; $('#cat').appendChild(o); });

  let state = { filter: 'farmable', cat: '', q: '', sort: 'implied_value_usd', dir: -1 };
  function parseHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.get('filter')) state.filter = h.get('filter');
    if (h.get('category')) state.cat = h.get('category');
    if (h.get('detail')) openDetail(h.get('detail'));
  }
  function filtered() {
    let list = rows;
    if (state.filter === 'farmable') list = list.filter((r) => r.eligible);
    if (state.filter === 'watchlist') list = list.filter((r) => r.watchlist);
    if (state.filter === 'skip') list = list.filter((r) => !r.eligible || r.farm_verdict === 'skip');
    if (state.cat) list = list.filter((r) => r.category === state.cat);
    if (state.q) { const q = state.q.toLowerCase(); list = list.filter((r) => (r.name + ' ' + r.slug).toLowerCase().includes(q)); }
    const k = state.sort;
    list = [...list].sort((a, b) => {
      const av = a[k], bv = b[k];
      if (typeof av === 'string') return av.localeCompare(bv) * state.dir;
      return (av - bv) * state.dir;
    });
    return list;
  }
  function render() {
    const list = filtered();
    $('#count').textContent = list.length + ' rows';
    $('#empty').hidden = list.length > 0;
    const chainShort = (r) => r.chains.length > 3 ? r.chains.slice(0, 3).join(', ') + ' +' + (r.chains.length - 3) : r.chains.join(', ');
    $('#rows').innerHTML = list.slice(0, 400).map((r) =>
      '<tr data-slug="' + esc(r.slug) + '" class="' + (r.watchlist ? 'wl ' : '') + r.farm_verdict + '">' +
      '<td>' + r.rank + '</td>' +
      '<td><b>' + esc(r.name) + '</b><span>' + esc(r.slug) + ' · ' + esc(r.category || '—') + ' · ' + esc(chainShort(r)) + (r.watchlist ? ' · ★ watchlist' : '') + '</span></td>' +
      '<td>' + money(r.tvl_usd) + '</td>' +
      '<td>' + money(r.fitted_value_usd) + '</td>' +
      '<td>' + pct(r.launch_odds) + '</td>' +
      '<td><b>' + money(r.implied_value_usd) + '</b></td>' +
      '<td>' + money(r.farmer_value_usd) + '</td>' +
      '<td>$' + r.farm_cost_usd.toFixed(0) + '</td>' +
      '<td><span class="v">' + r.farm_verdict + '</span></td></tr>'
    ).join('');
    document.querySelectorAll('#filters button').forEach((b) => b.classList.toggle('on', b.dataset.filter === state.filter));
    $('#cat').value = state.cat;
  }
  function openDetail(slug) {
    const r = rows.find((x) => x.slug === slug);
    if (!r) return;
    const b = r.value_breakdown;
    $('#detail-body').innerHTML =
      '<h2>' + esc(r.name) + '</h2><p class="dsub">' + esc(r.slug) + ' · ' + esc(r.category || '—') + ' · ' + esc(r.chains.join(', ')) + (r.watchlist ? ' · ★ watchlist' : '') + '</p>' +
      '<dl>' +
      '<dt>TVL</dt><dd>' + money(r.tvl_usd) + '</dd>' +
      '<dt>7-day change</dt><dd>' + (r.change_7d === null ? '—' : r.change_7d.toFixed(1) + '%') + '</dd>' +
      '<dt>Age</dt><dd>' + (r.age_days === null ? 'unknown' : r.age_days + ' days (' + esc(r.odds_band) + ')') + '</dd>' +
      '<dt>Fitted value</dt><dd>' + money(r.fitted_value_usd) + ' — ' + esc(b.fit) + ', slope ' + b.slope + ', intercept ' + b.intercept + ', offset ' + b.categoryOffset + ', R² ' + b.r2 + ', n=' + b.n_comps + '</dd>' +
      '<dt>Launch odds</dt><dd>' + pct(r.launch_odds) + ' (' + esc(r.odds_band) + ' peers)</dd>' +
      '<dt>Expected value</dt><dd><b>' + money(r.implied_value_usd) + '</b> = fitted × odds</dd>' +
      '<dt>Farmer value</dt><dd>' + money(r.farmer_value_usd) + ' (10% pool / 2,000 farmers)</dd>' +
      '<dt>Farm cost</dt><dd>$' + r.farm_cost_usd.toFixed(0) + ' — verdict <b>' + r.farm_verdict + '</b>' + (r.ineligible_reason ? ' — ' + esc(r.ineligible_reason) : '') + '</dd>' +
      '</dl>' +
      '<h3>Farm plan</h3><ol>' + r.farm_steps.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ol>';
    $('#detail').hidden = false;
  }
  function closeDetail() { $('#detail').hidden = true; if (location.hash.includes('detail')) history.replaceState(null, '', location.pathname + location.search); }

  $('#rows').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-slug]');
    if (tr) { history.replaceState(null, '', '#detail=' + tr.dataset.slug); openDetail(tr.dataset.slug); }
  });
  $('#close').addEventListener('click', closeDetail);
  $('#q').addEventListener('input', (e) => { state.q = e.target.value; render(); });
  $('#cat').addEventListener('change', (e) => { state.cat = e.target.value; render(); });
  document.querySelectorAll('#filters button').forEach((b) => b.addEventListener('click', () => { state.filter = b.dataset.filter; render(); }));
  document.querySelectorAll('#board th[data-sort]').forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.sort;
    if (state.sort === k) state.dir *= -1; else { state.sort = k; state.dir = k === 'name' ? 1 : -1; }
    render();
  }));
  window.addEventListener('hashchange', parseHash);
  parseHash();
  render();
})();
