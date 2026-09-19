/**
 * MAÇ SEO SAYFASI — BÖLÜM İŞARETLEMESİ (TR + EN, tek kaynak).
 *
 * scripts/generate-match-seo-pages.mjs tüketir. Her işlev ya tam bir bölüm
 * HTML'i ya da BOŞ DİZE döndürür; boş dize = doğrulanmış veri yok demektir
 * ve sayfaya boş kutu basılmaz. Uydurma değer üretilmez: saat, kanal, hakem,
 * skor ve kadro yalnızca kayıtta varsa yazılır; yoksa "Henüz açıklanmadı"
 * gibi dürüst bir ifade gösterilir.
 *
 * Aynı bölümler iki dilde de üretilir: metinler `STR` sözlüğünden gelir,
 * veri kaynağı ve kural ikisinde de birebir aynıdır (TR'nin göstermediği
 * veriyi EN de göstermez).
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { normalizeText } = require("../../api/_utils.js");
const { canonicalStatus, finishType, istanbulDay } = require("../../services/matchStatus.js");
const { sameClub } = require("../../services/superLigTeams.js");
const { publicPlayerView } = require("../../services/cardCredibility.js");
const { slug: playerSlug } = require("../../services/playerService.js");
/**
 * Akışın kuralları (sınıflandırma, koşan skor, önem, satır işaretlemesi)
 * `services/matchTimeline.js` içinde tek kaynak olarak duruyor; tarayıcı
 * kopyasını `scripts/build-match-timeline-client.mjs` aynı dosyadan
 * üretiyor. Burada ikinci bir tanım YOK — olması, maç sürerken ve maç
 * bitince farklı iki anlatı çizmek demekti.
 */
const matchTimeline = require("../../services/matchTimeline.js");
/**
 * Diziliş satırları (saha görseli) `services/matchHub.js` içinde tek kaynak.
 * `mac-detay.html` merkezi aynı işlevi kullanıyor; burada ikinci bir kopya
 * tutmak, iki yüzeyin aynı kadroyu farklı dizmesi demekti. Kural da oradan
 * geliyor: sağlayıcının `grid` koordinatı YA DA diziliş metni + 11 oyuncunun
 * sırası; ikisi de yoksa `null` döner ve saha ÇİZİLMEZ.
 */
const matchHub = require("../../services/matchHub.js");

/**
 * Oyuncu adresleri tek çözücüden. Maç SEO sayfaları hem Türkçe hem
 * İngilizce bağlantı basıyor ve ikisi de kimlikten türetiliyordu; oyuncu
 * tam isimli adrese taşındığı anda iki dilde de kırık link oluyordu.
 */
const playerUrls = require("../../services/playerUrl.js").createPlayerUrlResolver((() => {
  try {
    return require("../../data/player-url-slugs.json");
  } catch {
    return { entries: [], aliases: [] };
  }
})());

/**
 * Maç sayfasından oyuncu sayfasına giden yol, dile göre.
 *
 * Hedef üretilmemişse `null` döner: İngilizce profil yalnızca yayın
 * kapısından geçen oyuncular için var ve olmayan bir sayfaya bağlantı
 * atmak 404 demek.
 */
function playerPageHref(base, locale, id) {
  const relative = locale === "en" ? playerUrls.enPlayerPagePath(id) : playerUrls.playerPagePath(id);
  return fs.existsSync(path.join(process.cwd(), relative)) ? `${base}${relative}` : null;
}
const { broadcastChannel } = require("../../services/broadcastSchedule.js");
const probabilityService = require("../../services/fixtureProbabilityService.js");
const { competitionLabel } = require("../../services/i18n.js");

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const LOCALE_TAG = { tr: "tr-TR", en: "en-GB" };

export function longDate(value, locale) {
  const parsed = new Date(String(value || ""));
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat(LOCALE_TAG[locale] || "tr-TR", {
    timeZone: "Europe/Istanbul", day: "numeric", month: "long", year: "numeric", weekday: "long"
  }).format(parsed);
}

export function shortDate(value, locale) {
  const parsed = new Date(String(value || ""));
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat(LOCALE_TAG[locale] || "tr-TR", {
    timeZone: "Europe/Istanbul", day: "numeric", month: "long", year: "numeric"
  }).format(parsed);
}

export function clock(value) {
  const parsed = new Date(String(value || ""));
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit", hour12: false }).format(parsed);
}

