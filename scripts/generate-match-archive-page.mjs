/**
 * MAÇ ARŞİVİ SAYFASI — /mac-arsivi.html
 *
 * Arşivdeki her maçı tarihe göre gruplayarak listeler ve her birini
 * YAYIMLANMIŞ sayfasına bağlar. Sayfası olmayan maç bağlantı almaz; ölü
 * bağlantı basmak, arşivin verdiği "burada kalıcı olarak bulunur" sözünü
 * ilk günden bozardı.
 *
 * URL'LER OLDUĞU GİBİ KORUNUYOR. Yeni bir `/mac/{fixtureId}/...` şeması
 * kurmak, bugün yayında olan ve arama motorlarında dizinlenmiş yüzlerce
 * adresi kırardı. Mevcut yollar zaten kalıcı: slug maçın takım adlarından ve
 * tarihinden deterministik olarak üretiliyor, sağlayıcı kimliğine bağlı
 * değil — yani sağlayıcı maçı unutsa bile adres aynı kalıyor.
 *
 * PERFORMANS. Aylar `<details>` ile katlanıyor; en yeni ay açık, diğerleri
 * kapalı geliyor. Tarayıcıya tek seferde bütün geçmişi ÇİZDİRMEMEK için
 * seçilen yol bu — JavaScript gerektirmiyor, süzgeçler kapalıyken de sayfa
 * tam olarak çalışıyor.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { siteHeader, siteFooter } from "./lib/layout.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);
const domain = "https://www.futbolradar.com";

const archive = require("../services/matchArchiveService.js");
const { dateOnly } = require("../services/matchCalendar.js");
const { statusLabel, statusSlug, normalizeMatchStatus, isFinishedStatus } = require("../services/matchStatus.js");
const { displayLeagueName } = require("../services/leagueIdentity.js");
const { slug } = require("../services/matchReportService.js");

const PAGE = "mac-arsivi.html";

/** En yeni ay açık gelir; geçmiş aylar katlı. */
const OPEN_MONTHS = 1;

function escapeHtml(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(value) {
  const day = dateOnly(value);
  if (!day) return "Tarih bekleniyor";
  return new Intl.DateTimeFormat("tr-TR", {
    day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul"
  }).format(new Date(`${day}T12:00:00+03:00`));
}

function formatMonth(monthKey) {
  const [year, month] = monthKey.split("-");
  return new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric", timeZone: "Europe/Istanbul" })
    .format(new Date(`${year}-${month}-15T12:00:00+03:00`));
}

/**
 * Maçın yayımlanmış sayfası.
 *
 * Sıra, içeriğin zenginliğine göre: maç sonu raporu > maçın kendi analiz
 * sayfası > fikstür sayfası. Hiçbiri yoksa null döner ve kart bağlantısız
 * basılır — okuyucuya var olmayan bir sayfa vaat edilmez.
 */
function pageFor(match) {
  const stamp = dateOnly(match.kickoff || match.date);
  const candidates = [];

  if (match.analysisPage) candidates.push(String(match.analysisPage).replace(/^\.\//, ""));
  if (stamp) candidates.push(`mac-raporu/${slug(match.homeTeam)}-${slug(match.awayTeam)}-${stamp}.html`);

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(root, candidate))) return candidate;
  }

  // Fikstür sayfaları hafta numarası taşıyor; adı bilinmediği için dizinde
  // takım+tarih eşleşmesi aranıyor.
  const fixtureDir = path.join(root, "mac");
  if (fs.existsSync(fixtureDir)) {
    const prefix = `${slug(match.homeTeam)}-${slug(match.awayTeam)}-`;
    const found = fs.readdirSync(fixtureDir).find((file) => file.startsWith(prefix));
    if (found) return `mac/${found}`;
  }

  return null;
}

const index = archive.buildIndex();
const rows = index.matches
  .map((row) => {
    const record = { ...row };
    record.page = pageFor(row);
    return record;
  })
  .sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")));

