import fs from "node:fs";
import path from "node:path";
import { siteFooter, siteHeader } from "./lib/layout.mjs";

const root = process.cwd();
const domain = "https://www.futbolradar.com";
const config = JSON.parse(fs.readFileSync(path.join(root, "data", "standings-pages.json"), "utf8"));
const cachePath = path.join(root, "data", "standings-cache.json");
const cache = fs.existsSync(cachePath)
  ? JSON.parse(fs.readFileSync(cachePath, "utf8"))
  : { season: config.season.label, leagues: {} };

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeKey(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const REQUIRED_NUMBERS = [
  "rank", "played", "won", "drawn", "lost", "goalsFor", "goalsAgainst", "goalDifference", "points"
];

function validatedRows(rows) {
  if (!Array.isArray(rows) || rows.length < 10) return null;
  const normalized = rows.map((row) => ({
    ...row,
    team: String(row && (row.team || row.name) || "").trim(),
    rank: finite(row && row.rank),
    played: finite(row && row.played),
    won: finite(row && row.won),
    drawn: finite(row && row.drawn),
    lost: finite(row && row.lost),
    goalsFor: finite(row && row.goalsFor),
    goalsAgainst: finite(row && row.goalsAgainst),
    goalDifference: finite(row && (row.goalDifference ?? row.average)),
    points: finite(row && row.points)
  }));
  if (normalized.some((row) => !row.team || REQUIRED_NUMBERS.some((field) => row[field] === null))) return null;
  return normalized.sort((left, right) => left.rank - right.rank);
}

async function fetchLeague(leagueId) {
  if (process.env.STANDINGS_SKIP_REMOTE === "1") return null;
  const base = String(process.env.STANDINGS_API_BASE_URL || domain).replace(/\/$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${base}/api/standings?league=${encodeURIComponent(leagueId)}`, {
      headers: { accept: "application/json", "user-agent": "FutbolRadar-Standings-Prerender/1.0" },
      signal: controller.signal
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const rows = validatedRows(payload && payload.data);
    if (!payload || payload.ok !== true || !rows) return null;
    return {
      source: payload.source || "FutbolRadar canlı futbol veri altyapısı",
      updatedAt: payload.updatedAt || payload.responseAt || new Date().toISOString(),
      fetchedAt: new Date().toISOString(),
      rows
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

const leagueIds = [...new Set(config.pages.map((page) => page.league))];
const remoteResults = await Promise.all(leagueIds.map(async (leagueId) => [leagueId, await fetchLeague(leagueId)]));
for (const [leagueId, result] of remoteResults) {
  if (result) cache.leagues[leagueId] = result;
}
cache.season = config.season.label;

for (const leagueId of leagueIds) {
  const entry = cache.leagues[leagueId];
  const rows = validatedRows(entry && entry.rows);
  if (!rows) {
    throw new Error(`${leagueId}: doğrulanmış puan durumu yok; ince SEO sayfası üretilmedi.`);
  }
  entry.rows = rows;
}

fs.writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");

function zoneFor(row, league, total) {
  const zones = league.zones || {};
  if (zones.relegationCount && row.rank > total - zones.relegationCount) return "relegation";
  if (zones.promotionThrough && row.rank <= zones.promotionThrough) return "promotion";
  if (zones.playoffThrough && row.rank <= zones.playoffThrough) return "playoff";
  if (zones.championsLeagueThrough && row.rank <= zones.championsLeagueThrough) return "champions-league";
  if (zones.europeThrough && row.rank <= zones.europeThrough) return "europe";
  return "";
}

function signed(value) {
  return `${Number(value) > 0 ? "+" : ""}${value}`;
}

function standingRows(rows, league, selectedTeam) {
  return rows.map((row) => {
    const highlighted = selectedTeam && normalizeKey(row.team) === normalizeKey(selectedTeam);
    const zone = zoneFor(row, league, rows.length);
    return `<tr class="standings-row${highlighted ? " is-highlighted" : ""}${zone ? ` is-zone-${zone}` : ""}"${highlighted ? ' aria-current="true"' : ""} data-team="${escapeHtml(normalizeKey(row.team))}">
            <td class="col-rank">${row.rank}</td>
            <th scope="row" class="col-team"><span>${escapeHtml(row.team)}</span></th>
            <td class="col-played">${row.played}</td>
            <td class="col-won">${row.won}</td>
            <td class="col-drawn">${row.drawn}</td>
            <td class="col-lost">${row.lost}</td>
            <td class="col-gf">${row.goalsFor}</td>
            <td class="col-ga">${row.goalsAgainst}</td>
            <td class="col-gd">${signed(row.goalDifference)}</td>
            <td class="col-points"><strong>${row.points}</strong></td>
          </tr>`;
  }).join("\n");
}

function zoneLegend(league) {
  const zones = league.zones || {};
  const items = [];
  if (zones.championsLeagueThrough) items.push('<span class="is-champions-league">Şampiyonlar Ligi hattı</span>');
  if (zones.europeThrough) items.push('<span class="is-europe">Avrupa kupaları hattı</span>');
  if (zones.promotionThrough) items.push('<span class="is-promotion">Doğrudan yükselme</span>');
  if (zones.playoffThrough) items.push('<span class="is-playoff">Play-off hattı</span>');
  if (zones.relegationCount) items.push('<span class="is-relegation">Küme düşme hattı</span>');
  return `<div class="standings-zone-legend" aria-label="Tablo bölge açıklamaları">${items.join("")}</div>`;
}

function leagueSummary(rows, league) {
  const leader = rows[0];
  const relegation = league.zones && league.zones.relegationCount
    ? rows.slice(-league.zones.relegationCount).map((row) => row.team)
    : [];
  return `<p><strong>${escapeHtml(leader.team)}</strong>, ${leader.points} puanla ${escapeHtml(league.name)} lideri.${relegation.length ? ` ${escapeHtml(relegation.join(", "))} küme düşme hattında.` : ""} Tablo doğrulanmış son maç sonuçlarına göre güncellenir.</p>`;
}

function teamContext(rows, team) {
  const index = rows.findIndex((row) => normalizeKey(row.team) === normalizeKey(team));
  if (index < 0) throw new Error(`${team}: takım güncel lig tablosunda bulunamadı.`);
  const row = rows[index];
  const leader = rows[0];
  const above = rows[index - 1] || null;
  const below = rows[index + 1] || null;
  const leaderGap = leader.points - row.points;
  const aboveGap = above ? above.points - row.points : null;
  const belowGap = below ? row.points - below.points : null;
  const summary = leaderGap > 0
    ? `${row.team}, ${row.played} maç sonunda ${row.points} puanla ${row.rank}. sırada. Lider ${leader.team} ile arasında ${leaderGap} puan var.`
    : `${row.team}, ${row.played} maç sonunda ${row.points} puanla lig lideri.`;
  return `<section class="team-standing-context" aria-labelledby="team-standing-context-title" data-team-standing-context>
        <h2 id="team-standing-context-title">${escapeHtml(row.team)} kaçıncı sırada?</h2>
        <div class="team-standing-copy"><p>${escapeHtml(summary)}</p></div>
        <dl class="team-standing-metrics">
          <div><dt>Sıra</dt><dd>${row.rank}</dd></div>
          <div><dt>Puan</dt><dd>${row.points}</dd></div>
          <div><dt>Oynanan</dt><dd>${row.played}</dd></div>
          <div><dt>G / B / M</dt><dd>${row.won} / ${row.drawn} / ${row.lost}</dd></div>
          <div><dt>Averaj</dt><dd>${signed(row.goalDifference)}</dd></div>
          <div><dt>Üst sıra farkı</dt><dd>${aboveGap === null ? "Lider" : `${aboveGap} puan`}</dd></div>
          <div><dt>Alt sıra farkı</dt><dd>${belowGap === null ? "Son sıra" : `${belowGap} puan`}</dd></div>
          <div><dt>Liderle fark</dt><dd>${leaderGap} puan</dd></div>
        </dl>
      </section>`;
}

function standingsTable(page, rows, league) {
  return `<section class="standings-table-section" aria-labelledby="standings-table-title">
        <div class="standings-section-head"><div><span>2026/27 sezonu</span><h2 id="standings-table-title">${escapeHtml(league.name)} güncel puan tablosu</h2></div><small><span>Son veri:</span> <time data-standings-updated datetime="${escapeHtml(cache.leagues[page.league].updatedAt)}">${escapeHtml(formatDate(cache.leagues[page.league].updatedAt))}</time></small></div>
        ${zoneLegend(league)}
        <div class="standings-table-frame">
          <table class="seo-standings-table">
            <caption>${escapeHtml(league.name)} ${escapeHtml(config.season.label)} puan durumu</caption>
            <thead><tr><th scope="col" class="col-rank">#</th><th scope="col" class="col-team">Takım</th><th scope="col" class="col-played"><abbr title="Oynanan">O</abbr></th><th scope="col" class="col-won"><abbr title="Galibiyet">G</abbr></th><th scope="col" class="col-drawn"><abbr title="Beraberlik">B</abbr></th><th scope="col" class="col-lost"><abbr title="Mağlubiyet">M</abbr></th><th scope="col" class="col-gf"><abbr title="Attığı gol">AG</abbr></th><th scope="col" class="col-ga"><abbr title="Yediği gol">YG</abbr></th><th scope="col" class="col-gd"><abbr title="Averaj">Av</abbr></th><th scope="col" class="col-points"><abbr title="Puan">P</abbr></th></tr></thead>
            <tbody data-standings-body>${standingRows(rows, league, page.team)}</tbody>
          </table>
        </div>
      </section>`;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Güncel veri";
  return `${new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" }).format(date)} TSİ`;
}

function relatedLinks(page, league) {
  const leaguePages = config.pages.filter((item) => item.route !== page.route && (item.league === page.league || item.kind === "league")).slice(0, 6);
  const links = leaguePages.map((item) => `<a href="./${escapeHtml(item.route)}"><span>Puan durumu</span><strong>${escapeHtml(item.h1)}</strong></a>`);
  links.push(`<a href="${escapeHtml(league.fixtureHref)}"><span>Maç programı</span><strong>${escapeHtml(league.shortName)} maçları</strong></a>`);
  links.push('<a href="./bugunun-maclari.html"><span>Güncel program</span><strong>Bugünün maçları</strong></a>');
  links.push('<a href="./canli-skor.html"><span>Maç akışı</span><strong>Canlı skorlar</strong></a>');
  if (page.team) links.push(`<a href="./takim-detay.html?team=${encodeURIComponent(page.team)}"><span>Takım sayfası</span><strong>${escapeHtml(page.team)} takım radarı</strong></a>`);
  return `<section class="standings-related" aria-labelledby="standings-related-title"><div class="section-title"><span class="section-kicker">İlgili sayfalar</span><h2 id="standings-related-title">Puan durumunu maç ve takım verileriyle inceleyin</h2></div><div class="standings-related-grid">${links.join("")}</div></section>`;
}

function pageSchema(page, canonical, modifiedAt) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        name: page.h1,
        description: page.description,
        url: canonical,
        dateModified: modifiedAt,
        isPartOf: { "@type": "WebSite", name: "FutbolRadar", url: `${domain}/` }
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Ana Sayfa", item: `${domain}/` },
          { "@type": "ListItem", position: 2, name: "Puan Durumu", item: `${domain}/puan-durumu.html` },
          { "@type": "ListItem", position: 3, name: page.h1, item: canonical }
        ]
      }
    ]
  };
}

