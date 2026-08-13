import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { transferTickerTrack } from "./lib/transferTicker.mjs";
import {
  fixtureCard as sharedFixtureCard,
  fixtureRow as sharedFixtureRow,
  leagueMatchGroup as sharedLeagueMatchGroup,
  trendCard as sharedTrendCard,
  transferWatchShell
} from "./lib/matchCards.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);
const retryBuffer = new Int32Array(new SharedArrayBuffer(4));

function writeGeneratedFile(file, contents) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      fs.writeFileSync(file, contents, "utf8");
      return;
    } catch (error) {
      const retryable = ["UNKNOWN", "EBUSY", "EPERM"].includes(error && error.code);
      if (!retryable || attempt === 11) throw error;
      Atomics.wait(retryBuffer, 0, 0, 75 * (attempt + 1));
    }
  }
}
// Dış bağlantı politikası tek yerde: services/sourceLinks.js.
const { SOURCE_LINK_REL } = require("../services/sourceLinks.js");
// Haber akışı kuralı da tek yerde: services/newsFeed.js. Veri okumadan önce
// alınıyor, çünkü `news` sabiti hemen aşağıda bu süzgeci kullanıyor.
const { publishableNews, newsHref, isExternalHref } = require("../services/newsFeed.js");
// Transfer bandının seçim/sıralama kuralı da tek yerde; İngilizce bant da
// aynı servisi kullanıyor.
const { selectTickerRecords } = require("../services/transferRadarTicker.js");
// Maç ilgi puanı: sıralama kuralı tek yerde (API de aynı servisi kullanır).
const { withRelevance } = require("../services/matchRelevance.js");
// "Bugünün Maçları" yüzeyinin kuralı — sıra, lig blokları, bağlantı, SSS.
const {
  groupMatchesByLeague,
  matchDetailPath,
  matchProgramFaq,
  orderMatchProgram
} = require("../services/matchProgram.js");
// Maçların makine okunur karşılığı (SportsEvent / FAQPage).
const { faqSchema, matchListSchema } = require("../services/matchSchema.js");
const fixtures = JSON.parse(fs.readFileSync(path.join(root, "data", "super-lig-fixtures.json"), "utf8"));
const teams = JSON.parse(fs.readFileSync(path.join(root, "data", "teams.json"), "utf8"));
const momentum = JSON.parse(fs.readFileSync(path.join(root, "data", "momentum.json"), "utf8"));
const signals = JSON.parse(fs.readFileSync(path.join(root, "data", "signals.json"), "utf8"));
const analyses = JSON.parse(fs.readFileSync(path.join(root, "data", "analyses.json"), "utf8"));
// Haber akışı kuralı servistedir (services/newsFeed.js); İngilizce üretici de
// aynı listeyi oradan alır. Süzgeç yalnızca `verified` demiyor: haberin
// GÖVDESİ de olmalı, çünkü sayfa üreticisi gövdesizler için sayfa yazmıyor ve
// o karta bağlanmak 404 demek.
const newsPayload = JSON.parse(fs.readFileSync(path.join(root, "data", "news.json"), "utf8"));
const news = publishableNews(newsPayload);
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
const { CONFIRMED_FIXTURE_STATUSES, getFixtureWeeks, normalizeMatchStatus } = require("../services/superLigFixtureService.js");
const { curatedMatches } = require("../services/providers/mockProvider.js");
const {
  ROTATION_INTERVAL_MS,
  logFeaturedRotation,
  selectFeaturedMatches
} = require("../services/featuredMatchSelector.js");
const { orderForDisplay } = require("../services/postMatchReportStore.js");
const { renderQuickStats } = require("../services/homeQuickStats.js");
const { buildDailyHeadlines } = require("../services/dailyHeadlines.js");
const { buildMatchShareText, renderShareBlock } = require("../services/shareText.js");
const { filterPlayerCards, logRemovedCards, publicPlayerView } = require("../services/cardCredibility.js");
const { fixtureTeamNames, sameClub } = require("../services/superLigTeams.js");
const { MATCH_LIST_INITIAL } = require("../services/matchListWindow.js");
// Statik yedeğin takvim günü, istemcinin kullandığı kuralla AYNI olmalı
// (app.js: istanbulDayOf). Ayrışırsa JavaScript açılana kadar farklı bir
// gün listelenir ve sayfa gözün önünde değişir.
const { istanbulDay } = require("../services/matchStatus.js");

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

