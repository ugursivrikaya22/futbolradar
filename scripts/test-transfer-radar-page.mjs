#!/usr/bin/env node
/**
 * TRANSFER RADARI TESTLERİ (scripts/generate-transfer-radar-page.mjs).
 *  1. SEO: title, H1, meta açıklama (≤160), canonical aynı adres, ilk paragrafta "transfer radarı".
 *  2. Altı lig sekmesi; her ligde resmi / söylenti / Ocak 2027 bölümleri.
 *  3. Resmi ve söylenti ayrı: söylenti tabloya girmez, her söylentide "Söylenti" etiketi + kaynak.
 *  4. Kaynak kuralı: her dış bağlantı beyaz listede, yasaklı alan adı yok, rel nofollow noopener noreferrer;
 *     yasaklı/kaynaksız satır derlemeyi durdurur.
 *  5. Kayan yazı çapaları (#transfer-<oyuncu>) data/transfers.json'daki her kayıt için var.
 *  6. 72 saat: süresi geçen söylenti basılmaz; boş bölüm "Güncelleniyor" der.
 *  7. ItemList JSON-LD yalnızca resmi transferlerden.
 *  8. İç bağlantılar: ana sayfa Transfer Radarı bandı "Tümü" ve lig sayfaları bu sayfaya gider.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { buildTransferRadar, renderTransferRadarPage, generateTransferRadarPage, sourceProblem, slugify, PAGE_TITLE, PAGE_DESCRIPTION, PAGE_FILE } from "./generate-transfer-radar-page.mjs";
import { renderHomeTicker } from "./lib/homeTicker.mjs";

const require = createRequire(import.meta.url);
const { isAllowedSourceUrl } = require("../services/sourceLinks.js");
const root = process.cwd();
const NOW = Date.parse("2026-11-24T15:30:00+03:00");

const data = buildTransferRadar(root, { now: NOW });
assert.deepEqual(data.problems, [], "gerçek veride kaynak sorunu olmamalı");
const html = renderTransferRadarPage(data);

// 1. SEO
assert.equal(PAGE_TITLE, "Transfer Radarı 2026-2027 | Süper Lig ve Avrupa'nın Büyük Ligleri Transferleri | FutbolRadar");
assert.ok(html.includes(`<title>Transfer Radarı 2026-2027 | Süper Lig ve Avrupa&#039;nın Büyük Ligleri Transferleri | FutbolRadar</title>`), "title");
assert.match(html, /<h1>Transfer Radarı<\/h1>/, "H1 yalnızca Transfer Radarı");
assert.equal((html.match(/<h1/g) || []).length, 1, "tek H1");
assert.ok(PAGE_DESCRIPTION.length <= 160 && PAGE_DESCRIPTION.length >= 120, `meta açıklama 120-160 karakter (${PAGE_DESCRIPTION.length})`);
for (const league of ["Süper Lig", "Premier Lig", "La Liga", "Serie A", "Bundesliga", "Ligue 1"]) assert.ok(PAGE_DESCRIPTION.includes(league), `meta açıklama ${league}`);
assert.ok(html.includes('<link rel="canonical" href="https://www.futbolradar.com/super-lig-transferleri-2026-2027.html" />'), "canonical aynı adres");
const firstParagraph = html.slice(html.indexOf("</h1>")).match(/<p>([\s\S]*?)<\/p>/)[1];
assert.match(firstParagraph.toLocaleLowerCase("tr-TR"), /transfer radarı/, "ilk paragrafta 'transfer radarı'");
assert.match(html, /Son güncelleme: <time datetime="[^"]+">\d{1,2} \S+ 2026/, "Son güncelleme tarihi görünür");
assert.ok(html.includes('class="breadcrumb"') && html.includes("./index.html"), "görünür içerik yolu + ana sayfa bağlantısı");

// 2. Sekmeler ve bölümler
const ids = ["super-lig", "premier-lig", "la-liga", "serie-a", "bundesliga", "ligue-1"];
for (const id of ids) {
  assert.ok(html.includes(`data-tr-tab="${id}"`), `sekme ${id}`);
  const start = html.indexOf(`<section class="tr-league" id="lig-${id}"`);
  assert.ok(start > -1, `bölüm ${id}`);
  const section = html.slice(start, html.indexOf("</section>", start));
  assert.ok(section.includes("Resmi transferler"), `${id}: resmi bölüm`);
  assert.ok(section.includes("Güçlü söylentiler"), `${id}: söylenti bölümü`);
  assert.ok(section.includes("Ocak 2027 ara transfer dönemi"), `${id}: ocak bölümü`);
  // 3. Resmi tablo söylenti taşımaz.
  const table = section.slice(section.indexOf("<table"), section.indexOf("</table>") + 8);
  assert.ok(!/Söylenti|iddia/i.test(table), `${id}: resmi tabloda söylenti olmamalı`);
}
const rumourItems = html.match(/<li class="tr-rumour"[\s\S]*?<\/li>/g) || [];
assert.ok(rumourItems.length > 0, "en az bir söylenti");
for (const item of rumourItems) {
  assert.ok(item.includes('<span class="tr-tag">Söylenti</span>'), "söylenti etiketi");
  assert.match(item, /Kaynak: <a class="tr-src" href="https?:\/\//, "söylentide kaynak");
  assert.match(item, /data-expires="[^"]+"/, "söylentide bitiş zamanı");
}

// 4. Kaynak kuralı
const mainHtml = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
const external = [...mainHtml.matchAll(/<a\s[^>]*href="(https?:\/\/[^"]+)"[^>]*>/g)];
for (const [tag, url] of external) {
  if (/futbolradar\.com/.test(url)) continue;
  assert.ok(tag.includes('rel="nofollow noopener noreferrer"'), `rel eksik: ${url}`);
  assert.ok(isAllowedSourceUrl(url.replaceAll("&amp;", "&")), `beyaz liste dışı: ${url}`);
  // x.com yalnızca @Futbolradarcom paylaşımı olarak, FIFA yasak kutusunda EK bağlantı.
  if (/^https:\/\/x\.com\/Futbolradarcom\/status\/\d+$/.test(url)) continue;
  assert.ok(!/wikipedia|transfermarkt|fbref|thesportsdb|milliyet|haber7|\/\/(www\.)?x\.com|twitter\.com/i.test(url), `yasaklı kaynak: ${url}`);
}

// 4b. FIFA transfer yasakları: ayrı kutu, resmi tabloda değil, izinli ana kaynak.
{
  const superLig = html.slice(html.indexOf('id="lig-super-lig"'), html.indexOf('id="lig-premier-league"'));
  const bans = superLig.slice(superLig.indexOf("data-tr-bans"), superLig.indexOf('class="tr-block tr-official"'));
  assert.ok(bans.includes("FIFA transfer yasakları"), "Süper Lig sekmesinde FIFA yasak kutusu");
  const banItems = bans.match(/<li class="tr-ban"[\s\S]*?<\/li>/g) || [];
  assert.equal(banItems.length, 2, "iki kulüp yasağı");
  for (const item of banItems) assert.match(item, /Kaynak: <a class="tr-src" href="https:\/\/www\.aa\.com\.tr\//, "yasakta izinli ana kaynak (AA)");
  assert.ok(bans.includes("Trendyol Süper Lig") && bans.includes("Trendyol 1. Lig"), "lig adları kaynaktaki gibi");
  const xLinks = [...html.matchAll(/href="(https:\/\/x\.com\/[^"]+)"/g)].map((m) => m[1]);
  const mainX = [...mainHtml.matchAll(/href="(https:\/\/x\.com\/[^"]+)"/g)].map((m) => m[1]);
  for (const url of mainX) assert.ok(bans.includes(url), `x.com bağlantısı yalnızca yasak kutusunda: ${url}`);
  assert.ok(xLinks.length >= mainX.length);
  const table = superLig.slice(superLig.indexOf("<table"), superLig.indexOf("</table>"));
  assert.ok(!/Pendikspor|yasağı/.test(table), "yasak resmi transfer tablosunda değil");
  for (const otherId of ["premier-league", "la-liga", "serie-a", "bundesliga", "ligue-1"]) {
    const start = html.indexOf(`id="lig-${otherId}"`);
    const other = html.slice(start, html.indexOf("</section>", start));
    assert.ok(!other.includes("data-tr-bans"), `${otherId}: yasak kutusu yok`);
  }
  const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
  assert.ok(!ld.join("").includes("Pendikspor"), "JSON-LD ItemList'e yasak girmez");
}
assert.ok(sourceProblem({ sourceName: "Transfermarkt", sourceUrl: "https://www.transfermarkt.com.tr/x" }), "Transfermarkt reddedilmeli");
assert.ok(sourceProblem({ sourceName: "Milliyet", sourceUrl: "https://www.milliyet.com.tr/x" }), "Milliyet reddedilmeli");
assert.ok(sourceProblem({ sourceName: "X", sourceUrl: "https://x.com/someone/status/1" }), "x.com reddedilmeli");
assert.ok(sourceProblem({ sourceName: "", sourceUrl: "https://www.ntvspor.net/x" }), "kaynak adı zorunlu");
assert.equal(sourceProblem({ sourceName: "Premier League", sourceUrl: "https://www.premierleague.com/x" }), "");
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tr-radar-"));
  fs.mkdirSync(path.join(tmp, "data"));
  const radar = JSON.parse(fs.readFileSync(path.join(root, "data", "transfer-radar.json"), "utf8"));
  radar.official.push({ id: "uydurma", leagues: ["la-liga"], playerName: "X", fromTeam: "A", toTeam: "B", type: "Bonservis", sourceName: "Transfermarkt", sourceUrl: "https://www.transfermarkt.com.tr/x" });
  fs.writeFileSync(path.join(tmp, "data", "transfer-radar.json"), JSON.stringify(radar));
  fs.copyFileSync(path.join(root, "data", "transfers.json"), path.join(tmp, "data", "transfers.json"));
  fs.writeFileSync(path.join(tmp, "data", "ticker.json"), JSON.stringify({ items: [] }));
  assert.throws(() => generateTransferRadarPage(tmp, { now: NOW, sitemap: false }), /yasaklı kaynak/, "yasaklı kaynaklı satır derlemeyi durdurmalı");
  assert.ok(!fs.existsSync(path.join(tmp, PAGE_FILE)), "sorunlu veriyle sayfa yazılmamalı");
  // x.com tek başına yasak kaynağı olamaz.
  const radar2 = JSON.parse(fs.readFileSync(path.join(root, "data", "transfer-radar.json"), "utf8"));
  radar2.transferBans.items[0].sourceName = "X";
  radar2.transferBans.items[0].sourceUrl = "https://x.com/nexustransfer/status/2125190318114902291";
  fs.writeFileSync(path.join(tmp, "data", "transfer-radar.json"), JSON.stringify(radar2));
  assert.throws(() => generateTransferRadarPage(tmp, { now: NOW, sitemap: false }), /yasaklı kaynak/, "x.com kaynaklı yasak derlemeyi durdurmalı");
  radar2.transferBans.items[0].sourceName = "Anadolu Ajansı";
  radar2.transferBans.items[0].sourceUrl = "https://www.aa.com.tr/tr/spor/fifadan-2-turk-kulubune-transfer-yasagi/4135681";
  radar2.transferBans.xPostUrl = "https://x.com/nexustransfer/status/2125190318114902291";
  fs.writeFileSync(path.join(tmp, "data", "transfer-radar.json"), JSON.stringify(radar2));
  assert.throws(() => generateTransferRadarPage(tmp, { now: NOW, sitemap: false }), /Futbolradarcom/, "yalnızca kendi X paylaşımımız ek bağlantı olabilir");
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 5. Kayan yazı çapaları
const transfers = JSON.parse(fs.readFileSync(path.join(root, "data", "transfers.json"), "utf8"));
for (const record of transfers.filter((item) => item.status === "confirmed")) {
  assert.ok(html.includes(`id="transfer-${slugify(record.playerName)}"`), `çapa eksik: transfer-${slugify(record.playerName)}`);
}

// 6. 72 saat ve "Güncelleniyor"
{
  const later = buildTransferRadar(root, { now: Date.parse("2026-12-31T12:00:00+03:00"), tickerItems: [] });
  assert.ok(later.leagues.every((league) => league.rumours.length === 0), "süresi geçen söylenti düşmeli");
  const laterHtml = renderTransferRadarPage(later);
  assert.ok(laterHtml.includes("Güncelleniyor — son 72 saatte izinli bir kaynakta"), "boş söylenti bölümü Güncelleniyor demeli");
  const rumour = { id: "x-iddia", leagues: ["la-liga"], text: "Örnek iddia", date: "2026-11-20T00:00:00Z", expiresAt: "2026-11-24T00:00:00Z", sourceName: "Marca", sourceUrl: "https://www.marca.com/x" };
  const radar = JSON.parse(fs.readFileSync(path.join(root, "data", "transfer-radar.json"), "utf8"));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tr-radar-"));
  fs.mkdirSync(path.join(tmp, "data"));
  fs.writeFileSync(path.join(tmp, "data", "transfer-radar.json"), JSON.stringify({ ...radar, rumours: [rumour] }));
  fs.copyFileSync(path.join(root, "data", "transfers.json"), path.join(tmp, "data", "transfers.json"));
  const overlong = buildTransferRadar(tmp, { now: NOW, tickerItems: [] });
  assert.ok(overlong.problems.some((p) => /72 saati/.test(p)), "72 saati aşan söylenti reddedilmeli");
  fs.rmSync(tmp, { recursive: true, force: true });
}
assert.ok(html.includes("Pencere tarihleri: <strong>Güncelleniyor</strong>"), "kaynaksız ocak penceresi Güncelleniyor");

// 7. JSON-LD
const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
const list = ld["@graph"].find((node) => node["@type"] === "ItemList");
assert.ok(list && list.itemListElement.length === list.numberOfItems && list.numberOfItems > 0, "ItemList dolu");
assert.ok(list.itemListElement.every((item, index) => item.position === index + 1 && /^https:\/\/www\.futbolradar\.com\/super-lig-transferleri-2026-2027\.html#/.test(item.url)), "ItemList sıra + adres");
assert.ok(ld["@graph"].some((node) => node["@type"] === "BreadcrumbList"), "BreadcrumbList");
const rumourIds = new Set(data.leagues.flatMap((league) => league.rumours.map((item) => item.id)));
assert.ok(!list.itemListElement.some((item) => [...rumourIds].some((id) => item.url.endsWith(id))), "söylenti ItemList'e girmez");

// 8. İç bağlantılar
{
  const band = renderHomeTicker([{ id: "a", text: "Örnek iddia", category: "iddia", date: "2026-11-24T10:00:00+03:00", expiresAt: "2026-11-25T10:00:00+03:00", sourceName: "NTV Spor", sourceUrl: "https://www.ntvspor.net/x" }]);
  assert.ok(band.includes('class="home-ticker__all" href="./super-lig-transferleri-2026-2027.html"'), "ana sayfa bandında Tümü → Transfer Radarı");
  assert.ok(band.includes('class="home-ticker__link" href="./super-lig-transferleri-2026-2027.html"'), "bağlantısız söylenti Transfer Radarı'na gider");
  const en = renderHomeTicker([{ id: "a", text: "x", category: "haber", date: "2026-11-24T10:00:00+03:00", sourceName: "NTV Spor", sourceUrl: "https://www.ntvspor.net/x" }], { locale: "en" });
  assert.ok(!en.includes("home-ticker__all"), "EN bandına Türkçe sayfa bağlantısı eklenmez");
  const leagueGen = fs.readFileSync(path.join(root, "scripts", "generate-league-pages.mjs"), "utf8");
  assert.ok(leagueGen.includes("../super-lig-transferleri-2026-2027.html#lig-"), "lig sayfaları Transfer Radarı'na bağlanır");
}
const committed = fs.readFileSync(path.join(root, PAGE_FILE), "utf8");
assert.ok(committed.includes("<h1>Transfer Radarı</h1>"), "depodaki sayfa yeni üreticiden");

console.log(`test-transfer-radar-page: ok (${data.leagues.map((l) => `${l.id} ${l.official.length}/${l.rumours.length}`).join(", ")})`);
