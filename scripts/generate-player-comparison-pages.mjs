import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { siteHeader, siteFooter } from "./lib/layout.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";
import { createFreshnessTracker } from "./lib/sitemapFreshness.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { getPlayers, formatMarketValueEur } = require("../services/playerService.js");
const { publicPlayerView } = require("../services/cardCredibility.js");
const players = getPlayers(JSON.parse(fs.readFileSync(path.join(root, "data", "players.json"), "utf8")));
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

function playerCurrentTeam(player) {
  return player.currentTeam || player.team || "Takım bilgisi yakında";
}

function playerNeedsTransferReview(player) {
  return ["transfer_needs_monitoring", "manual-review"].includes(String(player.dataStatus || ""));
}

function playerTeamDisplay(player) {
  const team = playerCurrentTeam(player);
  return playerNeedsTransferReview(player) ? `${team} (takipte)` : team;
}

function playerRating(player) {
  return Number(player.overallRating || player.aiRating || player.rating || 0);
}

function playerMarket(player) {
  return player.marketValue || formatMarketValueEur(player.marketValueEur) || "Piyasa değeri yakında";
}

function playerPositionGroup(player) {
  const source = `${player.positionGroup || ""} ${player.position || ""}`.toLocaleLowerCase("tr-TR");

  if (source.includes("kaleci") || source.includes("goal")) return "kaleci";
  if (source.includes("def") || source.includes("stoper") || source.includes("bek") || source.includes("savun")) return "defans";
  if (source.includes("orta") || source.includes("mid")) return "orta saha";
  if (source.includes("wing") || source.includes("kanat") || source.includes("forvet") || source.includes("santrfor") || source.includes("striker")) return "forvet";
  return "diger";
}

function comparisonSlug(leftId, rightId) {
  return [leftId, rightId].sort().join("-vs-");
}

function comparePeerScore(primary, candidate) {
  if (!primary || !candidate || primary.id === candidate.id) return -1;

  const sameRole = playerPositionGroup(primary) === playerPositionGroup(candidate) ? 44 : 0;
  const sameLeague = primary.league && candidate.league && primary.league === candidate.league ? 16 : 0;
  const differentTeam = playerCurrentTeam(primary) !== playerCurrentTeam(candidate) ? 10 : 0;
  const ratingCloseness = Math.max(0, 26 - Math.abs(playerRating(primary) - playerRating(candidate)));
  const marketDelta = Math.abs(Number(primary.marketValueEur || 0) - Number(candidate.marketValueEur || 0)) / 1000000;
  const marketCloseness = Math.max(0, 12 - marketDelta / 3);

  return sameRole + sameLeague + differentTeam + ratingCloseness + marketCloseness;
}

function uniqueCompareCandidates(list) {
  const used = new Set();
  return list.filter((item) => {
    if (!item || !item.player || used.has(item.player.id)) return false;
    used.add(item.player.id);
    return true;
  });
}

function profileCompareCandidates(player) {
  const candidates = players.filter((candidate) => candidate.id !== player.id);
  const bestPeer = candidates.slice().sort((a, b) => comparePeerScore(player, b) - comparePeerScore(player, a))[0];
  const sameRole = candidates
    .filter((candidate) => playerPositionGroup(candidate) === playerPositionGroup(player))
    .sort((a, b) => playerRating(b) - playerRating(a))[0];
  const closeRating = candidates
    .slice()
    .sort((a, b) => Math.abs(playerRating(player) - playerRating(a)) - Math.abs(playerRating(player) - playerRating(b)))[0];
  const transferRead = candidates
    .filter((candidate) => Array.isArray(candidate.transferHistory) && candidate.transferHistory.length)
    .sort((a, b) => Number(b.marketValueEur || 0) - Number(a.marketValueEur || 0))[0];

  const baseLinks = uniqueCompareCandidates([
    { label: "Akilli eslesme", player: bestPeer, note: "Rol, rating ve piyasa yakinligi" },
    { label: "Aynı rol kıyası", player: sameRole, note: `${playerPositionGroup(player)} profili` },
    { label: "Rating sinavi", player: closeRating, note: "Overall farkini oku" },
    { label: "Transfer okuma", player: transferRead, note: "Güncel takım ve piyasa değeri" }
  ]);
  const fallbackLinks = candidates
    .slice()
    .sort((a, b) => playerRating(b) - playerRating(a))
    .map((candidate) => ({ label: "Radar alternatifi", player: candidate, note: "Profil trafiği ve kıyas akışı" }));

  return uniqueCompareCandidates(baseLinks.concat(fallbackLinks)).slice(0, 4);
}

