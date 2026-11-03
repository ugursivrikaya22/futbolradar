/**
 * ANAHTAR KELİME + EVERGREEN SAYFALARI (2 Kasım 2026).
 *
 * Ugur'un seçtiği hedef sorgular için kalıcı, mobil öncelikli sayfalar:
 *   galatasaray-son-dakika.html            ← "Galatasaray son dakika"
 *   fenerbahce-transfer.html               ← "Fenerbahçe transfer"
 *   besiktas-mac-ozetleri.html             ← "Beşiktaş maç özeti"
 *   turkiye-kupasi-fikstur.html            ← "Türkiye Kupası fikstür"
 *   super-lig-tarihcesi.html               ← "Süper Lig tarihçesi / şampiyonlar"
 *   super-lig-kadrolari-2026-2027.html     ← "takım kadroları 2026-2027"
 *   super-lig-gol-kralligi-tum-zamanlar.html ← "gol krallığı tüm zamanlar"
 *   derbi-gecmisi.html                     ← "derbi geçmişi"
 *
 * UYDURMA YOK KURALI: her sayfa ya sitenin kendi kayıtlı verisinden
 * (data/news.json, data/transfers.json, data/historical-match-archive.json,
 * data/super-lig-squads.json — API-Football) ya da kaynağı ve revizyonu
 * kayıtlı bir dış belgeden (data/evergreen-history-sources.json — Wikipedia
 * revizyonları; data/turkiye-kupasi-tff.json — tff.org) üretilir ve görünür
 * bir "Kaynaklar" bölümü taşır. Veri yoksa ilgili bölüm boş geçilir, metin
 * uydurulmaz.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { siteFooter, siteHeader } from "./lib/layout.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";
import { ROBOTS_INDEX } from "./lib/robots.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://www.futbolradar.com";
const OG = `${SITE}/assets/og-image.png`;
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, "data", file), "utf8"));

const news = read("news.json");
const transfers = read("transfers.json");
const archive = read("historical-match-archive.json").records.map((record) => record.match);
const squads = read("super-lig-squads.json");
const teams = read("teams.json");
const history = read("evergreen-history-sources.json");
const cup = read("turkiye-kupasi-tff.json");
const fixtures = read("super-lig-fixtures.json");

export const KEYWORD_PAGES = [
  { file: "galatasaray-son-dakika.html", keyword: "Galatasaray son dakika" },
  { file: "fenerbahce-transfer.html", keyword: "Fenerbahçe transfer" },
  { file: "besiktas-mac-ozetleri.html", keyword: "Beşiktaş maç özeti" },
  { file: "turkiye-kupasi-fikstur.html", keyword: "Türkiye Kupası fikstür" },
  { file: "super-lig-tarihcesi.html", keyword: "Süper Lig tarihçesi" },
  { file: "super-lig-kadrolari-2026-2027.html", keyword: "takım kadroları 2026-2027" },
  { file: "super-lig-gol-kralligi-tum-zamanlar.html", keyword: "gol krallığı tüm zamanlar" },
  { file: "derbi-gecmisi.html", keyword: "derbi geçmişi" },
  { file: "super-lig-bu-hafta.html", keyword: "Süper Lig bu hafta" },
  { file: "galatasaray-stuttgart.html", keyword: "Galatasaray Stuttgart" },
  { file: "vfb-stuttgart.html", keyword: "VfB Stuttgart" }
];

function esc(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
const exists = (rel) => fs.existsSync(path.join(root, rel.replace(/^\.\//, "").replace(/[?#].*$/, "")));
const TR_MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
function trDate(iso, withTime = false) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  const text = `${Number(get("day"))} ${TR_MONTHS[Number(get("month")) - 1]} ${get("year")}`;
  return withTime ? `${text}, ${get("hour")}:${get("minute")} TSİ` : text;
}
const isoDay = (iso) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(date);
};
const today = isoDay(new Date().toISOString());
const maxDay = (...days) => days.filter(Boolean).sort().at(-1) || today;

/** İç bağlantı yalnızca hedef dosya diskte varsa çizilir (kırık link olmaz). */
function link(href, text) {
  const file = href.replace(/^\.\//, "").replace(/[?#].*$/, "");
  const candidates = [file, `${file}.html`];
  if (!candidates.some((candidate) => exists(candidate) || MATCH_HUB_FILES.has(candidate) || TEAM_HUB_FILES.has(candidate))) return "";
  return `<a href="${esc(href)}">${esc(text)}</a>`;
}
/** Bu çalıştırmada üretilecek maç merkezleri: ilk üretimde de bağlantı verilebilsin. */
const readJsonDir = (dir) => fs.existsSync(path.join(root, "data", dir)) ? fs.readdirSync(path.join(root, "data", dir)).filter((n) => n.endsWith(".json")).map((n) => JSON.parse(fs.readFileSync(path.join(root, "data", dir, n), "utf8"))) : [];
const MATCH_HUB_DATA = new Map(readJsonDir("match-hubs").map((h) => [h.file, h]));
const MATCH_HUB_FILES = new Set(MATCH_HUB_DATA.keys());
const TEAM_HUB_FILES = new Set(readJsonDir("team-hubs").map((t) => t.file));
function linkGrid(title, items) {
  const html = items.map(([href, text]) => link(href, text)).filter(Boolean);
  if (!html.length) return "";
  return `<aside class="evergreen-related" aria-labelledby="rel-${esc(title.length)}"><h2 id="rel-${esc(title.length)}">${esc(title)}</h2><div class="evergreen-link-grid">${html.join("")}</div></aside>`;
}
function table(headers, rows, caption) {
  return `<div class="evergreen-table-wrap"><table class="evergreen-table"><caption>${esc(caption)}</caption><thead><tr>${headers.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}
function sourcesSection(sources) {
  const unique = [];
  const seen = new Set();
  for (const source of sources) {
    if (!source || !source.url || seen.has(source.url)) continue;
    seen.add(source.url);
    unique.push(source);
  }
  return `<section class="evergreen-section" aria-labelledby="kaynaklar"><h2 id="kaynaklar">Kaynaklar</h2><ul class="evergreen-sources">${unique
    .map((source) => `<li>${source.url.startsWith(SITE) || source.url.startsWith("/") ? `<a href="${esc(source.url)}">${esc(source.name)}</a>` : `<a href="${esc(source.url)}" rel="nofollow noopener noreferrer" target="_blank">${esc(source.name)}</a>`}${source.note ? ` — ${esc(source.note)}` : ""}</li>`)
    .join("")}</ul></section>`;
}
const wiki = (key) => ({ name: `Wikipedia (EN) — ${history.source[key].title}, revizyon ${history.source[key].oldid} (erişim ${trDate(history.retrievedAt)})`, url: `https://en.wikipedia.org/w/index.php?oldid=${history.source[key].oldid}` });
const SITE_DATA = { name: "FutbolRadar maç verisi (API-Football kaynaklı, sitenin /api/matches ve maç arşivi)", url: `${SITE}/mac-sonuclari.html` };

function page({ file, title, description, h1, kicker, intro, crumbs, schemaType = "CollectionPage", extraSchema = [], content, dateModified }) {
  const canonical = `${SITE}/${file}`;
  const breadcrumb = [{ name: "Ana Sayfa", href: "./", url: `${SITE}/` }, ...crumbs, { name: h1, href: `./${file}`, url: canonical }];
  const graph = [
    { "@type": schemaType, "@id": `${canonical}#page`, url: canonical, name: h1, headline: title, description, inLanguage: "tr-TR", dateModified, ...(schemaType === "Article" ? { datePublished: dateModified, author: { "@type": "Organization", name: "FutbolRadar", url: `${SITE}/` } } : {}), isPartOf: { "@type": "WebSite", name: "FutbolRadar", url: `${SITE}/` }, publisher: { "@type": "Organization", name: "FutbolRadar", url: `${SITE}/`, logo: { "@type": "ImageObject", url: OG } } },
    { "@type": "BreadcrumbList", itemListElement: breadcrumb.map((item, index) => ({ "@type": "ListItem", position: index + 1, name: item.name, item: item.url })) },
    ...extraSchema
  ];
  const crumbHtml = `<nav class="evergreen-breadcrumb" aria-label="İçerik yolu">${breadcrumb.map((item, index) => index === breadcrumb.length - 1 ? `<span aria-current="page">${esc(item.name)}</span>` : `<a href="${esc(item.href)}">${esc(item.name)}</a><span aria-hidden="true">/</span>`).join("")}</nav>`;
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
    <meta property="og:image" content="${OG}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(title)}" />
    <meta name="twitter:description" content="${esc(description)}" />
    <meta name="twitter:image" content="${OG}" />
    <meta name="theme-color" content="#0b1520" />
    <link rel="manifest" href="./site.webmanifest" />
    <link rel="icon" href="./favicon.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="./apple-touch-icon.png" />
    <link rel="stylesheet" href="./page.css" />
    <style>.kw-badge{display:inline-block;border-radius:999px;padding:2px 8px;font-size:12px;font-weight:700}.kw-official{background:#0b8f5a;color:#fff}.kw-rumour{background:#b26a00;color:#fff}.kw-list{list-style:none;padding:0;margin:0;display:grid;gap:10px}.kw-list li{border:1px solid rgba(127,127,127,.25);border-radius:12px;padding:12px}.kw-list time{font-size:12px;opacity:.75;display:block}.evergreen-sources{padding-left:18px;font-size:14px;line-height:1.55;word-break:break-word}.kw-squad{display:grid;gap:12px}@media(min-width:760px){.kw-squad{grid-template-columns:repeat(2,minmax(0,1fr))}}</style>
    <script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replaceAll("<", "\\u003c")}</script>
  </head>
  <body>
    <div class="site-shell">
      ${siteHeader({ base: "./" })}
      <main class="evergreen-page">
        <div class="container">
          ${crumbHtml}
          <header class="evergreen-hero">
            <span class="section-kicker">${esc(kicker)}</span>
            <h1>${esc(h1)}</h1>
            <p>${esc(intro)}</p>
            <p class="evergreen-freshness"><time datetime="${dateModified}">Son güncelleme: ${trDate(`${dateModified}T12:00:00+03:00`)}</time> · Yalnızca kaynağı gösterilen bilgiler yer alır.</p>
          </header>
          ${content}
        </div>
      </main>
      ${siteFooter({ base: "./" })}
    </div>
    <script src="./site.js" defer></script>
  </body>
</html>
`;
}

const HUB_LINKS = [
  ["./super-lig-puan-durumu", "Süper Lig puan durumu"],
  ["./super-lig-fikstur.html", "Süper Lig fikstürü"],
  ["./gol-kralligi.html", "Gol krallığı (bu sezon)"],
  ["./super-lig-tarihcesi.html", "Süper Lig tarihçesi"],
  ["./derbi-gecmisi.html", "Derbi geçmişi"],
  ["./super-lig-kadrolari-2026-2027.html", "Takım kadroları 2026-27"],
  ["./super-lig-gol-kralligi-tum-zamanlar.html", "Tüm zamanların gol krallığı"],
  ["./turkiye-kupasi-fikstur.html", "Türkiye Kupası fikstürü"],
  ["./galatasaray-son-dakika.html", "Galatasaray son dakika"],
  ["./fenerbahce-transfer.html", "Fenerbahçe transfer"],
  ["./besiktas-mac-ozetleri.html", "Beşiktaş maç özetleri"],
  ["./super-lig-bu-hafta.html", "Süper Lig bu hafta"]
];
/**
 * Maç dosyası "adaları": iç link denetiminde (seo-ic-link-yetim-sayfalar.csv)
 * ana sayfadan ulaşılamayan küme. Her kümenin KÖK dosyasına (başka bir
 * dosyanın öneki olan en kısa ad) takım sayfasından bağlanınca alt sayfalar
 * da ulaşılabilir olur.
 */
function matchDossierRoots(slug) {
  const dir = path.join(root, "mac-dosyasi");
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((name) => name.endsWith(".html") && name.includes(slug)).map((name) => name.replace(/\.html$/, ""));
  return files.filter((name) => !files.some((other) => other !== name && name.startsWith(`${other}-`))).sort()
    .map((name) => [`./mac-dosyasi/${name}.html`, `Maç dosyası: ${name.replace(/-mac-(dosyasi|analizi)$/, "").split("-").map((w) => w.charAt(0).toLocaleUpperCase("tr") + w.slice(1)).join(" ")}`]);
}
// Maç takvimi ve aylık arşivleri (iç link denetiminde gelen linki zayıf sayfalar).
const CALENDAR_LINKS = [["./mac-takvimi.html", "Maç takvimi"],
  ...(fs.existsSync(path.join(root, "mac-takvimi")) ? fs.readdirSync(path.join(root, "mac-takvimi")).filter((n) => /^\d{4}-\d{2}\.html$/.test(n)).sort()
    .map((n) => [`./mac-takvimi/${n}`, `Maç takvimi ${n.slice(5, 7)}/${n.slice(0, 4)}`]) : [])];
const hubLinksExcept = (file) => [...HUB_LINKS.filter(([href]) => !href.endsWith(file)), ...CALENDAR_LINKS];

function matchRowLink(match) {
  const report = match.reportPage && exists(match.reportPage) ? `./${match.reportPage}` : null;
  return report ? `<a href="${esc(report)}">Maç raporu</a>` : "—";
}
const finishedArchive = archive.filter((m) => m && m.status === "FINISHED" && m.score && Number.isFinite(m.score.home) && Number.isFinite(m.score.away));
const isTeam = (name, team) => String(name || "").replace(/\s+U\d+$/, "") === team && !/\bU\d+\b/.test(name);
const teamMatches = (team) => finishedArchive.filter((m) => isTeam(m.homeTeam, team) || isTeam(m.awayTeam, team)).sort((a, b) => b.kickoff.localeCompare(a.kickoff));
const upcomingFixtures = (team) => fixtures.rounds.flatMap((round) => round.matches.map((m) => ({ ...m, round: round.round })))
  .filter((m) => (m.homeTeam === team || m.awayTeam === team) && m.kickoff && new Date(m.kickoff) > new Date())
  .sort((a, b) => a.kickoff.localeCompare(b.kickoff));

// ---------------------------------------------------------------- Galatasaray
function galatasarayPage() {
  const file = "galatasaray-son-dakika.html";
  const items = news.filter((n) => n.status === "verified" && (n.team === "Galatasaray" || n.category === "Galatasaray") && exists(`haber/${n.slug}.html`))
    .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt))).slice(0, 20);
  const next = upcomingFixtures("Galatasaray").slice(0, 3);
  const last = teamMatches("Galatasaray").slice(0, 5);
  const list = items.length
    ? `<ul class="kw-list">${items.map((n) => `<li><time datetime="${esc(n.publishedAt)}">${esc(trDate(n.publishedAt, true))}</time><a href="./haber/${esc(n.slug)}.html"><strong>${esc(n.title)}</strong></a>${n.summary ? `<p>${esc(n.summary)}</p>` : ""}</li>`).join("")}</ul>`
    : "<p>Arşivimizde şu an doğrulanmış Galatasaray haberi yok.</p>";
  const nextRows = next.map((m) => `<tr><td>${esc(trDate(m.kickoff, true))}</td><td>${esc(m.round)}. hafta</td><th scope="row">${esc(m.homeTeam)} - ${esc(m.awayTeam)}</th><td>${esc(m.venue || "—")}</td></tr>`);
  const lastRows = last.map((m) => `<tr><td>${esc(trDate(m.kickoff))}</td><td>${esc(m.competition)}</td><th scope="row">${esc(m.homeTeam)} ${m.score.home}-${m.score.away} ${esc(m.awayTeam)}</th><td>${matchRowLink(m)}</td></tr>`);
  const sources = items.flatMap((n) => (n.sources || []).slice(0, 2));
  const dateModified = maxDay(...items.map((n) => isoDay(n.publishedAt)), ...last.map((m) => isoDay(m.kickoff)));
  return {
    file, dateModified,
    html: page({
      file, dateModified,
      title: "Galatasaray Son Dakika: Haberler, Fikstür ve Sonuçlar | FutbolRadar",
      description: "Galatasaray son dakika gelişmeleri: FutbolRadar'da yayımlanan doğrulanmış Galatasaray haberleri, sıradaki Süper Lig maçları ve son sonuçlar tek sayfada.",
      h1: "Galatasaray Son Dakika", kicker: "Takım merkezi",
      intro: "Bu sayfa FutbolRadar'da yayımlanmış ve kaynakları haber sayfasında listelenmiş Galatasaray haberlerini, TFF fikstürüne göre sıradaki maçları ve maç arşivimizdeki son sonuçları bir araya getirir. Burada yeni haber yazılmaz.",
      crumbs: [{ name: "Takımlar", href: "./takimlar", url: `${SITE}/takimlar` }, { name: "Galatasaray", href: "./takimlar/galatasaray", url: `${SITE}/takimlar/galatasaray` }],
      content: `<section class="evergreen-section" aria-labelledby="gs-news"><h2 id="gs-news">Son Galatasaray haberleri</h2>${list}<p>${link("./haberler.html", "Tüm haberler")}</p></section>
<section class="evergreen-section" aria-labelledby="gs-next"><h2 id="gs-next">Sıradaki maçlar</h2>${nextRows.length ? table(["Tarih", "Hafta", "Maç", "Stat"], nextRows, "Galatasaray sıradaki Süper Lig maçları") : "<p>Kayıtlı yaklaşan maç yok.</p>"}<p>${link("./galatasaray-maclari.html", "Galatasaray'ın tüm maçları")}</p></section>
<section class="evergreen-section" aria-labelledby="gs-last"><h2 id="gs-last">Son sonuçlar</h2>${lastRows.length ? table(["Tarih", "Turnuva", "Skor", "Rapor"], lastRows, "Galatasaray son maç sonuçları") : "<p>Arşivde sonuç yok.</p>"}</section>
${linkGrid("Galatasaray sayfaları", [["./takimlar/galatasaray", "Galatasaray takım profili"], ["./galatasaray-maclari.html", "Galatasaray maçları"], ["./galatasaray-puan-durumu.html", "Galatasaray puan durumu"], ["./galatasaray-form-durumu.html", "Galatasaray form durumu"], ["./galatasaray-oyuncu-radari.html", "Galatasaray oyuncu radarı"], ["./karsilastirma/takimlar/galatasaray-vs-fenerbahce", "Galatasaray - Fenerbahçe karşılaştırması"], ["./galatasaray-stuttgart.html", "Galatasaray - Stuttgart (Şampiyonlar Ligi, 3 Kasım 2026)"], ["./vfb-stuttgart.html", "Rakip: VfB Stuttgart profili"]])}
${linkGrid("Galatasaray maç dosyaları", matchDossierRoots("galatasaray"))}
${linkGrid("Süper Lig rehberleri", hubLinksExcept(file))}
${sourcesSection([{ name: "FutbolRadar haber arşivi (her haberin kaynakları kendi sayfasında)", url: `${SITE}/haberler.html` }, { name: "TFF — Süper Lig 2026-27 fikstürü (sitenin data/super-lig-fixtures.json kaydı)", url: "https://www.tff.org/default.aspx?pageID=198" }, SITE_DATA, ...sources])}`
    })
  };
}

// ---------------------------------------------------------------- Fenerbahçe
function fenerbahceTransferPage() {
  const file = "fenerbahce-transfer.html";
  const fb = transfers.filter((t) => t.toTeam === "Fenerbahçe" || t.fromTeam === "Fenerbahçe").sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const row = (t) => `<tr><td>${esc(trDate(`${t.date}T12:00:00+03:00`))}</td><th scope="row">${esc(t.playerName)}</th><td>${esc(t.toTeam === "Fenerbahçe" ? t.fromTeam : t.toTeam)}</td><td>${esc(t.type || "—")}</td><td><span class="kw-badge kw-official">Resmî</span></td><td><a href="${esc(t.sourceUrl)}" rel="nofollow noopener noreferrer" target="_blank">${esc(t.sourceName)}</a></td></tr>`;
  const ins = fb.filter((t) => t.toTeam === "Fenerbahçe");
  const outs = fb.filter((t) => t.fromTeam === "Fenerbahçe");
  const TRANSFER_RE = /transfer|imza|teklif|kiral|bonservis|ilgileniyor|ilgilendi|görüşme|sözleşme/i;
  const rumours = news.filter((n) => n.status === "verified" && /Fenerbah/.test(`${n.team} ${n.category} ${n.title}`) && TRANSFER_RE.test(`${n.title} ${n.summary}`) && exists(`haber/${n.slug}.html`))
    .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt))).slice(0, 12);
  const rumourHtml = rumours.length
    ? `<ul class="kw-list">${rumours.map((n) => `<li><span class="kw-badge kw-rumour">Gündem / iddia</span><time datetime="${esc(n.publishedAt)}">${esc(trDate(n.publishedAt, true))}</time><a href="./haber/${esc(n.slug)}.html"><strong>${esc(n.title)}</strong></a></li>`).join("")}</ul>`
    : "<p>Haber arşivimizde şu an Fenerbahçe ile ilgili kaynaklı bir transfer iddiası yok. İddia çıktığında burada, resmî transferlerden ayrı ve “Gündem / iddia” etiketiyle listelenir.</p>";
  const dateModified = maxDay(...fb.map((t) => String(t.lastVerifiedAt || t.date).slice(0, 10)), ...rumours.map((n) => isoDay(n.publishedAt)));
  const headers = ["Tarih", "Oyuncu", "Kulüp", "Tür", "Durum", "Kaynak"];
  return {
    file, dateModified,
    html: page({
      file, dateModified,
      title: "Fenerbahçe Transfer 2026-27: Resmî Gelenler, Gidenler ve İddialar | FutbolRadar",
      description: "Fenerbahçe transfer listesi: kaynağıyla doğrulanmış resmî gelen ve giden oyuncular, iddialar ise ayrı ve açıkça etiketli. 2026-27 sezonu Fenerbahçe transferleri.",
      h1: "Fenerbahçe Transfer", kicker: "2026-27 transfer dönemi",
      intro: "Resmî transferler yalnızca kulüp, KAP ya da güvenilir haber ajansı kaynağıyla doğrulandıysa “Resmî” olarak gösterilir. Henüz resmîleşmemiş haberler ayrı bir bölümde “Gündem / iddia” etiketiyle durur.",
      crumbs: [{ name: "Takımlar", href: "./takimlar", url: `${SITE}/takimlar` }, { name: "Fenerbahçe", href: "./takimlar/fenerbahce", url: `${SITE}/takimlar/fenerbahce` }],
      content: `<section class="evergreen-section" aria-labelledby="fb-in"><h2 id="fb-in">Resmî gelen oyuncular (${ins.length})</h2>${ins.length ? table(headers, ins.map(row), "Fenerbahçe resmî gelen transferler") : "<p>Kayıt yok.</p>"}</section>
<section class="evergreen-section" aria-labelledby="fb-out"><h2 id="fb-out">Resmî giden oyuncular (${outs.length})</h2>${outs.length ? table(headers, outs.map(row), "Fenerbahçe resmî giden transferler") : "<p>Kayıt yok.</p>"}</section>
<section class="evergreen-section" aria-labelledby="fb-rumour"><h2 id="fb-rumour">Gündemdeki iddialar (resmî değil)</h2>${rumourHtml}</section>
${linkGrid("Fenerbahçe ve transfer sayfaları", [["./takimlar/fenerbahce", "Fenerbahçe takım profili"], ["./fenerbahce-maclari.html", "Fenerbahçe maçları"], ["./fenerbahce-puan-durumu.html", "Fenerbahçe puan durumu"], ["./fenerbahce-oyuncu-radari.html", "Fenerbahçe oyuncu radarı"], ["./super-lig-transferleri-2026-2027.html", "Süper Lig transferleri 2026-27"], ["./transfer-donemi-2026-27.html", "Transfer dönemi 2026-27"]])}
${linkGrid("Fenerbahçe maç dosyaları", matchDossierRoots("fenerbahce"))}
${linkGrid("Süper Lig rehberleri", hubLinksExcept(file))}
${sourcesSection([{ name: "FutbolRadar transfer kaydı (data/transfers.json; her satırın kaynağı tabloda)", url: `${SITE}/super-lig-transferleri-2026-2027.html` }, ...fb.map((t) => ({ name: `${t.sourceName} — ${t.playerName}`, url: t.sourceUrl }))])}`
    })
  };
}

// ---------------------------------------------------------------- Beşiktaş
function besiktasPage() {
  const file = "besiktas-mac-ozetleri.html";
  const list = teamMatches("Beşiktaş");
  const rows = list.map((m) => {
    const home = isTeam(m.homeTeam, "Beşiktaş");
    const own = home ? m.score.home : m.score.away;
    const opp = home ? m.score.away : m.score.home;
    const result = own > opp ? "G" : own < opp ? "M" : "B";
    return `<tr><td>${esc(trDate(m.kickoff))}</td><td>${esc(m.competition)}</td><th scope="row">${esc(m.homeTeam)} ${m.score.home}-${m.score.away} ${esc(m.awayTeam)}</th><td>${result}</td><td>${matchRowLink(m)}</td></tr>`;
  });
  const lig = list.filter((m) => m.competition === "Süper Lig");
  const tally = lig.reduce((acc, m) => {
    const home = isTeam(m.homeTeam, "Beşiktaş");
    const own = home ? m.score.home : m.score.away;
    const opp = home ? m.score.away : m.score.home;
    acc[own > opp ? "w" : own < opp ? "l" : "d"] += 1; acc.gf += own; acc.ga += opp; return acc;
  }, { w: 0, d: 0, l: 0, gf: 0, ga: 0 });
  const next = upcomingFixtures("Beşiktaş").slice(0, 3);
  const dateModified = maxDay(...list.slice(0, 1).map((m) => isoDay(m.kickoff)));
  return {
    file, dateModified,
    html: page({
      file, dateModified,
      title: "Beşiktaş Maç Özeti ve Sonuçları 2026-27 | FutbolRadar",
      description: "Beşiktaş maç özetleri: 2026-27 sezonunda oynanan tüm Beşiktaş maçlarının skorları ve FutbolRadar maç raporları (gol, kart, istatistik) tek listede.",
      h1: "Beşiktaş Maç Özetleri", kicker: "Sonuçlar ve maç raporları",
      intro: "Sitemizin maç arşivinde (API-Football verisi) kayıtlı, sonuçlanmış Beşiktaş A takım maçları. Her satırdaki “Maç raporu” bağlantısı golleri, kartları ve istatistikleri gösteren yazılı özet sayfasına gider. Video özet barındırmıyoruz.",
      crumbs: [{ name: "Takımlar", href: "./takimlar", url: `${SITE}/takimlar` }, { name: "Beşiktaş", href: "./takimlar/besiktas", url: `${SITE}/takimlar/besiktas` }],
      content: `${lig.length ? `<section class="evergreen-section" aria-labelledby="bjk-sum"><h2 id="bjk-sum">Süper Lig özeti (arşivdeki ${lig.length} maç)</h2><p>${tally.w} galibiyet, ${tally.d} beraberlik, ${tally.l} mağlubiyet; atılan gol ${tally.gf}, yenilen gol ${tally.ga}. Bu sayılar yalnızca aşağıdaki tabloda listelenen maçlardan hesaplanır.</p></section>` : ""}
<section class="evergreen-section" aria-labelledby="bjk-list"><h2 id="bjk-list">Oynanan maçlar ve raporlar</h2>${rows.length ? table(["Tarih", "Turnuva", "Skor", "Sonuç", "Özet"], rows, "Beşiktaş 2026-27 maç sonuçları") : "<p>Arşivde maç yok.</p>"}</section>
${next.length ? `<section class="evergreen-section" aria-labelledby="bjk-next"><h2 id="bjk-next">Sıradaki Süper Lig maçları</h2>${table(["Tarih", "Hafta", "Maç"], next.map((m) => `<tr><td>${esc(trDate(m.kickoff, true))}</td><td>${esc(m.round)}. hafta</td><th scope="row">${esc(m.homeTeam)} - ${esc(m.awayTeam)}</th></tr>`), "Beşiktaş sıradaki maçlar")}</section>` : ""}
${linkGrid("Beşiktaş sayfaları", [["./takimlar/besiktas", "Beşiktaş takım profili"], ["./besiktas-maclari.html", "Beşiktaş maçları"], ["./besiktas-puan-durumu.html", "Beşiktaş puan durumu"], ["./besiktas-form-durumu.html", "Beşiktaş form durumu"], ["./besiktas-oyuncu-radari.html", "Beşiktaş oyuncu radarı"], ["./besiktas-yeni-transferleri-2026-2027.html", "Beşiktaş yeni transferleri"], ["./mac-sonuclari.html", "Tüm maç sonuçları"]])}
${linkGrid("Beşiktaş maç dosyaları", matchDossierRoots("besiktas"))}
${linkGrid("Süper Lig rehberleri", hubLinksExcept(file))}
${sourcesSection([SITE_DATA, { name: "API-Football (sitenin maç verisi sağlayıcısı)", url: "https://www.api-football.com/" }, { name: "TFF — Süper Lig 2026-27 fikstürü", url: "https://www.tff.org/default.aspx?pageID=198" }])}`
    })
  };
}

// ---------------------------------------------------------------- Türkiye Kupası
function cupPage() {
  const file = "turkiye-kupasi-fikstur.html";
  const calendarRows = cup.roundCalendar.map((r) => `<tr><th scope="row">${esc(r.round)}</th><td>${esc(r.dates)}</td></tr>`);
  const roundKeys = Object.keys(cup.rounds).sort().reverse();
  const roundsHtml = roundKeys.map((key) => `<section class="evergreen-section" aria-labelledby="tk-${esc(key[0])}"><h2 id="tk-${esc(key[0])}">${esc(key)} maçları (${cup.rounds[key].length})</h2>${table(["Tarih / saat", "Ev sahibi", "Skor", "Deplasman"], cup.rounds[key].map((m) => `<tr><td>${esc(m.date)}</td><td>${esc(m.home)}</td><td>${esc(m.score || "Oynanmadı")}</td><td>${esc(m.away)}</td></tr>`), `Ziraat Türkiye Kupası ${key} (TFF)`)}</section>`).join("");
  return {
    file, dateModified: cup.retrievedAt,
    html: page({
      file, dateModified: cup.retrievedAt,
      title: "Türkiye Kupası Fikstür 2026-27: Tur Tarihleri ve Sonuçlar | FutbolRadar",
      description: "Ziraat Türkiye Kupası 2026-27 fikstürü: TFF'nin açıkladığı tur tarihleri (final 29 Mayıs 2027), eleme turu sonuçları ve sıradaki kura bilgisi, kaynaklarıyla.",
      h1: "Türkiye Kupası Fikstürü 2026-27", kicker: "Ziraat Türkiye Kupası",
      intro: `Tur tarihleri ve maç sonuçları TFF'nin resmî fikstür sayfasından alınmıştır. ${cup.note} ${cup.draw}`,
      crumbs: [{ name: "Ligler", href: "./lig/super-lig.html", url: `${SITE}/lig/super-lig.html` }],
      content: `<section class="evergreen-section" aria-labelledby="tk-cal"><h2 id="tk-cal">2026-27 tur takvimi</h2>${table(["Tur", "Tarih"], calendarRows, "Ziraat Türkiye Kupası 2026-27 tur tarihleri (TFF)")}</section>
${roundsHtml}
${linkGrid("Kupa ve lig sayfaları", [["./lig/turkiye-kupasi.html", "Türkiye Kupası lig sayfası"], ["./super-lig-fikstur.html", "Süper Lig fikstürü"], ["./bugunun-maclari.html", "Bugünün maçları"], ["./mac-takvimi.html", "Maç takvimi"], ["./canli-skor.html", "Canlı skor"]])}
${linkGrid("Süper Lig rehberleri", hubLinksExcept(file))}
${sourcesSection([{ ...cup.sources.fixture, note: `erişim ${trDate(cup.retrievedAt)}` }, cup.sources.calendar, cup.sources.calendarAa, cup.sources.draw])}`
    })
  };
}