function pageHtml(page) {
  const league = config.leagues[page.league];
  const leagueData = cache.leagues[page.league];
  const rows = leagueData.rows;
  const canonical = `${domain}/${page.route}`;
  const schema = pageSchema(page, canonical, leagueData.updatedAt);
  const topAnswer = page.kind === "team"
    ? teamContext(rows, page.team)
    : `<section class="standings-intent-summary" data-standings-summary>${leagueSummary(rows, league)}</section>`;
  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(page.title)}</title>
    <meta name="description" content="${escapeHtml(page.description)}" />
    <link rel="canonical" href="${canonical}" />
    <meta name="robots" content="index,follow" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:title" content="${escapeHtml(page.title)}" />
    <meta property="og:description" content="${escapeHtml(page.description)}" />
    <meta property="og:image" content="${domain}/assets/og-image.svg" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(page.title)}" />
    <meta name="twitter:description" content="${escapeHtml(page.description)}" />
    <meta name="twitter:image" content="${domain}/assets/og-image.svg" />
    <script type="application/ld+json">${JSON.stringify(schema)}</script>
    <link rel="icon" href="./favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="./site.webmanifest" />
    <link rel="stylesheet" href="./page.css" />
    <link rel="stylesheet" href="./standings.css" />
  </head>
  <body class="subpage standings-seo-page">
    ${siteHeader({ base: "./" })}
    <main class="container standings-page-shell" data-standings-page data-league="${escapeHtml(page.league)}" data-team="${escapeHtml(page.team || "")}" data-zones="${escapeHtml(JSON.stringify(league.zones || {}))}">
      <nav class="breadcrumb" aria-label="Sayfa yolu"><a href="./index.html">Ana Sayfa</a><span>/</span><a href="./puan-durumu.html">Puan Durumu</a><span>/</span><span>${escapeHtml(page.h1)}</span></nav>
      <header class="standings-hero"><div><span class="eyebrow">${escapeHtml(league.name)} · ${escapeHtml(config.season.label)}</span><h1>${escapeHtml(page.h1)}</h1><p>${escapeHtml(page.description)}</p></div><aside><span>Veri kaynağı</span><strong>${escapeHtml(leagueData.source)}</strong><small>Maç sonuçları değiştikçe güncellenir.</small></aside></header>
      ${topAnswer}
      ${standingsTable(page, rows, league)}
      ${relatedLinks(page, league)}
    </main>
    ${siteFooter({ base: "./" })}
    <script src="./standings-page.js" defer></script>
    <script src="./site.js" defer></script>
  </body>
