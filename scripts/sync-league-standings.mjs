/**
 * LİG PUAN DURUMU SENKRONU.
 *
 * data/competitions.json'daki, apiFootball kimliği DOĞRULANMIŞ (resolve-
 * league-registry.mjs tarafından çözülmüş) ligler için `/standings`
 * çağrılır ve data/league-standings.json'a yazılır. Coverage nesnesi
 * `standings: false` diyorsa o lig hiç sorgulanmaz — desteklenmeyen bir
 * uç noktayı sorup boş/hata dönmek yerine, coverage'ın kendisi kapıyı
 * kapatır.
 *
 * Yalnızca günlük full koşuya eklenir (bkz. run-scheduled-update.mjs):
 * puan durumu saatlik tazelenmesi gereken bir veri değil.
 *
 * KULLANIM
 *   node scripts/sync-league-standings.mjs --apply
 *   node scripts/sync-league-standings.mjs --apply --json
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const apiFootballProvider = require("../services/providers/apiFootballProvider.js");
const { competitions } = require("../services/competitionCatalog.js");

const args = new Set(process.argv.slice(2));
const wantApply = args.has("--apply");
const asJson = args.has("--json");

const OUT_PATH = path.join(process.cwd(), "data", "league-standings.json");
const PUBLIC_OUT_PATH = path.join(process.cwd(), "public", "data", "league-standings.json");

function line(text = "") {
  if (!asJson) console.log(text);
}

/** Coverage kaydı yoksa (henüz çözülmemiş lig) temkinli davranılır: sorulmaz. */
function standingsSupported(competition) {
  return Boolean(competition.coverage && competition.coverage.standings === true);
}

async function main() {
  line("Lig puan durumu senkronu");
  line("-------------------------");

  if (!apiFootballProvider.hasConfig()) {
    line("  Anahtar tanımlı değil — puan durumu çekilemedi.");
    if (asJson) console.log(JSON.stringify({ ready: false, reason: "no-api-key", leagues: [] }, null, 2));
    process.exitCode = 1;
    return;
  }

  const eligible = competitions.filter((competition) =>
    competition.providers && competition.providers.apiFootball && standingsSupported(competition));

  if (!eligible.length) {
    line("  Coverage'ı 'standings: true' olan doğrulanmış lig yok — bekleniyor.");
  }

  const results = {};
  const errors = [];

  for (const competition of eligible) {
    try {
      const table = await apiFootballProvider.getStandings({ league: competition.providers.apiFootball });
      if (table.length) {
        results[competition.id] = {
          league: competition.name,
          updatedAt: table.map(row => row.fetchedAt).filter(Boolean).sort().at(-1) || null,
          table
        };
        line(`  ✓ ${competition.id.padEnd(24)} ${table.length} takım`);
      } else {
        line(`  · ${competition.id.padEnd(24)} sağlayıcı boş tablo döndürdü, atlandı`);
      }
    } catch (error) {
      const reason = error && error.code ? `provider-error:${error.code}` : "provider-error";
      errors.push({ catalogId: competition.id, reason });
      line(`  ✗ ${competition.id.padEnd(24)} ${reason}`);
    }
  }

  if (wantApply && Object.keys(results).length) {
    // Önceki koşunun verisiyle birleştirilir: bu koşuda hata alan bir lig,
    // önceki başarılı sonucu kaybetmez.
    let previous = {};
    try { previous = JSON.parse(fs.readFileSync(OUT_PATH, "utf8")); } catch { previous = {}; }
    const merged = { ...previous, ...results };
    const serialized = `${JSON.stringify(merged, null, 2)}\n`;
    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, serialized, "utf8");
    fs.mkdirSync(path.dirname(PUBLIC_OUT_PATH), { recursive: true });
    fs.writeFileSync(PUBLIC_OUT_PATH, serialized, "utf8");
    line(`  league-standings.json güncellendi (${Object.keys(results).length} lig).`);
  } else if (!wantApply) {
    line("  --apply verilmedi, dosya değiştirilmedi.");
  }

  if (asJson) {
    console.log(JSON.stringify({
      ready: true,
      eligibleCount: eligible.length,
      updatedCount: Object.keys(results).length,
      errors
    }, null, 2));
  }

  process.exitCode = 0;
}

main().catch((error) => {
  const message = error && error.message ? error.message : String(error);
  console.error(`Puan durumu senkronu beklenmedik şekilde başarısız oldu: ${message}`);
  if (process.env.GITHUB_ACTIONS === "true") {
    console.log(`::warning::Lig puan durumu senkronu çöktü: ${message.slice(0, 200)}`);
  }
  process.exitCode = 1;
});
