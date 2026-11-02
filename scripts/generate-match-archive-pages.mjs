#!/usr/bin/env node
/**
 * MAÇ ARŞİVİ ÜRETİCİSİ — biten her maç için kalıcı tarihçe sayfası.
 *
 *   mac/<YYYY-MM-DD>/<ev>-<dep>.html   → kanonik /mac/<gün>/<ev>-<dep>
 *
 * Girdi: data/historical-match-archive.json (ana kaynak), data/match-seo-pages.json
 * (eski /mac/<slug> sicili, tur/lig kimliği), data/matches.json (editoryal
 * kayıtlar ve kaynak bağlantıları). Sağlayıcıya istek atılmaz.
 *
 * Çıktılar:
 *   - mac/<gün>/<çift>.html                 (arşiv sayfaları)
 *   - data/match-archive-index.json         (sayfa sicili: indeks kararı, bölümler)
 *   - services/matchArchiveRedirects.generated.mjs (middleware.js'in 301 tablosu)
 *   - sitemap.xml                           (eski maç adresleri çıkar, indekslenebilir arşiv girer)
 *
 * Kural özeti (services/matchArchive.js):
 *   - Bölüm yalnız veri VARSA basılır; boş başlık yok, veri uydurulmaz.
 *   - Veri bloklarının her biri izinli-kaynak bağlantısı taşır; izinli kaynak
 *     yoksa bloklar basılmaz ve sayfa noindex,follow + site haritası dışı.
 *
 * Bayraklar: --limit=N (örnek üretim), --only=<gün/çift>,..., --check (yazmadan say)
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { siteHeader, siteFooter } from "./lib/layout.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";
import { ROBOTS_INDEX, ROBOTS_NOINDEX_FOLLOW } from "./lib/robots.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);
const archive = require("../services/matchArchive.js");
const { SOURCE_LINK_REL } = require("../services/sourceLinks.js");
const { playerLink, playerAbsoluteUrl } = require("../services/playerLinks.js");
const { resolvePlayerByName } = require("../services/playerMatchLogService.js");
const { getPlayers } = require("../services/playerService.js");
const { teamHubHref } = require("../services/teamHubLinks.js");
const { teamPageSlug } = require("../services/superLigTeamPages.js");

const args = process.argv.slice(2);
const CHECK_ONLY = args.includes("--check");
const LIMIT = Number((args.find((a) => a.startsWith("--limit=")) || "").split("=")[1]) || 0;
const ONLY = new Set(((args.find((a) => a.startsWith("--only=")) || "").split("=")[1] || "").split(",").filter(Boolean));
const DOMAIN = archive.DOMAIN;
const BASE = "../../";

const readJson = (rel, fallback) => {
  try { return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8")); } catch { return fallback; }
};
const exists = (rel) => fs.existsSync(path.join(root, rel));

const archiveRecords = (readJson("data/historical-match-archive.json", { records: [] }).records) || [];
const registryPages = (readJson("data/match-seo-pages.json", { pages: [] }).pages) || [];
const curated = readJson("data/matches.json", []);
const squadPlayers = (() => { try { return getPlayers(readJson("data/players.json", [])); } catch { return []; } })();

// Site haritasındaki (yani indekslenebilir) oyuncu profilleri — yalnız bunlara bağlanılır.
const sitemapText = fs.existsSync(path.join(root, "sitemap.xml")) ? fs.readFileSync(path.join(root, "sitemap.xml"), "utf8") : "";
const sitemapLocs = new Set([...sitemapText.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* ---------- 1. Kayıtları topla ---------- */
const registryByKey = new Map();
for (const entry of registryPages) {
  const key = archive.pairKey(entry.homeTeam, entry.awayTeam, entry.kickoff);
  if (key) registryByKey.set(key, entry);
}
const curatedByKey = new Map();
for (const item of Array.isArray(curated) ? curated : []) {
  const key = archive.pairKey(item.homeTeam, item.awayTeam, item.kickoff);
  if (key) curatedByKey.set(key, item);
}

function richness(match) {
  return (match.events || []).length + (match.lineups || []).length * 20 + (match.statistics || []).length * 2;
}

const groups = new Map(); // key -> [{ match, record }]
for (const record of archiveRecords) {
  const match = record && record.match;
  if (!match || !archive.isFinished(match.status)) continue;
  // Skoru olmayan "bitti" kaydı arşiv sayfası almaz: sayfanın kimliği skordur.
  if (!match.score || match.score.home === null || match.score.home === undefined || match.score.away === null || match.score.away === undefined) continue;
  const key = archive.pairKey(match.homeTeam, match.awayTeam, match.kickoff);
  if (!key) continue;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push({ match, record });
}
// Sicilde biten ama arşivde kaydı olmayan maçlar da kalıcı sayfa alır.
for (const [key, entry] of registryByKey) {
  if (groups.has(key) || !archive.isFinished(entry.status)) continue;
  if (!entry.score || entry.score.home === null || entry.score.home === undefined || entry.score.away === null || entry.score.away === undefined) continue;
  groups.set(key, [{ match: { ...entry, id: entry.slug, events: [], lineups: [], statistics: [], competition: entry.league }, record: { lastVerifiedAt: entry.statusFetchedAt || entry.updatedAt } }]);
}

