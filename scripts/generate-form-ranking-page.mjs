#!/usr/bin/env node
/**
 * "HANGİ TAKIM ŞU AN FORMDA?" — /hangi-takim-formda.html
 *
 * Süper Lig takımlarını YALNIZCA son 5 resmî maçlarının gerçek sonuçlarına
 * göre sıralar. Anket, oylama, model skoru ya da tahmin YOK. Hesap, takım
 * maçları sayfasındaki "<takım> son 5 maç" bölümüyle aynı işlevden gelir
 * (scripts/lib/teamLastFive.mjs): sağlayıcı takvimi (API-Football) + maç
 * sonu rapor sicili; hazırlık ve altyapı maçları hariç.
 *
 * Kanibalizasyon: `/form-tablosu/super-lig` sitenin form skoru/momentum
 * tablosu, `super-lig-form-durumu.html` momentum vitrini. Bu sayfa soru
 * niyetini ("hangi takım formda", "formda olan takımlar") son 5 maçın
 * puanıyla cevaplar ve ikisine de bağlantı verir.
 *
 * İnce içerik koruması: 5 maçı tam olan takım sayısı 12'nin altındaysa ya
 * da en yeni sonuç 21 günden eskiyse sayfa `noindex,follow` basılır ve site
 * haritasına girmez.
 *
 * Ek istek, cron, ortam değişkeni yok; derleme anında depodaki veriden.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { siteHeader, siteFooter } from "./lib/layout.mjs";
import { ROBOTS_INDEX, ROBOTS_NOINDEX_FOLLOW } from "./lib/robots.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";
import { lastFiveMatches, rankFormTable, allFromApiFootball, FORM_TIEBREAK_TEXT } from "./lib/teamLastFive.mjs";

const require = createRequire(import.meta.url);
const { sameClub } = require("../services/superLigTeams.js");
const { canonicalStatus, istanbulDay } = require("../services/matchStatus.js");
const { superLigTeamPages } = require("../services/superLigTeamPages.js");

const DOMAIN = "https://www.futbolradar.com";
export const PAGE_FILE = "hangi-takim-formda.html";
export const PAGE_URL = `${DOMAIN}/${PAGE_FILE}`;
export const PAGE_TITLE = "Hangi Takım Şu An Formda? Süper Lig Son 5 Maç Form Sıralaması | FutbolRadar";
export const SHARE_TITLE = "Hangi takım şu an formda? Süper Lig son 5 maç form sıralaması";
// ≤155 karakter: son işlem uzun açıklamayı cümle sınırında kesiyordu (canlıda "… goller. Veri.").
export const PAGE_DESCRIPTION = "Süper Lig'de hangi takım formda? Takımlar son 5 resmî maçtaki gerçek sonuçlara göre sıralandı: G/B/M serisi, puan, atılan ve yenilen goller.";
const MIN_COMPLETE_TEAMS = 12;
const MAX_AGE_DAYS = 21;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function shortDate(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul" }).format(parsed);
}

// RFC 3986 katı kodlama: ' ( ) ! * de kodlanır (HTML özniteliğinde kaçış gerekmez).
const encode = (value) => encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** Paylaşım bağlantıları: düz <a>, SDK/izleme yok; adres sayfanın kanoniği. */
export function shareLinks({ url = PAGE_URL, title = SHARE_TITLE, text = PAGE_DESCRIPTION } = {}) {
  const message = `${title} — ${text}`;
  return [
    { network: "facebook", label: "Facebook'ta paylaş", href: `https://www.facebook.com/sharer/sharer.php?u=${encode(url)}` },
    { network: "x", label: "X'te (Twitter) paylaş", href: `https://twitter.com/intent/tweet?text=${encode(title)}&url=${encode(url)}` },
    { network: "whatsapp", label: "WhatsApp'ta paylaş", href: `https://wa.me/?text=${encode(`${message} ${url}`)}` }
  ];
}

