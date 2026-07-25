/**
 * Tamamlanan her maç için otomatik maç raporu sayfası üretir.
 *
 * İçerik services/matchReportService.js tarafından maçın gerçek verisinden
 * türetilir; bu script yalnızca sunum katmanıdır. Verisi olmayan bölümler
 * gizlenmez, "veri bekleniyor" olarak yazılır — okuyucu neyin ölçülmüş
 * neyin eksik olduğunu görür.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const domain = "https://www.futbolradar.com";

const matches = JSON.parse(fs.readFileSync(path.join(root, "data", "matches.json"), "utf8"));
const { buildMatchReport } = require("../services/matchReportService.js");
const { curatedMatches } = require("../services/providers/mockProvider.js");

const fixturePool = curatedMatches();
const finished = matches
  .filter((match) => String(match.status || "").toUpperCase() === "FINISHED")
  .sort((left, right) => String(right.kickoff || "").localeCompare(String(left.kickoff || "")));

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(value, options = {}) {
  if (!value) return "Tarih bekleniyor";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Tarih bekleniyor";
  return new Intl.DateTimeFormat("tr-TR", {
    day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul", ...options
  }).format(date);
}

function monogram(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return parts.slice(0, 2).map((part) => part.charAt(0).toLocaleUpperCase("tr-TR")).join("");
}

function metricValue(value, metric) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "Veri yok";
  const decimals = Number.isInteger(metric.decimals) ? metric.decimals : Number.isInteger(number) ? 0 : 2;
  return `${number.toFixed(decimals).replace(".", ",")}${metric.unit || ""}`;
}

function noteCard(text) {
  return `<article class="card data-empty" data-card="empty-state"><strong>Veri bekleniyor</strong><span>${escapeHtml(text)}</span></article>`;
}

function statsHtml(match) {
  const stats = match.statistics || [];
  if (!stats.length) return "";
  const categories = [...new Set(stats.map((item) => item.category || "Genel"))];
  return categories.map((category) => {
    const rows = stats.filter((item) => (item.category || "Genel") === category);
    const id = `stats-${category.toLocaleLowerCase("tr-TR").replace(/[^a-z0-9]+/gi, "-")}`;
    return `<section class="post-match-stat-group" aria-labelledby="${escapeHtml(id)}">
      <h3 id="${escapeHtml(id)}">${escapeHtml(category)}</h3>
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
  const lineups = (match.lineups || []).filter((row) => row && Array.isArray(row.players) && row.players.length);
  if (!lineups.length) return "";
  return lineups.map((lineup) => `<article class="post-match-lineup-card">
    <header><h3>${escapeHtml(lineup.team)}</h3><span>${escapeHtml(lineup.formation || "Diziliş doğrulanmadı")}</span></header>
    <ol>${lineup.players.map((player) => `<li>${escapeHtml(player)}</li>`).join("")}</ol>
  </article>`).join("");
}

function substitutionsHtml(match) {
  const subs = match.substitutions || [];
  if (!subs.length) return "";
  return subs.map((item) => `<article class="post-match-sub-row">
    <time>${escapeHtml(item.time || "-")}</time><div><span>${escapeHtml(item.team)}</span><strong>${escapeHtml(item.in)}</strong><small>${escapeHtml(item.out)} yerine</small></div>
  </article>`).join("");
}

// ── Rapor bölümleri ─────────────────────────────────────────────────────────
function summarySection(report) {
  const summary = report.sections.summary;
  if (summary.status !== "ready") return noteCard(summary.reason);
  return `<article class="card post-match-summary-card"><span class="card-kicker">Maç özeti</span><h2>${escapeHtml(summary.headline)}</h2><p>${escapeHtml(summary.paragraph)}</p></article>`;
}

function standoutSection(report) {
  const block = report.sections.standoutPlayers;
  if (block.status !== "ready") return noteCard(block.reason);
  return `<div class="post-match-standouts">${block.players.map((player) => `<article class="card post-match-standout" data-impact="${escapeHtml(player.impact)}">
    <span class="card-kicker">${escapeHtml(player.team)}</span>
    <h3>${escapeHtml(player.name)}</h3>
    <p>${escapeHtml(player.contribution)}</p>
  </article>`).join("")}</div>`;
}

function statisticsSection(report, match) {
  const block = report.sections.statistics;
  if (block.status !== "ready") return noteCard(block.reason);

  const conversion = block.conversion.length
    ? `<div class="post-match-conversion">${block.conversion.map((row) => `<article><span>${escapeHtml(row.team)}</span><strong>%${escapeHtml(String(row.rate).replace(".", ","))}</strong><small>${escapeHtml(row.goals)} gol / ${escapeHtml(row.shots)} şut</small></article>`).join("")}</div>`
    : "";

  return `<article class="card post-match-stat-reading">
    <span class="card-kicker">İstatistik analizi</span>
    <p>${escapeHtml(block.lead)}</p>
    <ul>${block.readings.map((reading) => `<li>${escapeHtml(reading)}</li>`).join("")}</ul>
    ${conversion}
  </article>
  <div class="post-match-team-labels"><strong>${escapeHtml(match.homeTeam)}</strong><span>Karşılaştırma</span><strong>${escapeHtml(match.awayTeam)}</strong></div>
  <div class="post-match-stats-grid">${statsHtml(match)}</div>`;
}

function tacticalSection(report) {
  const block = report.sections.tactical;
  if (block.status === "unavailable") return noteCard(block.reason);
  return `<article class="card post-match-tactical">
    <span class="card-kicker">Taktik değerlendirme</span>
    <ul>${block.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>
    ${block.status === "partial" ? '<p class="muted-copy">Diziliş ve oyun yapısı verisinin bir bölümü henüz doğrulanmadı; bölüm veri geldikçe genişler.</p>' : ""}
  </article>`;
}

function turningPointsSection(report) {
  const block = report.sections.turningPoints;
  if (block.status === "unavailable") return noteCard(block.reason);
  return `<div class="post-match-events">${block.moments.map((moment) => `<article class="post-match-event${moment.pivotal ? " is-goal" : ""}">
    <time>${escapeHtml(moment.minute)}</time>
    <div><span>${escapeHtml(moment.type)}${moment.team ? ` · ${escapeHtml(moment.team)}` : ""}</span><p>${escapeHtml(moment.detail || "Ayrıntı doğrulanmadı.")}</p></div>
  </article>`).join("")}</div>`;
}

function aiRatingSection(report) {
  const block = report.sections.aiRating;
  if (block.status !== "ready") return noteCard(block.reason);
  return `<article class="card post-match-ai-rating">
    <span class="card-kicker">FutbolRadar performans puanı</span>
    <div class="post-match-ai-scores">
      <div><span>${escapeHtml(block.home.team)}</span><strong>${escapeHtml(block.home.score)}</strong></div>
      <div><span>${escapeHtml(block.away.team)}</span><strong>${escapeHtml(block.away.score)}</strong></div>
    </div>
    <p>${escapeHtml(block.basis)}</p>
    <div class="tag-row"><span class="tag soft">Veri güveni %${escapeHtml(block.confidence)}</span><span class="tag soft">100 üzerinden</span></div>
  </article>`;
}

function nextMatchSection(report) {
  const block = report.sections.nextMatch;
  return `<article class="card post-match-next">
    <span class="card-kicker">Sonraki maç öngörüsü</span>
    <ul>${block.entries.map((entry) => `<li>${escapeHtml(entry.text)}</li>`).join("")}</ul>
    <p class="muted-copy">${escapeHtml(block.note)}</p>
  </article>`;
}

/** Elle yazılmış editoryal analiz varsa üretilen içeriğe ek olarak sunulur. */
function editorialSection(match) {
  const analysis = match.analysis;
  if (!analysis || !analysis.headline) return "";
  const reads = [
    ["Hücum", analysis.attackingRead],
    ["Orta saha", analysis.midfieldRead],
    ["Savunma", analysis.defensiveRead]
  ].filter(([, text]) => text);

  return `<section class="post-match-section">
        <div class="section-head"><div class="section-title"><span class="section-kicker">Editör analizi</span><h2>${escapeHtml(analysis.headline)}</h2><p>${escapeHtml(analysis.verdict || "")}</p></div></div>
        ${reads.length ? `<div class="post-match-analysis-grid">${reads.map(([label, text]) => `<article class="card"><span class="card-kicker">${escapeHtml(label)}</span><p>${escapeHtml(text)}</p></article>`).join("")}</div>` : ""}
        ${Array.isArray(analysis.keyPoints) && analysis.keyPoints.length ? `<aside class="post-match-key-points card"><h3>Analiz notları</h3><ul>${analysis.keyPoints.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul></aside>` : ""}
      </section>`;
}

function kpiSection(match) {
  const pick = (type) => (match.statistics || []).find((row) => String(row.type).toLocaleLowerCase("tr-TR") === type.toLocaleLowerCase("tr-TR"));
  const tiles = [];
  const possession = pick("Topla oynama");
  const xg = pick("Gol beklentisi (xG)");
  const shots = pick("Toplam şut");
  const onTarget = pick("İsabetli şut");
  const passAccuracy = pick("Pas isabeti");

  if (possession) tiles.push(["Topla oynama", `%${possession.home}`, match.homeTeam]);
  if (xg) tiles.push(["xG", String(xg.home).replace(".", ","), `${String(xg.away).replace(".", ",")}'ye karşı`]);
  if (shots) tiles.push(["Şut", String(shots.home), onTarget ? `${onTarget.home} isabet` : "toplam"]);
  if (passAccuracy) tiles.push(["Pas isabeti", `%${passAccuracy.home}`, match.homeTeam]);

  if (!tiles.length) return "";
  return `<section class="post-match-kpi-grid" aria-label="Öne çıkan maç istatistikleri">${tiles
    .map(([label, value, note]) => `<article><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></article>`)
    .join("")}</section>`;
}

function pageHtml(report, match) {
  const { seo } = report;
  const url = `${domain}/${seo.path}`;
  const depth = seo.path.includes("/") ? "../" : "./";
  const score = match.score || {};
  const summary = report.sections.summary;
  const lead = summary.status === "ready" ? summary.paragraph : (match.summary || "Maç verisi doğrulandıkça bu rapor genişler.");

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
        location: { "@type": "StadiumOrArena", name: match.venue || "Bilinmiyor", address: match.city || "" },
        homeTeam: { "@type": "SportsTeam", name: match.homeTeam },
        awayTeam: { "@type": "SportsTeam", name: match.awayTeam },
        description: summary.status === "ready" ? summary.paragraph : match.summary || ""
      },
      {
        "@type": "Article",
        headline: seo.title,
        description: seo.description,
        datePublished: match.lastVerifiedAt || match.kickoff,
        dateModified: match.lastVerifiedAt || match.kickoff,
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

  const lineups = lineupHtml(match);
  const subs = substitutionsHtml(match);

  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(seo.title)}</title>
    <meta name="description" content="${escapeHtml(seo.description)}" />
    <link rel="canonical" href="${url}" />
    <meta name="robots" content="index,follow" />
    <meta property="og:type" content="article" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:url" content="${url}" />
    <meta property="og:title" content="${escapeHtml(seo.title)}" />
    <meta property="og:description" content="${escapeHtml(seo.description)}" />
    <meta property="og:image" content="${domain}/assets/og-image.svg" />
    <meta property="og:image:type" content="image/svg+xml" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(seo.title)}" />
    <meta name="twitter:description" content="${escapeHtml(seo.description)}" />
    <meta name="twitter:image" content="${domain}/assets/og-image.svg" />
    <script type="application/ld+json">${JSON.stringify(schema)}</script>
    <link rel="icon" href="${depth}favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="${depth}site.webmanifest" />
    <link rel="stylesheet" href="${depth}page.css" />
  </head>
  <body class="subpage post-match-page">
    <header class="topbar"><nav class="container nav" aria-label="Ana menü"><a class="brand" href="${depth}index.html" aria-label="FutbolRadar ana sayfa"><span class="brand-mark">FR</span><span>FutbolRadar</span></a><button class="nav-toggle" type="button" aria-label="Menüyü aç" aria-expanded="false" aria-controls="primary-menu"><span class="nav-toggle-bar"></span><span class="nav-toggle-bar"></span><span class="nav-toggle-bar"></span></button><div class="nav-menu" id="primary-menu"><div class="nav-links"><a href="${depth}bugunun-maclari.html">Bugünkü Maçlar</a><a href="${depth}canli-skor.html">Canlı Skor</a><a href="${depth}puan-durumu.html">Puan Durumu</a><a href="${depth}super-lig-fikstur.html">Süper Lig Fikstürü</a><a href="${depth}takimlar.html">Takımlar</a><a href="${depth}oyuncu-radari.html">Oyuncu Radarı</a><a href="${depth}momentum.html">Momentum</a></div><a class="cta" href="${depth}mac-merkezi.html">Maç Merkezi</a></div></nav></header>
    <main class="container">
      <nav class="breadcrumb" aria-label="Sayfa yolu"><a href="${depth}index.html">Ana Sayfa</a><span>/</span><a href="${depth}mac-merkezi.html">Maç Merkezi</a><span>/</span><span>${escapeHtml(match.homeTeam)} - ${escapeHtml(match.awayTeam)}</span></nav>
      <section class="post-match-hero">
        <div class="post-match-heading"><span class="eyebrow">${escapeHtml(match.league)}${match.stage ? ` · ${escapeHtml(match.stage)}` : ""}</span><h1>${escapeHtml(match.homeTeam)} ${escapeHtml(score.home ?? "")}-${escapeHtml(score.away ?? "")} ${escapeHtml(match.awayTeam)} Maç Raporu</h1><p>${escapeHtml(lead)}</p><div class="post-match-meta"><span>${escapeHtml(formatDate(match.kickoff))}</span>${match.venue && match.venue !== "Açıklanmadı" ? `<span>${escapeHtml(match.venue)}</span>` : ""}${match.referee ? `<span>Hakem: ${escapeHtml(match.referee)}</span>` : ""}<span>Veri kapsamı %${escapeHtml(report.coverage)}</span></div></div>
        <div class="post-match-scoreboard" aria-label="Maç sonucu">
          <div><span class="team-monogram">${escapeHtml(monogram(match.homeTeam))}</span><strong>${escapeHtml(match.homeTeam)}</strong></div>
          <div class="post-match-score"><span>Maç sonucu</span><b>${escapeHtml(score.home ?? "-")}<i>-</i>${escapeHtml(score.away ?? "-")}</b>${Number.isFinite(Number(score.halftimeHome)) ? `<small>İlk yarı ${escapeHtml(score.halftimeHome)}-${escapeHtml(score.halftimeAway)}</small>` : ""}</div>
          <div><span class="team-monogram away">${escapeHtml(monogram(match.awayTeam))}</span><strong>${escapeHtml(match.awayTeam)}</strong></div>
        </div>
      </section>

      ${kpiSection(match)}

      <section class="post-match-section" aria-labelledby="rapor-ozet">
        <div class="section-head"><div class="section-title"><span class="section-kicker">Rapor</span><h2 id="rapor-ozet">Maç özeti</h2><p>Sonuç, goller ve karşılaşmanın künyesi.</p></div></div>
        ${summarySection(report)}
      </section>

      <section class="post-match-section" aria-labelledby="rapor-oyuncu">
        <div class="section-head"><div class="section-title"><span class="section-kicker">Rapor</span><h2 id="rapor-oyuncu">Öne çıkan oyuncular</h2><p>Gol, asist, kart ve kritik aksiyon kayıtlarından çıkarılan katkılar.</p></div></div>
        ${standoutSection(report)}
      </section>

      <section class="post-match-section" aria-labelledby="rapor-istatistik">
        <div class="section-head"><div class="section-title"><span class="section-kicker">Rapor</span><h2 id="rapor-istatistik">İstatistik analizi</h2><p>${escapeHtml(match.homeTeam)} ve ${escapeHtml(match.awayTeam)} verilerinin karşılaştırmalı okuması.</p></div></div>
        ${statisticsSection(report, match)}
      </section>

      <section class="post-match-section" aria-labelledby="rapor-taktik">
        <div class="section-head"><div class="section-title"><span class="section-kicker">Rapor</span><h2 id="rapor-taktik">Taktik değerlendirme</h2><p>Diziliş, oyun kontrolü ve müdahalelerin veriye dayalı okuması.</p></div></div>
        ${tacticalSection(report)}
      </section>

      <section class="post-match-section" aria-labelledby="rapor-kirilma">
        <div class="section-head"><div class="section-title"><span class="section-kicker">Rapor</span><h2 id="rapor-kirilma">Maçın kırılma anları</h2><p>Skoru ve oyunun seyrini değiştiren dakikalar.</p></div></div>
        ${turningPointsSection(report)}
      </section>

      <section class="post-match-section" aria-labelledby="rapor-puan">
        <div class="section-head"><div class="section-title"><span class="section-kicker">Rapor</span><h2 id="rapor-puan">AI puanlaması</h2><p>Ölçülmüş istatistiklerden hesaplanan takım performans puanı.</p></div></div>
        ${aiRatingSection(report)}
      </section>

      <section class="post-match-section" aria-labelledby="rapor-sonraki">
        <div class="section-head"><div class="section-title"><span class="section-kicker">Rapor</span><h2 id="rapor-sonraki">Sonraki maça dair öngörü</h2><p>Doğrulanmış fikstüre göre iki takımı bekleyen karşılaşma.</p></div></div>
        ${nextMatchSection(report)}
      </section>

      ${editorialSection(match)}

      ${lineups ? `<section class="post-match-section">
        <div class="section-head"><div class="section-title"><span class="section-kicker">Kadrolar</span><h2>İlk 11 ve dizilişler</h2><p>Başlangıç kadroları ve maç içindeki oyuncu değişiklikleri.</p></div></div>
        <div class="post-match-lineups">${lineups}</div>
        ${subs ? `<div class="post-match-substitutions"><h3>Oyuncu değişiklikleri</h3><div>${subs}</div></div>` : ""}
      </section>` : ""}

      <section class="post-match-next-grid">
        <a href="${depth}mac-merkezi.html"><span>Maç merkezi</span><strong>Tüm maç raporları</strong><p>Tamamlanan karşılaşmaların veri odaklı okumalarına geç.</p></a>
        <a href="${depth}oyuncu-radari.html"><span>Oyuncu analizi</span><strong>${escapeHtml(match.homeTeam)} Oyuncu Radarı</strong><p>Kadro içindeki form ve rol sinyallerini incele.</p></a>
        <a href="${depth}bugunun-maclari.html"><span>Program</span><strong>Bugünkü maçlar</strong><p>Günün doğrulanmış karşılaşmalarını aç.</p></a>
      </section>
    </main>
    <footer class="footer"><div class="container footer-links">FutbolRadar · Maç raporu · <a href="${depth}hakkinda.html">Hakkında</a> · <a href="${depth}veri-notu.html">Veri Notu</a> · <a href="${depth}iletisim.html">İletişim</a></div></footer>
    <script src="${depth}site.js" defer></script>
  </body>
