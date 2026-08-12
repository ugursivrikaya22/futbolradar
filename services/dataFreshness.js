/**
 * VERİ TAZELİĞİ — "BU YANIT NE KADAR ESKİ?" SORUSUNUN TEK YANITI.
 *
 * PROBLEM. Sağlayıcı kotayı doldurup 429 döndürdüğünde `providerCache` son
 * BAŞARILI yanıtı servis ediyor ve buna `cache: "stale"` diyor — doğru
 * davranış, çünkü elde geçerli veri varken sayfayı boşaltmak gereksiz. Ama
 * o işaret `apiFootballProvider` içinde düşüyordu: `providerFetch` yalnızca
 * `result.data` döndürüyor. Zincirin geri kalanı (`providerMeta` → API
 * yanıtı → arayüz) yanıtın bayat olduğunu HİÇ öğrenmiyordu.
 *
 * Sonuç, bu depodaki en tehlikeli hata sınıfı: sağlayıcı çökmüşken eski bir
 * skor CANLIYMIŞ GİBİ gösteriliyordu. Yanlış veri değil — yanlış İDDİA.
 *
 * NEDEN İŞARET TAŞIMIYORUZ. Bayrağı sağlayıcıdan API'ye kadar beş katman
 * boyunca taşımak mümkündü ama iki sorunu vardı. Birincisi eşzamanlılık:
 * modül düzeyinde tutulan bir bayrak, aynı örnekte iç içe geçen iki isteğin
 * arasında sızabilir. İkincisi kapsam: o bayrak yalnızca ÖNBELLEK kaynaklı
 * bayatlığı görür, deponun statik yedeğinden gelen üç günlük veriyi görmez.
 *
 * Bu yüzden tazelik VERİNİN KENDİSİNDEN okunuyor. Kayıtlar zaten `fetchedAt`
 * ve `staleAfter` taşıyor (takvimdeki 314 kaydın 303'ü). Hangi katmanın
 * servis ettiğinden bağımsız olarak doğru yanıtı verir ve durum tutmaz.
 *
 * UYDURMA YOK. Zaman damgası olmayan kayıt "taze" SAYILMAZ ama "bayat" da
 * sayılmaz: bilinmeyen yaş, bir yaş iddiası değildir. Böyle kayıtlar
 * `unknown` olarak sayılır ve karar tek başına onlara dayandırılmaz.
 */

/**
 * Kaynak başına tazelik ömrü. Kayıt kendi `staleAfter` alanını taşıyorsa O
 * kullanılır; bu değerler yalnızca taşımayan kayıtlar için geçerli.
 *
 * Canlı skor dakikalarla ölçülür, kadro ve lig verisi saatlerle: bir maçın
 * 72. dakikası beş dakika eskiyse yanlıştır, bir kadro beş saat eskiyse
 * değildir.
 */
const MAX_AGE_MS = Object.freeze({
  "matches-live": 3 * 60 * 1000,
  matches: 30 * 60 * 1000,
  "match-detail": 10 * 60 * 1000,
  standings: 6 * 60 * 60 * 1000,
  teams: 24 * 60 * 60 * 1000,
  players: 24 * 60 * 60 * 1000,
  transfers: 12 * 60 * 60 * 1000,
  default: 60 * 60 * 1000
});

function parseTime(value) {
  if (typeof value !== "string" || !value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Kaydın kendi tazelik bilgisi. */
function recordTimes(record) {
  if (!record || typeof record !== "object") return { fetchedAt: null, staleAfter: null };
  return {
    fetchedAt: parseTime(record.fetchedAt)
      ?? parseTime(record.lastSuccessfulSyncAt)
      ?? parseTime(record.lastVerifiedAt)
      ?? parseTime(record.updatedAt),
    staleAfter: parseTime(record.staleAfter)
  };
}

/**
 * YANITIN TAZELİĞİ.
 *
 * Bir yanıt, İÇİNDEKİ EN ESKİ zaman damgasına göre değerlendirilmez —
 * en YENİsine göre değerlendirilir. Sebep: karışık yaşlı bir liste normaldir
 * (dün oynanmış maçın kaydı bugün tazelenmez), ama listedeki hiçbir kayıt
 * yakın zamanda tazelenmemişse tazeleme durmuş demektir.
 *
 * Dönen değer:
 *   stale       — yanıt bayat mı
 *   ageMs       — en taze kaydın yaşı (bilinmiyorsa null)
 *   staleSince  — bayatlığın başladığı an (ISO, bilinmiyorsa null)
 *   checkedAt   — bu değerlendirmenin yapıldığı an
 *   sampled     — zaman damgası okunabilen kayıt sayısı
 *   total       — toplam kayıt
 */
function assessFreshness(records, options = {}) {
  const nowMs = Number.isFinite(options.now) ? options.now : Date.now();
  const resource = typeof options.resource === "string" ? options.resource : "default";
  const maxAgeMs = Number.isFinite(options.maxAgeMs)
    ? options.maxAgeMs
    : (MAX_AGE_MS[resource] ?? MAX_AGE_MS.default);

  const list = Array.isArray(records) ? records : [];

  let newestFetchedAt = null;
  let earliestStaleAfter = null;
  let sampled = 0;

  for (const record of list) {
    const { fetchedAt, staleAfter } = recordTimes(record);
    if (fetchedAt === null && staleAfter === null) continue;
    sampled += 1;
    if (fetchedAt !== null && (newestFetchedAt === null || fetchedAt > newestFetchedAt)) {
      newestFetchedAt = fetchedAt;
    }
    if (staleAfter !== null && (earliestStaleAfter === null || staleAfter > earliestStaleAfter)) {
      // En GEÇ sona eren geçerlilik alınır: listedeki en taze kaydın
      // penceresi, yanıtın hâlâ tazelendiğinin göstergesidir.
      earliestStaleAfter = staleAfter;
    }
  }

  // Hiçbir kayıt zaman taşımıyorsa yaş BİLİNMİYOR demektir. Bilinmeyen yaş
  // bir bayatlık iddiası değildir; yanıt bayat işaretlenmez.
  if (!sampled) {
    return {
      stale: false,
      ageMs: null,
      staleSince: null,
      checkedAt: new Date(nowMs).toISOString(),
      sampled: 0,
      total: list.length
    };
  }

  // Kayıt kendi son kullanma anını bildiriyorsa o esastır; bildirmiyorsa
  // kaynak için tanımlı ömür uygulanır.
  const deadline = earliestStaleAfter !== null
    ? earliestStaleAfter
    : (newestFetchedAt !== null ? newestFetchedAt + maxAgeMs : null);

  const stale = deadline !== null && nowMs > deadline;

  return {
    stale,
    ageMs: newestFetchedAt !== null ? Math.max(0, nowMs - newestFetchedAt) : null,
    staleSince: stale && deadline !== null ? new Date(deadline).toISOString() : null,
    checkedAt: new Date(nowMs).toISOString(),
    sampled,
    total: list.length
  };
}

module.exports = {
  MAX_AGE_MS,
  assessFreshness,
  recordTimes
};
