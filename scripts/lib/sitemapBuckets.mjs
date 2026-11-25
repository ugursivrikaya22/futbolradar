/**
 * SİTE HARİTASI BÖLÜMLEME — tek urlset → türe göre çocuk haritalar + indeks.
 *
 * Üreticiler hâlâ birleşik `sitemap.xml` urlset'ine yazar (sıra bozulmasın).
 * Son işlemde bu modül aynı girdileri türe böler; `sitemap-index.xml` Google'a
 * bölümleri sunar. Birleşik dosya üreticiler ve mevcut testler için kalır.
 *
 * Görsel haritası YOK: sayfa başına özgün görsel envanteri yokken image
 * sitemap uydurulmaz (yalnızca ortak og-image.png var).
 */
import { URLSET_OPEN, wrapUrlset } from "./sitemap.mjs";

export const INDEX_OPEN =
  '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';

/** @typedef {{ id: string, file: string, test: (loc: string) => boolean }} Bucket */

/** Sıra önemli: ilk eşleşen kova kazanır. */
export const SITEMAP_BUCKETS = [
  { id: "comparisons", file: "sitemaps/sitemap-comparisons.xml", test: (loc) => /\/karsilastirma\//.test(loc) },
  { id: "matches", file: "sitemaps/sitemap-matches.xml", test: (loc) => /\/(mac|mac-raporu|mac-dosyasi|mac-takvimi|en\/match)\b/.test(loc) },
  { id: "players", file: "sitemaps/sitemap-players.xml", test: (loc) => /\/(futbolcu|oyuncular|players|en\/player)\b/.test(loc) },
  { id: "teams", file: "sitemaps/sitemap-teams.xml", test: (loc) => /\/takimlar\//.test(loc) },
  { id: "news", file: "sitemaps/sitemap-news-pages.xml", test: (loc) => /\/(haber|kose-yazilari|en\/news|en\/columns)\b/.test(loc) },
  { id: "en", file: "sitemaps/sitemap-en.xml", test: (loc) => /\/en(\/|$)/.test(loc) },
  { id: "core", file: "sitemaps/sitemap-core.xml", test: () => true }
];

const URL_BLOCK_RE = /[ \t]*<url>[\s\S]*?<\/url>[ \t]*\r?\n?/g;

/** urlset XML → { bucketId: entryXml[] } */
export function bucketUrlEntries(xml) {
  /** @type {Record<string, string[]>} */
  const out = Object.fromEntries(SITEMAP_BUCKETS.map((b) => [b.id, []]));
  for (const match of String(xml || "").matchAll(URL_BLOCK_RE)) {
    const block = match[0].trim();
    const loc = (block.match(/<loc>([^<]+)<\/loc>/) || [])[1];
    if (!loc) continue;
    const bucket = SITEMAP_BUCKETS.find((b) => b.test(loc.trim())) || SITEMAP_BUCKETS[SITEMAP_BUCKETS.length - 1];
    out[bucket.id].push(block.startsWith("<url>") ? `  ${block}` : block);
  }
  return out;
}

export function wrapSitemapIndex(entries, { domain = "https://www.futbolradar.com" } = {}) {
  const body = entries
    .map(({ file, lastmod }) => {
      const loc = `${domain}/${file.replace(/^\/+/, "")}`;
      const mod = lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : "";
      return `  <sitemap>\n    <loc>${loc}</loc>${mod}\n  </sitemap>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n${INDEX_OPEN}\n${body}\n</sitemapindex>\n`;
}

/**
 * Birleşik urlset'ten çocuk haritaları + indeks belgesi üretir.
 * Boş kovalar atlanır (boş urlset yayımlanmaz).
 *
 * `extraSitemaps`: birleşik urlset'ten TÜRETİLMEYEN ama indekste bildirilmesi
 * gereken haritalar — bugün yalnızca Google News haritası (`news-sitemap.xml`;
 * kendi üreticisi yazar, kendi `news:` ad alanını taşır). Sona eklenir; dosya
 * içeriğine dokunulmaz, `files` listesine girmez.
 */
export function buildSplitSitemaps(xml, { domain = "https://www.futbolradar.com", today = new Date().toISOString().slice(0, 10), extraSitemaps = [] } = {}) {
  const buckets = bucketUrlEntries(xml);
  /** @type {{ id: string, file: string, xml: string, count: number }[]} */
  const files = [];
  for (const def of SITEMAP_BUCKETS) {
    const entries = buckets[def.id] || [];
    if (!entries.length) continue;
    files.push({ id: def.id, file: def.file, xml: wrapUrlset(entries), count: entries.length });
  }
  const indexXml = wrapSitemapIndex(
    [
      ...files.map((f) => ({ file: f.file, lastmod: today })),
      ...extraSitemaps.map((file) => ({ file, lastmod: today }))
    ],
    { domain }
  );
  return { files, indexXml, total: files.reduce((n, f) => n + f.count, 0) };
}

export { URLSET_OPEN };