</html>`;
}

// ── Site geneli bağlantılar ─────────────────────────────────────────────────
function replaceOrInsert(file, startMarker, endMarker, content, beforeNeedle) {
  const filePath = path.join(root, file);
  if (!fs.existsSync(filePath)) return;
  let html = fs.readFileSync(filePath, "utf8");
  const block = `${startMarker}\n${content}\n${endMarker}`;
  const pattern = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`);
  if (pattern.test(html)) {
    html = html.replace(pattern, block);
  } else if (beforeNeedle && html.includes(beforeNeedle)) {
    html = html.replace(beforeNeedle, `${block}\n\n        ${beforeNeedle}`);
  } else {
    return;
  }
  fs.writeFileSync(filePath, html, "utf8");
  fs.writeFileSync(path.join(root, "public", file), html, "utf8");
}

function addInternalLinks(report, match) {
  const summary = report.sections.summary;
  const score = `${match.score.home}-${match.score.away}`;
  const headline = `${match.homeTeam} ${score} ${match.awayTeam}`;
  const verdict = summary.status === "ready" ? summary.paragraph : match.summary || "";
  const rating = report.sections.aiRating;
  const strip = rating.status === "ready"
    ? `${rating.home.team} ${rating.home.score} · ${rating.away.team} ${rating.away.score} performans puanı`
    : `${match.league}${match.stage ? ` · ${match.stage}` : ""}`;

  const homeFeature = `<section class="container section home-post-match" aria-labelledby="home-post-match-title"><div class="section-head"><div class="section-title"><span class="section-kicker">Son maç raporu</span><h2 id="home-post-match-title">${escapeHtml(headline)}</h2><p>Özet, öne çıkan oyuncular, istatistik ve kırılma anlarıyla tamamlanan maçın veri odaklı okuması.</p></div><a class="section-link" href="./${escapeHtml(report.seo.path)}">Tam raporu aç</a></div><div class="home-post-match-shell"><div><span>${escapeHtml(match.league)}</span><strong>${escapeHtml(strip)}</strong></div><p>${escapeHtml(verdict)}</p><a class="detail-link" href="./${escapeHtml(report.seo.path)}">Raporu incele</a></div></section>`;
  replaceOrInsert("index.html", "<!-- post-match-feature:start -->", "<!-- post-match-feature:end -->", homeFeature, '<section class="container section section-player-radar"');

  const teamFeature = `<section class="card team-latest-match"><span class="card-kicker">Son tamamlanan maç</span><div class="team-latest-match-score"><div><h2>${escapeHtml(headline)}</h2><p>${escapeHtml(verdict)}</p></div><strong>${escapeHtml(score)}</strong></div><a class="detail-link" href="./${escapeHtml(report.seo.path)}">Maç raporunu aç</a></section>`;
  replaceOrInsert("takimlar.html", "<!-- team-latest-match:start -->", "<!-- team-latest-match:end -->", teamFeature, '<section class="container section"');
}

