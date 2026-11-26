/**
 * HABER AKIŞI — YAYIMLANABİLİRLİK VE BAĞLANTI KURALI, TEK YERDE.
 *
 * NEDEN BU DOSYA VAR. Ana sayfanın haber kutusu iki yerde ayrı ayrı
 * kuruluyordu: Türkçe tarafta `scripts/prerender-core-pages.mjs`, İngilizce
 * tarafta `scripts/generate-en-pages.mjs`. İki taraf aynı `data/news.json`u
 * okuyordu ama AYNI KURALI uygulamıyordu:
 *
 *   Türkçe  → `status === "verified"` süzgeci + yayın tarihine göre sıralama
 *   İngilizce → süzgeç yok, sıralama yok
 *
 * Sonuç production'da göründü: `status: "archived"` iki haber İngilizce ana
 * sayfada kart olarak çizildi, ama o haberlerin sayfası hiç üretilmediği
 * için ikisi de 404 veriyordu. Kural iki yerde yazılınca biri eskidi.
 *
 * Bu yüzden kural buraya taşındı. İki üretici de aynı listeyi ve aynı
 * bağlantıyı bu dosyadan alır; ayrışma artık mümkün değil.
 *
 * YAYIMLANABİLİRLİK ÖLÇÜTÜ, SAYFA ÜRETİCİSİNİNKİYLE AYNI OLMAK ZORUNDA.
 * `scripts/generate-news-pages.mjs` bir haberin sayfasını yalnızca şu üç
 * koşulda yazar: geçerli slug, `status === "verified"`, en az bir dolu
 * paragraf ve (başlığı "resmen" diyorsa) resmî kaynak bağlantısı. Ana sayfa bir habere bağlanıyorsa o haberin sayfası da yazılmış
 * olmalı — yoksa bağlantı 404'e gider. Aynı üç koşul burada da uygulanır.
 *
 * ARŞİVLENMİŞ HABER SİLİNMEZ, YALNIZCA BAĞLANMAZ. `archived` bir kaydı
 * veriden atmak geçmişi kaybetmek olurdu; burada yapılan tek şey onu
 * "bugünün akışı" saymamak.
 */

const { promotedNewsId } = require('./newsPriority.js');
const { officialClaimCheck } = require('./officialClaimGate.js');

const OWN_ORIGIN = "https://www.futbolradar.com/";

function text(value) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return "";
}

/** Kayıt hangi alanda saklarsa saklasın haberin slug'ı. */
function newsSlug(article) {
  if (!article) return "";
  return text(article.slug) || text(article.id);
}

/**
 * Slug ÜRETİLEBİLİR mi? Sayfa üreticisi slug'ı `slug → id → title`
 * sırasıyla türetiyor; yayımlanabilirlik ölçütü de aynı sırayı görmeli,
 * yoksa yalnızca başlığı olan bir kayıt burada elenip orada sayfası
 * yazılırdı — iki tarafın ayrışması tam olarak bu hatayı doğurmuştu.
 */
function hasSlugSource(article) {
  return Boolean(newsSlug(article) || text(article && article.title));
}

/**
 * Kaydın gövdesi gerçekten var mı? Boş dizi ya da yalnızca boşluk taşıyan
 * paragraflar "gövde" sayılmaz: o kayıt için sayfa üretilmez.
 */
function hasBody(article) {
  return Array.isArray(article && article.body)
    && article.body.some((paragraph) => text(paragraph).length > 0);
}

/**
 * Bu haberin kalıcı bir sayfası üretiliyor mu?
 * `scripts/generate-news-pages.mjs` `publishableArticles()` ile birebir aynı.
 */
function hasOwnPage(article) {
  return Boolean(article)
    && hasSlugSource(article)
    && Boolean(text(article.title))
    && text(article.status).toLowerCase() === "verified"
    && hasBody(article)
    // "Resmen" diyen başlık resmî kaynak bağlantısı olmadan yayımlanmaz
    // (services/officialClaimGate.js).
    && officialClaimCheck(article).ok;
}

/**
 * Ham `news.json` yükünü listeye çevirir. Dosya kimi zaman dizi, kimi zaman
 * `{ news: [...] }` ya da `{ items: [...] }` olarak tutuluyor.
 */
function asList(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload.news)) return payload.news;
  if (Array.isArray(payload.items)) return payload.items;
  return [];
}

/**
 * Haberin YAYINA HAZIR bir İngilizce sürümü var mı?
 *
 * Başlık ve gövde BİRLİKTE aranıyor: yalnızca başlığı çevrilmiş bir haber
 * İngilizce sayfada başlığı İngilizce, gövdesi Türkçe bir kart üretirdi.
 */
