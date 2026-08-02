/**
 * TRANSFER KAYNAK KAYIT DEFTERİ.
 *
 * Kaynağa özgü her şey BURADA durur; hattın geri kalanı hangi siteden
 * geldiğini bilmez. Yeni bir kaynak eklemek bu dosyaya bir kayıt yazmaktır,
 * hatta kod değiştirmek değildir.
 *
 * ── ERİŞİLEBİLİRLİK GERÇEĞİ ───────────────────────────────────────────────
 *
 * Öncelik listesinin ilk sırası kulüplerin kendi siteleridir ve bu sıra
 * DOĞRUDUR. Ne var ki galatasaray.org, fenerbahce.org, bjk.com.tr,
 * trabzonspor.org.tr ve tff.org sunucu tarafı isteklere Cloudflare tarayıcı
 * doğrulamasıyla yanıt veriyor (403 "Just a moment"); bir CI koşusundan düz
 * HTTP ile okunamıyorlar. Bu bir tercih değil, ölçülmüş bir kısıt.
 *
 * Bunun sonucu SAKLANMIYOR, modele işleniyor:
 *
 *   • O kaynaklar burada `transport: "browser"` ile KAYITLI kalır. Kayıtlı
 *     ama kapalı olmaları, sağlık raporunda "erişilemiyor" satırı üretir —
 *     listeden silinselerdi eksiklik görünmez olurdu.
 *   • Erişilebilen resmî katman KAP'tır: kulüpler transferin mali şartlarını
 *     oraya yasal zorunlulukla bildirir. `official` durumu pratikte oradan
 *     gelir.
 *   • Medya katmanı `official` ÜRETEMEZ (statusModel.statusCeiling). Bu
 *     yüzden kulüp siteleri kapalıyken sistem yanlış bir "resmen açıklandı"
 *     üretmez; en fazla "anlaşmaya varıldı" der ve bunu kaynağıyla söyler.
 *
 * `transport: "browser"` kaynakları çalıştırmak için tarayıcı taşıyıcısı
 * gerekir (Playwright). Proje sıfır bağımlılıklı ve 5 dakikalık bir cron'a
 * tarayıcı kurulumu eklemek koşuyu bütçeden çıkarırdı; bu yüzden taşıyıcı
 * ŞİMDİLİK yok ve kaynaklar `enabled: false`. Taşıyıcı eklendiği gün tek
 * yapılacak şey bu bayrağı açmaktır.
 */

/** Kaynak yoklama sıklığı sınıfları. Zamanlayıcı bunlara göre koşar. */
const CADENCE = Object.freeze({
  fast: { label: "Resmî ve birincil kaynaklar", intervalMinutes: 5 },
  broad: { label: "Geniş transfer haber kaynakları", intervalMinutes: 10 }
});

/**
 * Kaynaklar.
 *
 * `tier`      → statusModel.SOURCE_TIERS anahtarı; kesinlik tavanını belirler.
 * `cadence`   → fast (5 dk) veya broad (10 dk).
 * `transport` → http | browser. browser olanlar taşıyıcı gelene dek kapalı.
 * `format`    → rss | html | json. Ayrıştırıcı bunu okur.
 * `enabled`   → kapalı kaynak yoklanmaz ama sağlık raporunda görünür.
 */
