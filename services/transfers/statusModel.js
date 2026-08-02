/**
 * TRANSFER DURUM MODELİ — tek yetkili sözlük.
 *
 * Bu dosyanın tek bir işi var: bir transfer hareketinin ne kadar kesin
 * olduğunu SÖYLEMEK ve o kesinliğin nereden gelebileceğini KISITLAMAK.
 *
 * EN ÖNEMLİ KURAL: BASIN HABERİ RESMÎ TRANSFER DEĞİLDİR.
 *
 * Kural iyi niyete bırakılmıyor, yapıya gömülüyor: `official` durumu yalnızca
 * resmî katmandan (kulübün kendi açıklaması, KAP bildirimi, federasyon,
 * oyuncu/menajerlik duyurusu) gelen bir kaynakla verilebilir. En güvenilir
 * spor medyası bile tek başına `official` üretemez — `statusCeiling()` bunu
 * kaynağın katmanına bakarak uygular ve `resolveStatus()` tavanı aşan her
 * talebi sessizce değil, GEREKÇESİYLE aşağı çeker.
 *
 * Durumlar bir yaşam döngüsüdür ve döngü İLERİ akar:
 *
 *   rumor → negotiation → advanced_talks → agreement_reached → official
 *
 * `denied` ve `cancelled` bu hattın dışındadır: her aşamadan oraya düşülebilir
 * ve oradan geri dönmek YENİ kanıt ister (bkz. canTransition).
 */

/**
 * Durumlar. `rank` yaşam döngüsündeki ilerlemedir; yükseltme kararı bununla
 * verilir. `terminal` olanlar akışın dışına düşer.
 *
 * `requiresOfficialSource`: bu duruma çıkabilmek için resmî katmandan kaynak
 * ŞART. Sadece `official` böyle — "anlaşmaya varıldı" haberi güvenilir bir
 * gazeteciden gelebilir, ama "resmen açıklandı" ancak açıklayandan gelir.
 */
const STATUSES = Object.freeze({
  rumor: {
    rank: 1,
    label: "Söylenti",
    badge: "SÖYLENTİ",
    requiresOfficialSource: false,
    terminal: false,
    headlineVerb: "iddiası gündemde"
  },
  negotiation: {
    rank: 2,
    label: "Görüşme",
    badge: "GÖRÜŞME",
    requiresOfficialSource: false,
    terminal: false,
    headlineVerb: "için görüşmelere başladı"
  },
  advanced_talks: {
    rank: 3,
    label: "İleri görüşme",
    badge: "İLERİ GÖRÜŞME",
    requiresOfficialSource: false,
    terminal: false,
    headlineVerb: "transferinde sona yaklaştı"
  },
  agreement_reached: {
    rank: 4,
    label: "Anlaşma sağlandı",
    badge: "ANLAŞMA",
    requiresOfficialSource: false,
    terminal: false,
    headlineVerb: "ile anlaşmaya vardı"
  },
  official: {
    rank: 5,
    label: "Resmî",
    badge: "RESMİ",
    requiresOfficialSource: true,
    terminal: false,
    headlineVerb: "transferini resmen açıkladı"
  },
  denied: {
    rank: 0,
    label: "Yalanlandı",
    badge: "YALANLANDI",
    requiresOfficialSource: false,
    terminal: true,
    headlineVerb: "iddiasını yalanladı"
  },
  cancelled: {
    rank: 0,
    label: "İptal",
    badge: "İPTAL",
    requiresOfficialSource: false,
    terminal: true,
    headlineVerb: "transferi iptal oldu"
  }
});

const STATUS_KEYS = Object.freeze(Object.keys(STATUSES));

/**
 * Kaynak katmanları. Kullanıcı önceliğiyle birebir aynı sıra.
 *
 * `official: true` olan katmanlar transferi "resmen açıklandı" saydırabilir.
 * Medya katmanları saydıramaz — ne kadar güvenilir olursa olsun.
 */
const SOURCE_TIERS = Object.freeze({
  club_site: { rank: 1, official: true, label: "Kulüp resmî sitesi", baseConfidence: 1 },
  club_social: { rank: 2, official: true, label: "Kulüp resmî sosyal medya hesabı", baseConfidence: 0.97 },
  kap: { rank: 3, official: true, label: "KAP bildirimi", baseConfidence: 1 },
  federation: { rank: 4, official: true, label: "TFF duyurusu", baseConfidence: 0.98 },
  player_agency: { rank: 5, official: true, label: "Oyuncu/menajerlik duyurusu", baseConfidence: 0.9 },
  tier_media: { rank: 6, official: false, label: "Güvenilir spor medyası", baseConfidence: 0.7 },
  other_media: { rank: 7, official: false, label: "Diğer medya", baseConfidence: 0.4 }
});

/** Resmî olmayan katmanların çıkabileceği en yüksek durum. */
const MEDIA_STATUS_CEILING = "agreement_reached";

function isKnownStatus(value) {
  return Object.prototype.hasOwnProperty.call(STATUSES, String(value || ""));
}

function isKnownTier(value) {
  return Object.prototype.hasOwnProperty.call(SOURCE_TIERS, String(value || ""));
}

function isOfficialTier(tier) {
  const entry = SOURCE_TIERS[String(tier || "")];
  return Boolean(entry && entry.official);
}

function statusRank(status) {
  const entry = STATUSES[String(status || "")];
  return entry ? entry.rank : -1;
}

