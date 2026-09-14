/**
 * İNGİLİZCE HUB SAYFA KABUĞU — lig ve kulüp giriş sayfalarının ortak iskeleti.
 *
 * İki üretici (`generate-en-league-hubs.mjs`, `generate-en-club-hubs.mjs`)
 * aynı `<head>`i, aynı bölüm biçimlerini ve aynı iç bağlantı kurallarını
 * kullanıyor. Kabuk burada tek yerde durmasaydı canonical/hreflang/OG üçlüsü
 * iki dosyada ayrı ayrı bakım isterdi — ve biri unutulduğunda hata SESSİZ
 * olurdu: sayfa render olur, yalnızca Google onu kopya sayar.
 *
 * VERİ UYDURULMAZ. Maç listesi `curatedMatches()` kaydından süzülür, puan
 * durumu `standingsData.mjs`ten okunur; kayıt yoksa bölüm dürüst bir boş
 * durum basar. Boş bir tabloyu içerikmiş gibi göstermek, hem okuyucuyu hem
 * de arama motorunu yanıltmak olurdu.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { siteFooter, siteHeader } from "./layout.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./sitemap.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const { DOMAIN } = require("../../services/i18n.js");
const { isDisplayableLive, istanbulDay, kickoffMs, matchState } = require("../../services/matchStatus.js");
const { enPathForMatch, loadRegistry } = require("../../services/matchSeoPages.js");

export const SITE_URL = DOMAIN;
export const SOCIAL_IMAGE = `${DOMAIN}/assets/og-image.svg`;

let registryCache = null;
function registryPages() {
  if (!registryCache) registryCache = loadRegistry().pages;
  return registryCache;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/** Köke ve `public/` aynasına birlikte yazar; ikisi de yayımlanıyor. */
export function writeEnPage(relativePath, html) {
  for (const outputRoot of [root, path.join(root, "public")]) {
    const destination = path.join(outputRoot, "en", relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, html, "utf8");
  }
}

/**
 * "SONUÇ" TANIMI — TÜRKÇE LİG SAYFASIYLA BİREBİR AYNI KAPI.
 *
 * `generate-league-pages.mjs` bir maçı ancak dört koşul birden sağlanınca
 * sonuç sayar. İngilizce taraf DAHA GEVŞEK bir kapı kullansaydı, aynı maç
 * Türkçe sayfada "henüz doğrulanmadı", İngilizce sayfada kesinleşmiş skor
 * gibi görünürdü — iki dilin aynı veriyi farklı anlatması, görevin
 * 18. maddesinde açıkça yasaklanan durum.
 */
export function isVerifiedFinalMatch(match) {
  const status = String((match && match.status) || "").toUpperCase();
  const score = match && match.score;
  const completeScore =
    Boolean(score) && Number.isFinite(Number(score.home)) && Number.isFinite(Number(score.away));
  return (
    status === "FINISHED" &&
    completeScore &&
    String((match && match.dataStatus) || "").toLowerCase() === "verified" &&
    String((match && match.publishState) || "").toLowerCase() === "complete"
  );
}

/**
 * MAÇ DURUMU ETİKETİ — İNGİLİZCE, ULUSLARARASI KULLANIMA GÖRE.
 *
 * Görev tanımındaki dört etiket ("LIVE", "HT", "FT", kick-off time)
 * uluslararası canlı skor sitelerinin ortak dilidir; Türkçe "MS"/"İY"
 * kısaltmalarının birebir çevirisi değil.
 *
 * "LIVE" ROZETİ SAĞLAYICININ SÖZÜNE GÜVENMEZ. Anlık görüntüdeki kayıtların
 * çoğu, beslemenin hiç kapatmadığı ESKİ maçlardır ve hâlâ "LIVE" taşır;
 * bunları canlı göstermek okuyucuya yanlış bir olgu sunmak olurdu. Rozet bu
 * yüzden `isDisplayableLive` kapısından geçer — sitenin geri kalanıyla aynı
 * kapı. Kapıyı geçemeyen maç başlama saatine düşer.
 */