function addPair(map, left, right, context) {
  if (!left || !right || left.id === right.id) {
    return;
  }

  const slug = comparisonSlug(left.id, right.id);
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

function buildPairs() {
  const map = new Map();
  const editorialPairs = [
    ["mauro-icardi", "edin-dzeko", "Super Lig gol tehdidi"],
    ["kerem-akturkoglu", "semih-kilicsoy", "Yükselen yerli hücum profili"],
    ["ugurcan-cakir", "abdulkerim-bardakci", "Savunma güveni"],
    ["sebastian-szymanski", "gedson-fernandes", "Orta saha etki kıyaslaması"]
  ];

  for (const [leftId, rightId, reason] of editorialPairs) {
    addPair(
      map,
      players.find((player) => player.id === leftId),
      players.find((player) => player.id === rightId),
      reason
    );
  }

  for (const player of players) {
    for (const item of profileCompareCandidates(player)) {
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
  const roleLine = `${playerPositionGroup(left)} ve ${playerPositionGroup(right)} rolleri birlikte okunmalı; tek skor karar için yeterli değil.`;

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
    `${leader.name} overall rating tarafinda onde gorunuyor.`,
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

  const rows = verified && verifiedRows.length
    ? verifiedRows.join("\n      ")
    : `<div><dt>Veri durumu</dt><dd>Doğrulanmış kayıt bekleniyor</dd></div>`;

  return `<article class="comparison-mini-card" data-player-verified="${verified ? "true" : "false"}">
    <span>${escapeHtml(player.position || "Mevki yakinda")}</span>
    <h2>${escapeHtml(player.name)}</h2>
    <dl>
      ${rows}
    </dl>
    <a href="../oyuncular/${escapeHtml(player.id)}.html">Oyuncu profilini aç</a>
  </article>`;
}

/** İki oyuncudan biri bile doğrulanmamışsa kart tek genel cümleye düşüyor
 * (bkz. comparisonInsight) — sayfa isim + boş kutudan ibaret kalıyor. */
function pairIsIndexable(pair) {
  return publicPlayerView(pair.left).verified && publicPlayerView(pair.right).verified;
}

function pageHtml(pair) {
  const { left, right, slug, reasons } = pair;
  const title = `${left.name} vs ${right.name} | Oyuncu Karşılaştırması | FutbolRadar`;
  const description = `${left.name} ve ${right.name} oyuncu karşılaştırması; AI rating, form, gol tehdidi, yaratıcılık, pres gücü, piyasa değeri ve transfer bilgileriyle FutbolRadar'da analiz edilir.`;
  const canonical = `${domain}/karsilastirma/${slug}.html`;
  const insights = comparisonInsight(left, right);
  const indexable = pairIsIndexable(pair);

  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${canonical}" />
    <meta name="robots" content="${indexable ? "index,follow" : "noindex,follow"}" />
    <meta property="og:type" content="article" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${domain}/assets/og-image.svg" />
    <meta property="og:image:type" content="image/svg+xml" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${domain}/assets/og-image.svg" />
    <script type="application/ld+json">
      ${JSON.stringify({
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "Article",
            headline: title,
            description: stripTags(description),
            mainEntityOfPage: canonical,
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
          }
        ]
      }, null, 8)}
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
          <p>${escapeHtml(reasons.slice(0, 3).join(" - ") || "Rol, form ve rating yakinligi")}</p>
        </article>
        ${playerMiniCard(right)}
      </section>

      <section class="compare-grid" data-api-target="player-compare" data-compare-seed="${escapeHtml(left.id)},${escapeHtml(right.id)}">
        <article class="data-empty" data-card="empty-state">
          <strong>Karşılaştırma yükleniyor</strong>
          <span>Oyuncu radar metrikleri hazırlanıyor.</span>
        </article>
      </section>

      <section class="comparison-seo-links" aria-label="İlgili karşılaştırma bağlantıları">
        <span>Devam et</span>
        <a href="../oyuncular/${escapeHtml(left.id)}.html">${escapeHtml(left.name)} profili</a>
        <a href="../oyuncular/${escapeHtml(right.id)}.html">${escapeHtml(right.name)} profili</a>
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
  const ratingDelta = Math.abs(playerRating(left) - playerRating(right));
  const roleLabel = playerPositionGroup(left) === playerPositionGroup(right)
    ? `${playerPositionGroup(left)} eslesmesi`
    : `${playerPositionGroup(left)} / ${playerPositionGroup(right)}`;

  return `<a class="comparison-index-card" href="./karsilastirma/${escapeHtml(slug)}.html">
    <span>${escapeHtml(roleLabel)}</span>
    <strong>${escapeHtml(left.name)} vs ${escapeHtml(right.name)}</strong>
    <p>${escapeHtml((reasons && reasons[0]) || "Rating, form ve rol etkisi")}</p>
    <em>Rating farki ${escapeHtml(ratingDelta.toFixed(1))}</em>
  </a>`;
}

function comparisonIndexHtml(pairs) {
  const title = "Oyuncu Karşılaştırmaları | Statik Kıyaslar | FutbolRadar";
  const description = "FutbolRadar oyuncu karşılaştırmaları; Süper Lig oyuncularını AI rating, form, rol etkisi, piyasa değeri ve transfer sinyalleriyle yan yana inceler.";
  const canonical = `${domain}/oyuncu-karsilastirmalari.html`;
  const topPairs = pairs.slice(0, 20);

  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${canonical}" />
    <meta name="robots" content="index,follow" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${domain}/assets/og-image.svg" />
    <meta property="og:image:type" content="image/svg+xml" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${domain}/assets/og-image.svg" />
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
        <a href="./transfer-radari.html">Transfer Radar</a>
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
for (const directory of [outDir, publicOutDir]) {
  for (const file of fs.readdirSync(directory)) {
    if (file.endsWith(".html") && !expectedFiles.has(file)) {
      fs.unlinkSync(path.join(directory, file));
    }
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
  const retained = (current.match(URL_ENTRY_RE) || [])
    .filter((entry) => !entry.includes(`${domain}/karsilastirma/`));
  // Tarih sabit yazılıyordu (2026-07-13) ve karşılaştırma sayfaları
  // güncellenmesine rağmen hiç ilerlemiyordu; gerekçe lib/sitemapFreshness.mjs.
  const entries = pairs.filter(pairIsIndexable).map((pair) => {
    const file = `karsilastirma/${pair.slug}.html`;
    const lastmod = freshness.lastmodForFile(file, path.join(root, file));
    return `  <url>\n    <loc>${domain}/${file}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.65</priority>\n  </url>`;
  });
  const content = wrapUrlset(retained.concat(entries));
  writeGeneratedFile(sitemapPath, content);
}

freshness.save();

console.log(`Generated ${pairs.length} static player comparison pages and index`);
