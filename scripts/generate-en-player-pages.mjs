#!/usr/bin/env node
/**
 * İNGİLİZCE OYUNCU PROFİLLERİ — /en/player/<slug>.html
 *
 * TR tarafındaki `oyuncular/<slug>.html` ile AYNI kanonik oyuncu kaydından
 * (data/players.json) üretilir, aynı slug — sağlayıcıya ikinci istek yok.
 *
 * İNCE İÇERİK YASAĞI BURADA UYGULANIYOR: yalnızca YAYIN KAPISINDAN GEÇMİŞ
 * (publicPlayerView(...).verified === true) oyuncular EN sayfası alır.
 * TR tarafı doğrulanmamış kayıtlar için de "Kulüp bilgisi doğrulanmadı"
 * diyen indirgenmiş bir sayfa yayımlıyor; İngilizcede o indirgenmiş hâlin
 * bir kopyasını yayımlamak yerine sayfa HİÇ üretilmiyor — belirsiz bir
 * profili başka dilde tekrarlamak veriyi zenginleştirmez, tekrarlar.
 *
 * Kısıtlı alanlar (rating, piyasa değeri, istatistik, forma numarası,
 * fotoğraf) doğrudan `player.*`den değil, `publicPlayerView(player).fields`
 * üzerinden okunuyor — TEK yetkili karar burada da geçerli: kaynağı
 * doğrulanmış olmak her sayının doğrulanmış olduğu anlamına gelmiyor.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { siteHeader, siteFooter } from "./lib/layout.mjs";
import { sectionHead } from "./lib/matchCards.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";
import {
  player360Description,
  player360Person,
  player360Title,
  renderPlayer360
} from "./lib/player360.mjs";
import { ROBOTS_INDEX } from "./lib/robots.mjs";

const require = createRequire(import.meta.url);
const {
  DOMAIN,
  absoluteUrl,
  formatDate,
  htmlLang,
  ogLocale,
  t,
  writeDynamicRoutePairs
} = require("../services/i18n.js");
const { getPlayers } = require("../services/playerService.js");
const { resolvePlayerPhoto } = require("../services/playerPhotoService.js");
const { publicPlayerView } = require("../services/cardCredibility.js");
const { slug: teamSlug } = require("../services/superLigTeams.js");
const { buildPlayer360 } = require("../services/player360Service.js");
const { createPlayerUrlResolver } = require("../services/playerUrl.js");
const { annotateDuplicates } = require("../services/duplicatePlayerService.js");

const root = process.cwd();
const LOCALE = "en";
const BASE = "../../";
const OUT_DIR = path.join(root, "en", "player");

const teams = JSON.parse(fs.readFileSync(path.join(root, "data", "teams.json"), "utf8"));

/**
 * FUTBOLCU 360 GİRDİLERİ — TR tarafıyla AYNI dosyalar.
 *
 * İki dil aynı kaynaktan beslenir; İngilizce sayfa için ikinci bir veri
 * hattı kurulmaz. Eksik dosya derlemeyi düşürmez, ilgili bölüm boş kalır.
 */
function readJson(relativePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
  } catch (error) {
    console.warn(`[futbolradar:player360:en] ${relativePath} okunamadı (${error.code || error.message})`);
    return fallback;
  }
}

const { publishableNews } = require("../services/newsFeed.js");

/** Yalnızca üretilmiş haber sayfalarına bağlanılır — bkz. TR üretici. */
function generatedSlugs(directory) {
  try {
    return new Set(fs.readdirSync(path.join(root, directory))
      .filter((name) => name.endsWith(".html"))
      .map((name) => name.slice(0, -5)));
  } catch {
    return new Set();
  }
}

/**
 * İNGİLİZCE TARAF DA TAM İSİMLİ ADRESE GEÇİYOR.
 *
 * Türkçe sayfa `/futbolcu/victor-osimhen`e taşınırken İngilizcesi
 * `/en/player/v-osimhen-galatasaray` kalsaydı iki sorun doğardı: hreflang
 * çifti kırılır (TR tarafı artık o yolda değil) ve aynı oyuncu iki dilde
 * iki ayrı adlandırma mantığı taşırdı. Slug ortak tablodan gelir.
 */
