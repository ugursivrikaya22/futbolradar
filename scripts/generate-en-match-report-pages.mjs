#!/usr/bin/env node
/**
 * İNGİLİZCE MAÇ RAPORLARI — /en/match-report/<slug>.html
 *
 * Türkçe `mac-raporu/<slug>.html` sayfalarının İngilizce karşılığı. Kapsam
 * Türkçe tarafla BİREBİR: diskte Türkçe raporu olan her maç bir İngilizce
 * rapor alır, olmayan almaz.
 *
 * METİN ÇEVRİLMİYOR, VERİDEN KURULUYOR. Türkçe rapordaki cümleler
 * (`services/matchReportService.js`) Türkçe şablon metnidir; onları makine
 * çevirisiyle çoğaltmak yerine İngilizce sayfa aynı YAPISAL veriden
 * (skor, tarih, stat, olay akışı, kadro, istatistik) kendi cümlelerini
 * kurar. Türkçe serbest metin taşıyan alanlar (elle yazılmış olay
 * açıklamaları, değişiklik notları) İngilizce sayfaya ALINMAZ; yalnızca
 * dilden bağımsız olgu (dakika, takım, olay türü) basılır.
 *
 * İNCE SAYFA KURALI TÜRKÇE TARAFLA AYNI (bkz. generate-post-match-pages.mjs):
 *   • kalıcı maç sayfası (`/en/match/...`) olan rapor → canonical oraya,
 *   • kapsamı %40 ve altında, kalıcı sayfası olmayan rapor → noindex,follow,
 *   • geri kalanı indekslenir ve site haritasına girer.
 * Raporların ezici çoğunluğu yalnızca skor taşıdığı için noindex'tir;
 * İngilizce yüzey okuyucuya açılır ama arama dizinine ince sayfa eklenmez.
 *
 * SAYFALAR DEPOYA İŞLENMEZ: her derlemede arşivden yeniden üretilir.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { siteHeader, siteFooter } from "./lib/layout.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";
import { ROBOTS_INDEX, ROBOTS_NOINDEX_FOLLOW } from "./lib/robots.mjs";
import { findTurkish } from "./lib/turkish-detector.mjs";

const require = createRequire(import.meta.url);
const { pageShareHtml } = require("../services/columnShare.js");
const {
  DOMAIN,
  competitionLabel,
  formatDate,
  formatTime,
  htmlLang,
  ogLocale,
  writeDynamicRoutePairs
} = require("../services/i18n.js");
const { venueLabel } = require("../services/displayLabels.js");
const { slug: teamSlug } = require("../services/superLigTeams.js");
const { enPathForMatch, loadRegistry } = require("../services/matchSeoPages.js");
const { getPlayers } = require("../services/playerService.js");
const { resolvePlayerByName } = require("../services/playerMatchLogService.js");
const playerUrls = require("../services/playerUrl.js").createPlayerUrlResolver((() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "player-url-slugs.json"), "utf8"));
  } catch {
    return { entries: [], aliases: [] };
  }
})());

const root = process.cwd();
const LOCALE = "en";
const BASE = "../../";
const TR_DIR = path.join(root, "mac-raporu");
const OUT_DIR = path.join(root, "en", "match-report");
/** Türkçe üreticiyle aynı eşik: bu yüzdenin altında ve eşitinde rapor incedir. */
const THIN_COVERAGE_THRESHOLD = 40;

