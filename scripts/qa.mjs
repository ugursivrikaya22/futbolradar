import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { validatePlayerData } = require("../services/playerService.js");
const players = JSON.parse(fs.readFileSync(path.join(root, "data", "players.json"), "utf8"));
const playerProfilePages = players.map((player) => `oyuncular/${player.id}.html`);
const comparisonPagesDir = path.join(root, "karsilastirma");
const playerComparisonPages = fs.existsSync(comparisonPagesDir)
  ? fs.readdirSync(comparisonPagesDir).filter((file) => file.endsWith(".html")).sort().map((file) => `karsilastirma/${file}`)
  : [];
const pages = [
  "index.html",
  "puan-durumu.html",
  "takimlar.html",
  "oyuncu-radari.html",
  "oyuncu-karsilastir.html",
  "oyuncu-karsilastirmalari.html",
  "oyuncu-detay.html",
  "mac-detay.html",
  "takim-detay.html",
  "super-lig-fikstur.html",
  "super-lig-form-durumu.html",
  "super-lig-momentum-siralamasi.html",
  "bugunku-mac-tahminleri.html",
  "super-lig-oyuncu-radari.html",
  "en-iyi-super-lig-oyunculari.html",
  "en-iyi-forvetler.html",
  "en-iyi-orta-sahalar.html",
  "en-iyi-defanslar.html",
  "en-iyi-kaleciler.html",
  "yukselen-oyuncular.html",
  "transfer-radari.html",
  "genc-yetenekler.html",
  "galatasaray-oyuncu-radari.html",
  "fenerbahce-oyuncu-radari.html",
  "besiktas-oyuncu-radari.html",
  "trabzonspor-oyuncu-radari.html",
  "galatasaray-form-durumu.html",
  "fenerbahce-form-durumu.html",
  "besiktas-form-durumu.html",
  "trabzonspor-form-durumu.html",
  "veri-notu.html",
  "gizlilik.html",
  "kullanim-sartlari.html",
  "iletisim.html",
  "hakkinda.html",
  "players/position/forvet.html",
  "players/league/super-lig.html",
  "oyuncular/forvetler.html",
  "oyuncular/kaleciler.html",
  "oyuncular/defanslar.html",
  "oyuncular/orta-sahalar.html",
  "oyuncular/genc-yetenekler.html",
  "oyuncular/en-iyi-oyuncular.html",
  ...playerProfilePages,
  ...playerComparisonPages,
  "canli-skor.html",
  "bugunun-maclari.html",
  "momentum.html",
  "analizler.html"
];
const endpoints = ["matches", "standings", "teams", "players", "player-detail", "player-compare", "player-rankings", "transfers", "squad", "match-detail", "momentum", "signals", "analyses", "health"];
const skipDirs = new Set([".git", ".agents", ".codex", "node_modules", "work", "outputs"]);
const VERCEL_HOBBY_FUNCTION_LIMIT = 12;
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
  "home-team-corridor"
];
const failures = [];

function walk(dir, predicate, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) {
      continue;
    }

    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, predicate, out);
    } else if (predicate(full)) {
      out.push(full);
    }
  }

  return out;
}

