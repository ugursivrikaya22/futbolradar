/**
 * OYUNCU İSTATİSTİK SENKRONU — ölçümü kaydın üstüne yazan tek yer.
 *
 * Denetimin bıraktığı boşluk buydu: kadro senkronu (/players/squads) yalnızca
 * KİMLİK getiriyor — ad, mevki, yaş, forma numarası, fotoğraf. Derecelendirme,
 * dakika, gol, asist GETİRMİYOR. normalizePlayer eksik alanları varsayılanla
 * dolduruyor ve sonuç "estimated" olarak işaretleniyordu. Bu yüzden 479
 * kaydın tamamı kayıt kapısını geçiyor ama tek bir ölçüm taşımıyordu:
 * Oyuncu Radarı'nın çizecek ekseni, ana sayfanın sıralayacak sayısı yoktu.
 *
 * Ölçümü getiren uç nokta ayrı: /players?league=&season=. Sezon istatistiği
 * ve GERÇEK bir maç derecesi (games.rating) döndürür.
 *
 * Bu modül saf: ağ çağrısı yapmaz, dosya yazmaz. Sağlayıcı yükünü alır,
 * yayımlanabilir yamayı üretir. Ağ ve disk scripts/sync-player-statistics.mjs
 * tarafında.
 */

const PROVIDER_SOURCE_NAME = "API-Football";
const PROVIDER_STATS_ENDPOINT = "https://v3.football.api-sports.io/players";

/**
 * Üretim verisi bu oranın altında kapsama ile EZİLMEZ. Yarısı düşmüş bir
 * koşu "güncelleme" değil, kayıptır — kadro senkronuyla aynı doktrin.
 */
const MIN_STATS_COVERAGE_RATIO = 0.5;

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * SIFIR, ÖLÇÜM DEĞİLDİR — sezon başlamadan önce hele hiç.
 *
 * Sağlayıcı bir oyuncuyu lig/sezon kadrosunda görüp appearances: 0
 * döndürebilir; bu "kayıtlı ama henüz oynamadı" demektir. O satırı
 * "doğrulanmış istatistik" diye damgalarsak site baştan sona "Dakika 0,
 * Gol 0, Asist 0" basar ve okuyucu bunu "oynadı, üretemedi" diye okur.
 * Bugün (sezon öncesi) bu, 479 oyuncunun tamamı demek olurdu.
 *
 * Bu yüzden ölçüm kanıtı aranır: en az bir maç oynanmış olmalı. Oynanmışlık
 * sentezlenemeyen tek işaret.
 */
function hasMeasuredPlay(statistics) {
  const games = (statistics && statistics.games) || {};
  const appearances = numberOrNull(games.appearences ?? games.appearances);
  const minutes = numberOrNull(games.minutes);
  return Number(appearances) > 0 || Number(minutes) > 0;
}

/**
 * Sağlayıcının GERÇEKTEN gönderdiği ölçümlerden yama üretir.
 *
 * Kural: gönderilmeyen alan yamaya girmez. Eksik alanı sıfırla doldurmak,
 * ölçüm yokluğunu ölçüme çevirmek olurdu.
 *
 * @returns {object|null} yayımlanabilir yama, ölçüm yoksa null
 */