/** ISO başlama anını her zaman +03:00 ofsetiyle yazar (şema kuralı). */
export function istanbulIso(value) {
  const parsed = new Date(String(value || ""));
  if (Number.isNaN(parsed.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  }).formatToParts(parsed).reduce((acc, part) => { acc[part.type] = part.value; return acc; }, {});
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}:${parts.second}+03:00`;
}

export const STR = {
  tr: {
    matchWord: "Maçı",
    notAnnounced: "Henüz açıklanmadı",
    tsi: "TSİ",
    home: "Ev sahibi",
    away: "Deplasman",
    date: "Tarih",
    time: "Saat",
    competition: "Turnuva",
    venue: "Stadyum",
    channel: "Yayın kanalı",
    referee: "Hakem",
    status: "Maç durumu",
    round: "Hafta",
    state: { pre: "Başlamadı", live: "Canlı", post: "Tamamlandı", pending: "Sonuç doğrulanıyor", postponed: "Ertelendi", cancelled: "İptal edildi", halftime: "Devre arası" },
    whenTitle: (h, a) => `${h} - ${a} maçı ne zaman?`,
    whenBody: (h, a, day, competition) => `${h} - ${a} maçı ${day} tarihinde${competition ? ` ${competition} kapsamında` : ""} oynanacak.`,
    whenBodyPast: (h, a, day, competition) => `${h} - ${a} maçı ${day} tarihinde${competition ? ` ${competition} kapsamında` : ""} oynandı.`,
    timeTitle: (h, a) => `${h} - ${a} maçı saat kaçta?`,
    timeBody: (h, a, hour) => `${h} - ${a} maçı Türkiye saatiyle ${hour}'da başlayacak.`,
    timeBodyPast: (h, a, hour) => `${h} - ${a} maçı Türkiye saatiyle ${hour}'da başladı.`,
    channelTitle: (h, a) => `${h} - ${a} maçı hangi kanalda?`,
    channelBody: (h, a, channel) => `${h} - ${a} maçı ${channel} ekranlarından canlı yayınlanacak.`,
    channelBodyPast: (h, a, channel) => `${h} - ${a} maçı ${channel} ekranlarından canlı yayınlandı.`,
    channelBodyLive: (h, a, channel) => `${h} - ${a} maçı ${channel} ekranlarından canlı yayınlanıyor.`,
    channelUnknown: (h, a) => `${h} - ${a} maçının yayın kanalı henüz açıklanmadı. Kanal bilgisi doğrulanmış bir kaynaktan alındığında bu bölüm otomatik güncellenir; tahmini kanal yazılmaz.`,
    // Lig yayın hakkından gelen kanal, o maça özel doğrulanmış bilgiyle
    // aynı şey değil. Not ikisini ayırıyor: okuyucu neye baktığını bilsin.
    lineups: "Muhtemel 11'ler",
    officialLineups: "İlk 11'ler",
    lineupUnavailable: "Bu maç için doğrulanmış ilk 11 verisi mevcut değil.",
    lineupNote: "Muhtemel 11, doğrulanmış kadro ve uygunluk verisinden üretilen bir tahmindir; resmî 11 açıklandığında bu bölüm otomatik güncellenir.",
    lineupPending: "Kadrolar açıklandığında burada yayımlanır. Muhtemel 11 tahmini doğrulanmış kadro verisi olmadan yazılmaz.",
    predictedBadge: "Muhtemel — Resmî Değil",
    predictedLineupNote: "Bu kadrolar spor basınından derlenmiştir; resmî ilk 11 açıklandığında bu bölümün yerini otomatik olarak resmî kadro alır.",
    predictedFlags: "Şüpheli / izlenmesi gereken",
    predictedSources: "Kaynaklar",
    bench: "Yedekler",
    benchPending: "Yedek listesi yayımlanmadı.",
    pitchLabel: "dizilişi",
    startingEleven: "İlk 11",
    formation: "Diziliş",
    coach: "Teknik direktör",
    squads: "Takım kadroları",
    squadPending: "Doğrulanmış kadro listesi bu takım için henüz yok.",
    absences: "Sakat ve cezalı oyuncular",
    injured: "Sakat oyuncular",
    suspended: "Cezalı oyuncular",
    doubtful: "Şüpheli",
    noAbsence: "Bildirilen sakat ya da cezalı oyuncu yok.",
    absencePending: "Sakat ve cezalı listesi doğrulanmış kaynaktan alındığında burada görünür.",
    form: "Son 5 maç formu",
    formPending: "Son maç formu için doğrulanmış sonuç bekleniyor.",
    h2h: "İki takım arasındaki son maçlar",
    h2hPending: "İki takım arasında doğrulanmış geçmiş karşılaşma kaydı bulunmuyor.",
    standings: "Güncel puan durumu",
    standingsPost: "Maç sonrası puan durumu",
    standingsFull: "Puan durumunun tamamı",
    standingsUnavailable: "Bu turnuva için güncel puan durumu verisi henüz mevcut değil.",
    scorers: "Takımların golcü oyuncuları",
    scorersPending: "Doğrulanmış gol istatistiği bulunan oyuncu kaydı yok.",
    goals: "gol",
    assists: "asist",
    leaders: (league) => `${league} gol ve asist krallığı`,
    leadersGeneric: "Gol ve asist krallığı",
    leadersScorers: (league) => `${league} gol krallığı`,
    leadersAssists: (league) => `${league} asist krallığı`,
    leadersSeason: (season) => `${season}/${String(season + 1).slice(2)} sezonu`,
    leadersPending: "Bu turnuva için gol/asist liderliği verisi henüz mevcut değil.",
    leadersNote: "Tablo yalnızca bu maçın oynandığı lig ve sezonun verisinden üretilir; başka turnuvaların golleri buraya eklenmez.",
    leadersAll: "Tüm tabloyu gör",
    analysis: "FutbolRadar maç öncesi analizi",
    analysisPending: "Maç öncesi radar analizi maç haftası yaklaştığında doğrulanmış verilerle yayımlanır.",
    radarDisclaimer: "Radar puanı maç öncesi okuma içindir; kesin sonuç veya bahis önerisi değildir.",
    providerPrediction: "Sağlayıcı tahmini",
    winProb: "Kazanma olasılığı",
    draw: "Beraberlik",
    predictionWinner: "Öne çıkan sonuç",
    predictionAdvice: "Sağlayıcı önerisi",
    predictionUnderOver: "Alt/Üst",
    predictionGoals: "Beklenen gol",
    predictionExpectedGoals: "Model beklenen gol",
    predictionBothScore: "Karşılıklı gol",
    predictionOver25: "2.5 üst",
    predictionBookmakers: (count) => `${count} bahisçi oranının ortancası`,
    predictionComparison: "Sağlayıcı karşılaştırması",
    predictionSourceLabel: "Kaynak",
    predictionComparisonLabels: {
      form: "Form",
      att: "Hücum",
      def: "Savunma",
      poisson_distribution: "Poisson dağılımı",
      h2h: "İkili rekabet",
      goals: "Goller",
      total: "Toplam"
    },
    predictionDisclaimer: "Olasılıklar istatistiksel okumadır; kesin sonuç ya da bahis önerisi değildir.",
    liveScore: "Canlı skor",
    liveTitle: "Canlı maç anlatımı",
    liveEvents: "Maç olayları",
    liveStats: "Maç istatistikleri",
    liveStatsPending: "İstatistikler maç başladığında burada canlı olarak açılır: topla oynama, şut, isabetli şut, korner ve diğerleri.",
    eventsPending: "Gol, kart ve oyuncu değişiklikleri maç başladığında burada listelenir.",
    resultTitle: "Maç sonucu",
    finalScore: "Nihai skor",
    halftime: "İlk yarı",
    summary: "Maç özeti",
    report: "Ayrıntılı maç raporu",
    nextMatches: "Sonraki maçlar",
    nextMatchesPending: "Takımların sonraki maçı doğrulanmış takvime girdiğinde burada listelenir.",
    noDetail: "Bu maç için gol ve kart akışı sağlayıcıdan alınamadı; skor doğrulanmış kaynaktan gelir.",
    pendingResult: "Maçın başlama saati geçti; nihai sonuç doğrulanmış kaynaktan alındığında bu sayfa otomatik güncellenir.",
    postponedNote: "Bu karşılaşma ertelendi. Yeni tarih açıklandığında aynı sayfa güncellenir.",
    cancelledNote: "Bu karşılaşma iptal edildi.",
    teamPage: "Takım sayfası",
    teamFixtures: "Takım fikstürü",
    teamStandings: "Takım puan durumu",
    leagueStandings: "Lig puan durumu",
    todayMatches: "Bugünün maçları",
    allMatches: "Maç takvimi",
    related: "İlgili sayfalar",
    breadcrumbHome: "Ana Sayfa",
    minute: "dk",
    yellow: "Sarı kart",
    red: "Kırmızı kart",
    yellowRed: "İkinci sarıdan kırmızı",
    goal: "Gol",
    ownGoal: "Kendi kalesine",
    penalty: "Penaltı golü",
    missedPenalty: "Kaçan penaltı",
    subIn: "giriyor",
    subOut: "çıkıyor",
    varEvent: "VAR",
    lastUpdated: "Son güncelleme",
    liveNote: "Skor ve olaylar sağlayıcıdan otomatik yenilenir.",
    radarPulseTitle: "Maçın Anlık Baskı Dengesi",
    radarPulseSubtitle: "Radar Nabzı, maçın son bölümündeki hücum ve baskı verilerinden hesaplanır.",
    radarPulsePending: "Radar Nabzı maç başladığında burada açılır.",
    radarPulseStale: "Canlı istatistik verisi geçici olarak güncellenemiyor.",
    fanPollTitle: "Taraftar Anketi",
    dataSource: "Veri kaynağı",
    dataSourceNote: "Maç bilgileri doğrulanmış sağlayıcı verisinden derlenir; eksik alanlar tahminle doldurulmaz."
  },
  en: {
    matchWord: "",
    notAnnounced: "Not announced yet",
    tsi: "Türkiye time",
    home: "Home",
    away: "Away",
    date: "Date",
    time: "Kick-off",
    competition: "Competition",
    venue: "Venue",
    channel: "TV channel",
    referee: "Referee",
    status: "Status",
    round: "Matchweek",
    state: { pre: "Not started", live: "Live", post: "Full time", pending: "Result pending", postponed: "Postponed", cancelled: "Cancelled", halftime: "Half time" },
    whenTitle: (h, a) => `When is ${h} vs ${a}?`,
    whenBody: (h, a, day, competition) => `${h} vs ${a} is scheduled for ${day}${competition ? ` in the ${competition}` : ""}.`,
    whenBodyPast: (h, a, day, competition) => `${h} vs ${a} was played on ${day}${competition ? ` in the ${competition}` : ""}.`,
    timeTitle: (h, a) => `What time does ${h} vs ${a} kick off?`,
    timeBody: (h, a, hour) => `${h} vs ${a} kicks off at ${hour} Türkiye time (UTC+3).`,
    timeBodyPast: (h, a, hour) => `${h} vs ${a} kicked off at ${hour} Türkiye time (UTC+3).`,
    channelTitle: (h, a) => `Where to watch ${h} vs ${a}?`,
    channelBody: (h, a, channel) => `${h} vs ${a} is broadcast live on ${channel} in Türkiye.`,
    channelBodyPast: (h, a, channel) => `${h} vs ${a} was broadcast live on ${channel} in Türkiye.`,
    channelBodyLive: (h, a, channel) => `${h} vs ${a} is being broadcast live on ${channel} in Türkiye.`,
    channelUnknown: (h, a) => `The broadcaster for ${h} vs ${a} has not been announced yet. This section updates automatically once a verified source confirms the channel; no channel is guessed.`,
    lineups: "Probable line-ups",
    officialLineups: "Starting line-ups",
    lineupUnavailable: "Verified starting line-up data is not available for this match.",
    lineupNote: "The probable XI is a prediction built from verified squad and availability data; it updates automatically once the official line-up is announced.",
    lineupPending: "Line-ups will be published here once announced. No probable XI is written without verified squad data.",
    predictedBadge: "Probable — Not Official",
    predictedLineupNote: "These line-ups are compiled from sports media reports; this section is replaced automatically once the official starting XI is announced.",
    predictedFlags: "Doubtful / to watch",
    predictedSources: "Sources",
    bench: "Substitutes",
    benchPending: "The bench has not been published.",
    pitchLabel: "formation",
    startingEleven: "Starting XI",
    formation: "Formation",
    coach: "Head coach",
    squads: "Squads",
    squadPending: "No verified squad list is available for this team yet.",
    absences: "Injuries and suspensions",
    injured: "Injured",
    suspended: "Suspended",
    doubtful: "Doubtful",
    noAbsence: "No reported injuries or suspensions.",
    absencePending: "Injury and suspension news appears here once a verified source reports it.",
    form: "Form (last 5)",
    formPending: "Waiting for verified results to build recent form.",
    h2h: "Head-to-head",
    h2hPending: "No verified previous meeting is on record for these two teams.",
    standings: "Current standings",
    standingsPost: "Standings after the match",
    standingsFull: "Full table",
    standingsUnavailable: "Standings data for this competition is not available yet.",
    scorers: "Top scorers",
    scorersPending: "No player with verified goal statistics is on record.",
    goals: "goals",
    assists: "assists",
    leaders: (league) => `${league} top scorers & assists`,
    leadersGeneric: "Top scorers & assists",
    leadersScorers: (league) => `${league} top scorers`,
    leadersAssists: (league) => `${league} top assists`,
    leadersSeason: (season) => `${season}/${String(season + 1).slice(2)} season`,
    leadersPending: "Top scorer and assist data is not available for this competition yet.",
    leadersNote: "The table is built only from this match's own competition and season; goals scored in other tournaments are never added here.",
    leadersAll: "See the full table",
    analysis: "FutbolRadar pre-match analysis",
    analysisPending: "The pre-match radar analysis is published with verified data as matchweek approaches.",
    radarDisclaimer: "The radar score is a pre-match reading; it is not a certain outcome or betting advice.",
    providerPrediction: "Provider prediction",
    winProb: "Win probability",
    draw: "Draw",
    predictionWinner: "Most likely outcome",
    predictionAdvice: "Provider advice",
    predictionUnderOver: "Under/Over",
    predictionGoals: "Expected goals",
    predictionExpectedGoals: "Model expected goals",
    predictionBothScore: "Both teams to score",
    predictionOver25: "Over 2.5",
    predictionBookmakers: (count) => `Median of ${count} bookmaker price${count === 1 ? "" : "s"}`,
    predictionComparison: "Provider comparison",
    predictionSourceLabel: "Source",
    predictionComparisonLabels: {
      form: "Form",
      att: "Attack",
      def: "Defence",
      poisson_distribution: "Poisson distribution",
      h2h: "Head-to-head",
      goals: "Goals",
      total: "Total"
    },
    predictionDisclaimer: "These probabilities are a statistical reading, not a certain outcome or betting advice.",
    liveScore: "Live score",
    liveTitle: "Live commentary",
    liveEvents: "Match events",
    liveStats: "Match statistics",
    liveStatsPending: "Statistics open here live once the match starts: possession, shots, shots on target, corners and more.",
    eventsPending: "Goals, cards and substitutions are listed here once the match starts.",
    resultTitle: "Result",
    finalScore: "Final score",
    halftime: "Half-time",
    summary: "Match summary",
    report: "Full match report",
    nextMatches: "Next matches",
    nextMatchesPending: "The next fixtures are listed here once they enter the verified calendar.",
    noDetail: "The goal and card feed for this match was not provided; the score comes from a verified source.",
    pendingResult: "Kick-off has passed; this page updates automatically once the final result is verified.",
    postponedNote: "This match has been postponed. The same page updates when a new date is announced.",
    cancelledNote: "This match has been cancelled.",
    teamPage: "Team page",
    teamFixtures: "Team fixtures",
    teamStandings: "Team standings",
    leagueStandings: "League standings",
    todayMatches: "Today's matches",
    allMatches: "Match calendar",
    related: "Related pages",
    breadcrumbHome: "Home",
    minute: "min",
    yellow: "Yellow card",
    red: "Red card",
    yellowRed: "Second yellow",
    goal: "Goal",
    ownGoal: "Own goal",
    penalty: "Penalty goal",
    missedPenalty: "Missed penalty",
    subIn: "on",
    subOut: "off",
    varEvent: "VAR",
    lastUpdated: "Last updated",
    liveNote: "Score and events refresh automatically from the provider.",
    radarPulseTitle: "Live Pressure",
    radarPulseSubtitle: "Live Match Pulse is calculated from attacking and pressure data in the closing stage of the match.",
    radarPulsePending: "Live Match Pulse opens here once the match kicks off.",
    radarPulseStale: "Live statistics cannot be updated at the moment.",
    fanPollTitle: "Fan Poll",
    dataSource: "Data source",
    dataSourceNote: "Match information is compiled from verified provider data; missing fields are never filled with guesses."
  }
};

