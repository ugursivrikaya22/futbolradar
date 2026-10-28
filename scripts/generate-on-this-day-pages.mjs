#!/usr/bin/env node
/**
 * /tarihte-bugun ve /en/on-this-day — "Tarihte bugün" sayfaları.
 *
 * KAYNAKLAR (ikisi de depoda, hiçbir API çağrısı yok):
 *  1. data/on-this-day.json — elle doğrulanmış, HER BİRİ KAYNAK BAĞLANTILI
 *     tarihî olaylar (Supabase `on_this_day` tablosunun tohumu). Yalnız
 *     `verified: true` ve `source_url` dolu kayıtlar yayınlanır.
 *  2. data/season-archive.json — doğrulanmış maç arşivi. Gün/ay'a denk gelen,
 *     GEÇMİŞ yıllarda oynanmış ve skoru kayıtlı maçlar.
 *
 * ÇIKTILAR:
 *  - /tarihte-bugun (+ /en/on-this-day): bugünün kanonik sayfası.
 *  - /tarih/<gün>-<ay> (ör. /tarih/26-ekim): yılın 366 günü için kalıcı sayfa.
 *    Kaydı olmayan gün `noindex,follow` olur ve site haritasına girmez.
 *  - data/on-this-day-today.json: bugünün türetilmiş özeti (elle düzenlenmez).
 * Tarihe bağlı olduğu için son-işlem zincirinde her koşuda yeniden üretilir.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { siteFooter, siteHeader } from "./lib/layout.mjs";
import { ROBOTS_INDEX, ROBOTS_NOINDEX_FOLLOW } from "./lib/robots.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteUrl = "https://www.futbolradar.com";
const TZ = "Europe/Istanbul";
const esc = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

const IST_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
function istanbulParts(date) {
  const p = Object.fromEntries(IST_FMT.formatToParts(date).map((x) => [x.type, x.value]));
  return { year: Number(p.year), md: `${p.month}-${p.day}`, iso: `${p.year}-${p.month}-${p.day}` };
}

export function collectEntries(archive, now = new Date(), monthDay = null) {
  const today = istanbulParts(now);
  if (monthDay) today.md = monthDay;
  const out = [];
  for (const season of Object.values(archive?.seasons || {})) {
    for (const m of season.matches || []) {
      if (!m?.kickoff || !m.homeTeam || !m.awayTeam) continue;
      const k = istanbulParts(new Date(m.kickoff));
      if ((today.md !== "*" && k.md !== today.md) || k.year >= today.year) continue;
      if (typeof m.score?.home !== "number" || typeof m.score?.away !== "number") continue;
      if (!m.lastVerifiedAt) continue;
      out.push({ date: k.iso, year: k.year, league: m.league || null, homeTeam: m.homeTeam, awayTeam: m.awayTeam, score: { home: m.score.home, away: m.score.away }, reportPage: m.reportPage || null, sourceUrls: m.sourceUrls || [], lastVerifiedAt: m.lastVerifiedAt });
    }
  }
  out.sort((a, b) => a.year - b.year || String(a.league).localeCompare(String(b.league)));
  return { today: today.iso, monthDay: today.md, entries: out };
}


export const CATEGORIES = Object.freeze(["mac", "gol", "transfer", "rekor", "dogum", "olum"]);
export const CATEGORY_LABELS = Object.freeze({ mac: "Maç", gol: "Gol", transfer: "Transfer", rekor: "Rekor / İlk", dogum: "Doğum", olum: "Vefat" });
export const MONTHS_TR = Object.freeze(["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"]);
export const MONTH_SLUGS = Object.freeze(["ocak", "subat", "mart", "nisan", "mayis", "haziran", "temmuz", "agustos", "eylul", "ekim", "kasim", "aralik"]);
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Yılın 366 günü (29 Şubat dahil), sırayla. */
export function allDays() {
  const out = [];
  DAYS_IN_MONTH.forEach((count, i) => { for (let d = 1; d <= count; d += 1) out.push({ month: i + 1, day: d }); });
  return out;
}

