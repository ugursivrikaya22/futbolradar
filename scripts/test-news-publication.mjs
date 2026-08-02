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
  "galatasaray-divan-kurulu-dursun-ozbek-transfer-tepkisi"
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

// Sıralama SÖZLEŞMESİ sınanıyor, belirli bir kimliğin birinciliği değil:
// ilk sırayı sabit bir id'ye bağlamak, yayımlanan HER yeni Galatasaray
// haberinde testi kırardı ve kırılan test kimseye bir şey öğretmez.
const galatasarayNews = readVerifiedTeamNews(root, "Galatasaray", 5);
assert.ok(galatasarayNews.length, "Galatasaray haberleri okunabilmeli");

const timestamps = galatasarayNews.map((item) => Date.parse(item.publishedAt));
assert.deepEqual(
  timestamps,
  [...timestamps].sort((left, right) => right - left),
  "takım haberleri yeniden eskiye sıralanmalı"
);

const fullGalatasarayNews = readVerifiedTeamNews(root, "Galatasaray", 50);
assert.ok(
  fullGalatasarayNews.some((item) => item.id === transferReaction.id),
  "doğrulanmış Galatasaray haberi takım listesinde bulunmalı"
);

const galatasaraySection = renderTeamNewsSection(fullGalatasarayNews.slice(0, 5), { team: "Galatasaray", base: "./" });
assert.match(galatasaraySection, /data-team-news="galatasaray"/, "Galatasaray haber bölümü üretilmeli");
assert.match(
  galatasaraySection,
  /haber\/[a-z0-9-]+\.html/,
  "Galatasaray haber kartı detay sayfasına bağlanmalı"
);

for (const draft of drafts.items || []) {
  assert.equal(draft.public, false, `${draft.id}: taslak public=false olmalı`);
  assert.equal(draft.status, "source-required", `${draft.id}: kaynak beklemeli`);
  assert.ok(!publishedIds.has(draft.id), `${draft.id}: taslak public haber verisine sızmamalı`);
  assert.ok(!(ticker.items || []).some((item) => item.id === draft.id), `${draft.id}: taslak gündem bandına sızmamalı`);
}

for (const tickerId of ["aziz-yildirim-divan-kurulu-sert-cikis", "galatasaray-musiala-yalanlama"]) {
  const item = (ticker.items || []).find((entry) => entry.id === tickerId);
  assert.ok(item, `${tickerId}: gündem bandı kaydı bulunmalı`);
  assert.match(item.source.url, /^https:\/\/www\.futbolradar\.com\/haber\//, `${tickerId}: iç detay sayfasına bağlanmalı`);
}

console.log(`Haber yayın testi geçti (${published.length} doğrulanmış haber, ${(drafts.items || []).length} kaynak bekleyen taslak).`);
