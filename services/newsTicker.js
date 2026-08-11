/**
 * SON DAKİKA BANDI — KÜRATÖRLÜ KAYNAK VE GÜVEN MODELİ
 *
 * Bant bugüne kadar yalnızca TÜRETİLMİŞ kaynaklardan besleniyordu: maç
 * sonuçları, onaylı transferler, doğrulanmış editoryal haberler. Bunların
 * hepsi doğruydu ama hepsi de "olmuş bitmiş" şeylerdi. Futbol gündeminin
 * büyük kısmı ise henüz kesinleşmemiş bilgiden oluşur: transfer iddiaları,
 * teknik direktör sözleri, sakatlık haberleri.
 *
 * Bu dosya o boşluğu doldurur — ama TEK BİR SERT KURALLA:
 *
 *     KESİNLEŞMEMİŞ BİR BİLGİ, KESİNLEŞMİŞ GİBİ GÖSTERİLEMEZ.
 *
 * Kural iyi niyete bırakılmıyor, YAPIYA gömülüyor:
 *
 *   1. Her öğe bir `confidence` taşımak ZORUNDA. Alan eksikse öğe banda
 *      hiç girmez — "belirtilmemiş" varsayılan olarak "kesin" sayılmaz.
 *   2. Kesinleşmemiş öğelerde güven rozetini ÇİZEN taraf şablondur, yazan
 *      taraf değil. Editör rozeti "unutamaz", çünkü rozet metinden değil
 *      `confidence` alanından üretilir.
 *   3. `transfer-rumour` kategorisi `confirmed` güveniyle birlikte
 *      KULLANILAMAZ. Kesinleşmiş bir transfer artık iddia değildir; yeri
 *      `official` kategorisidir. Çelişki doğrulamada reddedilir.
 *   4. Kesinleşmemiş bir öğenin METNİ kesinlik fiili taşıyamaz ("resmen",
 *      "imzaladı", "duyurdu"...). Rozet "Söylenti" derken cümle "imzaladı"
 *      diyorsa okuyucu cümleye inanır. Doğrulama bunu reddeder.
 *   5. Ve tersi de zorunlu: kesinleşmemiş bir öğenin metni ÇEKİNCE İFADESİ
 *      TAŞIMAK ZORUNDA ("iddia", "öne sürüldü", "aktarıldı", "görüşmeler
 *      sürüyor"...). Rozet ekranda küçüktür, cümle büyüktür; çekince
 *      yalnızca rozette kalırsa okuyucu onu görmeden geçer.
 *
 * KAYNAK ZORUNLU. Kaynağı gösterilemeyen bir iddia yayımlanmaz; söylenti
 * bandı, kaynaksız söylenti bandı demek değildir.
 *
 * RAF ÖMRÜ ZORUNLU. Bir başlık "gündem" olmaktan çıktığı anda banttan da
 * çıkmalı. Üç ayrı mekanizma bunu sağlıyor ve üçü de bu dosyada:
 *
 *   • KATEGORİ RAF ÖMRÜ  — haber değeri kategoriye göre farklı hızda tükenir.
 *   • `breaking` PENCERESİ — son dakika bir zaman iddiasıdır; 24 saat sonra
 *     öğe "son dakika" olmaktan çıkar (gelişme sürüyorsa `developing`).
 *   • `expiresAt`        — maç duyurusu gibi tarihi geçince anlamı kalmayan
 *     kayıtlar için sert son kullanma tarihi. Kalıcı duyuruların bantta
 *     süresiz asılı kalmasını bu alan engeller.
 *
 * SIRALAMA EDİTORYALDİR. Gündem sırası "en yeni en üstte" değildir: önce
 * son dakika, sonra dört büyükler, sonra Avrupa kupalarındaki Türk
 * kulüpleri, sonra Süper Lig, sonra büyük Avrupa kulüpleri gelir. Bu sıra
 * `editorialRank` içinde tek bir yerde yazılı.
 */

const { isMajorClubName } = require("./majorClubs");
const { isTurkishLeague, isTurkishTeamName } = require("./turkishTeams");
const { normalizeText } = require("../api/_utils");

