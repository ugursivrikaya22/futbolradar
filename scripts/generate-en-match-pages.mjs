#!/usr/bin/env node
/**
 * İNGİLİZCE MAÇ ÖNÜ SAYFALARI — /en/match/<slug>.html
 *
 * TR tarafındaki `/mac/<slug>.html` (scripts/generate-match-pages.mjs) ile
 * BİREBİR AYNI 306 onaylı Süper Lig eşleşmesinden üretilir — aynı slug,
 * aynı veri kaynağı (data/super-lig-fixtures.json), sağlayıcıya ikinci
 * istek yok. Kapsam TR ile eşit: yalnızca eşleşmesi VE onay durumu
 * doğrulanmış fikstürler; skor/olay/kadro dizilişi bu sayfalarda YOK,
 * çünkü TR /mac/ sayfaları da yalnızca maç ÖNÜ analizi — TR'nin kendisi
 * göstermediği veriyi EN sayfası da göstermez.
 *
 * Radar puanı services/matchRadarService.js'den geliyor ama bileşen
 * etiketleri (COMPONENT_LABELS) ve pozitif/negatif açıklama cümleleri
 * Türkçe sabit dizgeler — bunlar ÇEVRİLMİYOR. EN sayfası yalnızca
 * dilden bağımsız sayısal kısmı gösteriyor: puan, güven düzeyi, kapsam
 * yüzdesi. Bu, "Türkçe editoryal metni makine çevirisiyle çoğaltma"
 * kuralının radar açıklamasına uygulanmış hâli.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { siteHeader, siteFooter } from "./lib/layout.mjs";
import { sectionHead } from "./lib/matchCards.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";
import { findFinalResult, resultTitle, resultDescription } from "./lib/enMatchResult.mjs";

const require = createRequire(import.meta.url);
const {
  DOMAIN,
  absoluteUrl,
  competitionLabel,
  formatDate,
  formatTime,
  htmlLang,
  ogLocale,
  statusLabelFor,
  t,
  writeDynamicRoutePairs
} = require("../services/i18n.js");
const { CONFIRMED_FIXTURE_STATUSES } = require("../services/superLigFixtureService.js");
const { sameClub, slug: teamSlug } = require("../services/superLigTeams.js");
const { calculateMatchRadar, normalizeText } = require("../services/matchRadarService.js");
const { getPlayers, slug: playerSlug } = require("../services/playerService.js");
/**
 * Oyuncu adresleri tek çözücüden okunur. Kimlikten yol türetmek, oyuncu
 * tam isimli adrese taşındığı anda var olmayan bir dosyaya işaret ediyor.
 */
const playerUrls = require("../services/playerUrl.js").createPlayerUrlResolver((() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "player-url-slugs.json"), "utf8"));
  } catch {
    return { entries: [], aliases: [] };
  }
})());

const { publicPlayerView } = require("../services/cardCredibility.js");
const { enPathForMatch, loadRegistry } = require("../services/matchSeoPages.js");
const seoRegistryPages = loadRegistry().pages;

const root = process.cwd();
const LOCALE = "en";
const BASE = "../../";
const OUT_DIR = path.join(root, "en", "match");

const fixtures = JSON.parse(fs.readFileSync(path.join(root, "data", "super-lig-fixtures.json"), "utf8"));
const teams = JSON.parse(fs.readFileSync(path.join(root, "data", "teams.json"), "utf8"));
const rawPlayers = JSON.parse(fs.readFileSync(path.join(root, "data", "players.json"), "utf8"));
const squadStatus = JSON.parse(fs.readFileSync(path.join(root, "data", "squad-statuses.json"), "utf8"));
// Sağlayıcı sonuçları: maç bitince sayfayı önizlemeden sonuca çeviren kaynak.
const calendarMatches = JSON.parse(fs.readFileSync(path.join(root, "data", "fixture-calendar.json"), "utf8")).matches || [];
const players = getPlayers(rawPlayers);

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function label(key) {
  return t(key, LOCALE);
}

