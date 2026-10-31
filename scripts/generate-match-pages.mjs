import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { siteHeader, siteFooter } from "./lib/layout.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";
import { ROBOTS_INDEX, ROBOTS_NOINDEX_FOLLOW } from "./lib/robots.mjs";
import {
  lineupsSection,
  playerCardsSection,
  aiAnalysisSection,
  probabilitySection,
  absencesSection,
  formSection,
  h2hStandingsSection,
  matchInfoSection,
  liveStatsSection,
  analysisPendingNote,
  buildH2hEntries
} from "./lib/matchAnalysisSections.mjs";
import { loadProbabilityContext } from "./lib/fixtureProbabilityData.mjs";
import { findFinalResult, resultRowsFrom } from "./lib/enMatchResult.mjs";
import { matchWatchCard } from "./lib/youtubeWatchPage.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { internalHref } = require("../services/siteLinks.js");
const { playerLink } = require("../services/playerLinks.js");
const domain = "https://www.futbolradar.com";
const fixtures = JSON.parse(fs.readFileSync(path.join(root, "data", "super-lig-fixtures.json"), "utf8"));
const teams = JSON.parse(fs.readFileSync(path.join(root, "data", "teams.json"), "utf8"));
const rawPlayers = JSON.parse(fs.readFileSync(path.join(root, "data", "players.json"), "utf8"));
const squadStatus = JSON.parse(fs.readFileSync(path.join(root, "data", "squad-statuses.json"), "utf8"));
const matchAnalyses = JSON.parse(fs.readFileSync(path.join(root, "data", "match-analyses.json"), "utf8"));
const fixtureCalendar = JSON.parse(fs.readFileSync(path.join(root, "data", "fixture-calendar.json"), "utf8"));
const leagueStandings = JSON.parse(fs.readFileSync(path.join(root, "data", "league-standings.json"), "utf8"));
const matchArchive = JSON.parse(fs.readFileSync(path.join(root, "data", "historical-match-archive.json"), "utf8"));
const { getPlayers } = require("../services/playerService.js");
const { CONFIRMED_FIXTURE_STATUSES } = require("../services/superLigFixtureService.js");
const { sameClub } = require("../services/superLigTeams.js");
const { calculateMatchRadar, normalizeText } = require("../services/matchRadarService.js");
const { isSameFixture } = require("../services/fixtureCalendar.js");
const { slugForMatch, trPagePath } = require("../services/matchSeoPages.js");
const { resolveStandingsForMatch } = require("../services/standingsResolver.js");
const {
  confidenceLabel,
  formatFreshnessDate,
  freshnessLabel,
  normalizeFreshness
} = require("../services/freshnessService.js");

const players = getPlayers(rawPlayers);
// İzlerken skor: yalnızca site sahibinin data/youtube-watch.json'a eklediği
// resmi YouTube yayınları. Kayıt yoksa maç sayfasına yeni kutu eklenmez.
const { loadEntries: loadWatchEntries } = require("../services/youtubeWatch.js");
const watchEntries = (() => {
  try { return loadWatchEntries(JSON.parse(fs.readFileSync(path.join(root, "data", "youtube-watch.json"), "utf8"))).entries; } catch { return []; }
})();
function watchEntryFor(match) {
  const slugValue = pageSlug(match);
  return watchEntries.find((entry) => entry.slug === slugValue || entry.matchPath === `/mac/${slugValue}.html`) || null;
}
const calendarMatches = Array.isArray(fixtureCalendar.matches) ? fixtureCalendar.matches : [];
const archiveRecords = Array.isArray(matchArchive.records) ? matchArchive.records : [];
// Oynanmış hafta maçlarının sonucu: takvim + arşiv (bkz. lib/enMatchResult.mjs).
const resultRows = resultRowsFrom(calendarMatches, archiveRecords);
/**
 * Bu üretici YALNIZCA TFF Süper Lig fikstüründen sayfa basar
 * (data/super-lig-fixtures.json), bu yüzden tablo da Süper Lig tablosudur.
 * Yine de kimlik elle yazılmaz: tablo, diğer tüm maç yüzeyleriyle aynı
 * çözümleyiciden (services/standingsResolver.js) `competitionId: "super-lig"`
 * ile istenir — sezon denetimi ve "veri yoksa boş bırak" kuralı burada da
 * aynı kodla işler, iki yüzey asla ayrışmaz.
 */
