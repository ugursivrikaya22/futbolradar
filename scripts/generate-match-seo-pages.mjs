#!/usr/bin/env node
/**
 * MAÇ SEO MOTORU.
 *
 * Her "önemli" maç (bkz. services/matchSeoPriority.js) için maçtan 72 saat
 * önce kalıcı, sade bir URL'de ("/galatasaray-fenerbahce-maci") bir sayfa
 * otomatik açılır. Slug bir kez atandığında `data/match-seo-pages.json`
 * kayıt defterine yazılır ve BİR DAHA DEĞİŞMEZ — bu betik maç boyunca ve
 * maç bittikten sonra aynı dosyayı güncelleyerek yeniden yazar, silmez.
 *
 * Bu betik YENİ bir canlı skor sistemi KURMAZ. Maç künyesi bloğu
 * (`data-match-special-board data-match-id="…"`) scripts/generate-match-special.mjs
 * ile birebir aynı işaretlemeyi kullanır; sayfa açıldığında public/site.js
 * içindeki mevcut `startMatchPoller`/`setupMatchSpecial` mekanizması bu
 * bloğu otomatik bulup canlı skor, dakika ve durumu dolduruyor. Statik
 * içerik (bu betiğin ürettiği HTML) yalnızca ilk boyama ve arama motoru
 * görünürlüğü için bir anlık görüntüdür; saatlik zamanlanmış güncelleme
 * (scripts/run-scheduled-update.mjs → hourlyBuildSteps) her koşuda
 * data/fixture-calendar.json'daki en güncel durumla yeniden üretir.
 *
 * Veri kaynakları — hepsi mevcut, hiçbiri bu betik için yeni değil:
 *   - data/fixture-calendar.json → tüm turnuvalarda kickoff/skor/dakika/olay
 *   - data/match-analyses.json   → kadrolar, olasılık, form (varsa)
 *   - data/squad-statuses.json   → eksik/cezalı
 *   - data/league-standings.json → puan durumu
 *   - data/matches.json          → yayıncı kanal (services/broadcastSchedule.js)
 *   - data/historical-match-archive.json → ikili rekabet geçmişi
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { siteHeader, siteFooter } from "./lib/layout.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";
import {
  escapeHtml,
  lineupsSection,
  playerCardsSection,
  aiAnalysisSection,
  probabilitySection,
  absencesSection,
  formSection,
  h2hStandingsSection,
  matchInfoSection,
  liveStatsSection,
  analysisPendingNote,
  buildH2hEntries
} from "./lib/matchAnalysisSections.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);
const domain = "https://www.futbolradar.com";

const { getPlayers } = require("../services/playerService.js");
const { sameClub, slug: teamSlug } = require("../services/superLigTeams.js");
const { calculateMatchRadar, normalizeText } = require("../services/matchRadarService.js");
const { isSameFixture, normalizeFixtureCalendar } = require("../services/fixtureCalendar.js");
const { resolveCompetitionId, findCompetition } = require("../services/competitionCatalog.js");
const { broadcastChannel } = require("../services/broadcastSchedule.js");
const { curatedMatches } = require("../services/providers/mockProvider.js");
const { isImportantMatch, compareByImportance } = require("../services/matchSeoPriority.js");
const {
  kickoffMs,
  matchDay,
  hasReadableScore,
  isFinishedStatus,
  liveVerdict,
  finishLabel
} = require("../services/matchStatus.js");

function readJson(relativePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
  } catch {
    return fallback;
  }
}

const fixtureCalendarRaw = readJson("data/fixture-calendar.json", { matches: [] });
const fixtureCalendar = normalizeFixtureCalendar(fixtureCalendarRaw);
const calendarMatches = Array.isArray(fixtureCalendar.matches) ? fixtureCalendar.matches : [];
const teams = readJson("data/teams.json", []);
const rawPlayers = readJson("data/players.json", []);
const squadStatus = readJson("data/squad-statuses.json", { teams: [] });
const matchAnalyses = readJson("data/match-analyses.json", []);
const leagueStandings = readJson("data/league-standings.json", {});
const matchArchive = readJson("data/historical-match-archive.json", { records: [] });
const players = getPlayers(rawPlayers);
const archiveRecords = Array.isArray(matchArchive.records) ? matchArchive.records : [];
const broadcastCandidates = curatedMatches();

const REGISTRY_PATH = path.join(root, "data", "match-seo-pages.json");
const OUT_DIR = path.join(root, "mac-seo");
const PUBLIC_OUT_DIR = path.join(root, "public", "mac-seo");
const REGISTRATION_WINDOW_MS = 72 * 60 * 60 * 1000;
// Kayıt defteri, fikstür takviminin döndürebileceği geçmiş kayıtları
// (sağlayıcı geriye dönük veri gönderirse) sınırsız biriktirmesin diye bir
// güvenlik sınırı: 90 günden eski bir kickoff için YENİ kayıt açılmaz. Var
// olan kayıtlar bundan etkilenmez, sonsuza dek korunur.
const MAX_BACKFILL_MS = 90 * 24 * 60 * 60 * 1000;

function loadRegistry() {
  try {
    const parsed = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
    if (parsed && typeof parsed === "object" && parsed.entries && typeof parsed.entries === "object") {
      return parsed;
    }
  } catch {
    // dosya yok ya da bozuk — sıfırdan başla, mevcut sayfa dosyalarına dokunulmaz.
  }
  return { version: 1, entries: {} };
}

function saveRegistry(registry) {
  fs.writeFileSync(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

function slugBase(match) {
  return `${teamSlug(match.homeTeam)}-${teamSlug(match.awayTeam)}-maci`;
}

/**
 * Aynı karşılaşma, iki sağlayıcıda farklı yazılmış kulüp adıyla (ör. "Amed"
 * / "Amed Sportif Faaliyetler") fikstür takviminde İKİ AYRI KAYIT olarak
 * durabiliyor (bkz. services/fixtureCalendar.js'in dosya başı yorumu). Yeni
 * bir slug atamadan önce kayıt defterinde AYNI GÜN + AYNI KULÜP ÇİFTİ zaten
 * varsa ikinci kayıt atlanır — aksi hâlde tek maç için iki kalıcı URL
 * açılır ve arama motoruna kopya içerik sunulmuş olur.
 */