// ---------------------------------------------------------------- Tarihçe
function historyPage() {
  const file = "super-lig-tarihcesi.html";
  const champs = history.champions;
  const counts = new Map();
  for (const season of champs) counts.set(season.winner, (counts.get(season.winner) || 0) + 1);
  const countRows = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "tr")).map(([club, n]) => `<tr><th scope="row">${esc(club)}</th><td>${n}</td></tr>`);
  const rows = [...champs].reverse().map((s) => `<tr><td>${esc(s.season)}</td><th scope="row">${esc(s.winner)}</th><td>${esc(s.runnerUp)}</td><td>${esc(s.third)}</td><td>${esc(s.topScorer.replace(/\s{2,}/g, " / "))} (${s.goals})</td></tr>`);
  return {
    file, dateModified: history.retrievedAt,
    html: page({
      file, dateModified: history.retrievedAt, schemaType: "Article",
      title: "Süper Lig Tarihçesi: Sezon Sezon Şampiyonlar Listesi (1959-2026) | FutbolRadar",
      description: `Süper Lig şampiyonları listesi: 1959'dan ${champs.at(-1).season} sezonuna kadar her sezonun şampiyonu, ikincisi, üçüncüsü ve gol kralı. Kaynak: Wikipedia, revizyon numarasıyla.`,
      h1: "Süper Lig Tarihçesi ve Şampiyonlar", kicker: "1959'dan bugüne",
      intro: `Süper Lig (1. Lig) 1959'da başladı. Aşağıdaki tablo ${champs.length} sezonun şampiyon, ikinci, üçüncü ve gol krallarını Wikipedia'nın “List of Turkish football champions” maddesinin belirtilen revizyonundan aktarır. Şampiyonluk sayıları yalnızca bu tablodaki Süper Lig sezonlarından sayılmıştır (1959 öncesi şampiyonluklar dahil değildir).`,
      crumbs: [{ name: "Süper Lig", href: "./lig/super-lig.html", url: `${SITE}/lig/super-lig.html` }],
      content: `<section class="evergreen-section" aria-labelledby="h-count"><h2 id="h-count">Süper Lig şampiyonluk sayıları (1959-${champs.at(-1).season})</h2>${table(["Kulüp", "Şampiyonluk"], countRows, "Süper Lig dönemi şampiyonluk sayıları")}</section>
<section class="evergreen-section" aria-labelledby="h-list"><h2 id="h-list">Sezon sezon şampiyonlar</h2>${table(["Sezon", "Şampiyon", "İkinci", "Üçüncü", "Gol kralı (gol)"], rows, "Süper Lig şampiyonları listesi")}</section>
${linkGrid("İlgili sayfalar", [["./super-lig-puan-durumu", "Bu sezon puan durumu"], ["./super-lig-gol-kralligi-tum-zamanlar.html", "Tüm zamanların gol krallığı"], ["./derbi-gecmisi.html", "Derbi geçmişi"], ["./tarihte-bugun.html", "Tarihte bugün"], ["./arsiv.html", "Sezon arşivi"], ["./takimlar", "Süper Lig takımları"]])}
${linkGrid("Süper Lig rehberleri", hubLinksExcept(file))}
${sourcesSection([wiki("champions"), { name: "TFF — Süper Lig Fikstürü ve Puan Cetveli", url: "https://www.tff.org/default.aspx?pageID=198" }])}`
    })
  };
}

