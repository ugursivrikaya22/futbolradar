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
 * Transfer izleme dönem sınırı.
 *
 * Sınır eskiden İKİ yerde yaşıyordu — istemci (app.js) ve ana sayfanın
 * transfer bölümünü basan statik ön render. İkisi ayrışırsa sayfa önce eski
 * listeyi gösterip JS yüklendiğinde kendini düzeltirdi; okuyucu için bu bir
 * arıza görüntüsüydü. Ana sayfadaki bölüm kaldırıldığında ön renderdaki
 * kopya da gitti: sınır artık YALNIZCA app.js'te, transfer izleme listesi
 * için yaşıyor. Test tek tanımın durduğunu ve verinin ona uyduğunu
 * doğruluyor; ikinci bir tanım geri gelirse bu testin yeniden
 * eşitlik denetlemesi gerekir.
 */
function testTransferWatchWindowIsConsistent() {
  const fs = require("node:fs");
  const app = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");

  const appMatch = app.match(/TRANSFER_WATCH_SINCE\s*=\s*"([\d-]+)"/);
  assert.ok(appMatch, "app.js dönem sınırını tanımlamalı");

  // Sınır Haziran 2026'dan sonrasını kapsamalı.
  assert.ok(appMatch[1] > "2026-06-30", `sınır Haziran 2026 sonrası olmalı, bulunan: ${appMatch[1]}`);

  // Gerçek veriyle sayım: sınırın üstündekiler kalmalı, altındakiler izleme
  // listesinden düşmeli — ama veri dosyasından SİLİNMEMELİ.
  const all = require("../data/transfers.json");
  const kept = all.filter((transfer) => String(transfer.date).slice(0, 10) >= appMatch[1]);
  const dropped = all.filter((transfer) => String(transfer.date).slice(0, 10) < appMatch[1]);

  assert.ok(kept.length, "izleme penceresinde en az bir transfer kalmalı");
  assert.ok(dropped.length, "ön koşul: sınırın altında kayıt bulunmalı ki filtre anlamlı olsun");
  assert.equal(kept.length + dropped.length, all.length, "hiçbir kayıt sayımdan düşmemeli");

  // Silinmediklerinin kanıtı: eski kayıtlar hâlâ doğrulanmış veri olarak
  // hattan geçebiliyor (oyuncu geçmişi ve takım sayfaları için).
  const publishable = service.publishableTransfers().transfers;
  assert.ok(
    dropped.some((old) => publishable.some((item) => item.id === old.id)),
    "sınırın altındaki doğrulanmış kayıtlar silinmemeli, yalnızca izleme listesinden çıkmalı"
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
  testTransferWatchWindowIsConsistent,
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
  "zorunlu alanlar, tekilleştirme, gelen/giden ayrımı, gerçek veri, takım bağlantısı, bant bağlantısı, izleme dönem sınırı).");
