#!/usr/bin/env node
/**
 * HABER YAŞAM DÖNGÜSÜ — SÖZLEŞME DENETİMİ.
 *
 * Bir olay ilerledikçe başlığı yeniden yazılıyor:
 *   09:00 "… ile görüşüyor" → 12:00 "… görüşmelere başladı"
 *   → 17:00 "… resmen açıklandı"
 *
 * Üçü ayrı kimlik taşıdığı için depoda YAN YANA duruyordu. Okuyucu bandı
 * kaydırdıkça aynı transferi üç kez görüyordu ve 18 yuvalık bant tek
 * hikâyeye üç yuva harcıyordu. Denetimin sorduğu şey: aynı hikâye tek
 * kayıtta mı ve KALAN sürüm en güçlüsü mü.
 */
import assert from "node:assert/strict";

const news = await import("./sync-football-news.mjs");

console.log("news-lifecycle");

const make = (text, status, timestamp, extra = {}) => ({
  id: `id-${text.slice(0, 12)}-${timestamp}`,
  team: extra.team || "Fenerbahçe",
  category: extra.category || "transfer-rumour",
  text,
  timestamp,
  source: { name: "kaynak", url: `https://example.test/${encodeURIComponent(text)}` },
  automation: { source: "rss", feed: extra.feed || "besleme", priority: 5, status }
});

// ── 1. ÜÇ AŞAMA TEK HİKÂYE, EN GÜÇLÜ SÜRÜM KALIR ─────────────────────────
{
  const incoming = [
    make("Fenerbahçe Romelu Lukaku ile görüşüyor", "DEVELOPING", "2026-08-15T09:00:00.000Z"),
    make("Fenerbahçe Romelu Lukaku görüşmelere başladı", "DEVELOPING", "2026-08-15T12:00:00.000Z"),
    make("Fenerbahçe Romelu Lukaku transferini resmen açıkladı", "OFFICIAL", "2026-08-15T17:00:00.000Z")
  ];
  const merged = news.mergeNewsItems({ items: [] }, incoming, { nowMs: Date.parse("2026-08-15T18:00:00.000Z") });

  assert.equal(merged.items.length, 1, "üç aşama tek hikâyeye inmeli");
  const story = merged.items[0];
  assert.equal(story.automation.status, "OFFICIAL", "kalan sürüm en güçlüsü olmalı");
  assert.equal(story.automation.mergedReports, 3, "birleşen rapor sayısı kayıtta durmalı");
  assert.equal(story.automation.firstSeenAt, "2026-08-15T09:00:00.000Z",
    "hikâyenin ilk görülme anı korunmalı");
  console.log("  ok  3 aşama → 1 hikâye, OFFICIAL kaldı, ilk görülme korundu");
}

// ── 2. FARKLI KULÜBÜN HABERİ BİRLEŞMEZ ───────────────────────────────────
//
// Benzer cümle kurulumu iki kulüpte de olabiliyor ("… duyuru yaptı").
// Takım ayrımı olmasaydı iki ayrı kulübün haberi tek kayda düşerdi.
{
  const incoming = [
    make("Fenerbahçe Victor Osimhen ile görüşüyor", "DEVELOPING", "2026-08-15T09:00:00.000Z"),
    make("Galatasaray Victor Osimhen ile görüşüyor", "DEVELOPING", "2026-08-15T09:05:00.000Z", { team: "Galatasaray" })
  ];
  const merged = news.mergeNewsItems({ items: [] }, incoming, { nowMs: Date.parse("2026-08-15T10:00:00.000Z") });
  assert.equal(merged.items.length, 2, "farklı kulüplerin haberi ayrı kalmalı");
  console.log("  ok  farklı kulüp = farklı hikâye");
}

// ── 3. AYNI KULÜP, FARKLI KİŞİ: AYRI HİKÂYE ──────────────────────────────
{
  const incoming = [
    make("Fenerbahçe Romelu Lukaku transferini açıkladı", "CONFIRMED", "2026-08-15T09:00:00.000Z"),
    make("Fenerbahçe Nathan Ake transferini açıkladı", "CONFIRMED", "2026-08-15T09:05:00.000Z")
  ];
  const merged = news.mergeNewsItems({ items: [] }, incoming, { nowMs: Date.parse("2026-08-15T10:00:00.000Z") });
  assert.equal(merged.items.length, 2, "aynı kulübün iki ayrı transferi ayrı kalmalı");
  console.log("  ok  aynı kulüp farklı oyuncu = farklı hikâye");
}

// ── 4. ÇÖP BAŞLIK BANDA GİRMEZ ───────────────────────────────────────────
//
// Yayıncı beslemelerinde içi boş bölüm etiketleri geliyor; canlı koşuda
// banda ham "FUTBOL" metni düştüğü görüldü.
{
  for (const junk of ["FUTBOL", "SPOR", "Kısa", "SON DAKİKA"]) {
    assert.equal(news.hasUsableTitle(junk), false, `çöp başlık elenmeli: ${junk}`);
  }
  for (const good of [
    "Galatasaray'da Osimhen'den transfer açıklaması",
    "Fenerbahçe Romelu Lukaku transferini resmen açıkladı"
  ]) {
    assert.equal(news.hasUsableTitle(good), true, `gerçek başlık geçmeli: ${good}`);
  }
  console.log("  ok  çöp başlık süzgeci");
}

// ── 5. YAŞAM DÖNGÜSÜ DURUMU DİLDEN OKUNUR ────────────────────────────────
{
  assert.equal(news.lifecycleStatus({ text: "Kulüp transferi resmen açıkladı" }, true), "OFFICIAL",
    "resmî kaynak her zaman OFFICIAL");
  assert.equal(news.lifecycleStatus({ text: "Transfer resmen açıklandı" }, false), "CONFIRMED");
  assert.equal(news.lifecycleStatus({ text: "Transfer iddiası gündemde" }, false), "RUMOUR");
  assert.equal(news.lifecycleStatus({ text: "Kulüp oyuncuyla görüşüyor" }, false), "DEVELOPING");
  assert.equal(news.lifecycleStatus({ text: "Oyuncu antrenmana çıktı" }, false), "REPORTED");
  console.log("  ok  RUMOUR / DEVELOPING / CONFIRMED / OFFICIAL ayrımı");
}

// ── 6. GENEL BESLEMEDE TAKIM ŞARTI ───────────────────────────────────────
//
// Yayıncı beslemeleri tüm spor dallarını taşıyor; Türk futboluyla ilgisi
// kurulamayan bir başlık banda hiç girmemeli.
{
  assert.equal(news.teamFromTitle("VAR, timewasting and subs - new rules"), null,
    "Türk futbolu geçmeyen başlık takıma bağlanmamalı");
  assert.equal(news.teamFromTitle("Trabzonspor'da kritik sakatlık"), "Trabzonspor");
  assert.equal(news.teamFromTitle("TFF yeni kararını duyurdu"), "TFF");
  console.log("  ok  takım çıkarımı fikstür listesinden");
}

console.log("news-lifecycle OK (6 bölüm)");
