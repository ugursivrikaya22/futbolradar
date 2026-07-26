/**
 * GÖRÜNÜR KART GÜVENİLİRLİĞİ — tek yetkili kural.
 *
 * Ana sayfa "canlı" görünüyordu ama bunun bir kısmı doğrulanmamış kartlarla
 * sağlanıyordu. Denetimin bulduğu tablo:
 *
 *   • Puan, piyasa değeri ve dakika taşıyan SEKİZ oyuncunun SEKİZİ de
 *     "mock-..." sağlayıcı kimliğine sahip. Örtüşme tam.
 *   • Bunların dördü artık Süper Lig'de değil (serbest oyuncu, Schalke 04,
 *     Rennes, Spartak Moskova) ama trend bölümünde gösteriliyordu.
 *   • İkisi zaten dataStatus "mock_needs_verification" işaretli.
 *
 * Bu yüzden kural basit ve tavizsiz: bir kart, dayandığı kaydın kimliği ve
 * kaynağı gösterilebiliyorsa yayımlanır. Gösterilemiyorsa sayfa boş kalır.
 * Sayfayı doldurmak, okuyucuya doğrulanmamış bir sayı göstermenin gerekçesi
 * değildir.
 *
 * Ölçü uydurulmaz: eksik olan alan tahmin edilmez, kart hiç çizilmez.
 */

/** Yer tutucu kimlik kalıbı. Gerçek sağlayıcı kimliği yalnızca rakamdır. */
const MOCK_ID_PATTERN = /^mock[-_]/i;
const REAL_PROVIDER_ID = /^\d+$/;

/** Trend bölümünde gösterilemeyecek dataStatus değerleri. */
const REJECTED_DATA_STATUS = new Set(["mock_needs_verification"]);

/** Güvenilmez sayılan derecelendirme durumu. */
const REJECTED_RATING_STATUS = new Set(["stale"]);

/**
 * Doğrulama ne kadar eski olabilir? Trend bölümleri güncel sezonu iddia
 * eder; aylar önce doğrulanmış bir kayıt "şu an trend" demek için yeterli
 * değildir.
 */
const MAX_VERIFICATION_AGE_DAYS = 45;

function providerIdOf(record) {
  return String((record && (record.providerId || record.provider_id)) || "").trim();
}

function hasRealProviderId(record) {
  const id = providerIdOf(record);
  if (!id || MOCK_ID_PATTERN.test(id)) return false;
  return REAL_PROVIDER_ID.test(id);
}

function verificationAgeDays(record, now) {
  const stamp = Date.parse((record && (record.lastVerifiedAt || record.lastSyncedAt)) || "");
  if (Number.isNaN(stamp)) return null;
  return (now.getTime() - stamp) / 86400000;
}

/**
 * Bir oyuncu kartının yayımlanabilirliği.
 *
 * @returns {{publishable: boolean, reasons: string[], confidence: string}}
 */
function evaluatePlayerCard(player, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const reasons = [];

  if (!player || typeof player !== "object") {
    return { publishable: false, reasons: ["kayıt yok"], confidence: "none" };
  }

  if (!String(player.name || "").trim()) reasons.push("isim yok");

  // 1. Sağlayıcı kimliği: kaydın hangi gerçek oyuncuya karşılık geldiğini
  //    gösteremiyorsak, üstündeki hiçbir sayı doğrulanabilir değildir.
  if (!hasRealProviderId(player)) {
    reasons.push(MOCK_ID_PATTERN.test(providerIdOf(player))
      ? "sağlayıcı kimliği yer tutucu (mock)"
      : "gerçek sağlayıcı kimliği yok");
  }

  // 2. Kaynak: hangi kayıttan geldiği gösterilemeyen bir kart yayımlanmaz.
  if (!String(player.sourceUrl || "").trim()) reasons.push("kaynak bağlantısı yok");
  if (!String(player.lastVerifiedAt || player.lastSyncedAt || "").trim()) reasons.push("doğrulama zamanı yok");

  // 3. Açıkça doğrulanmamış işaretlenmiş kayıtlar.
  if (REJECTED_DATA_STATUS.has(String(player.dataStatus || "").toLowerCase())) {
    reasons.push(`dataStatus "${player.dataStatus}"`);
  }

  // 4. Bayat derecelendirme: gösterilen puan güncelliğini yitirmiş.
  if (REJECTED_RATING_STATUS.has(String(player.ratingStatus || "").toLowerCase())) {
    reasons.push(`ratingStatus "${player.ratingStatus}"`);
  }

  // 5. Tazelik.
  const age = verificationAgeDays(player, now);
  if (age !== null && age > MAX_VERIFICATION_AGE_DAYS) {
    reasons.push(`son doğrulama ${Math.round(age)} gün önce`);
  }

  const confidence = reasons.length === 0 ? "high" : "none";
  return { publishable: reasons.length === 0, reasons, confidence };
}

/**
 * Trend bölümü ek olarak GÜNCEL KULÜP şartı arar: ligde oynamayan bir
 * oyuncuyu "trend" diye göstermek, kartın en yanıltıcı hâli. Serbest
 * oyuncu ve yurt dışına giden oyuncular bu yüzden eleniyordu.
 */
