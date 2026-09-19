#!/usr/bin/env node
/**
 * İNGİLİZCE HABER AKIŞI — SÖZLEŞME DENETİMİ.
 *
 * Bu akışın var olma sebebi tek bir kuraldı: /en sayfalarında Türkçe
 * cümle kalmayacak. Denetim önce bu kuralı, sonra akışın kendi
 * kalitesini (özgünlük, künye, sınıflama, bayatlama) sabitler.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  buildEnglishArticle,
  containsTurkish,
  detectClub,
  detectCompetition,
  detectEventType,
  isPublishableEnglish,
  jaccard,
  rankEnglishNews,
  ENGLISH_FEEDS
} = require("../services/englishNews.js");
const { STATUS } = require("../services/editorialStatus.js");

console.log("english-news");

const NOW = new Date("2026-09-16T12:00:00.000Z");
const make = (title, sourceName, link, publishedAt = "2026-09-16T11:30:00.000Z") =>
  buildEnglishArticle({
    item: { title, sourceName, link, publishedAt },
    feed: { id: "test-feed", competition: "World football" },
    now: NOW
  });

// ── 1. KAYNAK CÜMLESİ KOPYALANMAZ ────────────────────────────────────────
{
  const headline = "Arsenal complete stunning deadline day signing of Real Madrid midfielder";
  const article = make(headline, "BBC Sport", "https://www.bbc.co.uk/sport/football/1");
  assert.notEqual(article.title, headline, "kaynak başlığı olduğu gibi kullanılmamalı");
  for (const paragraph of article.body) {
    assert.ok(
      jaccard(paragraph, headline) < 0.6,
      `gövde cümlesi kaynağa fazla benziyor: ${paragraph}`
    );
  }
  // Kaynak yine de AÇIKÇA belirtilmeli — özgünlük, künyesizlik demek değil.
  assert.ok(article.sources.length > 0, "kaynak künyesi olmalı");
  assert.ok(article.sources[0].url.includes("bbc.co.uk"), "künye özgün adrese gitmeli");
  assert.ok(article.body.join(" ").includes("BBC Sport"), "kaynak gövdede anılmalı");
}

// ── 2. AKIŞA TÜRKÇE CÜMLE GİREMEZ ────────────────────────────────────────
{
  const article = make(
    "Fenerbahce sign a new goalkeeper",
    "Sky Sports",
    "https://www.skysports.com/news/1"
  );
  const composed = [article.title, article.summary, ...article.body].join(" ");
  assert.equal(containsTurkish(composed), false, `üretilen metin Türkçe taşıyor: ${composed}`);
  assert.equal(article.lang, "en", "kayıt İngilizce olarak işaretlenmeli");

  // Özel isim geçebilir; dil yapısı geçemez.
  assert.equal(containsTurkish("Fenerbahçe and Beşiktaş meet on Sunday"), false,
    "kulüp adları Türkçe sızıntı sayılmamalı");
  assert.equal(containsTurkish("Fenerbahçe'de transfer görüşmesi yapıldı"), true,
    "gerçek Türkçe cümle yakalanmalı");
}

// ── 3. TÜRKÇE KAYIT İNGİLİZCE AKIŞTAN ELENİR ─────────────────────────────
{
  const leaked = {
    slug: "sizinti",
    title: "Galatasaray'da transfer gündemi",
    summary: "Sporx'in haberine göre bir açıklama aktarıldı.",
    body: ["Sporx'in haberine göre bir açıklama aktarıldı."],
    sources: [{ name: "Sporx", url: "https://www.sporx.com/1" }]
  };
  assert.equal(isPublishableEnglish(leaked), false,
    "Türkçe kayıt İngilizce akışta yayımlanmamalı");
}

// ── 4. KÜNYESİZ KAYIT YAYIMLANMAZ ────────────────────────────────────────
{
  const orphan = { slug: "x", title: "Arsenal win", summary: "Arsenal win.", body: [], sources: [] };
  assert.equal(isPublishableEnglish(orphan), false, "kaynaksız kayıt yayımlanmamalı");
}

// ── 5. SINIFLAMA: "DRAW" İKİ ANLAMA GELİR ────────────────────────────────
{
  assert.equal(detectEventType("Galatasaray held to a draw in Champions League opener"), "result",
    "beraberlik maç sonucu olmalı");
  assert.equal(detectEventType("The draw for the Europa League group stage takes place Friday"), "competition",
    "kura çekimi takvim haberi olmalı");
}

// ── 6. BAŞLIK TURNUVA SÖYLEMİYORSA KULÜBÜN LİGİNE DÜŞÜLÜR ────────────────
{
  assert.equal(detectClub("Arsenal complete signing"), "Arsenal");
  assert.equal(detectCompetition("Arsenal complete signing", { competition: "World football" }, "Arsenal"),
    "Premier League", "kulüp biliniyorsa ligi de bilinir");
  // Kulüp de bilinmiyorsa genel etiket kalır — uydurma lig atanmaz.
  assert.equal(detectCompetition("Refereeing standards under review", { competition: "World football" }, null),
    "World football");
}

// ── 7. RESMÎ KAYNAK RESMÎ DURUM VERİR ────────────────────────────────────
{
  const official = make("UEFA confirms new Champions League format", "UEFA", "https://www.uefa.com/news/1");
  assert.equal(official.editorialStatus, STATUS.OFFICIAL, "uefa.com resmî sayılmalı");
  assert.ok(official.editorialStatusLabel.en, "İngilizce rozet metni olmalı");
}

// ── 8. BAYAT İÇERİK GERİ PLANA ALINIR, SİLİNMEZ ──────────────────────────
{
  const fresh = make("Chelsea sign defender", "BBC Sport", "https://www.bbc.co.uk/1", "2026-09-16T11:00:00.000Z");
  const stale = make("Everton sign defender", "BBC Sport", "https://www.bbc.co.uk/2", "2026-09-01T11:00:00.000Z");
  const ranked = rankEnglishNews([stale, fresh], { now: NOW });
  assert.equal(ranked[0].slug, fresh.slug, "taze haber üste çıkmalı");
  assert.equal(ranked.length, 2, "bayat haber listeden SİLİNMEMELİ, yalnızca aşağı inmeli");
}

// ── 9. ÖNCELİKLİ TURNUVA ÖNE ÇIKAR ───────────────────────────────────────
{
  const sameMoment = "2026-09-16T11:00:00.000Z";
  const ucl = make("Champions League fixtures confirmed", "UEFA", "https://www.uefa.com/3", sameMoment);
  const minor = make("Refereeing standards under review", "BBC Sport", "https://www.bbc.co.uk/4", sameMoment);
  const ranked = rankEnglishNews([minor, ucl], { now: NOW });
  assert.equal(ranked[0].slug, ucl.slug, "Şampiyonlar Ligi haberi öne çıkmalı");
}

// ── 10. AYNI GİRDİ AYNI SLUG'I ÜRETİR ────────────────────────────────────
{
  const a = make("Napoli appoint new head coach", "ESPN", "https://www.espn.com/1");
  const b = make("Napoli appoint new head coach", "ESPN", "https://www.espn.com/1");
  assert.equal(a.slug, b.slug, "aynı girdi her koşuda aynı adresi üretmeli");
  const other = make("Napoli appoint new head coach", "ESPN", "https://www.espn.com/2");
  assert.notEqual(a.slug, other.slug, "farklı kaynak farklı kayıt olmalı");
}

// ── 11. BESLEMELER İNGİLİZCE VE BENZERSİZ ────────────────────────────────
{
  const ids = ENGLISH_FEEDS.map((feed) => feed.id);
  assert.equal(new Set(ids).size, ids.length, "besleme kimlikleri benzersiz olmalı");
  for (const feed of ENGLISH_FEEDS) {
    assert.ok(/^https:\/\//.test(feed.url), `${feed.id} https olmalı`);
  }
}

console.log("english-news passed");
