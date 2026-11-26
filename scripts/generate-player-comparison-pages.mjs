import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { siteHeader, siteFooter } from "./lib/layout.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";
import { createFreshnessTracker } from "./lib/sitemapFreshness.mjs";
import { ROBOTS_INDEX } from "./lib/robots.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { playerLink, playerAbsoluteUrl } = require("../services/playerLinks.js");
const { getPlayers, formatMarketValueEur } = require("../services/playerService.js");
const { publicPlayerView, sourceMetadata } = require("../services/cardCredibility.js");
const { annotateDuplicates, sameCanonicalPlayer } = require("../services/duplicatePlayerService.js");
const { playerPer90Stats } = require("../services/statNormalization.js");
const { formatFreshnessDate } = require("../services/freshnessService.js");
// ÖZELLİK PUANLARI SUNUCUDA BASILIR.
//
// Sekiz satır (Overall, Form, Hücum, Yaratıcılık, Savunma, Disiplin,
// Süreklilik, Potansiyel) bugüne kadar yalnızca istemcide, `/api/players`
// yanıtından çiziliyordu — ve orada hepsi "-" kalıyordu. Artık puan build
// sırasında hesaplanıp (scripts/compute-player-ratings.mjs) statik HTML'e
// gömülüyor: hem tablo doluyor hem de arama motoru "Osimhen overall rating"
// sorgusunun cevabını JavaScript çalıştırmadan görüyor.
const { withStoredRatings } = require("../services/playerRatingService.js");
const {
  comparisonRatingTableHtml,
  categoryOf,
  oldestRatingUpdatedAt,
  ratingAdditionalProperties,
  ratingScoresOf
} = require("../services/playerRatingView.js");
// Eş seçimi ve puanlama TEK kaynaktan (services/playerComparisonPairs.js):
// profil sayfası, Futbolcu 360 kıyas bölümü ve bu üretici aynı listeyi
// görmek zorunda, yoksa bağlantılar üretilmemiş sayfalara gider.
const {
  comparePeerScore,
  comparisonSlug,
  createComparisonSlugResolver,
  EDITORIAL_PAIRS,
  playerCurrentTeam,
  playerPositionGroup,
  positionGroupLabel,
  playerRating,
  profileCompareCandidates,
  uniqueCompareCandidates
} = require("../services/playerComparisonPairs.js");
/**
 * KIYAS YALNIZCA KANONİK KAYITLAR ARASINDA.
 *
 * Kopya kayıtların (aynı gerçek oyuncunun ikinci kaydı) artık profil
 * sayfası yok — kanonik kayda yönlendiriyorlar. Onları kıyas havuzunda
 * tutmak, hiçbir yerden bağlanmayan yüzlerce kıyas sayfası üretiyordu:
 * sayfayı basan taraf (kopya kaydın profili) ortadan kalktığı için
 * bağlantı da kalmadı, ama sayfa ve site haritası girdisi kaldı.
 */
function readJsonFile(relativePath, fallback) {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    console.warn(`[comparison-pages] ${relativePath} okunamadı: ${error.message}`);
    return fallback;
  }
}

const storedRatings = readJsonFile("data/player-ratings.json", { players: {} });
const allPlayerRecords = withStoredRatings(
  annotateDuplicates(getPlayers(JSON.parse(fs.readFileSync(path.join(root, "data", "players.json"), "utf8")))),
  storedRatings
);
const players = allPlayerRecords.filter((player) => !player.isDuplicate);
/** Kıyas adresi tek kaynaktan; editoryal istisnalar dahil. */
const slugForPair = createComparisonSlugResolver(allPlayerRecords);
const outDir = path.join(root, "karsilastirma");
const publicOutDir = path.join(root, "public", "karsilastirma");
const domain = "https://www.futbolradar.com";
const retryBuffer = new Int32Array(new SharedArrayBuffer(4));

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function writeGeneratedFile(file, contents) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      fs.writeFileSync(file, contents, "utf8");
      return;
    } catch (error) {
      const retryable = ["UNKNOWN", "EBUSY", "EPERM"].includes(error && error.code);
      if (!retryable || attempt === 11) throw error;
      Atomics.wait(retryBuffer, 0, 0, 75 * (attempt + 1));
    }
  }
}

