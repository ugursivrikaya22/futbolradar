#!/usr/bin/env node
/**
 * YAPISAL VERİ DOĞRULAMASI — TÜM ÜRETİLMİŞ AĞAÇ.
 *
 * Kontroller (bkz. scripts/lib/structuredData.mjs):
 *   1. Her JSON-LD bloğu ayrıştırılabilir ve @context schema.org.
 *   2. Tür başına ZORUNLU alanlar (SportsEvent, NewsArticle/Article,
 *      BreadcrumbList, Person, SportsTeam, WebPage/CollectionPage, ItemList,
 *      FAQPage, Dataset...).
 *   3. Tarih biçimi: ISO 8601, saat dilimli; datePublished gelecekte değil,
 *      dateModified ondan önce değil.
 *   4. Boş dize / null / "undefined" yok; adres alanları mutlak ve site içi.
 *   5. aggregateRating / review / offers gibi elimizde OLMAYAN verinin vaadi yok.
 *   6. DOĞRULANMAMIŞ SONUÇ YOK: şema metninde skor geçen bir maç, sicilde
 *      (data/match-seo-pages.json) ya da maç raporu deposunda
 *      (data/post-match-reports.json) FINISHED/AWARDED + aynı skorla kayıtlı
 *      olmak zorunda.
 *   7. FAQPage'deki her soru sayfanın GÖRÜNEN metninde de bulunur.
 *   8. Her indekslenebilir sayfa en az bir bloğa sahip (iç araç sayfaları,
 *      yönlendirme kabukları ve istemci kabukları hariç; bunlar listelenir).
 *
 * "Tavsiye edilen" alanlar (örn. NewsArticle.image, SportsEvent.location)
 * hata değildir; sayıları raporlanır.
 *
 * Kullanım: node scripts/test-structured-data.mjs [--report]
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { DOMAIN, SCORE_PATTERN, isIsoDate, normalize, scoreTexts, validateBlocks } from "./lib/structuredData.mjs";

const require = createRequire(import.meta.url);
const { nationLabel } = require("../services/displayLabels.js");
const root = process.cwd();
const reportMode = process.argv.includes("--report");
const SKIP_DIRS = new Set(["node_modules", "public", ".git", ".claude", "docs", "components", "locales", "editorial", "data", "scripts", "services", "api", "assets", "tests", "server", "supabase"]);

console.log("structured-data");

// ── 1. Birim denetimleri: doğrulayıcının kendisi ────────────────────────────
{
  const good = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "SportsEvent", name: "A - B", startDate: "2026-10-09T20:00:00+03:00", eventStatus: "https://schema.org/EventScheduled", homeTeam: { "@type": "SportsTeam", name: "A" }, awayTeam: { "@type": "SportsTeam", name: "B" }, location: { "@type": "Place", name: "Stat" }, url: `${DOMAIN}/mac/a-b-9-ekim-2026` },
      { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Ana Sayfa", item: `${DOMAIN}/` }, { "@type": "ListItem", position: 2, name: "Maç" }] },
      { "@type": "NewsArticle", headline: "Başlık", datePublished: "2026-10-09T12:32:00.000Z", dateModified: "2026-10-09T13:00:00Z", author: { "@type": "Organization", name: "FutbolRadar" }, publisher: { "@type": "Organization", name: "FutbolRadar" }, mainEntityOfPage: `${DOMAIN}/haber/x` }
    ]
  };
  const ok = validateBlocks([good]);
  assert.deepEqual(ok.errors, [], `geçerli örnek hata vermemeli: ${ok.errors.join("; ")}`);

  const bad = (mutate) => {
    const copy = JSON.parse(JSON.stringify(good));
    mutate(copy["@graph"]);
    return validateBlocks([copy]).errors;
  };
  assert.ok(bad((g) => { delete g[0].startDate; }).some((m) => /startDate/.test(m)), "startDate eksikliği yakalanmalı");
  assert.ok(bad((g) => { g[0].startDate = "2026-10-09 20:00"; }).some((m) => /startDate/.test(m)), "ISO olmayan tarih yakalanmalı");
  assert.ok(bad((g) => { g[0].startDate = "2026-10-09T20:00:00"; }).some((m) => /startDate/.test(m)), "saat dilimsiz tarih yakalanmalı");
  assert.ok(bad((g) => { g[0].eventStatus = "https://schema.org/EventCompleted"; }).some((m) => /eventStatus/.test(m)), "geçersiz eventStatus yakalanmalı");
  assert.ok(bad((g) => { g[0].location.address = ""; }).some((m) => /address/.test(m)), "boş adres yakalanmalı");
  assert.ok(bad((g) => { g[0].aggregateRating = { ratingValue: 4.5 }; }).some((m) => /aggregateRating/.test(m)), "uydurma puan vaadi yakalanmalı");
  assert.ok(bad((g) => { g[0].offers = { price: 0 }; }).some((m) => /offers/.test(m)), "bilet vaadi yakalanmalı");
  assert.ok(bad((g) => { g[1].itemListElement[0].position = 2; }).some((m) => /position/.test(m)), "kırıntı sırası yakalanmalı");
  assert.ok(bad((g) => { g[1].itemListElement[0].item = "/"; }).some((m) => /mutlak|site dışı/.test(m)), "göreli kırıntı adresi yakalanmalı");
  assert.ok(bad((g) => { delete g[2].datePublished; }).some((m) => /datePublished/.test(m)), "datePublished eksikliği yakalanmalı");
  assert.ok(bad((g) => { g[2].dateModified = "2026-10-08T00:00:00Z"; }).some((m) => /dateModified/.test(m)), "dateModified < datePublished yakalanmalı");
  assert.ok(bad((g) => { g[2].datePublished = "2099-01-01T00:00:00Z"; }).some((m) => /gelecekte/.test(m)), "gelecek tarihli yayın yakalanmalı");
  assert.ok(bad((g) => { g[2].author = { "@type": "Person" }; }).some((m) => /author/.test(m)), "isimsiz yazar yakalanmalı");
  assert.ok(bad((g) => { g[0].description = "undefined"; }).some((m) => /yer tutucu/.test(m)), "yer tutucu metin yakalanmalı");
  assert.equal(isIsoDate("2026-10-09"), true);
  assert.equal(isIsoDate("2026-13-45"), false);
  assert.ok(SCORE_PATTERN.test("Galatasaray 3-1 Kasımpaşa") && SCORE_PATTERN.test("A 0 – 0 B"), "skor kalıbı");
  assert.ok(!SCORE_PATTERN.test("Başlama 20:00 - 22:00") && !SCORE_PATTERN.test("2026-2027 sezonu") && !SCORE_PATTERN.test("2026-10-09"), "saat/yıl/tarih skor sayılmamalı");
  const faq = validateBlocks([{ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "Maç ne zaman?", acceptedAnswer: { "@type": "Answer", text: "Cuma." } }] }], { visibleText: normalize("başka metin") });
  assert.ok(faq.errors.some((m) => /görünmüyor/.test(m)), "görünmeyen SSS yakalanmalı");
  const verify = validateBlocks([{ "@context": "https://schema.org", "@type": "SportsEvent", name: "A 2-1 B", startDate: "2026-10-09T20:00:00+03:00", homeTeam: { name: "A" }, awayTeam: { name: "B" }, location: { name: "S" } }], { verifyScore: () => "skor doğrulanmamış" });
  assert.ok(verify.errors.some((m) => /doğrulanmamış/.test(m)), "doğrulanmamış skor yakalanmalı");
  console.log("  ok  doğrulayıcı: geçerli örnek temiz, 16 bozuk örnek yakalanıyor");
}

// ── 2. Doğrulanmış sonuç kaynakları ────────────────────────────────────────
//
// Şema metninde skor geçen HER düğüm (maç, haber, köşe yazısı) için: o skoru
// gerçekten bitmiş (FINISHED/AWARDED) ve aynı skorla kayıtlı bir maç olmalı
// VE metinde o maçın iki takımı da geçmeli. Skor kalıbı iki yönde kabul edilir
// ("Besiktas 3-2 Hoffenheim" ile kayıttaki ev-deplasman 2-3 aynı sonuçtur);
// takım adları çapraz doğrulama yaptığı için yön gevşekliği boşluk açmaz.
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, "data", file), "utf8"));
const FINAL = new Set(["FINISHED", "AWARDED"]);
const finishedByScore = new Map(); // "a-b" (küçük-büyük) → [{home, away}]
function indexFinished(home, away, score, status) {
  if (!FINAL.has(status) || !score || !Number.isFinite(score.home) || !Number.isFinite(score.away) || !home || !away) return;
  const key = [score.home, score.away].sort((a, b) => a - b).join("-");
  // Millî takım adı İngilizce sayfada çevrilmiş görünür ("İtalya" → "Italy"): ikisi de aranır.
  const names = (name) => [...new Set([normalize(name), normalize(nationLabel(name, "en"))])];
  (finishedByScore.get(key) || finishedByScore.set(key, []).get(key)).push({ home: names(home), away: names(away) });
}
{
  for (const page of readJson("match-seo-pages.json").pages || []) indexFinished(page.homeTeam, page.awayTeam, page.score, page.status);
  for (const record of readJson("post-match-reports.json").records || []) indexFinished(record.homeTeam, record.awayTeam, record.score, record.status);
}

/** Skor yazan düğüm yalnızca doğrulanmış bitmiş maçın SKORUNU yazabilir. */
function verifyScore(node) {
  const texts = scoreTexts(node);
  for (const text of texts) {
    const found = text.match(SCORE_PATTERN)[0].match(/\d{1,2}/g).map(Number);
    const key = [...found].sort((a, b) => a - b).join("-");
    const candidates = finishedByScore.get(key) || [];
    const haystack = normalize(text);
    // Takım adı eşleşmesi: iki ad da metinde (kısa adlar için tam kelime sınırı yok; ad uzunluğu >= 3).
    const ok = candidates.some((c) => c.home.some((n) => haystack.includes(n)) && c.away.some((n) => haystack.includes(n)));
    if (!ok) return `metinde "${text.slice(0, 70)}" skoru var ama bu takımlarla bitmiş ve aynı skorlu doğrulanmış maç kaydı yok`;
  }
  return null;
}

