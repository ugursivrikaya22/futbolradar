#!/usr/bin/env node
/**
 * COMPETITION STATS PAGES (SSG + client filters) — TR and EN.
 *
 *   /sampiyonlar-ligi-istatistikleri      ↔  /en/champions-league-stats
 *   /avrupa-ligi-istatistikleri           ↔  /en/europa-league-stats
 *
 * Every league in data/stats-leagues.json with `pages.tr.stats` gets a page
 * here; adding a league needs no change to this script.
 *
 * The default view (all teams, all rounds from the league phase on) is
 * rendered at build time with the same functions the browser uses
 * (competition-stats-core.js). The page also embeds the compact data set as
 * `application/json`; competition-stats.js re-renders on team/round change
 * and keeps the selection in the URL (?takim=&tur= / ?team=&round=). Those
 * filtered URLs canonicalise to the main page — 36 teams × N rounds of thin
 * near-duplicates are deliberately not separate indexable pages.
 *
 * Options (tests): --fixtures-store=<json> --leaders-store=<json>
 *                  --out=<dir> (default: repo root + public/) --no-sitemap
 *                  --now=<iso>
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { siteFooter, siteHeader } from "./lib/layout.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";
import { ROBOTS_INDEX } from "./lib/robots.mjs";

const require = createRequire(import.meta.url);
const core = require("../competition-stats-core.js");
const statsLeagues = require("../services/statsLeagues.js");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteUrl = "https://www.futbolradar.com";
const socialImage = `${siteUrl}/assets/og-image.png`;

const arg = (name) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const readJson = (file) => JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));

const playerUrls = require("../services/playerUrl.js").createPlayerUrlResolver((() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "data", "player-url-slugs.json"), "utf8"));
  } catch {
    return { entries: [], aliases: [] };
  }
})());

const { escapeHtml } = core;

const COPY = {
  tr: {
    home: "Ana Sayfa",
    hub: "İstatistik Merkezi",
    hubHref: "./istatistik-merkezi.html",
    title: (l, s) => `${l} İstatistikleri ${s}: Gol Krallığı, Asist ve Takım Formu | FutbolRadar`,
    description: (l, s, top) => `${l} ${s} istatistikleri: gol krallığı${top ? ` (lider ${top})` : ""}, asist krallığı, takım formu ve lig aşaması dahil tur tur maç istatistikleri. Takım ve tura göre filtrelenir.`,
    h1: (l) => `${l} İstatistikleri`,
    kicker: (s) => `UEFA · ${s} sezonu`,
    intro: (l) => `${l} gol ve asist krallığı, takımların son 5 maçlık formu ve tur bazında maç istatistikleri. Takım seçerek yalnızca o kulübün oyuncularını ve maçlarını, tur seçerek lig aşamasının bir maç gününü ya da bir eleme turunu görebilirsiniz.`,
    format: "Format: 2024-25 sezonundan bu yana grup aşaması yok. 36 takım tek bir lig aşamasında 8 maç oynar; ilk 8 doğrudan son 16'ya kalır, 9-24. sıralar play-off turunu oynar. Ardından son 16, çeyrek final, yarı final ve final gelir.",
    filters: "İstatistik filtreleri",
    team: "Takım",
    round: "Tur",
    reset: "Filtreleri temizle",
    apply: "Uygula",
    jump: "Bölümler",
    sections: { scorers: "Gol krallığı", assists: "Asist krallığı", form: "Takım formu", rounds: "Tur istatistikleri" },
    sectionHeads: {
      scorers: "En çok gol atan oyuncular",
      assists: "En çok asist yapan oyuncular",
      form: "Takım formu — son 5 maç",
      rounds: "Tur istatistikleri"
    },
    freshness: "Son güncelleme",
    leadersFresh: "Gol/asist",
    fixturesFresh: "Fikstür",
    pending: "Güncelleniyor",
    tz: "TSİ",
    source: "Kaynak: API-Football (/players/topscorers, /players/topassists, /fixtures, /fixtures/rounds). Yalnızca sağlayıcıdan gelen veriler gösterilir; eksik değerler tahmin edilmez.",
    related: "İlgili sayfalar",
    standings: (l) => `${l} puan durumu`,
    superLigScorers: "Süper Lig gol krallığı",
    example: "ÖRNEK VERİ — bu sayfa test fikstürleriyle üretildi, gerçek maç verisi değildir.",
    pagesKey: "tr",
    lang: "tr",
    ogLocale: "tr_TR",
    inLanguage: "tr-TR",
    breadcrumbAria: "İçerik yolu",
    nameScorers: "gol krallığı"
  },
  en: {
    home: "Home",
    hub: "Stats hub",
    hubHref: "./stats-hub.html",
    title: (l, s) => `${l} Stats ${s}: Top Scorers, Assists and Team Form | FutbolRadar`,
    description: (l, s, top) => `${l} ${s} stats: top scorers${top ? ` (led by ${top})` : ""}, top assists, team form and round-by-round match stats including the league phase. Filter by team and round.`,
    h1: (l) => `${l} Stats`,
    kicker: (s) => `UEFA · ${s} season`,
    intro: (l) => `${l} top scorers and assists, each club's last-five form and match stats per round. Pick a team to see only that club's players and matches, or a round to see one league-phase matchday or one knockout round.`,
    format: "Format: since 2024-25 there is no group stage. All 36 clubs play eight matches in a single league phase; the top 8 go straight to the round of 16 and 9th–24th play the knockout phase play-offs, followed by the round of 16, quarter-finals, semi-finals and final.",
    filters: "Stats filters",
    team: "Team",
    round: "Round",
    reset: "Clear filters",
    apply: "Apply",
    jump: "Sections",
    sections: { scorers: "Top scorers", assists: "Top assists", form: "Team form", rounds: "Round stats" },
    sectionHeads: {
      scorers: "Top scorers",
      assists: "Top assists",
      form: "Team form — last 5 matches",
      rounds: "Round stats"
    },
    freshness: "Last updated",
    leadersFresh: "Goals/assists",
    fixturesFresh: "Fixtures",
    pending: "Updating",
    tz: "Istanbul time, UTC+3",
    source: "Source: API-Football (/players/topscorers, /players/topassists, /fixtures, /fixtures/rounds). Only provider data is shown; missing values are never estimated.",
    related: "Related pages",
    standings: (l) => `${l} standings`,
    superLigScorers: null,
    example: "EXAMPLE DATA — this page was generated from test fixtures, not real match data.",
    pagesKey: "en",
    lang: "en",
    ogLocale: "en_GB",
    inLanguage: "en",
    breadcrumbAria: "Breadcrumb",
    nameScorers: "top scorers"
  }
};

function formatTime(iso, locale) {
  if (!iso || !Number.isFinite(Date.parse(iso))) return null;
  return new Date(iso).toLocaleString(locale === "en" ? "en-GB" : "tr-TR", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul"
  });
}

/** ISO with explicit +03:00 offset for JSON-LD dateModified. */
function istanbulIso(iso) {
  if (!iso || !Number.isFinite(Date.parse(iso))) return null;
  const shifted = new Date(Date.parse(iso) + 3 * 60 * 60 * 1000).toISOString().slice(0, 19);
  return `${shifted}+03:00`;
}

