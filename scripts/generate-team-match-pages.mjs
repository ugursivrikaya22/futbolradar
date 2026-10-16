#!/usr/bin/env node
/**
 * TAKIM MAÇ SAYFALARI — "galatasaray maçları", "fenerbahçe maçları" ...
 *
 * Türkiye'de en yüksek hacimli futbol aramalarından biri "<takım> maçları":
 * kullanıcı bir sonraki maçın ne zaman olduğunu ve son maçın nasıl bittiğini
 * arıyor. Sitede bu soruyu tek ekranda yanıtlayan bir sayfa yoktu; fikstür
 * lig genelindeydi, sonuçlar maç merkezindeydi, ikisi ayrı yerdeydi.
 *
 * SAYFA YALNIZCA ELDEKİ DOĞRULANMIŞ VERİDEN ÜRETİLİR:
 *
 *   • Sıradaki maç      — sağlayıcı takvimi (gün/saat/stat doğrulanmış)
 *   • Yaklaşan maçlar   — aynı takvim, TSİ gününe göre bugünden sonrası
 *   • Son maçlar        — maç sonu raporu üretilmiş karşılaşmalar
 *   • Sezon fikstürü    — TFF eşleşme listesi, 34 hafta
 *
 * İNCE İÇERİK ÜRETİLMEZ. Bir takım için ne yaklaşan maç ne rapor ne de
 * fikstür varsa o takımın sayfası HİÇ yazılmaz (`MIN_CONTENT_ROWS`).
 * Tarihi atanmamış hafta "tarih bekleniyor" diye görünür; uydurulmuş bir
 * gün yazılmaz. Skoru doğrulanmamış maç sonuç gibi gösterilmez.
 *
 * ŞEMA. Yalnızca başlama anı KESİN olan maçlar `SportsEvent` olur; tarihi
 * atanmamış eşleşme şemaya girmez (startDate'siz SportsEvent geçersizdir ve
 * uydurma tarih zengin sonuçta yanlış bilgi yayar).
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { siteHeader, siteFooter } from "./lib/layout.mjs";
import { newsSlug, readVerifiedTeamNews, renderTeamNewsSection } from "./lib/newsCards.mjs";
import { ROBOTS_INDEX } from "./lib/robots.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { playerLink } = require("../services/playerLinks.js");
const { canonicalStatus, istanbulDay } = require("../services/matchStatus.js");
const { sameClub } = require("../services/superLigTeams.js");
const { applyVerifiedBroadcast } = require("../services/broadcastSchedule.js");
const { SOURCE_LINK_REL } = require("../services/sourceLinks.js");
const { CONFIRMED_FIXTURE_STATUSES } = require("../services/superLigFixtureService.js");
const { normalizeKey } = require("../services/competitionCatalog.js");
const { slugForMatch, trPagePath } = require("../services/matchSeoPages.js");

const DOMAIN = "https://www.futbolradar.com";

/** Sayfa üretmek için gereken en az doğrulanmış satır sayısı. */
const MIN_CONTENT_ROWS = 6;

// Görev 6: büyük 4 sabiti yerine tüm Süper Lig takımları tek listeden
// (services/superLigTeamPages.js). Oyuncu radarı / form sayfası yalnızca
// dosyası varsa bağlanır (bugün yalnızca büyük 4'te var) — 404'e bağlantı yok.
const { superLigTeamPages, standingsPageIndexable } = require("../services/superLigTeamPages.js");
const TEAMS = superLigTeamPages({ root }).map(({ slug, name, record }) => {
  const radar = `${slug}-oyuncu-radari.html`;
  const form = `${slug}-form-durumu.html`;
  return {
    slug,
    name,
    radar: fs.existsSync(path.join(root, radar)) ? radar : null,
    form: fs.existsSync(path.join(root, form)) ? form : null,
    // Puan durumu sayfası (generate-team-standings-pages) indekslenebilir mi?
    hasStandingsPage: standingsPageIndexable(record)
  };
});

const calendarStore = JSON.parse(fs.readFileSync(path.join(root, "data", "fixture-calendar.json"), "utf8"));
const calendar = (calendarStore.matches || []).map((match) => applyVerifiedBroadcast(match));
const fixtures = JSON.parse(fs.readFileSync(path.join(root, "data", "super-lig-fixtures.json"), "utf8"));
const reportStore = JSON.parse(fs.readFileSync(path.join(root, "data", "post-match-reports.json"), "utf8"));
const reports = Array.isArray(reportStore) ? reportStore : (reportStore.reports || reportStore.records || []);
const transfers = JSON.parse(fs.readFileSync(path.join(root, "data", "transfers.json"), "utf8"));
const standingsStore = JSON.parse(fs.readFileSync(path.join(root, "data", "league-standings.json"), "utf8"));
const standings = standingsStore["super-lig"] || { table: [] };
const squads = JSON.parse(fs.readFileSync(path.join(root, "data", "super-lig-squads.json"), "utf8"));
const managers = JSON.parse(fs.readFileSync(path.join(root, "data", "managers.json"), "utf8"));
const leaders = JSON.parse(fs.readFileSync(path.join(root, "data", "league-leaders.json"), "utf8"));
const playerStore = JSON.parse(fs.readFileSync(path.join(root, "data", "players.json"), "utf8"));
const newsStore = JSON.parse(fs.readFileSync(path.join(root, "data", "news.json"), "utf8"));

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isTeamMatch(match, team) {
  return sameClub(match && match.homeTeam, team.name) || sameClub(match && match.awayTeam, team.name);
}

