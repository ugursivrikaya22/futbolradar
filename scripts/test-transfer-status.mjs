/**
 * TRANSFER DURUM/KAYNAK GÜVEN TESTLERİ.
 *
 * services/transferRadarTicker.js ve services/sourceTrust.js hâlâ canlı:
 * ana sayfanın "Transfer Takibi" paneli (prerender-core-pages.mjs
 * transferWatch()) ve /transfer-radari.html sayfası bu servisleri
 * kullanıyor — yalnızca üst bant (data-component ticker'ı) Canlı Skorlar
 * bandına devredildi (bkz. scripts/test-live-scores-ticker.mjs).
 *
 * Bu dosya eskiden scripts/test-transfer-radar-ticker.mjs'in bir parçasıydı;
 * bant değişince buraya taşındı — durum/kaynak kuralı bandın kendisinden
 * bağımsız, kaybolmaması gerekiyordu.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const {
  RECENT_WINDOW_MS,
  selectRecentTickerRecords,
  selectTickerRecords,
  transferStatusKey,
  withDisplayStatus
} = require("../services/transferRadarTicker.js");

const NOW = Date.parse("2026-08-11T12:00:00Z");
const recent = new Date(NOW - 24 * 60 * 60 * 1000).toISOString();

// ── "RESMÎ" ROZETİ KAYNAK GEREKTİRİR ────────────────────────────────────

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
  assert.equal(
    transferStatusKey({ displayStatus: "Official" }),
    "AgreementReported",
    "kaynaksız elle atanmış resmî durum da indirilmeli"
  );
  assert.equal(transferStatusKey({ status: "kiralık" }), "Loan", "kiralık tanınmalı");
  assert.equal(transferStatusKey({ status: "görüşmeler sürüyor" }), "Talks", "görüşme tanınmalı");
  assert.equal(transferStatusKey({ status: "iddia" }), "Rumor", "iddia tanınmalı");
  assert.equal(transferStatusKey({}), "Rumor", "durumu bilinmeyen kayıt resmî sayılmamalı");
  assert.equal(transferStatusKey({ status: "" }), "Rumor", "boş durum resmî sayılmamalı");
  assert.equal(transferStatusKey({ status: "belirsiz bir ifade" }), "Rumor", "tanınmayan ifade resmî sayılmamalı");
}

{
  const { TRUST_TIER, hasOfficialSource, trustTierOf } = require("../services/sourceTrust.js");

  assert.equal(trustTierOf("https://www.galatasaray.org/haber/x"), TRUST_TIER.OFFICIAL, "kulüp sitesi resmîdir");
  assert.equal(trustTierOf("https://media.fenerbahce.org/x"), TRUST_TIER.OFFICIAL, "kulübün alt alanı da kulübündür");
  assert.equal(trustTierOf("https://www.tff.org/x"), TRUST_TIER.OFFICIAL, "federasyon resmîdir");
  assert.equal(trustTierOf("https://www.aa.com.tr/x"), TRUST_TIER.HIGH, "ulusal ajans yüksek güvendir, resmî değil");
  assert.equal(trustTierOf("https://www.trtspor.com.tr/x"), TRUST_TIER.HIGH, "kamu yayıncısı yüksek güvendir, resmî değil");
  assert.equal(trustTierOf("https://bilinmeyen-site.example/x"), TRUST_TIER.LOW, "tanınmayan kaynak düşük güvendir");
  assert.equal(trustTierOf(""), TRUST_TIER.LOW, "kaynaksızlık güvenilirlik değildir");
  assert.equal(trustTierOf("javascript:alert(1)"), TRUST_TIER.LOW, "http(s) olmayan adres güvenilmez");
  assert.equal(
    trustTierOf("https://notgalatasaray.org/x"),
    TRUST_TIER.LOW,
    "benzer yazılmış alan adı kulüp sayılmamalı"
  );

  assert.equal(hasOfficialSource({ sourceUrl: "https://www.bjk.com.tr/x" }), true, "kulüp kaynağı resmî sayılmalı");
  assert.equal(hasOfficialSource({ sourceUrl: "https://www.sporx.com/x" }), false, "haber sitesi resmî sayılmamalı");

  const clubAnnounced = { playerName: "A", toTeam: "Galatasaray", fromTeam: "X", status: "resmi", date: recent, sourceUrl: "https://www.galatasaray.org/x" };
  const pressReported = { playerName: "B", toTeam: "Fenerbahçe", fromTeam: "Y", status: "resmi", date: recent, sourceUrl: "https://www.aa.com.tr/x" };

  assert.equal(transferStatusKey(clubAnnounced), "Official", "kulüp duyurduysa resmîdir");
  assert.equal(
    transferStatusKey(pressReported),
    "AgreementReported",
    "resmî ağız yoksa 'Resmî' rozeti verilmemeli"
  );

  const items = selectTickerRecords([clubAnnounced, pressReported], { now: NOW });
  assert.equal(items.length, 2, "indirilen kayıt banttan atılmamalı");

  assert.equal(
    transferStatusKey({ playerName: "C", toTeam: "X", fromTeam: "Y", status: "official" }),
    "AgreementReported",
    "kaynağı olmayan iddia resmî sayılamaz"
  );

  const source = [clubAnnounced];
  const stamped = withDisplayStatus(source);
  assert.equal(stamped[0].displayStatus, "Official", "durum kayda yazılmalı");
  assert.equal(source[0].displayStatus, undefined, "kaynak kayıt değiştirilmemeli");
}

console.log("Transfer durum testleri geçti (kayıt seçimi, kaynak güveni, resmî rozet).");

// ── selectRecentTickerRecords: SON DAKİKA varsa o kazanır, yoksa 21 günlük
//    doğrulanmış pencereye düşülür ────────────────────────────────────────

{
  const breakingRecord = {
    playerName: "A", toTeam: "Galatasaray", fromTeam: "X",
    status: "confirmed", date: recent
  };
  const oldConfirmed = {
    playerName: "B", toTeam: "Fenerbahçe", fromTeam: "Y",
    status: "confirmed", date: new Date(NOW - 10 * 24 * 60 * 60 * 1000).toISOString()
  };

  // 1) SON DAKİKA (3 gün) doluysa geniş pencereye hiç bakılmaz.
  const withBreaking = selectRecentTickerRecords([breakingRecord, oldConfirmed], { now: NOW });
  assert.equal(withBreaking.length, 1, "SON DAKİKA varken yalnızca o kayıt dönmeli");
  assert.equal(withBreaking[0].playerName, "A", "SON DAKİKA kaydı kazanmalı");
  assert.equal(withBreaking[0].isBreaking, true, "SON DAKİKA kaydı isBreaking taşımalı");

  // 2) SON DAKİKA boşken 21 günlük pencereden yalnızca doğrulanmış kayıt döner.
  const rumourOld = {
    playerName: "C", toTeam: "Beşiktaş", fromTeam: "Z",
    status: "rumour", date: new Date(NOW - 5 * 24 * 60 * 60 * 1000).toISOString()
  };
  const tooOldConfirmed = {
    playerName: "D", toTeam: "Trabzonspor", fromTeam: "W",
    status: "confirmed", date: new Date(NOW - RECENT_WINDOW_MS - 24 * 60 * 60 * 1000).toISOString()
  };
  const fallback = selectRecentTickerRecords([oldConfirmed, rumourOld, tooOldConfirmed], { now: NOW });
  assert.equal(fallback.length, 1, "yalnızca 21 gün içindeki doğrulanmış kayıt dönmeli");
  assert.equal(fallback[0].playerName, "B", "doğrulanmış kayıt dönmeli");
  assert.equal(fallback[0].isBreaking, false, "geniş pencere SON DAKİKA rozeti taşımamalı");
  assert.ok(fallback[0].dateLabel, "geniş pencere kaydı tarih etiketi taşımalı");

  // 3) Hiçbir pencerede uygun kayıt yoksa bant boş döner — uydurma yok.
  assert.deepEqual(
    selectRecentTickerRecords([rumourOld, tooOldConfirmed], { now: NOW }),
    [],
    "uygun kayıt yoksa boş liste dönmeli"
  );
}

console.log("selectRecentTickerRecords testleri geçti (SON DAKİKA önceliği, 21 günlük doğrulanmış yedek, boş durum).");

// ── GERÇEK DEPO: resmî rozetin arkasında resmî kaynak olmalı ───────────────

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