function expect(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function apiFunctionFiles() {
  const apiDir = path.join(root, "api");
  return walk(apiDir, (full) => {
    return full.endsWith(".js") && !path.basename(full).startsWith("_");
  }).map((full) => path.relative(root, full).replace(/\\/g, "/"));
}

function checkVercelFunctionLimit() {
  const functionFiles = apiFunctionFiles();
  expect(
    functionFiles.length <= VERCEL_HOBBY_FUNCTION_LIMIT,
    `Vercel Hobby function limit exceeded: ${functionFiles.length}/${VERCEL_HOBBY_FUNCTION_LIMIT}. ` +
    "Move helper/provider files outside api/ or route new API handlers through api/[...route].js."
  );

  const nestedApiFiles = functionFiles.filter((file) => path.dirname(file) !== "api");
  if (nestedApiFiles.length) {
    console.warn(
      `Vercel API warning: nested api/*.js files can be deployed as functions: ${nestedApiFiles.join(", ")}`
    );
  }

  expect(!fs.existsSync(path.join(root, "api", "providers")), "api/providers must stay outside api/ to avoid Vercel function limit");
  expect(fs.existsSync(path.join(root, "services", "providers", "index.js")), "services/providers/index.js missing");
  expect(fs.existsSync(path.join(root, "services", "providers", "mockProvider.js")), "services/providers/mockProvider.js missing");
}

function checkPublicMirrors() {
  for (const file of ["page.css", "app.js", "site.js", "site.webmanifest"]) {
    const rootFile = path.join(root, file);
    const publicFile = path.join(root, "public", file);
    if (!fs.existsSync(rootFile) || !fs.existsSync(publicFile)) {
      continue;
    }

    const rootContent = fs.readFileSync(rootFile, "utf8");
    const publicContent = fs.readFileSync(publicFile, "utf8");
    expect(rootContent === publicContent, `public/${file} must match ${file} for Vercel public output`);
  }
}

function checkFeatureMarkers() {
  const appJs = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const pageCss = fs.readFileSync(path.join(root, "page.css"), "utf8");

  for (const marker of appFeatureMarkers) {
    expect(appJs.includes(marker), `app.js: missing feature marker ${marker}`);
  }

  for (const marker of cssFeatureMarkers) {
    expect(pageCss.includes(marker), `page.css: missing feature marker ${marker}`);
  }
}

function checkJavaScriptSyntax() {
  for (const file of walk(root, (full) => full.endsWith(".js"))) {
    try {
      new Function(fs.readFileSync(file, "utf8"));
    } catch (error) {
      failures.push(`JS syntax failed: ${path.relative(root, file)}\n${error.message}`);
    }
  }
}

function checkJson() {
  for (const file of walk(path.join(root, "data"), (full) => full.endsWith(".json"))) {
    try {
      JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      failures.push(`JSON parse failed: ${path.relative(root, file)} ${error.message}`);
    }
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "site.webmanifest"), "utf8"));
    expect(manifest.name === "FutbolRadar", "manifest name mismatch");
    expect(Array.isArray(manifest.icons) && manifest.icons.length > 0, "manifest icons missing");
  } catch (error) {
    failures.push(`manifest parse failed: ${error.message}`);
  }

  try {
    const vercelConfig = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
    const rewrites = new Map((vercelConfig.rewrites || []).map((rewrite) => [rewrite.source, rewrite.destination]));
    const redirects = new Map((vercelConfig.redirects || []).map((redirect) => [redirect.source, redirect.destination]));
    [
      "forvetler",
      "kaleciler",
      "defanslar",
      "orta-sahalar",
      "genc-yetenekler",
      "en-iyi-oyuncular"
    ].forEach((slug) => {
      expect(
        rewrites.get(`/oyuncular/${slug}`) === `/oyuncular/${slug}.html`,
        `vercel rewrite missing /oyuncular/${slug}`
      );
    });
    expect(
      rewrites.get("/oyuncular/:slug") === "/oyuncular/:slug.html",
      "vercel rewrite missing /oyuncular/:slug"
    );
    expect(
      redirects.get("/oyuncular/edina-dzeko") === "/oyuncular/edin-dzeko.html",
      "vercel redirect missing /oyuncular/edina-dzeko"
    );
    expect(
      redirects.get("/oyuncular/edina-dzeko.html") === "/oyuncular/edin-dzeko.html",
      "vercel redirect missing /oyuncular/edina-dzeko.html"
    );
  } catch (error) {
    failures.push(`vercel config parse failed: ${error.message}`);
  }

  const playerValidation = validatePlayerData(players);
  for (const warning of playerValidation.warnings) {
    console.warn(`Player data warning: ${warning}`);
  }
  if (!playerValidation.ok) {
    failures.push(`player data validation failed:\n${playerValidation.errors.join("\n")}`);
  }

  const kerem = players.find((player) => player.id === "kerem-akturkoglu");
  expect(Boolean(kerem), "players: Kerem Aktürkoğlu record missing");
  expect(kerem && kerem.currentTeam === "Fenerbahçe", "players: Kerem currentTeam must be Fenerbahçe");
  expect(kerem && kerem.team === "Fenerbahçe", "players: Kerem team alias must be Fenerbahçe");
  expect(kerem && Array.isArray(kerem.formerTeams) && kerem.formerTeams.includes("Galatasaray"), "players: Kerem formerTeams must include Galatasaray");

  const ugurcan = players.find((player) => player.id === "ugurcan-cakir");
  expect(ugurcan && ugurcan.currentTeam === "Galatasaray", "players: Uğurcan currentTeam must be Galatasaray");

  const serializedPlayers = JSON.stringify(players);
  expect(!serializedPlayers.includes("?"), "players: mojibake marker '?' found after transfer update");

  const matches = JSON.parse(fs.readFileSync(path.join(root, "data", "matches.json"), "utf8"));
  expect(Array.isArray(matches), "matches: data/matches.json must be an array");
  matches.forEach((match, index) => {
    expect(Boolean(match.kickoff || match.date || match.utcDate), `matches: row ${index} must include kickoff/date; time-only rows are not allowed`);
  });
}