function stripTags(value) {
  return String(value ?? "").replace(/<[^>]*>/g, "").trim();
}

function playerNeedsTransferReview(player) {
  return ["transfer_needs_monitoring", "manual-review"].includes(String(player.dataStatus || ""));
}

function playerTeamDisplay(player) {
  const team = playerCurrentTeam(player);
  return playerNeedsTransferReview(player) ? `${team} (takipte)` : team;
}

function playerMarket(player) {
  return player.marketValue || formatMarketValueEur(player.marketValueEur) || "Piyasa değeri yakında";
}

/**
 * AYNI ÇİFT İKİ ADRESTE YAYIMLANMAZ.
 *
 * Editoryal çiftler yayımlanmış adreslerini koruyor (kopya kayıt
 * kimliğiyle yazılmış slug'lar), ama kayıtları kanoniğe çözülüyor. Bu
 * ikisi bir araya gelince aynı kıyas hem editoryal slug'da hem de kanonik
 * kimliklerden türeyen slug'da üretiliyordu: iki URL, aynı başlık, aynı
 * içerik. Çift, ADRESİYLE değil KİMLİĞİYLE tekilleştirilir; ilk gelen
 * (editoryal) adresi kazanır.
 */
function canonicalPairKey(left, right) {
  return [left.canonicalId || left.id, right.canonicalId || right.id].sort().join("::");
}

const seenPairKeys = new Map();

function addPair(map, left, right, context, forcedSlug) {
  if (!left || !right || left.id === right.id || sameCanonicalPlayer(left, right)) {
    return;
  }

  const pairKey = canonicalPairKey(left, right);
  const existingSlug = seenPairKeys.get(pairKey);
  if (existingSlug) {
    const existing = map.get(existingSlug);
    if (existing && context && !existing.reasons.includes(context)) existing.reasons.push(context);
    return;
  }

  const slug = forcedSlug || slugForPair(left, right);
  seenPairKeys.set(pairKey, slug);
  if (!map.has(slug)) {
    const ordered = [left, right].sort((a, b) => a.id.localeCompare(b.id));
    map.set(slug, {
      slug,
      left: ordered[0],
      right: ordered[1],
      reasons: []
    });
  }

  const pair = map.get(slug);
  if (context && !pair.reasons.includes(context)) {
    pair.reasons.push(context);
  }
}

const EDITORIAL_SLUGS = new Set(EDITORIAL_PAIRS.map(([leftId, rightId]) => comparisonSlug(leftId, rightId)));

function buildPairs() {
  const map = new Map();

  // EDİTORYAL ÇİFTLER KOPYA KAYIT KİMLİĞİYLE YAZILMIŞ.
  //
  // Havuz kanonik kayıtlarla sınırlandığında bu kimlikler havuzda
  // bulunamıyor ve dört editoryal kıyas sayfası hiç üretilmiyordu — oysa
  // onlara ana sayfa, gol krallığı ve oyuncu radarından bağlantı var.
  // Kayıt kanoniğe çözülür; ADRES ise bildirilen slug'da KALIR, çünkü o
  // adres zaten yayımlanmış ve bağlantılanmış durumda.
  for (const [leftId, rightId, reason] of EDITORIAL_PAIRS) {
    const resolve = (id) => {
      const record = allPlayerRecords.find((player) => player.id === id);
      if (!record) return null;
      return players.find((player) => player.id === (record.canonicalId || record.id)) || null;
    };

    addPair(map, resolve(leftId), resolve(rightId), reason);
  }

  for (const player of players) {
    for (const item of profileCompareCandidates(player, players)) {
      addPair(map, player, item.player, item.note || item.label);
    }
  }

  // No cap: every profile page links to its four comparison peers, so each
  // pair collected above must get a page or those links 404. A fixed limit
  // only happened to cover the full set back when the squad was tiny.
  return Array.from(map.values());
}

