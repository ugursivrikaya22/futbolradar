(function () {
  "use strict";

  var root = document.querySelector("[data-standings-page]");
  if (!root || typeof window.fetch !== "function") return;

  var league = root.getAttribute("data-league") || "";
  var team = root.getAttribute("data-team") || "";
  var zones;
  try {
    zones = JSON.parse(root.getAttribute("data-zones") || "{}");
  } catch (error) {
    zones = {};
  }

  function esc(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function key(value) {
    return String(value || "")
      .toLocaleLowerCase("tr-TR")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ı/g, "i")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  function number(value) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function valid(rows) {
    return Array.isArray(rows) && rows.length >= 10 && rows.every(function (row) {
      return row && row.team && ["rank", "played", "won", "drawn", "lost", "goalsFor", "goalsAgainst", "goalDifference", "points"]
        .every(function (field) { return number(row[field]) !== null; });
    });
  }

  function zoneFor(row, total) {
    var rank = number(row.rank);
    if (zones.relegationCount && rank > total - number(zones.relegationCount)) return "relegation";
    if (zones.promotionThrough && rank <= number(zones.promotionThrough)) return "promotion";
    if (zones.playoffThrough && rank <= number(zones.playoffThrough)) return "playoff";
    if (zones.championsLeagueThrough && rank <= number(zones.championsLeagueThrough)) return "champions-league";
    if (zones.europeThrough && rank <= number(zones.europeThrough)) return "europe";
    return "";
  }

  function rowsHtml(rows) {
    return rows.map(function (row) {
      var selected = team && key(row.team) === key(team);
      var zone = zoneFor(row, rows.length);
      return '<tr class="standings-row' + (selected ? ' is-highlighted' : '') + (zone ? ' is-zone-' + zone : '') + '"' +
        (selected ? ' aria-current="true"' : '') + ' data-team="' + esc(key(row.team)) + '">' +
        '<td class="col-rank">' + esc(row.rank) + '</td>' +
        '<th scope="row" class="col-team"><span>' + esc(row.team) + '</span></th>' +
        '<td class="col-played">' + esc(row.played) + '</td>' +
        '<td class="col-won">' + esc(row.won) + '</td>' +
        '<td class="col-drawn">' + esc(row.drawn) + '</td>' +
        '<td class="col-lost">' + esc(row.lost) + '</td>' +
        '<td class="col-gf">' + esc(row.goalsFor) + '</td>' +
        '<td class="col-ga">' + esc(row.goalsAgainst) + '</td>' +
        '<td class="col-gd">' + (number(row.goalDifference) > 0 ? "+" : "") + esc(row.goalDifference) + '</td>' +
        '<td class="col-points"><strong>' + esc(row.points) + '</strong></td></tr>';
    }).join("");
  }

  function teamContext(rows) {
    if (!team) return "";
    var index = rows.findIndex(function (row) { return key(row.team) === key(team); });
    if (index < 0) return "";
    var row = rows[index];
    var leader = rows[0];
    var above = rows[index - 1];
    var below = rows[index + 1];
    var leaderGap = number(leader.points) - number(row.points);
    var aboveGap = above ? number(above.points) - number(row.points) : null;
    var belowGap = below ? number(row.points) - number(below.points) : null;
    var narrative = row.team + ", " + row.played + " maç sonunda " + row.points + " puanla " + row.rank + ". sırada.";
    if (leaderGap > 0) narrative += " Lider " + leader.team + " ile arasında " + leaderGap + " puan var.";
    else narrative += " " + row.team + " lig lideri.";
    return '<div class="team-standing-copy"><p>' + esc(narrative) + '</p></div>' +
      '<dl class="team-standing-metrics">' +
      '<div><dt>Sıra</dt><dd>' + esc(row.rank) + '</dd></div><div><dt>Puan</dt><dd>' + esc(row.points) + '</dd></div>' +
      '<div><dt>Oynanan</dt><dd>' + esc(row.played) + '</dd></div><div><dt>G / B / M</dt><dd>' + esc(row.won) + ' / ' + esc(row.drawn) + ' / ' + esc(row.lost) + '</dd></div>' +
      '<div><dt>Averaj</dt><dd>' + (number(row.goalDifference) > 0 ? "+" : "") + esc(row.goalDifference) + '</dd></div>' +
      '<div><dt>Üst sıra farkı</dt><dd>' + (aboveGap === null ? "Lider" : esc(aboveGap) + " puan") + '</dd></div>' +
      '<div><dt>Alt sıra farkı</dt><dd>' + (belowGap === null ? "Son sıra" : esc(belowGap) + " puan") + '</dd></div>' +
      '<div><dt>Liderle fark</dt><dd>' + esc(leaderGap) + ' puan</dd></div></dl>';
  }

  function leagueSummary(rows) {
    var leader = rows[0];
    var relegation = zones.relegationCount ? rows.slice(-number(zones.relegationCount)).map(function (row) { return row.team; }) : [];
    return esc(leader.team) + ", " + esc(leader.points) + " puanla lider. " +
      (relegation.length ? esc(relegation.join(", ")) + " küme düşme hattında." : "Lig sıralaması güncel sonuçlardan hesaplanıyor.");
  }

  fetch("/api/standings?league=" + encodeURIComponent(league), { headers: { accept: "application/json" } })
    .then(function (response) { return response.ok ? response.json() : null; })
    .then(function (payload) {
      var rows = payload && payload.data;
      if (!valid(rows)) return;
      rows.sort(function (left, right) { return number(left.rank) - number(right.rank); });
      var body = root.querySelector("[data-standings-body]");
      if (body) body.innerHTML = rowsHtml(rows);
      var summary = root.querySelector("[data-standings-summary]");
      if (summary && !team) summary.innerHTML = "<p>" + leagueSummary(rows) + "</p>";
      var context = root.querySelector("[data-team-standing-context]");
      if (context && team) context.innerHTML = teamContext(rows);
      var freshness = root.querySelector("[data-standings-updated]");
      if (freshness && payload.updatedAt) {
        freshness.textContent = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" }).format(new Date(payload.updatedAt)) + " TSİ";
      }
      root.setAttribute("data-live-refreshed", "true");
    })
    .catch(function () {
      /* Sunucu tarafında üretilmiş doğrulanmış tablo görünür kalır. */
    });
})();