function findExistingFixtureEntry(registry, match) {
  for (const entry of Object.values(registry.entries)) {
    if (isSameFixture(match, entry)) return entry;
  }
  return null;
}

/**
 * Kayıt defterine yeni maçları ekler. Slug bir kez atandıktan sonra
 * DEĞİŞTİRİLMEZ — aynı iki takım sezon içinde tekrar karşılaşırsa (rövanş)
 * sade slug zaten dolu olduğundan tarih eklenmiş bir slug'a düşer.
 */
function registerImportantMatches(registry, nowMs) {
  const usedSlugs = new Map();
  for (const [id, entry] of Object.entries(registry.entries)) {
    usedSlugs.set(entry.slug, id);
  }

  let changed = false;
  for (const match of calendarMatches) {
    if (!match || !match.id || !match.homeTeam || !match.awayTeam || !match.kickoff) continue;
    if (registry.entries[match.id]) continue;
    if (!isImportantMatch(match)) continue;
    if (findExistingFixtureEntry(registry, match)) continue;

    const kickoff = kickoffMs(match);
    if (kickoff === null) continue;
    if (kickoff - nowMs > REGISTRATION_WINDOW_MS) continue; // henüz 72 saatlik pencereye girmedi
    if (nowMs - kickoff > MAX_BACKFILL_MS) continue; // çok eski, geriye dönük kayıt açılmaz

    const base = slugBase(match);
    const slugValue = usedSlugs.has(base)
      ? `${base}-${matchDay(match) || String(match.kickoff).slice(0, 10)}`
      : base;

    registry.entries[match.id] = {
      slug: slugValue,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      competitionId: resolveCompetitionId(match) || null,
      kickoff: match.kickoff,
      firstSeenAt: new Date(nowMs).toISOString()
    };
    usedSlugs.set(slugValue, match.id);
    changed = true;
  }
  return changed;
}

function findAnalysisRecord(match) {
  if (!match.kickoff) return null;
  return matchAnalyses.find((record) => record && record.homeContext && isSameFixture(
    { homeTeam: match.homeTeam, awayTeam: match.awayTeam, kickoff: match.kickoff },
    { homeTeam: record.homeContext.teamName, awayTeam: record.awayContext && record.awayContext.teamName, kickoff: record.kickoff }
  )) || null;
}

