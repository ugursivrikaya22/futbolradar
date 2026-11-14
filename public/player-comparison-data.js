/**
 * KAYNAKLI OYUNCU KIYASI — paylaşılan çizici (tarayıcı + Node).
 *
 * Veri: data/player-comparison-data.json (scripts/collect-player-comparison.mjs
 * üretir). Aynı çizici iki yerde çalışır:
 *   - oyuncu-karsilastir.html: Avrupa + Türkiye oyuncularından seçilen iki
 *     oyuncu tarayıcıda çizilir;
 *   - karsilastirma/*.html: scripts/generate-player-comparison-pages.mjs
 *     sayfayı üretirken aynı HTML'i statik olarak basar.
 *
 * Değer yoksa "Güncelleniyor" yazılır; hiçbir sayı tahmin edilmez. Kaynak
 * bağlantıları rel="nofollow noopener noreferrer" taşır.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FRPlayerComparison = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var MISSING = "Güncelleniyor";
  var LEAGUES = [
    ["", "Tüm ligler"],
    ["super-lig", "Süper Lig"],
    ["premier-league", "Premier League"],
    ["la-liga", "La Liga"],
    ["serie-a", "Serie A"],
    ["bundesliga", "Bundesliga"],
    ["ligue-1", "Ligue 1"],
    ["sampiyonlar-ligi", "Şampiyonlar Ligi"]
  ];

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function show(value, suffix) {
    if (value === null || value === undefined || value === "" || (typeof value === "number" && !isFinite(value))) {
      return '<span class="pcd-missing">' + MISSING + "</span>";
    }
    var text = typeof value === "number" ? String(value).replace(".", ",") : String(value);
    return esc(text) + (suffix || "");
  }

  function dateTr(value) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
    return m ? m[3] + "." + m[2] + "." + m[1] : null;
  }

  function sourceLink(meta, key) {
    var source = key && meta && meta.sources ? meta.sources[key] : null;
    if (!source) return "";
    var label = source.name === "API-Football" ? "API-Football" : source.name;
    return '<a class="pcd-src" href="' + esc(source.url) + '" target="_blank" rel="nofollow noopener noreferrer">' + esc(label) + "</a>";
  }

  function cell(meta, field) {
    if (!field || field.value === null || field.value === undefined) return show(null);
    return show(field.value) + " " + sourceLink(meta, field.source);
  }

  /** Oyuncunun ilk (ana) sezon istatistiği; lig filtresi varsa o lig. */
  function primaryStat(player, leagueId) {
    var stats = (player && player.seasonStats) || [];
    for (var i = 0; i < stats.length; i += 1) if (leagueId && stats[i].competitionId === leagueId) return stats[i];
    return stats[0] || null;
  }

  function primaryPerf(player) {
    var perf = player && player.matchPerformance;
    return perf && perf.competitions && perf.competitions.length ? perf.competitions[0] : null;
  }

  function statRow(label, left, right) {
    return "<tr><th scope=\"row\">" + esc(label) + "</th><td>" + left + "</td><td>" + right + "</td></tr>";
  }

  function lastMatchesHtml(meta, player) {
    var perf = player && player.matchPerformance;
    var rows = perf && perf.lastMatches ? perf.lastMatches : [];
    if (!rows.length) return '<p class="pcd-empty">Son maçlar: ' + MISSING + "</p>";
    return '<ol class="pcd-list">' + rows.map(function (row) {
      var where = row.home === true ? "(İç saha)" : row.home === false ? "(Deplasman)" : "";
      return "<li><b>" + show(dateTr(row.date)) + "</b> " + esc(row.opponent || MISSING) + " " + where +
        ' <span class="pcd-sub">' + esc(row.competition || "") + "</span><br>" +
        show(row.minutes, " dk") + " · Gol " + show(row.goals) + " · Asist " + show(row.assists) + " · Puan " + show(row.rating) + "</li>";
    }).join("") + "</ol>" + '<p class="pcd-cite">Kaynak: ' + sourceLink(meta, perf.source) + "</p>";
  }

  function transfersHtml(meta, player) {
    var rows = (player && player.transferHistory) || [];
    if (!rows.length) return '<p class="pcd-empty">Transfer geçmişi: ' + MISSING + "</p>";
    return '<ol class="pcd-list">' + rows.slice(0, 6).map(function (row) {
      return "<li><b>" + show(dateTr(row.date)) + "</b> " + esc(row.from || MISSING) + " → " + esc(row.to || MISSING) +
        ' <span class="pcd-sub">' + show(row.type) + (row.fee ? " · " + esc(row.fee) : "") + "</span> " + sourceLink(meta, row.source) + "</li>";
    }).join("") + "</ol>";
  }

  /**
   * İki oyuncunun kaynaklı kıyas bloğu. `left`/`right` toplayıcı kayıtları;
   * biri null olabilir (o sütun "Güncelleniyor" basar).
   */
  function renderComparison(data, left, right, options) {
    var meta = (data && data.meta) || {};
    var opts = options || {};
    var leagueId = opts.leagueId || "";
    var heading = opts.headingTag || "h2";
    var a = left || {};
    var b = right || {};
    var sa = primaryStat(a, leagueId);
    var sb = primaryStat(b, leagueId);
    var pa = primaryPerf(a);
    var pb = primaryPerf(b);
    var updated = dateTr(meta.generatedAt);

    function statSrc(stat) { return stat ? " " + sourceLink(meta, stat.source) : ""; }
    function v(obj, key, suffix) { return show(obj ? obj[key] : null, suffix); }

    var rows = [
      statRow("Kulüp (kadro)", cell(meta, a.team), cell(meta, b.team)),
      statRow("Pozisyon", cell(meta, a.position), cell(meta, b.position)),
      statRow("Forma numarası", cell(meta, a.shirtNumber), cell(meta, b.shirtNumber)),
      statRow("Yaş", cell(meta, a.age), cell(meta, b.age)),
      statRow("Sezon istatistiği", (sa ? esc(sa.competition + " " + (sa.season || "")) + statSrc(sa) : show(null)), (sb ? esc(sb.competition + " " + (sb.season || "")) + statSrc(sb) : show(null))),
      statRow("Maç", v(sa, "appearances"), v(sb, "appearances")),
      statRow("Dakika", v(sa, "minutes"), v(sb, "minutes")),
      statRow("Gol", v(sa, "goals"), v(sb, "goals")),
      statRow("Asist", v(sa, "assists"), v(sb, "assists")),
      statRow("Gol / 90 dk", v(sa, "goalsPer90"), v(sb, "goalsPer90")),
      statRow("Asist / 90 dk", v(sa, "assistsPer90"), v(sb, "assistsPer90")),
      statRow("Gol / maç", v(sa, "goalsPerMatch"), v(sb, "goalsPerMatch")),
      statRow("Dakika / maç", v(sa, "minutesPerMatch"), v(sb, "minutesPerMatch")),
      statRow("Maç kayıtları (sezon)", pa ? esc(pa.competition) + " " + sourceLink(meta, a.matchPerformance.source) : show(null), pb ? esc(pb.competition) + " " + sourceLink(meta, b.matchPerformance.source) : show(null)),
      statRow("Kayıtlı maç / ilk 11", pa ? show(pa.matches) + " / " + show(pa.starts) : show(null), pb ? show(pb.matches) + " / " + show(pb.starts) : show(null)),
      statRow("Şut / maç", v(pa, "shotsPerMatch"), v(pb, "shotsPerMatch")),
      statRow("Ortalama maç puanı", v(pa, "averageRating"), v(pb, "averageRating")),
      statRow("Pas isabeti (%)", v(pa, "passAccuracy"), v(pb, "passAccuracy"))
    ];

    var nameA = esc(a.name || MISSING);
    var nameB = esc(b.name || MISSING);

    return '<div class="pcd-block" data-pcd-left="' + esc(a.providerId || "") + '" data-pcd-right="' + esc(b.providerId || "") + '">' +
      '<div class="pcd-head"><' + heading + ">" + esc(opts.title || "Kaynaklı oyuncu verileri") + "</" + heading + ">" +
      '<a class="pcd-label" href="https://www.api-football.com/" target="_blank" rel="nofollow noopener noreferrer">Veri: API-Football</a></div>' +
      '<div class="pcd-table-wrap"><table class="pcd-table"><thead><tr><th scope="col">Alan</th><th scope="col">' + nameA + '</th><th scope="col">' + nameB + "</th></tr></thead><tbody>" +
      rows.join("") + "</tbody></table></div>" +
      '<div class="pcd-cards">' +
      '<article class="pcd-card"><h3>' + nameA + " · son 5 maç</h3>" + lastMatchesHtml(meta, a) + "</article>" +
      '<article class="pcd-card"><h3>' + nameB + " · son 5 maç</h3>" + lastMatchesHtml(meta, b) + "</article>" +
      '<article class="pcd-card"><h3>' + nameA + " · transfer geçmişi</h3>" + transfersHtml(meta, a) + "</article>" +
      '<article class="pcd-card"><h3>' + nameB + " · transfer geçmişi</h3>" + transfersHtml(meta, b) + "</article>" +
      "</div>" +
      '<p class="pcd-note">Veri: API-Football (kadro, lig liderleri, maç kayıtları, transferler) ve resmî kulüp kaynakları. ' +
      "Son veri: " + show(updated) + ". Kaynağı olmayan alanlarda “" + MISSING + "” yazar; değer tahmin edilmez.</p>" +
      "</div>";
  }

  function findPlayer(data, predicate) {
    var list = (data && data.players) || [];
    for (var i = 0; i < list.length; i += 1) if (predicate(list[i])) return list[i];
    return null;
  }

  /* ---------- Tarayıcı: oyuncu-karsilastir.html bölümü ---------- */
  function mount(section) {
    var url = section.getAttribute("data-src") || "/data/player-comparison-data.json";
    var leagueSelect = section.querySelector("[data-pcd-league]");
    var selects = section.querySelectorAll("[data-pcd-player]");
    var out = section.querySelector("[data-pcd-output]");
    if (!leagueSelect || selects.length < 2 || !out) return;
    leagueSelect.innerHTML = LEAGUES.map(function (pair) {
      return '<option value="' + esc(pair[0]) + '">' + esc(pair[1]) + "</option>";
    }).join("");

    fetch(url, { credentials: "same-origin" }).then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    }).then(function (data) {
      var players = (data.players || []).filter(function (p) { return p && p.name; });
      var params = new URLSearchParams(window.location.search);
      var preset = String(params.get("af") || "").split(",").filter(Boolean);

      function fill(select, list, wanted) {
        select.innerHTML = list.map(function (p) {
          return '<option value="' + esc(p.providerId) + '">' + esc(p.name) + (p.team && p.team.value ? " — " + esc(p.team.value) : "") + "</option>";
        }).join("");
        if (wanted && list.some(function (p) { return p.providerId === wanted; })) select.value = wanted;
      }

      function filtered() {
        var league = leagueSelect.value;
        return players.filter(function (p) { return !league || (p.leagues || []).indexOf(league) !== -1; });
      }

      function render() {
        var pick = function (select) { return findPlayer(data, function (p) { return p.providerId === select.value; }); };
        out.innerHTML = renderComparison(data, pick(selects[0]), pick(selects[1]), { leagueId: leagueSelect.value, headingTag: "h2" });
      }

      function refill() {
        var list = filtered();
        fill(selects[0], list, preset[0] || selects[0].value);
        fill(selects[1], list, preset[1] || (list[1] && list[1].providerId));
        if (selects[0].value === selects[1].value && list[1]) selects[1].value = list[1].providerId;
        preset = [];
        render();
      }

      leagueSelect.addEventListener("change", refill);
      selects[0].addEventListener("change", render);
      selects[1].addEventListener("change", render);
      var cov = section.querySelector("[data-pcd-coverage]");
      if (cov && data.meta && data.meta.coverage) {
        cov.textContent = data.meta.coverage.players + " oyuncu · " + (LEAGUES.length - 1) + " lig/turnuva";
      }
      refill();
    }).catch(function () {
      out.innerHTML = '<p class="pcd-empty">Oyuncu verisi ' + MISSING + ".</p>";
    });
  }

  if (typeof document !== "undefined") {
    var start = function () {
      var sections = document.querySelectorAll("[data-player-comparison-data]");
      for (var i = 0; i < sections.length; i += 1) mount(sections[i]);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
  }

  return { MISSING: MISSING, LEAGUES: LEAGUES, renderComparison: renderComparison, findPlayer: findPlayer, esc: esc };
});