/**
 * Kıyas yorumu. "X overall rating tarafında önde" cümlesi bir SAYIDAN
 * türetilmiş bir iddiadır; sayı doğrulanmamışsa cümle de doğrulanmamıştır.
 * Cümlenin sayı içermemesi onu güvenli yapmıyor.
 *
 * İki taraf da doğrulanmadıkça yalnızca rol okuması kalıyor — bu, kayıttan
 * değil mevkiden türeyen ve tartışmasız bir ifade.
 */
function comparisonInsight(left, right) {
  const bothVerified = publicPlayerView(left).verified && publicPlayerView(right).verified;
  const roleLine = `${positionGroupLabel(left)} ve ${positionGroupLabel(right)} rolleri birlikte okunmalı; tek skor karar için yeterli değil.`;

  if (!bothVerified) {
    return [
      "Bu kıyasın performans ve piyasa okuması, iki oyuncunun da doğrulanmış sağlayıcı kaydı geldiğinde yayımlanacak.",
      roleLine
    ];
  }

  const ratingDiff = playerRating(left) - playerRating(right);
  const marketDiff = Number(left.marketValueEur || 0) - Number(right.marketValueEur || 0);
  const leader = ratingDiff >= 0 ? left : right;
  const marketLeader = marketDiff >= 0 ? left : right;

  return [
    `${leader.name} overall rating tarafında önde görünüyor.`,
    `${marketLeader.name} piyasa değeri okumasında daha güçlü sinyal veriyor.`,
    roleLine
  ];
}

/**
 * Kıyas kartı. Puan bir <dl> içinde de olsa puandır: rozet biçiminde
 * olmaması onu doğrulanmış yapmıyor. Denetimde bu yüzey neredeyse
 * kaçırılmıştı — arama kalıbı rozete bakıyordu, buradaki
 * "<dt>Overall</dt><dd>80</dd>" ise 422 sayfada duruyordu.
 *
 * Doğrulanmamış kayıtta kulüp, lig, puan ve piyasa satırları hiç
 * çizilmiyor; "Yakında" gibi bir yer tutucu da basılmıyor, çünkü ölçüm
 * bekleniyormuş izlenimi veriyor. Kart ve bağlantı kalıyor.
 */
function playerMiniCard(player) {
  const view = publicPlayerView(player);
  const verified = view.verified;

  // Satırlar tek tek kapıdan geçenlerden kurulur: doğrulanmış bir kayıtta
  // bile sağlayıcının göndermediği puan ve piyasa değeri basılmaz.
  const fields = view.fields || {};
  const rating = fields.overallRating || fields.aiRating || fields.rating;
  const market = fields.marketValue
    || (fields.marketValueEur !== undefined ? formatMarketValueEur(fields.marketValueEur) : null);

  const verifiedRows = [];
  if (fields.currentTeam || fields.team) {
    verifiedRows.push(`<div><dt>Takım</dt><dd>${escapeHtml(playerTeamDisplay(player))}</dd></div>`);
  }
  if (player.league) verifiedRows.push(`<div><dt>Lig</dt><dd>${escapeHtml(player.league)}</dd></div>`);
  if (rating) verifiedRows.push(`<div><dt>Overall</dt><dd>${escapeHtml(rating)}</dd></div>`);
  if (market) verifiedRows.push(`<div><dt>Piyasa</dt><dd>${escapeHtml(market)}</dd></div>`);

  // Ham VE 90 dakikaya normalize edilmiş değer birlikte basılır — yalnızca
  // istatistik gerçekten doğrulanmışsa (fields.goals/assists zaten
  // publicPlayerView'dan sadece bu durumda geliyor, bkz. cardCredibility.js
  // statsAreVerified). Dakika verisi yoksa per-90 satırı hiç basılmaz;
  // tahmini bir oran gerçek ölçüm gibi gösterilmez.
  if (fields.goals != null || fields.assists != null) {
    const per90 = playerPer90Stats(player);
    if (fields.goals != null) {
      verifiedRows.push(`<div><dt>Gol (ham)</dt><dd>${escapeHtml(fields.goals)}</dd></div>`);
      if (per90.goalsPer90 != null) verifiedRows.push(`<div><dt>Gol (90 dk)</dt><dd>${escapeHtml(per90.goalsPer90)}</dd></div>`);
    }
    if (fields.assists != null) {
      verifiedRows.push(`<div><dt>Asist (ham)</dt><dd>${escapeHtml(fields.assists)}</dd></div>`);
      if (per90.assistsPer90 != null) verifiedRows.push(`<div><dt>Asist (90 dk)</dt><dd>${escapeHtml(per90.assistsPer90)}</dd></div>`);
    }
  }

  const rows = verified && verifiedRows.length
    ? verifiedRows.join("\n      ")
    : `<div><dt>Veri durumu</dt><dd>Doğrulanmış kayıt bekleniyor</dd></div>`;

  return `<article class="comparison-mini-card" data-player-verified="${verified ? "true" : "false"}">
    <span>${escapeHtml(player.position || "Mevki yakında")}</span>
    <h2>${escapeHtml(player.name)}</h2>
    <dl>
      ${rows}
    </dl>
    <a href="${escapeHtml(playerLink(player.id, "../"))}">Oyuncu profilini aç</a>
  </article>`;
}

