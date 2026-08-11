/**
 * TRANSFER RADARI BANDI TESTLERİ.
 *
 * Bu testler canlıda görülen bir ÇELİŞKİDEN doğdu: Türkçe ana sayfanın
 * HTML'i banda "Transfer güncellemeleri hazırlanıyor." yazarken, aynı
 * sayfanın alt tarafındaki Transfer Takibi bölümü dolu transfer satırları
 * gösteriyordu. Sayfa aynı anda hem "veri yok" hem "veri var" diyordu.
 *
 * Sebep: bant yalnızca istemcide doluyordu, ön derlenmiyordu. Yer tutucu
 * JavaScript yüklenene kadar ekranda kalıyordu — ve Googlebot'un gördüğü
 * hâl de buydu.
 *
 * Buradaki testler hem seçim kuralını hem de ÜRETİLEN ÇIKTIYI doğrular.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const {
  BREAKING_WINDOW_MS,
  MAX_ITEMS,
  selectTickerRecords,
  transferStatusKey
} = require("../services/transferRadarTicker.js");

const NOW = Date.parse("2026-08-11T12:00:00Z");
const recent = new Date(NOW - 24 * 60 * 60 * 1000).toISOString();
const old = new Date(NOW - 30 * 24 * 60 * 60 * 1000).toISOString();

// ── 1. Eksik taraflı kayıt banda girmez ────────────────────────────────────

{
  const rows = [
    { playerName: "Tam Kayıt", toTeam: "Galatasaray", fromTeam: "Beşiktaş", date: recent },
    { playerName: "Takımsız", toTeam: "", fromTeam: "Beşiktaş", date: recent },
    { playerName: "", toTeam: "Galatasaray", fromTeam: "Beşiktaş", date: recent },
    { playerName: "Kaynaksız Taraf", toTeam: "Galatasaray", fromTeam: "", date: recent }
  ];
  const items = selectTickerRecords(rows, { now: NOW });
  assert.equal(items.length, 1, "yalnızca tarafları tam olan kayıt banda girmeli");
  assert.equal(items[0].playerName, "Tam Kayıt", "eksik kayıtların boşluğu doldurulmamalı");
}

// ── 2. "SON DAKİKA" bir zaman iddiasıdır ───────────────────────────────────

{
  const items = selectTickerRecords([
    { playerName: "Yeni", toTeam: "Galatasaray", fromTeam: "Beşiktaş", date: recent },
    { playerName: "Eski", toTeam: "Fenerbahçe", fromTeam: "Trabzonspor", date: old },
    { playerName: "Tarihsiz", toTeam: "Beşiktaş", fromTeam: "Samsunspor" }
  ], { now: NOW });

  const byName = Object.fromEntries(items.map((item) => [item.playerName, item]));
  assert.equal(byName["Yeni"].isBreaking, true, "pencere içindeki kayıt son dakika olmalı");
  assert.equal(byName["Eski"].isBreaking, false, "eski kayıt son dakika olmamalı");
  assert.equal(byName["Eski"].dateLabel.length > 0, true, "eski kayıt tarihiyle gösterilmeli");

  // Bilinmeyen tarih, kaydın yeni olduğuna dair bir KANIT DEĞİL.
  assert.equal(byName["Tarihsiz"].isBreaking, false, "tarihi okunamayan kayıt son dakika sayılmamalı");
  assert.equal(byName["Tarihsiz"].dateLabel, "", "tarihi olmayan kayda tarih uydurulmamalı");

  // Eski kayıt banttan ATILMAZ: eskiyen transfer yanlış olmaz.
  assert.equal(items.length, 3, "eski kayıt banttan atılmamalı, yalnızca rozeti değişmeli");

  // Pencerenin tam sınırı da "içeride" sayılır.
  const edge = selectTickerRecords([{
    playerName: "Sınır", toTeam: "Galatasaray", fromTeam: "Beşiktaş",
    date: new Date(NOW - BREAKING_WINDOW_MS).toISOString()
  }], { now: NOW });
  assert.equal(edge[0].isBreaking, true, "pencerenin sınırı son dakika sayılmalı");
}

// ── 3. Durum çıkarımı BELİRSİZLİK yönüne düşer ─────────────────────────────

{
  assert.equal(transferStatusKey({ displayStatus: "Official" }), "Official", "açık durum korunmalı");
  assert.equal(transferStatusKey({ status: "resmi açıklandı" }), "Official", "resmî ifadesi tanınmalı");
  assert.equal(transferStatusKey({ status: "kiralık" }), "Loan", "kiralık tanınmalı");
  assert.equal(transferStatusKey({ status: "görüşmeler sürüyor" }), "Talks", "görüşme tanınmalı");
  assert.equal(transferStatusKey({ status: "iddia" }), "Rumor", "iddia tanınmalı");

  // ASIL KURAL: hiçbir kalıp tutmazsa sonuç "Rumor"dur, "Official" değil.
  // Kesinliği varsayılan yapmak doğrulanmamışı doğrulanmış göstermek olurdu.
  assert.equal(transferStatusKey({}), "Rumor", "durumu bilinmeyen kayıt resmî sayılmamalı");
  assert.equal(transferStatusKey({ status: "" }), "Rumor", "boş durum resmî sayılmamalı");
  assert.equal(transferStatusKey({ status: "belirsiz bir ifade" }), "Rumor", "tanınmayan ifade resmî sayılmamalı");
}

// ── 4. Sıralama: önce tarih, sonra Türk kulübü önceliği ────────────────────

{
  const sameMoment = new Date(NOW - 6 * 60 * 60 * 1000).toISOString();
  const newer = new Date(NOW - 60 * 60 * 1000).toISOString();
  const items = selectTickerRecords([
    { playerName: "Diğer Lig", toTeam: "Fiorentina", fromTeam: "Como", date: sameMoment },
    { playerName: "Süper Lig", toTeam: "Galatasaray", fromTeam: "Como", date: sameMoment },
    { playerName: "Daha Yeni", toTeam: "Como", fromTeam: "Fiorentina", date: newer }
  ], { now: NOW });

  assert.equal(items[0].playerName, "Daha Yeni", "en yeni kayıt başta olmalı");
  assert.equal(items[1].playerName, "Süper Lig", "aynı gün içinde Türk kulübü öne gelmeli");
}

// ── 5. Üst sınır ───────────────────────────────────────────────────────────

{
  const many = Array.from({ length: 40 }, (unused, index) => ({
    playerName: `Oyuncu ${index}`,
    toTeam: "Galatasaray",
    fromTeam: "Beşiktaş",
    date: recent
  }));
  assert.equal(selectTickerRecords(many, { now: NOW }).length, MAX_ITEMS, "bant liste değildir, sınırı olmalı");
}

// ── 6. Veri yoksa uydurma yok ──────────────────────────────────────────────

{
  assert.deepEqual(selectTickerRecords([], { now: NOW }), [], "veri yoksa bant boş kalmalı");
  assert.deepEqual(selectTickerRecords(null, { now: NOW }), [], "bozuk yük çökmemeli");
  assert.deepEqual(selectTickerRecords({ transfers: [] }, { now: NOW }), [], "sarmalanmış boş yük boş dönmeli");
}

// ── 7. ÜRETİLEN ÇIKTI: çelişkili boş-state olmamalı ────────────────────────
//
// Asıl kalkan bu. Depoda transfer verisi VARKEN Türkçe ana sayfanın bandı
// "hazırlanıyor" diyorsa çelişki geri gelmiş demektir.

{
  const transfers = JSON.parse(fs.readFileSync(path.join(root, "data", "transfers.json"), "utf8"));
  const expected = selectTickerRecords(transfers);

  const pages = [
    { file: "index.html", label: "Türkçe ana sayfa" },
    { file: "en/index.html", label: "İngilizce ana sayfa" }
  ];

  for (const page of pages) {
    const filePath = path.join(root, page.file);
    if (!fs.existsSync(filePath)) continue;
    const html = fs.readFileSync(filePath, "utf8");
    const band = html.match(/<div class="transfer-radar-ticker"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*<\/div>/);
    if (!band) continue;

    const itemCount = (band[0].match(/transfer-radar-ticker__item/g) || []).length;
    const hasEmptyState = band[0].includes("transfer-radar-ticker__empty");

    if (expected.length > 0) {
      assert.ok(
        itemCount > 0,
        `${page.label}: veri varken bant ön derlenmiş olmalı (JavaScript'siz de dolu görünmeli)`
      );
      assert.equal(
        hasEmptyState,
        false,
        `${page.label}: veri varken "hazırlanıyor" yer tutucusu gösterilmemeli — sayfa kendi kendisiyle çelişir`
      );
      // Kayan şerit için liste iki kez basılır (biri aria-hidden kopya).
      assert.equal(
        itemCount,
        expected.length * 2,
        `${page.label}: bant servisin seçtiği kayıt sayısını taşımalı`
      );
    }
  }
}

// ── 8. TR ve EN aynı transferleri aynı sırada göstermeli ───────────────────

{
  const trPath = path.join(root, "index.html");
  const enPath = path.join(root, "en", "index.html");
  if (fs.existsSync(trPath) && fs.existsSync(enPath)) {
    const names = (file) => {
      const html = fs.readFileSync(file, "utf8");
      const band = html.match(/<div class="transfer-radar-ticker"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*<\/div>/);
      if (!band) return [];
      return [...band[0].matchAll(/aria-label="[^"|]*\|\s*([^→|]+?)\s*→/g)].map((match) => match[1].trim());
    };
    const tr = names(trPath);
    const en = names(enPath);
    if (tr.length && en.length) {
      assert.deepEqual(en, tr, "İngilizce bant Türkçe bantla aynı transferleri aynı sırada göstermeli");
    }
  }
}

console.log(
  `Transfer bandı testleri geçti (${selectTickerRecords(JSON.parse(fs.readFileSync(path.join(root, "data", "transfers.json"), "utf8"))).length} kayıt seçildi, ` +
  "çelişkili boş-state yok, TR/EN aynı sırada)."
);
