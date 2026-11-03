#!/usr/bin/env node
/**
 * GALATASARAY FİKSTÜR + VfB STUTTGART TAKIM SAYFASI (3 Kasım 2026).
 *
 * Çıktılar (kök + public/):
 *   takimlar/galatasaray/fikstur.html  → /takimlar/galatasaray/fikstur.html
 *   takimlar/stuttgart.html            → /takimlar/stuttgart (vercel.json /takimlar/:slug kuralı)
 *
 * KURALLAR
 * - Yalnızca data/team-pages/gs-stuttgart-2026-11-03.json okunur; ağ çağrısı yok.
 * - Her kayıt kaynak anahtarı taşır; kaynağın alan adı services/sourceLinks.js
 *   izin listesinde değilse üretim DURUR (uydurma/izinsiz kaynak yayımlanmaz).
 * - Tarihi açıklanmamış maç "Tarih: Güncelleniyor" olarak gösterilir.
 * - Büyük dört üreticisine (generate-big-four-data-pages.mjs) dokunulmaz; açık
 *   PR #561/#564 ile çakışmamak için ayrı üretici.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { siteFooter, siteHeader } from "./lib/layout.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";
import { ROBOTS_INDEX } from "./lib/robots.mjs";

const require = createRequire(import.meta.url);
const { isAllowedSourceUrl, sourceLinkAttrs } = require("../services/sourceLinks.js");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://www.futbolradar.com";
const DATA_FILE = "data/team-pages/gs-stuttgart-2026-11-03.json";
const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const DAYS = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];

const esc = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

export function loadData() {
  const data = JSON.parse(fs.readFileSync(path.join(root, DATA_FILE), "utf8"));
  for (const [key, s] of Object.entries(data.sources)) {
    if (!isAllowedSourceUrl(s.url)) throw new Error(`[gs-stuttgart] izinsiz kaynak: ${key} ${s.url}`);
    if (/wikipedia|thesportsdb/i.test(s.url)) throw new Error(`[gs-stuttgart] yasak kaynak: ${s.url}`);
  }
  const check = (obj, where) => {
    for (const k of obj.source || []) if (!data.sources[k]) throw new Error(`[gs-stuttgart] bilinmeyen kaynak ${k} (${where})`);
  };
  const walk = (v, where) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${where}[${i}]`));
    else if (v && typeof v === "object") { if (Array.isArray(v.source)) check(v, where); for (const [k, x] of Object.entries(v)) if (k !== "source") walk(x, `${where}.${k}`); }
  };
  walk(data.galatasaray, "galatasaray");
  walk(data.stuttgart, "stuttgart");
  return data;
}

export function trDate(iso) {
  if (!iso) return "Tarih: Güncelleniyor";
  const [y, m, d] = iso.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${d} ${MONTHS[m - 1]} ${y} ${DAYS[day]}`;
}

function srcLinks(data, keys) {
  return keys.map((k) => `<a class="tp-src"${sourceLinkAttrs()} href="${esc(data.sources[k].url)}">${esc(data.sources[k].name.split(" — ")[0])}</a>`).join(" · ");
}

function fixtureList(data, items, label) {
  return `<ol class="tp-fixtures" aria-label="${esc(label)}">${items.map((m) => {
    const title = `${m.home} - ${m.away}`;
    const titleHtml = m.href ? `<a class="tp-match-link" href="${esc(m.href)}">${esc(title)}</a>` : `<strong>${esc(title)}</strong>`;
    const when = m.date ? `<time datetime="${m.date}${m.time ? `T${m.time}:00+03:00` : ""}">${esc(trDate(m.date))}${m.time ? ` · ${esc(m.time)} TSİ` : ""}</time>` : `<span>${esc(trDate(null))}</span>`;
    return `<li class="tp-fixture"><span class="tp-comp">${esc(m.competition)}</span>${titleHtml}<span class="tp-when">${when}</span>${m.venue ? `<span class="tp-venue">${esc(m.venue)}</span>` : ""}<span class="tp-sources">Kaynak: ${srcLinks(data, m.source)}</span></li>`;
  }).join("")}</ol>`;
}

function resultList(data, items) {
  return `<ul class="tp-results">${items.map((r) => `<li><span>${esc(trDate(r.date))}${r.md ? ` · ${r.md}. maç günü` : ""}</span><strong>${esc(r.home)} ${esc(r.score)} ${esc(r.away)}</strong><span class="tp-sources">Kaynak: ${srcLinks(data, r.source)}</span></li>`).join("")}</ul>`;
}

function tableRows(rows) {
  return `<div class="evergreen-table-wrap"><table class="evergreen-table"><tbody>${rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</tbody></table></div>`;
}

function eventSchema(m, pageUrl) {
  if (!m.date || !m.time) return null;
  return {
    "@type": "SportsEvent",
    name: `${m.home} - ${m.away}`,
    startDate: `${m.date}T${m.time}:00+03:00`,
    eventStatus: "https://schema.org/EventScheduled",
    sport: "Football",
    homeTeam: { "@type": "SportsTeam", name: m.home },
    awayTeam: { "@type": "SportsTeam", name: m.away },
    ...(m.venue ? { location: { "@type": "Place", name: m.venue } } : {}),
    url: m.href ? new URL(m.href, pageUrl).href : pageUrl
  };
}

const STYLE = `<style>
.tp-fixtures,.tp-results,.tp-facts{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.tp-fixture,.tp-results li,.tp-facts li{display:flex;flex-direction:column;gap:4px;padding:12px;border:1px solid var(--line,rgba(127,127,127,.25));border-radius:12px;min-width:0;overflow-wrap:anywhere}
.tp-comp{font-size:.8rem;opacity:.75}
.tp-when,.tp-venue{font-size:.9rem}
.tp-sources{font-size:.8rem;opacity:.85}
.tp-src,.tp-match-link{display:inline-flex;align-items:center;min-height:32px}
.tp-match-link{font-weight:700}
.tp-squad{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px;list-style:none;margin:0 0 12px;padding:0}
.tp-squad li{padding:8px 10px;border:1px solid var(--line,rgba(127,127,127,.25));border-radius:10px;overflow-wrap:anywhere}
.tp-squad b{display:inline-block;min-width:2ch;margin-right:6px}
.tp-page .evergreen-link-grid a{min-height:32px}
.tp-page .evergreen-breadcrumb a{display:inline-flex;align-items:center;min-height:32px}
</style>`;

function shell({ base, canonical, title, description, h1, kicker, intro, graph, body, dataDate }) {
  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" />
    <meta name="robots" content="${ROBOTS_INDEX}" />
    <link rel="canonical" href="${canonical}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${SITE}/assets/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="icon" href="${base}favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="${base}page.css" />
    ${STYLE}
    <script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replaceAll("<", "\\u003c")}</script>
  </head>
  <body>
    <div class="site-shell">
      ${siteHeader({ base })}
      <main class="evergreen-page tp-page">
        <div class="container">
          ${body.crumbs}
          <header class="evergreen-hero">
            <span class="section-kicker">${esc(kicker)}</span>
            <h1>${esc(h1)}</h1>
            <p>${esc(intro)}</p>
            <p class="evergreen-freshness"><time datetime="${dataDate}">Veri tarihi: ${dataDate}</time> · Saatler Türkiye saatiyle (TSİ). Her kayıt kaynak bağlantısı taşır; açıklanmamış bilgiler "Güncelleniyor" olarak işaretlenir.</p>
          </header>
          ${body.main}
        </div>
      </main>
      ${siteFooter({ base })}
    </div>
    <script src="${base}site.js" defer></script>
  </body>
</html>
`;
}

function crumbsFor(items) {
  const html = `<nav class="evergreen-breadcrumb" aria-label="İçerik yolu">${items.map((c, i) => (i === items.length - 1 ? `<span aria-current="page">${esc(c.name)}</span>` : `<a href="${esc(c.href)}">${esc(c.name)}</a><span aria-hidden="true">/</span>`)).join("")}</nav>`;
  const schema = { "@type": "BreadcrumbList", itemListElement: items.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: c.url })) };
  return { html, schema };
}

export function buildGsFixture(data) {
  const base = "../../";
  const gs = data.galatasaray;
  const canonical = `${SITE}/takimlar/galatasaray/fikstur.html`;
  const title = "Galatasaray Fikstürü 2026-27: Sıradaki Maçlar | FutbolRadar";
  const description = "Galatasaray fikstürü: Stuttgart (3 Kasım), Amed, Samsunspor, Aston Villa ve Şampiyonlar Ligi lig aşamasının kalan maçları. Tarih, saat ve stat kaynaklı.";
  const crumbs = crumbsFor([
    { name: "Ana Sayfa", url: `${SITE}/`, href: base },
    { name: "Takımlar", url: `${SITE}/takimlar`, href: `${base}takimlar.html` },
    { name: "Galatasaray", url: `${SITE}/takimlar/galatasaray`, href: "../galatasaray" },
    { name: "Fikstür", url: canonical }
  ]);
  const l = gs.league;
  const events = gs.upcoming.map((m) => eventSchema(m, canonical)).filter(Boolean);
  const graph = [
    { "@type": "WebPage", "@id": `${canonical}#page`, url: canonical, name: "Galatasaray Fikstürü", description, inLanguage: "tr-TR", dateModified: data.dataDate, about: { "@id": `${SITE}/takimlar/galatasaray#team` } },
    { "@type": "SportsTeam", "@id": `${SITE}/takimlar/galatasaray#team`, name: "Galatasaray", sport: "Football", url: `${SITE}/takimlar/galatasaray`, memberOf: { "@type": "SportsOrganization", name: "Süper Lig" } },
    { "@type": "ItemList", name: "Galatasaray sıradaki maçlar", itemListElement: events.map((e, i) => ({ "@type": "ListItem", position: i + 1, item: e })) },
    crumbs.schema
  ];
  const main = `
          <section class="evergreen-section" aria-labelledby="gs-next"><h2 id="gs-next">Sıradaki maçlar</h2>
            <p>3 Kasım maçının künyesi, yayın bilgisi ve maç öncesi notları: <a class="tp-match-link" href="../../galatasaray-stuttgart.html">Galatasaray - Stuttgart maç sayfası</a>. Rakip profili: <a class="tp-match-link" href="../stuttgart">VfB Stuttgart takım sayfası</a>.</p>
            ${fixtureList(data, gs.upcoming, "Galatasaray sıradaki maçlar")}
          </section>
          <section class="evergreen-section" aria-labelledby="gs-ucl"><h2 id="gs-ucl">Şampiyonlar Ligi 2026-27: oynanan maçlar</h2>
            <p>Galatasaray lig aşamasının ilk üç maçında 1 galibiyet, 2 mağlubiyetle 3 puan topladı.</p>
            ${resultList(data, gs.uclResults)}
          </section>
          <section class="evergreen-section" aria-labelledby="gs-table"><h2 id="gs-table">Süper Lig'de son durum</h2>
            ${tableRows([["Sıra", l.rank], ["Oynanan", l.played], ["Galibiyet", l.won], ["Beraberlik", l.drawn], ["Mağlubiyet", l.lost], ["Attığı / yediği", `${l.gf} / ${l.ga}`], ["Puan", l.points]])}
            <p class="tp-sources">Durum: ${esc(l.asOf)}. Kaynak: ${srcLinks(data, l.source)}</p>
          </section>
          <nav class="evergreen-link-grid" aria-label="Galatasaray sayfaları"><a href="../galatasaray">Galatasaray takım profili</a><a href="./kadro.html">Kadro</a><a href="./istatistikler.html">İstatistikler</a><a href="./mac-sonuclari.html">Maç sonuçları</a><a href="./tarihce.html">Tarihçe</a><a href="../../galatasaray-maclari.html">Galatasaray maçları</a><a href="../../sampiyonlar-ligi-puan-durumu.html">Şampiyonlar Ligi puan durumu</a><a href="../../galatasaray-stuttgart.html">Galatasaray - Stuttgart</a><a href="../stuttgart">VfB Stuttgart</a></nav>`;
  return shell({ base, canonical, title, description, h1: "Galatasaray Fikstürü: Sıradaki Maçlar", kicker: "Galatasaray · Fikstür", intro: "Galatasaray'ın Süper Lig ve UEFA Şampiyonlar Ligi'ndeki sıradaki maçları; tarih, saat (TSİ) ve stat bilgisi resmî kaynaklardan.", graph, body: { crumbs: crumbs.html, main }, dataDate: data.dataDate });
}

export function buildStuttgart(data) {
  const base = "../";
  const s = data.stuttgart;
  const canonical = `${SITE}/takimlar/stuttgart`;
  const title = "VfB Stuttgart: Kadro, Tarihçe, Fikstür | FutbolRadar";
  const description = "VfB Stuttgart takım sayfası: 2026-27 kadrosu, 1893'ten bugüne kısa tarihçe, Bundesliga ve Şampiyonlar Ligi istatistikleri ile sıradaki maçlar. Kaynaklı.";
  const crumbs = crumbsFor([
    { name: "Ana Sayfa", url: `${SITE}/`, href: base },
    { name: "Takımlar", url: `${SITE}/takimlar`, href: `${base}takimlar.html` },
    { name: "VfB Stuttgart", url: canonical }
  ]);
  const players = s.squad.groups.flatMap((g) => g.players.map(([, n]) => ({ "@type": "Person", name: n })));
  const b = s.bundesliga;
  const graph = [
    { "@type": "WebPage", "@id": `${canonical}#page`, url: canonical, name: "VfB Stuttgart takım sayfası", description, inLanguage: "tr-TR", dateModified: data.dataDate, about: { "@id": `${canonical}#team` } },
    { "@type": "SportsTeam", "@id": `${canonical}#team`, name: s.name, alternateName: "Stuttgart", sport: "Football", url: canonical, foundingDate: "1893-09-09", memberOf: { "@type": "SportsOrganization", name: "Bundesliga" }, coach: { "@type": "Person", name: s.headCoach.name }, location: { "@type": "Place", name: s.stadium.name }, athlete: players, sameAs: ["https://www.vfb.de/"] },
    { "@type": "ItemList", name: "VfB Stuttgart sıradaki maçlar", itemListElement: s.upcoming.map((m) => eventSchema(m, canonical)).filter(Boolean).map((e, i) => ({ "@type": "ListItem", position: i + 1, item: e })) },
    crumbs.schema
  ];
  const main = `
          <p>Şampiyonlar Ligi 4. maç günü: <a class="tp-match-link" href="../galatasaray-stuttgart.html">Galatasaray - Stuttgart (3 Kasım 2026, 20:45 TSİ)</a> · <a class="tp-match-link" href="./galatasaray/fikstur.html">Galatasaray fikstürü</a></p>
          <nav class="evergreen-link-grid" aria-label="Sayfa bölümleri"><a href="#kadro">Kadro</a><a href="#tarihce">Tarihçe</a><a href="#istatistikler">İstatistikler</a><a href="#fikstur">Fikstür</a></nav>
          <section class="evergreen-section" aria-labelledby="kadro"><h2 id="kadro">Kadro ${esc(s.squad.season)}</h2>
            <p>Teknik direktör: <strong>${esc(s.headCoach.name)}</strong>. İç saha: ${esc(s.stadium.name)}.</p>
            ${s.squad.groups.map((g) => `<h3>${esc(g.label)}</h3><ul class="tp-squad">${g.players.map(([no, n]) => `<li><b>${no}</b>${esc(n)}</li>`).join("")}</ul>`).join("")}
            <p class="tp-sources">Kaynak: ${srcLinks(data, s.squad.source)} · ${srcLinks(data, s.stadium.source)}</p>
          </section>
          <section class="evergreen-section" aria-labelledby="tarihce"><h2 id="tarihce">Kısa tarihçe</h2>
            <p>${esc(s.fullName)}</p>
            <ul class="tp-facts">${s.history.map((h) => `<li>${esc(h.text)}<span class="tp-sources">Kaynak: ${srcLinks(data, h.source)}</span></li>`).join("")}</ul>
          </section>
          <section class="evergreen-section" aria-labelledby="istatistikler"><h2 id="istatistikler">İstatistikler</h2>
            <h3>Bundesliga 2026-27 puan durumu</h3>
            ${tableRows([["Sıra", b.rank], ["Oynanan", b.played], ["Galibiyet", b.won], ["Beraberlik", b.drawn], ["Mağlubiyet", b.lost], ["Attığı / yediği", `${b.gf} / ${b.ga}`], ["Puan", b.points]])}
            <p class="tp-sources">Durum: ${esc(b.asOf)}. Kaynak: ${srcLinks(data, b.source)}</p>
            <h3>Son Bundesliga maçları</h3>
            ${resultList(data, s.bundesligaRecent)}
            <h3>${esc(s.seasonStats.label)}</h3>
            ${tableRows(s.seasonStats.items)}
            <p class="tp-sources">Kaynak: ${srcLinks(data, s.seasonStats.source)}</p>
            <h3>Şampiyonlar Ligi 2026-27: oynanan maçlar</h3>
            <p>Stuttgart lig aşamasının ilk üç maçında 2 galibiyet, 1 beraberlikle 7 puan topladı ve yenilmedi.</p>
            ${resultList(data, s.uclResults)}
            <h3>Öne çıkanlar</h3>
            <ul class="tp-facts">${s.facts.map((f) => `<li>${esc(f.text)}<span class="tp-sources">Kaynak: ${srcLinks(data, f.source)}</span></li>`).join("")}</ul>
          </section>
          <section class="evergreen-section" aria-labelledby="fikstur"><h2 id="fikstur">Fikstür: sıradaki maçlar</h2>
            ${fixtureList(data, s.upcoming, "VfB Stuttgart sıradaki maçlar")}
          </section>
          <nav class="evergreen-link-grid" aria-label="İlgili sayfalar"><a href="../galatasaray-stuttgart.html">Galatasaray - Stuttgart maç sayfası</a><a href="./galatasaray/fikstur.html">Galatasaray fikstürü</a><a href="./galatasaray">Galatasaray takım profili</a><a href="../sampiyonlar-ligi-puan-durumu.html">Şampiyonlar Ligi puan durumu</a><a href="../bundesliga-puan-durumu.html">Bundesliga puan durumu</a></nav>`;
  return shell({ base, canonical, title, description, h1: "VfB Stuttgart: Kadro, Tarihçe ve Fikstür", kicker: "Takımlar · Bundesliga", intro: "Galatasaray'ın Şampiyonlar Ligi rakibi VfB Stuttgart: güncel kadro, kulüp tarihçesi, Bundesliga ve Avrupa istatistikleri, sıradaki maçlar. Bilgiler kulübün resmî sitesi, Bundesliga.com ve UEFA.com'dan.", graph, body: { crumbs: crumbs.html, main }, dataDate: data.dataDate });
}

function write(rel, content) {
  for (const outRoot of [root, path.join(root, "public")]) {
    const dest = path.join(outRoot, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(dest) && fs.readFileSync(dest, "utf8") === content) continue;
    fs.writeFileSync(dest, content, "utf8");
  }
}

export const OUTPUTS = [
  { file: "takimlar/galatasaray/fikstur.html", loc: `${SITE}/takimlar/galatasaray/fikstur.html` },
  { file: "takimlar/stuttgart.html", loc: `${SITE}/takimlar/stuttgart` }
];

function main() {
  const data = loadData();
  write(OUTPUTS[0].file, buildGsFixture(data));
  write(OUTPUTS[1].file, buildStuttgart(data));
  for (const sitemapPath of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) {
    if (!fs.existsSync(sitemapPath)) continue;
    const retained = (fs.readFileSync(sitemapPath, "utf8").match(URL_ENTRY_RE) || []).filter((e) => !OUTPUTS.some((o) => e.includes(`<loc>${o.loc}</loc>`)));
    const entries = OUTPUTS.map((o) => `  <url>\n    <loc>${o.loc}</loc>\n    <lastmod>${data.dataDate}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.75</priority>\n  </url>`);
    fs.writeFileSync(sitemapPath, wrapUrlset(retained.concat(entries)), "utf8");
  }
  console.log(`[gs-stuttgart-team-pages] ${OUTPUTS.length} sayfa yazıldı.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
