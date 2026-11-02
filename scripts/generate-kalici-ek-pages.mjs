#!/usr/bin/env node
/**
 * KALICI EK SEO SAYFALARI — mevcut takım/istatistik/transfer yüzeylerinin
 * BOŞLUKLARINI dolduran üç kalıcı adres (31 Ekim 2026 boşluk analizi):
 *
 *   /super-lig-mac-istatistikleri        Maç bazlı istatistik karşılaştırma merkezi
 *                                        (API-Football maç istatistiği olan Süper Lig maçları)
 *   /super-lig-takimlari-avrupa-maclari  Süper Lig kulüplerinin UEFA maçları
 *   /transfer-radari                     Takım bazlı transfer iddiaları + tamamlanan transfer sayıları
 *
 * VERİ KURALI. Hiçbir değer uydurulmaz. Maç kaydı yalnızca API-Football
 * fikstür kimliği (providerIds.apiFootball / providerId) taşıyorsa basılır ve
 * sayfa "Veri: API-Football" atfı verir. Transfer iddiası yalnızca kaynak adresi
 * services/sourceLinks.js beyaz listesindeyse basılır, "İddia" etiketi ve tarihiyle.
 * Veri eşiği tutmayan sayfa noindex,follow yazılır ve sitemap'ten çıkarılır.
 * lastmod / dateModified = verinin kendi tarihi, derleme günü değil.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { siteFooter, siteHeader } from "./lib/layout.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";
import { ROBOTS_INDEX, ROBOTS_NOINDEX_FOLLOW } from "./lib/robots.mjs";

const require = createRequire(import.meta.url);
const { isAllowedSourceUrl, hostOf } = require("../services/sourceLinks.js");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteUrl = "https://www.futbolradar.com";
const socialImage = `${siteUrl}/assets/og-image.png`;
const API_FOOTBALL_URL = "https://www.api-football.com/";

export const MIN_STAT_MATCHES = 6;
export const MIN_EUROPE_MATCHES = 12;
export const MIN_RUMOURS = 5;

const SUPER_LIG_TEAMS = [
  ["galatasaray", "Galatasaray", ["galatasaray"]],
  ["fenerbahce", "Fenerbahçe", ["fenerbahce"]],
  ["besiktas", "Beşiktaş", ["besiktas"]],
  ["trabzonspor", "Trabzonspor", ["trabzonspor"]],
  ["samsunspor", "Samsunspor", ["samsunspor"]],
  ["basaksehir", "Başakşehir", ["basaksehir"]],
  ["konyaspor", "Konyaspor", ["konyaspor"]],
  ["goztepe", "Göztepe", ["goztepe"]],
  ["alanyaspor", "Alanyaspor", ["alanyaspor"]],
  ["genclerbirligi", "Gençlerbirliği", ["genclerbirligi"]],
  ["kasimpasa", "Kasımpaşa", ["kasimpasa"]],
  ["rizespor", "Rizespor", ["rizespor"]],
  ["erzurumspor", "Erzurumspor", ["erzurumspor"]],
  ["gaziantep-fk", "Gaziantep FK", ["gaziantep"]],
  ["amed", "Amed", ["amed"]],
  ["eyupspor", "Eyüpspor", ["eyupspor"]],
  ["corum-fk", "Çorum FK", ["corum"]],
  ["kocaelispor", "Kocaelispor", ["kocaelispor"]]
];

export const fold = (v) => String(v ?? "").toLocaleLowerCase("tr").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i");
export function teamOf(name) {
  const f = fold(name);
  if (/\bu(19|21|23)\b/.test(f)) return null; // altyapı takımları ayrı yarışma
  return SUPER_LIG_TEAMS.find(([, , keys]) => keys.some((k) => f.includes(k))) || null;
}

const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const DAY = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "long", year: "numeric" });
const dayLabel = (iso) => DAY.format(new Date(iso));
const ymd = (iso) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });
const srcLink = (url, name) => `<a href="${esc(url)}" target="_blank" rel="nofollow noopener noreferrer">${esc(name)}</a>`;
const API_ATTR = `Veri: ${srcLink(API_FOOTBALL_URL, "API-Football")}`;
const readJson = (rel, fallback) => { try { return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8")); } catch { return fallback; } };
const apiId = (m) => (m.providerIds && m.providerIds.apiFootball) || (/^\d+$/.test(String(m.providerId || "")) ? String(m.providerId) : null);
const reportHref = (m) => (m.reportPage && fs.existsSync(path.join(root, m.reportPage)) ? `./${m.reportPage}` : null);

/* ---------------- veri seçimi ---------------- */

