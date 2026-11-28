/**
 * hreflang TUTARLILIK TESTİ
 *
 * Canlı denetimde (3017 İngilizce sayfa ve Türkçe karşılıkları) bulunan iki
 * arızanın tekrarını önler:
 *   1. hreflang adresi sayfanın kanoniğinden farklıydı (94 köşe yazısı çifti,
 *      form tablosu): alternate `.html`, canonical uzantısız.
 *   2. İstek anında üretilen haber sayfası (api üzerinden) derleme sonrası
 *      enjekte edilen hreflang'ı hiç almıyordu.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { alternateUrls, canonicalOfHtml } from "./lib/hreflangUrls.mjs";
import { columnPageHtml } from "./generate-column-pages.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { pairUrl } = require("../services/i18n.js");
const { presentColumn, publishedColumns } = require("../services/columnService.js");
const matchNews = require("../services/matchNews.js");

// 1) Kanonik ayıklama.
assert.equal(canonicalOfHtml('<head><link rel="canonical" href="https://www.futbolradar.com/a/b" /></head>'), "https://www.futbolradar.com/a/b");
assert.equal(canonicalOfHtml('<link href="https://www.futbolradar.com/x" rel="canonical">'), "https://www.futbolradar.com/x");
assert.equal(canonicalOfHtml('<link rel="canonical" href="https://baska.example/x" />'), "", "yabancı alan adı kanonik sayılmaz");
assert.equal(canonicalOfHtml("<head></head>"), "");

// 2) Kanonik varsa o kazanır; yoksa rota haritasından türetilen adres.
{
  const route = { tr: "kose-yazilari/x.html", en: "en/columns/y.html" };
  const pages = {
    "kose-yazilari/x.html": '<link rel="canonical" href="https://www.futbolradar.com/kose-yazilari/x" />',
    "en/columns/y.html": ""
  };
  const urls = alternateUrls(route, (file) => pages[file] || "", pairUrl);
  assert.equal(urls.tr, "https://www.futbolradar.com/kose-yazilari/x");
  assert.equal(urls.en, pairUrl(route, "en"), "kanonik yoksa pairUrl'e düşer");
}

// 3) Gerçek köşe yazısı çifti: üretilen sayfaların kanoniği hreflang adresi olur
//    ve `.html` ile bitmez.
{
  const store = JSON.parse(fs.readFileSync(path.join(root, "data", "columns.json"), "utf8"));
  const { columns } = publishedColumns(store, { locale: "en" });
  const column = columns.find((row) => row.hasEnglish && row.path && row.counterpartPath);
  assert.ok(column, "çevirisi olan yayımlanmış yazı bulunmalı");
  const enHtml = columnPageHtml(column, "en");
  const trColumn = presentColumn(store.columns.find((row) => row.id === column.id), "tr");
  const trHtml = columnPageHtml(trColumn, "tr");
  const pages = { [column.path]: enHtml, [column.counterpartPath]: trHtml };
  const urls = alternateUrls({ tr: column.counterpartPath, en: column.path }, (file) => pages[file] || "", pairUrl);
  assert.equal(urls.tr, canonicalOfHtml(trHtml));
  assert.equal(urls.en, canonicalOfHtml(enHtml));
  assert.ok(!urls.tr.endsWith(".html") && !urls.en.endsWith(".html"), `uzantısız kanonik bekleniyordu: ${urls.tr} / ${urls.en}`);
}

// 4) İstek anında üretilen haber sayfası kendi hreflang kümesini taşır; küme
//    inject-hreflang işaretleriyle sarılı (statik kopyada tek küme kalır).
{
  const html = matchNews.renderPage();
  const block = html.match(/<!-- hreflang:start -->([\s\S]*?)<!-- hreflang:end -->/);
  assert.ok(block, "hreflang bloğu işaretli olmalı");
  const tags = [...block[1].matchAll(/hreflang="([^"]+)" href="([^"]+)"/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(tags.map((t) => t[0]), ["tr-TR", "en", "x-default"]);
  assert.equal(tags[0][1], canonicalOfHtml(html), "tr-TR kanonikle aynı");
  assert.equal(tags[2][1], tags[0][1], "x-default Türkçe");
  assert.equal(tags[1][1], matchNews.EN_URL);
  // İngilizce adres haber kaydındaki en.slug ile aynı mı?
  const news = JSON.parse(fs.readFileSync(path.join(root, "data", "news.json"), "utf8"));
  const record = news.find((row) => row.id === matchNews.editorial.id);
  assert.ok(record && record.en && record.en.slug, "haber kaydının İngilizce slug'ı olmalı");
  assert.equal(matchNews.EN_URL, `https://www.futbolradar.com/en/news/${record.en.slug}`);
}

console.log("hreflang tutarlılık testleri geçti.");