function hasCompleteScore(match) {
  const score = match && match.score;
  return Boolean(score) && Number.isFinite(Number(score.home)) && Number.isFinite(Number(score.away));
}

function isVerifiedFinalMatch(match) {
  const status = String(match && match.status || "").toUpperCase();
  return status === "FINISHED" &&
    hasCompleteScore(match) &&
    String(match.dataStatus || "").toLowerCase() === "verified" &&
    String(match.publishState || "").toLowerCase() === "complete";
}

function allFixtures() {
  return (fixtures.rounds || []).flatMap((round) => (round.matches || []).map((match) => ({
    ...match,
    round: round.round,
    roundLabel: round.label,
    dateRange: match.dateLabel || round.dateRange || "Tarih ve saat bekleniyor",
    league: fixtures.league,
    freshness: fixtures.freshness
  }))).filter((match) => CONFIRMED_FIXTURE_STATUSES.has(match.fixtureStatus));
}

// Aynı kulüp kaynaklara göre farklı yazılıyor: sağlayıcı "Rizespor" derken
// TFF fikstürü "Çaykur Rizespor" diyor. Tam eşitlik arandığı sürece bu üç
// kulüp (Rizespor, Gençlerbirliği, Amed) fikstür kartlarında takım kaydına
// hiç bağlanamıyordu: form, momentum ve rozet boş kalıyordu. Kural zaten
// services/superLigTeams.js#sameClub içinde tanımlı; burada da o kullanılır.
function teamByName(name) {
  return teams.find((team) => normalizeText(team.name) === normalizeText(name)) ||
    teams.find((team) => sameClub(team.name, name)) ||
    null;
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
function programMatchPool() {
  const today = istanbulToday();
  // curatedMatches() merges data/matches.json with the provider calendar and
  // collapses the same fixture listed with the sides swapped. Reading the raw
  // calendar here rendered those duplicates into the static fallback, so the
  // homepage showed each neutral-venue friendly twice.
  return curatedMatches()
    .filter((match) => istanbulDay(match.kickoff) >= today)
    .filter((match) => String(match.status || "").toUpperCase() !== "FINISHED" || isVerifiedFinalMatch(match));
}

function programFixtureCard(match, today) {
  const date = istanbulDay(match.kickoff);
  const isToday = date === today;
  const status = String(match.status || "SCHEDULED").toUpperCase();
  // Biten maçta başlık saati değil skoru göstermeli; statik yedek JS
  // çalışmadığında da günün sonucunu vermek zorunda.
  const finalScore = isVerifiedFinalMatch(match)
    ? `${match.score.home}-${match.score.away}`
    : null;
  const headlineValue = status === "FINISHED" && finalScore ? finalScore : (match.time || "");

  return staticFixtureCard(match, { headlineValue, isToday, status, finalScore });
}

function calendarProgramMatches(limit) {
  return programMatchPool()
    .sort((left, right) => String(left.kickoff).localeCompare(String(right.kickoff)))
    .slice(0, limit || 6);
}

function calendarProgramCards(limit) {
  const today = istanbulToday();
  const upcoming = calendarProgramMatches(limit);

  if (!upcoming.length) {
    return "";
  }

  return upcoming.map((match) => programFixtureCard(match, today)).join("");
}

/**
 * "BUGÜNÜN MAÇLARI" SAYFASININ STATİK LİSTESİ.
 *
 * Ana sayfadaki önizlemeden İKİ noktada ayrılır ve ikisi de istemciyle
 * hizalanmak için:
 *
 *   1. SIRA — ilgi puanı (services/matchProgram.js). Ölçüldü: 12 Ağustos
 *      2026'da başlama saatine göre sıralanan liste, günün ilk on ikisini
 *      15:00–19:15 arası hazırlık maçlarından seçiyordu; Konferans Ligi eleme
 *      maçları, Leeds–Manchester United ve Deportivo–Real Madrid pencerenin
 *      dışında kalıyordu. Sayfanın hedef sorgusu "bugünkü maçlar" ve arama
 *      motorunun gördüğü liste günün en çok aranan maçlarını içermiyordu.
 *
 *   2. LİG BLOKLARI — istemci listeyi liglere ayırıyor, statik yedek tek
 *      düz liste basıyordu. JavaScript yüklendiğinde yerleşim değişiyordu ve
 *      HTML'de hangi maçın hangi turnuvaya ait olduğu hiç yazmıyordu.
 *
 * Pencere yine MATCH_LIST_INITIAL kart: sayı bloklara BÖLÜNMEDEN önce
 * uygulanır, yani toplam görünen kart sayısı istemcininkiyle aynı kalır.
 */
function matchProgramPageCards() {
  const today = istanbulToday();
  const pool = programMatchPool();

  // LİSTE TEK BİR GÜNE AİT.
  //
  // Havuz bugünden İTİBAREN bütün maçları taşıyor; ana sayfadaki önizleme
  // için doğru, bu sayfa için değil. Sıra saate göreyken sorun görünmüyordu
  // (bugünün maçları zaten önce geliyordu), ilgi puanına geçilince gelecek
  // haftanın Süper Lig maçları bugünün Konferans Ligi maçlarının üstüne
  // çıktı — "Bugünün Maçları" sayfasında bugün oynanmayan maçlar.
  //
  // Bugün maç yoksa liste maç OLAN ilk güne kayar: boş sayfa göstermek
  // yerine hangi günü gösterdiğimizi söyleriz (SSS metinleri o günün adını
  // taşır, "bugün" demez).
  const days = [...new Set(pool.map((match) => istanbulDay(match.kickoff)))].sort();
  const day = days.includes(today) ? today : days[0];

  // Günün TAMAMI ile PENCERE ayrı iki liste. Kartlar pencereden basılır
  // (istemcinin ilk görünümüyle aynı sayı), ama günü ANLATAN metin — kaç maç
  // var, ilk ve son başlama saati — günün tamamından okunur. Pencereden
  // sayılsaydı sayfa "günün son maçı 19:15" derdi; o saat pencerenin sonu,
  // günün değil.
  const dayMatches = day
    ? orderMatchProgram(withRelevance(pool.filter((match) => istanbulDay(match.kickoff) === day)))
    : [];
  const ordered = dayMatches.slice(0, MATCH_LIST_INITIAL);

  if (!ordered.length) {
    return { html: "", matches: [], dayMatches: [], day: "" };
  }

  const html = groupMatchesByLeague(ordered)
    .map((group) => sharedLeagueMatchGroup({
      league: group.league || "Diğer karşılaşmalar",
      countLabel: `${group.matches.length} maç`,
      cardsHtml: group.matches.map((match) => programFixtureCard(match, today)).join("")
    }))
    .join("");

  return { html, matches: ordered, dayMatches, day };
}

/**
 * SSS bölümü. İşaretleme, sitede zaten yayında olan arama-talebi
 * sayfalarınınkiyle aynı (`.demand-faq` + `details.card`) — yeni bir görsel
 * dil ya da yeni CSS getirmiyor.
 *
 * Soru yoksa BÖLÜM DE YOK: başlığını yazıp altını boş bırakmak, bölümü hiç
 * göstermemekten kötü.
 */
function faqSectionHtml(entries, heading) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return "";

  const items = list
    .map((entry) => `<details class="card"><summary><b>${escapeHtml(entry.question)}</b></summary><p>${escapeHtml(entry.answer)}</p></details>`)
    .join("\n        ");

  return `      <section class="demand-faq" aria-labelledby="today-faq-title">
        <h2 id="today-faq-title">${escapeHtml(heading || "Sık sorulanlar")}</h2>
        ${items}
      </section>`;
}

