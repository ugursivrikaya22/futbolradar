/**
 * DOĞRULAYICI — üretime çıkacak kaydın kapısı.
 *
 * İki sonuç üretir ve ikisi de KAYIT ALTINA ALINIR:
 *
 *   • reject    → kayıt kullanılamaz (oyuncu yok, kaynak yok, tarih bozuk).
 *   • quarantine → kayıt kullanılabilir görünüyor ama bir şey ters
 *                  (mevcut resmî kayıtla çelişiyor, durum çözülemedi).
 *
 * Karantina ile ret arasındaki fark önemli: reddedilen kayıt çöptür,
 * karantinadaki kayıt İNSAN BAKMALI demektir. İkisini aynı kovaya atmak,
 * gerçek çelişkileri gürültünün içinde kaybeder.
 *
 * Hiçbir geçersiz kayıt üretim sayfalarına ulaşmaz — bu dosyanın tek sözü bu.
 */

const { isKnownStatus, isKnownTier } = require("./statusModel.js");
const { canonicalClub, fold } = require("./normalizer.js");

/** Oyuncu adı olmadan transfer olmaz. */
const REQUIRED = ["playerName", "sourceUrl"];

function text(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

function isTraceableUrl(value) {
  try {
    const url = new URL(text(value));
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isValidDate(value) {
  const raw = text(value);
  if (!raw) return false;
  const stamp = Date.parse(raw.length === 10 ? `${raw}T00:00:00Z` : raw);
  if (Number.isNaN(stamp)) return false;
  // Makul aralık: 2000'den sonra ve bugünden en fazla 2 gün sonra. Gelecek
  // tarihli "transfer" bir saat hatasıdır, haber değil.
  const now = Date.now();
  return stamp > Date.parse("2000-01-01T00:00:00Z") && stamp < now + 2 * 24 * 3600 * 1000;
}

/**
 * Tek bir adayı doğrular.
 *
 * @param {Object} candidate
 * @param {Object} [context] `{ existing: Array }` — çelişki denetimi için.
 * @returns {{verdict: "accept"|"quarantine"|"reject", reasons: string[]}}
 */
function validateCandidate(candidate, context = {}) {
  const reasons = [];

  if (!candidate || typeof candidate !== "object") {
    return { verdict: "reject", reasons: ["kayıt nesne değil"] };
  }

  for (const field of REQUIRED) {
    if (!text(candidate[field])) reasons.push(`${field} yok`);
  }

  const from = text(candidate.fromTeam);
  const to = text(candidate.toTeam);
  if (!from && !to) reasons.push("iki kulüp de yok");

  if (text(candidate.sourceUrl) && !isTraceableUrl(candidate.sourceUrl)) {
    reasons.push("kaynak bağlantısı izlenebilir değil");
  }

  if (!isKnownTier(candidate.sourceTier)) {
    reasons.push(`desteklenmeyen kaynak katmanı: ${text(candidate.sourceTier) || "yok"}`);
  }

  const status = text(candidate.status || candidate.requestedStatus);
  if (!status) reasons.push("durum belirlenemedi");
  else if (!isKnownStatus(status)) reasons.push(`bilinmeyen durum: ${status}`);

  const date = candidate.announcedAt || candidate.date || candidate.sourcePublishedAt;
  if (!isValidDate(date)) reasons.push("yayın tarihi geçersiz");

  if (reasons.length) {
    return { verdict: "reject", reasons };
  }

  // ── Karantina: isim yapısal olarak bozuk ya da tanınmıyor ─────────────
  //
  // Başlıktan isim çıkarma kalıplarla yapılıyor ve yanılıyor. Kalıbın
  // ürettiği her ismi yayımlamak, uydurma futbolcular hakkında haber
  // üretmek demek. Kapı veriye dayanıyor (bkz. playerDirectory).
  const { resolvePlayer } = require("./playerDirectory.js");
  const resolved = resolvePlayer(candidate.playerName);
  if (!resolved.known) {
    return { verdict: "quarantine", reasons: [resolved.reason] };
  }

  // ── Karantina: kayıt geçerli ama mevcut gerçekle çelişiyor ────────────
  const conflict = findOfficialConflict(candidate, context.existing || []);
  if (conflict) {
    return {
      verdict: "quarantine",
      reasons: [
        `mevcut resmî kayıtla çelişiyor (${conflict.id}): ` +
        `kayıtlı hedef "${conflict.toTeam}", gelen hedef "${to}"`
      ]
    };
  }

  return { verdict: "accept", reasons: [] };
}

/**
 * Aynı oyuncu için ZATEN resmî bir transfer varken farklı bir kulübe
 * transfer iddiası geliyorsa çelişki vardır.
 *
 * Bu sessizce üstüne yazılmamalı: ya kaynak yanılıyor ya oyuncu gerçekten
 * ikinci kez transfer oldu. İkisi de insan kararı ister.
 */
function findOfficialConflict(candidate, existing) {
  const player = fold(candidate.playerName);
  if (!player) return null;

  const incomingTo = fold(canonicalClub(candidate.toTeam));
  if (!incomingTo) return null;

  for (const record of existing) {
    if (!record || fold(record.playerName) !== player) continue;
    if (String(record.transferStatus || record.status) !== "official") continue;
    if (String(record.transferWindow || "") !== String(candidate.transferWindow || "")) continue;

    const recordedTo = fold(canonicalClub(record.toTeam));
    if (recordedTo && incomingTo && recordedTo !== incomingTo) {
      // Gelen kayıt da resmîyse bu bir güncelleme olabilir; yine de insan baksın.
      return record;
    }
  }

  return null;
}

/** Toplu doğrulama; üç kovaya ayırır. */
function validateAll(candidates, context = {}) {
  const accepted = [];
  const quarantined = [];
  const rejected = [];

  for (const candidate of candidates || []) {
    const { verdict, reasons } = validateCandidate(candidate, context);
    if (verdict === "accept") accepted.push(candidate);
    else if (verdict === "quarantine") quarantined.push({ candidate, reasons });
    else rejected.push({ candidate, reasons });
  }

  return { accepted, quarantined, rejected };
}

module.exports = {
  REQUIRED,
  findOfficialConflict,
  isTraceableUrl,
  isValidDate,
  validateAll,
  validateCandidate
};
