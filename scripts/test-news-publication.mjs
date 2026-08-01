import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const news = JSON.parse(fs.readFileSync(path.join(root, "data", "news.json"), "utf8"));
const ticker = JSON.parse(fs.readFileSync(path.join(root, "data", "news-ticker.json"), "utf8"));
const drafts = JSON.parse(fs.readFileSync(path.join(root, "editorial", "news-drafts.json"), "utf8"));

const published = news.filter((item) => String(item.status || "").toLowerCase() === "verified");
const publishedIds = new Set(published.map((item) => item.id));

for (const id of [
  "aziz-yildirim-fenerbahce-divan-kurulu-sert-cikis",
  "galatasaray-musiala-iddialarina-yalanlama"
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
