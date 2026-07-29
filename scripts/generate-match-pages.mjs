import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { siteHeader, siteFooter } from "./lib/layout.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);
const domain = "https://www.futbolradar.com";
const fixtures = JSON.parse(fs.readFileSync(path.join(root, "data", "super-lig-fixtures.json"), "utf8"));
const teams = JSON.parse(fs.readFileSync(path.join(root, "data", "teams.json"), "utf8"));
const rawPlayers = JSON.parse(fs.readFileSync(path.join(root, "data", "players.json"), "utf8"));
const squadStatus = JSON.parse(fs.readFileSync(path.join(root, "data", "squad-statuses.json"), "utf8"));
const { getPlayers } = require("../services/playerService.js");
const { calculateMatchRadar, normalizeText } = require("../services/matchRadarService.js");
const {
  confidenceLabel,
  formatFreshnessDate,
  freshnessLabel,
  normalizeFreshness
} = require("../services/freshnessService.js");
const { publishableStatements, logExcludedStatements, statementsForMatch } =
  require("../services/matchStatementService.js");
const { statementsSection, statementsSchema } = require("../services/matchStatementsView.js");
const { trustBadges, matchTrustLabels } = require("../services/trustLabels.js");
const { displayLeagueName, SUPER_LIG_DISPLAY_NAME } = require("../services/leagueIdentity.js");
const { fitDescription, fitTitle } = require("../services/seoText.js");

/**
 * Fikstür kaydı ile oynanmış maç kaydı ayrı kimlikler taşıyor
 * (`tff-tsl-2026-r01-...` ve `genclerbirligi-fenerbahce-2026-08-15`).
 * Açıklamalar oynanmış maça bağlı olduğu için eşleştirme takım çifti
 * üzerinden yapılır: maç henüz oynanmadıysa eşleşme bulunmaz ve bölüm
 * dürüstçe "açıklama bekleniyor" der.
 */
const playedMatches = JSON.parse(fs.readFileSync(path.join(root, "data", "matches.json"), "utf8"));
const preparedStatements = publishableStatements();
logExcludedStatements("match-pages", preparedStatements.excluded);

function playedMatchIdFor(match) {
  const wanted = `${normalizeText(match.homeTeam)}|${normalizeText(match.awayTeam)}`;
  const found = (Array.isArray(playedMatches) ? playedMatches : [])
    .find((played) => `${normalizeText(played.homeTeam)}|${normalizeText(played.awayTeam)}` === wanted);
  return found ? found.id : null;
}

