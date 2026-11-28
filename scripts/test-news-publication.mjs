import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readVerifiedTeamNews, renderTeamNewsSection } from "./lib/newsCards.mjs";

const root = process.cwd();
const news = JSON.parse(fs.readFileSync(path.join(root, "data", "news.json"), "utf8"));
const ticker = JSON.parse(fs.readFileSync(path.join(root, "data", "news-ticker.json"), "utf8"));
const drafts = JSON.parse(fs.readFileSync(path.join(root, "editorial", "news-drafts.json"), "utf8"));
const transfersDoc = JSON.parse(fs.readFileSync(path.join(root, "data", "transfers.json"), "utf8"));
const transfers = Array.isArray(transfersDoc) ? transfersDoc : (transfersDoc.transfers || []);

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

/**
 * KURAL SINANIYOR, ANLIK GERÇEK DEĞİL.
 *
 * Burada bir haberin KİMLİĞİ sabit yazılıydı ("şu an en yenisi bu"). Bu
 * bir kural değil, o günün fotoğrafıydı: yayımlanan her yeni Galatasaray
 * haberi testi düşürüyordu — haber doğru, sıralama doğru, test yanlış
 * olduğu hâlde. Bir tripwire'ın her doğru işte çalması, zamanla onu
 * "yine mi düştü, geç" diye görmezden gelmeye götürür.
 *
 * Sınanan şey artık iddianın kendisi: ilk sıradaki kayıt, doğrulanmış
 * Galatasaray haberleri arasında GERÇEKTEN en yenisi mi. Bu, hangi haber
 * yayımlanırsa yayımlansın geçerli kalır.
 */
const newestGalatasarayStamp = galatasarayNews
  .map((item) => String(item.publishedAt || ""))
  .sort()
  .at(-1);
assert.ok(galatasarayNews.length, "doğrulanmış Galatasaray haberi bulunmalı");
assert.equal(
  String(galatasarayNews[0]?.publishedAt || ""),
  newestGalatasarayStamp,
  "en yeni Galatasaray haberi takım sayfalarında ilk sırada görünmeli"
);
const sortedByRecency = galatasarayNews
  .map((item) => String(item.publishedAt || ""))
  .every((stamp, index, list) => index === 0 || list[index - 1] >= stamp);
assert.ok(sortedByRecency, "takım haberleri yayın tarihine göre yeniden eskiye sıralanmalı");
const galatasaraySection = renderTeamNewsSection(galatasarayNews, { team: "Galatasaray", base: "./" });
assert.match(galatasaraySection, /data-team-news="galatasaray"/, "Galatasaray haber bölümü üretilmeli");
/**
 * Yine kural sınanıyor, belirli bir haber değil: burada tek bir slug
 * sabit yazılıydı ve o haber ilk üçten düştüğü anda test kırılıyordu —
 * bağlantı kurma mantığında hiçbir şey bozulmamışken. Sınanan şey artık
 * ÇİZİLEN her kartın kendi detay sayfasına bağlanması.
 */
for (const article of galatasarayNews) {
  assert.ok(
    galatasaraySection.includes(`haber/${article.slug || article.id}"`),
    `Galatasaray haber kartı kendi detay sayfasına bağlanmalı: ${article.slug || article.id}`
  );
}

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
const columnsStore = JSON.parse(fs.readFileSync(path.join(root, "data", "columns.json"), "utf8"));
const publishedColumnSlugs = new Set(
  (columnsStore.columns || [])
    .filter((column) => String(column.status || "").toLowerCase() === "published")
    .map((column) => column.slug || column.id)
);

