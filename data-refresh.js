(function () {
  "use strict";
  if (document.documentElement.lang !== "tr") return;
  var path = location.pathname.replace(/\.html$/, "").replace(/^\//, "");
  var league = path.replace(/-puan-durumu$/, "");
  var leagueAliases = { "premier-lig": "premier-league", "1-lig": "tff-1-lig" };
  league = leagueAliases[league] || league;
  var table = /-puan-durumu$/.test(path) ? document.querySelector(".evergreen-table tbody") : null;
  var panels = Array.from(document.querySelectorAll('.standings-tabs__panel[id^="standings-panel-"]'));
  var leaderMetric = path === "gol-kralligi" ? "goals" : path === "asist-kralligi" ? "assists" : null;
  var leadersTable = leaderMetric ? document.querySelector(".evergreen-table tbody") : null;
  var homeLeaders = document.querySelector('[data-api-target="leaders-scorers"], [data-api-target="leaders-assists"]');
  if (!table && !panels.length && !leadersTable && !homeLeaders) return;

  function html(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function number(value) { return value == null ? "—" : html(value); }
  function stamp(target, value) {
    var element = target.querySelector("[data-resource-updated]");
    if (!element) {
      element = document.createElement("p");
      element.className = "data-stamp";
      element.setAttribute("data-resource-updated", "");
      target.appendChild(element);
    }
    var date = new Date(value || "");
    element.innerHTML = Number.isFinite(date.getTime())
      ? 'Son güncelleme: <time datetime="' + html(date.toISOString()) + '">' + html(date.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })) + " TSİ</time>"
      : "Son güncelleme: Güncelleme bekleniyor.";
    var old = document.querySelector(".evergreen-freshness time");
    if (table && old && Number.isFinite(date.getTime())) { old.dateTime = date.toISOString(); old.textContent = element.textContent; }
  }
  function json(url) {
    return fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) }).then(function (r) {
      if (!r.ok) throw new Error("data-unavailable");
      return r.json();
    }).then(function (payload) {
      if (payload.ok === false) throw new Error("data-unavailable");
      return payload;
    });
  }
  function standingCells(row) {
    return ["played", "won", "drawn", "lost", "goalsFor", "goalsAgainst", "goalDifference", "points"].map(function (key) { return "<td>" + number(row[key]) + "</td>"; }).join("");
  }
  function validStandings(rows) {
    return Array.isArray(rows) && rows.every(function (row) {
      return (row.name || row.team) && Number.isFinite(row.points) && Number.isFinite(row.rank) &&
        row.played === row.won + row.drawn + row.lost && row.goalDifference === row.goalsFor - row.goalsAgainst;
    }) && new Set(rows.map(function (row) { return row.rank; })).size === rows.length;
  }
  function refreshStanding(id, panel) {
    return json("/api/standings?league=" + encodeURIComponent(id)).then(function (payload) {
      var rows = payload.data;
      if (!validStandings(rows)) throw new Error("invalid-standings");
      rows.sort(function (a, b) { return a.rank - b.rank; });
      if (!panel) {
        table.innerHTML = rows.map(function (row) { return "<tr><td>" + number(row.rank) + '</td><th scope="row">' + html(row.name || row.team) + "</th>" + standingCells(row) + "</tr>"; }).join("");
        stamp(table.closest("section"), payload.updatedAt);
        return;
      }
      var body = panel.querySelector(".standings-tabs__body");
      if (!body) return;
      body.innerHTML = rows.slice(0, 5).map(function (row) {
        var name = html(row.name || row.team);
        var team = id === "super-lig" ? '<a class="home-standing-team" href="./takim-detay.html?team=' + encodeURIComponent(row.name || row.team) + '">' : '<span class="home-standing-team">';
        var logo = row.logo && /^https:\/\//.test(row.logo) ? '<img class="home-standing-logo" src="' + html(row.logo) + '" alt="" width="22" height="22" loading="lazy">' : '<span class="home-standing-logo home-standing-logo-fallback" aria-hidden="true">' + name.charAt(0) + '</span>';
        return '<div class="home-standing-row" data-card="standing-row" data-team="' + html(row.id) + '"><span class="home-standing-rank">' + number(row.rank) + '</span>' + team + logo + '<b>' + name + '</b>' + (id === "super-lig" ? '</a>' : '</span>') +
          ["played", "won", "drawn", "lost"].map(function (key) { return '<span>' + number(row[key]) + '</span>'; }).join("") + '<span class="home-standing-gd">' + (row.goalDifference > 0 ? "+" : "") + number(row.goalDifference) + '</span><span class="home-standing-points">' + number(row.points) + '</span></div>';
      }).join("");
      stamp(panel, payload.updatedAt);
    });
  }
  function nameOf(row) {
    return row.slug && /^[a-z0-9-]+$/.test(row.slug) ? '<a href="./oyuncular/' + row.slug + '.html">' + html(row.name) + '</a>' : '<span>' + html(row.name) + '</span>';
  }
  function refreshLeaders() {
    return json("/data/league-leaders.json").then(function (payload) {
      var now = new Date();
      var season = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
      var current = String(payload.season).slice(0, 4) === String(season);
      ["goals", "assists"].forEach(function (metric) {
        var rows = current ? payload[metric === "goals" ? "topScorers" : "topAssists"] : [];
        if (!Array.isArray(rows)) throw new Error("invalid-leaders");
        var target = document.querySelector('[data-api-target="leaders-' + (metric === "goals" ? "scorers" : "assists") + '"]');
        if (target) {
          target.innerHTML = '<ol class="leaders-list">' + rows.slice(0, 5).map(function (row, index) {
            return '<li class="leaders-row" data-card="leader-player"><span class="leaders-rank">' + (index + 1) + '</span><span class="leaders-name"><strong>' + nameOf(row) + '</strong><span>' + html(row.team) + '</span></span><span class="leaders-value">' + number(row[metric]) + '<small>' + (metric === "goals" ? "Gol" : "Asist") + '</small></span></li>';
          }).join("") + '</ol>';
          stamp(target, payload.updatedAt || payload.generatedAt);
        }
        if (leadersTable && leaderMetric === metric) {
          leadersTable.innerHTML = rows.map(function (row, index) {
            var logo = row.teamLogo && /^https:\/\//.test(row.teamLogo) ? '<img class="home-standing-logo" src="' + html(row.teamLogo) + '" alt="" width="20" height="20">' : "";
            return '<tr><td>' + (index + 1) + '</td><th scope="row">' + nameOf(row) + '</th><td><span class="home-standing-team">' + logo + '<span>' + html(row.team) + '</span></span></td><td><strong>' + number(row[metric]) + '</strong></td><td>' + number(row.appearances) + '</td></tr>';
          }).join("");
          stamp(leadersTable.closest("section"), payload.updatedAt || payload.generatedAt);
        }
      });
    });
  }
  var pending = false;
  function refresh() {
    if (pending || document.hidden) return;
    pending = true;
    var jobs = panels.map(function (panel) { return refreshStanding(panel.id.replace("standings-panel-", ""), panel); });
    if (table) jobs.push(refreshStanding(league));
    if (leadersTable || homeLeaders) jobs.push(refreshLeaders());
    Promise.allSettled(jobs).finally(function () { pending = false; });
  }
  refresh();
  window.setInterval(refresh, 60000);
  document.addEventListener("visibilitychange", refresh);
}());
