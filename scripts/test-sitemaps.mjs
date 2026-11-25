#!/usr/bin/env node
/**
 * ROBOTS.TXT, SITEMAP.XML VE NEWS-SITEMAP.XML DOĞRULAMASI.
 *
 *  1. robots.txt: tüm siteyi kapatmıyor, sitemap-index + news mutlak ve
 *     kanonik konakta bildirilmiş; kaynak dizinleri Disallow (CSS/JS/assets/data açık).
 *  2. Üç XML dosyası "iyi biçimli" (etiketler dengeli, tek kök, geçerli
 *     varlıklar) — harici XML kütüphanesi kullanmayan sıkı bir ayrıştırıcıyla.
 *  3. sitemap.xml protokol sınırları: <= 50.000 adres, <= 50 MB, adresler
 *     mutlak https + kanonik konak, tekrar yok, lastmod W3C ve gelecekte
 *     değil, changefreq/priority geçerli.
 *  4. Her sitemap adresi 200 verir (yönlendirme yok), noindex DEĞİL ve
 *     canonical'ı kendisi; hreflang alternate'leri harita içinde karşılıklı.
 *  5. news-sitemap.xml: Google News kuralları (48 saat penceresi, publication
 *     name/language, publication_date, title, <= 1000) — hem üretici işlev
 *     sınır değerleriyle hem diskteki dosya. Harita robots.txt'de ve ana
 *     sitemap indeksinde bildirilmiş olmalı.
 *  6. 48 saat penceresi İSTEK anında: `filterFreshNewsSitemap` sınır değerleri
 *     ve edge middleware'in (/news-sitemap.xml) gerçek davranışı — kaynak
 *     okunamazsa statik dosyaya düşmesi dahil.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { DOMAIN, auditSitemap, createResolver } from "./lib-link-audit.mjs";
import {
  NEWS_MAX_URLS,
  NEWS_PUBLICATION,
  NEWS_SITEMAP_FILE,
  NEWS_SITEMAP_SOURCE_FILE,
  NEWS_WINDOW_MS,
  buildNewsSitemap,
  columnNewsItems,
  filterFreshNewsSitemap
} from "./lib/newsSitemap.mjs";

const { PUBLICATION_NAME } = createRequire(import.meta.url)("../services/newsArticleSchema.js");

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
console.log("sitemaps");

// ── 0. Sıkı XML iyi-biçimlilik denetleyicisi ───────────────────────────────
/** @returns {{ok: boolean, error?: string, elements?: number}} */
export function checkWellFormed(xml) {
  const text = xml.replace(/^﻿/, "");
  if (!/^<\?xml\s+version="1\.0"(\s+encoding="[^"]+")?\s*\?>/.test(text)) return { ok: false, error: "XML bildirimi (<?xml version=\"1.0\"?>) yok" };
  const NAME = "[A-Za-z_][\\w.-]*(?::[A-Za-z_][\\w.-]*)?";
  const token = new RegExp(`<!--[\\s\\S]*?-->|<(/?)(${NAME})((?:\\s+${NAME}\\s*=\\s*(?:"[^"<]*"|'[^'<]*'))*)\\s*(/?)>|<\\?[\\s\\S]*?\\?>|[^<]+|<`, "g");
  const stack = [];
  let roots = 0;
  let elements = 0;
  let position = 0;
  let match;
  while ((match = token.exec(text)) !== null) {
    const [whole, closing, name, , selfClosing] = match;
    position = match.index;
    if (whole === "<") return { ok: false, error: `geçersiz '<' (konum ${position})` };
    if (whole.startsWith("<!--") || whole.startsWith("<?")) continue;
    if (name) {
      if (closing) {
        const open = stack.pop();
        if (open !== name) return { ok: false, error: `</${name}> beklenen </${open || "?"}> (konum ${position})` };
      } else {
        if (stack.length === 0) roots += 1;
        elements += 1;
        if (!selfClosing) stack.push(name);
      }
      continue;
    }
    // Metin: çıplak '&' ya da tanımsız varlık yasak.
    if (stack.length === 0 && whole.trim()) return { ok: false, error: `kök dışında metin (konum ${position})` };
    const badEntity = whole.match(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/);
    if (badEntity) return { ok: false, error: `geçersiz varlık '&' (konum ${position + badEntity.index}): "${whole.slice(badEntity.index, badEntity.index + 20)}"` };
  }
  if (stack.length) return { ok: false, error: `kapanmamış etiket <${stack[stack.length - 1]}>` };
  if (roots !== 1) return { ok: false, error: `${roots} kök öğe` };
  return { ok: true, elements };
}

// Denetleyicinin kendisi
{
  assert.equal(checkWellFormed('<?xml version="1.0" encoding="UTF-8"?><a><b x="1">&amp;&#39;</b><!-- c --></a>').ok, true);
  assert.equal(checkWellFormed('<?xml version="1.0"?><a><b></a></b>').ok, false, "iç içe geçme");
  assert.equal(checkWellFormed('<?xml version="1.0"?><a>Tom & Jerry</a>').ok, false, "çıplak &");
  assert.equal(checkWellFormed('<?xml version="1.0"?><a>&nbsp;</a>').ok, false, "HTML varlığı XML'de yok");
  assert.equal(checkWellFormed('<?xml version="1.0"?><a/><b/>').ok, false, "iki kök");
  assert.equal(checkWellFormed('<a/>').ok, false, "bildirim yok");
  assert.equal(checkWellFormed('<?xml version="1.0"?><a><b></a>').ok, false, "kapanmamış");
  console.log("  ok  XML denetleyicisi: geçerli örnek geçiyor, 6 bozuk örnek yakalanıyor");
}

// ── 1. robots.txt ───────────────────────────────────────────────────────────
{
  const robots = read("robots.txt");
  const lines = robots.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const groups = [];
  let current = null;
  const sitemaps = [];
  for (const line of lines) {
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    assert.ok(m, `robots.txt: geçersiz satır "${line}"`);
    const key = m[1].toLowerCase();
    if (key === "user-agent") { current = { agents: [m[2]], rules: [] }; groups.push(current); }
    else if (key === "sitemap") sitemaps.push(m[2]);
    else { assert.ok(["allow", "disallow", "crawl-delay", "host"].includes(key), `robots.txt: bilinmeyen yönerge ${key}`); assert.ok(current, "robots.txt: kural bir User-agent grubundan önce"); current.rules.push([key, m[2]]); }
  }
  assert.ok(groups.length >= 1, "robots.txt: User-agent grubu yok");
  const star = groups.find((g) => g.agents.includes("*"));
  assert.ok(star, "robots.txt: User-agent: * grubu yok");
  assert.ok(!star.rules.some(([k, v]) => k === "disallow" && (v === "/" || v === "/*")), "robots.txt: tüm site Disallow ile kapatılmış");
  assert.ok(!star.rules.some(([k, v]) => k === "disallow" && /\.(css|js)\b|\/assets|\/data\//.test(v)), "robots.txt: CSS/JS/veri kaynakları engellenmemeli (Googlebot render eder)");
  for (const sitemap of sitemaps) {
    assert.ok(sitemap.startsWith(`${DOMAIN}/`), `robots.txt: Sitemap kanonik konakta değil: ${sitemap}`);
    assert.ok(fs.existsSync(path.join(root, sitemap.slice(DOMAIN.length + 1))), `robots.txt: bildirilen dosya yok: ${sitemap}`);
  }
  assert.ok(sitemaps.includes(`${DOMAIN}/sitemap-index.xml`), "robots.txt: sitemap-index.xml bildirilmemiş");
  assert.ok(sitemaps.includes(`${DOMAIN}/news-sitemap.xml`), "robots.txt: news-sitemap.xml bildirilmemiş");
  assert.ok(fs.existsSync(path.join(root, "sitemap-index.xml")), "sitemap-index.xml dosyası yok");
  const disallows = new Set(star.rules.filter(([k]) => k === "disallow").map(([, v]) => v));
  for (const pathRule of ["/docs/", "/scripts/", "/services/", "/tests/", "/supabase/", "/server/", "/admin-", "/public/"]) {
    assert.ok(disallows.has(pathRule), `robots.txt: Disallow ${pathRule} eksik`);
  }
  assert.ok(!disallows.has("/data/"), "robots.txt: /data/ engellenmemeli");
  console.log(`  ok  robots.txt: ${groups.length} grup, ${sitemaps.length} harita bildirimi, kaynak dizinleri kapalı`);
}

// ── 2. Üç XML dosyası iyi biçimli ──────────────────────────────────────────
for (const file of ["sitemap.xml", "news-sitemap.xml", "public/sitemap.xml", "public/news-sitemap.xml"]) {
  const result = checkWellFormed(read(file));
  assert.ok(result.ok, `${file}: XML iyi biçimli değil: ${result.error}`);
}
assert.equal(read("sitemap.xml"), read("public/sitemap.xml"), "public/sitemap.xml ayna kopyası kökle aynı olmalı");
assert.equal(read("news-sitemap.xml"), read("public/news-sitemap.xml"), "public/news-sitemap.xml ayna kopyası kökle aynı olmalı");
if (fs.existsSync(path.join(root, "sitemap-index.xml"))) {
  assert.ok(checkWellFormed(read("sitemap-index.xml")).ok, "sitemap-index.xml iyi biçimli değil");
  assert.equal(read("sitemap-index.xml"), read("public/sitemap-index.xml"), "public/sitemap-index.xml ayna kopyası kökle aynı olmalı");
  const childLocs = [...read("sitemap-index.xml").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.ok(childLocs.length >= 1, "sitemap-index.xml boş");
  for (const loc of childLocs) {
    assert.ok(loc.startsWith(`${DOMAIN}/`), `indeks çocuğu kanonik konakta değil: ${loc}`);
    const rel = loc.slice(DOMAIN.length + 1);
    assert.ok(fs.existsSync(path.join(root, rel)), `indeks çocuğu yok: ${rel}`);
    assert.ok(checkWellFormed(read(rel)).ok, `${rel}: iyi biçimli değil`);
  }
  assert.ok(childLocs.includes(`${DOMAIN}/${NEWS_SITEMAP_FILE}`), "sitemap-index.xml: news-sitemap.xml bildirilmemiş");
  assert.equal(new Set(childLocs).size, childLocs.length, "sitemap-index.xml: aynı harita iki kez bildirilmiş");
  console.log(`  ok  sitemap-index.xml + ${childLocs.length} çocuk harita iyi biçimli (news-sitemap.xml dahil)`);
}
console.log("  ok  sitemap.xml ve news-sitemap.xml (ve public/ aynaları) iyi biçimli XML");

// ── 3. sitemap.xml protokol sınırları ──────────────────────────────────────
const xml = read("sitemap.xml");
const entries = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => m[1]);
const urls = [];
{
  assert.ok(Buffer.byteLength(xml) <= 50 * 1024 * 1024, "sitemap.xml 50 MB sınırını aşıyor");
  assert.ok(entries.length <= 50000, `sitemap.xml ${entries.length} adres (sınır 50.000)`);
  assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/, "sitemap ad alanı");
  const seen = new Set();
  const today = new Date(Date.now() + 36 * 3600000).toISOString().slice(0, 10);
  const CHANGEFREQ = new Set(["always", "hourly", "daily", "weekly", "monthly", "yearly", "never"]);
  for (const entry of entries) {
    const loc = (/<loc>([^<]+)<\/loc>/.exec(entry) || [])[1];
    assert.ok(loc, "<loc> yok");
    assert.ok(loc.startsWith(`${DOMAIN}/`) || loc === DOMAIN, `harita adresi kanonik konakta değil: ${loc}`);
    assert.ok(loc.length <= 2048, `adres 2048 karakteri aşıyor: ${loc.slice(0, 80)}`);
    assert.ok(!/[#?\s]/.test(loc), `adreste #, ? ya da boşluk var: ${loc}`);
    assert.ok(!seen.has(loc), `harita adresi tekrarlanıyor: ${loc}`);
    seen.add(loc);
    urls.push(loc);
    const lastmod = (/<lastmod>([^<]+)<\/lastmod>/.exec(entry) || [])[1];
    if (lastmod) {
      assert.match(lastmod, /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/, `lastmod W3C biçiminde değil: ${loc} ${lastmod}`);
      assert.ok(lastmod.slice(0, 10) <= today, `lastmod gelecekte: ${loc} ${lastmod}`);
    }
    const changefreq = (/<changefreq>([^<]+)<\/changefreq>/.exec(entry) || [])[1];
    if (changefreq) assert.ok(CHANGEFREQ.has(changefreq), `changefreq geçersiz: ${loc} ${changefreq}`);
    const priority = (/<priority>([^<]+)<\/priority>/.exec(entry) || [])[1];
    if (priority) assert.ok(Number(priority) >= 0 && Number(priority) <= 1, `priority 0-1 dışında: ${loc} ${priority}`);
  }
  console.log(`  ok  sitemap.xml: ${entries.length} adres, tekrar yok, kanonik konak, lastmod/changefreq/priority geçerli`);
}

// ── 4. Adresler 200, indekslenebilir, canonical kendisi; hreflang karşılıklı ──
{
  const audit = auditSitemap(root);
  assert.equal(audit.total, entries.length);
  assert.deepEqual(audit.bad.slice(0, 5), [], `harita adresleri 200 vermiyor (${audit.bad.length}): ${JSON.stringify(audit.bad.slice(0, 3))}`);

  const resolver = createResolver(root);
  const normalize = (u) => u.replace(/\.html$/, "").replace(/\/index$/, "").replace(/\/$/, "");
  const problems = [];
  let dynamicUrls = 0;
  for (const loc of urls) {
    const res = resolver.resolve(decodeURI(loc.slice(DOMAIN.length) || "/"));
    // Bir adres sunucusuz işlevle sunuluyorsa (rewrite → /api/...) statik gövde
    // yoktur; aynı adrese ait üretilmiş statik dosya varsa onun etiketleri denetlenir.
    let file = res.file.replace(/^\//, "");
    if (file.startsWith("api/")) {
      dynamicUrls += 1;
      file = `${decodeURI(loc.slice(DOMAIN.length)).replace(/^\//, "")}.html`;
      if (!fs.existsSync(path.join(root, file))) continue;
    }
    const html = fs.readFileSync(path.join(root, file), "utf8");
    const head = html.split(/<\/head>/i)[0];
    const robots = (/<meta\s+name="robots"\s+content="([^"]*)"/i.exec(head) || [])[1] || "";
    const canonical = (/<link\s+rel="canonical"\s+href="([^"]*)"/i.exec(head) || [])[1] || "";
    if (/noindex/i.test(robots)) problems.push(`noindex sayfa haritada: ${loc}`);
    if (!canonical) problems.push(`canonical yok: ${loc}`);
    else if (normalize(canonical) !== normalize(loc)) problems.push(`canonical haritadaki adresle aynı değil: ${loc} → ${canonical}`);
  }
  assert.deepEqual(problems.slice(0, 5), [], `harita tutarsızlıkları (${problems.length}): ${problems.slice(0, 3).join(" | ")}`);

  // hreflang (xhtml:link) karşılıklılığı: A, B'yi alternate gösteriyorsa B de A'yı göstermeli
  // ve her kayıt kendisini de listelemeli.
  const alt = new Map();
  for (const entry of entries) {
    const loc = (/<loc>([^<]+)<\/loc>/.exec(entry) || [])[1];
    const links = [...entry.matchAll(/<xhtml:link\s+rel="alternate"\s+hreflang="([^"]+)"\s+href="([^"]+)"\s*\/>/g)].map((m) => ({ lang: m[1], href: m[2] }));
    if (links.length) alt.set(loc, links);
  }
  const hreflangProblems = [];
  for (const [loc, links] of alt) {
    if (!links.some((l) => normalize(l.href) === normalize(loc))) hreflangProblems.push(`${loc}: kendini alternate listelemiyor`);
    for (const { href } of links) {
      if (!urls.includes(href)) { hreflangProblems.push(`${loc}: alternate haritada yok ${href}`); continue; }
      const back = alt.get(href);
      if (!back || !back.some((l) => normalize(l.href) === normalize(loc))) hreflangProblems.push(`${loc}: ${href} geri bildirmiyor`);
    }
  }
  if (process.env.SM_DEBUG) console.log([...new Set(hreflangProblems)].join("\n"));
  assert.deepEqual(hreflangProblems.slice(0, 5), [], `sitemap hreflang sorunları (${hreflangProblems.length}): ${hreflangProblems.slice(0, 3).join(" | ")}`);
  console.log(`  ok  ${urls.length} harita adresi: 200 (yönlendirmesiz; ${dynamicUrls} tanesi sunucusuz işlevle), noindex değil, canonical kendisi; ${alt.size} kayıtta hreflang karşılıklı`);
}

// ── 5. News site haritası ───────────────────────────────────────────────────
{
  const now = Date.parse("2026-10-16T12:00:00Z");
  const hours = (n) => new Date(now - n * 3600000).toISOString();
  const articles = [
    { id: "a", title: "Taze & \"özgün\" haber", publishedAt: hours(1) },
    { id: "b", title: "Sınırda (47s)", publishedAt: hours(47) },
    { id: "c", title: "Sınır dışı (49s)", publishedAt: hours(49) },
    { id: "d", title: "Gelecek tarihli", publishedAt: hours(-3) },
    { id: "e", title: "Otomatik ince haber", publishedAt: hours(2), thin: true },
    { id: "f", title: "Tarihsiz" }
  ];
  const built = buildNewsSitemap(articles, { now, urlFor: (a) => `${DOMAIN}/haber/${a.id}`, isExcluded: (a) => a.thin });
  assert.equal(built.count, 2, "yalnızca 48 saat içindeki, otomatik olmayan, geleceğe taşmayan haberler girmeli");
  assert.ok(checkWellFormed(built.xml).ok, "üretilen News haritası iyi biçimli olmalı");
  assert.ok(built.xml.includes("Taze &amp; &quot;özgün&quot; haber"), "başlık XML'e kaçırılmalı");
  assert.ok(!built.xml.includes("/haber/c") && !built.xml.includes("/haber/d") && !built.xml.includes("/haber/e") && !built.xml.includes("/haber/f"));
  assert.equal(buildNewsSitemap([], { now, urlFor: () => "" }).count, 0);
  assert.ok(checkWellFormed(buildNewsSitemap([], { now, urlFor: () => "" }).xml).ok, "boş harita da iyi biçimli");
  const many = Array.from({ length: 1200 }, (_, i) => ({ id: `n${i}`, title: `Haber ${i}`, publishedAt: hours(1 + (i % 40)) }));
  assert.equal(buildNewsSitemap(many, { now, urlFor: (a) => `${DOMAIN}/haber/${a.id}` }).count, NEWS_MAX_URLS, "harita başına en fazla 1.000 kayıt");
  assert.equal(NEWS_WINDOW_MS, 48 * 3600000);

  // Köşe yazıları: uzantısız canonical adres, ince-haber kuralından muaf, 48 saat penceresi.
  const columnItems = columnNewsItems([
    { id: "taze-yazi", path: "kose-yazilari/taze-yazi.html", title: "Taze köşe yazısı", date: hours(3), locale: "tr" },
    { id: "eski-yazi", path: "kose-yazilari/eski-yazi.html", title: "Eski köşe yazısı", date: hours(49), locale: "tr" },
    { id: "gelecek-yazi", path: "kose-yazilari/gelecek-yazi.html", title: "Gelecek", date: hours(-1), locale: "tr" }
  ], DOMAIN);
  assert.equal(columnItems[0].url, `${DOMAIN}/kose-yazilari/taze-yazi`, "köşe yazısı adresi uzantısız canonical olmalı");
  const withColumns = buildNewsSitemap(columnItems, {
    now,
    urlFor: (item) => item.url,
    isExcluded: (item) => item.kind !== "column"
  });
  assert.equal(withColumns.count, 1, "yalnızca son 48 saatin, geleceğe tarihlenmemiş köşe yazısı haritaya girer");
  assert.ok(withColumns.xml.includes(`<loc>${DOMAIN}/kose-yazilari/taze-yazi</loc>`));

  const news = read("news-sitemap.xml");
  assert.match(news, /xmlns:news="http:\/\/www\.google\.com\/schemas\/sitemap-news\/0\.9"/, "news ad alanı");
  const newsEntries = [...news.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => m[1]);
  assert.ok(newsEntries.length <= NEWS_MAX_URLS);
  const seen = new Set();
  for (const entry of newsEntries) {
    const loc = (/<loc>([^<]+)<\/loc>/.exec(entry) || [])[1];
    assert.ok(loc && loc.startsWith(`${DOMAIN}/`), `news adresi kanonik konakta değil: ${loc}`);
    assert.ok(!seen.has(loc), `news adresi tekrarlanıyor: ${loc}`);
    seen.add(loc);
    assert.ok(urls.includes(loc), `news adresi sitemap.xml'de de olmalı: ${loc}`);
    assert.match(entry, /<news:name>[^<]+<\/news:name>/, `${loc}: news:name yok`);
    assert.match(entry, /<news:language>[a-z]{2,3}(-[A-Za-z]{2,4})?<\/news:language>/, `${loc}: news:language ISO 639 değil`);
    assert.ok(entry.includes(`<news:name>${NEWS_PUBLICATION.name}</news:name>`), `${loc}: news:name yayın adıyla aynı değil`);
    assert.ok(entry.includes("<news:language>tr</news:language>"), `${loc}: news:language tr olmalı`);
    const date = (/<news:publication_date>([^<]+)<\/news:publication_date>/.exec(entry) || [])[1];
    assert.ok(date && !Number.isNaN(Date.parse(date)) && /^\d{4}-\d{2}-\d{2}/.test(date), `${loc}: publication_date W3C değil: ${date}`);
    assert.match(entry, /<news:title>[^<]+<\/news:title>/, `${loc}: news:title yok`);
    assert.ok(!/<lastmod>/.test(entry), `${loc}: News haritasında lastmod olmamalı`);
  }
  // Yayın adı tek: News haritası ile NewsArticle `publisher.name` aynı adı taşır.
  assert.equal(NEWS_PUBLICATION.name, PUBLICATION_NAME, "news:name ile NewsArticle yayıncı adı ayrışmış");
  assert.equal(NEWS_PUBLICATION.language, "tr");
  console.log(`  ok  news-sitemap.xml: ${newsEntries.length} kayıt (48 saat penceresi, otomatik haber dışı, publication/language/date/title) ve üretici sınır değerleri`);
}

// ── 6. 48 saat penceresi istek anında: süzgeç + edge middleware ────────────
{
  const now = Date.parse("2026-11-25T12:00:00Z");
  const iso = (hoursAgo) => new Date(now - hoursAgo * 3600000).toISOString();
  const block = (id, hoursAgo) => `  <url>
    <loc>${DOMAIN}/haber/${id}</loc>
    <news:news>
      <news:publication>
        <news:name>${NEWS_PUBLICATION.name}</news:name>
        <news:language>tr</news:language>
      </news:publication>
      <news:publication_date>${iso(hoursAgo)}</news:publication_date>
      <news:title>Başlık ${id}</news:title>
    </news:news>
  </url>`;
  const wrap = (blocks) => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${blocks.join("\n")}
</urlset>
`;
  const source = wrap([block("taze", 1), block("sinirda", 48), block("eski", 48.01), block("gelecek", -2), "  <url>\n    <loc>" + DOMAIN + "/haber/tarihsiz</loc>\n  </url>"]);

  const filtered = filterFreshNewsSitemap(source, now);
  assert.deepEqual([filtered.kept, filtered.dropped], [2, 3], "tam 48 saat içindeki kalır; aşan, geleceğe tarihli ve tarihsiz kayıt düşer");
  assert.equal(filtered.xml, wrap([block("taze", 1), block("sinirda", 48)]), "kalan kayıtlar bayt bayt aynı, düşenlerden iz kalmaz");
  assert.ok(checkWellFormed(filtered.xml).ok, "süzülmüş harita iyi biçimli");
  // Taze haritaya dokunulmaz: derleme çıktısı ile istek anı çıktısı aynı.
  const fresh = wrap([block("a", 1), block("b", 2)]);
  assert.equal(filterFreshNewsSitemap(fresh, now).xml, fresh);
  // Hepsi eskidiyse harita boş ama geçerli; boş derlenmiş harita da öyle kalır.
  const allStale = filterFreshNewsSitemap(wrap([block("x", 60), block("y", 90)]), now);
  assert.equal(allStale.kept, 0);
  assert.ok(checkWellFormed(allStale.xml).ok && !allStale.xml.includes("<url>") && /<!--[^>]+-->/.test(allStale.xml), "tamamı eskiyen harita: boş, iyi biçimli, nedeni yorumda");
  const builtEmpty = buildNewsSitemap([], { now, urlFor: () => "" }).xml;
  assert.equal(filterFreshNewsSitemap(builtEmpty, now).xml, builtEmpty, "boş derlenmiş haritaya ikinci yorum eklenmez");
  // urlset olmayan gövde (hata sayfası vb.) süzülmez: çağıran statik dosyaya düşer.
  assert.equal(filterFreshNewsSitemap("<!doctype html><title>404</title>", now), null);
  assert.equal(filterFreshNewsSitemap("", now), null);
  // İşlev pencere sabitini kendi içinde taşır (middleware'e kaynak metniyle gömülür); sabitle eşit olmalı.
  assert.ok(filterFreshNewsSitemap.toString().includes(String(NEWS_WINDOW_MS)), "süzgecin gömülü penceresi NEWS_WINDOW_MS ile aynı olmalı");
  // Üreticinin kendi çıktısı da aynı süzgeçten değişmeden geçer (iki kural aynı pencere).
  const built = buildNewsSitemap([{ id: "n1", title: "Bir", publishedAt: iso(47.9) }, { id: "n2", title: "İki", publishedAt: iso(0.1) }], { now, urlFor: (a) => `${DOMAIN}/haber/${a.id}` });
  assert.equal(filterFreshNewsSitemap(built.xml, now).xml, built.xml);

  // Kaynak kopya asıl dosyayla aynı (kök + public aynası).
  assert.equal(read(NEWS_SITEMAP_SOURCE_FILE), read(NEWS_SITEMAP_FILE), `${NEWS_SITEMAP_SOURCE_FILE} asıl haritayla aynı olmalı`);
  assert.equal(read(`public/${NEWS_SITEMAP_SOURCE_FILE}`), read(NEWS_SITEMAP_FILE), `public/${NEWS_SITEMAP_SOURCE_FILE} asıl haritayla aynı olmalı`);

  // Edge middleware: dosyanın KENDİSİ yüklenir (ESM; paket türünden bağımsız olsun diye .mjs kopyası).
  const middlewareSource = read("middleware.js");
  assert.ok(middlewareSource.includes(filterFreshNewsSitemap.toString()), "middleware.js süzgeci lib/newsSitemap.mjs kaynağından gömmeli (elle yazılmış kopya değil)");
  const copy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fr-middleware-")), "middleware.mjs");
  fs.writeFileSync(copy, middlewareSource, "utf8");
  const edge = await import(pathToFileURL(copy).href);
  assert.ok(edge.config.matcher.includes(`/${NEWS_SITEMAP_FILE}`), "middleware matcher: /news-sitemap.xml yok");
  assert.ok(edge.config.matcher.includes("/karsilastirma/:path*"), "middleware matcher: kıyas yönlendirmesi korunmalı");
  assert.ok(!edge.config.matcher.includes(`/${NEWS_SITEMAP_SOURCE_FILE}`), "kaynak kopya middleware'den geçmemeli (kendini çağırırdı)");

  const realFetch = globalThis.fetch;
  const realNow = Date.now;
  const request = () => new Request(`${DOMAIN}/${NEWS_SITEMAP_FILE}`);
  const calls = [];
  try {
    Date.now = () => now;
    globalThis.fetch = async (url) => { calls.push(String(url)); return new Response(source, { status: 200, headers: { "content-type": "application/xml" } }); };
    const response = await edge.default(request());
    assert.ok(response instanceof Response && response.status === 200, "middleware süzülmüş haritayı 200 ile döndürmeli");
    assert.deepEqual(calls, [`${DOMAIN}/${NEWS_SITEMAP_SOURCE_FILE}`], "middleware yalnızca kaynak kopyayı okumalı");
    assert.match(response.headers.get("content-type"), /^application\/xml/);
    assert.equal(response.headers.get("x-news-sitemap"), "live; kept=2; dropped=3");
    assert.equal(await response.text(), filtered.xml, "middleware çıktısı süzgecin çıktısıyla aynı");

    // Kaynak yoksa / hata verirse / urlset değilse: undefined → istek statik dosyaya düşer.
    globalThis.fetch = async () => new Response("yok", { status: 404 });
    assert.equal(await edge.default(request()), undefined, "kaynak 404: statik dosyaya düşmeli");
    globalThis.fetch = async () => { throw new Error("ağ hatası"); };
    assert.equal(await edge.default(request()), undefined, "kaynak okunamadı: statik dosyaya düşmeli");
    globalThis.fetch = async () => new Response("<!doctype html><title>Hata</title>", { status: 200 });
    assert.equal(await edge.default(request()), undefined, "urlset olmayan gövde: statik dosyaya düşmeli");

    // Kıyas yönlendirmesi olduğu gibi çalışır ve News dalına hiç girmez.
    globalThis.fetch = async () => { throw new Error("kıyas dalı ağ çağrısı yapmamalı"); };
    const [reversed, canonical] = (/"([a-z0-9-]+-vs-[a-z0-9-]+)": "([a-z0-9-]+-vs-[a-z0-9-]+)"/.exec(middlewareSource) || []).slice(1);
    assert.ok(reversed && canonical, "middleware.js: kanonik kıyas haritası boş");
    const redirect = edge.default(new Request(`${DOMAIN}/karsilastirma/${reversed}.html?x=1`));
    assert.equal(redirect.status, 301);
    assert.equal(redirect.headers.get("location"), `${DOMAIN}/karsilastirma/${canonical}`);
    assert.equal(edge.default(new Request(`${DOMAIN}/karsilastirma/${canonical}`)), undefined, "kanonik kıyas adresi statik sayfaya düşmeli");
  } finally {
    globalThis.fetch = realFetch;
    Date.now = realNow;
    fs.rmSync(path.dirname(copy), { recursive: true, force: true });
  }
  console.log("  ok  48 saat penceresi istek anında: süzgeç sınır değerleri + edge middleware (kaynak yoksa statik dosyaya düşer; kıyas yönlendirmesi sağlam)");
}

console.log("sitemaps: tamam");