export function daySlug(month, day) { return `${day}-${MONTH_SLUGS[month - 1]}`; }
export function dayLabel(month, day) { return `${day} ${MONTHS_TR[month - 1]}`; }
const mdKey = (month, day) => `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

/** Yayınlanabilir olay: doğrulanmış, kaynak bağlantılı, alanları geçerli. Diğerleri SESSİZCE DEĞİL, hata listesiyle elenir. */
export function validateEvent(e) {
  const errors = [];
  if (!e || typeof e !== "object") return ["kayıt nesne değil"];
  if (!Number.isInteger(e.month) || e.month < 1 || e.month > 12) errors.push("month");
  if (!Number.isInteger(e.day) || e.day < 1 || e.day > (DAYS_IN_MONTH[e.month - 1] || 0)) errors.push("day");
  if (!Number.isInteger(e.year) || e.year < 1800) errors.push("year");
  if (!CATEGORIES.includes(e.category)) errors.push("category");
  if (!String(e.title_tr || "").trim()) errors.push("title_tr");
  if (!/^https:\/\/\S+$/.test(String(e.source_url || ""))) errors.push("source_url");
  if (e.verified !== true) errors.push("verified");
  return errors;
}

export function loadEvents(doc) {
  const list = Array.isArray(doc?.events) ? doc.events : [];
  return list.filter((e) => validateEvent(e).length === 0);
}

export function eventsFor(events, month, day) {
  return events.filter((e) => e.month === month && e.day === day).sort((a, b) => a.year - b.year || String(a.id).localeCompare(String(b.id)));
}

function dayStyle() {
  return `<style>
      .otd-list{list-style:none;margin:0;padding:0;display:grid;gap:12px}
      .otd-item{border:1px solid var(--line,rgba(127,127,127,.25));border-radius:12px;padding:12px 14px}
      .otd-item h3{margin:4px 0 6px;font-size:1.05rem;line-height:1.35}
      .otd-item p{margin:0 0 8px;line-height:1.5}
      .otd-meta{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:.85rem}
      .otd-year{font-weight:700}
      .otd-tag{border-radius:999px;padding:2px 10px;border:1px solid currentColor;opacity:.8}
      .breadcrumb a,.otd-item a,.otd-days a{display:inline-flex;align-items:center;min-height:44px;min-width:44px}
      .otd-days{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;margin-top:16px}
    </style>`;
}

function eventItem(e) {
  return `<li class="otd-item" data-category="${esc(e.category)}"><div class="otd-meta"><span class="otd-year">${e.year}</span><span class="otd-tag">${esc(CATEGORY_LABELS[e.category])}</span></div><h3>${esc(e.title_tr)}</h3>${e.description_tr ? `<p>${esc(e.description_tr)}</p>` : ""}<a href="${esc(e.source_url)}" target="_blank" rel="noopener noreferrer nofollow">Kaynak: ${esc(e.source_name || new URL(e.source_url).hostname)}</a></li>`;
}

function matchItem(m, base) {
  return `<li class="otd-item" data-category="mac"><div class="otd-meta"><span class="otd-year">${m.year}</span><span class="otd-tag">Maç arşivi</span>${m.league ? `<small>${esc(m.league)}</small>` : ""}</div><h3>${esc(m.homeTeam)} ${m.score.home}-${m.score.away} ${esc(m.awayTeam)}</h3>${m.reportPage ? `<a href="${base}${esc(m.reportPage)}">Maç raporu</a>` : ""}</li>`;
}

/** ItemList: yalnız gerçek alanlar (ad, açıklama, kaynak/rapor URL'si). */
export function itemListJsonLd({ name, url, events, matches }) {
  const items = [
    ...events.map((e) => ({ name: `${e.year}: ${e.title_tr}`, ...(e.description_tr ? { description: e.description_tr } : {}), url: e.source_url })),
    ...matches.map((m) => ({ name: `${m.year}: ${m.homeTeam} ${m.score.home}-${m.score.away} ${m.awayTeam}`, ...(m.reportPage ? { url: `${siteUrl}/${m.reportPage}` } : {}) }))
  ];
  return { "@context": "https://schema.org", "@type": "ItemList", name, url, numberOfItems: items.length, itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, ...it })) };
}

function breadcrumbJsonLd(trail) {
  return { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: trail.map((t, i) => ({ "@type": "ListItem", position: i + 1, name: t.name, item: t.url })) };
}

const ld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replaceAll("<", "\\u003c")}</script>`;

