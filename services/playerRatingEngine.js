/**
 * FUTBOLCU ÖZELLİK PUANLARI — TEK YETKİLİ HESAP MOTORU.
 *
 * Karşılaştırma ve profil sayfalarındaki sekiz satır (Overall, Form, Hücum,
 * Yaratıcılık, Savunma, Disiplin, Süreklilik, Potansiyel) bugüne kadar
 * `-` basıyordu. Sebep tek bir alan değildi, iki katmanlı bir tıkanmaydı:
 *
 *   1. `services/ratingService.js` radar değerlerini ÖLÇÜLMEMİŞ sıfırlarla
 *      birlikte ortalıyordu. Kadro senkronu (API-Football `/players/squads`)
 *      istatistik döndürmez; `normalizePlayer` eksik alanı 0 yazar. Bu 0'lar
 *      ortalamaya girince 4 maçta 6 gol atan bir santrfor 20/100 "Hücum"
 *      puanı alıyordu — sayı yanlış olduğu için değil, ölçülmemiş alan
 *      ölçülmüş gibi sayıldığı için.
 *   2. `services/cardCredibility.js` bu yüzden HAKLI olarak kapıyı kapatıyor:
 *      `ratingStatus` "verified"/"current" değilse hiçbir puan yayımlanmıyor.
 *      Veri hattında bu iki değeri üreten bir adım olmadığından 806 kaydın
 *      hepsi eleniyor ve tablo baştan sona `-` kalıyordu.
 *
 * Bu modül ikinci kapıyı zorlamadan birinci sorunu çözer: puanı YALNIZCA
 * gerçekten ölçülmüş alanlardan hesaplar, her sayının arkasındaki girdileri
 * (kaç maç, kaç gol, kaç dakika) çıktının içinde taşır ve hesaplanamayan
 * kategoriyi "Veri yetersiz" olarak işaretler. Böylece:
 *
 *   • Uydurulmuş tek bir sayı üretilmez — ölçüm yoksa kategori boş kalır.
 *   • Tek bir eksik alan (örn. xG) bütün tabloyu düşürmez; o kategori
 *     mevcut metriklerle hesaplanır, ağırlıklar kalanlara dağıtılır.
 *   • Yayımlanan her değer `inputs` dizisiyle birlikte gelir; kullanıcı
 *     kategoriye tıkladığında puanın nasıl oluştuğunu görür.
 *
 * ÇIKTI, `player.ratingScores` ALANINA YAZILIR — eski `radar`/`aiRating`
 * alanlarının kredibilite kapısı DEĞİŞMEZ. Yeni blok kendi kanıtını taşıdığı
 * için ayrı bir alanda durur; eski alanların gevşetilmesi gerekmez.
 */

const { evaluatePlayerIdentity } = require("./cardCredibility");

const INSUFFICIENT_LABEL = "Veri yetersiz";
const NOT_APPLICABLE_LABEL = "Mevki dışı";

/** Sayfada basılan satır sırası. Kaleci dahil her mevkide aynı. */
const RATING_CATEGORY_ORDER = [
  "overall",
  "form",
  "attack",
  "creativity",
  "defense",
  "discipline",
  "durability",
  "potential"
];

const CATEGORY_LABELS = {
  overall: "Overall",
  form: "Form",
  attack: "Hücum",
  creativity: "Yaratıcılık",
  defense: "Savunma",
  discipline: "Disiplin",
  durability: "Süreklilik",
  potential: "Potansiyel"
};

/** Kaleci satırlarında "Savunma" kurtarış performansını anlatır. */
const GOALKEEPER_CATEGORY_LABELS = {
  ...CATEGORY_LABELS,
  defense: "Kalecilik"
};

/**
 * MEVKİYE GÖRE AĞIRLIK.
 *
 * Toplamları 100. `overall` bunların ağırlıklı ortalamasıdır; hesaplanamayan
 * kategorinin ağırlığı kalanlara ORANTILI dağıtılır (bkz. weightedOverall).
 */
const POSITION_WEIGHTS = {
  forward: { attack: 35, form: 20, creativity: 15, durability: 15, discipline: 5, defense: 10 },
  // Kanat oyuncusu şartnamede ayrı tanımlı değil; forvet ile orta saha
  // arasında duruyor: bitiricilik forvet kadar belirleyici değil, üretim
  // orta saha kadar merkezî değil.
  winger: { attack: 28, creativity: 22, form: 20, durability: 15, defense: 10, discipline: 5 },
  midfielder: { creativity: 25, form: 20, attack: 20, defense: 15, durability: 15, discipline: 5 },
  defender: { defense: 35, form: 20, durability: 15, discipline: 10, attack: 10, creativity: 10 },
  // KALECİ AYRI SİSTEM: hücum ve yaratıcılık mevki dışı sayılır, bu yüzden
  // ağırlık tablosunda hiç yer almazlar.
  goalkeeper: { defense: 40, form: 20, durability: 15, discipline: 10, potential: 15 }
};

/** Bilinmeyen mevki: orta saha dengesi en az varsayım içeren seçim. */
const FALLBACK_WEIGHTS = POSITION_WEIGHTS.midfielder;

/** Kaleci dışındaki mevkilerde hücum/yaratıcılık daima anlamlıdır. */
const GOALKEEPER_NOT_APPLICABLE = new Set(["attack", "creativity"]);

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function isFiniteNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function round(value, digits) {
  const factor = 10 ** (digits || 0);
  return Math.round(Number(value) * factor) / factor;
}

/**
 * Düğüm noktalarından geçen parçalı doğrusal eğri.
 *
 * Ham bir oranı (örn. 0.92 gol/90) 0-100 puana çevirir. Eşik tablosu açıkça
 * yazılır ki bir kategorinin neyi "elit" saydığı okunabilir olsun; gizli bir
 * katsayı ya da sihirli bölme yok.
 *
 * @param {number} value ham oran
 * @param {Array<[number, number]>} anchors artan sırada [oran, puan] çiftleri
 */
function curve(value, anchors) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (number <= anchors[0][0]) return anchors[0][1];

  for (let index = 1; index < anchors.length; index += 1) {
    const [prevX, prevY] = anchors[index - 1];
    const [nextX, nextY] = anchors[index];
    if (number <= nextX) {
      const span = nextX - prevX || 1;
      return prevY + ((number - prevX) / span) * (nextY - prevY);
    }
  }

  return anchors[anchors.length - 1][1];
}

/* ------------------------------------------------------------------------ *
 * KANIT KAPISI
 * ------------------------------------------------------------------------ */

/**
 * SIFIR, ÖLÇÜM DEĞİLDİR — kanıt yoksa.
 *
 * Kadro senkronundan gelen kayıtlarda şut, xG, pas isabeti, ikili mücadele
 * gibi alanların hepsi harfiyen 0. Sağlayıcı bunları hiç göndermedi;
 * `normalizePlayer` boşluğu 0 ile doldurdu. Bu 0'ı ölçüm saymak, "hiç şut
 * çekmedi" gibi YANLIŞ bir iddia üretir.
 *
 * Kural üç kademeli:
 *   1. `statsVerifiedFields` varsa yalnızca o alanlar ölçülmüştür (kayıt
 *      kısmi doğrulama beyan ediyor — services/cardCredibility.js ile aynı
 *      sözleşme).
 *   2. Değer 0 değilse ölçülmüştür.
 *   3. Değer 0 ise ancak açık bir istatistik kökeni (`statsSource`,
 *      `statsVerifiedAt`, `statsFetchedAt`) varsa ölçülmüş sayılır.
 */