/**
 * Kategoriler. Anahtar veri dosyasında, etiket ekranda görünür.
 *
 * `rumourOnly`: bu kategori doğası gereği kesinleşmemiştir; `confirmed`
 * güveniyle birlikte kullanılamaz.
 *
 * `maxAgeHours`: RAF ÖMRÜ. VARSAYILAN ÜÇ GÜNDÜR.
 *
 * Bant "gündem" iddiasında bulunur. Üç günden eski bir öğe gündem değil,
 * arşivdir — ve bant onu hâlâ akan bir şerit içinde taşıdığında okuyucuya
 * olmadığı bir tazeliği ima eder.
 *
 * Bu sınır gevşekti ve sonucu depoda görülüyordu: banttaki 20 öğenin altısı
 * üç günden eskiydi, en eskisi 201 SAATLİK (8,4 gün) bir kulüp duyurusuydu.
 * Sebep `official` kategorisine tanınan 21 günlük penceredeydi. O pencere
 * doğrulanmış TRANSFER kayıtları için düşünülmüştü (transfer penceresi
 * boyunca geçerli kalırlar); ama kategori transferle sınırlı değil, kulübün
 * her duyurusunu kapsıyor — antrenman raporu, bilet satışı, tesis haberi.
 *
 * Artık her kategori varsayılanı paylaşıyor. TEK İSTİSNA `fixture`:
 * gelecekteki bir maçın duyurusu maç oynanana kadar DOĞRU kalır, ama bunu
 * hak etmesi için kendi bitiş tarihini taşıması gerekir. `expiresAt` yoksa
 * o da varsayılana tabidir — "ileride bir maç var" demek, süresiz asılı
 * kalmak için yeterli bir gerekçe değil.
 *
 * Bu, tazelik iddiasını gevşetmez: "Son Dakika" rozeti hâlâ banttaki EN TAZE
 * öğeye göre verilir, eski bir resmî açıklama tek başına o rozeti üretemez.
 */
const DEFAULT_MAX_AGE_HOURS = 72;

/** `expiresAt` taşıyan maç programı duyurusunun tanınan üst sınırı. */
const DATED_FIXTURE_MAX_AGE_HOURS = 24 * 14;

const CATEGORIES = Object.freeze({
  "official": { label: "Resmî açıklama", rumourOnly: false, priority: 0, maxAgeHours: DEFAULT_MAX_AGE_HOURS },
  "post-match": { label: "Maç sonu", rumourOnly: false, priority: 1, maxAgeHours: DEFAULT_MAX_AGE_HOURS },
  "fixture": { label: "Maç programı", rumourOnly: false, priority: 2, maxAgeHours: DEFAULT_MAX_AGE_HOURS },
  "squad-update": { label: "Kadro & sakatlık", rumourOnly: false, priority: 3, maxAgeHours: DEFAULT_MAX_AGE_HOURS },
  "manager-quote": { label: "Teknik direktör", rumourOnly: false, priority: 4, maxAgeHours: DEFAULT_MAX_AGE_HOURS },
  "player-quote": { label: "Oyuncu açıklaması", rumourOnly: false, priority: 5, maxAgeHours: DEFAULT_MAX_AGE_HOURS },
  // Kulüp gündemi: kulübü ilgilendiren ama maç ya da transfer olmayan
  // gelişme (kongre, ceza, tesis, yönetim).
  "club-agenda": { label: "Kulüp gündemi", rumourOnly: false, priority: 6, maxAgeHours: DEFAULT_MAX_AGE_HOURS },
  "transfer-rumour": { label: "Transfer iddiası", rumourOnly: true, priority: 7, maxAgeHours: DEFAULT_MAX_AGE_HOURS }
});

/**
 * Güven seviyeleri.
 *
 * `badge` boşsa rozet çizilmez — yalnızca `confirmed` için, çünkü orada
 * gösterilecek bir çekince yoktur. Diğer ikisinde rozet ZORUNLU.
 */
const CONFIDENCE = Object.freeze({
  confirmed: {
    badge: "",
    label: "Doğrulandı",
    note: "Resmî ya da birincil kaynakla doğrulanmış.",
    requiresBadge: false
  },
  reported: {
    badge: "BASINDA",
    label: "Basında yer aldı",
    note: "Güvenilir bir yayın organı aktardı; kulüp doğrulamadı.",
    requiresBadge: true
  },
  rumour: {
    badge: "SÖYLENTİ",
    label: "Söylenti",
    note: "Kesinleşmemiş iddia. Doğrulanmadı.",
    requiresBadge: true
  }
});

/**
 * Kesinlik fiilleri. Kesinleşmemiş bir öğenin metninde geçemezler.
 *
 * Liste dar tutuldu: amaç dil denetimi yapmak değil, rozetle cümlenin
 * BİRBİRİYLE ÇELİŞMESİNİ engellemek. "Görüşmeler sürüyor" serbest;
 * "imzaladı" değil.
 */
const CONFIRMATION_VERBS = [
  "resmen",
  "imzaladı",
  "imzayı attı",
  "duyurdu",
  "kesinleşti",
  "anlaşma sağlandı",
  "transferi tamamlandı",
  "resmi açıklama"
];

