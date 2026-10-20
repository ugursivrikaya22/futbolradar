/* ÜRETİLMİŞ DOSYA — kaynak: services/standingsSimulator.js. Elle düzenlemeyin;
   `node scripts/generate-standings-simulator-page.mjs` ile yeniden üretilir. */
/**
 * PUAN DURUMU SİMÜLATÖRÜ — TABLO ARİTMETİĞİ VE MATEMATİKSEL DURUM.
 *
 * Kullanıcının seçtiği sonuçlar resmî tabloya eklenir; sıralama canlı puan
 * durumuyla aynı kuraldan (services/liveStandings.js#rankRows: puan, averaj,
 * atılan gol, eşitlikte resmî sıra) geçer. Bölgeler sitedeki kuralla aynı:
 * 1. sıra şampiyonluk, 2-4 Avrupa kupaları, son 3 küme düşme.
 *
 * "Kesin" ve "elendi" yalnızca kalan maçların azami puanından türetilir;
 * olasılık tahmini yoktur. Eşit puan ihtimali "açık" sayılır; tüm maçlar
 * belirlendiyse durum, sitedeki sıralama kuralıyla oluşan son sıradan okunur.
 * Tarayıcı kopyası scripts/generate-standings-simulator-page.mjs ile üretilir.
 */
(function (root, factory) {
  var live = typeof module === "object" && module.exports ? require("./liveStandings.js") : root.FutbolRadarLiveStandings;
  var api = factory(live);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FutbolRadarStandingsSimulator = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (live) {
  "use strict";

  var DEFAULT_SCORES = { H: [1, 0], D: [0, 0], A: [0, 1] };

  function zoneFor(rank, total) {
    var r = Number(rank);
    var t = Number(total);
    if (!(r > 0) || !(t > 0)) return "";
    if (r === 1) return "champion";
    if (r <= 4) return "europe";
    if (r > t - 3) return "relegation";
    return "";
  }

  function toGoal(value) {
    if (value === null || value === undefined || value === "") return null;
    var n = Number(value);
    return Number.isInteger(n) && n >= 0 && n <= 30 ? n : null;
  }

  function outcomeOf(home, away) {
    return home > away ? "H" : home === away ? "D" : "A";
  }

  /** Seçim: {result: "H"|"D"|"A"} ya da {home, away}. Geçersizse null. */
  function normalizePick(pick) {
    if (!pick) return null;
    var home = toGoal(pick.home);
    var away = toGoal(pick.away);
    if (home !== null && away !== null) return { home: home, away: away, result: outcomeOf(home, away), exact: true };
    var preset = DEFAULT_SCORES[pick.result];
    return preset ? { home: preset[0], away: preset[1], result: pick.result, exact: false } : null;
  }

  function baseRow(row) {
    var won = Number(row.won) || 0;
    var drawn = Number(row.drawn) || 0;
    var points = Number(row.points) || 0;
    return {
      id: String(row.id),
      name: row.name,
      slug: row.slug || null,
      officialRank: Number(row.rank),
      rank: Number(row.rank),
      played: (Number(row.played) || 0),
      won: won,
      drawn: drawn,
      lost: Number(row.lost) || 0,
      goalsFor: Number(row.goalsFor) || 0,
      goalsAgainst: Number(row.goalsAgainst) || 0,
      goalDifference: (Number(row.goalsFor) || 0) - (Number(row.goalsAgainst) || 0),
      points: points,
      pointDeduction: won * 3 + drawn - points,
      remaining: 0
    };
  }

  function addResult(row, scored, conceded) {
    row.goalsFor += scored;
    row.goalsAgainst += conceded;
    if (scored > conceded) row.won += 1;
    else if (scored === conceded) row.drawn += 1;
    else row.lost += 1;
    row.played = row.won + row.drawn + row.lost;
    row.goalDifference = row.goalsFor - row.goalsAgainst;
    row.points = row.won * 3 + row.drawn - row.pointDeduction;
  }

  /**
   * Seçimleri uygular, sıralar, bölge ve matematiksel durumu ekler.
   * @param {Array} rows resmî satırlar
   * @param {Array} fixtures kalan maçlar [{id, home, away}] (takım kimliği)
   * @param {Object} picks maç kimliği → seçim
   */
  function simulate(rows, fixtures, picks) {
    var table = (rows || []).map(baseRow);
    var byId = {};
    table.forEach(function (row) { byId[row.id] = row; });
    var applied = 0;
    (fixtures || []).forEach(function (match) {
      var home = byId[String(match.home)];
      var away = byId[String(match.away)];
      if (!home || !away || home === away) return;
      var pick = normalizePick(picks && picks[match.id]);
      if (!pick) {
        home.remaining += 1;
        away.remaining += 1;
        return;
      }
      addResult(home, pick.home, pick.away);
      addResult(away, pick.away, pick.home);
      applied += 1;
    });
    var ranked = live.rankRows(table);
    var total = ranked.length;
    ranked.forEach(function (row) {
      row.zone = zoneFor(row.rank, total);
      row.officialZone = zoneFor(row.officialRank, total);
      row.maxPoints = row.points + row.remaining * 3;
    });
    var settled = ranked.every(function (row) { return row.remaining === 0; });
    ranked.forEach(function (row) {
      var place = function (k) { return settled ? (row.rank <= k ? "clinched" : "eliminated") : placeStatus(row, ranked, k); };
      row.status = { champion: place(1), europe: place(4), safety: place(total - 3) };
    });
    return { rows: ranked, applied: applied, open: (fixtures || []).length - applied };
  }

  /**
   * İlk `k` sıra için deterministik durum:
   *  "clinched"   en fazla k-1 rakip bu takımın puanına yetişebiliyor,
   *  "eliminated" en az k rakip bu takımın azami puanını zaten geçti,
   *  "open"       ikisi de kanıtlanamadı.
   */
  function placeStatus(row, rows, k) {
    if (!(k > 0) || k >= rows.length) return "clinched";
    var threats = 0;
    var ahead = 0;
    rows.forEach(function (other) {
      if (other === row) return;
      if (other.maxPoints >= row.points) threats += 1;
      if (other.points > row.maxPoints) ahead += 1;
    });
    if (threats <= k - 1) return "clinched";
    if (ahead >= k) return "eliminated";
    return "open";
  }

  /** Takımın seçilmemiş ilk maçı için üç sonucun tabloya etkisi. */
  function scenarioFor(rows, fixtures, picks, teamId) {
    var id = String(teamId);
    var next = null;
    for (var i = 0; i < (fixtures || []).length; i += 1) {
      var match = fixtures[i];
      if ((String(match.home) === id || String(match.away) === id) && !normalizePick(picks && picks[match.id])) { next = match; break; }
    }
    if (!next) return null;
    var isHome = String(next.home) === id;
    var outcomes = { win: isHome ? "H" : "A", draw: "D", loss: isHome ? "A" : "H" };
    var result = { match: next, isHome: isHome };
    Object.keys(outcomes).forEach(function (key) {
      var trial = {};
      Object.keys(picks || {}).forEach(function (matchId) { trial[matchId] = picks[matchId]; });
      trial[next.id] = { result: outcomes[key] };
      var sim = simulate(rows, fixtures, trial);
      var row = sim.rows.filter(function (r) { return r.id === id; })[0];
      result[key] = { rank: row.rank, points: row.points, zone: row.zone };
    });
    return result;
  }

  return {
    DEFAULT_SCORES: DEFAULT_SCORES,
    normalizePick: normalizePick,
    placeStatus: placeStatus,
    scenarioFor: scenarioFor,
    simulate: simulate,
    zoneFor: zoneFor
  };
});