export function statusBadge(match) {
  if (isVerifiedFinalMatch(match)) return { label: "FT", tone: "final" };

  const state = matchState(match);
  if (state === "POSTPONED") return { label: "Postponed", tone: "muted" };
  if (state === "CANCELLED") return { label: "Cancelled", tone: "muted" };

  if (isDisplayableLive(match)) {
    if (state === "HALFTIME") return { label: "HT", tone: "live" };
    const minute = Number(match && match.minute);
    return { label: Number.isFinite(minute) && minute > 0 ? `${minute}'` : "LIVE", tone: "live" };
  }

  return { label: kickoffTime(match), tone: "scheduled" };
}

function kickoffTime(match) {
  const value = match && match.kickoff;
  if (!value) return match && match.time ? String(match.time) : "TBC";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "TBC";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(parsed);
}

export function formatEnDate(value) {
  const parsed = value instanceof Date ? value : new Date(String(value || ""));
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(parsed);
}

/**
 * SKOR YALNIZCA ARKASINDA BİR İDDİA VARSA YAZILIR.
 *
 * Doğrulanmış bitmiş maç ya da gerçekten canlı maç — başka hiçbir durumda.
 * Anlık görüntüde kapanmamış eski kayıtlar "0-0" taşıyor; onu basmak
 * oynanmamış bir maçın skoru gibi okunurdu.
 */
function scoreText(match) {
  if (!isVerifiedFinalMatch(match) && !isDisplayableLive(match)) return null;
  const score = match && match.score;
  if (!score) return null;
  if (!Number.isFinite(Number(score.home)) || !Number.isFinite(Number(score.away))) return null;
  return `${score.home} – ${score.away}`;
}

/**
 * TEK MAÇ SATIRI.
 *
 * Maçın kendi İngilizce SEO sayfası varsa satır ORAYA bağlanır (§14 iç
 * linkleme): İngilizce okuyucu Türkçe bir adrese gönderilmez. Sayfa yoksa
 * satır bağlantısız kalır — var olmayan bir adrese link vermektense düz
 * metin göstermek dürüsttür.
 */
export function matchRow(match, { base = "../" } = {}) {
  const badge = statusBadge(match);
  const score = scoreText(match);
  const href = enPathForMatch(match, registryPages());
  const teams = `${escapeHtml(match.homeTeam)} <span class="en-hub-vs" aria-hidden="true">v</span> ${escapeHtml(match.awayTeam)}`;
  const scoreCell = score
    ? `<span class="en-hub-score">${escapeHtml(score)}</span>`
    : `<span class="en-hub-score en-hub-score-empty" aria-hidden="true">—</span>`;
  const inner = `<span class="en-hub-row-date">${escapeHtml(formatEnDate(match.kickoff))}</span>
        <span class="en-hub-row-teams">${teams}</span>
        <span class="en-hub-row-status" data-tone="${badge.tone}">${escapeHtml(badge.label)}</span>
        ${scoreCell}`;
  if (!href) return `<li class="en-hub-row">${inner}</li>`;
  const target = `${base}${String(href).replace(/^\.?\//, "")}`;
  return `<li class="en-hub-row"><a class="en-hub-row-link" href="${escapeHtml(target)}">${inner}</a></li>`;
}

export function matchListSection({ id, heading, matches, emptyText, base }) {
  const body = matches.length
    ? `<ul class="en-hub-list">${matches.map((match) => matchRow(match, { base })).join("")}</ul>`
    : `<p class="en-hub-empty">${escapeHtml(emptyText)}</p>`;
  return `<section class="evergreen-section" aria-labelledby="${id}"><h2 id="${id}">${escapeHtml(heading)}</h2>${body}</section>`;
}

