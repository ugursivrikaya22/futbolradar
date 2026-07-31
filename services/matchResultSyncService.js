/**
 * Sağlayıcıdan gelen maç detayını kürasyonlu kayda uygulamanın saf mantığı.
 *
 * Ayrı bir servis olmasının nedeni test edilebilirlik: birleştirme kuralı
 * yanlış giderse elle doğrulanmış maç verisi bozulur, bu yüzden kural
 * scripts/test-match-report.mjs içinde doğrudan sınanır.
 */

const { API_FOOTBALL, providerIdFor } = require("./providerIdentityService");
const { isFinishedMatch, matchState } = require("./matchStatus");
const { dataCompleteness, planRefresh } = require("./refreshPolicy");

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
 * TEKİLLEŞTİRME — sağlayıcı fikstür kimliği yetkilidir.
 *
 * Aynı karşılaşma iki kaynaktan (kürasyonlu kayıt + sağlayıcı takvimi)
 * farklı yerel id ile gelebiliyor. Sağlayıcı fikstür kimliği varsa tekil
 * anahtar odur; yoksa takım çifti + gün kullanılır. Bu olmadan aynı maç
 * iki kez senkronlanır ve iki kez analiz üretilirdi.
 */
function fixtureKey(match) {
  const providerId = providerIdFor(match, API_FOOTBALL);
  if (providerId) return `provider:${providerId}`;

  const pair = [
    String((match && match.homeTeam) || "").trim().toLocaleLowerCase("tr-TR"),
    String((match && match.awayTeam) || "").trim().toLocaleLowerCase("tr-TR")
  ].sort();
  const day = String((match && (match.kickoff || match.date)) || "").slice(0, 10);

  // Takım adları yoksa çift anahtarı dejenere olur ("||2026-07-24") ve aynı
  // günün TÜM adsız kayıtları tek maça iner. Böyle bir kayıt kendi id'siyle
  // tekilleşir: yanlış birleştirmektense ayrı tutmak güvenli.
  if (!pair[0] && !pair[1]) {
    return `id:${String((match && match.id) || "")}`;
  }

  return `pair:${pair[0]}|${pair[1]}|${day}`;
}

/**
 * Aynı fikstürün birden fazla kaydını teke indirir. Sağlayıcı kimliği olan
 * kayıt tercih edilir; eşitlikte daha çok doğrulanmış veri taşıyan kalır.
 */
function dedupeFixtures(matches) {
  const bestByKey = new Map();
  const duplicates = [];

  for (const match of matches || []) {
    const key = fixtureKey(match);
    const existing = bestByKey.get(key);

    if (!existing) {
      bestByKey.set(key, match);
      continue;
    }

    const score = (record) => (providerIdFor(record, API_FOOTBALL) ? 4 : 0) +
      (isEmptyList(record.statistics) ? 0 : 2) +
      (isEmptyList(record.events) ? 0 : 1);

    if (score(match) > score(existing)) {
      bestByKey.set(key, match);
      duplicates.push({ key, dropped: existing.id, kept: match.id });
    } else {
      duplicates.push({ key, dropped: match.id, kept: existing.id });
    }
  }

  return { records: [...bestByKey.values()], duplicates };
}

/**
 * Sağlayıcıya sorulacak maçları seçer.
 *
 * Seçim artık services/refreshPolicy.js kademelerine dayanıyor: canlı maç
 * dakikada bir, devre arası iki dakikada bir, yeni biten maç üç dakikada
 * bir, verisi tamamlanmış eski maç ise HİÇ sorulmuyor. Eskiden her koşuda
 * "bitmiş ama eksik" olan her maç yeniden soruluyordu ve sağlayıcının
 * hiçbir zaman vermeyeceği maçlar kotayı sonsuza kadar tüketiyordu.
 *
 * providerId olmayan kayıtlar `skipped` işaretiyle döner; eşleşmeyi ada
 * göre tahmin etmek yanlış maçın verisini yazma riski taşır.
 */
