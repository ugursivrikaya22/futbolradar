/**
 * BAYAT MAÇ ÖNCESİ ANALİZLERİ TEMİZLER.
 *
 * `data/match-analyses.json` maç ÖNCESİ analizleri tutuyor: muhtemel ilk 11,
 * güç dengesi, tahmin. Bu kayıtlar ilk vuruştan önce donduruluyor ve maç
 * bittiğinde anlamlarını yitiriyor — ama dosyadan düşmüyorlardı.
 *
 * NEDEN ÖNEMLİ. Kayıt çalışma anında okunuyor (app.js: `matchAnalyses`) ve
 * "Analizi hazır" sayacını besliyor. Oynanmış bir maç için `status:
 * "scheduled"` taşıyan bir kayıt:
 *
 *   - sayacı şişiriyor (bitmiş maç "analizi hazır" sayılıyor),
 *   - maç detay sayfasında maç öncesi okuma gösterme riski taşıyor,
 *   - maç sonrası analiz deposundaki gerçek analizle çelişiyor.
 *
 * Bu betik yalnızca ARTIK GEÇERSİZ olanları siler: maçı tamamlanmış ve
 * kendisi hâlâ maç öncesi (`scheduled`/`live`) durumda olan kayıtlar.
 * Tamamlanmış maçın maç SONRASI kaydı varsa ona dokunulmaz.
 *
 * Kullanım:
 *   node scripts/prune-stale-match-analyses.mjs           (kuru koşu)
 *   node scripts/prune-stale-match-analyses.mjs --apply
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);

const { curatedMatches } = require("../services/providers/mockProvider.js");
const { isAnalyzableStatus, matchState } = require("../services/matchStatus.js");

const ANALYSES_PATH = path.join(root, "data", "match-analyses.json");
const PUBLIC_ANALYSES_PATH = path.join(root, "public", "data", "match-analyses.json");

/** Maç öncesi sayılan analiz durumları. */
const PRE_MATCH_STATUSES = new Set(["scheduled", "live", "halftime"]);

const apply = process.argv.includes("--apply");

if (!fs.existsSync(ANALYSES_PATH)) {
  console.log("[prune] data/match-analyses.json yok, yapılacak bir şey yok.");
  process.exit(0);
}

const analyses = JSON.parse(fs.readFileSync(ANALYSES_PATH, "utf8"));

if (!Array.isArray(analyses)) {
  console.error("[prune] match-analyses.json bir dizi değil; dokunulmadı.");
  process.exit(1);
}

const pool = curatedMatches();
const byId = new Map();
for (const match of pool) {
  byId.set(String(match.id), match);
  const providerId = (match.providerIds && match.providerIds["api-football"]) || match.providerId;
  if (providerId) byId.set(String(providerId), match);
}

const kept = [];
const removed = [];

for (const record of analyses) {
  const key = String(record.fixtureId || record.slug || record.matchId || "");
  const match = byId.get(key) || null;
  const recordStatus = String(record.status || "").toLowerCase();

  if (!match) {
    // Karşılığı olmayan kayıt: maç listesinden düşmüş olabilir. Maç öncesi
    // durumdaysa artık gösterilemez.
    if (PRE_MATCH_STATUSES.has(recordStatus)) {
      removed.push({ key, reason: "karşılık gelen maç bulunamadı, kayıt maç öncesi durumda", recordStatus });
      continue;
    }
    kept.push(record);
    continue;
  }

  if (isAnalyzableStatus(match) && PRE_MATCH_STATUSES.has(recordStatus)) {
    removed.push({
      key,
      reason: `maç tamamlandı (${matchState(match)}) ama kayıt hâlâ "${recordStatus}"`,
      recordStatus,
      kickoff: match.kickoff || match.date || null
    });
    continue;
  }

  kept.push(record);
}

console.log(`[prune] ${analyses.length} kayıt incelendi · ${removed.length} bayat · ${kept.length} korundu`);
for (const row of removed) {
  console.log(`[prune]   - ${row.key}: ${row.reason}`);
}

if (!removed.length) {
  console.log("[prune] temizlenecek bayat kayıt yok.");
  process.exit(0);
}

if (!apply) {
  console.log("[prune] kuru koşu — yazım yok. Silmek için --apply.");
  process.exit(0);
}

fs.writeFileSync(ANALYSES_PATH, `${JSON.stringify(kept, null, 2)}\n`, "utf8");
if (fs.existsSync(path.dirname(PUBLIC_ANALYSES_PATH))) {
  fs.writeFileSync(PUBLIC_ANALYSES_PATH, `${JSON.stringify(kept, null, 2)}\n`, "utf8");
}

console.log(`[prune] ${removed.length} bayat kayıt silindi; ${kept.length} kayıt kaldı.`);
