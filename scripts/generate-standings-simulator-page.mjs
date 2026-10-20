#!/usr/bin/env node
/**
 * /puan-durumu-simulator — PUAN DURUMU SİMÜLATÖRÜ.
 *
 * Resmî tablo ve kalan maçlar derlemede sayfaya gömülür; seçimler tarayıcıda
 * hesaplanır (services/standingsSimulator.js). Çalışma anında ağ isteği yok.
 * Veri doğrulanamazsa simülasyon basılmaz: sayfa dürüst bir boş durumla
 * noindex yayınlanır ve site haritasından çıkar (uydurma satır yok).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { siteFooter, siteHeader } from "./lib/layout.mjs";
import { ROBOTS_INDEX, ROBOTS_NOINDEX_FOLLOW } from "./lib/robots.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";
import { createRequire } from "node:module";
import { buildSuperLigSimulator } from "./lib/standingsSimulatorData.mjs";

const { zoneFor } = createRequire(import.meta.url)("../services/standingsSimulator.js");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteUrl = "https://www.futbolradar.com";
const CANONICAL = `${siteUrl}/puan-durumu-simulator`;
const CORE_SOURCE = path.join(root, "services", "standingsSimulator.js");
const CORE_FILE = "standings-simulator-core.js";
const CORE_BANNER = "/* ÜRETİLMİŞ DOSYA — kaynak: services/standingsSimulator.js. Elle düzenlemeyin;\n   `node scripts/generate-standings-simulator-page.mjs` ile yeniden üretilir. */\n";

export const PAGE_TITLE = "Süper Lig Puan Durumu Simülatörü: Kalan Maçları Sen Belirle | FutbolRadar";
export const PAGE_DESCRIPTION = "Süper Lig kalan maçlarına skor gir, puan durumu anında yeniden hesaplansın: sıra, averaj, şampiyonluk, Avrupa ve küme düşme hattı. Olasılık tahmini yok, yalnızca gerçek tablo ve fikstür.";

const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

const ZONE_CLASS = { champion: " is-leader", europe: " is-europe", relegation: " is-relegation" };

function trDate(iso) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hour12: false });
}

/** Gömülen veri: satırlar + [maç kimliği, hafta, ev, deplasman, başlama] dizileri. */
export function compactPayload(data) {
  const index = new Map(data.rows.map((row, i) => [row.id, i]));
  return {
    v: data.standingsAt,
    rows: data.rows.map(({ id, name, slug, rank, played, won, drawn, lost, goalsFor, goalsAgainst, points }) => [id, name, slug, rank, played, won, drawn, lost, goalsFor, goalsAgainst, points]),
    fx: data.fixtures.map((match) => [match.id, match.round, index.get(match.home), index.get(match.away), match.kickoff || null])
  };
}

function staticTable(rows) {
  const total = rows.length;
  const body = rows.map((row) => `<tr class="sim-row${ZONE_CLASS[zoneFor(row.rank, total)] || ""}"><td>${row.rank}</td><th scope="row">${escapeHtml(row.name)}</th><td>${row.played}</td><td>${row.goalsFor - row.goalsAgainst > 0 ? "+" : ""}${row.goalsFor - row.goalsAgainst}</td><td><strong>${row.points}</strong></td><td class="sim-status"></td></tr>`).join("");
  return `<table class="sim-table"><caption class="sr-only">Simüle edilen puan durumu</caption><thead><tr><th scope="col">#</th><th scope="col">Takım</th><th scope="col">O</th><th scope="col">Av</th><th scope="col">P</th><th scope="col"><abbr title="Şampiyonluk · Avrupa · Ligde kalma">Ş·A·K</abbr></th></tr></thead><tbody data-sim-table>${body}</tbody></table>`;
}