/** /tarih/<gün>-<ay> ve /tarihte-bugun (TR) için ortak gövde. */
export function renderDayPage({ month, day, events, matches, canonicalPath, base, isToday = false }) {
  const label = dayLabel(month, day);
  const canonical = `${siteUrl}/${canonicalPath}`;
  const title = `${label} Futbol Tarihi: Tarihte Bugün | futbolradar.com`;
  const count = events.length + matches.length;
  const desc = count
    ? `${label} tarihinde futbol tarihinde yaşananlar: ${count} kaynaklı kayıt — maçlar, goller, doğumlar ve vefatlar. Her olay kaynağına bağlantılı.`
    : `${label} için henüz kaynaklı bir futbol tarihi kaydımız yok. FutbolRadar uydurma kayıt yayımlamaz.`;
  const robots = count ? ROBOTS_INDEX : ROBOTS_NOINDEX_FOLLOW;
  const idx = allDays().findIndex((d) => d.month === month && d.day === day);
  const days = allDays();
  const prev = days[(idx + days.length - 1) % days.length];
  const next = days[(idx + 1) % days.length];
  const trail = [{ name: "Ana sayfa", url: `${siteUrl}/` }, { name: "Tarihte Bugün", url: `${siteUrl}/tarihte-bugun` }];
  if (!isToday) trail.push({ name: label, url: canonical });
  const list = count
    ? `<ul class="otd-list">${events.map(eventItem).join("")}${matches.map((m) => matchItem(m, base)).join("")}</ul>`
    : `<p class="otd-empty">Bu tarih için henüz kaynaklı bir kayıt yok. FutbolRadar uydurma kayıt yayımlamaz; doğrulanmış olaylar eklendikçe bu sayfa dolar.</p>`;
  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(desc)}" />
    <meta name="robots" content="${robots}" />
    <link rel="canonical" href="${canonical}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(desc)}" />
    <meta property="og:url" content="${canonical}" />
    <link rel="icon" href="${base}favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="${base}page.css" />
    ${dayStyle()}
    ${ld(breadcrumbJsonLd(trail))}
    ${count ? ld(itemListJsonLd({ name: `${label} futbol tarihi`, url: canonical, events, matches })) : ""}
  </head>
  <body>
    <div class="site-shell">
      ${siteHeader({ base })}
      <main class="container" id="tarihte-bugun" data-on-this-day="${mdKey(month, day)}">
        <nav class="breadcrumb" aria-label="Sayfa yolu"><a href="${base}index.html">Ana sayfa</a> › <a href="${base}tarihte-bugun">Tarihte Bugün</a>${isToday ? "" : ` › <span>${esc(label)}</span>`}</nav>
        <header class="trend-hero"><div><span class="eyebrow">Futbol tarihi · Kaynaklı kayıtlar</span><h1>${esc(label)} Futbol Tarihi: Tarihte Bugün</h1><p>${esc(desc)}</p></div></header>
        <section class="trend-section">${list}
          <p class="trend-source">Kaynaklar: her olayın altında bağlantısı verilen dış kaynak; maçlar için FutbolRadar maç arşivi.${isToday ? ` Kalıcı bağlantı: <a href="${base}tarih/${daySlug(month, day)}">${esc(label)}</a>.` : ""}</p>
          <nav class="otd-days" aria-label="Diğer günler"><a href="${base}tarih/${daySlug(prev.month, prev.day)}">‹ ${esc(dayLabel(prev.month, prev.day))}</a><a href="${base}tarih/${daySlug(next.month, next.day)}">${esc(dayLabel(next.month, next.day))} ›</a></nav>
        </section>
      </main>
      ${siteFooter({ base })}
    </div>
    <script src="${base}site.js" defer></script>
  </body>