function readJson(relative, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
  } catch (error) {
    console.warn(`[en-match-report] ${relative} okunamadı (${error.code || error.message})`);
    return fallback;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** Bu metin İngilizce sayfaya güvenle basılabilir mi? (Türkçe işlev sözcüğü yok.) */
function isClean(value) {
  return findTurkish(String(value || ""), { limit: 1 }).length === 0;
}

// ── Sözlükler ───────────────────────────────────────────────────────────────
// İstatistik adları veride Türkçe hazır metin olarak duruyor. Çeviri burada,
// sunum katmanında; karşılığı olmayan satır İngilizce sayfaya basılmaz.
const STAT_TYPES = {
  "İsabetli pas": "Accurate passes",
  "Ceza sahası içinden şut": "Shots inside the box",
  "Ceza sahası dışından şut": "Shots outside the box",
  "Engellenen şut": "Blocked shots",
  "İsabetli şut": "Shots on target",
  "Kurtarış": "Saves",
  "İsabetsiz şut": "Shots off target",
  "Ofsayt": "Offsides",
  "Toplam pas": "Total passes",
  "Kırmızı kart": "Red cards",
  "Toplam şut": "Total shots",
  "Sarı kart": "Yellow cards",
  "Korner": "Corners",
  "Faul": "Fouls",
  "Topla oynama": "Possession",
  "Gol beklentisi (xG)": "Expected goals (xG)",
  "Pas isabeti": "Pass accuracy",
  "Önlenen gol": "Goals prevented",
  "Direkten dönen şut": "Shots off the woodwork",
  "Kaçan net pozisyon": "Big chances missed",
  "Rakip ceza sahasında topla buluşma": "Touches in the opposition box",
  "Taç atışı": "Throw-ins",
  "Toplam orta": "Total crosses",
  "İsabetli orta": "Accurate crosses",
  "Kazanılan ikili mücadele": "Duels won",
  "Başarılı top kapma": "Successful tackles",
  "Kazanılan hava topu": "Aerial duels won",
  "Başarılı çalım": "Successful dribbles",
  "Pasa müdahale": "Interceptions",
  "Uzaklaştırma": "Clearances"
};
const STAT_CATEGORIES = {
  "Genel": "General",
  "Hücum": "Attack",
  "Pas": "Passing",
  "Savunma": "Defence",
  "Disiplin": "Discipline",
  "Mücadele": "Duels"
};
const PERCENT_STATS = new Set(["Topla oynama", "Pas isabeti"]);

// Lig adları: `competitionLabel` bilinen yarışmaları çevirir; aşağıdaki
// ek eşleme arşivde Türkçe yazılmış kalan adları kapsar.
const LEAGUE_EXTRA = {
  "Hazırlık Maçı": "Club Friendlies",
  "Hazırlık Maçları": "Club Friendlies",
  "Türkiye Kupası": "Turkish Cup",
  "Ziraat Türkiye Kupası": "Turkish Cup",
  "Süper Kupa": "Turkish Super Cup",
  "Turkcell Süper Kupa": "Turkish Super Cup",
  "UEFA Uluslar Ligi": "UEFA Nations League",
  "UEFA Şampiyonlar Ligi": "UEFA Champions League",
  "Şampiyonlar Ligi": "UEFA Champions League",
  "UEFA Avrupa Ligi": "UEFA Europa League",
  "Avrupa Ligi": "UEFA Europa League",
  "UEFA Konferans Ligi": "UEFA Europa Conference League",
  "Konferans Ligi": "UEFA Europa Conference League",
  "Dünya Kupası Elemeleri": "World Cup Qualifiers",
  "Milli Maç": "International",
  "Hazırlık": "Friendly"
};

function leagueLabel(name) {
  const raw = String(name || "").trim();
  if (!raw) return "";
  if (LEAGUE_EXTRA[raw]) return LEAGUE_EXTRA[raw];
  const label = competitionLabel(raw, LOCALE) || raw;
  return label;
}

function monogram(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return parts.slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("");
}

function hasScore(score) {
  return Boolean(score) && typeof score.home === "number" && typeof score.away === "number";
}

function hasHalftime(score) {
  return [score && score.halftimeHome, score && score.halftimeAway].every((value) => {
    if (value === null || value === undefined || value === "") return false;
    return Number.isFinite(Number(value));
  });
}

// ── Veri ────────────────────────────────────────────────────────────────────
const archive = readJson("data/historical-match-archive.json", { records: [] });
const reportStore = readJson("data/post-match-reports.json", { records: [] });
const seoRegistryPages = loadRegistry().pages;
const squadPlayers = (() => {
  try {
    return getPlayers(readJson("data/players.json", []));
  } catch {
    return [];
  }
})();

/** Dosya adı → arşiv maçı. */
const matchByFile = new Map();
for (const record of archive.records || []) {
  const match = record && record.match;
  const page = match && match.reportPage;
  if (page && page.startsWith("mac-raporu/")) matchByFile.set(path.basename(page), match);
}
/** Dosya adı → rapor deposu kaydı (kapsam yüzdesi + arşivde olmayan maçın künyesi). */
const storeByFile = new Map();
for (const record of reportStore.records || []) {
  const page = record && record.seo && record.seo.path;
  if (page && page.startsWith("mac-raporu/")) storeByFile.set(path.basename(page), record);
}

/** Depo kaydından asgari maç künyesi (arşivde karşılığı olmayan raporlar için). */
function matchFromStore(record) {
  const score = record.finalScore || record.score;
  return {
    id: record.matchId,
    homeTeam: record.homeTeam,
    awayTeam: record.awayTeam,
    kickoff: record.kickoff,
    league: record.league || record.competition,
    status: record.status,
    providerStatus: record.providerStatus,
    providerIds: record.providerIds,
    venue: record.venue,
    score: score && typeof score.home === "number" && typeof score.away === "number" ? score : null,
    events: [],
    lineups: [],
    statistics: []
  };
}

/**
 * SON ÇARE: Türkçe rapor sayfasının kendi yapısal verisi.
 *
 * Birkaç eski raporun ne arşivde ne rapor deposunda kaydı var; sayfa ise
 * yayında. O sayfanın JSON-LD'si (SportsEvent) ve skor panosu maçın
 * dilden bağımsız künyesini taşıyor. Yalnızca bu yapısal alanlar okunur;
 * Türkçe cümleler alınmaz.
 */
function matchFromTurkishPage(file) {
  let html = "";
  try {
    html = fs.readFileSync(path.join(TR_DIR, file), "utf8");
  } catch {
    return null;
  }
  const block = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!block) return null;
  let event = null;
  try {
    const graph = JSON.parse(block[1])["@graph"] || [];
    event = graph.find((node) => node && node["@type"] === "SportsEvent") || null;
  } catch {
    return null;
  }
  if (!event || !event.homeTeam || !event.awayTeam) return null;
  const board = html.match(/<div class="post-match-score">[\s\S]*?<b>(\d+)<i>-<\/i>(\d+)<\/b>(?:<small>[^<]*?(\d+)-(\d+)<\/small>)?/);
  const eyebrow = html.match(/<span class="eyebrow">([^<]*)<\/span>/);
  return {
    id: file.replace(/\.html$/, ""),
    homeTeam: event.homeTeam.name,
    awayTeam: event.awayTeam.name,
    kickoff: event.startDate || null,
    league: eyebrow ? eyebrow[1].split(" · ")[0].trim() : "",
    status: "FINISHED",
    venue: event.location && event.location.name ? event.location.name : null,
    score: board
      ? { home: Number(board[1]), away: Number(board[2]), halftimeHome: board[3] ? Number(board[3]) : null, halftimeAway: board[4] ? Number(board[4]) : null }
      : null,
    events: [],
    lineups: [],
    statistics: []
  };
}