function longDate(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("tr-TR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul"
  }).format(parsed);
}

function clockLabel(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" }).format(parsed);
}

function timestampLabel(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul"
  }).format(parsed) + " TSİ";
}

function latestTimestamp(values) {
  return values
    .filter((value) => Number.isFinite(Date.parse(value || "")))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] || null;
}

function opponentOf(match, team) {
  return sameClub(match.homeTeam, team.name) ? match.awayTeam : match.homeTeam;
}

function venueLabel(match, team) {
  if (match.venue) return match.venue;
  return sameClub(match.homeTeam, team.name) ? "İç saha" : "Deplasman";
}

/** Skoru doğrulanmış bitmiş maç mı? Yarım kayıt sonuç gibi gösterilmez. */
function hasFinalScore(match) {
  const score = match && match.score;
  return Boolean(score) && Number.isFinite(Number(score.home)) && Number.isFinite(Number(score.away));
}

function upcomingMatches(team, today) {
  return calendar
    .filter((match) => isTeamMatch(match, team))
    .filter((match) => match.kickoff && istanbulDay(match.kickoff) >= today)
    .filter((match) => !["FINISHED", "AWARDED", "CANCELLED", "POSTPONED", "ABANDONED"].includes(canonicalStatus(match.status || match.providerStatus)))
    .filter((match) => !["POSTPONED", "CANCELLED", "ABANDONED"].includes(String(match.status || "").toUpperCase()))
    .sort((left, right) => String(left.kickoff).localeCompare(String(right.kickoff)));
}

function todayMatch(team, today) {
  return calendar
    .filter((match) => isTeamMatch(match, team) && match.kickoff && istanbulDay(match.kickoff) === today)
    .sort((left, right) => String(left.kickoff).localeCompare(String(right.kickoff)))[0] || null;
}

function lastCompletedMatch(team) {
  const fromCalendar = calendar
    .filter((match) => isTeamMatch(match, team) && canonicalStatus(match.status || match.providerStatus) === "FINISHED" && hasFinalScore(match))
    .sort((left, right) => String(right.kickoff || "").localeCompare(String(left.kickoff || "")))[0];
  if (fromCalendar) return fromCalendar;
  return recentReports(team)[0] || null;
}

function standingFor(team) {
  return (standings.table || []).find((row) => sameClub(row.team || row.name, team.name)) || null;
}

function squadFor(team) {
  const row = squads.find((item) => sameClub(item.teamName, team.name));
  return row && row.status === "complete" && Array.isArray(row.players) ? row : null;
}

function managerFor(team) {
  const row = (managers.managers || []).find((item) => sameClub(item.team, team.name) && item.confidence === "confirmed") || null;
  if (!row) return null;
  const managerKey = String(row.manager || "").split(/\s+/).at(-1);
  const invalidated = (Array.isArray(newsStore) ? newsStore : []).some((article) =>
    article && article.status === "verified" && sameClub(article.team, team.name) &&
    Date.parse(article.publishedAt || "") > Date.parse(managers.updatedAt || "") &&
    String(article.title || "").includes(managerKey) && /yollar(?:ı)? ayrıldı/i.test(String(article.title || "")));
  return invalidated ? null : row;
}

function leadersFor(team, key) {
  return (leaders[key] || []).filter((row) => sameClub(row.team, team.name)).slice(0, 5);
}

function playerHref(row) {
  const player = playerStore.find((item) => String(item.providerId || "") === String(row.providerId || "") && sameClub(item.currentTeam || item.team, row.team));
  return player && player.id ? playerLink(player.id, "./") : null;
}

/**
 * KIRIK BAĞLANTIYA KARŞI ÇİFT KORUMA.
 *
 * `data/post-match-reports.json` bazen aynı gerçek maçı iki kez içerebiliyor
 * (sağlayıcı bir takımı farklı yazınca — "Gençlerbirliği" / "Gençlerbirliği
 * S.K." gibi — kalıcı arşiv o maçı iki ayrı kimlikle biriktiriyordu; kök
 * neden `generate-post-match-reports.mjs`de düzeltildi). Ama bu script derleme
 * zincirinde O DÜZELTMEDEN ÖNCE çalışıyor, yani depodaki dosya o an hâlâ
 * eski/yinelenen olabilir. İki bağımsız korumayla, hangi sebepten olursa
 * olsun kırık bir bağlantı asla basılmaz:
 *   1. Hedef dosya diskte gerçekten yoksa satır hiç eklenmez.
 *   2. Aynı saatte aynı iki kulüp arasında birden fazla kayıt varsa yalnızca
 *      ilki (en güncel sıralamadan sonra ilk görülen) kalır.
 */
function dedupeReports(list) {
  const seen = [];
  const out = [];
  for (const report of list) {
    const filePath = report.seo && report.seo.path;
    if (!filePath || !fs.existsSync(path.join(root, filePath))) continue;
    const duplicate = seen.some((other) => {
      if (String(other.kickoff || "") !== String(report.kickoff || "")) return false;
      const straight = sameClub(other.homeTeam, report.homeTeam) && sameClub(other.awayTeam, report.awayTeam);
      const swapped = sameClub(other.homeTeam, report.awayTeam) && sameClub(other.awayTeam, report.homeTeam);
      return straight || swapped;
    });
    if (duplicate) continue;
    seen.push(report);
    out.push(report);
  }
  return out;
}

