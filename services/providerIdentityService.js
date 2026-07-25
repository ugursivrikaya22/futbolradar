/**
 * Maç kayıtlarında sağlayıcı kimliklerinin isim alanlı yönetimi.
 *
 * Neden gerekli: `providerId` tek bir alandı ama içine farklı sağlayıcıların
 * kimlikleri yazılıyordu — fixture-calendar TheSportsDB olay numarasını
 * ("2539612"), elle girilen kayıtlar başka bir sağlayıcının opak kimliğini
 * ("blx8udpkfd48ndx9a93jskg0k") tutuyordu. sync-match-results ise bu alanı
 * API-Football'a fixture id olarak gönderiyordu; yani kimlik doğru sağlayıcıya
 * ait olmadığında istek sessizce boşa gidiyordu.
 *
 * Çözüm: kimlikler `providerIds: { apiFootball, theSportsDb, ... }` altında
 * saklanır. Eski `providerId` alanı geriye dönük uyumluluk için korunur ama
 * artık hiçbir çağrı onu doğrudan sağlayıcıya göndermez.
 */

const API_FOOTBALL = "apiFootball";
const THE_SPORTS_DB = "theSportsDb";

/** Eski `source` değerlerinden hangi sağlayıcıya ait olduğunu çıkarır. */
const SOURCE_TO_PROVIDER = {
  thesportsdb: THE_SPORTS_DB,
  "the-sports-db": THE_SPORTS_DB,
  "api-football": API_FOOTBALL,
  apifootball: API_FOOTBALL,
  "api-sports": API_FOOTBALL
};

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

/**
 * API-Football fixture id'leri tam sayıdır. Opak/alfanümerik bir değerin
 * yanlışlıkla API-Football'a gönderilmesini engeller.
 */
function isApiFootballId(value) {
  return /^\d+$/.test(String(value || "").trim());
}

/** Kaydın isim alanlı kimlik haritasını döndürür (eski alanları da okur). */
function readProviderIds(match) {
  const ids = { ...(match && match.providerIds) };

  const legacy = match && match.providerId;
  if (legacy && !Object.values(ids).includes(String(legacy))) {
    const provider = SOURCE_TO_PROVIDER[normalizeKey(match.source)]
      || SOURCE_TO_PROVIDER[normalizeKey(match.liveStateSource)]
      || null;
    if (provider && !ids[provider]) {
      ids[provider] = String(legacy);
    }
  }

  return ids;
}

/** Belirli bir sağlayıcının kimliğini döndürür; yoksa null. */
function providerIdFor(match, provider) {
  const value = readProviderIds(match)[provider];
  if (!value) return null;
  if (provider === API_FOOTBALL && !isApiFootballId(value)) return null;
  return String(value);
}

/**
 * Kimliği isim alanına yazar. Var olan farklı bir değeri ezmez: aynı maç
 * için iki farklı fixture id'si görülüyorsa bu bir eşleştirme hatasıdır ve
 * sessizce üzerine yazmak yanlış maçın verisini çekmeye yol açar.
 */
function withProviderId(match, provider, id) {
  const value = String(id || "").trim();
  if (!value) return { record: match, changed: false, conflict: null };
  if (provider === API_FOOTBALL && !isApiFootballId(value)) {
    return { record: match, changed: false, conflict: `API-Football kimliği sayısal olmalı: "${value}"` };
  }

  const current = readProviderIds(match)[provider];
  if (current && String(current) !== value) {
    return { record: match, changed: false, conflict: `${provider} kimliği çakışıyor: kayıtlı "${current}", gelen "${value}"` };
  }
  if (current === value) return { record: match, changed: false, conflict: null };

  return {
    record: { ...match, providerIds: { ...readProviderIds(match), [provider]: value } },
    changed: true,
    conflict: null
  };
}

/** Kapsam raporu: kaç kaydın hangi sağlayıcı kimliği var. */
function coverageReport(matches, provider) {
  const rows = Array.isArray(matches) ? matches : [];
  const withId = rows.filter((match) => providerIdFor(match, provider));
  return {
    total: rows.length,
    covered: withId.length,
    missing: rows.length - withId.length,
    percent: rows.length ? Math.round((withId.length / rows.length) * 100) : 0,
    missingIds: rows.filter((match) => !providerIdFor(match, provider)).map((match) => match.id)
  };
}

module.exports = {
  API_FOOTBALL,
  THE_SPORTS_DB,
  isApiFootballId,
  readProviderIds,
  providerIdFor,
  withProviderId,
  coverageReport
};
