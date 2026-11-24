/**
 * Dünya futbolu başlıklarını açık RSS akışlarından banda hazırlar.
 *
 *   node scripts/sync-world-football-ticker.mjs            kuru koşu, yazmaz
 *   node scripts/sync-world-football-ticker.mjs --apply    data/news-ticker.json
 *
 * Çeviri için FUTBOLRADAR_TICKER_TRANSLATE_URL tanımlanabilir. Tanımlı
 * değilse başlık kaynağın dilinde kalır ve dil etiketi taşır; uydurma
 * Türkçe cümle yazılmaz. Skorlar bu betikte üretilmez: bant, mevcut
 * API-Football önbelleğini (data/fixture-calendar.json) okur.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseRss } from "./sync-football-news.mjs";
import {
  TRANSLATE_URL_ENV,
  WORLD_FEEDS,
  WORLD_SKIPPED,
  apiFootballScoreItems,
  buildWorldItems,
  mergeWorldItems
} from "./lib/worldFootballTicker.mjs";

const root = process.cwd();
const OUTPUT_PATH = path.join(root, "data", "news-ticker.json");
const PUBLIC_OUTPUT_PATH = path.join(root, "public", "data", "news-ticker.json");

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
      "user-agent": "FutbolRadarTicker/1.0 (+https://www.futbolradar.com; rss)"
    },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function readPayload() {
  try {
    return JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf8"));
  } catch {
    return { items: [] };
  }
}

export async function runWorldTicker(options = {}) {
  const feeds = options.feeds || WORLD_FEEDS;
  const fetchImpl = options.fetchText || fetchText;
  const now = options.now || new Date();
  const errors = [];
  const entries = [];
  for (const feed of feeds) {
    try {
      const xml = await fetchImpl(feed.url, feed);
      const parsed = parseRss(xml, feed).map((item) => ({ ...item, feed }));
      entries.push(...parsed);
    } catch (error) {
      errors.push({ id: feed.id, message: error.message });
    }
  }
  const built = await buildWorldItems(entries, { nowMs: now.getTime(), url: options.translateUrl });
  const previous = options.previous || readPayload();
  const merged = mergeWorldItems(previous, built.items);
  const changed = JSON.stringify(previous.items || []) !== JSON.stringify(merged.items);
  return {
    items: built.items,
    rejected: built.rejected,
    errors,
    skipped: WORLD_SKIPPED,
    merged,
    changed,
    translateConfigured: Boolean(String(options.translateUrl || process.env[TRANSLATE_URL_ENV] || "").trim())
  };
}

function printResult(result) {
  console.log(`[world-ticker] çeviri ucu: ${result.translateConfigured ? "tanımlı" : `${TRANSLATE_URL_ENV} yok, başlıklar kaynak dilinde`}`);
  for (const feed of WORLD_SKIPPED) console.log(`[world-ticker] atlandı ${feed.name}: ${feed.reason}`);
  for (const error of result.errors) console.log(`[world-ticker] besleme hatası ${error.id}: ${error.message}`);
  console.log(`[world-ticker] yayına hazır ${result.items.length}, elenen ${result.rejected.length}`);
  let scores = [];
  try {
    const calendar = JSON.parse(fs.readFileSync(path.join(root, "data", "fixture-calendar.json"), "utf8"));
    scores = apiFootballScoreItems(calendar.matches || [], { nowMs: Date.now() });
  } catch {
    scores = [];
  }
  console.log(`[world-ticker] API-Football skoru (son 48 saat, TheSportsDB hariç): ${scores.length}`);
  for (const score of scores) console.log(`  - [skor] ${score.text} kaynak: API-Football ${score.href}`);
  for (const item of result.items) {
    console.log(`  - [${item.confidence}] ${item.text}`);
    console.log(`    kaynak: ${item.source.name} ${item.source.url}`);
    if (item.en && item.en.text) console.log(`    en: ${item.en.text}`);
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const result = await runWorldTicker();
  printResult(result);
  if (!apply) {
    console.log(result.changed ? "[world-ticker] kuru koşu: yazılmadı (--apply ile uygulayın)." : "[world-ticker] kuru koşu: değişiklik yok.");
    return;
  }
  if (!result.changed) {
    console.log("[world-ticker] içerik değişmedi, dosya yazılmadı.");
    return;
  }
  const next = { ...result.merged, updatedAt: new Date().toISOString() };
  const serialized = `${JSON.stringify(next, null, 2)}\n`;
  fs.writeFileSync(OUTPUT_PATH, serialized, "utf8");
  if (fs.existsSync(path.dirname(PUBLIC_OUTPUT_PATH))) fs.writeFileSync(PUBLIC_OUTPUT_PATH, serialized, "utf8");
  console.log("[world-ticker] yazıldı: data/news-ticker.json");
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch((error) => {
    console.error(`[world-ticker] ${error.message}`);
    process.exitCode = 1;
  });
}