/**
 * Aynı gün aynı eşleşme: skorları aynı olan kayıtlar aynı maçın kopyasıdır
 * (en zengini tutulur, diğerinin eski adresi de ona yönlenir). Farklı skorlu
 * ikinci gerçek maç "-2" son ekini alır.
 */
const pages = [];
for (const [key, items] of groups) {
  const [day, pair] = key.split("/");
  const byScore = new Map();
  for (const item of items) {
    const s = item.match.score || {};
    const scoreKey = `${s.home}-${s.away}`;
    if (!byScore.has(scoreKey)) byScore.set(scoreKey, []);
    byScore.get(scoreKey).push(item);
  }
  const distinct = [...byScore.values()]
    .map((dupes) => dupes.sort((a, b) => richness(b.match) - richness(a.match)))
    .sort((a, b) => String(a[0].match.kickoff).localeCompare(String(b[0].match.kickoff)));
  distinct.forEach((dupes, index) => {
    const slug = index === 0 ? pair : `${pair}-${index + 1}`;
    pages.push({ key, day, slug, primary: dupes[0], duplicates: dupes.slice(1), registry: index === 0 ? registryByKey.get(key) : null, curated: index === 0 ? curatedByKey.get(key) : null });
  });
}
pages.sort((a, b) => a.day.localeCompare(b.day) || a.slug.localeCompare(b.slug));

/* ---------- 2. Sayfa modeli ---------- */
const STANDINGS_BY_ID = { "super-lig": "super-lig-puan-durumu.html", "1-lig": "1-lig-puan-durumu.html", "sampiyonlar-ligi": "sampiyonlar-ligi-puan-durumu.html", "avrupa-ligi": "avrupa-ligi-puan-durumu.html", "konferans-ligi": "konferans-ligi-puan-durumu.html", "premier-lig": "premier-lig-puan-durumu.html", "la-liga": "la-liga-puan-durumu.html", "serie-a": "serie-a-puan-durumu.html", "bundesliga": "bundesliga-puan-durumu.html", "ligue-1": "ligue-1-puan-durumu.html" };

function competitionIdOf(page) {
  if (page.registry && page.registry.competitionId) return page.registry.competitionId;
  const match = page.primary.match;
  const identity = String(page.primary.record.identity || "");
  if (/\|superlig$/.test(identity) || (match.competition === "Süper Lig" && (teamHubHref(match.homeTeam) || teamHubHref(match.awayTeam)))) return "super-lig";
  if (/sampiyonlarligi$/.test(identity)) return "sampiyonlar-ligi";
  if (/avrupaligi$/.test(identity)) return "avrupa-ligi";
  if (/konferansligi$/.test(identity)) return "konferans-ligi";
  return null;
}

function playerHref(name, team) {
  const record = resolvePlayerByName(name, team, squadPlayers);
  if (!record) return null;
  if (!sitemapLocs.has(playerAbsoluteUrl(record.id, DOMAIN))) return null; // noindex profil: bağlantı yok
  return playerLink(record.id, BASE);
}

