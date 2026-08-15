#!/usr/bin/env node
/**
 * BİTMİŞ MAÇI TAKVİMDE DE BİTMİŞ YAPAR.
 *
 * `data/fixture-calendar.json` sonuç eşitlemesiyle güncelleniyor. Eşitleme
 * bir maç bittikten SONRA ama sonraki koşudan ÖNCE bakıldığında, takvim o
 * maçı hâlâ `SCHEDULED` ve skorsuz gösteriyor. Maç dosyası uç noktası
 * sağlayıcı penceresi kapandıktan sonra skoru bu dosyadan okuduğu için,
 * oynanmış maç saatlerce "başlamadı" görünüyordu — Gençlerbirliği 2-1
 * Fenerbahçe'de tam olarak bu oldu: rapor sayfası skoru yazarken maç
 * dosyası maçı başlamamış sanıyordu.
 *
 * ── SKOR UYDURULMAZ ──────────────────────────────────────────────────────
 * Bu betik hiçbir sonuç ÜRETMEZ. Yalnızca deponun BAŞKA BİR YERİNDE zaten
 * duran, sağlayıcıdan gelmiş ve maç raporu sayfasında yayımlanmış sonucu
 * takvime taşır. Rapor kaydı bitmiş demiyorsa ya da skoru yoksa dokunmaz.
 * İki dosya arasındaki çelişkiyi giderir, yeni bir iddia kurmaz.
 *
 *   node scripts/repair-fixture-results.mjs            # ne yapacağını yazar
 *   node scripts/repair-fixture-results.mjs --apply    # yazar
 */
import fs from "node:fs";
import path from "node:path";
import { readJsonFile } from "./lib/readJsonFile.mjs";

const root = process.cwd();
const CALENDAR_PATH = path.join(root, "data", "fixture-calendar.json");
const REPORTS_PATH = path.join(root, "data", "post-match-reports.json");

/** Sağlayıcının bitmiş saydığı durumlar — uç noktadakiyle aynı liste. */
const FINISHED = new Set(["FT", "AET", "PEN", "FINISHED"]);

const apply = process.argv.slice(2).includes("--apply");

function atomicWrite(filePath, data) {
  const temp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(temp, filePath);
}

const calendar = readJsonFile(CALENDAR_PATH, null);
const reports = readJsonFile(REPORTS_PATH, null);
if (!calendar || !reports) {
  console.error("fixture-results: veri dosyaları okunamadı, hiçbir şey yapılmadı.");
  process.exit(1);
}

const matches = Array.isArray(calendar) ? calendar : calendar.matches || [];
const records = new Map();
for (const record of reports.records || []) {
  const status = String(record.providerStatus || record.status || "").toUpperCase();
  if (!FINISHED.has(status)) continue;
  const score = record.score || record.finalScore || {};
  if (!Number.isFinite(Number(score.home)) || !Number.isFinite(Number(score.away))) continue;
  if (record.matchId) records.set(String(record.matchId), { score, status });
}

const repaired = [];
for (const match of matches) {
  const record = records.get(String(match.id || ""));
  if (!record) continue;

  const current = String(match.providerStatus || match.status || "").toUpperCase();
  if (FINISHED.has(current)) continue;

  // Başlama saati geçmemiş bir maç için rapor kaydı varsa bir yerde hata
  // vardır; onarım o hatayı takvime YAYMAZ.
  const kickoff = Date.parse(match.kickoff || "");
  if (!Number.isFinite(kickoff) || kickoff > Date.now()) continue;

  repaired.push({
    id: match.id,
    from: current || "(boş)",
    to: `FINISHED ${record.score.home}-${record.score.away}`
  });

  match.status = "FINISHED";
  match.providerStatus = record.status;
  match.score = {
    ...(match.score || {}),
    home: Number(record.score.home),
    away: Number(record.score.away)
  };
  match.resultSource = "post-match-report";
}

if (!repaired.length) {
  console.log("fixture-results: takvim raporlarla tutarlı, onarılacak maç yok.");
  process.exit(0);
}

for (const row of repaired) console.log(`  ${row.id}: ${row.from} → ${row.to}`);

if (!apply) {
  console.log(`fixture-results: ${repaired.length} maç onarılacak (--apply ile yaz).`);
  process.exit(0);
}

atomicWrite(CALENDAR_PATH, calendar);
console.log(`fixture-results: ${repaired.length} maç takvimde bitmiş olarak işaretlendi.`);
