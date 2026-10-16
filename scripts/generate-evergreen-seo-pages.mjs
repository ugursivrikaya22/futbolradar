import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { siteFooter, siteHeader } from "./lib/layout.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";
import { createRequire } from "node:module";
import { ROBOTS_INDEX, ROBOTS_NOINDEX_FOLLOW } from "./lib/robots.mjs";

const require = createRequire(import.meta.url);
const { playerLink } = require("../services/playerLinks.js");
const { superLigTeamPages, teamHubIndexable, standingsPageIndexable } = require("../services/superLigTeamPages.js");
const { sameClub } = require("../services/superLigTeams.js");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteUrl = "https://www.futbolradar.com";
const socialImage = `${siteUrl}/assets/og-image.png`;
const teams = JSON.parse(fs.readFileSync(path.join(root, "data", "teams.json"), "utf8"));
const players = JSON.parse(fs.readFileSync(path.join(root, "data", "players.json"), "utf8"));

const featuredTeams = [
  { slug: "galatasaray", name: "Galatasaray" },
  { slug: "fenerbahce", name: "Fenerbahçe" },
  { slug: "besiktas", name: "Beşiktaş" },
  { slug: "trabzonspor", name: "Trabzonspor" }
];

const teamBySlug = new Map(teams.map((team) => [team.id, team]));
// Görev 6: takım profili (hub) sayfaları 18 Süper Lig takımının hepsi için.
// Karşılaştırma sayfaları bilerek büyük 4'te kalıyor (153 çift ince içerik olurdu).
const hubTeams = superLigTeamPages({ root, teams }).map((entry) => {
  const squadCount = players.filter((player) => sameClub(player.currentTeam, entry.record.name)).length;
  return { slug: entry.slug, name: entry.name, record: entry.record, squadCount, indexable: teamHubIndexable(entry.record, squadCount) };
});
const hubBySlug = new Map(hubTeams.map((hub) => [hub.slug, hub]));
const comparisonPairs = featuredTeams.flatMap((team, index) =>
  featuredTeams.slice(index + 1).map((opponent) => [team, opponent])
);
const dataDate = teams
  .map((team) => team.lastStandingsSyncedAt)
  .filter(Boolean)
  .sort()
  .at(-1)?.slice(0, 10) || new Date().toISOString().slice(0, 10);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function value(value, suffix = "") {
  return Number.isFinite(value) ? `${escapeHtml(value)}${suffix}` : "—";
}

function breadcrumbSchema(items) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url
    }))
  };
}

function breadcrumbHtml(items) {
  return `<nav class="evergreen-breadcrumb" aria-label="İçerik yolu">${items
    .map((item, index) => index === items.length - 1
      ? `<span aria-current="page">${escapeHtml(item.name)}</span>`
      : `<a href="${escapeHtml(item.href)}">${escapeHtml(item.name)}</a><span aria-hidden="true">/</span>`)
    .join("")}</nav>`;
}

function pageDocument({ base, title, description, canonicalPath, h1, kicker, intro, breadcrumbs, schema, content, indexable = true, enPath = null }) {
  const canonical = `${siteUrl}${canonicalPath}`;
  // Gerçekten var olan İngilizce karşılık: İngilizce sayfa Türkçe sayfayı alternate
  // ilan ediyor; karşılık verilmezse Google tek yönlü bildirimi yok sayar.
  const hreflang = enPath
    ? `\n    <link rel="alternate" hreflang="tr-TR" href="${canonical}" />\n    <link rel="alternate" hreflang="en" href="${siteUrl}/en/${enPath}" />\n    <link rel="alternate" hreflang="x-default" href="${canonical}" />`
    : "";
  const graph = [schema, breadcrumbSchema(breadcrumbs.map(({ name, url }) => ({ name, url })))];
  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="${indexable ? ROBOTS_INDEX : ROBOTS_NOINDEX_FOLLOW}" />
    <link rel="canonical" href="${canonical}" />${hreflang}
    <meta property="og:type" content="${schema["@type"] === "Article" ? "article" : "website"}" />
    <meta property="og:locale" content="tr_TR" />
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
    <script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replaceAll("<", "\\u003c")}</script>
  </head>
  <body>
    <div class="site-shell">
      ${siteHeader({ base })}
      <main class="evergreen-page">
        <div class="container">
          ${breadcrumbHtml(breadcrumbs)}
          <header class="evergreen-hero">
            <span class="section-kicker">${escapeHtml(kicker)}</span>
            <h1>${escapeHtml(h1)}</h1>
            <p>${escapeHtml(intro)}</p>
            <p class="evergreen-freshness"><time datetime="${dataDate}">Veri tarihi: ${dataDate}</time> · Yalnızca kayıtlı sağlayıcı verileri gösterilir.</p>
          </header>
          ${content}
        </div>
      </main>
      ${siteFooter({ base })}
    </div>
    <script src="${base}site.js" defer></script>
  </body>