function getTeam(name) {
  return teams.find((team) => normalizeText(team.name || team.team) === normalizeText(name)) ||
    teams.find((team) => sameClub(team.name || team.team, name)) ||
    null;
}

function findBroadcastSource(match) {
  return broadcastCandidates.find((candidate) => isSameFixture(
    { homeTeam: match.homeTeam, awayTeam: match.awayTeam, kickoff: match.kickoff },
    candidate
  )) || null;
}

function formHtml(team) {
  const form = Array.isArray(team && team.form) ? team.form : [];
  if (!form.length) {
    return '<span class="muted-copy">Son 5 maç formu için doğrulanmış kayıt bekleniyor.</span>';
  }
  return `<div class="match-form-row">${form.map((item) => {
    const label = item.label || item.result || "-";
    const kind = normalizeText(item.result || label);
    const state = kind === "win" || kind === "g" ? "win" : kind === "loss" || kind === "m" ? "loss" : "draw";
    return `<span class="form-dot ${state}">${escapeHtml(label)}</span>`;
  }).join("")}</div>`;
}

function squadHtml(name) {
  const rows = Array.isArray(squadStatus.teams) ? squadStatus.teams : [];
  const row = rows.find((item) => normalizeText(item.team || item.name) === normalizeText(name));
  if (!row) {
    return '<p class="muted-copy">Eksik oyuncu bilgisi için doğrulanmış kayıt bekleniyor.</p>';
  }
  const absenceCount = Number(row.absenceCount || 0);
  const impact = row.totalAbsenceImpact ?? row.absenceImpact;
  return `<dl class="match-squad-metrics"><div><dt>Eksik oyuncu</dt><dd>${escapeHtml(absenceCount)}</dd></div>${impact == null ? "" : `<div><dt>Kadro kaybı</dt><dd>${escapeHtml(`${impact}/100`)}</dd></div>`}<div><dt>Önemli eksik</dt><dd>${escapeHtml(row.keyAbsence || "Yok")}</dd></div></dl>`;
}

/** "14 Ağustos 2026 Cuma" — TSİ. */
function shortDateLabel(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("tr-TR", {
    day: "numeric", month: "long", year: "numeric", weekday: "long", timeZone: "Europe/Istanbul"
  }).format(parsed);
}

/** "21:30" — TSİ. */
function clockLabel(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" }).format(parsed);
}

const EVENT_ICONS = {
  goal: "⚽",
  "own goal": "⚽",
  "missed penalty": "❌",
  card: "🟨",
  subst: "🔁",
  var: "📺"
};

function eventIcon(type) {
  const key = normalizeText(type);
  if (key.includes("kirmizi") || key.includes("red")) return "🟥";
  if (key.includes("sari") || key.includes("yellow") || key === "card") return "🟨";
  if (key.includes("gol") || key.includes("goal")) return "⚽";
  if (key.includes("degisiklik") || key.includes("subst")) return "🔁";
  return EVENT_ICONS[key] || "•";
}

/**
 * MAÇ ÖNCESİ/CANLI/SONRASI KÜNYE BLOĞU.
 *
 * İşaretleme, generate-match-special.mjs'teki `data-match-special-board`
 * ile BİREBİR aynı: public/site.js bu veri özniteliklerini otomatik
 * yakalayıp canlı skor/dakika/durumu istemci tarafında dolduruyor. Burada
 * yalnızca derleme anındaki en son bilinen durum (statik ilk boyama) basılır.
 */
function liveBoardHtml(match, state) {
  const verdict = liveVerdict(match);
  const scoreLine = hasReadableScore(match)
    ? `<p class="match-special__score" data-match-special-score>${escapeHtml(match.score.home)} - ${escapeHtml(match.score.away)}</p>`
    : `<p class="match-special__score" data-match-special-score hidden></p>`;
  const statusText = state === "live"
    ? `Canlı${Number.isFinite(match.minute) ? ` · ${match.minute}'` : ""}`
    : state === "finished"
      ? `Maç sonucu${finishLabel(match) ? ` · ${finishLabel(match)}` : ""}`
      : "Henüz başlamadı";

  return `<section class="match-special__board" data-match-special-board data-match-id="${escapeHtml(match.id)}" data-kickoff="${escapeHtml(match.kickoff)}">
        <div class="match-special__teams">
          <div class="match-special__team"><strong>${escapeHtml(match.homeTeam)}</strong></div>
          <div class="match-special__vs" aria-hidden="true">–</div>
          <div class="match-special__team"><strong>${escapeHtml(match.awayTeam)}</strong></div>
        </div>
        ${scoreLine}
        <p class="match-special__flag" data-match-special-status>${escapeHtml(statusText)}</p>
        ${verdict.verdict === "unverified" ? '<p class="muted-copy">Canlı veri şu an doğrulanamadı; sayfa otomatik olarak yenilendiğinde güncellenecek.</p>' : ""}
      </section>`;
}