// ── Bağlantılar ─────────────────────────────────────────────────────────────
const existsCache = new Map();
function pageExists(relative) {
  if (!existsCache.has(relative)) existsCache.set(relative, fs.existsSync(path.join(root, relative)));
  return existsCache.get(relative);
}

/** Takımın İngilizce sayfası: önce Süper Lig takım sayfası, sonra kulüp sayfası. */
function teamHref(name) {
  const slug = teamSlug(name);
  if (!slug) return null;
  if (pageExists(`en/team/${slug}.html`)) return `${BASE}en/team/${slug}.html`;
  if (pageExists(`en/club/${slug}.html`)) return `${BASE}en/club/${slug}.html`;
  return null;
}

function playerHref(name, team) {
  const record = resolvePlayerByName(name, team, squadPlayers);
  if (!record) return null;
  const profile = playerUrls.enPlayerPagePath(record.id);
  return pageExists(profile) ? `${BASE}${profile}` : null;
}

// ── Cümleler ────────────────────────────────────────────────────────────────
function finishKind(match) {
  const status = String(match.status || "").toUpperCase();
  const provider = String(match.providerStatus || "").toUpperCase();
  if (status === "CANCELLED") return "cancelled";
  if (status === "AWARDED" || provider === "AWD" || provider === "WO") return "awarded";
  if (provider === "PEN") return "penalties";
  if (provider === "AET") return "extra-time";
  return "regular";
}

