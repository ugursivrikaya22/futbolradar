#!/usr/bin/env node
/**
 * İNGİLİZCE OYUNCU PROFİLLERİ — /en/player/<slug>.html
 *
 * TR tarafındaki `oyuncular/<slug>.html` ile AYNI kanonik oyuncu kaydından
 * (data/players.json) üretilir, aynı slug — sağlayıcıya ikinci istek yok.
 *
 * HER TÜRKÇE PROFİLİN İNGİLİZCE EŞİ VAR. Bu üretici bir zamanlar yalnızca
 * YAYIN KAPISINDAN GEÇMİŞ (publicPlayerView(...).verified === true)
 * oyunculara sayfa yazıyordu; Türkçe profillerin büyük çoğunluğunun
 * İngilizcesi hiç yoktu ve dil düğmesi ana sayfaya düşüyordu. Artık
 * Türkçe sayfası diskte olan her oyuncu İngilizce sayfa alır.
 *
 * İNCE İÇERİK KURALI KORUNUR, ama "sayfa yok" yerine "indekslenmez" olarak —
 * ve Türkçe profille AYNI kapıdan (scripts/lib/playerIndexing.mjs): doğrulanmış
 * oyuncu YA DA en az bir kaynaklı içerik bölümü (sezon, maç günlüğü, kariyer,
 * transfer, haber, madalya, kadro durumu) olan sayfa indekslenir ve site
 * haritasına girer. Yalnızca ad + mevkiden ibaret sayfa `noindex,follow` basılır
 * ve haritada yer almaz. Eskiden burada yalnızca `verified` aranıyordu: aynı
 * bölümleri taşıyan Türkçe profil indekslenirken İngilizcesi noindex kalıyordu.
 * Sayfa Türkçesiyle aynı indirgenmiş bilgiyi verir ("Club not yet confirmed");
 * doğrulanmamış sayı İngilizcede de gösterilmez.
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
  player360FaqPage,
  player360Person,
  player360Title,
  renderPlayer360,
  renderPlayer360Kimdir
} from "./lib/player360.mjs";

import { ROBOTS_INDEX, ROBOTS_NOINDEX_FOLLOW } from "./lib/robots.mjs";
import { englishClubName, englishPlayer360 } from "./lib/player360English.mjs";
import { playerPageIsIndexable } from "./lib/playerIndexing.mjs";
import {
  englishProfilePlayers,
  peerHrefForBuiltComparisons,
  retainedEnglishPages,
  rewriteUnbuiltComparisonLinks,
  stripHreflangAlternates
} from "./lib/englishPlayerProfiles.mjs";

const require = createRequire(import.meta.url);
const {
  DOMAIN,
  absoluteUrl,
  formatDate,
  htmlLang,
  hreflangOf,
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
/** Kıyas üreticisinin bu veriyle yazacağı slug'lar (TR/EN ortak kaynak). */
const builtComparisonSlugs = slugForPair.generatedSlugs;

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
  const alt = `${player.name}${player.currentTeam ? ` — ${englishClubName(player.currentTeam)}` : ""} player photo`;
  if (photo.isPlaceholder) {
    return `<div class="player-avatar is-placeholder profile-avatar" role="img" aria-label="${escapeHtml(alt)}"><span aria-hidden="true">${escapeHtml(photo.initials)}</span></div>`;
  }
  return `<img class="player-avatar profile-avatar" src="${escapeHtml(photo.url)}" alt="${escapeHtml(alt)}" width="96" height="96" loading="lazy" decoding="async">`;
}

/**
 * AÇIKLAMA CÜMLE SINIRINDA KISALIR, SÖZCÜK ORTASINDA DEĞİL.
 *
 * `normalize-meta` uzun açıklamayı sözcük sınırında keser. Kulüp listesiyle
 * biten bir açıklamada bu, çok sözcüklü bir kulüp adını ortadan bölüyordu
 * ("…, Yeni Malatyaspor" → "…, Yeni."): yarım ad hem anlamsız hem de
 * İngilizce sayfada Türkçe sözcük olarak kalıyordu. Burada açıklama sınıra
 * sığana kadar sondaki öğe BÜTÜN olarak düşürülür.
 */