</html>`;
}

function write(file, content) {
  fs.writeFileSync(path.join(root, file), content, "utf8");
  fs.writeFileSync(path.join(root, "public", file), content, "utf8");
}

for (const page of config.pages) write(`${page.route}.html`, pageHtml(page));
fs.copyFileSync(path.join(root, "standings-page.js"), path.join(root, "public", "standings-page.js"));
fs.copyFileSync(path.join(root, "standings.css"), path.join(root, "public", "standings.css"));

function hubHtml() {
  const superPage = config.pages.find((page) => page.route === "super-lig-puan-durumu");
  const league = config.leagues["super-lig"];
  const rows = cache.leagues["super-lig"].rows;
  const canonical = `${domain}/puan-durumu.html`;
  const title = "Puan Durumu | Süper Lig, 1. Lig ve Premier Lig | FutbolRadar";
  const description = "Süper Lig, 1. Lig, Premier League ve büyük takımların güncel puan durumu sayfalarına ulaşın; lider ve düşme hattını inceleyin.";
  const hubSchema = pageSchema({ h1: "Puan Durumu", description }, canonical, cache.leagues["super-lig"].updatedAt);
  hubSchema["@graph"][1].itemListElement = hubSchema["@graph"][1].itemListElement.slice(0, 2);
  const cards = config.pages.map((page) => `<a href="./${escapeHtml(page.route)}"><span>${page.kind === "team" ? "Takım" : "Lig"}</span><strong>${escapeHtml(page.h1)}</strong><p>${escapeHtml(page.description)}</p></a>`).join("");
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}" /><link rel="canonical" href="${canonical}" /><meta name="robots" content="index,follow" /><meta property="og:type" content="website" /><meta property="og:locale" content="tr_TR" /><meta property="og:site_name" content="FutbolRadar" /><meta property="og:url" content="${canonical}" /><meta property="og:title" content="${escapeHtml(title)}" /><meta property="og:description" content="${escapeHtml(description)}" /><meta property="og:image" content="${domain}/assets/og-image.svg" /><meta name="twitter:card" content="summary_large_image" /><meta name="twitter:title" content="${escapeHtml(title)}" /><meta name="twitter:description" content="${escapeHtml(description)}" /><meta name="twitter:image" content="${domain}/assets/og-image.svg" /><script type="application/ld+json">${JSON.stringify(hubSchema)}</script><link rel="icon" href="./favicon.svg" type="image/svg+xml" /><link rel="manifest" href="./site.webmanifest" /><link rel="stylesheet" href="./page.css" /><link rel="stylesheet" href="./standings.css" /></head><body class="subpage standings-seo-page">${siteHeader({ base: "./" })}<main class="container standings-page-shell" data-standings-page data-league="super-lig" data-team="" data-zones="${escapeHtml(JSON.stringify(league.zones || {}))}"><nav class="breadcrumb" aria-label="Sayfa yolu"><a href="./index.html">Ana Sayfa</a><span>/</span><span>Puan Durumu</span></nav><header class="standings-hero"><div><span class="eyebrow">Lig ve takım tabloları</span><h1>Puan Durumu</h1><p>${escapeHtml(description)}</p></div><aside><span>Kapsam</span><strong>${config.pages.length} kalıcı puan durumu sayfası</strong><small>Her sayfanın bağımsız canonical adresi vardır.</small></aside></header><section class="standings-hub-grid" aria-label="Puan durumu sayfaları">${cards}</section><section class="standings-intent-summary" data-standings-summary>${leagueSummary(rows, league)}</section>${standingsTable(superPage, rows, league)}${relatedLinks(superPage, league)}</main>${siteFooter({ base: "./" })}<script src="./standings-page.js" defer></script><script src="./site.js" defer></script></body></html>`;
}