export function standingsTable(rows, caption) {
  const body = rows
    .map((row) => {
      const gd = row.goalDifference === null || row.goalDifference === undefined
        ? "—"
        : `${Number(row.goalDifference) > 0 ? "+" : ""}${row.goalDifference}`;
      const cell = (value) => (value === null || value === undefined || value === "" ? "—" : escapeHtml(value));
      return `<tr><td>${cell(row.rank)}</td><th scope="row">${escapeHtml(row.name)}</th><td>${cell(row.played)}</td><td>${cell(row.won)}</td><td>${cell(row.drawn)}</td><td>${cell(row.lost)}</td><td>${cell(row.goalsFor)}</td><td>${cell(row.goalsAgainst)}</td><td>${gd}</td><td><strong>${cell(row.points)}</strong></td></tr>`;
    })
    .join("");
  return `<div class="evergreen-table-wrap"><table class="evergreen-table"><caption>${escapeHtml(caption)}</caption><thead><tr><th scope="col">#</th><th scope="col">Team</th><th scope="col">P</th><th scope="col">W</th><th scope="col">D</th><th scope="col">L</th><th scope="col">GF</th><th scope="col">GA</th><th scope="col">GD</th><th scope="col">Pts</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

export function relatedLinks(heading, links) {
  return `<aside class="evergreen-related" aria-labelledby="en-hub-related"><h2 id="en-hub-related">${escapeHtml(heading)}</h2><div class="evergreen-link-grid">${links
    .map(([href, label]) => `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`)
    .join("")}</div></aside>`;
}

export function breadcrumbHtml(items) {
  return `<nav class="evergreen-breadcrumb" aria-label="Breadcrumb">${items
    .map((item, index) =>
      index === items.length - 1
        ? `<span aria-current="page">${escapeHtml(item.name)}</span>`
        : `<a href="${escapeHtml(item.href)}">${escapeHtml(item.name)}</a><span aria-hidden="true">/</span>`)
    .join("")}</nav>`;
}

export function breadcrumbSchema(items) {
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

/**
 * SportsEvent düğümleri — yalnızca OYNANMAMIŞ maçlar için.
 *
 * Google Rich Results, `SportsEvent` için gelecekteki bir `startDate` bekler;
 * bitmiş maçları olay olarak bildirmek uyarı üretir ve zaten kullanıcıya
 * hiçbir şey kazandırmaz. Bitmiş maçlar sayfada görünür, yapılandırılmış
 * veride değil.
 */
export function sportsEventNodes(matches, limit = 10) {
  return matches
    .filter((match) => match && match.kickoff && kickoffMs(match) > Date.now())
    .slice(0, limit)
    .map((match) => ({
      "@type": "SportsEvent",
      name: `${match.homeTeam} v ${match.awayTeam}`,
      startDate: match.kickoff,
      eventStatus: "https://schema.org/EventScheduled",
      eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
      ...(match.venue
        ? { location: { "@type": "Place", name: match.venue, address: match.city || "Türkiye" } }
        : {}),
      competitor: [
        { "@type": "SportsTeam", name: match.homeTeam },
        { "@type": "SportsTeam", name: match.awayTeam }
      ]
    }));
}

/**
 * SAYFA BELGESİ.
 *
 * `hreflang` üçlüsü BURADA gövdeye gömülüyor ve `x-default` Türkçedir:
 * ana alan adı Türkçe kalır. Enjektör (`inject-hreflang.mjs`) dinamik
 * eşlemeden gelen çiftleri de ayrıca yazar; ikisinin çakışmaması için
 * bu üreticiler eşlemeye `kind: "en-hub"` ile giriyor ve enjektör aynı
 * bloğu yeniden yazıyor — işaretli blok idempotan.
 */
export function hubDocument({
  title,
  description,
  canonicalPath,
  trPath,
  kicker,
  h1,
  intro,
  breadcrumbs,
  graph,
  content,
  dataDate
}) {
  const canonical = `${SITE_URL}${canonicalPath}`;
  const schema = { "@context": "https://schema.org", "@graph": graph };
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="index,follow" />
    <link rel="canonical" href="${canonical}" />
    <!-- hreflang etiketleri bu üreticide YAZILMAZ.
         Bu sayfalar dinamik rota eşlemesine giriyor (kind: en-league-hub /
         en-club-hub) ve inject-hreflang.mjs eşlemedeki her çift için işaretli
         bloğu iki tarafa da basıyor. Burada ayrıca bir üçlü yazmak, aynı
         sayfada İKİ ayrı alternate kümesi bırakırdı: enjektör yalnızca kendi
         işaretli bloğunu söküp yeniden yazdığı için buradaki kopya her
         derlemede hayatta kalır ve Google'a aynı ilişki iki kez bildirilirdi.
         Tek kaynak enjektördür. -->
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="en_US" />
    <meta property="og:locale:alternate" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${SOCIAL_IMAGE}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${SOCIAL_IMAGE}" />
    <link rel="icon" href="../favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="../page.css" />
    <script type="application/ld+json">${JSON.stringify(schema).replaceAll("<", "\\u003c")}</script>
  </head>
  <body>
    <div class="site-shell">
      ${siteHeader({ base: "../", locale: "en", altHref: trPath })}
      <main class="evergreen-page en-hub-page">
        <div class="container">
          ${breadcrumbHtml(breadcrumbs)}
          <header class="evergreen-hero">
            <span class="section-kicker">${escapeHtml(kicker)}</span>
            <h1>${escapeHtml(h1)}</h1>
            <p>${escapeHtml(intro)}</p>
            <p class="evergreen-freshness"><time datetime="${dataDate}">Data date: ${dataDate}</time> · Kick-off times shown in Türkiye time (UTC+3). Only provider-verified records are shown.</p>
          </header>
          ${content}
        </div>
      </main>
      ${siteFooter({ base: "../", locale: "en" })}
    </div>
    <script src="../site.js" defer></script>
  </body>
</html>
`;
}

