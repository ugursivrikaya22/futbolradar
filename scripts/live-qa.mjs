import fs from "node:fs";
import path from "node:path";

const baseUrl = (process.argv[2] || process.env.FUTBOLRADAR_BASE_URL || "https://www.futbolradar.com").replace(/\/+$/, "");
const root = process.cwd();
const players = JSON.parse(fs.readFileSync(path.join(root, "data", "players.json"), "utf8"));
const playerProfilePages = players.map((player) => `/oyuncular/${player.id}.html`);
const playerRewritePages = players.map((player) => `/oyuncular/${player.id}`);
const comparisonPagesDir = path.join(root, "karsilastirma");
const playerComparisonPages = fs.existsSync(comparisonPagesDir)
  ? fs.readdirSync(comparisonPagesDir).filter((file) => file.endsWith(".html")).sort().map((file) => `/karsilastirma/${file}`)
  : [];
const playerComparisonRewritePages = playerComparisonPages.map((page) => page.replace(/\.html$/, ""));
const pages = [
  "/",
  "/puan-durumu.html",
  "/takimlar.html",
  "/takim-detay.html",
  "/oyuncu-radari.html",
  "/oyuncu-karsilastir.html",
  "/oyuncu-karsilastirmalari.html",
  "/oyuncu-detay.html",
  "/mac-detay.html",
  "/super-lig-fikstur.html",
  "/bugunku-mac-tahminleri.html",
  "/gol-kralligi.html",
  "/asist-kralligi.html",
  "/derbi-radari.html",
  "/haftanin-maclari.html",
  "/mac-merkezi.html",
  "/oyuncu-liderleri.html",
  "/takim-trendleri.html",
  "/futbol-radar-rehberi.html",
  "/players/position/forvet.html",
  "/players/league/super-lig.html",
  "/oyuncular/forvetler.html",
  "/oyuncular/kaleciler.html",
  "/oyuncular/defanslar.html",
  "/oyuncular/orta-sahalar.html",
  "/oyuncular/genc-yetenekler.html",
  "/oyuncular/en-iyi-oyuncular.html",
  ...playerProfilePages,
  ...playerComparisonPages,
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
  "/oyuncu-karsilastirmalari",
  ...playerRewritePages,
  ...playerComparisonRewritePages
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
const hiddenSourceLabels = [
  "Veri kaynağı",
  "Veri kaynagi",
  "FutbolRadar API",
  "Statik yedek veri"
];
const appFeatureMarkers = [
  "scoutingSnapshotHtml",
  "playerWatchChecklistHtml",
  "profileCompareHubHtml",
  "profileCompareCandidateCardHtml",
  "compareInsightCardsHtml",
  "teamPlayerSpotlightHtml",
  "teamCardLeaderHtml",
  "matchActionPanelHtml",
  "matchEmptyStateHtml",
  "featured-match-actions",
  "playerScoutingSummary",
  "playerPositionGroup",
  "bestComparePeer",
  "ensureCompareGuide",
  "comparePresetDefinitions",
  "renderLandingInsights",
  "player-signal-actions",
  "initHomeSearch",
  "data-home-search"
];
const cssFeatureMarkers = [
  "scouting-summary-grid",
  "watch-check-card",
  "profile-compare-card",
  "profile-compare-grid",
  "static-profile-links",
  "static-profile-link-card",
  "static-comparison-summary",
  "comparison-mini-card",
  "comparison-index-grid",
  "comparison-index-card",
  "compare-insight-card",
  "team-player-spotlight-card",
  "team-card-player",
  "match-action-card",
  "match-empty-actions",
  "featured-match-actions",
  "compare-guide",
  "compare-quick-links",
  "compare-preset-card",
  "landing-insight-card",
  "player-signal-actions",
  "player-radar-hero",
  "player-radar-metrics",
  "comparison-hub-strip",
  "comparison-hub-card",
  "player-filter-panel",
  "player-rating-badge",
  "radar-mini-bars",
  "radar-mini-bar",
  "player-status-badge",
  "player-empty-state",
  "player-trust-note",
  "player-quick-links",
  "traffic-hub",
  "traffic-card",
  "traffic-route-chip",
  "live-pulse",
  "traffic-deep-links",
  "traffic-player-card",
  "traffic-mini-link",
  "traffic-fixture-note",
  "home-search-section",
  "home-search-card",
  "home-search-results",
  "home-directory",
  "home-directory-panel",
  "home-intelligence-board",
  "home-leader-row",
  "home-flow-list",
  "home-team-corridor",
  "home-agenda-hub",
  "home-agenda-card",
  "home-agenda-actions",
  "home-radar-ticker",
  "radar-ticker-track",
  "home-match-command",
  "home-player-leagues",
  "home-rivalry-wall",
  "intent-card-grid",
  "intent-player-card",
  "intent-link-grid",
  "home-explore-lab",
  "explore-lab-grid",
  "explore-lab-card",
  "intent-stack-grid",
  "intent-stack-card",
  "intent-chip-row"
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

function hasHiddenSourceLabel(text) {
  return hiddenSourceLabels.some((marker) => String(text || "").includes(marker));
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
    expect(!hasHiddenSourceLabel(text), `${page}: hidden source label should not be visible`);

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

    if (asset === "/app.js") {
      for (const marker of appFeatureMarkers) {
        expect(text.includes(marker), `${asset}: missing player feature marker ${marker}`);
      }
    }

    if (asset === "/page.css") {
      for (const marker of cssFeatureMarkers) {
        expect(text.includes(marker), `${asset}: missing player CSS marker ${marker}`);
      }
    }

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
      expect(typeof diagnostics.credentialEnvCount === "number", `${endpoint}: missing credential env count`);
      expect(typeof diagnostics.baseUrlEnvCount === "number", `${endpoint}: missing base URL env count`);
      expect(typeof diagnostics.competitionEnvCount === "number", `${endpoint}: missing competition env count`);
      expect(!hasSecretLeak(JSON.stringify(diagnostics)), `${endpoint}: secret marker found in diagnostics`);
    }

    if (endpoint === "/api/players") {
      const firstPlayer = payload?.data?.[0] || {};
      const requiredPlayerFields = [
        "height",
        "heightCm",
        "weight",
        "age",
        "computedAge",
        "birthDate",
        "nationality",
        "currentTeam",
        "team",
        "league",
        "position",
        "secondaryPosition",
        "preferredFoot",
        "marketValue",
        "marketValueEur",
        "contractUntil",
        "formerTeams",
        "transferHistory",
        "dataStatus",
        "ratingStatus",
        "sourceNote",
        "transferUpdatedAt",
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
      const kerem = payload.data.find((player) => player.id === "kerem-akturkoglu");
      expect(kerem && kerem.currentTeam === "Fenerbahçe", `${endpoint}: Kerem currentTeam must be Fenerbahçe`);
      expect(
        kerem && Array.isArray(kerem.formerTeams) && kerem.formerTeams.includes("Galatasaray"),
        `${endpoint}: Kerem formerTeams must include Galatasaray`
      );
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