/** Maç sonu raporu üretilmiş karşılaşmalar; en yenisi önde. */
function recentReports(team) {
  return dedupeReports(
    reports
      .filter((report) => isTeamMatch(report, team))
      .sort((left, right) => String(right.kickoff || "").localeCompare(String(left.kickoff || "")))
  ).slice(0, 6);
}

/** TFF eşleşme listesi: takımın 34 haftalık sezon programı. */
function seasonFixtures(team) {
  const rows = [];
  for (const round of fixtures.rounds || []) {
    for (const match of round.matches || []) {
      if (!CONFIRMED_FIXTURE_STATUSES.has(match.fixtureStatus)) continue;
      if (!sameClub(match.homeTeam, team.name) && !sameClub(match.awayTeam, team.name)) continue;
      rows.push({ ...match, round: round.round, roundLabel: round.label, dateRange: round.dateRange });
    }
  }
  return rows.sort((left, right) => Number(left.round) - Number(right.round));
}

function teamTransfers(team) {
  return transfers
    .filter((row) => row.status === "confirmed" && row.sourceUrl && (sameClub(row.toTeam, team.name) || sameClub(row.fromTeam, team.name)))
    .sort((left, right) => String(right.date).localeCompare(String(left.date)))
    .slice(0, 4);
}

function matchPageHref(match) {
  // Kalıcı maç SEO sayfası (ne zaman / canlı skor / sonuç aynı adreste)
  // editoryal analiz sayfasından önce gelir.
  const seoSlug = slugForMatch(match);
  if (seoSlug) return `./${trPagePath(seoSlug).replace(/\.html$/, "")}`;
  if (match.analysisPage) return `./${match.analysisPage}`;
  const fixtureId = match.providerId || match.id;
  return fixtureId ? `./mac-detay.html?fixtureId=${encodeURIComponent(fixtureId)}` : "./mac-merkezi.html";
}

function nextMatchCard(match, team, today) {
  if (!match) {
    return `<article class="data-empty" data-card="empty-state"><strong>Takvimde doğrulanmış sıradaki maç yok</strong><span>Kulüp ya da organizasyon gün ve saat açıkladığında bu alan otomatik güncellenir. Tahmini tarih yazılmaz.</span></article>`;
  }

  const home = sameClub(match.homeTeam, team.name);
  const isToday = istanbulDay(match.kickoff) === today;
  return `<article class="glass-card team-next-match${isToday ? " is-today" : ""}" data-card="${isToday ? "today-match" : "next-match"}">
    <div class="team-next-match-head"><span class="tag green">${isToday ? "Bugünkü maç" : "Sıradaki maç"}</span><span>${escapeHtml(match.league || "Maç programı")}</span></div>
    <h3>${escapeHtml(match.homeTeam)} <span aria-hidden="true">–</span> ${escapeHtml(match.awayTeam)}</h3>
    <dl class="team-next-match-facts">
      <div><dt>Tarih</dt><dd><time datetime="${escapeHtml(match.kickoff)}">${escapeHtml(longDate(match.kickoff))}</time></dd></div>
      <div><dt>Saat</dt><dd>${escapeHtml(clockLabel(match.kickoff))} TSİ</dd></div>
      <div><dt>Stat</dt><dd>${escapeHtml(venueLabel(match, team))}</dd></div>
      <div><dt>Konum</dt><dd>${home ? "İç saha" : "Deplasman"}</dd></div>
      ${match.broadcast && match.broadcast.turkey ? `<div><dt>Yayın</dt><dd>${escapeHtml(match.broadcast.turkey)}</dd></div>` : ""}
    </dl>
    <a class="detail-link" href="${escapeHtml(matchPageHref(match))}">Maç ayrıntısı</a>
  </article>`;
}

function currentMatchCard(match, team) {
  if (!match) return "";
  const status = canonicalStatus(match.status || match.providerStatus);
  const live = ["LIVE", "HALFTIME", "INTERRUPTED"].includes(status);
  const finished = status === "FINISHED" && hasFinalScore(match);
  const score = (live || finished) && hasFinalScore(match) ? `${match.score.home} - ${match.score.away}` : null;
  const statusLabel = live
    ? `${score || "Canlı"}${Number.isFinite(Number(match.minute)) ? ` · ${Number(match.minute)}. dakika` : ""}`
    : finished ? `Maç sonucu ${score}` : `Saat ${clockLabel(match.kickoff)} TSİ`;
  const channel = match.broadcast && match.broadcast.turkey ? match.broadcast.turkey : "Yayın bilgisi henüz açıklanmadı";
  return `<article class="team-today-callout" data-card="today-match-highlight">
    <div><span class="eyebrow">${escapeHtml(team.name)} maçı bugün</span><h2>${escapeHtml(match.homeTeam)} – ${escapeHtml(match.awayTeam)}</h2><p><strong>${escapeHtml(statusLabel)}</strong> · ${escapeHtml(channel)}</p></div>
    <a class="button primary" href="${escapeHtml(matchPageHref(match))}">Maç merkezine git</a>
  </article>`;
}