function resultSentence(match, dateText) {
  const { homeTeam: home, awayTeam: away, score } = match;
  const kind = finishKind(match);
  const when = dateText ? ` on ${dateText}` : "";
  const where = match.venue && isClean(match.venue) ? ` at ${venueLabel(match.venue, LOCALE)}` : "";
  if (kind === "cancelled") return `${home} v ${away}${when} was cancelled.`;
  if (!hasScore(score)) {
    return kind === "awarded"
      ? `${home} v ${away}${when} was decided by an awarded result; no score was published.`
      : `${home} met ${away}${when}${where}. The final score has not been published.`;
  }
  const tail = kind === "extra-time" ? " after extra time"
    : kind === "penalties" ? ", with the tie then settled by a penalty shoot-out"
    : kind === "awarded" ? " (awarded result)"
    : "";
  if (score.home > score.away) return `${home} beat ${away} ${score.home}-${score.away}${when}${where}${tail}.`;
  if (score.away > score.home) return `${away} won ${score.away}-${score.home} away to ${home}${when}${where}${tail}.`;
  return `${home} and ${away} drew ${score.home}-${score.away}${when}${where}${tail}.`;
}

function sectionList(flags) {
  const parts = [];
  if (flags.events) parts.push("the goals and key events");
  if (flags.lineups) parts.push("the line-ups");
  if (flags.stats) parts.push("team statistics");
  if (!parts.length) return "";
  const joined = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `This report covers ${joined}.`;
}

// ── Bölümler ────────────────────────────────────────────────────────────────
/**
 * Olay akışı. Yalnızca sağlayıcı türleri (Goal/Card/subst/Var) tam basılır:
 * bunların ayrıntı alanı İngilizcedir. Elle girilmiş Türkçe türlerde ("Gol",
 * "Kırmızı kart") yalnızca olgu basılır — dakika, takım, tür — Türkçe
 * açıklama cümlesi alınmaz. Diğer elle girilmiş türler (direk, kurtarış…)
 * İngilizce sayfada yer almaz.
 */
function eventRows(match) {
  const rows = [];
  for (const event of match.events || []) {
    if (!event) continue;
    const type = String(event.type || "");
    const detail = String(event.detail || "");
    const team = event.team && event.team.name ? String(event.team.name) : "";
    const minute = String(event.time || "").trim();
    const pieces = String(event.value || "").split(" · ").map((piece) => piece.trim()).filter(Boolean);
    const player = pieces.length && !/^Asist:/i.test(pieces[0]) && pieces[0] !== detail ? pieces[0] : "";
    const assistPiece = pieces.find((piece) => /^Asist:/i.test(piece));
    const second = assistPiece ? assistPiece.replace(/^Asist:\s*/i, "") : "";
    let label = "";
    let text = "";
    let isGoal = false;
    if (type === "Goal") {
      isGoal = detail !== "Missed Penalty";
      label = detail === "Penalty" ? "Penalty goal"
        : detail === "Own Goal" ? "Own goal"
        : detail === "Missed Penalty" ? "Missed penalty"
        : "Goal";
      text = player ? `${player}${second && isGoal && detail !== "Own Goal" ? ` (assist: ${second})` : ""}` : "";
    } else if (type === "Card") {
      label = /red/i.test(detail) ? "Red card" : "Yellow card";
      const reason = String(event.comments || "").trim();
      text = player ? `${player}${reason && isClean(reason) ? ` (${reason.toLowerCase()})` : ""}` : "";
    } else if (type === "subst") {
      label = "Substitution";
      text = [player, second].filter(Boolean).join(" / ");
    } else if (type === "Var") {
      label = "VAR";
      text = [detail && isClean(detail) ? detail : "", player].filter(Boolean).join(" — ");
    } else if (type === "Gol") {
      label = "Goal";
      isGoal = true;
    } else if (/^kırmızı kart$/i.test(type)) {
      label = "Red card";
    } else {
      continue;
    }
    if (text && !isClean(text)) text = "";
    rows.push({ minute: minute && minute !== "-" ? minute : "", label, team, text, isGoal });
  }
  return rows;
}