function eventsTimelineHtml(match) {
  const events = Array.isArray(match.events) ? match.events : [];
  if (!events.length) return "";
  const rows = events.map((event) => {
    const team = (event.team && event.team.name) || "";
    const detail = event.detail || event.value || "";
    return `<li><span class="match-event-time">${escapeHtml(event.time || "")}</span><span class="match-event-icon" aria-hidden="true">${eventIcon(event.type)}</span><span class="match-event-body"><b>${escapeHtml(team)}</b>${detail ? ` — ${escapeHtml(detail)}` : ""}</span></li>`;
  }).join("");
  return `<section class="match-events-timeline" aria-label="Maç olayları"><h2 class="match-section-title">Gol, Sarı Kart ve Kırmızı Kart Olayları</h2>
      <ul class="match-events-list">${rows}</ul>
    </section>`;
}

function broadcastRowHtml(channel) {
  return channel
    ? `<div class="fixture-card-broadcast"><span class="fixture-card-broadcast-icon" aria-hidden="true">📺</span><span>Yayıncı kanal: <b>${escapeHtml(channel)}</b></span></div>`
    : `<div class="fixture-card-broadcast is-unknown"><span class="fixture-card-broadcast-icon" aria-hidden="true">📺</span><span>Yayıncı kanal henüz açıklanmadı</span></div>`;
}

/** Maç durumuna göre başlık/açıklama — sabit üç kalıp, kullanıcı isteği. */
function titleAndDescription(match, state, competitionName) {
  const homeTeam = match.homeTeam;
  const awayTeam = match.awayTeam;
  const kickoffDay = match.kickoff ? shortDateLabel(match.kickoff) : "";
  const kickoffClock = match.kickoff ? clockLabel(match.kickoff) : "";
  const channel = (findBroadcastSource(match) && broadcastChannel(findBroadcastSource(match))) || "";

  if (state === "finished") {
    const scoreText = hasReadableScore(match) ? `${match.score.home}-${match.score.away}` : "";
    return {
      title: `${homeTeam} ${awayTeam} Maç Sonucu ve Skor | FutbolRadar`,
      description: `${homeTeam} - ${awayTeam} maçı sona erdi.${scoreText ? ` Maç sonucu: ${scoreText}.` : ""} Gol, kart olayları ve maç sonrası özet FutbolRadar'da.`
    };
  }

  if (state === "live") {
    return {
      title: `${homeTeam} ${awayTeam} Canlı Skor | Maç Sonucu | FutbolRadar`,
      description: `${homeTeam} - ${awayTeam} maçı canlı devam ediyor. Anlık skor, dakika, gol ve kart olayları FutbolRadar'da.`
    };
  }

  return {
    title: `${homeTeam} ${awayTeam} Maçı Ne Zaman, Saat Kaçta, Hangi Kanalda? | FutbolRadar`,
    description: `${homeTeam} - ${awayTeam} maçı${kickoffDay ? ` ${kickoffDay}` : ""}${kickoffClock ? ` saat ${kickoffClock} TSİ'de` : ""} oynanacak.${channel ? ` Yayıncı kanal: ${channel}.` : ""}${competitionName ? ` ${competitionName} karşılaşması.` : ""} Muhtemel 11'ler, eksikler, form ve puan durumu FutbolRadar'da.`
  };
}

function pageState(match) {
  if (isFinishedStatus(match)) return "finished";
  const verdict = liveVerdict(match);
  if (verdict.live) return "live";
  return "prematch";
}