function lastMatchCard(match) {
  if (!match) return `<article class="data-empty compact"><strong>Doğrulanmış son maç yok</strong><span>Sonuç sağlayıcıdan doğrulandığında burada gösterilir.</span></article>`;
  const score = hasFinalScore(match) ? `${match.score.home} - ${match.score.away}` : "";
  return `<article class="glass-card team-last-match" data-card="last-match">
    <span class="card-kicker">Son maç</span><h3>${escapeHtml(match.homeTeam)} <b>${escapeHtml(score)}</b> ${escapeHtml(match.awayTeam)}</h3>
    <p><time datetime="${escapeHtml(match.kickoff || "")}">${escapeHtml(longDate(match.kickoff))}</time>${match.league ? ` · ${escapeHtml(match.league)}` : ""}</p>
    <a class="detail-link" href="${escapeHtml(matchPageHref(match))}">Maç sonucu ve analiz</a>
  </article>`;
}

function upcomingRows(matches, team) {
  if (!matches.length) return "";
  return `<div class="archive-table-wrap"><table class="archive-table">
    <caption>${escapeHtml(team.name)} yaklaşan maçlar</caption>
    <thead><tr><th scope="col">Tarih</th><th scope="col">Saat</th><th scope="col">Karşılaşma</th><th scope="col">Turnuva</th><th scope="col">Stat</th></tr></thead>
    <tbody>${matches.map((match) => `<tr>
      <td><time datetime="${escapeHtml(match.kickoff)}">${escapeHtml(longDate(match.kickoff))}</time></td>
      <td>${escapeHtml(clockLabel(match.kickoff))}</td>
      <td><a href="${escapeHtml(matchPageHref(match))}">${escapeHtml(match.homeTeam)} – ${escapeHtml(match.awayTeam)}</a></td>
      <td>${escapeHtml(match.league || "—")}</td>
      <td>${escapeHtml(venueLabel(match, team))}</td>
    </tr>`).join("")}</tbody></table></div>`;
}

function resultRows(rows, team) {
  if (!rows.length) {
    return `<article class="data-empty" data-card="empty-state"><strong>Yayımlanmış maç raporu yok</strong><span>Maç sonu raporu, olay akışı ve istatistik doğrulandığında üretilir.</span></article>`;
  }

  return `<div class="trend-transfer-grid">${rows.map((report) => {
    const scored = hasFinalScore(report);
    const score = scored ? `${report.score.home} - ${report.score.away}` : "Sonuç doğrulanıyor";
    return `<article class="glass-card team-match-result" data-card="match-report">
      <div class="team-match-result-head"><time datetime="${escapeHtml(report.kickoff || "")}">${escapeHtml(longDate(report.kickoff) || "Tarih bekleniyor")}</time><span>${escapeHtml(report.league || report.competition || "")}</span></div>
      <h3>${escapeHtml(report.homeTeam)} <b>${escapeHtml(score)}</b> ${escapeHtml(report.awayTeam)}</h3>
      <a class="detail-link" href="./${escapeHtml(report.seo.path.replace(/^\//, ""))}">Maç raporunu oku</a>
    </article>`;
  }).join("")}</div>`;
}

function seasonRows(rows, team) {
  if (!rows.length) return "";
  return `<div class="archive-table-wrap"><table class="archive-table">
    <caption>${escapeHtml(team.name)} ${escapeHtml(fixtures.season || "")} Süper Lig fikstürü</caption>
    <thead><tr><th scope="col">Hafta</th><th scope="col">Karşılaşma</th><th scope="col">Tarih</th><th scope="col">Saha</th></tr></thead>
    <tbody>${rows.map((match) => {
      const home = sameClub(match.homeTeam, team.name);
      // Tarihi atanmamış hafta "bekleniyor" yazar; gün UYDURULMAZ.
      const when = match.kickoff
        ? `<time datetime="${escapeHtml(match.kickoff)}">${escapeHtml(longDate(match.kickoff))} ${escapeHtml(clockLabel(match.kickoff))}</time>`
        : `<span class="muted">${escapeHtml(match.dateLabel || match.dateRange || "Tarih ve saat bekleniyor")}</span>`;
      return `<tr><td>${escapeHtml(String(match.round))}. hafta</td>
        <td>${escapeHtml(match.homeTeam)} – ${escapeHtml(match.awayTeam)}</td>
        <td>${when}</td>
        <td>${home ? "İç saha" : "Deplasman"}</td></tr>`;
    }).join("")}</tbody></table></div>`;
}

function transferRows(rows) {
  if (!rows.length) return "";
  return `<ul class="trend-mini-stats team-match-transfer-list">${rows.map((row) => `<li><span>${escapeHtml(row.date)}</span><strong>${escapeHtml(row.playerName)}</strong><span>${escapeHtml(row.fromTeam)} → ${escapeHtml(row.toTeam)}</span><span class="tag green">${escapeHtml(row.type || "Transfer")}</span><a href="${escapeHtml(row.sourceUrl)}" target="_blank" rel="${SOURCE_LINK_REL}">Resmî kaynak</a></li>`).join("")}</ul>`;
}

