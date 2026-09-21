/**
 * TRANSFER DURUM/KAYNAK GÜVEN TESTLERİ.
 *
 * services/transferDisplayStatus.js ve services/sourceTrust.js canlı:
 * `/api/transfers` her kaydı bu eşlemeyle damgalıyor, transfer izleme
 * ekranı ve takım sayfaları rozeti oradan okuyor.
 *
 * Kural bir zamanlar Transfer Radarı bandının dosyasında yaşıyordu; bant
 * kaldırılınca yalnızca BANDA ÖZGÜ seçim kuralı silindi, durum/kaynak
 * kuralı kendi adını taşıyan servise taşındı ve buradaki denetimler onunla
 * birlikte kaldı.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const {
  transferStatusKey,
  withDisplayStatus
} = require("../services/transferDisplayStatus.js");

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

console.log("Transfer durum testleri geçti (kaynak güveni, resmî rozet).");

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