function pageHtml(match, slugValue) {
  const canonical = `${domain}/${slugValue}`;
  const state = pageState(match);
  const competitionId = resolveCompetitionId(match);
  const competition = competitionId ? findCompetition(competitionId) : null;
  const competitionName = (competition && competition.name) || match.league || "";
  const radar = calculateMatchRadar(match, { teams, players, squadStatus });
  const homeTeamRow = getTeam(match.homeTeam);
  const awayTeamRow = getTeam(match.awayTeam);
  const dateLabel = match.kickoff ? shortDateLabel(match.kickoff) : "Tarih ve saat bekleniyor";
  const channel = (findBroadcastSource(match) && broadcastChannel(findBroadcastSource(match))) || "";

  const analysis = findAnalysisRecord(match);
  const standingsEntry = competitionId && leagueStandings[competitionId] ? leagueStandings[competitionId] : { table: [], updatedAt: null };
  const h2hEntries = buildH2hEntries({
    archiveRecords,
    calendarRec: match,
    homeName: match.homeTeam,
    awayName: match.awayTeam,
    sameClub
  });
  const providerFixtureId = (match.providerIds && (match.providerIds.apiFootball || match.providerIds.thesportsdb)) || match.providerId || null;

  const preMatchSections = state === "finished" ? "" : [
    analysis ? lineupsSection(analysis, players, "") : "",
    analysis ? playerCardsSection(analysis, players, "") : "",
    analysis ? aiAnalysisSection(analysis, radar, match.homeTeam, match.awayTeam, "") : "",
    analysis ? probabilitySection(analysis, match, match.homeTeam, match.awayTeam) : "",
    !analysis ? analysisPendingNote() : ""
  ].filter(Boolean).join("\n      ");

  const { title, description } = titleAndDescription(match, state, competitionName);

  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SportsEvent",
        name: `${match.homeTeam} - ${match.awayTeam}`,
        url: canonical,
        description,
        startDate: match.kickoff,
        // schema.org'da "canlı/devam ediyor" için ayrı bir EventStatusType
        // değeri yok; bittiğinde de bir "tamamlandı" değeri yok — bu yüzden
        // yalnızca maç öncesinde EventScheduled yazılır, aksi hâlde alan
        // hiç basılmaz (bkz. scripts/generate-en-match-pages.mjs).
        ...(state === "prematch" ? { eventStatus: "https://schema.org/EventScheduled" } : {}),
        eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
        homeTeam: { "@type": "SportsTeam", name: match.homeTeam },
        awayTeam: { "@type": "SportsTeam", name: match.awayTeam },
        competitor: [
          { "@type": "SportsTeam", name: match.homeTeam },
          { "@type": "SportsTeam", name: match.awayTeam }
        ],
        ...(match.venue ? { location: { "@type": "Place", name: match.venue } } : {}),
        superEvent: { "@type": "SportsOrganization", name: competitionName || "Futbol" },
        sport: "Football"
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Ana Sayfa", item: `${domain}/` },
          { "@type": "ListItem", position: 2, name: `${match.homeTeam} - ${match.awayTeam}`, item: canonical }
        ]
      }
    ]
  };

  const absencesHtml = state === "finished" || !analysis ? "" : absencesSection(analysis, squadStatus, match.homeTeam, match.awayTeam);
  const formSectionHtml = analysis ? formSection(analysis, match.homeTeam, match.awayTeam) : "";

  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${canonical}" />
    <meta name="robots" content="index,follow" />
    <meta property="og:type" content="article" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${domain}/assets/og-image.svg" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${domain}/assets/og-image.svg" />
    <script type="application/ld+json">${JSON.stringify(schema).replace(/</g, "\\u003c")}</script>
    <link rel="icon" href="../favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="../site.webmanifest" />
    <link rel="stylesheet" href="../page.css" />
  </head>
  <body class="subpage match-analysis-page">
    ${siteHeader({ base: "../" })}
    <main class="container">
      <nav class="breadcrumb" aria-label="Sayfa yolu"><a href="../index.html">Ana Sayfa</a><span>/</span><span>${escapeHtml(match.homeTeam)} - ${escapeHtml(match.awayTeam)}</span></nav>
      <section class="hero match-analysis-hero"><div class="hero-row"><div><span class="eyebrow">${escapeHtml(competitionName)}</span><h1>${escapeHtml(match.homeTeam)} - ${escapeHtml(match.awayTeam)}</h1><p class="lead">${escapeHtml(dateLabel)}${match.venue ? ` · ${escapeHtml(match.venue)}` : ""}</p></div><span class="hero-meta">${escapeHtml(dateLabel)}</span></div></section>
      ${liveBoardHtml(match, state)}
      ${broadcastRowHtml(channel)}
      ${eventsTimelineHtml(match)}
      ${matchInfoSection(match, match, match.venue, null)}
      ${preMatchSections}
      ${absencesHtml}
      ${formSectionHtml}
      ${h2hStandingsSection(h2hEntries, standingsEntry.table, match.homeTeam, match.awayTeam, standingsEntry.updatedAt)}
      ${liveStatsSection(match, providerFixtureId)}
      <section class="match-context-grid" aria-label="Maç bağlamı"><article class="card"><span class="card-kicker">${escapeHtml(match.homeTeam)}</span><h2>Form ve kadro</h2>${formHtml(homeTeamRow)}${squadHtml(match.homeTeam)}</article><article class="card"><span class="card-kicker">${escapeHtml(match.awayTeam)}</span><h2>Form ve kadro</h2>${formHtml(awayTeamRow)}${squadHtml(match.awayTeam)}</article></section>
    </main>
    ${siteFooter({ base: "../" })}
    <script src="../site.js" defer></script>
    <script src="../app.js" defer></script>
  </body>