function internalTickerTarget(url) {
  const match = String(url || "").match(/^https:\/\/www\.futbolradar\.com\/(haber|kose-yazilari)\/([^/?#]+)/);
  if (!match) return null;
  return { kind: match[1], slug: match[2].replace(/\.html$/, "") };
}

function assertInternalTickerTarget(item) {
  const target = internalTickerTarget(item.source?.url || "");
  assert.ok(target, `${item.id}: iç hedef haber ya da köşe yazısı olmalı`);
  if (target.kind === "haber") {
    assert.ok(
      fs.existsSync(path.join(root, "haber", `${target.slug}.html`)),
      `${item.id}: bağlandığı haber sayfası (haber/${target.slug}.html) üretilmiş olmalı`
    );
    return;
  }
  assert.ok(
    publishedColumnSlugs.has(target.slug),
    `${item.id}: bağlandığı köşe yazısı yayımlanmış olmalı (${target.slug})`
  );
}

const internalCuratedTickerItems = (ticker.items || [])
  .filter((entry) => !entry.automation && internalTickerTarget(entry.source?.url || ""));

for (const item of internalCuratedTickerItems) {
  assertInternalTickerTarget(item);
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
// BANT "GÜNDEM"DİR, ARŞİV DEĞİL.
//
// Resmî transfer duyurusu da 72 saatlik varsayılan raf ömrüne tabidir; bu
// kayıt o pencereyi aştığında banttan düşer. Düşmesi bilgi kaybı değil:
// transferin kendisi `data/transfers.json` içinde "Official" olarak duruyor
// ve haber sayfası yayında kalıyor. Banttan çıkmak "artık gündem değil"
// demek, "artık doğru değil" demek değil.
//
// Bu yüzden aşağıdaki denetimler kaydın VARLIĞINI şart koşmuyor; bantta
// olduğu sürece DOĞRU sınıflandırıldığını şart koşuyor.
const salahTicker = (ticker.items || []).find((entry) => entry.id === "trabzonspor-mohamed-salah-resmi-transfer-0508");
if (salahTicker) {
  assert.equal(salahTicker.category, "official", "Salah ticker should use the official category");
  assert.equal(salahTicker.confidence, "confirmed", "Salah ticker should be confirmed after official club wording");
  assert.match(salahTicker.source?.url || "", /^https:\/\/www\.trabzonspor\.org\.tr\/news\//, "Salah ticker should link to the official club source");
}

// Bantta olsun olmasın, transferin kendisi doğrulanmış kayıt olarak durmalı:
// raf ömrü bandı temizler, gerçeği değil.
const salahTransfer = transfers.find((entry) => /salah/i.test(entry.playerName || ""));
assert.ok(salahTransfer, "resmî transfer kaydı depoda kalmalı");
assert.match(
  salahTransfer.sourceUrl || "",
  /^https:\/\/www\.trabzonspor\.org\.tr\//,
  "resmî transfer kaydı kulübün kendi duyurusuna bağlanmalı"
);
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

  if (entry.destinationUrl) {
    assert.match(entry.source?.url || "", /^https:\/\//, `${entry.id}: editoryal kaynağın https bağlantısı olmalı`);
    assert.match(
      entry.destinationUrl,
      /^https:\/\/www\.futbolradar\.com\//,
      `${entry.id}: özel bant hedefi bu sitede olmalı`
    );
    const relative = entry.destinationUrl
      .replace(/^https:\/\/www\.futbolradar\.com\//, "")
      .split("#")[0];
    const candidates = relative.endsWith(".html") ? [relative] : [relative, `${relative}.html`];
    assert.ok(
      candidates.some((file) => fs.existsSync(path.join(root, file))),
      `${entry.id}: bant hedefi diskte yok (${relative})`
    );
    continue;
  }

  if (OFFICIAL_SOURCE_TICKER_IDS.has(entry.id)) continue;
  const sourceUrl = entry.source?.url || "";
  if (internalTickerTarget(sourceUrl)) {
    assertInternalTickerTarget(entry);
    continue;
  }
  assert.match(sourceUrl, /^https:\/\//, `${entry.id}: bant öğesi https kaynak taşımalı`);
  assert.doesNotMatch(
    sourceUrl,
    /^https:\/\/www\.futbolradar\.com\//,
    `${entry.id}: iç bağlantı haber ya da köşe yazısı olmalı`
  );
}

console.log(`Haber yayın testi geçti (${published.length} doğrulanmış haber, ${(drafts.items || []).length} kaynak bekleyen taslak).`);
