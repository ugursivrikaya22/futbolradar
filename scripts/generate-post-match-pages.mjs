import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const domain = "https://www.futbolradar.com";
const matches = JSON.parse(fs.readFileSync(path.join(root, "data", "matches.json"), "utf8"));
const completedMatches = matches.filter((match) => match.status === "FINISHED" && match.analysisPage);

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(value, options = {}) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Tarih doğrulanamadı";
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "numeric",
    month: "long",
    year: "numeric",
    ...options
  }).format(date);
}

function metricValue(value, metric) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "Veri yok";
  const decimals = Number.isInteger(metric.decimals) ? metric.decimals : Number.isInteger(number) ? 0 : 2;
  return `${number.toFixed(decimals).replace(".", ",")}${metric.unit || ""}`;
}

function statsHtml(match) {
  const categories = [...new Set(match.statistics.map((item) => item.category || "Genel"))];
  return categories.map((category) => {
    const rows = match.statistics.filter((item) => (item.category || "Genel") === category);
    return `<section class="post-match-stat-group" aria-labelledby="stats-${escapeHtml(category.toLowerCase())}">
      <h3 id="stats-${escapeHtml(category.toLowerCase())}">${escapeHtml(category)}</h3>
      <div class="post-match-stat-list">${rows.map((metric) => {
        const home = Number(metric.home) || 0;
        const away = Number(metric.away) || 0;
        const total = home + away;
        const homeWidth = total > 0 ? Math.round((home / total) * 100) : 50;
        const awayWidth = total > 0 ? 100 - homeWidth : 50;
        return `<article class="post-match-stat-row">
          <b>${escapeHtml(metricValue(metric.home, metric))}</b>
          <div><span>${escapeHtml(metric.type)}</span><i aria-hidden="true"><em style="--value:${homeWidth}%"></em><em style="--value:${awayWidth}%"></em></i></div>
          <b>${escapeHtml(metricValue(metric.away, metric))}</b>
        </article>`;
      }).join("")}</div>
    </section>`;
  }).join("");
}

function lineupHtml(match) {
  return match.lineups.map((lineup) => `<article class="post-match-lineup-card">
    <header><h3>${escapeHtml(lineup.team)}</h3><span>${escapeHtml(lineup.formation)}</span></header>
    <ol>${lineup.players.map((player) => `<li>${escapeHtml(player)}</li>`).join("")}</ol>
  </article>`).join("");
}

function eventsHtml(match) {
  return match.events.map((event) => `<article class="post-match-event${event.type === "Gol" ? " is-goal" : ""}">
    <time>${escapeHtml(event.time)}</time><div><span>${escapeHtml(event.type)} · ${escapeHtml(event.team && event.team.name)}</span><p>${escapeHtml(event.detail)}</p></div>
  </article>`).join("");
}

function substitutionsHtml(match) {
  return match.substitutions.map((item) => `<article class="post-match-sub-row">
    <time>${escapeHtml(item.time)}</time><div><span>${escapeHtml(item.team)}</span><strong>${escapeHtml(item.in)}</strong><small>${escapeHtml(item.out)} yerine</small></div>
  </article>`).join("");
}