const DESCRIPTION_MAX = 155;

function fitDescription(value) {
  const text = String(value || "");
  if (text.length <= DESCRIPTION_MAX) return text;
  const tail = " — on FutbolRadar.";
  const parts = (text.endsWith(tail) ? text.slice(0, -tail.length) : text.replace(/\.$/, "")).split(", ");
  while (parts.length > 1 && `${parts.join(", ")}.`.length > DESCRIPTION_MAX) parts.pop();
  return `${parts.join(", ")}.`;
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
  const team = englishClubName(fields.currentTeam || fields.team || null);

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
  // İNDEKS KARARI Türkçe profille AYNI kapıdan (scripts/lib/playerIndexing.mjs):
  // en az bir kaynaklı içerik bölümü olan sayfa indekslenir; `verified` tek
  // başına yetmez (yalnızca kimlik + biyografi ince içeriktir). Eskiden iki
  // üretici ayrışıyordu: aynı bölümleri taşıyan Türkçe profil indekslenirken
  // İngilizce eşi noindex kalıyor, Türkçe sayfanın hreflang'ı
  // indekslenmeyen sayfaya bakıyordu.
  // Karar, çeviri modeli değiştirmeden ÖNCE verilir (TR üreticisiyle aynı sıra).
  const indexable = playerPageIsIndexable({ model });
  // Kayıt Türkçe tutulur (mevki, uyruk, transfer türü…); İngilizce sayfada
  // elle yazılmış karşılıkları basılır, karşılığı olmayan alan boş kalır.
  englishPlayer360(model);
  const position = model.identity.position || "";
  // Static pairs are generated only for canonical records. A verified alias
  // can still own the public profile when its canonical record is unverified;
  // use the existing picker (which resolves IDs) instead of inventing a URL.
  const pickerFor = (peer) => `${BASE}oyuncu-karsilastir.html?p1=${encodeURIComponent(player.id)}&p2=${encodeURIComponent(peer.id)}`;
  if (player.isDuplicate) {
    model.compare.peers = model.compare.peers.map(peer => ({ ...peer, href: pickerFor(peer) }));
  } else {
    // TR profiliyle aynı kural: yalnızca üreticinin yazdığı kıyas sayfası.
    model.compare.peers = model.compare.peers.map(peer => ({ ...peer,
      href: peerHrefForBuiltComparisons(peer.href, builtComparisonSlugs, pickerFor(peer))
    }));
  }

  const title = player360Title(model, { locale: LOCALE });
  const description = fitDescription(player360Description(model, { locale: LOCALE }));

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

  const person = player360Person(model, canonical, description);
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      person,
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: label("breadcrumb.home"), item: absoluteUrl("en/index.html") },
          { "@type": "ListItem", position: 2, name: label("nav.teams"), item: absoluteUrl("en/teams.html") },
          { "@type": "ListItem", position: 3, name: model.identity.name, item: canonical }
        ]
      },
      {
        "@type": "ProfilePage",
        "@id": `${canonical}#profile`,
        url: canonical,
        name: model.identity.name,
        description,
        mainEntity: { "@id": `${canonical}#person` },
        isPartOf: { "@type": "WebSite", name: "FutbolRadar", url: "https://www.futbolradar.com/" },
        inLanguage: "en"
      },
      ...(player360FaqPage(model, canonical, { locale: LOCALE })
        ? [player360FaqPage(model, canonical, { locale: LOCALE })]
        : [])
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
    <!-- hreflang:start -->
    <link rel="alternate" hreflang="${hreflangOf("tr")}" href="${absoluteUrl(trPath)}" />
    <link rel="alternate" hreflang="${hreflangOf("en")}" href="${canonical}" />
    <link rel="alternate" hreflang="x-default" href="${absoluteUrl(trPath)}" />
    <!-- hreflang:end -->
    <meta name="robots" content="${indexable ? ROBOTS_INDEX : ROBOTS_NOINDEX_FOLLOW}" />
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
      <nav class="breadcrumb" aria-label="Breadcrumb"><a href="${BASE}en/index.html">${escapeHtml(label("breadcrumb.home"))}</a><span>/</span><a href="${BASE}en/teams.html">${escapeHtml(label("nav.teams"))}</a><span>/</span><span>${escapeHtml(model.identity.name)}</span></nav>
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
      ${renderPlayer360Kimdir(model, { locale: LOCALE })}
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

  return { html, trPath, enPath, canonical, indexable };
}