// Bağlantı slug'ı sağlayıcı adından değil takım listesinden ("Erzurumspor FK" →
// erzurumspor): addan türetmek yeni takımlarda var olmayan adrese gidiyordu.
function standingCard(row, season, team) {
  if (!row) return "";
  const form = (row.form || []).slice(-5);
  const labels = { W: "G", D: "B", L: "M" };
  const classes = { W: "win", D: "draw", L: "loss" };
  return `<article class="glass-card team-standing-card" data-card="team-standing" data-source="league-standings">
    <div class="team-standing-rank"><span>Süper Lig sırası</span><strong>${escapeHtml(row.rank)}.</strong><small>${escapeHtml(season)}</small></div>
    <dl class="team-record" aria-label="${escapeHtml(row.team || row.name)} lig bilançosu">
      <div><dt>O</dt><dd>${escapeHtml(row.played)}</dd></div><div><dt>G</dt><dd>${escapeHtml(row.won)}</dd></div><div><dt>B</dt><dd>${escapeHtml(row.drawn)}</dd></div><div><dt>M</dt><dd>${escapeHtml(row.lost)}</dd></div><div><dt>P</dt><dd>${escapeHtml(row.points)}</dd></div>
    </dl>
    <div class="team-form"><span>Son ${form.length} lig maçı</span><div class="form-dots" aria-label="Son maç formu">${form.map((value) => `<span class="${classes[value] || ""}" title="${labels[value] || value}">${labels[value] || value}</span>`).join("")}</div></div>
    ${team.hasStandingsPage ? `<a class="detail-link" href="./${escapeHtml(team.slug)}-puan-durumu">Tam puan durumunu aç</a>` : `<a class="detail-link" href="./super-lig-puan-durumu">Tam puan durumunu aç</a>`}
  </article>`;
}

function squadSection(team, squad, manager) {
  if (!squad) return "";
  const positionNames = { Goalkeeper: "Kaleci", Defender: "Defans", Midfielder: "Orta saha", Attacker: "Forvet" };
  const groups = new Map();
  for (const player of squad.players) {
    const label = positionNames[player.position] || player.position || "Kadro";
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(player);
  }
  const managerHtml = manager
    ? `<article class="glass-card team-manager" data-card="manager"><span class="card-kicker">Teknik direktör</span><h3>${escapeHtml(manager.manager)}</h3><p>${escapeHtml(manager.note || "")}</p><a href="${escapeHtml(manager.source.url)}" target="_blank" rel="${SOURCE_LINK_REL}">Kaynak: ${escapeHtml(manager.source.name)}</a></article>`
    : `<article class="glass-card team-manager" data-card="manager"><span class="card-kicker">Teknik direktör</span><h3>Güncel kayıt doğrulanıyor</h3><p>Eski teknik direktör bilgisi yayımlanmadı. Yeni görevlendirme kaynakla doğrulandığında bu alan otomatik güncellenir.</p></article>`;
  const playersHtml = [...groups.entries()].map(([position, players]) => `<div class="team-squad-group"><h3>${escapeHtml(position)}</h3><ul>${players.map((player) => {
    const row = { providerId: player.providerId, team: team.name };
    const href = playerHref(row);
    const name = href ? `<a href="${escapeHtml(href)}">${escapeHtml(player.name)}</a>` : escapeHtml(player.name);
    return `<li>${name}${player.age ? `<span>${escapeHtml(player.age)} yaş</span>` : ""}</li>`;
  }).join("")}</ul></div>`).join("");
  return `${managerHtml}<div class="team-squad-grid" data-card="current-squad" data-source="api-football-squad">${playersHtml}</div>`;
}

function leaderCards(team) {
  const render = (rows, stat) => rows.length ? `<ol class="team-leader-list">${rows.map((row) => {
    const href = playerHref(row);
    const name = href ? `<a href="${escapeHtml(href)}">${escapeHtml(row.name)}</a>` : escapeHtml(row.name);
    return `<li><span>${escapeHtml(row.rank)}.</span><strong>${name}</strong><b>${escapeHtml(row[stat])}</b></li>`;
  }).join("")}</ol>` : `<p class="muted">Sağlayıcının ilk 20 listesinde bu takım için doğrulanmış oyuncu yok.</p>`;
  return `<div class="team-leaders-grid" data-source="api-football-leaders">
    <article class="glass-card"><span class="card-kicker">Takımın en golcüleri</span><h3>${escapeHtml(team.name)} gol liderleri</h3>${render(leadersFor(team, "topScorers"), "goals")}<a class="detail-link" href="./gol-kralligi.html">Süper Lig gol krallığı</a></article>
    <article class="glass-card"><span class="card-kicker">Takımın asist liderleri</span><h3>${escapeHtml(team.name)} asist liderleri</h3>${render(leadersFor(team, "topAssists"), "assists")}<a class="detail-link" href="./asist-kralligi.html">Süper Lig asist krallığı</a></article>
  </div>`;
}

function section(title, note, body, kicker) {
  if (!body) return "";
  return `<section class="trend-section">
    <div class="section-head"><div class="section-title">${kicker ? `<span class="section-kicker">${escapeHtml(kicker)}</span>` : ""}<h2>${escapeHtml(title)}</h2>${note ? `<p>${escapeHtml(note)}</p>` : ""}</div></div>
    ${body}
  </section>`;
}