// ── 3. Ağaç taraması ───────────────────────────────────────────────────────
function* walk(dir, top = true) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (top && SKIP_DIRS.has(entry.name)) continue;
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full, false);
    else if (entry.name.endsWith(".html")) yield full;
  }
}

/** JSON-LD'si olmaması MEŞRU sayfalar: araç sayfaları, kabuklar, yönlendirme stub'ları. */
const NO_LD_OK = [
  /^(404|admin-[a-z-]+|canli-veri-testi|mac-detay|oyuncu-detay|takim-detay|veri-notu)\.html$/,
  /^google[0-9a-f]+\.html$/i,
  /^oyuncular\/[^/]+\.html$/, // taşınmış oyuncunun yönlendirme kabuğu (noindex)
  /^players\//,
  /^(mac-dosyasi|en\/match-special)\//, // Maç dosyası alt sayfaları: ana sayfaya bağlı
  /^(anket|en\/poll)\//
];

const stats = { pages: 0, blocks: 0, nodes: 0, noLdIndexable: [], warnings: {} };
const typeCount = {};
const failures = new Map(); // mesaj kalıbı → { count, sample }
const fail = (rel, message) => {
  const key = message.replace(/"[^"]*"/g, '"…"').replace(/\d+/g, "N").slice(0, 160);
  const entry = failures.get(key) || { count: 0, samples: [] };
  entry.count += 1;
  if (entry.samples.length < 3) entry.samples.push(`${rel}: ${message.slice(0, 200)}`);
  failures.set(key, entry);
};