function readStat(player, field) {
  const stats = player && player.stats && typeof player.stats === "object" ? player.stats : {};
  const raw = stats[field] !== undefined && stats[field] !== null ? stats[field] : (player ? player[field] : null);
  return isFiniteNumber(raw) ? Number(raw) : null;
}

function hasStatsProvenance(player) {
  return Boolean(player && (player.statsSource || player.statsVerifiedAt || player.statsFetchedAt));
}

function measuredStat(player, field) {
  const value = readStat(player, field);
  if (value === null) return null;

  if (Array.isArray(player.statsVerifiedFields)) {
    return player.statsVerifiedFields.includes(field) ? value : null;
  }

  if (value !== 0) return value;
  return hasStatsProvenance(player) ? 0 : null;
}

/* ------------------------------------------------------------------------ *
 * ÖRNEKLEM KÜÇÜKLÜĞÜ
 * ------------------------------------------------------------------------ */

/**
 * KÜÇÜK ÖRNEKLEM KÜÇÜLTÜLÜR (shrinkage).
 *
 * 300 dakikada 6 gol ham hâliyle 1.80 gol/90 eder — sezon boyunca hiçbir
 * oyuncunun sürdürmediği bir oran. Ham oranı olduğu gibi puana çevirmek,
 * üç maç oynamış bir oyuncuyu ligin en iyisi ilan eder. Değer bu yüzden
 * mevki ortalamasına doğru, oynanan dakikayla ters orantılı olarak çekilir:
 * dakika arttıkça ölçüm kendi ağırlığını kazanır.
 *
 * `PRIOR_MINUTES` dört maçlık bir "önsel örneklem" demek: 360 dakika oynamış
 * bir oyuncuda ölçüm ile ortalama yarı yarıya tartılır.
 */
const PRIOR_MINUTES = 360;

function shrunkPer90(total, minutes, baselinePer90) {
  if (!isFiniteNumber(total) || !isFiniteNumber(minutes) || Number(minutes) <= 0) return null;
  const base = isFiniteNumber(baselinePer90) ? Number(baselinePer90) : 0;
  return (Number(total) * 90 + base * PRIOR_MINUTES) / (Number(minutes) + PRIOR_MINUTES);
}

/* ------------------------------------------------------------------------ *
 * METRİK TANIMLARI
 * ------------------------------------------------------------------------ */

/**
 * Metrik tablosu. Her satır tek bir ölçüyü anlatır:
 *   field     — kayıttaki alan adı
 *   label     — detay açılımında görünen Türkçe etiket
 *   weight    — kategori içi ağırlık
 *   baseline  — küçültme için mevki ortalaması (90 dakika başına)
 *   anchors   — ham oranı 0-100 puana çeviren eşik tablosu
 *   unit      — detay satırında değerin nasıl yazılacağı
 *
 * Eşikler MEVKİDEN BAĞIMSIZ (mutlak). Bir stoperin 0.05 gol/90 üretmesi
 * gerçekten düşük bir hücum katkısıdır; mevkiye göre eğri kaydırmak,
 * karşılaştırma satırını ("Hücum 89 | 95") anlamsız kılardı. Mevki farkı
 * kategori PUANINDA değil, `overall` AĞIRLIĞINDA yaşar.
 */
const ATTACK_METRICS = [
  {
    key: "goals",
    label: "Gol",
    weight: 40,
    baseline: 0.18,
    anchors: [[0, 18], [0.08, 38], [0.18, 52], [0.3, 64], [0.45, 75], [0.65, 85], [0.9, 93], [1.2, 98]]
  },
  {
    key: "shots",
    label: "Şut",
    weight: 14,
    baseline: 1.2,
    anchors: [[0, 20], [0.6, 40], [1.2, 55], [2, 68], [3, 80], [4.2, 90], [5.5, 96]]
  },
  {
    key: "shotsOnTarget",
    label: "İsabetli şut",
    weight: 14,
    baseline: 0.45,
    anchors: [[0, 20], [0.2, 40], [0.45, 55], [0.8, 69], [1.2, 81], [1.8, 91], [2.4, 97]]
  },
  {
    key: "xg",
    label: "xG",
    weight: 20,
    baseline: 0.16,
    anchors: [[0, 18], [0.07, 38], [0.16, 52], [0.28, 65], [0.42, 76], [0.6, 87], [0.85, 95]]
  },
  {
    key: "goalContribution",
    label: "Gol katkısı (G+A)",
    weight: 12,
    baseline: 0.28,
    anchors: [[0, 18], [0.12, 38], [0.28, 53], [0.45, 66], [0.65, 78], [0.9, 88], [1.3, 97]]
  }
];

const CREATIVITY_METRICS = [
  {
    key: "assists",
    label: "Asist",
    weight: 32,
    baseline: 0.11,
    anchors: [[0, 20], [0.05, 40], [0.11, 53], [0.2, 66], [0.32, 78], [0.48, 89], [0.7, 97]]
  },
  {
    key: "xa",
    label: "xA",
    weight: 18,
    baseline: 0.1,
    anchors: [[0, 20], [0.04, 40], [0.1, 53], [0.18, 66], [0.3, 79], [0.45, 90], [0.65, 97]]
  },
  {
    key: "keyPasses",
    label: "Kilit pas",
    weight: 24,
    baseline: 0.85,
    anchors: [[0, 20], [0.35, 40], [0.85, 55], [1.4, 68], [2.1, 80], [3, 90], [4, 97]]
  },
  {
    key: "dribbles",
    label: "Başarılı çalım",
    weight: 12,
    baseline: 0.7,
    anchors: [[0, 24], [0.3, 42], [0.7, 55], [1.3, 69], [2.1, 81], [3.2, 92], [4.5, 98]]
  },
  {
    key: "passAccuracy",
    label: "Pas isabeti",
    weight: 14,
    rate: true,
    anchors: [[40, 22], [55, 38], [65, 50], [75, 63], [82, 75], [88, 87], [93, 96]]
  }
];

const DEFENSE_METRICS = [
  {
    key: "tackles",
    label: "Müdahale (tackle)",
    weight: 24,
    baseline: 1.2,
    anchors: [[0, 18], [0.5, 38], [1.2, 54], [1.9, 67], [2.7, 79], [3.6, 90], [4.6, 97]]
  },
  {
    key: "interceptions",
    label: "Pas arası",
    weight: 22,
    baseline: 0.9,
    anchors: [[0, 18], [0.35, 38], [0.9, 54], [1.5, 68], [2.2, 80], [3, 90], [4, 97]]
  },
  {
    key: "blocks",
    label: "Blok",
    weight: 10,
    baseline: 0.25,
    anchors: [[0, 28], [0.12, 44], [0.25, 55], [0.5, 68], [0.85, 80], [1.3, 91], [1.9, 97]]
  },
  {
    key: "duelsWon",
    label: "Kazanılan ikili mücadele",
    weight: 24,
    baseline: 3.4,
    anchors: [[0, 18], [1.5, 38], [3.4, 55], [5.2, 68], [7.2, 80], [9.5, 91], [12, 97]]
  },
  {
    key: "recoveries",
    label: "Top kazanma",
    weight: 12,
    baseline: 3.2,
    anchors: [[0, 20], [1.4, 40], [3.2, 55], [5, 68], [7, 80], [9.5, 91], [12, 97]]
  },
  {
    key: "duelWinRate",
    label: "İkili mücadele kazanma %",
    weight: 8,
    rate: true,
    anchors: [[25, 20], [38, 38], [47, 52], [55, 66], [62, 78], [70, 90], [78, 97]]
  }
];