export function teamSlug(name) {
  return normalizeText(name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function initials(name) {
  return String(name || "").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
}

/** Küçük, sabit boyutlu arma; logo yoksa baş harfler (CLS yaratmaz). */
export function teamBadge(name, logo, options = {}) {
  const size = options.size || 40;
  if (logo) {
    return `<img class="msp-badge" src="${escapeHtml(logo)}" alt="${escapeHtml(name)} ${options.logoAlt || "logo"}" width="${size}" height="${size}" loading="${options.eager ? "eager" : "lazy"}" decoding="async" />`;
  }
  return `<span class="msp-badge msp-badge-initials" aria-hidden="true">${escapeHtml(initials(name))}</span>`;
}

function scoreValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function hasScore(score) {
  return Boolean(score) && scoreValue(score.home) !== null && scoreValue(score.away) !== null;
}

/* ------------------------------------------------------------------ */
/* OLAY NORMALİZASYONU                                                  */
/* ------------------------------------------------------------------ */

function sideOf(teamName, homeTeam, awayTeam) {
  if (!teamName) return "";
  if (sameClub(teamName, homeTeam) || normalizeText(teamName) === normalizeText(homeTeam)) return "home";
  if (sameClub(teamName, awayTeam) || normalizeText(teamName) === normalizeText(awayTeam)) return "away";
  return "";
}

/**
 * Sağlayıcı (API-Football) ve editoryal (data/matches.json) olay kayıtlarını
 * tek biçime indirir ve akışı kurar.
 *
 * Kararların tamamı `services/matchTimeline.js` içinde; bu işlev yalnızca
 * çağrı biçimini koruyan ince bir kabuk. `detail` TAM kayıt olarak
 * verilirse (skor dahil) koşan skor da hesaplanır; yalnızca
 * `{events, substitutions}` verilirse olaylar skorsuz döner.
 *
 * @param {Object} detail   Maç kaydı.
 * @param {string} homeTeam Ev sahibi künye adı.
 * @param {string} awayTeam Deplasman künye adı.
 * @param {Object} [options] {locale, finished}
 */
export function normalizeEvents(detail, homeTeam, awayTeam, options = {}) {
  if (!detail) return [];
  return matchTimeline.buildTimeline(detail, {
    homeTeam,
    awayTeam,
    locale: options.locale || "tr",
    finished: !!options.finished
  });
}

export function eventRowHtml(event, textOrLocale) {
  return matchTimeline.eventRowHtml(event, localeOf(textOrLocale));
}

export function eventsListHtml(events, textOrLocale, options = {}) {
  return matchTimeline.timelineListHtml(events, { ...options, locale: localeOf(textOrLocale) });
}

/**
 * Eski çağrılar bölüm metinleri sözlüğünü (`STR[locale]`) geçiriyordu;
 * paylaşılan çekirdek ise dil kodunu istiyor. İkisi de kabul edilir ki
 * çağrı yerleri tek tek değiştirilmek zorunda kalmasın.
 */
function localeOf(value) {
  if (typeof value === "string") return value === "en" ? "en" : "tr";
  return value && value.subIn === "on" ? "en" : "tr";
}

/* ------------------------------------------------------------------ */
/* İSTATİSTİK                                                           */
/* ------------------------------------------------------------------ */

const STAT_ORDER = ["topla oynama", "toplam sut", "isabetli sut", "isabetsiz sut", "engellenen sut", "korner", "ofsayt", "faul", "sari kart", "kirmizi kart", "toplam pas", "isabetli pas", "pas isabeti", "kurtaris", "gol beklentisi (xg)"];
const STAT_EN = {
  "topla oynama": "Possession", "toplam sut": "Total shots", "isabetli sut": "Shots on target", "isabetsiz sut": "Shots off target", "engellenen sut": "Blocked shots",
  "ceza sahasi icinden sut": "Shots inside box", "ceza sahasi disindan sut": "Shots outside box", korner: "Corners", ofsayt: "Offsides", faul: "Fouls",
  "sari kart": "Yellow cards", "kirmizi kart": "Red cards", "toplam pas": "Total passes", "isabetli pas": "Accurate passes", "pas isabeti": "Pass accuracy",
  kurtaris: "Saves", "gol beklentisi (xg)": "Expected goals (xG)", "onlenen gol": "Goals prevented"
};

export function normalizeStatistics(statistics) {
  const rows = (Array.isArray(statistics) ? statistics : [])
    .filter((row) => row && row.type && (row.home !== undefined || row.away !== undefined) && (row.home !== null || row.away !== null))
    // Mock sağlayıcının "Momentum"/"Goal potential" yedek satırları maç
    // istatistiği değildir; yalnızca iki taraflı satırlar kalır.
    .filter((row) => row.home !== undefined && row.away !== undefined);
  return rows
    .map((row) => ({ key: normalizeText(row.type), type: row.type, home: row.home, away: row.away, unit: row.unit === "%" || /topla oynama|pas isabeti/.test(normalizeText(row.type)) ? "%" : "" }))
    .sort((left, right) => {
      const li = STAT_ORDER.indexOf(left.key); const ri = STAT_ORDER.indexOf(right.key);
      return (li === -1 ? 99 : li) - (ri === -1 ? 99 : ri);
    });
}

export function statsTableHtml(statistics, locale, homeTeam, awayTeam) {
  const rows = normalizeStatistics(statistics);
  if (!rows.length) return "";
  return `<div class="msp-stats" role="table" aria-label="${escapeHtml(STR[locale].liveStats)}"><div class="msp-stats-head" role="row"><span>${escapeHtml(homeTeam)}</span><span></span><span>${escapeHtml(awayTeam)}</span></div>${rows.map((row) => {
    const label = locale === "en" ? (STAT_EN[row.key] || row.type) : row.type;
    const home = scoreValue(row.home); const away = scoreValue(row.away);
    const total = (home || 0) + (away || 0);
    const homePct = total > 0 ? Math.round(((home || 0) / total) * 100) : 50;
    return `<div class="msp-stat-row" role="row"><b>${escapeHtml(row.home ?? "-")}${row.unit}</b><span class="msp-stat-label"><i class="msp-stat-bar" style="--home:${homePct}%"><b></b></i><span>${escapeHtml(label)}</span></span><b>${escapeHtml(row.away ?? "-")}${row.unit}</b></div>`;
  }).join("")}</div>`;
}

/* ------------------------------------------------------------------ */
/* KADRO / İLK 11                                                       */
/* ------------------------------------------------------------------ */

export function playerLinkHtml(name, playerIndex, base, locale) {
  const record = playerIndex ? playerIndex.find(name) : null;
  if (!record) return escapeHtml(name);
  const href = playerPageHref(base, locale, record.id);
  return href
    ? `<a href="${escapeHtml(href)}">${escapeHtml(name)}</a>`
    : escapeHtml(name);
}

/**
 * MUHTEMEL 11 SAHA ÇİZİMİ (editoryal, kaynak gösterilmiş) — app.js'teki
 * predictedLineupPitchHtml ile AYNI kural: `rows[0]` kaleci, sonraki hatlar
 * hücuma doğru ilerliyor; her hattın İÇİ takımın kendi bakışına göre
 * SAĞDAN SOLA verilmiş. Ekranda hat sırası ve her hattın içi TERS ÇEVRİLİR
 * ki forvet üstte/kaleci altta dursun ve sağ/sol takımın kendi görüşüyle
 * eşleşsin — iki takım da bağımsız kendi kutusunda "yukarı hücum ediyormuş
 * gibi" çizildiği için bu tek kural her iki tarafta da aynı şekilde uygulanır.
 */
function predictedPitchHtml(side) {
  const rows = Array.isArray(side && side.rows) ? side.rows : [];
  const flags = Array.isArray(side && side.flags) ? side.flags : [];
  const displayRows = rows.slice().reverse();

  const rowsHtml = displayRows.map((row) => {
    const screenOrder = (row || []).slice().reverse();
    const players = screenOrder.map((name) => {
      const flagged = flags.includes(name);
      return `<span class="match-special__pitch-player predicted-lineup-player${flagged ? " is-flagged" : ""}">${escapeHtml(name)}${flagged ? '<i class="predicted-lineup-flag-mark" aria-hidden="true">!</i>' : ""}</span>`;
    }).join("");
    return `<div class="match-special__pitch-row is-${Math.max(1, Math.min(4, screenOrder.length))}">${players}</div>`;
  }).join("");

  return `<div class="match-special__pitch predicted-lineup-pitch" role="group" aria-label="${escapeHtml(`${(side && side.name) || ""} ${(side && side.formation) || ""}`)}">${rowsHtml}</div>`;
}

function predictedFlagsHtml(side, text) {
  const flags = Array.isArray(side && side.flags) ? side.flags : [];
  if (!flags.length) return "";
  return `<div class="predicted-lineup-flags"><span class="card-kicker">${escapeHtml(text.predictedFlags)}</span><ul class="lineup-missing-list">${flags.map((name) => `<li><span>${escapeHtml(name)}</span></li>`).join("")}</ul></div>`;
}

function predictedSideHtml(teamName, side, badge, text) {
  if (!side || !Array.isArray(side.rows) || !side.rows.length) return "";
  return `<article class="card predicted-lineup-side"><header class="msp-lineup-head"><h3>${escapeHtml(teamName)}${side.formation ? ` · ${escapeHtml(side.formation)}` : ""}</h3>${badge}</header>${predictedPitchHtml(side)}${side.note ? `<p class="predicted-lineup-note">${escapeHtml(side.note)}</p>` : ""}${predictedFlagsHtml(side, text)}</article>`;
}

/**
 * Kaynak gösterilmiş editoryal Muhtemel 11 (data/predicted-lineups.json).
 * Resmî kadro (yukarıdaki `official` dalı) ve site içi istatistik modeli
 * (`analysis.probableLineups`) HER ZAMAN önceliklidir — bu katman yalnızca
 * ikisi de yokken denenir. `null` dönmek "bu maç için editoryal kaynak yok"
 * demektir; çağıran istatistik-modeli boş dönmüş gibi devam eder.
 */
function predictedLineupSectionHtml(ctx, text) {
  const predicted = ctx.predictedLineup;
  if (!predicted) return null;

  const badge = `<span class="msp-tag is-probable">${escapeHtml(text.predictedBadge)}</span>`;
  const homeHtml = predictedSideHtml(ctx.homeTeam, predicted.home, badge, text);
  const awayHtml = predictedSideHtml(ctx.awayTeam, predicted.away, badge, text);
  if (!homeHtml && !awayHtml) return null;

  const sourceKeys = [...new Set([
    ...((predicted.home && predicted.home.sourceKeys) || []),
    ...((predicted.away && predicted.away.sourceKeys) || [])
  ])];
  const sourcesMap = ctx.predictedLineupSources || {};
  const sourceWord = ctx.locale === "en" ? "Source" : "Kaynak";
  const links = sourceKeys.map((key, index) => {
    const url = sourcesMap[key];
    return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="nofollow noopener noreferrer">${escapeHtml(sourceWord)} ${index + 1}</a>` : "";
  }).filter(Boolean).join(" ");
  const asOf = ctx.predictedLineupAsOf ? `${shortDate(ctx.predictedLineupAsOf, ctx.locale)} ${clock(ctx.predictedLineupAsOf)}` : "";
  const footer = links
    ? `<p class="predicted-lineup-sources"><span>${escapeHtml(text.predictedSources)}:</span> ${links}${asOf ? ` · ${escapeHtml(text.lastUpdated)}: ${escapeHtml(asOf)}` : ""}</p>`
    : "";

  return `<section class="msp-section" id="muhtemel-11" data-msp-lineups aria-labelledby="msp-lineups-title"><h2 id="msp-lineups-title" class="msp-section-title">${escapeHtml(text.lineups)}</h2><div class="msp-two-col">${homeHtml || `<article class="card data-empty"><strong>${escapeHtml(text.lineupPending)}</strong></article>`}${awayHtml || `<article class="card data-empty"><strong>${escapeHtml(text.lineupPending)}</strong></article>`}</div><p class="muted-copy">${escapeHtml(text.predictedLineupNote)}</p>${footer}</section>`;
}

/**
 * İsim listesini ve ayrıntı listesini tek modele katlar.
 *
 * Sağlayıcı `players`/`substitutes` alanlarını geriye dönük uyumluluk için
 * düz isim listesi olarak tutuyor; forma numarası, mevki ve saha koordinatı
 * `startingDetails`/`substituteDetails` içinde geliyor (bkz.
 * services/providers/apiFootballProvider.js#normalizeFixtureLineups).
 * Ayrıntı yoksa oyuncu yine listelenir, numarası boş kalır — numara
 * UYDURULMAZ. `services/matchHub.js#mergePlayers` ile aynı kural.
 */
function mergeLineupPlayers(names, details) {
  const list = Array.isArray(details) && details.length
    ? details.map((entry) => ({
      name: (entry && entry.name) || "",
      number: entry && entry.number !== undefined && entry.number !== null ? Number(entry.number) : null,
      position: (entry && entry.position) || null,
      grid: (entry && entry.grid) || null
    }))
    : (Array.isArray(names) ? names : []).map((entry) => ({
      name: typeof entry === "string" ? entry : (entry && entry.name) || "",
      number: entry && entry.number !== undefined && entry.number !== null ? Number(entry.number) : null,
      position: (entry && entry.position) || null,
      grid: (entry && entry.grid) || null
    }));
  return list.filter((entry) => entry.name);
}

/** Forma numarası + oyuncu sayfası bağlantısı taşıyan tek satır/çip gövdesi. */
function lineupPlayerHtml(player, ctx) {
  const { base, playerIndex, locale } = ctx;
  const number = player.number !== null && Number.isFinite(player.number)
    ? `<i class="msp-lineup-no">${escapeHtml(player.number)}</i>`
    : "";
  const position = player.position
    ? `<em class="msp-lineup-pos">${escapeHtml(player.position)}</em>`
    : "";
  return `${number}<b class="msp-lineup-name">${playerLinkHtml(player.name, playerIndex, base, locale)}</b>${position}`;
}

/**
 * SAHA GÖRSELİ.
 *
 * Satırlar `services/matchHub.js#formationRows` tarafından üretiliyor:
 * `rows[0]` KALECİ, sonraki hatlar hücuma doğru ilerliyor. Ekranda sıra
 * TERS ÇEVRİLİR ki kaleci altta, forvet üstte dursun —
 * `match-hub.js#pitchHtml` ile birebir aynı dönüşüm.
 *
 * Hat İÇİNDEKİ sıra sağlayıcının `grid` sütununu izler; sağ/sol bek iddiası
 * bu görselin taşıdığı bir bilgi DEĞİLDİR. Bölümün söylediği tek şey
 * hatların kaç kişilik olduğu, yani dizilişin kendisidir.
 *
 * Satır yoksa boş dize döner: koordinatı da geçerli dizilişi de olmayan bir
 * kadroyu sahaya yerleştirmek, okuyucuya doğrulanmamış bir taktik iddiası
 * sunmak olurdu. Çağıran o durumda yalnızca listeyi basar.
 */
function lineupPitchHtml(rows, teamName, formation, ctx) {
  if (!Array.isArray(rows) || !rows.length) return "";
  const text = STR[ctx.locale];
  const label = `${teamName}${formation ? ` ${formation}` : ""} ${text.pitchLabel}`;
  const display = rows.slice().reverse();
  return `<div class="msp-pitch match-special__pitch" role="img" aria-label="${escapeHtml(label)}">${display.map((line) => {
    const count = Math.max(1, Math.min(5, line.length));
    return `<div class="msp-pitch-row match-special__pitch-row is-${count}">${line.map((player) => (
      `<span class="msp-pitch-player match-special__pitch-player">${lineupPlayerHtml(player, ctx)}</span>`
    )).join("")}</div>`;
  }).join("")}</div>`;
}

/**
 * Bir takımın kadro kutusu: künye, saha görseli, ilk 11 listesi, yedekler.
 *
 * Saha ve liste BİRLİKTE basılıyor — `match-hub.js#lineupsHtml` ile aynı
 * düzen. Saha dizilişi gösterir, liste numarayı, mevkiyi ve oyuncu sayfası
 * bağlantısını taşır; ikisi farklı soruları yanıtlıyor.
 */
function lineupSideHtml(teamName, lineup, badge, coach, ctx) {
  const text = STR[ctx.locale];
  const starters = mergeLineupPlayers(lineup.players, lineup.startingDetails);
  const bench = mergeLineupPlayers(lineup.bench || lineup.substitutes, lineup.substituteDetails);
  const rows = matchHub.formationRows(starters, lineup.formation);

  const meta = lineup.formation || coach
    ? `<p class="msp-lineup-meta">${lineup.formation ? `<span>${escapeHtml(text.formation)}:</span> <b>${escapeHtml(lineup.formation)}</b>` : ""}${lineup.formation && coach ? " · " : ""}${coach ? `<span>${escapeHtml(text.coach)}:</span> <b>${escapeHtml(coach)}</b>` : ""}</p>`
    : "";

  const benchHtml = bench.length
    ? `<div class="msp-lineup-bench"><h4>${escapeHtml(text.bench)}</h4><ul class="msp-lineup-bench-list">${bench.map((player) => `<li>${lineupPlayerHtml(player, ctx)}</li>`).join("")}</ul></div>`
    : `<div class="msp-lineup-bench"><h4>${escapeHtml(text.bench)}</h4><p class="muted-copy">${escapeHtml(text.benchPending)}</p></div>`;

  return `<article class="card msp-lineup">` +
    `<header class="msp-lineup-head"><h3>${escapeHtml(teamName)}</h3>${badge}</header>` +
    meta +
    lineupPitchHtml(rows, teamName, lineup.formation, ctx) +
    `<h4 class="msp-lineup-subtitle">${escapeHtml(text.startingEleven)}</h4>` +
    `<ol class="msp-lineup-list">${starters.map((player) => `<li>${lineupPlayerHtml(player, ctx)}</li>`).join("")}</ol>` +
    benchHtml +
    `</article>`;
}

export function lineupsSectionHtml(detail, analysis, ctx) {
  const { locale, homeTeam, awayTeam } = ctx;
  const text = STR[locale];
  const official = (Array.isArray(detail && detail.lineups) ? detail.lineups : []).filter((row) => row && Array.isArray(row.players) && row.players.length >= 7);
  const coaches = detail && detail.coaches && typeof detail.coaches === "object" ? detail.coaches : null;

  if (official.length) {
    const home = official.find((row) => sideOf(row.team, homeTeam, awayTeam) === "home") || official[0];
    const away = official.find((row) => sideOf(row.team, homeTeam, awayTeam) === "away") || official[1];
    if (home && away && home !== away) {
      const badge = `<span class="msp-tag is-official">${escapeHtml(text.officialLineups)}</span>`;
      return `<section class="msp-section" id="kadrolar" data-msp-lineups aria-labelledby="msp-lineups-title"><h2 id="msp-lineups-title" class="msp-section-title"><span id="muhtemel-11">${escapeHtml(text.officialLineups)}</span></h2><div class="msp-two-col">${lineupSideHtml(homeTeam, home, badge, coaches && coaches.home, ctx)}${lineupSideHtml(awayTeam, away, badge, coaches && coaches.away, ctx)}</div></section>`;
    }
  }

  // Maç başladıktan sonra "muhtemel" 11 anlamsızdır: bitmiş ya da sonucu
  // bekleyen maçta yalnızca resmî kadro basılır, tahmin gösterilmez.
  // Keep previously published lineup deep links useful after kickoff, even
  // when the provider has not supplied official lineups. Never retain a prediction.
  if (ctx.state === "post" || ctx.state === "pending") {
    return `<section class="msp-section" id="muhtemel-11" data-msp-lineups aria-labelledby="msp-lineups-title"><h2 id="msp-lineups-title" class="msp-section-title">${escapeHtml(text.officialLineups)}</h2><p class="muted-copy">${escapeHtml(text.lineupUnavailable)}</p></section>`;
  }
  const probable = analysis && analysis.probableLineups;
  const probableSide = (side) => {
    const lineup = probable && probable[side];
    if (!lineup || lineup.predictionStatus !== "available" || !Array.isArray(lineup.starters) || !lineup.starters.length) return null;
    return { formation: lineup.formation || "", players: lineup.starters.map((starter) => (typeof starter === "string" ? starter : starter && starter.name) || "").filter(Boolean), substitutes: [] };
  };
  const probableHome = probableSide("home");
  const probableAway = probableSide("away");
  if (probableHome || probableAway) {
    const badge = `<span class="msp-tag is-probable">${escapeHtml(text.lineups)}</span>`;
    const empty = `<article class="card data-empty"><strong>${escapeHtml(text.lineupPending)}</strong></article>`;
    return `<section class="msp-section" id="muhtemel-11" data-msp-lineups aria-labelledby="msp-lineups-title"><h2 id="msp-lineups-title" class="msp-section-title">${escapeHtml(text.lineups)}</h2><div class="msp-two-col">${probableHome ? lineupSideHtml(homeTeam, probableHome, badge, null, ctx) : empty}${probableAway ? lineupSideHtml(awayTeam, probableAway, badge, null, ctx) : empty}</div><p class="muted-copy">${escapeHtml(text.lineupNote)}</p></section>`;
  }

  // Site içi istatistik modelinin (yukarıdaki `probable`) verisi yoksa,
  // kaynak gösterilmiş editoryal Muhtemel 11'e (data/predicted-lineups.json)
  // bakılır — ikisi de yoksa çağıran zaten "post"/"pending" durumunda
  // yukarıda dönmüştü, buraya yalnızca "pre" gelir.
  const predictedSection = predictedLineupSectionHtml(ctx, text);
  if (predictedSection) return predictedSection;

  return `<section class="msp-section" id="muhtemel-11" data-msp-lineups aria-labelledby="msp-lineups-title"><h2 id="msp-lineups-title" class="msp-section-title">${escapeHtml(text.lineups)}</h2><article class="card data-empty"><strong>${escapeHtml(text.lineupPending)}</strong></article></section>`;
}

const POSITION_ORDER = { goalkeeper: 0, kaleci: 0, defender: 1, defans: 1, midfielder: 2, "orta saha": 2, attacker: 3, forvet: 3 };
const POSITION_LABEL = {
  tr: { goalkeeper: "Kaleci", defender: "Defans", midfielder: "Orta saha", attacker: "Forvet" },
  en: { goalkeeper: "Goalkeepers", defender: "Defenders", midfielder: "Midfielders", attacker: "Forwards" }
};

export function squadsSectionHtml(squads, ctx) {
  const { locale, base, playerIndex, homeTeam, awayTeam } = ctx;
  const text = STR[locale];
  const find = (name) => (Array.isArray(squads) ? squads : []).find((squad) => squad && squad.teamName && sameClub(squad.teamName, name) && Array.isArray(squad.players) && squad.players.length);
  const home = find(homeTeam);
  const away = find(awayTeam);
  if (!home && !away) return "";

  const groupHtml = (squad, teamName) => {
    if (!squad) return `<article class="card data-empty"><strong>${escapeHtml(teamName)}</strong><span>${escapeHtml(text.squadPending)}</span></article>`;
    const groups = new Map();
    for (const player of squad.players) {
      const key = normalizeText(player.position);
      const groupKey = key.includes("goal") || key.includes("kale") ? "goalkeeper" : key.includes("def") ? "defender" : key.includes("mid") || key.includes("orta") ? "midfielder" : "attacker";
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push(player);
    }
    const ordered = [...groups.entries()].sort((left, right) => (POSITION_ORDER[left[0]] ?? 9) - (POSITION_ORDER[right[0]] ?? 9));
    return `<article class="card msp-squad"><h3>${escapeHtml(teamName)}</h3>${ordered.map(([group, players]) => `<p class="msp-squad-group"><span>${escapeHtml(POSITION_LABEL[locale][group])}:</span> ${players.map((player) => playerLinkHtml(player.name, playerIndex, base, locale)).join(", ")}</p>`).join("")}</article>`;
  };

  return `<section class="msp-section" id="kadro" aria-labelledby="msp-squads-title"><h2 id="msp-squads-title" class="msp-section-title">${escapeHtml(text.squads)}</h2><details class="msp-details"><summary>${escapeHtml(homeTeam)} · ${escapeHtml(awayTeam)}</summary><div class="msp-two-col">${groupHtml(home, homeTeam)}${groupHtml(away, awayTeam)}</div></details></section>`;
}

export function absencesSectionHtml(squadStatus, ctx) {
  const { locale, homeTeam, awayTeam } = ctx;
  const text = STR[locale];
  const rows = squadStatus && Array.isArray(squadStatus.teams) ? squadStatus.teams : [];
  const find = (name) => rows.find((row) => row && sameClub(row.team || row.name, name));
  const home = find(homeTeam);
  const away = find(awayTeam);
  if (!home && !away) return "";

  const statusLabel = (status) => {
    const key = normalizeText(status);
    if (key === "suspended") return text.suspended;
    if (key === "doubtful") return text.doubtful;
    return text.injured;
  };
  const listHtml = (row, teamName) => {
    if (!row) return `<article class="card data-empty"><strong>${escapeHtml(teamName)}</strong><span>${escapeHtml(text.absencePending)}</span></article>`;
    const absences = Array.isArray(row.absences) ? row.absences : [];
    const seen = new Set();
    const unique = absences.filter((item) => { const key = normalizeText(item.playerName); if (!key || seen.has(key)) return false; seen.add(key); return true; });
    return `<article class="card msp-absences"><h3>${escapeHtml(teamName)}</h3>${unique.length ? `<ul>${unique.map((item) => `<li><b>${escapeHtml(item.playerName)}</b> <span class="msp-tag is-${escapeHtml(normalizeText(item.status) || "injured")}">${escapeHtml(statusLabel(item.status))}</span>${item.reason && normalizeText(item.reason) !== "injury" ? ` <small>${escapeHtml(item.reason)}</small>` : ""}</li>`).join("")}</ul>` : `<p class="muted-copy">${escapeHtml(text.noAbsence)}</p>`}</article>`;
  };
  return `<section class="msp-section" id="sakat-cezali" aria-labelledby="msp-absences-title"><h2 id="msp-absences-title" class="msp-section-title">${escapeHtml(text.absences)}</h2><div class="msp-two-col">${listHtml(home, homeTeam)}${listHtml(away, awayTeam)}</div></section>`;
}

/* ------------------------------------------------------------------ */
/* FORM / H2H / PUAN DURUMU / GOLCÜLER                                  */
/* ------------------------------------------------------------------ */

export function formSectionHtml(forms, ctx) {
  const { locale, homeTeam, awayTeam, pageHrefFor } = ctx;
  const text = STR[locale];
  const home = forms.home || [];
  const away = forms.away || [];
  if (!home.length && !away.length) return "";
  const dots = (rows) => `<div class="form-dots msp-form-dots">${rows.map((row) => `<span class="${row.result === "W" ? "win" : row.result === "L" ? "loss" : "draw"}" title="${escapeHtml(row.label)}">${row.result === "W" ? (locale === "en" ? "W" : "G") : row.result === "L" ? (locale === "en" ? "L" : "M") : "B"}</span>`).join("")}</div>`;
  const list = (rows, teamName) => {
    if (!rows.length) return `<article class="card data-empty"><strong>${escapeHtml(teamName)}</strong><span>${escapeHtml(text.formPending)}</span></article>`;
    return `<article class="card msp-form"><h3>${escapeHtml(teamName)}</h3>${dots(rows)}<ul class="msp-form-list">${rows.map((row) => {
      const href = pageHrefFor ? pageHrefFor(row.match) : null;
      const line = `${escapeHtml(row.match.homeTeam)} ${escapeHtml(row.match.score.home)}-${escapeHtml(row.match.score.away)} ${escapeHtml(row.match.awayTeam)}`;
      return `<li><time datetime="${escapeHtml(row.match.kickoff)}">${escapeHtml(shortDate(row.match.kickoff, locale))}</time> ${href ? `<a href="${escapeHtml(href)}">${line}</a>` : line}${row.match.league ? ` <small>${escapeHtml(competitionLabel(row.match.league, locale))}</small>` : ""}</li>`;
    }).join("")}</ul></article>`;
  };
  return `<section class="msp-section" id="form" aria-labelledby="msp-form-title"><h2 id="msp-form-title" class="msp-section-title">${escapeHtml(text.form)}</h2><div class="msp-two-col">${list(home, homeTeam)}${list(away, awayTeam)}</div></section>`;
}

export function h2hSectionHtml(entries, ctx) {
  const { locale, homeTeam, awayTeam, pageHrefFor } = ctx;
  const text = STR[locale];
  if (!entries.length) return "";
  let homeWins = 0; let awayWins = 0; let draws = 0;
  for (const entry of entries) {
    const homeIsPageHome = sameClub(entry.homeTeam, homeTeam);
    const pageHomeGoals = homeIsPageHome ? entry.homeGoals : entry.awayGoals;
    const pageAwayGoals = homeIsPageHome ? entry.awayGoals : entry.homeGoals;
    if (pageHomeGoals > pageAwayGoals) homeWins += 1; else if (pageHomeGoals < pageAwayGoals) awayWins += 1; else draws += 1;
  }
  return `<section class="msp-section" id="son-maclar" aria-labelledby="msp-h2h-title"><h2 id="msp-h2h-title" class="msp-section-title">${escapeHtml(text.h2h)}</h2><div class="card msp-h2h"><p class="msp-h2h-summary"><span><b>${homeWins}</b> ${escapeHtml(homeTeam)}</span><span><b>${draws}</b> ${escapeHtml(text.draw)}</span><span><b>${awayWins}</b> ${escapeHtml(awayTeam)}</span></p><ul class="msp-h2h-list">${entries.map((entry) => {
    const href = pageHrefFor ? pageHrefFor({ homeTeam: entry.homeTeam, awayTeam: entry.awayTeam, kickoff: entry.date }) : null;
    const line = `${escapeHtml(entry.homeTeam)} <b>${escapeHtml(entry.homeGoals)}-${escapeHtml(entry.awayGoals)}</b> ${escapeHtml(entry.awayTeam)}`;
    return `<li>${entry.date ? `<time datetime="${escapeHtml(String(entry.date).slice(0, 10))}">${escapeHtml(shortDate(entry.date, locale))}</time> ` : ""}${href ? `<a href="${escapeHtml(href)}">${line}</a>` : line}${entry.competition ? ` <small>${escapeHtml(competitionLabel(entry.competition, locale))}</small>` : ""}</li>`;
  }).join("")}</ul></div></section>`;
}

/**
 * PUAN DURUMU BÖLÜMÜ — TABLO MAÇIN KENDİ LİGİNE AİTTİR, BAŞKA HİÇBİR ŞEYE.
 *
 * `resolved` doğrudan services/standingsResolver.js çıktısıdır: hangi
 * yarışmanın, hangi sezonun tablosu olduğu orada karara bağlanmıştır. Burada
 * yeniden lig tahmini YAPILMAZ ve yedek tablo seçilmez — veri yoksa bölüm
 * dürüst bir not basar. Bölüm, ligi makine tarafından da doğrulanabilsin
 * diye `data-standings-league` / `data-standings-season` taşır; böylece
 * "başlık doğru, tablo yanlış" durumu testle yakalanabilir.
 */
export function standingsSectionHtml(resolved, ctx, options = {}) {
  const { locale, homeTeam, awayTeam } = ctx;
  const text = STR[locale];
  const standings = resolved || {};
  const table = Array.isArray(standings.table) ? standings.table : [];
  const title = options.post ? text.standingsPost : text.standings;
  // Yarışma DOĞRULANAMADIYSA başlıkta lig adı yazılmaz: kaydın ham `league`
  // metni ("Bundesliga" — Almanya mı Avusturya mı?) tam da güvenilmediği
  // için kimlik çözülememiştir; onu başlığa basmak doğrulanmamış iddiayı
  // doğrulanmış gibi göstermek olurdu.
  const competitionName = standings.competitionId ? (standings.league || standings.competitionName || "") : "";
  const heading = `${escapeHtml(title)}${competitionName ? ` · ${escapeHtml(competitionLabel(competitionName, locale))}` : ""}`;
  const attrs = `data-standings-league="${escapeHtml(standings.competitionId || "")}" data-standings-season="${escapeHtml(standings.season || "")}"`;
  const unavailable = (reason) => `<section class="msp-section" id="puan-durumu" aria-labelledby="msp-standings-title" ${attrs} data-standings-state="unavailable" data-standings-reason="${escapeHtml(reason || "")}"><h2 id="msp-standings-title" class="msp-section-title">${heading}</h2><p class="muted-copy">${escapeHtml(text.standingsUnavailable)}</p></section>`;

  if (standings.status !== "ok" || !table.length) return unavailable(standings.reason || "no-data");

  const isSide = (row) => sameClub(row.team || row.name, homeTeam) || sameClub(row.team || row.name, awayTeam);
  const indexes = table.map((row, index) => (isSide(row) ? index : -1)).filter((index) => index >= 0);
  // İki takımdan hiçbiri tabloda yoksa gösterilecek doğru bir kesit yok.
  // Eskiden bölüm sessizce kayboluyordu; artık nedeni yazılı kalıyor.
  if (!indexes.length) return unavailable("teams-not-in-table");
  // Kompakt görünüm: iki takımın etrafı + lider. Tam tablo bağlantıyla.
  const keep = new Set();
  for (const index of indexes) for (let offset = -2; offset <= 2; offset += 1) if (table[index + offset]) keep.add(index + offset);
  keep.add(0);
  const rows = [...keep].sort((left, right) => left - right).map((index) => table[index]);
  const head = locale === "en" ? ["#", "Team", "P", "W", "D", "L", "GD", "Pts"] : ["#", "Takım", "O", "G", "B", "M", "Av", "P"];
  return `<section class="msp-section" id="puan-durumu" aria-labelledby="msp-standings-title" ${attrs} data-standings-state="ok"><h2 id="msp-standings-title" class="msp-section-title">${heading}</h2><div class="table-scroll"><table class="standings-table msp-standings"><thead><tr>${head.map((cell) => `<th scope="col">${escapeHtml(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row, position) => {
    const prev = rows[position - 1];
    const gap = prev && Number(row.rank) - Number(prev.rank) > 1 ? `<tr class="msp-standings-gap" aria-hidden="true"><td colspan="8">…</td></tr>` : "";
    return `${gap}<tr${isSide(row) ? ' class="is-highlight"' : ""}><td>${escapeHtml(row.rank ?? "")}</td><td>${escapeHtml(row.team || row.name)}</td><td>${escapeHtml(row.played ?? "")}</td><td>${escapeHtml(row.won ?? "")}</td><td>${escapeHtml(row.drawn ?? "")}</td><td>${escapeHtml(row.lost ?? "")}</td><td>${escapeHtml(row.goalDifference ?? "")}</td><td><strong>${escapeHtml(row.points ?? "")}</strong></td></tr>`;
  }).join("")}</tbody></table></div>${options.fullHref ? `<p class="msp-more"><a href="${escapeHtml(options.fullHref)}">${escapeHtml(text.standingsFull)}</a></p>` : ""}${standings.updatedAt ? `<p class="muted-copy">${escapeHtml(text.lastUpdated)}: ${escapeHtml(shortDate(standings.updatedAt, locale))}</p>` : ""}</section>`;
}

export function scorersSectionHtml(players, ctx) {
  const { locale, base, homeTeam, awayTeam } = ctx;
  const text = STR[locale];
  const pick = (teamName) => (Array.isArray(players) ? players : [])
    .filter((player) => player && sameClub(player.currentTeam || player.team, teamName) && Number(player.goals) > 0)
    .filter((player) => publicPlayerView(player).verified)
    .sort((left, right) => Number(right.goals) - Number(left.goals) || Number(right.assists || 0) - Number(left.assists || 0))
    .slice(0, 5);
  const home = pick(homeTeam);
  const away = pick(awayTeam);
  if (!home.length && !away.length) return "";
  const list = (rows, teamName) => rows.length
    ? `<article class="card msp-scorers"><h3>${escapeHtml(teamName)}</h3><ol>${rows.map((player) => `<li>${(() => { const href = playerPageHref(base, locale, player.id); return href ? `<a href="${escapeHtml(href)}">${escapeHtml(player.name)}</a>` : escapeHtml(player.name); })()}<span>${escapeHtml(player.goals)} ${escapeHtml(text.goals)}${Number(player.assists) > 0 ? ` · ${escapeHtml(player.assists)} ${escapeHtml(text.assists)}` : ""}</span></li>`).join("")}</ol></article>`
    : `<article class="card data-empty"><strong>${escapeHtml(teamName)}</strong><span>${escapeHtml(text.scorersPending)}</span></article>`;
  return `<section class="msp-section" id="golcüler" aria-labelledby="msp-scorers-title"><h2 id="msp-scorers-title" class="msp-section-title">${escapeHtml(text.scorers)}</h2><div class="msp-two-col">${list(home, homeTeam)}${list(away, awayTeam)}</div></section>`;
}

/**
 * GOL/ASİST KRALLIĞI — YALNIZCA BU MAÇIN LİGİ VE SEZONU.
 *
 * Veri `services/competitionLeaders.js` üzerinden lig+sezon anahtarıyla
 * (`topscorers:{leagueId}:{seasonId}` / `assists:{leagueId}:{seasonId}`)
 * okunur. Anahtar yoksa TABLO BASILMAZ — Süper Lig'e ya da başka bir lige
 * geri düşülmez; onun yerine dürüst bir "veri yok" satırı yazılır.
 *
 * Başlık, tablonun hangi lige ve sezona ait olduğunu HER ZAMAN yazar:
 * başlığı değiştirip veriyi olduğu gibi bırakmak bu hatanın ta kendisiydi.
 */
export function leadersSectionHtml(leaders, ctx) {
  const { locale, base } = ctx;
  const text = STR[locale];
  const data = leaders || { status: "unknown-league", topScorers: [], topAssists: [] };
  const leagueName = data.leagueName ? competitionLabel(data.leagueName, locale) : "";
  const title = leagueName ? text.leaders(leagueName) : text.leadersGeneric;
  const seasonLabel = Number.isFinite(Number(data.season)) ? text.leadersSeason(Number(data.season)) : "";
  const attributes = `${data.leagueId ? ` data-league-id="${escapeHtml(data.leagueId)}"` : ""}${data.season ? ` data-season="${escapeHtml(data.season)}"` : ""}${data.competitionId ? ` data-competition="${escapeHtml(data.competitionId)}"` : ""}`;
  const open = `<section class="msp-section msp-leaders" id="gol-asist-kralligi" aria-labelledby="msp-leaders-title"${attributes}><h2 id="msp-leaders-title" class="msp-section-title">${escapeHtml(title)}${seasonLabel ? ` · ${escapeHtml(seasonLabel)}` : ""}</h2>`;

  const rows = (list, metric, unit) => list.map((row) => {
    const href = row.slug ? playerPageHref(base, locale, row.slug) : null;
    const name = href
      ? `<a href="${escapeHtml(href)}">${escapeHtml(row.name)}</a>`
      : `<span>${escapeHtml(row.name)}</span>`;
    return `<li><span class="msp-leader-rank">${escapeHtml(row.rank)}</span><span class="msp-leader-name">${name}${row.team ? `<small>${escapeHtml(row.team)}</small>` : ""}</span><b class="msp-leader-value">${escapeHtml(Number(row[metric] || 0))} <small>${escapeHtml(unit)}</small></b></li>`;
  }).join("");

  const card = (heading, list, metric, unit, href, full) => `<article class="card msp-leaders-card"><h3>${href ? `<a href="${escapeHtml(href)}">${escapeHtml(heading)}</a>` : escapeHtml(heading)}</h3><ol class="msp-leaders-list">${rows(list, metric, unit)}</ol>${full ? `<p class="msp-more"><a href="${escapeHtml(full)}">${escapeHtml(text.leadersAll)}</a></p>` : ""}</article>`;

  const scorers = Array.isArray(data.topScorers) ? data.topScorers : [];
  const assists = Array.isArray(data.topAssists) ? data.topAssists : [];
  if (data.status !== "ok" || (!scorers.length && !assists.length)) {
    return `${open}<article class="card data-empty"><strong>${escapeHtml(text.leadersPending)}</strong></article></section>`;
  }

  const scorersHeading = leagueName ? text.leadersScorers(leagueName) : text.scorers;
  const assistsHeading = leagueName ? text.leadersAssists(leagueName) : text.assists;
  // Başlık bağlantısı: varsa ligin kendi krallık sayfası, yoksa ligin sayfası.
  // Hiçbiri yoksa başlık düz metin kalır — 404'e bağlantı verilmez.
  const scorersHref = ctx.leadersScorersHref || ctx.leagueHref || null;
  const assistsHref = ctx.leadersAssistsHref || ctx.leagueHref || null;
  const cards = [
    scorers.length ? card(scorersHeading, scorers, "goals", text.goals, scorersHref, ctx.leadersScorersHref || null) : "",
    assists.length ? card(assistsHeading, assists, "assists", text.assists, assistsHref, ctx.leadersAssistsHref || null) : ""
  ].filter(Boolean).join("");

  return `${open}<div class="msp-two-col">${cards}</div><p class="muted-copy msp-leaders-note">${escapeHtml(text.leadersNote)}</p></section>`;
}

/**
 * TAHMİN KARTI — BAŞLIK KAYNAĞI SÖYLER.
 *
 * Kart üç kaynaktan beslenebilir ve başlığı kaynağa göre değişir:
 *   provider_prediction → 📊 Sağlayıcı Tahmini
 *   market_probability  → 📊 Piyasa Olasılığı
 *   futbolradar_model   → ⚡ FutbolRadar Tahmini
 *
 * Başlık `services/fixtureProbabilityService.js`ten okunur, burada elle
 * yazılmaz: piyasa oranından türetilmiş bir yüzdenin "Sağlayıcı Tahmini"
 * diye etiketlenmesi, verinin kendisinden daha büyük bir hata olurdu.
 */
export function predictionCardHtml(probability, ctx) {
  const { locale, homeTeam, awayTeam } = ctx;
  const text = STR[locale];
  const record = normalizeProbabilityInput(probability);
  if (!record) return "";

  const display = probabilityService.displayFor(record.source, locale);
  if (!display) return "";

  const percent = (value) => (locale === "en" ? `${value}%` : `%${value}`);
  const rows = [
    { key: "home", label: homeTeam, value: record.probabilities.home },
    { key: "draw", label: text.draw, value: record.probabilities.draw },
    { key: "away", label: awayTeam, value: record.probabilities.away }
  ];
  const leading = probabilityService.leadingOutcome(record.probabilities);

  const bar = `<div class="msp-prediction-bar" role="img" aria-label="${escapeHtml(rows.map((row) => `${row.label} ${percent(row.value)}`).join(" · "))}">${
    rows.map((row) => `<span style="--w:${escapeHtml(row.value)}%">${escapeHtml(percent(row.value))}</span>`).join("")
  }</div>`;

  const rowList = `<ul class="msp-prediction-rows">${
    rows.map((row) => `<li class="msp-prediction-row${row.key === leading ? " is-leading" : ""}" data-outcome="${escapeHtml(row.key)}"><span class="msp-prediction-team">${escapeHtml(row.label)}</span><b class="msp-prediction-value">${escapeHtml(percent(row.value))}</b><i class="msp-prediction-track" aria-hidden="true"><b style="--w:${escapeHtml(row.value)}%"></b></i></li>`).join("")
  }</ul>`;

  const metaRows = predictionMetaRows(record, ctx, percent);
  const meta = metaRows.length
    ? `<dl class="msp-prediction-meta">${metaRows.map((row) => `<div><dt>${escapeHtml(row.label)}</dt><dd>${escapeHtml(row.value)}</dd></div>`).join("")}</dl>`
    : "";

  const comparison = comparisonHtml(record, ctx);

  // Modelin veri temeli sınırlıysa (tek taraflı geçmiş, ya da yalnızca
  // turnuva taban oranı) bunu kartın İÇİNDE söyle. Yüzdeyi gösterip
  // dayanağını göstermemek, okuyucunun sayıya hak etmediği bir otorite
  // atfetmesine yol açar.
  const basisNote = probabilityService.dataBasisNote(record, locale);
  const basis = basisNote
    ? `<p class="msp-prediction-basis" data-prediction-basis="${escapeHtml(record.dataBasis)}">${escapeHtml(basisNote)}</p>`
    : "";

  return `<div class="card msp-prediction" data-prediction-source="${escapeHtml(record.source)}"${record.dataBasis ? ` data-prediction-basis="${escapeHtml(record.dataBasis)}"` : ""}><h3><span class="msp-prediction-icon" aria-hidden="true">${display.icon}</span> ${escapeHtml(display.title)}</h3>${bar}${rowList}<p class="msp-prediction-note">${escapeHtml(probabilityService.displayNoteFor(record, locale) || display.note)}</p>${basis}${meta}${comparison}</div>`;
}

/**
 * Girdi ya çözülmüş kayıt ya da ham sağlayıcı yüküdür. Ham yük de
 * kabul edilir ki depo henüz yazılmamışken (ilk derleme, yeni fikstür)
 * takvimdeki mevcut `/predictions` verisi ekrandan düşmesin.
 */
function normalizeProbabilityInput(input) {
  if (!input) return null;
  if (input.probabilities && probabilityService.isDisplayable(input)) return input;
  if (input.predictions && input.predictions.percent) {
    const normalized = probabilityService.normalizeProviderPrediction(input);
    return normalized && probabilityService.isDisplayable(normalized) ? normalized : null;
  }
  return null;
}

/** Kaynağa göre ek satırlar — YALNIZCA kayıtta gerçekten varsa basılır. */
function predictionMetaRows(record, ctx, percent) {
  const { locale, homeTeam, awayTeam } = ctx;
  const text = STR[locale];
  const rows = [];
  const winner = record.predictedWinner;

  if (winner && (winner.name || winner.side)) {
    const name = winner.name || (winner.side === "home" ? homeTeam : winner.side === "away" ? awayTeam : text.draw);
    rows.push({ label: text.predictionWinner, value: winner.comment ? `${name} · ${winner.comment}` : name });
  }
  if (record.advice) rows.push({ label: text.predictionAdvice, value: record.advice });
  if (record.underOver) rows.push({ label: text.predictionUnderOver, value: record.underOver });
  if (record.predictedGoals && (record.predictedGoals.home || record.predictedGoals.away) && record.source === probabilityService.SOURCES.PROVIDER) {
    rows.push({
      label: text.predictionGoals,
      value: `${homeTeam} ${record.predictedGoals.home ?? "—"} · ${awayTeam} ${record.predictedGoals.away ?? "—"}`
    });
  }
  if (record.expectedGoals && Number.isFinite(Number(record.expectedGoals.home))) {
    rows.push({
      label: text.predictionExpectedGoals,
      value: `${homeTeam} ${record.expectedGoals.home} · ${awayTeam} ${record.expectedGoals.away}`
    });
  }
  if (record.modelUnderOver && Number.isFinite(Number(record.modelUnderOver.over))) {
    rows.push({ label: text.predictionOver25, value: percent(record.modelUnderOver.over) });
  }
  if (Number.isFinite(Number(record.bothTeamsScore))) {
    rows.push({ label: text.predictionBothScore, value: percent(record.bothTeamsScore) });
  }
  if (record.marketConsensus && Number(record.marketConsensus.bookmakerCount) > 0) {
    rows.push({
      label: text.predictionSourceLabel,
      value: text.predictionBookmakers(Number(record.marketConsensus.bookmakerCount))
    });
  }
  return rows;
}

/** Sağlayıcının kendi karşılaştırma yüzdeleri (yalnızca sağlayıcı kaydında). */
function comparisonHtml(record, ctx) {
  const { locale, homeTeam, awayTeam } = ctx;
  const text = STR[locale];
  const comparison = record.comparison;
  if (!comparison || record.source !== probabilityService.SOURCES.PROVIDER) return "";
  const entries = Object.entries(comparison).filter(([, value]) => value && (value.home !== null || value.away !== null));
  if (!entries.length) return "";
  const percent = (value) => (value === null || value === undefined ? "—" : locale === "en" ? `${Math.round(value)}%` : `%${Math.round(value)}`);
  return `<details class="msp-prediction-comparison"><summary>${escapeHtml(text.predictionComparison)}</summary><table><thead><tr><th scope="col"></th><th scope="col">${escapeHtml(homeTeam)}</th><th scope="col">${escapeHtml(awayTeam)}</th></tr></thead><tbody>${
    entries.map(([key, value]) => `<tr><th scope="row">${escapeHtml(text.predictionComparisonLabels[key] || key)}</th><td>${escapeHtml(percent(value.home))}</td><td>${escapeHtml(percent(value.away))}</td></tr>`).join("")
  }</tbody></table></details>`;
}

export function analysisSectionHtml(radar, probability, ctx) {
  const { locale, homeTeam, awayTeam } = ctx;
  const text = STR[locale];
  const hasRadar = radar && (radar.home.score !== null || radar.away.score !== null);
  const predictionCard = predictionCardHtml(probability, ctx);
  if (!hasRadar && !predictionCard) return "";

  const radarCard = (name, side) => `<article class="card msp-radar"><h3>${escapeHtml(name)}</h3><p class="msp-radar-score">${side.score === null ? escapeHtml(locale === "en" ? "Score pending" : "Veri bekleniyor") : `<b>${escapeHtml(side.score)}</b>/100`}</p>${locale === "tr" && Array.isArray(side.components) && side.components.filter((item) => item.value !== null).length ? `<ul class="msp-radar-components">${side.components.filter((item) => item.value !== null).map((item) => `<li><span>${escapeHtml(item.label)}</span><i style="--value:${escapeHtml(Math.round(item.value))}%"><b></b></i><em>${escapeHtml(Math.round(item.value))}</em></li>`).join("")}</ul>` : ""}${locale === "tr" && side.positives && side.positives.length ? `<p class="msp-radar-note"><span>Güçlü:</span> ${escapeHtml(side.positives.slice(0, 2).join(" · "))}</p>` : ""}${locale === "tr" && side.negatives && side.negatives.length ? `<p class="msp-radar-note"><span>Dikkat:</span> ${escapeHtml(side.negatives.slice(0, 2).join(" · "))}</p>` : ""}</article>`;

  return `<section class="msp-section" id="analiz" aria-labelledby="msp-analysis-title"><h2 id="msp-analysis-title" class="msp-section-title">${escapeHtml(text.analysis)}</h2>${hasRadar ? `${locale === "tr" && radar.lead ? `<p class="msp-lead">${escapeHtml(radar.lead)}</p>` : ""}<div class="msp-two-col">${radarCard(homeTeam, radar.home)}${radarCard(awayTeam, radar.away)}</div>` : ""}${predictionCard}<p class="msp-disclaimer">${escapeHtml(hasRadar ? text.radarDisclaimer : text.predictionDisclaimer)}</p></section>`;
}

/* ------------------------------------------------------------------ */
/* MAÇ ÖNCESİ SORU-CEVAP BÖLÜMLERİ                                      */
/* ------------------------------------------------------------------ */

/**
 * "Sık sorulanlar" bölümünün soru-cevapları — TEK KAYNAK.
 *
 * Hem sayfaya basılan HTML hem `FAQPage` şeması buradan üretiliyor.
 * Ayrı ayrı yazılsalardı biri değiştiğinde diğeri sessizce geride
 * kalırdı; sonucu da şema ihlali olurdu, çünkü `FAQPage` YALNIZCA
 * sayfada görünen soru-cevabı bildirebilir. Aynı diziden türemeleri
 * bu ihlali yapısal olarak imkânsız kılıyor.
 *
 * Kanal cevabına lig varsayılanı notu da ekleniyor: not sayfada okunan
 * metnin parçası, dolayısıyla şemadaki cevabın da parçası.
 */
export function faqEntries(entry, ctx) {
  const { locale, homeTeam, awayTeam, competitionName, state } = ctx;
  const text = STR[locale];
  const day = longDate(entry.kickoff, locale);
  const hour = clock(entry.kickoff);
  const past = state === "post" || state === "pending" || state === "live";
  // Kanal `services/broadcastSchedule.js` zincirinden geliyor: elle
  // doğrulama → yayıncının kendi akışının taraması → sağlayıcı alanı.
  // Lig varsayılanı BİLEREK yok; `services/broadcastRights.js` haritası
  // yalnızca hangi akışın taranacağını söylüyor ve ekrana yazılmıyor,
  // çünkü "Süper Lig beIN'de" cümlesi maç düzeyinde eksik: hangi beIN
  // kanalı olduğunu söylemiyor. Bilinmiyorsa cevap "henüz açıklanmadı".
  const channel = broadcastChannel(entry);
  const competition = competitionName ? competitionLabel(competitionName, locale) : "";
  // Oynanmış maçta "yayınlanacak" demek sayfayı da şemayı da yanlış
  // yapıyordu; zaman kipi maçın durumunu izler.
  //
  // Kanal cümlesi `past` bayrağını KULLANMAZ: o bayrak `live`i de geçmiş
  // sayıyor ve oynanmakta olan maç için "yayınlandı" çıkıyordu — maç
  // ekranda sürerken sayfa bitmiş gibi konuşuyordu. Üç kip ayrı:
  // sürüyor / oynandı / oynanacak.
  const channelBody = state === "live"
    ? text.channelBodyLive
    : past
      ? text.channelBodyPast
      : text.channelBody;
  const channelAnswer = channel
    ? channelBody(homeTeam, awayTeam, channel)
    : text.channelUnknown(homeTeam, awayTeam);

  return [
    {
      id: "ne-zaman",
      question: text.whenTitle(homeTeam, awayTeam),
      answer: past
        ? text.whenBodyPast(homeTeam, awayTeam, day, competition)
        : text.whenBody(homeTeam, awayTeam, day, competition)
    },
    {
      question: text.timeTitle(homeTeam, awayTeam),
      answer: past ? text.timeBodyPast(homeTeam, awayTeam, hour) : text.timeBody(homeTeam, awayTeam, hour)
    },
    {
      id: "hangi-kanalda",
      question: text.channelTitle(homeTeam, awayTeam),
      answer: channelAnswer
    }
  ];
}

export function whenSectionHtml(entry, ctx) {
  const text = STR[ctx.locale];
  const cards = faqEntries(entry, ctx)
    .map((item) => `<article class="card msp-qa"${item.id === "hangi-kanalda" ? ' id="hangi-kanalda"' : ""}><h2>${escapeHtml(item.question)}</h2><p>${escapeHtml(item.answer)}</p></article>`)
    .join("\n      ");
  return `<section class="msp-section msp-faq" id="ne-zaman" aria-label="${escapeHtml(text.date)}">
      ${cards}
    </section>`;
}

/* ------------------------------------------------------------------ */
/* CANLI / SONUÇ BÖLÜMLERİ                                              */
/* ------------------------------------------------------------------ */

/**
 * CANLI MAÇ ANLATIMI — dakika dakika olay akışı.
 *
 * SIRALAMA TERS KRONOLOJİK. Canlı maçta okuyucunun sorduğu soru "az önce
 * ne oldu"dur; akışı kronolojik basmak, cevabı her seferinde sayfanın en
 * altına saklamak demekti. Bitmiş maçta da aynı sıra kullanılıyor: tek bir
 * okuma biçimi var, maçın hâline göre değişen ikinci bir düzen yok.
 *
 * BÖLÜM HER HÂLDE SUNUCUDA BASILIR (boş kabuk dahil), çünkü maç başlayınca
 * `match-center.js` içini aynı işaretlemeyle doldurur — istemciye bırakılan
 * boş bir kutu değil, dolmaya hazır bir bölüm.
 *
 * Gol satırları `is-goal` sınıfıyla vurgulanır ve doğrulanabiliyorsa o
 * andaki koşan skoru taşır (bkz. services/matchTimeline.js#attachRunningScore).
 */
export function eventsSectionHtml(events, ctx) {
  const { locale, state } = ctx;
  const text = STR[locale];
  const title = state === "post" ? text.resultTitle : text.liveTitle;
  const emptyText = state === "post" ? text.noDetail : text.eventsPending;
  const body = matchTimeline.timelineBodyHtml(events, { locale, order: "desc", emptyText });
  return `<section class="msp-section msp-timeline-section" id="olaylar" data-msp-events aria-labelledby="msp-events-title">` +
    `<h2 id="msp-events-title" class="msp-section-title">${escapeHtml(title)}</h2>` +
    `<div data-msp-events-body>${body}</div>` +
    `</section>`;
}

/**
 * RADAR NABZI BÖLÜMÜNÜN KABUĞU.
 *
 * Sunucu tarafında yalnızca BAŞLIK ve BOŞ GÖVDE basılır; sayılar istemciye
 * `/api/match-detail` yanıtıyla gelir (bkz. radar-pulse.js). Sebebi basit:
 * Radar Nabzı "şu anki baskı"dır ve derleme anında üretilen bir sayı,
 * sayfanın yayına girdiği andan itibaren yanlıştır.
 *
 * Kabuk `hidden` doğar. Veri gelene kadar sayfada YER KAPLAMAZ — bu hem
 * düzen kaymasını (CLS) hem de "yükleniyor" diye duran boş bir kutuyu
 * önler. İstemci yalnızca çizecek gerçek veri bulduğunda `hidden`ı kaldırır.
 */
export function radarPulseSectionHtml(ctx) {
  const { locale } = ctx;
  const text = STR[locale];
  const anchor = locale === "en" ? "live-pulse" : "radar-nabzi";
  return `<section class="msp-section rp-section" id="${anchor}" data-radar-pulse hidden aria-labelledby="rp-title">` +
    `<h2 id="rp-title" class="msp-section-title">${escapeHtml(text.radarPulseTitle)}</h2>` +
    `<p class="rp-subtitle muted-copy">${escapeHtml(text.radarPulseSubtitle)}</p>` +
    `<div class="rp-body" data-radar-pulse-body></div>` +
    `<p class="rp-stale" data-radar-pulse-stale hidden>${escapeHtml(text.radarPulseStale)}</p>` +
    `</section>`;
}

/**
 * TARAFTAR ANKETİ KABUĞU.
 *
 * Sunucu yalnızca başlığı ve boş gövdeyi basar; sorular, sayım ve "bu
 * tarayıcı oy verdi mi" bilgisi `radar-fan.js` ile `/api/match-poll`ten
 * gelir. Sayım derleme anında basılamaz: her oyla değişir ve yayına giren
 * statik bir sayı o andan itibaren yanlıştır.
 *
 * Kabuk `hidden` doğar. Oy deposu yapılandırılmamışsa istemci bölümü hiç
 * açmaz — oy kabul edemeyen bir anketi göstermek, çalışmayan bir düğme
 * sunmaktır.
 */
/**
 * "BU MAÇI TAKİP ET" KABUĞU — maç başlığının hemen altında.
 *
 * Sunucu yalnızca boş, `hidden` bir kap basar; düğmeyi `radar-fan.js` ancak
 * push GERÇEKTEN mümkünse (VAPID anahtarı sayfada, servis çalışanı ve
 * Notification API var) çizer. Düğmeyi koşulsuz basmak, bildirim
 * gönderilemeyecek bir tarayıcıda okuyucudan izin istemek olurdu.
 *
 * Sağlayıcı maç kimliği olmayan maçta hiç basılmaz: takip aboneliği o
 * kimliğe yazılıyor (bkz. server/pushSubscriptionRoute.js#isFollowKey).
 */
export function matchFollowHtml(ctx) {
  const { locale, followFixtureId, pollSlug } = ctx;
  if (!followFixtureId) return "";
  return `<div class="fan-follow-wrap" data-match-follow hidden ` +
    `data-match-follow-id="${escapeHtml(followFixtureId)}" ` +
    `data-match-follow-slug="${escapeHtml(pollSlug || "")}" ` +
    `data-match-follow-locale="${locale}"></div>`;
}

export function matchPollSectionHtml(ctx) {
  const { locale, pollSlug } = ctx;
  const text = STR[locale];
  if (!pollSlug) return "";
  const anchor = locale === "en" ? "fan-poll" : "taraftar-anketi";
  return `<section class="msp-section fan-poll-section" id="${anchor}" data-match-poll ` +
    `data-match-poll-slug="${escapeHtml(pollSlug)}" data-match-poll-locale="${locale}" hidden ` +
    `aria-labelledby="fan-poll-title">` +
    `<h2 id="fan-poll-title" class="msp-section-title">${escapeHtml(text.fanPollTitle)}</h2>` +
    `<div class="fan-poll-body" data-match-poll-body></div>` +
    `<p class="fan-poll-error" data-fan-poll-error hidden>${escapeHtml(locale === "en" ? "Votes cannot be recorded right now." : "Oy şu anda kaydedilemiyor.")}</p>` +
    `</section>`;
}

export function statsSectionHtml(statistics, ctx) {
  const { locale, homeTeam, awayTeam, state } = ctx;
  const text = STR[locale];
  const table = statsTableHtml(statistics, locale, homeTeam, awayTeam);
  if (!table && state === "post") return "";
  return `<section class="msp-section" id="istatistik" data-msp-stats aria-labelledby="msp-stats-title"><h2 id="msp-stats-title" class="msp-section-title">${escapeHtml(text.liveStats)}</h2><div class="card msp-stats-shell" data-msp-stats-body>${table || `<p class="muted-copy" data-msp-stats-note>${escapeHtml(text.liveStatsPending)}</p>`}</div></section>`;
}

export function summarySectionHtml(summary, reportHref, ctx) {
  const { locale } = ctx;
  const text = STR[locale];
  if (!summary && !reportHref) return "";
  return `<section class="msp-section" id="ozet" aria-labelledby="msp-summary-title"><h2 id="msp-summary-title" class="msp-section-title">${escapeHtml(text.summary)}</h2>${summary ? `<div class="card msp-summary"><p>${escapeHtml(summary)}</p></div>` : ""}${reportHref ? `<p class="msp-more"><a class="detail-link" href="${escapeHtml(reportHref)}">${escapeHtml(text.report)}</a></p>` : ""}</section>`;
}

export function nextMatchesSectionHtml(nextMatches, ctx) {
  const { locale, homeTeam, awayTeam } = ctx;
  const text = STR[locale];
  const home = nextMatches.home || [];
  const away = nextMatches.away || [];
  if (!home.length && !away.length) return "";
  const list = (rows, teamName) => rows.length
    ? `<article class="card msp-next"><h3>${escapeHtml(teamName)}</h3><ul>${rows.map((row) => {
      const line = `${escapeHtml(row.match.homeTeam)} – ${escapeHtml(row.match.awayTeam)}`;
      return `<li><time datetime="${escapeHtml(row.match.kickoff)}">${escapeHtml(shortDate(row.match.kickoff, locale))} ${escapeHtml(clock(row.match.kickoff))}</time> ${row.href ? `<a href="${escapeHtml(row.href)}">${line}</a>` : line}${row.match.league ? ` <small>${escapeHtml(competitionLabel(row.match.league, locale))}</small>` : ""}</li>`;
    }).join("")}</ul></article>`
    : `<article class="card data-empty"><strong>${escapeHtml(teamName)}</strong><span>${escapeHtml(text.nextMatchesPending)}</span></article>`;
  return `<section class="msp-section" id="sonraki-maclar" aria-labelledby="msp-next-title"><h2 id="msp-next-title" class="msp-section-title">${escapeHtml(text.nextMatches)}</h2><div class="msp-two-col">${list(home, homeTeam)}${list(away, awayTeam)}</div></section>`;
}

/* ------------------------------------------------------------------ */
/* HERO / SKOR TABLOSU                                                  */
/* ------------------------------------------------------------------ */

export function stateLabel(entry, state, locale) {
  const text = STR[locale];
  if (state === "live" && canonicalStatus(entry.status || entry.providerStatus) === "HALFTIME") return text.state.halftime;
  if (state === "post") {
    const finish = finishType(entry);
    if (locale === "tr") return finish === "extra-time" ? "Uzatmalarda tamamlandı" : finish === "penalties" ? "Penaltılarla tamamlandı" : finish === "awarded" ? "Hükmen sonuçlandı" : text.state.post;
    return finish === "extra-time" ? "After extra time" : finish === "penalties" ? "Decided on penalties" : finish === "awarded" ? "Awarded" : text.state.post;
  }
  return text.state[state] || text.state.pre;
}

export function heroHtml(entry, ctx) {
  const { locale, state, homeTeam, awayTeam, homeHref, awayHref, homeLogo, awayLogo, competitionName, roundLabel } = ctx;
  const text = STR[locale];
  const scored = hasScore(entry.score) && (state === "live" || state === "post");
  const minute = state === "live" && entry.minute !== null && entry.minute !== undefined ? `${entry.minute}'` : "";
  const teamHtml = (name, href, logo, side) => `<div class="msp-team is-${side}">${teamBadge(name, logo, { size: 44, eager: true, logoAlt: locale === "en" ? "logo" : "logosu" })}${href ? `<a class="msp-team-name" href="${escapeHtml(href)}">${escapeHtml(name)}</a>` : `<span class="msp-team-name">${escapeHtml(name)}</span>`}</div>`;
  const halftime = state === "post" && entry.score && scoreValue(entry.score.halftimeHome) !== null && scoreValue(entry.score.halftimeAway) !== null
    ? `<span class="msp-ht" data-msp-halftime>${escapeHtml(text.halftime)}: ${escapeHtml(entry.score.halftimeHome)}-${escapeHtml(entry.score.halftimeAway)}</span>`
    : `<span class="msp-ht" data-msp-halftime hidden></span>`;
  const channel = broadcastChannel(entry);
  const kickoffIso = istanbulIso(entry.kickoff);

  return `<section class="msp-hero is-${escapeHtml(state)}" data-msp-hero data-msp-state="${escapeHtml(state)}" aria-label="${escapeHtml(`${homeTeam} - ${awayTeam}`)}">
        <p class="msp-kicker">${competitionName ? `<span>${escapeHtml(competitionLabel(competitionName, locale))}</span>` : ""}${roundLabel ? `<span>${escapeHtml(roundLabel)}</span>` : ""}<span class="msp-status" data-msp-status>${state === "live" ? '<i class="live-pulse" aria-hidden="true"></i>' : ""}${escapeHtml(stateLabel(entry, state, locale))}</span></p>
        <div class="msp-scoreboard">
          ${teamHtml(homeTeam, homeHref, homeLogo, "home")}
          <div class="msp-score-wrap">
            <p class="msp-score" data-msp-score>${scored ? `<b data-msp-score-home>${escapeHtml(entry.score.home)}</b><span aria-hidden="true">-</span><b data-msp-score-away>${escapeHtml(entry.score.away)}</b>` : `<b data-msp-score-home>${escapeHtml(clock(entry.kickoff) || "-")}</b>`}</p>
            <p class="msp-minute" data-msp-minute${minute ? "" : " hidden"}>${escapeHtml(minute)}</p>
            ${halftime}
          </div>
          ${teamHtml(awayTeam, awayHref, awayLogo, "away")}
        </div>
        <dl class="msp-facts">
          <div><dt>${escapeHtml(text.date)}</dt><dd><time datetime="${escapeHtml(kickoffIso || "")}">${escapeHtml(longDate(entry.kickoff, locale))}</time></dd></div>
          <div><dt>${escapeHtml(text.time)}</dt><dd>${escapeHtml(clock(entry.kickoff))} ${escapeHtml(text.tsi)}</dd></div>
          ${competitionName ? `<div><dt>${escapeHtml(text.competition)}</dt><dd>${escapeHtml(competitionLabel(competitionName, locale))}</dd></div>` : ""}
          <div><dt>${escapeHtml(text.venue)}</dt><dd>${escapeHtml(entry.venue || text.notAnnounced)}</dd></div>
          <div><dt>${escapeHtml(text.channel)}</dt><dd>${escapeHtml(channel || text.notAnnounced)}</dd></div>
          <div><dt>${escapeHtml(text.referee)}</dt><dd>${escapeHtml(entry.referee || text.notAnnounced)}</dd></div>
        </dl>
      </section>`;
}

export function relatedLinksHtml(links, locale) {
  const text = STR[locale];
  const rows = links.filter((link) => link && link.href);
  if (!rows.length) return "";
  return `<section class="msp-section msp-related" aria-label="${escapeHtml(text.related)}"><h2 class="msp-section-title">${escapeHtml(text.related)}</h2><div class="msp-related-grid">${rows.map((link) => `<a class="match-related-card" href="${escapeHtml(link.href)}"><span>${escapeHtml(link.kicker)}</span><strong>${escapeHtml(link.title)}</strong></a>`).join("")}</div></section>`;
}

export function dayOf(value) {
  return istanbulDay(value);
}