</html>\n`;
}

function writePage(relativePath, html) {
  for (const outputRoot of [root, path.join(root, "public")]) {
    const destination = path.join(outputRoot, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, html, "utf8");
  }
}

function table(headers, rows, label) {
  return `<div class="evergreen-table-wrap"><table class="evergreen-table"><caption>${escapeHtml(label)}</caption><thead><tr>${headers
    .map((header) => `<th scope="col">${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}

function teamHref(slug, base = "./") {
  return `${base}takimlar/${slug}`;
}

function teamNameCell(team, base = "./") {
  const hub = hubTeams.find((item) => item.record.id === team.id && item.indexable);
  return hub
    ? `<a href="${teamHref(hub.slug, base)}">${escapeHtml(team.name)}</a>`
    : escapeHtml(team.name);
}

function standingsPage() {
  const ordered = [...teams].filter((team) => team.isCurrentSuperLigTeam).sort((a, b) => a.rank - b.rank);
  const rows = ordered.map((team) => `<tr><td>${value(team.rank)}</td><th scope="row">${teamNameCell(team)}</th><td>${value(team.played)}</td><td>${value(team.won)}</td><td>${value(team.drawn)}</td><td>${value(team.lost)}</td><td>${value(team.goalsFor)}</td><td>${value(team.goalsAgainst)}</td><td>${value(team.goalDifference)}</td><td><strong>${value(team.points)}</strong></td></tr>`);
  const breadcrumbs = [
    { name: "Ana Sayfa", href: "./", url: `${siteUrl}/` },
    { name: "Süper Lig Puan Durumu", href: "./super-lig-puan-durumu", url: `${siteUrl}/super-lig-puan-durumu` }
  ];
  return pageDocument({
    base: "./",
    enPath: "super-lig-standings",
    title: "Süper Lig Puan Durumu 2026/27 | FutbolRadar",
    description: "Süper Lig 2026/27 puan durumunu; oynanan maç, galibiyet, beraberlik, mağlubiyet, averaj ve puan bilgileriyle inceleyin.",
    canonicalPath: "/super-lig-puan-durumu",
    h1: "Süper Lig Puan Durumu",
    kicker: "2026/27 Sezonu",
    intro: "Süper Lig takımlarının kayıtlı son puan durumu. Tablo, sağlayıcıdan doğrulanan lig verileriyle derleme sırasında oluşturulur.",
    breadcrumbs,
    schema: { "@type": "CollectionPage", "@id": `${siteUrl}/super-lig-puan-durumu#page`, url: `${siteUrl}/super-lig-puan-durumu`, name: "Süper Lig Puan Durumu", description: "Süper Lig 2026/27 puan durumu ve takım istatistikleri.", inLanguage: "tr-TR", dateModified: dataDate },
    content: `<section class="evergreen-section" aria-labelledby="standings-heading"><h2 id="standings-heading">Güncel lig tablosu</h2>${table(["Sıra", "Takım", "O", "G", "B", "M", "A", "Y", "Av.", "P"], rows, "Süper Lig 2026/27 puan durumu")}</section>${relatedLinks("Puan durumundan devam edin")}`
  });
}