/**
 * "SON GÜNCELLEME" + "VERİ KAYNAĞI" — her karşılaştırma sayfasında görünür.
 *
 * İki tarafın da kendi kaynak künyesi var (sourceMetadata); okuyucuya
 * tekil bir tarih/kaynak gösterilir: en ESKİ doğrulama zamanı alınır, çünkü
 * sayfa iki kaydın DAHA AZ güncel olanı kadar güncel sayılabilir. Kaynak
 * isimleri farklıysa ikisi de yazılır.
 */
function comparisonSourceStripHtml(left, right) {
  const leftMeta = sourceMetadata(left);
  const rightMeta = sourceMetadata(right);
  const timestamps = [leftMeta.last_verified_at, rightMeta.last_verified_at]
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value));
  const oldest = timestamps.length ? Math.min(...timestamps) : null;
  const updatedLabel = oldest === null ? "Tarih bekleniyor" : formatFreshnessDate(new Date(oldest).toISOString());

  const sourceNames = Array.from(new Set([leftMeta.source_name, rightMeta.source_name].filter(Boolean)));
  const sourceLabel = sourceNames.length ? sourceNames.join(" · ") : "Kaynak doğrulaması bekleniyor";

  return `<section class="source-strip" aria-label="Karşılaştırma veri künyesi">
        <div><span>Son güncelleme</span><b>${escapeHtml(updatedLabel)}</b></div>
        <div><span>Veri kaynağı</span><b>${escapeHtml(sourceLabel)}</b></div>
        <div><span>Veri durumu</span><b>${escapeHtml(leftMeta.data_confidence === "high" && rightMeta.data_confidence === "high" ? "İki taraf da doğrulandı" : "En az bir taraf doğrulama bekliyor")}</b></div>
      </section>`;
}

/**
 * META AÇIKLAMASI SAYIYI BAŞA ALIR.
 *
 * "Osimhen overall rating" ve "Osimhen Greenwood comparison" sorgularının
 * cevabı sayfada hesaplanmış hâlde duruyor; açıklamanın da aynı sayıyı
 * söylemesi, sonuç listesinde tıklanmadan önce doğru sayfanın görünmesini
 * sağlıyor.
 *
 * CÜMLE SONA EKLENMEZ, BAŞA GEÇER. Açıklamalar yayından önce 160 karaktere
 * kısaltılıyor (scripts/normalize-meta.mjs) ve genel tanıtım cümlesi zaten
 * ~155 karakter; sona eklenen her şey kesiliyordu. Sayı başta olunca
 * kırpma onu değil, tanıtım cümlesinin kuyruğunu alır.
 *
 * Puan hesaplanmamışsa cümle HİÇ kurulmaz: sayfanın gösteremeyeceği bir
 * şeyi arama sonucunda vaat etmek, tıklayan okuyucuya boş satır göstermek
 * demek olurdu.
 */
const META_DESCRIPTION_MAX = 160;