function pagePath(league, locale) {
  return league.pages[locale] && league.pages[locale].stats;
}

function canonicalUrl(relative) {
  return `${siteUrl}/${relative}`;
}

function breadcrumbHtml(items, aria) {
  return `<nav class="evergreen-breadcrumb" aria-label="${escapeHtml(aria)}">${items
    .map((item, index) => index === items.length - 1
      ? `<span aria-current="page">${escapeHtml(item.name)}</span>`
      : `<a href="${escapeHtml(item.href)}">${escapeHtml(item.name)}</a><span aria-hidden="true">/</span>`)
    .join("")}</nav>`;
}

function jsonForScript(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
}

function renderPage(league, locale, payload, allLeagues) {
  const c = COPY[locale];
  const base = locale === "en" ? "../" : "./";
  const selfPath = pagePath(league, locale);
  const trPath = pagePath(league, "tr");
  const enPath = pagePath(league, "en");
  const canonical = canonicalUrl(selfPath);
  const leagueName = payload.league.name;
  const season = payload.league.seasonLabel;
  const title = c.title(leagueName, season);
  const description = c.description(leagueName, season, payload.scorers[0] ? (locale === "en" ? `${payload.scorers[0].name} with ${payload.scorers[0].goals}` : `${payload.scorers[0].name} ${payload.scorers[0].goals} gol`) : null);
  const state = { teamId: null, roundKey: "", matchday: null };
  const leadersTime = formatTime(payload.freshness.leaders, locale);
  const fixturesTime = formatTime(payload.freshness.fixtures, locale);
  const modified = [payload.freshness.leaders, payload.freshness.fixtures].filter(Boolean).sort().at(-1) || null;

  const crumbs = [
    { name: c.home, href: locale === "en" ? "./index.html" : "./", url: locale === "en" ? `${siteUrl}/en` : `${siteUrl}/` },
    { name: c.hub, href: c.hubHref, url: locale === "en" ? `${siteUrl}/en/stats-hub` : `${siteUrl}/istatistik-merkezi.html` },
    { name: c.h1(payload.league.shortName), href: `./${path.basename(selfPath)}`, url: canonical }
  ];

  const scorersForSchema = payload.scorers.slice(0, 10);
  const graph = [
    {
      "@type": "CollectionPage",
      "@id": `${canonical}#page`,
      url: canonical,
      name: c.h1(leagueName),
      description,
      inLanguage: c.inLanguage,
      isPartOf: { "@type": "WebSite", name: "FutbolRadar", url: `${siteUrl}/` },
      ...(istanbulIso(modified) ? { dateModified: istanbulIso(modified) } : {}),
      about: { "@type": "SportsOrganization", name: leagueName, sport: "Football" }
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: crumbs.map((item, index) => ({ "@type": "ListItem", position: index + 1, name: item.name, item: item.url }))
    }
  ];
  if (scorersForSchema.length) {
    graph.push({
      "@type": "ItemList",
      "@id": `${canonical}#top-scorers`,
      name: `${leagueName} ${season} ${c.nameScorers}`,
      numberOfItems: scorersForSchema.length,
      itemListOrder: "https://schema.org/ItemListOrderDescending",
      itemListElement: scorersForSchema.map((row, index) => ({
        "@type": "ListItem",
        position: index + 1,
        item: { "@type": "Person", name: row.name, ...(row.team ? { memberOf: { "@type": "SportsTeam", name: row.team } } : {}) }
      }))
    });
  }

  const freshnessParts = [
    `${c.leadersFresh}: ${leadersTime ? `<time datetime="${escapeHtml(payload.freshness.leaders)}">${escapeHtml(leadersTime)}</time> (${escapeHtml(c.tz)})` : escapeHtml(c.pending)}`,
    `${c.fixturesFresh}: ${fixturesTime ? `<time datetime="${escapeHtml(payload.freshness.fixtures)}">${escapeHtml(fixturesTime)}</time> (${escapeHtml(c.tz)})` : escapeHtml(c.pending)}`
  ];

  const sectionIds = locale === "en"
    ? { scorers: "top-scorers", assists: "top-assists", form: "team-form", rounds: "round-stats" }
    : { scorers: "gol-kralligi", assists: "asist-kralligi", form: "takim-formu", rounds: "tur-istatistikleri" };

  const otherLeagues = allLeagues.filter((entry) => entry.slug !== league.slug && pagePath(entry, locale));
  const related = [
    league.pages[locale].standings ? [`./${path.basename(league.pages[locale].standings)}`, c.standings(payload.league.shortName)] : null,
    ...otherLeagues.map((entry) => [`./${path.basename(pagePath(entry, locale))}`, c.h1(entry.name[locale])]),
    [c.hubHref, c.hub],
    c.superLigScorers ? ["./gol-kralligi.html", c.superLigScorers] : ["./top-scorers.html", "Süper Lig top scorers"]
  ].filter(Boolean);

  const exampleBanner = payload.example
    ? `<p class="cs-example-banner" role="note" data-example-data="true"><strong>${escapeHtml(c.example)}</strong></p>`
    : "";

  const altHref = locale === "en" ? trPath : enPath;

  return `<!doctype html>
<html lang="${c.lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="${payload.example ? "noindex, nofollow" : ROBOTS_INDEX}" />
    <link rel="canonical" href="${canonical}" />
    <link rel="alternate" hreflang="tr-TR" href="${canonicalUrl(trPath)}" />
${enPath ? `    <link rel="alternate" hreflang="en" href="${canonicalUrl(enPath)}" />\n` : ""}    <link rel="alternate" hreflang="x-default" href="${canonicalUrl(trPath)}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="${c.ogLocale}" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${socialImage}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${socialImage}" />
    <link rel="icon" href="${base}favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="${base}page.css" />
    <link rel="stylesheet" href="${base}competition-stats.css" />
    <script type="application/ld+json">${jsonForScript({ "@context": "https://schema.org", "@graph": graph })}</script>
  </head>
  <body>
    <div class="site-shell">
      ${siteHeader({ base, locale, altHref })}
      <main class="evergreen-page competition-stats-page" data-competition-stats="${escapeHtml(league.slug)}">
        <div class="container">
          ${breadcrumbHtml(crumbs, c.breadcrumbAria)}
          ${exampleBanner}
          <header class="evergreen-hero">
            <span class="section-kicker">${escapeHtml(c.kicker(season))}</span>
            <h1>${escapeHtml(c.h1(leagueName))}</h1>
            <p>${escapeHtml(c.intro(payload.league.shortName))}</p>
            <p class="cs-format-note">${escapeHtml(c.format)}</p>
            <p class="evergreen-freshness">${escapeHtml(c.freshness)} — ${freshnessParts.join(" · ")}</p>
          </header>

          <form class="stats-filter-bar cs-filter-bar" aria-label="${escapeHtml(c.filters)}" method="get" action="./${escapeHtml(path.basename(selfPath))}" data-cs-filters>
            <label><span>${escapeHtml(c.team)}</span><select name="${payload.params.team}" data-cs-team>${core.teamOptionsHtml(payload, state)}</select></label>
            <label><span>${escapeHtml(c.round)}</span><select name="${payload.params.round}" data-cs-round>${core.roundOptionsHtml(payload, state)}</select></label>
            <button type="submit" data-cs-apply>${escapeHtml(c.apply)}</button>
            <button type="button" data-cs-reset hidden>${escapeHtml(c.reset)}</button>
            <span class="stats-filter-result" data-cs-status aria-live="polite"></span>
          </form>

          <nav class="cs-jump" aria-label="${escapeHtml(c.jump)}">
            ${["scorers", "assists", "form", "rounds"].map((key) => `<a href="#${sectionIds[key]}">${escapeHtml(c.sections[key])}</a>`).join("")}
          </nav>

          <section class="evergreen-section cs-section" id="${sectionIds.scorers}" aria-labelledby="${sectionIds.scorers}-h">
            <h2 id="${sectionIds.scorers}-h">${escapeHtml(c.sectionHeads.scorers)}</h2>
            <p class="cs-note">${escapeHtml(core.text(locale, "seasonTotalsNote"))}</p>
            <div data-cs-slot="scorers">${core.leadersTableHtml(payload, "goals", state)}</div>
          </section>

          <section class="evergreen-section cs-section" id="${sectionIds.assists}" aria-labelledby="${sectionIds.assists}-h">
            <h2 id="${sectionIds.assists}-h">${escapeHtml(c.sectionHeads.assists)}</h2>
            <div data-cs-slot="assists">${core.leadersTableHtml(payload, "assists", state)}</div>
          </section>

          <section class="evergreen-section cs-section" id="${sectionIds.form}" aria-labelledby="${sectionIds.form}-h">
            <h2 id="${sectionIds.form}-h">${escapeHtml(c.sectionHeads.form)}</h2>
            <p class="cs-note">${escapeHtml(core.text(locale, "formScopeNote"))}</p>
            <div data-cs-slot="form">${core.formTableHtml(payload, state)}</div>
          </section>

          <section class="evergreen-section cs-section" id="${sectionIds.rounds}" aria-labelledby="${sectionIds.rounds}-h">
            <h2 id="${sectionIds.rounds}-h">${escapeHtml(c.sectionHeads.rounds)}</h2>
            <div data-cs-slot="rounds">${core.roundStatsHtml(payload, state)}</div>
          </section>

          <p class="cs-source">${escapeHtml(c.source)}</p>

          <aside class="evergreen-related" aria-labelledby="cs-related-heading"><h2 id="cs-related-heading">${escapeHtml(c.related)}</h2><div class="evergreen-link-grid">${related.map(([href, label]) => `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`).join("")}</div></aside>
        </div>
      </main>
      ${siteFooter({ base, locale })}
    </div>
    <script type="application/json" id="competition-stats-data">${jsonForScript(payload)}</script>
    <script src="${base}competition-stats-core.js" defer></script>
    <script src="${base}competition-stats.js" defer></script>
    <script src="${base}site.js" defer></script>
  </body>
</html>
`;
}