/**
 * Çekince ifadeleri. Kesinleşmemiş bir öğenin metninde EN AZ BİRİ geçmek
 * zorunda.
 *
 * Gerekçe rozetin kendisiyle ilgili: rozet on piksellik bir etikettir,
 * cümle ise bandın taşıdığı asıl bilgidir. "Şu oyuncu Beşiktaş'a geliyor"
 * cümlesi, yanında "SÖYLENTİ" yazsa bile okuyucunun aklında haber olarak
 * kalır. Çekince cümlenin İÇİNDE olmak zorunda: "geldiği öne sürüldü".
 */
const HEDGE_MARKERS = [
  "iddia",
  "öne sürül",
  "ileri sürül",
  "aktarıl",
  "aktardı",
  "bildirdi",
  "belirtildi",
  "göre",
  "basına yansı",
  "gündeme geldi",
  "görüşmeler sürüyor",
  "görüşmelerin sürdüğü",
  "sürüyor",
  // "yazdı" tek başına yetmiyordu: Türkçe çekimlendiği için "basını ...
  // yazıyor" ve "yazdığını yazıyor" kalıpları eleniyordu — oysa ikisi de
  // iddiayı kaynağa atfeden, tam da bu kuralın istediği ifadeler. Kök
  // olarak "yaz" yazılamaz: "yaz transfer dönemi" yanlış eşleşirdi.
  "yazdı",
  "yazıyor",
  "yazdığı",
  "rapor",
  "konuşul",
  "sıcak bak",
  "değerlendiriliyor",
  "beklendiği",
  "olabileceği",
  "dönebileceği"
];

/**
 * Doğrulama katmanının işleyebileceği küratörlü HAVUZ — ekrandaki tavan
 * değil. Ekranda kaç öğe görüneceğini scripts/lib/tickerFeed.mjs içindeki
 * MAX_ITEMS belirler.
 *
 * Havuz, ayrılan slot sayısından (MIN_CURATED_SLOTS) bilinçli olarak geniş:
 * tekleştirme sırasında bir küratörlü öğe maç kaydındaki sürümüyle birleşip
 * kotadan düşebiliyor. Yedek olmasa gündem slotu boş kalırdı. Gündem
 * dosyasındaki kayıt sayısı arttıkça bu havuzun da geniş kalması gerekiyor,
 * yoksa sıralamanın altındaki kayıtlar doğrulamaya hiç ulaşamaz.
 */
const MAX_CURATED_ITEMS = 8;

/**
 * "Son dakika" bir ZAMAN İDDİASIDIR. Bir öğe `breaking` işaretiyle girse
 * bile bu pencereden sonra o iddiayı sürdüremez; gelişme gerçekten devam
 * ediyorsa editör `developing: true` yazmak zorundadır. İşaret kendiliğinden
 * kalıcı olmaz — kalıcı bir "son dakika" bandın tamamını değersizleştirir.
 */
const BREAKING_WINDOW_HOURS = 24;

/**
 * EDİTORYAL SIRA. Küçük sayı önce çizilir.
 *
 * Bu bir futbol sitesinin gündem sırası; "en yeni en üstte" değil. Trabzonspor'un
 * resmî açıklaması, saatler sonra gelen bir İtalya transfer iddiasının altında
 * kalmamalı.
 */
const EDITORIAL_RANKS = Object.freeze({
  BIG_FOUR: 0,
  TURKISH_IN_EUROPE: 1,
  TURKISH_LEAGUE: 2,
  MAJOR_EUROPEAN: 3,
  OTHER: 4
});

const BIG_FOUR = Object.freeze(["Galatasaray", "Fenerbahçe", "Beşiktaş", "Trabzonspor"]);
const BIG_FOUR_KEYS = new Set(BIG_FOUR.map((name) => normalizeText(name)));

/** Avrupa kupalarını işaret eden turnuva adları (Türkçe ve İngilizce yazım). */
const EUROPEAN_COMPETITION_HINTS = [
  "sampiyonlar ligi",
  "champions league",
  "avrupa ligi",
  "europa league",
  "konferans ligi",
  "conference league",
  "uefa",
  "super kupa",
  "super cup"
];

/**
 * Yinelenme eşiği (Jaccard). İki başlık aynı olayı anlatıyorsa kelimeleri de
 * büyük ölçüde örtüşür: "Beşiktaş Midtjylland'ı 2-0 yendi" ile "Midtjylland
 * 0-2 Beşiktaş: Kartal turladı" aynı haberdir ve bant ikisini birden
 * taşımamalı.
 *
 * Eşik dengeli tutuldu. Çok yüksek olursa aynı haberin iki yazımı yan yana
 * durur (0.6'da "…gerçek dışı olduğunu resmen açıkladı" ile "…iddialarını
 * resmen yalanladı" ayrı haber sayılıyordu); çok düşük olursa yanlış pozitif
 * gerçek bir haberi sessizce yutar. Şüphede kalınan yerde iki başlık da kalır.
 */