/**
 * Raporların tümünü Maç Merkezi'nden listeler. Hem kullanıcı için giriş
 * noktası, hem de her raporun en az bir iç bağlantıyla taranabilir olmasını
 * sağlar; aksi halde yalnızca sitemap üzerinden erişilebilir kalırlardı.
 */
function addReportIndex(entries) {
  const cards = entries.map(({ report, match }) => {
    const score = `${match.score.home}-${match.score.away}`;
    const summary = report.sections.summary;
    const line = summary.status === "ready" ? summary.headline : `${match.homeTeam} - ${match.awayTeam}`;
    return `<a class="match-report-card" href="./${escapeHtml(report.seo.path)}">
      <span>${escapeHtml(match.league)} · ${escapeHtml(formatDate(match.kickoff))}</span>
      <strong>${escapeHtml(match.homeTeam)} ${escapeHtml(score)} ${escapeHtml(match.awayTeam)}</strong>
      <p>${escapeHtml(line)}</p>
      <em>Veri kapsamı %${escapeHtml(report.coverage)}</em>
    </a>`;
  }).join("");

  const block = `<section class="section match-report-index" aria-labelledby="match-report-index-title">
          <div class="section-head"><div class="section-title"><span class="section-kicker">Maç raporları</span><h2 id="match-report-index-title">Tamamlanan maçların otomatik raporları</h2><p>Her rapor; özet, öne çıkan oyuncular, istatistik analizi, taktik değerlendirme, kırılma anları, performans puanı ve sonraki maç öngörüsü içerir.</p></div></div>
          <div class="match-report-grid">${cards}</div>
        </section>`;

  replaceOrInsert(
    "mac-merkezi.html",
    "<!-- match-report-index:start -->",
    "<!-- match-report-index:end -->",
    block,
    '<section class="route-chain"'
  );
}