/** Kaleci kendi ölçüleriyle puanlanır: kurtarış, yenilen gol, clean sheet. */
const GOALKEEPER_METRICS = [
  {
    key: "saves",
    label: "Kurtarış",
    weight: 34,
    baseline: 2.6,
    anchors: [[0, 25], [1, 42], [2.6, 58], [3.6, 70], [4.6, 81], [5.8, 91], [7.2, 97]]
  },
  {
    key: "savePct",
    label: "Kurtarış yüzdesi",
    weight: 30,
    rate: true,
    anchors: [[40, 20], [55, 38], [66, 52], [72, 65], [78, 78], [84, 90], [90, 97]]
  },
  {
    key: "goalsConcededPer90",
    label: "Yenilen gol (90 dk)",
    weight: 24,
    inverted: true,
    anchors: [[0.2, 97], [0.6, 90], [0.9, 80], [1.2, 68], [1.5, 56], [2, 40], [2.8, 22]]
  },
  {
    key: "cleanSheetRate",
    label: "Gol yemeden bitirme %",
    weight: 12,
    rate: true,
    anchors: [[0, 25], [10, 40], [22, 54], [32, 66], [42, 78], [55, 90], [70, 97]]
  }
];

/* ------------------------------------------------------------------------ *
 * ORTAK METRİK ÇÖZÜMLEYİCİ
 * ------------------------------------------------------------------------ */

function formatMetricValue(metric, rawValue, per90Value) {
  if (metric.rate) return `%${round(rawValue, 1)}`;
  if (metric.inverted) return `${round(per90Value, 2)} / 90 dk`;
  return `${round(per90Value, 2)} / 90 dk`;
}

/**
 * Tek bir metriği çözer. Ölçüm yoksa `null` döner ve metrik ağırlığı
 * kategoriden tamamen düşer — sıfırla doldurulmaz.
 */
function resolveMetric(metric, sample) {
  const { minutes } = sample;

  if (metric.rate) {
    const value = sample.rates[metric.key];
    if (!isFiniteNumber(value)) return null;
    return {
      key: metric.key,
      label: metric.label,
      weight: metric.weight,
      score: clamp(curve(Number(value), metric.anchors), 0, 100),
      raw: Number(value),
      display: formatMetricValue(metric, Number(value), null)
    };
  }

  if (metric.inverted) {
    const value = sample.rates[metric.key];
    if (!isFiniteNumber(value)) return null;
    // Ters eğri: düğüm noktaları azalan puanlı yazılır, curve() yine artan
    // x üzerinde çalışır.
    return {
      key: metric.key,
      label: metric.label,
      weight: metric.weight,
      score: clamp(curve(Number(value), metric.anchors), 0, 100),
      raw: Number(value),
      display: formatMetricValue(metric, Number(value), Number(value))
    };
  }

  const total = sample.totals[metric.key];
  // Alanın kendi dakika tabanı; yoksa kaydın genel dakikası.
  const basis = sample.basis && isFiniteNumber(sample.basis[metric.key]) ? Number(sample.basis[metric.key]) : minutes;
  if (!isFiniteNumber(total) || !isFiniteNumber(basis) || Number(basis) <= 0) return null;

  const per90 = shrunkPer90(total, basis, metric.baseline);
  if (per90 === null) return null;

  // GÖSTERİLEN ORAN HAM ORANDIR. Küçültme (shrinkage) puanı hesaplarken
  // kullanılır ama okuyucuya gösterilmez: "0 müdahale · 0.96/90" satırı
  // okuyana ölçümü değil, modelin iç düzeltmesini gösterirdi.
  const rawPer90 = (Number(total) / Number(basis)) * 90;

  return {
    key: metric.key,
    label: metric.label,
    weight: metric.weight,
    score: clamp(curve(per90, metric.anchors), 0, 100),
    raw: Number(total),
    per90: rawPer90,
    display: `${round(Number(total), 2)} · ${round(rawPer90, 2)} / 90 dk`
  };
}

/**
 * Kategori puanı: mevcut metriklerin ağırlıklı ortalaması.
 *
 * `minWeight` — kategori yayımlanmadan önce toplam ağırlığın en az ne
 * kadarının ölçülmüş olması gerektiği. Tek bir yan metrikle (örn. yalnızca
 * pas isabeti) "Yaratıcılık 63" basmak, ölçülmemiş asist/kilit pas verisini
 * gizlice iyi varsaymak olurdu.
 */
function composeCategory(metrics, sample, options) {
  const minWeight = (options && options.minWeight) || 25;
  const resolved = metrics.map((metric) => resolveMetric(metric, sample)).filter(Boolean);
  const totalWeight = metrics.reduce((sum, metric) => sum + metric.weight, 0);
  const availableWeight = resolved.reduce((sum, item) => sum + item.weight, 0);

  if (!resolved.length || (availableWeight / totalWeight) * 100 < minWeight) {
    return {
      value: null,
      status: "insufficient",
      coverage: totalWeight ? round(availableWeight / totalWeight, 3) : 0,
      inputs: resolved.map((item) => ({ label: item.label, value: item.display }))
    };
  }

  const score = resolved.reduce((sum, item) => sum + item.score * item.weight, 0) / availableWeight;

  return {
    value: Math.round(clamp(score, 0, 100)),
    status: "computed",
    coverage: round(availableWeight / totalWeight, 3),
    inputs: resolved.map((item) => ({ label: item.label, value: item.display }))
  };
}

/* ------------------------------------------------------------------------ *
 * ÖRNEKLEM KURULUMU
 * ------------------------------------------------------------------------ */

/**
 * Bir oyuncunun ölçülmüş toplamlarını ve oranlarını tek yerde toplar.
 *
 * Üç kaynak birleşir ve HER BİRİ KENDİ DAKİKA TABANIYLA taşınır:
 *   • sezon kaydı (`player.stats`) — kanıt kapısından geçenler,
 *   • maç defteri (`context.ledger`) — arşivlenmiş maçlardan sayılanlar,
 *   • dışarıdan gelen ölçüm (`context.measuredStats`) — örn. lig gol krallığı.
 *
 * DAKİKA TABANI ALAN BAZINDA TAŞINIR, ÇÜNKÜ KAYNAKLARIN KAPSAMI FARKLI.
 * Maç defteri yalnızca arşivdeki iki maçı, gol krallığı tablosu ise sezonun
 * dördünü kapsayabilir. Şutu iki maçtan, dakikayı dört maçtan alıp bölmek
 * şut/90 oranını yarıya indirirdi — sayı uydurulmuş olmazdı ama YANLIŞ
 * olurdu. Bu yüzden her alan, kendisini sağlayan kaynağın dakikasıyla
 * normalize edilir; kaynaklar arasında en GENİŞ örneklem kazanır.
 */