const SOURCES = Object.freeze([
  // ── Resmî katman: erişilebilir ────────────────────────────────────────
  {
    id: "kap-disclosures",
    label: "KAP — Kamuyu Aydınlatma Platformu",
    tier: "kap",
    cadence: "fast",
    transport: "http",
    format: "html",
    enabled: true,
    url: "https://www.kap.org.tr/tr/bildirim-sorgu",
    // KAP bildirimleri kulüplerin yasal beyanıdır: sportif faaliyet
    // sözleşmeleri buraya düşer. Futbolla ilgisiz bildirimleri elemek için
    // metin süzgeci ayrıştırıcıda uygulanır.
    note: "Kulüplerin yasal bildirim kanalı; futbolcu sözleşmeleri burada duyurulur."
  },

  // ── Resmî katman: Cloudflare arkasında, taşıyıcı bekliyor ─────────────
  {
    id: "galatasaray-official",
    label: "Galatasaray SK — resmî site",
    tier: "club_site",
    cadence: "fast",
    transport: "browser",
    format: "html",
    enabled: false,
    url: "https://www.galatasaray.org/haber/futbol",
    unreachableReason: "Cloudflare tarayıcı doğrulaması; sunucu tarafı istek 403 alıyor."
  },
  {
    id: "fenerbahce-official",
    label: "Fenerbahçe SK — resmî site",
    tier: "club_site",
    cadence: "fast",
    transport: "browser",
    format: "html",
    enabled: false,
    url: "https://www.fenerbahce.org/haberler",
    unreachableReason: "Cloudflare tarayıcı doğrulaması; sunucu tarafı istek 403 alıyor."
  },
  {
    id: "besiktas-official",
    label: "Beşiktaş JK — resmî site",
    tier: "club_site",
    cadence: "fast",
    transport: "browser",
    format: "html",
    enabled: false,
    url: "https://www.bjk.com.tr/tr/haberler",
    unreachableReason: "Cloudflare tarayıcı doğrulaması; sunucu tarafı istek 403 alıyor."
  },
  {
    id: "trabzonspor-official",
    label: "Trabzonspor — resmî site",
    tier: "club_site",
    cadence: "fast",
    transport: "browser",
    format: "html",
    enabled: false,
    url: "https://www.trabzonspor.org.tr/tr/haberler",
    unreachableReason: "Cloudflare tarayıcı doğrulaması; sunucu tarafı istek 403 alıyor."
  },
  {
    id: "tff-announcements",
    label: "TFF — duyurular",
    tier: "federation",
    cadence: "fast",
    transport: "browser",
    format: "html",
    enabled: false,
    url: "https://www.tff.org/default.aspx?pageID=28",
    unreachableReason: "Sunucu bağlantıyı kabul etmiyor (bağlantı kurulamadı)."
  },

  // ── Güvenilir medya katmanı ───────────────────────────────────────────
  {
    id: "aa-spor",
    label: "Anadolu Ajansı — spor",
    tier: "tier_media",
    cadence: "fast",
    transport: "http",
    format: "rss",
    enabled: true,
    url: "https://www.aa.com.tr/tr/rss/default?cat=spor",
    note: "Ulusal haber ajansı; kulüp açıklamalarını hızlı ve sadık aktarır."
  },
  {
    id: "trt-haber-spor",
    label: "TRT Haber — spor",
    tier: "tier_media",
    cadence: "broad",
    transport: "http",
    format: "rss",
    enabled: true,
    url: "https://www.trthaber.com/spor_articles.rss"
  },
  {
    id: "hurriyet-spor",
    label: "Hürriyet — spor",
    tier: "tier_media",
    cadence: "broad",
    transport: "http",
    format: "rss",
    enabled: true,
    url: "https://www.hurriyet.com.tr/rss/spor"
  },
  {
    id: "fotomac",
    label: "Fotomaç",
    tier: "other_media",
    cadence: "broad",
    transport: "http",
    format: "rss",
    enabled: true,
    url: "https://www.fotomac.com.tr/rss/anasayfa.xml"
  }
]);

function allSources() {
  return SOURCES.slice();
}

/** Yoklanacak kaynaklar: açık VE taşıyıcısı olan. */
function activeSources(cadence) {
  return SOURCES.filter((source) => {
    if (!source.enabled) return false;
    if (source.transport !== "http") return false;
    return cadence ? source.cadence === cadence : true;
  });
}

/** Kayıtlı ama yoklanamayan kaynaklar — sağlık raporu bunları YAZAR. */
function dormantSources() {
  return SOURCES.filter((source) => !source.enabled || source.transport !== "http");
}

function sourceById(id) {
  return SOURCES.find((source) => source.id === id) || null;
}

module.exports = {
  CADENCE,
  SOURCES,
  activeSources,
  allSources,
  dormantSources,
  sourceById
};
