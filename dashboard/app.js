// Fleet Forge dashboard. Renders window.FLEET_FORGE_DATA (written by main.ts
// beside this page). No network: every value on the page comes from that data.
(function () {
  "use strict";
  var DATA = window.FLEET_FORGE_DATA;
  if (!DATA) {
    document.getElementById("rows").innerHTML =
      '<tr><td colspan="10">No data found. Run main.ts first so it writes data.js beside this page.</td></tr>';
    return;
  }
  var meta = DATA.meta;
  var rows = DATA.rows;

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function usd(n) {
    if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
    return "$" + Math.round(n);
  }
  function usdFull(n) {
    return "$" + Math.round(n).toLocaleString("en-US");
  }
  function pct(x) {
    if (x === null || x === undefined) return "n/a";
    return (x > 0 ? "+" : "") + x.toFixed(1) + "%";
  }
  function ageFmt(days) {
    if (days === null || days === undefined) return "n/a";
    if (days < 365) return days + "d";
    return (days / 365).toFixed(1) + "y";
  }

  // ---- header stats ----
  var top = meta.top;
  document.getElementById("stats").innerHTML =
    stat(meta.n_board, "ranked protocols") +
    stat(meta.n_watchlist, "on the watchlist") +
    stat(usd(meta.total_implied_usd), "total implied value") +
    stat("#1 " + esc(top.name), usd(top.implied_value_usd) + " implied");
  function stat(big, label) {
    return (
      '<div class="stat"><b>' + big + "</b><span>" + label + "</span></div>"
    );
  }
  document.getElementById("asof").textContent = meta.as_of;

  // ---- filter controls ----
  var cats = [];
  var chains = [];
  rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    r.chains.forEach(function (c) {
      if (chains.indexOf(c) < 0) chains.push(c);
    });
  });
  cats.sort();
  chains.sort();
  fillSelect("category", cats);
  fillSelect("chain", chains);
  function fillSelect(id, values) {
    var el = document.getElementById(id);
    values.forEach(function (v) {
      var o = document.createElement("option");
      o.value = v;
      o.textContent = v;
      el.appendChild(o);
    });
  }

  var q = document.getElementById("q");
  var verdictSel = document.getElementById("verdict");
  var catSel = document.getElementById("category");
  var chainSel = document.getElementById("chain");
  var watchOnly = document.getElementById("watchonly");
  var sortSel = document.getElementById("sort");
  var tbody = document.getElementById("rows");
  var countEl = document.getElementById("count");

  [q, verdictSel, catSel, chainSel, watchOnly, sortSel].forEach(function (el) {
    el.addEventListener("input", render);
    el.addEventListener("change", render);
  });

  function filtered() {
    var needle = q.value.trim().toLowerCase();
    var list = rows.filter(function (r) {
      if (verdictSel.value && r.verdict !== verdictSel.value) return false;
      if (catSel.value && r.category !== catSel.value) return false;
      if (chainSel.value && r.chains.indexOf(chainSel.value) < 0) return false;
      if (watchOnly.checked && !r.watchlist) return false;
      if (
        needle &&
        (r.name.toLowerCase().indexOf(needle) < 0 &&
          r.slug.toLowerCase().indexOf(needle) < 0)
      )
        return false;
      return true;
    });
    var s = sortSel.value;
    list.sort(function (a, b) {
      if (s === "ev") return b.ev_per_hour_usd - a.ev_per_hour_usd;
      if (s === "tvl") return b.tvl_usd - a.tvl_usd;
      if (s === "odds") return b.launch_odds - a.launch_odds;
      if (s === "name") return a.name < b.name ? -1 : 1;
      return b.implied_value_usd - a.implied_value_usd;
    });
    return list;
  }

  function render() {
    var list = filtered();
    countEl.textContent =
      list.length +
      " of " +
      rows.length +
      " protocols" +
      (list.length !== rows.length ? " match the filters" : "") +
      " · ranked by implied value unless sorted otherwise";
    tbody.innerHTML = list
      .map(function (r) {
        return (
          '<tr data-slug="' +
          esc(r.slug) +
          '">' +
          "<td>" +
          r.rank +
          "</td>" +
          "<td><span class='name'>" +
          esc(r.name) +
          "</span>" +
          "<span class='sub'>" +
          esc(r.slug) +
          " · " +
          esc(r.category || "Uncategorised") +
          (r.watchlist ? ' · <span class="wl">WATCHLIST</span>' : "") +
          "</span></td>" +
          '<td class="num">' +
          usd(r.tvl_usd) +
          "</td>" +
          '<td class="num">' +
          pct(r.change_7d) +
          "</td>" +
          "<td>" +
          ageFmt(r.age_days) +
          "</td>" +
          '<td class="num">' +
          usd(r.implied_value_usd) +
          "</td>" +
          "<td><span class='oddsbar'><i style='width:" +
          Math.round(r.launch_odds * 100) +
          "%'></i></span>" +
          Math.round(r.launch_odds * 100) +
          "%</td>" +
          '<td class="num">' +
          usd(r.plan_cost_usd) +
          "</td>" +
          '<td class="num">' +
          usd(r.ev_per_hour_usd) +
          "/hr</td>" +
          '<td><span class="badge ' +
          r.verdict +
          '">' +
          r.verdict +
          "</span></td>" +
          "</tr>"
        );
      })
      .join("");
  }

  // ---- detail view ----
  var detailEl = document.getElementById("detail");
  var detailBody = document.getElementById("detail-body");
  document
    .getElementById("detail-close")
    .addEventListener("click", function () {
      detailEl.hidden = true;
      document.body.classList.remove("detail-only");
      if (location.hash.indexOf("#detail=") === 0)
        history.replaceState(null, "", location.pathname + location.search);
    });
  tbody.addEventListener("click", function (ev) {
    var tr = ev.target.closest("tr[data-slug]");
    if (tr) showDetail(tr.getAttribute("data-slug"));
  });

  function showDetail(slug, focus) {
    var r = null;
    for (var i = 0; i < rows.length; i++)
      if (rows[i].slug === slug) r = rows[i];
    if (!r) return;
    if (focus) document.body.classList.add("detail-only");
    var steps = r.farm_steps
      .map(function (s) {
        return "<li>" + esc(s) + "</li>";
      })
      .join("");
    detailBody.innerHTML =
      "<h2>" +
      esc(r.name) +
      ' <span class="slug">' +
      esc(r.slug) +
      "</span></h2>" +
      "<p>" +
      esc(r.category || "Uncategorised") +
      " · " +
      r.chains.map(esc).join(", ") +
      (r.watchlist ? " · <b>On the watchlist</b>" : "") +
      " · Rank #" +
      r.rank +
      " of " +
      rows.length +
      "</p>" +
      '<div class="kv">' +
      kv(usdFull(r.implied_value_usd), "implied value") +
      kv(
        usdFull(r.implied_low_usd) + " – " + usdFull(r.implied_high_usd),
        "80% interval",
      ) +
      kv(Math.round(r.launch_odds * 100) + "%", "launch odds") +
      kv(usdFull(r.tvl_usd), "TVL") +
      kv(pct(r.change_7d), "TVL change, 7d") +
      kv(ageFmt(r.age_days), "tracked for") +
      kv(usd(r.plan_cost_usd), "farm cost") +
      kv(r.plan_hours + " h", "farm time") +
      kv(usd(r.capital_usd), "suggested capital") +
      kv(usd(r.ev_per_hour_usd) + "/hr", "expected value / hour") +
      "</div>" +
      "<h3>Why this rank</h3>" +
      '<p class="why">Ranked #' +
      r.rank +
      " by an implied value of " +
      usdFull(r.implied_value_usd) +
      ", read off a TVL of " +
      usdFull(r.tvl_usd) +
      " through the fitted curve (see How this radar works). The 80% interval is " +
      usdFull(r.implied_low_usd) +
      " to " +
      usdFull(r.implied_high_usd) +
      " — the curve is honest about how wide it is. Launch odds " +
      Math.round(r.launch_odds * 100) +
      "% are the cross-fitted bucket for protocols that look like this one. Verdict: <b>" +
      r.verdict +
      "</b>.</p>" +
      "<h3>How to farm it — " +
      r.farm_steps.length +
      " steps, about " +
      usd(r.plan_cost_usd) +
      " in gas and fees, " +
      r.plan_hours +
      " hours of work</h3>" +
      "<ol>" +
      steps +
      "</ol>";
    detailEl.hidden = false;
    if (!focus) detailEl.scrollIntoView({ behavior: "auto", block: "start" });
    document.querySelectorAll("#board tr.sel").forEach(function (tr) {
      tr.classList.remove("sel");
    });
    var sel = tbody.querySelector('tr[data-slug="' + r.slug + '"]');
    if (sel) sel.classList.add("sel");
  }
  function kv(big, label) {
    return "<div><b>" + big + "</b><span>" + label + "</span></div>";
  }

  // ---- methodology, filled from the fitted numbers ----
  var fit = meta.fit;
  var cal = meta.calibration;
  document.getElementById("method-body").innerHTML =
    "<h3>The value model</h3>" +
    "<p>Implied value is read off the protocol's TVL through a curve fitted on the " +
    meta.n_fit +
    " protocols in this snapshot whose token already trades: " +
    "<code>log10(market cap) = " +
    fit.huber.a +
    " + " +
    fit.huber.b +
    " × log10(TVL)</code>. " +
    "It is a Huber robust fit (c = 1.345): a handful of protocols whose market cap is 100× off their TVL — prediction-market and bridge tokens mostly — do not get to drag the curve. " +
    "Out-of-sample (5-fold CV) RMSE is <b>" +
    fit.huber.cv_rmse +
    "</b> in log10, against <b>" +
    fit.ols.cv_rmse +
    "</b> for plain OLS (R² " +
    fit.ols.r2 +
    ", residual sd " +
    fit.ols.resid_sd +
    "). Every row carries an 80% interval from the residual sd (" +
    fit.huber.resid_sd +
    " in log10) — the model says how uncertain it is instead of pretending to be precise.</p>" +
    "<h3>What was tested and rejected</h3>" +
    "<p>" +
    esc(fit.rejected) +
    " The board prices on TVL alone because that is what survives a blind test. Age and 7-day growth still matter, but in the launch-odds score, not in the price.</p>" +
    "<h3>Launch odds</h3>" +
    "<p>Odds come from a logistic score on log TVL, log age and log chain count, predicting whether a protocol's record names a token. " +
    "Out-of-fold AUC is <b>" +
    cal.auc_out_of_fold +
    "</b> (TVL alone scores 0.53 — nearly useless on its own; age and chain count carry the signal). " +
    "Cross-fitted scores are split into quintiles and PAVA-pooled into the buckets <b>" +
    cal.buckets.map(function (b) {
      return Math.round(b * 100) + "%";
    }).join(" / ") +
    "</b>. " +
    esc(cal.note) +
    "</p>" +
    "<h3>Verdicts and farm costs</h3>" +
    "<p>Expected value per farming hour is <code>implied × odds × " +
    meta.verdicts.farmer_share +
    " ÷ plan hours</code>. The 0.1% farmer share is a deliberately conservative planning haircut — a single farmer never collects the whole implied value — stated here so the number can be argued with. " +
    "Farm at <b>" +
    usd(meta.verdicts.farm_ev_hr_at_least) +
    "/hr</b> or more, marginal from <b>" +
    usd(meta.verdicts.marginal_ev_hr_at_least) +
    "/hr</b>, skip below that: currently <b>" +
    meta.verdicts.counts.farm +
    " farm / " +
    meta.verdicts.counts.marginal +
    " marginal / " +
    meta.verdicts.counts.skip +
    " skip</b>. " +
    "Each plan's cost is the sum of its steps' gas (per-chain planning estimates) and fees, and its hours are the steps' stated times; capital is a suggestion, recoverable, not a cost.</p>" +
    "<h3>Who is on the board</h3>" +
    "<p>All " +
    meta.n_watchlist +
    " watchlist protocols, plus every other pre-token protocol that passes the watchlist's own exclusion rule — no wrapped, staked or bridged product of a token that trades, no centralised exchange, no versioned name. " +
    "That rule, not an arbitrary cutoff, sets the board's size at " +
    meta.n_board +
    " rows: every eligible pre-token protocol in the snapshot is on it. The house applies the same rule with one more field (parentProtocol) that the snapshot does not carry, so a protocol the rule would have caught through parentage can slip through here; the board names that gap rather than hiding it.</p>";

  // ---- hash routing: #detail=<slug> and #verdict=<farm|marginal|skip> ----
  function applyHash() {
    var h = location.hash;
    if (h.indexOf("#detail=") === 0) {
      showDetail(decodeURIComponent(h.slice(8)), true);
    } else if (h.indexOf("#verdict=") === 0) {
      var v = h.slice(9);
      if (["farm", "marginal", "skip"].indexOf(v) >= 0) {
        verdictSel.value = v;
        render();
      }
    }
  }
  window.addEventListener("hashchange", applyHash);

  render();
  applyHash();
})();