const playerUrls = createPlayerUrlResolver(readJson("data/player-url-slugs.json", { entries: [], aliases: [] }));

/** Kopya kayıtlar İngilizce sayfa almaz: adres kanonik kayda ait. */
function enPlayerSlug(player) {
  const table = playerUrls.playerPagePath(player.id);
  return table.replace(/^.*\//, "").replace(/\.html$/, "");
}

// İngilizce haber sayfaları `en/news/` altında üretiliyor; oyuncu sayfasının
// bağlanabileceği küme de o.
const newsSlugs = generatedSlugs("en/news");
const newsItems = publishableNews(readJson("data/news.json", []), { locale: "en" });
const matchRecords = readJson("data/matches.json", []);
const archiveRecords = readJson("data/historical-match-archive.json", { records: [] }).records || [];
const squadStatuses = readJson("data/squad-statuses.json", { teams: [] });
const confirmedTransfers = readJson("data/transfers.json", [])
  .filter((transfer) => transfer && transfer.status === "confirmed");

/**
 * İNGİLİZCE ROTA HARİTASI.
 *
 * İngilizce sayfa İngilizce sayfalara bağlanır: `en/team/...`,
 * `en/top-scorers.html`. İki istisna kasıtlı:
 *
 *   • Maç raporu — o rotanın İngilizce karşılığı bu kimlikle üretilmiyor,
 *     bu yüzden `null`: satır bağlantısız kalır, kırık link üretilmez.
 *   • Haber — artık İngilizce sürümü olan haberlerin kendi sayfası var
 *     (`en/news/<slug>.html`); İngilizce karşılığı olmayan haber listeye
 *     hiç girmez.
 */
const EN_ROUTES = {
  teamHref: (teamName) => {
    const team = teams.find((row) => String(row.name || "").toLowerCase() === String(teamName || "").toLowerCase());
    return team ? `en/team/${teamSlug(team.name)}.html` : null;
  },
  matchReportHref: () => null,
  newsHref: (slug) => (slug && newsSlugs.has(slug) ? `en/news/${slug}.html` : null),
  comparisonHref: (slug) => `karsilastirma/${slug}.html`,
  comparePickerHref: (playerId) => `oyuncu-karsilastir.html?player=${encodeURIComponent(playerId)}`,
  topScorers: "en/top-scorers.html",
  topAssists: "en/top-assists.html",
  matchCentre: "en/match-centre.html",
  playerRadar: "en/player-radar.html"
};
const rawPlayers = JSON.parse(fs.readFileSync(path.join(root, "data", "players.json"), "utf8"));
const players = annotateDuplicates(getPlayers(rawPlayers));

/**
 * Kıyas havuzu TR tarafıyla AYNI: yalnızca kanonik kayıtlar. Kıyas
 * sayfalarını üreten script de bu havuzu kullanıyor; farklı havuzlar
 * üretilmemiş sayfalara bağlantı demek.
 */
const comparablePlayers = players.filter((player) => !player.isDuplicate);
/** Kıyas adresi TR tarafıyla aynı kaynaktan; çözücü TAM listeyle kurulur. */
const slugForPair = require("../services/playerComparisonPairs.js").createComparisonSlugResolver(players, comparablePlayers);

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function label(key) {
  return t(key, LOCALE);
}

function teamHref(name) {
  const team = teams.find((row) => String(row.name || "").toLowerCase() === String(name || "").toLowerCase());
  return team ? `../team/${teamSlug(team.name)}.html` : null;
}

function avatarHtml(player) {
  const photo = resolvePlayerPhoto(player);
  const alt = `${player.name}${player.currentTeam ? ` — ${player.currentTeam}` : ""} player photo`;
  if (photo.isPlaceholder) {
    return `<div class="player-avatar is-placeholder profile-avatar" role="img" aria-label="${escapeHtml(alt)}"><span aria-hidden="true">${escapeHtml(photo.initials)}</span></div>`;
  }
  return `<img class="player-avatar profile-avatar" src="${escapeHtml(photo.url)}" alt="${escapeHtml(alt)}" width="96" height="96" loading="lazy" decoding="async">`;
}

function pageHtml(player) {
  const view = publicPlayerView(player);
  const fields = view.fields || {};
  const slugValue = enPlayerSlug(player);
  // Türkçe karşılık tek çözücüden: taşınan oyuncuda `futbolcu/<tam-ad>`,
  // taşınmayanda `oyuncular/<id>`. Sabit "oyuncular/" yazmak, hreflang
  // çiftinin bir ucunu yönlendirme sayfasına bağlıyordu.
  const trPath = playerUrls.playerPagePath(player.id);
  const enPath = `en/player/${slugValue}.html`;
  const canonical = absoluteUrl(enPath);
  const team = fields.currentTeam || fields.team || null;
  const position = player.position || "";

  // Futbolcu 360 modeli. Türkçe üreticiyle AYNI servis, aynı kapı; tek
  // fark rota haritası ve sözlük.
  const model = buildPlayer360({
    player,
    players: comparablePlayers,
    credibility: view,
    transfers: confirmedTransfers,
    news: newsItems,
    matches: matchRecords,
    archive: archiveRecords,
    squadStatuses,
    basePrefix: BASE,
    routes: EN_ROUTES,
    displayName: playerUrls.playerDisplayName(player),
    comparisonSlugFor: slugForPair
  });

  const title = player360Title(model, { locale: LOCALE });
  const description = player360Description(model, { locale: LOCALE });

  const teamLinkHref = team ? teamHref(team) : null;
  const teamHtml = team
    ? (teamLinkHref ? `<a href="${escapeHtml(teamLinkHref)}">${escapeHtml(team)}</a>` : escapeHtml(team))
    : "Club not yet confirmed";

  // Kimlik ve sezon blokları artık Futbolcu 360 modülünden geliyor; buradaki
  // ikinci kopyaları kaldırıldı: aynı sayıyı iki yerde üretmek, birinin
  // kapıyı atlamasıyla biten en sık hata.
  const rating = fields.overallRating || fields.aiRating || fields.rating || null;
  const marketValue = fields.marketValue || null;
  const number = fields.number ?? null;

  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      // Görünür bölümlerle aynı modelden. `@id` korunur: İngilizce sayfa
      // kendi kanonik adresiyle tanımlanır.
      { ...player360Person(model, canonical, description), "@id": canonical },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: label("breadcrumb.home"), item: absoluteUrl("en/index.html") },
          { "@type": "ListItem", position: 2, name: label("nav.teams"), item: absoluteUrl("en/teams.html") },
          { "@type": "ListItem", position: 3, name: player.name, item: canonical }
        ]
      }
    ]
  };

  const html = `<!doctype html>
<html lang="${htmlLang(LOCALE)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <meta name="robots" content="${ROBOTS_INDEX}" />
    <meta property="og:type" content="profile" />
    <meta property="og:locale" content="${ogLocale(LOCALE)}" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta property="og:image" content="${DOMAIN}/assets/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${DOMAIN}/assets/og-image.png" />
    <link rel="icon" href="${BASE}favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="${BASE}site.webmanifest" />
    <link rel="stylesheet" href="${BASE}page.css" />
    <script type="application/ld+json">${JSON.stringify(schema)}</script>
  </head>
  <body class="subpage player-profile-page">
    ${siteHeader({ base: BASE, locale: LOCALE, altHref: null })}
    <main class="container">
      <nav class="breadcrumb" aria-label="Breadcrumb"><a href="${BASE}en/index.html">${escapeHtml(label("breadcrumb.home"))}</a><span>/</span><a href="${BASE}en/teams.html">${escapeHtml(label("nav.teams"))}</a><span>/</span><span>${escapeHtml(player.name)}</span></nav>
      <section class="hero profile-hero">
        <div class="hero-row">
          <div class="profile-hero-identity">
            ${avatarHtml(player)}
            <div>
              <span class="eyebrow">${teamHtml}${number !== null ? ` · #${escapeHtml(number)}` : ""}</span>
              <h1>${escapeHtml(model.identity.name)}</h1>
              <p class="lead">${escapeHtml(position || "Position not yet confirmed")}</p>
            </div>
          </div>
          ${rating ? `<span class="hero-meta">Rating <b>${escapeHtml(rating)}</b></span>` : ""}
        </div>
      </section>
      ${renderPlayer360(model, { locale: LOCALE })}
      ${marketValue ? `<section class="container section" aria-label="Market value"><p class="muted-copy">Estimated market value: <b>${escapeHtml(marketValue)}</b></p></section>` : ""}
      <section class="container section" aria-label="Explore more">
        ${sectionHead({ locale: LOCALE, kicker: "FutbolRadar", titleId: "en-player-links-title", title: "Explore more" })}
        <div class="trend-link-grid">
          <a href="../standings.html"><span>Table</span><strong>Süper Lig standings</strong><p>Current league position.</p></a>
          <a href="../teams.html"><span>Clubs</span><strong>All Süper Lig teams</strong><p>Every club with position and form.</p></a>
        </div>
      </section>
      <section class="source-strip" aria-label="Data information">
        <div><span>Time zone</span><b>${escapeHtml(label("common.timezoneNote"))}</b></div>
        <div><span>Data policy</span><b>Compiled from official sources — never generated.</b></div>
      </section>
    </main>
    ${siteFooter({ base: BASE, locale: LOCALE })}
    <script src="${BASE}site.js" defer></script>
  </body>