function schemaFor(team, url, description, scheduled, squad, manager, news) {
  const sportsTeam = {
    "@type": "SportsTeam",
    "@id": `${url}#team`,
    name: team.name,
    sport: "Football",
    memberOf: { "@type": "SportsOrganization", name: "Trendyol Süper Lig" }
  };
  if (manager) sportsTeam.coach = { "@type": "Person", name: manager.manager };
  if (squad) sportsTeam.athlete = squad.players.map((player) => ({ "@type": "Person", name: player.name }));
  const graph = [
    {
      "@type": "CollectionPage",
      "@id": url,
      url,
      name: `${team.name} Maçları`,
      description,
      isPartOf: { "@type": "WebSite", name: "FutbolRadar", url: `${DOMAIN}/` },
      inLanguage: "tr-TR",
      about: { "@id": `${url}#team` },
      mainEntity: { "@id": `${url}#team` }
    },
    sportsTeam,
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Ana Sayfa", item: `${DOMAIN}/` },
        { "@type": "ListItem", position: 2, name: "Takımlar", item: `${DOMAIN}/takimlar.html` },
        { "@type": "ListItem", position: 3, name: `${team.name} Maçları`, item: url }
      ]
    }
  ];

  // Yalnızca başlama anı kesin olan maçlar şemaya girer.
  if (scheduled.length) {
    graph.push({
      "@type": "ItemList",
      name: `${team.name} yaklaşan maçları`,
      numberOfItems: scheduled.length,
      itemListElement: scheduled.map((match, index) => {
        const event = {
          "@type": "SportsEvent",
          name: `${match.homeTeam} - ${match.awayTeam}`,
          startDate: match.kickoff,
          eventStatus: "https://schema.org/EventScheduled",
          eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
          homeTeam: { "@type": "SportsTeam", name: match.homeTeam },
          awayTeam: { "@type": "SportsTeam", name: match.awayTeam }
        };
        if (match.venue) event.location = { "@type": "Place", name: match.venue };
        if (match.league) event.superEvent = { "@type": "SportsOrganization", name: match.league };
        return { "@type": "ListItem", position: index + 1, item: event };
      })
    });
  }

  if (news.length) {
    graph.push({
      "@type": "ItemList",
      name: `${team.name} haberleri`,
      numberOfItems: news.length,
      itemListElement: news.map((article, index) => ({
        "@type": "ListItem",
        position: index + 1,
        item: {
          "@type": "NewsArticle",
          headline: article.title,
          datePublished: article.publishedAt,
          url: `${DOMAIN}/haber/${newsSlug(article.slug || article.id || article.title)}`
        }
      }))
    });
  }

  return { "@context": "https://schema.org", "@graph": graph };
}

function relatedLinks(team) {
  const links = [
    { href: "./bugunun-maclari.html", kicker: "Bugün", title: "Bugünün maçları", text: "Günün doğrulanmış maç programı ve yayın bilgileri." },
    { href: "./super-lig-fikstur.html", kicker: "Lig", title: "Süper Lig fikstürü", text: "Tüm haftaların eşleşmelerini ve açıklanan saatleri gör." },
    { href: "./canli-skor.html", kicker: "Canlı", title: "Canlı skor", text: "Oynanan maçların dakikası ve skoru." },
    { href: "./puan-durumu.html", kicker: "Tablo", title: "Puan durumu", text: "Süper Lig sıralaması ve averaj." },
    { href: "./gol-kralligi.html", kicker: "Gol", title: "Süper Lig gol krallığı", text: "Güncel gol sıralaması ve oyuncu profilleri." },
    { href: "./asist-kralligi.html", kicker: "Asist", title: "Süper Lig asist krallığı", text: "Güncel asist sıralaması ve oyuncu profilleri." },
    { href: "./haberler.html", kicker: "Haber", title: `${team.name} haberleri`, text: "Doğrulanmış son takım haberleri." },
    { href: "./analizler.html", kicker: "Analiz", title: "Maç analizleri", text: `${team.name} ile ilgili veri odaklı maç okumaları.` },
    // Ücretsiz Tahmin Ligi'ne iç bağlantı (kullanıcıyı davet eder, zorlamaz).
    { href: "./tahmin-ligi", kicker: "Tahmin Ligi", title: `${team.name} maçını tahmin et`, text: "Ücretsiz skor tahmini yap, haftalık sıralamada yüksel." },
  ];
  // `generate-team-standings-pages.mjs` AYNI listeden ve AYNI slug'la üretir;
  // eşiği geçmeyen (noindex) puan sayfasına bağlantı verilmez.
  if (team.hasStandingsPage) links.push({ href: `./${team.slug}-puan-durumu`, kicker: "Puan durumu", title: `${team.name} puan durumu`, text: `${team.name} Süper Lig'de kaçıncı sırada, tam tabloda vurgulu.` });
  if (team.radar) links.push({ href: `./${team.radar}`, kicker: "Kadro", title: `${team.name} oyuncu radarı`, text: "Kadro, form ve rol sinyalleri." });
  if (team.form) links.push({ href: `./${team.form}`, kicker: "Form", title: `${team.name} form durumu`, text: "Son maçların form okuması." });
  return `<div class="trend-link-grid">${links.map((link) => `<a class="" href="${escapeHtml(link.href)}"><span>${escapeHtml(link.kicker)}</span><strong>${escapeHtml(link.title)}</strong><p>${escapeHtml(link.text)}</p></a>`).join("")}</div>`;
}