function slug(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function pageSlug(match) {
  return `${slug(match.homeTeam)}-${slug(match.awayTeam)}-${fixtures.season}-r${String(match.round).padStart(2, "0")}`;
}

function flattenFixtures() {
  return (fixtures.rounds || []).flatMap((round) => (round.matches || []).map((match) => ({
    ...match,
    league: fixtures.league,
    season: fixtures.season,
    round: round.round,
    roundLabel: round.label,
    dateRange: match.dateLabel || round.dateRange || null,
    freshness: match.freshness || fixtures.freshness
  }))).filter((match) => match.homeTeam && match.awayTeam && CONFIRMED_FIXTURE_STATUSES.has(match.fixtureStatus));
}

function getTeam(name) {
  return teams.find((team) => normalizeText(team.name || team.team) === normalizeText(name)) ||
    teams.find((team) => sameClub(team.name || team.team, name)) ||
    null;
}

function teamEnHref(name) {
  const team = getTeam(name);
  return team ? `../team/${teamSlug(team.name)}.html` : null;
}

function teamLink(name) {
  const href = teamEnHref(name);
  return href ? `<a href="${escapeHtml(href)}">${escapeHtml(name)}</a>` : escapeHtml(name);
}

function teamPlayers(name) {
  const wanted = normalizeText(name);
  return players
    .filter((player) => normalizeText(player.currentTeam || player.team) === wanted)
    .sort((left, right) => Number(right.formRating || right.overallRating || 0) - Number(left.formRating || left.overallRating || 0))
    .slice(0, 3);
}

function keyPlayersHtml(name) {
  const selected = teamPlayers(name).filter((player) => publicPlayerView(player).verified);
  if (!selected.length) {
    return `<p class="muted-copy">${escapeHtml(label("common.noData"))}</p>`;
  }
  return `<ul class="match-key-player-list">${selected.map((player) => {
    const rating = player.overallRating || player.aiRating || player.rating || null;
    // HEDEFİ OLMAYAN BAĞLANTI BASILMAZ: İngilizce profil yalnızca yayın
    // kapısından geçen oyuncular için üretiliyor.
    const profile = playerUrls.enPlayerPagePath(player.id);
    const label = `${escapeHtml(player.name)}`;
    const cell = fs.existsSync(path.join(root, profile))
      ? `<a href="../player/${escapeHtml(playerUrls.slugFor(player.id))}.html">${label}</a>`
      : label;
    return `<li>${cell}${rating ? `<span>Rating ${escapeHtml(rating)}</span>` : ""}</li>`;
  }).join("")}</ul>`;
}

function squadNoteHtml(name) {
  const rows = Array.isArray(squadStatus.teams) ? squadStatus.teams : [];
  const row = rows.find((item) => normalizeText(item.team || item.name) === normalizeText(name));
  if (!row) return `<p class="muted-copy">${escapeHtml(label("common.noData"))}</p>`;
  const absenceCount = Number(row.absenceCount || 0);
  const impact = row.totalAbsenceImpact ?? row.absenceImpact;
  return `<dl class="match-squad-metrics">
    <div><dt>Absences</dt><dd>${escapeHtml(absenceCount)}</dd></div>
    ${impact == null ? "" : `<div><dt>Squad impact</dt><dd>${escapeHtml(`${impact}/100`)}</dd></div>`}
    <div><dt>Key absence</dt><dd>${escapeHtml(row.keyAbsence || "None")}</dd></div>
  </dl>`;
}

/**
 * Radar puan kartı — YALNIZCA dilden bağımsız sayısal kısım. Bileşen
 * etiketleri ve pozitif/negatif açıklama cümleleri services/matchRadarService.js
 * içinde Türkçe sabit; buraya çevrilmeden taşınmıyor.
 */
function radarCardEn(name, radar) {
  const scoreText = radar.score === null ? label("radar.pending") : `${radar.score}/100`;
  const confidenceKey = `radar.confidence.${radar.confidence || "low"}`;
  return `<article class="match-radar-team-card">
    <div class="match-radar-team-head"><span>${teamLink(name)}</span><strong>${escapeHtml(scoreText)}</strong></div>
    ${radar.score !== null ? `<div class="match-confidence"><span>${escapeHtml(label(confidenceKey))}</span><b>${escapeHtml(label("radar.coverage"))} ${escapeHtml(radar.coverage)}%</b></div>` : ""}
  </article>`;
}

/** Permanent match page (kick-off, channel, live score, result) when registered. */
function liveCentreCard(match) {
  const enPath = match.kickoff ? enPathForMatch({ homeTeam: match.homeTeam, awayTeam: match.awayTeam, kickoff: match.kickoff }, seoRegistryPages) : null;
  if (!enPath) return "";
  return `<a class="match-related-card" href="${BASE}${escapeHtml(enPath)}"><span>Match centre</span><strong>Kick-off, TV channel &amp; live score</strong><p>Kick-off time, broadcaster, line-ups and the result on one permanent page.</p></a>`;
}

function shortDateLabel(value, locale) {
  return formatDate(value, locale);
}

function pageHtml(match) {
  const slugValue = pageSlug(match);
  const trPath = `mac/${slugValue}.html`;
  const enPath = `en/match/${slugValue}.html`;
  const canonical = absoluteUrl(enPath);
  const radar = calculateMatchRadar(match, { teams, players, squadStatus });
  const competition = competitionLabel(match.league, LOCALE);

  const kickoffDay = match.kickoff ? shortDateLabel(match.kickoff, LOCALE) : "";
  const kickoffClock = match.kickoff ? formatTime(match.kickoff, LOCALE) : "";

  // MAÇ SONU GÜNCELLEME ADIMI. Sağlayıcı bu eşleşme için doğrulanmış bir
  // nihai skor yazdıysa sayfa önizleme olmaktan çıkar: başlık "X 2-1 Y –
  // Result", açıklama sonuç cümlesi, hero skor panosu. Sonuç yoksa sayfa
  // önizleme olarak kalır — skor uydurulmaz. Adım ayrı bir cron değil:
  // sayfa üretimi her derlemede koştuğu için maç bittikten sonraki ilk
  // (saatlik) derleme sayfayı kendiliğinden çevirir.
  const finalResult = findFinalResult(match, calendarMatches, { seasonStart: fixtures.seasonStart });

  const title = finalResult
    ? resultTitle(match, finalResult)
    : match.kickoff
      ? `${match.homeTeam} vs ${match.awayTeam} – Preview, Kick-off & Analysis | FutbolRadar`
      : `${match.homeTeam} vs ${match.awayTeam} – Match Preview | FutbolRadar`;
  const description = finalResult
    ? resultDescription(match, finalResult, LOCALE)
    : match.kickoff
      ? `${match.homeTeam} vs ${match.awayTeam} kicks off ${kickoffDay} at ${kickoffClock} (Türkiye time).${match.venue ? ` Venue: ${match.venue}.` : ""} Pre-match form, radar score and squad news on FutbolRadar.`
      : `${match.homeTeam} vs ${match.awayTeam} — Trendyol Süper Lig preview with team form, radar score and squad news on FutbolRadar.`;

  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      ...((match.kickoff || (finalResult && finalResult.kickoff)) ? [{
        "@type": "SportsEvent",
        name: finalResult
          ? `${match.homeTeam} ${finalResult.home}-${finalResult.away} ${match.awayTeam}`
          : `${match.homeTeam} vs ${match.awayTeam}`,
        url: canonical,
        description,
        startDate: match.kickoff || finalResult.kickoff,
        // schema.org'da "tamamlandı" değeri yok (EventScheduled/Postponed/
        // Cancelled/MovedOnline). Bitmiş maçta yanlış bir durum İDDİA
        // ETMEMEK için alan yalnızca gelecekteki maçlarda yazılır.
        ...(finalResult ? {} : { eventStatus: "https://schema.org/EventScheduled" }),
        eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
        homeTeam: { "@type": "SportsTeam", name: match.homeTeam },
        awayTeam: { "@type": "SportsTeam", name: match.awayTeam },
        competitor: [
          { "@type": "SportsTeam", name: match.homeTeam },
          { "@type": "SportsTeam", name: match.awayTeam }
        ],
        ...(match.venue ? { location: { "@type": "Place", name: match.venue } } : {}),
        superEvent: { "@type": "SportsOrganization", name: fixtures.league || "Süper Lig" },
        sport: "Football",
        inLanguage: "en"
      }] : []),
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: label("breadcrumb.home"), item: absoluteUrl("en/index.html") },
          { "@type": "ListItem", position: 2, name: label("nav.todayMatches"), item: absoluteUrl("en/todays-matches.html") },
          { "@type": "ListItem", position: 3, name: `${match.homeTeam} vs ${match.awayTeam}`, item: canonical }
        ]
      }
    ]
  };

  // Hero: sonuçlanmış maçta skor panosu, gelecekteki maçta başlama bilgisi.
  const heroKicker = finalResult ? statusLabelFor("FINISHED", LOCALE) : label("match.previewKicker");
  const heroTitle = finalResult
    ? `${match.homeTeam} ${finalResult.home}-${finalResult.away} ${match.awayTeam}`
    : `${match.homeTeam} vs ${match.awayTeam}`;
  const heroMeta = finalResult
    ? `${finalResult.kickoff ? `${shortDateLabel(finalResult.kickoff, LOCALE)} · ` : ""}${label(`finish.${finalResult.finishKey || "regular"}`)}`
    : match.kickoff ? `${kickoffDay} · ${kickoffClock}` : (match.dateRange || label("status.SCHEDULED"));

  const resultPanel = finalResult
    ? `      <section class="container section" aria-labelledby="en-result-title">
        ${sectionHead({ locale: LOCALE, kicker: statusLabelFor("FINISHED", LOCALE), titleId: "en-result-title", title: "Final score" })}
        <div class="metric-grid">
          <span>${escapeHtml(label("common.score"))} <b>${escapeHtml(finalResult.home)}-${escapeHtml(finalResult.away)}</b></span>
          ${finalResult.halftimeHome !== null && finalResult.halftimeAway !== null ? `<span>Half-time <b>${escapeHtml(finalResult.halftimeHome)}-${escapeHtml(finalResult.halftimeAway)}</b></span>` : ""}
          ${finalResult.finishKey && finalResult.finishKey !== "regular" ? `<span>Finish <b>${escapeHtml(label(`finish.${finalResult.finishKey}`))}</b></span>` : ""}
          ${finalResult.kickoff ? `<span>${escapeHtml(label("common.date"))} <b>${escapeHtml(shortDateLabel(finalResult.kickoff, LOCALE))}</b></span>` : ""}
          ${match.venue ? `<span>${escapeHtml(label("common.venue"))} <b>${escapeHtml(match.venue)}</b></span>` : ""}
        </div>
      </section>
`
    : "";

  const body = `      <section class="hero match-analysis-hero"><div class="hero-row"><div><span class="eyebrow">${escapeHtml(heroKicker)} · ${escapeHtml(match.roundLabel || competition)}</span><h1>${escapeHtml(heroTitle)}</h1><p class="lead">${escapeHtml(competition)}</p></div><span class="hero-meta">${escapeHtml(heroMeta)}</span></div></section>
${resultPanel}      <section class="match-radar-board" aria-label="${escapeHtml(label("radar.title"))}">${radarCardEn(match.homeTeam, radar.home)}${radarCardEn(match.awayTeam, radar.away)}</section>
      <section class="match-context-grid" aria-label="Match context">
        <article class="card"><span class="card-kicker">${teamLink(match.homeTeam)}</span><h2>${escapeHtml(label("match.form"))} &amp; ${escapeHtml(label("match.squad"))}</h2>${squadNoteHtml(match.homeTeam)}${keyPlayersHtml(match.homeTeam)}</article>
        <article class="card"><span class="card-kicker">${teamLink(match.awayTeam)}</span><h2>${escapeHtml(label("match.form"))} &amp; ${escapeHtml(label("match.squad"))}</h2>${squadNoteHtml(match.awayTeam)}${keyPlayersHtml(match.awayTeam)}</article>
      </section>
      <section class="match-related-grid" aria-label="${escapeHtml(label("match.related"))}">
        ${liveCentreCard(match)}<a class="match-related-card" href="../standings.html"><span>Table</span><strong>Süper Lig standings</strong><p>See where both sides stand this season.</p></a>
        <a class="match-related-card" href="../todays-matches.html"><span>Fixtures</span><strong>Today's matches</strong><p>The full Süper Lig fixture list.</p></a>
      </section>`;

  const html = `<!doctype html>
<html lang="${htmlLang(LOCALE)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <meta name="robots" content="index,follow" />
    <meta property="og:type" content="article" />
    <meta property="og:locale" content="${ogLocale(LOCALE)}" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta property="og:image" content="${DOMAIN}/assets/og-image.svg" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${DOMAIN}/assets/og-image.svg" />
    <link rel="icon" href="${BASE}favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="${BASE}site.webmanifest" />
    <link rel="stylesheet" href="${BASE}page.css" />
    <script type="application/ld+json">${JSON.stringify(schema)}</script>
  </head>
  <body class="subpage match-analysis-page">
    ${siteHeader({ base: BASE, locale: LOCALE, altHref: null })}
    <main class="container">
      <nav class="breadcrumb" aria-label="Breadcrumb"><a href="${BASE}en/index.html">${escapeHtml(label("breadcrumb.home"))}</a><span>/</span><a href="${BASE}en/todays-matches.html">${escapeHtml(label("nav.todayMatches"))}</a><span>/</span><span>${escapeHtml(match.homeTeam)} vs ${escapeHtml(match.awayTeam)}</span></nav>
${body}
    </main>
    ${siteFooter({ base: BASE, locale: LOCALE })}
    <script src="${BASE}site.js" defer></script>
  </body>
</html>
`;

  return { html, trPath, enPath, canonical, lastmod: String((match.freshness && (match.freshness.verifiedAt || match.freshness.fetchedAt)) || fixtures.lastVerifiedAt || "").slice(0, 10) };
}

