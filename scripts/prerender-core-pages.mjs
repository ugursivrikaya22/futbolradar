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
const transfers = JSON.parse(fs.readFileSync(path.join(root, "data", "transfers.json"), "utf8"));
const fixtureCalendarPath = path.join(root, "data", "fixture-calendar.json");
const calendarMatches = fs.existsSync(fixtureCalendarPath)
  ? (JSON.parse(fs.readFileSync(fixtureCalendarPath, "utf8")).matches || [])
  : [];
const { getPlayers, formatMarketValueEur } = require("../services/playerService.js");
const { calculateMatchRadar, normalizeText } = require("../services/matchRadarService.js");
const { confidenceLabel, formatFreshnessDate, freshnessLabel, normalizeFreshness } = require("../services/freshnessService.js");
const { getFixtureWeeks, normalizeMatchStatus } = require("../services/superLigFixtureService.js");
const { curatedMatches } = require("../services/providers/mockProvider.js");
const {
  ROTATION_INTERVAL_MS,
  logFeaturedRotation,
  selectFeaturedMatches
} = require("../services/featuredMatchSelector.js");
const { orderForDisplay } = require("../services/postMatchReportStore.js");
const { filterPlayerCards, logRemovedCards, publicPlayerView } = require("../services/cardCredibility.js");
const { fixtureTeamNames } = require("../services/superLigTeams.js");

const FIXTURE_STATUS_TR = { SCHEDULED: "Planlandı", LIVE: "Canlı", FINISHED: "Bitti", POSTPONED: "Ertelendi", CANCELLED: "İptal" };
const FIXTURE_STATUS_SLUG = { SCHEDULED: "scheduled", LIVE: "live", FINISHED: "finished", POSTPONED: "postponed", CANCELLED: "cancelled" };

function fixtureTeamInitials(name) {
  const clean = String(name || "").trim();
  if (!clean) return "?";
  const parts = clean.split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("") || clean.charAt(0).toUpperCase();
}

function fixtureTeamLogoHtml(name) {
  return `<span class="fixture-team-logo-fallback" aria-hidden="true">${escapeHtml(fixtureTeamInitials(name))}</span>`;
}

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

const MATCH_STATUS_TR = { SCHEDULED: "Planlandı", LIVE: "Canlı", FINISHED: "Bitti", POSTPONED: "Ertelendi", CANCELLED: "İptal" };

function istanbulToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function longDateLabel(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "numeric",
    month: "long",
    weekday: "long"
  }).format(parsed);
}

/**
 * Statik yedek içerik: JS çalışmadan önce (ve arama motoru taramasında)
 * görünen blok. Eskiden koşulsuz "Bugün doğrulanmış maç yok" yazıyordu;
 * derleme anı ile görüntüleme anı aynı olmadığı için bu, maç olan günlerde
 * bile boş sayfa demekti. Artık takvimden yaklaşan maçlar kendi tarih
 * etiketleriyle basılıyor - bir gün eskise bile yanıltmayan bir içerik.
 */
function calendarProgramCards(limit) {
  const today = istanbulToday();
  // curatedMatches() merges data/matches.json with the provider calendar and
  // collapses the same fixture listed with the sides swapped. Reading the raw
  // calendar here rendered those duplicates into the static fallback, so the
  // homepage showed each neutral-venue friendly twice.
  const upcoming = curatedMatches()
    .filter((match) => String(match.kickoff || "").slice(0, 10) >= today)
    .sort((left, right) => String(left.kickoff).localeCompare(String(right.kickoff)))
    .slice(0, limit || 6);

  if (!upcoming.length) {
    return "";
  }

  return upcoming.map((match) => {
    const date = String(match.kickoff || "").slice(0, 10);
    const isToday = date === today;
    const status = String(match.status || "SCHEDULED").toUpperCase();
    // Biten maçta başlık saati değil skoru göstermeli; statik yedek JS
    // çalışmadığında da günün sonucunu vermek zorunda.
    const finalScore = match.score && match.score.home !== null && match.score.home !== undefined
      && match.score.away !== null && match.score.away !== undefined
      ? `${match.score.home}-${match.score.away}`
      : null;
    const headlineValue = status === "FINISHED" && finalScore ? finalScore : (match.time || "");

    return staticFixtureCard(match, { headlineValue, isToday, status, finalScore });
  }).join("");
}

/**
 * Statik maç kartı, istemcideki `renderFixtureCard` ile aynı işaretlemeyi
 * üretir. Aynı görünüm iki kez yazıldığı için değil; JavaScript çalışmadan
 * önce (ve tarayıcısız tarayıcılarda) sayfanın kartların son halini
 * göstermesi gerektiği için. İkisinin sınıf adları bilerek özdeştir.
 */
/**
 * Lig işareti: sağlayıcı lig logosu vermediği için turnuvanın baş
 * harflerinden tutarlı bir rozet üretilir. İstemcideki `leagueMarkHtml`
 * ile aynı kısaltma ve aynı renk tonunu verir.
 */
