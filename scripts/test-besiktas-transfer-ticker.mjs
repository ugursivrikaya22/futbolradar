#!/usr/bin/env node
/**
 * BEŞİKTAŞ TRANSFER GÜNDEMİ — SÖZLEŞME DENETİMİ.
 *
 * Bandın taşıdığı risk dar kapsamından geliyor: "Beşiktaş Transfer Gündemi"
 * başlığı altındaki her satır okuyucuya Beşiktaş'a dair bir gelişme olarak
 * okunur. Bu yüzden testler tek bir soruyu farklı açılardan soruyor:
 *
 *     BANDA GİRMEMESİ GEREKEN BİR ŞEY GİREBİLİR Mİ?
 *
 * Sınanan eleme yolları: kulüple ilgisiz kayıt, kaynaksız kayıt, hak
 * edilmemiş "resmî" rozeti, kesinleşmemiş başlıkta kesinlik fiili, süresi
 * dolmuş kayıt, genel bantla yinelenen başlık ve — en sinsisi — geçen
 * sezonun transferinin bu haftanın gündemi gibi görünmesi.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
  besiktasTickerBlock,
  besiktasTickerItem,
  besiktasTickerTrack,
  BESIKTAS_TICKER_PAGES,
  BESIKTAS_TICKER_MESSAGE_PAGES,
  BESIKTAS_TICKER_STRINGS
} from "./lib/besiktasTransferTicker.mjs";

const require = createRequire(import.meta.url);
const {
  BAND_LABEL,
  STATUS_KEYS,
  resolveStatus,
  selectBesiktasTransferItems,
  validateItem
} = require("../services/besiktasTransferTicker.js");

const root = process.cwd();
const NOW = Date.parse("2026-08-13T18:00:00+03:00");
const OFFICIAL_URL = "https://www.bjk.com.tr/tr/haber/1/ornek.html";
const HIGH_URL = "https://www.trtspor.com.tr/haber/futbol/ornek.html";
const LOW_URL = "https://example.com/ornek";

const select = (records, options = {}) =>
  selectBesiktasTransferItems({ transfers: { transfers: records } }, { now: NOW, ...options });

const transfer = (overrides = {}) => ({
  id: "t1",
  playerName: "Test Oyuncu",
  fromTeam: "Arsenal",
  toTeam: "Beşiktaş",
  date: "2026-08-10",
  status: "confirmed",
  sourceName: "Beşiktaş JK",
  sourceUrl: OFFICIAL_URL,
  ...overrides
});

console.log("besiktas-transfer-ticker");

// ── 1. Kapsam: yalnızca Beşiktaş ───────────────────────────────────────────
{
  const { items } = select([
    transfer(),
    transfer({ id: "t2", playerName: "Başka Oyuncu", fromTeam: "Real Madrid", toTeam: "Galatasaray" })
  ]);
  assert.equal(items.length, 1, "Beşiktaş'la ilgisi olmayan transfer banda girmemeli");
  assert.match(items[0].headline, /Beşiktaş/);

  // Gidiş de bir Beşiktaş hareketidir.
  const out = select([transfer({ fromTeam: "Beşiktaş", toTeam: "Çaykur Rizespor" })]);
  assert.equal(out.items.length, 1, "Beşiktaş'tan ayrılış da banda girmeli");
  assert.equal(out.items[0].movement, "gidiş");
}

// ── 2. "Resmî" rozeti KAYNAK ister ─────────────────────────────────────────
//
// Kaydın kendisi "confirmed" dese bile, arkasında kulüp ağzı yoksa rozet
// inmek zorunda. Bu bandın en önemli tek kuralı.
{
  const official = select([transfer({ sourceUrl: OFFICIAL_URL })]);
  assert.equal(official.items[0].status, "official", "kulüp kaynağı resmî rozeti hak eder");

  const media = select([transfer({ sourceUrl: HIGH_URL, sourceName: "TRT Spor" })]);
  assert.equal(media.items[0].status, "strong-rumour",
    "haber kuruluşu 'confirmed' dese de resmî sayılmamalı");

  const unknown = select([transfer({ sourceUrl: LOW_URL, sourceName: "Bilinmeyen" })]);
  assert.equal(unknown.items[0].status, "rumour", "tanınmayan kaynak iddia kademesinde kalmalı");

  // İNDİRME KAYNAĞIN BULUNDUĞU YERE DÜŞER, SABİT BİR KADEMEYE DEĞİL.
  //
  // Hak edilmemiş bir "resmî" iddiasını her koşulda "güçlü iddia"ya
  // indirmek, tanınmayan bir sitenin iddiasını saygın basının kademesine
  // TERFİ ETTİRİRDİ — indirme görünümünde bir yükseltme.
  assert.equal(resolveStatus({ status: "official", sourceUrl: OFFICIAL_URL }), "official");
  assert.equal(resolveStatus({ status: "official", sourceUrl: HIGH_URL }), "strong-rumour");
  assert.equal(resolveStatus({ status: "official", sourceUrl: LOW_URL }), "rumour");

  // Beyan tavandan düşükse beyana uyulur: yükseltme yok.
  assert.equal(resolveStatus({ status: "rumour", sourceUrl: OFFICIAL_URL }), "rumour",
    "editörün geri çektiği kayıt kaynak resmî diye terfi etmemeli");
}

// ── 3. Kaynaksız kayıt banda girmez ────────────────────────────────────────
{
  const { items } = select([transfer({ sourceName: "", sourceUrl: "" })]);
  assert.equal(items.length, 0, "kaynağı gösterilemeyen kayıt yayımlanamaz");
}

// ── 4. Eksik taraf banda girmez ────────────────────────────────────────────
{
  assert.equal(select([transfer({ fromTeam: "" })]).items.length, 0, "eski kulüp eksikse elenmeli");
  assert.equal(select([transfer({ playerName: "" })]).items.length, 0, "oyuncu adı eksikse elenmeli");
}

// ── 5. Kesinleşmemiş başlıkta kesinlik fiili olamaz ────────────────────────
{
  const verdict = validateItem({
    headline: "Test Oyuncu resmen imzaladı",
    sourceName: "Bir Gazete",
    status: "rumour",
    publishedAt: "2026-08-10T00:00:00+03:00"
  });
  assert.equal(verdict.valid, false, "iddia rozetli öğe 'imzaladı' diyemez");
  assert.ok(verdict.errors.some((error) => /kesinlik/.test(error)));

  // Aynı cümle resmî kaynakla sorun değil.
  assert.equal(validateItem({
    headline: "Test Oyuncu resmen imzaladı",
    sourceName: "Beşiktaş JK",
    status: "official",
    publishedAt: "2026-08-10T00:00:00+03:00"
  }).valid, true);
}

// ── 6. RAF ÖMRÜ: geçen sezonun transferi bu haftanın gündemi değildir ──────
//
// Bu testin gerçek bir karşılığı var: `lastVerifiedAt` alanı eski kayıtlar
// yeniden doğrulandığında tazeleniyor. Tarih olarak onu kullanmak,
// 2025-07-31 tarihli bir ayrılığı banda "25 Tem 2026" diye sokuyordu.
// Sıralama ve raf ömrü hareketin KENDİ tarihine bakmak zorunda.
{
  const stale = select([transfer({
    id: "gecen-sezon",
    date: "2025-07-31",
    lastVerifiedAt: "2026-07-25T12:00:00+03:00"
  })]);
  assert.equal(stale.items.length, 0, "geçen sezonun transferi banda girmemeli");
  assert.match(stale.rejected[0].errors[0], /raf ömrü/);

  // İddialar daha hızlı düşer: 10 günlük bir iddia gündem değildir.
  const oldRumour = select([transfer({
    date: "2026-08-01", sourceUrl: LOW_URL, sourceName: "Bilinmeyen"
  })]);
  assert.equal(oldRumour.items.length, 0, "7 günden eski iddia düşmeli");

  // Aynı yaştaki resmî kayıt KALIR — gerçekleşmiş transfer eskiyince
  // yanlış olmaz, yalnızca "son dakika" olmaktan çıkar.
  const oldOfficial = select([transfer({ date: "2026-08-01" })]);
  assert.equal(oldOfficial.items.length, 1);
  assert.equal(oldOfficial.items[0].isBreaking, false, "12 günlük kayıt 'son dakika' olamaz");

  const fresh = select([transfer({ date: "2026-08-12" })]);
  assert.equal(fresh.items[0].isBreaking, true, "72 saat içindeki kayıt son dakikadır");
}

// ── 7. SIRALAMA: önce resmî, sonra güvenilir basın, sonra iddia ────────────
{
  const { items } = select([
    transfer({ id: "r", playerName: "Cc Iddia", date: "2026-08-12", sourceUrl: LOW_URL, sourceName: "Bilinmeyen" }),
    transfer({ id: "s", playerName: "Bb Basin", date: "2026-08-12", sourceUrl: HIGH_URL, sourceName: "TRT Spor" }),
    transfer({ id: "o", playerName: "Aa Resmi", date: "2026-08-09", sourceUrl: OFFICIAL_URL })
  ]);
  assert.deepEqual(items.map((item) => item.status), ["official", "strong-rumour", "rumour"],
    "resmî kayıt daha eski olsa bile önce gelmeli");
}

// ── 8. Yinelenen metin: genel bantta olan başlık burada tekrarlanmaz ───────
{
  const record = transfer({ playerName: "Yineleme Testi" });
  const withoutExclude = select([record]);
  assert.equal(withoutExclude.items.length, 1);

  const excluded = select([record], { exclude: [withoutExclude.items[0].headline] });
  assert.equal(excluded.items.length, 0, "genel bantta görünen başlık ikinci kez basılmamalı");
}

// ── 9. Aynı başlık iki kez girmez ──────────────────────────────────────────
{
  const { items } = select([transfer({ id: "a" }), transfer({ id: "b" })]);
  assert.equal(items.length, 1, "aynı başlık bantta yinelenmemeli");
}

// ── 10. Küratörlü dosyanın ÖRNEK kayıtları yayına çıkmaz ───────────────────
//
// Yer tutucu bir kaydın yanlışlıkla yayımlanması, bandın bütün güvenilirlik
// iddiasını bitirir. Örnekler `_sample` anahtarında ve servis o anahtarı
// hiç okumuyor; test bunu dosyanın GERÇEK hâli üzerinden doğruluyor.
{
  const curated = JSON.parse(fs.readFileSync(path.join(root, "data", "besiktas-transfer-ticker.json"), "utf8"));
  assert.ok(curated._sample, "örnek kayıtlar _sample altında durmalı");
  assert.ok(Array.isArray(curated.items), "items dizi olmalı");

  const { items } = selectBesiktasTransferItems({ curated }, { now: NOW });
  const leaked = items.filter((item) => /ÖRNEK/i.test(item.headline) || /example\.com/i.test(item.url || ""));
  assert.deepEqual(leaked, [], "örnek kayıt banda sızmamalı");
}

// ── 11. İşaretleme: bağlantısız öğe <a> olmaz ──────────────────────────────
{
  const [item] = select([transfer()]).items;

  const linked = besiktasTickerItem(item);
  assert.match(linked, /^<a /, "kaynağı olan öğe bağlantı olmalı");
  assert.match(linked, /rel="nofollow noopener noreferrer"/, "dış kaynak künyesi nofollow olmalı");
  assert.match(linked, /target="_blank"/);

  const unlinked = besiktasTickerItem({ ...item, url: "" });
  assert.match(unlinked, /^<span /, "bağlantısı olmayan öğe <a> olamaz — olmayan bir söz verilir");
  assert.ok(!unlinked.includes("href="), "bağlantısız öğede href olmamalı");

  // Durum rozeti metinden değil alandan geliyor.
  assert.match(linked, /besiktas-ticker__status is-official/);
  assert.match(linked, /Resmî/);
}

// ── 12. Boş durum: uydurma yer tutucu YOK ──────────────────────────────────
{
  assert.equal(besiktasTickerBlock([]), "", "öğe yoksa bant hiç çizilmemeli");

  const kept = besiktasTickerBlock([], { keepEmpty: true });
  assert.ok(kept.includes(BESIKTAS_TICKER_STRINGS.empty), "mesaj sayfasında durum bildirimi olmalı");
  assert.ok(kept.includes("is-static"), "boş şerit kaymamalı");
  // Boş bant hiçbir sahte öğe taşımaz.
  assert.ok(!kept.includes("besiktas-ticker__item"), "boş bantta öğe olmamalı");

  const track = besiktasTickerTrack([]);
  assert.ok(!/besiktas-ticker__status/.test(track), "boş şeritte durum rozeti olmamalı");
}

// ── 13. Erişilebilirlik: kopya grup ekran okuyucudan ve klavyeden gizli ────
{
  const block = besiktasTickerBlock(select([transfer()]).items);
  assert.match(block, /role="region"/);
  assert.match(block, /aria-label="[^"]+"/);
  assert.match(block, /<div class="besiktas-ticker__group" aria-hidden="true">/,
    "ikinci grup ekran okuyucudan gizli olmalı");
  assert.match(block, /tabindex="-1"/, "kopya öğeler klavye sırasında olmamalı");
  assert.ok(block.includes(BAND_LABEL), "bant kendi başlığını taşımalı");
}

// ── 14. Kaçış: veri işaretlemeyi kıramaz ───────────────────────────────────
{
  const { items } = select([transfer({ playerName: '<img src=x onerror="alert(1)">' })]);
  const html = besiktasTickerItem(items[0]);
  assert.ok(!html.includes("<img"), "veri ham HTML olarak basılmamalı");
  assert.ok(html.includes("&lt;img"), "veri kaçırılmış olmalı");
}

// ── 15. Sayfa listeleri tutarlı ────────────────────────────────────────────
{
  assert.ok(BESIKTAS_TICKER_PAGES.length > 0);
  assert.equal(new Set(BESIKTAS_TICKER_PAGES).size, BESIKTAS_TICKER_PAGES.length, "sayfa listesinde kopya var");

  // Mesaj sayfaları bant sayfalarının ALT KÜMESİ olmalı; olmayan bir sayfaya
  // boş bant mesajı tanımlamak sessizce etkisiz kalırdı.
  for (const page of BESIKTAS_TICKER_MESSAGE_PAGES) {
    assert.ok(BESIKTAS_TICKER_PAGES.includes(page), `${page}: mesaj sayfası bant listesinde değil`);
  }

  // Liste yalnızca Türkçe sayfalar: bant çevrilmemiş Türkçe metin taşıyor.
  for (const page of BESIKTAS_TICKER_PAGES) {
    assert.ok(!page.startsWith("en/"), `${page}: Türkçe bant İngilizce sayfaya girmemeli`);
    assert.ok(fs.existsSync(path.join(root, page)), `${page}: sayfa depoda yok`);
  }
}

// ── 16. Durum anahtarları sözleşmesi ───────────────────────────────────────
{
  assert.deepEqual(STATUS_KEYS, ["official", "strong-rumour", "rumour"],
    "durum kademeleri gereksinimdeki üçlüyle birebir olmalı");
}

console.log(`besiktas-transfer-ticker OK (${16} bölüm)`);