function comparisonDescription(left, right) {
  const generic = `${left.name} ve ${right.name} oyuncu karşılaştırması; AI rating, form, gol tehdidi, yaratıcılık, pres gücü, piyasa değeri ve transfer bilgileriyle FutbolRadar'da analiz edilir.`;
  const leftOverall = categoryOf(left, "overall");
  const rightOverall = categoryOf(right, "overall");
  if (leftOverall.status !== "computed" || rightOverall.status !== "computed") return generic;

  const lead = `${left.name} overall ${leftOverall.value}, ${right.name} overall ${rightOverall.value}.`;
  const tail = " Form, hücum, yaratıcılık, savunma, disiplin, süreklilik ve potansiyel puanlarıyla FutbolRadar karşılaştırması.";
  // Uzun isimlerde kuyruk düşer, sayı kalır.
  return (lead + tail).length <= META_DESCRIPTION_MAX ? lead + tail : lead;
}

/**
 * BÖLÜM, GÖSTERECEK BİR ŞEY YOKKEN HİÇ BASILMAZ.
 *
 * İki tarafın da hiçbir kategorisi hesaplanamıyorsa tablo sekiz satır
 * "Veri yetersiz" yazan bir duvara dönüşüyor. Yokluğu bildirmenin dürüst
 * yolu bu değil: kıyasın üst kısmındaki kaynak künyesi ("En az bir taraf
 * doğrulama bekliyor") zaten durumu söylüyor. Tek taraf hesaplanmışsa tablo
 * BASILIR — o zaman gerçekten kıyaslanacak bir sayı var ve diğer sütunun
 * boşluğu bilgi taşıyor.
 */
function ratingSectionHtml(left, right, table) {
  const anyComputed = [left, right].some((player) => {
    const scores = ratingScoresOf(player);
    return scores && scores.status === "computed";
  });
  if (!anyComputed || !table) return "";

  return `<section class="comparison-ratings" aria-label="Özellik puanları">
        <div class="profile-section-head">
          <h2>${escapeHtml(left.name)} ve ${escapeHtml(right.name)} özellik puanları</h2>
          <span>Overall, form, hücum, yaratıcılık, savunma, disiplin, süreklilik ve potansiyel</span>
        </div>
        ${ratingLeadHtml(left, right)}
        ${table}
      </section>`;
}

/** Sayfa başındaki özet cümle: iki oyuncunun sekiz satırdaki durumu. */
function ratingLeadHtml(left, right) {
  const rows = ["overall", "form", "attack"].map((key) => {
    const leftCell = categoryOf(left, key);
    const rightCell = categoryOf(right, key);
    if (leftCell.status !== "computed" && rightCell.status !== "computed") return null;
    return `${leftCell.label}: ${left.name} ${leftCell.display} - ${right.name} ${rightCell.display}`;
  }).filter(Boolean);

  if (!rows.length) return "";
  return `<p class="rating-lead">${rows.map((row) => escapeHtml(row)).join(" · ")}</p>`;
}

