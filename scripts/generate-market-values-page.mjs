#!/usr/bin/env node
/**
 * Futbolcu piyasa değerleri kalıcı SEO sayfası.
 *
 * Çıktı: futbolcu-piyasa-degerleri.html (kök + public/), kanonik uzantısız.
 * Veri: data/market-values.json (kaynaklı listeler; değerler Transfermarkt tahmini).
 * Kural: kaynağı olmayan liste çizilmez; kulübü doğrulanmamış satırda kulüp "—" kalır.
 * Türk futbolcularda Süper Lig oyuncusunun profil sayfası varsa ona bağlanır.
 * Ortak başlık/altlık, manifest ve pwa.js postprocess zincirinde enjekte edilir.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { siteFooter, siteHeader } from "./lib/layout.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";
import { ROBOTS_INDEX, ROBOTS_NOINDEX_FOLLOW } from "./lib/robots.mjs";

const require = createRequire(import.meta.url);
const { isAllowedSourceUrl } = require("../services/sourceLinks.js");
const { playerLink } = require("../services/playerLinks.js");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteUrl = "https://www.futbolradar.com";
export const MARKET_VALUES_SLUG = "futbolcu-piyasa-degerleri";
const canonical = `${siteUrl}/${MARKET_VALUES_SLUG}`;

const readJson = (rel, fallback) => {
  try { return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8")); } catch { return fallback; }
};
const esc = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const src = (s) => `<a href="${esc(s.url)}" rel="nofollow noopener noreferrer" target="_blank">${esc(s.name)}</a>`;
const trDate = (iso) => {
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00+03:00`);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "long", year: "numeric" }).format(d);
};
const monthYear = (iso) => {
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00+03:00`);
  return Number.isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", month: "long", year: "numeric" }).format(d);
};
/** 220000000 → "220 milyon €", 6500000 → "6,5 milyon €". */
export const formatEur = (value) => {
  const m = Number(value) / 1e6;
  if (!Number.isFinite(m) || m <= 0) return "—";
  return `${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(m)} milyon €`;
};

const norm = (s) => String(s || "").toLocaleLowerCase("tr").normalize("NFC").trim();
function profileHref(name, base = "./") {
  const table = readJson("data/player-url-slugs.json", { entries: [] });
  const entry = (table.entries || []).find((e) => norm(e.fullName) === norm(name) || norm(e.name) === norm(name));
  return entry ? playerLink(entry.id, base) : null;
}

const validSource = (s) => Boolean(s && s.name && s.url && isAllowedSourceUrl(s.url));
const validRows = (rows) => (Array.isArray(rows) ? rows : [])
  .filter((r) => Number.isInteger(r.rank) && r.name && Number(r.valueEur) > 0)
  .sort((a, b) => a.rank - b.rank);

export function buildModel({ data = readJson("data/market-values.json", {}) } = {}) {
  const world = data.world && validSource(data.world.source) ? { ...data.world, players: validRows(data.world.players) } : null;
  const turkish = data.turkish && validSource(data.turkish.source)
    ? {
        ...data.turkish,
        players: validRows(data.turkish.players).map((p) => ({ ...p, href: profileHref(p.name) })),
        updates: (data.turkish.updates || []).filter((u) => u.text && validSource(u.source)).sort((a, b) => String(b.date).localeCompare(String(a.date)))
      }
    : null;
  const sections = { world: Boolean(world && world.players.length >= 10), turkish: Boolean(turkish && turkish.players.length >= 10) };
  const top = sections.world ? world.players[0] : null;
  const topTied = sections.world ? world.players.filter((p) => p.valueEur === top.valueEur) : [];
  // En değerli Türk: dünya listesinin güncel değeri, yoksa Türk listesi + sonraki güncelleme notu.
  const turkWorld = sections.world ? world.players.find((p) => p.turkish) : null;
  const turkTop = turkWorld
    ? { name: turkWorld.name, valueEur: turkWorld.valueEur, asOf: world.asOf, rank: turkWorld.rank }
    : sections.turkish ? { name: turkish.players[0].name, valueEur: turkish.players[0].valueEur, asOf: turkish.asOf } : null;
  return { data, world, turkish, sections, topTied, turkTop, indexable: sections.world, updatedAt: data.updatedAt || (world && world.asOf) };
}

