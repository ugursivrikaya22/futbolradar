import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const domain = "https://www.futbolradar.com";
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
const { filterPlayerCards, logRemovedCards, publicPlayerView } = require("../services/cardCredibility.js");
const { fixtureTeamNames } = require("../services/superLigTeams.js");
const { matchSignal } = require("../services/matchSignalService.js");
const { displayLeagueName, isSuperLigName, isUefaCompetitionName } = require("../services/leagueIdentity.js");
const { filterDisplayable, logHiddenMatches } = require("../services/matchEligibility.js");
const { rankMatches } = require("../services/matchPriorityService.js");
const { publishableTransfers, logExcludedTransfers, sourceTypeLabel } = require("../services/transferService.js");
const { publishableStatements, logExcludedStatements } = require("../services/matchStatementService.js");
const { trustBadges, transferTrustLabels, statementTrustLabels } = require("../services/trustLabels.js");
const { isStale, lastUpdatedNote, newestTimestamp, relativeAgeLabel } = require("../services/contentFreshness.js");
const { rankAgenda } = require("../services/agendaService.js");

/**
 * Maçın kalıcı sayfası. Var olmayan bir adrese bağlanmıyoruz: rapor
 * üretilmemişse canlı skor sayfası her zaman geçerli hedeftir.
 */
function matchReportPath(match) {
  return match && match.id ? path.join(root, "mac-raporu", `${match.id}.html`) : null;
}

function hasPublishedAnalysis(match) {
  if (match && match.analysisPage) return true;
  const reportPath = matchReportPath(match);
  return Boolean(reportPath && fs.existsSync(reportPath));
}

function matchDetailLink(match) {
  const reportPath = matchReportPath(match);
  if (reportPath && fs.existsSync(reportPath)) return `./mac-raporu/${match.id}.html`;
  if (match && match.analysisPage) return `./${match.analysisPage}`;
  return `./canli-skor.html#${match && match.id ? match.id : ""}`;
}

/**
 * Kartın alt bağlantısı GİTTİĞİ YERE göre adlandırılır.
 *
 * Etiket her kartta "Maç analizi" diyordu; oysa raporu ve analiz sayfası
 * olmayan maçlarda bağlantı canlı skor sayfasına gidiyordu. Yanlış etiketli
 * bir düğme, ölü bir düğme kadar zarar verir — okuyucu tıklar, beklediğini
 * bulamaz. Etiket bu yüzden hedeften türetiliyor, elle yazılmıyor.
 */
function matchDetailLinkLabel(match) {
  const reportPath = matchReportPath(match);
  if (reportPath && fs.existsSync(reportPath)) return "Maç raporu";
  if (match && match.analysisPage) return "Maç analizi";
  return "Canlı skor";
}

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
    ? "Şu an doğrulanmış canlı Trendyol Süper Lig maçı bulunmuyor. Sezonun onaylı ilk eşleşmelerini aşağıdan inceleyebilirsin."
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


/**
 * GÖSTERİLEBİLİR VE ÖNCELİKLİ MAÇ HAVUZU — tek giriş noktası.
 *
 * İki kural burada birleşiyor:
 *   1. KAPI  — başlama saati geçmiş ama skoru olmayan maç gizlenir
 *              (services/matchEligibility.js). Uydurma 0-0 basılmaz.
 *   2. SIRA  — kalanlar önceliğe göre dizilir; saat tek başına belirlemez
 *              (services/matchPriorityService.js).
 *
 * Gizlenen her maç gerekçesiyle günlüğe yazılır: veri boşluğu sessiz kalmaz.
 */
function displayableRankedMatches(pool, scope, options = {}) {
  const { matches, hidden } = filterDisplayable(pool, options.now);
  logHiddenMatches(scope, hidden);
  return rankMatches(matches, { teams, now: options.now });
}

