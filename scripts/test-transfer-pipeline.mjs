/**
 * DOĞRULANMIŞ TRANSFER HATTI TESTLERİ
 *
 * Hattın sözleşmesi:
 *   1. Yalnızca onaylı (confirmed) hareket yayımlanır. Söylenti girmez.
 *   2. İzlenebilir kaynak zorunlu: sourceUrl (http/https) ve sourceName.
 *      Kaynağı gösterilemeyen hareket yayımlanmaz.
 *   3. Aynı hareket iki kaynaktan gelirse bir kez yayımlanır; en son
 *      doğrulanan kazanır.
 *   4. Takım sayfası gelen ve giden hareketleri ayrı görür.
 *   5. Elenen ve tekilleşen kayıtlar sessizce kaybolmaz, günlüğe yazılır.
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const service = require("../services/transferService.js");

const base = {
  id: "t1",
  playerName: "Test Oyuncu",
  fromTeam: "Beşiktaş",
  toTeam: "Çaykur Rizespor",
  season: "2026/27",
  type: "Bonservis",
  date: "2026-07-19",
  status: "confirmed",
  sourceName: "Kulüp açıklaması",
  sourceUrl: "https://example.com/duyuru",
  lastVerifiedAt: "2026-07-20T12:00:00+03:00"
};

function testOnlyConfirmedIsPublished() {
  for (const status of ["rumour", "rumor", "talks", "medical", "", "pending"]) {
    const verdict = service.evaluateTransfer({ ...base, status });
    assert.equal(verdict.publishable, false, `"${status}" durumu yayımlanmamalı`);
    assert.ok(verdict.reason, "gerekçe boş olmamalı");
  }

  assert.equal(service.evaluateTransfer(base).publishable, true, "onaylı hareket yayımlanmalı");
}

function testTraceableSourceIsMandatory() {
  assert.equal(
    service.evaluateTransfer({ ...base, sourceUrl: "" }).publishable, false,
    "kaynak bağlantısı olmayan hareket yayımlanmamalı"
  );
  assert.equal(
    service.evaluateTransfer({ ...base, sourceName: "" }).publishable, false,
    "kaynak adı olmayan hareket yayımlanmamalı"
  );
  assert.equal(
    service.evaluateTransfer({ ...base, sourceUrl: "belki-bir-yerde" }).publishable, false,
    "geçersiz bağlantı izlenebilir sayılmamalı"
  );
  assert.equal(
    service.evaluateTransfer({ ...base, sourceUrl: "javascript:alert(1)" }).publishable, false,
    "http(s) olmayan şema kabul edilmemeli"
  );
}

function testRequiredFieldsAreEnforced() {
  for (const field of ["playerName", "fromTeam", "toTeam", "type", "date"]) {
    const verdict = service.evaluateTransfer({ ...base, [field]: "" });
    assert.equal(verdict.publishable, false, `${field} eksikken yayımlanmamalı`);
    assert.ok(verdict.reason.includes(field), `gerekçe eksik alanı adıyla söylemeli: ${verdict.reason}`);
  }

  assert.equal(
    service.evaluateTransfer({ ...base, date: "bilinmiyor" }).publishable, false,
    "okunamayan tarih yayımlanmamalı"
  );
}

function testDeduplication() {
  const older = { ...base, id: "eski", lastVerifiedAt: "2026-07-19T09:00:00+03:00", sourceName: "Ajans" };
  const newer = { ...base, id: "yeni", lastVerifiedAt: "2026-07-21T09:00:00+03:00", sourceName: "Kulüp" };

  const { transfers, duplicates } = service.publishableTransfers({ transfers: [older, newer] });

  assert.equal(transfers.length, 1, "aynı hareket bir kez yayımlanmalı");
  assert.equal(transfers[0].id, "yeni", "en son doğrulanan kayıt kazanmalı");
  assert.equal(duplicates.length, 1, "tekilleşen kayıt bildirilmeli");
  assert.equal(duplicates[0].keptId, "yeni");

  // Farklı oyuncu ya da farklı taraf aynı hareket değildir.
  const other = { ...base, id: "baska", playerName: "Diğer Oyuncu" };
  assert.equal(
    service.publishableTransfers({ transfers: [base, other] }).transfers.length, 2,
    "farklı oyuncular ayrı hareketlerdir"
  );
}

function testIncomingOutgoingSplit() {
  const prepared = service.publishableTransfers({ transfers: [base] });

  const rize = service.transfersForTeam("Çaykur Rizespor", { prepared });
  assert.equal(rize.incoming.length, 1, "hedef kulüp için gelen olmalı");
  assert.equal(rize.outgoing.length, 0);

  const besiktas = service.transfersForTeam("Beşiktaş", { prepared });
  assert.equal(besiktas.outgoing.length, 1, "kaynak kulüp için giden olmalı");
  assert.equal(besiktas.incoming.length, 0);

  // İki kaynakta farklı yazım: "Rizespor" ile "Çaykur Rizespor" aynı kulüp.
  assert.equal(
    service.transfersForTeam("Rizespor", { prepared }).incoming.length, 1,
    "kısaltılmış kulüp adı da eşleşmeli"
  );

  // Türkçe karakter katlaması.
  assert.equal(
    service.transfersForTeam("BESIKTAS", { prepared }).outgoing.length, 1,
    "Türkçe karakterler katlanarak eşleşmeli"
  );
}

function testRealDataIsPublishableAndTraceable() {
  const { transfers, excluded } = service.publishableTransfers();

  assert.ok(transfers.length, "depodaki doğrulanmış transferler yayımlanabilir olmalı");

  for (const transfer of transfers) {
    assert.equal(String(transfer.status).toLowerCase(), "confirmed", `${transfer.id}: yalnızca onaylı kayıt`);
    assert.ok(/^https?:\/\//.test(transfer.sourceUrl), `${transfer.id}: izlenebilir kaynak zorunlu`);
    assert.ok(String(transfer.type || "").trim(), `${transfer.id}: transfer türü zorunlu`);
    assert.ok(String(transfer.date || "").trim(), `${transfer.id}: tarih zorunlu`);
  }

  for (const item of excluded) {
    assert.ok(item.reason, "elenen her kaydın gerekçesi olmalı");
  }
}

function testAtLeastOneSuperLigTeamHasBothDirections() {
  // Hattın gerçekten takım sayfalarına bağlandığının kanıtı: en az bir Süper
  // Lig kulübü hem gelen hem giden hareket görmeli. Aksi hâlde birleştirme
  // çalışıyor görünüp hiçbir sayfayı doldurmuyor olabilir.
  const prepared = service.publishableTransfers();
  const teams = ["Galatasaray", "Fenerbahçe", "Beşiktaş", "Trabzonspor", "Göztepe", "Konyaspor"];

  const withBoth = teams.filter((team) => {
    const split = service.transfersForTeam(team, { prepared });
    return split.incoming.length && split.outgoing.length;
  });

  assert.ok(
    withBoth.length,
    `en az bir kulüpte hem gelen hem giden hareket bulunmalı, bulunan: ${withBoth.join(", ") || "yok"}`
  );
}

/**
 * ESKİ TRANSFER KAYITLARI SİLİNMEZ.
 *
 * Ana sayfanın transfer bölümü ve transfer izleme listesi bir sezon
 * penceresine ("bu yaz kim geldi") göre süzülüyordu; sınır app.js ile ön
 * render arasında paylaşılıyordu ve bu testin eski hâli ikisinin aynı
 * tarihi kullandığını doğruluyordu. Her iki yüzey de kaldırıldı, dolayısıyla
 * pencerenin kendisi artık hiçbir yerde yok.
 *
 * Pencereyle birlikte kaybolmaması gereken ASIL güvence buradaki: pencere
 * yalnızca bir GÖRÜNÜM süzgeciydi, kayıtları SİLMİYORDU. Eski doğrulanmış
 * transferler oyuncu profillerinin transfer geçmişinde ve takım
 * sayfalarında görünmeye devam eder. Bu test onu doğruluyor; bir gün
 * süzgeç veri katmanına kayarsa burada yakalanır.
 */