function pageUrl(page) {
  return `https://www.futbolradar.com/${page === "index.html" ? "" : page}`;
}

function checkSeoAndLinks() {
  const titles = new Map();
  const descriptions = new Map();

  for (const page of pages) {
    const html = fs.readFileSync(path.join(root, page), "utf8");
    const title = (html.match(/<title>([^<]+)<\/title>/) || [])[1] || "";
    const description = (html.match(/<meta\s+name="description"\s+content="([^"]+)"/i) || [])[1] || "";
    const canonical = (html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/i) || [])[1] || "";
    const robots = (html.match(/<meta\s+name="robots"\s+content="([^"]+)"/i) || [])[1] || "";
    const ogUrl = (html.match(/<meta\s+property="og:url"\s+content="([^"]+)"/i) || [])[1] || "";
    const ogImage = (html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i) || [])[1] || "";
    const ogTitle = (html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i) || [])[1] || "";
    const ogDescription = (html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i) || [])[1] || "";
    const twitterCard = (html.match(/<meta\s+name="twitter:card"\s+content="([^"]+)"/i) || [])[1] || "";
    const twitterTitle = (html.match(/<meta\s+name="twitter:title"\s+content="([^"]+)"/i) || [])[1] || "";
    const twitterDescription = (html.match(/<meta\s+name="twitter:description"\s+content="([^"]+)"/i) || [])[1] || "";
    const manifestHref = (html.match(/<link\s+rel="manifest"\s+href="([^"]+)"/i) || [])[1] || "";
    const expectedUrl = pageUrl(page);
    const pageDir = path.dirname(page);

    expect(Boolean(title), `${page}: missing title`);
    expect(Boolean(description), `${page}: missing meta description`);
    expect(canonical === expectedUrl, `${page}: canonical mismatch`);
    expect(ogUrl === expectedUrl, `${page}: og:url mismatch`);
    expect(ogImage === "https://www.futbolradar.com/assets/og-image.svg", `${page}: og:image mismatch`);
    expect(robots === "index,follow", `${page}: robots must be index,follow`);
    expect(Boolean(ogTitle), `${page}: missing og:title`);
    expect(Boolean(ogDescription), `${page}: missing og:description`);
    expect(twitterCard === "summary_large_image", `${page}: twitter card mismatch`);
    expect(twitterTitle === ogTitle, `${page}: twitter title should match og:title`);
    expect(twitterDescription === ogDescription, `${page}: twitter description should match og:description`);
    expect(Boolean(manifestHref), `${page}: missing manifest link`);

    if (title) titles.set(title, (titles.get(title) || 0) + 1);
    if (description) descriptions.set(description, (descriptions.get(description) || 0) + 1);

    if (playerProfilePages.includes(page)) {
      expect(html.includes("static-profile-links"), `${page}: missing static profile comparison links`);
      expect(html.includes("../karsilastirma/"), `${page}: missing static comparison page href`);
    }

    if (page === "index.html") {
      expect(html.includes("traffic-hub"), `${page}: missing live traffic hub`);
      expect(html.includes("home-search-section"), `${page}: missing home search section`);
      expect(html.includes("data-home-search"), `${page}: missing home search hook`);
      expect(html.includes("home-directory"), `${page}: missing homepage directory`);
      expect(html.includes("home-intelligence-board"), `${page}: missing homepage intelligence board`);
      expect(html.includes("traffic-deep-links"), `${page}: missing deep traffic links`);
      expect(html.includes("oyuncu-karsilastirmalari.html"), `${page}: missing comparison traffic link`);
      expect(html.includes("super-lig-fikstur.html"), `${page}: missing fixture traffic link`);
      expect(html.includes("karsilastirma/kerem-akturkoglu-vs-mauro-icardi.html"), `${page}: missing static comparison route`);
    }

    if (page === "oyuncu-radari.html") {
      expect(html.includes("comparison-hub-strip"), `${page}: missing visible comparison hub`);
      expect(html.includes("./karsilastirma/"), `${page}: missing static comparison hub links`);
      expect(html.includes("oyuncu-karsilastirmalari.html"), `${page}: missing comparison index link`);
    }

    if (page === "oyuncu-karsilastir.html") {
      expect(html.includes("oyuncu-karsilastirmalari.html"), `${page}: missing comparison index link`);
    }

    if (page === "oyuncu-karsilastirmalari.html") {
      expect(html.includes("comparison-index-grid"), `${page}: missing comparison index grid`);
      expect(html.includes("./karsilastirma/"), `${page}: missing static comparison links`);
    }

    if (playerComparisonPages.includes(page)) {
      expect(html.includes("static-comparison-summary"), `${page}: missing static comparison summary`);
      expect(html.includes('data-api-target="player-compare"'), `${page}: missing dynamic comparison hook`);
      expect(html.includes("data-compare-seed"), `${page}: missing comparison seed`);
    }

    for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const target = match[1];
      if (/^(https?:|#|mailto:|tel:|data:)/.test(target)) {
        continue;
      }

      const cleanTarget = target.split("#")[0].split("?")[0];
      if (!cleanTarget) {
        continue;
      }

      const resolvedTarget = cleanTarget.startsWith("/")
        ? path.join(root, cleanTarget.replace(/^\/+/, ""))
        : path.resolve(root, pageDir, cleanTarget);
      expect(fs.existsSync(resolvedTarget), `${page}: missing local target ${target}`);
    }
  }

  for (const [title, count] of titles) {
    expect(count === 1, `duplicate title: ${title}`);
  }

  for (const [description, count] of descriptions) {
    expect(count === 1, `duplicate description: ${description}`);
  }

  const sitemap = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
  for (const page of pages) {
    expect(sitemap.includes(`<loc>${pageUrl(page)}</loc>`), `sitemap missing ${pageUrl(page)}`);
  }

  const robots = fs.readFileSync(path.join(root, "robots.txt"), "utf8");
  expect(robots.includes("Sitemap: https://www.futbolradar.com/sitemap.xml"), "robots.txt missing sitemap URL");
  expect(fs.existsSync(path.join(root, "assets", "og-image.svg")), "missing assets/og-image.svg");
  expect(fs.existsSync(path.join(root, "public", "assets", "og-image.svg")), "missing public/assets/og-image.svg");
  expect(fs.existsSync(path.join(root, "site.webmanifest")), "missing site.webmanifest");
  expect(fs.existsSync(path.join(root, "public", "site.webmanifest")), "missing public/site.webmanifest");
}