function buildSample(player, ledger, extraStats) {
  const sources = [];
  const candidates = [];

  const seasonFields = [
    "appearances", "starts", "minutesPlayed", "goals", "assists", "shots", "shotsOnTarget",
    "keyPasses", "xg", "xa", "dribbles", "dribbleAttempts", "duelsWon", "duelsTotal",
    "tackles", "interceptions", "blocks", "recoveries", "foulsCommitted",
    "yellowCards", "redCards", "saves", "cleanSheets", "goalsConceded", "passes", "passAccuracy"
  ];

  // 1. Sezon kaydı.
  const seasonTotals = {};
  for (const field of seasonFields) {
    const value = measuredStat(player, field);
    if (value === null) continue;
    seasonTotals[field] = value;
  }
  if (seasonTotals.minutesPlayed === undefined) {
    const minutes = measuredStat(player, "minutes");
    if (minutes !== null) seasonTotals.minutesPlayed = minutes;
  }
  // MAÇ REYTİNGİ 0-10 ÖLÇEĞİNDEDİR, `player.rating` DEĞİL.
  //
  // Eski kayıtlarda `player.rating` 0-100 ölçeğinde bir genel puan (62, 66).
  // Onu maç reytingi sanmak "Sağlayıcı maç reytingi 66/10" gibi anlamsız bir
  // satır üretiyordu ve form puanını tavana yapıştırıyordu. Yalnızca
  // sağlayıcının kendi 0-10 alanı okunur ve ölçek açıkça doğrulanır.
  const seasonRating = [
    player && player.stats ? player.stats.rating : null,
    player ? player.providerRating : null,
    player ? player.matchRating : null
  ].map((value) => (isFiniteNumber(value) ? Number(value) : null)).find((value) => value !== null && value > 0 && value <= 10);
  if (seasonRating !== undefined && seasonRating !== null) seasonTotals.rating = seasonRating;
  if (Object.keys(seasonTotals).length) {
    candidates.push({ kind: "season", totals: seasonTotals, minutes: seasonTotals.minutesPlayed ?? null });
    sources.push({
      kind: "season",
      label: player.statsSource || player.sourceNote || player.providerName || "Sezon istatistikleri",
      verifiedAt: player.statsVerifiedAt || player.lastVerifiedAt || player.lastSyncedAt || null
    });
  }

  // 2. Maç defteri.
  const matches = Array.isArray(ledger) ? ledger : [];
  if (matches.length) {
    const ledgerTotals = aggregateLedger(matches);
    if (Object.keys(ledgerTotals).length) {
      candidates.push({ kind: "matches", totals: ledgerTotals, minutes: ledgerTotals.minutesPlayed ?? null });
      sources.push({
        kind: "matches",
        label: `Maç kayıtları (${matches.length} resmî maç)`,
        verifiedAt: matches[0] && matches[0].kickoff ? matches[0].kickoff : null
      });
    }
  }

  /**
   * 3. DIŞARIDAN GELEN ÖLÇÜM (örn. lig gol krallığı tablosu).
   *
   * `/players/topscorers` gerçek bir ölçüm uç noktası: gol, asist, maç ve
   * dakika hepsi sağlayıcının kendi sayımı. Bu değerler kanıt kapısına
   * girmez çünkü kapı "kayıttaki 0 ölçüm mü" sorusunu çözüyor; burada
   * kaynağın kendisi ölçüm olduğunu beyan ediyor.
   */
  if (extraStats && typeof extraStats === "object" && extraStats.totals) {
    const extraTotals = {};
    for (const [key, value] of Object.entries(extraStats.totals)) {
      if (isFiniteNumber(value)) extraTotals[key] = Number(value);
    }
    if (Object.keys(extraTotals).length) {
      candidates.push({ kind: extraStats.kind || "measured", totals: extraTotals, minutes: extraTotals.minutesPlayed ?? null });
      sources.push({
        kind: extraStats.kind || "measured",
        label: extraStats.label || "Sağlayıcı sezon ölçümü",
        verifiedAt: extraStats.verifiedAt || null
      });
    }
  }

  // Her alan için EN GENİŞ örneklemi taşıyan kaynak kazanır.
  const totals = {};
  const basis = {};
  const pick = (field) => {
    let best = null;
    for (const candidate of candidates) {
      const value = candidate.totals[field];
      if (!isFiniteNumber(value)) continue;
      const minutes = isFiniteNumber(candidate.minutes) ? Number(candidate.minutes) : 0;
      if (!best || minutes > best.minutes) best = { value: Number(value), minutes, kind: candidate.kind };
    }
    if (!best) return;
    totals[field] = best.value;
    basis[field] = best.minutes > 0 ? best.minutes : null;
  };

  for (const field of seasonFields.concat(["rating"])) pick(field);

  const minutes = isFiniteNumber(totals.minutesPlayed) ? Number(totals.minutesPlayed) : null;

  // Türetilmiş toplam: gol katkısı yalnızca ikisi de AYNI dakika tabanından
  // geldiğinde anlamlı.
  if (isFiniteNumber(totals.goals) && isFiniteNumber(totals.assists) && basis.goals === basis.assists) {
    totals.goalContribution = Number(totals.goals) + Number(totals.assists);
    basis.goalContribution = basis.goals;
  }

  // Oranlar kaynak İÇİNDE hesaplanır; kaynaklar arası bölme yapılmaz.
  const rates = {};
  const rateFrom = (compute) => {
    let best = null;
    for (const candidate of candidates) {
      const value = compute(candidate.totals);
      if (value === null || !Number.isFinite(value)) continue;
      const candidateMinutes = isFiniteNumber(candidate.minutes) ? Number(candidate.minutes) : 0;
      if (!best || candidateMinutes > best.minutes) best = { value, minutes: candidateMinutes };
    }
    return best ? best.value : null;
  };

  const passAccuracy = rateFrom((t) => (isFiniteNumber(t.passAccuracy) && Number(t.passAccuracy) > 0 ? Number(t.passAccuracy) : null));
  if (passAccuracy !== null) rates.passAccuracy = passAccuracy;

  const duelWinRate = rateFrom((t) => (isFiniteNumber(t.duelsWon) && isFiniteNumber(t.duelsTotal) && Number(t.duelsTotal) > 0
    ? (Number(t.duelsWon) / Number(t.duelsTotal)) * 100
    : null));
  if (duelWinRate !== null) rates.duelWinRate = duelWinRate;

  const savePct = rateFrom((t) => {
    if (!isFiniteNumber(t.saves) || !isFiniteNumber(t.goalsConceded)) return null;
    const faced = Number(t.saves) + Number(t.goalsConceded);
    return faced > 0 ? (Number(t.saves) / faced) * 100 : null;
  });
  if (savePct !== null) rates.savePct = savePct;

  const concededPer90 = rateFrom((t) => (isFiniteNumber(t.goalsConceded) && isFiniteNumber(t.minutesPlayed) && Number(t.minutesPlayed) > 0
    ? (Number(t.goalsConceded) / Number(t.minutesPlayed)) * 90
    : null));
  if (concededPer90 !== null) rates.goalsConcededPer90 = concededPer90;

  const cleanSheetRate = rateFrom((t) => (isFiniteNumber(t.cleanSheets) && isFiniteNumber(t.appearances) && Number(t.appearances) > 0
    ? (Number(t.cleanSheets) / Number(t.appearances)) * 100
    : null));
  if (cleanSheetRate !== null) rates.cleanSheetRate = cleanSheetRate;

  return { totals, basis, rates, minutes, matches, sources };
}

/** Maç defterindeki sayıları toplar. Alan yoksa toplama girmez. */
function aggregateLedger(matches) {
  const fields = ["minutes", "goals", "assists", "shots", "shotsOnTarget", "keyPasses",
    "tackles", "interceptions", "blocks", "duelsWon", "duelsTotal", "saves",
    "yellowCards", "redCards", "foulsCommitted", "passes"];
  const totals = {};
  let appearances = 0;
  let starts = 0;

  for (const match of matches) {
    if (match.played) appearances += 1;
    if (match.started) starts += 1;
    for (const field of fields) {
      if (!isFiniteNumber(match[field])) continue;
      totals[field] = (totals[field] || 0) + Number(match[field]);
    }
  }

  const mapped = {};
  for (const [key, value] of Object.entries(totals)) {
    mapped[key === "minutes" ? "minutesPlayed" : key] = value;
  }
  if (appearances > 0) mapped.appearances = appearances;
  if (starts > 0) mapped.starts = starts;
  return mapped;
}

