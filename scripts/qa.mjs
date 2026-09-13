import fs from "node:fs";
import path from "node:path";
import { readJsonFile } from "./lib/readJsonFile.mjs";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { validatePlayerData } = require("../services/playerService.js");
const { publishedColumns } = require("../services/columnService.js");
const players = JSON.parse(fs.readFileSync(path.join(root, "data", "players.json"), "utf8"));
const newsData = JSON.parse(fs.readFileSync(path.join(root, "data", "news.json"), "utf8"));
const columnData = JSON.parse(fs.readFileSync(path.join(root, "data", "columns.json"), "utf8"));
const playerProfilePages = players.map((player) => `oyuncular/${player.id}.html`);
const newsArticlePages = (Array.isArray(newsData) ? newsData : newsData.items || newsData.news || [])
  .filter((article) => article && String(article.status || "").toLowerCase() === "verified" && article.slug && Array.isArray(article.body))
  .map((article) => `haber/${article.slug}.html`);
const { columns: publishedColumnRecords } = publishedColumns(columnData);
const columnArticlePages = publishedColumnRecords.map((column) => column.path);
const columnAuthorPages = [...new Set(publishedColumnRecords.map((column) => column.authorPath))];
const comparisonPagesDir = path.join(root, "karsilastirma");
const playerComparisonPages = fs.existsSync(comparisonPagesDir)
  ? fs.readdirSync(comparisonPagesDir).filter((file) => file.endsWith(".html")).sort().map((file) => `karsilastirma/${file}`)
  : [];