function leagueMarkHtml(league) {
  const name = String(league || "").trim();

  if (!name) {
    return "";
  }

  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toLocaleUpperCase("tr"))
    .join("");

  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 997;
  }

  return `<i class="league-mark league-mark-${hash % 5}" aria-hidden="true">${escapeHtml(initials)}</i>`;
}

function staticFormPercent(name) {
  const team = teamByName(name);
  const form = team && Array.isArray(team.form) ? team.form : null;

  if (!form || !form.length) {
    return null;
  }

  const earned = form.reduce((total, entry) => {
    const result = String((entry && (entry.result || entry.label)) || "").toLowerCase();
    if (result === "win" || result === "g") return total + 3;
    if (result === "draw" || result === "b") return total + 1;
    return total;
  }, 0);

  return Math.round((earned / (form.length * 3)) * 100);
}

function staticFixtureRow(name, score, otherScore) {
  const winner = score !== null && otherScore !== null && Number(score) > Number(otherScore);
  return `<div class="fixture-row${winner ? " is-winner" : ""}">` +
    `<span class="fixture-row-fallback" aria-hidden="true">${escapeHtml(fixtureTeamInitials(name))}</span>` +
    `<span class="fixture-row-name">${escapeHtml(name)}</span>` +
    `<span class="fixture-row-score">${escapeHtml(score === null ? "–" : score)}</span>` +
    `</div>`;
}

function staticFixtureCard(match, meta) {
  const { headlineValue, status, finalScore } = meta;
  const isLive = status === "LIVE";
  const isFinal = status === "FINISHED";
  const stateClass = isLive ? "is-live" : isFinal ? "is-final" : "";
  const stateLabel = isFinal ? "MS" : isLive ? "Canlı" : (headlineValue || MATCH_STATUS_TR[status] || "Planlandı");
  const homeScore = finalScore ? Number(String(finalScore).split("-")[0]) : null;
  const awayScore = finalScore ? Number(String(finalScore).split("-")[1]) : null;

  const homeForm = staticFormPercent(match.homeTeam);
  const awayForm = staticFormPercent(match.awayTeam);
  const formHtml = homeForm === null && awayForm === null
    ? ""
    : `<div class="fixture-metric"><span>Form (son 5)</span><b>${homeForm === null ? "–" : `%${homeForm}`} · ${awayForm === null ? "–" : `%${awayForm}`}</b></div>`;

  return `<article class="fixture-card${isLive ? " is-live" : ""}" data-card="fixture" data-match="${escapeHtml(match.id)}">
    <div class="fixture-card-top"><span class="fixture-card-league">${leagueMarkHtml(match.league)}${escapeHtml(match.league || "Maç programı")}</span><span class="fixture-card-state ${stateClass}">${escapeHtml(stateLabel)}</span></div>
    <div class="fixture-card-rows">${staticFixtureRow(match.homeTeam, homeScore, awayScore)}${staticFixtureRow(match.awayTeam, awayScore, homeScore)}</div>
    ${formHtml ? `<div class="fixture-card-meta">${formHtml}</div>` : ""}
    <a class="fixture-card-action" href="./canli-skor.html">Analizi İncele</a>
  </article>`;
}

/**
 * Hero karuselinin statik karşılığı.
 *
 * Sıra kuralı istemciyle (app.js: selectFeaturedMatchEntries) aynı serviste
 * tanımlıdır: canlı Türk takımı maçı ilk karta sabit, sonra bugünün diğer
 * Türk maçları, sonra büyük kulüplerin canlı maçları. Statik yedek bu
 * kuralı uygulamazsa, JS çalışana kadar ekranda Türk takımı maçı yerine
 * rastgele bir hazırlık maçı kalıyordu.
 *
 * İşaretleme istemcideki `renderFeaturedCarousel` ile bilerek özdeştir:
 * JS yüklendiğinde kart yerinden oynamasın, aynı slayt aynı yerde kalsın.
 * JS hiç çalışmazsa ilk slayt görünür kalır ve sayfa tek kart gösterir.
 */