function pageHtml(match) {
  const url = `${domain}/${match.analysisPage}`;
  const title = `Fenerbahçe 1-0 Górnik Zabrze Maç Analizi ve İstatistikleri | FutbolRadar`;
  const description = "Fenerbahçe 1-0 Górnik Zabrze maç analizi: xG, şut, pas, korner, ikili mücadele, kadrolar, değişiklikler ve kritik anlar.";
  const score = match.score || {};
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SportsEvent",
        name: `${match.homeTeam} - ${match.awayTeam}`,
        url,
        startDate: match.kickoff,
        eventStatus: "https://schema.org/EventCompleted",
        sport: "Football",
        location: { "@type": "StadiumOrArena", name: match.venue, address: match.city },
        homeTeam: { "@type": "SportsTeam", name: match.homeTeam },
        awayTeam: { "@type": "SportsTeam", name: match.awayTeam },
        description: match.summary
      },
      {
        "@type": "Article",
        headline: title,
        description,
        datePublished: match.lastVerifiedAt,
        dateModified: match.lastVerifiedAt,
        mainEntityOfPage: url,
        publisher: { "@type": "Organization", name: "FutbolRadar", url: domain }
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Ana Sayfa", item: `${domain}/` },
          { "@type": "ListItem", position: 2, name: "Maç Merkezi", item: `${domain}/mac-merkezi.html` },
          { "@type": "ListItem", position: 3, name: `${match.homeTeam} - ${match.awayTeam}`, item: url }
        ]
      }
    ]
  };

  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${url}" />
    <meta name="robots" content="index,follow" />
    <meta property="og:type" content="article" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:url" content="${url}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${domain}/assets/og-image.svg" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${domain}/assets/og-image.svg" />
    <script type="application/ld+json">${JSON.stringify(schema)}</script>
    <link rel="icon" href="./favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="./site.webmanifest" />
    <link rel="stylesheet" href="./page.css" />
  </head>
  <body class="subpage post-match-page">
    <header class="topbar"><nav class="container nav" aria-label="Ana menü"><a class="brand" href="./index.html" aria-label="FutbolRadar ana sayfa"><span class="brand-mark">FR</span><span>FutbolRadar</span></a><button class="nav-toggle" type="button" aria-label="Menüyü aç" aria-expanded="false" aria-controls="primary-menu"><span class="nav-toggle-bar"></span><span class="nav-toggle-bar"></span><span class="nav-toggle-bar"></span></button><div class="nav-menu" id="primary-menu"><div class="nav-links"><a href="./bugunun-maclari.html">Bugünkü Maçlar</a><a href="./canli-skor.html">Canlı Skor</a><a href="./puan-durumu.html">Puan Durumu</a><a href="./takimlar.html">Takımlar</a><a href="./oyuncu-radari.html">Oyuncu Radarı</a><a href="./momentum.html">Momentum</a></div><a class="cta" href="./index.html#radar-sinyalleri">Radar Sinyalleri</a></div></nav></header>
    <main class="container">
      <nav class="breadcrumb" aria-label="Sayfa yolu"><a href="./index.html">Ana Sayfa</a><span>/</span><a href="./mac-merkezi.html">Maç Merkezi</a><span>/</span><span>Fenerbahçe - Górnik Zabrze</span></nav>
      <section class="post-match-hero">
        <div class="post-match-heading"><span class="eyebrow">${escapeHtml(match.league)} · ${escapeHtml(match.stage)}</span><h1>Fenerbahçe - Górnik Zabrze Maç Analizi</h1><p>${escapeHtml(match.analysis.lead)}</p><div class="post-match-meta"><span>${escapeHtml(formatDate(match.kickoff))}</span><span>${escapeHtml(match.venue)}</span><span>Hakem: ${escapeHtml(match.referee)}</span></div></div>
        <div class="post-match-scoreboard" aria-label="Maç sonucu">
          <div><span class="team-monogram">FB</span><strong>${escapeHtml(match.homeTeam)}</strong></div>
          <div class="post-match-score"><span>Maç sonucu</span><b>${escapeHtml(score.home)}<i>-</i>${escapeHtml(score.away)}</b><small>İlk yarı ${escapeHtml(score.halftimeHome)}-${escapeHtml(score.halftimeAway)}</small></div>
          <div><span class="team-monogram away">GZ</span><strong>${escapeHtml(match.awayTeam)}</strong></div>
        </div>
      </section>

      <section class="post-match-kpi-grid" aria-label="Öne çıkan maç istatistikleri">
        <article><span>Topla oynama</span><strong>%79</strong><small>Fenerbahçe</small></article>
        <article><span>xG üstünlüğü</span><strong>1,54</strong><small>0,06'ya karşı</small></article>
        <article><span>Şut</span><strong>15</strong><small>6 isabet</small></article>
        <article><span>Pas isabeti</span><strong>%92</strong><small>701 başarılı pas</small></article>
        <article><span>Direkten dönen</span><strong>2</strong><small>İkinci yarıda</small></article>
      </section>

      <section class="post-match-verdict card"><div><span class="card-kicker">Radar hükmü</span><h2>${escapeHtml(match.analysis.headline)}</h2><p>${escapeHtml(match.analysis.verdict)}</p></div><div class="post-match-verdict-score"><span>Oyun kontrolü</span><strong>Çok yüksek</strong><small>Bitiricilik geliştirmeli</small></div></section>

      <section class="post-match-analysis-grid" aria-label="Taktik analiz">
        <article class="card"><span class="card-kicker">Hücum</span><h2>Üretim hacmi</h2><p>${escapeHtml(match.analysis.attackingRead)}</p></article>
        <article class="card"><span class="card-kicker">Orta saha</span><h2>Ritim kontrolü</h2><p>${escapeHtml(match.analysis.midfieldRead)}</p></article>
        <article class="card"><span class="card-kicker">Savunma</span><h2>Geçiş güvenliği</h2><p>${escapeHtml(match.analysis.defensiveRead)}</p></article>
      </section>

      <section class="post-match-section">
        <div class="section-head"><div class="section-title"><span class="section-kicker">Tam veri tablosu</span><h2>Tüm maç istatistikleri</h2><p>Fenerbahçe ve Górnik Zabrze'nin genel, hücum, pas, mücadele ve savunma verileri.</p></div></div>
        <div class="post-match-team-labels"><strong>${escapeHtml(match.homeTeam)}</strong><span>Karşılaştırma</span><strong>${escapeHtml(match.awayTeam)}</strong></div>
        <div class="post-match-stats-grid">${statsHtml(match)}</div>
      </section>

      <section class="post-match-section">
        <div class="section-head"><div class="section-title"><span class="section-kicker">Maçın hikâyesi</span><h2>Kritik anlar</h2><p>Talisca'nın golü, direkler ve ikinci yarı baskısının dakika dakika özeti.</p></div></div>
        <div class="post-match-story-grid"><div class="post-match-events">${eventsHtml(match)}</div><aside class="post-match-key-points card"><h3>Analiz notları</h3><ul>${match.analysis.keyPoints.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul></aside></div>
      </section>

      <section class="post-match-section">
        <div class="section-head"><div class="section-title"><span class="section-kicker">Kadrolar</span><h2>İlk 11 ve dizilişler</h2><p>Başlangıç kadroları ve maç içindeki oyuncu değişiklikleri.</p></div></div>
        <div class="post-match-lineups">${lineupHtml(match)}</div>
        <div class="post-match-substitutions"><h3>Oyuncu değişiklikleri</h3><div>${substitutionsHtml(match)}</div></div>
      </section>

      <section class="post-match-context-strip" aria-label="Maç künyesi"><div><span>Teknik direktör</span><b>${escapeHtml(match.coaches.home)}</b></div><div><span>Rakip teknik direktör</span><b>${escapeHtml(match.coaches.away)}</b></div><div><span>Son kontrol</span><b>${escapeHtml(formatDate(match.lastVerifiedAt, { hour: "2-digit", minute: "2-digit" }))}</b></div></section>
      <section class="post-match-next-grid"><a href="./gornik-zabrze-fenerbahce-rovans-ne-zaman.html"><span>Rövanş</span><strong>Rövanş ne zaman?</strong><p>29 Temmuz programını ve tur senaryosunu incele.</p></a><a href="./fenerbahce-avrupa-maclari.html"><span>Avrupa fikstürü</span><strong>Fenerbahçe Avrupa maçları</strong><p>Sonuçları, yaklaşan maçları ve tur yolunu takip et.</p></a><a href="./oyuncu-radari.html?team=Fenerbahçe"><span>Oyuncu analizi</span><strong>Fenerbahçe Oyuncu Radarı</strong><p>Kadro içindeki form ve rol sinyallerine geç.</p></a></section>
    </main>
    <footer class="footer"><div class="container footer-links">FutbolRadar · Maç analizi · <a href="./hakkinda.html">Hakkında</a> · <a href="./veri-notu.html">Veri Notu</a> · <a href="./iletisim.html">İletişim</a></div></footer>
    <script src="./site.js" defer></script>
  </body>
</html>`;
}

function upsertSitemap(pages) {
  const sitemapPath = path.join(root, "sitemap.xml");
  if (!fs.existsSync(sitemapPath)) return;
  let xml = fs.readFileSync(sitemapPath, "utf8");
  for (const match of pages) {
    const loc = `${domain}/${match.analysisPage}`;
    const escapedLoc = loc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    xml = xml.replace(new RegExp(`  <url>\\s*<loc>${escapedLoc}<\\/loc>[\\s\\S]*?<\\/url>`, "g"), "");
    const entry = `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${String(match.lastVerifiedAt).slice(0, 10)}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.9</priority>\n  </url>\n`;
    xml = xml.replace("</urlset>", `${entry}</urlset>`);
  }
  fs.writeFileSync(sitemapPath, xml, "utf8");
  fs.writeFileSync(path.join(root, "public", "sitemap.xml"), xml, "utf8");
}

function replaceOrInsert(file, startMarker, endMarker, content, beforeNeedle) {
  const filePath = path.join(root, file);
  if (!fs.existsSync(filePath)) return;
  let html = fs.readFileSync(filePath, "utf8");
  const block = `${startMarker}\n${content}\n${endMarker}`;
  if (html.includes(startMarker)) {
    const start = html.indexOf(startMarker);
    const end = html.indexOf(endMarker, start);
    html = `${html.slice(0, start)}${block}${html.slice(end + endMarker.length)}`;
  } else if (html.includes(beforeNeedle)) {
    html = html.replace(beforeNeedle, `${block}\n\n        ${beforeNeedle}`);
  }
  fs.writeFileSync(filePath, html, "utf8");
}

function addInternalLinks(match) {
  const score = `${match.score.home}-${match.score.away}`;
  const homeFeature = `<section class="container section home-post-match" aria-labelledby="home-post-match-title"><div class="section-head"><div class="section-title"><span class="section-kicker">Son maç analizi</span><h2 id="home-post-match-title">Fenerbahçe ${score} Górnik Zabrze</h2><p>Şut, xG, pas, kadro ve kritik anlarla tamamlanan maçın veri odaklı okuması.</p></div><a class="section-link" href="./${escapeHtml(match.analysisPage)}">Tam analizi aç</a></div><div class="home-post-match-shell"><div><span>Şampiyonlar Ligi</span><strong>%79 topa sahip olma · 15 şut · 1,54 xG</strong></div><p>${escapeHtml(match.analysis.verdict)}</p><a class="detail-link" href="./${escapeHtml(match.analysisPage)}">Tüm istatistikleri incele</a></div></section>`;
  replaceOrInsert("index.html", "<!-- post-match-feature:start -->", "<!-- post-match-feature:end -->", homeFeature, '<section class="container section radar-layout"');

  const teamFeature = `<section class="card team-latest-match"><span class="card-kicker">Son tamamlanan maç</span><div class="team-latest-match-score"><div><h2>Fenerbahçe ${score} Górnik Zabrze</h2><p>${escapeHtml(match.analysis.verdict)}</p></div><strong>${score}</strong></div><div class="metric-grid compact"><span>Topla oynama <b>%79</b></span><span>Şut <b>15-2</b></span><span>xG <b>1,54-0,06</b></span></div><a class="detail-link" href="./${escapeHtml(match.analysisPage)}">Maç analizini aç</a></section>`;
  replaceOrInsert("fenerbahce-form-durumu.html", "<!-- latest-team-match:start -->", "<!-- latest-team-match:end -->", teamFeature, '<section class="source-strip"');
}

for (const match of completedMatches) {
  const html = pageHtml(match);
  fs.writeFileSync(path.join(root, match.analysisPage), html, "utf8");
  fs.writeFileSync(path.join(root, "public", match.analysisPage), html, "utf8");
}

if (completedMatches[0]) addInternalLinks(completedMatches[0]);
upsertSitemap(completedMatches);
console.log(`Generated ${completedMatches.length} post-match analysis page(s)`);
