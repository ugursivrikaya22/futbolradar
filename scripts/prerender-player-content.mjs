import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { getPlayers, formatMarketValueEur } = require("../services/playerService.js");
const players = getPlayers(JSON.parse(fs.readFileSync(path.join(root, "data", "players.json"), "utf8")));
const transfers = JSON.parse(fs.readFileSync(path.join(root, "data", "transfers.json"), "utf8"));

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

function playerCard(player, hrefPrefix = "./") {
  const age = player.computedAge || player.age || "Bilinmiyor";
  const market = formatMarketValueEur(player.marketValueEur) || player.marketValue || "Veri yok";
  return `<article class="card player-detail-card" data-card="player" data-player="${escapeHtml(player.id)}">
    <div class="card-head"><div><span class="card-kicker">${escapeHtml(team(player))} · ${escapeHtml(player.position || "Mevki bekleniyor")}</span><h2>${escapeHtml(player.name)}</h2></div><strong class="big-value player-rating-badge">${escapeHtml(rating(player))}</strong></div>
    <div class="metric-grid compact"><span>Yas <b>${escapeHtml(age)}</b></span><span>Mac dakikasi <b>${escapeHtml(player.minutesPlayed || player.minutes || "Veri yok")}</b></span><span>Piyasa <b>${escapeHtml(market)}</b></span></div>
    <p>${escapeHtml(player.summary || "Form, rol ve radar metriklerini oyuncu profilinde incele.")}</p>
    <a class="detail-link" href="${escapeHtml(hrefPrefix)}${escapeHtml(player.id)}.html">Oyuncu profilini ac</a>
  </article>`;
}

function transferCard(transfer) {
  const fee = transfer.fee || (Number(transfer.feeEur) > 0 ? formatMarketValueEur(transfer.feeEur) : Number(transfer.feeEur) === 0 ? "Bedelsiz" : "Açıklanmadı");
  const date = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${transfer.date}T12:00:00Z`));
  const sourceAction = transfer.sourceUrl
    ? `<a class="detail-link" href="${escapeHtml(transfer.sourceUrl)}" target="_blank" rel="noopener noreferrer">Transfer detayını aç</a>`
    : "";

  return `<article class="transfer-radar-card" data-card="transfer-record" data-transfer="${escapeHtml(transfer.id || transfer.playerId)}">
    <header><div class="player-card-title"><div><span class="card-kicker">${escapeHtml(transfer.league || "Lig bilgisi yakında")} · Kesinleşti</span><h2>${escapeHtml(transfer.playerName)}</h2></div></div><strong>${escapeHtml(date)}</strong></header>
    <div class="transfer-route transfer-route-large"><b>${escapeHtml(transfer.fromTeam || "Önceki kulüp bilinmiyor")}</b><em>→</em><b>${escapeHtml(transfer.toTeam || "Yeni kulüp bilinmiyor")}</b></div>
    <div class="transfer-radar-meta"><article><span>Mevki</span><b>${escapeHtml(transfer.position || "Bilinmiyor")}</b></article><article><span>Transfer tipi</span><b>${escapeHtml(transfer.type || "Açıklanmadı")}</b></article><article><span>Bonservis</span><b>${escapeHtml(fee)}</b></article><article><span>Sezon</span><b>${escapeHtml(transfer.season || "Yakında")}</b></article></div>
    ${transfer.note ? `<p class="transfer-note">${escapeHtml(transfer.note)}</p>` : ""}
    <p class="transfer-verification">Son kontrol: ${escapeHtml(new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(transfer.lastVerifiedAt || `${transfer.date}T12:00:00Z`)))}</p>
    <div class="player-status-row"><span class="status-badge verified">Kesinleşti</span></div>
    <div class="player-actions">${sourceAction}<a class="detail-link ghost" href="./takimlar.html?team=${encodeURIComponent(transfer.toTeam || "")}">Takımı incele</a></div>
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
  // Axes are null until real performance data exists; rendering them anyway
  // produces bare labels with no value, so drop them and fall back to the
  // "yakinda" note below.
  const radarItems = Object.entries(radar)
    .filter(([key]) => key !== "dataConfidence")
    .filter(([, value]) => Number.isFinite(Number(value)) && value !== null && value !== "")
    .slice(0, 5)
    .map(([key, value]) => `<span>${escapeHtml(key)} <b>${escapeHtml(value)}</b></span>`)
    .join("");
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