function faqItems(m) {
  const q = [];
  if (m.sections.world) {
    const names = m.topTied.map((p) => p.name);
    q.push(["Dünyanın en değerli futbolcusu kim?", names.length > 1
      ? `Transfermarkt'ın ${monthYear(m.world.asOf)} verilerine göre ${names.join(" ve ")} ${formatEur(m.topTied[0].valueEur)} ile dünyanın en değerli futbolcuları.`
      : `Transfermarkt'ın ${monthYear(m.world.asOf)} verilerine göre ${names[0]} ${formatEur(m.topTied[0].valueEur)} ile dünyanın en değerli futbolcusu.`]);
  }
  if (m.turkTop) {
    q.push(["En değerli Türk futbolcu kim?", `${m.turkTop.name}, ${formatEur(m.turkTop.valueEur)} piyasa değeriyle en değerli Türk futbolcu${m.turkTop.rank ? `; dünya sıralamasında ${m.turkTop.rank}. sırada` : ""} (${monthYear(m.turkTop.asOf)}).`]);
  }
  q.push(["Piyasa değeri ne demek?", "Piyasa değeri, bir futbolcunun transfer piyasasında ne kadar edebileceğine dair bir tahmindir. Ödenen bonservis bedeli ya da sözleşmedeki serbest kalma maddesi değildir; oyuncunun yaşı, performansı, sözleşme süresi ve oynadığı lig gibi etkenlere göre düzenli olarak güncellenir."]);
  q.push(["Bu sayfadaki değerler nereden geliyor?", "Değerler Transfermarkt'ın tahminleridir ve her listenin altında, aktaran haber kaynağı ve tarihiyle birlikte gösterilir. Liste yeni bir güncelleme yayımlandığında yenilenir."]);
  return q;
}

