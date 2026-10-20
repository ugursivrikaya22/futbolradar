/* /puan-durumu-simulator — istemci arayüzü. Hesap: standings-simulator-core.js */
(function () {
  "use strict";
  var sim = window.FutbolRadarStandingsSimulator;
  var node = document.getElementById("sim-data");
  if (!sim || !node) return;
  var payload;
  try { payload = JSON.parse(node.textContent); } catch (e) { return; }

  var rows = payload.rows.map(function (r) {
    return { id: r[0], name: r[1], slug: r[2], rank: r[3], played: r[4], won: r[5], drawn: r[6], lost: r[7], goalsFor: r[8], goalsAgainst: r[9], points: r[10] };
  });
  var fixtures = payload.fx.map(function (f) {
    return { id: String(f[0]), round: f[1], home: rows[f[2]].id, away: rows[f[3]].id, kickoff: f[4] };
  });
  var names = {};
  rows.forEach(function (r) { names[r.id] = r.name; });
  var rounds = [];
  fixtures.forEach(function (f) { if (rounds.indexOf(f.round) === -1) rounds.push(f.round); });

  var KEY = "fr-sim-super-lig";
  var picks = {};
  try {
    var saved = JSON.parse(localStorage.getItem(KEY) || "null");
    if (saved && saved.v === payload.v && saved.p) picks = saved.p;
  } catch (e) { /* depolama kapalı */ }

  var $ = function (sel) { return document.querySelector(sel); };
  var els = { matches: $("[data-sim-matches]"), table: $("[data-sim-table]"), round: $("[data-sim-round]"), count: $("[data-sim-count]"), team: $("[data-sim-team]"), scenario: $("[data-sim-scenario]") };
  var current = rounds[0];

  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); }
  function save() { try { localStorage.setItem(KEY, JSON.stringify({ v: payload.v, p: picks })); } catch (e) { /* yok say */ } }
  function signed(n) { return (n > 0 ? "+" : "") + n; }
  function kickoffLabel(k) {
    if (!k) return "Tarih bekleniyor";
    var d = new Date(k);
    return isNaN(d) ? "" : d.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "short", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  }

  var ZONE = { champion: " is-leader", europe: " is-europe", relegation: " is-relegation" };
  var STATUS = { clinched: ["is-clinched", "✓", "kesin"], eliminated: ["is-eliminated", "✕", "elendi"], open: ["", "·", "açık"] };
  function chip(label, state) {
    var s = STATUS[state];
    return '<b class="sim-chip ' + s[0] + '" title="' + label + ": " + s[2] + '" aria-label="' + label + ": " + s[2] + '">' + s[1] + "</b>";
  }

  function renderRoundSelect() {
    els.round.innerHTML = rounds.map(function (r) { return '<option value="' + r + '">' + r + ". Hafta</option>"; }).join("");
    els.round.value = String(current);
  }

  function renderMatches() {
    var list = fixtures.filter(function (f) { return f.round === current; });
    els.matches.innerHTML = '<ul class="sim-matches">' + list.map(function (f) {
      var p = picks[f.id] || {};
      var res = sim.normalizePick(p);
      var btn = function (val, label, aria) {
        return '<button type="button" class="sim-pick" data-pick="' + val + '" aria-pressed="' + (res && res.result === val ? "true" : "false") + '" aria-label="' + esc(aria) + '">' + label + "</button>";
      };
      return '<li class="sim-match" data-id="' + f.id + '">' +
        '<span class="sim-team">' + esc(names[f.home]) + "</span>" +
        '<span class="sim-picks">' + btn("H", "1", names[f.home] + " kazanır") + btn("D", "X", "Beraberlik") + btn("A", "2", names[f.away] + " kazanır") + "</span>" +
        '<span class="sim-team is-away">' + esc(names[f.away]) + "</span>" +
        '<span class="sim-score"><input inputmode="numeric" maxlength="2" aria-label="' + esc(names[f.home]) + ' golü" data-goal="home" value="' + (p.home != null ? esc(p.home) : "") + '" placeholder="' + (res ? res.home : "–") + '"><span>-</span><input inputmode="numeric" maxlength="2" aria-label="' + esc(names[f.away]) + ' golü" data-goal="away" value="' + (p.away != null ? esc(p.away) : "") + '" placeholder="' + (res ? res.away : "–") + '"></span>' +
        '<small class="sim-kickoff">' + esc(kickoffLabel(f.kickoff)) + "</small></li>";
    }).join("") + "</ul>";
  }

  function renderTable() {
    var result = sim.simulate(rows, fixtures, picks);
    els.table.innerHTML = result.rows.map(function (r) {
      var change = r.rankChange > 0 ? '<i class="sim-up" aria-label="' + r.rankChange + ' sıra yukarı">▲' + r.rankChange + "</i>" : r.rankChange < 0 ? '<i class="sim-down" aria-label="' + (-r.rankChange) + ' sıra aşağı">▼' + (-r.rankChange) + "</i>" : "";
      return '<tr class="sim-row' + (ZONE[r.zone] || "") + (r.zone !== r.officialZone ? " is-zone-change" : "") + '"><td>' + r.rank + change + '</td><th scope="row">' + esc(r.name) + "</th><td>" + r.played + "</td><td>" + signed(r.goalDifference) + "</td><td><strong>" + r.points + '</strong></td><td class="sim-status">' + chip("Şampiyonluk", r.status.champion) + chip("Avrupa", r.status.europe) + chip("Ligde kalma", r.status.safety) + "</td></tr>";
    }).join("");
    els.count.textContent = result.applied ? result.applied + " maç seçildi" : "";
    renderScenario();
  }

  function renderScenario() {
    var id = els.team.value;
    if (!id) return;
    var s = sim.scenarioFor(rows, fixtures, picks, id);
    if (!s) { els.scenario.innerHTML = '<p class="sim-note">Bu takımın belirlenmemiş maçı kalmadı.</p>'; return; }
    var opp = names[s.isHome ? s.match.away : s.match.home];
    var line = function (label, o, cls) { return '<li class="' + cls + '"><span>' + label + "</span><strong>" + o.rank + ". sıra</strong><small>" + o.points + " puan</small></li>"; };
    els.scenario.innerHTML = '<p class="sim-scenario-match">' + s.match.round + ". Hafta · " + esc(names[s.match.home]) + " – " + esc(names[s.match.away]) + " <small>" + esc(kickoffLabel(s.match.kickoff)) + "</small></p>" +
      '<ul class="sim-outcomes">' + line("Kazanırsa", s.win, "is-win") + line("Berabere kalırsa", s.draw, "is-draw") + line("Kaybederse", s.loss, "is-loss") + "</ul>" +
      '<p class="sim-note">' + esc(opp) + " maçı dışında senin seçimlerin ve resmî tablo sabit tutulur; skor 1-0, 0-0, 0-1 sayılır.</p>";
  }

  function setPick(id, next) {
    if (next) picks[id] = next; else delete picks[id];
    save();
    renderTable();
  }

  els.matches.addEventListener("click", function (event) {
    var button = event.target.closest("[data-pick]");
    if (!button) return;
    var li = button.closest("[data-id]");
    var id = li.getAttribute("data-id");
    var value = button.getAttribute("data-pick");
    var same = picks[id] && sim.normalizePick(picks[id]) && sim.normalizePick(picks[id]).result === value;
    setPick(id, same ? null : { result: value });
    renderMatches();
  });
  els.matches.addEventListener("input", function (event) {
    var input = event.target.closest("[data-goal]");
    if (!input) return;
    input.value = input.value.replace(/\D/g, "").slice(0, 2);
    var li = input.closest("[data-id]");
    var id = li.getAttribute("data-id");
    var home = li.querySelector('[data-goal="home"]').value;
    var away = li.querySelector('[data-goal="away"]').value;
    var h = home === "" ? null : Number(home);
    var a = away === "" ? null : Number(away);
    var prev = (picks[id] || {}).result;
    var next = h !== null && a !== null ? { home: h, away: a, result: h > a ? "H" : h === a ? "D" : "A" }
      : prev ? { result: prev, home: h, away: a }
      : h !== null || a !== null ? { home: h, away: a } : null;
    setPick(id, next);
    var res = sim.normalizePick(next);
    li.querySelectorAll("[data-pick]").forEach(function (b) { b.setAttribute("aria-pressed", res && res.result === b.getAttribute("data-pick") ? "true" : "false"); });
  });
  els.round.addEventListener("change", function () { current = Number(els.round.value); renderMatches(); });
  $("[data-sim-prev]").addEventListener("click", function () { var i = rounds.indexOf(current); if (i > 0) { current = rounds[i - 1]; els.round.value = String(current); renderMatches(); } });
  $("[data-sim-next]").addEventListener("click", function () { var i = rounds.indexOf(current); if (i < rounds.length - 1) { current = rounds[i + 1]; els.round.value = String(current); renderMatches(); } });
  $("[data-sim-clear-round]").addEventListener("click", function () {
    fixtures.forEach(function (f) { if (f.round === current) delete picks[f.id]; });
    save(); renderMatches(); renderTable();
  });
  $("[data-sim-reset]").addEventListener("click", function () { picks = {}; save(); renderMatches(); renderTable(); });
  els.team.addEventListener("change", function () {
    if (!els.team.value) els.scenario.innerHTML = "";
    renderScenario();
  });

  var wanted = new URLSearchParams(location.search).get("takim");
  if (wanted) rows.forEach(function (r) { if (r.slug === wanted || r.id === wanted) els.team.value = r.id; });

  $("[data-sim-nav]").hidden = false;
  $("[data-sim-actions]").hidden = false;
  renderRoundSelect();
  renderMatches();
  renderTable();
})();
