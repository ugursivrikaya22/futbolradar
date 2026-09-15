#!/usr/bin/env node
/**
 * MAÇ KAYBI KORUMASI.
 *
 * Tamamlanmış maçların saatlik hattan kalıcı olarak silinmesini önleyen üç
 * invariantı sınar. Bunlar davranışsal sözleşmeler: hiçbiri tek bir dosyada
 * "görünür" değil, üçü birden tutmazsa maç sessizce kaybolur ve bu yalnızca
 * haftalar sonra bir kapsama sayımında fark edilir.
 *
 * Neden test gerekiyor: kaybın kendisi sessiz. `generate-post-match-reports`
 * havuzda olmayan kaydı uyarı üretmeden düşürüyor, fikstür takviminin
 * penceresi 3 gün, ve arşiv bu zincirin tek kalıcı halkası. Koruma bir
 * orkestratör düzenlemesinde kolayca bozulabilir; bozulduğunda da testsiz
 * fark edilmez.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { buildArchive } = require("../services/historicalMatchArchive.js");

const orchestrator = fs.readFileSync(path.join(root, "scripts", "run-scheduled-update.mjs"), "utf8");

/* 1) SIRA: arşivleme, yıkıcı rapor üretiminden ÖNCE.
 *
 * Tersi olsaydı arşivlenecek kayıt çoktan silinmiş olurdu. */
const archiveAt = orchestrator.indexOf('nodeStep("match-archive"');
const storeAt = orchestrator.indexOf('nodeStep("post-match-store"');
assert.notEqual(archiveAt, -1, "match-archive adımı zamanlanmış hatta yok");
assert.notEqual(storeAt, -1, "post-match-store adımı zamanlanmış hatta yok");
assert.ok(archiveAt < storeAt, "match-archive, post-match-store'dan ÖNCE koşmalı");

/* 2) BAĞIMLILIK: arşivleme başarısızsa depo yeniden üretilmez.
 *
 * Transform döngüsü `required` bayrağını onurlandırmıyor; koruma bu yüzden
 * döngünün kendisinde açık bir dal olarak duruyor. */
assert.ok(
  /archiveFailed/.test(orchestrator) &&
  /spec\.id === "post-match-store" && archiveFailed/.test(orchestrator),
  "arşivleme başarısız olduğunda post-match-store atlanmalı"
);
assert.ok(
  /spec\.id === "match-archive" && result\.status === "failed"/.test(orchestrator),
  "match-archive sonucu okunmalı; aksi hâlde başarısızlık sessiz kalır"
);

/* 3) KALICILIK: arşiv küçülmez.
 *
 * Bir maç matches.json, fikstür takvimi ve rapor deposunun ÜÇÜNDEN birden
 * düştüğünde bile arşivdeki kaydı korunmalı — arşiv rapor üretecine havuz
 * olarak geri besleniyor, kalıcı olmazsa zincir kopuyor. */
const finished = {
  id: "aaa-bbb-2026-09-06",
  homeTeam: "AAA",
  awayTeam: "BBB",
  kickoff: "2026-09-06T20:00:00+03:00",
  status: "FINISHED",
  score: { home: 5, away: 0 }
};

const seeded = buildArchive({
  sources: [{ name: "manual", records: [finished] }],
  previous: { records: [] },
  now: "2026-09-06T23:00:00+03:00"
});
assert.equal(seeded.records.length, 1, "bitmiş maç arşive girmeli");

// Aynı maç artık HİÇBİR kaynakta yok — pencereden düştü.
const afterDrop = buildArchive({
  sources: [{ name: "manual", records: [] }, { name: "report", records: [] }],
  previous: seeded,
  now: "2026-09-10T02:00:00+03:00"
});
assert.equal(afterDrop.records.length, 1, "kaynaklardan düşen maç arşivde KALMALI");
const carried = afterDrop.records[0];
assert.equal(carried.match.score.home, 5, "taşınan kayıt skorunu korumalı");
assert.equal(carried.match.score.away, 0, "taşınan kayıt skorunu korumalı");
assert.equal(carried.archivedAt, "2026-09-06T23:00:00+03:00", "ilk arşivleme anı korunmalı");
assert.equal(carried.carriedForward, true, "taşınan kayıt işaretlenmeli");

// Kaynak geri geldiğinde taşınan kayıt tazesiyle değiştirilmeli, iki kez değil.
const afterReturn = buildArchive({
  sources: [{ name: "manual", records: [finished] }],
  previous: afterDrop,
  now: "2026-09-11T02:00:00+03:00"
});
assert.equal(afterReturn.records.length, 1, "kaynak dönünce kayıt çiftlenmemeli");
assert.ok(!afterReturn.records[0].carriedForward, "tazelenen kayıt taşınmış sayılmamalı");

console.log("Maç kaybı koruması geçti (sıra, arşiv-başarısızlık bağımlılığı, arşiv kalıcılığı).");