function model(page) {
  const { match, record } = page.primary;
  const sources = archive.collectSourceUrls(match.sourceUrls, record.sources, record.match && record.match.sourceUrls, page.curated && { sources: page.curated.sources, sourceUrl: page.curated.sourceUrl, sourceUrls: page.curated.sourceUrls, links: page.curated.links }, ...page.duplicates.map((d) => d.match.sourceUrls));
  const goals = archive.goalEvents(match.events);
  const cards = archive.cardEvents(match.events);
  const lineups = archive.lineupBlocks(match.lineups);
  const stats = archive.statRows(match.statistics);
  const score = match.score || {};
  // API-Football kökenli veri (fixture kimliği API-Football'dan) geçerli kaynak sayılır (Ugur, 31 Ekim 2026).
  const apiFootball = [match, record.match, ...page.duplicates.map((d) => d.match), page.registry].some((x) => archive.isApiFootballOrigin(x));
  const decision = archive.indexDecision({ score, sources, goals, lineups, stats, apiFootball });
  const competitionId = competitionIdOf(page);
  const rawRound = (page.registry && page.registry.round) || match.round || (page.curated && page.curated.stage) || null;
  const roundNo = rawRound && /^(?:regular season\s*-\s*)?(\d{1,2})$/i.exec(String(rawRound).trim());
  const round = roundNo ? `${roundNo[1]}. hafta` : rawRound;
  const venue = match.venue && !/açıklanmadı|unknown/i.test(match.venue) ? match.venue : (page.curated && page.curated.venue) || null;
  const lastVerified = record.lastVerifiedAt || match.lastVerifiedAt || (page.registry && page.registry.updatedAt) || null;
  const legacy = new Set();
  if (page.registry && page.registry.slug) legacy.add(`mac/${page.registry.slug}`);
  if (!page.slug.match(/-\d+$/)) legacy.add(`mac/${archive.legacySlugFor(page.day, page.slug)}`);
  for (const item of [page.primary, ...page.duplicates]) {
    const report = item.match.reportPage;
    if (report && /^mac-raporu\//.test(report)) legacy.add(report.replace(/\.html$/, ""));
    if (item.match.id) legacy.add(`mac-raporu/${item.match.id}`);
  }
  return {
    ...page,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    kickoff: match.kickoff,
    competition: match.competition || match.league || (page.registry && page.registry.league) || "",
    competitionId,
    round,
    venue,
    referee: match.referee || null,
    score,
    status: String(match.status || "").toUpperCase(),
    sources,
    apiFootball,
    sourced: sources.length > 0 || apiFootball,
    goals,
    cards,
    lineups,
    stats,
    corners: stats.find((row) => row.corner) || null,
    decision,
    lastVerified,
    legacy: [...legacy].filter((l) => l && exists(`${l}.html`)),
    file: archive.archiveFile(page.day, page.slug),
    url: archive.archiveUrl(page.day, page.slug)
  };
}

const models = pages.map(model);
const byPair = new Map();
for (const m of models) {
  const pairKey = [archive.pairSlug(m.homeTeam, m.awayTeam), archive.pairSlug(m.awayTeam, m.homeTeam)].sort()[0];
  if (!byPair.has(pairKey)) byPair.set(pairKey, []);
  byPair.get(pairKey).push(m);
}

/* ---------- 3. Başlık / açıklama ---------- */
function scoreText(m) {
  return `${m.score.home}-${m.score.away}`;
}

function titleFor(m) {
  const parts = [];
  if (m.goals.length && m.sourced) parts.push("Goller");
  if (m.lineups.length && m.sourced) parts.push("Kadrolar");
  if (m.stats.length && m.sourced) parts.push(m.corners ? "İstatistikler" : "İstatistikler");
  const tail = parts.length ? `Maç Özeti, ${parts.join(" ve ").replace(/ ve (?=.* ve )/, ", ")}` : "Maç Sonucu";
  return `${m.homeTeam} ${scoreText(m)} ${m.awayTeam} (${archive.trDateLabel(m.day)}) ${tail} | FutbolRadar`;
}

function descriptionFor(m) {
  const comp = m.competition ? `${m.competition}${m.round ? ` ${m.round}` : ""} karşılaşmasında ` : "";
  const h = Number(m.score.home), a = Number(m.score.away);
  let text = `${archive.trDateLabel(m.day)} — ${comp}${h === a ? `${m.homeTeam} ile ${m.awayTeam} ${scoreText(m)} berabere kaldı.` : `${h > a ? m.homeTeam : m.awayTeam}, ${h > a ? m.awayTeam : m.homeTeam} karşısında ${h > a ? scoreText(m) : `${a}-${h}`} kazandı.`}`;
  if (m.sourced && m.goals.length) {
    text += ` Goller: ${m.goals.slice(0, 4).map((g) => `${g.player}${g.minute ? ` ${g.minute}` : ""}`).join(", ")}${m.goals.length > 4 ? "…" : ""}.`;
  }
  const extras = [];
  if (m.sourced && m.lineups.length) extras.push("ilk 11'ler");
  if (m.sourced && m.stats.length) extras.push("maç istatistikleri");
  if (m.sourced && m.corners) extras.push("korner sayıları");
  if (extras.length) {
    const list = extras.length > 1 ? `${extras.slice(0, -1).join(", ")} ve ${extras[extras.length - 1]}` : extras[0];
    text += ` ${list.replace(/^./, (c) => c.toLocaleUpperCase("tr-TR"))} kaynak bağlantılarıyla bu sayfada.`;
  }
  return text.length > 300 ? `${text.slice(0, 297)}…` : text;
}

/* ---------- 4. HTML ---------- */
const API_FOOTBALL_URL = "https://www.api-football.com/";
function sourceLine(m) {
  if (!m.sourced) return "";
  const parts = [];
  if (m.sources.length) parts.push(`Kaynak: ${m.sources.map((s) => `<a href="${escapeHtml(s.url)}" rel="${escapeHtml(SOURCE_LINK_REL)}" target="_blank">${escapeHtml(s.host)}</a>`).join(", ")}`);
  if (m.apiFootball) parts.push(`<a href="${API_FOOTBALL_URL}" rel="${escapeHtml(SOURCE_LINK_REL)}" target="_blank">Veri: API-Football</a>`);
  return `<p class="ma-src">${parts.join(" · ")}</p>`;
}

function nameHtml(name, team) {
  const href = playerHref(name, team);
  return href ? `<a href="${escapeHtml(href)}">${escapeHtml(name)}</a>` : escapeHtml(name);
}

function goalsSection(m) {
  if (!m.sourced || !m.goals.length) return "";
  const kind = (g) => (g.kind === "pen" ? " (P)" : g.kind === "kk" ? " (K.K.)" : "");
  return `<section class="ma-card" aria-labelledby="ma-goller"><h2 id="ma-goller">Goller ve golcüler</h2>
      <ol class="ma-goals">${m.goals.map((g) => `<li class="${g.team === m.awayTeam ? "is-away" : "is-home"}"><b>${escapeHtml(g.minute || "–")}</b><span>${nameHtml(g.player, g.team)}${escapeHtml(kind(g))}${g.assist ? `<small>Asist: ${nameHtml(g.assist, g.team)}</small>` : ""}</span><em>${escapeHtml(g.team)}</em></li>`).join("")}</ol>
      ${m.cards.length ? `<h3>Kartlar</h3><ul class="ma-cards">${m.cards.map((c) => `<li><b>${escapeHtml(c.minute)}</b><span class="ma-card-${c.red ? "red" : "yellow"}" aria-label="${c.red ? "Kırmızı kart" : "Sarı kart"}"></span>${escapeHtml(c.player)} <em>${escapeHtml(c.team)}</em></li>`).join("")}</ul>` : ""}
      ${sourceLine(m)}</section>`;
}

function lineupsSection(m) {
  if (!m.sourced || !m.lineups.length) return "";
  const row = (p, team) => `<li>${p.number !== null && p.number !== undefined ? `<b>${escapeHtml(p.number)}</b>` : ""}${nameHtml(p.name, team)}${p.position ? `<em>${escapeHtml(p.position)}</em>` : ""}</li>`;
  return `<section class="ma-card" aria-labelledby="ma-kadro"><h2 id="ma-kadro">Kadrolar ve ilk 11</h2>
      <div class="ma-lineups">${m.lineups.map((l) => `<article><h3>${escapeHtml(l.team)}${l.formation ? ` <small>${escapeHtml(l.formation)}</small>` : ""}</h3><ol>${l.starters.map((p) => row(p, l.team)).join("")}</ol>${l.subs.length ? `<h4>Yedekler</h4><ul>${l.subs.map((p) => row(p, l.team)).join("")}</ul>` : ""}</article>`).join("")}</div>
      ${sourceLine(m)}</section>`;
}

function fmt(value, decimals) {
  if (typeof value === "number" && decimals) return value.toFixed(decimals).replace(".", ",");
  return String(value);
}

function statsSection(m) {
  if (!m.sourced || !m.stats.length) return "";
  const rows = [...m.stats].sort((a, b) => Number(b.corner) - Number(a.corner));
  return `<section class="ma-card" aria-labelledby="ma-istatistik"><h2 id="ma-istatistik">Maç istatistikleri${m.corners ? " ve kornerler" : ""}</h2>
      <table class="ma-stats"><thead><tr><th scope="col">${escapeHtml(m.homeTeam)}</th><th scope="col">İstatistik</th><th scope="col">${escapeHtml(m.awayTeam)}</th></tr></thead><tbody>${rows.map((r) => `<tr${r.corner ? ' class="is-corner"' : ""}><td>${escapeHtml(fmt(r.home, r.decimals))}</td><th scope="row">${escapeHtml(r.type)}</th><td>${escapeHtml(fmt(r.away, r.decimals))}</td></tr>`).join("")}</tbody></table>
      ${sourceLine(m)}</section>`;
}

function linksSection(m) {
  const links = [];
  for (const team of [m.homeTeam, m.awayTeam]) {
    const hub = teamHubHref(team, BASE);
    if (hub) links.push([hub, `${team} maçları`]);
    const slug = teamPageSlug(team);
    if (slug && exists(`takimlar/${slug}.html`)) links.push([`${BASE}takimlar/${slug}`, `${team} takım sayfası`]);
  }
  const standings = m.competitionId && STANDINGS_BY_ID[m.competitionId];
  if (standings && exists(standings)) links.push([`${BASE}${standings}`, `${m.competition} puan durumu`]);
  if (m.competitionId === "super-lig" && exists("gol-kralligi.html")) links.push([`${BASE}gol-kralligi.html`, "Süper Lig gol krallığı"]);
  const hs = teamPageSlug(m.homeTeam), as = teamPageSlug(m.awayTeam);
  for (const file of [`karsilastirma/takimlar/${hs}-vs-${as}.html`, `karsilastirma/takimlar/${as}-vs-${hs}.html`]) {
    if (hs && as && exists(file)) { links.push([`${BASE}${file.replace(/\.html$/, "")}`, `${m.homeTeam} - ${m.awayTeam} karşılaştırması`]); break; }
  }
  const pairKey = [archive.pairSlug(m.homeTeam, m.awayTeam), archive.pairSlug(m.awayTeam, m.homeTeam)].sort()[0];
  const meetings = (byPair.get(pairKey) || []).filter((x) => x !== m).sort((a, b) => b.day.localeCompare(a.day)).slice(0, 6);
  const meetingHtml = meetings.length ? `<h3>Aynı eşleşmenin diğer maçları</h3><ul class="ma-links">${meetings.map((x) => `<li><a href="${BASE}mac/${x.day}/${x.slug}">${escapeHtml(x.homeTeam)} ${escapeHtml(scoreText(x))} ${escapeHtml(x.awayTeam)} · ${escapeHtml(archive.trDateLabel(x.day))}</a></li>`).join("")}</ul>` : "";
  if (!links.length && !meetingHtml) return "";
  return `<section class="ma-card" aria-labelledby="ma-baglantilar"><h2 id="ma-baglantilar">İlgili sayfalar</h2>${links.length ? `<ul class="ma-links">${links.map(([href, label]) => `<li><a href="${escapeHtml(href)}">${escapeHtml(label)}</a></li>`).join("")}</ul>` : ""}${meetingHtml}</section>`;
}

const STYLE = `<style>
.ma-wrap{max-width:860px;margin:0 auto;padding:12px 14px 32px;box-sizing:border-box}
.ma-wrap *{box-sizing:border-box;overflow-wrap:anywhere}
.ma-hero{border-radius:14px;padding:16px;background:var(--surface,#fff);border:1px solid var(--line,#e3e7ee)}
.ma-hero .ma-eyebrow{font-size:.82rem;opacity:.75;margin:0 0 6px}
.ma-hero h1{font-size:1.25rem;line-height:1.3;margin:0 0 12px}
.ma-board{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px;text-align:center}
.ma-board strong{font-size:1rem}.ma-board .ma-score{font-size:2rem;font-weight:800;white-space:nowrap}
.ma-board small{display:block;font-size:.75rem;opacity:.7;font-weight:500}
.ma-meta{display:flex;flex-wrap:wrap;gap:6px 12px;margin:12px 0 0;padding:0;list-style:none;font-size:.85rem;opacity:.85}
.ma-card{margin-top:14px;border-radius:14px;padding:14px;background:var(--surface,#fff);border:1px solid var(--line,#e3e7ee)}
.ma-card h2{font-size:1.05rem;margin:0 0 10px}.ma-card h3{font-size:.95rem;margin:12px 0 6px}.ma-card h4{font-size:.85rem;margin:10px 0 4px;opacity:.8}
.ma-goals,.ma-cards,.ma-links,.ma-lineups ol,.ma-lineups ul{list-style:none;margin:0;padding:0}
.ma-goals li{display:grid;grid-template-columns:44px 1fr;gap:2px 8px;padding:8px 0;border-top:1px solid var(--line,#eef1f5)}
.ma-goals li em{grid-column:2;font-size:.78rem;opacity:.7;font-style:normal}.ma-goals small{display:block;font-size:.78rem;opacity:.75}
.ma-cards li{padding:6px 0;font-size:.88rem}.ma-cards em{opacity:.7;font-style:normal}.ma-cards b{display:inline-block;min-width:40px}
.ma-card-yellow,.ma-card-red{display:inline-block;width:10px;height:14px;border-radius:2px;margin-right:6px;vertical-align:-2px;background:#f2c200}.ma-card-red{background:#d6332e}
.ma-lineups{display:grid;grid-template-columns:1fr;gap:12px}
.ma-lineups li{display:flex;gap:8px;align-items:center;min-height:32px;border-top:1px solid var(--line,#eef1f5);font-size:.9rem}
.ma-lineups li b{min-width:24px;text-align:right;opacity:.7}.ma-lineups li em{margin-left:auto;font-style:normal;opacity:.6;font-size:.75rem}
.ma-stats{width:100%;border-collapse:collapse;table-layout:fixed;font-size:.88rem}
.ma-stats th,.ma-stats td{padding:7px 4px;border-top:1px solid var(--line,#eef1f5);text-align:center}
.ma-stats thead th{font-size:.78rem;opacity:.75}.ma-stats tbody th{font-weight:500;width:50%}
.ma-stats tr.is-corner{background:rgba(0,120,80,.07);font-weight:700}
.ma-src{margin:10px 0 0;font-size:.78rem;opacity:.8}.ma-src a{display:inline-block;min-height:32px;line-height:32px}
.ma-links li a{display:flex;align-items:center;min-height:40px;border-top:1px solid var(--line,#eef1f5)}
.ma-note{font-size:.85rem;opacity:.8}
.ma-wrap a{min-height:32px}
.ma-lineups li a,.ma-goals a{display:inline-flex;align-items:center;min-height:32px}
@media(min-width:720px){.ma-lineups{grid-template-columns:1fr 1fr}.ma-hero h1{font-size:1.5rem}}
</style>`;

const PWA_BLOCK = `<!-- pwa:start -->
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
<meta name="apple-mobile-web-app-title" content="FutbolRadar" />
<meta name="fr-vapid-public-key" content="${String(process.env.VAPID_PUBLIC_KEY || "").trim().replace(/"/g, "&quot;")}" />
<script defer src="/pwa.js"></script>
<!-- pwa:end -->`;

function schemaFor(m, title, description) {
  const canonical = m.url;
  const event = {
    "@type": "SportsEvent",
    "@id": `${canonical}#mac`,
    name: `${m.homeTeam} - ${m.awayTeam}`,
    url: canonical,
    startDate: m.kickoff,
    eventStatus: "https://schema.org/EventScheduled",
    sport: "Football",
    description,
    homeTeam: { "@type": "SportsTeam", name: m.homeTeam },
    awayTeam: { "@type": "SportsTeam", name: m.awayTeam },
    competitor: [{ "@type": "SportsTeam", name: m.homeTeam }, { "@type": "SportsTeam", name: m.awayTeam }]
  };
  if (m.venue) event.location = { "@type": "StadiumOrArena", name: m.venue };
  if (m.competition) event.superEvent = { "@type": "SportsEvent", name: m.competition };
  const page = {
    "@type": "WebPage",
    "@id": canonical,
    url: canonical,
    name: title,
    description,
    inLanguage: "tr-TR",
    about: { "@id": `${canonical}#mac` },
    datePublished: m.kickoff,
    ...(m.lastVerified ? { dateModified: m.lastVerified } : {}),
    isPartOf: { "@type": "WebSite", name: "FutbolRadar", url: `${DOMAIN}/` }
  };
  const crumbs = { "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: "Ana Sayfa", item: `${DOMAIN}/` },
    { "@type": "ListItem", position: 2, name: "Maç Sonuçları", item: `${DOMAIN}/mac-sonuclari.html` },
    { "@type": "ListItem", position: 3, name: `${m.homeTeam} - ${m.awayTeam}`, item: canonical }
  ] };
  return { "@context": "https://schema.org", "@graph": [event, page, crumbs] };
}