function pageHtml(pair) {
  const { left, right, slug, reasons } = pair;
  const title = `${left.name} vs ${right.name} | Oyuncu Karşılaştırması | FutbolRadar`;
  const description = comparisonDescription(left, right);
  const canonical = `${domain}/karsilastirma/${slug}.html`;
  const insights = comparisonInsight(left, right);
  const ratingUpdatedAt = oldestRatingUpdatedAt([left, right]);
  const ratingTable = comparisonRatingTableHtml([left, right], {
    updatedLabel: ratingUpdatedAt ? formatFreshnessDate(ratingUpdatedAt) : ""
  });
  const ratingPersonNodes = [left, right]
    .map((player) => {
      const properties = ratingAdditionalProperties(player);
      if (!properties.length) return null;
      return {
        "@type": "Person",
        name: player.name,
        url: playerAbsoluteUrl(player.id, domain),
        additionalProperty: properties
      };
    })
    .filter(Boolean);

  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${canonical}" />
    <meta name="robots" content="${ROBOTS_INDEX}" />
    <meta property="og:type" content="article" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${domain}/assets/og-image.png" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${domain}/assets/og-image.png" />
    <script type="application/ld+json">
      ${JSON.stringify({
        "@context": "https://schema.org",
        "@graph": [
          // KIYAS SAYFASI BİR HABER/MAKALE DEĞİL: yayın tarihi ve yazarı yok.
          // `Article` yazmak zorunlu datePublished/author alanlarını boş
          // bırakıyordu (2.800+ sayfada geçersiz şema). Sayfanın gerçek türü
          // WebPage; tarih ya da yazar UYDURULMAZ.
          {
            "@type": "WebPage",
            name: title,
            description: stripTags(description),
            url: canonical,
            mainEntityOfPage: canonical,
            inLanguage: "tr-TR",
            isPartOf: { "@type": "WebSite", name: "FutbolRadar", url: `${domain}/` },
            publisher: {
              "@type": "Organization",
              name: "FutbolRadar"
            },
            about: [left.name, right.name]
          },
          {
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Ana Sayfa", item: `${domain}/` },
              { "@type": "ListItem", position: 2, name: "Oyuncu Karşılaştırmaları", item: `${domain}/oyuncu-karsilastirmalari.html` },
              { "@type": "ListItem", position: 3, name: `${left.name} vs ${right.name}`, item: canonical }
            ]
          },
          // MEVCUT DÜĞÜMLER BOZULMADAN eklenir: WebPage ve BreadcrumbList
          // aynen kalır, hesaplanmış puanlar yalnızca Person düğümlerine
          // `additionalProperty` olarak girer. Hesaplanamayan kategori
          // düğüme HİÇ girmez — makine okunur veride "Veri yetersiz" metni
          // bir ölçü gibi görünmemeli.
          ...ratingPersonNodes
        ]
      })}
    </script>
    <link rel="icon" href="../favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="../site.webmanifest" />
    <link rel="stylesheet" href="../page.css" />
  </head>
  <body class="subpage">
    ${siteHeader({ base: "../" })}
    <main class="container compare-seo-page">
      <nav class="breadcrumb" aria-label="Sayfa yolu">
        <a href="../index.html">Ana Sayfa</a>
        <span>/</span>
        <a href="../oyuncu-karsilastir.html">Oyuncu Karşılaştırma</a>
        <span>/</span>
        <span>${escapeHtml(left.name)} vs ${escapeHtml(right.name)}</span>
      </nav>
      <section class="hero comparison-hero">
        <div class="hero-row">
          <div>
            <span class="eyebrow">Oyuncu karşılaştırma radarı</span>
            <h1>${escapeHtml(left.name)} vs ${escapeHtml(right.name)}</h1>
            <p class="lead">${escapeHtml(description)}</p>
          </div>
          <span class="hero-meta">${escapeHtml(playerTeamDisplay(left))} - ${escapeHtml(playerTeamDisplay(right))}</span>
        </div>
      </section>

      <section class="static-comparison-summary" aria-label="Statik karşılaştırma özeti">
        ${playerMiniCard(left)}
        <article class="comparison-mini-card comparison-mini-card-accent">
          <span>Radar Notu</span>
          <h2>Kıyas Özeti</h2>
          <ul>
            ${insights.map((item) => `<li>${escapeHtml(item)}</li>`).join("\n            ")}
          </ul>
          <p>${escapeHtml(reasons.slice(0, 3).join(" - ") || "Rol, form ve rating yakınlığı")}</p>
        </article>
        ${playerMiniCard(right)}
      </section>

      ${comparisonSourceStripHtml(left, right)}

      ${ratingSectionHtml(left, right, ratingTable)}

      <section class="compare-grid" data-api-target="player-compare" data-compare-seed="${escapeHtml(left.id)},${escapeHtml(right.id)}">
        <article class="data-empty" data-card="empty-state">
          <strong>Karşılaştırma yükleniyor</strong>
          <span>Oyuncu radar metrikleri hazırlanıyor.</span>
        </article>
      </section>

      <section class="comparison-seo-links" aria-label="İlgili karşılaştırma bağlantıları">
        <span>Devam et</span>
        <a href="${escapeHtml(playerLink(left.id, "../"))}">${escapeHtml(left.name)} profili</a>
        <a href="${escapeHtml(playerLink(right.id, "../"))}">${escapeHtml(right.name)} profili</a>
        <a href="../oyuncu-radari.html">Oyuncu Radarı</a>
        <a href="../oyuncu-karsilastir.html?players=${escapeHtml(left.id)},${escapeHtml(right.id)}">İnteraktif kıyas</a>
      </section>
    </main>
    ${siteFooter({ base: "../" })}
    <script src="../site.js" defer></script>
    <script src="../app.js" defer></script>
  </body>