function selectSyncTargets(matches, now, options) {
  const settings = options || {};
  const nowMs = Number.isFinite(now) ? now : Date.now();
  const { records, duplicates } = dedupeFixtures(matches);
  const plan = planRefresh(records, { nowMs, limit: settings.limit || 12 });

  const targets = plan.due.map((entry) => {
    const match = entry.match;
    const kickoff = new Date(match.kickoff || match.date || 0).getTime();
    const ended = Number.isFinite(kickoff) && kickoff > 0 && nowMs - kickoff >= FULL_TIME_MINUTES * 60 * 1000;
    const missingDetail = isEmptyList(match.statistics) || isEmptyList(match.events);

    let reason = `kademe: ${entry.tier}`;
    if (isFinished(match) && missingDetail) reason = `biten maçın istatistik dökümü eksik (${entry.tier})`;
    else if (!isFinished(match) && ended) reason = `maç saati geçti, sonuç bekleniyor (${entry.tier})`;

    const fixtureId = providerIdFor(match, API_FOOTBALL);
    return {
      match,
      reason,
      tier: entry.tier,
      fixtureId,
      skipped: fixtureId ? null : "API-Football fixture id yok"
    };
  });

  targets.duplicates = duplicates;
  targets.deferred = plan.deferred.length;
  targets.tierCounts = plan.counts;
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
  // Oyuncu istatistiği: sağlayıcı uç noktası vardı ama detay çağrısı onu
  // hiç istemiyordu; `players` her maçta boş kalıyordu.
  if (isEmptyList(match.players) && !isEmptyList(detail.players)) {
    next.players = detail.players;
    changes.push(`${detail.players.length} oyuncu istatistiği`);
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

  // Sağlayıcı oynanmayacak durumu bildirdiyse (PST/CANC/ABD/SUSP) bu bilgi
  // taşınır. Eskiden yalnızca FINISHED'e geçiş yazılıyordu; ertelenen bir
  // maç kayıtta "SCHEDULED" kalıyor ve saati geçtiği için arayüzde
  // oynanıyormuş gibi görünüyordu.
  const detailState = matchState(detail);
  if (["POSTPONED", "CANCELLED", "ABANDONED", "AWARDED"].includes(detailState) && matchState(match) !== detailState) {
    next.status = detailState;
    next.providerStatus = detail.status || detail.providerStatus || next.providerStatus;
    changes.push(`durum: ${detailState}`);
  }

  // TAZELİK ÜST VERİSİ. Bu alanlar olmadan "bu kayıt ne zaman doğrulandı"
  // sorusunun cevabı yoktu: bayat bir kayıt ile yeni senkronlanmış bir
  // kayıt ayırt edilemiyordu.
  const providerUpdatedAt = detail.providerUpdatedAt || detail.updatedAt || null;

  // Tazelik üst verisi HER başarılı senkronda yazılır — içerik değişmese
  // bile. `dataCompleteness` türetilmiş bir ölçü, doğrulanmış bir alan
  // değil; tek başına "içerik değişti" saymaz.
  next.lastSuccessfulSyncAt = timestamp;
  next.dataCompleteness = dataCompleteness(next);
  if (providerUpdatedAt) next.providerUpdatedAt = providerUpdatedAt;

  if (!changes.length) {
    // Yeni veri yok. Yine de BAŞARILI bir senkron gerçekleşti: zaman damgası
    // güncellenir ki tazeleme politikası aynı maçı hemen tekrar sormasın.
    // Doğrulanmış hiçbir alan değişmez.
    return { record: next, changes: [], touchedOnly: true };
  }

  next.providerSyncedAt = timestamp;
  next.liveStateSource = detail.source || "provider";
  return { record: next, changes };
}

module.exports = {
  dedupeFixtures,
  fixtureKey,
  FULL_TIME_MINUTES,
  selectSyncTargets,
  mergeProviderDetail,
  isFinished,
  hasScore,
  isEmptyList
};