function formPage() {
  const ordered = [...teams].filter((team) => team.isCurrentSuperLigTeam).sort((a, b) => (b.formScore ?? -1) - (a.formScore ?? -1));
  const rows = ordered.map((team, index) => `<tr><td>${index + 1}</td><th scope="row">${teamNameCell(team, "../")}</th><td>${value(team.formScore)}</td><td>${value(team.momentum)}</td><td><span class="evergreen-form" aria-label="Son kayıtlı form">${(team.form || []).map((item) => `<i class="is-${escapeHtml(item.result)}">${escapeHtml(item.label)}</i>`).join("") || "—"}</span></td></tr>`);
  const breadcrumbs = [
    { name: "Ana Sayfa", href: "../", url: `${siteUrl}/` },
    { name: "Süper Lig", href: "../form-tablosu/super-lig", url: `${siteUrl}/form-tablosu/super-lig` }
  ];
  return pageDocument({
    base: "../",
    title: "Süper Lig Form Tablosu 2026/27 | FutbolRadar",
    description: "Süper Lig takımlarının kayıtlı son form sonuçlarını, form skorunu ve momentum verisini karşılaştırın.",
    canonicalPath: "/form-tablosu/super-lig",
    h1: "Süper Lig Form Tablosu",
    kicker: "Takım Formu",
    intro: "Takımlar kayıtlı form skoruna göre sıralanır. Sonuç dizisi ve momentum değerleri yalnızca veri kaynağında bulunan kayıtları yansıtır.",
    breadcrumbs,
    schema: { "@type": "CollectionPage", "@id": `${siteUrl}/form-tablosu/super-lig#page`, url: `${siteUrl}/form-tablosu/super-lig`, name: "Süper Lig Form Tablosu", description: "Süper Lig takımlarının form skoru, momentum ve son kayıtlı sonuçları.", inLanguage: "tr-TR", dateModified: dataDate },
    content: `<section class="evergreen-section" aria-labelledby="form-heading"><h2 id="form-heading">Takımların kayıtlı form sıralaması</h2>${table(["Sıra", "Takım", "Form skoru", "Momentum", "Son sonuçlar"], rows, "Süper Lig form tablosu")}</section>${relatedLinks("Form tablosundan devam edin", "../")}`
  });
}

function relatedLinks(title, base = "./") {
  return `<aside class="evergreen-related" aria-labelledby="related-heading"><h2 id="related-heading">${escapeHtml(title)}</h2><div class="evergreen-link-grid"><a href="${base}bugunun-maclari">Bugünün maçları</a><a href="${base}super-lig-puan-durumu">Süper Lig puan durumu</a><a href="${base}form-tablosu/super-lig">Süper Lig form tablosu</a><a href="${base}takim-karsilastirmalari">Takım karşılaştırmaları</a><a href="${base}oyuncu-karsilastirmalari">Oyuncu karşılaştırmaları</a></div></aside>`;
}

