import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { recordNewsIngestion } = require("../services/ingestionMonitor.js");
const { isAllowedSource } = require("../services/newsIngestionService.js");
const root = process.cwd();
const apply = process.argv.includes("--apply");
const SOURCES_PATH = path.join(root, "data", "news-sources.json");
const INBOX_PATH = path.join(root, "data", "news-inbox.json");
const TIMEOUT_MS = 7000;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function text(value) {
  return String(value || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function field(fragment, names) {
  for (const name of names) {
    const match = fragment.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
    if (match) return text(match[1]);
  }
  return "";
}

function link(fragment) {
  const atom = fragment.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i);
  if (atom) return atom[1].trim();
  return field(fragment, ["link"]);
}

function slug(value) {
  return text(value).toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

function parseFeed(xml, source) {
  const blocks = xml.match(/<(?:item|entry)(?:\s[^>]*)?>[\s\S]*?<\/(?:item|entry)>/gi) || [];
  return blocks.map((block) => {
    const headline = field(block, ["title"]);
    const url = link(block);
    const rawTime = field(block, ["pubDate", "published", "updated", "date"]);
    const parsed = Date.parse(rawTime);
    if (!headline || !url || Number.isNaN(parsed) || !isAllowedSource(url, source.id)) return null;
    return {
      id: `${source.id}-${slug(url || headline)}`,
      sourceId: source.id,
      headline,
      summary: field(block, ["description", "summary", "content"]).slice(0, 420),
      time: new Date(parsed).toISOString(),
      source: { name: source.name, url },
      category: source.category || "Kulüp Gündemi",
      club: source.club || "",
      // Kaynak allowlist'ine yalnızca resmî yayıncılar `official: true` ile girer.
      status: source.official === true ? "verified" : "reported"
    };
  }).filter(Boolean);
}

async function fetchFeed(source) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(source.feedUrl, { signal: controller.signal, headers: { "user-agent": "FutbolRadar news ingestion/1.0" } });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    return parseFeed(await response.text(), source);
  } finally {
    clearTimeout(timer);
  }
}

const startedAt = Date.now();
const config = readJson(SOURCES_PATH, { sources: [] });
const sources = (Array.isArray(config.sources) ? config.sources : []).filter((source) => source && source.active === true && source.feedUrl);
const existing = readJson(INBOX_PATH, { items: [] });
const byId = new Map((Array.isArray(existing.items) ? existing.items : []).map((item) => [item.id, item]));
let rejected = 0;

for (const source of sources) {
  try {
    for (const item of await fetchFeed(source)) byId.set(item.id, item);
  } catch (error) {
    rejected += 1;
    console.warn(`[news-ingestion] source=${source.id} failed=${String(error.message || error).slice(0, 120)}`);
  }
}

const items = [...byId.values()]
  .filter((item) => Date.now() - Date.parse(item.time) <= 14 * 24 * 60 * 60 * 1000)
  .sort((left, right) => Date.parse(right.time) - Date.parse(left.time))
  .slice(0, 200);
const next = { updatedAt: new Date().toISOString(), items };
const previousComparable = JSON.stringify({ items: existing.items || [] });
const nextComparable = JSON.stringify({ items });

if (apply && previousComparable !== nextComparable) {
  fs.writeFileSync(INBOX_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  console.log(`[news-ingestion] wrote ${items.length} items`);
} else {
  console.log(`[news-ingestion] ${items.length} items; ${apply ? "no content change" : "dry run"}`);
}

recordNewsIngestion({ imported: items.length, rejected, durationMs: Date.now() - startedAt, failed: rejected > 0 && !items.length });
process.exitCode = process.argv.includes("--strict") && rejected ? 1 : 0;