function staticRound(data) {
  const first = data.fixtures[0];
  if (!first) return "<p class=\"sim-note\">Sezonun kalan maçı yok.</p>";
  const names = new Map(data.rows.map((row) => [row.id, row.name]));
  const matches = data.fixtures.filter((match) => match.round === first.round);
  return `<h3 class="sim-round-title">${escapeHtml(first.label)}</h3><ul class="sim-matches">${matches.map((match) => `<li class="sim-match"><span class="sim-team">${escapeHtml(names.get(match.home))}</span><span class="sim-vs">–</span><span class="sim-team is-away">${escapeHtml(names.get(match.away))}</span>${match.kickoff ? `<small class="sim-kickoff">${escapeHtml(trDate(match.kickoff))}</small>` : ""}</li>`).join("")}</ul>`;
}

const FAQ = [
  ["Sıralama nasıl hesaplanıyor?", "Önce puan, sonra averaj, sonra atılan gol karşılaştırılır. Bunlar da eşitse resmî tablodaki sıra korunur; ikili averaj gibi kurallar yalnızca resmî tabloya yansır. Sitedeki canlı puan durumu da aynı kuralı kullanır."],
  ["Skor girmezsem ne olur?", "Galibiyet 1-0, beraberlik 0-0, mağlubiyet 0-1 sayılır. Averajı etkilemek için iki kutuya skor yazabilirsin."],
  ["\"Kesin\" ve \"elendi\" ne demek?", "Kalan maçların hepsi kazanılsa bile ulaşılabilecek en yüksek puana göre yapılan kesin hesaptır: rakiplerin yetişemeyeceği fark varsa \"kesin\", takımın yetişemeyeceği fark varsa \"elendi\". Kanıtlanamayan her durum \"açık\" kalır. Olasılık ya da tahmin yüzdesi gösterilmez."],
  ["Bölgeler neye göre?", "1. sıra şampiyonluk, 2–4. sıralar Avrupa kupaları, son üç sıra küme düşme hattıdır; sitedeki diğer puan durumu tablolarıyla aynı bölgelendirme."],
  ["Seçimlerim kaydediliyor mu?", "Yalnızca bu tarayıcıda saklanır, sunucuya gönderilmez. Resmî tablo güncellendiğinde eski seçimler kendiliğinden temizlenir."]
];

function relatedLinks() {
  const links = [["./super-lig-puan-durumu", "Süper Lig puan durumu"], ["./super-lig-fikstur.html", "Süper Lig fikstürü"], ["./puan-durumu.html", "Tüm ligler — puan durumu merkezi"], ["./tahmin-ligi", "Tahmin Ligi"]];
  return `<aside class="evergreen-related" aria-labelledby="sim-related"><h2 id="sim-related">Puan durumundan devam et</h2><div class="evergreen-link-grid">${links.map(([href, label]) => `<a href="${href}">${escapeHtml(label)}</a>`).join("")}</div></aside>`;
}