/* ------------------------------------------------------------------------ *
 * KATEGORİLER
 * ------------------------------------------------------------------------ */

/**
 * DİSİPLİN — az olumsuz olay = yüksek puan.
 *
 * 100'den başlanır; kart ve faul yükü düşülür. Kart alanı 0 olabilir ve bu
 * GERÇEK bir ölçümdür — ama yalnızca kart verisi kanıt kapısından geçtiyse.
 * Aksi hâlde "hiç kart görmedi" iddiası, kadro senkronunun varsayılanından
 * ibaret olurdu.
 */
function disciplineCategory(sample) {
  const { totals, minutes } = sample;
  const yellow = totals.yellowCards;
  const red = totals.redCards;
  const fouls = totals.foulsCommitted;

  if (!isFiniteNumber(yellow) && !isFiniteNumber(red)) {
    return { value: null, status: "insufficient", coverage: 0, inputs: [] };
  }
  const basis = sample.basis && isFiniteNumber(sample.basis.yellowCards)
    ? Number(sample.basis.yellowCards)
    : minutes;
  if (!isFiniteNumber(basis) || Number(basis) <= 0) {
    return { value: null, status: "insufficient", coverage: 0, inputs: [] };
  }

  // KÜÇÜK ÖRNEKLEMDE "SIFIR KART" MÜKEMMEL DEĞİLDİR.
  //
  // Üç maçta kart görmemiş bir oyuncuya 100/100 disiplin vermek, ölçümün
  // taşıyabileceğinden fazlasını iddia eder. Kart yükü de diğer oranlar gibi
  // lig ortalamasına doğru küçültülür (bkz. shrunkPer90); dakika arttıkça
  // oyuncunun kendi sicili ağırlığını kazanır.
  const yellowPer90 = shrunkPer90(isFiniteNumber(yellow) ? yellow : 0, basis, 0.22) ?? 0;
  const redPer90 = shrunkPer90(isFiniteNumber(red) ? red : 0, basis, 0.012) ?? 0;
  const rawPer90 = (value) => (isFiniteNumber(value) ? (Number(value) / Number(basis)) * 90 : null);
  const foulsPer90 = isFiniteNumber(fouls) ? shrunkPer90(fouls, basis, 1.05) : null;

  let score = 100;
  score -= yellowPer90 * 78;
  score -= redPer90 * 190;
  if (foulsPer90 !== null) score -= Math.max(0, foulsPer90 - 0.9) * 9;

  const inputs = [];
  if (isFiniteNumber(yellow)) inputs.push({ label: "Sarı kart", value: `${round(yellow, 0)} · ${round(rawPer90(yellow), 2)} / 90 dk` });
  if (isFiniteNumber(red)) inputs.push({ label: "Kırmızı kart", value: `${round(red, 0)}` });
  if (isFiniteNumber(fouls)) inputs.push({ label: "Faul", value: `${round(fouls, 0)} · ${round(rawPer90(fouls), 2)} / 90 dk` });

  return {
    value: Math.round(clamp(score, 0, 100)),
    status: "computed",
    coverage: isFiniteNumber(fouls) ? 1 : 0.75,
    inputs
  };
}

/**
 * SÜREKLİLİK — sahada kalma ve istikrar.
 *
 * Üç bileşen: takımın oynadığı maçlara göre dakika payı, ilk 11 oranı ve
 * (maç defteri varsa) maçtan maça performans istikrarı. Takımın oynadığı
 * maç sayısı bilinmiyorsa dakika payı hesaplanamaz; o zaman ortalama maç
 * süresi ikinci en iyi ölçü olarak devreye girer.
 */
function durabilityCategory(sample, context) {
  const { totals, minutes, matches } = sample;
  const appearances = totals.appearances;
  const reportedTeamMatches = context && isFiniteNumber(context.teamMatchesPlayed) ? Number(context.teamMatchesPlayed) : null;

  /**
   * PAYDA, PAYLA AYNI SEZONDAN OLMAK ZORUNDA.
   *
   * Eski kürasyonlu kayıtlarda maç sayısı geçen sezonun toplamı (21 maç),
   * puan durumu ise bu sezonun (4 maç). İkisini bölmek "%100 dakika payı,
   * 21/4 maç" gibi hem yanlış hem de saçma bir satır üretiyordu. Oyuncunun
   * maç sayısı takımınkini aşıyorsa iki sayı aynı sezondan değildir; takım
   * paydası kullanılmaz.
   */
  const teamMatches = reportedTeamMatches !== null
    && isFiniteNumber(appearances)
    && Number(appearances) <= reportedTeamMatches
    ? reportedTeamMatches
    : null;

  if (!isFiniteNumber(minutes) || Number(minutes) <= 0 || !isFiniteNumber(appearances) || Number(appearances) <= 0) {
    return { value: null, status: "insufficient", coverage: 0, inputs: [] };
  }

  // SÜREKLİLİK TEK MAÇTAN OKUNMAZ. Takımın kaç maç oynadığı bilinmiyorsa ve
  // elimizde iki maçtan azı varsa, "90 dakika oynadı" bilgisi süreklilik
  // hakkında hiçbir şey söylemez — 96/100 basmak ölçümün taşımadığı bir
  // iddia olurdu.
  if ((!teamMatches || teamMatches <= 0) && Number(appearances) < 3) {
    return { value: null, status: "insufficient", coverage: 0, inputs: [] };
  }

  const parts = [];
  const inputs = [];

  if (teamMatches && teamMatches > 0) {
    const share = clamp((Number(minutes) / (teamMatches * 90)) * 100, 0, 100);
    parts.push({ score: curve(share, [[0, 12], [15, 32], [30, 48], [50, 64], [68, 78], [82, 90], [93, 97]]), weight: 42 });
    inputs.push({ label: "Takım maçlarındaki dakika payı", value: `%${round(share, 1)} (${round(minutes, 0)} dk / ${teamMatches} maç)` });
    const availability = clamp((Number(appearances) / teamMatches) * 100, 0, 100);
    parts.push({ score: curve(availability, [[0, 12], [25, 35], [45, 52], [65, 68], [80, 82], [92, 93], [100, 98]]), weight: 20 });
    inputs.push({ label: "Kadroda yer alma", value: `${round(appearances, 0)} / ${teamMatches} maç` });
  } else {
    inputs.push({ label: "Maç", value: `${round(appearances, 0)}` });
    inputs.push({ label: "Dakika", value: `${round(minutes, 0)}` });
  }

  const minutesPerMatch = Number(minutes) / Number(appearances);
  parts.push({ score: curve(minutesPerMatch, [[0, 15], [25, 38], [45, 52], [62, 66], [75, 80], [85, 92], [90, 96]]), weight: 30 });
  inputs.push({ label: "Maç başına dakika", value: `${round(minutesPerMatch, 1)} dk` });

  if (isFiniteNumber(totals.starts) && Number(appearances) > 0) {
    const startRate = clamp((Number(totals.starts) / Number(appearances)) * 100, 0, 100);
    parts.push({ score: curve(startRate, [[0, 25], [20, 42], [40, 55], [60, 68], [78, 82], [92, 93], [100, 97]]), weight: 24 });
    inputs.push({ label: "İlk 11 oranı", value: `%${round(startRate, 0)} (${round(totals.starts, 0)} / ${round(appearances, 0)})` });
  }

  const ratings = (matches || []).map((match) => Number(match.rating)).filter((value) => Number.isFinite(value) && value > 0);
  if (ratings.length >= 3) {
    const mean = ratings.reduce((sum, value) => sum + value, 0) / ratings.length;
    const variance = ratings.reduce((sum, value) => sum + (value - mean) ** 2, 0) / ratings.length;
    const deviation = Math.sqrt(variance);
    // Düşük sapma = maçtan maça istikrar.
    parts.push({ score: curve(deviation, [[0.15, 96], [0.3, 88], [0.5, 76], [0.7, 63], [0.95, 50], [1.3, 35], [1.8, 22]]), weight: 22 });
    inputs.push({ label: "Maçtan maça istikrar", value: `±${round(deviation, 2)} puan sapma (${ratings.length} maç)` });
  }

  const weightSum = parts.reduce((sum, part) => sum + part.weight, 0) || 1;
  const score = parts.reduce((sum, part) => sum + clamp(part.score, 0, 100) * part.weight, 0) / weightSum;

  return { value: Math.round(clamp(score, 0, 100)), status: "computed", coverage: round(weightSum / 138, 3), inputs };
}