const players = getPlayers(rawPlayers);
const outDir = path.join(root, "mac");
const publicOutDir = path.join(root, "public", "mac");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function slug(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function pageSlug(match) {
  return `${slug(match.homeTeam)}-${slug(match.awayTeam)}-${fixtures.season}-r${String(match.round).padStart(2, "0")}`;
}

function flattenFixtures() {
  return (fixtures.rounds || []).flatMap((round) => (round.matches || []).map((match) => ({
    ...match,
    league: fixtures.league,
    season: fixtures.season,
    round: round.round,
    roundLabel: round.label,
    dateRange: match.dateLabel || round.dateRange || null,
    freshness: match.freshness || fixtures.freshness
  }))).filter((match) => match.homeTeam && match.awayTeam && match.fixtureStatus === "confirmed-pairing");
}

function getTeam(name) {
  return teams.find((team) => normalizeText(team.name || team.team) === normalizeText(name)) || null;
}

function formHtml(team) {
  const form = Array.isArray(team && team.form) ? team.form : [];
  if (!form.length) {
    return '<span class="muted-copy">Son 5 maç formu için doğrulanmış kayıt bekleniyor.</span>';
  }

  return `<div class="match-form-row">${form.map((item) => {
    const label = item.label || item.result || "-";
    const kind = normalizeText(item.result || label);
    const state = kind === "win" || kind === "g" ? "win" : kind === "loss" || kind === "m" ? "loss" : "draw";
    return `<span class="form-dot ${state}">${escapeHtml(label)}</span>`;
  }).join("")}</div>`;
}

function teamPlayers(name) {
  const wanted = normalizeText(name);
  return players
    .filter((player) => normalizeText(player.currentTeam || player.team) === wanted)
    .sort((left, right) => Number(right.formRating || right.overallRating || 0) - Number(left.formRating || left.overallRating || 0))
    .slice(0, 3);
}

function keyPlayersHtml(name) {
  const selected = teamPlayers(name);
  if (!selected.length) {
    return '<p class="muted-copy">Kilit oyuncu formu için yeterli doğrulanmış kadro kaydı yok.</p>';
  }

  return `<ul class="match-key-player-list">${selected.map((player) => {
    const rating = player.overallRating || player.aiRating || player.rating || "-";
    return `<li><a href="../oyuncular/${escapeHtml(player.id)}.html">${escapeHtml(player.name)}</a><span>Radar ${escapeHtml(rating)}</span></li>`;
  }).join("")}</ul>`;
}

function squadHtml(name) {
  const rows = Array.isArray(squadStatus.teams) ? squadStatus.teams : [];
  const row = rows.find((item) => normalizeText(item.team || item.name) === normalizeText(name));
  if (!row) {
    return '<p class="muted-copy">Eksik oyuncu bilgisi için doğrulanmış kayıt bekleniyor.</p>';
  }

  const absenceCount = Number(row.absenceCount || 0);
  const impact = row.totalAbsenceImpact ?? row.absenceImpact;
  return `<dl class="match-squad-metrics"><div><dt>Eksik oyuncu</dt><dd>${escapeHtml(absenceCount)}</dd></div><div><dt>Kadro kaybı</dt><dd>${impact == null ? "Veri yok" : escapeHtml(`${impact}/100`)}</dd></div><div><dt>Önemli eksik</dt><dd>${escapeHtml(row.keyAbsence || "Yok")}</dd></div></dl>`;
}

/**
 * "%0 KAPSAM" BİR ÖLÇÜM İDDİASIDIR.
 *
 * Kart, hiç bileşen ölçülemediğinde bile "Sınırlı güven · Kapsam %0"
 * yazıyordu. Okuyucu bunu "ölçtük, sıfır çıktı" diye okur; oysa doğrusu
 * "bu eşleşme için henüz doğrulanmış kayıt yok". 306 maç sayfasının 96'sı
 * bu durumdaydı ve puan alanı zaten dürüstçe "Veri bekleniyor" diyordu —
 * yani aynı kartın iki satırı birbiriyle çelişiyordu.
 *
 * Ölçüm varsa oran yazılır, yoksa hiçbir rakam basılmaz.
 */
function coverageLine(radar) {
  const coverage = Number(radar.coverage);
  if (!Number.isFinite(coverage) || coverage <= 0) {
    return '<b class="match-confidence-awaiting">Veri bekleniyor</b>';
  }
  return `<b>Kapsam %${escapeHtml(radar.coverage)}</b>`;
}

function radarCard(name, radar, team) {
  const measured = radar.score !== null;
  const score = measured ? `${radar.score}/100` : "Veri bekleniyor";
  const positives = radar.positives.length ? radar.positives : ["Yeterli olumlu bileşen oluşmadı"];
  const negatives = radar.negatives.length ? radar.negatives : ["Belirgin olumsuz bileşen yok"];

  // Ölçüm yoksa "Neden bu puan?" açılır bölümü de basılmıyor: ortada bir
  // puan yokken gerekçe listelemek, olmayan bir hesabı açıklamak olurdu.
  const explanation = measured
    ? `<details class="radar-explanation" data-radar-explanation>
      <summary>Neden bu puan?</summary>
      <div class="radar-explanation-grid"><div><span>Güçlü etkenler</span><ul>${positives.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div><div><span>Dikkat noktaları</span><ul>${negatives.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div></div>
    </details>`
    : `<p class="muted-copy">${escapeHtml(`${name} için doğrulanmış form ve kadro kaydı oluştuğunda radar puanı burada hesaplanacak.`)}</p>`;

  return `<article class="match-radar-team-card">
    <div class="match-radar-team-head"><span>${escapeHtml(name)}</span><strong>${escapeHtml(score)}</strong></div>
    <div class="match-confidence"><span>${escapeHtml(confidenceLabel(radar.confidence))}</span>${coverageLine(radar)}</div>
    <div class="match-radar-bars">${radar.components.filter((item) => item.value !== null).map((item) => `<div><span>${escapeHtml(item.label)}</span><i style="--value:${escapeHtml(item.value)}%"><b></b></i><em>${escapeHtml(Math.round(item.value))}</em></div>`).join("") || '<p class="muted-copy">Puan için yeterli bileşen yok.</p>'}</div>
    ${explanation}
  </article>`;
}

function relatedComparison(match) {
  const home = teamPlayers(match.homeTeam);
  const away = teamPlayers(match.awayTeam);
  const candidate = home.flatMap((left) => away.map((right) => ({ left, right }))).find(({ left, right }) => left.positionGroup === right.positionGroup);
  if (!candidate) {
    return "";
  }

  return `<a class="match-related-card" href="../oyuncu-karsilastir.html?players=${escapeHtml(candidate.left.id)},${escapeHtml(candidate.right.id)}"><span>Aynı rol kıyası</span><strong>${escapeHtml(candidate.left.name)} vs ${escapeHtml(candidate.right.name)}</strong><p>Maç öncesi benzer rol profillerini yan yana oku.</p></a>`;
}

/**
 * BAŞLIK BÜTÇESİ.
 *
 * Başlık "Gençlerbirliği - Fenerbahçe Maç Analizi | 1. Hafta Trendyol Süper
 * Lig | FutbolRadar" biçimindeydi: 83 karakter. Arama sonucunda yaklaşık 60
 * karakterden sonrası kesiliyor, yani lig ve marka hiç görünmüyor, üstelik
 * kesik bir cümle görünüyordu.
 *
 * Çözüm sabit bir kalıp değil, bir BÜTÇE: takım adları uzunsa ek bilgi
 * düşer, kısaysa daha fazlası sığar. Anahtar kelime ("Maç Analizi") her
 * durumda başta kalır.
 *
 * Ligin adı her zaman resmî biçimiyle yazılır: "Trendyol Süper Lig".
 * Kısaltma yok — lig adı bir marka ve sitenin her yüzeyinde aynı olmalı.
 *
 * Sıralama önemli: LİG ADI TAŞIYAN aday, MARKA taşıyandan önce gelir.
 * "Trendyol Süper Lig" (18 karakter) çoğu maçta ikisinin birden sığmasına
 * izin vermiyor; bu durumda arama hacmi olan lig adı kalır, marka düşer.
 * Marka zaten alan adında ve arama sonucunda site adı olarak görünüyor.
 */
function buildTitle(heading, match) {
  const round = String(match.roundLabel || "").trim();
  const league = displayLeagueName(match.league, SUPER_LIG_DISPLAY_NAME);
  const candidates = [
    round ? `${heading} | ${league} ${round} | FutbolRadar` : null,
    `${heading} | ${league} | FutbolRadar`,
    round ? `${heading} | ${league} ${round}` : null,
    `${heading} | ${league}`,
    `${heading} | FutbolRadar`,
    heading
  ].filter(Boolean);

  return fitTitle([...candidates, heading]);
}

/**
 * Açıklama 189 karakterdi ve arama sonucunda ortasından kesiliyordu.
 * Parçalar sığdığı sürece eklenir; hiçbiri uydurulmaz — hepsi fikstür
 * kaydında zaten yazan alanlar.
 */
function buildDescription(heading, match, dateLabel) {
  const lead = `${heading}: ${[match.roundLabel, dateLabel].filter(Boolean).join(", ")}.`;
  return fitDescription(lead, "İki takımın form durumu, radar puanı, kadro eksikleri ve kilit oyuncuları.");
}

/**
 * YAPILANDIRILMIŞ VERİ — EKSİK OLAY YAYIMLANMAZ.
 *
 * Sayfa bugüne kadar her fikstür için `SportsEvent` basıyordu; oysa
 * fikstür kaydında ne başlama saati ne saha var (`data/super-lig-fixtures.json`
 * yalnızca hafta aralığı taşıyor: "14-17 Ağustos 2026"). Arama motorunun
 * Event için zorunlu saydığı `startDate` ve `location` yoksa, işaretleme
 * zenginleştirme üretmez; yalnızca 306 URL için "eksik alan" hatası üretir.
 *
 * İki seçenek vardı: eksik alanı uydurmak ya da olay iddiasını hiç
 * kurmamak. Uydurma tarih, sitenin tamamında uygulanan kuralı kırardı.
 * Bu yüzden:
 *   • doğrulanmış başlama saati VARSA -> tam SportsEvent
 *   • yoksa                            -> WebPage (sayfa gerçekte odur)
 *
 * Fikstüre saat girdiği gün üst blok kendiliğinden SportsEvent'e döner;
 * burada değiştirilecek bir şey kalmaz.
 */
function eventNode(match, canonical, description) {
  const teams = [
    { "@type": "SportsTeam", name: match.homeTeam },
    { "@type": "SportsTeam", name: match.awayTeam }
  ];

  if (!match.kickoff) {
    return {
      "@type": "WebPage",
      name: `${match.homeTeam} - ${match.awayTeam} Maç Analizi`,
      url: canonical,
      description,
      inLanguage: "tr-TR",
      isPartOf: { "@type": "WebSite", name: "FutbolRadar", url: `${domain}/` },
      about: teams
    };
  }

  return {
    "@type": "SportsEvent",
    name: `${match.homeTeam} - ${match.awayTeam}`,
    url: canonical,
    description,
    startDate: match.kickoff,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    sport: "Football",
    homeTeam: teams[0],
    awayTeam: teams[1],
    competitor: teams,
    superEvent: { "@type": "SportsEvent", name: `${displayLeagueName(match.league)} ${match.season}` },
    // Saha yalnızca doğrulanmışsa yazılır; "bilinmiyor" bir konum değildir.
    ...(match.venue ? { location: { "@type": "StadiumOrArena", name: match.venue } } : {})
  };
}

function pageHtml(match) {
  const slugValue = pageSlug(match);
  const canonical = `${domain}/mac/${slugValue}.html`;
  const freshness = normalizeFreshness(match.freshness);
  const radar = calculateMatchRadar(match, { teams, players, squadStatus });
  const homeTeam = getTeam(match.homeTeam);
  const awayTeam = getTeam(match.awayTeam);
  // SEO başlığı ve açıklaması maça özgü: hafta, lig ve takım adları
  // değişkenlerden gelir, iki sayfa aynı başlığı taşımaz.
  const heading = `${match.homeTeam} - ${match.awayTeam} Maç Analizi`;
  const dateLabel = match.kickoff ? formatFreshnessDate(match.kickoff) : (match.dateRange || "Tarih ve saat bekleniyor");
  const title = buildTitle(heading, match);
  const description = buildDescription(heading, match, dateLabel);

  // GÜVEN ETİKETİ: başlama saati geçmiş ama skoru ulaşmamış maç listelerden
  // gizleniyor (services/matchEligibility.js), ama sayfası duruyor. Okuyucu
  // buraya bir bağlantıdan gelebilir; boş bir skor alanı yerine nedenini
  // okumalı.
  const trustRow = trustBadges(matchTrustLabels(match));

  // Maç sonu açıklamaları: oynanmış maç kaydı varsa ona bağlanır, yoksa
  // bölüm "doğrulanmış açıklama bekleniyor" der. Bölüm hiç gizlenmez.
  const playedId = playedMatchIdFor(match);
  const matchStatements = playedId
    ? statementsForMatch(playedId, { prepared: preparedStatements })
    : [];
  const statementsBlock = statementsSection(matchStatements, {
    matchLabel: `${match.homeTeam} - ${match.awayTeam}`,
    headingId: "mac-sonu-aciklamalari"
  });

  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      ...statementsSchema(matchStatements, canonical),
      eventNode(match, canonical, description),
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Ana Sayfa", item: `${domain}/` },
          { "@type": "ListItem", position: 2, name: "Trendyol Süper Lig Maç Analizleri", item: `${domain}/super-lig-mac-analizleri.html` },
          { "@type": "ListItem", position: 3, name: `${match.homeTeam} - ${match.awayTeam}`, item: canonical }
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
    <meta property="og:image:alt" content="${escapeHtml(`${match.homeTeam} - ${match.awayTeam} maç analizi`)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${domain}/assets/og-image.svg" />
    <script type="application/ld+json">${JSON.stringify(schema)}</script>
    <link rel="icon" href="../favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="../site.webmanifest" />
    <link rel="stylesheet" href="../page.css" />
  </head>
  <body class="subpage match-analysis-page">
    ${siteHeader({ base: "../" })}
    <main class="container">
      <nav class="breadcrumb" aria-label="Sayfa yolu"><a href="../index.html">Ana Sayfa</a><span>/</span><a href="../super-lig-mac-analizleri.html">Trendyol Süper Lig Maç Analizleri</a><span>/</span><span>${escapeHtml(match.homeTeam)} - ${escapeHtml(match.awayTeam)}</span></nav>
      <section class="hero match-analysis-hero"><div class="hero-row"><div><span class="eyebrow">${escapeHtml(match.roundLabel)} · ${escapeHtml(displayLeagueName(match.league))}</span><h1>${escapeHtml(heading)}</h1><p class="lead">${escapeHtml(radar.lead)}</p>${trustRow}</div><span class="hero-meta">${escapeHtml(dateLabel)}</span></div></section>
      <section class="match-freshness-strip" aria-label="Fikstür durumu"><div><span>Fikstür durumu</span><b>${escapeHtml(freshnessLabel(freshness))}</b></div><div><span>Son kontrol</span><b>${escapeHtml(formatFreshnessDate(freshness.verifiedAt || freshness.fetchedAt))}</b></div><div><span>Güven</span><b>${escapeHtml(confidenceLabel(freshness.confidence))}</b></div></section>
      <section class="match-radar-board" aria-label="Maç öncesi radar puanları">${radarCard(match.homeTeam, radar.home, homeTeam)}${radarCard(match.awayTeam, radar.away, awayTeam)}</section>
      <p class="match-radar-disclaimer">${escapeHtml(radar.disclaimer)}</p>
      <section class="match-context-grid" aria-label="Maç bağlamı"><article class="card"><span class="card-kicker">${escapeHtml(match.homeTeam)}</span><h2>Form ve kadro</h2>${formHtml(homeTeam)}${squadHtml(match.homeTeam)}${keyPlayersHtml(match.homeTeam)}</article><article class="card"><span class="card-kicker">${escapeHtml(match.awayTeam)}</span><h2>Form ve kadro</h2>${formHtml(awayTeam)}${squadHtml(match.awayTeam)}${keyPlayersHtml(match.awayTeam)}</article></section>
      ${statementsBlock}
      <section class="match-related-grid" aria-label="İlgili radar ekranları">${relatedComparison(match)}<a class="match-related-card" href="../super-lig-mac-analizleri.html"><span>Maç analizi</span><strong>Trendyol Süper Lig maç analizleri</strong><p>Haftanın tüm eşleşmelerinin analiz sayfalarına geç.</p></a><a class="match-related-card" href="../super-lig-fikstur.html"><span>Fikstür</span><strong>Sezon eşleşmeleri</strong><p>Onaylı eşleşmelerin tamamına dön.</p></a><a class="match-related-card" href="../super-lig-form-durumu.html"><span>Takım formu</span><strong>Trendyol Süper Lig form durumu</strong><p>İki takımın son maç serisini form tablosunda karşılaştır.</p></a></section>
    </main>
    ${siteFooter({ base: "../" })}
    <script src="../site.js" defer></script>
    <script src="../app.js" defer></script>
  </body>
</html>`;
}

function sitemapEntry(match) {
  const slugValue = pageSlug(match);
  const freshness = normalizeFreshness(match.freshness);
  const lastmod = String(freshness.verifiedAt || freshness.fetchedAt || fixtures.lastVerifiedAt || "").slice(0, 10);
  return `  <url>\n    <loc>${domain}/mac/${slugValue}.html</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.85</priority>\n  </url>`;
}

function updateSitemap(matches) {
  const sitemapPath = path.join(root, "sitemap.xml");
  if (!fs.existsSync(sitemapPath)) {
    return;
  }

  const current = fs.readFileSync(sitemapPath, "utf8");
  const retained = (current.match(/  <url>[\s\S]*?  <\/url>/g) || [])
    .filter((entry) => !entry.includes(`${domain}/mac/`));
  const content = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${retained.concat(matches.map(sitemapEntry)).join("\n")}\n</urlset>\n`;
  fs.writeFileSync(sitemapPath, content, "utf8");
  fs.writeFileSync(path.join(root, "public", "sitemap.xml"), content, "utf8");
}

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(publicOutDir, { recursive: true });

const confirmedFixtures = flattenFixtures();
const expectedFiles = new Set(confirmedFixtures.map((match) => `${pageSlug(match)}.html`));
for (const directory of [outDir, publicOutDir]) {
  for (const file of fs.readdirSync(directory)) {
    if (file.endsWith(".html") && !expectedFiles.has(file)) {
      fs.unlinkSync(path.join(directory, file));
    }
  }
}

for (const match of confirmedFixtures) {
  const html = pageHtml(match);
  const file = `${pageSlug(match)}.html`;
  fs.writeFileSync(path.join(outDir, file), html, "utf8");
  fs.writeFileSync(path.join(publicOutDir, file), html, "utf8");
}

updateSitemap(confirmedFixtures);
console.log(`Generated ${confirmedFixtures.length} static match analysis pages`);
