import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { getPlayers, formatMarketValueEur } = require("../services/playerService.js");
const players = getPlayers(JSON.parse(fs.readFileSync(path.join(root, "data", "players.json"), "utf8")));
const outDir = path.join(root, "karsilastirma");
const publicOutDir = path.join(root, "public", "karsilastirma");
const domain = "https://www.futbolradar.com";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripTags(value) {
  return String(value ?? "").replace(/<[^>]*>/g, "").trim();
}

function playerCurrentTeam(player) {
  return player.currentTeam || player.team || "Takim bilgisi yakinda";
}

function playerRating(player) {
  return Number(player.overallRating || player.aiRating || player.rating || 0);
}

function playerMarket(player) {
  return player.marketValue || formatMarketValueEur(player.marketValueEur) || "Piyasa degeri yakinda";
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
    { label: "Ayni rol kiyas", player: sameRole, note: `${playerPositionGroup(player)} profili` },
    { label: "Rating sinavi", player: closeRating, note: "Overall farkini oku" },
    { label: "Transfer okuma", player: transferRead, note: "Guncel takim ve piyasa degeri" }
  ]);
  const fallbackLinks = candidates
    .slice()
    .sort((a, b) => playerRating(b) - playerRating(a))
    .map((candidate) => ({ label: "Radar alternatifi", player: candidate, note: "Profil trafigi ve kiyas akisi" }));

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
    ["kerem-akturkoglu", "semih-kilicsoy", "Yukselen yerli hucum profili"],
    ["ugurcan-cakir", "abdulkerim-bardakci", "Savunma guveni"],
    ["sebastian-szymanski", "gedson-fernandes", "Orta saha etki kiyaslamasi"]
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

  return Array.from(map.values()).slice(0, 32);
}

function comparisonInsight(left, right) {
  const ratingDiff = playerRating(left) - playerRating(right);
  const marketDiff = Number(left.marketValueEur || 0) - Number(right.marketValueEur || 0);
  const leader = ratingDiff >= 0 ? left : right;
  const marketLeader = marketDiff >= 0 ? left : right;

  return [
    `${leader.name} overall rating tarafinda onde gorunuyor.`,
    `${marketLeader.name} piyasa degeri okumasinda daha guclu sinyal veriyor.`,
    `${playerPositionGroup(left)} ve ${playerPositionGroup(right)} rolleri birlikte okunmali; tek skor karar icin yeterli degil.`
  ];
}

function playerMiniCard(player) {
  return `<article class="comparison-mini-card">
    <span>${escapeHtml(player.position || "Mevki yakinda")}</span>
    <h2>${escapeHtml(player.name)}</h2>
    <dl>
      <div><dt>Takim</dt><dd>${escapeHtml(playerCurrentTeam(player))}</dd></div>
      <div><dt>Lig</dt><dd>${escapeHtml(player.league || "Lig yakinda")}</dd></div>
      <div><dt>Overall</dt><dd>${escapeHtml(playerRating(player) || "Yakinda")}</dd></div>
      <div><dt>Piyasa</dt><dd>${escapeHtml(playerMarket(player))}</dd></div>
    </dl>
    <a href="../oyuncular/${escapeHtml(player.id)}.html">Oyuncu profilini ac</a>
  </article>`;
}