function updateSitemap(file, entries) {
  if (!fs.existsSync(file)) return;
  const xml = fs.readFileSync(file, "utf8");
  const urls = new Map(entries.map((entry) => [entry.url, entry]));
  const legacy = entries.map((entry) => `${entry.url}.html`);
  const stale = [...urls.keys(), ...legacy];
  const existing = (xml.match(URL_ENTRY_RE) || []).filter((entryXml) => !stale.some((url) => entryXml.includes(`<loc>${url}</loc>`)));
  const fresh = entries.map((entry) => `  <url>\n    <loc>${entry.url}</loc>\n    <lastmod>${entry.lastmod}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>${entry.priority}</priority>\n  </url>`);
  fs.writeFileSync(file, wrapUrlset([...existing, ...fresh]), "utf8");
}

export function generateCompetitionStatsPages(options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const leaguesAll = statsLeagues.loadStatsLeagues({ root });
  const leagues = leaguesAll.filter((league) => league.pages && league.pages.tr && league.pages.tr.stats);
  const outRoots = options.out ? [path.resolve(options.out)] : [root, path.join(root, "public")];
  const written = [];
  const sitemapEntries = [];
  for (const league of leagues) {
    for (const locale of ["tr", "en"]) {
      const relative = pagePath(league, locale);
      if (!relative) continue;
      const base = locale === "en" ? "../" : "./";
      const payload = statsLeagues.buildPagePayload(league, {
        root,
        now,
        locale,
        leadersStore: options.leadersStore,
        fixturesStore: options.fixturesStore,
        playerHref: (slug) => playerUrls.playerCanonicalHref(slug, base)
      });
      const html = renderPage(league, locale, payload, leagues);
      for (const outRoot of outRoots) {
        const destination = path.join(outRoot, `${relative}.html`);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, html, "utf8");
      }
      written.push({ league: league.slug, locale, path: `${relative}.html`, payload });
      const lastmod = ([payload.freshness.leaders, payload.freshness.fixtures].filter(Boolean).sort().at(-1) || now.toISOString()).slice(0, 10);
      sitemapEntries.push({ url: canonicalUrl(relative), lastmod, priority: locale === "en" ? "0.7" : "0.8", example: payload.example });
    }
  }
  if (!options.noSitemap && !sitemapEntries.some((entry) => entry.example)) {
    for (const sitemapPath of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) updateSitemap(sitemapPath, sitemapEntries);
  }
  return written;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const written = generateCompetitionStatsPages({
    out: arg("out"),
    now: arg("now"),
    noSitemap: process.argv.includes("--no-sitemap"),
    fixturesStore: arg("fixtures-store") ? readJson(arg("fixtures-store")) : undefined,
    leadersStore: arg("leaders-store") ? readJson(arg("leaders-store")) : undefined
  });
  for (const page of written) {
    const p = page.payload;
    console.log(`[competition-stats-pages] ${page.path} teams=${p.teams.length} scorers=${p.scorers.length} assists=${p.assists.length} fixtures=${p.fixtures.length}${p.example ? " (EXAMPLE DATA)" : ""}${p.unknownRoundLabels.length ? ` unmapped-rounds=${JSON.stringify(p.unknownRoundLabels)}` : ""}`);
  }
}
