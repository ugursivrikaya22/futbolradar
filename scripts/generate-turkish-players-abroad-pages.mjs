#!/usr/bin/env node
/**
 * AVRUPA'DAKİ TÜRK FUTBOLCULAR (`/avrupadaki-turk-futbolcular`, `/futbolcu/<slug>`).
 *
 * Liste `data/turkish-players-abroad.json`dan gelir: elle derlenir, her
 * kaydın doğrulanmış bir kaynağı vardır. İstatistikler yalnızca depodaki
 * `data/player-match-history.json` satırlarından, sağlayıcı oyuncu kimliği
 * eşleşen kayıtlardan türetilir; kayıt yoksa istatistik bloğu basılmaz ve
 * ince içerik dizine girmesin diye sayfa `noindex,follow` kalır.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { siteFooter, siteHeader } from "./lib/layout.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";
import { ROBOTS_INDEX, ROBOTS_NOINDEX_FOLLOW } from "./lib/robots.mjs";
import { createFreshnessTracker } from "./lib/sitemapFreshness.mjs";
import { escapeHtml } from "./lib/player360.mjs";

const root = process.env.TURKISH_ABROAD_ROOT
  ? path.resolve(process.env.TURKISH_ABROAD_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteUrl = "https://www.futbolradar.com";
const HUB_SLUG = "avrupadaki-turk-futbolcular";
const HUB_URL = `${siteUrl}/${HUB_SLUG}`;
const SEASON_START = "2026-07-01";
const RECENT_LIMIT = 8;
const NATIONAL_TEAM = "Türkiye";
const POSITION_ORDER = ["Kaleci", "Defans", "Orta saha", "Forvet"];
const COMPETITION_LABELS = {
  "UEFA Champions League": "Şampiyonlar Ligi",
  "UEFA Europa League": "Avrupa Ligi",
  "UEFA Europa Conference League": "Konferans Ligi"
};
const MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

function readJson(relative, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
  } catch {
    return fallback;
  }
}

function dateLabel(iso) {
  const [year, month, day] = String(iso).split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

function takenSlugs() {
  const registry = readJson("data/player-url-slugs.json", {});
  const taken = new Set();
  const collect = (value) => {
    if (typeof value === "string") taken.add(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") {
      for (const key of ["slug", "canonicalSlug"]) if (typeof value[key] === "string") taken.add(value[key]);
      for (const key of ["aliases", "slugs", "players", "entries"]) if (value[key]) collect(value[key]);
    }
  };
  collect(registry);
  return taken;
}

export function playerRows(player, rows) {
  if (!player.providerPlayerId) return [];
  const seen = new Set();
  return rows
    .filter((row) => String(row.providerPlayerId) === String(player.providerPlayerId) && String(row.date) >= SEASON_START)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .filter((row) => {
      const key = `${row.matchId}|${row.team}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function sumIfComplete(rows, field) {
  if (!rows.length || rows.some((row) => !Number.isFinite(row[field]))) return null;
  return rows.reduce((total, row) => total + row[field], 0);
}

export function playerStats(rows) {
  if (!rows.length) return null;
  return {
    matches: rows.length,
    starts: rows.filter((row) => row.started === true).length,
    minutes: rows.reduce((total, row) => total + (Number.isFinite(row.minutes) ? row.minutes : 0), 0),
    goals: sumIfComplete(rows, "goals"),
    assists: sumIfComplete(rows, "assists"),
    clubMatches: rows.filter((row) => row.team !== NATIONAL_TEAM).length,
    nationalMatches: rows.filter((row) => row.team === NATIONAL_TEAM).length,
    latest: rows[0].date
  };
}

function statCell(label, value) {
  return `<div class="p360-stat"><span>${escapeHtml(label)}</span><b>${escapeHtml(String(value))}</b></div>`;
}

function statsSection(player, stats) {
  const cells = [
    statCell("Maç", stats.matches),
    statCell("İlk 11", stats.starts),
    statCell("Dakika", stats.minutes)
  ];
  if (stats.goals !== null) cells.push(statCell("Gol", stats.goals));
  if (stats.assists !== null) cells.push(statCell("Asist", stats.assists));
  return `<section class="p360" aria-labelledby="p360-season-title" data-p360-section="season">
        <div class="p360-head"><h2 id="p360-season-title">${escapeHtml(player.name)} 2026/27 Maç Kayıtları</h2></div>
        <div class="p360-stat-grid">${cells.join("")}</div>
        <p class="p360-source">FutbolRadar maç kayıtlarındaki ${stats.clubMatches} kulüp ve ${stats.nationalMatches} millî maçın toplamı; sezonun tamamını kapsamayabilir. Son kayıt: ${escapeHtml(dateLabel(stats.latest))}.</p>
      </section>`;
}

function valueCell(row, field) {
  return Number.isFinite(row[field]) ? String(row[field]) : "–";
}

function matchesSection(player, rows) {
  const body = rows.slice(0, RECENT_LIMIT).map((row) => `<tr>
              <th scope="row">${escapeHtml(dateLabel(row.date))}</th>
              <td>${escapeHtml(row.team)}</td>
              <td>${escapeHtml(COMPETITION_LABELS[row.competition] || row.competition || "")}</td>
              <td>${row.home ? "" : "@"}${escapeHtml(row.opponent)}</td>
              <td>${row.started ? "İlk 11" : "Yedek"}</td>
              <td>${Number.isFinite(row.minutes) ? `${row.minutes}'` : "–"}</td>
              <td>${valueCell(row, "goals")}</td>
              <td>${valueCell(row, "assists")}</td>
            </tr>`).join("\n            ");
  return `<section class="p360" aria-labelledby="p360-matches-title" data-p360-section="matches">
        <div class="p360-head"><h2 id="p360-matches-title">${escapeHtml(player.name)} Son Maçları</h2></div>
        <div class="p360-table-wrap">
          <table class="p360-table">
            <caption>Satırlar FutbolRadar maç kayıtlarından alınmıştır; kaydı olmayan değer "–" ile gösterilir.</caption>
            <thead><tr><th scope="col">Tarih</th><th scope="col">Takım</th><th scope="col">Turnuva</th><th scope="col">Rakip</th><th scope="col">Rol</th><th scope="col">Dakika</th><th scope="col">Gol</th><th scope="col">Asist</th></tr></thead>
            <tbody>${body}</tbody>
          </table>
        </div>
      </section>`;
}

function sourceList(player) {
  const sources = [player.source, player.secondarySource].filter(Boolean);
  return sources
    .map((source) => `<a href="${escapeHtml(source.url)}" rel="nofollow noopener noreferrer" target="_blank">${escapeHtml(source.label)}</a>`)
    .join(" · ");
}

function breadcrumbHtml(items) {
  const parts = items.map((item, index) =>
    index === items.length - 1
      ? `<span>${escapeHtml(item.name)}</span>`
      : `<a href="${escapeHtml(item.href)}">${escapeHtml(item.name)}</a>`);
  return `<nav class="breadcrumb" aria-label="Sayfa yolu">${parts.join(" <span>/</span> ")}</nav>`;
}

function documentHtml({ base, title, description, canonical, indexable, ogType, graph, main }) {
  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${canonical}" />
    <meta name="robots" content="${indexable ? ROBOTS_INDEX : ROBOTS_NOINDEX_FOLLOW}" />
    <meta property="og:type" content="${ogType}" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${siteUrl}/assets/og-image.png" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${siteUrl}/assets/og-image.png" />
    <script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replaceAll("<", "\\u003c")}</script>
    <link rel="stylesheet" href="${base}page.css" />
  </head>
  <body class="subpage">
    ${siteHeader({ base, locale: "tr" })}
    <main class="container">
      ${main}
    </main>
    ${siteFooter({ base, locale: "tr" })}
    <script src="${base}site.js" defer></script>
  </body>
</html>
`;
}

function breadcrumbGraph(items) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({ "@type": "ListItem", position: index + 1, name: item.name, item: item.url }))
  };
}

function playerDescription(player, stats) {
  const role = `${player.club} kadrosunda ${player.position.toLocaleLowerCase("tr-TR")} oynayan Türk futbolcu`;
  if (!stats) return `${player.name}, ${role}. Kulüp, mevki ve doğrulanmış kaynak bilgisi FutbolRadar'da.`;
  const parts = [`${stats.matches} maç`, `${stats.minutes} dakika`];
  if (stats.goals !== null) parts.push(`${stats.goals} gol`);
  if (stats.assists !== null) parts.push(`${stats.assists} asist`);
  return `${player.name}, ${role}. 2026/27 maç kayıtları: ${parts.join(", ")}; son maçları FutbolRadar'da.`;
}

export function playerPage(player, rows) {
  const stats = playerStats(rows);
  const canonical = `${siteUrl}/futbolcu/${player.slug}`;
  const title = stats
    ? `${player.name} (${player.club}) İstatistikleri ve Son Maçları | FutbolRadar`
    : `${player.name} (${player.club}) Profili | FutbolRadar`;
  const description = playerDescription(player, stats);
  const crumbs = [
    { name: "Ana Sayfa", href: "../index.html", url: `${siteUrl}/` },
    { name: "Avrupa'daki Türk Futbolcular", href: `../${HUB_SLUG}`, url: HUB_URL },
    { name: player.name, href: `./${player.slug}`, url: canonical }
  ];
  const graph = [
    {
      "@type": "Person",
      name: player.name,
      url: canonical,
      description,
      nationality: "Türkiye",
      jobTitle: player.position,
      memberOf: { "@type": "SportsTeam", name: player.club, sport: "Football" }
    },
    breadcrumbGraph(crumbs)
  ];
  const main = `${breadcrumbHtml(crumbs)}
      <section class="hero">
        <div class="hero-row">
          <div>
            <span class="eyebrow">Avrupa'daki Türk futbolcular · ${escapeHtml(player.club)}</span>
            <h1>${escapeHtml(player.name)}</h1>
            <p class="lead">${escapeHtml(description)}</p>
          </div>
          <span class="hero-meta">${escapeHtml(player.position)} · ${escapeHtml(player.club)}</span>
        </div>
      </section>
      <section class="p360 p360-identity" aria-labelledby="p360-identity-title" data-p360-section="identity">
        <div class="p360-head"><h2 id="p360-identity-title">Oyuncu Kimlik Kartı</h2></div>
        <dl class="p360-id-grid"><div class="p360-id-row"><dt>Kulüp</dt><dd>${escapeHtml(player.club)}</dd></div><div class="p360-id-row"><dt>Mevki</dt><dd>${escapeHtml(player.position)}</dd></div><div class="p360-id-row"><dt>Ülke</dt><dd>Türkiye</dd></div></dl>
        <p class="p360-source">Kaynak: ${sourceList(player)} (doğrulama: ${escapeHtml(dateLabel(player.verifiedAt))})</p>
      </section>
      ${stats ? `${statsSection(player, stats)}\n      ${matchesSection(player, rows)}` : `<p class="p360-empty" data-card="empty-state">Bu oyuncu için FutbolRadar maç kayıtlarında 2026/27 satırı bulunmuyor; istatistik gösterilmiyor.</p>`}
      <p><a class="detail-link" href="../${HUB_SLUG}">Avrupa'daki tüm Türk futbolcular</a> · <a class="detail-link" href="../milli-takim.html">A Millî Takım</a></p>`;
  return {
    html: documentHtml({ base: "../", title, description, canonical, indexable: Boolean(stats), ogType: "profile", graph, main }),
    indexable: Boolean(stats),
    canonical,
    stats
  };
}

export function hubPage(entries) {
  const title = "Avrupa'daki Türk Futbolcular 2026/27: Kulüpler, Mevkiler ve Maç Kayıtları | FutbolRadar";
  const description = `Avrupa kulüplerinde oynayan ${entries.length} Türk futbolcu: kulüp, mevki, doğrulanmış kaynak ve FutbolRadar maç kayıtlarından 2026/27 maç ve dakika bilgisi.`;
  const crumbs = [
    { name: "Ana Sayfa", href: "index.html", url: `${siteUrl}/` },
    { name: "Avrupa'daki Türk Futbolcular", href: HUB_SLUG, url: HUB_URL }
  ];
  const groups = POSITION_ORDER.map((position) => {
    const list = entries.filter((entry) => entry.player.position === position);
    if (!list.length) return "";
    const rows = list.map(({ player, stats }) => `<tr>
              <th scope="row"><a href="futbolcu/${player.slug}">${escapeHtml(player.name)}</a></th>
              <td>${escapeHtml(player.club)}</td>
              <td>${stats ? stats.matches : "–"}</td>
              <td>${stats ? stats.minutes : "–"}</td>
            </tr>`).join("\n            ");
    return `<section class="p360" aria-labelledby="abroad-${position.replace(/\s+/g, "-").toLowerCase()}">
        <div class="p360-head"><h2 id="abroad-${position.replace(/\s+/g, "-").toLowerCase()}">${escapeHtml(position)}</h2></div>
        <div class="p360-table-wrap">
          <table class="p360-table">
            <thead><tr><th scope="col">Oyuncu</th><th scope="col">Kulüp</th><th scope="col">Maç</th><th scope="col">Dakika</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </section>`;
  }).filter(Boolean).join("\n      ");
  const graph = [
    {
      "@type": "CollectionPage",
      "@id": `${HUB_URL}#page`,
      url: HUB_URL,
      name: title,
      description,
      inLanguage: "tr"
    },
    {
      "@type": "ItemList",
      name: "Avrupa'daki Türk futbolcular",
      numberOfItems: entries.length,
      itemListElement: entries.map(({ player }, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: player.name,
        url: `${siteUrl}/futbolcu/${player.slug}`
      }))
    },
    breadcrumbGraph(crumbs)
  ];
  const sources = [...new Map(entries.flatMap(({ player }) => [player.source, player.secondarySource].filter(Boolean)).map((source) => [source.url, source])).values()];
  const main = `${breadcrumbHtml(crumbs)}
      <section class="hero">
        <div class="hero-row">
          <div>
            <span class="eyebrow">2026/27 sezonu</span>
            <h1>Avrupa'daki Türk Futbolcular</h1>
            <p class="lead">${escapeHtml(description)}</p>
          </div>
        </div>
      </section>
      ${groups}
      <section class="p360" aria-labelledby="abroad-sources">
        <div class="p360-head"><h2 id="abroad-sources">Kaynaklar</h2></div>
        <p class="p360-source">Liste yalnızca doğrulanmış kaynaklardan derlenir: ${sources.map((source) => `<a href="${escapeHtml(source.url)}" rel="nofollow noopener noreferrer" target="_blank">${escapeHtml(source.label)}</a>`).join(" · ")}. Maç ve dakika sütunları FutbolRadar maç kayıtlarından gelir; kaydı olmayan oyuncuda "–" görünür.</p>
      </section>
      <p><a class="detail-link" href="milli-takim.html">A Millî Takım</a></p>`;
  return documentHtml({ base: "", title, description, canonical: HUB_URL, indexable: true, ogType: "website", graph, main });
}

function writeBoth(relative, html) {
  for (const outputRoot of [root, path.join(root, "public")]) {
    const destination = path.join(outputRoot, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, html, "utf8");
  }
}

function sitemapEntry(loc, lastmod, priority) {
  return `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
}

function updateSitemap(file, ownLocs, fresh) {
  if (!fs.existsSync(file)) return;
  const xml = fs.readFileSync(file, "utf8");
  const existing = (xml.match(URL_ENTRY_RE) || [])
    .filter((entry) => ![...ownLocs].some((loc) => entry.includes(`<loc>${loc}</loc>`)));
  fs.writeFileSync(file, wrapUrlset([...existing, ...fresh]), "utf8");
}

export function run() {
  const data = readJson("data/turkish-players-abroad.json", { players: [] });
  const history = readJson("data/player-match-history.json", { rows: [] });
  const historyRows = Array.isArray(history.rows) ? history.rows : [];
  const taken = takenSlugs();
  const tracker = createFreshnessTracker(root);
  const entries = [];
  const ownLocs = new Set([HUB_URL]);
  const fresh = [];

  for (const player of data.players || []) {
    if (!player.slug || !player.source?.url) continue;
    ownLocs.add(`${siteUrl}/futbolcu/${player.slug}`);
    if (taken.has(player.slug)) {
      console.warn(`[turkish-players-abroad] ${player.slug} Süper Lig oyuncu adresiyle çakışıyor; atlandı.`);
      continue;
    }
    const rows = playerRows(player, historyRows);
    const page = playerPage(player, rows);
    writeBoth(path.join("futbolcu", `${player.slug}.html`), page.html);
    entries.push({ player, stats: page.stats });
    if (page.indexable) {
      fresh.push(sitemapEntry(page.canonical, tracker.lastmodFor(`futbolcu/${player.slug}.html`, page.html), "0.6"));
    }
  }

  const hub = hubPage(entries);
  writeBoth(`${HUB_SLUG}.html`, hub);
  fresh.unshift(sitemapEntry(HUB_URL, tracker.lastmodFor(`${HUB_SLUG}.html`, hub), "0.7"));
  tracker.save();

  for (const file of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) {
    updateSitemap(file, ownLocs, fresh);
  }

  const indexed = entries.filter((entry) => entry.stats).length;
  console.log(`[turkish-players-abroad] ${entries.length} oyuncu sayfası (${indexed} dizinde, ${entries.length - indexed} noindex) + liste sayfası.`);
  return { entries, indexed };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