/**
 * FORM — son 5-10 resmî maç.
 *
 * Öncelik maç defterinde: en yeni on maç alınır, son maçlar daha ağır tartar
 * (üstel sönüm). Her maçın puanı sağlayıcı maç reytingi (0-10) ve gol
 * katkısından oluşur.
 *
 * Defter yoksa SEZON TOPLAMI kullanılabilir — ama yalnızca örneklem gerçekten
 * yakın döneme aitse. Sezon başında 4 maçlık bir toplam zaten "son 4 maç"
 * demektir; 30 maçlık bir toplam ise form değil ortalamadır ve form satırı
 * hesaplanamaz sayılır.
 */
const FORM_WINDOW = 10;
const SEASON_AS_FORM_MAX_APPEARANCES = 12;

/** 0-10 sağlayıcı maç reytingini 0-100 puana çeviren eğri. */
const MATCH_RATING_ANCHORS = [[4.5, 20], [5.5, 38], [6, 50], [6.5, 62], [7, 73], [7.5, 84], [8.2, 93], [9, 98]];

/**
 * FORM — son 5-10 resmî maç.
 *
 * Öncelik maç defterinde: en yeni on maç alınır, son maçlar daha ağır tartar
 * (üstel sönüm). Her maçın puanı sağlayıcı maç reytingi (0-10) ve rolüne
 * uygun katkıdan oluşur.
 *
 * Defter yoksa SEZON TOPLAMI kullanılabilir — ama yalnızca örneklem gerçekten
 * yakın döneme aitse. Sezon başında 4 maçlık bir toplam zaten "son 4 maç"
 * demektir; 30 maçlık bir toplam ise form değil ortalamadır ve form satırı
 * hesaplanamaz sayılır.
 *
 * KALECİDE GOL KATKISI FORM SİNYALİ DEĞİLDİR. Kalecinin 0 gol + 0 asisti
 * "kötü form" değil, mevkisinin tanımı. Kaleci formu maç reytingi, kurtarış
 * ve yenilen golle okunur; hiçbiri yoksa kategori hesaplanamaz kalır —
 * gol katkısından türetilmiş bir sayı basmak yanlış olurdu.
 */
function formCategory(sample, context) {
  const ledgerForm = ledgerFormCandidate(sample, context);
  const seasonForm = seasonFormCandidate(sample, context);

  /**
   * İKİ ADAY ARASINDAN GENİŞ ÖRNEKLEM KAZANIR.
   *
   * Maç defteri daha ayrıntılı (maç reytingi taşır) ama kapsamı dar: bir
   * oyuncunun arşivde tek maçı, gol krallığı tablosunda dört maçı olabilir.
   * Tek maçlık defteri dört maçlık sezona tercih etmek, formu son doksan
   * dakikaya indirger. Eşitlikte defter kazanır — o daha yeni ve daha
   * ayrıntılı olandır.
   */
  const candidates = [ledgerForm, seasonForm].filter((item) => item && item.status === "computed");
  if (!candidates.length) return { value: null, status: "insufficient", coverage: 0, inputs: [] };
  candidates.sort((a, b) => (Number(b.window) || 0) - (Number(a.window) || 0));
  return candidates[0];
}

/** Maç defterinden form: en yeni on maç, üstel sönümle tartılır. */
function ledgerFormCandidate(sample, context) {
  const isGoalkeeper = Boolean(context && context.goalkeeper);
  const matches = (sample.matches || []).slice(0, FORM_WINDOW);

  if (matches.length) {
    let weightSum = 0;
    let scoreSum = 0;
    let goals = 0;
    let assists = 0;
    let saves = 0;
    let minutes = 0;
    let rated = 0;

    matches.forEach((match, index) => {
      const decay = 0.88 ** index;
      const rating = Number(match.rating);
      const played = isFiniteNumber(match.minutes) ? Number(match.minutes) : 0;
      minutes += played;
      goals += isFiniteNumber(match.goals) ? Number(match.goals) : 0;
      assists += isFiniteNumber(match.assists) ? Number(match.assists) : 0;
      saves += isFiniteNumber(match.saves) ? Number(match.saves) : 0;

      let matchScore = null;
      if (Number.isFinite(rating) && rating > 0 && rating <= 10) {
        matchScore = curve(rating, MATCH_RATING_ANCHORS);
        rated += 1;
      }

      if (!isGoalkeeper) {
        const contribution = (isFiniteNumber(match.goals) ? Number(match.goals) : 0)
          + (isFiniteNumber(match.assists) ? Number(match.assists) : 0) * 0.75;
        if (contribution > 0) {
          const bonus = Math.min(18, contribution * 9);
          matchScore = matchScore === null ? clamp(55 + bonus, 0, 100) : clamp(matchScore + bonus, 0, 100);
        }
      }

      if (matchScore === null) return;
      weightSum += decay;
      scoreSum += matchScore * decay;
    });

    if (weightSum > 0) {
      const inputs = [{ label: "Değerlendirilen maç", value: `${matches.length} resmî maç` }];
      if (minutes > 0) inputs.push({ label: "Toplam süre", value: `${round(minutes, 0)} dk` });
      if (rated > 0) inputs.push({ label: "Maç reytingi olan maç", value: `${rated} / ${matches.length}` });
      if (isGoalkeeper) {
        if (saves > 0) inputs.push({ label: "Kurtarış", value: `${round(saves, 0)}` });
      } else if (goals || assists) {
        inputs.push({ label: "Gol + asist", value: `${round(goals, 0)} gol · ${round(assists, 0)} asist` });
      }
      const last = matches[0];
      if (last && last.competition) inputs.push({ label: "Son maç", value: String(last.competition) });

      return {
        value: Math.round(clamp(scoreSum / weightSum, 0, 100)),
        status: "computed",
        coverage: round(Math.min(1, matches.length / 5), 3),
        window: matches.length,
        inputs
      };
    }
  }

  return { value: null, status: "insufficient", coverage: 0, inputs: [] };
}

