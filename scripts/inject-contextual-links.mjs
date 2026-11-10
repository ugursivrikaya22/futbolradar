#!/usr/bin/env node
/**
 * BAĞLAM İÇ BAĞLANTI ENJEKSİYONU.
 *
 * Takım → o takımın karşılaştırma, yakın maç ve maç dosyası sayfaları.
 * Maç → iki takım, lig, ikili karşılaştırma (dosya varsa).
 * Lig → ligler merkezi, alt bilgi ve kardeş lig blokları.
 * Avrupa Ligi rehberi → Avrupa Ligi / UEFA sayfaları ve ana sayfanın
 * futbol bölümü (köşe yazılarının üstünde).
 * Haber → aynı takımın tarih komşuları.
 *
 * Yalnızca diskte var olan adrese bağlanır. Bloklar görünür `source-strip`,
 * tavanlı, işaretli ve tekrar çalışınca yerinde yenilenir.
 *
 *   node scripts/inject-contextual-links.mjs            # yazar
 *   node scripts/inject-contextual-links.mjs --measure  # sayaç, yazmaz
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { siteFooter, siteHeader } from "./lib/layout.mjs";
import { findTurkish } from "./lib/turkish-detector.mjs";
import {
  CAP,
  UEFA_LEAGUE_IDS,
  WEAK_LEAGUE_IDS,
  slugify,
  POPULAR_SLUGS,
  popularityRank,
  escapeHtml,
  decodeHtml,
  hasSlugToken,
  orderLeagues,
  relatedLeagues,
  selectTeamLinks,
  selectNewsLinks,
  summerHubLinks,
  renderStrip,
  upsertMarked,
  normalizeHref,
  scanInbound,
  isSummer2026
} from "./lib/contextualLinkGraph.mjs";

const require = createRequire(import.meta.url);
const { createSiteLinks } = require("../services/siteLinks.js");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteLinks = createSiteLinks();
const MEASURE = process.argv.includes("--measure");

const EN_NAMES = {
  "sampiyonlar-ligi": "Champions League",
  "avrupa-ligi": "Europa League",
  "la-liga": "La Liga",
  "premier-league": "Premier League",
  "bundesliga": "Bundesliga",
  "serie-a": "Serie A",
  "ligue-1": "Ligue 1",
  "super-lig": "Süper Lig",
  "konferans-ligi": "Conference League",
  "1-lig": "Turkish First League",
  "arjantin-primera": "Argentina Primera Division",
  "belcika-pro-ligi": "Belgian Pro League",
  "brasileirao": "Brazilian Serie A",
  "championship": "Championship",
  "eredivisie": "Eredivisie",
  "mls": "MLS",
  "primeira-liga": "Primeira Liga",
  "saudi-pro-league": "Saudi Pro League",
  "scottish-premiership": "Scottish Premiership",
  "tff-2-lig": "TFF Second League",
  "tff-3-lig": "TFF Third League",
  "turkiye-kupasi": "Turkish Cup",
  "uefa-uluslar-ligi": "UEFA Nations League"
};

const EN_FILES = {
  "sampiyonlar-ligi": "en/champions-league-standings.html",
  "avrupa-ligi": "en/europa-league-standings.html",
  "konferans-ligi": "en/conference-league-standings.html",
  "premier-league": "en/premier-league-standings.html",
  "la-liga": "en/la-liga-standings.html",
  "serie-a": "en/serie-a-standings.html",
  "bundesliga": "en/bundesliga-standings.html",
  "ligue-1": "en/ligue-1-standings.html",
  "super-lig": "en/super-lig-standings.html"
};

const NOT_TEAM_HUBS = new Set(["bugunun", "haftanin", "sampiyonlar-ligi-on-eleme", "fenerbahce-avrupa"]);
const GUIDE_REL = "avrupa-ligi-eleme-sistemi-rehberi.html";
const SITEMAP_BLOCK = `  <url>
    <loc>https://www.futbolradar.com/ligler.html</loc>
    <xhtml:link rel="alternate" hreflang="tr-TR" href="https://www.futbolradar.com/ligler.html"/>
    <xhtml:link rel="alternate" hreflang="en" href="https://www.futbolradar.com/en/leagues.html"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://www.futbolradar.com/ligler.html"/>
    <lastmod>2026-11-09</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>
  <url>
    <loc>https://www.futbolradar.com/en/leagues.html</loc>
    <xhtml:link rel="alternate" hreflang="tr-TR" href="https://www.futbolradar.com/ligler.html"/>
    <xhtml:link rel="alternate" hreflang="en" href="https://www.futbolradar.com/en/leagues.html"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://www.futbolradar.com/ligler.html"/>
    <lastmod>2026-11-09</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>
`;

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function readJson(rel, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8")); } catch { return fallback; }
}

function h1Of(rel) {
  if (!exists(rel)) return "";
  const html = read(rel);
  const match = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  return match ? decodeHtml(match[1]) : "";
}

function linkable(rootPath) {
  const raw = rootPath.startsWith("/") ? rootPath : `/${rootPath}`;
  const finalPath = siteLinks.resolveFinalPath(raw);
  if (!finalPath || finalPath.includes("mac-merkezi")) return null;
  const file = `${finalPath.replace(/^\//, "")}.html`;
  const bare = finalPath.replace(/^\//, "");
  if (!exists(file) && !exists(bare) && !exists(`${bare}.html`)) {
    if (!exists(raw.replace(/^\//, "")) && !exists(`${raw.replace(/^\//, "")}`)) return null;
  }
  const candidate = exists(`${finalPath.replace(/^\//, "")}.html`) || exists(finalPath.replace(/^\//, ""))
    ? finalPath
    : raw.replace(/\.html$/, "");
  return candidate.startsWith("/") ? candidate : `/${candidate}`;
}

function hrefFrom(pageRel, rootPath) {
  const finalPath = linkable(rootPath);
  if (!finalPath) return null;
  return siteLinks.internalHref(finalPath, { from: pageRel });
}

function writeRel(rel, html) {
  const targets = [path.join(root, rel)];
  const mirror = path.join(root, "public", rel);
  if (fs.existsSync(mirror) || fs.existsSync(path.dirname(mirror))) targets.push(mirror);
  let changed = 0;
  for (const file of targets) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    if (before === html) continue;
    fs.writeFileSync(file, html);
    changed += 1;
  }
  return changed;
}

function applyBlock(rel, marker, block, insertAt, placement = "before") {
  let changed = 0;
  for (const fileRel of [rel, path.posix.join("public", rel)]) {
    if (!exists(fileRel)) continue;
    const before = read(fileRel);
    const next = upsertMarked(before, marker, block, insertAt, { placement });
    if (next == null) {
      if (fileRel === rel) console.error(`contextual-links: yer bulunamadı ${rel} (${marker})`);
      continue;
    }
    if (next === before) continue;
    fs.writeFileSync(path.join(root, fileRel), next);
    changed += 1;
  }
  return changed > 0 ? 1 : 0;
}

function formatDay(iso, locale) {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(time);
}

function englishLabel(label, fallback) {
  if (label && findTurkish(label, { limit: 1 }).length === 0) return label;
  if (fallback && findTurkish(fallback, { limit: 1 }).length === 0) return fallback;
  return null;
}

function loadLeagues() {
  const comps = readJson("data/competitions.json", []);
  const byId = new Map((Array.isArray(comps) ? comps : []).map((item) => [item.id, item]));
  const dir = path.join(root, "lig");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith(".html")).map((name) => {
    const id = name.replace(/\.html$/, "");
    const record = byId.get(id);
    const enFile = EN_FILES[id];
    return {
      id,
      nameTr: record && record.name ? record.name : id,
      nameEn: EN_NAMES[id] || (record && record.name) || id,
      trHref: `/lig/${id}.html`,
      enHref: enFile && exists(enFile) ? `/${enFile}` : null
    };
  });
}

function loadTeamNames() {
  const map = new Map();
  const teams = readJson("data/teams.json", []);
  for (const team of Array.isArray(teams) ? teams : []) {
    const slug = team.id || slugify(team.name);
    if (!slug) continue;
    map.set(slugify(team.name), slug);
    map.set(slug, slug);
    map.set(slugify(slug), slug);
  }
  const dir = path.join(root, "takimlar");
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".html")) continue;
      const slug = name.replace(/\.html$/, "");
      if (!map.has(slug)) map.set(slug, slug);
    }
  }
  return map;
}

function teamSlugForName(name, teamNames) {
  if (!name) return null;
  const direct = teamNames.get(slugify(name));
  if (direct) return direct;
  const slug = slugify(name);
  return exists(`takimlar/${slug}.html`) ? slug : null;
}

function loadMatches(teamNames) {
  const dir = path.join(root, "mac");
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".html")) continue;
    const rel = `mac/${name}`;
    const html = read(rel);
    const home = (html.match(/data-msp-home="([^"]*)"/) || [])[1];
    const away = (html.match(/data-msp-away="([^"]*)"/) || [])[1];
    const kickoff = (html.match(/data-msp-kickoff="([^"]*)"/) || [])[1];
    if (!home || !away || !kickoff) continue;
    const enHref = (html.match(/hreflang="en"\s+href="([^"]+)"/) || [])[1] || "";
    let enPath = "";
    if (enHref.includes("futbolradar.com/")) {
      enPath = enHref.split("futbolradar.com/")[1].split(/[?#]/)[0];
      if (enPath && !enPath.endsWith(".html") && exists(`${enPath}.html`)) enPath = `${enPath}.html`;
    }
    const leagueHref = (html.match(/href="([^"]*\/lig\/[^"]+)"/) || [])[1] || "";
    const leagueId = (leagueHref.match(/lig\/([a-z0-9-]+)/) || [])[1] || "";
    const rootPath = `/mac/${name}`;
    if (!linkable(rootPath)) continue;
    out.push({
      rel,
      rootPath,
      home,
      away,
      homeSlug: teamSlugForName(decodeHtml(home), teamNames),
      awaySlug: teamSlugForName(decodeHtml(away), teamNames),
      kickoff: decodeHtml(kickoff),
      enPath: enPath && exists(enPath) ? enPath : "",
      leagueId
    });
  }
  return out;
}

function loadComparisons() {
  const dir = path.join(root, "karsilastirma", "takimlar");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith(".html")).map((name) => {
    const stem = name.replace(/\.html$/, "");
    const [left, right] = stem.split("-vs-");
    return { left, right, rootPath: `/karsilastirma/takimlar/${name}`, rel: `karsilastirma/takimlar/${name}` };
  }).filter((item) => item.left && item.right);
}

function loadPlayerComparisons(teamSlugs) {
  const dir = path.join(root, "karsilastirma");
  const bySlug = new Map(teamSlugs.map((slug) => [slug, []]));
  if (!fs.existsSync(dir)) return bySlug;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".html")) continue;
    for (const slug of teamSlugs) {
      if (!hasSlugToken(name, slug)) continue;
      bySlug.get(slug).push(name);
    }
  }
  return bySlug;
}

function loadMatchFiles() {
  const groups = [
    { dir: "mac-dosyasi", parent: /-(?:mac-dosyasi|mac-analizi)\.html$/, locale: "tr" },
    { dir: "en/match-special", parent: /-(?:match-special|match-analysis)\.html$/, locale: "en" }
  ];
  const files = [];
  for (const group of groups) {
    const abs = path.join(root, group.dir);
    if (!fs.existsSync(abs)) continue;
    for (const name of fs.readdirSync(abs)) {
      if (!group.parent.test(name)) continue;
      const rel = `${group.dir}/${name}`;
      const html = read(rel);
      const h1 = (html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || "";
      const enHref = (html.match(/hreflang="en"\s+href="([^"]+)"/) || [])[1] || "";
      let enPath = "";
      if (enHref.includes("futbolradar.com/")) {
        enPath = enHref.split("futbolradar.com/")[1].split(/[?#]/)[0];
        if (enPath && !enPath.endsWith(".html") && exists(`${enPath}.html`)) enPath = `${enPath}.html`;
      }
      files.push({
        rel,
        rootPath: `/${rel}`,
        locale: group.locale,
        h1: decodeHtml(h1),
        enPath: enPath && exists(enPath) ? enPath : "",
        name
      });
    }
  }
  return files;
}

function teamPages(slug) {
  return [`takimlar/${slug}.html`, `${slug}-maclari.html`, `en/team/${slug}.html`].filter((rel) => exists(rel) && (rel.startsWith("en/") || !NOT_TEAM_HUBS.has(slug)));
}

function comparisonLabel(pair, names) {
  const left = names.get(pair.left) || pair.left;
  const right = names.get(pair.right) || pair.right;
  return `${left} - ${right} karşılaştırması`;
}

function displayNames(teamNames) {
  const teams = readJson("data/teams.json", []);
  const names = new Map();
  for (const team of Array.isArray(teams) ? teams : []) {
    const slug = team.id || slugify(team.name);
    if (slug && team.name) names.set(slug, team.name);
  }
  for (const slug of teamNames.values()) {
    if (!names.has(slug)) names.set(slug, slug);
  }
  return names;
}

function buildTeamItems(slug, locale, pageRel, ctx) {
  const name = ctx.names.get(slug) || slug;
  const comparisons = ctx.comparisons
    .filter((pair) => pair.left === slug || pair.right === slug)
    .sort((a, b) => popularityRank(a.left === slug ? a.right : a.left) - popularityRank(b.left === slug ? b.right : b.left))
    .map((pair) => {
      const href = hrefFrom(pageRel, pair.rootPath);
      if (!href || locale === "en") return null;
      return { href, label: comparisonLabel(pair, ctx.names), kicker: "Karşılaştırma" };
    })
    .filter(Boolean);

  const now = Date.parse("2026-11-09T09:00:00Z");
  const mine = ctx.matches
    .filter((match) => match.homeSlug === slug || match.awaySlug === slug)
    .sort((a, b) => String(a.kickoff).localeCompare(String(b.kickoff)));
  const past = mine.filter((match) => Date.parse(match.kickoff) <= now).reverse();
  const next = mine.filter((match) => Date.parse(match.kickoff) > now);
  const matchItem = (match) => {
    const target = locale === "en" ? (match.enPath ? `/${match.enPath}` : "") : match.rootPath;
    if (!target) return null;
    const href = hrefFrom(pageRel, target);
    if (!href) return null;
    const day = formatDay(match.kickoff, locale);
    const home = decodeHtml(match.home);
    const away = decodeHtml(match.away);
    const label = locale === "en"
      ? englishLabel(`${home} vs ${away}${day ? `, ${day}` : ""}`, `${home} vs ${away}`)
      : `${home} - ${away} maçı${day ? ` (${day})` : ""}`;
    if (!label) return null;
    return { href, label, kicker: locale === "en" ? "Match" : "Maç" };
  };
  const files = ctx.matchFiles
    .filter((file) => file.locale === (locale === "en" ? "en" : "tr") && hasSlugToken(file.name, slug))
    .sort((a, b) => popularityRank(slug) - popularityRank(slug) || a.name.localeCompare(b.name))
    .map((file) => {
      const href = hrefFrom(pageRel, file.rootPath);
      if (!href) return null;
      const label = locale === "en"
        ? englishLabel(file.h1, `${name} match file`)
        : (file.h1 || `${name} maç dosyası`);
      if (!label) return null;
      return { href, label, kicker: locale === "en" ? "Match file" : "Maç dosyası" };
    })
    .filter(Boolean);

  let playerComparisons = [];
  if (locale !== "en") {
    const ranked = (ctx.playerComparisons.get(slug) || []).slice().sort((a, b) => {
      const score = (fileName) => (POPULAR_SLUGS.some((other) => other !== slug && hasSlugToken(fileName, other)) ? 0 : 1);
      return score(a) - score(b) || a.localeCompare(b, "tr");
    });
    playerComparisons = ranked.slice(0, CAP.playerComparisons).map((fileName) => {
      const rel = `karsilastirma/${fileName}`;
      const href = hrefFrom(pageRel, `/${rel}`);
      if (!href) return null;
      const title = h1Of(rel).replace(/\s*[|–—]\s*FutbolRadar.*$/i, "").trim();
      if (!title) return null;
      return { href, label: title, kicker: "Karşılaştırma" };
    }).filter(Boolean);
  }

  const transfers = ctx.transfers
    .filter((item) => item.teamSlug === slug)
    .map((item) => {
      const href = hrefFrom(pageRel, `/${item.rel}`);
      if (!href || locale === "en") return null;
      return { href, label: item.label, kicker: "Transfer" };
    })
    .filter(Boolean);

  return selectTeamLinks({
    comparisons,
    recent: past.map(matchItem).filter(Boolean),
    upcoming: next.map(matchItem).filter(Boolean),
    files: [...transfers, ...files],
    playerComparisons
  });
}

function pageHas(html, rootPath) {
  const bare = rootPath.replace(/\.html$/i, "").replace(/^\//, "");
  return html.includes(bare);
}

function desiredMatchLinks(match, html, locale, pageRel, ctx) {
  const items = [];
  const push = (rootPath, label, kicker) => {
    if (!rootPath || pageHas(html, rootPath)) return;
    const href = hrefFrom(pageRel, rootPath);
    if (!href || pageHas(html, rootPath)) return;
    items.push({ href, label, kicker });
  };
  const homeSlug = match.homeSlug;
  const awaySlug = match.awaySlug;
  if (locale === "tr") {
    if (homeSlug && exists(`takimlar/${homeSlug}.html`)) push(`/takimlar/${homeSlug}.html`, `${decodeHtml(match.home)} takım sayfası`, "Takım");
    else if (homeSlug && exists(`${homeSlug}-maclari.html`)) push(`/${homeSlug}-maclari.html`, `${decodeHtml(match.home)} maçları`, "Takım");
    if (awaySlug && exists(`takimlar/${awaySlug}.html`)) push(`/takimlar/${awaySlug}.html`, `${decodeHtml(match.away)} takım sayfası`, "Takım");
    else if (awaySlug && exists(`${awaySlug}-maclari.html`)) push(`/${awaySlug}-maclari.html`, `${decodeHtml(match.away)} maçları`, "Takım");
    if (match.leagueId && exists(`lig/${match.leagueId}.html`)) {
      const league = ctx.leagues.find((item) => item.id === match.leagueId);
      push(`/lig/${match.leagueId}.html`, league ? league.nameTr : match.leagueId, "Lig");
    }
    if (homeSlug && awaySlug) {
      const pair = ctx.comparisons.find((item) =>
        (item.left === homeSlug && item.right === awaySlug) || (item.left === awaySlug && item.right === homeSlug));
      if (pair) push(pair.rootPath, comparisonLabel(pair, ctx.names), "Karşılaştırma");
      const file = ctx.matchFiles.find((item) => item.locale === "tr" && hasSlugToken(item.name, homeSlug) && hasSlugToken(item.name, awaySlug));
      if (file) push(file.rootPath, file.h1 || `${decodeHtml(match.home)} - ${decodeHtml(match.away)} maç dosyası`, "Maç dosyası");
    }
  } else {
    if (homeSlug && exists(`en/team/${homeSlug}.html`)) push(`/en/team/${homeSlug}.html`, englishLabel(`${decodeHtml(match.home)} team page`, `${decodeHtml(match.home)}`), "Team");
    if (awaySlug && exists(`en/team/${awaySlug}.html`)) push(`/en/team/${awaySlug}.html`, englishLabel(`${decodeHtml(match.away)} team page`, `${decodeHtml(match.away)}`), "Team");
    const enLeague = match.leagueId && EN_FILES[match.leagueId] && exists(EN_FILES[match.leagueId]) ? `/${EN_FILES[match.leagueId]}` : "";
    if (enLeague) {
      const league = ctx.leagues.find((item) => item.id === match.leagueId);
      const label = englishLabel(league ? `${league.nameEn} standings` : "League standings", "League standings");
      if (label) push(enLeague, label, "League");
    }
    if (homeSlug && awaySlug) {
      const file = ctx.matchFiles.find((item) => item.locale === "en" && hasSlugToken(item.name, homeSlug) && hasSlugToken(item.name, awaySlug));
      if (file) {
        const label = englishLabel(file.h1, `${decodeHtml(match.home)} vs ${decodeHtml(match.away)} match file`);
        if (label) push(file.rootPath, label, "Match file");
      }
    }
  }
  return items.filter((item) => item && item.label).slice(0, 6);
}

function loadNews(file, locale) {
  const rows = readJson(file, []);
  return (Array.isArray(rows) ? rows : []).map((article) => {
    const slug = String(article.slug || "").trim();
    if (!slug) return null;
    const rel = locale === "en" ? `en/news/${slug}.html` : `haber/${slug}.html`;
    if (!exists(rel)) return null;
    const teamKey = slugify(article.team || "") || slugify(article.category || article.competition || "");
    return {
      id: slug,
      slug,
      rel,
      title: String(article.title || "").trim(),
      team: article.team || "",
      teamKey: teamKey || "genel",
      publishedAt: article.publishedAt || ""
    };
  }).filter((item) => item && item.title);
}

function loadTransfers(players, teamNames) {
  const files = fs.readdirSync(root).filter((name) => name.endsWith("-transfer-son-durum.html"));
  return files.map((name) => {
    const stem = name.replace(/\.html$/, "");
    let teamSlug = null;
    let best = 0;
    for (const player of players) {
      const playerSlug = slugify(player.name);
      if (playerSlug.length < 5 || !stem.includes(playerSlug) || playerSlug.length <= best) continue;
      const slug = teamSlugForName(player.team || player.currentTeam, teamNames);
      if (!slug) continue;
      best = playerSlug.length;
      teamSlug = slug;
    }
    if (!teamSlug) {
      for (const slug of new Set(teamNames.values())) {
        if (hasSlugToken(name, slug)) { teamSlug = slug; break; }
      }
    }
    return { rel: name, teamSlug, label: h1Of(name) || stem };
  });
}

function hubDocument({ locale, leagues }) {
  const en = locale === "en";
  const ordered = orderLeagues(leagues, en ? "nameEn" : "nameTr").filter((league) => en ? league.enHref : league.trHref);
  const title = en ? "League pages | FutbolRadar" : "Lig sayfaları | FutbolRadar";
  const description = en
    ? "Fixtures, results and standings for each competition FutbolRadar covers, in priority order."
    : "FutbolRadar'da sayfası olan ligler. Önce Şampiyonlar Ligi, Avrupa Ligi ve büyük ligler, sonra diğer ligler alfabe sırasıyla.";
  const h1 = en ? "League pages" : "Lig sayfaları";
  const canonical = en ? "https://www.futbolradar.com/en/leagues.html" : "https://www.futbolradar.com/ligler.html";
  const pageRel = en ? "en/leagues.html" : "ligler.html";
  const cells = ordered.map((league) => {
    const href = hrefFrom(pageRel, en ? league.enHref : league.trHref);
    const label = en ? league.nameEn : league.nameTr;
    if (!href || !label) return "";
    const kicker = en ? "League" : "Lig";
    return `<div><span>${kicker}</span><b><a href="${escapeHtml(href)}">${escapeHtml(label)}</a></b></div>`;
  }).join("");
  const guideHref = !en && exists(GUIDE_REL) ? hrefFrom(pageRel, `/${GUIDE_REL}`) : "";
  const guideLabel = guideHref ? (h1Of(GUIDE_REL) || "UEFA Avrupa Ligi eleme sistemi nasıl işliyor?") : "";
  const guide = guideHref ? `<p><a href="${escapeHtml(guideHref)}">${escapeHtml(guideLabel)}</a></p>` : "";
  return `<!doctype html>
<html lang="${en ? "en" : "tr"}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${canonical}" />
    <link rel="alternate" hreflang="tr-TR" href="https://www.futbolradar.com/ligler.html" />
    <link rel="alternate" hreflang="en" href="https://www.futbolradar.com/en/leagues.html" />
    <link rel="alternate" hreflang="x-default" href="https://www.futbolradar.com/ligler.html" />
    <meta name="robots" content="index,follow" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="${en ? "en_US" : "tr_TR"}" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${canonical}" />
    <link rel="icon" href="${en ? "../" : "./"}favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="${en ? "../" : "./"}page.css" />
  </head>
  <body>
    <div class="site-shell">
      ${siteHeader({ base: en ? "../" : "./", locale, altHref: en ? "ligler.html" : "en/leagues.html" })}
      <main class="container">
        <nav class="breadcrumb" aria-label="${en ? "Breadcrumb" : "Sayfa yolu"}"><a href="${en ? "./index.html" : "./index.html"}">${en ? "Home" : "Ana Sayfa"}</a><span>/</span><span>${h1}</span></nav>
        <header class="hero">
          <span class="eyebrow">${en ? "Competitions" : "Ligler"}</span>
          <h1>${escapeHtml(h1)}</h1>
          <p>${escapeHtml(description)}</p>
          ${guide}
        </header>
        <section class="source-strip" data-context-links="league-hub" aria-label="${h1}">${cells}</section>
      </main>
      ${siteFooter({ base: en ? "../" : "./", locale })}
    </div>
    <script src="${en ? "../" : "./"}site.js" defer></script>
  </body>
</html>
`;
}

function footerItems(leagues, locale, pageRel) {
  const ordered = orderLeagues(leagues, locale === "en" ? "nameEn" : "nameTr");
  const items = [];
  for (const league of ordered) {
    if (items.length >= CAP.footerLeagues) break;
    const rootPath = locale === "en" ? league.enHref : league.trHref;
    if (!rootPath) continue;
    const href = hrefFrom(pageRel, rootPath);
    if (!href) continue;
    const label = locale === "en" ? englishLabel(league.nameEn, league.nameEn) : league.nameTr;
    if (!label) continue;
    items.push({ href, label, kicker: locale === "en" ? "League" : "Lig" });
  }
  const hub = locale === "en" ? "/en/leagues.html" : "/ligler.html";
  const hubHref = hrefFrom(pageRel, hub);
  if (hubHref) items.push({ href: hubHref, label: locale === "en" ? "League pages" : "Lig sayfaları", kicker: locale === "en" ? "League" : "Lig" });
  return items.slice(0, CAP.leagueRelated);
}

function ensureSitemap(rel) {
  if (!exists(rel)) return 0;
  const xml = read(rel);
  if (xml.includes("https://www.futbolradar.com/ligler.html")) return 0;
  const at = xml.lastIndexOf("</urlset>");
  if (at < 0) return 0;
  fs.writeFileSync(path.join(root, rel), `${xml.slice(0, at)}${SITEMAP_BLOCK}${xml.slice(at)}`);
  return 1;
}

function measure() {
  const comparisons = fs.readdirSync(path.join(root, "karsilastirma")).filter((name) => name.endsWith(".html")).map((name) => `/karsilastirma/${name}`);
  const teamComparisons = exists("karsilastirma/takimlar")
    ? fs.readdirSync(path.join(root, "karsilastirma", "takimlar")).filter((name) => name.endsWith(".html")).map((name) => `/karsilastirma/takimlar/${name}`)
    : [];
  const files = exists("mac-dosyasi")
    ? fs.readdirSync(path.join(root, "mac-dosyasi")).filter((name) => name.endsWith(".html")).map((name) => `/mac-dosyasi/${name}`)
    : [];
  const enFiles = exists("en/match-special")
    ? fs.readdirSync(path.join(root, "en/match-special")).filter((name) => name.endsWith(".html")).map((name) => `/en/match-special/${name}`)
    : [];
  const leagues = loadLeagues().map((league) => league.trHref);
  const keys = [
    `/${GUIDE_REL}`,
    ...WEAK_LEAGUE_IDS.map((id) => `/lig/${id}.html`),
    ...leagues,
    "/en-iyi-defanslar.html",
    "/en-iyi-forvetler.html",
    "/en-iyi-kaleciler.html",
    "/en-iyi-orta-sahalar.html",
    "/en-iyi-super-lig-oyunculari.html",
    "/victor-osimhen-transfer-son-durum.html",
    "/mohamed-salah-trabzonspor-transfer-son-durum.html",
    "/dusan-vlahovic-besiktas-transfer-son-durum.html",
    "/turk-sporcu-sonuclari.html",
    "/ligler.html",
    "/en/leagues.html",
    ...teamComparisons,
    ...files,
    ...enFiles
  ];
  const news = loadNews("data/news.json", "tr").filter(isSummer2026).map((item) => `/${item.rel}`);
  const { counts, pagesScanned } = scanInbound(root, [...new Set([...keys, ...comparisons, ...news])]);
  const zero = (list) => list.filter((item) => (counts[normalizeHref(item, "index.html")] || 0) === 0).length;
  const report = {
    pagesScanned,
    comparisons: comparisons.length,
    comparisonZero: zero(comparisons),
    matchFiles: files.length,
    matchFileZero: zero(files),
    enMatchFiles: enFiles.length,
    enMatchFileZero: zero(enFiles),
    summerNews: news.length,
    summerNewsUnder2: news.filter((item) => (counts[normalizeHref(item, "index.html")] || 0) < 2).length,
    keys: Object.fromEntries([...new Set(keys)].map((item) => [normalizeHref(item, "index.html"), counts[normalizeHref(item, "index.html")] || 0]))
  };
  console.log(JSON.stringify(report, null, 2));
  return report;
}

function main() {
  if (MEASURE) {
    measure();
    return;
  }
  const leagues = loadLeagues();
  const trOrdered = orderLeagues(leagues, "nameTr");
  const enOrdered = orderLeagues(leagues.filter((league) => league.enHref), "nameEn");
  const teamNames = loadTeamNames();
  const names = displayNames(teamNames);
  const matches = loadMatches(teamNames);
  const comparisons = loadComparisons();
  const teamSlugs = [...new Set(teamNames.values())].filter((slug) => exists(`takimlar/${slug}.html`) || exists(`en/team/${slug}.html`) || exists(`${slug}-maclari.html`));
  const playerComparisons = loadPlayerComparisons(teamSlugs);
  const matchFiles = loadMatchFiles();
  const players = readJson("data/players.json", []);
  const transfers = loadTransfers(Array.isArray(players) ? players : [], teamNames);
  console.log(`contextual-links: transfer ${transfers.map((item) => `${item.rel} -> ${item.teamSlug || "-"}`).join("; ")}`);
  const ctx = { leagues, names, matches, comparisons, playerComparisons, matchFiles, transfers };
  let pages = 0;

  pages += writeRel("ligler.html", hubDocument({ locale: "tr", leagues })) > 0 ? 1 : 0;
  pages += writeRel("en/leagues.html", hubDocument({ locale: "en", leagues: enOrdered })) > 0 ? 1 : 0;
  pages += ensureSitemap("sitemap.xml");
  if (exists("public/sitemap.xml")) pages += ensureSitemap("public/sitemap.xml");

  const guideLabel = h1Of(GUIDE_REL) || "UEFA Avrupa Ligi eleme sistemi nasıl işliyor?";
  const homeBlock = renderStrip({
    marker: "context-home",
    aria: "Avrupa kupaları",
    items: [
      hrefFrom("index.html", `/${GUIDE_REL}`) ? { href: hrefFrom("index.html", `/${GUIDE_REL}`), label: guideLabel, kicker: "Rehber" } : null,
      hrefFrom("index.html", "/ligler.html") ? { href: hrefFrom("index.html", "/ligler.html"), label: "Lig sayfaları", kicker: "Lig" } : null
    ].filter(Boolean)
  });
  const leagueNavEnd = "<!-- prerender:league-directory:end -->";
  const homeHtml = read("index.html");
  const directoryAt = homeHtml.indexOf(leagueNavEnd);
  const navClose = directoryAt >= 0 ? homeHtml.indexOf("</nav>", directoryAt) : -1;
  if (navClose >= 0) pages += applyBlock("index.html", "context-home", homeBlock, homeHtml.slice(directoryAt, navClose + "</nav>".length), "after");

  const enHomeItems = [
    ["/en/europa-league-standings.html", "Europa League standings"],
    ["/en/champions-league-standings.html", "Champions League standings"],
    ["/en/leagues.html", "League pages"]
  ].map(([target, label]) => {
    const href = hrefFrom("en/index.html", target);
    const safe = englishLabel(label, label);
    return href && safe ? { href, label: safe, kicker: "League" } : null;
  }).filter(Boolean);
  pages += applyBlock("en/index.html", "context-home", renderStrip({ marker: "context-home", aria: "European competitions", items: enHomeItems }), 'href="/en/todays-matches.html">View All</a></div>', "after");

  for (const [rel, locale] of [
    ["index.html", "tr"],
    ["en/index.html", "en"],
    ["puan-durumu.html", "tr"],
    ["en/standings.html", "en"],
    ["bugunun-maclari.html", "tr"],
    ["en/todays-matches.html", "en"]
  ]) {
    if (!exists(rel)) continue;
    const items = footerItems(locale === "en" ? enOrdered : trOrdered, locale, rel);
    const block = renderStrip({
      marker: "context-footer",
      aria: locale === "en" ? "League pages" : "Lig sayfaları",
      items
    });
    pages += applyBlock(rel, "context-footer", block, "</footer>");
  }

  for (const league of trOrdered) {
    const rel = `lig/${league.id}.html`;
    const items = [];
    if (UEFA_LEAGUE_IDS.has(league.id) && exists(GUIDE_REL)) {
      const href = hrefFrom(rel, `/${GUIDE_REL}`);
      if (href) items.push({ href, label: guideLabel, kicker: "Rehber" });
    }
    for (const other of relatedLeagues(trOrdered, league.id, CAP.leagueRelated - items.length)) {
      const href = hrefFrom(rel, other.trHref);
      if (href) items.push({ href, label: other.nameTr, kicker: "Lig" });
    }
    const hub = hrefFrom(rel, "/ligler.html");
    if (hub && items.length < CAP.leagueRelated) items.push({ href: hub, label: "Lig sayfaları", kicker: "Lig" });
    pages += applyBlock(rel, "context-links", renderStrip({
      marker: "context-links",
      aria: `${league.nameTr} ile ilgili sayfalar`,
      items: items.slice(0, CAP.leagueRelated)
    }), "</main>");
  }

  for (const league of enOrdered) {
    const rel = league.enHref.replace(/^\//, "");
    const items = [];
    for (const other of relatedLeagues(enOrdered, league.id, CAP.leagueRelated)) {
      const href = hrefFrom(rel, other.enHref);
      const label = englishLabel(other.nameEn, other.nameEn);
      if (href && label) items.push({ href, label, kicker: "League" });
    }
    const hub = hrefFrom(rel, "/en/leagues.html");
    if (hub && items.length < CAP.leagueRelated) items.push({ href: hub, label: "League pages", kicker: "League" });
    pages += applyBlock(rel, "context-links", renderStrip({
      marker: "context-links",
      aria: `${league.nameEn} related pages`,
      items: items.slice(0, CAP.leagueRelated)
    }), "</main>");
  }

  const seenTeamPages = new Set();
  for (const slug of teamSlugs) {
    for (const rel of teamPages(slug)) {
      if (seenTeamPages.has(rel)) continue;
      seenTeamPages.add(rel);
      const locale = rel.startsWith("en/") ? "en" : "tr";
      const items = buildTeamItems(slug, locale, rel, ctx);
      if (!items.length) continue;
      const name = names.get(slug) || slug;
      const aria = locale === "en" ? `${name} matches and files` : `${name} maçları ve karşılaştırmaları`;
      const titleOk = locale === "en" ? englishLabel(aria, `${name} matches`) : aria;
      if (!titleOk) continue;
      pages += applyBlock(rel, "context-links", renderStrip({ marker: "context-links", aria: titleOk, items }), "</main>");
    }
  }

  for (const match of matches) {
    const trHtml = read(match.rel);
    const trItems = desiredMatchLinks(match, trHtml, "tr", match.rel, ctx);
    if (trItems.length) pages += applyBlock(match.rel, "context-links", renderStrip({ marker: "context-links", aria: "Maç bağlantıları", items: trItems }), "</main>");
    if (!match.enPath) continue;
    const enHtml = read(match.enPath);
    const enItems = desiredMatchLinks(match, enHtml, "en", match.enPath, ctx).filter((item) => englishLabel(item.label, item.label));
    if (enItems.length) pages += applyBlock(match.enPath, "context-links", renderStrip({ marker: "context-links", aria: "Match links", items: enItems }), "</main>");
  }

  const guideTargets = [
    "avrupa-ligi-puan-durumu.html",
    "sampiyonlar-ligi-puan-durumu.html",
    "konferans-ligi-puan-durumu.html"
  ];
  for (const rel of guideTargets) {
    if (!exists(rel) || !exists(GUIDE_REL)) continue;
    const href = hrefFrom(rel, `/${GUIDE_REL}`);
    if (!href) continue;
    pages += applyBlock(rel, "context-links", renderStrip({
      marker: "context-links",
      aria: "UEFA sayfaları",
      items: [{ href, label: guideLabel, kicker: "Rehber" }]
    }), "</main>");
  }

  const bestOf = [
    "en-iyi-kaleciler.html",
    "en-iyi-defanslar.html",
    "en-iyi-orta-sahalar.html",
    "en-iyi-forvetler.html",
    "en-iyi-super-lig-oyunculari.html"
  ].filter((rel) => exists(rel));
  const turkLabel = exists("turk-sporcu-sonuclari.html") ? (h1Of("turk-sporcu-sonuclari.html") || "Türk sporcu sonuçları") : "";
  const bestItemsFor = (pageRel) => {
    const items = bestOf.map((rel) => {
      const href = hrefFrom(pageRel, `/${rel}`);
      const label = h1Of(rel);
      return href && label ? { href, label, kicker: "Oyuncu" } : null;
    }).filter(Boolean);
    if (pageRel === "istatistik-merkezi.html" && turkLabel) {
      const href = hrefFrom(pageRel, "/turk-sporcu-sonuclari.html");
      if (href) items.push({ href, label: turkLabel, kicker: "Sonuç" });
    }
    return items;
  };
  for (const rel of ["istatistik-merkezi.html", "oyuncu-radari.html", "gol-kralligi.html"]) {
    if (!exists(rel)) continue;
    pages += applyBlock(rel, "context-links", renderStrip({
      marker: "context-links",
      aria: rel === "istatistik-merkezi.html" ? "Oyuncu listeleri ve sonuçlar" : "Oyuncu listeleri",
      items: bestItemsFor(rel)
    }), "</main>");
  }

  const transferItemsFor = (pageRel) => transfers.map((item) => {
    const href = hrefFrom(pageRel, `/${item.rel}`);
    return href && item.label ? { href, label: item.label, kicker: "Transfer" } : null;
  }).filter(Boolean);
  if (exists("super-lig-transferleri-2026-2027.html")) {
    pages += applyBlock("super-lig-transferleri-2026-2027.html", "context-links", renderStrip({
      marker: "context-links",
      aria: "Transferde son durum",
      items: transferItemsFor("super-lig-transferleri-2026-2027.html")
    }), "</main>");
  }

  if (turkLabel && exists("milli-takim.html")) {
    const href = hrefFrom("milli-takim.html", "/turk-sporcu-sonuclari.html");
    if (href) {
      pages += applyBlock("milli-takim.html", "context-links", renderStrip({
        marker: "context-links",
        aria: "Türk sporcu sonuçları",
        items: [{ href, label: turkLabel, kicker: "Sonuç" }]
      }), "</main>");
    }
  }

  const trNews = loadNews("data/news.json", "tr");
  const enNews = loadNews("data/news-en.json", "en");
  const attachNews = (rows, locale) => {
    let count = 0;
    for (const article of rows) {
      const picks = selectNewsLinks(rows, article);
      const items = picks.map((item) => {
        const href = hrefFrom(article.rel, `/${item.rel}`);
        if (!href) return null;
        const label = locale === "en" ? englishLabel(item.title, item.team ? `${item.team} report` : "") : item.title;
        if (!label) return null;
        return { href, label, kicker: locale === "en" ? "Report" : "Haber" };
      }).filter(Boolean);
      if (!items.length) continue;
      const aria = locale === "en" ? "Related reports" : "İlgili haberler";
      count += applyBlock(article.rel, "context-links", renderStrip({ marker: "context-links", aria, items }), "</main>");
    }
    return count;
  };
  pages += attachNews(trNews, "tr");
  pages += attachNews(enNews, "en");

  const summerTr = summerHubLinks(trNews).map((item) => {
    const href = hrefFrom("haberler.html", `/${item.rel}`);
    return href ? { href, label: item.title, kicker: "Haber" } : null;
  }).filter(Boolean);
  if (exists("haberler.html") && summerTr.length) {
    pages += applyBlock("haberler.html", "context-news", renderStrip({
      marker: "context-news",
      aria: "Ağustos ve eylül haberleri",
      items: summerTr
    }), "</main>");
  }
  const summerEn = summerHubLinks(enNews).map((item) => {
    const href = hrefFrom("en/news.html", `/${item.rel}`);
    const label = englishLabel(item.title, item.team ? `${item.team} report` : "");
    return href && label ? { href, label, kicker: "Report" } : null;
  }).filter(Boolean);
  if (exists("en/news.html") && summerEn.length) {
    pages += applyBlock("en/news.html", "context-news", renderStrip({
      marker: "context-news",
      aria: "August and September reports",
      items: summerEn
    }), "</main>");
  }

  console.log(`contextual-links: ${pages} sayfa güncellendi`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