const DUPLICATE_SIMILARITY = 0.5;

/**
 * KAPSAMA EŞİĞİ — Jaccard'ın tek başına yakalayamadığı hâl.
 *
 * Bandın bir kaynağı skor satırı üretiyor ("Midtjylland 0-2 Beşiktaş": iki
 * anlamlı kelime), diğeri aynı olayı cümleyle anlatıyor ("Beşiktaş,
 * Midtjylland deplasmanında kazanıp tur atladı": on kelime). Jaccard bu iki
 * kümeyi asla 0.6'ya çıkaramaz — payda büyük kümeyi de sayar. Oysa küçük
 * küme büyüğün İÇİNDE: aynı haber.
 *
 * Bu yüzden ikinci bir ölçü: kesişimin KÜÇÜK kümeye oranı. İki kelimelik bir
 * başlık pratikte bir maç skorudur; iki takım adı da örtüşüyorsa aynı
 * eşleşmedir.
 */
const DUPLICATE_CONTAINMENT = 0.8;
const DUPLICATE_CONTAINMENT_MIN_TOKENS = 2;

/** Oran yolunun geçerli sayılması için gereken en az ortak kelime. */
const DUPLICATE_MIN_SHARED = 3;

/**
 * Kelime gövdesi uzunluğu.
 *
 * Türkçe çekim ekleri karşılaştırmayı bozuyor: "Midtjylland" ile
 * "Midtjylland'ı", "Beşiktaş" ile "Beşiktaş'ın", "Turku" ile "Turku'ya"
 * farklı belirteçler olarak sayılıyor ve aynı haberin iki yazımı yabancı
 * görünüyordu. Belirteçler gövdelerine indirgeniyor; ek düşüyor, kök kalıyor.
 *
 * Beş, kulüp adlarının ayırt edilebildiği en kısa uzunluk: "besik"/"fener"/
 * "galat"/"trabz" hâlâ birbirinden ayrı, ama "turku"/"turkuya" birleşiyor.
 */
const STEM_LENGTH = 5;

/** Örtüşme hesabında sayılmayan, her cümlede geçen kelimeler. */
const DUPLICATE_STOPWORDS = new Set([
  "ile", "icin", "olan", "oldu", "bir", "bu", "ve", "the", "and", "for",
  "gunu", "maci", "macinda", "sonra", "once", "kulubu", "kulup", "takim",
  "sezonu", "sezon", "yeni", "aciklama", "aciklamasi", "haber"
]);