function shareSectionHtml() {
  // page-share.css/js sitenin mevcut paylaşım bileşeni: 44px dokunma alanı,
  // sarılan satır (390px'te taşma yok), yer ayrılmış kutu (CLS yok).
  return `<section class="page-share" data-page-share aria-label="Bu sayfayı paylaş">
  <strong>Bu sayfayı paylaş</strong>
  <div class="page-share-actions">${shareLinks().map((link) => `<a data-share-network="${link.network}" href="${escapeHtml(link.href)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(link.label)} (yeni sekmede açılır)">${escapeHtml(link.label)}</a>`).join("")}
  <button type="button" data-page-share-copy="${escapeHtml(PAGE_URL)}" hidden>Bağlantıyı kopyala</button></div>
  <p data-page-share-status role="status" aria-live="polite"></p>
  <label data-page-share-fallback hidden>Bağlantıyı seçip kopyalayın<input type="text" readonly value="${escapeHtml(PAGE_URL)}" aria-label="Paylaşılacak bağlantı"></label>
</section>`;
}

/** Depodaki veriden model: takım başına son 5 maç + sıralama + indeks kararı. */
export function buildFormModel({ root = process.cwd(), now = new Date() } = {}) {
  const readJson = (rel, fallback) => {
    try { return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8")); } catch { return fallback; }
  };
  const calendar = (readJson("data/fixture-calendar.json", { matches: [] }).matches) || [];
  const store = readJson("data/post-match-reports.json", { records: [] });
  const allReports = Array.isArray(store) ? store : (store.records || store.reports || []);
  // Rapor satırı yalnızca sayfası diskte varsa kullanılır (kırık bağlantı yok).
  const reports = allReports.filter((report) => report && report.seo && report.seo.path && fs.existsSync(path.join(root, String(report.seo.path).replace(/^\//, ""))));
  const teams = superLigTeamPages({ root }).map(({ slug, name }) => ({ slug, name, matchesPage: fs.existsSync(path.join(root, `${slug}-maclari.html`)) ? `${slug}-maclari.html` : null }));
  const entries = teams.map((team) => ({
    team,
    rows: lastFiveMatches({
      team,
      calendar,
      reports: reports.filter((report) => sameClub(report.homeTeam, team.name) || sameClub(report.awayTeam, team.name)),
      sameClub,
      canonicalStatus,
      istanbulDay
    })
  }));
  const table = rankFormTable(entries);
  const allRows = entries.flatMap((entry) => entry.rows);
  const newest = allRows.map((row) => Date.parse(row.kickoff)).filter(Number.isFinite).sort((a, b) => b - a)[0] || null;
  const ageDays = newest ? (now.getTime() - newest) / 86400000 : Infinity;
  const indexable = table.ranked.length >= MIN_COMPLETE_TEAMS && ageDays <= MAX_AGE_DAYS;
  return {
    ...table,
    newest: newest ? new Date(newest).toISOString() : null,
    indexable,
    credit: allFromApiFootball(allRows) ? "Veri: API-Football" : "Veri: API-Football ve FutbolRadar maç sonu raporları",
    generatedAt: now.toISOString()
  };
}

function dotsHtml(rows) {
  const cls = { G: "win", B: "draw", M: "loss" };
  const label = { G: "Galibiyet", B: "Beraberlik", M: "Mağlubiyet" };
  // En yeni maç solda (sıra satırlarla aynı).
  return `<div class="form-dots" role="img" aria-label="Son ${rows.length} maç: ${rows.map((row) => label[row.result]).join(", ")}">${rows.map((row) => `<span class="${cls[row.result]}" title="${escapeHtml(`${row.homeTeam} ${row.score.home}-${row.score.away} ${row.awayTeam}`)}">${row.result}</span>`).join("")}</div>`;
}

function teamHref(team) {
  return team.matchesPage ? `./${team.matchesPage}#son-5-mac` : `./takimlar/${team.slug}`;
}

function rowHtml(row) {
  const s = row.summary;
  const gd = row.goalDifference > 0 ? `+${row.goalDifference}` : String(row.goalDifference);
  return `<li class="glass-card frk-row" data-card="form-rank" data-team="${escapeHtml(row.team.slug)}">
      <div class="frk-head"><span class="frk-rank">${row.rank}.</span><h3><a href="${escapeHtml(teamHref(row.team))}">${escapeHtml(row.team.name)}</a></h3><strong class="frk-points">${s.points} puan</strong></div>
      ${dotsHtml(row.rows)}
      <p class="frk-meta">${s.won}G ${s.drawn}B ${s.lost}M · Gol ${s.scored}-${s.conceded} (averaj ${gd}) · Son maç: <time datetime="${escapeHtml(row.lastKickoff)}">${escapeHtml(shortDate(row.lastKickoff))}</time></p>
    </li>`;
}

function pendingHtml(row) {
  return `<li class="glass-card frk-row is-pending" data-card="form-rank-pending" data-team="${escapeHtml(row.team.slug)}">
      <div class="frk-head"><span class="frk-rank">–</span><h3><a href="${escapeHtml(teamHref(row.team))}">${escapeHtml(row.team.name)}</a></h3><strong class="frk-points">Güncelleniyor</strong></div>
      ${row.rows.length ? dotsHtml(row.rows) : ""}
      <p class="frk-meta">Skoru doğrulanmış ${row.rows.length} resmî maç var; sıralama için 5 maç gerekiyor.</p>
    </li>`;
}

export function renderFormPage(model) {
  const leader = model.ranked[0] || null;
  const lead = leader
    ? `Son 5 resmî maçına göre Süper Lig'in en formda takımı ${leader.team.name}: ${leader.summary.won} galibiyet, ${leader.summary.drawn} beraberlik, ${leader.summary.lost} mağlubiyetle ${leader.summary.points} puan.`
    : "Sıralama için yeterli doğrulanmış sonuç yok; veriler güncelleniyor.";
  const robots = model.indexable ? ROBOTS_INDEX : ROBOTS_NOINDEX_FOLLOW;
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "CollectionPage", "@id": `${PAGE_URL}#page`, url: PAGE_URL, name: SHARE_TITLE, description: PAGE_DESCRIPTION, inLanguage: "tr-TR", isPartOf: { "@type": "WebSite", name: "FutbolRadar", url: `${DOMAIN}/` }, ...(model.newest ? { dateModified: model.generatedAt } : {}) },
      { "@type": "ItemList", name: "Süper Lig son 5 maç form sıralaması", numberOfItems: model.ranked.length, itemListElement: model.ranked.map((row) => ({ "@type": "ListItem", position: row.rank, item: { "@type": "SportsTeam", name: row.team.name, url: `${DOMAIN}/takimlar/${row.team.slug}` } })) },
      { "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "Ana Sayfa", item: `${DOMAIN}/` },
        { "@type": "ListItem", position: 2, name: "Süper Lig form tablosu", item: `${DOMAIN}/form-tablosu/super-lig` },
        { "@type": "ListItem", position: 3, name: "Hangi takım formda?", item: PAGE_URL }
      ] }
    ]
  };
  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(PAGE_TITLE)}</title>
    <meta name="description" content="${escapeHtml(PAGE_DESCRIPTION)}" />
    <link rel="canonical" href="${PAGE_URL}" />
    <meta name="robots" content="${robots}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:url" content="${PAGE_URL}" />
    <meta property="og:title" content="${escapeHtml(SHARE_TITLE)}" />
    <meta property="og:description" content="${escapeHtml(PAGE_DESCRIPTION)}" />
    <meta property="og:image" content="${DOMAIN}/assets/og-image.png" />
    <meta property="og:image:alt" content="Hangi takım şu an formda? — FutbolRadar paylaşım görseli" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(SHARE_TITLE)}" />
    <meta name="twitter:description" content="${escapeHtml(PAGE_DESCRIPTION)}" />
    <meta name="twitter:image" content="${DOMAIN}/assets/og-image.png" />
    <script type="application/ld+json">${JSON.stringify(schema)}</script>
    <link rel="icon" href="./favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="./site.webmanifest" />
    <link rel="stylesheet" href="./page.css" />
    <link rel="stylesheet" href="./page-share.css" />
    <style>
      .frk-list{list-style:none;margin:0;padding:0;display:grid;gap:12px}
      .frk-row{padding:14px 16px;min-width:0}
      .frk-head{display:flex;align-items:baseline;gap:10px;min-width:0}
      .frk-head h3{flex:1;min-width:0;margin:0;font-size:1rem;overflow-wrap:anywhere}
      .frk-rank{font-weight:900;min-width:2ch}
      .frk-points{white-space:nowrap}
      .frk-meta{margin:6px 0 0;font-size:.86rem;color:var(--muted);overflow-wrap:anywhere}
      .frk-row .form-dots{margin:10px 0 0}
      .frk-row .form-dots span{width:28px;height:28px}
    </style>
  </head>
  <body class="subpage form-ranking-page">
    ${siteHeader({ base: "./" })}
    <main class="container">
      <nav class="breadcrumb" aria-label="Sayfa yolu"><a href="./index.html">Ana Sayfa</a><span>/</span><a href="./form-tablosu/super-lig">Form tablosu</a><span>/</span><span>Hangi takım formda?</span></nav>
      <section class="trend-hero">
        <div>
          <span class="eyebrow">Süper Lig · son 5 resmî maç</span>
          <h1>Hangi takım şu an formda?</h1>
          <p>${escapeHtml(lead)}</p>
          <p class="muted">${escapeHtml(FORM_TIEBREAK_TEXT)} Anket ya da tahmin kullanılmaz; yalnızca oynanmış maçların skorları sayılır. Hazırlık ve altyapı maçları dahil değildir.</p>
        </div>
      </section>
      <section class="trend-section" id="form-siralamasi" aria-labelledby="form-siralamasi-title">
        <div class="section-head"><div class="section-title"><span class="section-kicker">Form sıralaması</span><h2 id="form-siralamasi-title">Formda olan takımlar: son 5 maç puanı</h2><p>Noktalar en yeni maçtan eskiye: G galibiyet, B beraberlik, M mağlubiyet.</p></div></div>
        ${model.ranked.length ? `<ol class="frk-list">${model.ranked.map(rowHtml).join("")}</ol>` : `<article class="data-empty" data-card="empty-state"><strong>Güncelleniyor</strong><span>Sıralama için 5 maçı doğrulanmış takım yok.</span></article>`}
        ${model.pending.length ? `<h3>Sıralamaya henüz girmeyen takımlar</h3><ul class="frk-list">${model.pending.map(pendingHtml).join("")}</ul>` : ""}
        <p class="muted">${escapeHtml(model.credit)}${model.newest ? ` · En yeni sonuç: <time datetime="${escapeHtml(model.newest)}">${escapeHtml(shortDate(model.newest))}</time>` : ""}</p>
      </section>
      ${shareSectionHtml()}
      <section class="trend-section" aria-labelledby="form-related-title">
        <div class="section-head"><div class="section-title"><span class="section-kicker">İlgili sayfalar</span><h2 id="form-related-title">Formu başka açılardan incele</h2></div></div>
        <div class="trend-link-grid">
          <a href="./form-tablosu/super-lig"><span>Form tablosu</span><strong>Süper Lig form tablosu</strong><p>Form skoru ve momentum sıralaması.</p></a>
          <a href="./super-lig-form-durumu.html"><span>Momentum</span><strong>Süper Lig form durumu</strong><p>Takım momentumu ve gol eğilimi.</p></a>
          <a href="./super-lig-puan-durumu"><span>Puan durumu</span><strong>Süper Lig puan durumu</strong><p>Sezonun tamamına göre sıralama.</p></a>
        </div>
      </section>
    </main>
    ${siteFooter({ base: "./" })}
    <script src="./site.js" defer></script>
    <script src="./page-share.js" defer></script>
  </body>
