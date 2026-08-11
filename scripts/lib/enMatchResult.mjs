/**
 * MAÇ SONU SONUCU — FİKSTÜR SAYFASINA DOĞRULANMIŞ SKORU BAĞLAMA.
 *
 * İngilizce maç sayfaları (/en/match/<slug>.html) 34 haftalık onaylı
 * fikstürden üretiliyor; maç OYNANDIKTAN sonra da "Preview" başlığında
 * kalıyorlardı. "Galatasaray vs X result" araması bu sayfaların asıl
 * trafiği — maç bitince sayfa sonuca dönmek zorunda.
 *
 * Sonucun kaynağı data/fixture-calendar.json: saatlik CI koşusu sağlayıcı
 * sonuçlarını oraya yazıyor, ayrıca bir istek gerekmiyor. Sayfa üretimi
 * zaten her koşuda yeniden çalıştığı için "güncelleme adımı" kendiliğinden
 * işliyor: maç bittikten sonraki ilk derlemede başlık, açıklama ve gövde
 * sonuç hâline döner.
 *
 * EŞLEŞTİRME YANLIŞ SKOR BASMAKTAN DAHA ÖNEMLİ. Bu yüzden dört kapı var:
 *
 *   1. YALNIZCA Süper Lig sonuçları aday olur. Takvimde hazırlık maçları da
 *      var (ör. Göztepe 2-1 Trabzonspor hazırlık maçı) — lig süzgeci
 *      olmadan bir hazırlık skoru lig fikstürünün sonucu gibi basılırdı.
 *   2. Ev/deplasman SIRASI korunarak eşleştirilir. Çift devreli ligde her
 *      (ev, deplasman) çifti sezonda BİR kez oynanır; sıra ters olan kayıt
 *      rövanşın sonucudur, bu fikstürün değil.
 *   3. Skor iki tarafta da sayısal olmalı; yarım kayıt sonuç sayılmaz.
 *   4. Fikstürün gün/saati doğrulanmışsa sonuç AYNI TSİ gününde olmalı;
 *      tarihi atanmamış fikstürde sezon başlangıcından önceki kayıt elenir.
 *
 * Metinler İngilizce ŞABLONDAN üretilir (skor, takım adları, tarih);
 * Türkçe editoryal cümle çevrilmez, skor uydurulmaz.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { canonicalStatus, istanbulDay } = require("../../services/matchStatus.js");
const { sameClub } = require("../../services/superLigTeams.js");
const { formatDate, t } = require("../../services/i18n.js");

function isSuperLigLeague(name) {
  const value = String(name || "").toLowerCase();
  return value.includes("süper lig") || value.includes("super lig");
}

/**
 * `Number(null)` sıfırdır — saf `Number.isFinite(Number(x))` denetimi yarım
 * kaydı (home: 2, away: null) "2-0" diye UYDURULMUŞ bir skora çevirirdi.
 * Test bunu yakaladı; alanın varlığı ayrıca denetleniyor.
 */
function scoreValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function hasFullScore(match) {
  const score = match && match.score;
  return Boolean(score) && scoreValue(score.home) !== null && scoreValue(score.away) !== null;
}

/** FT / AET / PEN → i18n finish anahtarı. Tanınmayan kod "regular" sayılmaz, null döner. */
export function finishKeyOf(providerStatus) {
  const token = String(providerStatus || "").trim().toUpperCase();
  if (token === "FT") return "regular";
  if (token === "AET") return "extra-time";
  if (token === "PEN") return "penalties";
  return null;
}

/**
 * Fikstür satırına karşılık gelen doğrulanmış nihai sonucu bulur.
 *
 * @param {object} fixtureMatch super-lig-fixtures satırı (homeTeam, awayTeam, kickoff?)
 * @param {Array}  calendarMatches data/fixture-calendar.json `matches`
 * @param {object} options { seasonStart } — "YYYY-MM-DD"; tarihi atanmamış
 *                 fikstürlerde sezon öncesi kayıtları eler.
 * @returns {null | {home:number, away:number, halftimeHome:number|null,
 *                   halftimeAway:number|null, kickoff:string,
 *                   providerStatus:string, finishKey:string|null}}
 */
export function findFinalResult(fixtureMatch, calendarMatches, options = {}) {
  const seasonStart = String(options.seasonStart || "").slice(0, 10);
  const fixtureDay = fixtureMatch.kickoff ? istanbulDay(fixtureMatch.kickoff) : null;

  const candidates = (Array.isArray(calendarMatches) ? calendarMatches : [])
    .filter((row) => isSuperLigLeague(row.league))
    .filter((row) => canonicalStatus(row.status) === "FINISHED")
    .filter(hasFullScore)
    .filter((row) => sameClub(row.homeTeam, fixtureMatch.homeTeam) && sameClub(row.awayTeam, fixtureMatch.awayTeam))
    .filter((row) => {
      const day = istanbulDay(row.kickoff);
      if (fixtureDay) return day === fixtureDay;
      if (seasonStart) return day >= seasonStart;
      return true;
    });

  if (!candidates.length) return null;
  // Aynı gün iki kayıt olamaz; yine de en yeni doğrulanan kazanır.
  const row = candidates.sort((left, right) =>
    String(right.fetchedAt || right.kickoff || "").localeCompare(String(left.fetchedAt || left.kickoff || "")))[0];

  return {
    home: scoreValue(row.score.home),
    away: scoreValue(row.score.away),
    halftimeHome: scoreValue(row.score.halftimeHome),
    halftimeAway: scoreValue(row.score.halftimeAway),
    kickoff: row.kickoff || fixtureMatch.kickoff || null,
    providerStatus: String(row.providerStatus || "").toUpperCase(),
    finishKey: finishKeyOf(row.providerStatus)
  };
}

/** "Galatasaray 2-1 Çorum FK – Result & Match Analysis | FutbolRadar" */
export function resultTitle(fixtureMatch, result) {
  return `${fixtureMatch.homeTeam} ${result.home}-${result.away} ${fixtureMatch.awayTeam} – Result & Match Analysis | FutbolRadar`;
}

/**
 * Sonuç açıklaması — skor ve tarihten üretilen doğal İngilizce; kazanan
 * cümlesi aritmetikten çıkar, hiçbir alan uydurulmaz.
 */
export function resultDescription(fixtureMatch, result, locale = "en") {
  const day = result.kickoff ? formatDate(result.kickoff, locale) : "";
  const outcome = result.home === result.away
    ? `${fixtureMatch.homeTeam} and ${fixtureMatch.awayTeam} drew ${result.home}-${result.away}`
    : result.home > result.away
      ? `${fixtureMatch.homeTeam} beat ${fixtureMatch.awayTeam} ${result.home}-${result.away}`
      : `${fixtureMatch.awayTeam} won ${result.away}-${result.home} away at ${fixtureMatch.homeTeam}`;
  const finish = result.finishKey && result.finishKey !== "regular"
    ? ` (${t(`finish.${result.finishKey}`, locale).toLowerCase()})`
    : "";
  const halftime = result.halftimeHome !== null && result.halftimeAway !== null
    ? ` Half-time: ${result.halftimeHome}-${result.halftimeAway}.`
    : "";
  return `${outcome}${finish}${day ? ` in the Trendyol Süper Lig on ${day}` : " in the Trendyol Süper Lig"}.${halftime} Full result and match data on FutbolRadar.`;
}