async function callEndpoint(name, url = `/api/${name}`) {
  const directPath = path.join(root, "api", `${name}.js`);
  const modulePath = fs.existsSync(directPath) ? directPath : path.join(root, "api", "[...route].js");
  const moduleUrl = pathToFileURL(modulePath).href;
  const { default: handler } = await import(`${moduleUrl}?qa=${Date.now()}-${Math.random()}`);
  let payload = null;
  const response = {
    headers: {},
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      payload = body;
      return body;
    },
    end(body) {
      payload = JSON.parse(body);
      return payload;
    }
  };

  await handler({ method: "GET", url, headers: {} }, response);
  return { payload, response };
}

async function checkApi() {
  for (const endpoint of endpoints) {
    const { payload, response } = await callEndpoint(endpoint);
    expect(response.statusCode === 200 || response.statusCode === undefined, `${endpoint}: non-200 status`);
    expect(payload && typeof payload.ok === "boolean", `${endpoint}: missing ok boolean`);
    expect(payload && payload.source, `${endpoint}: missing source`);
    expect(payload && payload.updatedAt, `${endpoint}: missing updatedAt`);
    expect(payload && Array.isArray(payload.data), `${endpoint}: data must be array`);
    expect(response.headers["cache-control"] === "public, max-age=0", `${endpoint}: browser cache header mismatch`);
    expect(
      response.headers["cdn-cache-control"] === "public, s-maxage=300, stale-while-revalidate=600",
      `${endpoint}: CDN cache header mismatch`
    );

    if (endpoint === "health") {
      const diagnostics = payload.data[0] || {};
      expect(["mock", "live-ready"].includes(diagnostics.mode), "health: mode mismatch");
      expect(Boolean(diagnostics.providerSource), "health: missing providerSource");
      expect(Boolean(diagnostics.nextAction), "health: missing nextAction");
      expect(typeof diagnostics.credentialEnvCount === "number", "health: missing credential env count");
      expect(typeof diagnostics.baseUrlEnvCount === "number", "health: missing base URL env count");
      expect(typeof diagnostics.competitionEnvCount === "number", "health: missing competition env count");
      expect(Array.isArray(diagnostics.liveProviderResources), "health: missing live provider resources");
      expect(!JSON.stringify(diagnostics).includes("X-Auth-Token"), "health: should not expose auth header markers");
      expect(!JSON.stringify(diagnostics).includes("FOOTBALL_API_KEY"), "health: should not expose API key env names");
      expect(!JSON.stringify(diagnostics).includes("apiKey"), "health: should not expose API key field names");
    }
  }

  const invalidDate = await callEndpoint("matches", "/api/matches?date=yanlis");
  expect(invalidDate.payload.ok === false, "matches invalid date should return ok:false");
  expect(invalidDate.payload.error?.code === "INVALID_DATE", "matches invalid date should return INVALID_DATE");

  const playersResponse = await callEndpoint("players");
  const playerFields = [
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
    "positionGroup",
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
  const firstPlayer = playersResponse.payload.data[0] || {};
  expect(playersResponse.payload.data.length >= 8, "players: expected at least 8 mock players");
  for (const field of playerFields) {
    expect(Object.prototype.hasOwnProperty.call(firstPlayer, field), `players: missing ${field}`);
  }
  ["stats", "radar", "ratingComponents", "source"].forEach((field) => {
    expect(firstPlayer[field] && typeof firstPlayer[field] === "object", `players: missing object ${field}`);
  });
  ["strengths", "weaknesses", "similarPlayers"].forEach((field) => {
    expect(Array.isArray(firstPlayer[field]), `players: missing array ${field}`);
  });

  const keremApi = playersResponse.payload.data.find((player) => player.id === "kerem-akturkoglu");
  expect(keremApi && keremApi.currentTeam === "Fenerbahçe", "api players: Kerem currentTeam must be Fenerbahçe");
  expect(keremApi && Array.isArray(keremApi.formerTeams) && keremApi.formerTeams.includes("Galatasaray"), "api players: Kerem formerTeams must include Galatasaray");
}

checkVercelFunctionLimit();
checkPublicMirrors();
checkFeatureMarkers();
checkJavaScriptSyntax();
checkJson();
checkSeoAndLinks();
await checkApi();

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("FutbolRadar QA passed");