</html>`;
}

function sitemapEntry(match, slugValue) {
  const lastmod = String(match.fetchedAt || match.kickoff || new Date().toISOString()).slice(0, 10);
  const priority = pageState(match) === "live" ? "0.95" : "0.85";
  return `  <url>\n    <loc>${domain}/${slugValue}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>hourly</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
}

function updateSitemap(entries) {
  const sitemapPath = path.join(root, "sitemap.xml");
  if (!fs.existsSync(sitemapPath)) return;
  const current = fs.readFileSync(sitemapPath, "utf8");
  const retained = (current.match(URL_ENTRY_RE) || [])
    .filter((entry) => !/-maci<\/loc>/.test(entry));
  const content = wrapUrlset(retained.concat(entries));
  fs.writeFileSync(sitemapPath, content, "utf8");
  fs.writeFileSync(path.join(root, "public", "sitemap.xml"), content, "utf8");
}

function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(PUBLIC_OUT_DIR, { recursive: true });

  const registry = loadRegistry();
  const nowMs = Date.now();
  const changed = registerImportantMatches(registry, nowMs);
  if (changed) saveRegistry(registry);

  const matchById = new Map(calendarMatches.filter((match) => match && match.id).map((match) => [match.id, match]));

  /**
   * `match.id` sağlayıcı yazımına bağlı ("Amed" / "Amed Sportif
   * Faaliyetler" gibi) — zamanla değişebilir. Kimlik artık eşleşmiyorsa
   * kayıt defterindeki günü/kulüp çiftini kullanarak takvimde aynı
   * karşılaşmayı ara; bulunamazsa sayfa bu koşuda güncellenmez (silinmez,
   * son bilinen hâliyle kalır) ama kalıcı olarak kaybolmaz.
   */
  function findMatchForEntry(id, entry) {
    return matchById.get(id) || calendarMatches.find((match) => match && match.kickoff && isSameFixture(entry, match)) || null;
  }

  const activeEntries = Object.entries(registry.entries)
    .map(([id, entry]) => ({ id, entry, match: findMatchForEntry(id, entry) }))
    .filter((row) => row.match)
    .sort((left, right) => compareByImportance(left.match, right.match));

  const sitemapEntries = [];
  let written = 0;
  for (const { match, entry } of activeEntries) {
    const html = pageHtml(match, entry.slug);
    const file = `${entry.slug}.html`;
    fs.writeFileSync(path.join(OUT_DIR, file), html, "utf8");
    fs.writeFileSync(path.join(PUBLIC_OUT_DIR, file), html, "utf8");
    sitemapEntries.push(sitemapEntry(match, entry.slug));
    written += 1;
  }

  updateSitemap(sitemapEntries);
  console.log(`Generated ${written} match SEO pages (${Object.keys(registry.entries).length} slugs registered total)`);
}

run();
