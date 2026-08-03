const fs = require("node:fs");
const path = require("node:path");
const { dedupeByMeaning, editorialRank, normalizeTickerItems } = require("./newsTicker");

const DATA_DIR = path.join(process.cwd(), "data");

function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), "utf8"));
  } catch {
    return fallback;
  }
}

function sourceUrls(item) {
  const urls = [];
  if (item && item.url) urls.push(item.url);
  for (const source of Array.isArray(item && item.sources) ? item.sources : []) {
    if (source && source.url) urls.push(source.url);
  }
  return urls.filter((url) => /^https:\/\//i.test(String(url)));
}

function publishedNewsItems(now = new Date()) {
  const news = readJson("news.json", []);
  return (Array.isArray(news) ? news : [])
    .filter((item) => item && item.id && item.title && String(item.status).toLowerCase() === "verified")
    .filter((item) => sourceUrls(item).length && !Number.isNaN(Date.parse(item.publishedAt || "")))
    .map((item) => ({
      id: String(item.id),
      headline: String(item.title),
      summary: String(item.summary || item.spot || ""),
      time: new Date(item.publishedAt).toISOString(),
      source: { name: String(item.sourceName || "FutbolRadar"), url: sourceUrls(item)[0] },
      category: String(item.category || "Gündem"),
      club: String(item.team || ""),
      status: "verified",
      url: String(item.url || ""),
      priority: editorialRank({ team: item.team, competition: item.competition || item.category })
    }))
    .filter((item) => Date.parse(item.time) <= now.getTime());
}

function curatedBreakingItems(now = new Date()) {
  const payload = readJson("news-ticker.json", { items: [] });
  const { items } = normalizeTickerItems(payload, { now });
  return items.map((item) => ({
    id: String(item.id),
    headline: String(item.text),
    summary: "",
    time: new Date(item.at).toISOString(),
    source: { name: String(item.sourceName), url: String(item.href) },
    category: String(item.category),
    club: String(item.team || ""),
    status: item.confidence === "confirmed" ? "verified" : item.confidence,
    url: String(item.href),
    priority: Number(item.rank || 4)
  }));
}

function ingestedNewsItems(now = new Date()) {
  const inbox = readJson("news-inbox.json", { items: [] });
  const rows = Array.isArray(inbox.items) ? inbox.items : [];
  return rows
    .filter((item) => item && item.id && item.headline && item.source && item.source.url)
    .filter((item) => item.status === "verified" && isAllowedSource(item.source.url, item.sourceId))
    .filter((item) => !Number.isNaN(Date.parse(item.time || "")) && Date.parse(item.time) <= now.getTime())
    .map((item) => ({ ...item, priority: editorialRank({ team: item.club, competition: item.category }) }));
}

function buildBreakingNewsFeed(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const candidates = [...publishedNewsItems(now), ...curatedBreakingItems(now), ...ingestedNewsItems(now)];
  const { items } = dedupeByMeaning(candidates.map((item) => ({ ...item, text: item.headline, at: item.time })));
  return items
    .sort((left, right) => Number(left.priority || 4) - Number(right.priority || 4) || Date.parse(right.time) - Date.parse(left.time))
    .slice(0, 20)
    .map(({ text, at, ...item }) => item);
}

function allowedSources() {
  const payload = readJson("news-sources.json", { sources: [] });
  return Array.isArray(payload.sources) ? payload.sources : [];
}

function isAllowedSource(url, source) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    return allowedSources().some((row) => row && row.active === true && row.id === source &&
      hostname === String(row.hostname || "").replace(/^www\./, ""));
  } catch {
    return false;
  }
}

module.exports = { allowedSources, buildBreakingNewsFeed, ingestedNewsItems, isAllowedSource, publishedNewsItems, sourceUrls };
