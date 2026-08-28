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
  BREAKING_WINDOW_HOURS,
  CATEGORIES,
  CONFIDENCE,
  EDITORIAL_RANKS,
  dedupeByMeaning,
  editorialRank,
  normalizeTickerItems,
  shelfLifeVerdict,
  validateTickerItem,
  confidenceBadge
} = require("../services/newsTicker.js");

const now = new Date("2026-08-01T14:20:00+03:00");

function item(overrides = {}) {
  return {
    id: "ornek",
    category: "official",
    confidence: "confirmed",
    text: "Örnek başlık",
    timestamp: "2026-07-30T12:00:00+03:00",
    // Varsayılan kategori "official"; o kategori resmî ağız gerektirdiği
    // için kurgu da kulübün kendi alanını taşır.
    source: { name: "Kaynak", url: "https://www.galatasaray.org/haber/ornek" },
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
  const old = "2026-07-20T12:00:00+03:00"; // ~12 gün önce

  const rumour = normalizeTickerItems({
    items: [item({ id: "eski-iddia", category: "transfer-rumour", confidence: "rumour", text: "Eski iddia", timestamp: old })]
  }, { now });
  assert.equal(rumour.items.length, 0, "12 günlük iddia banda girmemeli");

  // VARSAYILAN RAF ÖMRÜ ÜÇ GÜN — resmî açıklama da bundan muaf değil.
  //
  // `official` kategorisine tanınan 21 günlük pencere doğrulanmış TRANSFER
  // kayıtları için düşünülmüştü, ama kategori kulübün her duyurusunu
  // kapsıyor: antrenman raporu, bilet satışı, tesis haberi. Depoda sonucu
  // görülüyordu — banttaki 20 öğenin altısı üç günden eskiydi, en eskisi
  // 201 saatlik bir kulüp duyurusuydu.
  const official = normalizeTickerItems({
    items: [item({ id: "eski-resmi", category: "official", confidence: "confirmed", text: "Eski resmî açıklama", timestamp: old })]
  }, { now });
  assert.equal(official.items.length, 0, "12 günlük resmî açıklama da banda girmemeli");

  // Üç günün içindeki resmî açıklama elbette kalır.
  const fresh = normalizeTickerItems({
    items: [item({ id: "taze-resmi", category: "official", confidence: "confirmed", text: "Taze resmî açıklama", timestamp: "2026-08-01T12:00:00+03:00" })]
  }, { now });
  assert.equal(fresh.items.length, 1, "üç günden yeni resmî açıklama kalmalı");

  // TEK İSTİSNA: maç programı duyurusu, KENDİ BİTİŞ TARİHİNİ taşıyorsa
  // varsayılanı aşabilir — süresiz asılı kalmaz, maç gelince kendiliğinden
  // düşer. `expiresAt` yoksa o da varsayılana tabidir.
  const datedFixture = normalizeTickerItems({
    items: [item({
      id: "tarihli-fikstur", category: "fixture", confidence: "confirmed",
      text: "14 Ağustos'ta oynanacak", timestamp: old, expiresAt: "2026-08-20T12:00:00+03:00"
    })]
  }, { now });
  assert.equal(datedFixture.items.length, 1, "bitiş tarihi taşıyan maç programı duyurusu kalabilir");

  const undatedFixture = normalizeTickerItems({
    items: [item({ id: "tarihsiz-fikstur", category: "fixture", confidence: "confirmed", text: "Program açıklandı", timestamp: old })]
  }, { now });
  assert.equal(undatedFixture.items.length, 0, "bitiş tarihi olmayan maç programı duyurusu varsayılana tabidir");
}

// ── 7. Geleceğe tarihli kayıt reddedilir ───────────────────────────────────
{
  const future = normalizeTickerItems({
    items: [item({ id: "gelecek", timestamp: "2026-08-15T12:00:00+03:00" })]
  }, { now });
  assert.equal(future.items.length, 0, "gelecek tarihli öğe bandın 'şu an' iddiasını bozar");
}

// ── 8. Sekiz kategori de destekleniyor ─────────────────────────────────────
//
// Kategori listesi bandın kapsamıdır: resmî açıklama, maç sonu, maç programı,
// kadro/sakatlık, teknik direktör ve oyuncu sözü, kulüp gündemi, transfer
// iddiası.
{
  const expected = [
    "official",
    "post-match",
    "fixture",
    "squad-update",
    "manager-quote",
    "player-quote",
    "club-agenda",
    "transfer-rumour"
  ];
  assert.deepEqual(Object.keys(CATEGORIES).sort(), expected.slice().sort(), "sekiz kategori tanımlı olmalı");
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

  // Bu bölüm dosyanın synthetic testlerinde kullanılan sabit `now`'ı KASITLI
  // OLARAK kullanmaz: burada sınanan gerçek, canlı veri dosyasının şu anki
  // duvar saatine göre geçerli olup olmadığı. Sabit tarih kullanılsaydı
  // gündem dosyası ilerledikçe test çürürdü — bkz. test-ticker-feed.mjs
  // içindeki aynı hatanın belgelenmiş düzeltmesi ("Test saati VERİDEN
  // türetilir, sabit yazılmaz").
  const { items, rejected } = normalizeTickerItems(payload, { now: new Date() });
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

// ── 11. Çekince YALNIZCA rozette kalamaz ───────────────────────────────────
//
// Rozet on piksellik bir etiket, cümle ise bandın taşıdığı asıl bilgi.
// "X, Beşiktaş'a geliyor" cümlesi yanında "SÖYLENTİ" yazsa bile okuyucunun
// aklında haber olarak kalır.
{
  const bare = validateTickerItem(item({
    category: "transfer-rumour",
    confidence: "rumour",
    text: "Oyuncu Beşiktaş'a geliyor"
  }));
  assert.equal(bare.valid, false, "çekincesiz kesinleşmemiş metin geçersiz olmalı");
  assert.ok(
    bare.errors.some((error) => /çekince ifadesi yok/.test(error)),
    "gerekçe çekince eksikliğini söylemeli"
  );

  for (const phrase of ["iddia edildi", "öne sürüldü", "aktarıldı", "görüşmeler sürüyor"]) {
    const hedged = validateTickerItem(item({
      category: "transfer-rumour",
      confidence: "rumour",
      text: `Oyuncunun Beşiktaş'a geleceği ${phrase}`
    }));
    assert.equal(hedged.valid, true, `"${phrase}" çekincesi kabul edilmeli`);
  }

  // Doğrulanmış öğede çekince ARANMAZ; orada gösterilecek bir çekince yok.
  assert.equal(
    validateTickerItem(item({ text: "Kulüp transferi resmen açıkladı" })).valid,
    true,
    "doğrulanmış öğede çekince zorunlu olmamalı"
  );
}

// ── 12. Son dakika penceresi kendiliğinden sönümlenir ──────────────────────
{
  const fresh = shelfLifeVerdict(
    item({ breaking: true, timestamp: "2026-08-01T06:00:00+03:00" }),
    now
  );
  assert.equal(fresh.breaking, true, "6 saatlik son dakika hâlâ son dakika olmalı");

  // Kurgu 72 saatlik raf ömrünün İÇİNDE ama 24 saatlik son dakika
  // penceresinin dışında: sınanan şey raf ömrü değil, rozetin sönmesi.
  const old = shelfLifeVerdict(
    item({ breaking: true, timestamp: "2026-07-30T12:00:00+03:00" }),
    now
  );
  assert.equal(old.drop, null, "penceresi dolan öğe banttan DÜŞMEZ, yalnızca rütbe iner");
  assert.equal(old.breaking, false, `${BREAKING_WINDOW_HOURS} saat sonra son dakika iddiası sürdürülemez`);

  const developing = shelfLifeVerdict(
    item({ breaking: true, developing: true, timestamp: "2026-07-30T12:00:00+03:00" }),
    now
  );
  assert.equal(developing.breaking, true, "gelişme sürüyorsa pencere uzar");

  // `developing`, `breaking` olmadan anlamsız — sessizce yok sayılmaz.
  assert.equal(
    validateTickerItem(item({ developing: true })).valid,
    false,
    "breaking olmadan developing kullanılamaz"
  );
}

// ── 13. expiresAt: tarihi geçen duyuru bantta kalamaz ──────────────────────
//
// "5 Ağustos'ta oynanacak" duyurusu 6 Ağustos'ta yanlıştır; raf ömrü değil,
// TARİH bitirir. Kalıcı duyuruların süresiz asılı kalmasını bu alan engeller.
{
  const live = normalizeTickerItems({
    items: [item({ id: "yaklasan", category: "fixture", expiresAt: "2026-08-05T23:59:59+03:00" })]
  }, { now });
  assert.equal(live.items.length, 1, "tarihi gelmemiş duyuru bantta kalmalı");

  const expired = normalizeTickerItems({
    items: [item({ id: "gecmis", category: "fixture", expiresAt: "2026-07-30T23:59:59+03:00" })]
  }, { now });
  assert.equal(expired.items.length, 0, "tarihi geçen duyuru banttan düşmeli");
  assert.ok(
    expired.rejected[0].errors.some((error) => /geçerlilik tarihi doldu/.test(error)),
    "düşme gerekçesi tarih olmalı"
  );

  assert.equal(
    validateTickerItem(item({ expiresAt: "yakında" })).valid,
    false,
    "okunamayan expiresAt reddedilmeli"
  );
}

// ── 14. updatedAt tutarlı olmak zorunda ────────────────────────────────────
{
  assert.equal(
    validateTickerItem(item({ timestamp: "2026-07-30T12:00:00+03:00", updatedAt: "2026-07-30T18:00:00+03:00" })).valid,
    true,
    "yayımdan sonraki güncelleme geçerli"
  );
  assert.equal(
    validateTickerItem(item({ timestamp: "2026-07-30T12:00:00+03:00", updatedAt: "2026-07-29T18:00:00+03:00" })).valid,
    false,
    "yayımdan önceye tarihlenmiş güncelleme kaydın bozuk olduğunu gösterir"
  );

  const { items } = normalizeTickerItems({
    items: [item({ timestamp: "2026-07-30T12:00:00+03:00", updatedAt: "2026-07-30T18:00:00+03:00" })]
  }, { now });
  assert.equal(items[0].updatedAt, "2026-07-30T18:00:00+03:00", "son güncelleme banda taşınmalı");
}

// ── 15. Gündem sırası editoryal ────────────────────────────────────────────
//
// "En yeni en üstte" değil: dört büyükler, sonra Avrupa'daki Türk kulüpleri,
// sonra Süper Lig, sonra büyük Avrupa kulüpleri.
{
  assert.equal(editorialRank({ team: "Galatasaray" }), EDITORIAL_RANKS.BIG_FOUR);
  assert.equal(
    editorialRank({ team: "Samsunspor", competition: "UEFA Konferans Ligi" }),
    EDITORIAL_RANKS.TURKISH_IN_EUROPE
  );
  assert.equal(editorialRank({ team: "Samsunspor" }), EDITORIAL_RANKS.TURKISH_LEAGUE);
  assert.equal(editorialRank({ competition: "Trendyol Süper Lig" }), EDITORIAL_RANKS.TURKISH_LEAGUE);
  assert.equal(editorialRank({ team: "Real Madrid" }), EDITORIAL_RANKS.MAJOR_EUROPEAN);
  assert.equal(editorialRank({ team: "Rudeš" }), EDITORIAL_RANKS.OTHER);

  // Dört büyükler, rakibi kim olursa olsun öne geçer.
  assert.equal(
    editorialRank({ teams: ["Górnik Zabrze", "Fenerbahçe"] }),
    EDITORIAL_RANKS.BIG_FOUR,
    "eşleşmedeki dört büyükler takımı sırayı belirlemeli"
  );

  // Ve bu sıra bandın kendisine yansımalı: taze bir Real Madrid haberi,
  // ondan eski bir Beşiktaş haberinin önüne geçemez.
  const { items } = normalizeTickerItems({
    items: [
      item({ id: "avrupa", team: "Real Madrid", text: "Real Madrid açıklaması", timestamp: "2026-07-31T10:00:00+03:00" }),
      item({ id: "besiktas", team: "Beşiktaş", text: "Beşiktaş açıklaması", timestamp: "2026-07-30T10:00:00+03:00" })
    ]
  }, { now });
  assert.deepEqual(
    items.map((entry) => entry.id),
    ["besiktas", "avrupa"],
    "dört büyükler haberi daha taze Avrupa haberinin önünde olmalı"
  );
}

// ── 16. Aynı haberin iki yazımı tekleşir ───────────────────────────────────
//
// Kelimesi kelimesine karşılaştırma yetmiyor: çıplak skor satırı ile
// editoryal başlık aynı olayı anlatıyor ama tek bir kelimeyi bile aynı
// çekimle paylaşmayabiliyor.
{
  const { items, dropped } = dedupeByMeaning([
    { id: "skor", text: "Inter Turku 2-0 Başakşehir", priority: 1 },
    { id: "baslik", text: "Başakşehir, Konferans Ligi'nde Inter Turku'ya elenerek veda etti", category: "post-match", priority: 3 }
  ]);

  assert.equal(items.length, 1, "aynı olayın iki yazımı tek öğeye inmeli");
  assert.equal(items[0].id, "baslik", "anlamı taşıyan başlık, çıplak skora tercih edilmeli");
  assert.equal(items[0].priority, 1, "haberin yeri en güçlü sürümünün önceliğinden gelmeli");
  assert.equal(dropped.length, 1, "elenen sürüm gerekçesiyle raporlanmalı");

  // Farklı haberler birleşmemeli — yanlış pozitif gerçek bir haberi yutar.
  const distinct = dedupeByMeaning([
    { id: "a", text: "Galatasaray, Jamal Musiala iddialarını yalanladı", category: "official", priority: 0 },
    { id: "b", text: "Trendyol Süper Lig 14 Ağustos'ta başlıyor", category: "fixture", priority: 2 }
  ]);
  assert.equal(distinct.items.length, 2, "ilgisiz iki haber tekleştirilmemeli");

  // Daha güvenilir sürüm kazanır: resmî açıklama, iddia sürümünü eler.
  const byConfidence = dedupeByMeaning([
    { id: "iddia", text: "Galatasaray, Jamal Musiala iddialarını yalanladığı öne sürüldü", confidence: "rumour", category: "transfer-rumour", priority: 6 },
    { id: "resmi", text: "Galatasaray, Jamal Musiala iddialarını resmen yalanladı", confidence: "confirmed", category: "official", priority: 0 }
  ]);
  assert.equal(byConfidence.items[0].id, "resmi", "doğrulanmış sürüm iddia sürümünü elemeli");
}

console.log("Küratörlü ticker testleri geçti (eksik güven reddi, kategori çelişkisi, rozet-cümle çelişkisi, çekince zorunluluğu, kaynak zorunluluğu, raf ömrü, son dakika penceresi, expiresAt, editoryal sıra, tekleştirme, şablon rozeti).");