function standingsForFixture(match) {
  return {
    ...resolveStandingsForMatch(
      { competitionId: "super-lig", league: fixtures.league, kickoff: match.kickoff },
      { store: leagueStandings }
    ),
    fullHref: internalHref("super-lig-puan-durumu.html", { from: "mac/_.html" })
  };
}

/**
 * TAHMİN ZİNCİRİ — depo → takvimdeki ham sağlayıcı yükü → FutbolRadar
 * modeli. Sağlayıcıya derleme anında istek atılmaz; `/predictions` ve
 * `/odds` çağrıları `scripts/sync-fixture-predictions.mjs` koşusuna aittir.
 */
const probabilityStore = require("../services/fixturePredictionStore.js");
const probabilityService = require("../services/fixtureProbabilityService.js");
const probabilityIndex = probabilityStore.indexStore(
  probabilityStore.readStore(path.join(root, "data", "fixture-predictions.json"))
);
const probabilityContext = loadProbabilityContext(root);

function resolvedProbability(match, calendarRec) {
  const providerFixtureId = calendarRec && calendarRec.providerIds && calendarRec.providerIds.apiFootball
    ? String(calendarRec.providerIds.apiFootball)
    : null;
  const stored = probabilityIndex.find(calendarRec && calendarRec.id, providerFixtureId);
  if (stored) {
    const display = probabilityStore.toDisplayRecord(stored);
    if (display) return display;
  }
  // Depoda kayıt yoksa takvimdeki ham sağlayıcı yükü normalleştirilir;
  // o da yoksa model yerel veriden hesaplanır.
  const fromProvider = probabilityService.normalizeProviderPrediction(calendarRec && calendarRec.prediction);
  if (fromProvider) return fromProvider;
  const model = probabilityContext.engine.modelFor({
    id: calendarRec && calendarRec.id,
    competitionId: (calendarRec && calendarRec.competitionId) || "super-lig",
    kickoff: match.kickoff,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    homeTeamId: calendarRec && calendarRec.homeTeamId,
    awayTeamId: calendarRec && calendarRec.awayTeamId
  });
  return model.prediction || null;
}

const outDir = path.join(root, "mac");
/** Bu üreticinin dosya deseni: <ev>-<dep>-<sezon>-r<NN>.html */
const ROUND_PAGE_FILE_RE = /-\d{4}-\d{4}-r\d{2}\.html$/;
const ROUND_PAGE_LOC_RE = /<loc>[^<]*\/mac\/[^<]*-\d{4}-\d{4}-r\d{2}\.html<\/loc>/;
const publicOutDir = path.join(root, "public", "mac");

/**
 * Üç ayrı kimlik düzeni arasında köprü: TFF fikstürü (tff-tsl-...), analiz
 * kaydı (takim-takim-tarih) ve takvim kaydı (takim-takim-tarih). Eşleşme
 * kimlik dizgisiyle DEĞİL, kulüp çifti + gün ile kurulur (sameClub yazım
 * farklarını tolere eder) — bkz. services/fixtureCalendar.js#isSameFixture.
 */
function findAnalysisRecord(match) {
  if (!match.kickoff) return null;
  return matchAnalyses.find((record) => record && record.homeContext && isSameFixture(
    { homeTeam: match.homeTeam, awayTeam: match.awayTeam, kickoff: match.kickoff },
    { homeTeam: record.homeContext.teamName, awayTeam: record.awayContext && record.awayContext.teamName, kickoff: record.kickoff }
  )) || null;
}

function findCalendarRecord(match) {
  if (!match.kickoff) return null;
  return calendarMatches.find((record) => isSameFixture(
    { homeTeam: match.homeTeam, awayTeam: match.awayTeam, kickoff: match.kickoff },
    record
  )) || null;
}

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
  // "confirmed-date" = eşleşme onaylı VE gün/saat atanmış. İkisi de yayına
  // girer; tarih atanmış maçı dışarıda bırakmak, onaylanmış bir fikstürün
  // sayfasını yok etmek olurdu.
  }))).filter((match) => match.homeTeam && match.awayTeam && CONFIRMED_FIXTURE_STATUSES.has(match.fixtureStatus));
}