function teamPage(featured) {
  const team = featured.record || teamBySlug.get(featured.slug);
  if (!team) throw new Error(`Takım verisi bulunamadı: ${featured.slug}`);
  const squad = players.filter((player) => sameClub(player.currentTeam, team.name)).sort((a, b) => a.name.localeCompare(b.name, "tr")).slice(0, 12);
  const teamPlayers = squad.length
    ? `<ul class="evergreen-player-list">${squad.map((player) => `<li><a href="${escapeHtml(playerLink(player.id, "../"))}"><strong>${escapeHtml(player.name)}</strong><span>${escapeHtml(player.position || "Pozisyon kaydı yok")}</span></a></li>`).join("")}</ul>`
    : "<p>Bu takım için güncel oyuncu kaydı bulunmuyor.</p>";
  const breadcrumbs = [
    { name: "Ana Sayfa", href: "../", url: `${siteUrl}/` },
    { name: "Takımlar", href: "../takimlar", url: `${siteUrl}/takimlar` },
    { name: featured.name, href: `../takimlar/${featured.slug}`, url: `${siteUrl}/takimlar/${featured.slug}` }
  ];
  const factRows = [
    ["Lig sırası", value(team.rank)], ["Oynanan maç", value(team.played)], ["Galibiyet", value(team.won)],
    ["Beraberlik", value(team.drawn)], ["Mağlubiyet", value(team.lost)], ["Attığı gol", value(team.goalsFor)],
    ["Yediği gol", value(team.goalsAgainst)], ["Averaj", value(team.goalDifference)], ["Puan", value(team.points)]
  ].map(([label, item]) => `<tr><th scope="row">${label}</th><td>${item}</td></tr>`);
  const scores = [["Form skoru", team.formScore], ["Momentum", team.momentum], ["Hücum", team.attack], ["Savunma", team.defense]]
    .filter(([, item]) => item !== null && item !== undefined && item !== "");
  const formItems = (team.form || []).map((item) => `<i class="is-${escapeHtml(item.result)}">${escapeHtml(item.label)}</i>`).join("");
  // Veri yoksa "—" kutuları basılmaz (ince içerik): bölüm yalnızca kayıt varsa.
  const formSection = scores.length || formItems
    ? `<section class="evergreen-section" aria-labelledby="team-form"><h2 id="team-form">Kayıtlı form</h2>${scores.length ? `<div class="evergreen-score-grid">${scores.map(([label, item]) => `<div><span>${label}</span><strong>${value(item)}</strong></div>`).join("")}</div>` : ""}${formItems ? `<div class="evergreen-form evergreen-form-large">${formItems}</div>` : ""}</section>`
    : "";
  const teamLinks = [
    fs.existsSync(path.join(root, `${featured.slug}-maclari.html`)) ? `<a href="../${featured.slug}-maclari.html">${escapeHtml(featured.name)} maçları ve fikstür</a>` : "",
    standingsPageIndexable(team) ? `<a href="../${featured.slug}-puan-durumu">${escapeHtml(featured.name)} puan durumu</a>` : ""
  ].join("");
  const teamComparisons = comparisonPairs.filter(([a, b]) => a.slug === featured.slug || b.slug === featured.slug)
    .map(([a, b]) => `<a href="../karsilastirma/takimlar/${a.slug}-vs-${b.slug}">${escapeHtml(a.name)} vs ${escapeHtml(b.name)}</a>`).join("");
  return pageDocument({
    base: "../",
    title: `${featured.name} Takım Profili, Puan ve Form | FutbolRadar`,
    description: `${featured.name} takım profili: kayıtlı Süper Lig sırası, puanı, maç bilançosu, form durumu ve FutbolRadar oyuncu profilleri.`,
    canonicalPath: `/takimlar/${featured.slug}`,
    h1: `${featured.name} Takım Profili`,
    kicker: "Süper Lig Takımı",
    intro: `${featured.name} için kayıtlı 2026/27 lig görünümü, takım formu ve doğrulanmış oyuncu kayıtlarına erişim sayfası.`,
    breadcrumbs,
    schema: { "@type": "ProfilePage", "@id": `${siteUrl}/takimlar/${featured.slug}#page`, url: `${siteUrl}/takimlar/${featured.slug}`, name: `${featured.name} Takım Profili`, description: `${featured.name} takım profili, puan durumu ve form verileri.`, inLanguage: "tr-TR", dateModified: dataDate, mainEntity: { "@type": "SportsTeam", name: featured.name, sport: "Football", memberOf: { "@type": "SportsOrganization", name: team.league } } },
    indexable: featured.indexable !== false,
    content: `<div class="evergreen-two-column"><section class="evergreen-section" aria-labelledby="team-facts"><h2 id="team-facts">Lig görünümü</h2>${table(["Gösterge", "Kayıtlı değer"], factRows, `${featured.name} 2026/27 takım verileri`)}</section>${formSection}</div>${teamLinks ? `<nav class="evergreen-link-grid" aria-label="${escapeHtml(featured.name)} sayfaları">${teamLinks}</nav>` : ""}<section class="evergreen-section" aria-labelledby="team-players"><h2 id="team-players">Kayıtlı oyuncu profilleri</h2>${teamPlayers}</section>${teamComparisons ? `<aside class="evergreen-related"><h2>${featured.name} karşılaştırmaları</h2><div class="evergreen-link-grid">${teamComparisons}</div></aside>` : ""}${relatedLinks("Takım profilinden devam edin", "../")}`
  });
}

