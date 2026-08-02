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
 *
 * KAYNAK ZORUNLU. Kaynağı gösterilemeyen bir iddia yayımlanmaz; söylenti
 * bandı, kaynaksız söylenti bandı demek değildir.
 */

/**
 * Kategoriler. Anahtar veri dosyasında, etiket ekranda görünür.
 *
 * `rumourOnly`: bu kategori doğası gereği kesinleşmemiştir; `confirmed`
 * güveniyle birlikte kullanılamaz.
 *
 * `maxAgeHours`: RAF ÖMRÜ KATEGORİYE GÖRE DEĞİŞİR, çünkü haber değeri
 * kategoriye göre farklı hızda tükenir:
 *
 *   • Maç sonu tepkisi dört gün sonra haber değil, arşivdir.
 *   • Bayat bir transfer İDDİASI faydasızdan da kötüdür: çoktan çürütülmüş
 *     olabilir ve bant onu hâlâ gündem gibi taşır.
 *   • Resmî açıklama ise transfer penceresi boyunca geçerliliğini korur —
 *     bu, bu depoda doğrulanmış transferler için zaten uygulanan 21 günlük
 *     pencerenin (scripts/lib/tickerFeed.mjs) aynı gerekçesi.
 *
 * Bu, tazelik iddiasını gevşetmez: "Son Dakika" rozeti hâlâ banttaki EN TAZE
 * öğeye göre verilir, eski bir resmî açıklama tek başına o rozeti üretemez.
 */
const CATEGORIES = Object.freeze({
  // Oynanmakta olan maçtan gelen olay. Banda en üstten girer ve EN KISA raf
  // ömrünü taşır: "Osimhen 23'te attı" ertesi sabah gündem değil, yanlış bir
  // şimdiki zaman iddiasıdır. Maç bitince bu öğelerin yerini tek bir
  // `post-match` özeti alır.
  "live-match": { label: "Canlı maç", rumourOnly: false, priority: 0, maxAgeHours: 6 },
  "official": { label: "Resmî açıklama", rumourOnly: false, priority: 1, maxAgeHours: 24 * 21 },
  "post-match": { label: "Maç sonu", rumourOnly: false, priority: 2, maxAgeHours: 24 * 4 },
  "squad-update": { label: "Kadro & sakatlık", rumourOnly: false, priority: 3, maxAgeHours: 24 * 10 },
  "manager-quote": { label: "Teknik direktör", rumourOnly: false, priority: 4, maxAgeHours: 24 * 7 },
  "club-agenda": { label: "Kulüp gündemi", rumourOnly: false, priority: 5, maxAgeHours: 24 * 4 },
  "transfer-rumour": { label: "Transfer iddiası", rumourOnly: true, priority: 6, maxAgeHours: 24 * 7 }
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

/** Doğrulama katmanının işleyebileceği küratörlü havuz; ekranda son tavan 6. */
const MAX_CURATED_ITEMS = 8;

function text(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

function lower(value) {
  return text(value).toLocaleLowerCase("tr");
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
  if (!timestamp) errors.push("timestamp yok");
  else if (Number.isNaN(Date.parse(timestamp))) errors.push(`geçersiz timestamp: ${timestamp}`);

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

    const ageHours = (now.getTime() - Date.parse(entry.timestamp)) / 3600000;
    const shelfLife = override === null
      ? CATEGORIES[text(entry.category)].maxAgeHours
      : override;

    if (ageHours > shelfLife) {
      rejected.push({
        id: text(entry.id),
        errors: [`raf ömrü doldu (${Math.round(ageHours)} saat > ${shelfLife} saat)`]
      });
      continue;
    }

    // Geleceğe tarihli kayıt: saat hatası ya da yanlış giriş. Bandın "şu an"
    // iddiasını bozar.
    if (ageHours < -1) {
      rejected.push({ id: text(entry.id), errors: ["timestamp gelecekte"] });
      continue;
    }

    const category = text(entry.category);
    const confidence = text(entry.confidence);

    items.push({
      label: categoryLabel(category),
      text: text(entry.text),
      href: text(entry.source.url),
      at: text(entry.timestamp),
      category,
      confidence,
      confidenceBadge: confidenceBadge(confidence),
      sourceName: text(entry.source.name),
      priority: CATEGORIES[category].priority
    });
  }

  items.sort((left, right) => {
    if (left.priority !== right.priority) return left.priority - right.priority;
    return String(right.at).localeCompare(String(left.at));
  });

  return { items: items.slice(0, limit), rejected };
}

/** Elenen öğeleri görünür kılar. Sessiz eleme, hata ayıklanamaz eleme demek. */
function logRejected(scope, rejected) {
  for (const row of Array.isArray(rejected) ? rejected : []) {
    console.warn(`[futbolradar:ticker-rejected] scope=${scope} id=${row.id} reasons="${row.errors.join("; ")}"`);
  }
}

module.exports = {
  CATEGORIES,
  CONFIDENCE,
  CONFIRMATION_VERBS,
  MAX_CURATED_ITEMS,
  categoryLabel,
  confidenceBadge,
  logRejected,
  normalizeTickerItems,
  validateTickerItem
};