/** Sezon toplamı yakın dönem örneklemi ise form olarak okunabilir. */
function seasonFormCandidate(sample, context) {
  const isGoalkeeper = Boolean(context && context.goalkeeper);
  const appearances = sample.totals.appearances;
  const minutes = sample.minutes;
  if (!isFiniteNumber(appearances) || Number(appearances) <= 0 || !isFiniteNumber(minutes) || Number(minutes) <= 0) {
    return { value: null, status: "insufficient", coverage: 0, inputs: [] };
  }
  if (Number(appearances) > SEASON_AS_FORM_MAX_APPEARANCES) {
    return { value: null, status: "insufficient", coverage: 0, inputs: [] };
  }

  const seasonRating = Number(sample.totals.rating);
  const inputs = [{ label: "Değerlendirilen maç", value: `${round(appearances, 0)} resmî maç (sezon başı)` }];
  inputs.push({ label: "Süre", value: `${round(minutes, 0)} dk` });

  const parts = [];
  if (Number.isFinite(seasonRating) && seasonRating > 0 && seasonRating <= 10) {
    parts.push({ score: curve(seasonRating, MATCH_RATING_ANCHORS), weight: 55 });
    inputs.push({ label: "Sağlayıcı maç reytingi", value: `${round(seasonRating, 2)} / 10` });
  }

  if (isGoalkeeper) {
    if (isFiniteNumber(sample.rates.savePct)) {
      parts.push({ score: curve(Number(sample.rates.savePct), [[40, 20], [55, 38], [66, 52], [72, 65], [78, 78], [84, 90], [90, 97]]), weight: 45 });
      inputs.push({ label: "Kurtarış yüzdesi", value: `%${round(sample.rates.savePct, 1)}` });
    } else if (isFiniteNumber(sample.rates.goalsConcededPer90)) {
      parts.push({ score: curve(Number(sample.rates.goalsConcededPer90), [[0.2, 97], [0.6, 90], [0.9, 80], [1.2, 68], [1.5, 56], [2, 40], [2.8, 22]]), weight: 45 });
      inputs.push({ label: "Yenilen gol (90 dk)", value: `${round(sample.rates.goalsConcededPer90, 2)}` });
    }
  } else if (isFiniteNumber(sample.totals.goalContribution)) {
    const basis = sample.basis && isFiniteNumber(sample.basis.goalContribution) ? Number(sample.basis.goalContribution) : minutes;
    const shrunk = shrunkPer90(sample.totals.goalContribution, basis, 0.28);
    const raw = (Number(sample.totals.goalContribution) / basis) * 90;
    parts.push({ score: curve(shrunk, [[0, 26], [0.12, 42], [0.28, 55], [0.45, 67], [0.65, 79], [0.9, 89], [1.3, 97]]), weight: 45 });
    inputs.push({
      label: "Gol katkısı",
      value: `${round(sample.totals.goals ?? 0, 0)} gol · ${round(sample.totals.assists ?? 0, 0)} asist · ${round(raw, 2)} / 90 dk`
    });
  }

  if (!parts.length) {
    return { value: null, status: "insufficient", coverage: 0, inputs: [] };
  }

  const weightSum = parts.reduce((sum, part) => sum + part.weight, 0);
  const score = parts.reduce((sum, part) => sum + clamp(part.score, 0, 100) * part.weight, 0) / weightSum;

  return {
    value: Math.round(clamp(score, 0, 100)),
    status: "computed",
    coverage: round(weightSum / 100, 3),
    window: Number(appearances),
    inputs
  };
}

/**
 * YAŞA GÖRE GELİŞİM PAYI.
 *
 * 0-1 arası bir katsayı: oyuncunun mevcut seviyesiyle tavanı arasındaki
 * boşluğun ne kadarının hâlâ kapanabileceği. 18 yaşında neredeyse tamamı,
 * 32 yaşında neredeyse hiçbiri.
 */
function ageHeadroom(age) {
  if (!isFiniteNumber(age)) return null;
  const value = Number(age);
  const anchors = [[16, 1], [18, 0.96], [19, 0.9], [20, 0.84], [21, 0.76], [22, 0.68], [23, 0.58],
    [24, 0.48], [25, 0.38], [26, 0.29], [27, 0.22], [28, 0.16], [29, 0.11], [30, 0.07],
    [31, 0.05], [32, 0.03], [34, 0.01], [38, 0]];
  return clamp(curve(value, anchors), 0, 1);
}

/**
 * POTANSİYEL — yaş + mevcut performans + gelişim trendi.
 *
 * Genç oyuncuda gelişim payı daha ağır tartar: aynı 70'lik mevcut performans
 * 19 yaşında 89, 30 yaşında 72 potansiyel üretir. Trend (son form ile sezon
 * ortalaması arasındaki fark) ikisinin üstüne küçük bir düzeltme ekler.
 */
function potentialCategory(sample, context, currentScore, formScore) {
  const age = context && isFiniteNumber(context.age) ? Number(context.age) : null;
  const headroom = ageHeadroom(age);

  if (headroom === null || currentScore === null) {
    return { value: null, status: "insufficient", coverage: 0, inputs: [] };
  }

  const inputs = [{ label: "Yaş", value: `${round(age, 0)}` }];
  inputs.push({ label: "Mevcut performans", value: `${Math.round(currentScore)} / 100` });
  inputs.push({ label: "Yaşa bağlı gelişim payı", value: `%${round(headroom * 100, 0)}` });

  let trend = 0;
  if (formScore !== null && Number.isFinite(formScore)) {
    trend = clamp((formScore - currentScore) / 10, -1.2, 1.2);
    inputs.push({
      label: "Gelişim trendi",
      value: `${trend >= 0 ? "+" : ""}${round(trend * 10, 1)} puan (form ↔ sezon)`
    });
  }

  // Genç oyuncuda trend de daha ağır tartar: yükselişteki 20 yaşındaki bir
  // oyuncunun eğrisi, aynı yükselişteki 30 yaşındakinden anlamlıdır.
  const trendBonus = trend * (4 + headroom * 6);
  const score = currentScore + (100 - currentScore) * headroom * 0.68 + trendBonus;

  return {
    value: Math.round(clamp(score, 0, 100)),
    status: "computed",
    coverage: formScore === null ? 0.7 : 1,
    inputs
  };
}

/* ------------------------------------------------------------------------ *
 * OVERALL
 * ------------------------------------------------------------------------ */

/**
 * OVERALL — mevcut kategorilerin mevkiye göre ağırlıklı ortalaması.
 *
 * Hesaplanamayan kategorinin ağırlığı SİLİNİR, sıfırla doldurulmaz: ölçüm
 * yokluğu kötü performans değildir. Ama tabanı çok dar bir overall de
 * yanıltıcıdır; toplam ağırlığın en az %45'i ölçülmüş olmalı.
 */
const MIN_OVERALL_WEIGHT_COVERAGE = 0.45;

function weightedOverall(categories, weights) {
  let available = 0;
  let total = 0;
  let sum = 0;
  const inputs = [];

  for (const [key, weight] of Object.entries(weights)) {
    total += weight;
    const category = categories[key];
    if (!category || category.status !== "computed" || !isFiniteNumber(category.value)) continue;
    available += weight;
    sum += Number(category.value) * weight;
    inputs.push({ label: `${CATEGORY_LABELS[key] || key} (ağırlık %${weight})`, value: `${category.value} / 100` });
  }

  if (!available || available / total < MIN_OVERALL_WEIGHT_COVERAGE) {
    return { value: null, status: "insufficient", coverage: total ? round(available / total, 3) : 0, inputs };
  }

  return {
    value: Math.round(clamp(sum / available, 0, 100)),
    status: "computed",
    coverage: round(available / total, 3),
    inputs
  };
}

/* ------------------------------------------------------------------------ *
 * GİRİŞ NOKTASI
 * ------------------------------------------------------------------------ */

