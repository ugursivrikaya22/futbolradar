import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { getPlayers, formatMarketValueEur } = require("../services/playerService.js");
const players = getPlayers(JSON.parse(fs.readFileSync(path.join(root, "data", "players.json"), "utf8")));

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function rating(player) {
  return player.overallRating || player.aiRating || player.rating || "-";
}

function team(player) {
  return player.currentTeam || player.team || "Takim bilgisi yakinda";
}

function playerCard(player) {
  const age = player.computedAge || player.age || "Bilinmiyor";
  const market = formatMarketValueEur(player.marketValueEur) || player.marketValue || "Veri yok";
  return `<article class="card player-detail-card" data-card="player" data-player="${escapeHtml(player.id)}">
    <div class="card-head"><div><span class="card-kicker">${escapeHtml(team(player))} · ${escapeHtml(player.position || "Mevki bekleniyor")}</span><h2>${escapeHtml(player.name)}</h2></div><strong class="big-value player-rating-badge">${escapeHtml(rating(player))}</strong></div>
    <div class="metric-grid compact"><span>Yas <b>${escapeHtml(age)}</b></span><span>Mac dakikasi <b>${escapeHtml(player.minutesPlayed || player.minutes || "Veri yok")}</b></span><span>Piyasa <b>${escapeHtml(market)}</b></span></div>
    <p>${escapeHtml(player.summary || "Form, rol ve radar metriklerini oyuncu profilinde incele.")}</p>
    <a class="detail-link" href="./${escapeHtml(player.id)}.html">Oyuncu profilini ac</a>
  </article>`;
}

function profileContent(player) {
  const age = player.computedAge || player.age || "Bilinmiyor";
  const market = formatMarketValueEur(player.marketValueEur) || player.marketValue || "Piyasa degeri yakinda";
  const metrics = [
    ["Overall", rating(player)],
    ["Form", player.formRating || player.formScore || "Veri yok"],
    ["Gol", player.goals ?? "Veri yok"],
    ["Asist", player.assists ?? "Veri yok"],
    ["Dakika", player.minutesPlayed || player.minutes || "Veri yok"],
    ["Piyasa", market]
  ];
  const radar = player.radar || {};
  const radarItems = Object.entries(radar).slice(0, 5).map(([key, value]) => `<span>${escapeHtml(key)} <b>${escapeHtml(value)}</b></span>`).join("");
  return `<section class="profile-section profile-content-prerender" aria-label="${escapeHtml(player.name)} performans ozeti">
    <div class="metric-grid profile-metrics">${metrics.map(([label, value]) => `<span>${escapeHtml(label)} <b>${escapeHtml(value)}</b></span>`).join("")}</div>
    <div class="profile-section-head"><h2>Oyuncu ozeti</h2><span>${escapeHtml(team(player))} · ${escapeHtml(player.position || "Mevki bekleniyor")} · ${escapeHtml(age)} yas</span></div>
    <p>${escapeHtml(player.summary || "Oyuncunun formu, rol etkisi ve radar metrikleri birlikte okunur.")}</p>
    <div class="radar-mini-bars">${radarItems || "<span>Alt metrikler yakinda</span>"}</div>
    <div class="tag-row"><span class="tag green">Guncel takim: ${escapeHtml(team(player))}</span><span class="tag soft">${escapeHtml(player.league || "Super Lig")}</span></div>
  </section>`;
}

function landingConfig(slug) {
  return {
    forvetler: (player) => /forvet|santrfor|kanat/i.test(`${player.position} ${player.positionGroup}`),
    kaleciler: (player) => /kaleci|goalkeeper/i.test(`${player.position} ${player.positionGroup}`),
    defanslar: (player) => /def|stoper|bek|savun/i.test(`${player.position} ${player.positionGroup}`),
    "orta-sahalar": (player) => /orta|mid/i.test(`${player.position} ${player.positionGroup}`),
    "genc-yetenekler": (player) => Number(player.computedAge || player.age || 99) < 23,
    "en-iyi-oyuncular": (player) => Number(rating(player)) >= 80
  }[slug];
}

function replaceFile(file, transform) {
  const source = path.join(root, file);
  if (!fs.existsSync(source)) return;
  const html = transform(fs.readFileSync(source, "utf8"));
  fs.writeFileSync(source, html, "utf8");
  const mirror = path.join(root, "public", file);
  fs.mkdirSync(path.dirname(mirror), { recursive: true });
  fs.writeFileSync(mirror, html, "utf8");
}

for (const player of players) {
  replaceFile(`oyuncular/${player.id}.html`, (html) => html.replace(/<section class="player-profile-shell"[\s\S]*?<\/section>/, profileContent(player)));
}

for (const slug of ["forvetler", "kaleciler", "defanslar", "orta-sahalar", "genc-yetenekler", "en-iyi-oyuncular"]) {
  const filter = landingConfig(slug);
  const selected = players.filter(filter).sort((a, b) => Number(rating(b)) - Number(rating(a)));
  const content = selected.length
    ? selected.map(playerCard).join("\n")
    : `<article class="data-empty"><strong>Bu listede oyuncu bulunamadi</strong><span>Yeni ve dogrulanmis oyuncu verileri geldikce liste genisleyecek.</span></article>`;
  replaceFile(`oyuncular/${slug}.html`, (html) => html
    .replace(/<span class="hero-meta" data-landing-count>[^<]*<\/span>/, `<span class="hero-meta" data-landing-count>${selected.length} oyuncu</span>`)
    .replace(/<section class="grid" data-api-section="player-seo-landing"[\s\S]*?<\/section>/, `<section class="grid" data-api-section="player-seo-landing" data-api-target="player-seo-landing" data-player-landing="${slug}">${content}</section>`));
}

console.log(`Prerendered ${players.length} player profiles and SEO landing lists`);