// ---------------------------------------------------------------- Kadrolar
const POS_TR = { Goalkeeper: "Kaleci", Defender: "Defans", Midfielder: "Orta saha", Attacker: "Forvet" };
function squadsPage() {
  const file = "super-lig-kadrolari-2026-2027.html";
  const teamById = new Map(teams.map((t) => [t.name, t]));
  const blocks = [...squads].sort((a, b) => a.teamName.localeCompare(b.teamName, "tr")).map((squad) => {
    const team = teamById.get(squad.teamName);
    const groups = ["Goalkeeper", "Defender", "Midfielder", "Attacker"].map((pos) => {
      const list = squad.players.filter((p) => p.position === pos);
      return list.length ? `<p><strong>${POS_TR[pos]} (${list.length}):</strong> ${list.map((p) => `${esc(p.name)}${p.number ? ` (${p.number})` : ""}`).join(", ")}</p>` : "";
    }).join("");
    const teamLink = team ? link(`./takimlar/${team.id}`, `${squad.teamName} profili`) : "";
    return `<article class="evergreen-card" id="${esc(team ? team.id : squad.teamId)}"><h3>${esc(squad.teamName)} kadrosu (${squad.players.length} oyuncu)</h3>${groups}<p class="evergreen-note">Sağlayıcı senkronu: ${esc(trDate(squad.syncedAt, true))}${teamLink ? ` · ${teamLink}` : ""}</p></article>`;
  });
  const dateModified = maxDay(...squads.map((s) => isoDay(s.syncedAt)));
  const toc = [...squads].sort((a, b) => a.teamName.localeCompare(b.teamName, "tr")).map((s) => { const t = teamById.get(s.teamName); return `<a href="#${esc(t ? t.id : s.teamId)}">${esc(s.teamName)}</a>`; }).join("");
  return {
    file, dateModified,
    html: page({
      file, dateModified,
      title: "Süper Lig Takım Kadroları 2026-2027: 18 Takımın Oyuncu Listesi | FutbolRadar",
      description: "Süper Lig 2026-2027 takım kadroları: 18 kulübün kaleci, defans, orta saha ve forvet oyuncuları, API-Football kadro verisinden ve senkron tarihiyle.",
      h1: "Süper Lig Takım Kadroları 2026-2027", kicker: "18 takım, mevki mevki",
      intro: "Kadrolar sitenin kullandığı API-Football kadro verisinden (data/super-lig-squads.json) otomatik oluşturulur; oyuncu adları sağlayıcının yazımıyla gösterilir. Her kartta son senkron zamanı yazar.",
      crumbs: [{ name: "Takımlar", href: "./takimlar", url: `${SITE}/takimlar` }],
      content: `<nav class="evergreen-link-grid" aria-label="Takıma git">${toc}</nav>
<section class="evergreen-section kw-squad" aria-label="Takım kadroları">${blocks.join("")}</section>
${linkGrid("İlgili sayfalar", [["./takimlar", "Tüm takımlar"], ["./super-lig-transferleri-2026-2027.html", "Süper Lig transferleri 2026-27"], ["./super-lig-oyuncu-radari.html", "Süper Lig oyuncu radarı"], ["./oyuncu-liderleri.html", "Oyuncu liderleri"], ["./genc-yetenekler.html", "Genç yetenekler"]])}
${linkGrid("Süper Lig rehberleri", hubLinksExcept(file))}
${sourcesSection([{ name: "API-Football — takım kadroları (sitenin /api/squad ve /api/teams verisi)", url: "https://www.api-football.com/documentation-v3#tag/Players/operation/get-players-squads" }, { name: "FutbolRadar takımlar sayfası", url: `${SITE}/takimlar` }])}`
    })
  };
}

