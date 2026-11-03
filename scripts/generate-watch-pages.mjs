/**
 * /izle/<slug>.html sayfalarını data/youtube-watch.json'dan üretir.
 * Kayıt yoksa hiçbir sayfa üretilmez; listeden çıkan kaydın eski sayfası silinir.
 * Sağlayıcıya istek atılmaz: maç bittiyse final skor mevcut takvim/arşiv verisinden okunur.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { watchPageHtml } from "./lib/youtubeWatchPage.mjs";
import { findFinalResult, resultRowsFrom } from "./lib/enMatchResult.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { loadEntries } = require("../services/youtubeWatch.js");
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(path.join(root, file), "utf8")); } catch { return fallback; } };

const { entries, errors } = loadEntries(readJson("data/youtube-watch.json", { streams: [] }));
for (const error of errors) console.warn(`[izle] kayıt atlandı: ${error}`);
const calendar = readJson("data/fixture-calendar.json", {});
const archive = readJson("data/historical-match-archive.json", {});
const rows = resultRowsFrom(calendar.matches || [], archive.records || []);

const dirs = [path.join(root, "izle"), path.join(root, "public", "izle")];
const expected = new Set(entries.map((e) => `${e.slug}.html`));
for (const dir of dirs) {
  fs.mkdirSync(dir, { recursive: true });
  for (const file of fs.readdirSync(dir)) if (file.endsWith(".html") && !expected.has(file)) fs.unlinkSync(path.join(dir, file));
}
for (const entry of entries) {
  const final = findFinalResult(entry, rows);
  const html = watchPageHtml(entry, final && final.home != null && final.away != null ? final : null);
  for (const dir of dirs) fs.writeFileSync(path.join(dir, `${entry.slug}.html`), html, "utf8");
}
console.log(`Generated ${entries.length} izlerken-skor watch pages`);
