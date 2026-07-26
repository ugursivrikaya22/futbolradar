/**
 * API-Football istatistik türlerini sitenin kanonik şemasına çevirir.
 *
 * NEDEN VAR: Sağlayıcı `/fixtures/statistics` çıktısını İNGİLİZCE tür
 * adlarıyla ve METİN değerlerle döndürüyor ("Ball Possession" → "58%").
 * Analiz katmanı ise kürasyonlu veriden gelen TÜRKÇE kanonik adları arıyor
 * ("Topla oynama") ve sayısal değer bekliyor. Çeviri olmadan sağlayıcıdan
 * gerçekten çekilmiş 18 istatistiğin tamamı okunamıyor: maç kaydında
 * duruyor ama hiçbir analiz bölümü üretmiyordu.
 *
 * Bu tablo VERİ ÜRETMEZ; yalnızca sağlayıcının gönderdiği değeri adlandırır
 * ve birimini işaretler. Karşılığı olmayan tür sessizce atılmaz, loglanır.
 */

/** Sağlayıcıdan gelmeyen bir ölçüyü tabloya EKLEME — burası çeviri, üretim değil. */
const CANONICAL_STATISTICS = [
  // Genel
  { aliases: ["Ball Possession", "Possession"], type: "Topla oynama", category: "Genel", unit: "%", higherIsBetter: true },
  { aliases: ["expected_goals", "Expected Goals"], type: "Gol beklentisi (xG)", category: "Genel", decimals: 2, higherIsBetter: true },
  { aliases: ["Corner Kicks", "Corners"], type: "Korner", category: "Genel" },
  { aliases: ["Offsides"], type: "Ofsayt", category: "Genel" },

  // Hücum
  { aliases: ["Total Shots"], type: "Toplam şut", category: "Hücum", higherIsBetter: true },
  { aliases: ["Shots on Goal", "Shots on Target"], type: "İsabetli şut", category: "Hücum", higherIsBetter: true },
  { aliases: ["Shots off Goal", "Shots off Target"], type: "İsabetsiz şut", category: "Hücum" },
  { aliases: ["Blocked Shots"], type: "Engellenen şut", category: "Hücum" },
  { aliases: ["Shots insidebox", "Shots inside box"], type: "Ceza sahası içinden şut", category: "Hücum", higherIsBetter: true },
  { aliases: ["Shots outsidebox", "Shots outside box"], type: "Ceza sahası dışından şut", category: "Hücum" },

  // Pas
  { aliases: ["Total passes", "Total Passes"], type: "Toplam pas", category: "Pas", higherIsBetter: true },
  { aliases: ["Passes accurate", "Passes Accurate"], type: "İsabetli pas", category: "Pas", higherIsBetter: true },
  { aliases: ["Passes %", "Passes Percentage"], type: "Pas isabeti", category: "Pas", unit: "%", higherIsBetter: true },

  // Savunma
  // Kurtarış BİLEREK nötr: çok kurtarış "iyi savunma" değil, çok baskı altında
  // kalmak da olabilir. higherIsBetter işaretlemek okuyucuya olmayan bir
  // yargıyı ölçülmüş gibi gösterirdi.
  { aliases: ["Goalkeeper Saves", "Saves"], type: "Kurtarış", category: "Savunma" },
  { aliases: ["goals_prevented", "Goals Prevented"], type: "Önlenen gol", category: "Savunma", decimals: 2, higherIsBetter: true },

  // Disiplin
  { aliases: ["Fouls"], type: "Faul", category: "Disiplin" },
  { aliases: ["Yellow Cards"], type: "Sarı kart", category: "Disiplin" },
  { aliases: ["Red Cards"], type: "Kırmızı kart", category: "Disiplin" }
];

function foldKey(value) {
  return String(value == null ? "" : value)
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ");
}

const ALIAS_INDEX = new Map();
for (const entry of CANONICAL_STATISTICS) {
  for (const alias of entry.aliases) ALIAS_INDEX.set(foldKey(alias), entry);
  // Kanonik ad da kendine eşlenir: zaten çevrilmiş satır yeniden çevrilebilsin.
  ALIAS_INDEX.set(foldKey(entry.type), entry);
}

function canonicalEntryFor(type) {
  return ALIAS_INDEX.get(foldKey(type)) || null;
}

/**
 * Sağlayıcı değerini sayıya çevirir. "58%" → 58, "1,54" → 1.54, null → null.
 * Çevrilemeyen değer null döner; uydurma sıfır YAZILMAZ, çünkü "0 şut" ile
 * "şut verisi yok" farklı şeylerdir ve analiz katmanı bu farkı okuyor.
 */
function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace("%", "").replace(",", ".").trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Ham {type, home, away} satırlarını kanonik şemaya çevirir.
 *
 * Karşılığı olmayan tür ATILIR — İngilizce etiketi Türkçe sayfaya sızdırmak
 * yerine — ama `unmapped` listesinde döner ki kayıp görünür olsun.
 */
function canonicalizeStatistics(rows) {
  const statistics = [];
  const unmapped = [];
  const seen = new Set();

  for (const row of Array.isArray(rows) ? rows : []) {
    const entry = canonicalEntryFor(row && row.type);
    if (!entry) {
      if (row && row.type) unmapped.push(String(row.type));
      continue;
    }
    if (seen.has(entry.type)) continue;

    const home = toNumber(row.home);
    const away = toNumber(row.away);
    // İki taraf da okunamıyorsa satırın bilgi değeri yok.
    if (home === null && away === null) continue;

    seen.add(entry.type);
    const canonical = { category: entry.category, type: entry.type, home, away };
    if (entry.unit) canonical.unit = entry.unit;
    if (entry.decimals) canonical.decimals = entry.decimals;
    if (entry.higherIsBetter) canonical.higherIsBetter = true;
    statistics.push(canonical);
  }

  return { statistics, unmapped };
}

module.exports = {
  CANONICAL_STATISTICS,
  canonicalEntryFor,
  canonicalizeStatistics,
  toNumber
};