</html>`.replace(/^[ \t]+$/gm, "");
}

export function updateSitemapXml(xml, indexable, today = new Date().toISOString().slice(0, 10)) {
  const existing = (xml.match(URL_ENTRY_RE) || []).filter((entry) => !entry.includes(`<loc>${PAGE_URL}</loc>`));
  // noindex sayfa site haritasına girmez; önceden girdiyse çıkarılır.
  const entries = indexable
    ? [...existing, `  <url>\n    <loc>${PAGE_URL}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.7</priority>\n  </url>`]
    : existing;
  return wrapUrlset(entries);
}

function updateSitemap(file, indexable) {
  if (!fs.existsSync(file)) return;
  const xml = fs.readFileSync(file, "utf8");
  const next = updateSitemapXml(xml, indexable);
  const strip = (text) => text.replace(/<lastmod>[^<]*<\/lastmod>/g, "");
  if (strip(next) !== strip(xml)) fs.writeFileSync(file, next, "utf8");
}

function main() {
  const root = process.cwd();
  const model = buildFormModel({ root });
  const html = renderFormPage(model);
  fs.writeFileSync(path.join(root, PAGE_FILE), html, "utf8");
  const mirror = path.join(root, "public", PAGE_FILE);
  if (fs.existsSync(path.dirname(mirror))) fs.writeFileSync(mirror, html, "utf8");
  for (const sitemap of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) updateSitemap(sitemap, model.indexable);
  console.log(`[form-ranking] ${PAGE_FILE}: ${model.ranked.length} takım sıralandı, ${model.pending.length} güncelleniyor; ${model.indexable ? "index" : "noindex"}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
