import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const fixtures = JSON.parse(fs.readFileSync(path.join(root, "data", "super-lig-fixtures.json"), "utf8"));
const teams = JSON.parse(fs.readFileSync(path.join(root, "data", "teams.json"), "utf8"));
const momentum = JSON.parse(fs.readFileSync(path.join(root, "data", "momentum.json"), "utf8"));
const signals = JSON.parse(fs.readFileSync(path.join(root, "data", "signals.json"), "utf8"));
const analyses = JSON.parse(fs.readFileSync(path.join(root, "data", "analyses.json"), "utf8"));
const news = JSON.parse(fs.readFileSync(path.join(root, "data", "news.json"), "utf8"));
const freshnessData = JSON.parse(fs.readFileSync(path.join(root, "data", "freshness.json"), "utf8"));
const squadStatus = JSON.parse(fs.readFileSync(path.join(root, "data", "squad-statuses.json"), "utf8"));
const rawPlayers = JSON.parse(fs.readFileSync(path.join(root, "data", "players.json"), "utf8"));
const matchesData = JSON.parse(fs.readFileSync(path.join(root, "data", "matches.json"), "utf8"));
const transfers = JSON.parse(fs.readFileSync(path.join(root, "data", "transfers.json"), "utf8"));
const { getPlayers, formatMarketValueEur } = require("../services/playerService.js");
const { calculateMatchRadar, normalizeText } = require("../services/matchRadarService.js");
const { confidenceLabel, formatFreshnessDate, freshnessLabel, normalizeFreshness } = require("../services/freshnessService.js");

