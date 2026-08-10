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

// Küratörlü bant kayıtları iç haber sayfasına bağlanmalı.
//
// Bu denetim eskiden TEK bir kimliği ("fenerbahce-sturm-graz-programi")
// adıyla arıyordu. O kayıt 5 Ağustos'taki ilk maçı duyuran, tarihi geçince
// anlamı kalmayan bir duyuruydu; bant onu raf ömrü kuralıyla düşürdüğünde
// test kırıldı — yani denetim, bandın DOĞRU davranışını hata sayıyordu.
// Kural artık kimliğe değil sınıfa bakıyor: küratörlü ve iç sayfaya
// bağlanan her kaydın hedefi gerçekten üretilmiş bir haber sayfası olmalı.
const internalCuratedTickerItems = (ticker.items || [])
  .filter((entry) => !entry.automation && /^https:\/\/www\.futbolradar\.com\//.test(entry.source?.url || ""));

for (const item of internalCuratedTickerItems) {
  assert.match(item.source.url, /^https:\/\/www\.futbolradar\.com\/haber\//, `${item.id}: ic detay sayfasina baglanmali`);
  const slug = item.source.url.replace(/^https:\/\/www\.futbolradar\.com\/haber\//, "").replace(/\.html$/, "");
  assert.ok(
    fs.existsSync(path.join(root, "haber", `${slug}.html`)),
    `${item.id}: bağlandığı haber sayfası (haber/${slug}.html) üretilmiş olmalı`
  );
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
// ── Bandın iki katmanı, iki ayrı bağlantı sözleşmesi ──────────────────────
//
// 1. KÜRATÖRLÜ kayıtlar (elle yazılan, `automation` taşımayanlar): arkasında
//    bu sitede yayımlanmış bir haber sayfası vardır ve okuyucuyu oraya
//    götürmek zorundadır. Tek istisna, kaynağı doğrudan kulübün resmî
//    duyurusu olan kayıtlar — orada aracı sayfa değil, birincil kaynak
//    daha dürüst bir bağlantıdır.
// 2. OTOMATİK kayıtlar (`automation.source === "rss"`, kulüplerin resmî
//    beslemelerinden gelir): arkalarında bir FutbolRadar sayfası YOKTUR.
//    Onlara iç bağlantı şartı koşmak, var olmayan bir sayfaya işaret etmek
//    demekti; bu döngü otomasyon eklenmeden önce yazılmıştı ve o günden beri
//    kırmızıydı. Sözleşmeleri farklı: kaynak adı, https bağlantı ve besleme
//    işareti taşımak zorundalar.
const OFFICIAL_SOURCE_TICKER_IDS = new Set(["trabzonspor-mohamed-salah-resmi-transfer-0508"]);

for (const entry of ticker.items || []) {
  if (entry.automation) {
    assert.equal(entry.automation.source, "rss", `${entry.id}: otomatik kayıt beslemesini bildirmeli`);
    assert.ok(entry.source && entry.source.name, `${entry.id}: otomatik kaydın kaynak adı olmalı`);
    assert.match(entry.source.url || "", /^https:\/\//, `${entry.id}: otomatik kayıt https bağlantı taşımalı`);
    assert.doesNotMatch(
      entry.source.url || "",
      /^https:\/\/www\.futbolradar\.com\//,
      `${entry.id}: otomatik kayıt üretilmemiş bir iç sayfaya bağlanmamalı`
    );
    continue;
  }

  if (OFFICIAL_SOURCE_TICKER_IDS.has(entry.id)) continue;
  assert.match(entry.source.url, /^https:\/\/www\.futbolradar\.com\/haber\//, `${entry.id}: bant ogesi ic haber sayfasina baglanmali`);
}

console.log(`Haber yayın testi geçti (${published.length} doğrulanmış haber, ${(drafts.items || []).length} kaynak bekleyen taslak).`);