function pageHtml(pair) {
  const { left, right, slug, reasons } = pair;
  const title = `${left.name} vs ${right.name} | Oyuncu Karsilastirmasi | FutbolRadar`;
  const description = `${left.name} ve ${right.name} oyuncu karsilastirmasi; AI rating, form, gol tehdidi, yaraticilik, pres gucu, piyasa degeri ve transfer bilgileriyle FutbolRadar'da analiz edilir.`;
  const canonical = `${domain}/karsilastirma/${slug}.html`;
  const insights = comparisonInsight(left, right);

  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${canonical}" />
    <meta name="robots" content="index,follow" />
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
        "@type": "Article",
        headline: title,
        description: stripTags(description),
        mainEntityOfPage: canonical,
        publisher: {
          "@type": "Organization",
          name: "FutbolRadar"
        },
        about: [left.name, right.name]
      }, null, 8)}
    </script>
    <link rel="icon" href="../favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="../site.webmanifest" />
    <link rel="stylesheet" href="../page.css" />
  </head>
  <body class="subpage">
    <header class="topbar">
      <nav class="container nav" aria-label="Ana menu">
        <a class="brand" href="../index.html" aria-label="FutbolRadar ana sayfa"><span class="brand-mark">FR</span><span>FutbolRadar</span></a>
        <button class="nav-toggle" type="button" aria-label="Menuyu ac" aria-expanded="false" aria-controls="primary-menu"><span class="nav-toggle-bar"></span><span class="nav-toggle-bar"></span><span class="nav-toggle-bar"></span></button>
        <div class="nav-menu" id="primary-menu">
          <div class="nav-links"><a href="../bugunun-maclari.html">Bugunku Maclar</a><a href="../canli-skor.html">Canli Skor</a><a href="../puan-durumu.html">Puan Durumu</a><a href="../takimlar.html">Takimlar</a><a href="../oyuncu-radari.html">Oyuncu Radar</a><a href="../momentum.html">Momentum</a></div>
          <a class="cta" href="../index.html#radar-sinyalleri">Radar Sinyalleri</a>
        </div>
      </nav>
    </header>
    <main class="container compare-seo-page">
      <nav class="breadcrumb" aria-label="Sayfa yolu">
        <a href="../index.html">Ana Sayfa</a>
        <span>/</span>
        <a href="../oyuncu-karsilastir.html">Oyuncu Karsilastirma</a>
        <span>/</span>
        <span>${escapeHtml(left.name)} vs ${escapeHtml(right.name)}</span>
      </nav>
      <section class="hero comparison-hero">
        <div class="hero-row">
          <div>
            <span class="eyebrow">Oyuncu karsilastirma radari</span>
            <h1>${escapeHtml(left.name)} vs ${escapeHtml(right.name)}</h1>
            <p class="lead">${escapeHtml(description)}</p>
          </div>
          <span class="hero-meta">${escapeHtml(playerCurrentTeam(left))} - ${escapeHtml(playerCurrentTeam(right))}</span>
        </div>
      </section>

      <section class="static-comparison-summary" aria-label="Statik karsilastirma ozeti">
        ${playerMiniCard(left)}
        <article class="comparison-mini-card comparison-mini-card-accent">
          <span>Radar Notu</span>
          <h2>Kiyas Ozeti</h2>
          <ul>
            ${insights.map((item) => `<li>${escapeHtml(item)}</li>`).join("\n            ")}
          </ul>
          <p>${escapeHtml(reasons.slice(0, 3).join(" - ") || "Rol, form ve rating yakinligi")}</p>
        </article>
        ${playerMiniCard(right)}
      </section>

      <section class="compare-grid" data-api-target="player-compare" data-compare-seed="${escapeHtml(left.id)},${escapeHtml(right.id)}">
        <article class="data-empty" data-card="empty-state">
          <strong>Karsilastirma yukleniyor</strong>
          <span>Oyuncu radar metrikleri hazirlaniyor.</span>
        </article>
      </section>

      <section class="comparison-seo-links" aria-label="Ilgili karsilastirma linkleri">
        <span>Devam et</span>
        <a href="../oyuncular/${escapeHtml(left.id)}.html">${escapeHtml(left.name)} profili</a>
        <a href="../oyuncular/${escapeHtml(right.id)}.html">${escapeHtml(right.name)} profili</a>
        <a href="../oyuncu-radari.html">Oyuncu Radar</a>
        <a href="../oyuncu-karsilastir.html?players=${escapeHtml(left.id)},${escapeHtml(right.id)}">Interaktif kiyas</a>
      </section>
    </main>
    <footer class="footer"><div class="container footer-links">FutbolRadar - Oyuncu karsilastirmalari - <a href="../hakkinda.html">Hakkinda</a> - <a href="../veri-notu.html">Veri Notu</a> - <a href="../iletisim.html">Iletisim</a></div></footer>
    <script src="../site.js" defer></script>
    <script src="../app.js" defer></script>
  </body>
</html>
`;
}

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(publicOutDir, { recursive: true });

const pairs = buildPairs();
for (const pair of pairs) {
  const html = pageHtml(pair);
  fs.writeFileSync(path.join(outDir, `${pair.slug}.html`), html, "utf8");
  fs.writeFileSync(path.join(publicOutDir, `${pair.slug}.html`), html, "utf8");
}

console.log(`Generated ${pairs.length} static player comparison pages`);