</html>
`;

  return { html, trPath, enPath, canonical };
}

// Kopya kayıt İngilizce sayfa üretmez — kanonik kaydınki zaten var.
const eligible = players.filter((player) =>
  publicPlayerView(player).verified && playerUrls.resolveId(player.id) === player.id);
fs.mkdirSync(OUT_DIR, { recursive: true });

let written = 0;
const pairs = [];
const sitemapEntries = [];
const skipped = players.length - eligible.length;

for (const player of eligible) {
  const result = pageHtml(player);
  const target = path.join(root, result.enPath);
  const previous = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
  if (previous !== result.html) {
    fs.writeFileSync(target, result.html, "utf8");
    written += 1;
  }
  pairs.push({ tr: result.trPath, en: result.enPath });
  sitemapEntries.push(`  <url>\n    <loc>${result.canonical}</loc>\n    <lastmod>${String(player.lastVerifiedAt || player.lastSyncedAt || "").slice(0, 10)}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.6</priority>\n  </url>`);
}

/**
 * ESKİ KOŞULARDAN KALAN SAYFALARI BUDA.
 *
 * Üretici bugüne kadar yalnızca YAZIYORDU, hiç silmiyordu: yayın kapısından
 * düşen ya da adresi değişen oyuncunun eski dosyası dizinde kalıyor, site
 * haritasına girmediği için sessizce "öksüz" bir sayfa olarak yaşıyordu.
 * Dizin artık güncel veriyi birebir yansıtır.
 */
const expectedFiles = new Set(pairs.map((pair) => path.basename(pair.en)));
let pruned = 0;
for (const file of fs.readdirSync(OUT_DIR)) {
  if (!file.endsWith(".html") || expectedFiles.has(file)) continue;
  fs.rmSync(path.join(OUT_DIR, file));
  pruned += 1;
}

const registered = writeDynamicRoutePairs("player", pairs);

for (const sitemapPath of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) {
  if (!fs.existsSync(sitemapPath)) continue;
  const current = fs.readFileSync(sitemapPath, "utf8");
  const retained = (current.match(URL_ENTRY_RE) || []).filter((entry) => !entry.includes(`${DOMAIN}/en/player/`));
  fs.writeFileSync(sitemapPath, wrapUrlset(retained.concat(sitemapEntries)), "utf8");
}

console.log(`English player pages: ${written} written, ${eligible.length - written} unchanged (${eligible.length} verified players).`);
console.log(`English player pages: ${skipped} unverified players skipped (no thin/unconfirmed EN profile).`);
console.log(`English player pages: ${registered} TR↔EN pairs registered (dynamic route map).`);
console.log(`English player pages: ${pruned} stale file(s) pruned.`);
