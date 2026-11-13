#!/usr/bin/env node
/** Six permanent Turkish statistics hubs, rendered from existing provider snapshots.
 * Runs before shared-layout on both full and scheduled builds; no API requests.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { siteHeader, siteFooter } from "./lib/layout.mjs";
import { RICH_TEAM_PAGES } from "./lib/richTeamPages.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";
import { ROBOTS_INDEX, ROBOTS_NOINDEX_FOLLOW } from "./lib/robots.mjs";
import {
  STAT_LEAGUES,
  escapeHtml as h,
  seasonLabel,
  availableSeasons,
  statisticsFor,
} from "./lib/leagueStatistics.mjs";
const require = createRequire(import.meta.url);
const { createPlayerUrlResolver } = require("../services/playerUrl.js");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const site = "https://www.futbolradar.com";
const read = (file, fallback = {}) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  } catch {
    return fallback;
  }
};
const leaders = read("data/competition-leaders.json"),
  standings = read("data/league-standings.json"),
  players = read("data/players.json", []);
const urls = createPlayerUrlResolver(
  read("data/player-url-slugs.json", { entries: [], aliases: [] }),
);
const value = (v) => (v === null || v === undefined || v === "" ? "—" : h(v));
const date = (v) =>
  v && Number.isFinite(Date.parse(v))
    ? new Intl.DateTimeFormat("tr-TR", {
        dateStyle: "long",
        timeStyle: "short",
        timeZone: "Europe/Istanbul",
      }).format(new Date(v)) + " TSİ"
    : "Tarih bildirilmedi";
const attribution = (timestamp, endpoint) =>
  `<p class="evergreen-freshness">Veri: <a href="https://www.api-football.com/documentation-v3" rel="nofollow noopener noreferrer">API-Football</a> · ${h(endpoint)} · Kayıt: ${h(date(timestamp))}. Anlık değildir.</p>`;
const css = `.league-stats{padding-bottom:2rem}.league-stats *{box-sizing:border-box}.league-stats h1{font-size:clamp(1.5rem,5vw,2.5rem)}.league-stats h1,.league-stats h2,.league-stats a,.league-stats p{overflow-wrap:anywhere}.league-stats .container{min-width:0;max-width:1100px}.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:12px}.stats-box{min-width:0;border:1px solid var(--border,#384456);border-radius:12px;padding:12px;margin:12px 0}.stats-scroll{max-width:100%;overflow-x:auto}.stats-table{width:100%;border-collapse:collapse;font-size:.83rem}.stats-table th,.stats-table td{padding:7px 4px;text-align:left;border-bottom:1px solid var(--border,#384456);white-space:normal;overflow-wrap:anywhere}.stats-table th:first-child{width:30px}.stats-table a{color:inherit}.stats-links{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.stats-links a{padding:8px;border:1px solid var(--border,#384456);border-radius:8px}.stats-profile summary{cursor:pointer;min-height:44px}.stats-profile dl{display:grid;grid-template-columns:1fr 1fr;gap:6px}.stats-profile dd{margin:0;text-align:right}.stats-selects{display:grid;grid-template-columns:1fr 1fr;gap:10px}.stats-selects label{min-width:0}.stats-selects select{display:block;max-width:100%;width:100%;font:inherit;padding:9px;color:inherit;background:var(--bg,#101821)}.stats-compare td,.stats-compare th{width:33.33%}@media(max-width:480px){.stats-selects{grid-template-columns:1fr}.stats-table{font-size:.75rem}.stats-box{padding:8px}.stats-table td,.stats-table th{padding:6px 3px}}`;
function existingProfile(row) {
  const local = players.find(
    (p) => String(p.providerId) === String(row.providerId),
  );
  if (!local) return "";
  const href = urls.playerHref(local, "/");
  const file = path.join(
    root,
    href.replace(/^\//, "").replace(/\.html$/, "") + ".html",
  );
  return fs.existsSync(file)
    ? `<p><a href="${h(href)}">Mevcut oyuncu profili: ${h(local.name)}</a></p>`
    : "";
}
function leaderTable(entry, metric, title, id, canonical, graphs) {
  const rows = entry.rows;
  if (!rows.length)
    return `<section class="stats-box" id="${id}"><h2>${title}</h2><p>Güncelleniyor: bu lig ve sezon için doğrulanmış liste yok.</p></section>`;
  graphs.push({
    "@type": "ItemList",
    "@id": `${canonical}#${id}`,
    name: title,
    numberOfItems: rows.length,
    itemListElement: rows.map((r, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: r.name,
      url: `${canonical}#oyuncu-${r.providerId}`,
    })),
  });
  return `<section class="stats-box" id="${id}"><h2>${title}</h2>${attribution(entry.updatedAt, metric === "goals" ? "/players/topscorers" : "/players/topassists")}<p>Sağlayıcının ilk ${rows.length} kaydı; tam oyuncu havuzu değildir. Eşit değerler aynı performansı ifade eder.</p><table class="stats-table"><caption>${title}</caption><thead><tr><th>Sıra</th><th>Oyuncu / takım</th><th>${metric === "goals" ? "Gol" : "Asist"}</th><th>Maç</th><th>Dk.</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${r.rank}</td><th scope="row"><a href="#oyuncu-${r.providerId}">${h(r.name)}</a><br><small>${h(r.team)}</small></th><td>${value(r[metric])}</td><td>${value(r.appearances)}</td><td>${value(r.minutes)}</td></tr>`).join("")}</tbody></table></section>`;
}
function comparison(data) {
  if (data.teams.length < 2)
    return `<section class="stats-box" id="takim-karsilastirma"><h2>Takım karşılaştırmaları</h2><p>Güncelleniyor: aynı sezondan iki takım kaydı bekleniyor.</p></section>`;
  const options = data.teams
    .map((t, i) => `<option value="${i}">${h(t.name || t.team)}</option>`)
    .join("");
  const metrics = [
    ["played", "Oynanan maç"],
    ["won", "Galibiyet"],
    ["drawn", "Beraberlik"],
    ["lost", "Mağlubiyet"],
    ["goalsFor", "Atılan gol"],
    ["goalsAgainst", "Yenilen gol"],
    ["goalDifference", "Averaj"],
    ["points", "Puan"],
  ];
  return `<section class="stats-box" id="takim-karsilastirma"><h2>Takım karşılaştırmaları</h2>${attribution(data.standingsUpdatedAt, "/standings")}<p>Aynı sezonun lig tablosu karşılaştırılır; bu bir ikili rekabet veya tahmin modeli değildir.</p><div class="stats-selects"><label>Birinci takım<select id="stats-team-a">${options}</select></label><label>İkinci takım<select id="stats-team-b">${options.replace('value="1"', 'value="1" selected')}</select></label></div><table class="stats-table stats-compare"><caption>Sezonluk takım verileri</caption><thead><tr><th>Ölçüt</th><th id="stats-name-a">${h(data.teams[0].name)}</th><th id="stats-name-b">${h(data.teams[1].name)}</th></tr></thead><tbody>${metrics.map(([key, label]) => `<tr><th scope="row">${label}</th><td data-side="a" data-metric="${key}">${value(data.teams[0][key])}</td><td data-side="b" data-metric="${key}">${value(data.teams[1][key])}</td></tr>`).join("")}</tbody></table><noscript>JavaScript kapalı: ilk iki takımın karşılaştırması gösteriliyor.</noscript></section><script>(()=>{const teams=${JSON.stringify(data.teams.map((t) => Object.fromEntries(["name", "team", ...metrics.map((m) => m[0])].map((k) => [k, t[k] ?? null])))).replaceAll("<", "\\u003c")};for(const side of ['a','b']){const select=document.getElementById('stats-team-'+side);select.addEventListener('change',()=>{const t=teams[Number(select.value)];document.getElementById('stats-name-'+side).textContent=t.name||t.team;document.querySelectorAll('[data-side="'+side+'"]').forEach(c=>c.textContent=t[c.dataset.metric]??'—');});}})();</script>`;
}
function document(league, season, seasons, data, url) {
  const canonical = site + url,
    label = seasonLabel(season),
    title = `${league.name} İstatistikleri ${label} | Gol ve Asist Krallığı`,
    description = `${league.name} ${label} sezonu gol ve asist kralları, oyuncu performans profilleri ve takım karşılaştırmaları. API-Football kaynaklı sezon istatistikleri.`;
  const graphs = [
    {
      "@type": "CollectionPage",
      url: canonical,
      name: title,
      inLanguage: "tr-TR",
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        ["Ana sayfa", site + "/"],
        ["İstatistik Merkezi", site + "/istatistik-merkezi.html"],
        [`${league.name} istatistikleri`, canonical],
      ].map(([name, item], i) => ({
        "@type": "ListItem",
        position: i + 1,
        name,
        item,
      })),
    },
  ];
  const tables =
    leaderTable(
      data.scorers,
      "goals",
      "Gol krallığı",
      "gol-kralligi",
      canonical,
      graphs,
    ) +
    leaderTable(
      data.assists,
      "assists",
      "Asist krallığı",
      "asist-kralligi",
      canonical,
      graphs,
    );
  const profiles = data.profiles
    .map(
      (r) =>
        `<details class="stats-box stats-profile" id="oyuncu-${r.providerId}"><summary>${h(r.name)} — ${h(r.team)}</summary><p>${h(league.name)} ${label} oyuncu performans profili. Yalnızca bu yarışmadaki sağlayıcı kaydıdır; diğer liglerin rakamları birleştirilmez.</p><dl>${[
          ["Takım", r.team],
          ["Maç", r.appearances],
          ["Dakika", r.minutes],
          ["Gol", r.goals],
          ["Asist", r.assists],
        ]
          .map(([k, v]) => `<dt>${k}</dt><dd>${value(v)}</dd>`)
          .join("")}</dl>${existingProfile(r)}</details>`,
    )
    .join("");
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h(title)}</title><meta name="description" content="${h(description)}"><meta name="robots" content="${data.indexable ? ROBOTS_INDEX : ROBOTS_NOINDEX_FOLLOW}"><link rel="canonical" href="${canonical}"><meta property="og:title" content="${h(title)}"><meta property="og:description" content="${h(description)}"><meta property="og:url" content="${canonical}"><meta property="og:type" content="website"><link rel="stylesheet" href="/page.css"><link rel="icon" href="/favicon.svg"><style>${css}</style><script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graphs }).replaceAll("<", "\\u003c")}</script></head><body><div class="site-shell">${siteHeader({ base: "/", altHref: "en/" })}<main class="evergreen-page league-stats"><div class="container"><nav aria-label="İçerik yolu"><a href="/istatistik-merkezi.html">İstatistik Merkezi</a> / ${h(league.name)}</nav><header class="evergreen-hero"><h1>${h(league.name)} istatistikleri — ${label}</h1><p>${h(description)}</p><p>Bu sayfa kayıtlı verinin tarihli görünümüdür; canlı veya tam sezon sonucu olduğu iddia edilmez. Sakatlık ve ceza tek başına oyuncuyu listeden çıkarmaz; ayrıldığı veya serbest kaldığı kayıtlı oyuncular gösterilmez.</p></header><nav class="stats-links" aria-label="Lig istatistikleri">${STAT_LEAGUES.map((l) => `<a href="${l.url}"${l.id === league.id ? ' aria-current="page"' : ""}>${h(l.name)}</a>`).join("")}</nav><section class="stats-box" id="sezon"><h2>Sezon bazlı istatistikler</h2><p>Gösterilen sezon: ${label}. Yalnızca kayıtlı sezonlar sunulur; arşiv verisi olmadan eski sezon oluşturulmaz.</p><div class="stats-links">${seasons.map((s, i) => `<a href="${i === 0 ? league.url : `/istatistik/${league.id}/${s}-${s + 1}`}"${s === season ? ' aria-current="page"' : ""}>${seasonLabel(s)}</a>`).join("")}</div><a href="/${league.slug}-puan-durumu">${h(league.name)} güncel puan durumu</a></section><div class="stats-grid">${tables}</div><section class="stats-box" id="xg"><h2>xG verileri</h2><p>Güncelleniyor. Kayıtlı API-Football oyuncu verisinde bu lig ve sezon için doğrulanmış xG alanı bulunmuyor. Plan kapsamı doğrulanmadan oyuncu xG sıralaması yayımlanmaz; gol, şut veya maç xG'sinden oyuncu xG'si tahmin edilmez.</p></section>${comparison(data)}<section id="oyuncu-profilleri"><h2>Oyuncu performans profilleri</h2><p>Gol ve asist listelerindeki oyuncuların aynı lig ve sezon için kısa profilleri; yaş, mevki ve biyografi doğrulanmadığında eklenmez.</p>${attribution(data.scorers.updatedAt || data.assists.updatedAt, "/players/topscorers · /players/topassists")}<div class="stats-grid">${profiles || "<p>Güncelleniyor: doğrulanmış oyuncu kaydı yok.</p>"}</div></section><section class="stats-box"><h2>Veri kaynakları ve kapsam</h2><p>Veri: <a href="https://www.api-football.com/" rel="nofollow noopener noreferrer">API-Football</a>. Lig kimliği: ${league.leagueId}; sezon başlangıç yılı: ${season}. Gol ve asist tabloları /players/topscorers ve /players/topassists; takım karşılaştırması /standings. Yerel, tarihli sağlayıcı kayıtları kullanılır. Eksik değerler “—” ile gösterilir, sıfırla doldurulmaz. Kayıtlı transfer durumları uygunluk filtresinde kullanılır. Şampiyonlar Ligi verileri yalnızca o yarışmaya aittir.</p></section></div></main>${siteFooter({ base: "/" })}</div><script src="/site.js" defer></script></body></html>\n`;
}
const outputs = [];
for (const league of STAT_LEAGUES) {
  const seasons = availableSeasons(league, leaders, standings);
  // No empty current-season claim if even the season cannot be verified.
  const available = seasons.length
    ? seasons
    : [new Date().getUTCFullYear() - (new Date().getUTCMonth() < 6 ? 1 : 0)];
  for (const [i, season] of available.entries()) {
    const url =
      i === 0 ? league.url : `/istatistik/${league.id}/${season}-${season + 1}`;
    const data = statisticsFor(league, season, leaders, standings, players);
    const html = document(league, season, seasons, data, url);
    for (const base of [root, path.join(root, "public")]) {
      const f = path.join(base, url + ".html");
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, html);
    }
    const dates = [
      data.scorers.updatedAt,
      data.assists.updatedAt,
      data.standingsUpdatedAt,
    ]
      .filter((v) => v && Number.isFinite(Date.parse(v)))
      .sort();
    outputs.push({
      url,
      indexable: data.indexable,
      lastmod: dates.at(-1)?.slice(0, 10),
    });
    console.log(
      `${url}: ${data.scorers.rows.length} gol, ${data.assists.rows.length} asist, ${data.teams.length} takım; ${data.indexable ? "index" : "noindex"}`,
    );
  }
}
// Idempotent contextual links: source generators remain owners of their pages.
const marker =
  /<!-- league-statistics:start -->[\s\S]*?<!-- league-statistics:end -->/g;
const allLinks = STAT_LEAGUES.map(
  (l) => `<a href="${l.url}">${h(l.name)} istatistikleri</a>`,
).join(" · ");
function integrate(file, links) {
  for (const base of [root, path.join(root, "public")]) {
    const f = path.join(base, file);
    if (!fs.existsSync(f)) continue;
    const before = fs.readFileSync(f, "utf8");
    const block = `<!-- league-statistics:start --><aside class="evergreen-related"><h2>Avrupa ligleri istatistikleri</h2><div class="evergreen-link-grid">${links}</div></aside><!-- league-statistics:end -->`;
    const clean = before.replace(marker, "");
    const next = clean.replace("</main>", `${block}</main>`);
    if (next !== before) fs.writeFileSync(f, next);
  }
}
integrate("istatistik-merkezi.html", allLinks);
// Existing team URLs, including rich team pages, are reused; no duplicate teams.
// Stuttgart has its own existing generator, outside the rich-team registry.
const existingTeamFiles = new Map([
  ...Object.entries(RICH_TEAM_PAGES).map(([id, entry]) => [id, entry.file]),
  ["172", "takimlar/stuttgart.html"],
]);
const teamFiles = fs.existsSync(path.join(root, "takimlar"))
  ? fs
      .readdirSync(path.join(root, "takimlar"))
      .filter((n) => n.endsWith(".html"))
  : [];
for (const league of STAT_LEAGUES) {
  const link = `<a href="${league.url}">${h(league.name)} gol krallığı, asistler ve takım karşılaştırmaları</a>`;
  integrate(`${league.slug}-puan-durumu.html`, link);
  integrate(`lig/${league.id}.html`, link);
}
// Match a team's numeric API-Football id (not ambiguous display names).
for (const file of teamFiles) {
  const content = fs.readFileSync(path.join(root, "takimlar", file), "utf8");
  const leagues = STAT_LEAGUES.filter((l) =>
    (standings[l.id]?.table || []).some(
      (t) =>
        /^\d+$/.test(String(t.providerId || t.id)) &&
        (existingTeamFiles.get(String(t.providerId || t.id)) ===
          `takimlar/${file}` ||
          content.includes(
            `https://media.api-sports.io/football/teams/${t.providerId || t.id}.png`,
          )),
    ),
  );
  if (leagues.length)
    integrate(
      `takimlar/${file}`,
      leagues
        .map((l) => `<a href="${l.url}">${h(l.name)} istatistikleri</a>`)
        .join(" · "),
    );
}
for (const base of [root, path.join(root, "public")]) {
  const file = path.join(base, "sitemap.xml");
  if (!fs.existsSync(file)) continue;
  const existing = (
    fs.readFileSync(file, "utf8").match(URL_ENTRY_RE) || []
  ).filter(
    (e) =>
      !STAT_LEAGUES.some(
        (l) =>
          e.includes(`<loc>${site}${l.url}</loc>`) ||
          e.includes(`<loc>${site}/istatistik/${l.id}/`),
      ),
  );
  const additions = outputs
    .filter((o) => o.indexable)
    .map(
      (o) =>
        // Ortak site haritası biçimi (girintili, çok satırlı). Tek satırlık
        // girdi `URL_ENTRY_RE` ile eşleşmez: bu adımdan sonra haritayı
        // yeniden yazan her üretici bu altı adresi sessizce düşürürdü.
        `  <url>\n    <loc>${site}${o.url}</loc>${o.lastmod ? `\n    <lastmod>${o.lastmod}</lastmod>` : ""}\n  </url>`,
    );
  fs.writeFileSync(file, wrapUrlset([...existing, ...additions]));
}