function eventsSectionHtml(match) {
  const rows = eventRows(match);
  if (!rows.length) return "";
  return `<section class="post-match-section" aria-labelledby="report-events">
        <div class="section-head"><div class="section-title"><span class="section-kicker">Report</span><h2 id="report-events">Goals and key events</h2><p>Minute, player and event type as reported by the data provider.</p></div></div>
        <div class="post-match-events">${rows.map((row) => `<article class="post-match-event${row.isGoal ? " is-goal" : ""}">
          <time>${escapeHtml(row.minute || "–")}</time>
          <div><span>${escapeHtml(row.label)}${row.team ? ` · ${escapeHtml(row.team)}` : ""}</span><p>${escapeHtml(row.text)}</p></div>
        </article>`).join("")}</div>
      </section>`;
}

function lineupsSectionHtml(match) {
  const lineups = (match.lineups || []).filter((row) => row && Array.isArray(row.players) && row.players.length);
  if (!lineups.length) return "";
  const cards = lineups.map((lineup) => {
    const formation = lineup.formation && /^[\d-]+$/.test(String(lineup.formation)) ? String(lineup.formation) : "";
    const starters = lineup.players.map((name) => {
      const href = playerHref(name, lineup.team);
      return href ? `<li><a href="${escapeHtml(href)}">${escapeHtml(name)}</a></li>` : `<li>${escapeHtml(name)}</li>`;
    }).join("");
    return `<article class="post-match-lineup-card">
    <header><h3>${escapeHtml(lineup.team)}</h3>${formation ? `<span>${escapeHtml(formation)}</span>` : ""}</header>
    <ol>${starters}</ol>
  </article>`;
  }).join("");
  return `<section class="post-match-section">
        <div class="section-head"><div class="section-title"><span class="section-kicker">Line-ups</span><h2>Starting elevens and formations</h2><p>The starting line-ups as reported by the data provider.</p></div></div>
        <div class="post-match-lineups">${cards}</div>
      </section>`;
}

function statValue(value, turkishType) {
  const number = Number(value);
  const decimals = Number.isInteger(number) ? 0 : 2;
  return `${number.toFixed(decimals)}${PERCENT_STATS.has(turkishType) ? "%" : ""}`;
}

