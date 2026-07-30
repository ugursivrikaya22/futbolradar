/**
 * Sağlayıcıdan gelen maç detayını kürasyonlu kayda uygulamanın saf mantığı.
 *
 * Ayrı bir servis olmasının nedeni test edilebilirlik: birleştirme kuralı
 * yanlış giderse elle doğrulanmış maç verisi bozulur, bu yüzden kural
 * scripts/test-match-report.mjs içinde doğrudan sınanır.
 */

const { API_FOOTBALL, providerIdFor } = require("./providerIdentityService");
const { isFinishedMatch } = require("./matchStatus");

/** Maçın bitmiş sayılması için ilk vuruştan sonra beklenen süre (dk). */
const FULL_TIME_MINUTES = 135;

// Tamamlanma tespiti services/matchStatus.js'de tek yerde: sağlayıcı
// bitmiş maçı "FT", uzatmalıyı "AET", penaltılıyı "PEN" olarak veriyor ve
// yalnızca "FINISHED" arayan eski kontrol bu maçların sonucunu hiç
// çekmiyordu.
function isFinished(match) {
  return isFinishedMatch(match);
}

function isScoreValue(value) {
  // Number(null) === 0 olduğu için Number.isFinite tek başına yetmez:
  // {home: null} boş skoru "dolu" sayılır ve gerçek skor hiç yazılmazdı.
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function hasScore(match) {
  const score = match && match.score;
  return Boolean(score) && isScoreValue(score.home) && isScoreValue(score.away);
}

function isEmptyList(value) {
  return !Array.isArray(value) || value.length === 0;
}

/**
 * Sağlayıcıya sorulacak maçları seçer:
 *   - bitmiş ama istatistik/olay dökümü eksik olanlar,
 *   - başlama saatinin üzerinden tam maç süresi geçtiği hâlde hâlâ
 *     SCHEDULED/LIVE görünenler.
 * providerId olmayan kayıtlar `skipped` işaretiyle döner; eşleşmeyi ada göre
 * tahmin etmek yanlış maçın verisini yazma riski taşır.
 */
function selectSyncTargets(matches, now) {
  const targets = [];
  for (const match of matches || []) {
    const kickoff = new Date(match.kickoff || match.date || 0).getTime();
    const ended = Number.isFinite(kickoff) && kickoff > 0 && now - kickoff >= FULL_TIME_MINUTES * 60 * 1000;
    const missingDetail = isEmptyList(match.statistics) || isEmptyList(match.events);

    let reason = null;
    if (isFinished(match) && missingDetail) reason = "biten maçın istatistik dökümü eksik";
    else if (!isFinished(match) && ended) reason = "maç saati geçti, sonuç bekleniyor";
    if (!reason) continue;

    // Sorgu API-Football'a gidiyor; başka bir sağlayıcının kimliği işe
    // yaramaz, bu yüzden özellikle o isim alanı aranır.
    const fixtureId = providerIdFor(match, API_FOOTBALL);
    targets.push({ match, reason, fixtureId, skipped: fixtureId ? null : "API-Football fixture id yok" });
  }
  return targets;
}

/**
 * Sağlayıcı detayını kayda uygular ve değişiklik yoksa null döner.
 *
 * Kurallar:
 *   - Kürasyonlu listeler (istatistik/olay/kadro) doluysa DOKUNULMAZ.
 *   - Doğrulanmış skor DEĞİŞTİRİLMEZ; yalnızca eksikse yazılır.
 *   - Durum yalnızca ileri taşınır (FINISHED geri alınmaz).
 *   - Editoryal alanlar (analysis, summary, sourceUrls...) hiç okunmaz.
 */
function mergeProviderDetail(match, detail, timestamp) {
  if (!match || !detail) return null;
  const next = { ...match };
  const changes = [];

  if (isEmptyList(match.statistics) && !isEmptyList(detail.statistics)) {
    next.statistics = detail.statistics;
    changes.push(`${detail.statistics.length} istatistik`);
  }
  if (isEmptyList(match.events) && !isEmptyList(detail.events)) {
    next.events = detail.events;
    changes.push(`${detail.events.length} olay`);
  }
  if (isEmptyList(match.lineups) && !isEmptyList(detail.lineups)) {
    next.lineups = detail.lineups;
    changes.push(`${detail.lineups.length} kadro`);
  }

  if (!isFinished(match) && isFinishedMatch(detail)) {
    // Kürasyonlu kayıt tek bir kanonik değer taşır; sağlayıcının FT/AET/PEN
    // ayrımı `providerStatus` alanında korunur, uydurulmaz.
    next.status = "FINISHED";
    next.providerStatus = detail.status || detail.providerStatus || next.providerStatus;
    changes.push("durum: FINISHED");
  }

  if (!hasScore(match) && hasScore(detail)) {
    next.score = { ...(match.score || {}), ...detail.score };
    changes.push(`skor ${detail.score.home}-${detail.score.away}`);
  }

  if (!changes.length) return null;

  next.providerSyncedAt = timestamp;
  next.liveStateSource = detail.source || "provider";
  return { record: next, changes };
}

module.exports = {
  FULL_TIME_MINUTES,
  selectSyncTargets,
  mergeProviderDetail,
  isFinished,
  hasScore,
  isEmptyList
};