function staticFeaturedFixture() {
  const today = istanbulToday();
  const all = curatedMatches();
  const list = all
    .filter((match) => String(match.kickoff || "").slice(0, 10) >= today)
    .sort((left, right) => String(left.kickoff).localeCompare(String(right.kickoff)));

  const liveCount = list.filter((match) => String(match.status || "").toUpperCase() === "LIVE").length;
  const todayList = list.filter((match) => String(match.kickoff || "").slice(0, 10) === today);
  const finishedCount = todayList.filter((match) => String(match.status || "").toUpperCase() === "FINISHED").length;
  const upcomingCount = todayList.length - finishedCount - liveCount;
  const selections = selectFeaturedMatches(all, { today });
  logFeaturedRotation("prerender-index", selections);
  const selection = selections[0] || null;
  const featured = selection && selection.match;

  // "Analizi hazır" istemcide de aynı kuralla sayılır (app.js:
  // matchHasReadyAnalysis): maçın yayımlanabilir bir okuması var mı? Statik
  // karşılığın eksik kalması, sayfa JS çalışmadan açıldığında sayacın hiç
  // görünmemesine ve ilk boyamada düzenin kaymasına yol açıyordu.
  const analysisReadyCount = todayList.filter((match) => Boolean(
    match.summary ||
    (match.analysis && (match.analysis.headline || match.analysis.lead)) ||
    (match.events || []).length ||
    (match.statistics || []).length
  )).length;

  const quickStats = `<div class="quick-stats" aria-label="Bugünün maç özeti">
      <a class="quick-stat${liveCount ? " is-live" : ""}" href="./canli-skor.html"><span>Canlı</span><b class="live-number">${liveCount}</b></a>
      <a class="quick-stat" href="./bugunun-maclari.html?status=upcoming"><span>Başlayacak</span><b>${Math.max(upcomingCount, 0)}</b></a>
      <a class="quick-stat" href="./bugunun-maclari.html?status=finished"><span>Biten</span><b>${finishedCount}</b></a>
      <a class="quick-stat${analysisReadyCount ? " is-ready" : ""}" href="./mac-merkezi.html"><span>Analizi hazır</span><b>${analysisReadyCount}</b></a>
      <a class="quick-stat" href="./bugunun-maclari.html"><span>Toplam</span><b>${todayList.length}</b></a>
    </div>`;

  if (!featured) {
    return `<div class="featured-fixture">
      <div class="featured-fixture-head"><span class="featured-fixture-league">Canlı skor panosu</span><span>Program kontrol ediliyor</span></div>
      <div class="home-match-command-empty"><strong>Maç programı yükleniyor.</strong><span>Bugünün doğrulanmış karşılaşmaları burada listelenecek.</span></div>
      <div class="home-match-command-actions featured-match-actions"><a class="button primary" href="./canli-skor.html">Canlı skor</a><a class="button secondary" href="./bugunun-maclari.html">Maç programı</a></div>
    </div>${quickStats}`;
  }

  const side = (name) => `<div class="featured-fixture-team">
        <span class="fixture-row-fallback" aria-hidden="true">${escapeHtml(fixtureTeamInitials(name))}</span>
        <strong>${escapeHtml(name)}</strong>
      </div>`;

  const card = (entry) => {
    const match = entry.match;
    const status = String(match.status || "SCHEDULED").toUpperCase();
    const hasScore = match.score && match.score.home !== null && match.score.home !== undefined
      && match.score.away !== null && match.score.away !== undefined;
    const headline = hasScore ? `${match.score.home} - ${match.score.away}` : (match.time || "—");
    // Skor/saat büyük alanda zaten yazıyor; rozet onu tekrar etmesin.
    const stateLabel = status === "FINISHED" ? "Maç sonucu" : status === "LIVE" ? "Canlı" : "Başlama saati";
    const dateLabel = String(match.kickoff || "").slice(0, 10) === today ? "Bugün" : longDateLabel(match.kickoff);

    return `<div class="featured-fixture${status === "LIVE" ? " is-live" : ""}" data-featured-reason="${escapeHtml(entry.reason)}" data-featured-turkish="${entry.turkish ? "true" : "false"}" data-featured-reason-label="${escapeHtml(entry.reasonLabel)}">
      <div class="featured-fixture-head"><span class="featured-fixture-league">${leagueMarkHtml(match.league)}${escapeHtml(match.league || "Maç programı")}</span><span>${escapeHtml(`${dateLabel} · ${match.venue || "Saha bilgisi bekleniyor"}`)}</span></div>
      <div class="featured-fixture-board">
        ${side(match.homeTeam)}
        <div class="featured-fixture-score"><b>${escapeHtml(headline)}</b><span>${escapeHtml(stateLabel)}</span></div>
        ${side(match.awayTeam)}
      </div>
      <div class="home-match-command-actions featured-match-actions"><a class="button primary" href="./canli-skor.html">Analizi İncele</a><a class="button secondary" href="./bugunun-maclari.html">Maç programı</a></div>
    </div>`;
  };

  const slides = selections.map((entry, index) => `<div class="featured-carousel-slide${index === 0 ? " is-active" : ""}" data-featured-slide="${index}" data-featured-match="${escapeHtml(String(entry.match.id || ""))}" role="group" aria-roledescription="slayt" aria-label="${index + 1} / ${selections.length}"${index === 0 ? "" : " hidden"}>${card(entry)}</div>`).join("");

  // Tek maç varsa dönecek bir şey yok; gezinme çizilmez.
  const nav = selections.length < 2 ? "" : `<div class="featured-carousel-nav">
      <button type="button" class="featured-carousel-arrow" data-featured-prev aria-label="Önceki maç"><span aria-hidden="true">‹</span></button>
      <div class="featured-carousel-dots" role="tablist" aria-label="Öne çıkan maçlar">${selections.map((entry, index) => `<button type="button" class="featured-carousel-dot${index === 0 ? " is-active" : ""}" data-featured-go="${index}" role="tab" aria-selected="${index === 0 ? "true" : "false"}" aria-label="${escapeHtml(`${entry.match.homeTeam || "?"} - ${entry.match.awayTeam || "?"}`)}"><span aria-hidden="true"></span></button>`).join("")}</div>
      <button type="button" class="featured-carousel-arrow" data-featured-next aria-label="Sonraki maç"><span aria-hidden="true">›</span></button>
    </div>`;

  return `<div class="featured-carousel" data-featured-carousel data-featured-interval="${ROTATION_INTERVAL_MS}" data-featured-count="${selections.length}" aria-roledescription="karusel" aria-label="Öne çıkan maçlar">
      <div class="featured-carousel-viewport">${slides}</div>
      ${nav}
    </div>${quickStats}`;
}