// --- Süzgeç seçenekleri gerçek veriden türetilir; boş seçenek basılmaz ---
const competitions = [...new Set(rows.map((row) => row.competition).filter(Boolean))].sort((a, b) => a.localeCompare(b, "tr"));
const teams = [...new Set(rows.flatMap((row) => [row.homeTeam, row.awayTeam]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "tr"));
const seasons = [...new Set(rows.map((row) => row.season).filter(Boolean))].sort().reverse();
const statuses = [...new Set(rows.map((row) => row.status))];

function optionList(values, label) {
  return [`<option value="">${escapeHtml(label)}</option>`]
    .concat(values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`))
    .join("");
}

function scoreCell(row) {
  if (row.score) return `<strong class="archive-score">${escapeHtml(row.score.home)}-${escapeHtml(row.score.away)}</strong>`;
  if (isFinishedStatus(row.status)) {
    // Bitmiş ama skoru doğrulanmamış maçta 0-0 yazmak veriyi uydurmaktır.
    return `<span class="archive-score is-missing">Skor bekleniyor</span>`;
  }
  return `<span class="archive-score is-pending">—</span>`;
}

function matchRow(row) {
  const status = normalizeMatchStatus(row.status);
  const inner = `<span class="archive-match-teams">` +
      `<span class="archive-team">${escapeHtml(row.homeTeam)}</span>` +
      scoreCell(row) +
      `<span class="archive-team">${escapeHtml(row.awayTeam)}</span>` +
    `</span>` +
    `<span class="archive-match-meta">` +
      `<span class="archive-competition">${escapeHtml(displayLeagueName(row.competition, "Turnuva bekleniyor"))}</span>` +
      `<span class="archive-status" data-status="${escapeHtml(statusSlug(status))}">${escapeHtml(statusLabel(status))}</span>` +
    `</span>`;

  const attrs = `data-card="archive-match" ` +
    `data-team="${escapeHtml(`${row.homeTeam} ${row.awayTeam}`)}" ` +
    `data-competition="${escapeHtml(row.competition || "")}" ` +
    `data-season="${escapeHtml(row.season || "")}" ` +
    `data-status="${escapeHtml(status)}" ` +
    `data-date="${escapeHtml(row.date || "")}"`;

  return row.page
    ? `<a class="archive-match" ${attrs} href="./${escapeHtml(row.page)}">${inner}</a>`
    : `<div class="archive-match is-unlinked" ${attrs}><span class="archive-unlinked-note" title="Bu karşılaşma için henüz yayımlanmış bir sayfa yok.">${inner}</span></div>`;
}

// --- Aylara ve günlere grupla ---
const byMonth = new Map();
for (const row of rows) {
  const month = String(row.date || "").slice(0, 7) || "tarihsiz";
  if (!byMonth.has(month)) byMonth.set(month, new Map());
  const days = byMonth.get(month);
  const day = row.date || "tarihsiz";
  if (!days.has(day)) days.set(day, []);
  days.get(day).push(row);
}

const monthKeys = [...byMonth.keys()].sort().reverse();
const monthBlocks = monthKeys.map((month, position) => {
  const days = byMonth.get(month);
  const dayKeys = [...days.keys()].sort().reverse();
  const count = dayKeys.reduce((sum, day) => sum + days.get(day).length, 0);

  const dayBlocks = dayKeys.map((day) => `<section class="archive-day" aria-labelledby="gun-${escapeHtml(day)}">
        <h3 id="gun-${escapeHtml(day)}" class="archive-day-title">${escapeHtml(formatDate(day))}</h3>
        <div class="archive-day-list">${days.get(day).map(matchRow).join("")}</div>
      </section>`).join("");

  return `<details class="archive-month" data-month="${escapeHtml(month)}"${position < OPEN_MONTHS ? " open" : ""}>
      <summary class="archive-month-summary"><span>${escapeHtml(month === "tarihsiz" ? "Tarihi bekleniyor" : formatMonth(month))}</span><b>${count} maç</b></summary>
      ${dayBlocks}
    </details>`;
}).join("");

const emptyState = `<article class="card data-empty" data-card="empty-state">
      <strong>Veri bekleniyor</strong>
      <span>Arşivde henüz kayıtlı karşılaşma yok. Bir maç doğrulandığında kalıcı olarak burada listelenir.</span>
    </article>`;

const finishedCount = rows.filter((row) => isFinishedStatus(row.status)).length;
const linkedCount = rows.filter((row) => row.page).length;

const description = `FutbolRadar maç arşivi: ${rows.length} karşılaşmanın kalıcı kaydı. ` +
  "Tarih, turnuva, takım ve sezona göre süz; her maçın analiz sayfasına doğrudan git.";

const schema = {
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  name: "Maç Arşivi",
  url: `${domain}/${PAGE}`,
  inLanguage: "tr-TR",
  description,
  isPartOf: { "@type": "WebSite", name: "FutbolRadar", url: domain }
};

const html = `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Maç Arşivi | FutbolRadar</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${domain}/${PAGE}" />
    <meta name="robots" content="index,follow" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:url" content="${domain}/${PAGE}" />
    <meta property="og:title" content="Maç Arşivi | FutbolRadar" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${domain}/assets/og-image.svg" />
    <meta name="twitter:card" content="summary_large_image" />
    <script type="application/ld+json">${JSON.stringify(schema)}</script>
    <link rel="icon" href="./favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="./site.webmanifest" />
    <link rel="stylesheet" href="./page.css" />
  </head>
  <body class="subpage match-archive-page">
    ${siteHeader({ base: "./" })}
    <main class="container">
      <nav class="breadcrumb" aria-label="Sayfa yolu"><a href="./index.html">Ana Sayfa</a><span>/</span><span>Maç Arşivi</span></nav>

      <section class="page-hero">
        <div class="page-hero-copy">
          <span class="eyebrow">Kalıcı kayıt</span>
          <h1>Maç Arşivi</h1>
          <p>FutbolRadar'da görünen her karşılaşma, sağlayıcı artık göndermese bile burada kalır. ${escapeHtml(String(rows.length))} maç kayıtlı; ${escapeHtml(String(finishedCount))} tanesi tamamlandı, ${escapeHtml(String(linkedCount))} tanesinin yayımlanmış sayfası var.</p>
        </div>
      </section>

      <form class="archive-filters" id="archive-filters" aria-label="Arşiv süzgeçleri">
        <label class="archive-filter"><span>Takım ara</span><input type="search" name="team" id="archive-search" placeholder="Takım adı" autocomplete="off" /></label>
        <label class="archive-filter"><span>Turnuva</span><select name="competition" id="archive-competition">${optionList(competitions, "Tümü")}</select></label>
        <label class="archive-filter"><span>Sezon</span><select name="season" id="archive-season">${optionList(seasons, "Tümü")}</select></label>
        <label class="archive-filter"><span>Durum</span><select name="status" id="archive-status">${[`<option value="">Tümü</option>`].concat(statuses.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(statusLabel(value))}</option>`)).join("")}</select></label>
        <label class="archive-filter"><span>Tarih</span><input type="date" name="date" id="archive-date" /></label>
        <button type="reset" class="archive-filter-reset">Süzgeçleri temizle</button>
      </form>
      <p class="archive-filter-status" id="archive-filter-status" role="status" hidden></p>

      <section class="archive-list" id="archive-list" aria-label="Arşivlenmiş maçlar">
        ${rows.length ? monthBlocks : emptyState}
      </section>

      <section class="archive-note">
        <h2>Bu arşiv neden var?</h2>
        <p>Sağlayıcının geçmiş penceresi sitenin hafızası değildir. Maç takvimi her senkronda yeniden yazılıyor ve yalnızca son üç günü tutuyordu; daha eski bir karşılaşma başka hiçbir yerde kayıtlı değilse siteden tamamen siliniyordu. Arşiv, görülen her maçı kalıcı olarak saklar ve sağlayıcı cevaplarını gerçeğin tamamı değil, güncelleme olarak işler.</p>
        <p>Eksik alanlar uydurulmaz: skoru doğrulanmamış bir maçta 0-0 yazmak yerine "Skor bekleniyor" yazılır.</p>
      </section>
    </main>
    ${siteFooter({ base: "./" })}
    <script src="./site.js" defer></script>
    <script src="./app.js" defer></script>
  </body>
</html>
`;

for (const base of [root, path.join(root, "public")]) {
  fs.mkdirSync(base, { recursive: true });
  fs.writeFileSync(path.join(base, PAGE), html, "utf8");
}

// --- Site haritası ---
const sitemapPath = path.join(root, "sitemap.xml");
if (fs.existsSync(sitemapPath)) {
  let xml = fs.readFileSync(sitemapPath, "utf8");
  const loc = `${domain}/${PAGE}`;
  if (!xml.includes(`<loc>${loc}</loc>`)) {
    const entry = `  <url>\n    <loc>${loc}</loc>\n    <changefreq>daily</changefreq>\n    <priority>0.6</priority>\n  </url>`;
    xml = xml.replace("</urlset>", `${entry}\n</urlset>`);
    fs.writeFileSync(sitemapPath, xml, "utf8");
    fs.writeFileSync(path.join(root, "public", "sitemap.xml"), xml, "utf8");
  }
}

console.log(`Maç arşivi sayfası: ${rows.length} maç, ${monthKeys.length} ay, ${linkedCount} bağlantılı.`);
