import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { curatedMatches } = require("../services/providers/mockProvider.js");

const pages = ["mac-sonuclari.html", "bugunun-maclari.html", "canli-skor.html", "analizler.html"];
const prohibitedCopy = [
  /\bbahis\b/iu,
  /\bkupon\b/iu,
  /\biddaa\b/iu,
  /\bodds\b/iu,
  /\btahmin(?:i|ler|leri)?\b/iu,
  /kazanma (?:oranı|yüzdesi|olasılığı)/iu,
  /gol potansiyeli/iu
];

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function hasCompleteScore(match) {
  return Number.isFinite(Number(match && match.score && match.score.home)) &&
    Number.isFinite(Number(match && match.score && match.score.away));
}

function verifiedFinal(match) {
  return String(match && match.status || "").toUpperCase() === "FINISHED" &&
    hasCompleteScore(match) &&
    String(match.dataStatus || "").toLowerCase() === "verified" &&
    String(match.publishState || "").toLowerCase() === "complete";
}

for (const page of pages) {
  const html = read(page);
  const title = (html.match(/<title>([^<]+)<\/title>/i) || [])[1] || "";
  const description = (html.match(/<meta\s+name="description"\s+content="([^"]+)"/i) || [])[1] || "";
  const h1Count = (html.match(/<h1\b/gi) || []).length;

  assert.ok(title.length >= 30 && title.length <= 65, `${page}: SEO title length must be 30-65 characters`);
  assert.ok(description.length >= 100 && description.length <= 170, `${page}: meta description length must be 100-170 characters`);
  assert.equal(h1Count, 1, `${page}: exactly one H1 is required`);
  assert.match(html, /class="[^"]*ad-search-page/, `${page}: informational landing class missing`);
  assert.match(html, /data-futbolradar-ga4/, `${page}: analytics tag missing`);
  assert.doesNotMatch(html, /G-XXXXXXXXXX/, `${page}: placeholder analytics ID must not ship`);

  for (const pattern of prohibitedCopy) {
    assert.doesNotMatch(html, pattern, `${page}: gambling-adjacent copy found: ${pattern}`);
  }
}

for (const page of ["bugunun-maclari.html", "canli-skor.html"]) {
  const html = read(page);
  assert.match(html, /performance-loader\.js/, `${page}: deferred application loader missing`);
  assert.doesNotMatch(html, /<script\s+src="\.\/app\.js"/, `${page}: app.js must not block initial parse`);
}

for (const page of ["mac-sonuclari.html", "analizler.html"]) {
  assert.doesNotMatch(read(page), /performance-loader\.js|<script\s+src="\.\/app\.js"/, `${page}: static landing must not load the heavy app bundle`);
}

const verifiedIds = new Set(curatedMatches().filter(verifiedFinal).map((match) => String(match.id)));
const resultHtml = read("mac-sonuclari.html");
const resultIds = [...resultHtml.matchAll(/data-card="verified-result"\s+data-match="([^"]+)"/g)].map((match) => match[1]);
assert.ok(resultIds.length > 0, "mac-sonuclari.html: no verified result cards rendered");
for (const id of resultIds) assert.ok(verifiedIds.has(id), `mac-sonuclari.html: unverified score rendered for ${id}`);
assert.equal((resultHtml.match(/data-match-click(?:\s|>)/g) || []).length, resultIds.length, "every result card must expose one tracked match click");

const analysisHtml = read("analizler.html");
const analysisIds = [...analysisHtml.matchAll(/data-card="post-match"\s+data-match="([^"]+)"/g)].map((match) => match[1]);
assert.ok(analysisIds.length > 0, "analizler.html: no verified post-match cards rendered");
for (const id of analysisIds) assert.ok(verifiedIds.has(id), `analizler.html: unverified final score rendered for ${id}`);

const analytics = read("analytics.js");
assert.match(analytics, /"match_click"/, "analytics.js: GA4 match_click event missing");
assert.match(analytics, /adsId \+ "\/" \+ pageViewLabel/, "analytics.js: Google Ads page-view conversion missing");
assert.match(analytics, /adsId \+ "\/" \+ matchClickLabel/, "analytics.js: Google Ads match-click conversion missing");

const injector = read("scripts/inject-ga4.mjs");
for (const variable of ["GA4_MEASUREMENT_ID", "GOOGLE_ADS_ID", "GOOGLE_ADS_PAGE_VIEW_LABEL", "GOOGLE_ADS_MATCH_CLICK_LABEL"]) {
  assert.ok(injector.includes(variable), `inject-ga4.mjs: ${variable} missing`);
}

const vercel = JSON.parse(read("vercel.json"));
const rewrites = new Map((vercel.rewrites || []).map((item) => [item.source, item.destination]));
assert.equal(rewrites.get("/mac-sonuclari"), "/mac-sonuclari.html", "clean match-results route missing");
const globalHeaders = (vercel.headers || []).find((item) => item.source === "/(.*)");
const csp = ((globalHeaders && globalHeaders.headers) || []).find((item) => item.key === "Content-Security-Policy");
assert.ok(csp && csp.value.includes("https://www.googletagmanager.com"), "CSP must allow Google tag loader");
assert.ok(csp && csp.value.includes("https://www.google-analytics.com"), "CSP must allow GA4 collection");

console.log(`Google Ads landing tests passed (${resultIds.length} verified results, ${analysisIds.length} verified analyses).`);
