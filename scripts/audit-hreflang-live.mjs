#!/usr/bin/env node
/**
 * CANLI hreflang DENETİMİ (ağ gerekir; derlemeye ve testlere bağlı değil).
 *
 * `sitemaps/sitemap-en.xml` içindeki her İngilizce sayfayı ve hreflang ile
 * bildirdiği Türkçe karşılığını çeker, şunları sınar:
 *   - tr-TR, en ve x-default üçü de var; x-default Türkçe adrese eşit
 *   - alternate adresler sayfaların KENDİ canonical adresiyle aynı
 *   - ilişki karşılıklı: Türkçe sayfa İngilizceye, İngilizce sayfa Türkçeye bağlı
 *   - sitemap'teki İngilizce sayfa noindex değil; Türkçe karşılığı noindex değil
 *
 * Kullanım:
 *   node scripts/audit-hreflang-live.mjs                 # tümü (~6000 istek)
 *   node scripts/audit-hreflang-live.mjs --limit=200     # ilk 200 İngilizce sayfa
 *   node scripts/audit-hreflang-live.mjs --origin=https://www.futbolradar.com
 * Hata varsa çıkış kodu 1.
 */
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const ORIGIN = (args.origin || "https://www.futbolradar.com").replace(/\/$/, "");
const LIMIT = Number(args.limit) || Infinity;
const CONCURRENCY = 12;

async function get(url) {
  const res = await fetch(url, { redirect: "follow", headers: { "user-agent": "futbolradar-hreflang-audit" } });
  return { status: res.status, text: await res.text() };
}

function pageInfo(html) {
  const links = {};
  for (const tag of html.match(/<link\s+[^>]*rel="alternate"[^>]*>/g) || []) {
    const lang = (tag.match(/hreflang="([^"]+)"/) || [])[1];
    const href = (tag.match(/href="([^"]+)"/) || [])[1];
    if (lang && href) (links[lang] ||= []).push(href);
  }
  const canonical = (html.match(/<link rel="canonical" href="([^"]+)"/) || [])[1] || "";
  const robots = (html.match(/<meta name="robots" content="([^"]+)"/) || [])[1] || "";
  return { links, canonical, noindex: /noindex/i.test(robots) };
}

async function pool(items, worker) {
  const queue = [...items];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) await worker(queue.shift());
  }));
}

const problems = new Map();
const note = (kind, detail) => { if (!problems.has(kind)) problems.set(kind, []); problems.get(kind).push(detail); };

const sitemap = await get(`${ORIGIN}/sitemaps/sitemap-en.xml`);
const enUrls = [...sitemap.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).slice(0, LIMIT);
console.log(`${enUrls.length} İngilizce sayfa denetleniyor…`);

const enPages = new Map();
await pool(enUrls, async (url) => {
  const res = await get(url);
  if (res.status !== 200) return note(`http_${res.status}`, url);
  enPages.set(url, pageInfo(res.text));
});

const trUrls = new Set();
for (const [url, info] of enPages) {
  const L = info.links;
  if (!Object.keys(L).length) { note("hreflang_yok", url); continue; }
  for (const key of ["tr-TR", "en", "x-default"]) if (!L[key]) note(`eksik_${key}`, url);
  if (L["tr-TR"] && L["x-default"] && L["tr-TR"][0] !== L["x-default"][0]) note("xdefault_tr_degil", url);
  if (L.en && info.canonical && L.en[0] !== info.canonical) note("en_hreflang_canonical_degil", `${url} → ${L.en[0]} (canonical ${info.canonical})`);
  if (info.noindex) note("sitemapte_noindex", url);
  if (L["tr-TR"]) trUrls.add(L["tr-TR"][0]);
}

const trPages = new Map();
await pool([...trUrls], async (url) => {
  const res = await get(url);
  if (res.status !== 200) return note(`tr_http_${res.status}`, url);
  trPages.set(url, pageInfo(res.text));
});

for (const [enUrl, info] of enPages) {
  const trUrl = (info.links["tr-TR"] || [])[0];
  const tr = trUrl && trPages.get(trUrl);
  if (!tr) continue;
  const L = tr.links;
  if (!Object.keys(L).length) { note("tr_sayfada_hreflang_yok", `${trUrl} (EN: ${enUrl})`); continue; }
  if (tr.canonical && trUrl !== tr.canonical) note("tr_hreflang_canonical_degil", `${trUrl} (canonical ${tr.canonical})`);
  if (!L.en || L.en[0] !== (info.links.en || [])[0]) note("karsilikli_degil", `${trUrl} → ${(L.en || ["yok"])[0]} (EN sayfa ${enUrl})`);
  if (tr.noindex) note("tr_karsilik_noindex", `${trUrl} (EN: ${enUrl})`);
}

if (!problems.size) {
  console.log(`Temiz: ${enPages.size} İngilizce ve ${trPages.size} Türkçe sayfa tutarlı.`);
} else {
  for (const [kind, rows] of problems) {
    console.log(`\n${kind}: ${rows.length}`);
    rows.slice(0, 5).forEach((row) => console.log(`  - ${row}`));
  }
  process.exitCode = 1;
}