write("puan-durumu.html", hubHtml());

function upsertSitemap(file) {
  let xml = fs.readFileSync(file, "utf8");
  for (const page of config.pages) {
    const urls = [`${domain}/${page.route}`, `${domain}/${page.route}.html`];
    for (const url of urls) {
      const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      xml = xml.replace(new RegExp(`\\s*<url>\\s*<loc>${escaped}<\\/loc>[\\s\\S]*?<\\/url>`, "g"), "");
    }
    const lastmod = String(cache.leagues[page.league].updatedAt).slice(0, 10);
    xml = xml.replace("</urlset>", `  <url>\n    <loc>${domain}/${page.route}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>hourly</changefreq>\n    <priority>0.9</priority>\n  </url>\n</urlset>`);
  }
  fs.writeFileSync(file, xml, "utf8");
}

upsertSitemap(path.join(root, "sitemap.xml"));
upsertSitemap(path.join(root, "public", "sitemap.xml"));

function homeModule() {
  const rows = cache.leagues["super-lig"].rows.slice(0, 5);
  return `<!-- standings-seo-home:start -->
        <section class="container section home-standings-seo" aria-labelledby="home-standings-title">
          <div class="section-head"><div class="section-title"><span class="section-kicker">Güncel lig tablosu</span><h2 id="home-standings-title">Süper Lig puan durumu</h2><p>${escapeHtml(rows[0].team)}, ${rows[0].points} puanla lider.</p></div><a class="section-link" href="./super-lig-puan-durumu">Süper Lig Puan Durumu</a></div>
          <ol class="home-standings-list">${rows.map((row) => `<li><span>${row.rank}</span><strong>${escapeHtml(row.team)}</strong><small>${row.played} maç</small><b>${row.points} puan</b></li>`).join("")}</ol>
        </section>
        <!-- standings-seo-home:end -->`;
}

function injectHomepage(file) {
  let html = fs.readFileSync(file, "utf8");
  if (!html.includes('href="./standings.css"')) {
    html = html.replace("</head>", '    <link rel="stylesheet" href="./standings.css" />\n  </head>');
  }
  const module = homeModule();
  const marker = /<!-- standings-seo-home:start -->[\s\S]*?<!-- standings-seo-home:end -->/;
  if (marker.test(html)) html = html.replace(marker, module);
  else html = html.replace('<section class="container section home-statistics-entry"', `${module}\n        <section class="container section home-statistics-entry"`);
  fs.writeFileSync(file, html, "utf8");
}

injectHomepage(path.join(root, "index.html"));
injectHomepage(path.join(root, "public", "index.html"));

console.log(`Generated ${config.pages.length} permanent standings pages from ${leagueIds.length} shared league datasets.`);