const pages = [
  "404.html",
  "index.html",
  "galatasaray-maclari.html",
  "fenerbahce-maclari.html",
  "besiktas-maclari.html",
  "trabzonspor-maclari.html",
  "puan-durumu.html",
  "takimlar.html",
  "oyuncu-radari.html",
  "oyuncu-karsilastir.html",
  "oyuncu-karsilastirmalari.html",
  "oyuncu-detay.html",
  "mac-detay.html",
  "fenerbahce-gornik-zabrze-mac-analizi.html",
  "transfer-sezonu-ne-zaman-bitiyor.html",
  "super-lig-transferleri-2026-2027.html",
  "gornik-zabrze-fenerbahce-rovans-ne-zaman.html",
  "uefa-ulke-puani-siralamasi.html",
  "sampiyonlar-ligi-on-eleme-maclari.html",
  "fenerbahce-avrupa-maclari.html",
  "galatasaray-transfer-radar.html",
  "fenerbahce-transfer-radar.html",
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
  "gol-kralligi.html",
  "asist-kralligi.html",
  "derbi-radari.html",
  "haftanin-maclari.html",
  "mac-merkezi.html",
  "istatistik-merkezi.html",
  "oyuncu-liderleri.html",
  "takim-trendleri.html",
  "futbol-radar-rehberi.html",
  "gunun-radar-bulteni.html",
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
  "mac-sonuclari.html",
  "haberler.html",
  ...newsArticlePages,
  "kose-yazilari.html",
  ...columnArticlePages,
  ...columnAuthorPages,
  "momentum.html",
  "analizler.html"
];
const endpoints = ["matches", "standings", "teams", "players", "player-detail", "player-compare", "player-rankings", "transfers", "squad", "match-detail", "momentum", "signals", "analyses", "health"];
const skipDirs = new Set([".git", ".agents", ".codex", ".vercel", "node_modules", "work", "outputs"]);
const { checkStandings } = require("../services/standingsIntegrity.js");
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
  "data-home-search",
  "initStatisticsHub",
  "buildDailyHeadlines",
  "renderDailyHeadlines",
  "visibleQuickStats",
  "applyEmptyHide",
  "initShareBlocks",
  "renderMatchListWindow",
  "MATCH_LIST_INITIAL",
  "initMatchListToggles"
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
  "live-pulse",
  "hero-value-prop",
  "daily-headlines",
  "daily-headline-kicker",
  "daily-headline-hook",
  "share-block",
  "share-targets",
  "share-copy",
  "home-match-command",
  "intent-card-grid",
  "intent-player-card",
  "intent-link-grid",
  "intent-stack-grid",
  "intent-stack-card",
  "intent-chip-row",
  "brief-command-grid",
  "brief-command-card",
  "stats-summary",
  "stats-panel-grid",
  "stats-coverage-grid",
  "match-more",
  "match-more-row",
  "archive-match-row",
  "archive-table",
  "archive-squad-list",
  "archive-stat",
  "archive-stat-grid",
  "player-score-card",
  "player-score-components",
  "player-form-chart",
  "player-stat-grid",
  "player-match-table",
  "player-scouting-list",
  "player-peer-card",
  "player-transfer-timeline",
  "player-empty-block"
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
  for (const file of ["page.css", "app.js", "player-profile.js", "site.js", "analytics.js", "performance-loader.js", "site.webmanifest"]) {
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

const playerProfileMarkers = [
  "renderProfileHtml",
  "buildPlayerProfile",
  "credibilitySection",
  "heroSection",
  "scoreSection",
  "formSection",
  "analysisSection",
  "seasonSection",
  "recentSection",
  "peerSection",
  "SECTION_RENDERERS",
  "UNVERIFIED_SECTIONS"
];

function checkFeatureMarkers() {
  const appJs = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const pageCss = fs.readFileSync(path.join(root, "page.css"), "utf8");
  const profileJs = fs.readFileSync(path.join(root, "player-profile.js"), "utf8");

  for (const marker of playerProfileMarkers) {
    expect(profileJs.includes(marker), `player-profile.js: missing feature marker ${marker}`);
  }

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
    const redirectRules = vercelConfig.redirects || [];
    const globalHeaders = (vercelConfig.headers || []).find((rule) => rule.source === "/(.*)");
    const headerMap = new Map(((globalHeaders && globalHeaders.headers) || []).map((header) => [header.key, header.value]));
    expect(headerMap.has("Content-Security-Policy"), "vercel security headers missing Content-Security-Policy");
    expect(String(headerMap.get("Content-Security-Policy") || "").includes("object-src 'none'"), "vercel CSP must block object sources");
    expect(String(headerMap.get("Content-Security-Policy") || "").includes("connect-src 'self'"), "vercel CSP must restrict API connections");
    [
      "futbolradar.com",
      "futbolradar.com.tr",
      "www.futbolradar.com.tr"
    ].forEach((host) => {
      expect(
        redirectRules.some((redirect) => {
          return redirect.source === "/:path*" &&
            redirect.destination === "https://www.futbolradar.com/:path*" &&
            redirect.permanent === true &&
            Array.isArray(redirect.has) &&
            redirect.has.some((condition) => condition.type === "host" && condition.value === host);
        }),
        `vercel canonical host redirect missing ${host}`
      );
    });
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
    for (const redirect of redirectRules) {
      const destination = redirect.destination || "";
      if (!destination.startsWith("/") || destination.includes(":path*")) {
        continue;
      }

      const target = destination.replace(/^\/+/, "");
      const targetPath = path.join(root, target);
      expect(
        fs.existsSync(targetPath) || (!path.extname(targetPath) && fs.existsSync(`${targetPath}.html`)),
        `vercel redirect target missing ${destination}`
      );
    }
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

  // MOJIBAKE, METİN ALANLARINDA ARANIR — her "?" karakteri değil.
  //
  // Kural "players.json içinde hiç ? olmasın"dı ve Türkçe bir harfin ?'e
  // dönüşmesini yakalamak için yazılmıştı. Kadro senkronu köken bilgisi
  // yazmaya başlayınca sourceUrl bir sorgu dizesi taşıyor
  // (".../squads?player=49866") ve kural yanlış alarm veriyor. Kontrol
  // daraltıldı, KALDIRILMADI: bozulmanın gerçekten olabileceği metin
  // alanları ve Unicode değiştirme karakteri hâlâ sınanıyor.
  const TEXT_FIELDS = ["name", "fullName", "currentTeam", "team", "position",
    "secondaryPosition", "nationality", "summary", "sourceNote", "league"];
  for (const player of players) {
    for (const field of TEXT_FIELDS) {
      const value = String(player[field] || "");
      expect(!value.includes("?"),
        `players: mojibake marker '?' in ${player.id}.${field} ("${value}")`);
    }
  }
  expect(!JSON.stringify(players).includes("\uFFFD"),
    "players: Unicode replacement character found");

  const matches = JSON.parse(fs.readFileSync(path.join(root, "data", "matches.json"), "utf8"));
  expect(Array.isArray(matches), "matches: data/matches.json must be an array");
  matches.forEach((match, index) => {
    expect(Boolean(match.kickoff || match.date || match.utcDate), `matches: row ${index} must include kickoff/date; time-only rows are not allowed`);
  });
}

function pageUrl(page) {
  if (columnArticlePages.includes(page) || newsArticlePages.includes(page)) {
    return `https://www.futbolradar.com/${page.replace(/\.html$/i, "")}`;
  }
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
    expect(ogImage.startsWith("https://www.futbolradar.com/"), `${page}: og:image must use the canonical host`);
    if (ogImage.startsWith("https://www.futbolradar.com/")) {
      const ogImagePath = path.join(root, ogImage.replace("https://www.futbolradar.com/", ""));
      expect(fs.existsSync(ogImagePath), `${page}: og:image target missing`);
    }
    expect(["index,follow", "noindex,follow"].includes(robots), `${page}: robots directive is invalid`);
    expect(Boolean(ogTitle), `${page}: missing og:title`);
    expect(Boolean(ogDescription), `${page}: missing og:description`);
    expect(twitterCard === "summary_large_image", `${page}: twitter card mismatch`);
    expect(twitterTitle === ogTitle, `${page}: twitter title should match og:title`);
    expect(twitterDescription === ogDescription, `${page}: twitter description should match og:description`);
    expect(Boolean(manifestHref), `${page}: missing manifest link`);

    if (title) titles.set(title, (titles.get(title) || 0) + 1);
    if (description) descriptions.set(description, (descriptions.get(description) || 0) + 1);

    if (playerProfilePages.includes(page)) {
      expect(html.includes("player-profile.js"), `${page}: missing player profile module script`);
      expect(html.includes('data-api-target="player-detail"'), `${page}: missing player profile hydration target`);
      expect(html.includes('data-prerendered="1"'), `${page}: player profile must be prerendered for SEO`);
      // Doğrulanmamış kayıtta ölçüm bölümleri BASILMAZ; beklenen tek şey
      // gerekçe kartı. Doğrulanmış kayıtta kimlik ızgarası her zaman çizilir.
      expect(
        html.includes("Doğrulanmış veri bekleniyor") || html.includes("Kimlik ve Kulüp"),
        `${page}: player profile body missing`
      );
      expect(html.includes("static-profile-links"), `${page}: missing static profile comparison links`);
      expect(html.includes("../karsilastirma/"), `${page}: missing static comparison page href`);
      expect(html.includes('"@type": "Person"'), `${page}: missing Person schema`);

      // SportsTeam YALNIZCA doğrulanmış kayıtta beklenir.
      //
      // Bu kural, güvenilirlik politikasından önce yazılmıştı ve her profilin
      // bir kulüp beyan etmesini şart koşuyordu. Politika tam tersini
      // söylüyor: doğrulanmamış bir kaydın kulübünü schema.org ile beyan
      // etmek, yanlış bir iddiayı makine okunur bir olguya çevirir
      // (denetimde Dzeko "Schalke 04" olarak böyle beyan ediliyordu).
      //
      // Bu yüzden kontrol tersine çevrildi: doğrulanmışsa SportsTeam OLMALI,
      // doğrulanmamışsa OLMAMALI. İkisi de sessizce geçilmiyor.
      const verifiedProfile = html.includes('data-player-verified="true"');
      if (verifiedProfile) {
        expect(html.includes('"@type": "SportsTeam"'), `${page}: missing SportsTeam schema`);
      } else {
        expect(!html.includes('"@type": "SportsTeam"'),
          `${page}: doğrulanmamış profil kulüp beyanı taşımamalı`);
      }
      expect(html.includes('"@type": "BreadcrumbList"'), `${page}: missing breadcrumb schema`);
    }

    if (page === "index.html") {
      expect(html.includes('data-api-target="featured-match"'), `${page}: missing featured match`);
      expect(html.includes('data-api-target="today-matches"'), `${page}: missing today matches`);
      expect(html.includes('data-api-target="player-radar"'), `${page}: missing player radar`);
      expect(html.includes('data-api-target="home-transfer-watch"'), `${page}: missing transfer watch`);
      expect(html.includes("istatistik-merkezi.html"), `${page}: missing statistics center route`);
      expect(html.includes("gol-kralligi.html"), `${page}: missing goal ranking route`);
      expect(html.includes("oyuncu-karsilastirmalari.html"), `${page}: missing comparison traffic link`);
      expect(html.includes("super-lig-fikstur.html"), `${page}: missing fixture traffic link`);
      expect(html.includes("premier-league"), `${page}: missing Premier League route`);
      expect(html.includes("sampiyonlar-ligi"), `${page}: missing Champions League route`);
      expect(html.includes("avrupa-ligi"), `${page}: missing Europa League route`);
      expect(html.includes("puan-durumu.html"), `${page}: missing standings route`);
      expect(html.includes("momentum.html"), `${page}: missing momentum route`);
      expect(html.includes("analizler.html"), `${page}: missing analysis hub route`);
      expect(html.includes('data-api-target="home-columns"'), `${page}: missing latest columns block`);
      expect(html.includes("Son Köşe Yazıları"), `${page}: latest columns heading is unclear`);
    }

    if (page === "kose-yazilari.html") {
      expect(html.includes('data-api-target="columns-page"'), `${page}: missing column listing target`);
      expect(html.includes("Köşe Yazıları"), `${page}: missing visible section label`);
    }

    if (columnArticlePages.includes(page)) {
      const columnRecord = publishedColumnRecords.find((column) => column.path === page);
      if (!columnRecord || !columnRecord.hideStandfirst) {
        expect(html.includes('class="column-standfirst"'), `${page}: missing article excerpt`);
      }
      expect(html.includes('class="column-author"'), `${page}: missing linked author`);
      expect(html.includes("yazarlar/"), `${page}: missing author archive route`);
      expect(html.includes('"@type":"Article"'), `${page}: missing article schema`);
      expect(html.includes('"additionalType":"https://schema.org/OpinionNewsArticle"'), `${page}: missing opinion article schema`);
    }

    if (columnAuthorPages.includes(page)) {
      expect(html.includes('class="column-grid"'), `${page}: missing author article grid`);
      expect(html.includes('"@type":"ProfilePage"'), `${page}: missing author profile schema`);
      expect(html.includes("Köşe Yazıları"), `${page}: missing route back to columns`);
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

    // Takım maç sayfaları: arama trafiği hedefleyen landing'ler. İnce içerik
    // ya da öksüz sayfa üretmediğimizin kapısı — ikisi de sıralamayı yakar.
    if (/^(galatasaray|fenerbahce|besiktas|trabzonspor)-maclari\.html$/.test(page)) {
      expect(html.includes('"@type":"BreadcrumbList"') || html.includes('"@type": "BreadcrumbList"'), `${page}: missing breadcrumb schema`);
      expect(html.includes('class="breadcrumb"'), `${page}: missing visible breadcrumb`);
      expect(html.includes("./takimlar.html"), `${page}: missing parent link`);
      expect(html.includes("archive-table"), `${page}: missing fixture table`);
      // Metin gövdesi: kabuk sayfa (yalnızca menü + altbilgi) yayımlanmamalı.
      const bodyText = html
        .replace(/<script[\s\S]*?<\/script>/g, "")
        .replace(/<style[\s\S]*?<\/style>/g, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      expect(bodyText.length > 3000, `${page}: thin content (${bodyText.length} karakter)`);
      // Sayfa Takımlar sayfasından bağlantı almalı; öksüz sayfa taranmaz.
      const teamsIndex = fs.readFileSync(path.join(root, "takimlar.html"), "utf8");
      expect(teamsIndex.includes(`./${page}`), `${page}: takimlar.html içinden bağlantı yok`);
    }

    if (playerComparisonPages.includes(page)) {
      expect(html.includes("static-comparison-summary"), `${page}: missing static comparison summary`);
      expect(html.includes('data-api-target="player-compare"'), `${page}: missing dynamic comparison hook`);
      expect(html.includes("data-compare-seed"), `${page}: missing comparison seed`);
      expect(html.includes('"@type": "Article"'), `${page}: missing Article schema`);
      expect(html.includes('"@type": "BreadcrumbList"'), `${page}: missing breadcrumb schema`);
    }

    if ([
      "transfer-sezonu-ne-zaman-bitiyor.html",
      "super-lig-transferleri-2026-2027.html",
      "fenerbahce-gornik-zabrze-mac-analizi.html",
      "gornik-zabrze-fenerbahce-rovans-ne-zaman.html",
      "uefa-ulke-puani-siralamasi.html",
      "sampiyonlar-ligi-on-eleme-maclari.html",
      "fenerbahce-avrupa-maclari.html",
      "galatasaray-transfer-radar.html",
      "fenerbahce-transfer-radar.html",
      "en-iyi-super-lig-oyunculari.html"
    ].includes(page)) {
      expect(html.includes('class="breadcrumb"'), `${page}: missing visible breadcrumb`);
      expect(html.includes('"@type":"BreadcrumbList"') || html.includes('"@type": "BreadcrumbList"'), `${page}: missing breadcrumb schema`);
      expect(html.includes("./index.html"), `${page}: missing home link`);
    }

    if (page === "404.html") {
      expect(robots === "noindex,follow", `${page}: must be noindex,follow`);
      expect(html.includes("mac-merkezi.html"), `${page}: missing match center recovery link`);
      expect(html.includes("oyuncu-radari.html"), `${page}: missing player radar recovery link`);
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
      expect(
        fs.existsSync(resolvedTarget) || (!path.extname(resolvedTarget) && fs.existsSync(`${resolvedTarget}.html`)),
        `${page}: missing local target ${target}`
      );
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
    const html = fs.readFileSync(path.join(root, page), "utf8");
    const robots = (html.match(/<meta\s+name="robots"\s+content="([^"]+)"/i) || [])[1] || "";
    if (robots === "noindex,follow") {
      expect(!sitemap.includes(`<loc>${pageUrl(page)}</loc>`), `sitemap must exclude noindex page ${pageUrl(page)}`);
    } else {
      expect(sitemap.includes(`<loc>${pageUrl(page)}</loc>`), `sitemap missing ${pageUrl(page)}`);
    }

    if ([
      "en-iyi-super-lig-oyunculari.html",
      "en-iyi-forvetler.html",
      "en-iyi-orta-sahalar.html",
      "en-iyi-defanslar.html",
      "en-iyi-kaleciler.html",
      "yukselen-oyuncular.html",
      "genc-yetenekler.html",
      "transfer-radari.html"
    ].includes(page)) {
      const expectedCard = page === "transfer-radari.html" ? 'data-card="transfer-record"' : 'data-card="player"';
      expect(html.includes(expectedCard), `${page}: missing prerendered content cards`);
      expect(!html.includes("Oyuncular yukleniyor"), `${page}: client-only loading placeholder must not be indexed`);
      if (page === "transfer-radari.html") {
        expect(html.includes("data-transfer-direction-filter"), `${page}: missing incoming/outgoing transfer filter`);
        expect(html.includes("transfer-verification"), `${page}: missing transfer verification timestamp`);
      }
    }
  }

  const robots = fs.readFileSync(path.join(root, "robots.txt"), "utf8");
  expect(robots.includes("Sitemap: https://www.futbolradar.com/sitemap.xml"), "robots.txt missing sitemap URL");
  expect(fs.existsSync(path.join(root, "assets", "og-image.svg")), "missing assets/og-image.svg");
  expect(fs.existsSync(path.join(root, "public", "assets", "og-image.svg")), "missing public/assets/og-image.svg");
  expect(fs.existsSync(path.join(root, "site.webmanifest")), "missing site.webmanifest");
  expect(fs.existsSync(path.join(root, "public", "site.webmanifest")), "missing public/site.webmanifest");
}

/**
 * Google mülkiyet doğrulama dosyası bir sayfa değil, içeriği birebir
 * korunması gereken bir kanıt dosyasıdır: Google tam olarak tek satırı
 * bekler. GA4/tema enjektörleri onu atlar, bu kontrol de atlamalı.
 */
const VERIFICATION_FILE = "googlef881b0d7527a8fba.html";
const VERIFICATION_CONTENT = "google-site-verification: googlef881b0d7527a8fba.html";

/**
 * ÖLÇÜM ETİKETİ: YAPILANDIRILDIYSA HER SAYFADA, YAPILANDIRILMADIYSA HİÇBİRİNDE.
 *
 * Denetim eskiden etiketi KOŞULSUZ arıyordu. Oysa `analytics.js` kimlik
 * yokken ilk satırlarda `return` ediyor; etiket yine de basıldığı için
 * tarayıcı betiği indirip çalıştırıyor ve karşılığında hiçbir iş yapmıyordu —
 * 5.169 sayfanın her görüntülenmesinde bir istek, sıfır ölçüm.
 *
 * Sözleşme artık duruma bağlı ve İKİ YÖNLÜ sınanıyor: kimlik varsa etiket
 * her sayfada olmalı (ölçüm sessizce düşmesin), kimlik yoksa hiçbir sayfada
 * olmamalı (boşuna istek atılmasın). Tek yönlü sınamak, ikisinden birini
 * fark edilmeden kaybettirirdi.
 */
function checkAnalyticsTag() {
  const ga4 = /^G-[A-Z0-9]+$/i.test(String(process.env.GA4_MEASUREMENT_ID || "").trim());
  const ads = /^AW-\d+$/i.test(String(process.env.GOOGLE_ADS_ID || "").trim());
  const configured = ga4 || ads;

  const htmlFiles = walk(root, (full) => full.endsWith(".html") && path.basename(full) !== VERIFICATION_FILE);
  for (const file of htmlFiles) {
    const html = fs.readFileSync(file, "utf8");
    const hasTag = html.includes("data-futbolradar-ga4");
    if (configured) {
      expect(hasTag, `${path.relative(root, file)}: GA4 tag missing`);
      expect(html.includes('src="/analytics.js"'), `${path.relative(root, file)}: analytics loader missing`);
    } else {
      expect(!hasTag, `${path.relative(root, file)}: ölçüm yapılandırılmamışken etiket basılmamalı`);
    }
    expect(!html.includes("G-XXXXXXXXXX"), `${path.relative(root, file)}: analytics placeholder must not ship`);
  }
}

/**
 * Doğrulama dosyası kaybolur ya da içine bir etiket enjekte edilirse Search
 * Console mülkiyeti sessizce düşer. Derleme her sayfayı yeniden ürettiği için
 * bu tam olarak fark edilmeden olabilecek bir regresyon; burada kilitleniyor.
 */
function checkSiteVerification() {
  const file = path.join(root, VERIFICATION_FILE);
  if (!fs.existsSync(file)) {
    // Dosya yoksa içeriği okumaya çalışmak ham bir ENOENT yığın izi basar ve
    // asıl mesajı gizler; burada anlaşılır hatayla durulur.
    expect(false, `missing ${VERIFICATION_FILE} (Google mülkiyet doğrulaması düşer)`);
    return;
  }

  const content = fs.readFileSync(file, "utf8").trim();
  expect(
    content === VERIFICATION_CONTENT,
    `${VERIFICATION_FILE} içeriği değişmiş; Google birebir "${VERIFICATION_CONTENT}" bekler`
  );
}

function checkClientSecrets() {
  const forbiddenMarkers = [
    "FOOTBALL_API_KEY",
    "FOOTBALL_DATA_API_KEY",
    "APIFOOTBALL_API_KEY",
    "X-Auth-Token",
    "x-apisports-key"
  ];
  const clientFiles = [
    path.join(root, "app.js"),
    path.join(root, "site.js"),
    ...walk(root, (full) => full.endsWith(".html") && !full.includes(`${path.sep}node_modules${path.sep}`))
  ];

  for (const file of clientFiles) {
    const content = fs.readFileSync(file, "utf8");
    for (const marker of forbiddenMarkers) {
      expect(!content.includes(marker), `client secret marker '${marker}' leaked into ${path.relative(root, file)}`);
    }
  }
}

/**
 * Lig kimliği önbelleği (data/api-football-league.json) commit edilen bir
 * dosyadır ve CI her koşuda `git add -A` yapar. İçine bir gün bir kimlik
 * bilgisi düşerse depoya girer ve oradan geri alınamaz. Bu kontrol, dosyanın
 * yalnızca beklenen alanları taşıdığını ve hiçbir alanının API anahtarı
 * biçiminde olmadığını doğrular.
 */
function checkLeagueCacheHasNoSecret() {
  const file = path.join(root, "data", "api-football-league.json");
  if (!fs.existsSync(file)) return;

  const raw = fs.readFileSync(file, "utf8");
  // API-Sports anahtarı: tam 32 onaltılık karakter.
  const keyShaped = /\b[a-f0-9]{32}\b/i;
  expect(!keyShaped.test(raw), "data/api-football-league.json içinde API anahtarı biçiminde bir değer var");

  const allowedKeys = new Set([
    "leagueId", "leagueName", "country", "resolvedForSeason", "resolvedAt", "source", "note"
  ]);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    expect(false, "data/api-football-league.json geçerli JSON değil");
    return;
  }

  for (const key of Object.keys(parsed || {})) {
    expect(allowedKeys.has(key), `data/api-football-league.json beklenmedik alan taşıyor: '${key}'`);
  }
}

function checkPublicCopyAndAccessibility() {
  const publicFiles = walk(root, (full) => {
    return full.endsWith(".html") || path.basename(full) === "app.js";
  });
  const forbiddenCopy = [
    "JSON veri",
    "API verisi",
    "API uyumlu",
    "Provider ID",
    "gerçek oyuncu API",
    "gercek oyuncu API"
  ];

  for (const file of publicFiles) {
    const content = fs.readFileSync(file, "utf8");
    for (const marker of forbiddenCopy) {
      expect(!content.toLocaleLowerCase("tr-TR").includes(marker.toLocaleLowerCase("tr-TR")),
        `public copy leaks internal wording '${marker}' in ${path.relative(root, file)}`);
    }

    if (file.endsWith(".html")) {
      for (const image of content.matchAll(/<img\b[^>]*>/gi)) {
        expect(/\balt\s*=/.test(image[0]), `${path.relative(root, file)}: image missing alt text`);
      }
      for (const button of content.matchAll(/<button\b[^>]*>/gi)) {
        expect(/\btype\s*=/.test(button[0]), `${path.relative(root, file)}: button missing type`);
      }
    }
  }

  const css = fs.readFileSync(path.join(root, "page.css"), "utf8");
  expect(css.includes(":focus-visible"), "page.css: visible keyboard focus style missing");
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
  const cacheHeaders = {
    matches: "no-store",
    standings: "no-store",
    teams: "public, s-maxage=1800, stale-while-revalidate=7200",
    players: "public, s-maxage=3600, stale-while-revalidate=21600",
    "player-detail": "public, s-maxage=3600, stale-while-revalidate=21600",
    "player-compare": "public, s-maxage=3600, stale-while-revalidate=21600",
    "player-rankings": "public, s-maxage=3600, stale-while-revalidate=21600",
    transfers: "public, s-maxage=300, stale-while-revalidate=900",
    squad: "public, s-maxage=300, stale-while-revalidate=900",
    "match-detail": "public, s-maxage=30, stale-while-revalidate=120",
    momentum: "public, s-maxage=300, stale-while-revalidate=900",
    signals: "public, s-maxage=120, stale-while-revalidate=600",
    analyses: "public, s-maxage=3600, stale-while-revalidate=21600",
    health: "no-store"
  };

  for (const endpoint of endpoints) {
    const { payload, response } = await callEndpoint(endpoint);
    expect(response.statusCode === 200 || response.statusCode === undefined, `${endpoint}: non-200 status`);
    expect(payload && typeof payload.ok === "boolean", `${endpoint}: missing ok boolean`);
    expect(payload && payload.source, `${endpoint}: missing source`);
    expect(payload && Object.prototype.hasOwnProperty.call(payload, "updatedAt"), `${endpoint}: missing updatedAt`);
    expect(payload && payload.responseAt && !Number.isNaN(Date.parse(payload.responseAt)), `${endpoint}: invalid responseAt`);
    if (payload && payload.updatedAt !== null) {
      expect(!Number.isNaN(Date.parse(payload.updatedAt)), `${endpoint}: invalid updatedAt`);
    }
    expect(payload && Array.isArray(payload.data), `${endpoint}: data must be array`);
    const expectedBrowserCache = ["health", "matches", "standings"].includes(endpoint) ? "no-store" : "public, max-age=0";
    expect(response.headers["cache-control"] === expectedBrowserCache, `${endpoint}: browser cache header mismatch`);
    expect(
      response.headers["cdn-cache-control"] === cacheHeaders[endpoint],
      `${endpoint}: CDN cache header mismatch`
    );
    expect(Boolean(response.headers["x-ratelimit-limit"]), `${endpoint}: rate limit header missing`);
    expect(Boolean(response.headers["x-ratelimit-remaining"]), `${endpoint}: rate limit remaining header missing`);

    if (endpoint === "health") {
      const diagnostics = payload.data[0] || {};
      expect(["mock", "live-ready"].includes(diagnostics.mode), "health: mode mismatch");
      expect(Boolean(diagnostics.providerSource), "health: missing providerSource");
      expect(Boolean(diagnostics.nextAction), "health: missing nextAction");
      expect(typeof diagnostics.credentialEnvCount === "number", "health: missing credential env count");
      expect(typeof diagnostics.baseUrlEnvCount === "number", "health: missing base URL env count");
      expect(typeof diagnostics.competitionEnvCount === "number", "health: missing competition env count");
      expect(Array.isArray(diagnostics.liveProviderResources), "health: missing live provider resources");
      // SIZINTI KONTROLÜ — korunması gereken şey anahtarın DEĞERİdir.
      //
      // Bu iki kontrol eskiden değişken ADINI ("...FOOTBALL_API_KEY") ve
      // "apiKey" alan adını da yasaklıyordu. Değişken adı gizli bilgi değil:
      // .env.example, docs/api-football-setup.md ve iş akışı dosyalarında
      // zaten açıkça yazıyor. Adı gizlemek, kurulumu eksik bir dağıtımda
      // "nereye bakmalıyım" sorusunu cevapsız bırakıyordu; teşhis ucunun
      // varlık sebebi tam olarak bu soruyu yanıtlamak.
      //
      // Kontrol artık DEĞER biçimine bakıyor: API-Sports anahtarı 32
      // karakterlik onaltılık bir dizedir ve yanıtta böyle bir dize
      // görünmemelidir.
      const diagnosticsText = JSON.stringify(diagnostics);
      expect(!diagnosticsText.includes("X-Auth-Token"), "health: should not expose auth header markers");
      expect(!diagnosticsText.includes("x-apisports-key"), "health: should not expose provider auth header");
      expect(!/[0-9a-f]{32}/i.test(diagnosticsText), "health: should not expose credential-shaped values");
      expect(!/"(apiKey|credential|token|secret)"\s*:\s*"[^"]+"/i.test(diagnosticsText),
        "health: should not expose credential values");

      // Kurulum eksikse hangi değişkenin tanımlanacağı AÇIKÇA yazmalı.
      const pipeline = diagnostics.pipeline || {};
      expect(Boolean(pipeline.provider), "health: missing pipeline provider section");
      expect(pipeline.provider.requiredEnvName === "APIFOOTBALL_API_KEY",
        "health: pipeline must name the required env var");
      expect(typeof pipeline.provider.apiKeyPresent === "boolean",
        "health: pipeline must report api key presence");
      // Anahtar yokken saklanan veri "taze" diye raporlanmamalı.
      if (pipeline.provider.apiKeyPresent === false) {
        expect(pipeline.freshness.trustworthy === false,
          "health: stored-only data must not be reported as trustworthy");
        expect(Boolean(pipeline.provider.warning), "health: missing stored-only warning");
      }
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

async function checkMatchAnalysisApi() {
  // Dosya adını söyleyen okuyucu: ham JSON.parse hatası hangi dosyanın
  // bozuk olduğunu anmıyordu.
  const analyses = readJsonFile(path.join(root, "data", "match-analyses.json"), []);
  const missingQuery = await callEndpoint("match-analysis", "/api/match-analysis");
  expect(missingQuery.payload.ok === false, "match-analysis: missing query should return ok:false");
  expect(missingQuery.payload.error?.code === "MATCH_ANALYSIS_QUERY_REQUIRED", "match-analysis: missing query error code mismatch");

  const notFound = await callEndpoint("match-analysis", "/api/match-analysis?fixtureId=does-not-exist");
  expect(notFound.response.statusCode === 404, "match-analysis: unknown fixture should 404");
  expect(notFound.payload.error?.code === "MATCH_ANALYSIS_NOT_FOUND", "match-analysis: unknown fixture error code mismatch");

  if (!analyses.length) {
    return;
  }

  const sample = analyses[0];
  const byFixtureId = await callEndpoint("match-analysis", `/api/match-analysis?fixtureId=${encodeURIComponent(sample.fixtureId)}`);
  expect(byFixtureId.payload.ok === true, "match-analysis: fixtureId lookup should succeed");
  expect(byFixtureId.payload.method, "match-analysis: missing method field");
  expect(byFixtureId.payload.data && byFixtureId.payload.data.fixtureId === sample.fixtureId, "match-analysis: data mismatch for fixtureId lookup");
  expect(
    byFixtureId.response.headers["cdn-cache-control"] === "public, s-maxage=300, stale-while-revalidate=900",
    "match-analysis: CDN cache header mismatch"
  );

  const bySlug = await callEndpoint("match-analysis", `/api/match-analysis?slug=${encodeURIComponent(sample.slug)}`);
  expect(bySlug.payload.ok === true, "match-analysis: slug lookup should succeed");

  const payloadText = JSON.stringify(byFixtureId.payload);
  expect(!/FOOTBALL_API_KEY|apiKey|X-Auth-Token/i.test(payloadText), "match-analysis: should not expose API key material");

  const probabilities = sample.prediction && sample.prediction.probabilities;
  if (probabilities) {
    const sum = Number(probabilities.homeWin) + Number(probabilities.draw) + Number(probabilities.awayWin);
    expect(sum === 100, `match-analysis: probabilities must sum to 100 (got ${sum})`);
  }
}

/**
 * BOŞ BÖLÜM GİZLİ KALIR.
 *
 * `data-empty-hide` taşıyan bir bölüm, sözleşmesi gereği içeriği boşken
 * `hidden` olmalı. Bu, "zayıfsa gizle" kuralının HTML'e düşen hâli:
 * "Bugün öne çıkan üç başlık" başlığını yazıp altını boş bırakmak, bölümü
 * hiç göstermemekten kötüdür — okuyucu sitenin bir şeyi beceremediğini görür.
 *
 * Kural üç yerde uygulanıyor (ön derleme `applyEmptyHide`, istemci
 * `applyEmptyHide`, elle yazılmış işaretleme). Bu kapı üçünün de sonucunu
 * aynı yerde sınar: dosyada ne varsa o doğru olmalı.
 */
function checkEmptyHideSections() {
  const pages = walk(root, (full) => full.endsWith(".html") && !full.includes(`${path.sep}public${path.sep}`));

  for (const file of pages) {
    const html = fs.readFileSync(file, "utf8");
    if (!html.includes("data-empty-hide")) continue;

    const rel = path.relative(root, file);
    const expression = /<section\b[^>]*\bdata-empty-hide\b[^>]*>([\s\S]*?)<\/section>/g;
    let match;

    while ((match = expression.exec(html)) !== null) {
      const openTag = match[0].slice(0, match[0].indexOf(">") + 1);
      const isHidden = /\shidden(?=[\s>])/.test(openTag);

      // İçerik: prerender işaretleri arasında kalan kısım. İşaret yoksa
      // bölümün hedef kabındaki her şey sayılır.
      const slot = match[1].match(/<!-- prerender:[a-z-]+:start -->([\s\S]*?)<!-- prerender:[a-z-]+:end -->/);
      if (!slot) continue;

      const hasContent = slot[1].trim() !== "";

      expect(
        hasContent !== isHidden,
        `${rel}: data-empty-hide bölümü ${hasContent ? "dolu ama gizli" : "boş ama görünür"}`
      );
    }
  }
}

/**
 * İŞ AKIŞI YAML'I AYRIŞABİLİR KALSIN.
 *
 * GERÇEK OLAY. Bir commit adımı tek satıra yazıldı:
 *
 *     run: node scripts/ci-commit-push.mjs "ci(matches): automate ..."
 *
 * Değerin içindeki `": "` (iki nokta + boşluk) YAML'da eşleme başlatır, yani
 * tırnaksız bir skalerde YASAKTIR. Dosya ayrıştırılamaz hâle geldi ve GitHub
 * iş akışını TÜMÜYLE yok saydı: zamanlanmış koşular durdu, `workflow_dispatch`
 * kayboldu, elle tetikleme "bu iş akışında workflow_dispatch yok" diye 422
 * döndürdü. Hiçbir adım kırmızıya dönmedi çünkü hiçbir adım çalışmadı —
 * en sinsi arıza türü.
 *
 * NEDEN TAM YAML AYRIŞTIRICISI DEĞİL. Bu depo bilerek sıfır bağımlılıklı ve
 * CI hiç `npm install` çalıştırmıyor; yalnızca bu kontrol için bir kütüphane
 * eklemek, korumaya çalıştığı şeyden pahalı olurdu. Bunun yerine iş akışlarını
 * bozan DAR sınıf hedefleniyor: tırnaksız/bloksuz bir değerin içinde `": "`.
 *
 * `https://...` gibi adresler yanlış yakalanmaz: aranan şey iki noktadan
 * SONRA BOŞLUK gelmesi, ki YAML'ın eşleme göstergesi tam olarak budur.
 */
function checkWorkflowYaml() {
  const workflowDir = path.join(root, ".github", "workflows");
  if (!fs.existsSync(workflowDir)) return;

  // Değer tırnaklı, blok skaler ya da akış koleksiyonuysa `": "` güvenlidir.
  const SAFE_START = /^[|>'"[{&*]/;

  for (const name of fs.readdirSync(workflowDir).filter((file) => /\.ya?ml$/.test(file))) {
    const rel = `.github/workflows/${name}`;
    const raw = fs.readFileSync(path.join(workflowDir, name), "utf8");

    expect(!raw.includes("\t"), `${rel}: YAML sekme karakteri içeremez`);

    raw.split("\n").forEach((line, index) => {
      if (/^\s*#/.test(line) || !line.trim()) return;

      // `anahtar: değer` (liste öğesi olabilir). Değer boşsa blok başlıyordur.
      const match = line.match(/^\s*(?:-\s+)?[A-Za-z_][\w.-]*:\s+(\S.*)$/);
      if (!match) return;

      const value = match[1].trim();
      if (SAFE_START.test(value)) return;

      expect(
        !value.includes(": "),
        `${rel}:${index + 1}: tırnaksız değerde "': '" var — YAML ayrıştırılamaz. ` +
        `Blok skaler (\`run: |\`) kullanın. Satır: ${line.trim().slice(0, 80)}`
      );
    });
  }

  // Elle tetikleme kaybolduğunda hiçbir şey kırmızıya dönmez; ayrıca sınanır.
  const main = path.join(workflowDir, "match-analysis.yml");
  if (fs.existsSync(main)) {
    expect(
      /^\s*workflow_dispatch:/m.test(fs.readFileSync(main, "utf8")),
      "match-analysis.yml: workflow_dispatch tetikleyicisi kaybolmuş"
    );
  }
}

/**
 * SAĞLAYICI SIR ADLARI TEK STANDARTTA KALSIN.
 *
 * SORUN. Kod beş ayrı yazım varyantını kabul ediyor
 * (`APIFOOTBALL_API_KEY`, `API_FOOTBALL_API_KEY`, `APIFOOTBALL_KEY`,
 * `API_SPORTS_API_KEY`, `APISPORTS_API_KEY`). Bu esneklik YANLIŞ ADLA
 * TANIMLANMIŞ bir anahtarın sağlayıcıyı sessizce devre dışı bırakmasını
 * önlemek için var — ama iş akışlarına sızarsa tersine döner: hangi
 * GitHub secret'ının gerçekten okunduğu belirsizleşir, eski bir secret
 * silinemez hâle gelir ve iki farklı ad dolduğunda hangisinin kazandığı
 * kimsenin bilmediği bir sıraya kalır.
 *
 * KURAL. Kabul edilen adlar KODDA kalır (geriye dönük uyumluluk), ama
 * TANIMLANDIĞI her yerde — iş akışları, `.env.example`, belgeler —
 * yalnızca kanonik ad kullanılır. Bu kontrol kuralı zorunlu kılar.
 */
function checkProviderSecretNaming() {
  const utils = require("../api/_utils.js");
  const providerMode = require("../services/providerMode.js");

  // İki modül aynı listeyi ayrı ayrı tanımlıyor. Ayrışmaları, bir katmanın
  // gördüğü anahtarı diğerinin görmemesi demek: API canlı, betikler
  // "anahtar yok" derdi.
  expect(
    JSON.stringify(utils.APIFOOTBALL_API_KEY_ENV_NAMES) === JSON.stringify(providerMode.API_KEY_ENV_NAMES),
    "provider secrets: api/_utils.js ve services/providerMode.js anahtar ad listeleri ayrışmış"
  );
  expect(
    providerMode.PRIMARY_API_KEY_ENV === "APIFOOTBALL_API_KEY",
    `provider secrets: kanonik ad APIFOOTBALL_API_KEY olmalı (şu an ${providerMode.PRIMARY_API_KEY_ENV})`
  );

  // İş akışlarında yalnızca bu adlar geçebilir.
  const canonical = new Set([
    "APIFOOTBALL_API_KEY",
    "APIFOOTBALL_API_BASE_URL",
    "APIFOOTBALL_LEAGUE_ID",
    "APIFOOTBALL_SEASON",
    "APIFOOTBALL_COUNTRY"
  ]);
  const aliases = new Set([
    ...utils.APIFOOTBALL_API_KEY_ENV_NAMES,
    ...utils.APIFOOTBALL_LEAGUE_ID_ENV_NAMES,
    ...utils.APIFOOTBALL_BASE_URL_ENV_NAMES,
    ...utils.APIFOOTBALL_SEASON_ENV_NAMES,
    ...utils.APIFOOTBALL_COUNTRY_ENV_NAMES
  ].filter((name) => !canonical.has(name)));

  const workflowDir = path.join(root, ".github", "workflows");
  if (!fs.existsSync(workflowDir)) return;

  const workflows = fs.readdirSync(workflowDir).filter((name) => /\.ya?ml$/.test(name));
  expect(workflows.length > 0, "provider secrets: .github/workflows altında iş akışı yok");

  for (const name of workflows) {
    const rel = `.github/workflows/${name}`;
    const lines = fs.readFileSync(path.join(workflowDir, name), "utf8").split("\n");

    lines.forEach((line, index) => {
      const at = `${rel}:${index + 1}`;
      // Yorum satırları anlatım içindir; eski adlardan söz edebilirler.
      if (/^\s*#/.test(line)) return;

      for (const secret of line.matchAll(/secrets\.([A-Z0-9_]+)/g)) {
        expect(
          !aliases.has(secret[1]),
          `provider secrets: ${at} eski ad kullanıyor (secrets.${secret[1]}); kanonik ada geçin`
        );
      }

      // `NAME: ${{ secrets.OTHER }}` — çapraz bağlama. Adların eşleşmesi,
      // "hangi secret hangi değişkene gidiyor" sorusunu okumadan yanıtlar.
      const mapping = line.match(/^\s*([A-Z0-9_]+):\s*\$\{\{\s*secrets\.([A-Z0-9_]+)\s*\}\}\s*$/);
      if (mapping && (canonical.has(mapping[1]) || aliases.has(mapping[1]))) {
        expect(
          mapping[1] === mapping[2],
          `provider secrets: ${at} çapraz bağlama (${mapping[1]} ← secrets.${mapping[2]})`
        );
        expect(
          canonical.has(mapping[1]),
          `provider secrets: ${at} eski değişken adı (${mapping[1]}); kanonik ada geçin`
        );
      }
    });
  }
}

/**
 * JSON SÖZDİZİMİ KAPISI.
 *
 * Bozuk bir veri dosyası bugüne kadar ancak CI'da, dosyayı hiç anmayan bir
 * yığın iziyle ortaya çıkıyordu: `data/match-analyses.json` yarım kalmış
 * bir düzenlemeyle bozuldu ve "Refresh official lineups" adımı
 * "Expected ',' or '}' after property value in JSON at position 9" diyerek
 * çöktü. Hangi dosya olduğu mesajda yoktu.
 *
 * QA artık her veri dosyasını ayrıştırıyor. Bozuk dosya burada, ADIYLA
 * yakalanıyor — CI'ya ulaşmadan.
 */
function checkDataJsonSyntax() {
  const roots = [path.join(root, "data"), path.join(root, "public", "data")];
  let checked = 0;

  for (const dir of roots) {
    if (!fs.existsSync(dir)) continue;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;

      const filePath = path.join(dir, entry.name);
      checked += 1;

      try {
        JSON.parse(fs.readFileSync(filePath, "utf8"));
      } catch (error) {
        // HEMEN DUR. Bozuk veriyle sonraki kontroller anlamsız ve aşağıdaki
        // ham JSON.parse çağrıları zaten çökerek asıl hatayı gizliyor.
        console.error(
          `\nQA DURDU — bozuk JSON: ${path.relative(root, filePath)}\n` +
          `  Ayrıştırıcı: ${error.message}\n` +
          `  Geçerli sürüme dönmek için: git checkout HEAD -- ${path.relative(root, filePath)}\n`
        );
        process.exit(1);
      }
    }
  }

  expect(checked > 0, "veri dizininde JSON dosyası bulunamadı");
}

/**
 * PUAN TABLOSU ARİTMETİĞİ.
 *
 * Kural services/standingsIntegrity.js içinde tek yerde: bu kapı üretim
 * verisini sınar, scripts/test-opening-week.mjs ise kuralın bozuk satırı
 * gerçekten yakaladığını doğrular. Kural burada gömülü kalsaydı kapının
 * kendisi test edilemezdi.
 */
function checkStandingsIntegrity() {
  const teamsPath = path.join(root, "data", "teams.json");
  if (!fs.existsSync(teamsPath)) return;

  const rows = JSON.parse(fs.readFileSync(teamsPath, "utf8"));
  for (const violation of checkStandings(rows)) {
    expect(false, violation);
  }
}

/**
 * ÇEKİRDEK SAYFALARIN YAPISAL VERİSİ.
 *
 * Puan durumu, bugünün maçları, takımlar, Süper Lig fikstürü gibi en çok
 * arama trafiği beklenen sayfalarda hiç JSON-LD yoktu; Google için ne
 * oldukları yalnızca `<title>`dan anlaşılıyordu. Şema
 * `scripts/inject-core-page-schema.mjs` ile basılıyor, kapı burada:
 * blok düşerse ya da bayatlarsa QA kırmızı yanar.
 */
function checkCorePageSchema() {
  const required = [
    "puan-durumu.html",
    "bugunun-maclari.html",
    "takimlar.html",
    "super-lig-fikstur.html",
    "analizler.html",
    "mac-merkezi.html"
  ];

  for (const page of required) {
    const file = path.join(root, page);
    if (!fs.existsSync(file)) continue;
    const html = fs.readFileSync(file, "utf8");

    expect(html.includes("<!-- core-page-schema:start -->"), `${page}: çekirdek sayfa şeması bloğu yok`);

    const match = html.match(/<!-- core-page-schema:start -->\s*<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(Boolean(match), `${page}: şema bloğu okunamadı`);
    if (!match) continue;

    let parsed = null;
    try {
      parsed = JSON.parse(match[1]);
    } catch (error) {
      expect(false, `${page}: şema geçersiz JSON (${error.message})`);
      continue;
    }

    const graph = Array.isArray(parsed["@graph"]) ? parsed["@graph"] : [];
    const types = graph.map((node) => node["@type"]);
    expect(types.includes("BreadcrumbList"), `${page}: BreadcrumbList şeması yok`);
    expect(types.some((type) => type === "WebPage" || type === "CollectionPage"), `${page}: WebPage/CollectionPage şeması yok`);

    // Şemadaki canonical, sayfanın kendi canonical'ıyla ÇELİŞMEMELİ.
    const canonical = (html.match(/<link rel="canonical" href="([^"]*)"/) || [])[1];
    const page1 = graph.find((node) => node["@type"] === "WebPage" || node["@type"] === "CollectionPage");
    if (canonical && page1) {
      expect(page1.url === canonical, `${page}: şema url'i canonical ile çelişiyor (${page1.url} != ${canonical})`);
    }

    // SportsEvent yazıldıysa BAŞLAMA ANI olmak ZORUNDA: tarihsiz maç
    // şemaya uydurma bir tarihle girmemeli.
    for (const node of graph) {
      if (node["@type"] !== "ItemList") continue;
      for (const entry of node.itemListElement || []) {
        const item = entry.item || {};
        if (item["@type"] !== "SportsEvent") continue;
        expect(Boolean(item.startDate), `${page}: startDate taşımayan SportsEvent şemaya yazılmış (${item.name})`);
        expect(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+03:00$/.test(String(item.startDate)),
          `${page}: SportsEvent startDate TSİ ofsetiyle yazılmalı (${item.name}: ${item.startDate})`
        );
      }
    }
  }
}

checkDataJsonSyntax();
checkStandingsIntegrity();
checkCorePageSchema();
checkProviderSecretNaming();
checkWorkflowYaml();
checkEmptyHideSections();
checkVercelFunctionLimit();
checkPublicMirrors();
checkAnalyticsTag();
checkSiteVerification();
checkLeagueCacheHasNoSecret();
checkFeatureMarkers();
checkJavaScriptSyntax();
checkJson();
checkSeoAndLinks();
checkClientSecrets();
checkPublicCopyAndAccessibility();
await checkApi();
await checkMatchAnalysisApi();

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("FutbolRadar QA passed");