// ---------------------------------------------------------------- Gol krallığı
function scorersPage() {
  const file = "super-lig-gol-kralligi-tum-zamanlar.html";
  const rows = history.allTimeScorers.map((p) => `<tr><td>${p.rank}</td><th scope="row">${esc(p.player)}</th><td><strong>${p.goals}</strong></td><td>${p.apps}</td><td>${p.first}-${p.last}</td><td>${esc(p.clubs)}</td></tr>`);
  const seasonRows = [...history.champions].reverse().slice(0, 20).map((s) => `<tr><td>${esc(s.season)}</td><th scope="row">${esc(s.topScorer.replace(/\s{2,}/g, " / "))}</th><td>${s.goals}</td></tr>`);
  const top = history.allTimeScorers[0];
  const faq = [{ q: "Süper Lig tarihinin en golcü oyuncusu kim?", a: `Wikipedia'nın ${trDate(history.source.scorers.allTimeAsOf + "T12:00:00+03:00")} itibarıyla güncellenen listesine göre ${top.player}, ${top.apps} maçta ${top.goals} golle zirvede.` }];
  return {
    file, dateModified: history.retrievedAt,
    html: page({
      file, dateModified: history.retrievedAt, schemaType: "Article",
      extraSchema: [{ "@type": "FAQPage", mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) }],
      title: "Süper Lig Gol Krallığı Tüm Zamanlar: En Golcü 20 Oyuncu | FutbolRadar",
      description: `Süper Lig tüm zamanların gol krallığı: ${top.player} ${top.goals} golle zirvede. İlk 20 golcü, maç sayıları ve son 20 sezonun gol kralları, kaynaklarıyla.`,
      h1: "Süper Lig Tüm Zamanların Gol Krallığı", kicker: "Rekorlar",
      intro: `Liste, Wikipedia'nın “List of Süper Lig top scorers” maddesinden alınmıştır; maddedeki tablo ${trDate(history.source.scorers.allTimeAsOf + "T12:00:00+03:00")} itibarıyla güncellenmiştir. Bu sezonun gol krallığı yarışı için ayrı sayfamıza bakın.`,
      crumbs: [{ name: "Süper Lig", href: "./lig/super-lig.html", url: `${SITE}/lig/super-lig.html` }],
      content: `<section class="evergreen-section" aria-labelledby="s-all"><h2 id="s-all">En çok gol atan 20 oyuncu</h2>${table(["Sıra", "Oyuncu", "Gol", "Maç", "Yıllar", "Kulüpler (gol/maç)"], rows, "Süper Lig tüm zamanların golcüleri")}</section>
<section class="evergreen-section" aria-labelledby="s-season"><h2 id="s-season">Son 20 sezonun gol kralları</h2>${table(["Sezon", "Gol kralı", "Gol"], seasonRows, "Süper Lig sezonluk gol kralları")}</section>
<section class="evergreen-section" aria-labelledby="s-faq"><h2 id="s-faq">Sık sorulan</h2>${faq.map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join("")}</section>
${linkGrid("İlgili sayfalar", [["./gol-kralligi.html", "2026-27 gol krallığı"], ["./asist-kralligi.html", "Asist krallığı"], ["./oyuncu-liderleri.html", "Oyuncu liderleri"], ["./en-iyi-forvetler.html", "En iyi forvetler"], ["./super-lig-tarihcesi.html", "Süper Lig şampiyonları"]])}
${linkGrid("Süper Lig rehberleri", hubLinksExcept(file))}
${sourcesSection([wiki("scorers"), wiki("champions")])}`
    })
  };
}