export function renderPage(result) {
  const ok = result && result.ok;
  const data = ok ? result.data : null;
  const dataDate = data && data.standingsAt ? data.standingsAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebApplication", "@id": `${CANONICAL}#app`, name: "Süper Lig Puan Durumu Simülatörü", url: CANONICAL, applicationCategory: "SportsApplication", operatingSystem: "Web", inLanguage: "tr-TR", isAccessibleForFree: true, description: PAGE_DESCRIPTION, dateModified: dataDate },
      { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Ana Sayfa", item: `${siteUrl}/` }, { "@type": "ListItem", position: 2, name: "Süper Lig Puan Durumu", item: `${siteUrl}/super-lig-puan-durumu` }, { "@type": "ListItem", position: 3, name: "Puan Durumu Simülatörü", item: CANONICAL }] },
      ...(ok ? [{ "@type": "FAQPage", mainEntity: FAQ.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) }] : [])
    ]
  };
  const body = ok
    ? `<div class="sim-grid">
            <section class="sim-card" aria-labelledby="sim-picks-h">
              <div class="sim-card-head"><h2 id="sim-picks-h">Maçları belirle</h2><span class="sim-count" data-sim-count role="status" aria-live="polite"></span></div>
              <div class="sim-round-nav" data-sim-nav hidden><button type="button" class="sim-btn" data-sim-prev aria-label="Önceki hafta">‹</button><select data-sim-round aria-label="Hafta seç"></select><button type="button" class="sim-btn" data-sim-next aria-label="Sonraki hafta">›</button></div>
              <div data-sim-matches>${staticRound(data)}</div>
              <div class="sim-actions" data-sim-actions hidden><button type="button" class="sim-btn ghost" data-sim-clear-round>Bu haftayı temizle</button><button type="button" class="sim-btn ghost" data-sim-reset>Tümünü sıfırla</button></div>
              <p class="sim-note">1 = ev sahibi kazanır, X = beraberlik, 2 = deplasman kazanır. Skor kutuları isteğe bağlı; averajı değiştirir.</p>
            </section>
            <section class="sim-card" aria-labelledby="sim-table-h">
              <div class="sim-card-head"><h2 id="sim-table-h">Senin tablon</h2></div>
              <div class="sim-table-wrap">${staticTable(data.rows)}</div>
              <ul class="sim-legend"><li><i class="is-leader"></i>Şampiyonluk</li><li><i class="is-europe"></i>Avrupa (2–4)</li><li><i class="is-relegation"></i>Küme düşme (son 3)</li><li><b class="sim-chip is-clinched">✓</b>kesin</li><li><b class="sim-chip is-eliminated">✕</b>elendi</li><li><b class="sim-chip">·</b>açık</li></ul>
            </section>
            <section class="sim-card" aria-labelledby="sim-what-h">
              <h2 id="sim-what-h">Bu maçı kazansam ne olur?</h2>
              <label class="sim-label" for="sim-team">Takım</label>
              <select id="sim-team" data-sim-team><option value="">Takım seç</option>${data.rows.map((row) => `<option value="${escapeHtml(row.id)}">${escapeHtml(row.name)}</option>`).join("")}</select>
              <div data-sim-scenario class="sim-scenario" aria-live="polite"><p class="sim-note">Bir takım seç; sıradaki (henüz belirlemediğin) maçının üç sonucu tabloyu nasıl değiştirir, gör.</p></div>
            </section>
          </div>
          <script type="application/json" id="sim-data">${JSON.stringify(compactPayload(data)).replaceAll("<", "\\u003c")}</script>
          <noscript><p class="sim-note">Simülatör JavaScript ile çalışır. Yukarıda resmî tablo ve sıradaki hafta okunabilir.</p></noscript>
          <section class="sim-card sim-faq" aria-labelledby="sim-faq-h"><h2 id="sim-faq-h">Nasıl hesaplanıyor?</h2>${FAQ.map(([q, a]) => `<details><summary>${escapeHtml(q)}</summary><p>${escapeHtml(a)}</p></details>`).join("")}</section>`
    : `<div class="standings-empty" data-card="simulator-unavailable"><strong>Simülatör şu an kapalı</strong><p>Süper Lig resmî puan durumu ile kalan fikstür birbirini doğrulamadığı için simülasyon gösterilmiyor. Veri tutarlı hâle geldiğinde sayfa kendiliğinden açılır.</p><a class="detail-link" href="./super-lig-puan-durumu">Resmî puan durumunu gör</a></div>`;
  const freshness = ok
    ? `<p class="evergreen-freshness">Resmî tablo: <time datetime="${escapeHtml(data.standingsAt || "")}">${escapeHtml(trDate(data.standingsAt))}</time> (TSİ) · Kalan maç: ${data.fixtures.length} · Kaynak: sağlayıcı puan durumu ve TFF fikstürü. Olasılık tahmini yoktur.</p>`
    : "";
  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(PAGE_TITLE)}</title>
    <meta name="description" content="${escapeHtml(PAGE_DESCRIPTION)}" />
    <meta name="robots" content="${ok ? ROBOTS_INDEX : ROBOTS_NOINDEX_FOLLOW}" />
    <link rel="canonical" href="${CANONICAL}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${escapeHtml(PAGE_TITLE)}" />
    <meta property="og:description" content="${escapeHtml(PAGE_DESCRIPTION)}" />
    <meta property="og:url" content="${CANONICAL}" />
    <meta property="og:image" content="${siteUrl}/assets/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(PAGE_TITLE)}" />
    <meta name="twitter:description" content="${escapeHtml(PAGE_DESCRIPTION)}" />
    <meta name="twitter:image" content="${siteUrl}/assets/og-image.png" />
    <link rel="icon" href="./favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="./page.css" />
    <link rel="stylesheet" href="./puan-durumu-simulator.css" />
    <script type="application/ld+json">${JSON.stringify(schema).replaceAll("<", "\\u003c")}</script>
  </head>
  <body>
    <div class="site-shell">
      ${siteHeader({ base: "./" })}
      <main class="evergreen-page sim-page" id="puan-durumu-simulator">
        <div class="container">
          <nav class="evergreen-breadcrumb" aria-label="İçerik yolu"><a href="./">Ana Sayfa</a><span aria-hidden="true">/</span><a href="./super-lig-puan-durumu">Süper Lig Puan Durumu</a><span aria-hidden="true">/</span><span aria-current="page">Simülatör</span></nav>
          <header class="evergreen-hero">
            <span class="section-kicker">Süper Lig${data && data.season ? ` · ${escapeHtml(data.season.replace("-", "/"))}` : ""}</span>
            <h1>Süper Lig Puan Durumu Simülatörü</h1>
            <p>Kalan maçların sonucunu sen seç; puan, averaj, sıra ve şampiyonluk, Avrupa, küme düşme hattı anında yeniden hesaplanır. Başlangıç noktası sitedeki gerçek puan durumu ve fikstürdür.</p>
            ${freshness}
          </header>
          ${body}
          ${relatedLinks()}
        </div>
      </main>
      ${siteFooter({ base: "./" })}
    </div>
    <script src="./site.js" defer></script>
