/**
 * API-Football fixture id'si eksik olan maçları sağlayıcıdan eşleştirip
 * data/matches.json'a yazar.
 *
 * Eşleştirme gün + iki takım adı üzerinden yapılır (bkz.
 * services/fixtureMatchingService.js). Belirsiz kalan adaylar YAZILMAZ;
 * yanlış eşleşme, bir maçın istatistiklerini başka maça işlemek demektir.
 *
 * Kimlik bilgisi yoksa temiz no-op: hangi maçların beklediğini raporlar.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const apiFootballProvider = require("../services/providers/apiFootballProvider.js");
const { matchFixture } = require("../services/fixtureMatchingService.js");
const { API_FOOTBALL, providerIdFor, withProviderId, coverageReport } = require("../services/providerIdentityService.js");

const MATCHES_PATH = path.join(root, "data", "matches.json");
const PUBLIC_MATCHES_PATH = path.join(root, "public", "data", "matches.json");

function parseArgs(argv) {
  const args = { apply: false };
  for (const raw of argv) {
    if (raw === "--apply") args.apply = true;
    else if (raw === "--dry-run") args.apply = false;
  }
  return args;
}

function atomicWrite(filePath, data) {
  const tempPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function dateKey(value) {
  return String(value || "").slice(0, 10);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const matches = JSON.parse(fs.readFileSync(MATCHES_PATH, "utf8"));

  const before = coverageReport(matches, API_FOOTBALL);
  console.log(`API-Football kimlik kapsamı (önce): ${before.covered}/${before.total} (%${before.percent})`);

  const pending = matches.filter((match) => !providerIdFor(match, API_FOOTBALL));
  if (!pending.length) {
    console.log("Eksik kimlik yok.");
    return;
  }
  console.log(`Eşleştirilecek maç: ${pending.length}`);

  if (!apiFootballProvider.hasConfig()) {
    console.log(
      "\nCanlı sağlayıcı yapılandırılmadı (APIFOOTBALL_API_KEY yok). Eşleştirme altyapısı hazır; " +
      "geçerli anahtar tanımlandığında bu adım otomatik çalışacak. Bekleyen maçlar:"
    );
    pending.forEach((match) => console.log(`  - ${match.id} (${dateKey(match.kickoff)})`));
    return;
  }

  // Aynı günü birden çok maç paylaşabildiği için gün başına tek istek atılır.
  const days = [...new Set(pending.map((match) => dateKey(match.kickoff || match.date)).filter(Boolean))].sort();
  const fixturesByDay = new Map();

  for (const day of days) {
    try {
      const fixtures = await apiFootballProvider.getMatches({ date: day });
      fixturesByDay.set(day, Array.isArray(fixtures) ? fixtures : []);
      console.log(`  ${day}: sağlayıcıdan ${fixturesByDay.get(day).length} fikstür`);
    } catch (error) {
      console.log(`  ${day}: sağlayıcı hatası (${error.code || error.message}) — bu gün atlandı`);
      fixturesByDay.set(day, []);
    }
  }

  const next = [...matches];
  const applied = [];
  const unresolved = [];

  for (const match of pending) {
    const day = dateKey(match.kickoff || match.date);
    const candidates = fixturesByDay.get(day) || [];
    if (!candidates.length) {
      unresolved.push({ id: match.id, why: "o güne ait sağlayıcı fikstürü alınamadı" });
      continue;
    }

    const result = matchFixture(match, candidates);
    if (result.status !== "matched") {
      unresolved.push({
        id: match.id,
        why: result.status === "ambiguous"
          ? `birden fazla yakın aday (skor ${result.score.toFixed(2)})`
          : `eşik altı benzerlik (en iyi ${result.score.toFixed(2)})`
      });
      continue;
    }

    const fixtureId = result.candidate.providerId || result.candidate.id;
    const { record, changed, conflict } = withProviderId(match, API_FOOTBALL, fixtureId);
    if (conflict) {
      unresolved.push({ id: match.id, why: conflict });
      continue;
    }
    if (!changed) continue;

    next[next.findIndex((row) => row.id === match.id)] = record;
    applied.push({
      id: match.id,
      fixtureId: String(fixtureId),
      score: result.score.toFixed(2),
      swapped: result.sidesSwapped
    });
  }

  console.log(`\nEşleşen: ${applied.length} | Çözülemeyen: ${unresolved.length}`);
  applied.forEach((row) => console.log(`  + ${row.id} -> ${row.fixtureId} (benzerlik ${row.score}${row.swapped ? ", taraflar ters" : ""})`));
  unresolved.forEach((row) => console.log(`  ? ${row.id}: ${row.why}`));

  if (!applied.length) {
    console.log("\nYazılacak değişiklik yok.");
    return;
  }

  if (!args.apply) {
    console.log("\nYazmak için --apply ile çalıştır.");
    return;
  }

  atomicWrite(MATCHES_PATH, next);
  if (fs.existsSync(path.dirname(PUBLIC_MATCHES_PATH))) atomicWrite(PUBLIC_MATCHES_PATH, next);

  const after = coverageReport(next, API_FOOTBALL);
  console.log(`\nYazıldı. API-Football kimlik kapsamı (sonra): ${after.covered}/${after.total} (%${after.percent})`);
}

main().catch((error) => {
  console.error("backfill-provider-ids başarısız:", error.message);
  process.exitCode = 1;
});
