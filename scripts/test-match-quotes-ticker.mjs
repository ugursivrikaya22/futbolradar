/**
 * MAÇ SONU AÇIKLAMALARI ŞERİDİ VE ROL TESTLERİ
 *
 * Alıntı kuralı services/managerQuotes.js'te ve zaten test-post-match-core
 * tarafından sınanıyor (kaynak zorunlu, zaman damgası zorunlu, uydurma yok).
 * Bu dosya iki YENİ sözleşmeyi kapsıyor:
 *
 *   1. ROL bir bilgi, dekorasyon değil. Aynı cümle teknik direktörden gelince
 *      kadro/plan beyanı, futbolcudan gelince kişisel değerlendirme olur.
 *      Tanınmayan rol YUVARLANMAZ — kayıt reddedilir.
 *   2. Şerit, doğrulanmış alıntı yokken GİZLENMEZ: "Kaynaklardan bekleniyor"
 *      yazar. Sessiz boşluk okuyucuya "kimse konuşmadı" diye okunurdu.
 *   3. Şerit alıntıyı kısaltıyor; TAM metin maç raporu sayfasında duruyor.
 *      Yalnızca kısaltılmış hâl yayımlansaydı, cümlenin tamamı sitenin
 *      hiçbir yerinde bulunamazdı.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import {
  QUOTES_AWAITING_LABEL,
  matchQuotesTickerBlock,
  quoteAttribution,
  shortenQuote
} from "./lib/matchQuotesTicker.mjs";

const require = createRequire(import.meta.url);
const {
  ROLE_LABELS,
  latestQuotes,
  quotesForMatch,
  resolveRole,
  validateQuote
} = require("../services/managerQuotes.js");

const VALID = {
  matchId: "test-mac",
  speaker: "Test Kişi",
  team: "Test Takım",
  quote: "Maçın tamamında istediğimiz tempoyu bulamadık.",
  at: "2026-08-23T23:45:00+03:00",
  source: { name: "Test Kaynak", url: "https://example.com/haber" }
};

// --- 1. Rol çözümleme ---
{
  for (const [input, expected] of [
    ["manager", "manager"],
    ["coach", "manager"],
    ["Teknik Direktör", "manager"],
    ["player", "player"],
    ["futbolcu", "player"],
    ["oyuncu", "player"]
  ]) {
    assert.deepEqual(resolveRole(input), { role: expected }, `"${input}" -> ${expected} çözümlenmeli`);
  }

  // Boş rol geriye dönük uyumluluk için teknik direktöre düşer.
  for (const empty of ["", null, undefined, "   "]) {
    assert.deepEqual(resolveRole(empty), { role: "manager" }, "boş rol varsayılana düşmeli");
  }

  // Tanınmayan rol YUVARLANMAZ.
  for (const unknown of ["başkan", "yetkili", "menajer", "sportif direktör"]) {
    const verdict = resolveRole(unknown);
    assert.ok(verdict.error, `"${unknown}" tanınmayan rol olarak işaretlenmeli`);
    assert.ok(!verdict.role, `"${unknown}" bir role yuvarlanmamalı`);
  }
}

// --- 2. Tanınmayan rollü kayıt yayımlanmaz ---
{
  assert.equal(validateQuote({ ...VALID, role: "başkan" }).valid, false, "tanınmayan rollü kayıt geçersiz olmalı");
  assert.equal(validateQuote({ ...VALID, role: "futbolcu" }).valid, true, "futbolcu rolü geçerli olmalı");
  assert.equal(validateQuote(VALID).valid, true, "rolsüz kayıt hâlâ geçerli olmalı (geriye dönük uyumluluk)");

  const verdict = quotesForMatch("test-mac", { quotes: [{ ...VALID, role: "başkan" }] });
  assert.equal(verdict.status, "unavailable", "tanınmayan rollü tek kayıt bölümü boş bırakmalı");
  assert.ok(verdict.reason, "gerekçe yazılmalı");
}

// --- 3. Rol okunur etiketiyle taşınır ---
{
  const verdict = quotesForMatch("test-mac", {
    quotes: [{ ...VALID, role: "futbolcu" }, { ...VALID, quote: "Başka bir cümle.", role: "manager" }]
  });

  assert.equal(verdict.status, "ready");
  assert.equal(verdict.quotes[0].role, "player", "makine anahtarı taşınmalı");
  assert.equal(verdict.quotes[0].roleLabel, ROLE_LABELS.player, "okunur etiket taşınmalı");
  assert.equal(verdict.quotes[1].roleLabel, ROLE_LABELS.manager);

  assert.equal(
    quoteAttribution(verdict.quotes[0]),
    `${VALID.speaker} · ${ROLE_LABELS.player} · ${VALID.team}`,
    "atıf satırı kişi · rol · takım olmalı"
  );
}

// --- 4. En yeni açıklamalar: kapsam ve sıra ---
{
  const store = {
    quotes: [
      { ...VALID, matchId: "eski", quote: "Eski söz.", at: "2026-08-01T20:00:00+03:00" },
      { ...VALID, matchId: "yeni", quote: "Yeni söz.", at: "2026-08-23T23:45:00+03:00" }
    ]
  };

  const all = latestQuotes(store, { limit: 5 });
  assert.equal(all.quotes.length, 2);
  assert.equal(all.quotes[0].quote, "Yeni söz.", "en yeni açıklama başta olmalı");

  // Süzgeç: çağıran hangi maçların bittiğini biliyor.
  const filtered = latestQuotes(store, { limit: 5, matchIds: ["yeni"] });
  assert.equal(filtered.quotes.length, 1, "yalnızca izin verilen maçın alıntısı gelmeli");
  assert.equal(filtered.quotes[0].matchId, "yeni");

  const none = latestQuotes(store, { matchIds: ["hiç-oynanmadı"] });
  assert.equal(none.status, "unavailable", "kapsam dışıysa bölüm beklemede olmalı");

  assert.equal(latestQuotes({ quotes: [] }).status, "unavailable", "boş depo beklemede olmalı");
}

// --- 5. Şerit boşken GİZLENMEZ ---
{
  const empty = matchQuotesTickerBlock({ status: "unavailable", quotes: [] });
  assert.ok(empty.includes("match-quotes-ticker"), "şerit boşken de basılmalı");
  assert.ok(empty.includes(QUOTES_AWAITING_LABEL), `boş şerit "${QUOTES_AWAITING_LABEL}" yazmalı`);
  assert.ok(empty.includes('data-empty="true"'), "boş hâl işaretlenmeli (animasyon çalışmasın)");
}

// --- 6. Dolu şerit: rol ve kaynak görünür ---
{
  const verdict = quotesForMatch("test-mac", { quotes: [{ ...VALID, role: "futbolcu" }] });
  const html = matchQuotesTickerBlock(verdict, { href: (q) => `./mac-raporu/${q.matchId}.html` });

  assert.ok(html.includes(ROLE_LABELS.player), "şerit rolü göstermeli");
  assert.ok(html.includes(VALID.team), "şerit takımı göstermeli");
  assert.ok(!html.includes(QUOTES_AWAITING_LABEL), "dolu şeritte bekleme metni olmamalı");

  // Şerit iki kez basılır: animasyon kesintisiz dönsün diye.
  assert.equal((html.match(/match-quotes__group/g) || []).length, 2, "şerit iki kez basılmalı");
  assert.ok(html.includes('aria-hidden="true"'), "kopya grup ekran okuyucudan gizlenmeli");
}

// --- 6b. Tam liste: şerit kısaltır, maç raporu TAM metni verir ---
{
  // Tam listeyi çekirdek raporun `manager-comment` bölümü çiziyor. Şerit
  // kısaltılmış alıntı gösterdiği için tam metnin BİR YERDE durması şart:
  // yoksa okuyucu cümlenin tamamını hiçbir yerde bulamaz.
  const store = JSON.parse(fs.readFileSync("data/manager-quotes.json", "utf8"));
  const quotes = (store.quotes || []).filter(Boolean);
  const byMatch = new Map();
  for (const quote of quotes) {
    if (!byMatch.has(quote.matchId)) byMatch.set(quote.matchId, []);
    byMatch.get(quote.matchId).push(quote);
  }

  let checked = 0;
  for (const [matchId, entries] of byMatch) {
    const page = `mac-raporu/${matchId}.html`;
    if (!fs.existsSync(page)) continue;
    const html = fs.readFileSync(page, "utf8");
    checked += 1;

    for (const quote of entries) {
      assert.ok(
        html.includes(quote.quote),
        `${page}: "${quote.speaker}" alıntısının TAM metni sayfada bulunmalı`
      );
      assert.ok(html.includes(quote.source.url), `${page}: alıntı kaynağına bağlanmalı`);
      const roleLabel = ROLE_LABELS[resolveRole(quote.role).role];
      assert.ok(html.includes(roleLabel), `${page}: "${roleLabel}" rolü yazılmalı`);
    }
  }

  assert.ok(checked, "ön koşul: depodaki alıntıların en az biri üretilmiş bir rapor sayfasına ait olmalı");
}

// --- 7. Şerit alıntıyı kelime ortasından kesmez ---
{
  const long = `${"kelime ".repeat(40)}son`;
  const short = shortenQuote(long);
  assert.ok(short.length <= 125, "şerit alıntısı kısaltılmalı");
  assert.ok(short.endsWith("…"), "kısaltılan alıntı üç nokta ile bitmeli");
  assert.ok(!/\s…$/.test(short), "üç noktadan önce boşluk kalmamalı");

  const stem = short.slice(0, -1);
  assert.ok(long.startsWith(stem), "kırpılan metin orijinalin ön eki olmalı");
  assert.equal(shortenQuote("Kısa söz."), "Kısa söz.", "sığan alıntı kırpılmamalı");
}

// --- 8. Depodaki gerçek veri kurallara uyuyor ---
{
  const store = JSON.parse(fs.readFileSync("data/manager-quotes.json", "utf8"));
  const quotes = Array.isArray(store) ? store : (store.quotes || []);

  for (const entry of quotes) {
    const verdict = validateQuote(entry);
    assert.equal(
      verdict.valid,
      true,
      `data/manager-quotes.json geçersiz kayıt taşıyor (${entry && entry.speaker}): ${verdict.errors.join(", ")}`
    );
    assert.ok(/^https?:\/\//.test(entry.source.url), "kaynak bağlantısı izlenebilir olmalı");
  }
}

// --- 9. Üretilen sayfa asla sessizce boş kalmaz ---
{
  const reportDir = "mac-raporu";
  const files = fs.existsSync(reportDir) ? fs.readdirSync(reportDir).filter((file) => file.endsWith(".html")) : [];
  assert.ok(files.length, "ön koşul: maç raporu sayfaları üretilmiş olmalı");

  // NEDEN "her dosya" değil: mac-raporu/ üretecin ŞU AN bastığı sayfalardan
  // fazlasını taşıyor. Fikstür havuzundan düşen eski maçların HTML'i silinmiyor
  // (bu koşuda 842 dosyanın 477'si yazıldı). Bu bayat dosyalar bu değişiklikten
  // önce de vardı; onları burada şart koşmak, bu testi ilgisiz bir sorunun
  // üzerine kilitlerdi. Sözleşme şu: ŞERİDİ TAŞIYAN her sayfa ya alıntı ya
  // bekleme metni gösterir — sessiz boşluk yok.
  let withTicker = 0;
  let withQuote = 0;
  let withAwaiting = 0;

  for (const file of files) {
    const html = fs.readFileSync(`${reportDir}/${file}`, "utf8");
    if (!html.includes('data-component="MatchQuotesTicker"')) continue;
    withTicker += 1;

    const hasQuote = html.includes("core-quote");
    const hasAwaiting = html.includes(QUOTES_AWAITING_LABEL);
    assert.ok(hasQuote || hasAwaiting, `${file}: ya alıntı ya bekleme metni olmalı, sessiz boşluk olmamalı`);
    if (hasQuote) withQuote += 1;
    if (hasAwaiting) withAwaiting += 1;
  }

  // Taban: şerit bir avuç sayfada değil, rapor yüzeyinin genelinde basılmalı.
  // Üretecin sessizce tek sayfaya düşmesi bu eşikte yakalanır.
  assert.ok(withTicker >= 100, `şerit yalnızca ${withTicker} rapor sayfasında — üretimde bir kopukluk var`);

  // İki hâl de gerçek çıktıda görülmeli: yalnızca "bekleniyor" basan bir
  // sürüm, alıntı yolunun hiç çalışmadığını gizlerdi.
  assert.ok(withQuote >= 1, "en az bir rapor sayfası doğrulanmış alıntı göstermeli");
  assert.ok(withAwaiting >= 1, "en az bir rapor sayfası bekleme metnini göstermeli");

  const home = fs.readFileSync("index.html", "utf8");
  assert.ok(home.includes('data-component="MatchQuotesTicker"'), "ana sayfada şerit bulunmalı");
}

console.log("Match quotes ticker tests passed (rol çözümleme, tanınmayan rol reddi, rol etiketi, en yeni kapsam, boş şerit gizlenmez, tam metin raporda, kelime bütünlüğü, gerçek veri, üretilen sayfa).");
