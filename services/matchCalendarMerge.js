/**
 * KÜRASYONLU MAÇ + SAĞLAYICI TAKVİMİ BİRLEŞTİRME — tek yetkili kural.
 *
 * Elle doğrulanmış maçlar (data/matches.json) ile sağlayıcı takvimi
 * (data/fixture-calendar.json) tek listede birleşir.
 *
 * Kural: kimlik ve editoryal alanlar (analiz, özet, kaynaklar) her zaman
 * kürasyonlu kayda aittir; sağlayıcı yalnızca maç *durumunu* ileri taşır.
 * Böylece kürasyonlu veri bir gün geride kaldığında biten maç "oynanacak"
 * görünmez, ama doğrulanmış bir skor da asla sağlayıcı tahminiyle ezilmez.
 *
 * NEDEN AYRI DOSYA: kural daha önce yalnızca mockProvider içinde yaşıyordu ve
 * o dosya veri setlerini modül yüklenirken `require` ile okuduğu için sonuç
 * süreç ömrü boyunca donuyordu. Bandı besleyen tarafın (scripts/lib/tickerFeed.mjs)
 * dosyaları her turda diskten taze okuması gerekiyor; kuralı oraya kopyalamak
 * ise iki ayrı birleştirme mantığı demekti — biri gevşediğinde diğeri fark
 * etmez ve bant ile fikstür yüzeyleri farklı şeyler gösterirdi. Bu yüzden
 * kural saf bir fonksiyona taşındı: girdiyi çağıran verir, kural tektir.
 */

const { normalizeText } = require("../api/_utils");

const MATCH_STATE_RANK = { SCHEDULED: 0, TIMED: 0, POSTPONED: 0, CANCELLED: 0, LIVE: 1, FINISHED: 2 };

function matchStateRank(status) {
  return MATCH_STATE_RANK[String(status || "").toUpperCase()] ?? 0;
}

function matchDateOnly(match) {
  const value = match && (match.kickoff || match.date || match.utcDate);
  if (!value) {
    return "";
  }

  return String(value).slice(0, 10);
}

function matchIdentity(match) {
  const date = matchDateOnly(match);
  // Order-insensitive on purpose: for neutral-venue fixtures (pre-season camps
  // in particular) sources disagree about which club is nominally at home, and
  // an ordered key let the same match through twice with the sides swapped.
  const pair = [normalizeText(match && match.homeTeam), normalizeText(match && match.awayTeam)].sort();
  return `${pair[0]}|${pair[1]}|${date}`;
}

function hasFinalScore(match) {
  const score = match && match.score;
  return Boolean(score) && score.home !== null && score.home !== undefined && score.away !== null && score.away !== undefined;
}

// "Açıklanmadı" gibi yer tutucular boş bir alan değil, bilinçli bir
// editoryal karar: kulüp sahayı henüz duyurmadıysa kayıt bunu `note`
// alanında gerekçesiyle birlikte saklıyor.
//
// Bu yer tutucuları sağlayıcı verisiyle doldurmak denendi ve geri alındı:
// sağlayıcı sezon öncesi kamp maçlarında ev sahibinin varsayılan stadyumunu
// döndürüyor ve sonuç doğrulanmış alanlarla çelişiyordu - "country:
// Slovenya" olan Çaykur Rizespor maçına Hırvatistan'daki Opus Arena,
// "country: Hollanda" olan Samsunspor maçına Belçika'daki Stade du Tivoli
// yazılıyordu. Doğrulanmamış bir tahmini kesin bilgi gibi göstermektense
// "Açıklanmadı" demek doğru. Sağlayıcının kaydı yalnızca ayrı ve açıkça
// etiketli bir alanda taşınır.
const VENUE_PLACEHOLDERS = new Set(["", "-", "–", "aciklanmadi", "belirlenmedi", "bilinmiyor", "tbd"]);

function hasRealVenue(value) {
  return !VENUE_PLACEHOLDERS.has(normalizeText(value).replace(/\s+/g, " ").trim());
}

