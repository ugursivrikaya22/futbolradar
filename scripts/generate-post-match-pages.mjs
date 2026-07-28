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
import { siteHeader, siteFooter } from "./lib/layout.mjs";
import { statementsMarqueeHtml, statementsListHtml } from "./lib/statementsView.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);
const domain = "https://www.futbolradar.com";

const matches = JSON.parse(fs.readFileSync(path.join(root, "data", "matches.json"), "utf8"));
const { buildMatchReport } = require("../services/matchReportService.js");
const { curatedMatches } = require("../services/providers/mockProvider.js");
const { resolvePlayerPhoto, playerPhotoAlt } = require("../services/playerPhotoService.js");
const { buildPostMatchIntelligence } = require("../services/postMatchIntelligence.js");
const { enrichmentSection } = require("../services/postMatchEnrichmentView.js");
const {
  publishableStatements,
  logExcludedStatements,
  statementTickerItems
} = require("../services/matchStatementsService.js");

/**
 * Sağlayıcı zenginleştirme deposu — SALT OKUNUR.
 *
 * Dosya `scripts/enrich-post-match.mjs --apply` tarafından yazılıyor ve
 * henüz hiç yazılmadı. Yokluğu bir hata değil, normal durum: o zaman
 * hiçbir rapora zenginleştirme bölümü eklenmiyor. Bu script dosyayı
 * asla yazmaz, yalnızca okur.
 */