function buildPage(team, today) {
  const upcoming = upcomingMatches(team, today);
  const results = recentReports(team);
  const season = seasonFixtures(team);
  const moves = teamTransfers(team);
  const todayGame = todayMatch(team, today);
  const lastGame = lastCompletedMatch(team);
  const standing = standingFor(team);
  const squad = squadFor(team);
  const manager = managerFor(team);
  const teamNews = readVerifiedTeamNews(root, team.name, 3);

  // İnce içerik koruması: elde anlamlı satır yoksa sayfa üretilmez.
  const contentRows = upcoming.length + results.length + season.length;
  if (contentRows < MIN_CONTENT_ROWS) {
    return { skipped: `${team.name}: yalnızca ${contentRows} doğrulanmış satır (en az ${MIN_CONTENT_ROWS} gerekli)` };
  }

  const file = `${team.slug}-maclari.html`;
  const url = `${DOMAIN}/${file}`;
  const next = upcoming[0] || null;
  const scheduled = upcoming.filter((match) => match.kickoff);
  const seasonLabel = String(fixtures.season || "").replace(/^(\d{4})-\d{2}(\d{2})$/, "$1/$2");
  const updatedAt = latestTimestamp([
    calendarStore.fetchedAt,
    fixtures.lastVerifiedAt,
    standings.updatedAt,
    squad && squad.syncedAt,
    leaders.generatedAt,
    managers.updatedAt
  ]);

  const nextSentence = next
    ? `${team.name}'ın sıradaki maçı ${longDate(next.kickoff)} günü saat ${clockLabel(next.kickoff)} TSİ'de ${opponentOf(next, team)} karşısında.`
    : `${team.name} için takvimde gün ve saati doğrulanmış bir sonraki maç henüz yok.`;

  const title = `${team.name} Maçları, Puan Durumu ve Fikstür ${seasonLabel} | FutbolRadar`;
  const description = `${team.name} maçı bugün var mı? Sıradaki maçın saati ve yayın kanalı, ${team.name} puan durumu, fikstürü, kadrosu ve güncel takım haberleri.`;

  const html = `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${url}" />
    <meta name="robots" content="${ROBOTS_INDEX}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:url" content="${url}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${DOMAIN}/assets/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${DOMAIN}/assets/og-image.png" />
    <script type="application/ld+json">${JSON.stringify(schemaFor(team, url, description, scheduled, squad, manager, teamNews))}</script>
    <link rel="icon" href="./favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="./site.webmanifest" />
    <link rel="stylesheet" href="./page.css" />
  </head>
  <body class="subpage team-match-page">
    ${siteHeader({ base: "./" })}
    <main class="container">
      <nav class="breadcrumb" aria-label="Sayfa yolu"><a href="./index.html">Ana Sayfa</a><span>/</span><a href="./takimlar.html">Takımlar</a><span>/</span><span>${escapeHtml(team.name)} Maçları</span></nav>
      <section class="trend-hero">
        <div>
          <span class="eyebrow">${escapeHtml(team.name)} · ${escapeHtml(seasonLabel)} sezonu</span>
          <h1>${escapeHtml(team.name)} Maçları, Puan Durumu ve Fikstür</h1>
          <p>${escapeHtml(nextSentence)}</p>
          <p class="muted">${escapeHtml(team.name)} maçı saat kaçta ve hangi kanalda sorularının yanıtı, fikstür, kadro ve lig verileri aynı doğrulanmış kaynaklardan otomatik güncellenir.</p>
        </div>
        ${nextMatchCard(next, team, today)}
      </section>
      ${currentMatchCard(todayGame, team)}
      ${section(`${team.name} puan durumu ve son form`, `${seasonLabel} Süper Lig sıralaması; puan durumu sayfasıyla aynı sağlayıcı tablosundan.`, `<div class="team-overview-grid">${standingCard(standing, seasonLabel, team)}${lastMatchCard(lastGame)}</div>`, "Güncel durum")}
      ${section("Yaklaşan maçlar", "Gün ve saati doğrulanmış karşılaşmalar, en yakın tarih önde.", upcomingRows(upcoming, team), "Takvim")}
      ${section("İlgili maç analizleri", "Yalnızca doğrulanmış sonuçtan üretilmiş maç raporları ve analizler listelenir.", resultRows(results, team), "Analiz")}
      ${section(`${team.name} Süper Lig fikstürü`, `${fixtures.season || ""} sezonu eşleşmeleri. Tarihi atanmamış haftalar için gün uydurulmaz.`, seasonRows(season, team), "Sezon")}
      ${section(`${team.name} gol ve asist liderleri`, "Süper Lig sağlayıcısının güncel gol ve asist listelerinde yer alan takım oyuncuları.", leaderCards(team), "Oyuncu performansı")}
      ${section(`${team.name} güncel kadrosu`, squad ? `${seasonLabel} sezonu sağlayıcı kadrosu; son senkron ${timestampLabel(squad.syncedAt)}.` : "", squadSection(team, squad, manager), "Kadro ve teknik ekip")}
      ${section("Son transfer hareketleri", "Yalnızca resmî açıklamayla doğrulanmış kayıtlar.", transferRows(moves), "Kadro")}
      ${renderTeamNewsSection(teamNews, { team: team.name, base: "./" })}
      ${section("İlgili ekranlar", "Aynı veriyi lig, kadro ve form açısından derinleştir.", relatedLinks(team), "İç bağlantılar")}
      ${updatedAt ? `<p class="team-data-freshness" data-source-updated-at="${escapeHtml(updatedAt)}">Son veri güncellemesi: <time datetime="${escapeHtml(updatedAt)}">${escapeHtml(timestampLabel(updatedAt))}</time></p>` : ""}
    </main>
    ${siteFooter({ base: "./" })}
    <script src="./site.js" defer></script>
  </body>
</html>`;

  const cleanHtml = html.replace(/^[ \t]+$/gm, "");
  return { file, html: cleanHtml, stats: { upcoming: upcoming.length, results: results.length, season: season.length, scheduled: scheduled.length } };
}