/** Bugünün İstanbul tarihi — "yaklaşan" ve "son" ayrımı buna göre. */
export function todayIstanbul() {
  return istanbulDay(new Date().toISOString());
}

/**
 * ÜRETİLEN HUB SAYFALARINI SİTE HARİTASINA EKLE.
 *
 * Girdi, kendi `<xhtml:link>` alternate çocuklarını DA taşır: site haritası
 * Google'ın hreflang çiftini okuduğu ikinci yerdir ve sayfa içi etiketlerle
 * tutarsız kalırsa çift tek yönlü sayılır.
 *
 * Mevcut girdiler KORUNUR, yalnızca aynı adresi taşıyanlar tazelenir — bu
 * adım derleme zincirinde birden çok kez koşabilir ve her koşuda haritayı
 * büyütmemelidir.
 */
export function appendHubSitemapEntries(rows, { changefreq = "daily", priority = "0.8" } = {}) {
  for (const outputRoot of [root, path.join(root, "public")]) {
    const file = path.join(outputRoot, "sitemap.xml");
    if (!fs.existsSync(file)) continue;

    const xml = fs.readFileSync(file, "utf8");
    const wanted = new Map(rows.map((row) => [`${SITE_URL}/${row.en}`, row]));
    // Kalıp ve kök etiket paylaşılan tanımdan geliyor (./sitemap.mjs): burada
    // ikinci bir kopya tutmak, tam da o dosyanın düzelttiği sessiz veri
    // kaybını bu üreticide yeniden üretmek olurdu.
    const kept = (xml.match(URL_ENTRY_RE) || []).filter(
      (entry) => ![...wanted.keys()].some((url) => entry.includes(`<loc>${url}</loc>`))
    );
    const fresh = [...wanted.entries()].map(([url, row]) => {
      const trUrl = `${SITE_URL}/${row.tr}`;
      return `  <url>\n    <loc>${url}</loc>\n    <xhtml:link rel="alternate" hreflang="tr-TR" href="${trUrl}"/>\n    <xhtml:link rel="alternate" hreflang="en" href="${url}"/>\n    <xhtml:link rel="alternate" hreflang="x-default" href="${trUrl}"/>\n    <lastmod>${row.lastmod}</lastmod>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
    });

    fs.writeFileSync(file, wrapUrlset([...kept, ...fresh]), "utf8");
  }
}