function readEnrichmentStore() {
  const storePath = path.join(root, "data", "match-enrichment.json");
  if (!fs.existsSync(storePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    // Bozuk depo sayfayı çökertmemeli; bölüm açılmaz, sebep günlüğe düşer.
    console.warn(`[post-match] match-enrichment.json okunamadı: ${error.message}`);
    return {};
  }
}

const enrichmentStore = readEnrichmentStore();

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

/**
 * Öne çıkan oyuncunun görseli. Kural services/playerPhotoService.js'de:
 * yalnızca lisanslı kaynak, gerçek sağlayıcı kimliği yoksa baş harfler.
 *
 * Buradaki alt DOLU: görsel, adın hemen bitişiğinde değil, kartın üstünde
 * ayrı bir öge olarak duruyor.
 */
function playerPhotoHtml(player) {
  const photo = resolvePlayerPhoto(player);
  if (photo.isPlaceholder) {
    return `<span class="post-match-face is-placeholder" aria-hidden="true">${escapeHtml(photo.initials)}</span>`;
  }

  return `<img class="post-match-face" src="${escapeHtml(photo.url)}" ` +
    `alt="${escapeHtml(playerPhotoAlt(player, `${player.name}, maç sonrası öne çıkan oyuncu`))}" ` +
    `loading="lazy" decoding="async" width="56" height="56">`;
}

/**
 * MAÇ SONRASI ANALİZ PANOSU
 *
 * Her bölüm yalnızca ölçülmüş girdilerden üretilir; verisi olmayan bölüm
 * hiç basılmaz (services/postMatchIntelligence.js). Bu yüzden burada
 * "veri yok" kartı yok — boş bölüm, ölçüm yapılmış ama sonuç çıkmamış
 * izlenimi verirdi.
 *
 * Grafikler satır içi SVG/CSS: harici kütüphane yok, tema değişkenleriyle
 * boyanıyor, açık ve koyu temada aynı okunurluk.
 */
function confidenceBadge(confidence) {
  if (!confidence) return "";
  const level = confidence.level;
  const cls = level === "yüksek" ? "is-high" : level === "orta" ? "is-medium" : "is-low";
  return `<span class="pmi-confidence ${cls}" title="Bu bölümün dayandığı ölçülerin ne kadarı mevcut">
    <i aria-hidden="true"></i>Güven: ${escapeHtml(level)}</span>`;
}

/** Ev-deplasman karşılaştırma çubuğu. Sayılar her zaman yazılır. */
function comparisonBar(metric, match) {
  const home = Number(metric.home);
  const away = Number(metric.away);
  const total = Math.abs(home) + Math.abs(away);
  const homePct = total ? Math.round((Math.abs(home) / total) * 100) : 50;
  const decimals = metric.decimals || 0;
  const fmt = (value) => (decimals ? Number(value).toFixed(decimals) : String(value)).replace(".", ",");
  const unit = metric.unit ? escapeHtml(metric.unit) : "";

  return `<div class="pmi-metric">
    <div class="pmi-metric-head">
      <b>${escapeHtml(fmt(home))}${unit}</b>
      <span>${escapeHtml(metric.label)}</span>
      <b>${escapeHtml(fmt(away))}${unit}</b>
    </div>
    <div class="pmi-bar" role="img" aria-label="${escapeHtml(`${metric.label}: ${match.homeTeam} ${fmt(home)}, ${match.awayTeam} ${fmt(away)}`)}">
      <span class="pmi-bar-home" style="width:${homePct}%"></span>
      <span class="pmi-bar-away" style="width:${100 - homePct}%"></span>
    </div>
  </div>`;
}

function derivedNote(derived) {
  if (!derived) return "";
  return `<details class="pmi-derived">
    <summary>Bu ölçü nasıl hesaplandı?</summary>
    <p><b>Formül:</b> ${escapeHtml(derived.formula)}</p>
    <p><b>Girdiler:</b> ${escapeHtml(derived.inputs.join(", "))}</p>
    <p>${escapeHtml(derived.note)}</p>
  </details>`;
}

function intelligenceSectionHtml(section, match) {
  const metrics = (section.metrics || []).map((metric) => comparisonBar(metric, match)).join("");
  const readings = (section.readings || []).length
    ? `<ul class="pmi-readings">${section.readings.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`
    : "";

  const lines = (section.lines || []).length
    ? `<ul class="pmi-readings">${section.lines.map((line) =>
        `<li>${escapeHtml(line.text)} <em class="pmi-basis">${escapeHtml(line.basis)}</em></li>`).join("")}</ul>`
    : "";

  const performers = (section.performers || []).length
    ? `<ul class="pmi-performers">${section.performers.map((player) =>
        `<li><strong>${escapeHtml(player.name)}</strong><span>${escapeHtml(player.team)}</span>` +
        `<b>${player.goals} gol</b>${player.minutes.length ? `<em>${escapeHtml(player.minutes.join(", "))}</em>` : ""}</li>`).join("")}</ul>`
    : "";

  const note = section.note ? `<p class="pmi-note">${escapeHtml(section.note)}</p>` : "";
  const sources = section.sources
    ? `<p class="pmi-sources">Kaynak: ${escapeHtml(section.sources.join(" · "))}</p>`
    : "";

  return `<article class="card pmi-section" id="pmi-${escapeHtml(section.id)}" data-pmi-section="${escapeHtml(section.id)}">
    <div class="pmi-section-head">
      <h3>${escapeHtml(section.title)}</h3>
      ${confidenceBadge(section.confidence)}
    </div>
    ${metrics}
    ${readings}${lines}${performers}
    ${note}
    ${derivedNote(section.derived)}
    ${sources}
  </article>`;
}

function intelligenceDashboard(match) {
  const intelligence = buildPostMatchIntelligence(match);
  if (!intelligence.sections.length) return "";

  return `<section class="post-match-section pmi-dashboard" aria-labelledby="rapor-analiz">
    <div class="section-head"><div class="section-title">
      <span class="section-kicker">Maç sonrası analiz</span>
      <h2 id="rapor-analiz">Veri panosu</h2>
      <p>Her bölüm yalnızca bu maç için ölçülmüş istatistiklerden üretildi; verisi olmayan analiz hiç gösterilmiyor.</p>
    </div></div>
    <div class="pmi-grid">${intelligence.sections.map((section) => intelligenceSectionHtml(section, match)).join("")}</div>
  </section>`;
}

function standoutSection(report) {
  const block = report.sections.standoutPlayers;
  if (block.status !== "ready") return noteCard(block.reason);
  return `<div class="post-match-standouts">${block.players.map((player) => `<article class="card post-match-standout" data-impact="${escapeHtml(player.impact)}">
    ${playerPhotoHtml(player)}
    <span class="card-kicker">${escapeHtml(player.team)}</span>
    <h3>${escapeHtml(player.name)}</h3>
    <p>${escapeHtml(player.contribution)}</p>
  </article>`).join("")}</div>`;
}

/**
 * Momentum: ölçülen olay dağılımı. Çubuklar uydurma bir eğri değil, dilim
 * başına düşen gerçek olay sayısı — bu yüzden sayılar da yazılıyor.
 */
function momentumSection(report) {
  const block = report.sections.momentum;
  if (block.status !== "ready") return noteCard(block.reason);

  const bars = block.phases.map((phase) => {
    const total = phase.home + phase.away;
    const homePct = total ? Math.round((phase.home / total) * 100) : 50;
    return `<div class="pm-momentum-row">
      <span class="pm-momentum-label">${escapeHtml(phase.label)}</span>
      <span class="pm-momentum-bar" role="img" aria-label="${escapeHtml(`${phase.label}: ${phase.home}-${phase.away}`)}">
        <b style="width:${total ? homePct : 0}%"></b>
      </span>
      <span class="pm-momentum-count">${phase.home}-${phase.away}</span>
    </div>`;
  }).join("");

  return `<div class="card pm-momentum">
    <p class="pm-momentum-meta">${escapeHtml(`${block.sampleSize} dakikalı olaydan türetildi · güven: ${block.confidence}`)}</p>
    ${bars}
    <ul class="pm-momentum-readings">${block.readings.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>
  </div>`;
}

/**
 * Takım sinyalleri. Her sinyal hangi ölçüden geldiğini taşır; okuyucu
 * "sinyal" kelimesine güvenmek zorunda kalmaz, sayıyı görür.
 */
function signalsSection(report) {
  const block = report.sections.signals;
  if (block.status !== "ready") return noteCard(block.reason);

  return `<div class="pm-signals">${block.signals.map((signal) => `<article class="card pm-signal${signal.strong ? " is-strong" : ""}">
    <span class="card-kicker">${escapeHtml(signal.label)}</span>
    <strong>${escapeHtml(signal.team)}</strong>
    <p>${escapeHtml(`${signal.metric}: ${signal.value}`)}</p>
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

/**
 * Maç sonu açıklamaları: sayfanın başında kayan şerit, gövdesinde tam liste.
 *
 * Bölüm doğrulanmış açıklama yokken de basılır ve "Kaynaklardan bekleniyor"
 * der. Gizlemek, okuyucuya "kimse konuşmadı" diye okunurdu.
 */
function statementsBlocks(match) {
  const result = publishableStatements(match);
  logExcludedStatements(`post-match:${match.id}`, result.excluded);

  const feed = statementTickerItems([match], { limit: 6 });
  const awaitingNote = "Bu karşılaşma için doğrulanmış bir teknik direktör ya da futbolcu açıklaması henüz yayımlanmadı.";

  return {
    marquee: statementsMarqueeHtml(feed, { awaitingNote }),
    list: statementsListHtml(result, { awaitingNote }),
    count: result.statements.length
  };
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

  // Boşken TEK BAYT bile eklemiyoruz: boş bir interpolasyon, deponun hiç
  // yazılmadığı bugünkü durumda yirmi HTML dosyasına boş satır farkı
  // basardı — anlamsız üretim gürültüsü.
  const enrichmentHtml = enrichmentSection(enrichmentStore[match.id] || null);
  const enrichmentBlock = enrichmentHtml ? `\n\n      ${enrichmentHtml}` : "";

  // Maç sonu açıklamaları: şerit sayfanın başında, tam liste gövdesinde.
  // İkisi de aynı doğrulanmış listeden üretilir; şerit kısaltır, liste
  // alıntının tamamını ve kaynağını gösterir.
  const statements = statementsBlocks(match);

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
    ${siteHeader({ base: depth })}
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

      ${statements.marquee}

      ${kpiSection(match)}

      <section class="post-match-section" aria-labelledby="rapor-ozet">
        <div class="section-head"><div class="section-title"><span class="section-kicker">Rapor</span><h2 id="rapor-ozet">Maç özeti</h2><p>Sonuç, goller ve karşılaşmanın künyesi.</p></div></div>
        ${summarySection(report)}
      </section>

      <section class="post-match-section" aria-labelledby="rapor-oyuncu">
        <div class="section-head"><div class="section-title"><span class="section-kicker">Rapor</span><h2 id="rapor-oyuncu">Öne çıkan oyuncular</h2><p>Gol, asist, kart ve kritik aksiyon kayıtlarından çıkarılan katkılar.</p></div></div>
        ${standoutSection(report)}
      </section>

      ${intelligenceDashboard(match)}

      <section class="post-match-section" aria-labelledby="rapor-momentum">
        <div class="section-head"><div class="section-title"><span class="section-kicker">Rapor</span><h2 id="rapor-momentum">Maç momentumu</h2><p>Dakikalı olay akışından çıkarılan bölüm bölüm üstünlük dağılımı.</p></div></div>
        ${momentumSection(report)}
      </section>

      <section class="post-match-section" aria-labelledby="rapor-sinyal">
        <div class="section-head"><div class="section-title"><span class="section-kicker">Rapor</span><h2 id="rapor-sinyal">Takım sinyalleri</h2><p>Her sinyal tek bir ölçülmüş istatistiğe dayanır; ölçü yoksa sinyal üretilmez.</p></div></div>
        ${signalsSection(report)}
      </section>

      <section class="post-match-section" aria-labelledby="rapor-istatistik">
        <div class="section-head"><div class="section-title"><span class="section-kicker">Rapor</span><h2 id="rapor-istatistik">İstatistik analizi</h2><p>${escapeHtml(match.homeTeam)} ve ${escapeHtml(match.awayTeam)} verilerinin karşılaştırmalı okuması.</p></div></div>
        ${statisticsSection(report, match)}
      </section>${enrichmentBlock}

      <section class="post-match-section" aria-labelledby="rapor-aciklama">
        <div class="section-head"><div class="section-title"><span class="section-kicker">Rapor</span><h2 id="rapor-aciklama">Maç sonu açıklamaları</h2><p>Teknik direktör ve futbolcuların maç sonrası sözleri; yalnızca kaynağı gösterilebilen alıntılar.</p></div></div>
        ${statements.list}
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
    ${siteFooter({ base: depth })}
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

/**
 * Ana sayfa: SON maç raporları listesi.
 *
 * Önceki hâl yalnızca en son raporu gösteriyordu; okuyucu "geçen hafta ne
 * oynandı" sorusunun cevabını ana sayfada göremiyor, her rapora ancak Maç
 * Merkezi üzerinden ulaşabiliyordu.
 *
 * Her kartta kapsama oranı yazıyor: raporun ne kadarının ölçülmüş veriden
 * geldiği okuyucudan gizlenmiyor. Kapsaması düşük bir rapor da yayımlanır —
 * ama düşük olduğu söylenerek.
 */
function recentReportsBlock(entries) {
  const recent = entries.slice(0, 4);
  if (!recent.length) return "";

  const cards = recent.map(({ report, match }) => {
    const summary = report.sections.summary;
    const line = summary.status === "ready"
      ? summary.headline
      : `${match.homeTeam} - ${match.awayTeam}`;
    const measured = ["momentum", "signals", "statistics"]
      .filter((key) => report.sections[key] && report.sections[key].status === "ready").length;

    return `<a class="home-report-card" href="./${escapeHtml(report.seo.path)}">
      <span class="home-report-meta">${escapeHtml(match.league)} · ${escapeHtml(formatDate(match.kickoff))}</span>
      <strong class="home-report-score">${escapeHtml(`${match.homeTeam} ${match.score.home}-${match.score.away} ${match.awayTeam}`)}</strong>
      <p class="home-report-line">${escapeHtml(line)}</p>
      <span class="home-report-coverage">${escapeHtml(`Veri kapsamı %${report.coverage}`)}${measured ? escapeHtml(` · ${measured}/3 ölçüm hazır`) : ""}</span>
    </a>`;
  }).join("");

  return `<section class="container section home-recent-reports" aria-labelledby="home-recent-reports-title">
    <div class="section-head"><div class="section-title">
      <span class="section-kicker">Maç sonrası analizler</span>
      <h2 id="home-recent-reports-title">Son tamamlanan maçların raporları</h2>
      <p>Momentum, takım sinyalleri ve istatistik okumasıyla; yalnızca ölçülmüş veriden.</p>
    </div><a class="section-link" href="./mac-merkezi.html">Tüm raporlar</a></div>
    <div class="home-report-grid">${cards}</div>
  </section>`;
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
 * ANA SAYFA: canlı maç alanının altında kısa "Maç Sonu Açıklamaları" şeridi.
 *
 * Şerit BİRDEN ÇOK maçtan beslenir (en yeni biten maçtan geriye), çünkü ana
 * sayfa tek bir maçın sayfası değil. Doğrulanmış hiç alıntı yoksa şerit
 * kaldırılmaz; "Kaynaklardan bekleniyor" der ve okuyucu bunun bir veri
 * durumu olduğunu görür.
 */
function addHomeStatementsMarquee(entries) {
  const reportPathById = new Map(entries.map(({ report, match }) => [match.id, report.seo.path]));
  const matches = entries.map(({ match }) => match);

  const feed = statementTickerItems(matches, {
    limit: 6,
    href: (match) => {
      const reportPath = reportPathById.get(match.id);
      return reportPath ? `./${reportPath}` : null;
    }
  });

  const marquee = statementsMarqueeHtml(feed, {
    awaitingNote: "Son tamamlanan maçlar için doğrulanmış bir teknik direktör ya da futbolcu açıklaması henüz yayımlanmadı."
  });

  // Başlık ayrı bir <h2> değil: şeridin kendi rozeti zaten "Maç Sonu
  // Açıklamaları" yazıyor ve aria-label aynı adı taşıyor. Görsel olarak
  // gizlenmiş ikinci bir başlık, ekran okuyucuda aynı şeyi iki kez okuturdu.
  const block = `<section class="container section home-statements" aria-label="Maç Sonu Açıklamaları">
    ${marquee}
  </section>`;

  replaceOrInsert(
    "index.html",
    "<!-- match-statements:start -->",
    "<!-- match-statements:end -->",
    block,
    '<section class="container section home-post-match"'
  );
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
  addHomeStatementsMarquee(generated);
  // Ana sayfadaki tek "son rapor" vitrinini, son raporların listesiyle
  // değiştirir. Vitrin bloğunun kendisi addInternalLinks içinde duruyor;
  // bu blok onun altına, ayrı bir işaretleyici arasına yazılıyor.
  replaceOrInsert(
    "index.html",
    "<!-- post-match-recent:start -->",
    "<!-- post-match-recent:end -->",
    recentReportsBlock(generated),
    '<section class="container section section-player-radar"'
  );
  addReportIndex(generated);
  upsertSitemap(generated.map((entry) => entry.report.seo.path));
}

const complete = generated.filter((entry) => entry.report.dataStatus === "complete").length;
console.log(`Generated ${generated.length} match report page(s) (${complete} complete, ${generated.length - complete} partial)`);
