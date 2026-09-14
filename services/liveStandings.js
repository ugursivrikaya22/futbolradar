/**
 * CANLI PUAN DURUMU — GEÇİCİ TABLO ARİTMETİĞİ, TEK TANIM.
 *
 * Resmî puan tablosu yalnızca BİTMİŞ maçları sayar ve sağlayıcıdan saatte
 * bir senkronlanır. Maç sürerken tablo kıpırdamıyordu: 85. dakikada
 * atılan gol zirveyi değiştirse bile okuyucu bunu ertesi senkrona kadar
 * göremiyordu.
 *
 * Bu modül, resmî tabloya canlı maçların GEÇİCİ etkisini bindirir. Üç şey
 * kasıtlı olarak burada, tek yerde duruyor:
 *
 *   1. HANGİ MAÇ SAYILIR. Ertelenen, iptal edilen, hükmen sonuçlanan ya da
 *      henüz başlamayan maç tabloya girmez. Skoru okunamayan maç da girmez —
 *      "muhtemelen 0-0" diye bir şey yok.
 *   2. HANGİ TAKIM SATIRINA YAZILIR. Eşleşme sağlayıcı takım kimliğiyle
 *      yapılır; kimlik yoksa logodaki kimlik, o da yoksa normalize edilmiş
 *      ad denenir. Hiçbiri tutmuyorsa maç ATLANIR. Yanlış takıma puan
 *      yazmak, tabloyu hiç oynatmamaktan kötüdür.
 *   3. SIRALAMA NASIL KURULUR. Puan, averaj ve atılan gol hesaplanabilir;
 *      averaj eşitliğinde ligin resmî kuralı (Süper Lig'de ikili averaj,
 *      Premier Lig'de atılan gol sonrası ikili karşılaşma) bu veriyle
 *      yeniden üretilemez. Bu yüzden hesaplanabilir ölçütler eşitken
 *      RESMÎ SIRA korunur: resmî sıra o kuralların sonucunu zaten taşıyor.
 *      Böylece geçici tablo resmî kuralı ezmez, yalnızca canlı maçın
 *      kesin olan etkisini uygular.
 *
 * Modül hem Node'da (testler, sunucu) hem tarayıcıda çalışır; tarayıcıya
 * giden kopya `scripts/build-live-standings-client.mjs` tarafından bu
 * dosyadan üretilir, elle yazılmaz (bkz. scripts/test-live-standings.mjs).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FutbolRadarLiveStandings = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /**
   * Devam eden maç. Tablo bu maçı ASLA içermez — resmî tablo yalnızca
   * bitmiş maçları sayar — bu yüzden geçici etki koşulsuz uygulanır.
   */
  var IN_PLAY = ["1H", "2H", "HT", "ET", "BT", "P", "LIVE", "IN_PLAY", "HALFTIME", "PAUSED", "INT"];

  /** Sonucu kesinleşmiş maç. Resmî tabloya girene kadar geçici sayılır. */
  var FINAL = ["FT", "AET", "PEN", "FINISHED", "AFTER_EXTRA_TIME", "PENALTIES"];

  /**
   * Tabloya hiç girmeyen durumlar. Ertelenen/iptal edilen maç oynanmadı;
   * hükmen sonuç (AWD/WO) ise sahadaki skorla değil masa kararıyla
   * yazılır ve sağlayıcının resmî tablosuna aittir — burada tahmin
   * edilmez.
   */
  var NEVER = ["NS", "TBD", "PST", "CANC", "ABD", "SUSP", "AWD", "WO", "SCHEDULED", "POSTPONED", "CANCELLED"];

  function upper(value) {
    return String(value == null ? "" : value).toUpperCase();
  }

  function statusOf(match) {
    return {
      provider: upper(match && match.providerStatus),
      normalized: upper(match && match.status)
    };
  }

  function listHas(list, value) {
    return value !== "" && list.indexOf(value) !== -1;
  }

  /**
   * Maçın tabloya katkı türü: "in-play", "final" ya da null (sayılmaz).
   *
   * Sağlayıcının kısa kodu (`providerStatus`) ÖNCE okunur: normalize
   * edilmiş `status` alanı "LIVE"ı da "HALFTIME"ı da taşıyor ama ertelemeyi
   * ayırt edecek kadar ince değil.
   */
  function contribution(match) {
    if (!match) return null;
    var status = statusOf(match);

    if (listHas(NEVER, status.provider) || listHas(NEVER, status.normalized)) return null;

    var home = toScore(match && match.score && match.score.home);
    var away = toScore(match && match.score && match.score.away);
    if (home === null || away === null) return null;

    if (listHas(IN_PLAY, status.provider) || listHas(IN_PLAY, status.normalized) || match.live === true) return "in-play";
    if (listHas(FINAL, status.provider) || listHas(FINAL, status.normalized)) return "final";
    return null;
  }

  function toScore(value) {
    if (value === null || value === undefined || value === "") return null;
    var number = Number(value);
    return Number.isFinite(number) && number >= 0 && Number.isInteger(number) ? number : null;
  }

  /** Logo adresindeki sağlayıcı takım kimliği: .../teams/645.png → "645" */
  function idFromLogo(url) {
    var match = /\/teams\/(\d+)\./.exec(String(url || ""));
    return match ? match[1] : null;
  }

  /**
   * Ad karşılaştırması için sadeleştirme. Aksan, noktalama ve "A.Ş." gibi
   * kuyruklar sağlayıcıdan sağlayıcıya değişiyor; harf ve rakam dışı her
   * şey atılır.
   */
  function nameKey(value) {
    var text = String(value == null ? "" : value);
    if (typeof text.normalize === "function") text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return text
      .replace(/[İIı]/g, "i")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  }

  /** Satırları kimliğe, logodaki kimliğe ve ada göre aranabilir hâle getirir. */
  function indexRows(rows) {
    var byId = new Map();
    var byName = new Map();
    var ambiguousNames = new Set();

    (rows || []).forEach(function (row) {
      if (!row) return;
      [row.id, row.providerId, idFromLogo(row.logo)].forEach(function (id) {
        if (id !== null && id !== undefined && id !== "") byId.set(String(id), row);
      });
      [row.name, row.team].forEach(function (name) {
        var key = nameKey(name);
        if (!key) return;
        // AYNI ADI TAŞIYAN İKİ SATIR VARSA AD İLE EŞLEŞME YAPILMAZ.
        if (byName.has(key) && byName.get(key) !== row) ambiguousNames.add(key);
        else byName.set(key, row);
      });
    });

    return { byId: byId, byName: byName, ambiguousNames: ambiguousNames };
  }

  function findRow(index, teamId, logo, name) {
    var id = teamId !== null && teamId !== undefined && teamId !== "" ? String(teamId) : idFromLogo(logo);
    if (id && index.byId.has(id)) return index.byId.get(id);

    var key = nameKey(name);
    if (key && !index.ambiguousNames.has(key) && index.byName.has(key)) return index.byName.get(key);
    return null;
  }

  function number(value) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  /** Satırın hesaplanabilir alanlarını sıfırdan türetir (O, AV, P). */
  function recalculate(row) {
    row.played = number(row.won) + number(row.drawn) + number(row.lost);
    row.goalDifference = number(row.goalsFor) - number(row.goalsAgainst);
    row.points = number(row.won) * 3 + number(row.drawn) - number(row.pointDeduction);
    return row;
  }

  function cloneRow(row) {
    return {
      id: row.id != null ? String(row.id) : null,
      providerId: row.providerId != null ? String(row.providerId) : null,
      rank: row.rank != null ? Number(row.rank) : null,
      officialRank: row.rank != null ? Number(row.rank) : null,
      name: row.name || row.team || "",
      team: row.team || row.name || "",
      logo: row.logo || null,
      played: number(row.played),
      won: number(row.won),
      drawn: number(row.drawn),
      lost: number(row.lost),
      goalsFor: number(row.goalsFor),
      goalsAgainst: number(row.goalsAgainst),
      goalDifference: number(row.goalDifference),
      points: number(row.points),
      pointDeduction: number(row.pointDeduction),
      average: row.average != null ? row.average : null,
      momentum: row.momentum != null ? row.momentum : null,
      live: false,
      liveMatchIds: []
    };
  }

  /** Bir maçın tek bir takım satırına etkisi. */
  function applySide(row, scored, conceded, matchId) {
    row.goalsFor += scored;
    row.goalsAgainst += conceded;
    if (scored > conceded) row.won += 1;
    else if (scored === conceded) row.drawn += 1;
    else row.lost += 1;
    row.live = true;
    if (row.liveMatchIds.indexOf(matchId) === -1) row.liveMatchIds.push(matchId);
    recalculate(row);
  }

  /**
   * Maçın bu tabloya ait olup olmadığı.
   *
   * Lig kimliği verilmişse eşleşme ZORUNLUDUR: kimliği çözülemeyen bir maçı
   * "herhalde bu ligdendir" diye tabloya yazmak, yanlış ligin golünü
   * Süper Lig tablosuna işlemek demektir. `leagueIds` boş bırakılırsa
   * (çağıran zaten filtrelemişse) kontrol atlanır.
   */
  function belongsToLeague(match, leagueIds) {
    if (!leagueIds || !leagueIds.length) return true;
    var candidates = [match && match.competitionId, match && match.providerLeagueId, match && match.league]
      .filter(function (value) { return value !== null && value !== undefined && value !== ""; })
      .map(function (value) { return nameKey(value); });
    return leagueIds.some(function (id) {
      var key = nameKey(id);
      return key !== "" && candidates.indexOf(key) !== -1;
    });
  }

  /**
   * Resmî tabloya canlı maçların geçici etkisini bindirir.
   *
   * @param {Array}  rows      resmî satırlar (değiştirilmez)
   * @param {Array}  matches   canlı skor anlık görüntüleri
   * @param {Object} [options]
   * @param {Array}  [options.leagueIds]      bu tabloya ait lig kimlikleri
   * @param {Array}  [options.settledMatchIds] resmî tabloya girdiği doğrulanan maçlar
   * @returns {{rows: Array, appliedMatchIds: Array, liveTeamIds: Array, skipped: Array}}
   */
  function applyLiveMatches(rows, matches, options) {
    var settings = options || {};
    var settled = new Set((settings.settledMatchIds || []).map(String));
    var next = (rows || []).map(cloneRow);
    var index = indexRows(next);
    var applied = [];
    var skipped = [];
    var seen = new Set();

    (matches || []).forEach(function (match) {
      var id = String((match && (match.id || match.providerId)) || "");
      if (!id) return skipped.push({ id: id, reason: "kimliksiz maç" });

      // AYNI MAÇ İKİ KEZ SAYILMAZ: akış aynı maçı iki kayıtla gönderse de
      // (id + providerId) yalnızca ilki uygulanır.
      if (seen.has(id)) return skipped.push({ id: id, reason: "yinelenen maç" });
      seen.add(id);

      if (settled.has(id)) return skipped.push({ id: id, reason: "resmî tabloya girdi" });

      var kind = contribution(match);
      if (!kind) return skipped.push({ id: id, reason: "sayılmayan durum" });
      if (!belongsToLeague(match, settings.leagueIds)) return skipped.push({ id: id, reason: "başka lig" });

      var home = findRow(index, match.homeTeamId, match.homeTeamLogo, match.homeTeam);
      var away = findRow(index, match.awayTeamId, match.awayTeamLogo, match.awayTeam);
      if (!home || !away || home === away) return skipped.push({ id: id, reason: "takım satırı eşleşmedi" });

      var homeGoals = toScore(match.score && match.score.home);
      var awayGoals = toScore(match.score && match.score.away);

      applySide(home, homeGoals, awayGoals, id);
      applySide(away, awayGoals, homeGoals, id);
      applied.push({ id: id, kind: kind });
    });

    var liveTeamIds = next.filter(function (row) { return row.live; })
      .map(function (row) { return row.id; })
      .filter(Boolean);

    return { rows: rankRows(next), appliedMatchIds: applied, liveTeamIds: liveTeamIds, skipped: skipped };
  }

  /**
   * Sıralama. Hesaplanabilir ölçütler bittiğinde RESMÎ SIRA korunur —
   * ligin ikili averaj/karşılaşma kuralı bu veriyle yeniden üretilemez ve
   * resmî sıra o kuralın sonucunu zaten taşır.
   */
  function rankRows(rows) {
    var ordered = (rows || []).slice().sort(function (left, right) {
      if (right.points !== left.points) return right.points - left.points;
      if (right.goalDifference !== left.goalDifference) return right.goalDifference - left.goalDifference;
      if (right.goalsFor !== left.goalsFor) return right.goalsFor - left.goalsFor;
      var leftRank = left.officialRank == null ? Number.MAX_SAFE_INTEGER : left.officialRank;
      var rightRank = right.officialRank == null ? Number.MAX_SAFE_INTEGER : right.officialRank;
      return leftRank - rightRank;
    });

    ordered.forEach(function (row, position) {
      row.rank = position + 1;
      row.rankChange = row.officialRank == null ? 0 : row.officialRank - row.rank;
    });

    return ordered;
  }

  /**
   * Resmî tablo tazelendiğinde hangi canlı maçın artık gerekmediğini söyler.
   *
   * Maç bittiğinde geçici etkiyi hemen bırakmak tabloyu GERİ alırdı: resmî
   * tablo o maçı ancak bir sonraki senkronda sayıyor, aradaki dakikalarda
   * okuyucu golü görüp sonra kaybederdi. Bu yüzden etki, resmî satırların
   * o maçı gerçekten saydığı DOĞRULANANA kadar sürer: iki takımın da
   * oynadığı maç sayısı, etkinin ilk uygulandığı andaki temel değerin
   * üstüne çıkmışsa maç resmî tabloya girmiştir.
   *
   * @param {Object} baselines  matchId → {home: {id, played}, away: {id, played}}
   * @param {Array}  officialRows resmî (canlı etki uygulanmamış) satırlar
   * @returns {string[]} artık uygulanmaması gereken maç kimlikleri
   */
  function settledMatchIds(baselines, officialRows) {
    var index = indexRows(officialRows || []);
    var settled = [];

    Object.keys(baselines || {}).forEach(function (matchId) {
      var baseline = baselines[matchId];
      if (!baseline || !baseline.home || !baseline.away) return;

      var home = findRow(index, baseline.home.id, baseline.home.logo, baseline.home.name);
      var away = findRow(index, baseline.away.id, baseline.away.logo, baseline.away.name);
      if (!home || !away) return;

      if (number(home.played) > number(baseline.home.played) && number(away.played) > number(baseline.away.played)) {
        settled.push(String(matchId));
      }
    });

    return settled;
  }

  /** Bir maç için `settledMatchIds`in beklediği temel kaydı üretir. */
  function baselineFor(match, rows) {
    var index = indexRows(rows || []);
    var home = findRow(index, match && match.homeTeamId, match && match.homeTeamLogo, match && match.homeTeam);
    var away = findRow(index, match && match.awayTeamId, match && match.awayTeamLogo, match && match.awayTeam);
    if (!home || !away) return null;
    return {
      home: { id: home.id, logo: home.logo, name: home.name, played: number(home.played) },
      away: { id: away.id, logo: away.logo, name: away.name, played: number(away.played) }
    };
  }

  return {
    applyLiveMatches: applyLiveMatches,
    baselineFor: baselineFor,
    contribution: contribution,
    nameKey: nameKey,
    rankRows: rankRows,
    settledMatchIds: settledMatchIds,
    IN_PLAY: IN_PLAY,
    FINAL: FINAL,
    NEVER: NEVER
  };
});