function comparisonPage(leftFeatured, rightFeatured) {
  const left = teamBySlug.get(leftFeatured.slug);
  const right = teamBySlug.get(rightFeatured.slug);
  const slug = `${leftFeatured.slug}-vs-${rightFeatured.slug}`;
  const metrics = [
    ["Lig sırası", left.rank, right.rank], ["Oynanan maç", left.played, right.played], ["Galibiyet", left.won, right.won],
    ["Beraberlik", left.drawn, right.drawn], ["Mağlubiyet", left.lost, right.lost], ["Attığı gol", left.goalsFor, right.goalsFor],
    ["Yediği gol", left.goalsAgainst, right.goalsAgainst], ["Averaj", left.goalDifference, right.goalDifference], ["Puan", left.points, right.points],
    ["Form skoru", left.formScore, right.formScore], ["Momentum", left.momentum, right.momentum]
  ];
  const rows = metrics.map(([label, leftValue, rightValue]) => `<tr><th scope="row">${escapeHtml(label)}</th><td>${value(leftValue)}</td><td>${value(rightValue)}</td></tr>`);
  const breadcrumbs = [
    { name: "Ana Sayfa", href: "../../", url: `${siteUrl}/` },
    { name: "Takım Karşılaştırmaları", href: "../../takim-karsilastirmalari", url: `${siteUrl}/takim-karsilastirmalari` },
    { name: `${leftFeatured.name} vs ${rightFeatured.name}`, href: `../../karsilastirma/takimlar/${slug}`, url: `${siteUrl}/karsilastirma/takimlar/${slug}` }
  ];
  const title = `${leftFeatured.name} vs ${rightFeatured.name} Takım Karşılaştırması`;
  return pageDocument({
    base: "../../",
    title: `${title} | FutbolRadar`,
    description: `${leftFeatured.name} ve ${rightFeatured.name} takımlarını kayıtlı lig sırası, puan, gol, form skoru ve momentum verileriyle karşılaştırın.`,
    canonicalPath: `/karsilastirma/takimlar/${slug}`,
    h1: title,
    kicker: "Takım Karşılaştırması",
    intro: "Bu sayfa iki takımın aynı veri anındaki kayıtlarını yan yana getirir; tahmin, skor veya olay üretmez.",
    breadcrumbs,
    schema: { "@type": "Article", "@id": `${siteUrl}/karsilastirma/takimlar/${slug}#article`, mainEntityOfPage: `${siteUrl}/karsilastirma/takimlar/${slug}`, headline: title, description: `${leftFeatured.name} ve ${rightFeatured.name} takım verilerinin karşılaştırması.`, datePublished: dataDate, dateModified: dataDate, inLanguage: "tr-TR", author: { "@type": "Organization", name: "FutbolRadar" }, publisher: { "@type": "Organization", name: "FutbolRadar", logo: { "@type": "ImageObject", url: `${siteUrl}/favicon-512x512.png` } }, image: socialImage },
    content: `<section class="evergreen-section" aria-labelledby="comparison-heading"><h2 id="comparison-heading">Kayıtlı sezon verileri</h2>${table(["Gösterge", leftFeatured.name, rightFeatured.name], rows, `${leftFeatured.name} ve ${rightFeatured.name} karşılaştırma tablosu`)}<p class="evergreen-note">Karşılaştırma yalnızca veri dosyasında bulunan değerleri gösterir. Eksik bir değer “—” olarak bırakılır.</p></section><div class="evergreen-link-grid"><a href="../../takimlar/${leftFeatured.slug}">${escapeHtml(leftFeatured.name)} takım profili</a><a href="../../takimlar/${rightFeatured.slug}">${escapeHtml(rightFeatured.name)} takım profili</a></div>${relatedLinks("Karşılaştırmadan devam edin", "../../")}`
  });
}

function comparisonHub() {
  const breadcrumbs = [
    { name: "Ana Sayfa", href: "./", url: `${siteUrl}/` },
    { name: "Takım Karşılaştırmaları", href: "./takim-karsilastirmalari", url: `${siteUrl}/takim-karsilastirmalari` }
  ];
  const links = comparisonPairs.map(([left, right]) => `<article class="evergreen-card"><h2>${escapeHtml(left.name)} vs ${escapeHtml(right.name)}</h2><p>İki takımın puan, gol, form ve momentum kayıtlarını aynı tabloda inceleyin.</p><a href="./karsilastirma/takimlar/${left.slug}-vs-${right.slug}">Karşılaştırmayı aç</a></article>`).join("");
  return pageDocument({
    base: "./",
    title: "Süper Lig Takım Karşılaştırmaları | FutbolRadar",
    description: "Galatasaray, Fenerbahçe, Beşiktaş ve Trabzonspor için puan, gol, form ve momentum verilerini karşılaştıran takım sayfaları.",
    canonicalPath: "/takim-karsilastirmalari",
    h1: "Süper Lig Takım Karşılaştırmaları",
    kicker: "Karşılaştırma Merkezi",
    intro: "Dört büyük takımın kayıtlı sezon verilerini çiftler halinde karşılaştırın. Her sayfa sunucudan teslim edilen, taranabilir HTML içerir.",
    breadcrumbs,
    schema: { "@type": "CollectionPage", "@id": `${siteUrl}/takim-karsilastirmalari#page`, url: `${siteUrl}/takim-karsilastirmalari`, name: "Süper Lig Takım Karşılaştırmaları", description: "Süper Lig takım karşılaştırma sayfaları.", inLanguage: "tr-TR", dateModified: dataDate },
    content: `<section class="evergreen-card-grid" aria-label="Takım karşılaştırmaları">${links}</section>${relatedLinks("Karşılaştırma merkezinden devam edin")}`
  });
}

