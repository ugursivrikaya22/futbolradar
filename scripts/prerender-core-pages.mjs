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
const freshnessData = JSON.parse(fs.readFileSync(path.join(root, "data", "freshness.json"), "utf8"));
const squadStatus = JSON.parse(fs.readFileSync(path.join(root, "data", "squad-statuses.json"), "utf8"));
const rawPlayers = JSON.parse(fs.readFileSync(path.join(root, "data", "players.json"), "utf8"));
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
  const title = isFeatured
    ? "Günün radar maçı bekleniyor"
    : isLive
      ? "Şu anda canlı maç yok"
      : "Bugün doğrulanmış maç yok";
  const text = isFeatured
    ? "Bugünün doğrulanmış maçları geldiğinde form, momentum ve maç önü sinyalleri burada açılacak."
    : isLive
      ? "Canlı maç başladığında skor, tempo ve maç içi sinyaller bu alanda görünecek."
      : "Bugünün maç listesi doğrulandığında burada gösterilecek. Sezon eşleşmelerini fikstür sayfasından inceleyebilirsin.";
  const tag = isLive ? "Canlı akış bekleniyor" : "Günlük maç akışı bekleniyor";
  const element = isFeatured ? "div" : "article";

  return `<${element} class="data-empty${isFeatured ? " compact" : ""}" data-card="empty-state">
    <strong>${escapeHtml(title)}</strong>
    <span>${escapeHtml(text)}</span>
    <div class="match-empty-actions">
      <a class="detail-link" href="./super-lig-fikstur.html">Süper Lig fikstürünü aç</a>
      <a class="detail-link ghost" href="./puan-durumu.html">Puan durumuna git</a>
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

function staticTeamCard(team) {
  return `<article class="team-card" data-card="team-radar" data-team="${escapeHtml(team.id)}"><header><div><h3>${escapeHtml(team.name)}</h3><span>Sezon öncesi referans</span></div><strong class="momentum-number">${escapeHtml(team.momentum)}</strong></header>${formDots(team.form)}<div class="metric-grid compact"><span>Hücum <b>${escapeHtml(team.attack)}</b></span><span>Savunma <b>${escapeHtml(team.defense)}</b></span></div><a class="detail-link" href="./takim-detay.html?team=${encodeURIComponent(team.id)}">Takım radarını aç</a></article>`;
}

function staticStandingRows() {
  return teams.slice().sort((left, right) => Number(left.rank) - Number(right.rank)).map((team) => `<div class="table-row" data-card="standing-row" data-team="${escapeHtml(team.id)}"><span>${escapeHtml(team.rank)}</span><b>${escapeHtml(team.name)}</b><span>${escapeHtml(team.played)}</span><span>${escapeHtml(team.points)}</span><span>${escapeHtml(team.average)}</span><span>${escapeHtml(team.momentum)}</span></div>`).join("");
}

function staticHomeStandingRows() {
  return teams.slice().sort((left, right) => Number(left.rank) - Number(right.rank)).slice(0, 5).map((team) => `<div class="standing-row" data-card="standing-row" data-team="${escapeHtml(team.id)}"><span>${escapeHtml(team.rank)}</span><b>${escapeHtml(team.name)}</b><span>${escapeHtml(team.points)} P</span><span>${escapeHtml(team.momentum)} M</span></div>`).join("");
}

function staticMomentumRows() {
  return momentum.slice().sort((left, right) => Number(left.rank) - Number(right.rank)).map((row) => `<div class="table-row" data-card="momentum" data-team="${escapeHtml(row.team)}"><span>${escapeHtml(row.rank)}</span><b>${escapeHtml(row.team)}</b><span>${escapeHtml(row.momentum)}</span><span>${escapeHtml(row.formScore)}</span><span>${escapeHtml(row.goalSignal)}</span><span>${escapeHtml(row.risk)}</span></div>`).join("");
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

function fixtureRounds() {
  return (fixtures.rounds || []).map((round) => `<section class="fixture-round-card" data-card="fixture-round"><div class="fixture-round-head"><div><span>${escapeHtml(round.dateRange || "Tarih ve saat bekleniyor")}</span><h2>${escapeHtml(round.label)}</h2></div><b>Onaylı eşleşmeler</b></div><div class="fixture-match-list">${(round.matches || []).map((match) => `<a class="fixture-match-row" href="./mac/${escapeHtml(matchSlug({ ...match, round: round.round }))}.html"><span class="fixture-time">${escapeHtml(match.dateLabel || round.label)}</span><strong>${escapeHtml(match.homeTeam)}</strong><span class="vs-pill">VS</span><strong>${escapeHtml(match.awayTeam)}</strong></a>`).join("")}</div></section>`).join("");
}

function transferWatch() {
  const selected = players.filter((player) => Array.isArray(player.transferHistory) && player.transferHistory.length).slice(0, 3);
  if (!selected.length) {
    return '<article class="data-empty"><strong>İzlenecek transfer kaydı yok</strong><span>Yeni doğrulanmış transferler geldiğinde bu alan güncellenir.</span></article>';
  }

  return `<article class="home-transfer-feature" data-card="home-transfer-watch"><div class="home-transfer-player"><div><span>Transfer takibi</span><h3>${escapeHtml(selected[0].name)}</h3><p>${escapeHtml(selected[0].currentTeam || selected[0].team)} · ${escapeHtml(selected[0].position)}</p></div></div><div class="home-transfer-actions"><a class="detail-link" href="./oyuncular/${escapeHtml(selected[0].id)}.html">Profili aç</a><a class="detail-link ghost" href="./transfer-izleme.html">Takip listesi</a></div></article><aside class="home-transfer-side"><div class="home-transfer-list">${selected.map((player) => `<a class="home-transfer-row" href="./oyuncular/${escapeHtml(player.id)}.html"><span>${escapeHtml(player.name)}</span><strong>${escapeHtml(player.currentTeam || player.team)}</strong><b>${escapeHtml(formatMarketValueEur(player.marketValueEur) || "Takipte")}</b></a>`).join("")}</div></aside>`;
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
const topPlayers = players.slice().sort((left, right) => Number(right.overallRating || 0) - Number(left.overallRating || 0));

writePage("index.html", {
  "featured-match": emptyMatchState("featured"),
  "home-transfer-watch": transferWatch(),
  "today-matches": emptyMatchState("today"),
  "radar-signals": signalCards(),
  "team-radar": topTeams.slice(0, 4).map(staticTeamCard).join(""),
  "home-standings": staticHomeStandingRows(),
  "player-radar": topPlayers.slice(0, 3).map(simplePlayerCard).join(""),
  "player-signals": playerSignals(),
  "analysis-preview": analysisCards()
}, fixtureFreshness);

writePage("bugunun-maclari.html", {
  "matches-page": emptyMatchState("today")
}, fixtureFreshness);

writePage("canli-skor.html", {
  "live-score": emptyMatchState("live")
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