// ---------------------------------------------------------------- Derbiler
function derbyPage() {
  const file = "derbi-gecmisi.html";
  const big = ["Galatasaray", "Fenerbahçe", "Beşiktaş"];
  const blocks = [["gsfb", "Galatasaray - Fenerbahçe (Kıtalararası Derbi)"], ["fbbjk", "Fenerbahçe - Beşiktaş"], ["bjkgs", "Beşiktaş - Galatasaray"]].map(([key, title]) => {
    const d = history.derbies[key];
    const rows = d.rows.map((r) => `<tr><th scope="row">${esc(r.competition)}</th><td>${r.played}</td><td>${r.winsA}</td><td>${r.draws}</td><td>${r.winsB}</td><td>${r.goalsA}-${r.goalsB}</td></tr>`);
    const recent = finishedArchive.filter((m) => [d.teamA, d.teamB].includes(m.homeTeam) && [d.teamA, d.teamB].includes(m.awayTeam)).sort((a, b) => b.kickoff.localeCompare(a.kickoff));
    return `<section class="evergreen-section" aria-labelledby="d-${key}"><h2 id="d-${key}">${esc(title)}</h2>
<ul><li>İlk resmî karşılaşma (Wikipedia bilgi kutusu): ${esc(d.infobox["First meeting"])}</li><li>Tüm maçlar, hazırlık dahil (bilgi kutusu): ${esc(d.infobox["All-time series"].replace("Drawn", "Beraberlik"))}</li><li>En farklı skor (bilgi kutusu): ${esc(d.infobox["Largest victory"])}</li></ul>
${table(["Turnuva", "Maç", `${d.teamA} galibiyeti`, "Beraberlik", `${d.teamB} galibiyeti`, `Gol (${d.teamA}-${d.teamB})`], rows, `${title} baş başa istatistikleri (Wikipedia tablosu)`)}
${recent.length ? `<p><strong>Bu sezon (sitemizin maç arşivi):</strong> ${recent.map((m) => `${esc(trDate(m.kickoff))} ${esc(m.homeTeam)} ${m.score.home}-${m.score.away} ${esc(m.awayTeam)} ${m.reportPage && exists(m.reportPage) ? `(<a href="./${esc(m.reportPage)}">maç raporu</a>)` : ""}`).join("; ")}</p>` : ""}
<p class="evergreen-note">Kaynak: ${esc(history.source[key].title)} maddesi, revizyon ${history.source[key].oldid}. Wikipedia tablosu en son maçları içermeyebilir; tablo ile bilgi kutusu sayıları farklı kapsamdadır (resmî maçlar / hazırlık dahil).</p></section>`;
  }).join("");
  void big;
  return {
    file, dateModified: history.retrievedAt,
    html: page({
      file, dateModified: history.retrievedAt, schemaType: "Article",
      title: "Derbi Geçmişi: Galatasaray-Fenerbahçe, Fenerbahçe-Beşiktaş, Beşiktaş-Galatasaray | FutbolRadar",
      description: "İstanbul derbilerinin geçmişi: GS-FB, FB-BJK ve BJK-GS baş başa istatistikleri, ilk maçlar ve en farklı skorlar; Wikipedia revizyonları ve kendi maç arşivimizle.",
      h1: "Derbi Geçmişi: Üç Büyüklerin Rekabeti", kicker: "Baş başa istatistikler",
      intro: "Üç büyük İstanbul derbisinin Süper Lig, Türkiye Kupası ve tüm resmî maç istatistikleri. Sayılar ilgili Wikipedia maddelerinin belirtilen revizyonlarından aktarılır; bu sezon oynanan derbiler sitemizin maç arşivinden eklenir.",
      crumbs: [{ name: "Süper Lig", href: "./lig/super-lig.html", url: `${SITE}/lig/super-lig.html` }],
      content: `${blocks}
${linkGrid("Derbi sayfaları", [["./super-lig-derbi-takvimi-2026-2027.html", "2026-27 derbi takvimi"], ["./derbi-radari.html", "Derbi radarı"], ["./karsilastirma/takimlar/galatasaray-vs-fenerbahce", "Galatasaray - Fenerbahçe karşılaştırması"], ["./karsilastirma/takimlar/fenerbahce-vs-besiktas", "Fenerbahçe - Beşiktaş karşılaştırması"], ["./karsilastirma/takimlar/galatasaray-vs-besiktas", "Galatasaray - Beşiktaş karşılaştırması"], ["./takim-karsilastirmalari", "Takım karşılaştırmaları"]])}
${linkGrid("Süper Lig rehberleri", hubLinksExcept(file))}
${sourcesSection([wiki("gsfb"), wiki("fbbjk"), wiki("bjkgs"), SITE_DATA])}`
    })
  };
}

/**
 * Kanonik iç link: hedef dosyanın kendi canonical'ı uzantısızsa (ör.
 * mac-takvimi.html → /mac-takvimi) link de doğrudan o adrese gider; böylece
 * kanonik olmayan .html varyantına link verilmez.
 */
// ------------------------------------------------------- Süper Lig bu hafta
/**
 * MAÇ OLMAYAN GÜNLER İÇİN KALICI SAYFA. Derleme anında (GitHub Actions'a
 * bağlı değil) TFF fikstüründen sıradaki haftayı, sitenin puan tablosundan
 * (API-Football) iki takımın sırasını, maç arşivinden son 5 Süper Lig
 * sonucunu ve arşivdeki son karşılaşmaları yazar. Tahmin, yorum ya da
 * kaynaksız cümle yok; veri yoksa ilgili hücre "—".
 */