export function statMatches(archive) {
  return (archive.records || []).map((r) => r.match)
    .filter((m) => m && m.league === "Süper Lig" && m.status === "FINISHED" && apiId(m) && Array.isArray(m.statistics) && m.statistics.length >= 8)
    .sort((a, b) => String(b.kickoff).localeCompare(String(a.kickoff)));
}

const EUROPE_RE = /(UEFA|Şampiyonlar Ligi|Avrupa Ligi|Konferans Ligi|Champions League|Europa League|Conference League)/i;
export function europeMatches(archive, calendar) {
  const all = [...(archive.records || []).map((r) => r.match), ...((calendar && calendar.matches) || [])];
  const seen = new Map();
  for (const m of all) {
    if (!m || !EUROPE_RE.test(`${m.league || ""} ${m.competition || ""}`) || /youth|gençlik/i.test(m.league || "")) continue;
    const id = apiId(m);
    if (!id) continue; // kaynak kimliği olmayan maç basılmaz
    const team = teamOf(m.homeTeam) || teamOf(m.awayTeam);
    if (!team) continue;
    if (!seen.has(id)) seen.set(id, { ...m, apiId: id, team });
  }
  return [...seen.values()].sort((a, b) => String(a.kickoff).localeCompare(String(b.kickoff)));
}