function patchHomePage(file) {
  if (!fs.existsSync(file)) return;
  let html = fs.readFileSync(file, "utf8");
  const block = `<!-- evergreen-seo-links:start -->
        <section class="container section evergreen-home-links" aria-labelledby="evergreen-home-title">
          <div class="section-head"><div class="section-title"><span class="section-kicker">Futbol Rehberi</span><h2 id="evergreen-home-title">Puan, form, takım ve karşılaştırma sayfaları</h2><p>Bugünün programından takım profillerine uzanan kalıcı FutbolRadar rehberleri.</p></div></div>
          <nav class="evergreen-link-grid" aria-label="Futbol rehberleri"><a href="./bugunun-maclari">Bugünün maçları</a><a href="./super-lig-puan-durumu">Süper Lig puan durumu</a><a href="./form-tablosu/super-lig">Süper Lig form tablosu</a>${featuredTeams.map((team) => `<a href="./takimlar/${team.slug}">${escapeHtml(team.name)}</a>`).join("")}<a href="./takimlar">Tüm takımlar</a><a href="./takim-karsilastirmalari">Takım karşılaştırmaları</a><a href="./oyuncu-karsilastirmalari">Oyuncu karşılaştırmaları</a></nav>
        </section>
        <!-- evergreen-seo-links:end -->`;
  const pattern = /\s*<!-- evergreen-seo-links:start -->[\s\S]*?<!-- evergreen-seo-links:end -->/;
  html = pattern.test(html) ? html.replace(pattern, `\n${block}`) : html.replace(/\s*<\/main>/, `\n${block}\n      </main>`);
  fs.writeFileSync(file, html, "utf8");
}

function updateSitemap(file) {
  if (!fs.existsSync(file)) return;
  const xml = fs.readFileSync(file, "utf8");
  const newPaths = [
    "/super-lig-puan-durumu", "/form-tablosu/super-lig", "/takim-karsilastirmalari",
    ...hubTeams.filter((team) => team.indexable).map((team) => `/takimlar/${team.slug}`),
    ...comparisonPairs.map(([left, right]) => `/karsilastirma/takimlar/${left.slug}-vs-${right.slug}`)
  ];
  const urls = new Set(newPaths.map((item) => `${siteUrl}${item}`));
  const entries = (xml.match(URL_ENTRY_RE) || []).filter((entry) => ![...urls].some((url) => entry.includes(`<loc>${url}</loc>`)));
  entries.push(...[...urls].map((url) => `  <url>\n    <loc>${url}</loc>\n    <lastmod>${dataDate}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>${url.includes("/karsilastirma/") ? "0.7" : "0.8"}</priority>\n  </url>`));
  fs.writeFileSync(file, wrapUrlset(entries), "utf8");
}

writePage("super-lig-puan-durumu.html", standingsPage());
writePage(path.join("form-tablosu", "super-lig.html"), formPage());
writePage("takim-karsilastirmalari.html", comparisonHub());
for (const team of hubTeams) writePage(path.join("takimlar", `${team.slug}.html`), teamPage(team));
for (const [left, right] of comparisonPairs) writePage(path.join("karsilastirma", "takimlar", `${left.slug}-vs-${right.slug}.html`), comparisonPage(left, right));
for (const outputRoot of [root, path.join(root, "public")]) {
  patchHomePage(path.join(outputRoot, "index.html"));
  updateSitemap(path.join(outputRoot, "sitemap.xml"));
}

console.log(`Evergreen SEO: 3 merkez, ${hubTeams.length} takım profili (${hubTeams.filter((team) => team.indexable).length} indekslenebilir) ve ${comparisonPairs.length} takım karşılaştırması üretildi.`);
