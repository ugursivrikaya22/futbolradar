/**
 * RADAR YORUMU TESTLERİ
 *
 * Sistemin iki sözü var ve testler bu ikisini koruyor:
 *
 *   1. YORUM İLE HABER AYRIDIR. Her yazı "Köşe Yazısı" künyesi taşır; künyesiz bir
 *      köşe yazısı yayımlanamaz. Okuyucu bir kanaati sitenin doğrulanmış
 *      verisi sanmamalı.
 *   2. TASLAK ÜRETİLİR, YAYIN ELLE AÇILIR. Hiçbir otomatik yol bir yazıyı
 *      yayına alamaz; taslak hiçbir genel yüzeyde görünmez.
 *
 * Telegram tarafında sınanan tek şey: sır sızmıyor ve mesaj istenen üç
 * bilgiyi taşıyor.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { NAV_PRIMARY, NAV_SECONDARY } from "./lib/layout.mjs";
import { authorPageHtml, columnCard, columnPageHtml, groupAuthors } from "./generate-column-pages.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);

const {
  CATEGORIES,
  OPINION_BADGE,
  OPINION_DISCLAIMER,
  STATUSES,
  authorPath,
  draftColumns,
  presentColumn,
  publishedColumns,
  slugify,
  validateColumn
} = require("../services/columnService.js");

const {
  CALL_TO_ACTION,
  CHAT_ENV,
  TOKEN_ENV,
  draftMessage,
  sendTelegramMessage,
  telegramConfig
} = require("../services/telegramNotifier.js");

function column(overrides = {}) {
  return {
    id: "ornek-yazi",
    title: "Örnek yazı",
    author: "Yazar Adı",
    date: "2026-07-30T10:00:00+03:00",
    category: "lig-analizi",
    status: "published",
    excerpt: "Kısa özet.",
    body: ["Birinci paragraf.", "İkinci paragraf."],
    tags: ["etiket"],
    ...overrides
  };
}

// ── 1. Zorunlu alanlar ─────────────────────────────────────────────────────
{
  assert.equal(validateColumn(column()).valid, true, "tam kayıt geçerli olmalı");

  for (const field of ["id", "title", "author", "date", "category", "status"]) {
    const broken = column();
    delete broken[field];
    assert.equal(validateColumn(broken).valid, false, `${field} eksikken geçersiz olmalı`);
  }

  assert.equal(validateColumn(column({ status: "yayinda" })).valid, false, "bilinmeyen durum reddedilmeli");
  assert.equal(validateColumn(column({ category: "spor" })).valid, false, "bilinmeyen kategori reddedilmeli");
  assert.equal(validateColumn(column({ date: "dün" })).valid, false, "geçersiz tarih reddedilmeli");
  assert.equal(validateColumn(column({ tags: "etiket" })).valid, false, "tags dizi olmalı");
}

// ── 2. Yayımlanmış yazının gövdesi boş olamaz ──────────────────────────────
//
// Taslak boş olabilir (henüz yazılıyordur); yayında olan boş bir sayfa
// okuyucuya kırık görünür.
{
  assert.equal(validateColumn(column({ body: [] })).valid, false, "yayımlanmış boş gövde reddedilmeli");
  assert.equal(validateColumn(column({ excerpt: "" })).valid, false, "yayımlanmış yazı özetsiz olamaz");
  assert.equal(
    validateColumn(column({ status: "draft", body: [], excerpt: "" })).valid,
    true,
    "taslak boş gövdeyle geçerli olmalı"
  );
}

// ── 3. Taslak hiçbir genel yüzeyde görünmez ────────────────────────────────
{
  const store = {
    columns: [
      column({ id: "yayinda", status: "published" }),
      column({ id: "taslak", status: "draft", body: [], excerpt: "" }),
      column({ id: "incelemede", status: "review", body: [], excerpt: "" }),
      column({ id: "arsiv", status: "archived" })
    ]
  };

  const { columns } = publishedColumns(store);
  assert.deepEqual(
    columns.map((entry) => entry.id),
    ["yayinda"],
    "yalnızca published yazı genel yüzeye çıkmalı"
  );

  const drafts = draftColumns(store);
  assert.deepEqual(drafts.map((entry) => entry.id), ["taslak"], "taslak listesi yalnızca draft içermeli");

  // Durum tanımlarının kendisi de kontrol ediliyor: yeni bir durum eklenip
  // yanlışlıkla public işaretlenirse burada yakalanır.
  const publicStatuses = Object.entries(STATUSES).filter(([, entry]) => entry.public).map(([key]) => key);
  assert.deepEqual(publicStatuses, ["published"], "yalnızca published herkese açık olmalı");
}

// ── 4. Künye ve rozet her yazıda ───────────────────────────────────────────
{
  const presented = presentColumn(column());
  assert.equal(presented.badge, OPINION_BADGE, "her yazı Köşe Yazısı rozeti taşımalı");
  assert.equal(presented.disclaimer, OPINION_DISCLAIMER, "her yazı künye taşımalı");
  assert.equal(presented.authorPath, "yazarlar/yazar-adi.html", "yazar sayfası kalıcı bir yol taşımalı");
  assert.match(presented.disclaimer, /köşe yazısı/i, "künye yazının kanaat olduğunu söylemeli");
  assert.match(presented.disclaimer, /doğrulanmış maç verisi/i, "künye veriyle karıştırılmamayı söylemeli");

  // Rozet servisten geliyor: yüzeyin kendi başına hatırlaması gerekmiyor.
  const { columns } = publishedColumns({ columns: [column()] });
  assert.ok(columns[0].badge && columns[0].disclaimer, "yayın listesindeki yazı da künyeli olmalı");
}

// ── 5. Kısa ad Türkçe karakterleri düzgün çeviriyor ────────────────────────
{
  assert.equal(slugify("Fenerbahçe'nin Avrupa sınavı"), "fenerbahce-nin-avrupa-sinavi");
  assert.equal(slugify("Şampiyonluk yarışı: İlk perde"), "sampiyonluk-yarisi-ilk-perde");
  assert.equal(slugify("Göztepe'nin çıkışı"), "goztepe-nin-cikisi");
  assert.equal(authorPath("Yazar Adı"), "yazarlar/yazar-adi.html");
}

// ── 6. Kategori sözleşmesi ─────────────────────────────────────────────────
{
  assert.deepEqual(
    Object.keys(CATEGORIES).sort(),
    ["besiktas", "fenerbahce", "futbol-gundemi", "galatasaray", "lig-analizi", "mac-yorumu", "oyuncu-portresi", "trabzonspor", "transfer-yorumu"],
    "kategori listesi beklenen değerleri taşımalı"
  );
}

// ── 7. Betik yazıyı yayına ALAMAZ ──────────────────────────────────────────
//
// Yayın kararı sitenin sesini değiştirir; bir betiğin kendiliğinden
// vereceği karar değil. Betikte böyle bir seçenek BULUNMAMALI.
{
  const source = fs.readFileSync(path.join(root, "scripts", "create-column-draft.mjs"), "utf8");

  // Yorum satırları hariç tutuluyor: betik `--status`'ın NEDEN olmadığını
  // açıklayan bir cümle taşıyor ve o cümle değerli. Aranan şey seçeneğin
  // GERÇEKTEN İŞLENMESİ.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");

  assert.ok(
    !/--status/.test(code),
    "taslak betiği --status seçeneğini İŞLEMEMELİ: yayın elle açılır"
  );
  assert.ok(
    /status:\s*"draft"/.test(code),
    "betik durumu sabit 'draft' yazmalı"
  );
  assert.ok(
    !/status\s*[:=]\s*["']published["']/.test(code),
    "taslak betiği hiçbir kayda published yazmamalı"
  );
}

// ── 8. Telegram mesajı istenen üç bilgiyi taşır ────────────────────────────
{
  const presented = presentColumn(column({ status: "draft", body: [], excerpt: "" }));
  const message = draftMessage(presented);

  assert.match(message.text, /Örnek yazı/, "mesajda başlık olmalı");
  assert.match(message.text, /Lig analizi/, "mesajda kategori olmalı");
  assert.match(message.text, /Yazar Adı/, "mesajda yazar olmalı");
  assert.ok(message.text.includes(CALL_TO_ACTION.replace(",", "\\,")) || message.text.includes("yayınla"),
    "mesajda eylem çağrısı olmalı");

  // Taslak GÖVDESİ gönderilmiyor: gözden geçirilmemiş metin sohbette
  // yayımlanmış gibi dolaşmamalı.
  const withBody = presentColumn(column({ status: "draft", body: ["Gizli kalması gereken taslak paragrafı."] }));
  assert.ok(
    !draftMessage(withBody).text.includes("Gizli kalması gereken"),
    "taslak gövdesi bildirime girmemeli"
  );
}

// ── 9. Sır sızmıyor ────────────────────────────────────────────────────────
{
  const config = telegramConfig({});
  assert.equal(config.ready, false, "değişkensiz ortamda hazır olmamalı");
  assert.deepEqual(config.missing, [TOKEN_ENV, CHAT_ENV], "eksik değişkenler ADLARIYLA bildirilmeli");

  const ready = telegramConfig({ [TOKEN_ENV]: "gizli-jeton", [CHAT_ENV]: "123" });
  assert.equal(ready.ready, true);
  assert.ok(
    !JSON.stringify(ready).includes("gizli-jeton"),
    "yapılandırma raporu jeton DEĞERİNİ taşımamalı"
  );

  // Yapılandırma eksikken gönderim sessizce başarılı görünmemeli.
  const result = await sendTelegramMessage({ text: "x", parseMode: "MarkdownV2" }, { env: {} });
  assert.equal(result.sent, false, "yapılandırma yokken gönderildi denmemeli");
  assert.match(result.reason, /eksik/i, "gerekçe açık olmalı");
  assert.ok(!String(result.reason).includes("api.telegram.org"), "gerekçede uç nokta adresi olmamalı");
}

// ── 10. Gönderim hatası taslağı düşürmez ───────────────────────────────────
{
  const failing = await sendTelegramMessage(
    { text: "x", parseMode: "MarkdownV2" },
    {
      env: { [TOKEN_ENV]: "jeton", [CHAT_ENV]: "1" },
      fetchImpl: async () => { throw new TypeError("ağ yok"); }
    }
  );
  assert.equal(failing.sent, false, "hata sent=false dönmeli");
  assert.ok(!/jeton/.test(JSON.stringify(failing)), "hata raporu jeton taşımamalı");

  const rejected = await sendTelegramMessage(
    { text: "x", parseMode: "MarkdownV2" },
    {
      env: { [TOKEN_ENV]: "jeton", [CHAT_ENV]: "1" },
      fetchImpl: async () => ({ ok: false, status: 403 })
    }
  );
  assert.equal(rejected.sent, false);
  assert.equal(rejected.status, 403, "HTTP durumu bildirilmeli");
}

// ── 11. Gerçek veri dosyası geçerli ────────────────────────────────────────
{
  const file = path.join(root, "data", "columns.json");
  assert.ok(fs.existsSync(file), "data/columns.json bulunmalı");

  const store = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.ok(Array.isArray(store.columns), "columns dizisi olmalı");

  const ids = new Set();
  for (const entry of store.columns) {
    const verdict = validateColumn(entry);
    assert.equal(verdict.valid, true, `geçersiz kayıt "${entry && entry.id}": ${verdict.errors.join("; ")}`);
    assert.equal(ids.has(entry.id), false, `yinelenen id: ${entry.id}`);
    ids.add(entry.id);
  }

  console.log(`test-columns: ${store.columns.length} kayıt · ${publishedColumns(store).columns.length} yayında`);
}

// ── 12. Taslak betiği gerçekten yalnızca taslak üretiyor ───────────────────
{
  const output = execFileSync(process.execPath, [
    path.join(root, "scripts", "create-column-draft.mjs"),
    "--title=Kuru koşu denemesi",
    "--author=Test",
    "--category=mac-yorumu",
    "--dry-run"
  ], { cwd: root, encoding: "utf8", env: { ...process.env, [TOKEN_ENV]: "", [CHAT_ENV]: "" } });

  assert.match(output, /"status": "draft"/, "üretilen kayıt draft olmalı");
  assert.ok(!/"published"/.test(output), "çıktı published içermemeli");
}

// ── 13. Köşe yazıları gezinme, rota ve üretim sözleşmesi ────────────────────
{
  const primaryItem = NAV_PRIMARY.find((item) => item.href === "kose-yazilari.html");
  assert.equal(primaryItem?.label, "Köşe Yazıları", "köşe yazıları birincil menüde olmalı");
  assert.ok(!NAV_SECONDARY.some((item) => item.href === "kose-yazilari.html"), "menüde yinelenmemeli");

  const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  const rewrites = new Map(vercel.rewrites.map((rule) => [rule.source, rule.destination]));
  assert.equal(rewrites.get("/kose-yazilari"), "/kose-yazilari.html");
  assert.equal(rewrites.get("/kose-yazilari/:slug"), "/kose-yazilari/:slug.html");
  assert.equal(rewrites.get("/yazarlar/:slug"), "/yazarlar/:slug.html");
  // İNGİLİZCE YAZI DA UZANTISIZ AÇILMALI. Üretilen sayfa kendi canonical
  // adresini uzantısız yazıyor; kural olmadığında o adres 404 veriyordu.
  assert.equal(rewrites.get("/en/columns"), "/en/columns.html");
  assert.equal(rewrites.get("/en/columns/:slug"), "/en/columns/:slug.html");

  const generator = fs.readFileSync(path.join(root, "scripts", "generate-column-pages.mjs"), "utf8");
  assert.match(generator, /columns\.slice\(0, 3\)/, "ana sayfa yalnızca son üç yazıyı göstermeli");
  assert.match(generator, /function authorPageHtml\(/, "yazar arşivi üreticisi bulunmalı");
  assert.match(generator, /class="column-card-detail"/, "kartta detay bağlantısı bulunmalı");
  assert.match(generator, /class="column-standfirst"/, "detay sayfasında özet bulunmalı");
  assert.match(generator, /column\.authorPath/, "kart ve detay sayfası yazara bağlanmalı");

  const presented = presentColumn(column());
  const card = columnCard(presented);
  assert.match(card, /Yazıyı Oku/, "kartta açık bir detay eylemi olmalı");
  assert.match(card, /yazarlar\/yazar-adi\.html/, "kart yazar sayfasına bağlanmalı");

  const detail = columnPageHtml(presented);
  assert.match(detail, /class="column-standfirst">Kısa özet\./, "detay sayfasında özet görünmeli");
  assert.match(detail, /"@type":"Person","name":"Yazar Adı","url":/, "detay şeması yazarı bağlamalı");
  assert.match(detail, /src="\.\.\/site\.js" defer/, "detay sayfası ortak etkileşim betiğini yüklemeli");
  // KESME İŞARETİ ARTIK KAÇIRILIYOR. Paylaşım etiketleri sabit şablon metni
  // olmaktan çıkıp dile göre seçilen bir tablodan geliyor ve `escapeHtml`ten
  // geçiyor; yani `'` çıktıda `&#39;`. Ekranda görünen metin aynı, işaretleme
  // daha güvenli. Denetim bu yüzden iki biçimi de kabul ediyor.
  assert.match(detail, /Facebook(?:'|&#39;)ta Paylaş/, "detay sayfası Facebook paylaşım eylemi taşımalı");
  assert.match(detail, /X(?:'|&#39;)te Paylaş/, "detay sayfası X paylaşım eylemi taşımalı");
  assert.match(detail, /https:\/\/twitter\.com\/intent\/tweet\?text=/, "X Web Intent kullanılmalı");
  assert.match(detail, /FutbolRadar%20%7C%20futbolradar\.com/, "X metni FutbolRadar markasını taşımalı");
  assert.match(detail, /https%3A%2F%2Fwww\.futbolradar\.com%2Fkose-yazilari%2Fornek-yazi/, "X kanonik adresi taşımalı");
  assert.match(detail, /https:\/\/www\.facebook\.com\/sharer\/sharer\.php\?u=https%3A%2F%2Fwww\.futbolradar\.com%2Fkose-yazilari%2Fornek-yazi/, "Facebook kanonik adresi taşımalı");
  assert.match(detail, /property="og:title" content="Örnek yazı \| FutbolRadar"/, "OG başlığı markalı olmalı");
  assert.match(detail, /property="og:description" content="Kısa özet\. — futbolradar\.com"/, "OG açıklaması markalı olmalı");
  assert.match(detail, /property="og:image:width" content="1200"/, "OG görsel genişliği belirtilmeli");
  assert.match(detail, /property="og:image:height" content="630"/, "OG görsel yüksekliği belirtilmeli");
  assert.match(detail, /property="og:image:alt" content="Örnek yazı \| FutbolRadar"/, "OG görsel alternatif metni markalı olmalı");
  assert.match(detail, /name="twitter:card" content="summary_large_image"/, "X kart türü belirtilmeli");
  assert.match(detail, /name="twitter:title" content="Örnek yazı \| FutbolRadar"/, "X kart başlığı markalı olmalı");

  // ── İç bağlantı notasyonu: `[metin](hedef.html)` ─────────────────────────
  const linked = presentColumn(column({
    body: [
      "[Süper Lig](super-lig-puan-durumu.html)'de bir gelişme.",
      "[Zararlı bağlantı](javascript:alert(1)) işlenmemeli.",
      "Eşleşmeyen [köşeli parantez metni."
    ]
  }));
  const linkedDetail = columnPageHtml(linked);
  assert.match(
    linkedDetail,
    /<a href="\.\.\/super-lig-puan-durumu">Süper Lig<\/a>&#39;de bir gelişme\./,
    "gövdedeki [metin](hedef.html) iç bağlantıya çevrilmeli, base ile önekli olmalı ve 301 kaynağı yerine kanonik adrese gitmeli"
  );
  assert.ok(!/href="[^"]*javascript:/.test(linkedDetail), "yalnızca .html ile biten göreli hedeflere izin verilmeli");
  assert.match(linkedDetail, /Eşleşmeyen \[köşeli parantez metni\./, "eşleşmeyen köşeli parantez metni olduğu gibi kalmalı");

  const authors = groupAuthors([presented]);
  assert.equal(authors.length, 1);
  const archive = authorPageHtml(authors[0]);
  assert.match(archive, /<h1>Yazar Adı Yazıları<\/h1>/, "yazar sayfasında açık H1 olmalı");
  assert.match(archive, /"@type":"ProfilePage"/, "yazar sayfasında ProfilePage şeması olmalı");
  assert.match(archive, /Örnek yazı/, "yazar sayfası yayımlanmış yazıyı listelemeli");
  assert.match(archive, /src="\.\.\/site\.js" defer/, "yazar sayfası ortak etkileşim betiğini yüklemeli");
}

// Paylaşım penceresi tek bir ortak istemci davranışıyla açılır; kart
// etkileşimiyle çakışmaması ve yeni pencerenin açtığı sayfaya erişememesi gerekir.
{
  const card = columnCard(presentColumn(column()), "./", { showShareControls: true });
  const siteScript = fs.readFileSync(path.join(root, "site.js"), "utf8");

  assert.match(card, /class="column-card-share/, "liste kartında kompakt paylaşım simgeleri olmalı");
  assert.match(card, /data-share-popup/, "kart simgeleri ortak popup davranışını kullanmalı");
  assert.match(card, /rel="noopener noreferrer"/, "kart paylaşım bağlantıları korumalı olmalı");
  assert.match(siteScript, /function setupSharePopups\(\)/, "ortak paylaşım popup kurulumu bulunmalı");
  assert.match(siteScript, /event\.stopPropagation\(\)/, "paylaşım tıklaması kart gezinmesini tetiklememeli");
  assert.match(siteScript, /noopener,noreferrer/, "popup noopener ve noreferrer korumasıyla açılmalı");
}

console.log("Radar Yorumu testleri geçti (zorunlu alanlar, taslak gizliliği, yazar sayfaları, son üç yazı, temiz rotalar, elle yayın).");

// Kaynak numaraları yalnızca kayıtlı HTTPS kaynaklarına bağlanır.
{
  const rendered = columnPageHtml(presentColumn(column({author:'FutbolRadar',body:['**Doğrulanan bilgi** [1]. Bilinmeyen [9]. <script>alert(1)</script>'],sources:[{label:'Resmî kaynak',url:'https://www.tff.org/default.aspx?a=1&b=2'}]})));
  assert.match(rendered, /href="https:\/\/www\.tff\.org\/default\.aspx\?a=1&amp;b=2"[^>]*>\[1\]<\/a>/);
  assert.match(rendered, /Bilinmeyen \[9\]/);
  assert.ok(!rendered.includes('<script>alert(1)</script>'));
  assert.match(rendered, /"author":\{"@type":"Organization","name":"FutbolRadar"/);
}

// Ana sayfa öne çıkan köşe yazısı: veriye bağlı, en yeni yazı, uzantısız adres, kaçırılmış metin.
{
  const { featuredColumnHtml, pickFeaturedColumn } = await import("./generate-column-pages.mjs");
  const now = Date.parse("2026-10-19T17:00:00+03:00");
  const older = presentColumn(column({ id: "eski-yazi", date: "2026-10-18T23:30:00+03:00" }));
  // UTC ofseti farklı ama zamanca daha yeni: metin sıralaması yanılırdı.
  const newer = presentColumn(column({ id: "yeni-yazi", title: "Yeni <b>yazı</b> & \"tırnak\"", excerpt: "Özet <script>x</script>", date: "2026-10-18T21:00:00Z" }));
  const future = presentColumn(column({ id: "gelecek-yazi", date: "2026-10-20T10:00:00+03:00" }));
  assert.equal(pickFeaturedColumn([older, newer, future], now).id, "yeni-yazi", "vitrin en yeni (gelecek tarihli olmayan) yazıyı seçmeli");
  const hero = featuredColumnHtml([older, newer, future], now);
  assert.match(hero, /<article class="home-featured-column__card"/, "vitrin <article> olmalı");
  assert.match(hero, /<h2 class="home-featured-column__title"/, "vitrin başlığı h2 olmalı");
  const cleanHref = `./${newer.path.replace(/\.html$/, "")}`;
  assert.ok(hero.includes(`href="${cleanHref}" aria-label="Devamını Oku: `), "Devamını Oku uzantısız kanonik adrese gitmeli");
  assert.ok(!hero.includes(".html"), "vitrin .html uzantılı bağlantı vermemeli");
  assert.match(hero, /Yeni &lt;b&gt;yazı&lt;\/b&gt; &amp; &quot;tırnak&quot;/, "başlık kaçırılmalı");
  assert.ok(!hero.includes("<script>"), "özet kaçırılmalı");
  assert.match(hero, /Köşe Yazısı/, "vitrin yorum rozetini taşımalı");
  assert.equal(featuredColumnHtml([], now), "", "yazı yoksa vitrin boş kalmalı");
  const home = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(home, /<section[^>]*data-featured-column[^>]*aria-label="Öne çıkan köşe yazısı"/, "ana sayfada vitrin bölümü olmalı");
  assert.match(home, /<!-- prerender:home-featured-column:start -->/, "ana sayfada vitrin slot'u olmalı");

  // SIRA: canlı skor kahramanı → öne çıkan köşe yazısı → maç vitrini / maç dosyası.
  // Şablonda bölüm hero'nun HEMEN ardında (arada yalnızca açıklama yorumu olabilir);
  // maç günü olmasa da (vitrin bloğu sökülmüşken) bu sıra korunur.
  const heroEnd = home.match(/<section class="container hero" id="hero-canli-skor"[\s\S]*?<\/section>\r?\n/);
  assert.ok(heroEnd, "ana sayfada canlı skor kahramanı bulunmalı");
  const afterHero = home.slice(heroEnd.index + heroEnd[0].length);
  assert.match(afterHero, /^\s*(?:<!--[\s\S]*?-->\s*)?<section class="container home-featured-column"/, "öne çıkan köşe yazısı canlı skor kahramanının hemen altında olmalı");
  const featuredAt = home.indexOf("data-featured-column");
  for (const marker of ["<!-- featured-match-spotlight:start -->", "<!-- match-special:start -->"]) {
    const at = home.indexOf(marker);
    if (at >= 0) assert.ok(featuredAt < at, `öne çıkan köşe yazısı ${marker} bloğunun üstünde olmalı`);
  }
  // Enjektörler kendi bloklarını önce köşe yazısı bölümünün ardına, yoksa hero'nun ardına yazar.
  const spotlightSource = fs.readFileSync(path.join(root, "scripts", "generate-featured-match-spotlight.mjs"), "utf8");
  const specialSource = fs.readFileSync(path.join(root, "scripts", "inject-match-special.mjs"), "utf8");
  assert.match(spotlightSource, /anchors: \[FEATURED_COLUMN_END_RE, HERO_END_RE\]/, "maç vitrini köşe yazısı bölümünün ardına yazılmalı");
  assert.match(specialSource, /\[FEATURED_COLUMN_END_RE, HERO_END_RE\]\.find/, "maç dosyası kutusu köşe yazısı bölümünün ardına yazılmalı");
  // Çapa deseni gerçek bir sayfada bölümün tamamını (ve yalnızca onu) yakalamalı.
  const anchorSource = (spotlightSource.match(/const FEATURED_COLUMN_END_RE = (\/.+\/);/) || [])[1];
  assert.ok(anchorSource, "FEATURED_COLUMN_END_RE tanımı bulunmalı");
  const anchorRe = new Function(`return ${anchorSource}`)();
  const sample = `<section class="container hero" id="hero-canli-skor"><div></div></section>\n<section class="container home-featured-column" data-featured-column hidden>\n<!-- s --><!-- e -->\n</section>\n<section class="container x"></section>\n`;
  const caught = sample.match(anchorRe);
  assert.ok(caught && caught[0].endsWith("</section>\n") && !caught[0].includes("container x") && !caught[0].includes("hero-canli-skor"), "çapa yalnızca köşe yazısı bölümünü yakalamalı");
}

// Öne çıkan köşe yazısı "Köşe notu": vitrinin maçından türetilir, bugün + başlama+2 saat penceresinde görünür.
{
  const { featuredColumnNote, applyFeaturedColumnNote, NOTE_DWELL_MS } = await import("./lib/featuredColumnNote.mjs");
  const match = { homeTeam: "Trabzonspor", awayTeam: "Beşiktaş", kickoff: "2026-10-19T20:00:00+03:00", venue: "Papara Park", phase: "pre", href: "./mac/trabzonspor-besiktas-19-ekim-2026" };
  const at = (iso) => Date.parse(iso);
  assert.equal(NOTE_DWELL_MS, 2 * 60 * 60 * 1000, "not başlama saatinden 2 saat sonra düşmeli");
  const note = featuredColumnNote(match, at("2026-10-19T17:00:00+03:00"));
  assert.match(note.html, /<time datetime="2026-10-19T20:00:00\+03:00">Bu akşam 20\.00<\/time> · Papara Park — <strong>Trabzonspor–Beşiktaş<\/strong>/, "not saat, stadyum ve eşleşmeyi taşımalı");
  assert.match(note.html, /<a class="home-featured-column__note-link" href="\.\/mac\/trabzonspor-besiktas-19-ekim-2026">/, "not uzantısız maç sayfasına bağlanmalı");
  assert.match(note.html, /data-expires-at="2026-10-19T19:00:00\.000Z"/, "son kullanma = başlama + 2 saat");
  assert.ok(!featuredColumnNote({ ...match, href: "" }, at("2026-10-19T17:00:00+03:00")).html.includes("<a "), "maç sayfası yoksa bağlantı basılmamalı");
  assert.ok(!featuredColumnNote({ ...match, venue: "" }, at("2026-10-19T17:00:00+03:00")).html.includes(" · "), "stadyum yoksa uydurulmamalı");
  assert.match(featuredColumnNote({ ...match, kickoff: "2026-10-19T14:30:00+03:00" }, at("2026-10-19T09:00:00+03:00")).html, />Bugün 14\.30</, "gündüz maçında 'Bugün' yazmalı");
  assert.ok(featuredColumnNote({ ...match, phase: "live" }, at("2026-10-19T21:30:00+03:00")).html, "maç sırasında görünmeli");
  assert.equal(featuredColumnNote(match, at("2026-10-19T22:00:00+03:00")).html, "", "başlama + 2 saatte düşmeli");
  assert.equal(featuredColumnNote(match, at("2026-10-18T21:00:00+03:00")).html, "", "maç bugün değilse görünmemeli");
  assert.equal(featuredColumnNote({ ...match, phase: "post" }, at("2026-10-19T21:00:00+03:00")).html, "", "biten maçta görünmemeli");
  assert.equal(featuredColumnNote({ ...match, phase: "postponed" }, at("2026-10-19T17:00:00+03:00")).html, "", "ertelenen maçta görünmemeli");
  assert.equal(featuredColumnNote(null).html, "", "veri yoksa görünmemeli");
  assert.equal(featuredColumnNote({ ...match, kickoff: "belirsiz" }, at("2026-10-19T17:00:00+03:00")).html, "", "saat yoksa görünmemeli");
  const tricky = featuredColumnNote({ ...match, homeTeam: "<img src=x onerror=1>", venue: "A & B \"Park\"" }, at("2026-10-19T17:00:00+03:00")).html;
  assert.ok(!tricky.includes("<img") && tricky.includes("&lt;img") && tricky.includes("A &amp; B &quot;Park&quot;"), "not metni kaçırılmalı");

  const shell = `<section class="container home-featured-column" data-featured-column><aside class="home-featured-column__note" data-featured-column-note aria-label="x" hidden>\n<!-- prerender:home-featured-column-note:start -->\n<!-- prerender:home-featured-column-note:end -->\n</aside></section>`;
  const shown = applyFeaturedColumnNote(shell, note.html);
  assert.match(shown, /<aside [^>]*data-featured-column-note aria-label="x">/, "not doluyken hidden kalkmalı");
  assert.ok(shown.includes("Bu akşam 20.00"), "slot dolmalı");
  const cleared = applyFeaturedColumnNote(shown, "");
  assert.match(cleared, /<aside [^>]*data-featured-column-note aria-label="x" hidden>/, "not boşken hidden olmalı");
  assert.ok(!cleared.includes("Bu akşam"), "slot boşalmalı");

  const home = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const sectionAt = home.indexOf("data-featured-column ");
  const noteAt = home.indexOf("data-featured-column-note");
  const sectionEnd = home.indexOf("</section>", sectionAt);
  assert.ok(noteAt > sectionAt && noteAt < sectionEnd, "köşe notu öne çıkan köşe yazısı bölümünün içinde olmalı");
  assert.ok(home.indexOf("<!-- prerender:home-featured-column-note:start -->") > home.indexOf("<!-- prerender:home-featured-column:end -->"), "not slot'u köşe yazısı slot'unun dışında (kartın altında) olmalı");
  const generator = fs.readFileSync(path.join(root, "scripts", "generate-featured-match-spotlight.mjs"), "utf8");
  assert.match(generator, /featuredColumnNote\(\{/, "not vitrin üreticisinin seçtiği maçtan türetilmeli");
  assert.match(generator, /fs\.existsSync\(path\.join\(root, `mac\/\$\{selected\.slug\}\.html`\)\)/, "bağlantı yalnızca maç sayfası varsa verilmeli");
  const client = fs.readFileSync(path.join(root, "featured-match-spotlight.js"), "utf8");
  assert.match(client, /\[data-featured-column-note\]/, "istemci notun son kullanmasını uygulamalı");
}
