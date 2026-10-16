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

const XML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
export const escapeXml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);

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