const matches = flattenFixtures();
fs.mkdirSync(OUT_DIR, { recursive: true });

let written = 0;
const pairs = [];
const sitemapEntries = [];
for (const match of matches) {
  const result = pageHtml(match);
  const target = path.join(root, result.enPath);
  const previous = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
  if (previous !== result.html) {
    fs.writeFileSync(target, result.html, "utf8");
    written += 1;
  }
  pairs.push({ tr: result.trPath, en: result.enPath });
  sitemapEntries.push(`  <url>\n    <loc>${result.canonical}</loc>\n    <lastmod>${result.lastmod || fixtures.lastVerifiedAt || ""}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.7</priority>\n  </url>`);
}

const registered = writeDynamicRoutePairs("match", pairs);

for (const sitemapPath of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) {
  if (!fs.existsSync(sitemapPath)) continue;
  const current = fs.readFileSync(sitemapPath, "utf8");
  // Yalnızca hafta numaralı kendi girdileri; kalıcı EN maç sayfaları korunur.
  const retained = (current.match(URL_ENTRY_RE) || []).filter((entry) => !/<loc>[^<]*\/en\/match\/[^<]*-\d{4}-\d{4}-r\d{2}\.html<\/loc>/.test(entry));
  fs.writeFileSync(sitemapPath, wrapUrlset(retained.concat(sitemapEntries)), "utf8");
}

console.log(`English match pages: ${written} written, ${matches.length - written} unchanged (${matches.length} confirmed fixtures).`);
console.log(`English match pages: ${registered} TR↔EN pairs registered (dynamic route map).`);
