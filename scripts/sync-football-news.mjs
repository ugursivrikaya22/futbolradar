#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { validateTickerItem } = require("../services/newsTicker.js");

const root = process.cwd();
const OUTPUT_PATH = path.join(root, "data", "news-ticker.json");
const PUBLIC_OUTPUT_PATH = path.join(root, "public", "data", "news-ticker.json");
const REQUEST_TIMEOUT_MS = 12_000;
const REQUEST_RETRIES = 2;
const MAX_AUTOMATED_ITEMS = 18;
const MAX_AGE_MS = 96 * 60 * 60 * 1000;

const OFFICIAL_DOMAINS = [
  "galatasaray.org", "fenerbahce.org", "bjk.com.tr", "trabzonspor.org.tr",
  "tff.org", "uefa.com", "fifa.com"
];
const TRUSTED_DOMAINS = [
  ...OFFICIAL_DOMAINS, "aa.com.tr", "trtspor.com.tr", "bbc.co.uk", "bbc.com",
  "reuters.com", "apnews.com"
];

function googleNewsUrl(query, language = "tr") {
  const locale = language === "en" ? { hl: "en-GB", gl: "GB", ceid: "GB:en" } : { hl: "tr", gl: "TR", ceid: "TR:tr" };
  const params = new URLSearchParams({ q: query, ...locale });
  return `https://news.google.com/rss/search?${params.toString()}`;
}

const DEFAULT_FEEDS = [
  { id: "galatasaray", team: "Galatasaray", priority: 1, url: googleNewsUrl("Galatasaray futbol site:galatasaray.org") },
  { id: "fenerbahce", team: "Fenerbahçe", priority: 2, url: googleNewsUrl("Fenerbahçe futbol site:fenerbahce.org") },
  { id: "besiktas", team: "Beşiktaş", priority: 3, url: googleNewsUrl("Beşiktaş futbol site:bjk.com.tr") },
  { id: "trabzonspor", team: "Trabzonspor", priority: 4, url: googleNewsUrl("Trabzonspor futbol site:trabzonspor.org.tr") },
  { id: "super-lig", team: "Süper Lig", priority: 5, url: googleNewsUrl("Süper Lig futbol site:tff.org") },
  { id: "turkish-football", team: "Türk futbolu", priority: 6, url: googleNewsUrl("Türk futbolu UEFA site:aa.com.tr") },
  { id: "uefa", team: "Avrupa futbolu", priority: 7, url: googleNewsUrl("UEFA football site:uefa.com", "en") }
];