function pageHtml(m) {
  const title = titleFor(m);
  const description = descriptionFor(m);
  const indexable = m.decision.indexable;
  const sections = [goalsSection(m), lineupsSection(m), statsSection(m)].filter(Boolean);
  const halftime = m.score.halftimeHome !== null && m.score.halftimeHome !== undefined && m.score.halftimeAway !== null && m.score.halftimeAway !== undefined;
  const meta = [
    `<li><time datetime="${escapeHtml(m.kickoff)}">${escapeHtml(archive.trDateLabel(m.day))}</time></li>`,
    m.competition ? `<li>${escapeHtml(m.competition)}${m.round ? ` · ${escapeHtml(m.round)}` : ""}</li>` : "",
    m.venue && m.sourced ? `<li>Stat: ${escapeHtml(m.venue)}</li>` : "",
    m.referee && m.sourced ? `<li>Hakem: ${escapeHtml(m.referee)}</li>` : "",
    m.status === "AWARDED" ? "<li>Hükmen sonuçlandı</li>" : ""
  ].filter(Boolean).join("");
  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${m.url}" />
    <meta name="robots" content="${indexable ? ROBOTS_INDEX : ROBOTS_NOINDEX_FOLLOW}" />
    <meta name="fr-archive-reason" content="${escapeHtml(m.decision.reason)}" />
    <meta property="og:type" content="article" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:url" content="${m.url}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${DOMAIN}/assets/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    ${m.lastVerified ? `<meta property="article:modified_time" content="${escapeHtml(m.lastVerified)}" />` : ""}
    <script type="application/ld+json">${JSON.stringify(schemaFor(m, title, description)).replace(/</g, "\\u003c")}</script>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="/site.webmanifest" />
    <link rel="stylesheet" href="${BASE}page.css" />
    ${STYLE}
  ${PWA_BLOCK}
  </head>
  <body class="subpage match-archive-page">
    ${siteHeader({ base: BASE })}
    <main class="ma-wrap">
      <nav class="breadcrumb" aria-label="Sayfa yolu"><a href="${BASE}index.html">Ana Sayfa</a><span>/</span><a href="${BASE}mac-sonuclari.html">Maç Sonuçları</a><span>/</span><span>${escapeHtml(m.homeTeam)} - ${escapeHtml(m.awayTeam)}</span></nav>
      <section class="ma-hero" aria-label="Maç sonucu">
        <p class="ma-eyebrow">Maç arşivi${m.competition ? ` · ${escapeHtml(m.competition)}` : ""}</p>
        <h1>${escapeHtml(m.homeTeam)} ${escapeHtml(scoreText(m))} ${escapeHtml(m.awayTeam)} maç özeti</h1>
        <div class="ma-board"><strong>${escapeHtml(m.homeTeam)}</strong><div class="ma-score">${escapeHtml(m.score.home)} - ${escapeHtml(m.score.away)}${halftime ? `<small>İY ${escapeHtml(m.score.halftimeHome)}-${escapeHtml(m.score.halftimeAway)}</small>` : ""}</div><strong>${escapeHtml(m.awayTeam)}</strong></div>
        <ul class="ma-meta">${meta}</ul>
        ${m.sourced ? sourceLine(m) : ""}
      </section>
      ${sections.join("\n      ")}
      ${sections.length ? "" : `<p class="ma-note">Bu maçın gol, kadro ve istatistik dökümü için izinli bir kaynak bağlantısı henüz yok; doğrulanmamış veri gösterilmiyor.</p>`}
      ${linksSection(m)}
    </main>
    ${siteFooter({ base: BASE })}
    <script src="${BASE}site.js" defer></script>
  </body>
</html>
`;
}

/* ---------- 5. Yaz ---------- */
let selected = models;
if (ONLY.size) selected = models.filter((m) => ONLY.has(`${m.day}/${m.slug}`));
else if (LIMIT) {
  // Örnek: tüm indekslenebilirler + her nedenden birkaç noindex.
  const idx = models.filter((m) => m.decision.indexable);
  const reasons = new Map();
  for (const m of models) if (!m.decision.indexable) { const list = reasons.get(m.decision.reason) || []; if (list.length < 5) list.push(m); reasons.set(m.decision.reason, list); }
  selected = [...idx, ...[...reasons.values()].flat()].slice(0, Math.max(LIMIT, idx.length));
}
let written = 0, unchanged = 0;
const expected = new Set(selected.map((m) => m.file));
if (!CHECK_ONLY) {
  for (const m of selected) {
    const html = pageHtml(m);
    const full = path.join(root, m.file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    if (fs.existsSync(full) && fs.readFileSync(full, "utf8") === html) { unchanged += 1; continue; }
    fs.writeFileSync(full, html, "utf8");
    written += 1;
  }
  // Sicil dışı kalan arşiv dosyaları (tam koşuda) silinir.
  if (!LIMIT && !ONLY.size) {
    for (const dir of fs.readdirSync(path.join(root, "mac"), { withFileTypes: true })) {
      if (!dir.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(dir.name)) continue;
      for (const file of fs.readdirSync(path.join(root, "mac", dir.name))) {
        if (!expected.has(`mac/${dir.name}/${file}`)) fs.unlinkSync(path.join(root, "mac", dir.name, file));
      }
    }
  }
}
const generated = new Set(selected.map((m) => m.file));

/* ---------- 6. Yönlendirme tablosu (middleware.js) ---------- */
// Yalnız sayfası gerçekten üretilen maçlar yönlendirilir; yoksa eski adres yaşar.
const redirects = {};
const ruleKeys = [];
for (const m of models) {
  if (!generated.has(m.file)) continue;
  const target = `${m.day}/${m.slug}`;
  for (const legacy of m.legacy) {
    const rule = /^mac-raporu\/(.+)-(\d{4}-\d{2}-\d{2})$/.exec(legacy);
    if (rule && `${rule[2]}/${rule[1]}` === target) ruleKeys.push(legacy.slice("mac-raporu/".length));
    else redirects[legacy] = target;
  }
}
const redirectModule = `// OTOMATİK ÜRETİLDİ — scripts/generate-match-archive-pages.mjs. Elle düzenleme.
// RAPOR_KURAL: "mac-raporu/<çift>-<gün>" → "/mac/<gün>/<çift>" kuralına uyan anahtarlar.
// ISTISNA: diğer eski adresler → arşiv hedefi ("<gün>/<çift>").
export const RAPOR_KURAL = new Set(${JSON.stringify(ruleKeys.sort())});
export const ISTISNA = ${JSON.stringify(Object.fromEntries(Object.entries(redirects).sort()))};
`;

/* ---------- 7. Sicil + site haritası ---------- */
const sectionCounts = { goals: 0, lineups: 0, stats: 0, corners: 0, cards: 0 };
const reasons = {};
for (const m of models) {
  reasons[m.decision.reason] = (reasons[m.decision.reason] || 0) + 1;
  if (m.sourced) {
    if (m.goals.length) sectionCounts.goals += 1;
    if (m.lineups.length) sectionCounts.lineups += 1;
    if (m.stats.length) sectionCounts.stats += 1;
    if (m.corners) sectionCounts.corners += 1;
    if (m.cards.length) sectionCounts.cards += 1;
  }
}
const indexRecords = models.map((m) => ({
  path: `${m.day}/${m.slug}`,
  homeTeam: m.homeTeam,
  awayTeam: m.awayTeam,
  score: `${m.score.home}-${m.score.away}`,
  competition: m.competition,
  indexable: m.decision.indexable,
  reason: m.decision.reason,
  sections: [m.sourced && m.goals.length && "goals", m.sourced && m.lineups.length && "lineups", m.sourced && m.stats.length && "stats", m.sourced && m.corners && "corners"].filter(Boolean),
  lastmod: m.lastVerified ? String(m.lastVerified).slice(0, 10) : null,
  legacy: m.legacy,
  generated: generated.has(m.file)
}));

let sitemapBefore = 0, sitemapAfter = 0, removedLegacy = 0;
if (!CHECK_ONLY) {
  fs.writeFileSync(path.join(root, "services", "matchArchiveRedirects.generated.mjs"), redirectModule, "utf8");
  fs.writeFileSync(path.join(root, "data", "match-archive-index.json"), `${JSON.stringify({ version: 1, generatedFrom: "data/historical-match-archive.json", pageCount: models.length, indexableCount: models.filter((m) => m.decision.indexable).length, reasons, sectionCounts, records: indexRecords })}\n`, "utf8");

  const redirectedLocs = new Set();
  for (const m of models) {
    if (!generated.has(m.file)) continue;
    for (const legacy of m.legacy) { redirectedLocs.add(`${DOMAIN}/${legacy}`); redirectedLocs.add(`${DOMAIN}/${legacy}.html`); }
  }
  const newUrlFor = new Map();
  for (const m of models) if (generated.has(m.file)) for (const legacy of m.legacy) { newUrlFor.set(`${DOMAIN}/${legacy}`, m); newUrlFor.set(`${DOMAIN}/${legacy}.html`, m); }
  for (const file of ["sitemap.xml", path.join("public", "sitemap.xml")]) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    const xml = fs.readFileSync(full, "utf8");
    const entries = xml.match(URL_ENTRY_RE) || [];
    const kept = [];
    for (const entry of entries) {
      const loc = (/<loc>([^<]+)<\/loc>/.exec(entry) || [])[1] || "";
      if (redirectedLocs.has(loc) || /^https:\/\/www\.futbolradar\.com\/mac\/\d{4}-\d{2}-\d{2}\//.test(loc)) { if (!/\/mac\/\d{4}-/.test(loc)) removedLegacy += file === "sitemap.xml" ? 1 : 0; continue; }
      // EN maç sayfasının TR alternatifi artık 301 veren eski adres: hreflang
      // kümesi geri bildirimsiz kalacağı için o girdinin alternate satırları düşer.
      const alternates = [...entry.matchAll(/<xhtml:link rel="alternate" hreflang="[^"]+" href="([^"]+)"\/>/g)].map((x) => x[1]);
      const fixed = alternates.some((href) => newUrlFor.has(href))
        ? entry.replace(/\n?[ \t]*<xhtml:link rel="alternate"[^>]*\/>/g, "")
        : entry;
      kept.push(fixed);
    }
    const additions = models.filter((m) => generated.has(m.file) && m.decision.indexable).map((m) => `  <url>\n    <loc>${m.url}</loc>\n    <lastmod>${m.lastVerified ? String(m.lastVerified).slice(0, 10) : m.day}</lastmod>\n    <changefreq>yearly</changefreq>\n    <priority>0.6</priority>\n  </url>`);
    if (file === "sitemap.xml") { sitemapBefore = entries.length; sitemapAfter = kept.length + additions.length; }
    fs.writeFileSync(full, wrapUrlset([...kept, ...additions]), "utf8");
  }
}

console.log(`[match-archive] maç: ${models.length} (indekslenebilir ${models.filter((m) => m.decision.indexable).length}); üretilen ${selected.length} (yazılan ${written}, değişmeyen ${unchanged}); nedenler ${JSON.stringify(reasons)}; bölümler ${JSON.stringify(sectionCounts)}; yönlendirme kural ${ruleKeys.length} + istisna ${Object.keys(redirects).length}; site haritası ${sitemapBefore} → ${sitemapAfter} (eski maç adresi çıkan: ${removedLegacy})`);
