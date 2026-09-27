/**
 * DEVREDİLMİŞ TUR SAYFASI İKİNCİ BİR `SportsEvent` TAŞIMAZ.
 *
 * Kapı (`test-match-seo-pages.mjs`) bunu üretim ağacında doğruluyor ama
 * yalnızca hata ANINDA: devir, maça tarih atanan tek koşuda gerçekleşiyor
 * ve o koşu düşünce hiçbir şey commit edilmediği için ertesi gün aynı
 * yarış baştan kuruluyor. Bu test yarışı laboratuvarda kurar, böylece
 * kanıt canlı veriye ve günün şansına bağlı kalmaz.
 *
 * KURULAN DURUM (gerçek derleme sırasının aynısı):
 *   1. `generate-match-pages.mjs` tur sayfasını yazar. Maça tarih O KOŞUDA
 *      atandığı için sicilde kayıt yoktur; sayfa kendi kanoniğiyle ve
 *      `SportsEvent` düğümüyle doğar.
 *   2. `generate-match-seo-pages.mjs` tarihli Maç Merkezi sayfasını üretir.
 *   3. `unify-match-canonicals.mjs` devri yapar.
 *
 * Betik gerçek hâliyle, ayrı bir çalışma dizininde koşturulur — sahte bir
 * kopyası değil: kırılırsa bu test de kırılmalı.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { trSlugFor } = require("../services/matchSeoPages.js");

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, "unify-match-canonicals.mjs");
const DOMAIN = "https://www.futbolradar.com";

const HOME = "Beşiktaş";
const AWAY = "Amed Sportif Faaliyetler";
const KICKOFF = "2026-09-17T22:00:00+03:00";

// Slug hesaplanır, elle yazılmaz: `canonicalTeamName` kulüp adını
// sadeleştirebilir ve testin sabit bir yazıma çakılması, betik doğru
// çalışırken bile testi kırardı.
const targetSlug = trSlugFor(HOME, AWAY, KICKOFF);
assert.ok(targetSlug, "test kurulumu: hedef slug üretilemedi");

const sportsEvent = {
  "@type": "SportsEvent",
  name: `${HOME} - ${AWAY}`,
  url: `${DOMAIN}/mac/PLACEHOLDER`,
  startDate: KICKOFF,
  homeTeam: { "@type": "SportsTeam", name: HOME },
  awayTeam: { "@type": "SportsTeam", name: AWAY }
};

const breadcrumb = {
  "@type": "BreadcrumbList",
  itemListElement: [{ "@type": "ListItem", position: 1, name: "Ana Sayfa", item: `${DOMAIN}/` }]
};

/** Üreticilerin bastığı biçim: tek satır, `JSON.stringify` (boşluksuz). */
function page({ slug, nodes, breadcrumb = true }) {
  const graph = nodes.map((node) => (node === sportsEvent ? { ...node, url: `${DOMAIN}/mac/${slug}` } : node));
  return [
    "<!doctype html>",
    '<html lang="tr"><head>',
    `    <link rel="canonical" href="${DOMAIN}/mac/${slug}.html" />`,
    `    <meta property="og:url" content="${DOMAIN}/mac/${slug}.html" />`,
    `    <script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph })}</script>`,
    '</head><body class="subpage match-analysis-page"><main class="container">',
    ...(breadcrumb
      ? ['      <nav class="breadcrumb" aria-label="Sayfa yolu"><a href="../index.html">Ana Sayfa</a><span>/</span><a href="../super-lig-fikstur.html">Süper Lig Fikstürü</a><span>/</span><span>test</span></nav>']
      : []),
    '      <section class="hero match-analysis-hero"><h1>test</h1></section>',
    "</main></body></html>",
    ""
  ].join("\n");
}

const roundSlug = "besiktas-amed-sportif-faaliyetler-2026-2027-r06";
const fallbackRoundSlug = "besiktas-amed-sportif-faaliyetler-2026-2027-r07";
// Kontrol grubu: hedefi OLMAYAN tur sayfası. Ona dokunulmamalı; aksi hâlde
// düzeltme, tarihi henüz kesinleşmemiş maçı şemasız bırakırdı.
const lonelySlug = "goztepe-konyaspor-2026-2027-r09";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fr-canonical-"));
fs.mkdirSync(path.join(dir, "mac"), { recursive: true });
fs.mkdirSync(path.join(dir, "data"), { recursive: true });

const files = {
  target: path.join(dir, "mac", `${targetSlug}.html`),
  round: path.join(dir, "mac", `${roundSlug}.html`),
  fallbackRound: path.join(dir, "mac", `${fallbackRoundSlug}.html`),
  lonely: path.join(dir, "mac", `${lonelySlug}.html`)
};