// Kaynaklar arası yazım farkı için bkz. services/superLigTeams.js#sameClub.
function getTeam(name) {
  return teams.find((team) => normalizeText(team.name || team.team) === normalizeText(name)) ||
    teams.find((team) => sameClub(team.name || team.team, name)) ||
    null;
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
    return `<li><a href="${escapeHtml(playerLink(player.id, "../"))}">${escapeHtml(player.name)}</a><span>Radar ${escapeHtml(rating)}</span></li>`;
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
  return `<dl class="match-squad-metrics"><div><dt>Eksik oyuncu</dt><dd>${escapeHtml(absenceCount)}</dd></div>${impact == null ? "" : `<div><dt>Kadro kaybı</dt><dd>${escapeHtml(`${impact}/100`)}</dd></div>`}<div><dt>Önemli eksik</dt><dd>${escapeHtml(row.keyAbsence || "Yok")}</dd></div></dl>`;
}

function radarCard(name, radar, team) {
  const score = radar.score === null ? "Veri bekleniyor" : `${radar.score}/100`;
  const positives = radar.positives.length ? radar.positives : ["Yeterli olumlu bileşen oluşmadı"];
  const negatives = radar.negatives.length ? radar.negatives : ["Belirgin olumsuz bileşen yok"];
  return `<article class="match-radar-team-card">
    <div class="match-radar-team-head"><span>${escapeHtml(name)}</span><strong>${escapeHtml(score)}</strong></div>
    <div class="match-confidence"><span>${escapeHtml(confidenceLabel(radar.confidence))}</span><b>Kapsam %${escapeHtml(radar.coverage)}</b></div>
    <div class="match-radar-bars">${radar.components.filter((item) => item.value !== null).map((item) => `<div><span>${escapeHtml(item.label)}</span><i style="--value:${escapeHtml(item.value)}%"><b></b></i><em>${escapeHtml(Math.round(item.value))}</em></div>`).join("") || '<p class="muted-copy">Puan için yeterli bileşen yok.</p>'}</div>
    <details class="radar-explanation" data-radar-explanation>
      <summary>Neden bu puan?</summary>
      <div class="radar-explanation-grid"><div><span>Güçlü etkenler</span><ul>${positives.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div><div><span>Dikkat noktaları</span><ul>${negatives.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div></div>
    </details>
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
 * MAÇ MERKEZİ DEVRİ — bu sayfa kalıcı maç sayfasının takma adı mı?
 *
 * Hafta numaralı adres (`/mac/<ev>-<dep>-2026-2027-r05.html`) TFF fikstürü
 * yalnızca EŞLEŞMEYİ bildirdiğinde, yani tarih henüz atanmamışken üretilir:
 * o aşamada tarih slug'ı kurulamaz. Maç takvime oturup tarihi onaylanınca
 * aynı maç için kalıcı Maç Merkezi adresi (`/mac/<ev>-<dep>-23-agustos-2026`)
 * açılır ve maçın tüm yaşam döngüsü orada sürer.
 *
 * Devir gerçekleştikten sonra hafta numaralı sayfa SİLİNMEZ (dış bağlantılar
 * ve eski paylaşımlar kırılmasın) ama artık kanonik değildir: canonical,
 * og:url ve SportsEvent kimliği Maç Merkezi adresini gösterir, sayfa site
 * haritasından düşer. Aksi hâlde Google aynı maçı iki ayrı indekslenebilir
 * adreste görüyor — sezon ilerledikçe 306 eşleşmenin tamamı çiftlenirdi.
 *
 * Sicilde kayıt yoksa `null` döner: olmayan bir adrese canonical verilmez.
 */
function matchCentreSlug(match) {
  if (!match || !match.kickoff) return null;
  return slugForMatch({ homeTeam: match.homeTeam, awayTeam: match.awayTeam, kickoff: match.kickoff }) || null;
}

/** Maç Merkezi'nin uzantısız yolu (`mac/<slug>`) ya da null. */
function matchCentrePath(match) {
  const seoSlug = matchCentreSlug(match);
  return seoSlug ? trPagePath(seoSlug).replace(/\.html$/, "") : null;
}

/**
 * Kalıcı maç sayfası bağlantısı: aynı maçın "ne zaman / canlı skor / sonuç"
 * yüzeyi tarih slug'lı sayfada yaşıyor. Sicilde sayfa yoksa kart basılmaz.
 */
function liveCenterCard(match) {
  const centrePath = matchCentrePath(match);
  if (!centrePath) return "";
  return `<a class="match-related-card" href="../${escapeHtml(centrePath)}"><span>Canlı maç merkezi</span><strong>Ne zaman, hangi kanalda, canlı skor</strong><p>Maç saati, yayın, muhtemel 11'ler ve maç sonucu aynı kalıcı sayfada.</p></a>`;
}

