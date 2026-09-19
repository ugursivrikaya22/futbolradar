#!/usr/bin/env node
/**
 * HABER DURUMU — SÖZLEŞME DENETİMİ.
 *
 * Okura gösterilen tek etiketin (Resmî / Görüşme / İddia / Haber) hangi
 * kanıta dayandığını sabitler. Denetimin koruduğu asıl kural şu:
 * BAŞLIKTAKİ KELİME KURUMU KONUŞTURMAZ. Bir gazete "Resmen açıkladı!"
 * diye yazabilir; haber ancak kaydın kaynakları arasında kurumun KENDİ
 * alan adı varsa "Resmî" olur.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  STATUS,
  editorialStatusOf,
  isBreaking,
  statusLabel
} = require("../services/editorialStatus.js");

console.log("editorial-status");

const NOW = Date.parse("2026-09-16T12:00:00.000Z");
const at = (iso) => iso;

const make = (title, sourceUrl, publishedAt = "2026-09-16T11:00:00.000Z") => ({
  title,
  publishedAt: at(publishedAt),
  sources: [{ name: "kaynak", url: sourceUrl }]
});

// ── 1. RESMÎ, YALNIZCA KURUMUN KENDİ AĞZIYLA ─────────────────────────────
{
  const official = make(
    "Galatasaray, Victor Osimhen transferini duyurdu",
    "https://www.galatasaray.org/haber/12345"
  );
  assert.equal(editorialStatusOf(official, { now: NOW }).status, STATUS.OFFICIAL,
    "kulübün kendi sitesi resmî sayılmalı");
}

// ── 2. BAŞLIKTAKİ "RESMEN" KURUMU KONUŞTURMAZ ────────────────────────────
{
  const dressedUp = make(
    "Fenerbahçe transferi resmen açıkladı, imza attı!",
    "https://www.example-gazete.com/haber/999"
  );
  const verdict = editorialStatusOf(dressedUp, { now: NOW });
  assert.notEqual(verdict.status, STATUS.OFFICIAL,
    "gazete başlığındaki 'resmen' haberi resmî yapmamalı");
}

// ── 3. ÇEKİNCE DİLİ GÖRÜŞME DİLİNİ YENER ─────────────────────────────────
{
  // "görüşme" kelimesi geçiyor ama cümle bir İDDİA aktarıyor.
  const claimed = make(
    "Beşiktaş'ın bir forvetle görüşme yaptığı iddia edildi",
    "https://www.hurriyet.com.tr/spor/haber"
  );
  assert.equal(editorialStatusOf(claimed, { now: NOW }).status, STATUS.CLAIM,
    "'görüşme iddiası' bir iddiadır, görüşme değil");
}

// ── 4. SÜREÇ DİLİ GÖRÜŞME OLARAK KALIR ───────────────────────────────────
{
  const talks = make(
    "Trabzonspor, orta saha için teklif yaptı",
    "https://www.aa.com.tr/tr/spor/haber"
  );
  assert.equal(editorialStatusOf(talks, { now: NOW }).status, STATUS.NEGOTIATION,
    "teklif/görüşme dili 'Görüşme' olmalı");
}

// ── 5. KAYNAKSIZLIK GÜVENİLİRLİK DEĞİLDİR ────────────────────────────────
{
  const noSource = { title: "Süper Lig'de puan durumu güncellendi", publishedAt: at("2026-09-16T11:00:00.000Z") };
  assert.equal(editorialStatusOf(noSource, { now: NOW }).status, STATUS.CLAIM,
    "kaynağı olmayan nötr haber 'Haber' diye sunulmamalı");
}

// ── 6. SON DAKİKA BİR SÜREDİR, DURUMUN YERİNE GEÇMEZ ─────────────────────
{
  const freshOfficial = make(
    "UEFA kura çekimini duyurdu",
    "https://www.uefa.com/news/1",
    "2026-09-16T11:30:00.000Z"
  );
  const verdict = editorialStatusOf(freshOfficial, { now: NOW });
  assert.equal(verdict.status, STATUS.OFFICIAL, "taze olmak resmîliği gizlememeli");
  assert.equal(verdict.isBreaking, true, "30 dakikalık haber son dakika olmalı");
}

// ── 7. DÜNKÜ "SON DAKİKA" BUGÜN SON DAKİKA DEĞİLDİR ──────────────────────
{
  const stale = make("Son dakika! Transfer tamam", "https://www.uefa.com/news/2", "2026-09-15T11:30:00.000Z");
  assert.equal(isBreaking(stale, { now: NOW }), false,
    "24 saatlik haber başlığında 'son dakika' yazsa da taze değildir");
}

// ── 8. TARİHSİZ VE GELECEK TARİHLİ KAYIT TAZE SAYILMAZ ───────────────────
{
  assert.equal(isBreaking({ title: "x" }, { now: NOW }), false, "tarihsiz kayıt taze sayılmamalı");
  assert.equal(isBreaking({ publishedAt: "2026-09-16T18:00:00.000Z" }, { now: NOW }), false,
    "gelecek tarihli kayıt (besleme saat hatası) taze sayılmamalı");
}

// ── 9. ETİKETLER İKİ DİLDE DE DOLU ───────────────────────────────────────
{
  for (const status of Object.values(STATUS)) {
    assert.ok(statusLabel(status, "tr"), `${status} için Türkçe etiket olmalı`);
    assert.ok(statusLabel(status, "en"), `${status} için İngilizce etiket olmalı`);
    assert.notEqual(statusLabel(status, "tr"), statusLabel(status, "en"),
      `${status} etiketi çevrilmemiş görünüyor`);
  }
}

console.log("editorial-status passed");
