/**
 * MAÇ SEO MOTORU — DOĞRULAMA.
 *
 * scripts/generate-match-seo-pages.mjs'in ürettiği kayıt defteri ve HTML
 * sayfalarının sözleşmesini test eder: slug kalıcılığı, önem/sıralama
 * kuralı, canonical/OG/Twitter/JSON-LD varlığı, durum bazlı başlık kalıbı,
 * ve sitemap kaydı. Betiği yeniden çalıştırıp idempotent olduğunu da
 * doğrular (aynı girişte ikinci koşu kayıt defterini büyütmemeli).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOMAIN = "https://www.futbolradar.com";
const SCRIPT = path.join(root, "scripts", "generate-match-seo-pages.mjs");
const REGISTRY_PATH = path.join(root, "data", "match-seo-pages.json");

function run() {
  execFileSync(process.execPath, [SCRIPT], { cwd: root, stdio: "pipe" });
}

function readRegistry() {
  return JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
}

// İlk koşu — kayıt defteri zaten var olabilir (repo bir önceki çalıştırmayı
// taşıyor), o yüzden burada SIFIRLAMIYORUZ; gerçek dünyadaki gibi üstüne
// koşuyoruz.
run();
const before = readRegistry();
assert.ok(before && typeof before.entries === "object", "kayıt defteri entries taşımalı");

const entryIds = Object.keys(before.entries);
assert.ok(entryIds.length > 0, "en az bir önemli maç kaydedilmeli (fikstür takviminde uygun maç yoksa test verisi eksik demektir)");

// Slug tekilliği: iki farklı maç aynı slug'ı paylaşamaz.
const slugs = entryIds.map((id) => before.entries[id].slug);
assert.equal(new Set(slugs).size, slugs.length, "her slug yalnızca bir maça ait olmalı");

// Slug biçimi: kalıcı/sade — yalnızca küçük harf, rakam, tire; "-maci" ile biter.
for (const slug of slugs) {
  assert.match(slug, /^[a-z0-9-]+-maci(-\d{4}-\d{2}-\d{2})?$/, `slug biçimi beklenmiyor: ${slug}`);
}

// İDEMPOTENTLİK: aynı fikstür verisiyle ikinci koşu, mevcut slug'ları
// DEĞİŞTİRMEMELİ (kalıcı URL sözleşmesi).
run();
const after = readRegistry();
for (const id of entryIds) {
  assert.equal(after.entries[id].slug, before.entries[id].slug, `${id}: ikinci koşuda slug değişti — kalıcılık bozuldu`);
}
assert.equal(Object.keys(after.entries).length, entryIds.length, "ikinci koşu yeni kayıt eklememeli (aynı fikstür verisiyle)");

// ÖNCELİK KURALI: kayıtlı her maç ya Türk takımı içeriyor ya da öncelikli
// bir turnuvada (services/matchSeoPriority.js#COMPETITION_PRIORITY_ORDER).
const priorityModule = await import("../services/matchSeoPriority.js");
const { isTurkishTeamName, COMPETITION_PRIORITY_ORDER } = priorityModule.default || priorityModule;
for (const id of entryIds) {
  const entry = after.entries[id];
  const turkish = isTurkishTeamName(entry.homeTeam) || isTurkishTeamName(entry.awayTeam);
  const priorityCompetition = entry.competitionId && COMPETITION_PRIORITY_ORDER.includes(entry.competitionId);
  assert.ok(turkish || priorityCompetition, `${id}: ne Türk takımı ne öncelikli turnuva — önemsiz bir maç kaydedilmiş`);
}

// HTML SAYFA SÖZLEŞMESİ: her kayıt için hem mac-seo/ hem public/mac-seo/
// kopyası, kendini gösteren canonical, tam OG/Twitter seti ve SportsEvent
// + BreadcrumbList JSON-LD taşımalı.
const titles = new Set();
let sportsEventCount = 0;
let liveBoardCount = 0;
for (const id of entryIds) {
  const entry = after.entries[id];
  const relative = `mac-seo/${entry.slug}.html`;
  const filePath = path.join(root, relative);
  const publicPath = path.join(root, "public", relative);
  assert.ok(fs.existsSync(filePath), `${relative} üretilmeli`);
  assert.ok(fs.existsSync(publicPath), `public/${relative} üretilmeli`);
  assert.equal(fs.readFileSync(filePath, "utf8"), fs.readFileSync(publicPath, "utf8"), `${relative}: kök ve public kopyası aynı olmalı`);

  const html = fs.readFileSync(filePath, "utf8");
  const canonicalUrl = `${DOMAIN}/${entry.slug}`;
  assert.match(html, new RegExp(`<link rel="canonical" href="${canonicalUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" />`), `${relative}: canonical kendi kalıcı adresini göstermeli`);
  assert.ok(html.includes(`<meta property="og:url" content="${canonicalUrl}" />`), `${relative}: og:url eksik/yanlış`);
  for (const marker of ["og:title", "og:description", "og:image", "twitter:card", "twitter:title", "twitter:description", "twitter:image"]) {
    assert.ok(html.includes(marker), `${relative}: ${marker} eksik`);
  }

  const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
  assert.ok(title, `${relative}: title eksik`);
  titles.add(`${relative}::${title}`);

  const schemaMatch = html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/);
  assert.ok(schemaMatch, `${relative}: JSON-LD şeması eksik`);
  const schema = JSON.parse(schemaMatch[1]);
  const graph = Array.isArray(schema["@graph"]) ? schema["@graph"] : [];
  const sportsEvent = graph.find((node) => node["@type"] === "SportsEvent");
  const breadcrumb = graph.find((node) => node["@type"] === "BreadcrumbList");
  assert.ok(sportsEvent, `${relative}: SportsEvent düğümü eksik`);
  assert.ok(sportsEvent.startDate, `${relative}: SportsEvent startDate eksik`);
  assert.ok(breadcrumb, `${relative}: BreadcrumbList düğümü eksik`);
  if (sportsEvent) sportsEventCount += 1;

  // Canlı skor bloğu — mevcut public/site.js poller'ının otomatik yakaladığı
  // işaretleme; bu betik yeni bir canlı sistem KURMAZ, yalnızca bu bloğu basar.
  assert.match(html, new RegExp(`data-match-special-board data-match-id="${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`), `${relative}: canlı künye bloğu (data-match-id) eksik veya yanlış maç kimliği`);
  liveBoardCount += 1;

  // Durum bazlı başlık kalıbı — kullanıcının istediği üç sabit kalıptan biri.
  assert.ok(
    /Maçı Ne Zaman, Saat Kaçta, Hangi Kanalda\?/.test(title) ||
    /Canlı Skor \| Maç Sonucu/.test(title) ||
    /Maç Sonucu ve Skor/.test(title),
    `${relative}: başlık beklenen üç durum kalıbından birine uymuyor: "${title}"`
  );
}

assert.equal(sportsEventCount, entryIds.length, "her sayfa bir SportsEvent düğümü taşımalı");
assert.equal(liveBoardCount, entryIds.length, "her sayfa canlı künye bloğu taşımalı");

// SİTEMAP: her kayıtlı slug sitemap.xml'de kendi kalıcı adresiyle yer almalı.
const sitemap = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
for (const id of entryIds) {
  const entry = after.entries[id];
  assert.ok(sitemap.includes(`<loc>${DOMAIN}/${entry.slug}</loc>`), `sitemap.xml: ${entry.slug} eksik`);
}
// public/sitemap.xml ile kök sitemap.xml aynı maç-SEO girdilerini taşımalı.
const publicSitemap = fs.readFileSync(path.join(root, "public", "sitemap.xml"), "utf8");
const ownEntries = (sitemap.match(/<url>[\s\S]*?<\/url>/g) || []).filter((entry) => /-maci<\/loc>/.test(entry));
const publicOwnEntries = (publicSitemap.match(/<url>[\s\S]*?<\/url>/g) || []).filter((entry) => /-maci<\/loc>/.test(entry));
assert.equal(ownEntries.length, publicOwnEntries.length, "kök ve public sitemap aynı sayıda maç-SEO girdisi taşımalı");
assert.equal(ownEntries.length, entryIds.length, "sitemap'teki -maci girdi sayısı kayıt defteriyle eşleşmeli (yetim/eksik girdi yok)");

console.log(`match-seo-pages OK (${entryIds.length} sayfa, idempotent, sitemap tutarlı)`);