/**
 * MAÇ SONRASI ANALİZ KARTLARI — statik karşılık.
 *
 * İşaretleme istemcideki `renderPostMatchCard` ile bilerek özdeş: JS
 * yüklendiğinde kartlar yerinden oynamasın. Kaynak build sırasında bir kez
 * üretilen `data/post-match-reports.json`; burada hiçbir analiz yeniden
 * hesaplanmaz, yalnızca saklanmış kayıt basılır.
 */
function postMatchStore() {
  const storePath = path.join(root, "data", "post-match-reports.json");
  if (!fs.existsSync(storePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, "utf8"));
    return Array.isArray(parsed.records) ? parsed.records : [];
  } catch (error) {
    console.warn(`[prerender] post-match-reports.json okunamadı: ${error.message}`);
    return [];
  }
}

function postMatchScoreLine(record) {
  if (!record.score || typeof record.score.home !== "number" || typeof record.score.away !== "number") {
    return `${record.homeTeam || "?"} - ${record.awayTeam || "?"}`;
  }
  return `${record.homeTeam || "?"} ${record.score.home}-${record.score.away} ${record.awayTeam || "?"}`;
}

function postMatchDateLabel(value) {
  const parsed = new Date(`${String(value || "").slice(0, 10)}T00:00:00Z`);
  if (!value || Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "long", year: "numeric", timeZone: "Europe/Istanbul" }).format(parsed);
}

const COVERAGE_LABELS = {
  full: "Tam analiz",
  partial: "Kısmi analiz",
  "events-only": "Sadece olaylar",
  "awaiting-provider": "Sağlayıcı verisi bekleniyor",
  "api-key-missing": "API anahtarı eksik"
};

function postMatchCoverageLabel(record) {
  if (record && record.coverageLabel) return record.coverageLabel;
  return COVERAGE_LABELS[record && record.coverageGrade] || "Analiz durumu bilinmiyor";
}

function postMatchSourceLabel(record) {
  const sources = (record && record.dataSources) || {};
  const names = [...new Set(Object.values(sources)
    .filter((entry) => entry && entry.present && entry.source)
    .map((entry) => entry.source))];
  return names.length ? `Kaynak: ${names.join(", ")}` : "Kaynak doğrulanmadı";
}

const POST_MATCH_STATUS_LABELS = {
  waiting_for_final_data: "Analiz hazırlanıyor",
  ready_for_analysis: "Analiz sırada",
  generating: "Analiz üretiliyor",
  completed: "Analiz tamamlandı",
  partial_data: "Kısmi veri",
  failed: "Analiz üretilemedi",
  retry_scheduled: "Yeniden denenecek"
};

function postMatchStatusLabel(record) {
  return POST_MATCH_STATUS_LABELS[record && record.analysisStatus] || "Analiz durumu bilinmiyor";
}

function postMatchUpdatedLabel(value) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return `Güncelleme: ${new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
    timeZone: "Europe/Istanbul"
  }).format(parsed)} TSİ`;
}

