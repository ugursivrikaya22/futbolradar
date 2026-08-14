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
  assert.equal(byName["Eski"], undefined, "üç günden eski kayıt güncel banda girmemeli");
  assert.equal(byName["Tarihsiz"], undefined, "tarihi bilinmeyen kayıt güncel banda girmemeli");
  assert.equal(items.length, 1, "ana sayfa bandı yalnızca son üç günü göstermeli");

  // Pencerenin tam sınırı da "içeride" sayılır.
  const edge = selectTickerRecords([{
    playerName: "Sınır", toTeam: "Galatasaray", fromTeam: "Beşiktaş",
    date: new Date(NOW - BREAKING_WINDOW_MS).toISOString()
  }], { now: NOW });
  assert.equal(edge[0].isBreaking, true, "pencerenin sınırı son dakika sayılmalı");
}

// ── 3. Durum çıkarımı BELİRSİZLİK yönüne düşer ─────────────────────────────

{
  const officialSource = { sourceUrl: "https://www.galatasaray.org/haber/x" };
  assert.equal(
    transferStatusKey({ displayStatus: "Official", ...officialSource }),
    "Official",
    "açık durum korunmalı"
  );
  assert.equal(
    transferStatusKey({ status: "resmi açıklandı", ...officialSource }),
    "Official",
    "resmî ifadesi tanınmalı"
  );
  // Elle "Official" yazılmış olması bile kaynak koşulunu kaldırmaz.
  assert.equal(
    transferStatusKey({ displayStatus: "Official" }),
    "AgreementReported",
    "kaynaksız elle atanmış resmî durum da indirilmeli"
  );
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

// ── 9. "RESMÎ" ROZETİ KAYNAK GEREKTİRİR ────────────────────────────────────
//
// Depoda görülen durum: "Resmî" gösterilen 20 transferin beşinin arkasında
// kulüp değil bir haber kuruluşu vardı (TRT Spor, Anadolu Ajansı, Sporx).
// Hepsi saygın yayın organı — ama bir gazetenin "imzalandı" yazması,
// kulübün imzayı duyurması değildir.

{
  const { TRUST_TIER, hasOfficialSource, trustTierOf } = require("../services/sourceTrust.js");
  const { withDisplayStatus } = require("../services/transferRadarTicker.js");

  // Kademe eşlemesi
  assert.equal(trustTierOf("https://www.galatasaray.org/haber/x"), TRUST_TIER.OFFICIAL, "kulüp sitesi resmîdir");
  assert.equal(trustTierOf("https://media.fenerbahce.org/x"), TRUST_TIER.OFFICIAL, "kulübün alt alanı da kulübündür");
  assert.equal(trustTierOf("https://www.tff.org/x"), TRUST_TIER.OFFICIAL, "federasyon resmîdir");
  assert.equal(trustTierOf("https://www.aa.com.tr/x"), TRUST_TIER.HIGH, "ulusal ajans yüksek güvendir, resmî değil");
  assert.equal(trustTierOf("https://www.trtspor.com.tr/x"), TRUST_TIER.HIGH, "kamu yayıncısı yüksek güvendir, resmî değil");

  // TANINMAYAN KAYNAK KADEME 4'TÜR — varsayılan iyimser olmamalı.
  assert.equal(trustTierOf("https://bilinmeyen-site.example/x"), TRUST_TIER.LOW, "tanınmayan kaynak düşük güvendir");
  assert.equal(trustTierOf(""), TRUST_TIER.LOW, "kaynaksızlık güvenilirlik değildir");
  assert.equal(trustTierOf("javascript:alert(1)"), TRUST_TIER.LOW, "http(s) olmayan adres güvenilmez");

  // Sonek benzerliği yetmemeli.
  assert.equal(
    trustTierOf("https://notgalatasaray.org/x"),
    TRUST_TIER.LOW,
    "benzer yazılmış alan adı kulüp sayılmamalı"
  );

  assert.equal(hasOfficialSource({ sourceUrl: "https://www.bjk.com.tr/x" }), true, "kulüp kaynağı resmî sayılmalı");
  assert.equal(hasOfficialSource({ sourceUrl: "https://www.sporx.com/x" }), false, "haber sitesi resmî sayılmamalı");

  // Durum indirmesi
  const clubAnnounced = { playerName: "A", toTeam: "Galatasaray", fromTeam: "X", status: "resmi", date: recent, sourceUrl: "https://www.galatasaray.org/x" };
  const pressReported = { playerName: "B", toTeam: "Fenerbahçe", fromTeam: "Y", status: "resmi", date: recent, sourceUrl: "https://www.aa.com.tr/x" };

  assert.equal(transferStatusKey(clubAnnounced), "Official", "kulüp duyurduysa resmîdir");
  assert.equal(
    transferStatusKey(pressReported),
    "AgreementReported",
    "resmî ağız yoksa 'Resmî' rozeti verilmemeli"
  );

  // BİLGİ SİLİNMEZ: kayıt bantta kalır, yalnızca rozeti değişir.
  const items = selectTickerRecords([clubAnnounced, pressReported], { now: NOW });
  assert.equal(items.length, 2, "indirilen kayıt banttan atılmamalı");

  // Kaynaksız bir kayıt asla resmî olamaz.
  assert.equal(
    transferStatusKey({ playerName: "C", toTeam: "X", fromTeam: "Y", status: "official" }),
    "AgreementReported",
    "kaynağı olmayan iddia resmî sayılamaz"
  );

  // Damgalama kaynağı bozmamalı.
  const source = [clubAnnounced];
  const stamped = withDisplayStatus(source);
  assert.equal(stamped[0].displayStatus, "Official", "durum kayda yazılmalı");
  assert.equal(source[0].displayStatus, undefined, "kaynak kayıt değiştirilmemeli");
}

// ── 10. GERÇEK DEPO: resmî rozetin arkasında resmî kaynak olmalı ───────────

{
  const { hasOfficialSource } = require("../services/sourceTrust.js");
  const payload = JSON.parse(fs.readFileSync(path.join(root, "data", "transfers.json"), "utf8"));
  const rows = Array.isArray(payload) ? payload : (payload.transfers || []);

  const wrong = rows
    .filter((row) => transferStatusKey(row) === "Official" && !hasOfficialSource(row))
    .map((row) => `${row.playerName} (${row.sourceUrl})`);

  assert.deepEqual(
    wrong,
    [],
    `"Resmî" gösterilen her transferin arkasında resmî kaynak olmalı; aykırı: ${wrong.join(", ")}`
  );
}

console.log("Kaynak güven testleri geçti (resmî rozet yalnızca resmî kaynakla).");

// ── 11. BANT KAPSAMI: hangi sayfalarda çıkar, hangilerinde çıkmaz ──────────
//
// Bant ana gezinme sayfalarında var, üretilmiş detay sayfalarında yok. Bu bir
// tasarım kararı ve sessizce kayabilecek bir karar: listeye bir satır eklemek
// 4.900 detay sayfasının tepesine kayan şerit koyabilir, bir satır silmek
// bandı bir sayfadan habersizce kaldırabilir. İkisini de bekçiye bağlıyoruz.
//
// Liste testte KOPYALANMAZ, enjeksiyonun okuduğu yerden okunur — kopyalanmış
// bir liste, asıl liste değişince sessizce eskir ve testi işe yaramaz kılar.

{
  const { TRANSFER_TICKER_PAGES, TRANSFER_TICKER_OWN_PAGES } =
    await import("./lib/transferTicker.mjs");

  const BAND = 'data-component="TransferRadarTicker"';
  const hasBand = (file) => {
    const full = path.join(root, file);
    return fs.existsSync(full) && fs.readFileSync(full, "utf8").includes(BAND);
  };

  const expected = [...TRANSFER_TICKER_PAGES, ...TRANSFER_TICKER_OWN_PAGES];
  const missing = expected.filter((file) => !hasBand(file));
  assert.deepEqual(missing, [], `bant listedeki her sayfada olmalı; eksik: ${missing.join(", ")}`);

  // Sızıntı kontrolü TÜM siteyi tarar: "listede olmayan hiçbir sayfada bant
  // yok" ifadesi, örneklem üzerinden değil ancak tam tarama ile kurulabilir.
  // Örneklem alsaydık, bandın 4.900 detay sayfasının bir kısmına sızması
  // testten kaçabilirdi.
  const walk = (dir) => {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "public") {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(full));
      else if (entry.name.endsWith(".html")) out.push(path.relative(root, full).split(path.sep).join("/"));
    }
    return out;
  };

  const allPages = walk(root);
  assert.ok(allPages.length > 1000, `tam tarama beklenen büyüklükte değil (${allPages.length} sayfa)`);

  const known = new Set(expected);
  const leaked = allPages.filter((file) => !known.has(file) && hasBand(file));
  assert.deepEqual(
    leaked.slice(0, 10),
    [],
    `bant yalnızca listedeki sayfalarda olmalı; sızan ${leaked.length} sayfa: ${leaked.slice(0, 10).join(", ")}`
  );

  // TR ve EN aynı sayfada aynı davranmalı — birinde bant varken diğerinde
  // olmaması, daha önce düzeltilen tasarım eşitsizliğinin geri gelmesidir.
  [
    ["index.html", "en/index.html"],
    ["canli-skor.html", "en/live-scores.html"],
    ["bugunun-maclari.html", "en/todays-matches.html"],
    ["puan-durumu.html", "en/standings.html"]
  ].forEach(([tr, en]) => {
    assert.equal(hasBand(tr), hasBand(en), `${tr} ve ${en} bant konusunda eşit olmalı`);
  });

  console.log(
    `Bant kapsamı testleri geçti (${expected.length} sayfada var, ` +
    `kalan ${allPages.length - expected.length} sayfada yok, 4 dil çifti eşit).`
  );
}
