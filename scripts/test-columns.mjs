/**
 * RADAR YORUMU TESTLERİ
 *
 * Sistemin iki sözü var ve testler bu ikisini koruyor:
 *
 *   1. YORUM İLE HABER AYRIDIR. Her yazı "Yorum" künyesi taşır; künyesiz bir
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
  assert.equal(presented.badge, OPINION_BADGE, "her yazı Yorum rozeti taşımalı");
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

// ── 6. Beş kategori ────────────────────────────────────────────────────────
{
  assert.deepEqual(
    Object.keys(CATEGORIES).sort(),
    ["futbol-gundemi", "lig-analizi", "mac-yorumu", "oyuncu-portresi", "transfer-yorumu"],
    "kategori listesi beklenen beş değeri taşımalı"
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

  const generator = fs.readFileSync(path.join(root, "scripts", "generate-column-pages.mjs"), "utf8");
  assert.match(generator, /columns\.slice\(0, 3\)/, "ana sayfa yalnızca son üç yazıyı göstermeli");
  assert.match(generator, /function authorPageHtml\(/, "yazar arşivi üreticisi bulunmalı");
  assert.match(generator, /class="column-card-detail"/, "kartta detay bağlantısı bulunmalı");
  assert.match(generator, /class="column-standfirst"/, "detay sayfasında özet bulunmalı");
  assert.match(generator, /column\.authorPath/, "kart ve detay sayfası yazara bağlanmalı");

  const presented = presentColumn(column());
  const card = columnCard(presented);
  assert.match(card, /Yazıyı oku/, "kartta açık bir detay eylemi olmalı");
  assert.match(card, /yazarlar\/yazar-adi\.html/, "kart yazar sayfasına bağlanmalı");

  const detail = columnPageHtml(presented);
  assert.match(detail, /class="column-standfirst">Kısa özet\./, "detay sayfasında özet görünmeli");
  assert.match(detail, /"@type":"Person","name":"Yazar Adı","url":/, "detay şeması yazarı bağlamalı");

  const authors = groupAuthors([presented]);
  assert.equal(authors.length, 1);
  const archive = authorPageHtml(authors[0]);
  assert.match(archive, /<h1>Yazar Adı Yazıları<\/h1>/, "yazar sayfasında açık H1 olmalı");
  assert.match(archive, /"@type":"ProfilePage"/, "yazar sayfasında ProfilePage şeması olmalı");
  assert.match(archive, /Örnek yazı/, "yazar sayfası yayımlanmış yazıyı listelemeli");
}

console.log("Radar Yorumu testleri geçti (zorunlu alanlar, taslak gizliliği, yazar sayfaları, son üç yazı, temiz rotalar, elle yayın).");