fs.writeFileSync(files.target, page({ slug: targetSlug, nodes: [breadcrumb, sportsEvent] }), "utf8");
fs.writeFileSync(files.round, page({ slug: roundSlug, nodes: [breadcrumb, sportsEvent] }), "utf8");
fs.writeFileSync(files.fallbackRound, page({ slug: fallbackRoundSlug, nodes: [breadcrumb, sportsEvent], breadcrumb: false }), "utf8");
fs.writeFileSync(files.lonely, page({
  slug: lonelySlug,
  nodes: [breadcrumb, { ...sportsEvent, name: "Göztepe - Konyaspor", homeTeam: { "@type": "SportsTeam", name: "Göztepe" }, awayTeam: { "@type": "SportsTeam", name: "Konyaspor" } }]
}), "utf8");

const sitemapUrl = (slug) => `  <url><loc>${DOMAIN}/mac/${slug}.html</loc></url>`;
fs.writeFileSync(
  path.join(dir, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset>\n${[targetSlug, roundSlug, fallbackRoundSlug, lonelySlug].map(sitemapUrl).join("\n")}\n</urlset>\n`,
  "utf8"
);

const run = () => execFileSync(process.execPath, [SCRIPT], { cwd: dir, encoding: "utf8" });
const read = (file) => fs.readFileSync(file, "utf8");

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}`);
    console.error(`       ${error.message.split("\n")[0]}`);
  }
}

console.log("match-canonical-round-schema");
run();

const roundAfter = read(files.round);
const fallbackRoundAfter = read(files.fallbackRound);

check("devredilmiş tur sayfasında SportsEvent kalmaz", () => {
  assert.ok(!roundAfter.includes("SportsEvent"), "tur sayfasında SportsEvent hâlâ duruyor");
});

check("kanonik Maç Merkezi'ni gösterir", () => {
  assert.match(roundAfter, new RegExp(`rel="canonical" href="${DOMAIN}/mac/${targetSlug}"`));
});

check("kullanıcıya görünen devir şeridi eklenir", () => {
  assert.ok(roundAfter.includes('class="match-centre-handoff"'), "devir şeridi eklenmedi");
  assert.ok(roundAfter.includes(`href="../mac/${targetSlug}"`), "devir şeridi hedefe bağlanmadı");
});

check("breadcrumb olmasa da devir şeridi eklenir", () => {
  assert.ok(fallbackRoundAfter.includes('class="match-centre-handoff"'), "fallback devir şeridi eklenmedi");
  assert.ok(fallbackRoundAfter.includes(`href="../mac/${targetSlug}"`), "fallback devir şeridi hedefe bağlanmadı");
});

check("sayfanın kendi düğümleri korunur (BreadcrumbList)", () => {
  assert.ok(roundAfter.includes("BreadcrumbList"), "BreadcrumbList da silinmiş");
  assert.ok(roundAfter.includes('<script type="application/ld+json">'), "JSON-LD bloğu komple gitmiş");
});

check("kalan JSON-LD geçerli ve üretici biçiminde", () => {
  const raw = roundAfter.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
  const parsed = JSON.parse(raw);
  assert.equal(parsed["@context"], "https://schema.org");
  assert.equal(parsed["@graph"].length, 1);
  assert.equal(parsed["@graph"][0]["@type"], "BreadcrumbList");
});

check("hedef sayfa kendi SportsEvent'ini korur", () => {
  assert.ok(read(files.target).includes("SportsEvent"), "kanonik sayfanın şeması sökülmüş");
});

check("hedefi olmayan tur sayfasına dokunulmaz", () => {
  const lonely = read(files.lonely);
  assert.ok(lonely.includes("SportsEvent"), "hedefi olmayan sayfa şemasız bırakılmış");
  assert.match(lonely, new RegExp(`rel="canonical" href="${DOMAIN}/mac/${lonelySlug}\\.html"`));
});

check("takma ad site haritasından düşer, hedef kalır", () => {
  const sitemap = read(path.join(dir, "sitemap.xml"));
  assert.ok(!sitemap.includes(`/mac/${roundSlug}.html`), "takma ad haritada kalmış");
  assert.ok(!sitemap.includes(`/mac/${fallbackRoundSlug}.html`), "fallback takma ad haritada kalmış");
  assert.ok(sitemap.includes(`/mac/${targetSlug}.html`), "hedef haritadan düşmüş");
  assert.ok(sitemap.includes(`/mac/${lonelySlug}.html`), "hedefsiz sayfa haritadan düşmüş");
});

check("ikinci koşu hiçbir şeyi değiştirmez (idempotent)", () => {
  run();
  assert.equal(read(files.round), roundAfter, "betik ikinci koşuda kendi çıktısını yeniden yazdı");
});

fs.rmSync(dir, { recursive: true, force: true });

if (failures > 0) {
  console.error(`match-canonical-round-schema: FAILED (${failures})`);
  process.exit(1);
}
console.log("match-canonical-round-schema: passed");