function hasEnglish(article) {
  const en = (article && article.en) || {};
  return Boolean(text(en.title)) && Array.isArray(en.body)
    && en.body.some((paragraph) => text(paragraph).length > 0);
}

/**
 * Haberi istenen dilde sunar.
 *
 * İngilizce alanlar Türkçe kaydın ÜZERİNE yazılır; `publishedAt`, `team`,
 * `status` gibi dilden bağımsız alanlar olduğu gibi kalır. `en` alt nesnesi
 * sonuçtan düşürülür ki çağıran yanlışlıkla iki dili karıştırmasın.
 */
function presentNews(article, locale) {
  if (String(locale || "tr").toLowerCase() !== "en" || !hasEnglish(article)) return article;
  const en = article.en;
  const merged = { ...article, ...en, locale: "en" };
  merged.seo = { ...(article.seo || {}), ...(en.seo || {}) };
  if (article.ticker || en.ticker) merged.ticker = { ...(article.ticker || {}), ...(en.ticker || {}) };
  delete merged.en;
  return merged;
}

/**
 * ANA SAYFA / LİSTE AKIŞI. Yalnızca sayfası üretilen haberler, en yeni
 * önce. Bir kart çiziliyorsa bağlantısının açılacağı garanti.
 *
 * DİL ELEMESİ BURADA. `locale: "en"` istendiğinde İngilizce sürümü olmayan
 * haber HİÇ DÖNMEZ. Eskiden süzgeç yoktu: İngilizce ana sayfa ve
 * `en/news.html`, Türkçe başlıkları `lang="tr"` etiketiyle basıyordu —
 * yani okuyucuya "bu kart senin dilinde değil" demekle yetiniyordu.
 * Bir haberi göstermemek, okuyamayacağı bir dilde göstermekten iyidir;
 * Türkçe sürüm `/tr` tarafında olduğu gibi durur.
 */
function publishableNews(payload, options = {}) {
  const locale = String(options.locale || "tr").toLowerCase() === "en" ? "en" : "tr";
  const lead = promotedNewsId(asList(payload).filter(hasOwnPage), options.now);
  return asList(payload)
    .filter(hasOwnPage)
    .filter((article) => locale !== "en" || hasEnglish(article))
    .sort((left, right) => Number(right.id === lead) - Number(left.id === lead) || text(right.publishedAt).localeCompare(text(left.publishedAt)))
    .map((article) => presentNews(article, locale));
}

/**
 * KARTIN BAĞLANTISI.
 *
 * Kayıttaki `url` mutlak adrestir. Kendi alanımızdaysa siteye göre göreli
 * yola çevrilir; başka bir alandaysa dış künye olarak olduğu gibi döner.
 * Uydurma yapılmaz: `url` yoksa slug'dan kanonik iç yol kurulur.
 *
 * `base` çağıran tarafın kök öneki ("./" Türkçe, "../" İngilizce alt dizin).
 *
 * `haber/` yolunda `.html` uzantısı DÜŞÜRÜLÜR — sitenin bugünkü kanonik iç
 * bağlantı biçimi bu ve barındırma temiz URL'i çözüyor. Biçim burada
 * değiştirilmiyor; amaç kuralı tek yere toplamak, çıktıyı oynatmak değil.
 */
function newsHref(article, base = "./", locale = "tr") {
  // İNGİLİZCE KARTIN BAĞLANTISI TÜRKÇE SAYFAYA GİTMEZ.
  //
  // Kayıttaki `url` her zaman Türkçe `haber/` yolunu gösteriyor. İngilizce
  // kart bu adrese bağlandığında okuyucu tek tıkla Türkçe bir sayfaya
  // düşüyordu — kartın İngilizce olması tek başına yetmez.
  if (String(locale).toLowerCase() === "en") {
    const slug = newsSlug(article);
    return slug ? `${base}en/news/${slug}.html` : "";
  }

  const url = text(article && article.url);
  if (url) {
    if (url.startsWith(OWN_ORIGIN)) {
      const localPath = url.slice(OWN_ORIGIN.length);
      return localPath.startsWith("haber/")
        ? `${base}${localPath.replace(/\.html$/, "")}`
        : `${base}${localPath}`;
    }
    if (/^https?:/i.test(url)) return url;
  }
  const slug = newsSlug(article);
  return slug ? `${base}haber/${slug}` : "";
}

/** Bağlantı bu siteden mi çıkıyor? Dış künye `nofollow` ister. */
function isExternalHref(href) {
  return /^https?:/i.test(text(href));
}

module.exports = {
  asList,
  hasEnglish,
  hasOwnPage,
  isExternalHref,
  newsHref,
  newsSlug,
  presentNews,
  publishableNews
};