function postMatchCard(record) {
  const digest = record.digest || {};
  const meta = [record.league, postMatchDateLabel(record.date)].filter(Boolean).join(" · ");
  const finish = digest.finish;
  const finishNote = finish && finish.type && finish.type !== "regular" ? finish.label : "";
  const turning = digest.turningPoints || {};
  const late = digest.lateGame;
  const players = (digest.keyPlayers || {}).players || [];
  const missing = Array.isArray(record.missingInputs) ? record.missingInputs : [];

  const momentsHtml = turning.status === "ready" && (turning.moments || []).length
    ? `<div class="post-match-moments"><span class="post-match-label">Kırılma anları</span><ul>${turning.moments.map((moment) =>
      `<li${moment.pivotal ? ' class="is-pivotal"' : ""}><b>${escapeHtml(moment.minute)}</b> ${escapeHtml([moment.team, moment.type].filter(Boolean).join(" · "))}${moment.detail ? `<span>${escapeHtml(moment.detail)}</span>` : ""}</li>`).join("")}</ul></div>`
    : "";

  const lateHtml = late && late.status === "ready" && late.verdict
    ? `<div class="post-match-late"><span class="post-match-label">Maç sonu (${escapeHtml(String(late.from || 75))}'+)</span><p>${escapeHtml(late.verdict)}</p></div>`
    : "";

  const playersHtml = players.length
    ? `<div class="post-match-players"><span class="post-match-label">Öne çıkan oyuncular</span><ul>${players.map((player) =>
      `<li><b>${escapeHtml(player.name || "")}</b>${player.team ? `<span>${escapeHtml(player.team)}</span>` : ""}${player.contribution ? `<span>${escapeHtml(player.contribution)}</span>` : ""}</li>`).join("")}</ul></div>`
    : "";

  // Anahtar yoksa eksiklik sağlayıcının değil, kurulumun.
  const missingHtml = record.apiKeyPresent === false
    ? `<p class="post-match-missing is-key-missing"><strong>API anahtarı eksik</strong> ${escapeHtml("Sağlayıcıya istek gönderilemiyor; gösterilen veri depoda saklanan son kayıttır ve taze değildir.")}</p>`
    : (missing.length
      ? `<p class="post-match-missing"><strong>${escapeHtml(record.providerMissingLabel || "Veri sağlayıcı tarafından sunulmadı")}</strong> ${escapeHtml(missing.map((item) => item.label).join(", "))}</p>`
      : "");

  return `<article class="post-match-card${record.turkish ? " is-turkish" : ""}" data-card="post-match" data-match="${escapeHtml(record.matchId || "")}">` +
    `<div class="post-match-head"><span class="post-match-meta">${escapeHtml(meta)}</span>${finishNote ? `<span class="post-match-finish">${escapeHtml(finishNote)}</span>` : ""}<span class="post-match-status is-${escapeHtml(String(record.coverageGrade || "unknown"))}" title="${escapeHtml(String(record.coverageNote || ""))}">${escapeHtml(postMatchCoverageLabel(record))}</span></div>` +
    `<strong class="post-match-score">${escapeHtml(postMatchScoreLine(record))}</strong>` +
    (digest.headline ? `<h3>${escapeHtml(digest.headline)}</h3>` : "") +
    (digest.paragraph ? `<p>${escapeHtml(digest.paragraph)}</p>` : "") +
    momentsHtml + lateHtml + playersHtml + missingHtml +
    `<div class="post-match-footer"><span class="post-match-coverage">Veri kapsamı %${escapeHtml(String(record.coveragePercent || 0))} · ${escapeHtml(postMatchSourceLabel(record))}${record.analysisUpdatedAt ? ` · ${escapeHtml(postMatchUpdatedLabel(record.analysisUpdatedAt))}` : ""}</span>` +
    (record.publishState === "page"
      ? `<a class="detail-link" href="${escapeHtml(record.reportUrl || "#")}">Tam raporu aç</a>`
      : `<span class="post-match-note">Analiz hazırlanıyor</span>`) +
    "</div></article>";
}

/** Sunum sırası: bitmiş Türk takımı maçları önce, sonra en yeni. */
function postMatchAnalysisCards(limit) {
  const ordered = orderForDisplay(postMatchStore());
  const records = limit ? ordered.slice(0, limit) : ordered;

  if (!records.length) {
    return `<article class="card data-empty" data-card="empty-state"><strong>Tamamlanan maç analizi yok</strong><span>Bir maç bittiğinde ölçülmüş veriden üretilen analizi burada listelenecek.</span></article>`;
  }

  return records.map(postMatchCard).join("");
}

function matchProgramState(variant) {
  const cards = calendarProgramCards(variant === "today" ? 6 : 4);
  return cards || emptyMatchState(variant);
}