// Aynı yayın adresi tek kayıttan üretilir; doğrulanmış kayıt önceliklidir.
// Türkçe sayfası diskte olmayan oyuncuya İngilizce sayfa yazılmaz.
const candidates = englishProfilePlayers(players, playerUrls, publicPlayerView, { includeUnverified: true });
const eligible = candidates.filter((player) => publicPlayerView(player).verified
  || fs.existsSync(path.join(root, playerUrls.playerPagePath(player.id))));
fs.mkdirSync(OUT_DIR, { recursive: true });

let written = 0;
const pairs = [];
const sitemapEntries = [];
const withoutTurkishPage = candidates.length - eligible.length;
let indexableCount = 0;

for (const player of eligible) {
  const result = pageHtml(player);
  const target = path.join(root, result.enPath);
  const previous = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
  if (previous !== result.html) {
    fs.writeFileSync(target, result.html, "utf8");
    written += 1;
  }
  pairs.push({ tr: result.trPath, en: result.enPath });
  // Doğrulanmamış kaydın sayfası noindex; site haritasına girmez.
  if (!result.indexable) continue;
  indexableCount += 1;
  sitemapEntries.push(`  <url>\n    <loc>${result.canonical}</loc>\n    <lastmod>${String(player.lastVerifiedAt || player.lastSyncedAt || "").slice(0, 10)}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.6</priority>\n  </url>`);
}

/**
 * GÜNCEL VERİDE OLMAYAN SAYFALAR KORUNUR (silme yok).
 * Eskiden dizin güncel veriye budanıyordu; saatlik yenileme oyuncu düşürdüğünde
 * yayındaki sayfalar silinip üretim kapısı kırıldı (eade051911fd). Artık
 * mevcut dosyalar ve site haritası kayıtları yerinde kalır.
 */
const expectedFiles = new Set(pairs.map((pair) => path.basename(pair.en)));
const retainedPages = retainedEnglishPages(fs.readdirSync(OUT_DIR), expectedFiles);
// Korunan sayfanın TR eşi artık EN alternatifini duyurmuyor; tek taraflı
// hreflang bırakmamak için korunan sayfadaki alternate etiketleri kaldırılır
// (canonical yerinde kalır, sayfa erişilebilir kalır).
for (const file of retainedPages) {
  const target = path.join(OUT_DIR, file);
  const html = fs.readFileSync(target, "utf8");
  const stripped = rewriteUnbuiltComparisonLinks(stripHreflangAlternates(html), builtComparisonSlugs, `${BASE}oyuncu-karsilastir.html`);
  if (stripped !== html) fs.writeFileSync(target, stripped, "utf8");
}
const retainedLocs = new Set(retainedPages.map((file) => `${DOMAIN}/en/player/${file.slice(0, -5)}`));

const registered = writeDynamicRoutePairs("player", pairs);

for (const sitemapPath of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) {
  if (!fs.existsSync(sitemapPath)) continue;
  const current = fs.readFileSync(sitemapPath, "utf8");
  const retained = (current.match(URL_ENTRY_RE) || []).filter((entry) => !entry.includes(`${DOMAIN}/en/player/`)
    || [...retainedLocs].some((loc) => entry.includes(`<loc>${loc}</loc>`) || entry.includes(`<loc>${loc}.html</loc>`)));
  fs.writeFileSync(sitemapPath, wrapUrlset(retained.concat(sitemapEntries)), "utf8");
}

console.log(`English player pages: ${written} written, ${eligible.length - written} unchanged (${eligible.length} players).`);
console.log(`English player pages: ${indexableCount} indexable (verified or with sourced content), ${eligible.length - indexableCount} thin (noindex,follow, outside the sitemap); ${withoutTurkishPage} without a Turkish page skipped.`);
console.log(`English player pages: ${registered} TR↔EN pairs registered (dynamic route map).`);
console.log(`English player pages: ${retainedPages.length} page(s) outside current data retained (never deleted).`);