function decodeXml(value) {
  return String(value || "")
    .replace(/^<!\[CDATA\[|\]\]>$/g, "")
    .replace(/&#(x?[0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code.replace(/^x/i, ""), /^x/i.test(code) ? 16 : 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .trim();
}

function tagValue(block, tag) {
  const match = String(block).match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function sourceFromBlock(block) {
  const match = String(block).match(/<source(?:\s+url=["']([^"']+)["'])?[^>]*>([\s\S]*?)<\/source>/i);
  return match ? { url: decodeXml(match[1]), name: decodeXml(match[2]) } : { url: "", name: "" };
}

export function parseRss(xml, feed = {}) {
  const blocks = [...String(xml || "").matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((match) => match[2]);
  return blocks.map((block) => {
    const source = sourceFromBlock(block);
    const atomLink = String(block).match(/<link\s+[^>]*href=["']([^"']+)["'][^>]*\/?\s*>/i);
    return {
      title: tagValue(block, "title"),
      link: tagValue(block, "link") || decodeXml(atomLink && atomLink[1]),
      guid: tagValue(block, "guid") || tagValue(block, "id"),
      publishedAt: tagValue(block, "pubDate") || tagValue(block, "published") || tagValue(block, "updated"),
      sourceName: source.name || feed.name || feed.id || "Football news feed",
      sourceUrl: source.url || feed.sourceUrl || feed.url || "",
      feed
    };
  }).filter((item) => item.title && item.link && !Number.isNaN(Date.parse(item.publishedAt)));
}

function hostname(value) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function domainAllowed(domain, allowed) {
  return allowed.some((entry) => domain === entry || domain.endsWith(`.${entry}`));
}

function isOfficial(item) {
  return domainAllowed(hostname(item.sourceUrl), OFFICIAL_DOMAINS);
}

function isTrusted(item) {
  return item.feed.trusted === true || domainAllowed(hostname(item.sourceUrl), TRUSTED_DOMAINS);
}

/**
 * BAŞKA BRANŞ, BAŞKA SİTE.
 *
 * Beslemeler kulüplerin resmî sitelerine daraltılmış ("site:galatasaray.org")
 * ama o siteler çok şubeli: basketbol, voleybol, atletizm... Google bunları
 * ayırmıyor, dolayısıyla bir FUTBOL bandına "Erkek Basketbol Takımımız yeni
 * sezon hazırlıklarına başlıyor" ve basketbol transferleri düşüyordu.
 * Okuyucu için bu yanlış bilgi değil, ALAKASIZ bilgi — ama bant "gündem"
 * diyorsa gündemi futbol olmalı.
 *
 * Eleme YALNIZCA başlık üzerinden ve açık işaretlerle yapılır: branş adları
 * ve kulüplerin futbol dışı takım markaları. Gövde metnine bakılmaz, çünkü
 * bir futbol haberinde geçen "basketbol" kelimesi haberi basketbol yapmaz.
 */
const OTHER_SPORT_PATTERNS = [
  /basketbol/i,
  /voleybol/i,
  /hentbol/i,
  /atletizm/i,
  /\batlet(?:ler|imiz|leri)?\b/i,
  /yelken/i,
  /\bboks\b/i,
  /yüzme/i,
  /masa tenisi/i,
  /buz hokeyi/i,
  /satranç/i,
  /\be-?spor/i,
  /badminton/i,
  /\bkürek\b/i,
  /cimnastik|jimnastik/i,
  /tekerlekli sandalye/i,
  /\bgüreş\b/i,
  /taekwondo|karate|\bjudo\b/i,
  /okçuluk|eskrim|halter|triatlon|kürek/i,
  /bisiklet/i,
  /\bşubemiz\b/i,
  // Kulüplerin futbol dışı takım/sponsor markaları.
  /mct technic/i,
  /\bbeko\b/i,
  /daikin/i,
  /eczacıbaşı/i
];

/**
 * Başlıkta hem branş işareti hem "futbol" geçiyorsa haber futboldur
 * ("Futbol Takımımız ... basketbol takımıyla ortak antrenman"). Elemenin
 * kapsamı bilinçli olarak dar: şüphede kalırsa haber BANTTA KALIR, çünkü
 * yanlış eleme gerçek bir futbol haberini gizler.
 */
function isFootballTopic(item) {
  const title = String((item && item.title) || "");
  if (/futbol/i.test(title)) return true;
  return !OTHER_SPORT_PATTERNS.some((pattern) => pattern.test(title));
}

function classify(item) {
  const text = item.title.toLocaleLowerCase("tr-TR");
  if (/transfer|imza|kiral|bonservis/.test(text)) return isOfficial(item) ? "official" : "transfer-rumour";
  if (/sakat|ceza|kadro|ilk 11|lineup/.test(text)) return "squad-update";
  if (/maç sonucu|mac sonucu|full.?time|final score/.test(text)) return "post-match";
  return isOfficial(item) ? "official" : "club-agenda";
}

function automatedId(item) {
  const input = item.guid || `${item.sourceUrl}|${item.link}|${item.title}`;
  return `auto-news-${crypto.createHash("sha256").update(input).digest("hex").slice(0, 20)}`;
}

export function toTickerItem(item) {
  const official = isOfficial(item);
  return {
    id: automatedId(item),
    category: classify(item),
    confidence: official ? "confirmed" : "reported",
    section: /transfer|imza|kiral|bonservis/i.test(item.title) ? "transfer" : "news",
    text: item.title.replace(/\s+-\s+[^-]+$/, "").trim(),
    team: item.feed.team || null,
    timestamp: new Date(item.publishedAt).toISOString(),
    // `url` toplayıcı üzerinden yazının kendisine gider; `publisher` ise
    // haberin gerçekte hangi kurumda yayımlandığını kayıtta tutar. İkisi
    // ayrı durur ki kaydı okuyan (ya da denetleyen) kimse bağlantının
    // hedefiyle kaynağın kimliğini birbirine karıştırmasın.
    source: { name: item.sourceName, url: item.link, publisher: hostname(item.sourceUrl) || null },
    automation: { source: "rss", feed: item.feed.id || item.feed.url, priority: item.feed.priority || 99 }
  };
}

function configuredFeeds() {
  const raw = String(process.env.FOOTBALL_NEWS_FEEDS || "").trim();
  if (!raw) return DEFAULT_FEEDS;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) throw new Error("expected a non-empty JSON array");
    return parsed.map((feed, index) => ({ priority: index + 1, trusted: true, ...feed }));
  } catch (error) {
    throw new Error(`FOOTBALL_NEWS_FEEDS is invalid: ${error.message}`);
  }
}

async function fetchText(url) {
  let lastError;
  for (let attempt = 1; attempt <= REQUEST_RETRIES + 1; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt <= REQUEST_RETRIES) await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function comparable(items) {
  return JSON.stringify((items || []).map((item) => ({ ...item, automation: item.automation || undefined })));
}

export function mergeNewsItems(payload, incoming, options = {}) {
  const nowMs = options.nowMs || Date.now();
  const existing = Array.isArray(payload && payload.items) ? payload.items : [];
  const curated = existing.filter((item) => !item.automation);
  // Branş süzgeci saklanan kayıtlara da uygulanır. Yalnızca girişte süzmek,
  // süzgeç eklenmeden önce banda düşmüş basketbol/voleybol başlıklarının
  // raf ömrü dolana kadar orada kalması demekti.
  const retainedAutomated = existing.filter((item) =>
    item.automation &&
    nowMs - Date.parse(item.timestamp) <= MAX_AGE_MS &&
    isFootballTopic({ title: item.text }));
  const byId = new Map(retainedAutomated.map((item) => [item.id, item]));
  for (const item of incoming || []) byId.set(item.id, item);
  const automated = [...byId.values()]
    .filter((item) => nowMs - Date.parse(item.timestamp) <= MAX_AGE_MS)
    .sort((left, right) => Number(left.automation.priority) - Number(right.automation.priority) || String(right.timestamp).localeCompare(String(left.timestamp)))
    .slice(0, MAX_AUTOMATED_ITEMS);
  const items = [...automated, ...curated];
  return { items, changed: comparable(items) !== comparable(existing), automated: automated.length, curated: curated.length };
}

export async function synchronizeFootballNews(options = {}) {
  const feeds = options.feeds || configuredFeeds();
  const now = options.now || new Date();
  const errors = [];
  const candidates = [];
  let checked = 0;

  for (const feed of feeds) {
    try {
      const xml = options.fetchText ? await options.fetchText(feed.url, feed) : await fetchText(feed.url);
      checked += 1;
      candidates.push(...parseRss(xml, feed).slice(0, 5));
    } catch (error) {
      errors.push({ source: feed.id || feed.url, message: error.message });
    }
  }
  if (!checked) throw new Error(`All football news feeds failed: ${errors.map((item) => item.source).join(", ")}`);

  const cutoff = now.getTime() - MAX_AGE_MS;
  const accepted = [];
  const seen = new Set();
  for (const candidate of candidates
    .filter((item) => Date.parse(item.publishedAt) >= cutoff && isTrusted(item) && isFootballTopic(item))
    .sort((left, right) => Number(left.feed.priority || 99) - Number(right.feed.priority || 99) || Date.parse(right.publishedAt) - Date.parse(left.publishedAt))) {
    const tickerItem = toTickerItem(candidate);
    const verdict = validateTickerItem(tickerItem);
    if (!verdict.valid || seen.has(tickerItem.id)) continue;
    seen.add(tickerItem.id);
    accepted.push(tickerItem);
  }

  const previous = options.previous || JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf8"));
  const merged = mergeNewsItems(previous, accepted, { nowMs: now.getTime() });
  return {
    output: merged.changed ? { ...previous, updatedAt: now.toISOString(), items: merged.items } : previous,
    summary: { source: "rss", feedsChecked: checked, candidates: candidates.length, accepted: accepted.length, updated: merged.changed ? accepted.length : 0, errors },
    changed: merged.changed
  };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const result = await synchronizeFootballNews();
  if (apply && result.changed) {
    atomicWrite(OUTPUT_PATH, result.output);
    if (fs.existsSync(path.dirname(PUBLIC_OUTPUT_PATH))) atomicWrite(PUBLIC_OUTPUT_PATH, result.output);
  }
  console.log(`[football-news] feeds=${result.summary.feedsChecked} candidates=${result.summary.candidates} accepted=${result.summary.accepted} errors=${result.summary.errors.length}`);
  if (!result.changed) console.log("[football-news] No news item changed; the curated ticker file was not rewritten.");
  else if (!apply) console.log("[football-news] Dry run; use --apply to persist changes.");
  console.log(`FUTBOLRADAR_STEP_SUMMARY ${JSON.stringify(result.summary)}`);
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch((error) => {
    console.error(`[football-news] ${error.message}`);
    process.exitCode = 1;
  });
}