function buildVerifiedStatsPatch(providerItem, options = {}) {
  const item = providerItem || {};
  const statistics = Array.isArray(item.statistics) && item.statistics[0] ? item.statistics[0] : null;
  if (!statistics) return null;

  const observedAt = options.observedAt || new Date().toISOString();
  const games = statistics.games || {};
  const goals = statistics.goals || {};
  const cards = statistics.cards || {};
  const shots = statistics.shots || {};
  const passes = statistics.passes || {};
  const duels = statistics.duels || {};
  const tackles = statistics.tackles || {};

  const patch = {};
  const measured = hasMeasuredPlay(statistics);

  // 1. SAYAÇLAR — yalnızca gerçekten oynanmışsa.
  if (measured) {
    const counting = {
      appearances: numberOrNull(games.appearences ?? games.appearances),
      minutes: numberOrNull(games.minutes),
      minutesPlayed: numberOrNull(games.minutes),
      goals: numberOrNull(goals.total),
      assists: numberOrNull(goals.assists),
      yellowCards: numberOrNull(cards.yellow),
      redCards: numberOrNull(cards.red),
      shots: numberOrNull(shots.total),
      keyPasses: numberOrNull(passes.key),
      passAccuracy: numberOrNull(passes.accuracy),
      duels: numberOrNull(duels.total),
      duelsWon: numberOrNull(duels.won),
      tacklesPerGame: numberOrNull(tackles.total)
    };

    for (const [key, value] of Object.entries(counting)) {
      if (value !== null) patch[key] = value;
    }

    if (Object.keys(patch).length) {
      // Köken damgası: cardCredibility.statsAreVerified bunu arar.
      patch.statsVerifiedAt = observedAt;
      patch.statsSource = PROVIDER_SOURCE_NAME;
      patch.statsFetchedAt = observedAt;
    }
  }

  // 2. DERECE — sağlayıcı gerçekten bir derece gönderdiyse.
  //
  // Bağımsız koşul: derece maç başına ölçülür ve oynanmışlık şartını zaten
  // içerir, ama sayaçlardan ayrı gelebilir. ratingStatus "provider" tek
  // başına yetmiyor; cardCredibility köken damgası da arıyor (serbest metin
  // bir dizeyle derece kapısı açılmasın diye).
  const rating = numberOrNull(games.rating);
  if (rating !== null) {
    patch.rating = rating;
    patch.overallRating = rating;
    patch.aiRating = rating;
    patch.ratingStatus = "provider";
    patch.ratingVerifiedAt = observedAt;
    patch.ratingSource = PROVIDER_SOURCE_NAME;
  }

  if (!Object.keys(patch).length) return null;

  patch.dataStatus = "provider";
  patch.sourceName = PROVIDER_SOURCE_NAME;
  patch.providerName = PROVIDER_SOURCE_NAME;
  patch.lastVerifiedAt = observedAt;
  patch.sourceNote = `${PROVIDER_SOURCE_NAME} sezon istatistiği uç noktasından ölçüldü.`;

  const providerId = item.player && item.player.id ? String(item.player.id) : null;
  patch.sourceUrl = providerId
    ? `${PROVIDER_STATS_ENDPOINT}?id=${providerId}`
    : PROVIDER_STATS_ENDPOINT;

  return patch;
}

/**
 * ELLE DOĞRULANMIŞ ALAN SAĞLAYICI TARAFINDAN EZİLMEZ.
 *
 * Kadro senkronundaki koruma ile aynı: dataStatus/ratingStatus "manual" veya
 * "verified" ise sağlayıcı farklı bir değer gönderse bile yerel alan
 * korunur; çakışma işaretlenir, sessizce kaybolmaz.
 */
function isProtectedRecord(player) {
  const marks = [player && player.dataStatus, player && player.ratingStatus];
  return marks.some((mark) => /manual|verified/i.test(String(mark || "")));
}

function applyStatsPatch(player, patch) {
  if (!patch) return { player, changed: false, conflict: null };

  if (isProtectedRecord(player)) {
    const conflict = {
      playerId: player.id,
      name: player.name,
      field: "stats",
      resolution: "kept-local-flagged-for-review",
      detectedAt: patch.lastVerifiedAt,
      reason: "manually-verified-record"
    };
    return { player, changed: false, conflict };
  }

  return { player: { ...player, ...patch }, changed: true, conflict: null };
}

/**
 * Koşunun yazmaya değip değmediği. Kadro senkronundaki `evaluateSquadSyncSafety`
 * ile aynı doktrin: boş ya da yarım bir çekim üretim verisini EZMEZ.
 */
function evaluateStatsSyncSafety({ requested, measured, failures }) {
  if (!requested) {
    return { safe: false, reason: "no-players-requested" };
  }
  if (!measured) {
    return { safe: false, reason: "provider-returned-no-measurements" };
  }
  const coverage = measured / requested;
  if (coverage < MIN_STATS_COVERAGE_RATIO) {
    return {
      safe: false,
      reason: `coverage-below-threshold (${Math.round(coverage * 100)}% < ${Math.round(MIN_STATS_COVERAGE_RATIO * 100)}%)`
    };
  }
  if (failures && failures >= requested) {
    return { safe: false, reason: "all-requests-failed" };
  }
  return { safe: true, reason: null, coverage };
}

/** Sağlayıcı yükünü providerId'ye göre indeksler. */
function indexByProviderId(items) {
  const index = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const id = item && item.player && item.player.id;
    if (id === null || id === undefined) continue;
    index.set(String(id), item);
  }
  return index;
}

module.exports = {
  buildVerifiedStatsPatch,
  applyStatsPatch,
  evaluateStatsSyncSafety,
  indexByProviderId,
  hasMeasuredPlay,
  isProtectedRecord,
  MIN_STATS_COVERAGE_RATIO,
  PROVIDER_STATS_ENDPOINT,
  PROVIDER_SOURCE_NAME
};
