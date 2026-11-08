#!/usr/bin/env node
/**
 * ZENGİN TAKIM SAYFALARI (data/team-pages/<slug>.json → takimlar/<slug>.html).
 * Kayıt: scripts/lib/richTeamPages.mjs (API-Football id → slug).
 * Ağ çağrısı yok; izinsiz / Wikipedia / TheSportsDB kaynakta üretim DURUR.
 * İNDEKSLENİR + sitemap. PR #583 şablon üreticisi bu id'leri atlamalı.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { siteFooter, siteHeader } from "./lib/layout.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";
import { ROBOTS_INDEX } from "./lib/robots.mjs";
import { RICH_TEAM_PAGES } from "./lib/richTeamPages.mjs";

const require = createRequire(import.meta.url);
const { isAllowedSourceUrl, sourceLinkAttrs } = require("../services/sourceLinks.js");
const { pageShareHtml } = require("../services/columnShare.js");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://www.futbolradar.com";
const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const DAYS = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
const esc = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

const STYLE = `<style>
.tp-results,.tp-facts,.tp-fixtures{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.tp-results li,.tp-facts li,.tp-fixtures li{display:flex;flex-direction:column;gap:4px;padding:12px;border:1px solid var(--line,rgba(127,127,127,.25));border-radius:12px;min-width:0;overflow-wrap:anywhere}
.tp-comp{font-size:.8rem;opacity:.75}
.tp-sources{font-size:.8rem;opacity:.85}
.tp-src,.tp-match-link{display:inline-flex;align-items:center;min-height:32px}
.tp-match-link{font-weight:700}
.tp-res{display:inline-flex;align-items:center;justify-content:center;min-width:1.8em;height:1.8em;border-radius:6px;font-weight:700;font-size:.85rem;margin-right:6px;background:rgba(127,127,127,.18)}
.tp-res-G{background:#1f9d55;color:#fff}.tp-res-M{background:#c53030;color:#fff}
.tp-squad{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px;list-style:none;margin:0 0 12px;padding:0}
.tp-squad li{padding:8px 10px;border:1px solid var(--line,rgba(127,127,127,.25));border-radius:10px;overflow-wrap:anywhere}
.tp-squad b{display:inline-block;min-width:2ch;margin-right:6px}
.tp-squad small{display:block;opacity:.7}
.tp-honours{display:grid;grid-template-columns:repeat(auto-fill,minmax(135px,1fr));gap:8px;list-style:none;margin:0 0 12px;padding:0}
.tp-honours li{padding:12px;border:1px solid var(--line,rgba(127,127,127,.25));border-radius:12px;min-width:0;overflow-wrap:anywhere}
.tp-honours strong{display:block;font-size:1.6rem;line-height:1.1}
.tp-honours small{display:block;opacity:.75;margin-top:4px}
.tp-page .evergreen-link-grid a{min-height:32px}
.tp-page .evergreen-breadcrumb a{display:inline-flex;align-items:center;min-height:32px}
.tp-page summary{display:flex;align-items:center;min-height:32px;cursor:pointer}
.tp-faq dt{font-weight:700;margin-top:12px}.tp-faq dd{margin:4px 0 0}
</style>`;

export function trDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y} ${DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}`;
}

function leagueBlock(data) {
  return data.league || data.premierLeague || data.laLiga || null;
}

export function loadData(entry) {
  const tag = entry.slug;
  const data = JSON.parse(fs.readFileSync(path.join(root, entry.data), "utf8"));
  for (const [key, s] of Object.entries(data.sources)) {
    if (/wikipedia|thesportsdb/i.test(s.url)) throw new Error(`[${tag}] yasak kaynak: ${s.url}`);
    if (!isAllowedSourceUrl(s.url)) throw new Error(`[${tag}] izinsiz kaynak: ${key} ${s.url}`);
  }
  const walk = (v, where) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${where}[${i}]`));
    else if (v && typeof v === "object") {
      if (Array.isArray(v.source)) for (const k of v.source) if (!data.sources[k]) throw new Error(`[${tag}] bilinmeyen kaynak ${k} (${where})`);
      for (const [k, x] of Object.entries(v)) if (k !== "source" && k !== "sources") walk(x, `${where}.${k}`);
    }
  };
  walk(data, "data");
  for (const key of ["history", "honours", "recent"]) for (const item of data[key]) if (!item.source?.length) throw new Error(`[${tag}] kaynaksız kayıt: ${key}`);
  const lg = leagueBlock(data);
  if (!data.squad.source?.length || !lg?.source?.length) throw new Error(`[${tag}] kaynaksız kadro/istatistik`);
  return data;
}

const srcLinks = (data, keys) => keys.map((k) => `<a class="tp-src"${sourceLinkAttrs()} href="${esc(data.sources[k].url)}">${esc(data.sources[k].name.split(" — ")[0])}</a>`).join(" · ");
const statTable = (rows) => `<div class="evergreen-table-wrap"><table class="evergreen-table"><tbody>${rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</tbody></table></div>`;

function resultLabel(m, shortName) {
  const [h, a] = m.score.split("-").map(Number);
  const homeUs = m.home.toLowerCase().includes(shortName.toLowerCase().slice(0, 8)) || m.home === shortName || m.home.startsWith(shortName);
  // prefer explicit team name match via shortName tokens
  const tokens = shortName.toLowerCase().split(/\s+/).filter((t) => t.length > 3);
  const isHome = tokens.some((t) => m.home.toLowerCase().includes(t));
  const isAway = tokens.some((t) => m.away.toLowerCase().includes(t));
  const usHome = isHome && !isAway ? true : isAway && !isHome ? false : homeUs;
  const us = usHome ? h : a, op = usHome ? a : h;
  if (m.note && /Penaltı/i.test(m.note)) return "B"; // yalnızca penaltılı beraberlik notu
  return us > op ? "G" : us < op ? "M" : "B";
}

function liverpoolFaq(data) {
  const lg = data.honours[0], ucl = data.honours[1], pl = data.premierLeague;
  return [
    { q: "Liverpool kaç kez İngiltere şampiyonu oldu?", a: `Liverpool ${lg.count} kez İngiltere lig şampiyonu oldu; sonuncusu ${lg.lastWon} Premier Lig sezonu.`, source: lg.source },
    { q: "Liverpool kaç kez Şampiyonlar Ligi (Avrupa Kupası) kazandı?", a: `Liverpool ${ucl.count} kez Avrupa Kupası / Şampiyonlar Ligi kazandı (${ucl.seasons}).`, source: ucl.source },
    { q: "Liverpool ne zaman kuruldu?", a: "Liverpool FC resmî olarak 3 Haziran 1892'de kuruldu; iç saha stadı Anfield.", source: ["lfcFounded"] },
    { q: "Liverpool'un teknik direktörü kim?", a: `Kulübün resmî kadro sayfasında baş antrenör olarak ${data.headCoach.name} yer alıyor.`, source: data.headCoach.source },
    { q: "Liverpool Premier Lig'de kaçıncı sırada?", a: `Liverpool ${pl.season} Premier Lig'inde ${pl.played} maçta ${pl.points} puanla ${pl.rank}. sırada (${pl.asOf}).`, source: pl.source }
  ];
}

export function faqEntries(data) {
  if (Array.isArray(data.faq) && data.faq.length) return data.faq;
  if (data.team?.slug === "liverpool") return liverpoolFaq(data);
  return [];
}

export function buildPage(data, entry) {
  const base = "../";
  const t = data.team;
  const canonical = `${SITE}/${entry.href}`;
  const lg = leagueBlock(data);
  const leagueName = lg.name || (data.premierLeague ? "Premier Lig" : t.leagueLabel || "Lig");
  const standingsHref = t.standingsHref || (data.premierLeague ? "premier-lig-puan-durumu.html" : "la-liga-puan-durumu.html");
  const title = data.seo?.title || `${t.shortName}: Kadro, Kupalar, Tarihçe, Maçlar | FutbolRadar`;
  const description = data.seo?.description || `${t.shortName} takım sayfası: kupalar, tarihçe, kadro, istatistikler ve son maçlar. Kaynaklı.`;
  const h1 = data.seo?.h1 || `${t.name}: Kupalar, Tarihçe, Kadro ve Maçlar`;
  const intro = data.seo?.intro || `${t.name} kupa başarıları, tarihçe, kadro, istatistikler ve son maçlar.`;
  const kicker = t.kicker || `Takımlar · ${leagueName}`;
  if (title.length > 60) throw new Error(`[${entry.slug}] title ${title.length}>60`);
  if (description.length > 155) throw new Error(`[${entry.slug}] description ${description.length}>155`);

  const crumbItems = [
    { name: "Ana Sayfa", url: `${SITE}/`, href: base },
    { name: "Takımlar", url: `${SITE}/takimlar`, href: `${base}takimlar.html` },
    { name: t.shortName, url: canonical }
  ];
  const crumbs = `<nav class="evergreen-breadcrumb" aria-label="İçerik yolu">${crumbItems.map((c, i) => (i === crumbItems.length - 1 ? `<span aria-current="page">${esc(c.name)}</span>` : `<a href="${esc(c.href)}">${esc(c.name)}</a><span aria-hidden="true">/</span>`)).join("")}</nav>`;
  const faqs = faqEntries(data);
  const ucl = data.ucl;
  const players = data.squad.groups.flatMap((g) => g.players.map(([, n]) => ({ "@type": "Person", name: n })));
  const graph = [
    { "@type": "WebPage", "@id": `${canonical}#page`, url: canonical, name: `${t.shortName} takım sayfası`, description, inLanguage: "tr-TR", dateModified: data.dataDate, about: { "@id": `${canonical}#team` } },
    { "@type": "SportsTeam", "@id": `${canonical}#team`, name: t.name, alternateName: t.shortName, sport: "Football", url: canonical, foundingDate: t.foundingDate, memberOf: { "@type": "SportsOrganization", name: leagueName }, coach: { "@type": "Person", name: data.headCoach.name }, location: { "@type": "StadiumOrArena", name: t.stadium }, athlete: players, sameAs: [t.sameAs] },
    { "@type": "BreadcrumbList", itemListElement: crumbItems.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: c.url })) },
    ...(faqs.length ? [{ "@type": "FAQPage", mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) }] : [])
  ];

  const uclRank = ucl.rank == null ? (ucl.rankNote || "Güncelleniyor") : `${ucl.rank}.`;
  const related = data.relatedLinks || [
    [`../${standingsHref}`, `${leagueName} puan durumu`],
    ["../sampiyonlar-ligi-puan-durumu.html", "Şampiyonlar Ligi puan durumu"],
    ["../takimlar.html", "Tüm takımlar"]
  ];

  const main = `
          <nav class="evergreen-link-grid" aria-label="Sayfa bölümleri"><a href="#kupalar">Kupalar</a><a href="#tarihce">Tarihçe</a><a href="#kadro">Kadro</a><a href="#istatistikler">İstatistikler</a><a href="#son-maclar">Son maçlar</a>${faqs.length ? `<a href="#sss">SSS</a>` : ""}</nav>
          ${(data.upcoming || []).map((m) => `<p>Sıradaki maç: <strong>${esc(m.home)} - ${esc(m.away)}</strong> · ${esc(m.competition)} · <time datetime="${m.date}T${m.time || "00:00"}:00+03:00">${esc(trDate(m.date))}${m.time ? ` · ${esc(m.time)} TSİ` : ""}</time> <span class="tp-sources">Kaynak: ${srcLinks(data, m.source)}</span></p>`).join("")}
          <section class="evergreen-section" aria-labelledby="kupalar"><h2 id="kupalar">Kupa başarıları</h2>
            <p>${esc(data.honoursTotal.text)} <span class="tp-sources">Kaynak: ${srcLinks(data, data.honoursTotal.source)}</span></p>
            <ul class="tp-honours">${data.honours.map((h) => `<li><strong>${h.count}</strong>${esc(h.name)}<small>Son: ${esc(h.lastWon)}</small></li>`).join("")}</ul>
            <details><summary>Sezon sezon tüm kupalar</summary><ul class="tp-facts">${data.honours.map((h) => `<li><b>${esc(h.name)} (${h.count})</b><span>${esc(h.seasons)}</span></li>`).join("")}</ul></details>
            <p class="tp-sources">Kaynak: ${srcLinks(data, data.honours[0].source)} (erişim: ${esc(data.dataDate)})</p>
          </section>
          <section class="evergreen-section" aria-labelledby="tarihce"><h2 id="tarihce">Tarihçe</h2>
            <ul class="tp-facts">${data.history.map((h) => `<li>${esc(h.text)}<span class="tp-sources">Kaynak: ${srcLinks(data, h.source)}</span></li>`).join("")}</ul>
          </section>
          <section class="evergreen-section" aria-labelledby="kadro"><h2 id="kadro">Güncel kadro ${esc(data.squad.season)}</h2>
            <p>Baş antrenör: <strong>${esc(data.headCoach.name)}</strong>. İç saha: ${esc(t.stadium)}.</p>
            ${data.squad.groups.map((g) => `<h3>${esc(g.label)}</h3><ul class="tp-squad">${g.players.map(([no, n, nat]) => `<li><b>${esc(no)}</b>${esc(n)}${nat ? `<small>${esc(nat)}</small>` : ""}</li>`).join("")}</ul>`).join("")}
            ${(data.squad.onLoan || []).length ? `<h3>Kiralık oyuncular</h3><ul class="tp-squad">${data.squad.onLoan.map(([no, n]) => `<li><b>${esc(no)}</b>${esc(n)}</li>`).join("")}</ul>` : ""}
            <p class="tp-sources">Forma numarası ve isimler kulübün resmî kadro sayfasından (erişim: ${esc(data.dataDate)}). Kaynak: ${srcLinks(data, data.squad.source)}</p>
          </section>
          <section class="evergreen-section" aria-labelledby="istatistikler"><h2 id="istatistikler">İstatistikler</h2>
            <h3>${esc(leagueName)} ${esc(lg.season)}</h3>
            ${statTable([["Sıra", `${lg.rank}.`], ["Oynanan", lg.played], ["Galibiyet", lg.won], ["Beraberlik", lg.drawn], ["Mağlubiyet", lg.lost], ["Attığı / yediği", `${lg.gf} / ${lg.ga}`], ["Averaj", `${lg.gf - lg.ga >= 0 ? "+" : ""}${lg.gf - lg.ga}`], ["Puan", lg.points], ["Lider", `${lg.leader.name} (${lg.leader.points} puan)`]])}
            <p class="tp-sources">Durum: ${esc(lg.asOf)}. Kaynak: ${srcLinks(data, lg.source)}</p>
            <h3>UEFA Şampiyonlar Ligi ${esc(ucl.season)} · lig aşaması</h3>
            ${statTable([["Sıra", uclRank], ["Oynanan", ucl.played], ["Galibiyet", ucl.won], ["Beraberlik", ucl.drawn], ["Mağlubiyet", ucl.lost], ["Attığı / yediği", `${ucl.gf} / ${ucl.ga}`], ["Puan", ucl.points]])}
            <p class="tp-sources">Durum: ${esc(ucl.asOf)}. Kaynak: ${srcLinks(data, ucl.source)}</p>
            <p>Sezon gol krallığı (kulüp içi): Güncelleniyor.</p>
          </section>
          <section class="evergreen-section" aria-labelledby="son-maclar"><h2 id="son-maclar">Son 5 resmî maç</h2>
            <ul class="tp-results">${data.recent.map((m) => { const r = resultLabel(m, t.shortName); return `<li><span class="tp-comp">${esc(m.competition)} · <time datetime="${m.date}">${esc(trDate(m.date))}</time></span><strong><span class="tp-res tp-res-${r}" aria-label="${r === "G" ? "Galibiyet" : r === "M" ? "Mağlubiyet" : "Beraberlik"}">${r}</span>${esc(m.home)} ${esc(m.score)} ${esc(m.away)}</strong>${m.note ? `<span>${esc(m.note)}</span>` : ""}<span class="tp-comp">${esc(m.venue || "")}</span><span class="tp-sources">Kaynak: ${srcLinks(data, m.source)}</span></li>`; }).join("")}</ul>
            <p class="tp-sources">Hazırlık maçları hariç. Veri tarihi: ${esc(data.dataDate)}.</p>
          </section>
          ${faqs.length ? `<section class="evergreen-section" aria-labelledby="sss"><h2 id="sss">Sık sorulan sorular</h2>
            <dl class="tp-faq">${faqs.map((f) => `<dt>${esc(f.q)}</dt><dd>${esc(f.a)} <span class="tp-sources">Kaynak: ${srcLinks(data, f.source)}</span></dd>`).join("")}</dl>
          </section>` : ""}
          <nav class="evergreen-link-grid" aria-label="İlgili sayfalar">${related.map(([href, label]) => `<a href="${esc(href)}">${esc(label)}</a>`).join("")}</nav>`;

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
    <link rel="stylesheet" href="${base}page.css" />
    ${STYLE}
    <script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replaceAll("<", "\\u003c")}</script>
    <!-- favicon:start -->
<link rel="icon" href="/favicon.ico" sizes="any" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="icon" type="image/png" sizes="48x48" href="/favicon-48x48.png" />
<link rel="icon" type="image/png" sizes="96x96" href="/favicon-96x96.png" />
<link rel="icon" type="image/png" sizes="192x192" href="/favicon-192x192.png" />
<link rel="icon" type="image/png" sizes="512x512" href="/favicon-512x512.png" />
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
<link rel="manifest" href="/site.webmanifest" />
<!-- favicon:end -->
<!-- pwa:start -->
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
<meta name="apple-mobile-web-app-title" content="FutbolRadar" />
<meta name="fr-vapid-public-key" content="" />
<script defer src="/pwa.js"></script>
<!-- pwa:end -->
<!-- theme-boot:start -->
<script>(function(){try{var s=localStorage.getItem("fr-theme");var th=s==="light"||s==="dark"?s:(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.setAttribute("data-theme",th);}catch(e){}})();</script>
<!-- theme-boot:end -->
  </head>
  <body>
    <div class="site-shell">
      ${siteHeader({ base })}
      <main class="evergreen-page tp-page">
        <div class="container">
          ${crumbs}
          <header class="evergreen-hero">
            <span class="section-kicker">${esc(kicker)}</span>
            <h1>${esc(h1)}</h1>
            <p>${esc(intro)}</p>
            <p class="evergreen-freshness"><time datetime="${data.dataDate}">Veri tarihi: ${data.dataDate}</time> · Saatler Türkiye saatiyle (TSİ). Her bilgi kaynak bağlantısı taşır; doğrulanmamış bilgiler "Güncelleniyor" olarak işaretlenir.</p>
          </header>
          ${main}
          ${pageShareHtml({ url: canonical, title: h1, locale: "tr" })}
        </div>
      </main>
      ${siteFooter({ base })}
    </div>
    <script src="${base}site.js" defer></script>
  </body>
</html>
`;
}

export function generateOne(providerId) {
  const entry = RICH_TEAM_PAGES[String(providerId)];
  if (!entry) throw new Error(`bilinmeyen rich team id: ${providerId}`);
  const data = loadData(entry);
  const html = buildPage(data, entry);
  for (const outRoot of [root, path.join(root, "public")]) {
    const dest = path.join(outRoot, entry.file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, html, "utf8");
  }
  const loc = `${SITE}/${entry.href}`;
  for (const sitemapPath of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) {
    if (!fs.existsSync(sitemapPath)) continue;
    const retained = (fs.readFileSync(sitemapPath, "utf8").match(URL_ENTRY_RE) || []).filter((e) => !e.includes(`<loc>${loc}</loc>`));
    const smEntry = `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${data.dataDate}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.75</priority>\n  </url>`;
    fs.writeFileSync(sitemapPath, wrapUrlset(retained.concat([smEntry])), "utf8");
  }
  console.log(`[rich-team-pages] ${entry.file} yazıldı.`);
  return { entry, data, html };
}

export function generateAll() {
  return Object.keys(RICH_TEAM_PAGES).map((id) => generateOne(id));
}

// Liverpool test uyumu
export const OUTPUT = { file: RICH_TEAM_PAGES["40"].file, loc: `${SITE}/${RICH_TEAM_PAGES["40"].href}` };
export function loadDataLiverpool() { return loadData(RICH_TEAM_PAGES["40"]); }

function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  if (only.length) only.forEach((id) => generateOne(id));
  else generateAll();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