function statsSectionHtml(match) {
  const stats = (match.statistics || []).filter((item) =>
    item && STAT_TYPES[item.type] &&
    Number.isFinite(Number(item.home)) && Number.isFinite(Number(item.away)) &&
    item.home !== null && item.away !== null && item.home !== "" && item.away !== "");
  if (!stats.length) return "";
  const categories = [...new Set(stats.map((item) => item.category || "Genel"))];
  const groups = categories.map((category) => {
    const rows = stats.filter((item) => (item.category || "Genel") === category);
    if (!rows.length) return "";
    const heading = STAT_CATEGORIES[category] || "General";
    const id = `stats-${heading.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    return `<section class="post-match-stat-group" aria-labelledby="${id}">
      <h3 id="${id}">${escapeHtml(heading)}</h3>
      <div class="post-match-stat-list">${rows.map((metric) => {
        const home = Number(metric.home) || 0;
        const away = Number(metric.away) || 0;
        const total = home + away;
        const homeWidth = total > 0 ? Math.round((home / total) * 100) : 50;
        const awayWidth = total > 0 ? 100 - homeWidth : 50;
        return `<article class="post-match-stat-row">
          <b>${escapeHtml(statValue(metric.home, metric.type))}</b>
          <div><span>${escapeHtml(STAT_TYPES[metric.type])}</span><i aria-hidden="true"><em style="--value:${homeWidth}%"></em><em style="--value:${awayWidth}%"></em></i></div>
          <b>${escapeHtml(statValue(metric.away, metric.type))}</b>
        </article>`;
      }).join("")}</div>
    </section>`;
  }).join("");
  return `<section class="post-match-section" aria-labelledby="report-stats">
        <div class="section-head"><div class="section-title"><span class="section-kicker">Report</span><h2 id="report-stats">Team statistics</h2><p>${escapeHtml(match.homeTeam)} and ${escapeHtml(match.awayTeam)} side by side; only metrics measured for both teams are shown.</p></div></div>
        <div class="post-match-team-labels"><strong>${escapeHtml(match.homeTeam)}</strong><span>Comparison</span><strong>${escapeHtml(match.awayTeam)}</strong></div>
        <div class="post-match-stats-grid">${groups}</div>
      </section>`;
}

// ── Sayfa ───────────────────────────────────────────────────────────────────
function pageHtml(file, match, stored) {
  const trPath = `mac-raporu/${file}`;
  const enPath = `en/match-report/${file}`;
  const selfUrl = `${DOMAIN}/${enPath}`;
  const score = match.score || {};
  const scored = hasScore(score);
  const dateText = formatDate(match.kickoff, LOCALE);
  const timeText = match.kickoff ? formatTime(match.kickoff, LOCALE) : "";
  const league = leagueLabel(match.league || match.competition);
  const leagueText = league && isClean(league) ? league : "";
  const venue = match.venue && match.venue !== "Açıklanmadı" && match.venue !== "Bilinmiyor" && isClean(match.venue)
    ? venueLabel(match.venue, LOCALE)
    : "";

  const events = eventsSectionHtml(match);
  const lineups = lineupsSectionHtml(match);
  const stats = statsSectionHtml(match);

  // Kalıcı maç sayfası varsa rapor onun kopyasıdır: canonical oraya döner.
  const permanent = enPathForMatch(match, seoRegistryPages);
  const permanentExists = permanent && pageExists(`${permanent}.html`);
  const canonical = permanentExists ? `${DOMAIN}/${permanent}` : selfUrl;
  const coverage = stored && Number.isFinite(stored.coveragePercent) ? stored.coveragePercent : 0;
  const thin = coverage <= THIN_COVERAGE_THRESHOLD && !(events || lineups || stats);
  const indexable = permanentExists || !thin;

  const headline = scored
    ? `${match.homeTeam} ${score.home}-${score.away} ${match.awayTeam}`
    : `${match.homeTeam} v ${match.awayTeam}`;
  const title = `${headline} – Match Report${dateText ? `, ${dateText}` : ""} | FutbolRadar`;
  const lead = resultSentence(match, dateText);
  const description = [lead, leagueText ? `Competition: ${leagueText}.` : "", sectionList({ events, lineups, stats }) || "Final score and match details on FutbolRadar."]
    .filter(Boolean).join(" ");

  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      // Kalıcı maç sayfasına devredilmiş raporda SportsEvent yazılmaz: olayın
      // kimliği kanonik adreste yaşıyor.
      ...(!permanentExists && match.kickoff ? [{
        "@type": "SportsEvent",
        name: `${match.homeTeam} v ${match.awayTeam}`,
        url: selfUrl,
        startDate: match.kickoff,
        eventStatus: "https://schema.org/EventScheduled",
        sport: "Football",
        ...(venue ? { location: { "@type": "StadiumOrArena", name: venue } } : {}),
        homeTeam: { "@type": "SportsTeam", name: match.homeTeam },
        awayTeam: { "@type": "SportsTeam", name: match.awayTeam },
        description: lead
      }] : []),
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${DOMAIN}/en/` },
          { "@type": "ListItem", position: 2, name: "Results", item: `${DOMAIN}/en/results.html` },
          { "@type": "ListItem", position: 3, name: `${match.homeTeam} v ${match.awayTeam}`, item: canonical }
        ]
      }
    ]
  };

  const homeHref = teamHref(match.homeTeam);
  const awayHref = teamHref(match.awayTeam);
  const teamCard = (name, href) => href
    ? `<a href="${escapeHtml(href)}"><span>Team page</span><strong>${escapeHtml(name)}</strong><p>Fixtures, results, table position and squad.</p></a>`
    : "";
  const meta = [
    dateText ? `<span>${escapeHtml(dateText)}${timeText ? `, ${escapeHtml(timeText)} (Türkiye time)` : ""}</span>` : "",
    venue ? `<span>${escapeHtml(venue)}</span>` : "",
    match.referee && isClean(match.referee) ? `<span>Referee: ${escapeHtml(match.referee)}</span>` : ""
  ].join("");
  const kind = finishKind(match);
  const scoreNote = kind === "extra-time" ? "After extra time"
    : kind === "penalties" ? "Decided on penalties"
    : kind === "awarded" ? "Awarded result"
    : "Full time";

  const html = `<!doctype html>
<html lang="${htmlLang(LOCALE)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <meta name="robots" content="${indexable ? ROBOTS_INDEX : ROBOTS_NOINDEX_FOLLOW}" />
    <meta property="og:type" content="article" />
    <meta property="og:locale" content="${ogLocale(LOCALE)}" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${DOMAIN}/assets/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${DOMAIN}/assets/og-image.png" />
    <script type="application/ld+json">${JSON.stringify(schema)}</script>
    <link rel="icon" href="${BASE}favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="${BASE}site.webmanifest" />
    <link rel="stylesheet" href="${BASE}page.css" />
  </head>
  <body class="subpage post-match-page">
    ${siteHeader({ base: BASE, locale: LOCALE, altHref: trPath })}
    <main class="container">
      <nav class="breadcrumb" aria-label="Breadcrumb"><a href="${BASE}en/index.html">Home</a><span>/</span><a href="${BASE}en/results.html">Results</a><span>/</span><span>${escapeHtml(match.homeTeam)} v ${escapeHtml(match.awayTeam)}</span></nav>
      <section class="post-match-hero">
        <div class="post-match-heading">${leagueText ? `<span class="eyebrow">${escapeHtml(leagueText)}</span>` : ""}<h1>${escapeHtml(headline)} – Match Report</h1><p>${escapeHtml(lead)}</p><div class="post-match-meta">${meta}</div></div>
        <div class="post-match-scoreboard" aria-label="Final score">
          <div><span class="team-monogram">${escapeHtml(monogram(match.homeTeam))}</span><strong>${escapeHtml(match.homeTeam)}</strong></div>
          ${scored ? `<div class="post-match-score"><span>${escapeHtml(scoreNote)}</span><b>${escapeHtml(score.home)}<i>-</i>${escapeHtml(score.away)}</b>${hasHalftime(score) ? `<small>Half-time ${escapeHtml(score.halftimeHome)}-${escapeHtml(score.halftimeAway)}</small>` : ""}</div>` : '<div class="post-match-score is-empty" aria-label="Score not published"><span>Score</span><b>–</b></div>'}
          <div><span class="team-monogram away">${escapeHtml(monogram(match.awayTeam))}</span><strong>${escapeHtml(match.awayTeam)}</strong></div>
        </div>
      </section>

      ${pageShareHtml({ url: canonical, title: `${headline} – Match Report`, locale: "en" })}

      ${events}

      ${lineups}

      ${stats}

      <section class="post-match-next-grid">
        ${teamCard(match.homeTeam, homeHref)}
        ${teamCard(match.awayTeam, awayHref)}
        <a href="${BASE}en/results.html"><span>Results</span><strong>All results</strong><p>Final scores from completed matches.</p></a>
        <a href="${BASE}en/match-centre.html"><span>Match centre</span><strong>Live and upcoming matches</strong><p>Scores, kick-off times and match details.</p></a>
        <a href="${BASE}en/todays-matches.html"><span>Schedule</span><strong>Today's matches</strong><p>The day's confirmed fixtures.</p></a>
      </section>
    </main>
    ${siteFooter({ base: BASE, locale: LOCALE })}
    <script src="${BASE}site.js" defer></script>
  </body>
</html>
`;
  return { html, trPath, enPath, selfUrl, indexable, alias: Boolean(permanentExists), title };
}