/**
 * Sayfaları KEŞFEDİLEBİLİR yapar.
 *
 * Sitemap'e girmek tek başına yetmez: hiçbir sayfadan bağlantı almayan bir
 * sayfa öksüzdür, tarayıcı ona nadiren döner ve sıralamada karşılığı olmaz.
 * Kırıntı yolu bu sayfaları "Takımlar"ın altına koyuyor; o hâlde bağlantının
 * gerçekten Takımlar sayfasında durması gerekir.
 */
function injectTeamMatchLinks(files) {
  const target = path.join(root, "takimlar.html");
  if (!fs.existsSync(target) || !files.length) return false;

  const cards = files.map((entry) => `<a href="./${escapeHtml(entry.file)}"><span>Maç programı</span><strong>${escapeHtml(entry.name)} Maçları</strong><p>${escapeHtml(entry.blurb)}</p></a>`).join("");
  const block = `<!-- team-match-links:start -->
<section class="trend-section" aria-labelledby="team-match-links-title">
  <div class="section-head"><div class="section-title"><span class="section-kicker">Maç programı</span><h2 id="team-match-links-title">Takımların maç sayfaları</h2><p>Sıradaki maç, yaklaşan karşılaşmalar ve yayımlanmış maç raporları tek ekranda.</p></div></div>
  <section class="trend-link-grid" aria-label="Takım maç sayfaları">${cards}</section>
</section>
<!-- team-match-links:end -->`;

  let html = fs.readFileSync(target, "utf8");
  const pattern = /<!-- team-match-links:start -->[\s\S]*?<!-- team-match-links:end -->/;

  if (pattern.test(html)) {
    html = html.replace(pattern, block);
  } else if (html.includes("</main>")) {
    html = html.replace("</main>", `  ${block}\n    </main>`);
  } else {
    return false;
  }

  fs.writeFileSync(target, html, "utf8");
  const mirror = path.join(root, "public", "takimlar.html");
  if (fs.existsSync(mirror)) fs.writeFileSync(mirror, html, "utf8");
  return true;
}

const today = istanbulDay(new Date().toISOString());
const written = [];
const skipped = [];

for (const team of TEAMS) {
  const page = buildPage(team, today);
  if (page.skipped) {
    skipped.push(page.skipped);
    continue;
  }

  fs.writeFileSync(path.join(root, page.file), page.html, "utf8");
  const mirror = path.join(root, "public", page.file);
  if (fs.existsSync(path.dirname(mirror))) fs.writeFileSync(mirror, page.html, "utf8");
  written.push({ file: page.file, name: team.name, blurb: page.stats.upcoming
    ? `${page.stats.upcoming} yaklaşan maç, ${page.stats.season} haftalık fikstür.`
    : `${page.stats.season} haftalık sezon fikstürü ve maç raporları.` });
  console.log(`[team-match-pages] ${page.file} — ${page.stats.upcoming} yaklaşan, ${page.stats.results} rapor, ${page.stats.season} fikstür satırı, ${page.stats.scheduled} SportsEvent`);
}

const sitemapPath = path.join(root, "sitemap.xml");
if (fs.existsSync(sitemapPath)) {
  let xml = fs.readFileSync(sitemapPath, "utf8");
  const stamp = today;
  let added = 0;

  for (const entry of written) {
    const loc = `${DOMAIN}/${entry.file}`;
    if (xml.includes(`<loc>${loc}</loc>`)) continue;
    // ÇOK SATIRLI biçim zorunlu: `generate-match-pages.mjs` sitemap'i yeniden
    // yazarken girdileri `  <url>...  </url>` kalıbıyla koruyor. Tek satırlık
    // bir girdi o kalıba uymaz ve sessizce SİLİNİR — sayfalar sitemap'ten
    // düşer, bu adım "eklendi" dediği hâlde.
    xml = xml.replace("</urlset>", `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${stamp}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.8</priority>\n  </url>\n</urlset>`);
    added += 1;
  }

  if (added) {
    fs.writeFileSync(sitemapPath, xml, "utf8");
    const publicSitemap = path.join(root, "public", "sitemap.xml");
    if (fs.existsSync(publicSitemap)) fs.writeFileSync(publicSitemap, xml, "utf8");
  }
  console.log(`[team-match-pages] sitemap: ${added} yeni URL eklendi.`);
}

for (const note of skipped) console.warn(`[team-match-pages] atlandı — ${note}`);
const linked = injectTeamMatchLinks(written);
console.log(`[team-match-pages] ${written.length} sayfa üretildi; takimlar.html bağlantı bloğu ${linked ? "güncellendi" : "YAZILAMADI"}.`);