${ok ? `    <script src="./live-standings-core.js" defer></script>
    <script src="./${CORE_FILE}" defer></script>
    <script src="./puan-durumu-simulator.js" defer></script>
` : ""}  </body>
</html>\n`;
}

function updateSitemap(file, include, lastmod) {
  if (!fs.existsSync(file)) return;
  const xml = fs.readFileSync(file, "utf8");
  const existing = (xml.match(URL_ENTRY_RE) || []).filter((entry) => !entry.includes(`<loc>${CANONICAL}</loc>`));
  const fresh = include ? [`  <url>\n    <loc>${CANONICAL}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.7</priority>\n  </url>`] : [];
  const next = wrapUrlset([...existing, ...fresh]);
  const strip = (text) => text.replace(/<lastmod>[^<]*<\/lastmod>/g, "");
  if (strip(next) !== strip(xml)) fs.writeFileSync(file, next, "utf8");
}

function writeIfChanged(target, content) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const previous = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
  if (previous !== content) fs.writeFileSync(target, content, "utf8");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = buildSuperLigSimulator(root);
  const html = renderPage(result);
  const core = `${CORE_BANNER}${fs.readFileSync(CORE_SOURCE, "utf8")}`;
  for (const outputRoot of [root, path.join(root, "public")]) {
    writeIfChanged(path.join(outputRoot, "puan-durumu-simulator.html"), html);
    writeIfChanged(path.join(outputRoot, CORE_FILE), core);
  }
  const lastmod = result.ok && result.data.standingsAt ? result.data.standingsAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
  for (const sitemap of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) updateSitemap(sitemap, result.ok, lastmod);
  if (result.ok) console.log(`[standings-simulator] puan-durumu-simulator.html: ${result.data.rows.length} takım, ${result.data.fixtures.length} kalan maç`);
  else console.warn(`[standings-simulator] simülasyon basılmadı (noindex boş durum): ${result.reason}`);
}