// ── Üretim ──────────────────────────────────────────────────────────────────
const trFiles = fs.existsSync(TR_DIR) ? fs.readdirSync(TR_DIR).filter((file) => file.endsWith(".html")).sort() : [];
fs.mkdirSync(OUT_DIR, { recursive: true });

let written = 0;
let unchanged = 0;
let skipped = 0;
let noindex = 0;
let aliases = 0;
const pairs = [];
const sitemapEntries = [];
const expected = new Set();
const seenTitles = new Map();

for (const file of trFiles) {
  const stored = storeByFile.get(file) || null;
  const match = matchByFile.get(file) || (stored ? matchFromStore(stored) : null) || matchFromTurkishPage(file);
  // Künyesi kurulamayan rapor İngilizce sayfa almaz: uydurulacak bir şey yok.
  if (!match || !match.homeTeam || !match.awayTeam) {
    skipped += 1;
    continue;
  }
  const result = pageHtml(file, match, stored);
  if (seenTitles.has(result.title)) {
    throw new Error(`[en-match-report] yinelenen başlık: "${result.title}" (${seenTitles.get(result.title)} ve ${file})`);
  }
  seenTitles.set(result.title, file);
  expected.add(file);

  const target = path.join(OUT_DIR, file);
  const previous = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
  if (previous === null || !sameIgnoringInjected(previous, result.html)) {
    fs.writeFileSync(target, result.html, "utf8");
    written += 1;
  } else {
    unchanged += 1;
  }
  pairs.push({ tr: result.trPath, en: result.enPath });
  if (result.alias) aliases += 1;
  if (!result.indexable) noindex += 1;
  if (result.indexable && !result.alias) {
    const lastmod = String(match.lastVerifiedAt || match.kickoff || "").slice(0, 10);
    sitemapEntries.push(`  <url>\n    <loc>${result.selfUrl}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ""}\n    <changefreq>monthly</changefreq>\n    <priority>0.5</priority>\n  </url>`);
  }
}

