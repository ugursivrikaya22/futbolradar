/**
 * TRANSFER ŞEMA GEÇİŞİ — eski kayıtlara yeni alanları ekler.
 *
 * GERİYE UYUMLULUK BİRİNCİ ÖNCELİK: `status: "confirmed"` alanı OLDUĞU GİBİ
 * kalır. services/transferService.js ve on sekiz takım sayfası onu okuyor;
 * dokunulsaydı doğrulanmış transfer bölümleri boşalırdı.
 *
 * Yeni alanlar yanına eklenir: transferStatus (yeni sözlük), transferWindow
 * (tekilleştirme kimliğinin dördüncü parçası), künye alanları ve kaynak
 * dizisi. Bilinmeyen her alan `unknown` yazılır — uydurulmaz.
 *
 * Betik ÇALIŞTIRILDIĞI KADAR ÇOK KEZ çalıştırılabilir: zaten taşınmış kayıt
 * yeniden yazılmaz.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);

const { fromLegacyStatus, statusBadge, statusLabel } = require("../services/transfers/statusModel.js");
const { seasonLabel, transferWindow } = require("../services/transfers/normalizer.js");

const STORE = path.join(root, "data", "transfers.json");
const dryRun = process.argv.includes("--dry-run");

const raw = JSON.parse(fs.readFileSync(STORE, "utf8"));
const records = Array.isArray(raw) ? raw : (raw.transfers || []);

let migrated = 0;
let untouched = 0;

const next = records.map((record) => {
  if (record && record.transferStatus) {
    untouched += 1;
    return record;
  }

  const status = fromLegacyStatus(record.status) || "rumor";
  const announcedAt = record.lastVerifiedAt || `${record.date}T00:00:00+03:00`;
  const window = record.transferWindow || transferWindow(record.date) || "";

  migrated += 1;

  return {
    ...record,
    // Yeni sözlük — eski `status` alanına DOKUNULMADI.
    transferStatus: status,
    transferStatusLabel: statusLabel(status),
    transferStatusBadge: statusBadge(status),
    transferWindow: window,
    season: record.season || seasonLabel(record.date) || "",
    nationality: record.nationality || "unknown",
    age: Number.isFinite(record.age) ? record.age : null,
    loanFee: record.loanFee || "unknown",
    contractUntil: record.contractUntil || "unknown",
    loanEndDate: record.loanEndDate || "unknown",
    purchaseOption: record.purchaseOption || "unknown",
    confidenceScore: Number.isFinite(record.confidence) ? record.confidence : 1,
    announcedAt,
    ingestedAt: announcedAt,
    // Eski kayıtlar elle girildiği için gecikme ölçülemez; null = ölçüm yok.
    ingestionDelaySeconds: null,
    sources: Array.isArray(record.sources) && record.sources.length
      ? record.sources
      : [{
          id: "manual",
          name: record.sourceName || "",
          tier: "club_site",
          url: record.sourceUrl || "",
          publishedAt: announcedAt
        }],
    history: Array.isArray(record.history) && record.history.length
      ? record.history
      : [{ at: announcedAt, status, note: "elle girilen kayıt şemaya taşındı", sourceUrl: record.sourceUrl || "" }]
  };
});

if (dryRun) {
  console.log(`[migrate] kuru koşu — ${migrated} kayıt taşınacak, ${untouched} kayıt zaten güncel.`);
  console.log(JSON.stringify(next[0], null, 2));
} else {
  fs.writeFileSync(STORE, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  console.log(`[migrate] ${migrated} kayıt taşındı, ${untouched} kayıt zaten güncel.`);
}