/**
 * Sağlayıcının saha tahminiyle ne yapılacağına karar verir.
 *
 * Kural üç dalda da aynı: doğrulanmış saha ASLA ezilmez, açıklanmamış saha
 * tahminle DOLDURULMAZ, tahmin yalnızca ayrı ve "unverified" etiketli bir
 * alanda taşınır.
 *
 * Ayrı fonksiyon olmasının nedeni test edilebilirlik: kural daha önce
 * yalnızca canlı fikstür takvimindeki belirli bir hazırlık maçı üzerinden
 * sınanıyordu. O maç sağlayıcının eventsnext/eventslast penceresinden
 * çıkınca tahmin de kayboldu ve test kırıldı — kural bozulmadığı hâlde.
 * Sözleşme artık sabit girdilerle, üç dalın hepsinde doğrulanıyor.
 */
function resolveProviderVenue(existingVenue, providerVenue) {
  if (hasRealVenue(existingVenue)) return null;
  return providerVenue || null;
}

/**
 * Kürasyonlu kayıtlarla sağlayıcı takvimini birleştirir.
 *
 * Saf fonksiyon: dosya okumaz, günlük yazmaz, yayın politikası uygulamaz.
 * Yayın politikası (services/matchEligibility.js) çağıranın sorumluluğudur —
 * böylece aynı birleşik liste hem yayın yüzeylerinde hem de politikayı
 * uygulamayan bakım araçlarında kullanılabilir.
 *
 * @param {Array} curated data/matches.json kayıtları
 * @param {Array} calendar data/fixture-calendar.json içindeki `matches`
 * @returns {Array} birleşik liste
 */
function mergeCuratedWithCalendar(curated, calendar) {
  const merged = new Map();

  for (const match of Array.isArray(curated) ? curated : []) {
    merged.set(matchIdentity(match), match);
  }

  for (const calendarMatch of Array.isArray(calendar) ? calendar : []) {
    const key = matchIdentity(calendarMatch);
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, calendarMatch);
      continue;
    }

    // `venue` doğrulanmış editoryal alan; sağlayıcı ona hiç dokunmaz.
    // Kürasyonlu kayıtta saha henüz açıklanmamışsa sağlayıcının kaydı
    // yalnızca ayrı bir alanda, doğrulanmamış olduğu belli olacak şekilde
    // taşınır - arayüz isterse "sağlayıcı kaydı" etiketiyle gösterebilir.
    const providerVenue = resolveProviderVenue(existing.venue, calendarMatch.venue);
    const advances = matchStateRank(calendarMatch.status) > matchStateRank(existing.status);
    const canAdvance = advances && !hasFinalScore(existing);

    if (!canAdvance && !providerVenue) {
      continue;
    }

    merged.set(key, {
      ...existing,
      ...(providerVenue ? { providerVenue, providerVenueStatus: "unverified" } : {}),
      ...(canAdvance
        ? {
          status: calendarMatch.status,
          score: hasFinalScore(calendarMatch) ? { ...existing.score, ...calendarMatch.score } : existing.score,
          liveStateSource: calendarMatch.source || "provider"
        }
        : {}),
      providerId: existing.providerId || calendarMatch.providerId || ""
    });
  }

  return [...merged.values()];
}

/** Kürasyonlu kayıt sağlayıcı satırını ezer; birleştirme yapılmaz. */
function unionByIdentity(curated, calendar) {
  const merged = new Map();
  for (const match of Array.isArray(curated) ? curated : []) {
    merged.set(matchIdentity(match), match);
  }
  for (const calendarMatch of Array.isArray(calendar) ? calendar : []) {
    if (!merged.has(matchIdentity(calendarMatch))) {
      merged.set(matchIdentity(calendarMatch), calendarMatch);
    }
  }
  return [...merged.values()];
}

module.exports = {
  mergeCuratedWithCalendar,
  unionByIdentity,
  matchIdentity,
  matchDateOnly,
  matchStateRank,
  hasFinalScore,
  hasRealVenue,
  resolveProviderVenue
};