export function rumourItems(ticker) {
  const items = (ticker && Array.isArray(ticker.items)) ? ticker.items : [];
  return items.filter((it) => /dedikodu|iddia|söylenti|rumou?r/i.test(it.status || "") && it.text && isAllowedSourceUrl(it.source_url))
    .map((it) => {
      const m = String(it.source_url).match(/\/(20\d{2})\/(\d{2})\/(\d{2})\//);
      return { ...it, team: teamOf(it.text), date: m ? `${m[1]}-${m[2]}-${m[3]}` : null, dateKind: m ? "haber" : "liste" };
    });
}

/* ---------------- ortak şablon ---------------- */

function pageShell({ slug, title, description, h1, kicker, intro, freshness, indexable, graph, crumbs, body }) {
  const canonical = `${siteUrl}/${slug}`;
  const crumbHtml = crumbs.map(([label, href], i) => (i === crumbs.length - 1 ? `<span aria-current="page">${esc(label)}</span>` : `<a href="${href}">${esc(label)}</a>`)).join('<span aria-hidden="true">/</span>');
  const breadcrumb = { "@type": "BreadcrumbList", itemListElement: crumbs.map(([label, href], i) => ({ "@type": "ListItem", position: i + 1, name: label, item: i === crumbs.length - 1 ? canonical : `${siteUrl}/${href.replace(/^\.\//, "")}` })) };
  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" />
    <meta name="robots" content="${indexable ? ROBOTS_INDEX : ROBOTS_NOINDEX_FOLLOW}" />
    <link rel="canonical" href="${canonical}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${socialImage}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(title)}" />
    <meta name="twitter:description" content="${esc(description)}" />
    <meta name="twitter:image" content="${socialImage}" />
    <link rel="icon" href="./favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="./site.webmanifest" />
    <link rel="stylesheet" href="./page.css" />
    <style>.kalici-ek .kx-card{border:1px solid var(--line,#d9dee7);border-radius:12px;padding:12px;margin:12px 0}.kalici-ek .kx-card h3{margin:0 0 6px;font-size:1.05rem}.kalici-ek .kx-meta{font-size:.85rem;opacity:.8;margin:0 0 8px}.kalici-ek .kx-badge{display:inline-block;font-size:.75rem;font-weight:700;border-radius:999px;padding:2px 8px;margin-right:6px;background:#fff4d6;color:#7a4b00}.kalici-ek .kx-badge.ok{background:#e3f6e8;color:#14532d}.kalici-ek .kx-jump{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}.kalici-ek .kx-jump a,.kalici-ek .kx-links a{display:inline-flex;align-items:center;min-height:36px;padding:4px 12px;border-radius:999px;border:1px solid var(--line,#d9dee7);text-decoration:none}.kalici-ek .kx-links{display:flex;flex-wrap:wrap;gap:8px}.kalici-ek table{width:100%}.kalici-ek td,.kalici-ek th{overflow-wrap:anywhere}.kalici-ek td a,.kalici-ek th a,.kalici-ek .kx-card h3 a,.kalici-ek .kx-meta a,.kalici-ek .evergreen-breadcrumb a,.kalici-ek .evergreen-note a{display:inline-flex;align-items:center;min-height:32px}</style>
    <script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": [...graph, breadcrumb] }).replaceAll("<", "\\u003c")}</script>
  </head>
  <body>
    <div class="site-shell">
      ${siteHeader({ base: "./" })}
      <main class="evergreen-page kalici-ek" id="${esc(slug)}">
        <div class="container">
          <nav class="evergreen-breadcrumb" aria-label="İçerik yolu">${crumbHtml}</nav>
          <header class="evergreen-hero">
            <span class="section-kicker">${esc(kicker)}</span>
            <h1>${esc(h1)}</h1>
            <p>${intro}</p>
            <p class="evergreen-freshness">${freshness}</p>
          </header>
${body}
        </div>
      </main>
      ${siteFooter({ base: "./" })}
    </div>
    <script src="./site.js" defer></script>
  </body>
</html>
`;
}

const relatedNav = (title) => `          <aside class="evergreen-related" aria-labelledby="kx-related"><h2 id="kx-related">${esc(title)}</h2><div class="kx-links"><a href="./istatistik-merkezi.html">İstatistik Merkezi</a><a href="./gol-kralligi.html">Gol krallığı</a><a href="./asist-kralligi.html">Asist krallığı</a><a href="./super-lig-mac-istatistikleri">Maç istatistikleri</a><a href="./super-lig-takimlari-avrupa-maclari">Avrupa maçları</a><a href="./transfer-radari">Transfer Radarı</a><a href="./super-lig-transferleri-2026-2027.html">Süper Lig transferleri</a><a href="./super-lig-puan-durumu">Puan durumu</a><a href="./takimlar">Tüm takımlar</a></div></aside>`;

const sportsTeam = (name) => {
  const t = teamOf(name);
  return t ? { "@type": "SportsTeam", name: t[1], url: `${siteUrl}/takimlar/${t[0]}`, sport: "Futbol" } : { "@type": "SportsTeam", name, sport: "Futbol" };
};
const sportsEvent = (m, url) => ({
  "@type": "SportsEvent",
  name: `${m.homeTeam} - ${m.awayTeam}`,
  startDate: m.kickoff,
  eventStatus: m.status === "FINISHED" ? "https://schema.org/EventCompleted" : "https://schema.org/EventScheduled",
  sport: "Futbol",
  homeTeam: sportsTeam(m.homeTeam),
  awayTeam: sportsTeam(m.awayTeam),
  competitor: [sportsTeam(m.homeTeam), sportsTeam(m.awayTeam)],
  superEvent: { "@type": "SportsEvent", name: m.league || m.competition },
  ...(m.venue ? { location: { "@type": "Place", name: m.venue } } : {}),
  ...(url ? { url } : {})
});
const teamLink = (name) => { const t = teamOf(name); return t ? `<a href="./takimlar/${t[0]}">${esc(name)}</a>` : esc(name); };
const scoreText = (m) => (m.score && m.score.home != null && m.score.away != null ? `${m.score.home}-${m.score.away}` : "–");

/* ---------------- 1) maç istatistikleri ---------------- */

const KEY_STATS = ["Topla oynama", "Toplam şut", "İsabetli şut", "Gol beklentisi (xG)", "Korner", "Faul", "Ofsayt", "Pas isabeti", "Sarı kart", "Kırmızı kart"];
const statVal = (m, type, side) => { const s = m.statistics.find((x) => x.type === type); if (!s || s[side] == null || s[side] === "") return null; return s[side]; };
const fmtStat = (v, type) => (v == null ? "—" : (/oynama|isabeti/i.test(type) && !String(v).includes("%") ? `%${v}` : String(v)));
const num = (v) => (v == null ? null : Number(String(v).replace("%", "")));

export function buildStatsPage(archive) {
  const matches = statMatches(archive);
  const indexable = matches.length >= MIN_STAT_MATCHES;
  const dataDate = archive.updatedAt;
  const slug = "super-lig-mac-istatistikleri";
  const totalShots = (m) => (num(statVal(m, "Toplam şut", "home")) ?? 0) + (num(statVal(m, "Toplam şut", "away")) ?? 0);
  const cards = (m, side) => (num(statVal(m, "Sarı kart", side)) ?? 0) + (num(statVal(m, "Kırmızı kart", side)) ?? 0);
  const topShots = [...matches].sort((a, b) => totalShots(b) - totalShots(a))[0];
  const topCards = [...matches].sort((a, b) => (cards(b, "home") + cards(b, "away")) - (cards(a, "home") + cards(a, "away")))[0];
  const cards2 = topCards ? cards(topCards, "home") + cards(topCards, "away") : 0;

  const cardsHtml = matches.map((m) => {
    const href = reportHref(m);
    const rows = KEY_STATS.map((t) => [t, statVal(m, t, "home"), statVal(m, t, "away")]).filter(([, h, a]) => h != null || a != null)
      .map(([t, h, a]) => `<tr><td>${fmtStat(h, t)}</td><th scope="row">${esc(t)}</th><td>${fmtStat(a, t)}</td></tr>`).join("");
    return `            <article class="kx-card" id="mac-${esc(m.id)}">
              <h3>${teamLink(m.homeTeam)} ${esc(scoreText(m))} ${teamLink(m.awayTeam)}</h3>
              <p class="kx-meta"><time datetime="${esc(m.kickoff)}">${esc(dayLabel(m.kickoff))}</time>${m.venue ? ` · ${esc(m.venue)}` : ""} · ${API_ATTR} (fikstür #${esc(apiId(m))})</p>
              <div class="evergreen-table-wrap"><table class="evergreen-table"><caption>${esc(m.homeTeam)} – ${esc(m.awayTeam)} istatistik karşılaştırması</caption><thead><tr><th scope="col">${esc(m.homeTeam)}</th><th scope="col">İstatistik</th><th scope="col">${esc(m.awayTeam)}</th></tr></thead><tbody>${rows}</tbody></table></div>
              ${href ? `<p><a href="${href}">Maç raporu: ${esc(m.homeTeam)} – ${esc(m.awayTeam)}</a></p>` : ""}
            </article>`;
  }).join("\n");

  const graph = [
    { "@type": "CollectionPage", "@id": `${siteUrl}/${slug}#page`, name: "Süper Lig maç istatistikleri", url: `${siteUrl}/${slug}`, inLanguage: "tr-TR", dateModified: dataDate, isPartOf: { "@type": "WebSite", name: "FutbolRadar", url: `${siteUrl}/` }, mainEntity: { "@id": `${siteUrl}/${slug}#maclar` } },
    { "@type": "ItemList", "@id": `${siteUrl}/${slug}#maclar`, name: "İstatistiği olan Süper Lig maçları", numberOfItems: matches.length, itemListElement: matches.map((m, i) => ({ "@type": "ListItem", position: i + 1, item: sportsEvent(m, `${siteUrl}/${slug}#mac-${m.id}`) })) }
  ];
  const body = `          <section class="evergreen-section" id="ozet" aria-labelledby="ozet-baslik">
            <h2 id="ozet-baslik">Öne çıkan maç istatistikleri</h2>
            <ul>
              ${topShots ? `<li>En çok şutlu maç: <a href="#mac-${esc(topShots.id)}">${esc(topShots.homeTeam)} – ${esc(topShots.awayTeam)}</a> (${totalShots(topShots)} şut).</li>` : ""}
              ${topCards && cards2 ? `<li>En çok kartlı maç: <a href="#mac-${esc(topCards.id)}">${esc(topCards.homeTeam)} – ${esc(topCards.awayTeam)}</a> (${cards2} kart).</li>` : ""}
              <li>Bu sayfadaki maç sayısı: ${matches.length}. Yalnızca API-Football maç istatistiği arşivimize işlenmiş maçlar listelenir; diğer maçlar eklendikçe sayfa güncellenir.</li>
            </ul>
          </section>
          <section class="evergreen-section" id="maclar" aria-labelledby="maclar-baslik">
            <h2 id="maclar-baslik">Maç maç istatistik karşılaştırması</h2>
${cardsHtml || "            <p>Güncelleniyor.</p>"}
          </section>
          <section class="evergreen-section" id="kart-kralligi" aria-labelledby="kart-baslik">
            <h2 id="kart-baslik">Kart kralları (sarı ve kırmızı kart)</h2>
            <p><strong>Güncelleniyor.</strong> Oyuncu bazlı sezonluk kart verisi henüz arşivimizde tüm maçlar için yok; eksik veriyle sıralama yayımlamıyoruz. Maç bazlı takım kart sayıları yukarıdaki tablolarda yer alıyor. Gol ve asist sıralamaları için <a href="./gol-kralligi.html">gol krallığı</a> ve <a href="./asist-kralligi.html">asist krallığı</a> sayfalarına bakın.</p>
          </section>
${relatedNav("İstatistik Merkezi'nden devam edin")}`;
  return {
    slug, indexable, lastmod: ymd(dataDate),
    html: pageShell({
      slug, indexable, graph, body,
      title: "Süper Lig Maç İstatistikleri 2026-27: Şut, xG, Kart Karşılaştırması",
      description: `Süper Lig 2026-27 maçlarının şut, isabetli şut, xG, topla oynama, korner, faul ve kart istatistikleri maç maç karşılaştırmalı. ${matches.length} maç, veri: API-Football.`,
      h1: "Süper Lig maç istatistikleri ve karşılaştırmalar (2026-27)",
      kicker: "İstatistik Merkezi · Maç bazlı",
      intro: "Süper Lig maçlarında iki takımın şut, isabetli şut, gol beklentisi (xG), topla oynama, korner, faul ve kart sayıları yan yana. Değerler maç sağlayıcısının resmî istatistik dökümünden alınır; tahmin ya da tamamlama yapılmaz.",
      freshness: `Veri tarihi: <time datetime="${esc(dataDate)}">${esc(dayLabel(dataDate))}</time> · ${API_ATTR}`,
      crumbs: [["Ana Sayfa", "./"], ["İstatistik Merkezi", "./istatistik-merkezi.html"], ["Maç istatistikleri", "./super-lig-mac-istatistikleri"]]
    })
  };
}

/* ---------------- 2) Avrupa maçları ---------------- */

export function buildEuropePage(archive, calendar) {
  const matches = europeMatches(archive, calendar);
  const finished = matches.filter((m) => m.status === "FINISHED");
  const indexable = finished.length >= MIN_EUROPE_MATCHES;
  const dataDate = [archive.updatedAt, calendar && calendar.fetchedAt].filter(Boolean).sort().at(-1);
  const slug = "super-lig-takimlari-avrupa-maclari";
  const byTeam = new Map();
  for (const m of matches) { const k = m.team[0]; if (!byTeam.has(k)) byTeam.set(k, { team: m.team, rows: [] }); byTeam.get(k).rows.push(m); }
  const groups = SUPER_LIG_TEAMS.map(([k]) => byTeam.get(k)).filter(Boolean);
  const sections = groups.map(({ team, rows }) => {
    const tr = rows.map((m) => { const href = reportHref(m); return `<tr><td><time datetime="${esc(m.kickoff)}">${esc(dayLabel(m.kickoff))}</time></td><td>${esc(m.league)}${m.stage ? `<br /><small>${esc(m.stage)}</small>` : ""}</td><td>${teamLink(m.homeTeam)} <strong>${esc(m.status === "FINISHED" ? scoreText(m) : "–")}</strong> ${teamLink(m.awayTeam)}${href ? `<br /><a href="${href}">Maç raporu</a>` : ""}</td><td>${m.status === "FINISHED" ? "Oynandı" : "Programda"}</td></tr>`; }).join("");
    const extra = team[0] === "fenerbahce" ? `<p><a href="./fenerbahce-avrupa-maclari.html">Fenerbahçe Avrupa maçları rehberi</a></p>` : "";
    return `          <section class="evergreen-section" id="${esc(team[0])}" aria-labelledby="${esc(team[0])}-baslik">
            <h2 id="${esc(team[0])}-baslik">${esc(team[1])} Avrupa maçları</h2>
            <div class="evergreen-table-wrap"><table class="evergreen-table"><caption>${esc(team[1])} UEFA maçları (kaynaklı kayıtlar)</caption><thead><tr><th scope="col">Tarih</th><th scope="col">Organizasyon</th><th scope="col">Maç</th><th scope="col">Durum</th></tr></thead><tbody>${tr}</tbody></table></div>
            <p class="evergreen-note"><a href="./takimlar/${esc(team[0])}">${esc(team[1])} takım profili</a> · ${API_ATTR}</p>${extra}
          </section>`;
  }).join("\n");
  const graph = [
    { "@type": "CollectionPage", "@id": `${siteUrl}/${slug}#page`, name: "Süper Lig takımlarının Avrupa maçları", url: `${siteUrl}/${slug}`, inLanguage: "tr-TR", dateModified: dataDate, isPartOf: { "@type": "WebSite", name: "FutbolRadar", url: `${siteUrl}/` } },
    { "@type": "ItemList", name: "Süper Lig kulüplerinin UEFA maçları 2026-27", numberOfItems: matches.length, itemListElement: matches.map((m, i) => ({ "@type": "ListItem", position: i + 1, item: sportsEvent(m, `${siteUrl}/${slug}#${m.team[0]}`) })) }
  ];
  const body = `          <nav class="kx-jump" aria-label="Takıma git">${groups.map(({ team }) => `<a href="#${esc(team[0])}">${esc(team[1])}</a>`).join("")}</nav>
          <section class="evergreen-section" id="kapsam" aria-labelledby="kapsam-baslik">
            <h2 id="kapsam-baslik">Kapsam ve veri durumu</h2>
            <p>Bu sayfada yalnızca API-Football fikstür kimliğiyle doğrulanmış ${matches.length} UEFA maçı (${finished.length} oynanmış) yer alıyor. Sağlayıcı doğrulaması bekleyen diğer Avrupa maçları <strong>güncelleniyor</strong>; liste bu nedenle bir kulübün tüm Avrupa maçlarını kapsamayabilir. Son 5 sezonun Avrupa sonuçları için kaynaklı veri henüz yok, bu bölüm eklenmedi.</p>
          </section>
${sections || "          <p>Güncelleniyor.</p>"}
${relatedNav("Takım ve istatistik sayfaları")}`;
  return {
    slug, indexable, lastmod: ymd(dataDate),
    html: pageShell({
      slug, indexable, graph, body,
      title: "Türk Takımlarının Avrupa Maçları 2026-27: Sonuçlar ve Fikstür",
      description: "Galatasaray, Fenerbahçe, Beşiktaş, Trabzonspor ve Başakşehir'in UEFA Şampiyonlar Ligi, Avrupa Ligi ve Konferans Ligi maçları; skorlar ve tarihler. Veri: API-Football.",
      h1: "Süper Lig takımlarının Avrupa maçları (2026-27)",
      kicker: "Takımlar · UEFA",
      intro: "Süper Lig kulüplerinin 2026-27 sezonundaki UEFA Şampiyonlar Ligi, Avrupa Ligi ve Konferans Ligi maçları takım takım. Skorlar maç sağlayıcısının fikstür kaydından gelir.",
      freshness: `Veri tarihi: <time datetime="${esc(dataDate)}">${esc(dayLabel(dataDate))}</time> · ${API_ATTR}`,
      crumbs: [["Ana Sayfa", "./"], ["Takımlar", "./takimlar"], ["Avrupa maçları", "./super-lig-takimlari-avrupa-maclari"]]
    })
  };
}

/* ---------------- 3) Transfer Radarı ---------------- */

export function buildTransferRadarPage(transfers, ticker) {
  const rumours = rumourItems(ticker);
  const indexable = rumours.length >= MIN_RUMOURS;
  const confirmed = (Array.isArray(transfers) ? transfers : []).filter((t) => t.status === "confirmed" && isAllowedSourceUrl(t.sourceUrl));
  const latestConfirmed = confirmed.map((t) => t.lastVerifiedAt || t.date).filter(Boolean).sort().at(-1);
  const dataDate = [latestConfirmed, ticker && ticker.updatedAt].filter(Boolean).map((d) => new Date(d).toISOString()).sort().at(-1);
  const slug = "transfer-radari";
  const rows = SUPER_LIG_TEAMS.map(([key, name]) => {
    const inbound = confirmed.filter((t) => teamOf(t.toTeam)?.[0] === key).length;
    const outbound = confirmed.filter((t) => teamOf(t.fromTeam)?.[0] === key).length;
    const rum = rumours.filter((r) => r.team?.[0] === key);
    return { key, name, inbound, outbound, rum };
  });
  const tableRows = rows.map((r) => `<tr><th scope="row"><a href="./takimlar/${r.key}">${esc(r.name)}</a></th><td>${r.inbound}</td><td>${r.outbound}</td><td>${r.rum.length ? `<a href="#iddia-${r.key}">${r.rum.length}</a>` : "0"}</td></tr>`).join("");
  const rumourSections = rows.filter((r) => r.rum.length).map((r) => `          <section class="evergreen-section" id="iddia-${r.key}" aria-labelledby="iddia-${r.key}-baslik">
            <h2 id="iddia-${r.key}-baslik">${esc(r.name)} transfer iddiaları</h2>
${r.rum.map((it) => `            <article class="kx-card"><p><span class="kx-badge">İddia / dedikodu</span>${esc(it.text)}</p><p class="kx-meta">Kaynak: ${srcLink(it.source_url, it.source_name || hostOf(it.source_url))}${it.date ? ` · Haber tarihi: <time datetime="${it.date}">${esc(dayLabel(`${it.date}T12:00:00+03:00`))}</time>` : ticker.updatedAt ? ` · Listeye alındı: <time datetime="${esc(ticker.updatedAt)}">${esc(dayLabel(ticker.updatedAt))}</time>` : ""}</p></article>`).join("\n")}
          </section>`).join("\n");
  const graph = [
    { "@type": "CollectionPage", "@id": `${siteUrl}/${slug}#page`, name: "Transfer Radarı", url: `${siteUrl}/${slug}`, inLanguage: "tr-TR", ...(dataDate ? { dateModified: dataDate } : {}), isPartOf: { "@type": "WebSite", name: "FutbolRadar", url: `${siteUrl}/` } },
    { "@type": "ItemList", name: "Süper Lig kulüpleri transfer özeti", numberOfItems: rows.length, itemListElement: rows.map((r, i) => ({ "@type": "ListItem", position: i + 1, item: { "@type": "SportsTeam", name: r.name, url: `${siteUrl}/takimlar/${r.key}`, sport: "Futbol" } })) }
  ];
  const body = `          <section class="evergreen-section" id="ozet" aria-labelledby="ozet-baslik">
            <h2 id="ozet-baslik">Takım bazlı transfer özeti</h2>
            <p><span class="kx-badge ok">Resmî</span> sütunları kaynaklı ve tamamlanmış transferleri sayar (ayrıntı ve kaynak linkleri: <a href="./super-lig-transferleri-2026-2027.html">Süper Lig transferleri 2026-2027</a>). <span class="kx-badge">İddia</span> sütunu basında çıkan, henüz resmîleşmemiş haberleri sayar; bunlar kesin bilgi değildir.</p>
            <div class="evergreen-table-wrap"><table class="evergreen-table"><caption>Süper Lig kulüpleri: tamamlanan transferler ve iddialar</caption><thead><tr><th scope="col">Takım</th><th scope="col">Gelen (resmî)</th><th scope="col">Giden (resmî)</th><th scope="col">İddia</th></tr></thead><tbody>${tableRows}</tbody></table></div>
          </section>
${rumourSections || `          <section class="evergreen-section" id="iddialar" aria-labelledby="iddialar-baslik"><h2 id="iddialar-baslik">Güncel transfer iddiaları</h2><p><strong>Güncelleniyor.</strong> Kaynağı doğrulanmış güncel transfer iddiası şu an listede yok.</p></section>`}
          <section class="evergreen-section" id="kurallar" aria-labelledby="kurallar-baslik">
            <h2 id="kurallar-baslik">Transfer Radarı nasıl hazırlanıyor?</h2>
            <p>İddialar yalnızca güvenilir kabul ettiğimiz spor yayınlarından, kaynak linki ve tarihiyle alınır ve her zaman "İddia / dedikodu" etiketi taşır. Kulüp ya da KAP duyurusuyla resmîleşen transferler <a href="./super-lig-transferleri-2026-2027.html">transfer listesine</a> taşınır. Ara transfer dönemi tarihleri: <a href="./transfer-donemi-2026-27">Transfer dönemi 2026-27</a>.</p>
          </section>
${relatedNav("Transfer ve takım sayfaları")}`;
  return {
    slug, indexable, lastmod: dataDate ? ymd(dataDate) : null,
    html: pageShell({
      slug, indexable, graph, body,
      title: "Transfer Radarı: Süper Lig Transfer İddiaları ve Resmî Transferler",
      description: `Süper Lig kulüplerinin güncel transfer iddiaları (kaynak ve tarihle, "iddia" etiketiyle) ve tamamlanan ${confirmed.length} resmî transferin takım bazlı özeti.`,
      h1: "Transfer Radarı: Süper Lig transfer iddiaları ve tamamlanan transferler",
      kicker: "Transfer · Takım bazlı",
      intro: "Hangi Süper Lig takımı kimi istiyor, kim resmen geldi? Basında çıkan iddialar kaynak ve tarihle, resmîleşen transferler ayrı sütunda; ikisi asla karıştırılmaz.",
      freshness: dataDate ? `Veri tarihi: <time datetime="${esc(dataDate)}">${esc(dayLabel(dataDate))}</time>` : "Veri tarihi: güncelleniyor",
      crumbs: [["Ana Sayfa", "./"], ["Transfer", "./super-lig-transferleri-2026-2027.html"], ["Transfer Radarı", "./transfer-radari"]]
    })
  };
}

/* ---------------- yazım + sitemap ---------------- */

export function applySitemap(xml, page) {
  const loc = `${siteUrl}/${page.slug}`;
  const existing = (xml.match(URL_ENTRY_RE) || []).filter((e) => !e.includes(`<loc>${loc}</loc>`) && !e.includes(`<loc>${loc}.html</loc>`));
  if (!page.indexable || !page.lastmod) return wrapUrlset(existing);
  return wrapUrlset([...existing, `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${page.lastmod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.7</priority>\n  </url>`]);
}

export function buildAll() {
  const archive = readJson("data/historical-match-archive.json", { records: [] });
  const calendar = readJson("data/fixture-calendar.json", { matches: [] });
  const transfers = readJson("data/transfers.json", []);
  const ticker = readJson("data/transfer-ticker.json", null);
  return [buildStatsPage(archive), buildEuropePage(archive, calendar), buildTransferRadarPage(transfers, ticker)];
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const pages = buildAll();
  for (const outputRoot of [root, path.join(root, "public")]) {
    for (const page of pages) {
      const target = path.join(outputRoot, `${page.slug}.html`);
      const prev = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
      if (prev !== page.html) fs.writeFileSync(target, page.html, "utf8");
    }
    const sm = path.join(outputRoot, "sitemap.xml");
    if (fs.existsSync(sm)) {
      const xml = fs.readFileSync(sm, "utf8");
      const next = pages.reduce((acc, p) => applySitemap(acc, p), xml);
      if (next !== xml) fs.writeFileSync(sm, next, "utf8");
    }
  }
  for (const p of pages) console.log(`[kalici-ek] ${p.slug}.html · ${p.indexable ? "index" : "noindex"} · lastmod ${p.lastmod}`);
}