const leagueStandings = (() => { try { return read("league-standings.json")["super-lig"] || null; } catch { return null; } })();
const { sameClub } = createRequire(import.meta.url)("../services/superLigTeams.js");
const standingRow = (team) => (leagueStandings?.table || []).find((row) => row.team === team || row.name === team || sameClub(row.team || row.name, team)) || null;
const teamFile = (name) => { const t = teams.find((x) => x.name === name) || teams.find((x) => sameClub(x.name, name)); return t && exists(`takimlar/${t.id}.html`) ? `./takimlar/${t.id}` : null; };
const slMatches = (team) => teamMatches(team).filter((m) => m.league === "Süper Lig");
const resultLetter = (m, team) => { const home = isTeam(m.homeTeam, team); const f = home ? m.score.home : m.score.away; const a = home ? m.score.away : m.score.home; return f > a ? "G" : f < a ? "M" : "B"; };
function weeklyPage() {
  const file = "super-lig-bu-hafta.html";
  const now = new Date();
  const rounds = fixtures.rounds || [];
  const idx = rounds.findIndex((r) => r.matches.some((m) => m.kickoff && new Date(m.kickoff) > now));
  const next = idx >= 0 ? rounds[idx] : null;
  const prev = idx > 0 ? rounds[idx - 1] : (idx < 0 ? rounds.at(-1) : null);
  const sources = new Map();
  const addSrc = (url, name) => { if (url && !sources.has(url)) sources.set(url, { url, name }); };
  const teamCell = (name) => { const href = teamFile(name); return href ? `<a href="${esc(href)}">${esc(name)}</a>` : esc(name); };
  const rankText = (name) => { const r = standingRow(name); return r ? `${r.rank}. (${r.points} p)` : "—"; };
  const form = (name) => { const list = slMatches(name).slice(0, 5); list.forEach((m) => (m.sourceUrls || []).slice(0, 1).forEach((u) => addSrc(u, `Maç kaydı: ${m.homeTeam} ${m.score.home}-${m.score.away} ${m.awayTeam} (${trDate(m.kickoff)})`))); return list.length ? list.map((m) => resultLetter(m, name)).join(" ") : "—"; };
  const h2h = (home, away) => finishedArchive.filter((m) => (isTeam(m.homeTeam, home) && isTeam(m.awayTeam, away)) || (isTeam(m.homeTeam, away) && isTeam(m.awayTeam, home))).sort((a, b) => b.kickoff.localeCompare(a.kickoff)).slice(0, 3);
  const nextMatches = next ? [...next.matches].sort((a, b) => String(a.kickoff).localeCompare(String(b.kickoff))) : [];
  const cards = nextMatches.map((m) => {
    const meetings = h2h(m.homeTeam, m.awayTeam);
    meetings.forEach((x) => (x.sourceUrls || []).slice(0, 1).forEach((u) => addSrc(u, `Maç kaydı: ${x.homeTeam} ${x.score.home}-${x.score.away} ${x.awayTeam} (${trDate(x.kickoff)})`)));
    return `<li><time datetime="${esc(m.kickoff || "")}">${esc(m.kickoff ? trDate(m.kickoff, true) : (m.dateLabel || "Tarih bekleniyor"))}</time><p><strong>${teamCell(m.homeTeam)} – ${teamCell(m.awayTeam)}</strong>${m.venue ? ` · ${esc(m.venue)}` : ""}</p>`
      + `<p>Sıralama: ${esc(m.homeTeam)} ${esc(rankText(m.homeTeam))} · ${esc(m.awayTeam)} ${esc(rankText(m.awayTeam))}</p>`
      + `<p>Son 5 Süper Lig maçı (yeniden eskiye): ${esc(m.homeTeam)} ${esc(form(m.homeTeam))} · ${esc(m.awayTeam)} ${esc(form(m.awayTeam))}</p>`
      + (meetings.length ? `<p>Arşivdeki son karşılaşmalar: ${meetings.map((x) => `${esc(x.homeTeam)} ${x.score.home}-${x.score.away} ${esc(x.awayTeam)} (${esc(trDate(x.kickoff))}${x.league ? `, ${esc(x.league)}` : ""})`).join("; ")}</p>` : "")
      + `</li>`;
  });
  const prevRows = prev ? prev.matches.map((m) => {
    const played = finishedArchive.find((x) => isTeam(x.homeTeam, m.homeTeam) && isTeam(x.awayTeam, m.awayTeam) && m.kickoff && isoDay(x.kickoff) === isoDay(m.kickoff));
    if (played) (played.sourceUrls || []).slice(0, 1).forEach((u) => addSrc(u, `Maç kaydı: ${played.homeTeam} ${played.score.home}-${played.score.away} ${played.awayTeam} (${trDate(played.kickoff)})`));
    return `<tr><th scope="row">${teamCell(m.homeTeam)} – ${teamCell(m.awayTeam)}</th><td>${played ? `${played.score.home}-${played.score.away}` : "Skor arşivde yok"}</td><td>${esc(m.kickoff ? trDate(m.kickoff) : "—")}</td></tr>`;
  }) : [];
  const firstKick = nextMatches.find((m) => m.kickoff)?.kickoff;
  const todayHasMatch = rounds.some((r) => r.matches.some((m) => m.kickoff && isoDay(m.kickoff) === today));
  const standingsDate = leagueStandings?.updatedAt ? isoDay(leagueStandings.updatedAt) : null;
  const fixturesDate = fixtures.freshness?.verifiedAt ? isoDay(fixtures.freshness.verifiedAt) : null;
  const dateModified = maxDay(fixturesDate, standingsDate) > today ? today : maxDay(fixturesDate, standingsDate);
  const title = next ? `Süper Lig Bu Hafta: ${next.label} (${next.dateRange}) Maçları ve Form | FutbolRadar` : "Süper Lig Bu Hafta | FutbolRadar";
  const description = next ? `Süper Lig ${next.label} (${next.dateRange}): ${nextMatches.length} maçın tarihi, stadı, takımların sırası, son 5 maç formu ve arşivdeki son karşılaşmalar. Kaynaklı, tahminsiz.` : "Süper Lig haftalık maç rehberi.";
  const content = `${!todayHasMatch && firstKick ? `<section class="evergreen-section"><h2>Bugün Süper Lig maçı yok</h2><p>Sıradaki Süper Lig maçı: <strong>${esc(trDate(firstKick, true))}</strong> (${esc(nextMatches[0].homeTeam)} – ${esc(nextMatches[0].awayTeam)}).</p></section>` : ""}
<section class="evergreen-section" aria-labelledby="bu-hafta"><h2 id="bu-hafta">${esc(next ? `${next.label} maçları (${next.dateRange})` : "Sıradaki hafta")}</h2>${cards.length ? `<ol class="kw-list">${cards.join("")}</ol>` : "<p>Fikstürde sıradaki hafta bulunmuyor.</p>"}<p class="evergreen-source">Sıralama: puan tablosu verisi${standingsDate ? `, ${esc(trDate(`${standingsDate}T12:00:00+03:00`))} senkronu` : ""}. Form ve son karşılaşmalar yalnızca sitenin maç arşivindeki, kaynaklı ve bitmiş maçlardan hesaplanır; arşivde olmayan maçlar sayılmaz.</p></section>
${prev ? `<section class="evergreen-section" aria-labelledby="gecen-hafta"><h2 id="gecen-hafta">${esc(prev.label)} sonuçları</h2>${table(["Maç", "Skor", "Tarih"], prevRows, `${prev.label} (${prev.dateRange})`)}</section>` : ""}
${linkGrid("Bu hafta Avrupa'da", [...MATCH_HUB_DATA.values()].map((h) => [`./${h.file}`, `${h.home} - ${h.awayShort || h.away} (${h.competition.split(",")[0]})`]))}
${linkGrid("Maç günü dışında da", [["./super-lig-puan-durumu", "Süper Lig puan durumu"], ["./super-lig-fikstur.html", "Süper Lig fikstürü"], ["./tarihte-bugun.html", "Tarihte bugün"], ["./kose-yazilari.html", "Köşe yazıları"], ["./super-lig-transferleri-2026-2027.html", "Süper Lig transferleri"], ["./gol-kralligi.html", "Gol krallığı"]])}
${linkGrid("Süper Lig rehberleri", hubLinksExcept(file))}
${sourcesSection([{ name: `TFF — Süper Lig Fikstürü ve Puan Cetveli (fikstür; ${fixtures.freshness?.source || "TFF"}${fixturesDate ? `, doğrulama ${trDate(`${fixturesDate}T12:00:00+03:00`)}` : ""})`, url: "https://www.tff.org/default.aspx?pageID=198" }, { name: "API-Football (sitenin puan tablosu verisi)", url: "https://www.api-football.com/" }, ...sources.values()])}`;
  const events = nextMatches.filter((m) => m.kickoff).map((m) => ({ "@type": "SportsEvent", name: `${m.homeTeam} – ${m.awayTeam}`, startDate: m.kickoff, sport: "Football", ...(m.venue ? { location: { "@type": "Place", name: m.venue } } : {}), homeTeam: { "@type": "SportsTeam", name: m.homeTeam }, awayTeam: { "@type": "SportsTeam", name: m.awayTeam } }));
  return { file, dateModified, html: page({ file, dateModified, title, description, h1: next ? `Süper Lig Bu Hafta: ${next.label}` : "Süper Lig Bu Hafta", kicker: "Haftalık rehber", intro: "Sıradaki Süper Lig haftasının maçları, takımların sırası ve son form durumu. Maç olmayan günlerde de güncel kalır: sayfa her derlemede fikstür ve arşivden yeniden üretilir.", crumbs: [{ name: "Süper Lig fikstürü", href: "./super-lig-fikstur.html", url: `${SITE}/super-lig-fikstur.html` }], extraSchema: events.length ? [{ "@type": "ItemList", name: next.label, itemListElement: events.map((e, i) => ({ "@type": "ListItem", position: i + 1, item: e })) }] : [], content }) };
}