function emptyMatchState(variant) {
  const isFeatured = variant === "featured";
  const isLive = variant === "live";
  if (isFeatured) {
    return `<div class="home-match-command">
      <div class="home-match-command-head"><div><span>Canlı skor panosu</span><strong>Program kontrol ediliyor</strong></div><a href="./canli-skor.html">Tam ekran</a></div>
      <div class="home-match-command-metrics" aria-label="Bugünün maç özeti"><a href="./canli-skor.html"><span>Canlı</span><b class="live-number">0</b></a><a href="./bugunun-maclari.html?status=upcoming"><span>Başlayacak</span><b>0</b></a><a href="./bugunun-maclari.html?status=finished"><span>Biten</span><b>0</b></a></div>
      <div class="home-match-command-empty"><strong>Maç programı yükleniyor.</strong><span>Bugünün doğrulanmış karşılaşmaları burada listelenecek.</span></div>
      <div class="home-match-command-actions featured-match-actions"><a class="button primary" href="./canli-skor.html">Canlı skor</a><a class="button secondary" href="./bugunun-maclari.html">Maç programı</a></div>
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

function staticTeamCard(team) {
  return `<article class="team-card" data-card="team-radar" data-team="${escapeHtml(team.id)}"><header><div><h3>${escapeHtml(team.name)}</h3><span>Sezon öncesi referans</span></div><strong class="momentum-number">${escapeHtml(team.momentum)}</strong></header>${formDots(team.form)}<div class="metric-grid compact"><span>Hücum <b>${escapeHtml(team.attack)}</b></span><span>Savunma <b>${escapeHtml(team.defense)}</b></span></div><a class="detail-link" href="./takim-detay.html?team=${encodeURIComponent(team.id)}">Takım radarını aç</a></article>`;
}

/**
 * Ana sayfadaki "trend takımlar" şeridi. Değerler doğrudan takım verisinden
 * gelir (momentum, form, hücum/savunma); hiçbir sayı burada üretilmez.
 */
function trendTeamCards() {
  return teams
    .slice()
    .sort((left, right) => Number(right.momentum || 0) - Number(left.momentum || 0))
    .slice(0, 8)
    .map((team) => {
      const initials = fixtureTeamInitials(team.name);
      return `<article class="trend-card" data-card="trend-team" data-team="${escapeHtml(team.id)}">
      <div class="trend-card-head"><span class="trend-card-avatar" aria-hidden="true">${escapeHtml(initials)}</span><span><strong>${escapeHtml(team.name)}</strong><span>${escapeHtml(team.league || "Takım")}</span></span><b class="trend-card-score">${escapeHtml(team.momentum ?? "–")}</b></div>
      ${formDots(team.form)}
      <dl class="trend-card-stats"><div><dt>Hücum</dt><dd>${escapeHtml(team.attack ?? "–")}</dd></div><div><dt>Savunma</dt><dd>${escapeHtml(team.defense ?? "–")}</dd></div><div><dt>Form</dt><dd>${escapeHtml(team.formScore ?? "–")}</dd></div></dl>
      <a class="fixture-card-action" href="./takim-detay.html?team=${encodeURIComponent(team.name)}">Takım radarını aç</a>
    </article>`;
    })
    .join("");
}

function staticStandingRows() {
  return standingsPreseason(false);
}

function staticHomeStandingRows() {
  return standingsPreseason(true);
}

function standingsPreseason(compact) {
  return `<div class="standings-empty${compact ? " compact" : ""}" data-card="standings-preseason"><span class="card-kicker">Süper Lig · 2026/27</span><strong>2026/27 sezonu henüz başlamadı</strong><p>Süper Lig 14 Ağustos'ta başlayacak. İlk maçlar tamamlandığında puan tablosu otomatik güncellenecek.</p><a class="detail-link" href="./super-lig-fikstur.html">Sezon fikstürünü aç</a></div>`;
}

function staticMomentumRows() {
  return momentum.slice().sort((left, right) => Number(left.rank) - Number(right.rank)).map((row) => `<div class="table-row" data-card="momentum" data-team="${escapeHtml(row.team)}"><span>${escapeHtml(row.rank)}</span><b>${escapeHtml(row.team)}</b><span>${escapeHtml(row.momentum)}</span><span>${escapeHtml(row.formScore)}</span><span>${escapeHtml(row.goalSignal)}</span><span>${escapeHtml(row.risk)}</span></div>`).join("");
}

/**
 * GÖRÜNÜR KART GÜVENİLİRLİĞİ (bkz. services/cardCredibility.js)
 *
 * Denetim sonucu: 110 oyuncu kaydının HİÇBİRİ yayın barını geçmiyor —
 * 102'sinde sağlayıcı kimliği hiç yok, 8'inde "mock-..." yer tutucu var.
 * Ana sayfada görünen üç kart (Icardi, Aktürkoğlu, Dzeko) bu sekizden
 * geliyordu; ikisi ayrıca ligde bile oynamıyordu (serbest oyuncu ve
 * Schalke 04).
 *
 * Bu yüzden bölüm doldurulmuyor: doğrulanmış kayıt yoksa temiz bir boş
 * durum basılıyor. Sayfayı doldurmak, okuyucuya doğrulanmamış bir puan
 * göstermenin gerekçesi değil.
 */
function verifiedTrendPlayers(limit) {
  const { kept, removed } = filterPlayerCards(topPlayers, {
    trend: true,
    leagueTeams: fixtureTeamNames()
  });
  logRemovedCards("homepage-trend-players", removed.slice(0, 5));
  if (removed.length > 5) {
    console.warn(`[futbolradar:card-hidden] scope=homepage-trend-players ...ve ${removed.length - 5} kayıt daha`);
  }
  return kept.slice(0, limit);
}

function emptyStateCard(title, note) {
  return `<article class="card data-empty" data-card="empty-state"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(note)}</span></article>`;
}

function trendPlayerSlot(limit) {
  const verified = verifiedTrendPlayers(limit);
  if (!verified.length) {
    return emptyStateCard(
      "Veri bekleniyor",
      "Trend oyuncu kartları yalnızca doğrulanmış, sağlayıcı kimliği olan güncel sezon verisinden üretilir. " +
      "Kadro senkronu bu veriyi getirdiğinde bu alan otomatik dolar."
    );
  }
  return verified.map(simplePlayerCard).join("");
}

/**
 * Kartın alanları KAPIDAN GEÇENLERDEN okunur, ham kayıttan değil.
 *
 * Kaydın kaynağının doğrulanmış olması üstündeki her sayıyı doğrulamıyor:
 * kadro uç noktası derecelendirme, dakika ve piyasa değeri göndermiyor.
 * Ham kayıt okunduğunda normalizePlayer'ın varsayılanları (rating 32,
 * dakika 0, piyasa "Yakında") doğrulanmış kart görünümüyle basılıyordu.
 */
function simplePlayerCard(player) {
  const view = publicPlayerView(player);
  const age = player.computedAge || player.age || "Bilinmiyor";
  const ratingValue = view.fields.overallRating || view.fields.aiRating || view.fields.rating;
  const minutesValue = view.fields.minutesPlayed ?? view.fields.minutes;
  const marketValue = view.fields.marketValueEur !== undefined
    ? formatMarketValueEur(view.fields.marketValueEur)
    : (view.fields.marketValue || null);
  const clubValue = view.fields.currentTeam || view.fields.team;

  const kicker = [clubValue, player.position].filter(Boolean).join(" · ");
  const badge = ratingValue
    ? `<strong class="big-value player-rating-badge">${escapeHtml(ratingValue)}</strong>`
    : "";
  const metrics = [`<span>Yaş <b>${escapeHtml(age)}</b></span>`];
  if (minutesValue !== undefined && minutesValue !== null) {
    metrics.push(`<span>Dakika <b>${escapeHtml(minutesValue)}</b></span>`);
  }
  if (marketValue) metrics.push(`<span>Piyasa <b>${escapeHtml(marketValue)}</b></span>`);

  return `<article class="card player-detail-card" data-card="player" data-player="${escapeHtml(player.id)}"><div class="card-head"><div><span class="card-kicker">${escapeHtml(kicker)}</span><h2>${escapeHtml(player.name)}</h2></div>${badge}</div><div class="metric-grid compact">${metrics.join("")}</div><p>${escapeHtml(player.summary || "Profil metrikleri ve transfer geçmişi oyuncu sayfasında yer alır.")}</p><a class="detail-link" href="./oyuncular/${escapeHtml(player.id)}.html">Oyuncu profilini aç</a></article>`;
}

/**
 * Oyuncu sinyalleri de aynı bara tabi. Sinyal kartı bir oyuncuyu "en iyi"
 * ilan ediyor; dayandığı kayıt doğrulanamıyorsa bu iddia yayımlanmamalı.
 */
function playerSignalsSlot() {
  const { kept } = filterPlayerCards(players, { trend: true, leagueTeams: fixtureTeamNames() });
  if (!kept.length) {
    return emptyStateCard(
      "Veri bekleniyor",
      "Oyuncu sinyalleri doğrulanmış sezon istatistiğine dayanır; sağlayıcıdan bu veri geldiğinde alan dolar."
    );
  }
  return playerSignals(kept);
}

function playerSignals(pool) {
  const source = Array.isArray(pool) ? pool : players;
  const by = (field) => source.slice().sort((left, right) => Number(right[field] || 0) - Number(left[field] || 0))[0];
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

function fixtureMatchRowHtml(match, round) {
  const status = normalizeMatchStatus(match.status);
  const statusSlug = FIXTURE_STATUS_SLUG[status] || "scheduled";
  const timeLabel = match.dateLabel || round.dateRange || "Tarih ve saat bekleniyor";
  const scoreOrVs = status === "FINISHED" && match.score
    ? `<strong>${escapeHtml(displayScore(match.score))}</strong>`
    : `<span class="vs-pill">VS</span>`;

  return `<a class="fixture-match-row" data-card="fixture-match" data-status="${statusSlug}" href="./mac/${escapeHtml(matchSlug({ ...match, round: round.round }))}.html">` +
    `<div class="fixture-match-time"><span class="fixture-time">${escapeHtml(timeLabel)}</span><span class="fixture-status-badge" data-status="${statusSlug}">${escapeHtml(FIXTURE_STATUS_TR[status] || "Planlandı")}</span></div>` +
    `<div class="fixture-match-team fixture-match-team-home">${fixtureTeamLogoHtml(match.homeTeam)}<span>${escapeHtml(match.homeTeam)}</span></div>` +
    `<div class="fixture-match-score">${scoreOrVs}</div>` +
    `<div class="fixture-match-team fixture-match-team-away">${fixtureTeamLogoHtml(match.awayTeam)}<span>${escapeHtml(match.awayTeam)}</span></div>` +
    `<div class="fixture-venue">${escapeHtml(match.venue || "")}</div>` +
    `</a>`;
}

function displayScore(score) {
  if (!score || score.home === null || score.home === undefined || score.away === null || score.away === undefined) {
    return "- : -";
  }
  return `${score.home} - ${score.away}`;
}

function fixtureRounds() {
  const weeks = getFixtureWeeks(fixtures);
  return weeks.map((round) => `<section class="fixture-round-card" data-card="fixture-round"><div class="fixture-round-head"><div><span>${escapeHtml(round.dateRange || "Tarih ve saat bekleniyor")}</span><h2>${escapeHtml(round.label)}</h2></div><b>Onaylı eşleşmeler</b></div><div class="fixture-match-list">${(round.matches || []).map((match) => fixtureMatchRowHtml(match, round)).join("")}</div></section>`).join("");
}

/**
 * Transfer radarı bu sezonun hareketlerini gösteriyor; sınır app.js'teki
 * TRANSFER_RADAR_SINCE ile aynı olmalı. Statik ön render eski kayıtları
 * gösterip JS yüklendiğinde liste değişseydi, okuyucu sayfanın kendi
 * kendini düzelttiğini görürdü.
 */
const TRANSFER_RADAR_SINCE = "2026-07-01";

function transferWatch() {
  const selected = transfers
    .filter((transfer) => String(transfer && transfer.date || "").slice(0, 10) >= TRANSFER_RADAR_SINCE)
    .sort((left, right) => String(right.date || "").localeCompare(String(left.date || ""))).slice(0, 5);
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

/**
 * TAZELİK DAMGASI MAKİNE OKUNUR OLMALI.
 *
 * Damga bugüne kadar yalnızca "Son kontrol: 24 Temmuz 2026 15:27 TSİ"
 * biçiminde basılıyordu. İnsan için doğru, tarayıcı için okunamaz: Türkçe
 * ay adı ve "TSİ" eki hiçbir standart tarih biçimine uymuyor. Canlı skor
 * gibi tazeliğin sıralamayı doğrudan belirlediği bir sayfada, tarihin
 * ayrıştırılamaması sinyali tamamen kaybettiriyor.
 *
 * Görünen metin aynı kalıyor; yanına `<time datetime>` ekleniyor. Değer
 * UYDURULMUYOR — kaynağı sağlayıcı doğrulama damgasının kendisi; yoksa
 * `<time>` hiç basılmıyor.
 */
function freshnessStamp(freshness) {
  const raw = (freshness && (freshness.verifiedAt || freshness.fetchedAt)) || null;
  const label = `Son kontrol: ${formatFreshnessDate(raw)}`;
  const parsed = raw ? new Date(raw) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return escapeHtml(label);
  return `Son kontrol: <time datetime="${escapeHtml(parsed.toISOString())}">${escapeHtml(formatFreshnessDate(raw))}</time>`;
}

function updateMetaLabels(html, freshness) {
  const stamp = freshnessStamp(freshness);
  // `[\s\S]*?` — damga artık iç içe `<time>` taşıyabildiği için eski
  // `[^<]*` deseni ikinci koşuda eşleşmiyordu ve damga donup kalırdı.
  return html
    .replace(/<span class="hero-meta">(?:Son güncelleme|Son kontrol):[\s\S]*?<\/span>/g, `<span class="hero-meta">${stamp}</span>`)
    .replace(/<span class="data-stamp">(?:Son güncelleme|Son kontrol):[\s\S]*?<\/span>/g, `<span class="data-stamp">${stamp}</span>`);
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
  "featured-match": staticFeaturedFixture(),
  "home-trend-teams": trendTeamCards(),
  "home-transfer-watch": transferWatch(),
  "today-matches": matchProgramState("today"),
  "radar-signals": signalCards(),
  "team-radar": topTeams.slice(0, 4).map(staticTeamCard).join(""),
  "home-standings": staticHomeStandingRows(),
  "player-radar": trendPlayerSlot(3),
  "player-signals": playerSignalsSlot(),
  "news-preview": newsCards(3),
  "analysis-preview": analysisCards()
}, fixtureFreshness);

writePage("analizler.html", {
  "post-match-analyses": postMatchAnalysisCards()
}, fixtureFreshness);

writePage("haberler.html", {
  "news-page": newsCards()
}, fixtureFreshness);

writePage("bugunun-maclari.html", {
  "matches-page": matchProgramState("today")
}, fixtureFreshness);

writePage("canli-skor.html", {
  // Canlı maç yokken de günün sonuçları görünsün: sayfa eskiden yalnızca
  // "canlı maç yok" diyordu ve o günün oynanmış maçları hiç listelenmiyordu.
  "live-score": matchProgramState("live")
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
  "players-page": trendPlayerSlot(6)
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