const players = getPlayers(rawPlayers);
const fixtureFreshness = normalizeFreshness(fixtures.freshness || freshnessData.records.fixtures);
const teamFreshness = normalizeFreshness(freshnessData.records.teamRadar);
const playerFreshness = normalizeFreshness(freshnessData.records.players);
const seasonUpdated = formatFreshnessDate(fixtureFreshness.verifiedAt || fixtureFreshness.fetchedAt);

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function slug(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function matchSlug(match) {
  return `${slug(match.homeTeam)}-${slug(match.awayTeam)}-${fixtures.season}-r${String(match.round).padStart(2, "0")}`;
}

function allFixtures() {
  return (fixtures.rounds || []).flatMap((round) => (round.matches || []).map((match) => ({
    ...match,
    round: round.round,
    roundLabel: round.label,
    dateRange: match.dateLabel || round.dateRange || "Tarih ve saat bekleniyor",
    league: fixtures.league,
    freshness: fixtures.freshness
  }))).filter((match) => match.fixtureStatus === "confirmed-pairing");
}

function teamByName(name) {
  return teams.find((team) => normalizeText(team.name) === normalizeText(name)) || null;
}

function radarFor(match) {
  return calculateMatchRadar(match, { teams, players, squadStatus });
}

function formDots(form) {
  const rows = Array.isArray(form) ? form : [];
  if (!rows.length) {
    return '<span class="muted-copy">Son maç formu henüz teyit edilmedi.</span>';
  }

  return `<div class="form-dots">${rows.map((item) => {
    const label = item.label || item.result || "-";
    const value = normalizeText(item.result || label);
    const state = value === "win" || value === "g" ? "win" : value === "loss" || value === "m" ? "loss" : "draw";
    return `<span class="form-dot ${state}">${escapeHtml(label)}</span>`;
  }).join("")}</div>`;
}

function staticMatchCard(match, variant) {
  const radar = radarFor(match);
  const homeScore = radar.home.score === null ? "Bekleniyor" : `${radar.home.score}/100`;
  const awayScore = radar.away.score === null ? "Bekleniyor" : `${radar.away.score}/100`;
  const label = variant === "live" ? "Canlı maç yok" : match.roundLabel;
  const lead = variant === "live"
    ? "Şu an doğrulanmış canlı Süper Lig maçı bulunmuyor. Sezonun onaylı ilk eşleşmelerini aşağıdan inceleyebilirsin."
    : "Eşleşme fikstürde yer alıyor; tarih, saat ve kadro bilgileri açıklandıkça bu sayfa güncellenecek.";

  return `<article class="card match-card static-match-card" data-card="fixture-preview" data-match="${escapeHtml(match.id)}">
    <div class="card-head"><span class="card-kicker">${escapeHtml(label)} · ${escapeHtml(match.dateRange)}</span><strong class="big-value">${escapeHtml(match.roundLabel)}</strong></div>
    <h2>${escapeHtml(match.homeTeam)} - ${escapeHtml(match.awayTeam)}</h2>
    <p>${escapeHtml(lead)}</p>
    <div class="match-teams"><div class="team-line"><span>${escapeHtml(match.homeTeam)}</span><span>Radar ${escapeHtml(homeScore)}</span></div><div class="team-line"><span>${escapeHtml(match.awayTeam)}</span><span>Radar ${escapeHtml(awayScore)}</span></div></div>
    <div class="tag-row"><span class="tag green">${escapeHtml(confidenceLabel(fixtureFreshness.confidence))}</span><span class="tag soft">Fikstür eşleşmesi</span></div>
    <a class="detail-link" href="./mac/${escapeHtml(matchSlug(match))}.html">Maç öncesi analizi aç</a>
  </article>`;
}

function emptyMatchState(variant) {
  const isFeatured = variant === "featured";
  const isLive = variant === "live";
  if (isFeatured) {
    return `<div class="home-match-command">
      <div class="home-match-command-head"><div><span>Bugünün maç merkezi</span><strong>Program kontrol ediliyor</strong></div><a href="./bugunun-maclari.html">Tümünü aç</a></div>
      <div class="home-match-command-metrics" aria-label="Bugünün maç özeti"><a href="./canli-skor.html"><span><span class="live-pulse" aria-hidden="true"></span> Canlı</span><b class="live-number">0</b></a><a href="./bugunun-maclari.html?status=upcoming"><span>Başlayacak</span><b>0</b></a><a href="./bugunun-maclari.html?status=finished"><span>Tamamlanan</span><b>0</b></a><a href="./bugunun-maclari.html"><span>Aktif lig</span><b>0</b></a></div>
      <div class="home-match-command-empty"><strong>Maç programı yükleniyor.</strong><span>Bugünün doğrulanmış karşılaşmaları burada listelenecek.</span></div>
      <div class="home-match-command-actions featured-match-actions"><a class="button primary" href="./bugunun-maclari.html">Maç programı</a><a class="button secondary" href="./canli-skor.html">Canlı skor</a></div>
    </div>`;
  }
  const title = isFeatured
    ? "Bugünün maç merkezi"
    : isLive
      ? "Şu anda canlı maç yok"
      : "Bugün doğrulanmış maç yok";
  const text = isFeatured
    ? "Bugünün doğrulanmış karşılaşmaları burada listelenecek."
    : isLive
      ? "Canlı maç başladığında skor, tempo ve maç içi sinyaller bu alanda görünecek."
      : "Bugünün maç listesi doğrulandığında burada gösterilecek. Sezon eşleşmelerini fikstür sayfasından inceleyebilirsin.";
  const tag = isLive ? "Canlı akış bekleniyor" : "Günlük maç akışı bekleniyor";
  const element = isFeatured ? "div" : "article";

  return `<${element} class="data-empty${isFeatured ? " compact" : ""}" data-card="empty-state">
    <strong>${escapeHtml(title)}</strong>
    <span>${escapeHtml(text)}</span>
    <div class="match-empty-actions">
      <a class="detail-link" href="./bugunun-maclari.html">Günün tüm maçlarını aç</a>
      <a class="detail-link ghost" href="./super-lig-fikstur.html">Sezon fikstürüne git</a>
      <span class="tag soft">${escapeHtml(tag)}</span>
    </div>
  </${element}>`;
}

function homeFeature(match) {
  const radar = radarFor(match);
  const homeScore = radar.home.score === null ? "Bekleniyor" : `${radar.home.score}/100`;
  const awayScore = radar.away.score === null ? "Bekleniyor" : `${radar.away.score}/100`;
  return `<div class="match-top"><span class="status-dot">Fikstürden öne çıkan</span><span class="match-date">${escapeHtml(match.roundLabel)} · ${escapeHtml(match.dateRange)}</span></div>
    <div class="versus"><div class="club"><b>${escapeHtml(match.homeTeam)}</b><span>Radar: ${escapeHtml(homeScore)}</span></div><span class="vs-pill">VS</span><div class="club"><b>${escapeHtml(match.awayTeam)}</b><span>Radar: ${escapeHtml(awayScore)}</span></div></div>
    <div class="prediction-grid"><div class="prediction"><span>Fikstür durumu</span><b>${escapeHtml(freshnessLabel(fixtureFreshness))}</b></div><div class="prediction"><span>Son kontrol</span><b>${escapeHtml(seasonUpdated)}</b></div><div class="prediction"><span>Radar güveni</span><b>${escapeHtml(confidenceLabel(fixtureFreshness.confidence))}</b></div></div>
    <div class="player-actions match-actions featured-match-actions"><a class="detail-link" href="./mac/${escapeHtml(matchSlug(match))}.html">Maç öncesi analizi aç</a><a class="detail-link ghost" href="./super-lig-fikstur.html">Tüm fikstüre git</a></div>`;
}

function signalCards() {
  return (signals.radarSignals || []).slice(0, 3).map((signal) => `<article class="signal-card" data-card="radar-signal" data-signal="${escapeHtml(signal.id)}"><span class="signal-label">${escapeHtml(signal.label)}</span><h3>${escapeHtml(signal.title)}</h3><strong class="signal-value">${escapeHtml(signal.value || "Takipte")}</strong><p>${escapeHtml(signal.description)}</p></article>`).join("");
}

function metricBarRow(label, value) {
  const width = Math.max(0, Math.min(100, Number(value) || 0));
  return `<div class="bar-row"><span>${escapeHtml(label)}</span><span class="bar"><i style="--value: ${width}%"></i></span><b>${escapeHtml(value)}</b></div>`;
}

function teamTagRow(tags) {
  if (!Array.isArray(tags) || !tags.length) {
    return "";
  }
  return `<div class="tag-row">${tags.map((tag) => `<span class="tag${tag.variant ? ` ${escapeHtml(tag.variant)}` : ""}">${escapeHtml(tag.label)}</span>`).join("")}</div>`;
}

function staticTeamCard(team) {
  return `<article class="card" id="${escapeHtml(team.id)}" data-card="team" data-team="${escapeHtml(team.id)}"><div class="card-head"><div><span class="card-kicker">${escapeHtml(team.league || "Süper Lig")}</span><h2>${escapeHtml(team.name)}</h2></div><strong class="big-value">${escapeHtml(team.momentum)}</strong></div>${formDots(team.form)}${metricBarRow("Hücum", team.attack)}${metricBarRow("Savunma", team.defense)}<div class="metric-grid compact"><span>Form puanı <b>${escapeHtml(team.formScore)}</b></span><span>Gol eğilimi <b>${escapeHtml(team.goalTrend)}</b></span></div>${teamTagRow(team.tags)}<div class="team-card-actions"><a class="detail-link" href="./takim-detay.html?team=${encodeURIComponent(team.id)}">Takım detayı</a><a class="detail-link ghost" href="./oyuncu-radari.html?team=${encodeURIComponent(team.name)}">Oyuncu radarı</a></div></article>`;
}

function staticStandingRows() {
  return standingsPreseason(false);
}

function staticHomeStandingRows() {
  return standingsPreseason(true);
}

function standingsPreseason(compact) {
  return `<div class="standings-empty${compact ? " compact" : ""}" data-card="standings-preseason"><span class="card-kicker">Süper Lig · 2026/27</span><strong>2026/27 sezonu henüz başlamadı</strong><span class="status-badge upcoming" data-season-start="${escapeHtml(fixtures.seasonStart || "")}">Süper Lig ${escapeHtml(seasonStartLabel())}'ta başlıyor</span><p>Süper Lig 14 Ağustos'ta başlayacak. İlk maçlar tamamlandığında puan tablosu otomatik güncellenecek.</p><a class="detail-link" href="./super-lig-fikstur.html">Sezon fikstürünü aç</a></div>`;
}

function riskVariant(value) {
  const key = normalizeText(value);
  if (key === "dusuk") return "low";
  if (key === "yuksek") return "high";
  return "medium";
}

function staticMomentumRows() {
  return momentum.slice().sort((left, right) => Number(left.rank) - Number(right.rank)).map((row) => `<div class="table-row" data-card="momentum" data-team="${escapeHtml(row.team)}"><span>${escapeHtml(row.rank)}</span><b>${escapeHtml(row.team)}</b><span>${escapeHtml(row.momentum)}</span><span>${escapeHtml(row.formScore)}</span><span>${escapeHtml(row.goalSignal)}</span><span class="risk-badge ${riskVariant(row.risk)}">${escapeHtml(row.risk)}</span></div>`).join("");
}

function simplePlayerCard(player) {
  const rating = player.overallRating || player.aiRating || player.rating || "-";
  const age = player.computedAge || player.age || "Bilinmiyor";
  return `<article class="card player-detail-card" data-card="player" data-player="${escapeHtml(player.id)}"><div class="card-head"><div><span class="card-kicker">${escapeHtml(player.currentTeam || player.team)} · ${escapeHtml(player.position)}</span><h2>${escapeHtml(player.name)}</h2></div><strong class="big-value player-rating-badge">${escapeHtml(rating)}</strong></div><div class="metric-grid compact"><span>Yaş <b>${escapeHtml(age)}</b></span><span>Dakika <b>${escapeHtml(player.minutesPlayed ?? "Veri yok")}</b></span><span>Piyasa <b>${escapeHtml(formatMarketValueEur(player.marketValueEur) || "Yakında")}</b></span></div><p>${escapeHtml(player.summary || "Profil metrikleri ve transfer geçmişi oyuncu sayfasında yer alır.")}</p><a class="detail-link" href="./oyuncular/${escapeHtml(player.id)}.html">Oyuncu profilini aç</a></article>`;
}

function playerSignals() {
  const by = (field) => players.slice().sort((left, right) => Number(right[field] || 0) - Number(left[field] || 0))[0];
  const cards = [
    ["AI rating", by("overallRating"), "overallRating"],
    ["Gol tehdidi", by("threatScore"), "threatScore"],
    ["Yaratıcılık", by("creativityScore"), "creativityScore"]
  ];
  return cards.map(([label, player, field]) => `<article class="card player-signal-card"><span class="card-kicker">${escapeHtml(label)}</span><h3>${escapeHtml(player.name)}</h3><strong>${escapeHtml(player[field] || "-" )}</strong><p>${escapeHtml(player.currentTeam || player.team)} · ${escapeHtml(player.position)}</p><a href="./oyuncular/${escapeHtml(player.id)}.html">Profili aç</a></article>`).join("");
}

function analysisCards() {
  return analyses.map((analysis) => `<article class="article-card" data-card="analysis" id="${escapeHtml(analysis.id)}-preview"><div><h3>${escapeHtml(analysis.title)}</h3><p>${escapeHtml(analysis.summary)}</p></div><a href="${escapeHtml(analysis.url)}">Analizi aç</a></article>`).join("");
}

function newsCards(limit) {
  return news.slice(0, limit || news.length).map((item) => `<article class="news-card" data-card="news" data-news="${escapeHtml(item.id)}"><div class="news-card-meta"><span class="tag green">${escapeHtml(item.category || "Futbol Gündemi")}</span><time datetime="${escapeHtml(item.publishedAt || "")}">${escapeHtml(formatFreshnessDate(item.publishedAt) || "Tarih açıklanmadı")}</time></div><div><span class="card-kicker">${escapeHtml(item.team || item.sourceName || "FutbolRadar")}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.summary)}</p></div><div class="news-card-footer"><span>${escapeHtml(item.sourceName || "Resmî kaynak")}</span><a class="detail-link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">Resmî açıklamayı aç</a></div></article>`).join("");
}

function fixtureRounds() {
  return (fixtures.rounds || []).map((round) => `<section class="fixture-round-card" data-card="fixture-round"><div class="fixture-round-head"><div><span>${escapeHtml(round.dateRange || "Tarih ve saat bekleniyor")}</span><h2>${escapeHtml(round.label)}</h2></div><b>Onaylı eşleşmeler</b></div><div class="fixture-match-list">${(round.matches || []).map((match) => `<a class="fixture-match-row" href="./mac/${escapeHtml(matchSlug({ ...match, round: round.round }))}.html"><span class="fixture-time">${escapeHtml(match.dateLabel || round.label)}</span><strong>${escapeHtml(match.homeTeam)}</strong><span class="vs-pill">VS</span><strong>${escapeHtml(match.awayTeam)}</strong></a>`).join("")}</div></section>`).join("");
}

function transferWatch() {
  const selected = transfers.slice().sort((left, right) => String(right.date || "").localeCompare(String(left.date || ""))).slice(0, 5);
  if (!selected.length) {
    return '<article class="data-empty"><strong>Kesinleşen transfer bulunamadı</strong><span>Yeni kulüp açıklamaları geldiğinde bu alan güncellenir.</span></article>';
  }

  const leader = selected[0];
  return `<article class="home-transfer-feature" data-card="home-transfer-watch"><div class="home-transfer-player"><div><span>Son kesinleşen transfer</span><h3>${escapeHtml(leader.playerName)}</h3><p>${escapeHtml(leader.type || "Transfer")} · ${escapeHtml(leader.date)}</p></div></div><div class="home-transfer-route"><b>${escapeHtml(leader.fromTeam)}</b><em>→</em><b>${escapeHtml(leader.toTeam)}</b></div><div class="home-transfer-actions"><a class="detail-link" href="${escapeHtml(leader.sourceUrl)}" target="_blank" rel="noopener noreferrer">Transfer detayını aç</a><a class="detail-link ghost" href="./transfer-radari.html">Tüm transferler</a></div></article><aside class="home-transfer-side"><div class="home-transfer-list">${selected.slice(1).map((transfer) => `<a class="home-transfer-row" href="./transfer-radari.html?team=${encodeURIComponent(transfer.toTeam || "")}"><span>${escapeHtml(transfer.date)}</span><strong>${escapeHtml(transfer.playerName)}</strong><b>${escapeHtml(transfer.toTeam)}</b></a>`).join("")}</div></aside>`;
}

function replaceSlot(html, target, content) {
  if (!html.includes(`data-api-target="${target}"`)) {
    return html;
  }

  const markerStart = `<!-- prerender:${target}:start -->`;
  const markerEnd = `<!-- prerender:${target}:end -->`;
  const wrapped = `${markerStart}\n${content}\n${markerEnd}`;
  const targetExpression = new RegExp(`(data-api-target="${target}")(?![^>]*data-static-fallback)`);
  html = html.replace(targetExpression, "$1 data-static-fallback=\"true\"");

  if (html.includes(markerStart)) {
    const expression = new RegExp(`${markerStart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${markerEnd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
    return html.replace(expression, wrapped);
  }

  const targetIndex = html.indexOf(`data-api-target="${target}"`);
  const cardIndex = html.indexOf('data-card="empty-state"', targetIndex);
  if (cardIndex === -1) {
    return html;
  }

  const elementStart = html.lastIndexOf("<", cardIndex);
  const tagMatch = html.slice(elementStart, cardIndex).match(/^<([a-z0-9-]+)/i);
  if (!tagMatch) {
    return html;
  }

  const closing = `</${tagMatch[1]}>`;
  const elementEnd = html.indexOf(closing, cardIndex);
  if (elementEnd === -1) {
    return html;
  }

  return `${html.slice(0, elementStart)}${wrapped}${html.slice(elementEnd + closing.length)}`;
}

function updateMetaLabels(html, freshness) {
  const label = `Son kontrol: ${formatFreshnessDate(freshness.verifiedAt || freshness.fetchedAt)}`;
  return html
    .replace(/<span class="hero-meta">Son güncelleme:[^<]*<\/span>/g, `<span class="hero-meta">${escapeHtml(label)}</span>`)
    .replace(/<span class="data-stamp">Son güncelleme:[^<]*<\/span>/g, `<span class="data-stamp">${escapeHtml(label)}</span>`);
}

const noindexShellPages = new Set([
  "takim-detay.html",
  "oyuncu-detay.html",
  "mac-detay.html",
  "oyuncu-karsilastir.html"
]);

function updateRobotsDirective(html, file) {
  const directive = noindexShellPages.has(file) ? "noindex,follow" : "index,follow";
  return html.replace(
    /<meta\s+name="robots"\s+content="(?:index,follow|noindex,follow)"\s*\/>/i,
    `<meta name="robots" content="${directive}" />`
  );
}

function writePage(file, slots, freshness) {
  const sourcePath = path.join(root, file);
  if (!fs.existsSync(sourcePath)) {
    return;
  }

  let html = fs.readFileSync(sourcePath, "utf8");
  Object.entries(slots).forEach(([target, content]) => {
    html = replaceSlot(html, target, content);
  });
  html = updateMetaLabels(html, freshness);
  html = updateRobotsDirective(html, file);
  fs.writeFileSync(sourcePath, html, "utf8");
  fs.writeFileSync(path.join(root, "public", file), html, "utf8");
}

const confirmed = allFixtures();
const topFixtures = confirmed.slice(0, 3);
const topTeams = teams.slice().sort((left, right) => Number(right.momentum) - Number(left.momentum));

const BIG_TEAM_IDS = ["galatasaray", "fenerbahce", "besiktas", "trabzonspor"];
const BIG_TEAM_NAMES = new Set(["Galatasaray", "Fenerbahçe", "Beşiktaş", "Trabzonspor"]);
const TR_MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

function seasonStartLabel() {
  const raw = String(fixtures.seasonStart || "");
  const parts = raw.split("-");
  if (parts.length !== 3) return raw;
  return `${Number(parts[2])} ${TR_MONTHS[Number(parts[1]) - 1] || ""}`;
}

function radarTicker() {
  const items = [];
  if (fixtures.seasonStart) {
    items.push(`<a href="./super-lig-fikstur.html" data-season-start="${escapeHtml(fixtures.seasonStart)}"><span>Geri sayım</span><b>Süper Lig ${escapeHtml(fixtures.season)} sezonu ${escapeHtml(seasonStartLabel())}'ta başlıyor</b></a>`);
  }
  for (const item of news.slice(0, 3)) {
    items.push(`<a href="./haberler.html"><span>${escapeHtml(item.category || "Gündem")}</span><b>${escapeHtml(item.title)}</b></a>`);
  }
  const latestTransfers = transfers.slice().sort((left, right) => String(right.date || "").localeCompare(String(left.date || ""))).slice(0, 2);
  for (const transfer of latestTransfers) {
    items.push(`<a href="./transfer-radari.html"><span>Transfer</span><b>${escapeHtml(transfer.playerName)} → ${escapeHtml(transfer.toTeam)}</b></a>`);
  }
  for (const watch of (fixtures.watchList || []).slice(0, 1)) {
    items.push(`<a href="./super-lig-fikstur.html"><span>Fikstür</span><b>${escapeHtml(watch.label)}: ${escapeHtml(watch.value)}</b></a>`);
  }
  if (!items.length) {
    return `<span class="radar-ticker-label"><span class="live-pulse" aria-hidden="true"></span>Radar Akışı</span><div class="radar-ticker-track"><a href="./haberler.html"><span>Gündem</span><b>Doğrulanmış gelişmeler burada akacak</b></a></div>`;
  }
  return `<span class="radar-ticker-label"><span class="live-pulse" aria-hidden="true"></span>Radar Akışı</span><div class="radar-ticker-track">${items.join("")}</div>`;
}

function fixturePopularCard(match) {
  const homeInitial = String(match.homeTeam || "?").charAt(0).toLocaleUpperCase("tr-TR");
  const awayInitial = String(match.awayTeam || "?").charAt(0).toLocaleUpperCase("tr-TR");
  return `<article class="popular-card" data-card="fixture-popular"><div class="popular-card-top"><span class="popular-card-league">Süper Lig · ${escapeHtml(match.roundLabel || "Fikstür")}</span><span class="status-badge upcoming">${escapeHtml(match.dateRange || "Tarih bekleniyor")}</span></div><div class="popular-fixture"><div class="popular-side"><span class="logo-fallback" style="width:46px;height:46px" aria-hidden="true">${escapeHtml(homeInitial)}</span><strong>${escapeHtml(match.homeTeam)}</strong></div><div class="popular-score"><span class="vs">VS</span></div><div class="popular-side"><span class="logo-fallback" style="width:46px;height:46px" aria-hidden="true">${escapeHtml(awayInitial)}</span><strong>${escapeHtml(match.awayTeam)}</strong></div></div><div class="popular-card-foot"><a class="cta-button small" href="./mac/${escapeHtml(matchSlug(match))}.html">Maç radarını aç</a></div></article>`;
}

function upcomingKickoffLabel(kickoff) {
  const raw = String(kickoff || "");
  const dateMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!dateMatch) return "";
  const label = `${Number(dateMatch[3])} ${TR_MONTHS[Number(dateMatch[2]) - 1] || ""}`;
  const timeMatch = raw.match(/T(\d{2}):(\d{2})/);
  return timeMatch ? `${label} ${timeMatch[1]}.${timeMatch[2]}` : label;
}

function liveScoreFallback() {
  const upcoming = (Array.isArray(matchesData) ? matchesData : [])
    .filter((match) => ["SCHEDULED", "TIMED", "NOT_STARTED", "NS"].includes(String(match.status || "").toUpperCase()))
    .filter((match) => String(match.kickoff || "") >= String(new Date().toISOString().slice(0, 10)))
    .sort((left, right) => String(left.kickoff || "").localeCompare(String(right.kickoff || "")))
    .slice(0, 3);

  const empty = emptyMatchState("live");
  if (!upcoming.length) {
    return empty;
  }

  const cards = upcoming.map((match) => {
    const dateOnly = String(match.kickoff || "").slice(0, 10);
    return `<a class="analysis-card" data-card="live-upcoming" href="./bugunun-maclari.html?date=${escapeHtml(dateOnly)}"><span class="analysis-kicker">${escapeHtml(match.league || "Maç")} · ${escapeHtml(upcomingKickoffLabel(match.kickoff))}</span><div class="analysis-card-title"><h3>${escapeHtml(match.homeTeam)} – ${escapeHtml(match.awayTeam)}</h3></div><p>Maç başladığında canlı skor ve tempo bu sayfada yayınlanacak.</p></a>`;
  }).join("");

  return `${empty}<div class="section-header live-upcoming-header"><div class="section-header-text"><span class="section-kicker">Sıradaki program</span></div></div><div class="analysis-grid live-upcoming-strip">${cards}</div>`;
}

function fixtureShowcase() {
  const opening = confirmed.filter((match) => match.round === 1);
  const prioritized = [
    ...opening.filter((match) => BIG_TEAM_NAMES.has(match.homeTeam) || BIG_TEAM_NAMES.has(match.awayTeam)),
    ...opening.filter((match) => !BIG_TEAM_NAMES.has(match.homeTeam) && !BIG_TEAM_NAMES.has(match.awayTeam))
  ].slice(0, 3);
  if (!prioritized.length) {
    return emptyMatchState("today");
  }

  const ctaCard = `<article class="popular-card" data-card="fixture-cta"><div class="popular-card-top"><span class="popular-card-league">Süper Lig · ${escapeHtml(fixtures.season)}</span><span class="status-badge upcoming" data-season-start="${escapeHtml(fixtures.seasonStart || "")}">Sezon yaklaşıyor</span></div><h3>Sezon ${escapeHtml(seasonStartLabel())}'ta başlıyor</h3><p>Bugün doğrulanmış maç yok; açılış haftasının maç önü radar analizleri hazır.</p><div class="popular-card-foot"><a class="cta-button small" href="./super-lig-fikstur.html">Sezon fikstürü</a><a class="deep-link-button" href="./bugunun-maclari.html">Maç merkezi</a></div></article>`;
  return prioritized.map(fixturePopularCard).join("") + ctaCard;
}

function bigTeamCards() {
  const displayValue = (value) => (value === null || value === undefined || value === "" ? "—" : value);
  return BIG_TEAM_IDS
    .map((id) => teams.find((team) => team.id === id))
    .filter(Boolean)
    .map((team) => {
      const initial = String(team.name || "?").charAt(0).toLocaleUpperCase("tr-TR");
      const formSpans = Array.isArray(team.form)
        ? team.form.map((item) => `<span class="${escapeHtml(item.result || "")}">${escapeHtml(item.label)}</span>`).join("")
        : "";
      return `<article class="big-team-card" data-card="big-team" data-team="${escapeHtml(team.id)}"><div class="big-team-head"><span class="logo-fallback" style="width:44px;height:44px" aria-hidden="true">${escapeHtml(initial)}</span><div><strong>${escapeHtml(team.name)}</strong><span>${escapeHtml(team.league || "Süper Lig")}</span></div></div><div class="big-team-metrics"><div><b>${escapeHtml(displayValue(team.momentum))}</b><span>Momentum</span></div><div><b>${escapeHtml(displayValue(team.formScore))}</b><span>Form puanı</span></div><div><b>${escapeHtml(displayValue(team.goalTrend))}</b><span>Gol eğilimi</span></div></div>${formSpans ? `<div class="form-trend" aria-label="Son 5 maç">${formSpans}</div>` : ""}<div class="big-team-foot"><a class="deep-link-button" href="./${encodeURIComponent(team.id)}-form-durumu.html">Takım sayfası</a></div></article>`;
    })
    .join("");
}
const topPlayers = players.slice().sort((left, right) => Number(right.overallRating || 0) - Number(left.overallRating || 0));

writePage("index.html", {
  "featured-match": emptyMatchState("featured"),
  "radar-ticker": radarTicker(),
  "home-transfer-watch": transferWatch(),
  "today-matches": fixtureShowcase(),
  "home-big-teams": bigTeamCards(),
  "radar-signals": signalCards(),
  "home-standings": staticHomeStandingRows(),
  "player-radar": topPlayers.slice(0, 3).map(simplePlayerCard).join(""),
  "player-signals": playerSignals(),
  "news-preview": newsCards(4),
  "analysis-preview": analysisCards()
}, fixtureFreshness);

writePage("haberler.html", {
  "news-page": newsCards()
}, fixtureFreshness);

writePage("bugunun-maclari.html", {
  "matches-page": fixtureShowcase()
}, fixtureFreshness);

writePage("canli-skor.html", {
  "live-score": liveScoreFallback()
}, fixtureFreshness);

writePage("puan-durumu.html", {
  standings: staticStandingRows()
}, teamFreshness);

writePage("momentum.html", {
  momentum: staticMomentumRows(),
  "momentum-signals": (signals.momentumSignals || []).map((signal) => `<article class="card" data-card="momentum-signal"><span class="card-kicker">${escapeHtml(signal.label)}</span><h2>${escapeHtml(signal.title)}</h2><p>${escapeHtml(signal.description)}</p></article>`).join("")
}, teamFreshness);

writePage("takimlar.html", {
  "teams-page": topTeams.map(staticTeamCard).join("")
}, teamFreshness);

writePage("oyuncu-radari.html", {
  "players-page": topPlayers.slice(0, 6).map(simplePlayerCard).join("")
}, playerFreshness);

writePage("mac-detay.html", {
  "match-detail": `<article class="card match-detail-card"><span class="card-kicker">Süper Lig fikstürü</span><h2>Maç öncesi analiz sayfasını seç</h2><p>Onaylı eşleşmelerin form, kadro durumu ve radar puanı aynı kalıcı sayfada yer alır.</p><div class="match-empty-actions">${topFixtures.map((match) => `<a class="detail-link" href="./mac/${escapeHtml(matchSlug(match))}.html">${escapeHtml(match.homeTeam)} - ${escapeHtml(match.awayTeam)}</a>`).join("")}</div></article>`
}, fixtureFreshness);

writePage("super-lig-fikstur.html", {
  "super-lig-fixtures": `<section class="fixture-overview">${(fixtures.watchList || []).map((item) => `<article class="metric-tile"><strong>${escapeHtml(item.value)}</strong><span>${escapeHtml(item.label)}</span></article>`).join("")}</section><section class="fixture-note card"><span class="card-kicker">${escapeHtml(fixtures.league)} · ${escapeHtml(fixtures.season)}</span><h2>İlk iki haftanın eşleşmeleri açıklandı</h2><p>Tarih ve saat bilgileri açıklandıkça ilgili maç sayfaları güncellenecek.</p></section><section class="fixture-rounds">${fixtureRounds()}</section>`
}, fixtureFreshness);

for (const file of noindexShellPages) {
  const sourcePath = path.join(root, file);
  if (!fs.existsSync(sourcePath)) continue;
  const html = updateRobotsDirective(fs.readFileSync(sourcePath, "utf8"), file);
  fs.writeFileSync(sourcePath, html, "utf8");
  fs.writeFileSync(path.join(root, "public", file), html, "utf8");
}

console.log("Prerendered critical page fallbacks");