/**
 * Devredilmiş sayfanın en üstünde tek satırlık yönlendirme şeridi: kullanıcı
 * canlı skoru ve sonucu aradığında ilgili sayfaya kaydırmadan geçebilsin.
 */
function centreHandoffBanner(match) {
  const centrePath = matchCentrePath(match);
  if (!centrePath) return "";
  return `<p class="match-centre-handoff"><a href="../${escapeHtml(centrePath)}">${escapeHtml(`${match.homeTeam} - ${match.awayTeam}`)} maç merkezi: saat, yayın kanalı, canlı skor ve maç sonucu →</a></p>`;
}

/** "14 Ağustos 2026 Cuma" — TSİ. */
function shortDateLabel(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("tr-TR", {
    day: "numeric", month: "long", year: "numeric", weekday: "long", timeZone: "Europe/Istanbul"
  }).format(parsed);
}

/** "21:30" — TSİ. */
function clockLabel(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" }).format(parsed);
}

/**
 * TARİHİ ATANMAMIŞ HAFTA SAYFASI İNDEKSLENMEZ.
 *
 * Fikstürde yalnızca eşleşmesi belli (gün/saat yok) maçın hafta numaralı
 * sayfası ("... Maç Önü Analizi" başlığı) yer tutucudur: tam analiz "maç
 * haftası yaklaştığında" üretilecek, içerik "bekleniyor" notlarından oluşuyor
 * ve başlık olmayan bir analizi vaat ediyor. Bu sayfalar aynı iskeletle onlarca
 * kez tekrarlanır (306 sayfa; 235'i tarihsiz). Gün/saat atanıp Maç Merkezi
 * sayfası açılınca aynı adres `unify-match-canonicals` ile kalıcı sayfaya
 * kanonikleşir; o ana kadar `noindex,follow` + site haritası dışı. Sayfa
 * AÇIK kalır, iç bağlantılar izlenir.
 */
function isDatedMatch(match) {
  if (match.kickoff) return true;
  const result = findFinalResult(match, resultRows, { seasonStart: fixtures.seasonStart });
  return Boolean(result && result.kickoff);
}

