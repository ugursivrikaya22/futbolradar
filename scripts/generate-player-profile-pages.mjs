import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { getPlayers } = require("../services/playerService.js");
const players = getPlayers(JSON.parse(fs.readFileSync(path.join(root, "data", "players.json"), "utf8")));
const outDir = path.join(root, "oyuncular");
const publicOutDir = path.join(root, "public", "oyuncular");

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

function playerDescription(player) {
  const team = player.currentTeam || player.team || "Takım bilgisi yakında";
  return `${player.name}; güncel takım ${team}, mevki ${player.position}. Transfer geçmişi, overall rating ${player.overallRating || player.aiRating || player.rating}, potansiyel ${player.potentialRating || "yakında"} ve radar metrikleriyle FutbolRadar'da analiz edilir.`;
}

function playerCurrentTeam(player) {
  return player.currentTeam || player.team || "Takim bilgisi yakinda";
}

function playerRating(player) {
  return Number(player.overallRating || player.aiRating || player.rating || 0);
}

function playerPositionGroup(player) {
  const source = `${player.positionGroup || ""} ${player.position || ""}`.toLocaleLowerCase("tr-TR");

  if (source.includes("kaleci") || source.includes("goal")) return "kaleci";
  if (source.includes("def") || source.includes("stoper") || source.includes("bek") || source.includes("savun")) return "defans";
  if (source.includes("orta") || source.includes("mid")) return "orta saha";
  if (source.includes("wing") || source.includes("kanat") || source.includes("forvet") || source.includes("santrfor") || source.includes("striker")) return "forvet";
  return "diger";
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

function staticCompareLinks(player) {
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
  const links = uniqueCompareCandidates(baseLinks.concat(fallbackLinks)).slice(0, 4);

  return links.map((item) => {
    const href = `../oyuncu-karsilastir.html?players=${encodeURIComponent(player.id)},${encodeURIComponent(item.player.id)}`;
    return `<a class="static-profile-link-card" href="${escapeHtml(href)}"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(player.name)} vs ${escapeHtml(item.player.name)}</strong><em>${escapeHtml(item.note)}</em></a>`;
  }).join("\n        ");
}

function relatedLinks(currentId) {
  const links = [
    ["Forvetler", "./forvetler.html"],
    ["Kaleciler", "./kaleciler.html"],
    ["Defanslar", "./defanslar.html"],
    ["Orta sahalar", "./orta-sahalar.html"],
    ["Genç yetenekler", "./genc-yetenekler.html"],
    ["En iyi oyuncular", "./en-iyi-oyuncular.html"]
  ];

  return links
    .concat(players.filter((player) => player.id !== currentId).slice(0, 3).map((player) => [player.name, `./${player.id}.html`]))
    .map(([label, href]) => `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`)
    .join("\n        ");
}

function pageHtml(player) {
  const team = player.currentTeam || player.team || "Takım bilgisi yakında";
  const age = player.computedAge || player.age || "Yaş yakında";
  const title = `${player.name} Oyuncu Profili | ${team} | FutbolRadar`;
  const description = playerDescription(player);
  const canonical = `https://www.futbolradar.com/oyuncular/${player.id}.html`;
  const overall = player.overallRating || player.aiRating || player.rating || "-";

  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${canonical}" />
    <meta name="robots" content="index,follow" />
    <meta property="og:type" content="profile" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="https://www.futbolradar.com/assets/og-image.svg" />
    <meta property="og:image:type" content="image/svg+xml" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="https://www.futbolradar.com/assets/og-image.svg" />
    <script type="application/ld+json">
      ${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Person",
        name: player.name,
        nationality: player.nationality,
        height: player.height,
        memberOf: {
          "@type": "SportsTeam",
          name: team,
          sport: "Football"
        },
        jobTitle: player.position,
        url: canonical,
        description: stripTags(description)
      }, null, 8)}
    </script>
    <link rel="icon" href="../favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="../site.webmanifest" />
    <link rel="stylesheet" href="../page.css" />
  </head>
  <body class="subpage">
    <header class="topbar">
      <nav class="container nav" aria-label="Ana menü">
        <a class="brand" href="../index.html" aria-label="FutbolRadar ana sayfa"><span class="brand-mark">FR</span><span>FutbolRadar</span></a>
        <button class="nav-toggle" type="button" aria-label="Menüyü aç" aria-expanded="false" aria-controls="primary-menu"><span class="nav-toggle-bar"></span><span class="nav-toggle-bar"></span><span class="nav-toggle-bar"></span></button>
        <div class="nav-menu" id="primary-menu">
          <div class="nav-links"><a href="../bugunun-maclari.html">Bugünkü Maçlar</a><a href="../canli-skor.html">Canlı Skor</a><a href="../puan-durumu.html">Puan Durumu</a><a href="../takimlar.html">Takımlar</a><a href="../oyuncu-radari.html">Oyuncu Radar</a><a href="../momentum.html">Momentum</a></div>
          <a class="cta" href="../index.html#radar-sinyalleri">Radar Sinyalleri</a>
        </div>
      </nav>
    </header>
    <main class="container">
      <nav class="breadcrumb" aria-label="Sayfa yolu">
        <a href="../index.html">Ana Sayfa</a>
        <span>/</span>
        <a href="../oyuncu-radari.html">Oyuncu Radar</a>
        <span>/</span>
        <span>${escapeHtml(player.name)}</span>
      </nav>
      <section class="hero">
        <div class="hero-row">
          <div>
            <span class="eyebrow">Güncel takım: ${escapeHtml(team)}</span>
            <h1>${escapeHtml(player.name)}</h1>
            <p class="lead">${escapeHtml(player.summary || description)}</p>
          </div>
          <span class="hero-meta">Overall ${escapeHtml(overall)} · ${escapeHtml(player.position)} · ${escapeHtml(age)}</span>
        </div>
      </section>
      <section class="player-profile-shell" data-api-target="player-detail" data-player-id="${escapeHtml(player.id)}">
        <article class="data-empty" data-card="empty-state">
          <strong>${escapeHtml(player.name)} profili hazırlanıyor</strong>
          <span>Oyuncu performans kartı yükleniyor.</span>
        </article>
      </section>
      <section class="static-profile-links" aria-label="Statik oyuncu karsilastirma baglantilari">
        <div class="profile-section-head"><h2>Hazir Kiyas Linkleri</h2><span>Arama motorlari ve hizli gezinme icin</span></div>
        <div class="static-profile-link-grid">
        ${staticCompareLinks(player)}
        </div>
      </section>
      <section class="popular-links" aria-label="İlgili oyuncu bağlantıları">
        <span>İlgili oyuncu radarları</span>
        ${relatedLinks(player.id)}
      </section>
    </main>
    <footer class="footer"><div class="container footer-links">FutbolRadar · Oyuncu profilleri · <a href="../hakkinda.html">Hakkında</a> · <a href="../veri-notu.html">Veri Notu</a> · <a href="../iletisim.html">İletişim</a> · <a href="../gizlilik.html">Gizlilik</a> · <a href="../kullanim-sartlari.html">Kullanım Şartları</a></div></footer>
    <script src="../site.js" defer></script>
    <script src="../app.js" defer></script>
  </body>