function playerTable(rows, { caption, linkProfiles = false, highlightTurkish = false }) {
  const body = rows.map((p) => {
    const name = linkProfiles && p.href ? `<a href="${esc(p.href)}">${esc(p.name)}</a>` : esc(p.name);
    const flag = highlightTurkish && p.turkish ? ` <span class="mv-badge">Türk</span>` : "";
    const club = esc(p.club || "—");
    return `<tr${highlightTurkish && p.turkish ? ' class="mv-turkish"' : ""}><td class="mv-rank">${p.rank}</td><th scope="row">${name}${flag}<span class="mv-club-inline" aria-hidden="true">${club}</span></th><td class="mv-club">${club}</td><td class="mv-value">${esc(formatEur(p.valueEur))}</td></tr>`;
  }).join("");
  return `<div class="evergreen-table-wrap"><table class="evergreen-table mv-table"><caption>${esc(caption)}</caption><thead><tr><th scope="col">Sıra</th><th scope="col">Futbolcu</th><th scope="col" class="mv-club">Kulüp</th><th scope="col">Piyasa değeri</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function render(m) {
  const asOfLabel = m.sections.world ? monthYear(m.world.asOf) : monthYear(m.updatedAt);
  const title = `Futbolcu Piyasa Değerleri ${asOfLabel}: Dünyanın En Değerli Futbolcuları | FutbolRadar`;
  const description = m.sections.world
    ? `Dünyanın en değerli futbolcuları: ${m.topTied.map((p) => p.name).join(" ve ")} ${formatEur(m.topTied[0].valueEur)} ile zirvede.${m.turkTop ? ` En değerli Türk futbolcu ${m.turkTop.name} (${formatEur(m.turkTop.valueEur)}).` : ""} Transfermarkt verileri, ${asOfLabel}.`
    : "Futbolcu piyasa değerleri: dünyanın ve Türkiye'nin en değerli futbolcuları, Transfermarkt verileri ve kaynaklarıyla.";
  const h1 = `Futbolcu Piyasa Değerleri (${asOfLabel})`;
  const parts = [];
  const sources = new Map();
  const addSrc = (s) => { if (s && s.url) sources.set(s.url, s.name); };

  if (m.sections.world || m.turkTop) {
    const cards = [];
    if (m.sections.world) cards.push(`<article class="glass-card mv-stat"><span class="card-kicker">Dünyanın en değerlisi</span><strong>${esc(formatEur(m.topTied[0].valueEur))}</strong><p>${esc(m.topTied.map((p) => p.name).join(" ve "))}</p></article>`);
    if (m.turkTop) cards.push(`<article class="glass-card mv-stat"><span class="card-kicker">En değerli Türk futbolcu</span><strong>${esc(formatEur(m.turkTop.valueEur))}</strong><p>${esc(m.turkTop.name)}${m.turkTop.rank ? ` · dünyada ${m.turkTop.rank}. sırada` : ""}</p></article>`);
    if (m.sections.world) {
      const over100 = m.world.players.filter((p) => p.valueEur >= 100000000).length;
      if (over100 === m.world.players.length) cards.push(`<article class="glass-card mv-stat"><span class="card-kicker">Listedeki herkes</span><strong>100 milyon €+</strong><p>İlk ${m.world.players.length} futbolcunun her biri 100 milyon euro ve üzerinde</p></article>`);
    }
    parts.push(`<section class="mv-stats" aria-label="Öne çıkanlar">${cards.join("")}</section>`);
  }

  if (m.sections.world) {
    addSrc(m.world.source); addSrc(m.data.valueSource);
    parts.push(`<section class="evergreen-section" aria-labelledby="dunya-en-degerli"><h2 id="dunya-en-degerli">Dünyanın en değerli ${m.world.players.length} futbolcusu</h2><p>Transfermarkt'ın güncel değerlerine göre (${esc(trDate(m.world.asOf))} itibarıyla) dünyanın en değerli futbolcuları. Eşit değerdeki oyuncular kaynaktaki sırayla listelenmiştir.</p>${playerTable(m.world.players, { caption: `Dünyanın en değerli futbolcuları · ${trDate(m.world.asOf)}`, highlightTurkish: true })}<p class="mv-source">Değerler: ${src(m.data.valueSource)} · Aktaran: ${src(m.world.source)}</p></section>`);
  }

  if (m.sections.turkish) {
    const t = m.turkish;
    addSrc(t.source); addSrc(t.secondarySource);
    const updates = t.updates.length
      ? `<aside class="mv-updates" aria-labelledby="mv-updates-title"><h3 id="mv-updates-title">${esc(monthYear(t.asOf))} listesinden bu yana</h3><ul>${t.updates.map((u) => { addSrc(u.source); return `<li><time datetime="${esc(u.date)}">${esc(trDate(u.date))}</time>: ${esc(u.text)} <span class="mv-source">(${src(u.source)})</span></li>`; }).join("")}</ul></aside>`
      : "";
    parts.push(`<section class="evergreen-section" aria-labelledby="turk-en-degerli"><h2 id="turk-en-degerli">En değerli ${t.players.length} Türk futbolcu</h2><p>Transfermarkt'ın ${esc(monthYear(t.asOf))} verilerine göre en değerli Türk futbolcular. Süper Lig'de oynayan isimlerin profil sayfalarına adlarından ulaşabilirsiniz.</p>${playerTable(t.players, { caption: `En değerli Türk futbolcular · ${trDate(t.asOf)}`, linkProfiles: true })}${updates}<p class="mv-source">Değerler: ${src(m.data.valueSource)} · Aktaran: ${src(t.source)}${t.secondarySource ? `; ${src(t.secondarySource)}` : ""}</p></section>`);
  }

  parts.push(`<section class="evergreen-section" aria-labelledby="piyasa-degeri-nedir"><h2 id="piyasa-degeri-nedir">Piyasa değeri nedir, nasıl okunmalı?</h2><p>Piyasa değeri, bir futbolcunun transfer piyasasında ne kadar edebileceğine dair bir tahmindir. Ödenen bonservis bedeli ya da serbest kalma maddesi değildir. Yaş, performans, sözleşme süresi, oynanan lig ve sakatlık geçmişi gibi etkenlere göre yılda birkaç kez güncellenir.</p><p>Bu sayfadaki değerler Transfermarkt tahminleridir. Her listenin tarihi tablonun üstünde yazar; yeni bir güncelleme yayımlandığında liste yenilenir.</p></section>`);

  const faq = faqItems(m);
  parts.push(`<section class="evergreen-section" aria-labelledby="mv-sss"><h2 id="mv-sss">Sık sorulan sorular</h2>${faq.map(([q, a]) => `<details class="mv-faq"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}</section>`);
  parts.push(`<aside class="evergreen-related" aria-labelledby="mv-related"><h2 id="mv-related">İlginizi çekebilir</h2><div class="evergreen-link-grid"><a href="./istatistik-merkezi.html">İstatistik merkezi</a><a href="./oyuncu-liderleri.html">Oyuncu liderleri</a><a href="./super-lig-transferleri-2026-2027.html">Süper Lig transferleri 2026-27</a><a href="./oyuncu-karsilastirmalari.html">Oyuncu karşılaştırmaları</a></div></aside>`);

  const listNode = m.sections.world ? {
    "@type": "ItemList", "@id": `${canonical}#dunya`, name: `Dünyanın en değerli futbolcuları (${asOfLabel})`, numberOfItems: m.world.players.length,
    itemListElement: m.world.players.map((p) => ({ "@type": "ListItem", position: p.rank, item: { "@type": "Person", name: p.name, ...(p.club ? { affiliation: { "@type": "SportsTeam", name: p.club } } : {}) } }))
  } : null;
  const graph = [
    { "@type": "WebPage", "@id": `${canonical}#page`, url: canonical, name: title, description, inLanguage: "tr-TR", dateModified: m.updatedAt, citation: [...sources.keys()] },
    { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Ana Sayfa", item: `${siteUrl}/` }, { "@type": "ListItem", position: 2, name: "İstatistik Merkezi", item: `${siteUrl}/istatistik-merkezi.html` }, { "@type": "ListItem", position: 3, name: "Futbolcu Piyasa Değerleri", item: canonical }] },
    ...(listNode ? [listNode] : []),
    { "@type": "FAQPage", "@id": `${canonical}#faq`, mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) }
  ];

  const intro = "Dünyanın en değerli futbolcuları ve en değerli Türk futbolcular, güncel piyasa değerleriyle tek sayfada. Değerler Transfermarkt tahminleridir; her listenin tarihi ve kaynağı tablonun altında yer alır.";
  const css = `<style>.mv-stats{display:grid;grid-template-columns:1fr;gap:10px;margin:8px 0 20px}.mv-stat{padding:12px 14px;min-width:0;min-height:0;height:auto;aspect-ratio:auto}.mv-stat strong{display:block;font-size:1.5rem;line-height:1.2;margin:4px 0}.mv-stat p{margin:4px 0}.mv-value{white-space:nowrap}.mv-table th[scope=row]{white-space:normal}.mv-club-inline{display:none;font-weight:400;font-size:.85rem;opacity:.75}@media(max-width:599px){.mv-table .mv-club{display:none}.mv-club-inline{display:block}.mv-table td,.mv-table th{padding-left:6px;padding-right:6px}}.mv-rank{text-align:center;width:2.5em}.mv-value{font-weight:600;text-align:right}.mv-table thead th:last-child{text-align:right}.mv-turkish{background:rgba(227,10,23,.07)}.mv-badge{display:inline-block;font-size:.7rem;font-weight:700;padding:1px 6px;border-radius:999px;background:#e30a17;color:#fff;vertical-align:middle}.mv-source{font-size:.85rem;opacity:.85;overflow-wrap:anywhere}.mv-source a,.mv-table a,.evergreen-related a,.mv-updates a{display:inline-block;min-height:24px;line-height:24px}.mv-updates{margin:12px 0;padding:10px 14px;border-left:3px solid currentColor;opacity:.95}.mv-updates h3{margin:0 0 6px;font-size:1rem}.mv-updates ul{margin:0;padding-left:18px}.mv-faq summary{min-height:24px;padding:6px 0;cursor:pointer}.evergreen-table-wrap{max-width:100%;overflow-x:auto}@media(min-width:600px){.mv-stats{grid-template-columns:repeat(3,1fr)}}</style>`;
  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" />
    <meta name="robots" content="${m.indexable ? ROBOTS_INDEX : ROBOTS_NOINDEX_FOLLOW}" />
    <link rel="canonical" href="${canonical}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${siteUrl}/assets/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="manifest" href="./site.webmanifest" />
    <link rel="stylesheet" href="./page.css" />
    ${css}
    <script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replaceAll("<", "\\u003c")}</script>
  </head>
  <body>
    <div class="site-shell">
      ${siteHeader({ base: "./" })}
      <main class="evergreen-page" data-page="piyasa-degerleri">
        <div class="container">
          <nav class="evergreen-breadcrumb" aria-label="İçerik yolu"><a href="./">Ana Sayfa</a><span aria-hidden="true">/</span><a href="./istatistik-merkezi.html">İstatistik Merkezi</a><span aria-hidden="true">/</span><span aria-current="page">Futbolcu Piyasa Değerleri</span></nav>
          <header class="evergreen-hero">
            <span class="section-kicker">Transfer · Piyasa değerleri</span>
            <h1>${esc(h1)}</h1>
            <p>${esc(intro)}</p>
            <p class="mv-source">Son güncelleme: <time datetime="${esc(m.updatedAt)}">${esc(trDate(m.updatedAt))}</time></p>
          </header>
          ${parts.join("\n          ")}
        </div>
      </main>
      ${siteFooter({ base: "./" })}
    </div>
    <script src="./site.js" defer></script>
  </body>
</html>\n`;
}

function updateSitemap(file, indexable, lastmod) {
  if (!fs.existsSync(file)) return;
  const xml = fs.readFileSync(file, "utf8");
  const entries = (xml.match(URL_ENTRY_RE) || []).filter((e) => !e.includes(`<loc>${canonical}</loc>`));
  // Sitemap yalnızca indekslenebilir URL taşır; noindex ise kayıt düşer.
  if (indexable) entries.push(`  <url>\n    <loc>${canonical}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>`);
  fs.writeFileSync(file, wrapUrlset(entries), "utf8");
}

export function renderMarketValues(opts) { const m = buildModel(opts); return { model: m, html: render(m) }; }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { model, html } = renderMarketValues();
  for (const out of [root, path.join(root, "public")]) {
    fs.writeFileSync(path.join(out, `${MARKET_VALUES_SLUG}.html`), html, "utf8");
    updateSitemap(path.join(out, "sitemap.xml"), model.indexable, String(model.updatedAt || new Date().toISOString()).slice(0, 10));
  }
  console.log(`[market-values] üretildi (${model.indexable ? "index" : "noindex"}); bölümler: ${Object.entries(model.sections).filter(([, v]) => v).map(([k]) => k).join(", ")}`);
}