function pageHtml(match) {
  const slugValue = pageSlug(match);
  const selfUrl = `${domain}/mac/${slugValue}.html`;
  // Maç Merkezi açıldıysa kanonik adres odur (bkz. matchCentreSlug).
  const centrePath = matchCentrePath(match);
  const canonical = centrePath ? `${domain}/${centrePath}` : selfUrl;
  const isCentreAlias = canonical !== selfUrl;
  const freshness = normalizeFreshness(match.freshness);
  const radar = calculateMatchRadar(match, { teams, players, squadStatus });
  const homeTeam = getTeam(match.homeTeam);
  const awayTeam = getTeam(match.awayTeam);
  // MAÇ OYNANDIYSA sayfa sonuca döner (EN sayfalarla aynı kaynak ve kapılar).
  // Sonuç yoksa önizleme kalır; skor ya da tarih uydurulmaz.
  const finalResult = findFinalResult(match, resultRows, { seasonStart: fixtures.seasonStart });
  const resultKickoff = finalResult ? (finalResult.kickoff || match.kickoff || null) : null;
  const dateLabel = resultKickoff ? formatFreshnessDate(resultKickoff) : match.kickoff ? formatFreshnessDate(match.kickoff) : (match.dateRange || "Tarih ve saat bekleniyor");

  // Maç öncesi bölümler (kullanıcı öncelik sırası): analiz kaydı ancak maç
  // haftası penceresinde üretilir; yokken tek dürüst bekleme notu basılır,
  // altı ayrı boş kutu değil. H2H, puan tablosu ve maç bilgileri analiz
  // kaydından bağımsız gerçek verilerdir — her sayfada denenir.
  const analysis = findAnalysisRecord(match);
  const calendarRec = findCalendarRecord(match);
  const base = "../";
  const fixtureTeamRow = (fixtures.teams || []).find((team) => sameClub(team.name, match.homeTeam)) || null;
  const h2hEntries = buildH2hEntries({
    archiveRecords,
    calendarRec,
    homeName: match.homeTeam,
    awayName: match.awayTeam,
    sameClub
  });
  const providerFixtureId = (analysis && analysis.providerId) ||
    (calendarRec && calendarRec.providerIds && calendarRec.providerIds.apiFootball) || null;

  const preMatchSections = [
    analysis ? lineupsSection(analysis, players, base) : "",
    analysis ? playerCardsSection(analysis, players, base) : "",
    analysis ? aiAnalysisSection(analysis, radar, match.homeTeam, match.awayTeam, base) : "",
    analysis ? probabilitySection(analysis, calendarRec, match.homeTeam, match.awayTeam, resolvedProbability(match, calendarRec)) : "",
    analysis ? absencesSection(analysis, squadStatus, match.homeTeam, match.awayTeam) : "",
    analysis ? formSection(analysis, match.homeTeam, match.awayTeam) : "",
    !analysis ? analysisPendingNote() : "",
    h2hStandingsSection(h2hEntries, standingsForFixture(match), match.homeTeam, match.awayTeam),
    matchInfoSection(resultKickoff ? { ...match, kickoff: resultKickoff } : match, calendarRec, fixtureTeamRow && fixtureTeamRow.venue, fixtureTeamRow && fixtureTeamRow.city),
    liveStatsSection(match, providerFixtureId)
  ].filter(Boolean).join("\n      ");

  // BAŞLIK ARANAN SORUYU KARŞILAMALI.
  //
  // Bir maç sayfasına gelen aramanın ezici çoğunluğu "… maçı ne zaman, saat
  // kaçta" biçiminde. Başlık yalnızca "Maç Önü Analizi" dediğinde sayfa,
  // cevabını ZATEN TAŞIDIĞI sorunun sonuçlarında görünmüyordu. Gün ve saat
  // yalnızca DOĞRULANMIŞSA başlığa girer; atanmamış fikstürde eski başlık
  // korunur, çünkü olmayan bir tarihi başlıkta vaat etmek okuyucuyu boşa
  // tıklatır.
  const kickoffDay = match.kickoff ? shortDateLabel(match.kickoff) : "";
  const kickoffClock = match.kickoff ? clockLabel(match.kickoff) : "";
  // KALICI MAÇ SAYFASI VARSA "ne zaman / saat kaçta" niyeti ORAYA aittir:
  // aynı sorgu için iki sayfa yarıştırmak ikisini de zayıflatır. Bu sayfa o
  // durumda maç önü ANALİZİ olarak konumlanır (radar, form, kadro).
  const permanentSlug = match.kickoff ? slugForMatch({ homeTeam: match.homeTeam, awayTeam: match.awayTeam, kickoff: match.kickoff }) : null;
  const resultDay = resultKickoff ? shortDateLabel(resultKickoff) : "";
  const title = finalResult
    ? `${match.homeTeam} ${finalResult.home}-${finalResult.away} ${match.awayTeam} Maç Sonucu${resultDay ? ` (${resultDay})` : ""} | FutbolRadar`
    : match.kickoff && !permanentSlug
    ? `${match.homeTeam} - ${match.awayTeam} Maçı Ne Zaman, Saat Kaçta? ${kickoffDay} ${kickoffClock} | FutbolRadar`
    : match.kickoff
      ? `${match.homeTeam} - ${match.awayTeam} Maç Önü Analizi: Radar, Form ve Kadro (${kickoffDay}) | FutbolRadar`
      : `${match.homeTeam} - ${match.awayTeam} Maç Önü Analizi | FutbolRadar`;
  // Stat adına Türkçe ek EKLENMEZ: doğru ek sesli uyumuna ve son sessize
  // göre değişiyor ("Rams Park'ta", "Tüpraş Stadyumu'nda") ve stat adları
  // veriden geliyor. Tek bir ek kalıbı yazmak kaçınılmaz olarak yanlış
  // Türkçe üretir; cümle eki gerektirmeyecek biçimde kuruluyor.
  const description = finalResult
    ? `${match.homeTeam} - ${match.awayTeam} maçı${resultDay ? ` ${resultDay} tarihinde` : ""} ${finalResult.home}-${finalResult.away} sona erdi. Skor, maç bilgileri, ikili rekabet ve puan durumu FutbolRadar'da.`
    : match.kickoff
    ? `${match.homeTeam} - ${match.awayTeam} maçı ${kickoffDay} saat ${kickoffClock} TSİ'de oynanacak.${match.venue ? ` Stat: ${match.venue}.` : ""} Maç öncesi form, radar puanı, kadro durumu ve kilit oyuncu etkisi FutbolRadar'da.`
    : `${match.homeTeam} - ${match.awayTeam} Süper Lig maç öncesi analizi; form, radar puanı, kadro durumu ve kilit oyuncu etkisiyle FutbolRadar'da.`;
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      // SportsEvent YALNIZCA BAŞLAMA ANI BİLİNİYORSA yazılır.
      //
      // Buradaki düğüm `startDate` taşımıyordu — ne de `location`,
      // `homeTeam`, `awayTeam`. `startDate` Event için zorunlu alan;
      // onsuz düğüm zengin sonuç üretmez, yalnızca doğrulayıcıda hata
      // olarak görünür. 306 maç sayfasının tamamı bu hâldeydi.
      //
      // Tarihi atanmamış fikstürde düğüm HİÇ yazılmaz. Alternatif, olmayan
      // bir tarih uydurmak olurdu; geçersiz şema, yanlış şemadan iyidir.
      //
      // Maç Merkezi'ne devredilmiş sayfada da yazılmaz: o maçın SportsEvent
      // kimliği kanonik adreste yaşıyor ve orada canlı durumla (eventStatus,
      // skor) güncelleniyor. Burada ikinci bir düğüm bırakmak aynı gerçek
      // olayı iki ayrı adrese bağlar; bu sayfa artık yalnızca maç ÖNÜ
      // analizini taşıyan takma addır.
      ...((match.kickoff || resultKickoff) && !isCentreAlias ? [{
        "@type": "SportsEvent",
        name: `${match.homeTeam} - ${match.awayTeam}`,
        url: canonical,
        description,
        startDate: match.kickoff || resultKickoff,
        ...(finalResult ? {} : { eventStatus: "https://schema.org/EventScheduled" }),
        eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
        homeTeam: { "@type": "SportsTeam", name: match.homeTeam },
        awayTeam: { "@type": "SportsTeam", name: match.awayTeam },
        competitor: [
          { "@type": "SportsTeam", name: match.homeTeam },
          { "@type": "SportsTeam", name: match.awayTeam }
        ],
        ...(match.venue ? { location: { "@type": "Place", name: match.venue } } : {}),
        superEvent: { "@type": "SportsOrganization", name: fixtures.league || "Süper Lig" },
        sport: "Football"
      }] : []),
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Ana Sayfa", item: `${domain}/` },
          { "@type": "ListItem", position: 2, name: "Süper Lig Fikstürü", item: `${domain}/super-lig-fikstur.html` },
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
    <meta name="robots" content="${isDatedMatch(match) ? ROBOTS_INDEX : ROBOTS_NOINDEX_FOLLOW}" />
    <meta property="og:type" content="article" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${domain}/assets/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${domain}/assets/og-image.png" />
    <script type="application/ld+json">${JSON.stringify(schema)}</script>
    <link rel="icon" href="../favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="../site.webmanifest" />
    <link rel="stylesheet" href="../page.css" />
  </head>
  <body class="subpage match-analysis-page">
    ${siteHeader({ base: "../" })}
    <main class="container" data-notification-detail data-match="${escapeHtml(match.id)}" data-home-team="${escapeHtml(match.homeTeam)}" data-away-team="${escapeHtml(match.awayTeam)}" data-match-href="${escapeHtml(selfUrl)}">
      <nav class="breadcrumb" aria-label="Sayfa yolu"><a href="../index.html">Ana Sayfa</a><span>/</span><a href="../super-lig-fikstur.html">Süper Lig Fikstürü</a><span>/</span><span>${escapeHtml(match.homeTeam)} - ${escapeHtml(match.awayTeam)}</span></nav>
      ${centreHandoffBanner(match)}
      <section class="hero match-analysis-hero"><div class="hero-row"><div><span class="eyebrow">${escapeHtml(match.roundLabel)} · ${escapeHtml(match.league)}</span><h1>${finalResult ? `${escapeHtml(match.homeTeam)} ${escapeHtml(finalResult.home)}-${escapeHtml(finalResult.away)} ${escapeHtml(match.awayTeam)}` : `${escapeHtml(match.homeTeam)} - ${escapeHtml(match.awayTeam)}`}</h1><p class="lead">${escapeHtml(radar.lead)}</p></div><span class="hero-meta">${escapeHtml(dateLabel)}</span></div></section>
      <section class="match-freshness-strip" aria-label="Fikstür durumu"><div><span>Fikstür durumu</span><b>${escapeHtml(freshnessLabel(freshness))}</b></div><div><span>Son kontrol</span><b>${escapeHtml(formatFreshnessDate(freshness.verifiedAt || freshness.fetchedAt))}</b></div><div><span>Güven</span><b>${escapeHtml(confidenceLabel(freshness.confidence))}</b></div></section>
      ${finalResult ? `<section class="match-final-result" aria-labelledby="tr-result-title"><h2 id="tr-result-title" class="match-section-title">Maç Sonucu</h2><div class="card metric-grid"><span>Skor <b>${escapeHtml(finalResult.home)}-${escapeHtml(finalResult.away)}</b></span>${finalResult.halftimeHome !== null && finalResult.halftimeAway !== null ? `<span>İlk yarı <b>${escapeHtml(finalResult.halftimeHome)}-${escapeHtml(finalResult.halftimeAway)}</b></span>` : ""}${resultKickoff ? `<span>Tarih <b>${escapeHtml(formatFreshnessDate(resultKickoff))}</b></span>` : ""}</div></section>` : ""}
      ${preMatchSections}
      <section class="match-radar-board" aria-label="Maç öncesi radar puanları">${radarCard(match.homeTeam, radar.home, homeTeam)}${radarCard(match.awayTeam, radar.away, awayTeam)}</section>
      <p class="match-radar-disclaimer">${escapeHtml(radar.disclaimer)}</p>
      <section class="match-context-grid" aria-label="Maç bağlamı"><article class="card"><span class="card-kicker">${escapeHtml(match.homeTeam)}</span><h2>Form ve kadro</h2>${formHtml(homeTeam)}${squadHtml(match.homeTeam)}${keyPlayersHtml(match.homeTeam)}</article><article class="card"><span class="card-kicker">${escapeHtml(match.awayTeam)}</span><h2>Form ve kadro</h2>${formHtml(awayTeam)}${squadHtml(match.awayTeam)}${keyPlayersHtml(match.awayTeam)}</article></section>
      <section class="match-related-grid" aria-label="İlgili radar ekranları">${matchWatchCard(watchEntryFor(match))}${liveCenterCard(match)}${relatedComparison(match)}<a class="match-related-card" href="../super-lig-fikstur.html"><span>Fikstür</span><strong>Sezon eşleşmeleri</strong><p>Onaylı eşleşmelerin tamamına dön.</p></a><a class="match-related-card" href="../momentum.html"><span>Takım formu</span><strong>Momentum tablosu</strong><p>Takım trendlerini ayrı ekranda karşılaştır.</p></a></section>
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
  // YALNIZCA kendi (hafta numaralı) girdileri değiştirilir: aynı dizinde
  // yaşayan kalıcı maç SEO sayfaları (tarih slug'lı, uzantısız) korunur.
  const retained = (current.match(URL_ENTRY_RE) || [])
    .filter((entry) => !ROUND_PAGE_LOC_RE.test(entry));
  // Kök etiket scripts/lib/sitemap.mjs'de: bu adım site haritasını baştan
  // yazdığı için ad alanları burada da bildirilmek zorunda; sabit bir dize
  // yazılsaydı iki dilli girdilerin `xhtml:` öneki tanımsız kalırdı.
  // Maç Merkezi'ne devredilmiş hafta sayfaları site haritasından düşer:
  // haritaya yalnızca kanonik adresler yazılır, takma ad yazılmaz. Sayfa
  // dosyası yerinde kalır ve canonical ile kanonik adrese bağlanır.
  const canonicalOnly = matches.filter((match) => !matchCentrePath(match) && isDatedMatch(match));
  const content = wrapUrlset(retained.concat(canonicalOnly.map(sitemapEntry)));
  fs.writeFileSync(sitemapPath, content, "utf8");
  fs.writeFileSync(path.join(root, "public", "sitemap.xml"), content, "utf8");
}

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(publicOutDir, { recursive: true });

const confirmedFixtures = flattenFixtures();
const expectedFiles = new Set(confirmedFixtures.map((match) => `${pageSlug(match)}.html`));
for (const directory of [outDir, publicOutDir]) {
  for (const file of fs.readdirSync(directory)) {
    // Aynı dizindeki kalıcı maç SEO sayfalarına (tarih slug'lı) dokunulmaz.
    if (ROUND_PAGE_FILE_RE.test(file) && !expectedFiles.has(file)) {
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