function text(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

function lower(value) {
  return text(value).toLocaleLowerCase("tr");
}

function isBoolean(value) {
  return typeof value === "boolean";
}

function parsedTime(value) {
  const parsed = Date.parse(text(value));
  return Number.isNaN(parsed) ? null : parsed;
}

function hoursBetween(fromMs, now) {
  return (now.getTime() - fromMs) / 3600000;
}

/** Turnuva adı Avrupa kupalarından birini mi işaret ediyor? */
function isEuropeanCompetition(competition) {
  const normalized = normalizeText(competition);
  if (!normalized) return false;
  return EUROPEAN_COMPETITION_HINTS.some((hint) => normalized.includes(hint));
}

/**
 * Bir kaydın gündem sırası.
 *
 * Girdi esnek: tek takım (`team`), birden çok takım (`teams`) ya da yalnızca
 * turnuva (`competition`) verilebilir. Birden çok takım varsa EN YÜKSEK
 * öncelik kazanır — Galatasaray'ın rakibi kim olursa olsun haber
 * Galatasaray haberidir.
 */
function editorialRank(input = {}) {
  const competition = text(input.competition);
  const names = []
    .concat(Array.isArray(input.teams) ? input.teams : [])
    .concat(input.team ? [input.team] : [])
    .map(text)
    .filter(Boolean);

  const european = isEuropeanCompetition(competition);
  let best = EDITORIAL_RANKS.OTHER;

  for (const name of names) {
    if (BIG_FOUR_KEYS.has(normalizeText(name))) return EDITORIAL_RANKS.BIG_FOUR;

    if (isTurkishTeamName(name)) {
      best = Math.min(best, european ? EDITORIAL_RANKS.TURKISH_IN_EUROPE : EDITORIAL_RANKS.TURKISH_LEAGUE);
      continue;
    }

    if (isMajorClubName(name)) {
      best = Math.min(best, EDITORIAL_RANKS.MAJOR_EUROPEAN);
    }
  }

  // Takım adı taşımayan kayıtlar — federasyon duyurusu, lig takvimi, kura
  // çekimi. Turnuva alanı bunları doğru banda yerleştirir; aksi hâlde
  // "Süper Lig 14 Ağustos'ta başlıyor" başlığı listenin en dibine düşerdi.
  if (best === EDITORIAL_RANKS.OTHER) {
    if (isTurkishLeague(competition)) return EDITORIAL_RANKS.TURKISH_LEAGUE;
    if (european) return EDITORIAL_RANKS.MAJOR_EUROPEAN;
  }

  return best;
}

/**
 * Tek bir öğeyi doğrular.
 *
 * @returns {{valid: boolean, errors: string[]}} Hata varsa öğe banda GİRMEZ.
 *   Sessizce düzeltilmez: eksik güven bilgisini tahmin etmek, tam olarak
 *   önlemeye çalıştığımız şeydir.
 */
function validateTickerItem(item) {
  const errors = [];

  if (!item || typeof item !== "object") {
    return { valid: false, errors: ["kayıt nesne değil"] };
  }

  const id = text(item.id);
  if (!id) errors.push("id yok");
  if (!text(item.text)) errors.push("metin yok");

  const category = text(item.category);
  if (!category) errors.push("category yok");
  else if (!CATEGORIES[category]) errors.push(`bilinmeyen category: ${category}`);

  const confidence = text(item.confidence);
  if (!confidence) {
    // Eksik güven "kesin" sayılmaz. Bandın tüm güvenliği bu satıra dayanıyor.
    errors.push("confidence yok — eksik güven kesinlik sayılmaz");
  } else if (!CONFIDENCE[confidence]) {
    errors.push(`bilinmeyen confidence: ${confidence}`);
  }

  const timestamp = text(item.timestamp);
  const publishedMs = parsedTime(timestamp);
  if (!timestamp) errors.push("timestamp yok");
  else if (publishedMs === null) errors.push(`geçersiz timestamp: ${timestamp}`);

  // Son güncelleme zamanı isteğe bağlı ama VARSA tutarlı olmak zorunda:
  // yayımdan önceye tarihlenmiş bir güncelleme, kaydın elle düzenlenirken
  // bozulduğunu gösterir.
  const updatedAt = text(item.updatedAt);
  if (updatedAt) {
    const updatedMs = parsedTime(updatedAt);
    if (updatedMs === null) errors.push(`geçersiz updatedAt: ${updatedAt}`);
    else if (publishedMs !== null && updatedMs < publishedMs) {
      errors.push("updatedAt, timestamp'ten önce olamaz");
    }
  }

  const expiresAt = text(item.expiresAt);
  if (expiresAt && parsedTime(expiresAt) === null) {
    errors.push(`geçersiz expiresAt: ${expiresAt}`);
  }

  if (item.breaking !== undefined && !isBoolean(item.breaking)) {
    errors.push("breaking alanı boolean olmalı");
  }
  if (item.developing !== undefined && !isBoolean(item.developing)) {
    errors.push("developing alanı boolean olmalı");
  }
  // "Gelişme sürüyor" yalnızca son dakika penceresini uzatmak için vardır.
  // `breaking` olmayan bir kayıtta anlamı yok; sessizce yok saymak yerine
  // editoryal hata olarak bildiriliyor.
  if (item.developing === true && item.breaking !== true) {
    errors.push("developing yalnızca breaking öğelerde kullanılabilir");
  }

  const source = item.source || {};
  if (!text(source.name)) errors.push("source.name yok");
  const url = text(source.url);
  if (!url) errors.push("source.url yok");
  else if (!/^https?:\/\//i.test(url)) errors.push(`source.url http(s) olmalı: ${url}`);

  // ÇELİŞKİ 1: doğası gereği iddia olan kategori "doğrulandı" olamaz.
  if (CATEGORIES[category] && CATEGORIES[category].rumourOnly && confidence === "confirmed") {
    errors.push(
      `"${category}" kategorisi confidence "confirmed" olamaz — ` +
      'kesinleşmiş bir transfer iddia değildir, kategorisi "official" olmalı'
    );
  }

  // ÇELİŞKİ 2: rozet çekince derken cümle kesinlik diyorsa okuyucu cümleye
  // inanır. Rozet bu durumda koruma değil, süs olur.
  if (CONFIDENCE[confidence] && CONFIDENCE[confidence].requiresBadge) {
    const haystack = lower(item.text);
    const hit = CONFIRMATION_VERBS.find((verb) => haystack.includes(verb));
    if (hit) {
      errors.push(
        `kesinleşmemiş öğenin metninde kesinlik ifadesi var ("${hit}"); ` +
        "rozet ile cümle çelişiyor"
      );
    }

    // ÇELİŞKİ 3: çekince YALNIZCA rozette kalamaz. Rozet küçük, cümle büyük.
    if (!HEDGE_MARKERS.some((marker) => haystack.includes(marker))) {
      errors.push(
        "kesinleşmemiş öğenin metninde çekince ifadesi yok " +
        '("iddia", "öne sürüldü", "aktarıldı", "görüşmeler sürüyor" gibi); ' +
        "çekince yalnızca rozette kalamaz"
      );
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Ekranda görünecek güven rozeti. `confirmed` için boş dize. */
function confidenceBadge(confidence) {
  const entry = CONFIDENCE[text(confidence)];
  return entry ? entry.badge : "";
}

function categoryLabel(category) {
  const entry = CATEGORIES[text(category)];
  return entry ? entry.label : "";
}

/**
 * Bir kaydın zaman durumu: banttan düşmeli mi, yoksa yalnızca "son dakika"
 * işaretini mi kaybetmeli?
 *
 * Üç ayrı kural, üç ayrı gerekçe:
 *
 *   • `expiresAt`  — "5 Ağustos'ta oynanacak" duyurusu 6 Ağustos'ta yanlıştır.
 *                    Raf ömrü değil, TARİH bitirir.
 *   • kategori raf ömrü — haber değeri kategoriye göre tükenir.
 *   • breaking penceresi — DÜŞÜRMEZ, yalnızca rütbe indirir. Haber hâlâ
 *                    doğrudur; artık "son dakika" değildir.
 */
function shelfLifeVerdict(entry, now, overrideMaxAgeHours = null) {
  const publishedMs = parsedTime(entry.timestamp);
  if (publishedMs === null) return { drop: "timestamp okunamadı", breaking: false };

  const ageHours = hoursBetween(publishedMs, now);

  // Geleceğe tarihli kayıt: saat hatası ya da yanlış giriş. Bandın "şu an"
  // iddiasını bozar.
  if (ageHours < -1) return { drop: "timestamp gelecekte", breaking: false };

  const expiresMs = parsedTime(entry.expiresAt);
  if (expiresMs !== null && now.getTime() > expiresMs) {
    return { drop: `geçerlilik tarihi doldu (${text(entry.expiresAt)})`, breaking: false };
  }

  // Maç programı duyurusu varsayılanı ancak KENDİ BİTİŞ TARİHİNİ taşıyorsa
  // aşabilir: o zaman süresiz asılı kalmaz, maç gelince kendiliğinden düşer.
  const category = text(entry.category);
  const categoryMaxAge = category === "fixture" && expiresMs !== null
    ? DATED_FIXTURE_MAX_AGE_HOURS
    : CATEGORIES[category].maxAgeHours;

  const shelfLife = Number.isFinite(overrideMaxAgeHours) && overrideMaxAgeHours !== null
    ? overrideMaxAgeHours
    : categoryMaxAge;

  if (ageHours > shelfLife) {
    return {
      drop: `raf ömrü doldu (${Math.round(ageHours)} saat > ${shelfLife} saat)`,
      breaking: false
    };
  }

  // Son dakika işareti kendiliğinden sönümlenir. `developing` onu uzatır ama
  // kategori raf ömrünün ötesine taşıyamaz — yukarıdaki kontrol zaten geçildi.
  const breaking = entry.breaking === true &&
    (ageHours <= BREAKING_WINDOW_HOURS || entry.developing === true);

  return { drop: null, breaking, ageHours };
}

/** Örtüşme hesabı için anlamlı kelime gövdeleri. */
function tokenSet(value) {
  const normalized = normalizeText(value).replace(/[^a-z0-9\s]+/g, " ");
  const stems = normalized
    .split(/\s+/)
    .filter((token) => token.length > 2 && !DUPLICATE_STOPWORDS.has(token))
    .map((token) => token.slice(0, STEM_LENGTH));
  return new Set(stems);
}

function sharedCount(left, right) {
  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared += 1;
  }
  return shared;
}

/** Aynı olayın iki yazımı mı? İki ölçü, iki farklı yanılma biçimi için. */
function sameStory(left, right) {
  if (!left.size || !right.size) return false;

  const shared = sharedCount(left, right);
  if (!shared) return false;

  // Oran ölçüsü kısa başlıklarda yanılıyor: "Trabzonspor duyuru yaptı" ile
  // "Samsunspor duyuru yaptı" üç kelimenin ikisini paylaşıyor ve Jaccard tam
  // 0.5 çıkıyor — iki AYRI haber aynı sayılıyordu. Oran yolunun geçerli
  // sayılması için paylaşılan kelime sayısı da anlamlı olmalı.
  const union = left.size + right.size - shared;
  if (shared >= DUPLICATE_MIN_SHARED && shared / union >= DUPLICATE_SIMILARITY) return true;

  // Kapsama yolu bilerek daha az kelimeyle çalışır: iki kelimelik bir başlık
  // pratikte bir maç skorudur ("Midtjylland 0-2 Beşiktaş") ve iki takım adı
  // da örtüşüyorsa aynı eşleşmedir.
  const smaller = Math.min(left.size, right.size);
  return smaller >= DUPLICATE_CONTAINMENT_MIN_TOKENS &&
    shared / smaller >= DUPLICATE_CONTAINMENT;
}

/**
 * Aynı olayın iki farklı yazımını eler.
 *
 * HANGİSİ KALIR? "En yenisi" değil — EN GÜVENİLİRİ. Bir olayın hem resmî
 * açıklaması hem de basın aktarımı bantta yer alıyorsa, iddia sürümü
 * gitmeli; kulübün kendi açıklaması kalmalı. Eşitlikte kategori önceliği,
 * sonra tazelik karar verir.
 */
function dedupeByMeaning(items) {
  const kept = [];
  const dropped = [];

  const strength = (item) => {
    // Güven alanı taşımayan öğeler TÜRETİLMİŞ kaynaklardan gelir (maç kaydı,
    // onaylı transfer): oradaki doğrulama yayın politikasında yapılmıştır,
    // burada eksik alan "söylenti" sayılamaz.
    const confidenceRank = item.confidence === "reported"
      ? 1
      : (item.confidence === "rumour" ? 2 : 0);

    // AYNI OLAYIN İKİ SÜRÜMÜNDE EDİTORYAL BAŞLIK KAZANIR.
    //
    // Bandın türetilmiş kaynağı çıplak bir skor satırı üretir
    // ("Inter Turku 2-0 Başakşehir"); küratörlü kaynak ise o skorun NE
    // ANLAMA GELDİĞİNİ yazar ("Başakşehir Konferans Ligi'nde elendi").
    // İkisi aynı haberdir ve biri düşecekse skor satırı düşmeli: skor zaten
    // canlı skor sayfasında duruyor, anlam yalnızca burada.
    const editorial = text(item.category) ? 0 : 1;

    const priority = Number.isFinite(item.priority) ? item.priority : 99;
    return [confidenceRank, editorial, priority, -(parsedTime(item.at) || 0)];
  };

  const better = (candidate, incumbent) => {
    const a = strength(candidate);
    const b = strength(incumbent);
    for (let index = 0; index < a.length; index += 1) {
      if (a[index] !== b[index]) return a[index] < b[index];
    }
    return false;
  };

  const label = (item) => text(item.id) || text(item.text) || "(kimliksiz)";
  const tokensOf = [];

  for (const item of items) {
    const tokens = tokenSet(item.text);
    const twinIndex = kept.findIndex((_, index) => sameStory(tokens, tokensOf[index]));

    if (twinIndex === -1) {
      kept.push(item);
      tokensOf.push(tokens);
      continue;
    }

    const incumbent = kept[twinIndex];
    const winner = better(item, incumbent) ? item : incumbent;
    const loser = winner === item ? incumbent : item;

    dropped.push({
      id: label(loser),
      errors: [`aynı haberin başka yazımı; "${winner.text}" tercih edildi`]
    });

    // HABERİN YERİ EN GÜÇLÜ SÜRÜMÜNÜNKİ, METNİ EN AÇIK SÜRÜMÜNÜNKİ.
    //
    // Bir maç sonucu bantta hem çıplak skor satırı (yüksek öncelik, düşük
    // bilgi) hem de editoryal başlık (düşük öncelik, yüksek bilgi) olarak
    // duruyor. Yalnızca metin seçilse haber bandın dibine düşer ve maç
    // kotasına hiç giremezdi — Göztepe'nin bir haftalık skoru Beşiktaş'ın
    // tur atlamasını bandın dışına itiyordu. Yalnızca öncelik seçilse
    // okuyucu "ne oldu"yu öğrenemezdi.
    //
    // Bu yüzden iki alan ayrı ayrı devralınıyor: SUNUM kazanandan
    // (metin, bağlantı, rozet), YERLEŞİM ise önceliği en yüksek süründen
    // (`priority` ve ait olduğu kaynak kotası).
    const strongest = [winner, loser].reduce((best, row) => {
      const a = Number.isFinite(row.priority) ? row.priority : Infinity;
      const b = Number.isFinite(best.priority) ? best.priority : Infinity;
      return a < b ? row : best;
    }, winner);

    kept[twinIndex] = strongest === winner
      ? winner
      : { ...winner, priority: strongest.priority, source: strongest.source };

    if (winner === item) tokensOf[twinIndex] = tokens;
  }

  return { items: kept, dropped };
}

/**
 * Küratörlü dosyayı banda hazır öğelere çevirir.
 *
 * Geçersiz öğeler ELENİR ve gerekçesiyle raporlanır — sessizce düşmezler,
 * çünkü sessizce düşen bir öğe "neden görünmüyor?" sorusunu yanıtsız
 * bırakır.
 *
 * @param {Object|Array} payload `data/news-ticker.json` içeriği.
 * @param {Object} [options] `now`, `maxAgeHours`, `limit`.
 * @returns {{items: Array, rejected: Array}}
 */
function normalizeTickerItems(payload, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const limit = Number.isFinite(options.limit) ? options.limit : MAX_CURATED_ITEMS;
  // Çağıran tek bir tavan dayatabilir; dayatmazsa kategori kendi raf ömrünü
  // kullanır.
  const override = Number.isFinite(options.maxAgeHours) ? options.maxAgeHours : null;

  const raw = Array.isArray(payload)
    ? payload
    : (payload && Array.isArray(payload.items) ? payload.items : []);

  const items = [];
  const rejected = [];

  for (const entry of raw) {
    const verdict = validateTickerItem(entry);
    if (!verdict.valid) {
      rejected.push({ id: text(entry && entry.id) || "(kimliksiz)", errors: verdict.errors });
      continue;
    }

    const shelf = shelfLifeVerdict(entry, now, override);
    if (shelf.drop) {
      rejected.push({ id: text(entry.id), errors: [shelf.drop] });
      continue;
    }

    const category = text(entry.category);
    const confidence = text(entry.confidence);
    const rank = editorialRank({ team: entry.team, teams: entry.teams, competition: entry.competition });

    items.push({
      id: text(entry.id),
      label: categoryLabel(category),
      text: text(entry.text),
      href: text(entry.source.url),
      at: text(entry.timestamp),
      updatedAt: text(entry.updatedAt) || text(entry.timestamp),
      expiresAt: text(entry.expiresAt) || null,
      category,
      confidence,
      confidenceBadge: confidenceBadge(confidence),
      sourceName: text(entry.source.name),
      team: text(entry.team),
      competition: text(entry.competition),
      breaking: shelf.breaking,
      rank,
      priority: CATEGORIES[category].priority
    });
  }

  // Sıra: önce son dakika, sonra editoryal rütbe, sonra kategori, sonra
  // tazelik. Requirement'ın "önemli Türk futbolu haberleri önce" kuralı bu
  // dört anahtarın sırasında yaşıyor.
  items.sort((left, right) => {
    if (left.breaking !== right.breaking) return left.breaking ? -1 : 1;
    if (left.rank !== right.rank) return left.rank - right.rank;
    if (left.priority !== right.priority) return left.priority - right.priority;
    return String(right.at).localeCompare(String(left.at));
  });

  const deduped = dedupeByMeaning(items);
  rejected.push(...deduped.dropped);

  return { items: deduped.items.slice(0, limit), rejected };
}

/** Elenen öğeleri görünür kılar. Sessiz eleme, hata ayıklanamaz eleme demek. */
function logRejected(scope, rejected) {
  for (const row of Array.isArray(rejected) ? rejected : []) {
    console.warn(`[futbolradar:ticker-rejected] scope=${scope} id=${row.id} reasons="${row.errors.join("; ")}"`);
  }
}

module.exports = {
  BIG_FOUR,
  BREAKING_WINDOW_HOURS,
  CATEGORIES,
  DATED_FIXTURE_MAX_AGE_HOURS,
  DEFAULT_MAX_AGE_HOURS,
  CONFIDENCE,
  CONFIRMATION_VERBS,
  DUPLICATE_CONTAINMENT,
  DUPLICATE_SIMILARITY,
  EDITORIAL_RANKS,
  HEDGE_MARKERS,
  MAX_CURATED_ITEMS,
  categoryLabel,
  confidenceBadge,
  dedupeByMeaning,
  editorialRank,
  isEuropeanCompetition,
  logRejected,
  normalizeTickerItems,
  sameStory,
  shelfLifeVerdict,
  tokenSet,
  validateTickerItem
};
