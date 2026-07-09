import fs from "node:fs";
import path from "node:path";

const baseUrl = (process.argv[2] || process.env.FUTBOLRADAR_BASE_URL || "https://www.futbolradar.com").replace(/\/+$/, "");
const root = process.cwd();
const players = JSON.parse(fs.readFileSync(path.join(root, "data", "players.json"), "utf8"));
const playerProfilePages = players.map((player) => `/oyuncular/${player.id}.html`);
const playerRewritePages = players.map((player) => `/oyuncular/${player.id}`);
const pages = [
  "/",
  "/puan-durumu.html",
  "/takimlar.html",
  "/oyuncu-radari.html",
  "/oyuncu-karsilastir.html",
  "/oyuncu-detay.html",
  "/players/position/forvet.html",
  "/players/league/super-lig.html",
  "/oyuncular/forvetler.html",
  "/oyuncular/kaleciler.html",
  "/oyuncular/defanslar.html",
  "/oyuncular/orta-sahalar.html",
  "/oyuncular/genc-yetenekler.html",
  "/oyuncular/en-iyi-oyuncular.html",
  ...playerProfilePages,
  "/canli-skor.html",
  "/bugunun-maclari.html",
  "/momentum.html",
  "/analizler.html"
];
const rewritePages = [
  "/oyuncular/forvetler",
  "/oyuncular/kaleciler",
  "/oyuncular/defanslar",
  "/oyuncular/orta-sahalar",
  "/oyuncular/genc-yetenekler",
  "/oyuncular/en-iyi-oyuncular",
  ...playerRewritePages
];
const endpoints = ["/api/matches", "/api/standings", "/api/teams", "/api/players", "/api/momentum", "/api/signals", "/api/analyses", "/api/health"];
const staticAssets = ["/sitemap.xml", "/robots.txt", "/page.css", "/app.js", "/site.js", "/site.webmanifest", "/assets/og-image.svg"];
const secretMarkers = [
  "X-Auth-Token",
  "FOOTBALL_API_KEY=",
  "FOOTBALL_DATA_API_KEY=",
  "FOOTBALLDATA_TOKEN=",
  "FOOTBALL_API_TOKEN="
];
const suspiciousCodes = new Set([0x00c2, 0x00c3, 0x00c4, 0x00c5]);
const failures = [];
const summary = [];

function hasMojibake(text) {
  for (const char of String(text || "")) {
    if (suspiciousCodes.has(char.codePointAt(0))) {
      return true;
    }
  }

  return false;
}

function hasSecretLeak(text) {
  return secretMarkers.some((marker) => String(text || "").includes(marker));
}

function expect(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

async function fetchText(path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: {
        "user-agent": "FutbolRadar-Live-QA/1.0"
      },
      signal: controller.signal
    });
    const text = await response.text();
    return { response, text };
  } finally {
    clearTimeout(timeout);
  }
}

function meta(html, selector) {
  return (html.match(selector) || [])[1] || "";
}

function expectedUrl(path) {
  return `${baseUrl}${path === "/" ? "/" : path}`;
}

async function checkPages() {
  const titles = new Set();
  const descriptions = new Set();

  for (const page of pages) {
    const { response, text } = await fetchText(`${page}?v=liveqa`);
    const title = meta(text, /<title>([^<]+)<\/title>/i);
    const description = meta(text, /<meta\s+name="description"\s+content="([^"]+)"/i);
    const canonical = meta(text, /<link\s+rel="canonical"\s+href="([^"]+)"/i);
    const ogUrl = meta(text, /<meta\s+property="og:url"\s+content="([^"]+)"/i);
    const ogImage = meta(text, /<meta\s+property="og:image"\s+content="([^"]+)"/i);

    expect(response.status === 200, `${page}: expected 200, got ${response.status}`);
    expect(Boolean(title), `${page}: missing title`);
    expect(Boolean(description), `${page}: missing description`);
    expect(canonical === expectedUrl(page), `${page}: canonical mismatch`);
    expect(ogUrl === expectedUrl(page), `${page}: og:url mismatch`);
    expect(ogImage === `${baseUrl}/assets/og-image.svg`, `${page}: og:image mismatch`);
    expect(text.includes('name="twitter:card" content="summary_large_image"'), `${page}: missing twitter card`);
    expect(/<link\s+rel="manifest"\s+href="[^"]+"/i.test(text), `${page}: missing manifest link`);
    expect(!hasMojibake(text), `${page}: mojibake marker found`);
    expect(!hasSecretLeak(text), `${page}: secret marker found`);

    if (title) titles.add(title);
    if (description) descriptions.add(description);
    summary.push({ type: "page", path: page, status: response.status, title });
  }

  expect(titles.size === pages.length, "page titles should be unique");
  expect(descriptions.size === pages.length, "meta descriptions should be unique");
}

async function checkStaticAssets() {
  for (const asset of staticAssets) {
    const { response, text } = await fetchText(`${asset}?v=liveqa`);
    expect(response.status === 200, `${asset}: expected 200, got ${response.status}`);
    expect(!hasSecretLeak(text), `${asset}: secret marker found`);
    summary.push({ type: "asset", path: asset, status: response.status });
  }

  const robots = await fetchText("/robots.txt?v=liveqa");
  expect(robots.text.includes(`Sitemap: ${baseUrl}/sitemap.xml`), "robots.txt sitemap URL mismatch");

  const manifest = await fetchText("/site.webmanifest?v=liveqa");
  try {
    const payload = JSON.parse(manifest.text);
    expect(payload.name === "FutbolRadar", "manifest name mismatch");
  } catch (error) {
    failures.push(`manifest JSON parse failed: ${error.message}`);
  }
}

