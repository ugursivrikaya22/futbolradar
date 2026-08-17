/**
 * ÇOK-LİGLİ REGİSTRY ÇÖZÜMLEYİCİ
 *
 * data/competitions.json'daki her kaydı services/leagueRegistry.js ile
 * sağlayıcıya doğrulatır (bkz. o dosyanın başındaki açıklama). Bu script
 * SADECE raporlar; dosyayı yalnızca --apply verildiğinde yazar. Anahtar
 * yoksa (yerel ortam gibi) net bir mesajla çıkar, mevcut dosyaya dokunmaz —
 * scripts/preflight-api-football.mjs ile aynı davranış.
 *
 * KULLANIM
 *   node scripts/resolve-league-registry.mjs            # yalnızca rapor
 *   node scripts/resolve-league-registry.mjs --apply     # competitions.json'ı güncelle
 *   node scripts/resolve-league-registry.mjs --json      # makine okunur çıktı
 *
 * Yalnızca "resolved" sonuçlar uygulanır. Belirsiz/eksik kalan kayıtlar
 * dokunulmadan "pending" olarak kalır — tahmin edilmez.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { resolveLeagueRegistry } = require("../services/leagueRegistry.js");
const apiFootballProvider = require("../services/providers/apiFootballProvider.js");

const args = new Set(process.argv.slice(2));
const wantApply = args.has("--apply");
const asJson = args.has("--json");

const DATA_PATH = path.join(process.cwd(), "data", "competitions.json");
const PUBLIC_DATA_PATH = path.join(process.cwd(), "public", "data", "competitions.json");

function line(text = "") {
  if (!asJson) console.log(text);
}

const REASON_LABELS = {
  "no-api-key": "anahtar yok",
  "id-not-found": "kayıtlı kimlik sağlayıcıda bulunamadı",
  "ambiguous-match": "birden fazla aday — belirsiz",
  "no-match": "sağlayıcıda eşleşme yok",
  "provider-error": "sağlayıcı hatası"
};

function reasonLabel(reason) {
  if (!reason) return "";
  const [base] = String(reason).split(":");
  return REASON_LABELS[base] || reason;
}

function applyResults(results) {
  const catalog = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  const byId = new Map(results.map((result) => [result.catalogId, result]));
  let updatedCount = 0;

  const next = catalog.map((entry) => {
    const result = byId.get(entry.id);
    if (!result || result.status !== "resolved") return entry;

    updatedCount += 1;
    return {
      ...entry,
      providers: { ...entry.providers, apiFootball: Number(result.leagueId) },
      logo: result.logo,
      coverage: result.coverage,
      resolvedAt: result.resolvedAt || new Date().toISOString(),
      resolvedSeason: result.currentSeasonYear || null,
      source: "api-football:/leagues"
    };
  });

  const serialized = `${JSON.stringify(next, null, 2)}\n`;
  fs.writeFileSync(DATA_PATH, serialized, "utf8");
  fs.mkdirSync(path.dirname(PUBLIC_DATA_PATH), { recursive: true });
  fs.writeFileSync(PUBLIC_DATA_PATH, serialized, "utf8");

  return updatedCount;
}

async function main() {
  const config = apiFootballProvider.getConfig();

  line("Çok-ligli registry çözümleyici");
  line("-------------------------------");

  if (!apiFootballProvider.hasConfig()) {
    line("  Anahtar tanımlı değil — hiçbir kayıt çözülemedi, competitions.json değiştirilmedi.");
    if (asJson) {
      console.log(JSON.stringify({ ready: false, reason: "no-api-key", results: [] }, null, 2));
    }
    if (process.env.GITHUB_ACTIONS === "true") {
      console.log("::warning::API-Football yapılandırması eksik; lig registry çözümlemesi atlandı.");
    }
    process.exitCode = 1;
    return;
  }

  line(`  Sezon: ${config.season}`);
  line("");

  const { resolvedAt, results } = await resolveLeagueRegistry();

  const resolved = results.filter((result) => result.status === "resolved");
  const unavailable = results.filter((result) => result.status !== "resolved");

  for (const result of results) {
    if (result.status === "resolved") {
      line(`  ✓ ${result.catalogId.padEnd(24)} ${result.leagueId} — ${result.leagueName} (${result.country}) [${result.mode}]`);
    } else {
      line(`  ✗ ${result.catalogId.padEnd(24)} ${reasonLabel(result.reason)}`);
      if (result.candidates && result.candidates.length) {
        result.candidates.slice(0, 8).forEach((candidate) => {
          line(`      aday: ${candidate.id}  ${candidate.name} (${candidate.country})`);
        });
      }
    }
  }

  line("");
  line(`  Çözülen: ${resolved.length}/${results.length}, çözülemeyen: ${unavailable.length}`);

  let updatedCount = 0;
  if (wantApply) {
    updatedCount = applyResults(resolved);
    line(`  competitions.json güncellendi (${updatedCount} kayıt).`);
  } else {
    line("  --apply verilmedi, competitions.json değiştirilmedi (yalnızca rapor).");
  }

  if (asJson) {
    console.log(JSON.stringify({
      ready: true,
      resolvedAt,
      resolvedCount: resolved.length,
      totalCount: results.length,
      applied: wantApply,
      updatedCount,
      results
    }, null, 2));
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    const summaryLines = [
      "### Lig registry çözümlemesi",
      "",
      `Çözülen: ${resolved.length}/${results.length}`,
      "",
      ...resolved.map((result) => `- ✓ \`${result.catalogId}\` → ${result.leagueId} (${result.leagueName})`),
      ...unavailable.map((result) => `- ✗ \`${result.catalogId}\` — ${reasonLabel(result.reason)}`)
    ];
    try {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summaryLines.join("\n")}\n`, "utf8");
    } catch {
      /* Özet yazılamazsa çözümleme yine de tamamlanmış sayılır. */
    }
  }

  process.exitCode = 0;
}

main().catch((error) => {
  const message = error && error.message ? error.message : String(error);
  console.error(`Registry çözümlemesi beklenmedik şekilde başarısız oldu: ${message}`);
  if (process.env.GITHUB_ACTIONS === "true") {
    console.log(`::warning::Lig registry çözümlemesi çöktü: ${message.slice(0, 200)}`);
  }
  process.exitCode = 1;
});