// ---------------------------------------------------------------- Maç merkezi (UEFA)
// data/match-hubs/*.json: her bilgi bir kaynak anahtarı taşır. Maç sonrası
// `result` ve `lineups` alanları kaynaklı olarak doldurulunca sayfa maç özetine döner.
function matchHubPages() {
  const dir = path.join(root, "data", "match-hubs");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => n.endsWith(".json")).sort().map((n) => matchHubPage(JSON.parse(fs.readFileSync(path.join(dir, n), "utf8"))));
}
/** Maç merkezi ek bölümleri: data/match-hub-extras/<file>.json (yoksa bölüm basılmaz). */
function matchHubExtras(h, cite) {
  const p = path.join(root, "data", "match-hub-extras", `${h.file}.json`);
  if (!fs.existsSync(p)) return "";
  const x = JSON.parse(fs.readFileSync(p, "utf8"));
  const c = (k) => x.sources[k] ? `<a href="${esc(x.sources[k].url)}" rel="nofollow noopener noreferrer" target="_blank">${esc(x.sources[k].name.split(" — ")[0])}</a>` : cite(k);
  let out = "";
  if (x.h2h) {
    const rows = x.h2h.matches.map((m) => `<tr><td>${esc(trDate(m.date))}</td><td>${esc(m.competition)}</td><th scope="row">${esc(m.home)} ${esc(m.score)} ${esc(m.away)}</th><td>${c(m.source || x.h2h.source)}</td></tr>`);
    out += `<section class="evergreen-section" aria-labelledby="h2h"><h2 id="h2h">Head-to-head: önceki resmî karşılaşmalar</h2>${rows.length ? table(["Tarih", "Turnuva", "Maç", "Kaynak"], rows, "Resmî maçlar") : `<p>${esc(x.h2h.emptyText)}</p>`}<p class="evergreen-source">Kaynak: ${c(x.h2h.source)}</p></section>`;
  }
  if (x.season) {
    const blocks = x.season.teams.map((t) => {
      let w = 0, d = 0, l = 0, gf = 0, ga = 0;
      const rows = t.matches.map((m) => {
        const [a, b] = m.score.split("-").map(Number); const home = m.home === t.team; const f = home ? a : b, g = home ? b : a;
        gf += f; ga += g; if (f > g) w++; else if (f === g) d++; else l++;
        return `<tr><td>${m.md}</td><td>${esc(trDate(m.date))}</td><th scope="row">${esc(m.home)} ${esc(m.score)} ${esc(m.away)}</th><td>${f > g ? "G" : f === g ? "B" : "M"}</td></tr>`;
      });
      return table(["Hafta", "Tarih", "Maç", "Sonuç"], rows, `${t.team}: ${t.matches.length} maç, ${w}G ${d}B ${l}M, gol ${gf}-${ga}, ${w * 3 + d} puan`);
    }).join("");
    out += `<section class="evergreen-section" aria-labelledby="sezon-ist"><h2 id="sezon-ist">Maç öncesi istatistikler: 2026-27 lig aşaması</h2>${blocks}<p class="evergreen-source">Kaynak: ${c(x.season.source)} (galibiyet/beraberlik/mağlubiyet, gol ve puan toplamları bu skorlardan hesaplanmıştır).</p></section>`;
  }
  return out;
}