function testOldTransfersAreNotDropped() {
  // Sezon sınırı SADECE bu denetimin "eski kayıt" tanımı; üretimde böyle bir
  // sınır artık yok. 1 Temmuz 2026, bir önceki sezonun kapanışını ve devre
  // arasını bu tarafta bırakır.
  const SEASON_START = "2026-07-01";
  const all = require("../data/transfers.json");
  const older = all.filter((transfer) => String(transfer.date).slice(0, 10) < SEASON_START);
  const newer = all.filter((transfer) => String(transfer.date).slice(0, 10) >= SEASON_START);

  assert.ok(newer.length, "bu sezondan en az bir transfer bulunmalı");
  assert.ok(older.length, "ön koşul: sınırın altında kayıt bulunmalı ki denetim anlamlı olsun");
  assert.equal(older.length + newer.length, all.length, "hiçbir kayıt sayımdan düşmemeli");

  // Asıl iddia: eski kayıtlar hâlâ doğrulanmış veri olarak hattan geçiyor.
  const publishable = service.publishableTransfers().transfers;
  assert.ok(
    older.some((old) => publishable.some((item) => item.id === old.id)),
    "eski doğrulanmış kayıtlar yayın hattından düşürülmemeli"
  );
}

function testSuperLigRelevance() {
  // En az bir taraf Süper Lig kulübü olmalı. Giden transferde karşı taraf
  // yabancı kulüp olabilir — o da lig haberidir.
  assert.equal(
    service.involvesSuperLigTeam({ fromTeam: "Trabzonspor", toTeam: "Fiorentina" }), true,
    "Süper Lig'den giden hareket lig haberidir"
  );
  assert.equal(
    service.involvesSuperLigTeam({ fromTeam: "Arsenal", toTeam: "Beşiktaş" }), true,
    "Süper Lig'e gelen hareket lig haberidir"
  );
  assert.equal(
    service.involvesSuperLigTeam({ fromTeam: "Chelsea", toTeam: "Fiorentina" }), false,
    "iki tarafı da lig dışında olan hareket lig haberi değildir"
  );
  assert.equal(
    service.involvesSuperLigTeam({ fromTeam: "BESIKTAS", toTeam: "Roma" }), true,
    "Türkçe karakterler katlanarak eşleşmeli"
  );
}