/**
 * JSON-LD etiketi. `<` kaçırılır: aksi hâlde veri içindeki bir `</script>`
 * dizgesi etiketi erken kapatır ve sayfanın geri kalanını bozar.
 */
function jsonLdScript(schema) {
  const json = JSON.stringify(schema).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
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

// İşaretleme artık ortak bileşende: scripts/lib/matchCards.mjs. Türkçe ve
// İngilizce üretici AYNI şablonu çağırır; iki dilin kartları ayrışamaz.
const staticFixtureRow = sharedFixtureRow;

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

  return sharedFixtureCard({
    locale: "tr",
    id: match.id,
    league: match.league,
    live: isLive,
    stateClass,
    stateLabel,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    homeScore,
    awayScore,
    formHtml,
    // Bağlantı kuralı istemciyle AYNI (services/matchProgram.js). Eskiden her
    // kart `./canli-skor.html`e gidiyordu: on iki kart, tek hedef ve maç
    // başına hiçbir tarama yolu yok. JavaScript yüklendiğinde bağlantı zaten
    // maç ayrıntısına dönüyordu, yani statik hâl istemciyle çelişiyordu.
    actionHref: matchDetailPath(match),
    withMatchClick: true
  });
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
    .filter((match) => istanbulDay(match.kickoff) >= today)
    .sort((left, right) => String(left.kickoff).localeCompare(String(right.kickoff)));

  const liveCount = list.filter((match) => String(match.status || "").toUpperCase() === "LIVE").length;
  const todayList = list.filter((match) => istanbulDay(match.kickoff) === today);
  const finishedCount = todayList.filter((match) => String(match.status || "").toUpperCase() === "FINISHED").length;
  const upcomingCount = todayList.length - finishedCount - liveCount;
  const selections = selectFeaturedMatches(all, { today });
  logFeaturedRotation("prerender-index", selections);
  const selection = selections[0] || null;
  const featured = selection && selection.match;

  // "Analizi hazır" istemcide de AYNI kuralla sayılır (app.js:
  // matchHasReadyAnalysis). Kural gevşekti: olay akışı ya da istatistik
  // bulunması yeterli sayılıyordu ve ham olay listesi analiz değil. Sayaç
  // böylece raporu üretilmemiş maçları da sayıp tıklayan okuyucuya vaat
  // edilenden azını gösteriyordu.
  //
  // Artık yalnızca AÇILABİLİR bir okuma sayılıyor: yayımlanmış maç sonu
  // raporu ya da maçın kendi editoryal okuması.
  const publishedReportIds = new Set(
    postMatchStore()
      .filter((record) => record && record.analysisStatus !== "failed")
      .map((record) => String(record.matchId || ""))
  );

  const analysisReadyCount = todayList.filter((match) => Boolean(
    match.summary ||
    (match.analysis && (match.analysis.headline || match.analysis.lead)) ||
    publishedReportIds.has(String(match.id || ""))
  )).length;

  // Sıfır olan sayaç çizilmez (services/homeQuickStats.js). "Analizi hazır 0"
  // gibi bir satır, sayfanın vaadinin yokluğunu rakamla ilan ediyordu.
  const quickStats = renderQuickStats({
    live: liveCount,
    upcoming: Math.max(upcomingCount, 0),
    finished: finishedCount,
    analysisReady: analysisReadyCount,
    total: todayList.length
  }, escapeHtml);

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
    const dateLabel = istanbulDay(match.kickoff) === today ? "Bugün" : longDateLabel(match.kickoff);

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
 * GÜNÜN ÜÇ BAŞLIĞI — statik karşılık.
 *
 * Kural servistedir (services/dailyHeadlines.js) ve istemci aynı servisin
 * kopyasını kullanır, yani JS yüklendiğinde başlıklar yerinden oynamaz.
 *
 * Aday yoksa BOŞ DİZE döner. Boş dize slot'a yazıldığında bölüm görünür
 * ama içi boş kalırdı; bunu önlemek için `index.html`deki bölüm
 * `data-empty-hide` taşıyor ve istemci boş bölümü gizliyor. Statik tarafta
 * ise bölümün kendisi `hidden` başlar ve yalnızca başlık varken açılır.
 */
function dailyHeadlineCards() {
  const today = istanbulToday();
  // İlgi puanı burada damgalanır; API de aynı servisi kullanıyor, böylece
  // ön derlenmiş sıra ile JavaScript yüklendikten sonraki sıra aynı olur.
  const headlines = buildDailyHeadlines(withRelevance(curatedMatches()), {
    today,
    reports: postMatchStore()
  });

  if (!headlines.length) return "";

  return headlines.map((headline, index) => `<a class="daily-headline${headline.state === "live" ? " is-live" : ""}" href="${escapeHtml(headline.href)}" data-headline-rank="${index + 1}" data-headline-match="${escapeHtml(headline.matchId)}" data-headline-state="${escapeHtml(headline.state)}">
      <span class="daily-headline-index" aria-hidden="true">${index + 1}</span>
      <span class="daily-headline-body">
        <span class="daily-headline-kicker">${escapeHtml(headline.kicker)}</span>
        <strong class="daily-headline-title">${escapeHtml(headline.title)}</strong>
        ${headline.subtitle ? `<span class="daily-headline-score">${escapeHtml(headline.subtitle)}</span>` : ""}
        <span class="daily-headline-hook">${escapeHtml(headline.hook)}</span>
      </span>
    </a>`).join("");
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
    return "";
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
  const scoreLine = postMatchScoreLine(record);

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
    (scoreLine ? `<strong class="post-match-score">${escapeHtml(scoreLine)}</strong>` : "") +
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
function postMatchAnalysisCards(limit, options = {}) {
  let ordered = orderForDisplay(postMatchStore());
  if (options.verifiedScoresOnly) {
    const verifiedIds = new Set(curatedMatches().filter(isVerifiedFinalMatch).map((match) => String(match.id || "")));
    ordered = ordered.filter((record) => verifiedIds.has(String(record.matchId || "")));
  }
  const records = limit ? ordered.slice(0, limit) : ordered;

  if (!records.length) {
    return `<article class="card data-empty" data-card="empty-state"><strong>Tamamlanan maç analizi yok</strong><span>Bir maç bittiğinde ölçülmüş veriden üretilen analizi burada listelenecek.</span></article>`;
  }

  return records.map(postMatchCard).join("");
}

function verifiedResultHref(match, reportsByMatch) {
  if (match.analysisPage) return `./${String(match.analysisPage).replace(/^\.\//, "")}`;
  const report = reportsByMatch.get(String(match.id || ""));
  if (report && report.publishState === "page" && report.reportUrl) return report.reportUrl;
  return `./canli-skor.html#${encodeURIComponent(match.id || "")}`;
}

function verifiedResultMatches(limit = 18) {
  return curatedMatches()
    .filter(isVerifiedFinalMatch)
    .sort((left, right) => String(right.kickoff || "").localeCompare(String(left.kickoff || "")))
    .slice(0, limit);
}

function verifiedResultCards(limit = 18) {
  const reportsByMatch = new Map(postMatchStore().map((record) => [String(record.matchId || ""), record]));
  const matches = verifiedResultMatches(limit);

  if (!matches.length) {
    return '<article class="data-empty" data-card="empty-state"><strong>Doğrulanmış maç sonucu bulunmuyor</strong><span>Resmî veya editoryal olarak doğrulanmış sonuçlar geldiğinde bu liste güncellenir.</span></article>';
  }

  return matches.map((match) => {
    const href = verifiedResultHref(match, reportsByMatch);
    const date = postMatchDateLabel(match.kickoff || match.date);
    return `<article class="result-card" data-card="verified-result" data-match="${escapeHtml(match.id)}">
      <div class="result-card-head"><span>${escapeHtml(match.league || "Futbol")}${date ? ` · ${escapeHtml(date)}` : ""}</span><strong>MS</strong></div>
      <div class="result-card-score" aria-label="${escapeHtml(`${match.homeTeam} ${match.score.home}, ${match.awayTeam} ${match.score.away}`)}">
        <div><span>${escapeHtml(match.homeTeam)}</span><b>${escapeHtml(match.score.home)}</b></div>
        <div><span>${escapeHtml(match.awayTeam)}</span><b>${escapeHtml(match.score.away)}</b></div>
      </div>
      <div class="result-card-footer"><span class="result-verified">Doğrulanmış sonuç</span><a href="${escapeHtml(href)}" data-match-click data-match="${escapeHtml(match.id)}">Maç ayrıntısı</a></div>
    </article>`;
  }).join("");
}

/**
 * Statik yedek, JavaScript çalışmadan ÖNCE görünen listedir. Kart sayısı
 * istemcinin başlangıç penceresiyle aynı olmak zorunda: altı kart basılıp
 * hemen ardından on ikiye çıkılsaydı sayfa yüklenirken gözle görülür biçimde
 * zıplardı. Sayı tek bir yerde (services/matchListWindow.js) duruyor.
 *
 * "Daha Fazla Göster" butonu burada BASILMAZ: butonu çalıştıracak JavaScript
 * yokken basılan buton ölü bir düğmedir. Yedek, penceresi kadarını gösterir
 * ve okuyucuyu tam listeye bağlantılarla yönlendirir.
 */
function matchProgramState(variant) {
  const cards = calendarProgramCards(MATCH_LIST_INITIAL);
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
    .map((team) => sharedTrendCard({
      locale: "tr",
      id: team.id,
      name: team.name,
      leagueLabel: team.league,
      momentum: team.momentum,
      formDotsHtml: formDots(team.form),
      attack: team.attack,
      defense: team.defense,
      formScore: team.formScore,
      actionHref: `./takim-detay.html?team=${encodeURIComponent(team.name)}`
    }))
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

function newsCardAction(item) {
  const href = newsHref(item, "./");
  if (!href) {
    return "";
  }
  const external = isExternalHref(href);
  // Dışarı çıkan künye `nofollow` taşır (services/sourceLinks.js ile aynı
  // kural): alıntı bir atıftır, tavsiye değil. İç bağlantı sade açılır.
  const attrs = external ? ` target="_blank" rel="${SOURCE_LINK_REL}"` : "";
  const label = external ? "Resmî açıklamayı aç" : "Haberi oku";
  return `<a class="detail-link" href="${escapeHtml(href)}"${attrs}>${label}</a>`;
}

function newsCards(limit) {
  return news.slice(0, limit || news.length).map((item) => `<article class="news-card" data-card="news" data-news="${escapeHtml(item.id)}"><div class="news-card-meta"><span class="tag green">${escapeHtml(item.category || "Futbol Gündemi")}</span><time datetime="${escapeHtml(item.publishedAt || "")}">${escapeHtml(formatFreshnessDate(item.publishedAt) || "Tarih açıklanmadı")}</time></div><div><span class="card-kicker">${escapeHtml(item.team || item.sourceName || "FutbolRadar")}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.summary)}</p></div><div class="news-card-footer"><span>${escapeHtml(item.sourceName || "Resmî kaynak")}</span>${newsCardAction(item)}</div></article>`).join("");
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
 * TRANSFER RADARI BANDI — ARTIK DERLEME SIRASINDA YAZILIYOR.
 *
 * Bant eskiden yalnızca istemcide doluyordu; `index.html` banda "Transfer
 * güncellemeleri hazırlanıyor." yer tutucusuyla çıkıyordu. Bunun görünür bir
 * sonucu vardı: aynı sayfanın alt tarafındaki Transfer Takibi bölümü dolu
 * transfer satırları gösterirken bant "veri hazırlanıyor" diyordu. Sayfa
 * aynı anda hem "veri yok" hem "veri var" diyordu — JavaScript yüklenene
 * kadar okuyucunun ve Googlebot'un gördüğü hâl buydu.
 *
 * Seçim ve sıralama servistedir (services/transferRadarTicker.js); İngilizce
 * bant da aynı listeyi oradan alır. İstemci canlı veriyle üstüne yazar ama
 * aynı kuralı kullandığı için bant yerinden oynamaz.
 *
 * Kayan animasyon saf CSS; bant JavaScript olmadan da çalışır.
 *
 * İşaretleme scripts/lib/transferTicker.mjs'te — Türkçe ön derleme,
 * İngilizce üretici ve ana sayfa dışındaki sayfalara basılan bant aynı
 * fonksiyondan çizilir. Burada kalan tek şey veriyi seçip şeridi istemek.
 */
function transferRadarTrack() {
  return transferTickerTrack(selectTickerRecords(transfers), {
    locale: "tr",
    sourceRel: SOURCE_LINK_REL
  });
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
  return transferWatchShell({
    locale: "tr",
    leader: { ...leader, typeLabel: leader.type || "Transfer" },
    allHref: "./transfer-radari.html",
    rows: selected.slice(1).map((transfer) => ({
      ...transfer,
      href: `./transfer-radari.html?team=${encodeURIComponent(transfer.toTeam || "")}`
    }))
  });
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

/**
 * BOŞ BÖLÜM GİZLENİR.
 *
 * `data-empty-hide` taşıyan bir bölüm, içindeki slot boşsa `hidden` kalır;
 * doluysa açılır. "Bugün öne çıkan üç başlık" başlığını yazıp altını boş
 * bırakmak, bölümü hiç göstermemekten kötü: okuyucu sitenin bir şeyi
 * beceremediğini görür.
 *
 * İstemci aynı kuralı `applyEmptyHide` ile uygular, yani JS yüklendiğinde
 * bölüm yerinden oynamaz.
 */
function applyEmptyHide(html, target, content) {
  const hasContent = String(content || "").trim() !== "";
  // Bölüm etiketi: `data-api-target="<target>"` içeren en yakın
  // `data-empty-hide` bölümü. İşaretleme sabit olduğu için doğrudan
  // bölümün açılış etiketi aranıyor.
  const expression = new RegExp(`(<section\\b[^>]*\\bdata-api-section="${target}"[^>]*>)`);
  const match = html.match(expression);
  if (!match) return html;

  const openTag = match[1];
  if (!openTag.includes("data-empty-hide")) return html;

  const next = hasContent
    ? openTag.replace(/\s+hidden(?=[\s>])/, "")
    : (/\s+hidden(?=[\s>])/.test(openTag) ? openTag : openTag.replace(/>$/, " hidden>"));

  return html.replace(openTag, next);
}

/**
 * YALNIZCA İŞARETÇİYLE ÇALIŞAN SLOT.
 *
 * `replaceSlot` bir `data-api-target` bekler; çünkü doldurduğu her alanı
 * istemci sonradan yeniden çizer. Bazı bloklar ise SADECE derlemede üretilir
 * ve istemci onlara hiç dokunmaz — sayfanın SSS'i ve yapılandırılmış verisi
 * gibi. Onlara sahte bir API hedefi vermek, "burayı API dolduruyor" diye
 * yanlış bir şey söylemek olurdu.
 *
 * İşaretçiler sayfaya ELLE yazılır; yoksa blok sessizce atlanır (dosyaya
 * kendiliğinden bölüm eklenmez).
 */
function replaceStaticSlot(html, target, content) {
  const markerStart = `<!-- prerender:${target}:start -->`;
  const markerEnd = `<!-- prerender:${target}:end -->`;
  if (!html.includes(markerStart) || !html.includes(markerEnd)) return html;

  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expression = new RegExp(`${escape(markerStart)}[\\s\\S]*?${escape(markerEnd)}`);
  return html.replace(expression, `${markerStart}\n${content}\n${markerEnd}`);
}

function writePage(file, slots, freshness, staticSlots = {}) {
  const sourcePath = path.join(root, file);
  if (!fs.existsSync(sourcePath)) {
    return;
  }

  let html = fs.readFileSync(sourcePath, "utf8");
  Object.entries(slots).forEach(([target, content]) => {
    html = replaceSlot(html, target, content);
    html = applyEmptyHide(html, target, content);
  });
  Object.entries(staticSlots).forEach(([target, content]) => {
    html = replaceStaticSlot(html, target, content);
  });
  html = updateMetaLabels(html, freshness);
  html = updateRobotsDirective(html, file);
  writeGeneratedFile(sourcePath, html);
  writeGeneratedFile(path.join(root, "public", file), html);
}

const confirmed = allFixtures();
const topFixtures = confirmed.slice(0, 3);
const topTeams = teams.slice().sort((left, right) => Number(right.momentum) - Number(left.momentum));
const topPlayers = players.slice().sort((left, right) => Number(right.overallRating || 0) - Number(left.overallRating || 0));

writePage("index.html", {
  "featured-match": staticFeaturedFixture(),
  "daily-headlines": dailyHeadlineCards(),
  "home-trend-teams": trendTeamCards(),
  "home-transfer-watch": transferWatch(),
  "today-matches": matchProgramState("today"),
  "radar-signals": signalCards(),
  "team-radar": topTeams.slice(0, 4).map(staticTeamCard).join(""),
  "home-standings": staticHomeStandingRows(),
  "player-radar": trendPlayerSlot(3),
  "player-signals": playerSignalsSlot(),
  "news-preview": newsCards(3),
  "analysis-preview": analysisCards(),
  "transfer-radar": transferRadarTrack()
}, fixtureFreshness);

writePage("analizler.html", {
  "post-match-analyses": postMatchAnalysisCards(undefined, { verifiedScoresOnly: true })
}, fixtureFreshness);

/**
 * MAÇ LİSTESİ BASAN SAYFALARIN ORTAK ŞEMASI.
 *
 * "Bugünün Maçları"nda kurulan kural (services/matchSchema.js) aynı kusuru
 * taşıyan diğer sayfalara da uygulanıyor: `canli-skor.html` ve
 * `mac-sonuclari.html` on ikişer maç kartı basıyor ama arama motoruna
 * bunların MAÇ olduğunu söyleyen tek bir işaret yoktu.
 *
 * Düğümler sayfada BASILAN listeden üretilir; işaretleme ekranda olmayan
 * bir maçı iddia edemez. Skor YAZILMAZ — schema.org SportsEvent'in skor için
 * standart bir alanı yok ve olmayan bir alanı uydurmak zengin sonuç
 * kazandırmaz, yalnızca doğrulanamaz veri üretir.
 */
function matchListSchemaBlock(matches, name) {
  const schema = matchListSchema(matches, {
    name,
    urlFor: (match) => (match && match.analysisPage ? matchDetailPath(match) : "")
  });
  return schema ? jsonLdScript(schema) : "";
}

writePage("mac-sonuclari.html", {
  "verified-results": verifiedResultCards()
}, fixtureFreshness, {
  "results-schema": matchListSchemaBlock(verifiedResultMatches(), "Doğrulanmış maç sonuçları")
});

writePage("haberler.html", {
  "news-page": newsCards()
}, fixtureFreshness);

/**
 * "Bugünün Maçları" sayfasının statik hâli: liste + SSS + yapılandırılmış
 * veri. Üçü de AYNI maç listesinden üretilir; SSS'in cevabı ile ekrandaki
 * liste ayrışamaz, `SportsEvent` düğümleri de basılan sırayı izler.
 */
const matchProgramPage = matchProgramPageCards();
// Gün adı LİSTENİN gününden gelir, "bugün"den değil: derleme bir gün eski
// kaldığında "bugün 25 maç var" bir yalana dönüşür, tarihli cümle ise
// yalnızca geçmişe düşer.
const matchProgramDateLabel = matchProgramPage.day
  ? longDateLabel(`${matchProgramPage.day}T12:00:00+03:00`)
  : "";
const matchProgramFaqEntries = matchProgramFaq(matchProgramPage.dayMatches, {
  dateLabel: matchProgramDateLabel
});

writePage("bugunun-maclari.html", {
  "matches-page": matchProgramPage.html || emptyMatchState("today")
}, fixtureFreshness, {
  "today-faq": faqSectionHtml(
    matchProgramFaqEntries,
    matchProgramDateLabel ? `${matchProgramDateLabel} maçları hakkında sık sorulanlar` : "Sık sorulanlar"
  ),
  "today-schema": [
    matchListSchema(matchProgramPage.matches, {
      name: "Bugünün futbol maçları",
      // `url` YALNIZCA maçın kalıcı, dizine açık bir sayfası varsa yazılır.
      // `mac-detay.html` `noindex,follow`; onu etkinliğin adresi diye vermek
      // makineye var olmayan bir hedef göstermek olurdu.
      urlFor: (match) => (match && match.analysisPage ? matchDetailPath(match) : "")
    }),
    faqSchema(matchProgramFaqEntries)
  ].filter(Boolean).map(jsonLdScript).join("\n")
});

writePage("canli-skor.html", {
  // Canlı maç yokken de günün sonuçları görünsün: sayfa eskiden yalnızca
  // "canlı maç yok" diyordu ve o günün oynanmış maçları hiç listelenmiyordu.
  "live-score": matchProgramState("live")
}, fixtureFreshness, {
  "live-schema": matchListSchemaBlock(calendarProgramMatches(MATCH_LIST_INITIAL), "Canlı ve günün maçları")
});

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
  writeGeneratedFile(sourcePath, html);
  writeGeneratedFile(path.join(root, "public", file), html);
}

console.log("Prerendered critical page fallbacks");
