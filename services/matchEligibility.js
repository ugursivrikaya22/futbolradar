/**
 * MAÇ YAYIN UYGUNLUĞU — tek yetkili kural.
 *
 * Politika: bir maç onaylı bir kaynaktan eksiksiz ve doğrulanmış biçimde
 * gelmiyorsa sitede HİÇBİR yerde görünmez. Kısmi, tahmini veya doğrulanmamış
 * karşılaşma yayımlanmaz; yer tutucu ya da "belki oynanacak" kaydı olmaz.
 *
 * Bu dosya tek karar noktasıdır. Aynı kuralı arama, canlı skor, takım
 * sayfaları, statik sayfa üreticileri ve site haritası birlikte kullanır;
 * aksi hâlde bir yerde elenen maç başka bir yerde sızar.
 *
 * Elenen her maç sessizce yok sayılmaz: gerekçesiyle birlikte döndürülür ve
 * çağıran taraf bunu iç günlüğe yazar.
 */

// Onaylı kaynaklar. Buraya girmeyen hiçbir kayıt yayımlanmaz — "mock" dahil.
const APPROVED_SOURCES = new Set([
  "manual_verified",
  "official_club",
  "api-football",
  "football-data",
  "thesportsdb"
]);

// Her maçta bulunması gereken alanlar.
const REQUIRED_FIELDS = ["homeTeam", "awayTeam", "kickoff", "league", "status"];

const FINISHED_STATUSES = new Set(["FINISHED", "FT", "AET", "PEN"]);
const LIVE_STATUSES = new Set(["LIVE", "IN_PLAY", "PAUSED", "HALFTIME", "1H", "HT", "2H", "ET", "BT", "P"]);

/**
 * Hazırlık ve alt seviye karşılaşmalar. Bu maçlar için sağlayıcının ham
 * kaydı yetmez: yayımlanmaları doğrulanmış (verified) veri gerektirir.
 * Sebep, bu kategoride sağlayıcı verisinin sık sık eksik, geç ve çelişkili
 * gelmesi — takvim kaydı maç bittikten saatler sonra hâlâ "SCHEDULED"
 * gösterebiliyor.
 */
function isFriendlyOrLowerTier(match) {
  const competition = String(match.competitionId || "").toLowerCase();
  const league = String(match.league || "").toLocaleLowerCase("tr-TR");
  return competition.includes("hazirlik") ||
    league.includes("hazırlık") ||
    league.includes("hazirlik") ||
    league.includes("friendly");
}

function isFinished(match) {
  return FINISHED_STATUSES.has(String(match.status || "").toUpperCase());
}

function isLive(match) {
  return LIVE_STATUSES.has(String(match.status || "").toUpperCase());
}

function hasNumericScore(match) {
  const score = match.score || {};
  return Number.isFinite(Number(score.home)) && score.home !== null && score.home !== "" &&
    Number.isFinite(Number(score.away)) && score.away !== null && score.away !== "";
}

/**
 * Bir maçın yayımlanıp yayımlanamayacağına karar verir.
 * @returns {{eligible: boolean, reason: string}}
 */
function evaluateMatch(match, options = {}) {
  if (!match || typeof match !== "object") {
    return { eligible: false, reason: "kayıt yok" };
  }

  const missing = REQUIRED_FIELDS.filter((field) => {
    const value = match[field];
    return value === null || value === undefined || String(value).trim() === "";
  });

  if (missing.length) {
    return { eligible: false, reason: `zorunlu alan eksik: ${missing.join(", ")}` };
  }

  const source = String(match.source || "").toLowerCase();
  if (!APPROVED_SOURCES.has(source)) {
    return { eligible: false, reason: `kaynak onaylı değil: ${source || "belirtilmemiş"}` };
  }

  // Biten maçın skoru olmak zorunda: skorsuz "bitti" kaydı okuyucuya sonucu
  // bilinmeyen bir maçı bitmiş gibi gösterir.
  if (isFinished(match) && !hasNumericScore(match)) {
    return { eligible: false, reason: "biten maçta skor yok" };
  }

  const verified = String(match.dataStatus || "").toLowerCase() === "verified";

  if (isFriendlyOrLowerTier(match) && !verified) {
    return { eligible: false, reason: "hazırlık/alt seviye maç doğrulanmamış" };
  }

  // Zaman tutarlılığı: başlama saati geçmiş ama kayıt hâlâ "başlayacak"
  // diyorsa, elimizdeki veri maçın gerçek durumunu bilmiyordur. Böyle bir
  // kayıt canlı skor tablosunda "yakında" olarak durur ve okuyucuyu yanıltır.
  const now = options.now instanceof Date ? options.now : new Date();
  const kickoff = new Date(match.kickoff);
  if (!Number.isNaN(kickoff.getTime())) {
    const hoursSinceKickoff = (now.getTime() - kickoff.getTime()) / 3600000;
    const stillPending = !isFinished(match) && !isLive(match);
    if (stillPending && hoursSinceKickoff > 3.5) {
      return { eligible: false, reason: "başlama saati geçmiş ama durum güncellenmemiş" };
    }
  }

  return { eligible: true, reason: "" };
}

function isPublishable(match, options) {
  return evaluateMatch(match, options).eligible;
}

/**
 * Listeyi süzer ve elenenleri gerekçesiyle döndürür. Çağıran taraf
 * `excluded` listesini iç günlüğe yazar — eleme sessiz olmamalı.
 */
function filterPublishable(matches, options = {}) {
  const eligible = [];
  const excluded = [];

  for (const match of Array.isArray(matches) ? matches : []) {
    const verdict = evaluateMatch(match, options);
    if (verdict.eligible) {
      eligible.push(match);
    } else {
      excluded.push({ id: (match && match.id) || "?", reason: verdict.reason });
    }
  }

  return { eligible, excluded };
}

/** İç günlük: elenen maçlar tek satırda, sayfa üreticileri ve CI için. */
function logExcluded(scope, excluded) {
  if (!excluded || !excluded.length) {
    return;
  }
  for (const item of excluded) {
    console.warn(`[futbolradar:match-excluded] scope=${scope} id=${item.id} reason="${item.reason}"`);
  }
}

module.exports = {
  APPROVED_SOURCES,
  REQUIRED_FIELDS,
  evaluateMatch,
  isPublishable,
  filterPublishable,
  logExcluded,
  isFriendlyOrLowerTier
};