function upsertSitemap(paths) {
  const sitemapPath = path.join(root, "sitemap.xml");
  if (!fs.existsSync(sitemapPath)) return;
  let xml = fs.readFileSync(sitemapPath, "utf8");
  for (const relative of paths) {
    const loc = `${domain}/${relative}`;
    if (xml.includes(`<loc>${loc}</loc>`)) continue;
    // Çok satırlı biçim zorunlu: generate-player-comparison-pages.mjs sitemap'i
    // yeniden yazarken yalnızca "  <url> ... \n  </url>" kalıbına uyan
    // girdileri koruyor, tek satırlık girdiler sessizce düşüyor.
    const entry = `  <url>\n    <loc>${loc}</loc>\n    <changefreq>weekly</changefreq>\n    <priority>0.7</priority>\n  </url>`;
    xml = xml.replace("</urlset>", `${entry}\n</urlset>`);
  }
  fs.writeFileSync(sitemapPath, xml, "utf8");
  fs.writeFileSync(path.join(root, "public", "sitemap.xml"), xml, "utf8");
}

// ── Üretim ──────────────────────────────────────────────────────────────────
const generated = [];
const seenTitles = new Map();
const seenDescriptions = new Map();
const seenPaths = new Map();

for (const match of finished) {
  const report = buildMatchReport(match, { fixtures: fixturePool });
  if (!report) continue;

  const { title, description, path: relative } = report.seo;
  for (const [label, value, store] of [
    ["başlık", title, seenTitles],
    ["meta açıklaması", description, seenDescriptions],
    ["URL", relative, seenPaths]
  ]) {
    if (store.has(value)) {
      throw new Error(`Yinelenen ${label}: "${value}" hem ${store.get(value)} hem ${match.id} raporunda kullanılıyor.`);
    }
    store.set(value, match.id);
  }

  const html = pageHtml(report, match);
  for (const base of [root, path.join(root, "public")]) {
    const target = path.join(base, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, html, "utf8");
  }
  generated.push({ report, match });
}

if (generated.length) {
  addInternalLinks(generated[0].report, generated[0].match);
  addReportIndex(generated);
  upsertSitemap(generated.map((entry) => entry.report.seo.path));
}

const complete = generated.filter((entry) => entry.report.dataStatus === "complete").length;
console.log(`Generated ${generated.length} match report page(s) (${complete} complete, ${generated.length - complete} partial)`);