/**
 * Kimlik kapısından geçemeyen kayıt için boş blok.
 *
 * Kategoriler "insufficient" döner — sayfada "Veri yetersiz" olarak görünür,
 * sıfır ya da tire değil. Gerekçe çıktının içinde taşınır ki denetimde
 * "neden boş" sorusu veri dosyasından cevaplanabilsin.
 */
function withheldScores(group, now, reasons) {
  const isGoalkeeper = group === "goalkeeper";
  const labels = isGoalkeeper ? GOALKEEPER_CATEGORY_LABELS : CATEGORY_LABELS;
  const categories = {};

  for (const key of RATING_CATEGORY_ORDER) {
    const notApplicable = isGoalkeeper && GOALKEEPER_NOT_APPLICABLE.has(key);
    categories[key] = {
      key,
      label: labels[key] || key,
      value: null,
      status: notApplicable ? "not-applicable" : "insufficient",
      display: notApplicable ? NOT_APPLICABLE_LABEL : INSUFFICIENT_LABEL,
      coverage: 0,
      window: null,
      inputs: []
    };
  }

  return {
    version: 1,
    scheme: isGoalkeeper ? "goalkeeper" : "outfield",
    positionGroup: group,
    status: "insufficient",
    computedCategories: 0,
    coverage: 0,
    updatedAt: now.toISOString(),
    weights: POSITION_WEIGHTS[group] || FALLBACK_WEIGHTS,
    categories,
    withheldReasons: Array.isArray(reasons) ? reasons : [],
    sources: [],
    sampleWindow: { matches: null, minutes: null }
  };
}

function normalizePositionGroup(group) {
  const normalized = String(group || "").toLowerCase();
  if (POSITION_WEIGHTS[normalized]) return normalized;
  return "unknown";
}

/**
 * Bir oyuncunun sekiz satırlık puan bloğunu üretir.
 *
 * @param {object} player normalize edilmiş oyuncu kaydı
 * @param {object} [context]
 * @param {Array}  [context.ledger] maç defteri kayıtları (en yeni önce)
 * @param {number} [context.teamMatchesPlayed] takımın oynadığı maç sayısı
 * @param {string} [context.positionGroup] mevki grubu (verilmezse kayıttan)
 * @param {Date}   [context.now] hesap zamanı
 * @returns {object} ratingScores bloğu
 */
function computePlayerRatingScores(player, context) {
  const options = context || {};
  const now = options.now instanceof Date ? options.now : new Date();
  const group = normalizePositionGroup(options.positionGroup || (player && player.positionGroup));

  /**
   * KİMLİK KAPISI ÖNCE.
   *
   * Ölçüm kapısı (measuredStat) "bu sayı gerçekten ölçüldü mü" sorusunu
   * çözüyor; ama bir sayının ölçülmüş olması, ONU TAŞIYAN KAYDIN gerçek bir
   * oyuncuya ait olduğunu göstermez. Yer tutucu ("mock-") kimlikli ya da
   * kaynağı gösterilemeyen bir kayıttan puan yayımlamak, sitenin geri
   * kalanında tavizsiz uygulanan kuralı (services/cardCredibility.js) tam
   * da en görünür yüzeyde delerdi.
   *
   * Tazelik kuralı burada UYGULANMAZ: puan kendi zaman damgasını ve
   * dayandığı maçların tarihini birlikte yayımlıyor (bkz.
   * evaluatePlayerIdentity'deki karar notu).
   */
  const identity = evaluatePlayerIdentity(player);
  if (!identity.publishable) {
    return withheldScores(group, now, identity.reasons);
  }
  const isGoalkeeper = group === "goalkeeper";
  const weights = POSITION_WEIGHTS[group] || FALLBACK_WEIGHTS;
  const sample = buildSample(player || {}, options.ledger, options.measuredStats);

  const age = isFiniteNumber(options.age) ? Number(options.age)
    : isFiniteNumber(player && (player.computedAge ?? player.age)) ? Number(player.computedAge ?? player.age)
      : null;
  const categoryContext = { ...options, age, now, goalkeeper: isGoalkeeper };

  const categories = {};

  if (isGoalkeeper) {
    // Kalecinin hücum ve yaratıcılık satırları ölçülemediği için değil,
    // mevkisinin tanımı gereği boş: "Veri yetersiz" demek yanlış bir vaat
    // olurdu (veri gelse de bu satırlar dolmayacak).
    for (const key of GOALKEEPER_NOT_APPLICABLE) {
      categories[key] = { value: null, status: "not-applicable", coverage: 0, inputs: [] };
    }
    categories.defense = composeCategory(GOALKEEPER_METRICS, sample, { minWeight: 30 });
  } else {
    categories.attack = composeCategory(ATTACK_METRICS, sample, { minWeight: 30 });
    categories.creativity = composeCategory(CREATIVITY_METRICS, sample, { minWeight: 25 });
    categories.defense = composeCategory(DEFENSE_METRICS, sample, { minWeight: 22 });
  }

  categories.discipline = disciplineCategory(sample);
  categories.durability = durabilityCategory(sample, categoryContext);
  categories.form = formCategory(sample, categoryContext);

  // Potansiyelin "mevcut performans" tabanı, potansiyel HARİÇ ağırlıklarla
  // kurulur — kendi kendini beslemesin.
  const coreWeights = { ...weights };
  delete coreWeights.potential;
  const core = weightedOverall(categories, coreWeights);
  categories.potential = potentialCategory(
    sample,
    categoryContext,
    core.status === "computed" ? core.value : null,
    categories.form.status === "computed" ? categories.form.value : null
  );

  categories.overall = weightedOverall(categories, weights);

  const decorated = {};
  const labels = isGoalkeeper ? GOALKEEPER_CATEGORY_LABELS : CATEGORY_LABELS;
  for (const key of RATING_CATEGORY_ORDER) {
    const category = categories[key] || { value: null, status: "insufficient", coverage: 0, inputs: [] };
    decorated[key] = {
      key,
      label: labels[key] || key,
      value: category.status === "computed" ? category.value : null,
      status: category.status,
      display: category.status === "computed"
        ? String(category.value)
        : category.status === "not-applicable" ? NOT_APPLICABLE_LABEL : INSUFFICIENT_LABEL,
      coverage: category.coverage || 0,
      window: category.window || null,
      inputs: Array.isArray(category.inputs) ? category.inputs : []
    };
  }

  const computedCount = RATING_CATEGORY_ORDER.filter((key) => decorated[key].status === "computed").length;

  return {
    version: 1,
    scheme: isGoalkeeper ? "goalkeeper" : "outfield",
    positionGroup: group,
    status: computedCount > 0 ? "computed" : "insufficient",
    computedCategories: computedCount,
    coverage: round(computedCount / RATING_CATEGORY_ORDER.length, 3),
    updatedAt: now.toISOString(),
    weights,
    categories: decorated,
    sources: sample.sources,
    sampleWindow: {
      matches: sample.matches.length || (isFiniteNumber(sample.totals.appearances) ? Number(sample.totals.appearances) : null),
      minutes: sample.minutes
    }
  };
}

module.exports = {
  CATEGORY_LABELS,
  GOALKEEPER_CATEGORY_LABELS,
  INSUFFICIENT_LABEL,
  NOT_APPLICABLE_LABEL,
  MIN_OVERALL_WEIGHT_COVERAGE,
  POSITION_WEIGHTS,
  PRIOR_MINUTES,
  RATING_CATEGORY_ORDER,
  ageHeadroom,
  computePlayerRatingScores,
  curve,
  measuredStat,
  shrunkPer90
};