</html>
`;
}

function comparisonIndexCard(pair) {
  const { left, right, slug, reasons } = pair;
  const roleLabel = playerPositionGroup(left) === playerPositionGroup(right)
    ? `${positionGroupLabel(left)} eşleşmesi`
    : `${positionGroupLabel(left)} / ${positionGroupLabel(right)}`;

  // Rating farkı bir SAYIDAN türetilmiş iddiadır; iki taraf da doğrulanmış
  // değilse basılmaz — bu tam olarak comparisonInsight()'ın uyguladığı
  // kural, indeks kartı için de geçerli (bkz. karar notu comparisonInsight).
  const bothVerified = publicPlayerView(left).verified && publicPlayerView(right).verified;
  const ratingDelta = bothVerified ? Math.abs(playerRating(left) - playerRating(right)) : null;
  const footer = ratingDelta === null
    ? "Doğrulanmış puan bekleniyor"
    : `Rating farkı ${escapeHtml(ratingDelta.toFixed(1))}`;

  return `<a class="comparison-index-card" href="./karsilastirma/${escapeHtml(slug)}.html">
    <span>${escapeHtml(roleLabel)}</span>
    <strong>${escapeHtml(left.name)} vs ${escapeHtml(right.name)}</strong>
    <p>${escapeHtml((reasons && reasons[0]) || "Rating, form ve rol etkisi")}</p>
    <em>${footer}</em>
  </a>`;
}

function comparisonIndexHtml(pairs) {
  const title = "Oyuncu Karşılaştırmaları | Statik Kıyaslar | FutbolRadar";
  const description = "FutbolRadar oyuncu karşılaştırmaları; Süper Lig oyuncularını AI rating, form, rol etkisi, piyasa değeri ve transfer sinyalleriyle yan yana inceler.";
  const canonical = `${domain}/oyuncu-karsilastirmalari.html`;
  // Aynı mevki kıyasları önce gelir: bir forvet arayan okuyucu için bir
  // kaleci-forvet eşleşmesi daha az kullanışlıdır. Editoryal dörtlü (elle
  // seçilmiş öne çıkanlar) sırasını korur; geri kalan aday havuzu yalnızca
  // rol eşleşmesine göre yeniden sıralanır.
  const editorial = pairs.filter((pair) => EDITORIAL_SLUGS.has(pair.slug));
  const rest = pairs
    .filter((pair) => !EDITORIAL_SLUGS.has(pair.slug))
    .slice()
    .sort((a, b) => {
      const aSameRole = playerPositionGroup(a.left) === playerPositionGroup(a.right) ? 1 : 0;
      const bSameRole = playerPositionGroup(b.left) === playerPositionGroup(b.right) ? 1 : 0;
      return bSameRole - aSameRole;
    });
  const topPairs = editorial.concat(rest).slice(0, 20);

  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${canonical}" />
    <meta name="robots" content="${ROBOTS_INDEX}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${domain}/assets/og-image.png" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${domain}/assets/og-image.png" />
    <script type="application/ld+json">
      ${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: title,
        description,
        url: canonical,
        mainEntity: {
          "@type": "ItemList",
          itemListElement: topPairs.map((pair, index) => ({
            "@type": "ListItem",
            position: index + 1,
            name: `${pair.left.name} vs ${pair.right.name}`,
            url: `${domain}/karsilastirma/${pair.slug}.html`
          }))
        }
      }, null, 8)}
    </script>
    <link rel="icon" href="./favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="./site.webmanifest" />
    <link rel="stylesheet" href="./page.css" />
  </head>
  <body class="subpage">
    ${siteHeader({ base: "./" })}
    <main class="container comparison-index-page">
      <nav class="breadcrumb" aria-label="Sayfa yolu"><a href="./index.html">Ana Sayfa</a><span>/</span><a href="./oyuncu-radari.html">Oyuncu Radarı</a><span>/</span><span>Oyuncu Karşılaştırmaları</span></nav>
      <section class="hero">
        <div class="hero-row">
          <div>
            <span class="eyebrow">Oyuncu karşılaştırma merkezi</span>
            <h1>Oyuncu Karşılaştırmaları</h1>
            <p class="lead">${escapeHtml(description)}</p>
          </div>
          <span class="hero-meta">${escapeHtml(topPairs.length)} hazır kıyas</span>
        </div>
      </section>
      <section class="comparison-index-grid" aria-label="Hazır oyuncu karşılaştırmaları">
        ${topPairs.map(comparisonIndexCard).join("\n        ")}
      </section>
      <section class="comparison-seo-links" aria-label="Oyuncu karşılaştırma gezinme">
        <span>Devam et</span>
        <a href="./oyuncu-radari.html">Oyuncu Radarı</a>
        <a href="./oyuncu-karsilastir.html">İnteraktif kıyas</a>
        <a href="./oyuncular/en-iyi-oyuncular.html">En iyi oyuncular</a>
      </section>
    </main>
    ${siteFooter({ base: "./" })}
    <script src="./site.js" defer></script>
    <script src="./app.js" defer></script>
  </body>
</html>
`;
}

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(publicOutDir, { recursive: true });

