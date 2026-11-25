/**
 * GOOGLE NEWS SİTE HARİTASI — SAF İŞLEV.
 *
 * Google News site haritası kuralları (support.google.com/news/publisher-center):
 *   • Yalnızca SON 2 GÜNÜN (48 saat) makaleleri; eski makale haritada kalmaz.
 *   • Harita başına en fazla 1.000 <news:news>.
 *   • Her kayıt: <loc>, <news:publication> (<news:name>, <news:language> ISO 639),
 *     <news:publication_date> (W3C: YYYY-MM-DD ya da tam tarih-saat),
 *     <news:title>.
 *   • Otomatik üretilmiş / özgün olmayan içerik kabul edilmez: şablon metinli
 *     keşif haberleri (bkz. services/newsIndexPolicy.js) haritaya GİRMEZ.
 *
 * Üretici (generate-news-pages.mjs) ve test (test-sitemaps.mjs) aynı işlevi
 * kullanır; 48 saat sınırı sınır değerlerinde birim testle doğrulanır.
 */
export const NEWS_WINDOW_MS = 48 * 3600000;
export const NEWS_MAX_URLS = 1000;
export const NEWS_PUBLICATION = { name: "FutbolRadar", language: "tr" };
/** Arama motoruna bildirilen adres (robots.txt + sitemap-index.xml). */
export const NEWS_SITEMAP_FILE = "news-sitemap.xml";
/** Aynı içeriğin kaynak kopyası; edge middleware istek anında bunu okur. */
export const NEWS_SITEMAP_SOURCE_FILE = "news-sitemap-source.xml";

const XML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
export const escapeXml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);

/**
 * KÖŞE YAZILARI → NEWS HARİTASI KAYDI.
 *
 * Köşe yazıları (data/columns.json) editörün elle yayımladığı özgün kanaat
 * metinleridir; otomatik keşif haberi değildir. Bu yüzden ince-haber kuralı
 * (services/newsIndexPolicy.js) onlara uygulanmaz: kayıt `kind: "column"`
 * taşır ve üretici `isExcluded`'da bu türü atlar. Adres, köşe yazısı
 * sayfasının canonical'ıyla aynı: uzantısız `/kose-yazilari/<slug>`
 * (bkz. generate-column-pages.mjs `publicUrl`). 48 saat penceresini ve
 * gelecek tarih elemesini buildNewsSitemap uygular.
 *
 * @param {object[]} columns  columnService.publishedColumns(...).columns (Türkçe)
 * @param {string} domain     https://www.futbolradar.com
 */
export function columnNewsItems(columns, domain) {
  return (columns || [])
    .filter((column) => column && column.path && column.title && column.date && column.locale !== "en")
    .map((column) => ({
      kind: "column",
      id: column.id,
      title: column.title,
      publishedAt: column.date,
      url: `${domain}/${String(column.path).replace(/\.html$/i, "")}`
    }));
}

/**
 * @param {object[]} articles  yayımlanabilir haberler (publishedAt, title, …)
 * @param {{now?: number, urlFor: (a: object) => string, isExcluded?: (a: object) => boolean}} options
 * @returns {{xml: string, count: number}}
 */
export function buildNewsSitemap(articles, { now = Date.now(), urlFor, isExcluded = () => false } = {}) {
  const fresh = (articles || [])
    .filter((article) => {
      const time = Date.parse((article && article.publishedAt) || "");
      // Gelecek tarihli kayıt (saat kayması) haritaya girmez: henüz yayımlanmamış sayılır.
      return Number.isFinite(time) && time <= now && now - time <= NEWS_WINDOW_MS && !isExcluded(article);
    })
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, NEWS_MAX_URLS);
  const seen = new Set();
  const entries = [];
  for (const article of fresh) {
    const loc = urlFor(article);
    if (!loc || seen.has(loc)) continue;
    seen.add(loc);
    entries.push(`  <url>
    <loc>${escapeXml(loc)}</loc>
    <news:news>
      <news:publication>
        <news:name>${escapeXml(NEWS_PUBLICATION.name)}</news:name>
        <news:language>${NEWS_PUBLICATION.language}</news:language>
      </news:publication>
      <news:publication_date>${escapeXml(article.publishedAt)}</news:publication_date>
      <news:title>${escapeXml(article.title)}</news:title>
    </news:news>
  </url>`);
  }
  // Boş harita da geçerli bir haritadır; ama neden boş olduğu yorumda yazılsın
  // (Search Console'da "sitemap boş" uyarısını okuyan kişi arızayla karıştırmasın).
  const body = entries.length ? entries.join("\n") : "  <!-- Son 48 saatte Google News ölçütlerine uyan (otomatik üretilmemiş) haber yok. -->";
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${body}
</urlset>
`;
  return { xml, count: entries.length };
}

/**
 * İSTEK ANINDA 48 SAAT SÜZGECİ — KAPANIMSIZ, KENDİ KENDİNE YETEN İŞLEV.
 *
 * `buildNewsSitemap` pencereyi DERLEME anında uygular; dosya statiktir ve bir
 * sonraki derlemeye kadar değişmez. Derlemeler arası boşluk saatleri bulabilir
 * (25.11.2026: son derlemeden 10 saat sonra canlı haritadaki 11 kaydın 3'ü 48
 * saati aşmıştı). Bu işlev aynı kuralı haritanın XML'ine İSTEK anında uygular:
 * süresi dolan `<url>` bloğu düşer, geri kalan bayt bayt aynı kalır.
 *
 * Yeni kayıt EKLEMEZ — yeni yazı her zaman derlemeyle gelir (sayfası da o
 * derlemede doğar). Yalnızca eskiyeni ayıklar.
 *
 * NEDEN KAPANIMSIZ: `generate-stat-comparison-module.mjs` bu işlevin KAYNAK
 * METNİNİ (`toString()`) `middleware.js` içine gömer; edge çalışma zamanında
 * bu modül yoktur. Bu yüzden gövde dışarıdan hiçbir ad okumaz (pencere sabiti
 * dahil — `NEWS_WINDOW_MS` ile eşitliği test denetler) ve modül düzeyinde
 * hiçbir yardımcıya başvurmaz. Birim testi tek yerde, iki kullanım aynı kod.
 *
 * @param {string} xml  News site haritası belgesi
 * @param {number} now  epoch ms
 * @returns {{xml: string, kept: number, dropped: number} | null}
 *   `null`: metin bir urlset değil (çağıran statik dosyaya düşmeli).
 */
export function filterFreshNewsSitemap(xml, now) {
  const text = String(xml == null ? "" : xml);
  if (text.indexOf("<urlset") === -1 || text.indexOf("</urlset>") === -1) return null;
  const windowMs = 172800000; // 48 saat
  let kept = 0;
  let dropped = 0;
  let out = text.replace(/[ \t]*<url>[\s\S]*?<\/url>[ \t]*\r?\n?/g, (block) => {
    const match = /<news:publication_date>([^<]+)<\/news:publication_date>/.exec(block);
    const time = match ? Date.parse(match[1]) : NaN;
    if (Number.isFinite(time) && time <= now && now - time <= windowMs) {
      kept += 1;
      return block;
    }
    dropped += 1;
    return "";
  });
  // Boş harita da geçerlidir; nedenini yorum söyler (kaynak zaten boşsa yorumu taşır).
  if (!kept && out.indexOf("<!--") === -1) {
    out = out.replace("</urlset>", "  <!-- Son 48 saatte yayımlanan haber ya da köşe yazısı yok. -->\n</urlset>");
  }
  return { xml: out, kept, dropped };
}