function evaluateTrendPlayerCard(player, options = {}) {
  const base = evaluatePlayerCard(player, options);
  const reasons = base.reasons.slice();

  const team = String((player && (player.currentTeam || player.team)) || "").trim();
  const leagueTeams = Array.isArray(options.leagueTeams) ? options.leagueTeams : null;

  if (!team) {
    reasons.push("güncel kulüp yok");
  } else if (/serbest|free agent|kulüpsüz/i.test(team)) {
    reasons.push("oyuncu serbest — trend bölümüne girmemeli");
  } else if (leagueTeams && leagueTeams.length) {
    const normalized = team.toLocaleLowerCase("tr-TR");
    const inLeague = leagueTeams.some((name) => {
      const candidate = String(name || "").toLocaleLowerCase("tr-TR");
      return candidate && (candidate === normalized || candidate.includes(normalized) || normalized.includes(candidate));
    });
    if (!inLeague) reasons.push(`kulüp lig dışında: ${team}`);
  }

  return { publishable: reasons.length === 0, reasons, confidence: reasons.length ? "none" : "high" };
}

/**
 * Kartın arkasındaki iç kaynak künyesi. Sayfaya basılmaz; denetim, günlük
 * ve yapılandırılmış veri için taşınır.
 */
function sourceMetadata(record) {
  return {
    source_name: (record && (record.providerName || record.sourceName)) || null,
    source_url: (record && record.sourceUrl) || null,
    last_verified_at: (record && (record.lastVerifiedAt || record.lastSyncedAt)) || null,
    provider_id: providerIdOf(record) || null,
    data_confidence: evaluatePlayerCard(record).confidence
  };
}

/**
 * BAĞIMSIZ OLARAK GÜVENLİ ALANLAR.
 *
 * Bunlar oyuncunun kulübünden, formundan ve sezonundan bağımsız, zamanla
 * değişmeyen kimlik bilgileri. Doğrulama gelmese de yayımlanabilirler:
 * yanlış olma riski yok, tartışmalı bir iddia taşımıyorlar.
 *
 * Listede OLMAYAN her şey kısıtlıdır — özellikle güncel kulüp, çünkü
 * denetimde en yanıltıcı alan oydu (serbest oyuncu ve Schalke 04 oyuncusu
 * Süper Lig trendinde duruyordu).
 */
const SAFE_FIELDS = ["id", "slug", "name", "fullName", "position", "secondaryPosition",
  "nationality", "birthDate", "computedAge", "age", "heightCm", "height", "preferredFoot"];

/** Doğrulama olmadan asla yayımlanmayacak alanlar. */
const RESTRICTED_FIELDS = [
  "aiRating", "rating", "overallRating", "potentialRating", "formRating",
  "marketValue", "marketValueEur",
  "minutes", "minutesPlayed", "appearances", "goals", "assists",
  "currentTeam", "team", "currentTeamId", "squadStatus", "number",
  "threatScore", "creativityScore", "pressingScore", "continuityScore", "tempoScore",
  "form", "formChange", "trend", "trendDirection", "impact",
  "providerId", "photo"
];

/**
 * TEK YETKİLİ, SERİLEŞTİRİLEBİLİR KARAR.
 *
 * Hem statik ön render hem tarayıcı bu nesneyi kullanır. Karar bir kez
 * verilir ve çıktıya gömülür; istemci kendi kuralını yeniden hesaplamaz,
 * dolayısıyla ön renderde kaldırılan bir alanı geri boyayamaz.
 *
 * @returns {{verified: boolean, reasons: string[], fields: object,
 *   restricted: string[], meta: object}}
 */
function publicPlayerView(player, options = {}) {
  const verdict = options.trend
    ? evaluateTrendPlayerCard(player, options)
    : evaluatePlayerCard(player, options);

  const fields = {};
  for (const key of SAFE_FIELDS) {
    const value = player && player[key];
    if (value !== null && value !== undefined && String(value).trim() !== "") {
      fields[key] = value;
    }
  }

  if (verdict.publishable) {
    // Doğrulanmış kayıtta kısıtlı alanlar da yayımlanabilir.
    for (const key of RESTRICTED_FIELDS) {
      const value = player && player[key];
      if (value !== null && value !== undefined && String(value).trim() !== "") {
        fields[key] = value;
      }
    }
  }

  return {
    verified: verdict.publishable,
    reasons: verdict.reasons,
    fields,
    // Hangi alanların KASITLI olarak gizlendiği taşınır: sıfır ya da tire
    // basıp gerçek bir ölçüm sanılmasındansa, alanın yokluğu açıkça bildirilir.
    restricted: verdict.publishable
      ? []
      : RESTRICTED_FIELDS.filter((key) => player && player[key] !== null && player[key] !== undefined && String(player[key]).trim() !== ""),
    meta: sourceMetadata(player)
  };
}

/** Listeyi süzer; elenenleri gerekçesiyle döndürür. */
function filterPlayerCards(players, options = {}) {
  const evaluate = options.trend ? evaluateTrendPlayerCard : evaluatePlayerCard;
  const kept = [];
  const removed = [];

  for (const player of Array.isArray(players) ? players : []) {
    const verdict = evaluate(player, options);
    if (verdict.publishable) kept.push(player);
    else removed.push({ id: (player && (player.id || player.name)) || "?", reasons: verdict.reasons });
  }

  return { kept, removed };
}

/** İç günlük: yayımlanmayan kartlar sessizce kaybolmaz. */
function logRemovedCards(scope, removed) {
  for (const item of removed || []) {
    console.warn(`[futbolradar:card-hidden] scope=${scope} id=${item.id} reasons="${item.reasons.join("; ")}"`);
  }
}

module.exports = {
  MAX_VERIFICATION_AGE_DAYS,
  hasRealProviderId,
  evaluatePlayerCard,
  evaluateTrendPlayerCard,
  publicPlayerView,
  SAFE_FIELDS,
  RESTRICTED_FIELDS,
  filterPlayerCards,
  sourceMetadata,
  logRemovedCards
};