const pairs = buildPairs();
const expectedFiles = new Set(pairs.map((pair) => `${pair.slug}.html`));
function isStatComparisonModule(file) {
  try {
    return fs.readFileSync(file, "utf8").includes('data-fr-module="stat-comparison"');
  } catch {
    return false;
  }
}
for (const directory of [outDir, publicOutDir]) {
  for (const file of fs.readdirSync(directory)) {
    if (!file.endsWith(".html") || expectedFiles.has(file)) continue;
    const full = path.join(directory, file);
    // Kaynaklı kıyas modülünün sayfaları bu üreticinin listesinde değildir.
    if (isStatComparisonModule(full)) continue;
    fs.unlinkSync(full);
  }
}

for (const pair of pairs) {
  const html = pageHtml(pair);
  writeGeneratedFile(path.join(outDir, `${pair.slug}.html`), html);
  writeGeneratedFile(path.join(publicOutDir, `${pair.slug}.html`), html);
}

const indexHtml = comparisonIndexHtml(pairs);
writeGeneratedFile(path.join(root, "oyuncu-karsilastirmalari.html"), indexHtml);
writeGeneratedFile(path.join(root, "public", "oyuncu-karsilastirmalari.html"), indexHtml);

const freshness = createFreshnessTracker(root);

for (const sitemapPath of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) {
  if (!fs.existsSync(sitemapPath)) continue;
  const current = fs.readFileSync(sitemapPath, "utf8");
  const moduleLocPath = path.join(root, "data", "comparison-module", "published-locs.json");
  const moduleLocs = new Set(fs.existsSync(moduleLocPath) ? JSON.parse(fs.readFileSync(moduleLocPath, "utf8")) : []);
  const retained = (current.match(URL_ENTRY_RE) || [])
    .filter((entry) => {
      if (!entry.includes(`${domain}/karsilastirma/`)) return true;
      const loc = (entry.match(/<loc>([^<]+)<\/loc>/) || [])[1];
      return moduleLocs.has(loc);
    });
  // Tarih sabit yazılıyordu (2026-07-13) ve karşılaştırma sayfaları
  // güncellenmesine rağmen hiç ilerlemiyordu; gerekçe lib/sitemapFreshness.mjs.
  const entries = pairs.map((pair) => {
    const file = `karsilastirma/${pair.slug}.html`;
    const lastmod = freshness.lastmodForFile(file, path.join(root, file));
    return `  <url>\n    <loc>${domain}/${file}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.65</priority>\n  </url>`;
  });
  const content = wrapUrlset(retained.concat(entries));
  writeGeneratedFile(sitemapPath, content);
}

freshness.save();

console.log(`Generated ${pairs.length} static player comparison pages and index`);