function matchHubPage(h) {
  const S = h.sources;
  const cite = (keys) => [].concat(keys).map((k) => S[k] ? `<a href="${esc(S[k].url)}" rel="nofollow noopener noreferrer" target="_blank">${esc(S[k].name.split(" — ")[0])}</a>` : "").filter(Boolean).join(", ");
  const f = h.facts;
  const ul = (block) => `<ul>${block.items.map((t) => `<li>${esc(t)}</li>`).join("")}</ul><p class="evergreen-source">Kaynak: ${cite(block.source)}</p>`;
  const when = trDate(h.kickoff, true);
  const played = Boolean(h.result);
  const kickoffClock = (when.match(/(\d{2}:\d{2})/) || [])[1] || "";
  const channel = String(h.broadcast || "").split(/ \(|,| ve /)[0].trim();
  const title = played ? `${h.home} ${h.result.home}-${h.result.away} ${h.awayShort} Maç Sonucu ve Özeti | FutbolRadar` : `${h.home} - ${h.awayShort} Maçı Saat Kaçta, Hangi Kanalda? ${kickoffClock} TSİ, ${channel} | FutbolRadar`;
  const h1 = played ? `${h.home} - ${h.awayShort}` : `${h.home} - ${h.awayShort} maçı saat kaçta, hangi kanalda?`;
  const info = table(["Bilgi", "Değer", "Kaynak"], [
    ["Turnuva", h.competition, cite("uefa")], ["Tarih ve saat", `${when} · ${h.kickoffCET}`, cite(f.kickoff)], ["Stat", h.venue, cite(f.venue)], ["Hakem", h.referee, cite(f.referee)], ["Yayın", h.broadcast, cite(f.broadcast)]
  ].map(([k, v, c]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td><td>${c}</td></tr>`), "Maç künyesi");
  const result = played
    ? `<p><strong>${esc(h.home)} ${h.result.home}-${h.result.away} ${esc(h.away)}</strong></p><p class="evergreen-source">Kaynak: ${cite(h.result.source)}</p>`
    : `<p>Maç henüz oynanmadı. Skor, goller ve kartlar maçtan sonra resmî kaynaktan doğrulanınca bu bölüme eklenecek.</p>`;
  const lineups = h.lineups ? `<p class="evergreen-source">Kaynak: ${cite(h.lineups.source)}</p>` : `<p data-status="veri-bekleniyor"><strong>İlk 11:</strong> Güncelleniyor — veri bekleniyor. Resmî kadrolar açıklanmadan tahmini kadro yazılmaz.</p>`;
  const tbl = table(["Sıra", "Takım", "Puan"], f.table.rows.map((r) => `<tr><td>${r.rank}</td><th scope="row">${esc(r.team)}</th><td>${r.points}</td></tr>`), `Şampiyonlar Ligi lig aşaması (${trDate(f.table.asOf)} itibarıyla)`) + `<p class="evergreen-source">Kaynak: ${cite(f.table.source)}. Tablonun tamamı: ${link("./sampiyonlar-ligi-puan-durumu.html", "Şampiyonlar Ligi puan durumu")}</p>`;
  const faq = [
    [`${h.home} - ${h.awayShort} maçı ne zaman, saat kaçta?`, `${when}, ${h.kickoffCET}.`, f.kickoff],
    [`${h.home} - ${h.awayShort} maçı hangi kanalda?`, `${h.broadcast}.`, f.broadcast],
    [`${h.home} - ${h.awayShort} maçı nerede oynanacak?`, `${h.venue}.`, f.venue],
    [`${h.home} - ${h.awayShort} maçının hakemi kim?`, `${h.referee}.`, f.referee]
  ];
  const faqHtml = `<section class="evergreen-section" aria-labelledby="sss"><h2 id="sss">Sık sorulan sorular</h2>${faq.map(([q, a, s]) => `<h3>${esc(q)}</h3><p>${esc(a)} <span class="evergreen-source">Kaynak: ${cite(s)}</span></p>`).join("")}</section>`;
  const event = { "@type": "SportsEvent", "@id": `${SITE}/${h.file}#event`, name: `${h.home} - ${h.away}`, startDate: h.kickoff, eventStatus: played ? "https://schema.org/EventCompleted" : "https://schema.org/EventScheduled", eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode", sport: "Football",
    location: { "@type": "Place", name: h.venue, address: { "@type": "PostalAddress", addressLocality: "İstanbul", addressCountry: "TR" } },
    homeTeam: { "@type": "SportsTeam", name: h.home }, awayTeam: { "@type": "SportsTeam", name: h.away }, competitor: [{ "@type": "SportsTeam", name: h.home }, { "@type": "SportsTeam", name: h.away }],
    superEvent: { "@type": "SportsEvent", name: "UEFA Şampiyonlar Ligi 2026-27" }, organizer: { "@type": "SportsOrganization", name: "UEFA", url: "https://www.uefa.com/" } };
  const faqLd = { "@type": "FAQPage", mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) };
  const gsMatches = [["./mac/lille-galatasaray-21-ekim-2026.html", "Lille - Galatasaray (21 Ekim 2026)"], ["./mac/galatasaray-barcelona-13-ekim-2026.html", "Galatasaray - Barcelona (13 Ekim 2026)"], ["./mac/sporting-cp-galatasaray-9-eylul-2026.html", "Sporting CP - Galatasaray (9 Eylül 2026)"]];
  const vfbMatches = [["./mac/vfb-stuttgart-atletico-madrid-20-ekim-2026.html", "Stuttgart - Atlético Madrid (20 Ekim 2026)"], ["./mac/slovan-bratislava-vfb-stuttgart-14-ekim-2026.html", "Slovan Bratislava - Stuttgart (14 Ekim 2026)"], ["./mac/vfb-stuttgart-viking-9-eylul-2026.html", "Stuttgart - Viking (9 Eylül 2026)"], ["./mac/hamburger-sv-vfb-stuttgart-17-ekim-2026.html", "Hamburger SV - Stuttgart (17 Ekim 2026)"], ["./vfb-stuttgart.html", "VfB Stuttgart takım profili"], ["./bundesliga-puan-durumu.html", "Bundesliga puan durumu"]];
  return {
    file: h.file, dateModified: h.updatedAt,
    html: page({
      file: h.file, dateModified: h.updatedAt, schemaType: "WebPage", extraSchema: [event, faqLd],
      title,
      description: played ? `${h.home} - ${h.awayShort} maç sonucu ve özeti, kaynaklarıyla.` : `${h.home} - ${h.awayShort} maçı saat kaçta, hangi kanalda? ${when}, ${channel}. Hakem, kadro, puan durumu ve maç özeti kaynaklarıyla.`,
      h1, kicker: "Şampiyonlar Ligi maç merkezi",
      intro: `${h.competition} kapsamında ${h.home}, ${h.away} takımını ağırlıyor. Bu sayfadaki her bilgi yanında kaynağıyla verilir; maçtan sonra sonuç ve özet aynı adreste güncellenir.`,
      crumbs: [{ name: "Takımlar", href: "./takimlar", url: `${SITE}/takimlar` }, { name: "Galatasaray", href: "./takimlar/galatasaray", url: `${SITE}/takimlar/galatasaray` }],
      content: `<section class="evergreen-section" aria-labelledby="kunye"><h2 id="kunye">Maç künyesi</h2>${info}</section>
<section class="evergreen-section" aria-labelledby="canli"><h2 id="canli">Canlı skor</h2><p>Bu sayfa canlı skor göstermez. Maç oynanırken anlık skor ve dakika için ${link("./canli-skor.html", "canlı skor")} ve ${link("./canli-maclar.html", "canlı maçlar")} sayfalarını açın; sonuç doğrulanınca aşağıdaki özet bölümüne eklenir.</p></section>
<section class="evergreen-section" aria-labelledby="sonuc"><h2 id="sonuc">Maç özeti ve sonucu</h2>${result}</section>
<section class="evergreen-section" aria-labelledby="ilk11"><h2 id="ilk11">İlk 11'ler</h2>${lineups}</section>
<section class="evergreen-section" aria-labelledby="kadrolar"><h2 id="kadrolar">Kadrolar</h2><p>${link("./takimlar/galatasaray/kadro.html", "Galatasaray kadrosu")} (sağlayıcı verisinden) · ${link("./vfb-stuttgart.html", "VfB Stuttgart profili ve sezonu")}. Muhtemel 11 yazılmaz; resmî ilk 11'ler açıklanınca yukarıya eklenir.</p></section>
<section class="evergreen-section" aria-labelledby="tablo"><h2 id="tablo">Puan durumu</h2>${tbl}</section>
${matchHubExtras(h, cite)}
<section class="evergreen-section" aria-labelledby="gs-form"><h2 id="gs-form">Galatasaray maç öncesi</h2>${ul(f.homeForm)}<p>${link("./galatasaray-son-dakika.html", "Galatasaray son dakika")} · ${link("./galatasaray-maclari.html", "Galatasaray maçları")} · ${link("./galatasaray-form-durumu.html", "Galatasaray form durumu")}</p></section>
<section class="evergreen-section" aria-labelledby="vfb-form"><h2 id="vfb-form">Stuttgart maç öncesi</h2>${ul(f.awayForm)}</section>
<section class="evergreen-section" aria-labelledby="gecmis"><h2 id="gecmis">İki takımın geçmişi</h2>${ul(f.history)}</section>
<section class="evergreen-section" aria-labelledby="oyuncular"><h2 id="oyuncular">Oyuncuların Stuttgart karnesi</h2>${ul(f.players)}</section>
<section class="evergreen-section" aria-labelledby="sonraki"><h2 id="sonraki">Sıradaki maç</h2>${ul(f.next)}</section>
${faqHtml}
${linkGrid("Galatasaray'ın bu sezonki Şampiyonlar Ligi maçları", gsMatches)}
${linkGrid("Stuttgart'ın son maçları", vfbMatches)}
${linkGrid("Galatasaray sayfaları", [["./takimlar/galatasaray", "Galatasaray takım profili"], ["./takimlar/galatasaray/kadro.html", "Galatasaray kadrosu"], ["./takimlar/galatasaray/istatistikler.html", "Galatasaray istatistikleri"], ["./takimlar/galatasaray/tarihce.html", "Galatasaray tarihçesi"], ["./galatasaray-puan-durumu.html", "Galatasaray puan durumu"], ["./sampiyonlar-ligi-puan-durumu.html", "Şampiyonlar Ligi puan durumu"], ["./super-lig-puan-durumu", "Süper Lig puan durumu"], ["./super-lig-bu-hafta.html", "Süper Lig bu hafta"]])}
${sourcesSection(Object.values(S))}`
    })
  };
}

// ---------------------------------------------------------------- Yabancı takım profili
// data/team-hubs/*.json: yalnız kaynaklı profil, kupa, sezon ve fikstür maddeleri.
function teamHubPages() {
  const dir = path.join(root, "data", "team-hubs");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => n.endsWith(".json")).sort().map((n) => teamHubPage(JSON.parse(fs.readFileSync(path.join(dir, n), "utf8"))));
}
function teamHubPage(t) {
  const S = t.sources;
  const cite = (k) => S[k] ? `<a href="${esc(S[k].url)}" rel="nofollow noopener noreferrer" target="_blank">${esc(S[k].name.split(" — ")[0])}</a>` : "";
  const src = (k) => `<p class="evergreen-source">Kaynak: ${cite(k)}</p>`;
  const ul = (b) => `<ul>${b.items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>${src(b.source)}`;
  const hubs = [...MATCH_HUB_FILES].map((f) => { const h = MATCH_HUB_DATA.get(f); return h && (h.home === t.name || h.away === t.name) ? [`./${f}`, `${h.home} - ${h.awayShort || h.away}: maç saati, kanal ve kadro`] : null; }).filter(Boolean);
  const profile = table(["Bilgi", "Değer"], t.profile.rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`), `${t.name} kulüp künyesi`);
  return { file: t.file, dateModified: t.updatedAt, html: page({
    file: t.file, dateModified: t.updatedAt, schemaType: "WebPage",
    extraSchema: [{ "@type": "SportsTeam", name: t.name, sport: "Football", foundingDate: "1893-09-09", location: { "@type": "Place", name: "Stuttgart, Almanya" }, sameAs: [S.wiki.url.replace(/\/w\/index\.php\?title=([^&]+).*/, "/wiki/$1")] }],
    title: `${t.name}: Kulüp Bilgileri, Kupalar ve Şampiyonlar Ligi Maçları | FutbolRadar`,
    description: `${t.name}: kuruluş, stat, kupalar, 2026-27 Şampiyonlar Ligi sonuçları ve sıradaki maçlar — her bilgi kaynağıyla.`,
    h1: `${t.name}`, kicker: "Takım profili",
    intro: `${t.name} hakkında kaynaklı temel bilgiler ve bu sezonki Şampiyonlar Ligi yolculuğu. Kaynağı olmayan bilgi bu sayfaya yazılmaz.`,
    crumbs: [{ name: "Takımlar", href: "./takimlar", url: `${SITE}/takimlar` }],
    content: `${hubs.length ? linkGrid("Öne çıkan maç", hubs) : ""}
<section class="evergreen-section" aria-labelledby="kunye"><h2 id="kunye">Kulüp künyesi</h2>${profile}${src(t.profile.source)}</section>
<section class="evergreen-section" aria-labelledby="kupalar"><h2 id="kupalar">Kupalar</h2>${ul(t.honours)}</section>
<section class="evergreen-section" aria-labelledby="sezon"><h2 id="sezon">2026-27 sezonu</h2>${ul(t.season)}<p>${esc(t.table.text)}</p>${src(t.table.source)}</section>
<section class="evergreen-section" aria-labelledby="kadro"><h2 id="kadro">${esc(t.short)} kadrosu</h2><p data-status="veri-bekleniyor">Güncelleniyor — veri bekleniyor. Kaynaklı ve güncel kadro listesi doğrulanınca eklenecek; tahmini kadro yazılmaz.</p></section>
<section class="evergreen-section" aria-labelledby="fikstur"><h2 id="fikstur">Şampiyonlar Ligi fikstürü</h2>${ul(t.fixtures)}</section>
${linkGrid("İlgili sayfalar", [["./sampiyonlar-ligi-puan-durumu.html", "Şampiyonlar Ligi puan durumu"], ["./bundesliga-puan-durumu.html", "Bundesliga puan durumu"], ["./mac/vfb-stuttgart-atletico-madrid-20-ekim-2026.html", "Stuttgart - Atlético Madrid (20 Ekim 2026)"], ["./mac/slovan-bratislava-vfb-stuttgart-14-ekim-2026.html", "Slovan Bratislava - Stuttgart (14 Ekim 2026)"], ["./mac/vfb-stuttgart-viking-9-eylul-2026.html", "Stuttgart - Viking (9 Eylül 2026)"], ["./takimlar/galatasaray", "Galatasaray takım profili"], ["./canli-skor.html", "Canlı skor"]])}
${sourcesSection(Object.values(S))}`
  }) };
}

function canonicalizeLinks(html) {
  return html.replace(/href="\.\/([^"#?]+\.html)"/g, (whole, file) => {
    try {
      const target = fs.readFileSync(path.join(root, file), "utf8");
      const m = target.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']https:\/\/www\.futbolradar\.com\/([^"']*)["']/i);
      if (m && m[1] === file.replace(/\.html$/, "")) return `href="./${m[1]}"`;
    } catch {}
    return whole;
  });
}

function writeAll(pages) {
  for (const p of pages) p.html = canonicalizeLinks(p.html);
  for (const outputRoot of [root, path.join(root, "public")]) {
    if (outputRoot !== root && !fs.existsSync(outputRoot)) continue;
    for (const p of pages) fs.writeFileSync(path.join(outputRoot, p.file), p.html, "utf8");
    const sitemap = path.join(outputRoot, "sitemap.xml");
    if (!fs.existsSync(sitemap)) continue;
    const xml = fs.readFileSync(sitemap, "utf8");
    const urls = new Map(pages.map((p) => [`${SITE}/${p.file}`, p.dateModified > today ? today : p.dateModified]));
    const entries = (xml.match(URL_ENTRY_RE) || []).filter((entry) => ![...urls.keys()].some((url) => entry.includes(`<loc>${url}</loc>`)));
    for (const [url, lastmod] of urls) entries.push(`  <url>\n    <loc>${url}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${/tarihcesi|tum-zamanlar|derbi-gecmisi/.test(url) ? "monthly" : "daily"}</changefreq>\n    <priority>0.8</priority>\n  </url>`);
    fs.writeFileSync(sitemap, wrapUrlset(entries), "utf8");
  }
}

const pages = [galatasarayPage(), fenerbahceTransferPage(), besiktasPage(), cupPage(), historyPage(), squadsPage(), scorersPage(), derbyPage(), weeklyPage(), ...matchHubPages(), ...teamHubPages()];
writeAll(pages);
console.log(`Anahtar kelime sayfaları: ${pages.length} sayfa üretildi ve sitemap.xml'e eklendi.`);