/**
 * Sonraki derleme adımları (ortak düzen, hreflang, analitik…) sayfaya blok
 * enjekte eder; ham üretici çıktısı diskteki dosyayla bu yüzden bayt bayt
 * eşleşmez. Yeniden yazıp yazmamaya `<main>` gövdesi ve başlık üzerinden
 * karar verilir: içerik aynıysa enjekte edilmiş sayfa olduğu gibi kalır.
 */
function sameIgnoringInjected(previous, next) {
  const core = (html) => {
    const main = html.match(/<main[\s\S]*<\/main>/);
    const title = html.match(/<title>[\s\S]*?<\/title>/);
    const robots = html.match(/<meta name="robots"[^>]*>/);
    const canonical = html.match(/<link rel="canonical"[^>]*>/);
    return [main && main[0], title && title[0], robots && robots[0], canonical && canonical[0]].join("\n");
  };
  return core(previous) === core(next);
}

// Türkçe eşi kalkmış İngilizce rapor da kalkar.
let removed = 0;
for (const file of fs.readdirSync(OUT_DIR)) {
  if (!file.endsWith(".html") || expected.has(file)) continue;
  fs.unlinkSync(path.join(OUT_DIR, file));
  removed += 1;
}

const registered = writeDynamicRoutePairs("match-report", pairs);

for (const sitemapPath of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) {
  if (!fs.existsSync(sitemapPath)) continue;
  const current = fs.readFileSync(sitemapPath, "utf8");
  const retained = (current.match(URL_ENTRY_RE) || []).filter((entry) => !/<loc>[^<]*\/en\/match-report\/[^<]*<\/loc>/.test(entry));
  fs.writeFileSync(sitemapPath, wrapUrlset(retained.concat(sitemapEntries)), "utf8");
}

console.log(`English match reports: ${written} written, ${unchanged} unchanged, ${removed} removed (${trFiles.length} Turkish reports, ${skipped} skipped).`);
console.log(`English match reports: ${sitemapEntries.length} indexable, ${aliases} canonical to the match page, ${noindex} thin (noindex,follow).`);
console.log(`English match reports: ${registered} TR↔EN pairs registered (dynamic route map).`);
