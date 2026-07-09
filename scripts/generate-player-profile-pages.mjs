import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const players = JSON.parse(fs.readFileSync(path.join(root, "data", "players.json"), "utf8"));
const outDir = path.join(root, "oyuncular");

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
  return `${player.name}; ${player.team} ${player.position} profili. Overall rating ${player.overallRating || player.aiRating || player.rating}, potansiyel ${player.potentialRating || "yakında"}, teknik, fiziksel, mental ve radar metrikleriyle FutbolRadar'da analiz edilir.`;
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
  const title = `${player.name} | ${player.team} ${player.position} Oyuncu Profili | FutbolRadar`;
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
          name: player.team,
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
      <section class="hero">
        <div class="hero-row">
          <div>
            <span class="eyebrow">${escapeHtml(player.team)} oyuncu profili</span>
            <h1>${escapeHtml(player.name)}</h1>
            <p class="lead">${escapeHtml(player.summary || description)}</p>
          </div>
          <span class="hero-meta">Overall ${escapeHtml(overall)} · ${escapeHtml(player.position)} · ${escapeHtml(player.age || "Yaş yakında")}</span>
        </div>
      </section>
      <section class="player-profile-shell" data-api-target="player-detail" data-player-id="${escapeHtml(player.id)}">
        <article class="data-empty" data-card="empty-state">
          <strong>${escapeHtml(player.name)} profili hazırlanıyor</strong>
          <span>Oyuncu performans kartı yükleniyor.</span>
        </article>
      </section>
      <section class="popular-links" aria-label="İlgili oyuncu bağlantıları">
        <span>İlgili oyuncu radarları</span>
        ${relatedLinks(player.id)}
      </section>
    </main>
    <footer class="footer"><div class="container">FutbolRadar · ${escapeHtml(player.name)}</div></footer>
    <script src="../site.js" defer></script>
    <script src="../app.js" defer></script>
  </body>
</html>
`;
}

fs.mkdirSync(outDir, { recursive: true });

for (const player of players) {
  fs.writeFileSync(path.join(outDir, `${player.id}.html`), pageHtml(player));
}

console.log(`Generated ${players.length} player profile pages`);