/** Kartın "neden öne çıktı" etiketi. Gerekçesi yoksa etiket basılmaz. */
function priorityReasonHtml(match) {
  const reason = match && match.priority && match.priority.primaryReason;
  if (!reason) return "";
  return `<span class="fixture-priority is-${escapeHtml(reason.key)}">${escapeHtml(reason.label)}</span>`;
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
  // Kapı + öncelik: başlamış ama skorsuz maç listeye girmez, kalanlar
  // saate göre değil ilgiye göre sıralanır.
  const upcoming = displayableRankedMatches(
    curatedMatches().filter((match) => String(match.kickoff || "").slice(0, 10) >= today),
    "match-program"
  ).slice(0, limit || 6);

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

function staticFixtureRow(name, score, otherScore) {
  const winner = score !== null && otherScore !== null && Number(score) > Number(otherScore);
  return `<div class="fixture-row${winner ? " is-winner" : ""}">` +
    `<span class="fixture-row-fallback" aria-hidden="true">${escapeHtml(fixtureTeamInitials(name))}</span>` +
    `<span class="fixture-row-name">${escapeHtml(name)}</span>` +
    `<span class="fixture-row-score">${escapeHtml(score === null ? "–" : score)}</span>` +
    `</div>`;
}

/**
 * Radar sinyali. Kural services/matchSignalService.js'de; burada yalnızca
 * takım kayıtları verilip sonuç çizilir. Sinyal bir tahmin değil, eldeki
 * kaydın okunuşudur ve oran/yüzde iddiası taşımaz.
 */
function staticSignalHtml(match) {
  const signal = matchSignal(match, {
    homeTeam: teamByName(match.homeTeam),
    awayTeam: teamByName(match.awayTeam),
    analysisReady: Boolean(match.analysisPage) || hasPublishedAnalysis(match)
  });

  return `<span class="fixture-signal is-${escapeHtml(signal.tone)}" title="${escapeHtml(signal.basis)}">` +
    `<i aria-hidden="true"></i><span>${escapeHtml(signal.label)}</span></span>`;
}

/**
 * KOMPAKT MAÇ KARTI (statik yedek).
 *
 * app.js'teki `renderFixtureCard` ile aynı iskelet: üstte lig ve saat/durum,
 * ortada takımlar ve skor, altta radar sinyali + detay bağlantısı. JS
 * yüklenmeden önce görünen kart ile yüklendikten sonraki kartın farklı
 * olması, sayfanın kendi kendini düzelttiği izlenimi veriyordu.
 */
function staticFixtureCard(match, meta) {
  const { headlineValue, status, finalScore } = meta;
  const isLive = status === "LIVE";
  const isFinal = status === "FINISHED";
  const stateClass = isLive ? "is-live" : isFinal ? "is-final" : "";
  const stateLabel = isFinal ? "MS" : isLive ? "Canlı" : (headlineValue || MATCH_STATUS_TR[status] || "Planlandı");
  const homeScore = finalScore ? Number(String(finalScore).split("-")[0]) : null;
  const awayScore = finalScore ? Number(String(finalScore).split("-")[1]) : null;

  return `<article class="fixture-card${isLive ? " is-live" : ""}${isFinal ? " is-final" : ""}" data-card="fixture" data-match="${escapeHtml(match.id)}">
    <div class="fixture-card-top"><span class="fixture-card-league">${leagueMarkHtml(match.league)}${escapeHtml(displayLeagueName(match.league, "Maç programı"))}</span><span class="fixture-card-state ${stateClass}">${isLive ? '<i class="live-pulse" aria-hidden="true"></i>' : ""}${escapeHtml(stateLabel)}</span></div>
    ${priorityReasonHtml(match)}
    <div class="fixture-card-rows">${staticFixtureRow(match.homeTeam, homeScore, awayScore)}${staticFixtureRow(match.awayTeam, awayScore, homeScore)}</div>
    <div class="fixture-card-foot fixture-card-foot-divider">${staticSignalHtml(match)}<a class="fixture-card-link" href="${escapeHtml(matchDetailLink(match))}" aria-label="${escapeHtml(`${match.homeTeam} - ${match.awayTeam} ${matchDetailLinkLabel(match).toLocaleLowerCase("tr-TR")}`)}">${escapeHtml(matchDetailLinkLabel(match))}</a></div>
  </article>`;
}

/** Hero'daki büyük öne çıkan maç panosunun statik karşılığı. */
function staticFeaturedFixture() {
  const today = istanbulToday();
  const list = curatedMatches()
    .filter((match) => String(match.kickoff || "").slice(0, 10) >= today)
    .sort((left, right) => String(left.kickoff).localeCompare(String(right.kickoff)));

  const liveCount = list.filter((match) => String(match.status || "").toUpperCase() === "LIVE").length;
  const todayList = list.filter((match) => String(match.kickoff || "").slice(0, 10) === today);
  const finishedCount = todayList.filter((match) => String(match.status || "").toUpperCase() === "FINISHED").length;
  const upcomingCount = todayList.length - finishedCount - liveCount;
  const featured = todayList[0] || list[0] || null;

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

  const status = String(featured.status || "SCHEDULED").toUpperCase();
  const hasScore = featured.score && featured.score.home !== null && featured.score.home !== undefined
    && featured.score.away !== null && featured.score.away !== undefined;
  const headline = hasScore ? `${featured.score.home} - ${featured.score.away}` : (featured.time || "—");
  // Skor/saat büyük alanda zaten yazıyor; rozet onu tekrar etmesin.
  const stateLabel = status === "FINISHED" ? "Maç sonucu" : status === "LIVE" ? "Canlı" : "Başlama saati";
  const dateLabel = String(featured.kickoff || "").slice(0, 10) === today ? "Bugün" : longDateLabel(featured.kickoff);

  const side = (name) => `<div class="featured-fixture-team">
        <span class="fixture-row-fallback" aria-hidden="true">${escapeHtml(fixtureTeamInitials(name))}</span>
        <strong>${escapeHtml(name)}</strong>
      </div>`;

  return `<div class="featured-fixture${status === "LIVE" ? " is-live" : ""}">
      <div class="featured-fixture-head"><span class="featured-fixture-league">${leagueMarkHtml(featured.league)}${escapeHtml(displayLeagueName(featured.league, "Maç programı"))}</span><span>${escapeHtml(`${dateLabel} · ${featured.venue || "Saha bilgisi bekleniyor"}`)}</span></div>
      <div class="featured-fixture-board">
        ${side(featured.homeTeam)}
        <div class="featured-fixture-score"><b>${escapeHtml(headline)}</b><span>${escapeHtml(stateLabel)}</span></div>
        ${side(featured.awayTeam)}
      </div>
      <div class="home-match-command-actions featured-match-actions"><a class="button primary" href="./canli-skor.html">Canlı skorları aç</a><a class="button secondary" href="./bugunun-maclari.html">Maç programı</a></div>
    </div>${quickStats}`;
}

/**
 * BUGÜNÜN ÖNE ÇIKAN 5 MAÇI.
 *
 * Ana sayfaya giren okuyucunun ilk saniyelerde görmesi gereken şey bu:
 * bugün ne oynanıyor, hangisi canlı, saat kaçta. "Öne çıkan" bir editör
 * tercihi değil, ÖLÇÜLEBİLİR bir sıralama:
 *
 *   1. Canlı maçlar (şu anda oynanıyor)
 *   2. Başlayacak maçlar, saati yaklaşan önce
 *   3. Tamamlanan maçlar
 *
 * Eşitlikte Trendyol Süper Lig kulübü içeren karşılaşma öne alınır; sitenin kapsamı
 * budur. Bugün doğrulanmış maç yoksa liste uydurulmaz, "veri bekleniyor"
 * yazılır.
 */
const FEATURED_TODAY_LIMIT = 5;

/**
 * Sıralama artık elle yazılmış bir statü/kapsam/saat zinciri değil,
 * `services/matchPriorityService.js` puanı: kulüp ilgisi, turnuva ağırlığı,
 * derbi/Avrupa bağlamı ve canlılık birlikte hesaplanıyor. Eski zincir
 * 19:00'daki hazırlık maçını 21:00'daki Şampiyonlar Ligi eşleşmesinin
 * üstünde tutuyordu.
 */
/**
 * ANA KARTIN GARANTİSİ.
 *
 * Sıralama tek başına yetmiyor: ilk beşe kesme (`slice`) yapıldığında, o gün
 * beşten fazla üst bant maçı varsa bir Türk takımının UEFA maçı listeden
 * DÜŞEBİLİR. Kural "Türk takımı oynuyorsa ana kartta MUTLAKA yer alacak"
 * diyor — "genelde yer alır" değil.
 *
 * Bu yüzden kesme sonrası bir GARANTİ adımı var: Süper Lig, Şampiyonlar Ligi,
 * Avrupa Ligi ve Konferans Ligi'nde oynayan Türk takımlarının maçları listede
 * yoksa, listenin en alttaki en düşük öncelikli maçının yerini alırlar.
 *
 * Garanti, sıralamayı EZMEZ: eklenen maç kendi öncelik sırasına yerleşir.
 * Yalnızca listeden düşmesini engeller.
 */
function guaranteedTurkishMatches(ranked, limit) {
  const selected = ranked.slice(0, limit);
  const selectedIds = new Set(selected.map((match) => match.id));

  // Kapsamdaki turnuvalar: kullanıcı bu dördünü tek tek saydı.
  const inScope = (match) =>
    isSuperLigName(match.league) || isUefaCompetitionName(match.league);

  // Türk takımı listesi kanonik kaynaktan; ayrı bir liste tutulsaydı biri
  // güncellenmeyi unutur ve o takımın maçı sessizce garantisiz kalırdı.
  const turkishClubs = fixtureTeamNames().map((name) => String(name).toLocaleLowerCase("tr-TR"));
  const isTurkishClub = (name) => {
    const key = String(name || "").toLocaleLowerCase("tr-TR").trim();
    return Boolean(key) && turkishClubs.some((club) => club === key || club.includes(key) || key.includes(club));
  };

  const missing = ranked.filter((match) =>
    !selectedIds.has(match.id)
    && inScope(match)
    && (isTurkishClub(match.homeTeam) || isTurkishClub(match.awayTeam)));

  if (!missing.length) return selected;

  // Eksik olanlar en düşük öncelikli seçilmişlerin yerine geçer, sonra
  // tamamı yeniden sıralanır — garanti sırayı bozmaz, yalnızca üyeliği
  // güvenceye alır.
  const keep = selected.slice(0, Math.max(0, limit - missing.length));
  const merged = [...keep, ...missing].slice(0, limit);

  for (const match of missing) {
    if (!merged.some((item) => item.id === match.id)) continue;
    console.warn(
      `[futbolradar:featured-guarantee] ${match.id} ana karta garanti ile eklendi ` +
      `(${match.league})`
    );
  }

  return rankMatches(merged, { teams });
}

function featuredTodayMatches() {
  const today = istanbulToday();
  const pool = curatedMatches().filter((match) => String(match.kickoff || "").slice(0, 10) === today);
  return guaranteedTurkishMatches(displayableRankedMatches(pool, "home-featured"), FEATURED_TODAY_LIMIT);
}

function featuredTodayBlock() {
  const selected = featuredTodayMatches();

  if (!selected.length) {
    return `<article class="data-empty" data-card="empty-state">
      <strong>Bugün için doğrulanmış maç bekleniyor</strong>
      <span>Günün karşılaşmaları doğrulandığı anda saat, durum ve skorlarıyla burada listelenecek. Doğrulanmamış eşleşme gösterilmez.</span>
      <div class="match-empty-actions">
        <a class="detail-link" href="./super-lig-fikstur.html">Trendyol Süper Lig fikstürünü aç</a>
        <a class="detail-link ghost" href="./canli-skor.html">Canlı skor sayfası</a>
      </div>
    </article>`;
  }

  return selected.map((match) => {
    const status = String(match.status || "SCHEDULED").toUpperCase();
    const finalScore = match.score && match.score.home !== null && match.score.home !== undefined
      && match.score.away !== null && match.score.away !== undefined
      ? `${match.score.home}-${match.score.away}`
      : null;
    const headlineValue = status === "FINISHED" && finalScore ? finalScore : (match.time || "");
    return staticFixtureCard(match, { headlineValue, isToday: true, status, finalScore });
  }).join("");
}

/**
 * TAKIM FORM SAYFALARI.
 *
 * Form sayfaları üretiliyordu ama ana sayfadan hiçbirine bağlantı yoktu;
 * yalnızca site haritası üzerinden erişilebiliyorlardı. Bu blok dört büyük
 * kulübün ve lig genelinin form sayfasını ana sayfaya bağlar.
 *
 * Kartta bir form iddiası YAZILMIYOR: burada gösterilecek sayı, sayfanın
 * kendi doğrulanmış kaydından gelmeli. Kayıt varsa son maç serisi noktalarla
 * gösterilir, yoksa "veri bekleniyor" yazılır - ikisinin arası yok.
 */
const FORM_PAGES = [
  { team: "Galatasaray", file: "galatasaray-form-durumu.html", label: "Galatasaray Form Durumu" },
  { team: "Fenerbahçe", file: "fenerbahce-form-durumu.html", label: "Fenerbahçe Form Durumu" },
  { team: "Beşiktaş", file: "besiktas-form-durumu.html", label: "Beşiktaş Form Durumu" },
  { team: "Trabzonspor", file: "trabzonspor-form-durumu.html", label: "Trabzonspor Form Durumu" },
  { team: null, file: "super-lig-form-durumu.html", label: "Trendyol Süper Lig Form Tablosu" }
];

function formLinksBlock() {
  return FORM_PAGES.map((entry) => {
    const team = entry.team ? teamByName(entry.team) : null;
    const form = team && Array.isArray(team.form) ? team.form : [];

    const body = entry.team
      ? (form.length
        ? formDots(form)
        : '<span class="muted-copy">Form kaydı bekleniyor</span>')
      : '<span class="muted-copy">18 takımın son maç serisi</span>';

    return `<a class="home-form-link" href="./${escapeHtml(entry.file)}">
      <span class="home-form-link-team">${escapeHtml(entry.team || "Trendyol Süper Lig")}</span>
      <strong>${escapeHtml(entry.label)}</strong>
      ${body}
    </a>`;
  }).join("");
}


/**
 * GÜNÜN RADAR BÜLTENİ — günlük akış.
 *
 * Sayfa yalnızca bağlantı listesiydi: adı "bülten" ama içinde o güne ait
 * hiçbir şey yoktu. Üç bölüm artık veriden geliyor ve her biri boşken
 * uydurma satır değil, açık bir bekleme cümlesi basıyor.
 *
 * Sıralama bandın kuralıyla aynı: büyük kulüpler ve doğrulanmış kayıtlar
 * önce. Ayrı bir sıralama yazsaydık bülten ile bant farklı şeyler söylerdi.
 */
function bulletinEmptyCard(title, text) {
  return `<article class="data-empty" data-card="empty-state">
    <strong>${escapeHtml(title)}</strong><span>${escapeHtml(text)}</span>
  </article>`;
}

/**
 * Bölüm başlığındaki "son güncelleme" satırı.
 *
 * Bölüm, içindeki EN TAZE kayıt kadar günceldir. Kayıt yoksa satır hiç
 * basılmaz — boş bir bölümün üstünde tarih göstermek, orada bir şey olduğunu
 * ima eder.
 */
function sectionUpdatedNote(stamps, kind) {
  const newest = newestTimestamp(stamps);
  if (!newest) return "";

  // Bölümün EN TAZE kaydı bile gündem penceresini aştıysa bunu söylemek
  // gerekir. Aksi hâlde on gün önceki bir liste "bugünün gündemi" gibi
  // okunur — veri doğru olduğu hâlde sayfa yanıltıcı olur.
  const stale = isStale(newest, kind);
  const note = stale ? `${lastUpdatedNote(newest)} · Yeni kayıt bekleniyor` : lastUpdatedNote(newest);

  return `<p class="section-updated${stale ? " is-stale" : ""}" data-card="section-updated">${escapeHtml(note)}</p>`;
}

/** Bültenin transfer akışı: en yeni doğrulanmış hareketler. */
function bulletinTransfers(limit) {
  const { transfers, excluded } = publishableTransfers();
  logExcludedTransfers("bulletin", excluded);

  // GÜNDEM SIRASI: aynı bant içinde tazelik belirleyici. Bir hafta geçmiş
  // transfer listede kalır ama daha yeni hareketlerin altına iner.
  const ranked = rankAgenda(
    transfers.map((transfer) => ({ type: "transfer", at: transfer.date, record: transfer })),
    { now: new Date() }
  ).map((entry) => entry.record);

  const selected = ranked.slice(0, limit || 5);
  if (!selected.length) {
    return bulletinEmptyCard(
      "Doğrulanmış transfer bekleniyor",
      "Kulüp açıklaması veya güvenilir kayıt ulaştığında bu alan güncellenecek. Söylenti kesinleşmiş transfer gibi gösterilmez."
    );
  }

  return sectionUpdatedNote(selected.map((transfer) => transfer.date), "transfer") +
    selected.map((transfer) => `<article class="bulletin-row" data-card="transfer-record">
      <div class="bulletin-row-head"><span class="bulletin-row-date">${escapeHtml(formatFreshnessDate(transfer.date) || transfer.date)}</span>${trustBadges(transferTrustLabels(transfer))}</div>
      <strong>${escapeHtml(transfer.playerName)}</strong>
      <p class="bulletin-row-route">${escapeHtml(transfer.fromTeam)} → ${escapeHtml(transfer.toTeam)} · ${escapeHtml(transfer.type)}</p>
      <!-- Yaş, sıralamanın dayandığı alanla AYNI alandan okunur (transfer
           tarihi). Doğrulama zamanından okunsaydı liste sırasıyla çelişirdi:
           "7 gün önce" satırının üstünde "4 gün önce" satırı görünürdü. -->
      <p class="bulletin-row-age">${escapeHtml(relativeAgeLabel(transfer.date))}</p>
      <a class="detail-link" href="${escapeHtml(transfer.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(transfer.sourceName)} kaynağını aç</a>
    </article>`).join("");
}

/**
 * Bültenin maç sonu açıklamaları akışı.
 *
 * Her satır kimin, hangi kulüpten, hangi maçtan sonra konuştuğunu ve kaydın
 * kaynağını taşır. Alıntı kısaltılmaz — kısaltılmış bir söz, söylenmemiş bir
 * cümleye dönüşebilir.
 */
function bulletinStatements(limit) {
  const { statements, excluded } = publishableStatements();
  logExcludedStatements("bulletin", excluded);

  const ranked = rankAgenda(
    statements.map((statement) => ({ type: "statement", at: statement.publishedAt, record: statement })),
    { now: new Date() }
  ).map((entry) => entry.record);

  const selected = ranked.slice(0, limit || 5);
  if (!selected.length) {
    return bulletinEmptyCard(
      "Doğrulanmış açıklama bekleniyor",
      "Teknik direktör ve futbolcu sözleri, kulüp veya resmî kaynak yayımladığı anda kaynağıyla birlikte burada listelenecek. Doğrulanmamış söz yayımlanmaz."
    );
  }

  return sectionUpdatedNote(selected.map((statement) => statement.publishedAt), "statement") +
    selected.map((statement) => {
      const context = [statement.team, statement.matchLabel].filter(Boolean).join(" · ");
      return `<article class="bulletin-row" data-card="match-statement">
      <div class="bulletin-row-head"><span class="bulletin-row-date">${escapeHtml(formatFreshnessDate(statement.publishedAt) || "")}</span>${trustBadges(statementTrustLabels(statement))}</div>
      <strong>${escapeHtml(statement.speaker)}</strong>
      <p class="bulletin-row-route">${escapeHtml(statement.roleLabel)}${context ? ` · ${escapeHtml(context)}` : ""}</p>
      <blockquote class="bulletin-row-quote"><p>${escapeHtml(statement.quote)}</p></blockquote>
      <a class="detail-link" href="${escapeHtml(statement.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(statement.sourceName)} kaynağını aç</a>
    </article>`;
    }).join("");
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
      <div class="trend-card-head"><span class="trend-card-avatar" aria-hidden="true">${escapeHtml(initials)}</span><span><strong>${escapeHtml(team.name)}</strong><span>${escapeHtml(displayLeagueName(team.league, "Takım"))}</span></span><b class="trend-card-score">${escapeHtml(team.momentum ?? "–")}</b></div>
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
  return `<div class="standings-empty${compact ? " compact" : ""}" data-card="standings-preseason"><span class="card-kicker">Trendyol Süper Lig · 2026/27</span><strong>2026/27 sezonu henüz başlamadı</strong><p>Trendyol Süper Lig 14 Ağustos'ta başlayacak. İlk maçlar tamamlandığında puan tablosu otomatik güncellenecek.</p><a class="detail-link" href="./super-lig-fikstur.html">Sezon fikstürünü aç</a></div>`;
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

/**
 * Ana sayfadaki transfer şeridi.
 *
 * Kayıtlar HAM DOSYADAN DEĞİL, yayın kapısından geçer: transfer-radari.html
 * ile ana sayfa aynı listeyi göstermeli, aksi hâlde kapının elediği bir kayıt
 * ana sayfada durabilirdi. Sıra services/agendaService.js ile aynı; kart
 * kaynağını ve ne zaman doğrulandığını taşır.
 */
function transferWatch() {
  const { transfers: publishable, excluded } = publishableTransfers();
  logExcludedTransfers("home-transfer-watch", excluded);

  const inWindow = publishable
    .filter((transfer) => String(transfer && transfer.date || "").slice(0, 10) >= TRANSFER_RADAR_SINCE);

  const selected = rankAgenda(
    inWindow.map((transfer) => ({ type: "transfer", at: transfer.date, record: transfer })),
    { now: new Date() }
  ).map((entry) => entry.record).slice(0, 5);

  if (!selected.length) {
    return '<article class="data-empty"><strong>Kesinleşen transfer bulunamadı</strong><span>Yeni kulüp açıklamaları geldiğinde bu alan güncellenir.</span></article>';
  }

  const leader = selected[0];
  return `<article class="home-transfer-feature" data-card="home-transfer-watch"><div class="home-transfer-player"><div><span>Son kesinleşen transfer</span><h3>${escapeHtml(leader.playerName)}</h3><p>${escapeHtml(leader.type || "Transfer")} · ${escapeHtml(leader.date)}</p></div></div><div class="home-transfer-route"><b>${escapeHtml(leader.fromTeam)}</b><em>→</em><b>${escapeHtml(leader.toTeam)}</b></div>${trustBadges(transferTrustLabels(leader))}<p class="home-transfer-updated">${escapeHtml(lastUpdatedNote(leader.lastVerifiedAt || leader.date))}</p><div class="home-transfer-actions"><a class="detail-link" href="${escapeHtml(leader.sourceUrl)}" target="_blank" rel="noopener noreferrer">Transfer detayını aç</a><a class="detail-link ghost" href="./transfer-radari.html">Tüm transferler</a></div></article><aside class="home-transfer-side"><div class="home-transfer-list">${selected.slice(1).map((transfer) => `<a class="home-transfer-row" href="./transfer-radari.html?team=${encodeURIComponent(transfer.toTeam || "")}"><span>${escapeHtml(transfer.date)}</span><strong>${escapeHtml(transfer.playerName)}</strong><b>${escapeHtml(transfer.toTeam)}</b></a>`).join("")}</div></aside>`;
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
 * ANA SAYFA YAPILANDIRILMIŞ VERİSİ.
 *
 * Ana sayfa yalnızca bir `WebSite` düğümü taşıyordu; sayfanın asıl konusu
 * olan "bugünün maçları" arama motoruna hiç bildirilmiyordu.
 *
 * Üç düğüm üretilir:
 *   WebSite       — site kimliği ve site içi arama eylemi
 *   Organization   — yayıncı varlığı (logo ve sosyal hesaplarla)
 *   ItemList       — BUGÜNÜN maçları, her biri SportsEvent
 *
 * UYDURMA YOK: ItemList yalnızca doğrulanmış başlama saati olan maçlardan
 * kurulur. Bugün maç yoksa düğüm HİÇ üretilmez — boş bir liste yayımlamak,
 * "bugün maç yok" iddiasını arama motoruna yazmak olurdu ve o iddia
 * verimizin değil, senkron zamanlamamızın sonucu olabilir.
 */
const ORGANIZATION_SAME_AS = [
  "https://x.com/futbolradar",
  "https://www.instagram.com/futbolradar",
  "https://www.youtube.com/@futbolradar"
];

function homeSchemaJson() {
  const today = istanbulToday();

  const nodes = [
    {
      "@type": "WebSite",
      "@id": `${domain}/#website`,
      name: "FutbolRadar",
      url: `${domain}/`,
      description: "Canlı skor, bugünün maçları, maç analizleri, takım formu ve oyuncu istatistikleri platformu.",
      publisher: { "@id": `${domain}/#organization` },
      potentialAction: {
        "@type": "SearchAction",
        target: `${domain}/oyuncu-radari.html?search={search_term_string}`,
        "query-input": "required name=search_term_string"
      },
      inLanguage: "tr-TR"
    },
    {
      "@type": "Organization",
      "@id": `${domain}/#organization`,
      name: "FutbolRadar",
      url: `${domain}/`,
      logo: { "@type": "ImageObject", url: `${domain}/favicon.svg` },
      sameAs: ORGANIZATION_SAME_AS
    }
  ];

  // Başlama saati doğrulanmamış maç olay olarak yayımlanmaz: `startDate`
  // arama motorunun Event için zorunlu saydığı alan ve uydurulamaz.
  const todayMatches = curatedMatches()
    .filter((match) => String(match.kickoff || "").slice(0, 10) === today)
    .filter((match) => match.kickoff && match.homeTeam && match.awayTeam)
    .sort((left, right) => String(left.kickoff).localeCompare(String(right.kickoff)));

  if (todayMatches.length) {
    nodes.push({
      "@type": "ItemList",
      name: "Bugünün maçları",
      numberOfItems: todayMatches.length,
      itemListElement: todayMatches.map((match, index) => {
        const status = String(match.status || "SCHEDULED").toUpperCase();
        const eventStatus = status === "FINISHED"
          ? "https://schema.org/EventCompleted"
          : status === "POSTPONED"
            ? "https://schema.org/EventPostponed"
            : status === "CANCELLED"
              ? "https://schema.org/EventCancelled"
              : "https://schema.org/EventScheduled";

        return {
          "@type": "ListItem",
          position: index + 1,
          item: {
            "@type": "SportsEvent",
            name: `${match.homeTeam} - ${match.awayTeam}`,
            startDate: match.kickoff,
            eventStatus,
            eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
            sport: "Football",
            homeTeam: { "@type": "SportsTeam", name: match.homeTeam },
            awayTeam: { "@type": "SportsTeam", name: match.awayTeam },
            url: `${domain}/${matchDetailLink(match).replace(/^\.\//, "")}`,
            ...(match.league ? { superEvent: { "@type": "SportsEvent", name: displayLeagueName(match.league) } } : {}),
            // Saha yalnızca doğrulanmışsa yazılır; sağlayıcıdan gelen
            // teyitsiz saha bilgisi (providerVenue) buraya girmez.
            ...(match.venue && match.venue !== "Açıklanmadı"
              ? { location: { "@type": "StadiumOrArena", name: match.venue } }
              : {})
          }
        };
      })
    });
  }

  return JSON.stringify({ "@context": "https://schema.org", "@graph": nodes });
}

/** Sayfanın `<head>` bölümündeki işaretleyici bloğunu değiştirir. */
function replaceMarkerBlock(html, marker, content) {
  const start = `<!-- prerender:${marker}:start -->`;
  const end = `<!-- prerender:${marker}:end -->`;
  if (!html.includes(start) || !html.includes(end)) return html;

  const expression = new RegExp(
    `${start.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${end.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`
  );
  return html.replace(expression, `${start}\n${content}\n    ${end}`);
}

function writePage(file, slots, freshness, options = {}) {
  const sourcePath = path.join(root, file);
  if (!fs.existsSync(sourcePath)) {
    return;
  }

  let html = fs.readFileSync(sourcePath, "utf8");
  Object.entries(slots).forEach(([target, content]) => {
    html = replaceSlot(html, target, content);
  });
  // `<head>` içindeki bloklar `data-api-target` yuvası taşıyamaz (script
  // etiketi bir kart değil); işaretleyici ile değiştirilir.
  Object.entries(options.markers || {}).forEach(([marker, content]) => {
    html = replaceMarkerBlock(html, marker, content);
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
  "today-top-matches": featuredTodayBlock(),
  "home-form-links": formLinksBlock(),
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
}, fixtureFreshness, {
  markers: {
    "home-schema": `    <script type="application/ld+json">${homeSchemaJson()}</script>`
  }
});

writePage("haberler.html", {
  "news-page": newsCards()
}, fixtureFreshness);

/**
 * ARAMA NİYETİ SAYFALARININ İÇERİĞİ.
 *
 * Kabukları `scripts/generate-static-seo-pages.mjs` yazıyor; gerçek maç
 * listesi burada dolduruluyor çünkü maç verisi zaten bu dosyada okunuyor.
 * İki kaynak arasında veri kopyalamak yerine, her dosya bildiği işi yapıyor.
 */
writePage("gunluk-mac-analizleri.html", {
  "daily-analysis-matches": matchProgramState("today")
}, fixtureFreshness);

// "Bugünkü maç tahminleri" sayfası boş vitrin kartları yerine günün gerçek
// maç listesini gösteriyor; aynı kart, aynı radar sinyali, aynı boş durum.
writePage("bugunku-mac-tahminleri.html", {
  "prediction-matches": matchProgramState("today")
}, fixtureFreshness);

/**
 * Trendyol Süper Lig eşleşmelerinin kalıcı analiz sayfaları. Yalnızca onaylı
 * eşleşmeler listelenir; tarih açıklanmamışsa saat yerine hafta aralığı
 * yazılır ve uydurma bir başlama saati üretilmez.
 */
function superLigAnalysisLinks(limit) {
  const upcoming = allFixtures().slice(0, limit || 12);

  if (!upcoming.length) {
    return `<article class="data-empty" data-card="empty-state">
      <strong>Onaylı eşleşme bekleniyor</strong>
      <span>Fikstür doğrulandığında her karşılaşmanın analiz sayfası burada listelenecek.</span>
    </article>`;
  }

  return upcoming.map((match) => `<a class="home-form-link" href="./mac/${escapeHtml(matchSlug(match))}.html">
    <span class="home-form-link-team">${escapeHtml(match.roundLabel)} · ${escapeHtml(match.dateRange)}</span>
    <strong>${escapeHtml(match.homeTeam)} - ${escapeHtml(match.awayTeam)} Maç Analizi</strong>
    <span class="muted-copy">Form, kadro durumu ve radar okuması</span>
  </a>`).join("");
}

writePage("super-lig-mac-analizleri.html", {
  "super-lig-analysis-links": superLigAnalysisLinks(12)
}, fixtureFreshness);

// Günün Radar Bülteni: adı "bülten" ama içinde o güne ait hiçbir veri yoktu.
writePage("gunun-radar-bulteni.html", {
  "bulletin-matches": matchProgramState("today"),
  "bulletin-transfers": bulletinTransfers(5),
  "bulletin-statements": bulletinStatements(5)
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
  "match-detail": `<article class="card match-detail-card"><span class="card-kicker">Trendyol Süper Lig fikstürü</span><h2>Maç öncesi analiz sayfasını seç</h2><p>Onaylı eşleşmelerin form, kadro durumu ve radar puanı aynı kalıcı sayfada yer alır.</p><div class="match-empty-actions">${topFixtures.map((match) => `<a class="detail-link" href="./mac/${escapeHtml(matchSlug(match))}.html">${escapeHtml(match.homeTeam)} - ${escapeHtml(match.awayTeam)}</a>`).join("")}</div></article>`
}, fixtureFreshness);

writePage("super-lig-fikstur.html", {
  "super-lig-fixtures": `<section class="fixture-overview">${(fixtures.watchList || []).map((item) => `<article class="metric-tile"><strong>${escapeHtml(item.value)}</strong><span>${escapeHtml(item.label)}</span></article>`).join("")}</section><section class="fixture-note card"><span class="card-kicker">${escapeHtml(displayLeagueName(fixtures.league))} · ${escapeHtml(fixtures.season)}</span><h2>İlk iki haftanın eşleşmeleri açıklandı</h2><p>Tarih ve saat bilgileri açıklandıkça ilgili maç sayfaları güncellenecek.</p></section><section class="fixture-rounds">${fixtureRounds()}</section>`
}, fixtureFreshness);

for (const file of noindexShellPages) {
  const sourcePath = path.join(root, file);
  if (!fs.existsSync(sourcePath)) continue;
  const html = updateRobotsDirective(fs.readFileSync(sourcePath, "utf8"), file);
  fs.writeFileSync(sourcePath, html, "utf8");
  fs.writeFileSync(path.join(root, "public", file), html, "utf8");
}

console.log("Prerendered critical page fallbacks");