</html>
`;
}

function aliasHtml(player, alias) {
  const canonical = `https://www.futbolradar.com/oyuncular/${player.id}.html`;
  const title = `${player.name} Oyuncu Profili | FutbolRadar`;
  const description = `${player.name} oyuncu profili FutbolRadar kanonik sayfasına yönlendirilir.`;

  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${canonical}" />
    <meta name="robots" content="noindex,follow" />
    <meta http-equiv="refresh" content="0; url=./${escapeHtml(player.id)}.html" />
    <meta property="og:type" content="profile" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="https://www.futbolradar.com/assets/og-image.svg" />
    <meta property="og:image:type" content="image/svg+xml" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="https://www.futbolradar.com/assets/og-image.svg" />
    <link rel="icon" href="../favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="../site.webmanifest" />
    <link rel="stylesheet" href="../page.css" />
    <script>window.location.replace("./${escapeHtml(player.id)}.html");</script>
  </head>
  <body class="subpage">
    <main class="container">
      <section class="hero alias-redirect">
        <div class="hero-row">
          <div>
            <span class="eyebrow">Oyuncu profili taşındı</span>
            <h1>${escapeHtml(player.name)}</h1>
            <p class="lead">Bu adres güncellendi. FutbolRadar kanonik oyuncu profiline yönlendiriliyorsun.</p>
            <a class="button primary" href="./${escapeHtml(player.id)}.html">Oyuncu profilini aç</a>
          </div>
        </div>
      </section>
    </main>
  </body>
</html>
`;
}

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(publicOutDir, { recursive: true });

for (const player of players) {
  const html = pageHtml(player);
  fs.writeFileSync(path.join(outDir, `${player.id}.html`), html, "utf8");
  fs.writeFileSync(path.join(publicOutDir, `${player.id}.html`), html, "utf8");

  for (const alias of player.aliases || []) {
    const html = aliasHtml(player, alias);
    fs.writeFileSync(path.join(outDir, `${alias}.html`), html, "utf8");
    fs.writeFileSync(path.join(publicOutDir, `${alias}.html`), html, "utf8");
  }
}

console.log(`Generated ${players.length} player profile pages`);
