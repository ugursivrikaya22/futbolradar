import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildBreakingNewsFeed, isAllowedSource } = require("../services/newsIngestionService.js");

assert.equal(isAllowedSource("https://example.invalid/feed", "unknown"), false, "allowlist dışı kaynak kabul edilmemeli");
const items = buildBreakingNewsFeed(new Date("2026-08-03T12:00:00.000Z"));
assert.ok(Array.isArray(items));
for (const item of items) {
  assert.ok(item.id && item.headline && item.time && item.source && item.source.url, "haber şeması eksiksiz olmalı");
  assert.ok(["verified", "reported", "rumour"].includes(item.status), "haber durumu açıkça belirtilmeli");
}
console.log("News ingestion tests passed (allowlist, normalized breaking-news schema).");
