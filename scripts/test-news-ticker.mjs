/**
 * KÜRATÖRLÜ SON DAKİKA BANDI TESTLERİ
 *
 * Bu bandın diğer kaynaklardan farkı, içeriğin ELLE girilmesi. Türetilmiş
 * veride yanlışlık bir hesaplama hatasıdır; elle girilen veride yanlışlık
 * bir İDDİADIR. O yüzden buradaki testlerin çoğu tek bir soruyu sınıyor:
 *
 *     Kesinleşmemiş bir bilgi, kesinleşmiş gibi görünebilir mi?
 *
 * Cevap her yolda "hayır" olmalı: eksik güven alanıyla, çelişkili
 * kategoriyle, kesinlik fiili taşıyan metinle ya da rozetsiz şablonla.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);

const {
  CATEGORIES,
  CONFIDENCE,
  normalizeTickerItems,
  validateTickerItem,
  confidenceBadge
} = require("../services/newsTicker.js");

const now = new Date("2026-07-31T12:00:00+03:00");

function item(overrides = {}) {
  return {
    id: "ornek",
    category: "official",
    confidence: "confirmed",
    text: "Örnek başlık",
    timestamp: "2026-07-30T12:00:00+03:00",
    source: { name: "Kaynak", url: "https://example.com/haber" },
    ...overrides
  };
}

// ── 1. Eksik güven "kesin" sayılmaz ────────────────────────────────────────
{
  const verdict = validateTickerItem(item({ confidence: undefined }));
  assert.equal(verdict.valid, false, "confidence eksikken öğe geçerli sayılmamalı");
  assert.ok(
    verdict.errors.some((error) => /confidence yok/.test(error)),
    "eksik güven açıkça gerekçelendirilmeli"
  );

  // Ve bandın kendisine de girmemeli.
  const { items, rejected } = normalizeTickerItems({ items: [item({ confidence: undefined })] }, { now });
  assert.equal(items.length, 0, "güvensiz öğe banda girmemeli");
  assert.equal(rejected.length, 1, "elenen öğe raporlanmalı");
}

// ── 2. Transfer iddiası "doğrulandı" olamaz ────────────────────────────────
{
  const verdict = validateTickerItem(item({ category: "transfer-rumour", confidence: "confirmed" }));
  assert.equal(verdict.valid, false, "iddia kategorisi confirmed olamaz");
  assert.ok(
    verdict.errors.some((error) => /official/.test(error)),
    "çelişki gerekçesi doğru kategoriyi önermeli"
  );
}

// ── 3. Rozet ile cümle çelişemez ───────────────────────────────────────────
//
// Rozet "SÖYLENTİ" derken cümle "imzaladı" diyorsa okuyucu cümleye inanır;
// rozet koruma değil süs olur.
{
  for (const phrase of ["resmen açıklandı", "imzaladı", "duyurdu", "kesinleşti"]) {
    const verdict = validateTickerItem(item({
      category: "transfer-rumour",
      confidence: "rumour",
      text: `Oyuncu ${phrase}`
    }));
    assert.equal(verdict.valid, false, `kesinleşmemiş metinde "${phrase}" geçememeli`);
  }

  // Kesinleşmiş öğede aynı ifade SERBEST — orada çelişki yok.
  const confirmed = validateTickerItem(item({
    category: "official",
    confidence: "confirmed",
    text: "Kulüp transferi resmen açıkladı"
  }));
  assert.equal(confirmed.valid, true, "doğrulanmış öğede kesinlik ifadesi serbest olmalı");

  // Çekinceli dil ise her zaman serbest.
  const hedged = validateTickerItem(item({
    category: "transfer-rumour",
    confidence: "rumour",
    text: "Görüşmelerin sürdüğü öne sürüldü"
  }));
  assert.equal(hedged.valid, true, "çekinceli iddia geçerli olmalı");
}

// ── 4. Kaynak zorunlu ──────────────────────────────────────────────────────
{
  assert.equal(validateTickerItem(item({ source: { name: "X" } })).valid, false, "url'siz öğe geçersiz");
  assert.equal(validateTickerItem(item({ source: { url: "https://a.b" } })).valid, false, "isimsiz kaynak geçersiz");
  assert.equal(
    validateTickerItem(item({ source: { name: "X", url: "javascript:alert(1)" } })).valid,
    false,
    "http(s) olmayan kaynak reddedilmeli"
  );
}

// ── 5. Kesinleşmemiş her öğe rozet TAŞIR ───────────────────────────────────
{
  assert.equal(confidenceBadge("confirmed"), "", "doğrulanmış öğede rozet olmamalı");
  assert.ok(confidenceBadge("rumour"), "söylenti rozeti olmalı");
  assert.ok(confidenceBadge("reported"), "basında rozeti olmalı");

  for (const [key, entry] of Object.entries(CONFIDENCE)) {
    if (!entry.requiresBadge) continue;
    assert.ok(entry.badge.trim(), `${key}: çekince gerektiren seviye rozetsiz olamaz`);
  }

  const { items } = normalizeTickerItems({
    items: [
      item({ id: "a", category: "transfer-rumour", confidence: "rumour", text: "Görüşme iddiası" }),
      item({ id: "b", category: "manager-quote", confidence: "reported", text: "Basına yansıyan değerlendirme" })
    ]
  }, { now });

  assert.equal(items.length, 2, "geçerli kesinleşmemiş öğeler banda girmeli");
  for (const entry of items) {
    assert.ok(entry.confidenceBadge, `${entry.category}: rozet üretilmeli`);
  }
}

// ── 6. Raf ömrü kategoriye göre ────────────────────────────────────────────
//
// Bayat bir iddia faydasızdan kötüdür: çoktan çürütülmüş olabilir ve bant
// onu hâlâ gündem gibi taşır.
{
  const old = "2026-07-20T12:00:00+03:00"; // ~11 gün önce

  const rumour = normalizeTickerItems({
    items: [item({ id: "eski-iddia", category: "transfer-rumour", confidence: "rumour", text: "Eski iddia", timestamp: old })]
  }, { now });
  assert.equal(rumour.items.length, 0, "11 günlük iddia banda girmemeli (raf ömrü 7 gün)");

  const official = normalizeTickerItems({
    items: [item({ id: "eski-resmi", category: "official", confidence: "confirmed", text: "Eski resmî açıklama", timestamp: old })]
  }, { now });
  assert.equal(official.items.length, 1, "11 günlük resmî açıklama geçerli kalmalı (raf ömrü 21 gün)");
}

// ── 7. Geleceğe tarihli kayıt reddedilir ───────────────────────────────────
{
  const future = normalizeTickerItems({
    items: [item({ id: "gelecek", timestamp: "2026-08-15T12:00:00+03:00" })]
  }, { now });
  assert.equal(future.items.length, 0, "gelecek tarihli öğe bandın 'şu an' iddiasını bozar");
}

// ── 8. Beş kategori de destekleniyor ───────────────────────────────────────
{
  const expected = ["official", "post-match", "squad-update", "manager-quote", "transfer-rumour"];
  assert.deepEqual(Object.keys(CATEGORIES).sort(), expected.slice().sort(), "beş kategori tanımlı olmalı");
  for (const key of expected) {
    assert.ok(CATEGORIES[key].label, `${key}: ekran etiketi olmalı`);
    assert.ok(Number.isFinite(CATEGORIES[key].maxAgeHours), `${key}: raf ömrü tanımlı olmalı`);
  }
}

// ── 9. Gerçek veri dosyası geçerli ─────────────────────────────────────────
{
  const file = path.join(root, "data", "news-ticker.json");
  assert.ok(fs.existsSync(file), "data/news-ticker.json bulunmalı");

  const payload = JSON.parse(fs.readFileSync(file, "utf8"));
  const raw = Array.isArray(payload) ? payload : payload.items;
  assert.ok(Array.isArray(raw), "items dizisi olmalı");

  const ids = new Set();
  for (const entry of raw) {
    const verdict = validateTickerItem(entry);
    assert.equal(
      verdict.valid,
      true,
      `data/news-ticker.json geçersiz kayıt "${entry && entry.id}": ${verdict.errors.join("; ")}`
    );
    assert.equal(ids.has(entry.id), false, `yinelenen id: ${entry.id}`);
    ids.add(entry.id);
  }

  const { items, rejected } = normalizeTickerItems(payload, { now });
  console.log(`test-news-ticker: gerçek dosyadan ${items.length} öğe geçti, ${rejected.length} elendi`);
  for (const row of rejected) {
    console.log(`test-news-ticker:   elendi ${row.id}: ${row.errors.join("; ")}`);
  }
}

// ── 10. Şablon rozeti gerçekten basıyor ────────────────────────────────────
//
// Kural katmanı doğru olsa bile şablon rozeti çizmezse söylenti kesin gibi
// görünür. Bu yüzden işaretleme de sınanıyor.
{
  const { newsTicker } = await import("./lib/layout.mjs");

  const html = newsTicker({
    base: "./",
    badge: "Gündem",
    items: [
      { label: "Transfer iddiası", text: "Görüşmelerin sürdüğü öne sürüldü", href: "https://example.com/a", at: "2026-07-30T12:00:00+03:00", confidence: "rumour", confidenceBadge: "SÖYLENTİ", sourceName: "Kaynak" },
      { label: "Resmî açıklama", text: "Kulüp transferi resmen açıkladı", href: "https://example.com/b", at: "2026-07-30T12:00:00+03:00", confidence: "confirmed", confidenceBadge: "", sourceName: "Kulüp" }
    ]
  });

  assert.ok(html.includes("SÖYLENTİ"), "söylenti rozeti işaretlemede görünmeli");
  assert.ok(html.includes("news-ticker-confidence is-rumour"), "rozet güven sınıfını taşımalı");
  assert.ok(
    html.includes("aria-label=") && html.includes("kaynak: Kaynak"),
    "çekince ve kaynak ekran okuyucuya da ulaşmalı"
  );

  // Doğrulanmış öğe rozetsiz: rozetin VARLIĞI anlamlı bir sinyal olmalı.
  //
  // Öğeler tek tek ayıklanıyor. Bant kayan şerit için içeriği İKİ KEZ
  // basıyor; "doğrulanmış öğeden sonrasına bak" gibi bir kesit alma,
  // ikinci kopyadaki söylenti rozetini yakalayıp testi yanıltıyordu.
  const anchors = html.match(/<a class="news-ticker-item"[\s\S]*?<\/a>/g) || [];
  assert.ok(anchors.length >= 2, "işaretlemede bant öğeleri bulunmalı");

  const confirmedAnchor = anchors.find((anchor) => anchor.includes("Kulüp transferi"));
  const rumourAnchor = anchors.find((anchor) => anchor.includes("Görüşmelerin sürdüğü"));

  assert.ok(confirmedAnchor && rumourAnchor, "her iki öğe de işaretlemede olmalı");
  assert.ok(
    !confirmedAnchor.includes("news-ticker-confidence"),
    "doğrulanmış öğeye çekince rozeti basılmamalı"
  );
  assert.ok(
    rumourAnchor.includes("news-ticker-confidence"),
    "söylenti öğesi çekince rozetini taşımalı"
  );
}

console.log("Küratörlü ticker testleri geçti (eksik güven reddi, kategori çelişkisi, rozet-cümle çelişkisi, kaynak zorunluluğu, raf ömrü, şablon rozeti).");