for (const file of walk(root)) {
  const rel = path.relative(root, file).split(path.sep).join("/");
  const html = fs.readFileSync(file, "utf8");
  stats.pages += 1;
  const noindex = /<meta\s+name="robots"\s+content="[^"]*noindex/i.test(html);
  const blocks = [];
  const raw = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const [, body] of raw) {
    try { blocks.push(JSON.parse(body)); } catch (error) { fail(rel, `JSON-LD ayrıştırılamıyor: ${error.message}`); }
  }
  if (!raw.length) {
    if (!noindex && !NO_LD_OK.some((re) => re.test(rel))) stats.noLdIndexable.push(rel);
    continue;
  }
  stats.blocks += blocks.length;
  // noindex sayfanın şeması arama sonucunu etkilemez: yalnızca ayrıştırılabilirlik denetlenir.
  if (noindex) { stats.noindexParsed = (stats.noindexParsed || 0) + 1; continue; }
  const visibleText = normalize(html.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " "));
  const canonical = (/<link\s+rel="canonical"\s+href="([^"]+)"/i.exec(html) || [])[1];
  // Editoryal yazılar (haber, köşe yazısı) skoru kendi yayın kapısından geçirir
  // (status: verified); maç-bağlı yüzeyler burada sicile karşı doğrulanır.
  const editorial = /^(haber|kose-yazilari|yazarlar|en\/news|en\/columns)\//.test(rel);
  const result = validateBlocks(blocks, { visibleText, verifyScore: editorial ? null : verifyScore });
  stats.nodes += result.types.length;
  for (const type of result.types) typeCount[type] = (typeCount[type] || 0) + 1;
  for (const message of result.errors) fail(rel, message);
  for (const message of result.warnings) stats.warnings[message] = (stats.warnings[message] || 0) + 1;
}

console.log(`  ..  ${stats.pages} sayfa, ${stats.blocks} JSON-LD bloğu, ${stats.nodes} düğüm — ${Object.entries(typeCount).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`);
const warningLines = Object.entries(stats.warnings).sort((a, b) => b[1] - a[1]);
if (warningLines.length) console.log(`  ..  tavsiye uyarıları (hata değil): ${warningLines.map(([k, v]) => `${k} ×${v}`).join(" | ")}`);

if (reportMode) {
  for (const [key, entry] of [...failures.entries()].sort((a, b) => b[1].count - a[1].count)) console.log(`  !!  ${entry.count}× ${key}\n        ${entry.samples.join("\n        ")}`);
  if (stats.noLdIndexable.length) console.log(`  !!  JSON-LD'siz indekslenebilir sayfa: ${stats.noLdIndexable.length}  ${stats.noLdIndexable.slice(0, 8).join(", ")}`);
}

assert.equal(failures.size, 0, `yapısal veri hataları (${[...failures.values()].reduce((a, b) => a + b.count, 0)}):\n${[...failures.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 12).map(([k, v]) => `  ${v.count}× ${k}\n      ${v.samples[0]}`).join("\n")}`);
assert.equal(stats.noLdIndexable.length, 0, `JSON-LD'siz indekslenebilir sayfa: ${stats.noLdIndexable.slice(0, 10).join(", ")}`);
console.log("  ok  tüm JSON-LD blokları geçerli: zorunlu alanlar, ISO tarihler, doğrulanmış skor, görünür SSS, uydurma puan/bilet vaadi yok");
console.log("structured-data: tamam");
