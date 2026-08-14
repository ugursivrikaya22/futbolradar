/**
 * FİKSTÜR TAKVİMİ — AYNI MAÇIN DAĞILMIŞ KAYITLARINI TEK KAYDA İNDİRGER.
 *
 * Takvim iki sağlayıcıdan besleniyor ve ikisi aynı kulübü farklı yazabiliyor:
 * "Gençlerbirliği" / "Gençlerbirliği S.K.", "Rizespor" / "Çaykur Rizespor".
 * Sonuç, aynı karşılaşmanın takvimde İKİ AYRI KAYIT olarak durması — her biri
 * yalnızca kendi sağlayıcısının kimliğini taşıyarak.
 *
 * ── NEDEN AYRI BİR MODÜL ─────────────────────────────────────────────────
 * Bu birleştirme `services/providers/mockProvider.js` içinde zaten vardı ve
 * site listelerini düzeltiyordu. Ama `server/matchLineupRoute.js` takvimi
 * DOĞRUDAN okuyor, sağlayıcı katmanından geçmiyor; oradaki kayıt hâlâ
 * yarımdı.
 *
 * Bedeli sessizdi ve tam olarak şuydu: resmî ilk 11 uç noktası
 * `providerIds.apiFootball || providerId` sırasını izliyor. Gençlerbirliği –
 * Fenerbahçe kaydında apiFootball kimliği YOKTU, bu yüzden theSportsDb
 * kimliği (2527728) API-Football'a fikstür kimliği diye gönderiliyordu.
 * Uç nokta hata vermiyor, sadece kadro hiç gelmiyordu — yani maç dosyasının
 * en çok beklenen özelliği o maçta hiç çalışmayacaktı.
 *
 * Kural artık tek yerde ve takvimi okuyan herkes aynı kaydı görüyor.
 */

const { normalizeText } = require("../api/_utils");
const { sameClub, confirmedHomeVenue } = require("./superLigTeams.js");

function matchList(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.matches)) return payload.matches;
  return [];
}

function dateOnly(match) {
  return String((match && (match.kickoff || match.date)) || "").slice(0, 10);
}

/** Aynı gün, aynı kulüp çifti — ev sahibi ters yazılmış olabilir. */
function isSameFixture(left, right) {
  if (!left || !right) return false;
  if (dateOnly(left) !== dateOnly(right)) return false;
  const straight = sameClub(left.homeTeam, right.homeTeam) && sameClub(left.awayTeam, right.awayTeam);
  const swapped = sameClub(left.homeTeam, right.awayTeam) && sameClub(left.awayTeam, right.homeTeam);
  return straight || swapped;
}

/**
 * Bir maçın TÜM eş kayıtlarındaki sağlayıcı kimlikleri.
 *
 * Kaydın kendi kimlikleri korunur, eksik olanlar eşlerinden tamamlanır:
 * birleştirme hiçbir şeyi EZMEZ, yalnızca iki kaynağın bildiğini toplar.
 */
function mergedProviderIds(match, matches) {
  const merged = {};
  for (const candidate of matchList(matches)) {
    if (candidate !== match && !isSameFixture(match, candidate)) continue;
    const ids = (candidate && candidate.providerIds) || {};
    for (const [provider, id] of Object.entries(ids)) {
      if (!merged[provider] && id) merged[provider] = id;
    }
    // `providerId` alanı da bir kimlik taşıyor ama hangi sağlayıcıya ait
    // olduğunu söylemiyor; yalnızca providerIds boşsa yedek olarak durur.
  }
  const own = (match && match.providerIds) || {};
  return { ...merged, ...Object.fromEntries(Object.entries(own).filter(([, id]) => Boolean(id))) };
}

/**
 * Lig maçında açıklanmamış saha, ev sahibinin DOĞRULANMIŞ stadıyla dolar.
 *
 * Yalnızca lige uygulanır: sağlayıcının saha tahminine güvenilmemesinin
 * nedeni sezon öncesi yurt dışı kampıydı (takım başka ülkede oynarken
 * sağlayıcı ev sahibinin varsayılan stadını yazıyordu). Lig maçında bu
 * belirsizlik yok; tarafsız sahaya alınan bir lig maçında `venue` zaten
 * dolu gelir ve buraya hiç düşülmez.
 */
function withHomeGroundVenue(match) {
  if (!match || match.league !== "Süper Lig") return match;
  if (match.venue && String(match.venue).trim()) return match;
  const venue = confirmedHomeVenue(match.homeTeam);
  return venue ? { ...match, venue, venueSource: "club-home-ground" } : match;
}

/** Tek kaydı, takvimin tamamını bilerek onarır. */
function normalizeFixture(match, matches) {
  if (!match) return match;
  const providerIds = mergedProviderIds(match, matches);
  const changed = JSON.stringify(providerIds) !== JSON.stringify(match.providerIds || {});
  return withHomeGroundVenue(changed ? { ...match, providerIds } : match);
}

/** Takvimin tamamı; girdi biçimi (dizi / {matches}) korunur. */
function normalizeFixtureCalendar(payload) {
  const matches = matchList(payload);
  if (!matches.length) return payload;
  const patched = matches.map((match) => normalizeFixture(match, matches));
  return Array.isArray(payload) ? patched : { ...payload, matches: patched };
}

/** Kimliğe göre tek maç — kaydı döndürmeden önce onarır. */
function findFixtureById(payload, matchId) {
  const wanted = normalizeText(matchId);
  if (!wanted) return null;
  const matches = matchList(payload);
  const hit = matches.find((match) => normalizeText(match && match.id) === wanted);
  return hit ? normalizeFixture(hit, matches) : null;
}

module.exports = {
  findFixtureById,
  isSameFixture,
  mergedProviderIds,
  normalizeFixture,
  normalizeFixtureCalendar
};