async function checkRewritePages() {
  for (const page of rewritePages) {
    const { response, text } = await fetchText(`${page}?v=liveqa`);
    expect(response.status === 200, `${page}: expected rewritten 200, got ${response.status}`);
    expect(text.includes("<h1>"), `${page}: rewritten page missing h1`);
    expect(!hasSecretLeak(text), `${page}: secret marker found`);
    summary.push({ type: "rewrite", path: page, status: response.status });
  }
}

async function checkApi() {
  for (const endpoint of endpoints) {
    const { response, text } = await fetchText(`${endpoint}?v=liveqa`);
    let payload = null;

    try {
      payload = JSON.parse(text);
    } catch (error) {
      failures.push(`${endpoint}: JSON parse failed ${error.message}`);
    }

    expect(response.status === 200, `${endpoint}: expected 200, got ${response.status}`);
    expect(payload && typeof payload.ok === "boolean", `${endpoint}: missing ok boolean`);
    expect(payload && payload.source, `${endpoint}: missing source`);
    expect(payload && payload.updatedAt, `${endpoint}: missing updatedAt`);
    expect(payload && Array.isArray(payload.data), `${endpoint}: data must be array`);
    expect(response.headers.get("cache-control") === "public, max-age=0", `${endpoint}: browser cache header mismatch`);
    expect(
      response.headers.get("cdn-cache-control") === "public, s-maxage=300, stale-while-revalidate=600",
      `${endpoint}: CDN cache header mismatch`
    );
    expect(!hasSecretLeak(text), `${endpoint}: secret marker found`);

    if (endpoint === "/api/health") {
      const diagnostics = payload?.data?.[0] || {};
      expect(["mock", "live-ready"].includes(diagnostics.mode), `${endpoint}: mode mismatch`);
      expect(Boolean(diagnostics.providerSource), `${endpoint}: missing providerSource`);
      expect(Boolean(diagnostics.nextAction), `${endpoint}: missing nextAction`);
      expect(Array.isArray(diagnostics.acceptedApiKeyEnvNames), `${endpoint}: missing accepted API key env names`);
      expect(!hasSecretLeak(JSON.stringify(diagnostics)), `${endpoint}: secret marker found in diagnostics`);
    }

    if (endpoint === "/api/players") {
      const firstPlayer = payload?.data?.[0] || {};
      const requiredPlayerFields = [
        "height",
        "weight",
        "age",
        "nationality",
        "team",
        "league",
        "position",
        "preferredFoot",
        "marketValue",
        "contractUntil",
        "appearances",
        "goals",
        "assists",
        "minutesPlayed",
        "yellowCards",
        "redCards",
        "passAccuracy",
        "shotsPerGame",
        "tacklesPerGame",
        "interceptionsPerGame",
        "rating",
        "providerId",
        "providerName",
        "lastSyncedAt",
        "overallRating",
        "potentialRating",
        "technicalRating",
        "physicalRating",
        "mentalRating",
        "defensiveRating",
        "attackingRating",
        "passingRating",
        "shootingRating",
        "paceRating",
        "dribblingRating",
        "staminaRating",
        "formRating",
        "lastUpdated"
      ];
      expect(payload.data.length >= 8, `${endpoint}: expected at least 8 player records`);
      for (const field of requiredPlayerFields) {
        expect(Object.prototype.hasOwnProperty.call(firstPlayer, field), `${endpoint}: missing ${field}`);
      }
    }

    summary.push({
      type: "api",
      path: endpoint,
      status: response.status,
      ok: payload?.ok,
      source: payload?.source,
      count: Array.isArray(payload?.data) ? payload.data.length : null
    });
  }

  const invalidDate = await fetchText("/api/matches?date=yanlis&v=liveqa");
  const invalidPayload = JSON.parse(invalidDate.text);
  expect(invalidDate.response.status === 200, "invalid date: expected controlled 200 response");
  expect(invalidPayload.ok === false, "invalid date: should return ok:false");
  expect(invalidPayload.error?.code === "INVALID_DATE", "invalid date: should return INVALID_DATE");
  expect(Array.isArray(invalidPayload.data) && invalidPayload.data.length === 0, "invalid date: data should be empty array");
  expect(!hasSecretLeak(invalidDate.text), "invalid date: secret marker found");
}

async function checkSecurityHeaders() {
  const { response } = await fetchText("/?v=liveqa-headers");
  expect(response.headers.get("x-content-type-options") === "nosniff", "missing x-content-type-options nosniff");
  expect(response.headers.get("referrer-policy") === "strict-origin-when-cross-origin", "missing referrer-policy");
  expect(response.headers.get("x-frame-options") === "SAMEORIGIN", "missing x-frame-options SAMEORIGIN");
  expect((response.headers.get("permissions-policy") || "").includes("camera=()"), "missing permissions-policy");
}

await checkPages();
await checkRewritePages();
await checkStaticAssets();
await checkApi();
await checkSecurityHeaders();

console.log(JSON.stringify({ baseUrl, summary }, null, 2));

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("FutbolRadar live QA passed");