async function testTickerCarriesAConfirmedTransfer() {
  // Hattın banda gerçekten bağlandığının kanıtı. Daha önce sıralama önceliği
  // doğru ama sonuç tek sesliydi: altı maç sonucu bütün yerleri dolduruyor,
  // doğrulanmış transferler banda hiç girmiyordu.
  const { buildTickerFeed } = await import("./lib/tickerFeed.mjs");
  const feed = buildTickerFeed();

  const transferItems = feed.items.filter((item) => item.label === "Transfer");
  assert.ok(transferItems.length, "bantta en az bir doğrulanmış transfer olmalı");

  for (const item of transferItems) {
    assert.match(
      item.href,
      /^super-lig-transferleri-2026-2027\.html#transfer-/,
      "transfer öğesi site içindeki ayrıntılı kayda bağlanmalı"
    );
    assert.ok(item.at, "transfer öğesinin tarihi olmalı");
  }
}

const tests = [
  testOnlyConfirmedIsPublished,
  testSuperLigRelevance,
  testOldTransfersAreNotDropped,
  testTraceableSourceIsMandatory,
  testRequiredFieldsAreEnforced,
  testDeduplication,
  testIncomingOutgoingSplit,
  testRealDataIsPublishableAndTraceable,
  testAtLeastOneSuperLigTeamHasBothDirections,
  testTickerCarriesAConfirmedTransfer
];

for (const test of tests) {
  await test();
}

console.log(`Transfer pipeline tests passed (${tests.length} senaryo: yalnızca onaylı, Süper Lig ilgisi, izlenebilir kaynak, ` +
  "zorunlu alanlar, tekilleştirme, gelen/giden ayrımı, gerçek veri, takım bağlantısı, bant bağlantısı, eski kayıtların korunması).");
