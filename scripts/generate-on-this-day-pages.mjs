#!/usr/bin/env node
/**
 * /tarihte-bugun ve /en/on-this-day — "Tarihte bugün" sayfaları.
 *
 * KAYNAK: yalnızca depodaki doğrulanmış maç arşivi (data/season-archive.json,
 * scripts/archive-season-data.mjs üretir). Bugünün gün/ay'ına denk gelen,
 * GEÇMİŞ yıllarda oynanmış ve skoru kayıtlı maçlar listelenir. Hiçbir API
 * çağrısı yapılmaz, hiçbir kayıt elle eklenmez. Doğrulanmış kayıt yoksa sayfa
 * bunu açıkça söyler ve `noindex,follow` olur (ince içerik indekslenmez).
 * Tarihe bağlı olduğu için son-işlem zincirinde her koşuda yeniden üretilir.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { siteFooter, siteHeader } from "./lib/layout.mjs";
import { ROBOTS_INDEX, ROBOTS_NOINDEX_FOLLOW } from "./lib/robots.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteUrl = "https://www.futbolradar.com";
const TZ = "Europe/Istanbul";
const esc = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

function istanbulParts(date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date).map((x) => [x.type, x.value]));
  return { year: Number(p.year), md: `${p.month}-${p.day}`, iso: `${p.year}-${p.month}-${p.day}` };
}

export function collectEntries(archive, now = new Date()) {
  const today = istanbulParts(now);
  const out = [];
  for (const season of Object.values(archive?.seasons || {})) {
    for (const m of season.matches || []) {
      if (!m?.kickoff || !m.homeTeam || !m.awayTeam) continue;
      const k = istanbulParts(new Date(m.kickoff));
      if (k.md !== today.md || k.year >= today.year) continue;
      if (typeof m.score?.home !== "number" || typeof m.score?.away !== "number") continue;
      if (!m.lastVerifiedAt) continue;
      out.push({ date: k.iso, year: k.year, league: m.league || null, homeTeam: m.homeTeam, awayTeam: m.awayTeam, score: { home: m.score.home, away: m.score.away }, reportPage: m.reportPage || null, sourceUrls: m.sourceUrls || [], lastVerifiedAt: m.lastVerifiedAt });
    }
  }
  out.sort((a, b) => a.year - b.year || String(a.league).localeCompare(String(b.league)));
  return { today: today.iso, monthDay: today.md, entries: out };
}

function renderPage({ lang, today, entries }) {
  const tr = lang === "tr";
  const canonical = tr ? `${siteUrl}/tarihte-bugun` : `${siteUrl}/en/on-this-day`;
  const base = tr ? "./" : "../";
  const dateLabel = new Intl.DateTimeFormat(tr ? "tr-TR" : "en-GB", { day: "numeric", month: "long", timeZone: TZ }).format(new Date(`${today}T12:00:00+03:00`));
  const title = tr ? `Tarihte Bugün: ${dateLabel} Futbol Maçları | FutbolRadar` : `On This Day in Football: ${dateLabel} | FutbolRadar`;
  const desc = tr ? `${dateLabel} tarihinde geçmiş yıllarda oynanan, FutbolRadar arşivinde doğrulanmış maç sonuçları.` : `Verified football results from past years played on ${dateLabel}, from the FutbolRadar match archive.`;
  const robots = entries.length ? ROBOTS_INDEX : ROBOTS_NOINDEX_FOLLOW;
  const list = entries.length
    ? `<ul class="otd-list">${entries.map((e) => `<li><span class="otd-year">${e.year}</span> <strong>${esc(e.homeTeam)} ${e.score.home}-${e.score.away} ${esc(e.awayTeam)}</strong>${e.league ? ` <small>${esc(e.league)}</small>` : ""}${tr && e.reportPage ? ` <a href="${base}${esc(e.reportPage)}">Maç raporu</a>` : ""}</li>`).join("")}</ul>`
    : `<p class="otd-empty">${tr ? "Bu tarih için arşivimizde geçmiş yıllardan doğrulanmış bir maç kaydı henüz yok. FutbolRadar uydurma kayıt yayımlamaz; arşiv büyüdükçe bu sayfa kendiliğinden dolar." : "Our archive has no verified match from past years for this date yet. FutbolRadar never publishes invented records; this page fills itself as the archive grows."}</p>`;
  return `<!doctype html>
<html lang="${tr ? "tr" : "en"}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(desc)}" />
    <meta name="robots" content="${robots}" />
    <link rel="canonical" href="${canonical}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="${tr ? "tr_TR" : "en_GB"}" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(desc)}" />
    <meta property="og:url" content="${canonical}" />
    <link rel="icon" href="${base}favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="${base}page.css" />
  </head>
  <body>
    <div class="site-shell">
      ${siteHeader({ base, ...(tr ? {} : { locale: "en" }) })}
      <main class="container" id="tarihte-bugun" data-on-this-day="${esc(today)}">
        <header class="trend-hero"><div><span class="eyebrow">${tr ? "Arşiv · Doğrulanmış veri" : "Archive · Verified data"}</span><h1>${tr ? `Tarihte Bugün: ${esc(dateLabel)}` : `On This Day: ${esc(dateLabel)}`}</h1><p>${esc(desc)}</p></div></header>
        <section class="trend-section">${list}<p class="trend-source">${tr ? "Kaynak: FutbolRadar maç arşivi (data/season-archive.json)." : "Source: FutbolRadar match archive."}</p></section>
      </main>
      ${siteFooter({ base, ...(tr ? {} : { locale: "en" }) })}
    </div>
    <script src="${base}site.js" defer></script>
  </body>
</html>\n`;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const archivePath = path.join(root, "data", "season-archive.json");
  const archive = fs.existsSync(archivePath) ? JSON.parse(fs.readFileSync(archivePath, "utf8")) : { seasons: {} };
  const result = collectEntries(archive);
  const json = { _comment: "Türetilmiş dosya — scripts/generate-on-this-day-pages.mjs üretir; elle düzenlenmez. Yalnız depodaki doğrulanmış maç arşivi.", source: "data/season-archive.json", today: result.today, monthDay: result.monthDay, count: result.entries.length, entries: result.entries };
  fs.writeFileSync(path.join(root, "data", "on-this-day.json"), JSON.stringify(json, null, 2) + "\n", "utf8");
  for (const [lang, rel] of [["tr", "tarihte-bugun.html"], ["en", "en/on-this-day.html"]]) {
    const html = renderPage({ lang, today: result.today, entries: result.entries });
    for (const outRoot of [root, path.join(root, "public")]) {
      const target = path.join(outRoot, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, html, "utf8");
    }
  }
  console.log(`[on-this-day] ${result.today}: ${result.entries.length} doğrulanmış kayıt`);
}
