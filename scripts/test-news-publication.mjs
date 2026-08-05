import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readVerifiedTeamNews, renderTeamNewsSection } from "./lib/newsCards.mjs";

const root = process.cwd();
const news = JSON.parse(fs.readFileSync(path.join(root, "data", "news.json"), "utf8"));
const ticker = JSON.parse(fs.readFileSync(path.join(root, "data", "news-ticker.json"), "utf8"));
const drafts = JSON.parse(fs.readFileSync(path.join(root, "editorial", "news-drafts.json"), "utf8"));

const published = news.filter((item) => String(item.status || "").toLowerCase() === "verified");
const publishedIds = new Set(published.map((item) => item.id));

for (const id of [
  "aziz-yildirim-fenerbahce-divan-kurulu-sert-cikis",
  "galatasaray-musiala-iddialarina-yalanlama",
  "galatasaray-divan-kurulu-dursun-ozbek-transfer-tepkisi",
  "mohamed-salah-trabzonspor-transferi-resmen-aciklandi"
]) {
  const article = published.find((item) => item.id === id);
  assert.ok(article, `${id}: doğrulanmış haber bulunmalı`);
  assert.ok(Array.isArray(article.body) && article.body.length, `${id}: haber gövdesi bulunmalı`);
  assert.ok(Array.isArray(article.tags) && article.tags.length >= 3, `${id}: etiketler bulunmalı`);
  assert.ok(
    Array.isArray(article.sources) && article.sources.every((source) => source.name && /^https?:\/\//.test(source.url)),
    `${id}: ad ve bağlantı taşıyan kaynaklar bulunmalı`
  );
}

const transferReaction = published.find((item) => item.id === "galatasaray-divan-kurulu-dursun-ozbek-transfer-tepkisi");
assert.equal(transferReaction.slug, "galatasaray-divan-kurulu-dursun-ozbek-transfer-tepkisi", "haber slugı URL standardına uygun olmalı");
assert.ok(
  transferReaction.body.some((paragraph) => paragraph.includes("Basına yansıyan açıklamalara göre")),
  "istenen basın atfı haber gövdesinde korunmalı"
);
assert.match(transferReaction.updateNote || "", /resmî bir özet yayımladığında/, "resmî kulüp özeti için güncelleme notu bulunmalı");

const galatasarayNews = readVerifiedTeamNews(root, "Galatasaray", 3);
assert.equal(
  galatasarayNews[0]?.id,
  "galatasaray-osimhen-premier-league-ilgisi-iddialari",
  "en yeni Galatasaray haberi takım sayfalarında ilk sırada görünmeli"
);
const sortedByRecency = galatasarayNews
  .map((item) => String(item.publishedAt || ""))
  .every((stamp, index, list) => index === 0 || list[index - 1] >= stamp);
assert.ok(sortedByRecency, "takım haberleri yayın tarihine göre yeniden eskiye sıralanmalı");
const galatasaraySection = renderTeamNewsSection(galatasarayNews, { team: "Galatasaray", base: "./" });
assert.match(galatasaraySection, /data-team-news="galatasaray"/, "Galatasaray haber bölümü üretilmeli");
assert.match(
  galatasaraySection,
  /haber\/galatasaray-divan-kurulu-dursun-ozbek-transfer-tepkisi"/,
  "Galatasaray haber kartı yeni detay sayfasına bağlanmalı"
);

for (const draft of drafts.items || []) {
  assert.equal(draft.public, false, `${draft.id}: taslak public=false olmalı`);
  assert.equal(draft.status, "source-required", `${draft.id}: kaynak beklemeli`);
  assert.ok(!publishedIds.has(draft.id), `${draft.id}: taslak public haber verisine sızmamalı`);
  assert.ok(!(ticker.items || []).some((item) => item.id === draft.id), `${draft.id}: taslak gündem bandına sızmamalı`);
}

for (const tickerId of ["fenerbahce-sturm-graz-programi"]) {
  const item = (ticker.items || []).find((entry) => entry.id === tickerId);
  assert.ok(item, `${tickerId}: gundem bandi kaydi bulunmali`);
  assert.match(item.source.url, /^https:\/\/www\.futbolradar\.com\/haber\//, `${tickerId}: ic detay sayfasina baglanmali`);
}

const archivedSalahRumors = [
  "trabzonspor-mohamed-salah-transfer-iddiasi",
  "trabzonspor-salah-transfer-iddiasi-son-durum"
];
for (const id of archivedSalahRumors) {
  const article = news.find((item) => item.id === id);
  assert.equal(article?.status, "archived", `${id}: official confirmation should archive the stale rumor article`);
}

assert.ok(
  !(ticker.items || []).some((entry) => entry.id === "trabzonspor-salah-dev-paket-iddiasi"),
  "Salah rumor ticker item should not remain after official confirmation"
);
const salahTicker = (ticker.items || []).find((entry) => entry.id === "trabzonspor-mohamed-salah-resmi-transfer-0508");
assert.equal(salahTicker?.category, "official", "Salah ticker should use the official category");
assert.equal(salahTicker?.confidence, "confirmed", "Salah ticker should be confirmed after official club wording");
assert.match(salahTicker?.source?.url || "", /^https:\/\/www\.trabzonspor\.org\.tr\/news\//, "Salah ticker should link to the official club source");
for (const entry of ticker.items || []) {
  if (entry.id === "trabzonspor-mohamed-salah-resmi-transfer-0508") continue;
  assert.match(entry.source.url, /^https:\/\/www\.futbolradar\.com\/haber\//, `${entry.id}: bant ogesi ic haber sayfasina baglanmali`);
}

console.log(`Haber yayın testi geçti (${published.length} doğrulanmış haber, ${(drafts.items || []).length} kaynak bekleyen taslak).`);