</html>\n`;
}

function updateSitemap(file, urls, lastmod) {
  if (!fs.existsSync(file)) return;
  const xml = fs.readFileSync(file, "utf8");
  const owned = (loc) => loc === `${siteUrl}/tarihte-bugun` || loc.startsWith(`${siteUrl}/tarih/`);
  const existing = (xml.match(URL_ENTRY_RE) || []).filter((entry) => { const m = entry.match(/<loc>([^<]+)<\/loc>/); return !(m && owned(m[1])); });
  const fresh = urls.map((u) => `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${u.lastmod || lastmod}</lastmod>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`);
  const next = wrapUrlset([...existing, ...fresh]);
  if (next !== xml) fs.writeFileSync(file, next, "utf8");
}

function writeBoth(rel, html) {
  for (const outRoot of [root, path.join(root, "public")]) {
    const target = path.join(outRoot, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const prev = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
    if (prev !== html) fs.writeFileSync(target, html, "utf8");
  }
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
  const eventsPath = path.join(root, "data", "on-this-day.json");
  const events = loadEvents(fs.existsSync(eventsPath) ? JSON.parse(fs.readFileSync(eventsPath, "utf8")) : {});
  const now = new Date();
  const result = collectEntries(archive, now);
  // Arşivi bir kez tara, gün/ay'a göre grupla (366 ayrı tarama yerine).
  const all = collectEntries(archive, now, "*").entries;
  const byDay = new Map();
  for (const m of all) { const k = m.date.slice(5); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(m); }
  const [tm, td] = result.monthDay.split("-").map(Number);
  const todayEvents = eventsFor(events, tm, td);
  const json = { _comment: "Türetilmiş dosya — scripts/generate-on-this-day-pages.mjs üretir; elle düzenlenmez.", sources: ["data/on-this-day.json", "data/season-archive.json"], today: result.today, monthDay: result.monthDay, count: todayEvents.length + result.entries.length, events: todayEvents, entries: result.entries };
  fs.writeFileSync(path.join(root, "data", "on-this-day-today.json"), JSON.stringify(json, null, 2) + "\n", "utf8");
  // TR kanonik /tarihte-bugun: kaynaklı olaylar + arşiv maçları.
  writeBoth("tarihte-bugun.html", renderDayPage({ month: tm, day: td, events: todayEvents, matches: result.entries, canonicalPath: "tarihte-bugun", base: "./", isToday: true }));
  // EN: yalnız arşiv maçları (olay metinleri yalnız Türkçe).
  writeBoth("en/on-this-day.html", renderPage({ lang: "en", today: result.today, entries: result.entries }));
  const sitemapUrls = [];
  if (todayEvents.length + result.entries.length) sitemapUrls.push({ loc: `${siteUrl}/tarihte-bugun`, changefreq: "daily", priority: "0.6", lastmod: result.today });
  let indexed = 0;
  for (const { month, day } of allDays()) {
    const dayEvents = eventsFor(events, month, day);
    const matches = byDay.get(mdKey(month, day)) || [];
    writeBoth(`tarih/${daySlug(month, day)}.html`, renderDayPage({ month, day, events: dayEvents, matches, canonicalPath: `tarih/${daySlug(month, day)}`, base: "../" }));
    if (dayEvents.length + matches.length) {
      indexed += 1;
      sitemapUrls.push({ loc: `${siteUrl}/tarih/${daySlug(month, day)}`, changefreq: "monthly", priority: "0.5", lastmod: result.today });
    }
  }
  for (const sm of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) updateSitemap(sm, sitemapUrls, result.today);
  console.log(`[on-this-day] ${result.today}: ${todayEvents.length} olay + ${result.entries.length} maç; /tarih: 366 gün, ${indexed} indekslenebilir`);
}
