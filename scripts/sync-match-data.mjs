import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { getMatchDataProvider } = require("../services/providers/index.js");
const { synchronizeMatchDate } = require("../services/matchSyncService.js");
const { validateDateParam } = require("../api/_utils.js");

const date = process.argv[2] || new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Istanbul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
}).format(new Date());
const dateError = validateDateParam(date);
if (dateError) {
  console.error(JSON.stringify({ ok: false, code: "INVALID_DATE", message: dateError }));
  process.exit(1);
}

const cachePath = path.join(root, "data", "matches-cache.json");
const existing = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, "utf8")) : [];

try {
  const result = await synchronizeMatchDate({ provider: getMatchDataProvider("matches"), date, existing });
  const temporaryPath = `${cachePath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(result.records, null, 2) + "\n", "utf8");
  fs.renameSync(temporaryPath, cachePath);
  console.log(JSON.stringify(result.report));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error.code || "MATCH_SYNC_FAILED",
    message: error.message || "Maç senkronizasyonu tamamlanamadı.",
    date
  }));
  process.exit(1);
}
