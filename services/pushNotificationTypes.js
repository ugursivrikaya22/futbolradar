/**
 * PUSH BİLDİRİM TÜRLERİ — abonenin tür bazında açıp kapattığı gruplar.
 *
 *   match-day     "Favori takımının bugün maçı var" hatırlatması (günde bir)
 *   goal          gol
 *   match-status  maç başı, devre arası, maç sonu, kırmızı kart
 *
 * GERİYE UYUMLULUK: `notification_types` sütunu boş (null) olan eski
 * abonelikler TÜM türleri alır — bu PR'dan önce abone olan kimse gol
 * bildirimini kaybetmez. Migrasyon 0014 uygulanmamışsa sütun hiç yoktur;
 * depo katmanı bu durumda da null döner (bkz. pushSubscriptionStore).
 */

const NOTIFICATION_TYPES = Object.freeze(["match-day", "goal", "match-status"]);

/** Canlı olay türü → abonelik grubu. */
const EVENT_GROUP = Object.freeze({
  "match-day": "match-day",
  goal: "goal",
  kickoff: "match-status",
  halftime: "match-status",
  fulltime: "match-status",
  "red-card": "match-status"
});

/**
 * İstemciden gelen listeyi doğrular. Geçersiz/boş liste → null (tümü).
 * Bilinmeyen değerler atılır; sıra sabitlenir (depoda kararlı değer).
 */
function normalizeNotificationTypes(input) {
  if (!Array.isArray(input)) return null;
  const wanted = new Set(input.map((item) => String(item || "").trim()));
  const types = NOTIFICATION_TYPES.filter((type) => wanted.has(type));
  return types.length ? types : null;
}

/** Abone bu olay türünü istiyor mu? `types` null/undefined → evet (eski davranış). */
function wantsEvent(types, eventType) {
  const group = EVENT_GROUP[eventType];
  if (!group) return false;
  if (!Array.isArray(types) || !types.length) return true;
  return types.includes(group);
}

module.exports = { EVENT_GROUP, NOTIFICATION_TYPES, normalizeNotificationTypes, wantsEvent };