function rootLandingConfig(slug) {
  const configs = {
    "en-iyi-super-lig-oyunculari": (player) => /süper lig|super lig/i.test(player.league || "") && Number(rating(player)) >= 75,
    "en-iyi-forvetler": (player) => ["forward", "winger"].includes(player.positionGroup),
    "en-iyi-orta-sahalar": (player) => player.positionGroup === "midfielder",
    "en-iyi-defanslar": (player) => player.positionGroup === "defender",
    "en-iyi-kaleciler": (player) => player.positionGroup === "goalkeeper",
    "yukselen-oyuncular": (player) => {
      const trend = String(player.trendDirection || player.trend || "").toLocaleLowerCase("tr-TR");
      return Number(player.formChange) > 0 || trend.includes("up") || trend.includes("yüksel") || trend.includes("yuksel");
    },
    "genc-yetenekler": (player) => Number(player.computedAge || player.age || 99) < 23,
    "transfer-radari": (player) => Array.isArray(player.transferHistory) && player.transferHistory.length > 0
  };
  return configs[slug];
}

function updateSitemapIndexability(file, shouldIndex) {
  if (shouldIndex) return;
  const canonical = `https://www.futbolradar.com/${file}`;
  for (const sitemapPath of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) {
    if (!fs.existsSync(sitemapPath)) continue;
    const xml = fs.readFileSync(sitemapPath, "utf8");
    const next = xml.replace(/\s*<url>[\s\S]*?<\/url>/g, (block) => {
      return block.includes(`<loc>${canonical}</loc>`) ? "" : block;
    });
    fs.writeFileSync(sitemapPath, next, "utf8");
  }
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
    ? selected.map((player) => playerCard(player)).join("\n")
    : `<article class="data-empty"><strong>Bu listede oyuncu bulunamadi</strong><span>Yeni ve dogrulanmis oyuncu verileri geldikce liste genisleyecek.</span></article>`;
  replaceFile(`oyuncular/${slug}.html`, (html) => html
    .replace(/<span class="hero-meta" data-landing-count>[^<]*<\/span>/, `<span class="hero-meta" data-landing-count>${selected.length} oyuncu</span>`)
    .replace(/<section class="grid" data-api-section="player-seo-landing"[\s\S]*?<\/section>/, `<section class="grid" data-api-section="player-seo-landing" data-api-target="player-seo-landing" data-player-landing="${slug}">${content}</section>`));
}

for (const slug of [
  "en-iyi-super-lig-oyunculari",
  "en-iyi-forvetler",
  "en-iyi-orta-sahalar",
  "en-iyi-defanslar",
  "en-iyi-kaleciler",
  "yukselen-oyuncular",
  "genc-yetenekler"
]) {
  const filter = rootLandingConfig(slug);
  const selected = players.filter(filter).sort((a, b) => Number(rating(b)) - Number(rating(a)));
  const shouldIndex = selected.length >= 2;
  const content = selected.length
    ? selected.map((player) => playerCard(player, "./oyuncular/")).join("\n")
    : `<article class="data-empty"><strong>Bu listede oyuncu bulunamadi</strong><span>Yeterli oyuncu verisi olustugunda sayfa genisleyecek.</span></article>`;

  replaceFile(`${slug}.html`, (html) => {
    const withContent = html
      .replace(/<span data-landing-count>[^<]*<\/span>/, `<span data-landing-count>${selected.length} oyuncu</span>`)
      .replace(/<section class="grid" data-api-section="player-landing"[\s\S]*?<\/section>/, `<section class="grid" data-api-section="player-landing" data-api-target="player-seo-landing" data-player-landing="${slug}">${content}</section>`);
    return shouldIndex ? withContent : withContent.replace('content="index,follow"', 'content="noindex,follow"');
  });
  updateSitemapIndexability(`${slug}.html`, shouldIndex);
}

const sortedTransfers = transfers.slice().sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")));
const transferContent = sortedTransfers.length
  ? sortedTransfers.map(transferCard).join("\n")
  : `<article class="data-empty"><strong>Kesinleşen transfer bulunamadı</strong><span>Yeni kulüp açıklamaları geldiğinde bu alan güncellenir.</span></article>`;

replaceFile("transfer-radari.html", (html) => html
  .replace(/<span data-landing-count>[^<]*<\/span>/, `<span data-landing-count>${sortedTransfers.length} transfer kaydı</span>`)
  .replace(/<section class="grid" data-api-section="player-landing"[\s\S]*?<\/section>/, `<section class="grid" data-api-section="player-landing" data-api-target="player-seo-landing" data-player-landing="transfer-radari">${transferContent}</section>`));
updateSitemapIndexability("transfer-radari.html", sortedTransfers.length >= 2);

console.log(`Prerendered ${players.length} player profiles and SEO landing lists`);