/**
 * Bu kaynak katmanlarıyla çıkılabilecek EN YÜKSEK durum.
 *
 * Tek bir resmî kaynak yeter — kulüp kendi transferini açıklamışsa haber
 * resmîdir. Hiç resmî kaynak yoksa tavan `agreement_reached`'tir: medya
 * "anlaştılar" diyebilir, "resmen açıkladı" diyemez.
 */
function statusCeiling(tiers) {
  const list = Array.isArray(tiers) ? tiers : [tiers];
  return list.some((tier) => isOfficialTier(tier)) ? "official" : MEDIA_STATUS_CEILING;
}

/**
 * İstenen durumu kaynakların izin verdiği tavana çeker.
 *
 * Sessizce kırpmaz: kırpıldıysa `capped: true` ve gerekçe döner, çağıran da
 * bunu sağlık raporuna ve bildirime yazar. "Neden resmî görünmüyor?" sorusu
 * yanıtsız kalmamalı.
 *
 * @returns {{status: string, capped: boolean, reason: string}}
 */
function resolveStatus(requested, tiers) {
  const wanted = String(requested || "");
  if (!isKnownStatus(wanted)) {
    return { status: "rumor", capped: true, reason: `bilinmeyen durum "${wanted}", söylentiye düşürüldü` };
  }

  // Terminal durumlar tavana takılmaz: bir iddianın yalanlandığını medya da
  // bildirebilir ve bunu bastırmak okuyucuyu yanıltır.
  if (STATUSES[wanted].terminal) {
    return { status: wanted, capped: false, reason: "" };
  }

  const ceiling = statusCeiling(tiers);
  if (statusRank(wanted) <= statusRank(ceiling)) {
    return { status: wanted, capped: false, reason: "" };
  }

  return {
    status: ceiling,
    capped: true,
    reason:
      `"${wanted}" için resmî kaynak yok; ` +
      `elde yalnızca medya katmanı var, durum "${ceiling}" ile sınırlandı`
  };
}

/**
 * Bir durumdan diğerine geçilebilir mi?
 *
 * İleri yönde her geçiş serbest. Geri yönde geçiş, kaydı sessizce zayıflatmak
 * anlamına geleceği için YASAK — tek istisna terminal durumlar: resmî bir
 * transferin iptal edilmesi ya da bir iddianın yalanlanması gerçek bir olaydır.
 *
 * Terminal bir kayıttan çıkmak da mümkün (yalanlanan iddia sonradan resmen
 * gerçekleşebilir); ama bu "yeniden canlandırma" ayrıca işaretlenir ki
 * bildirim gitsin.
 *
 * @returns {{allowed: boolean, revival: boolean, reason: string}}
 */
function canTransition(from, to) {
  if (!isKnownStatus(to)) {
    return { allowed: false, revival: false, reason: `bilinmeyen hedef durum: ${to}` };
  }
  if (!from || !isKnownStatus(from)) {
    return { allowed: true, revival: false, reason: "" };
  }
  if (from === to) {
    return { allowed: true, revival: false, reason: "" };
  }

  if (STATUSES[to].terminal) {
    return { allowed: true, revival: false, reason: "" };
  }

  if (STATUSES[from].terminal) {
    return { allowed: true, revival: true, reason: `${from} durumundaki kayıt yeniden canlandı` };
  }

  if (statusRank(to) > statusRank(from)) {
    return { allowed: true, revival: false, reason: "" };
  }

  return {
    allowed: false,
    revival: false,
    reason: `geri yönde geçiş engellendi: ${from} -> ${to}`
  };
}

/** Ekranda görünecek etiket. */
function statusLabel(status) {
  const entry = STATUSES[String(status || "")];
  return entry ? entry.label : "";
}

/** Kart ve bant rozeti. */
function statusBadge(status) {
  const entry = STATUSES[String(status || "")];
  return entry ? entry.badge : "";
}

/** Bu durum genel yüzeylerde görünebilir mi? Hepsi görünür — ama etiketiyle. */
function isPublishable(status) {
  return isKnownStatus(status);
}

/**
 * ESKİ SÖZLÜKLE KÖPRÜ.
 *
 * data/transfers.json bu modelden önce `confirmed` kullanıyordu ve
 * services/transferService.js hâlâ onu bekliyor. Köprü iki yönlü:
 * eski kayıtlar okunurken `official`'a çevrilir, yayın hattı için
 * `official` yeniden `confirmed` olarak görünür. Böylece takım sayfaları
 * kırılmaz.
 */
const LEGACY_STATUS_MAP = Object.freeze({
  confirmed: "official",
  rumour: "rumor",
  talks: "negotiation",
  medical: "advanced_talks"
});

function fromLegacyStatus(value) {
  const key = String(value || "").toLowerCase();
  if (isKnownStatus(key)) return key;
  return LEGACY_STATUS_MAP[key] || "";
}

function toLegacyStatus(status) {
  return String(status) === "official" ? "confirmed" : String(status || "");
}

module.exports = {
  MEDIA_STATUS_CEILING,
  SOURCE_TIERS,
  STATUSES,
  STATUS_KEYS,
  canTransition,
  fromLegacyStatus,
  isKnownStatus,
  isKnownTier,
  isOfficialTier,
  isPublishable,
  resolveStatus,
  statusBadge,
  statusCeiling,
  statusLabel,
  statusRank,
  toLegacyStatus
};
