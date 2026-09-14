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
    channelUnknown: (h, a) => `${h} - ${a} maçının yayın kanalı henüz açıklanmadı. Kanal bilgisi doğrulanmış bir kaynaktan alındığında bu bölüm otomatik güncellenir; tahmini kanal yazılmaz.`,
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
    liveScore: "Canlı skor",
    liveTitle: "Canlı maç anlatımı",
    liveEvents: "Maç olayları",
    liveStats: "Maç istatistikleri",
    liveStatsPending: "İstatistikler maç başladığında burada canlı olarak açılır: topla oynama, şut, isabetli şut, korner ve diğerleri.",
    eventsPending: "Gol, kart ve oyuncu değişiklikleri maç başladığında burada listelenir.",
    resultTitle: "Maç sonucu",
    finalScore: "Nihai skor",
    halftime: "İlk yarı",
    goalsTitle: "Gol atanlar",
    cardsTitle: "Kartlar",
    subsTitle: "Oyuncu değişiklikleri",
    varTitle: "VAR kararları",
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
    liveScore: "Live score",
    liveTitle: "Live commentary",
    liveEvents: "Match events",
    liveStats: "Match statistics",
    liveStatsPending: "Statistics open here live once the match starts: possession, shots, shots on target, corners and more.",
    eventsPending: "Goals, cards and substitutions are listed here once the match starts.",
    resultTitle: "Result",
    finalScore: "Final score",
    halftime: "Half-time",
    goalsTitle: "Goalscorers",
    cardsTitle: "Cards",
    subsTitle: "Substitutions",
    varTitle: "VAR decisions",
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

function minuteSort(time) {
  const match = String(time || "").match(/(\d+)(?:\+(\d+))?/);
  if (!match) return 9999;
  return Number(match[1]) * 10 + Math.min(Number(match[2] || 0), 9);
}

function sideOf(teamName, homeTeam, awayTeam) {
  if (!teamName) return "";
  if (sameClub(teamName, homeTeam) || normalizeText(teamName) === normalizeText(homeTeam)) return "home";
  if (sameClub(teamName, awayTeam) || normalizeText(teamName) === normalizeText(awayTeam)) return "away";
  return "";
}

/**
 * Sağlayıcı (API-Football) ve editoryal (data/matches.json) olay kayıtlarını
 * tek biçime indirir. Tanınmayan tür `other` olarak korunur, düşürülmez.
 */
export function normalizeEvents(detail, homeTeam, awayTeam) {
  if (!detail) return [];
  const out = [];
  const rawEvents = Array.isArray(detail.events) ? detail.events : [];
  for (const raw of rawEvents) {
    if (!raw) continue;
    const teamName = typeof raw.team === "string" ? raw.team : (raw.team && raw.team.name) || "";
    const type = normalizeText(raw.type);
    const detailText = String(raw.detail || "");
    const detailKey = normalizeText(detailText);
    const value = String(raw.value || "");
    const valueParts = value.split(" · ").map((part) => part.trim()).filter(Boolean);
    const player = valueParts.length && !/^(asist|assist):/i.test(valueParts[0]) && normalizeText(valueParts[0]) !== detailKey ? valueParts[0] : "";
    const assistPart = valueParts.find((part) => /^(asist|assist):/i.test(part));
    const assist = assistPart ? assistPart.replace(/^(asist|assist):\s*/i, "") : "";
    const event = { time: String(raw.time || "").replace(/'+$/, ""), sort: minuteSort(raw.time), team: teamName, side: sideOf(teamName, homeTeam, awayTeam), kind: "other", player, assist, detail: detailText };

    if (type === "goal" || type === "gol") {
      if (detailKey.includes("own")) event.kind = "own-goal";
      else if (detailKey.includes("missed")) event.kind = "missed-penalty";
      else if (detailKey.includes("penalty")) event.kind = "penalty";
      else event.kind = "goal";
      // Editoryal kayıt: oyuncu adı `detail` cümlesinde. Cümle olduğu gibi
      // taşınır; ad ayıklama tahmini yapılmaz.
      if (!player && !valueParts.length) event.player = "";
    } else if (type === "card" || type.includes("kart")) {
      if (detailKey.includes("second yellow") || detailKey.includes("ikinci sari")) event.kind = "yellow-red";
      else if (detailKey.includes("red") || detailKey.includes("kirmizi")) event.kind = "red";
      else event.kind = "yellow";
    } else if (type === "subst" || type.includes("degisik")) {
      event.kind = "sub";
      event.playerIn = player;
      event.playerOut = assist;
    } else if (type === "var") {
      event.kind = "var";
    }
    out.push(event);
  }

  for (const raw of Array.isArray(detail.substitutions) ? detail.substitutions : []) {
    if (!raw) continue;
    const teamName = typeof raw.team === "string" ? raw.team : (raw.team && raw.team.name) || "";
    out.push({ time: String(raw.time || "").replace(/'+$/, ""), sort: minuteSort(raw.time), team: teamName, side: sideOf(teamName, homeTeam, awayTeam), kind: "sub", playerIn: raw.in || "", playerOut: raw.out || "", detail: "" });
  }

  return out.sort((left, right) => left.sort - right.sort);
}

function eventLabel(event, text) {
  switch (event.kind) {
    case "goal": return text.goal;
    case "own-goal": return text.ownGoal;
    case "penalty": return text.penalty;
    case "missed-penalty": return text.missedPenalty;
    case "yellow": return text.yellow;
    case "red": return text.red;
    case "yellow-red": return text.yellowRed;
    case "sub": return "";
    case "var": return text.varEvent;
    default: return event.detail || "";
  }
}

const EVENT_ICONS = {
  goal: "⚽", "own-goal": "⚽", penalty: "⚽", "missed-penalty": "✖", yellow: "🟨", red: "🟥", "yellow-red": "🟨🟥", sub: "🔁", var: "📺", other: "•"
};

export function eventRowHtml(event, text) {
  const label = eventLabel(event, text);
  let body = "";
  if (event.kind === "sub") {
    body = `${event.playerIn ? `<b>${escapeHtml(event.playerIn)}</b> ${escapeHtml(text.subIn)}` : ""}${event.playerIn && event.playerOut ? " · " : ""}${event.playerOut ? `${escapeHtml(event.playerOut)} ${escapeHtml(text.subOut)}` : ""}`;
  } else {
    const name = event.player ? `<b>${escapeHtml(event.player)}</b>` : "";
    const assist = event.assist ? ` <span class="msp-event-assist">(${escapeHtml(text.assists === "asist" ? "Asist" : "Assist")}: ${escapeHtml(event.assist)})</span>` : "";
    const detail = !event.player && event.detail ? escapeHtml(event.detail) : (event.kind === "var" || event.kind === "other") && event.detail ? ` <span class="msp-event-assist">${escapeHtml(event.detail)}</span>` : "";
    body = `${name}${assist}${detail}`;
  }
  return `<li class="msp-event is-${escapeHtml(event.kind)} is-${escapeHtml(event.side || "neutral")}"><span class="msp-event-min">${escapeHtml(event.time ? `${event.time}'` : "-")}</span><span class="msp-event-icon" aria-hidden="true">${EVENT_ICONS[event.kind] || "•"}</span><span class="msp-event-body">${label ? `<em>${escapeHtml(label)}</em> ` : ""}${body}${event.team ? ` <small>${escapeHtml(event.team)}</small>` : ""}</span></li>`;
}

export function eventsListHtml(events, text) {
  if (!events.length) return "";
  return `<ol class="msp-events">${events.map((event) => eventRowHtml(event, text)).join("")}</ol>`;
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

export function lineupsSectionHtml(detail, analysis, ctx) {
  const { locale, base, playerIndex, homeTeam, awayTeam } = ctx;
  const text = STR[locale];
  const official = (Array.isArray(detail && detail.lineups) ? detail.lineups : []).filter((row) => row && Array.isArray(row.players) && row.players.length >= 7);
  const coaches = detail && detail.coaches && typeof detail.coaches === "object" ? detail.coaches : null;

  const sideHtml = (title, lineup, badge, coach) => `<article class="card msp-lineup"><header class="msp-lineup-head"><h3>${escapeHtml(title)}</h3>${badge}</header>${lineup.formation ? `<p class="msp-lineup-meta"><span>${escapeHtml(text.formation)}:</span> <b>${escapeHtml(lineup.formation)}</b>${coach ? ` · <span>${escapeHtml(text.coach)}:</span> <b>${escapeHtml(coach)}</b>` : ""}</p>` : coach ? `<p class="msp-lineup-meta"><span>${escapeHtml(text.coach)}:</span> <b>${escapeHtml(coach)}</b></p>` : ""}<ol class="msp-lineup-list">${lineup.players.map((player) => {
    const name = typeof player === "string" ? player : (player && player.name) || "";
    const detailRow = Array.isArray(lineup.startingDetails) ? lineup.startingDetails.find((row) => row && row.name === name) : null;
    return `<li>${detailRow && detailRow.number ? `<span class="msp-lineup-no">${escapeHtml(detailRow.number)}</span>` : ""}${playerLinkHtml(name, playerIndex, base, locale)}</li>`;
  }).join("")}</ol>${Array.isArray(lineup.substitutes) && lineup.substitutes.length ? `<p class="msp-lineup-bench"><span>${escapeHtml(text.bench)}:</span> ${lineup.substitutes.map((player) => escapeHtml(typeof player === "string" ? player : (player && player.name) || "")).filter(Boolean).join(", ")}</p>` : ""}</article>`;

  if (official.length) {
    const home = official.find((row) => sideOf(row.team, homeTeam, awayTeam) === "home") || official[0];
    const away = official.find((row) => sideOf(row.team, homeTeam, awayTeam) === "away") || official[1];
    if (home && away && home !== away) {
      const badge = `<span class="msp-tag is-official">${escapeHtml(text.officialLineups)}</span>`;
      return `<section class="msp-section" id="kadrolar" data-msp-lineups aria-labelledby="msp-lineups-title"><h2 id="msp-lineups-title" class="msp-section-title"><span id="muhtemel-11">${escapeHtml(text.officialLineups)}</span></h2><div class="msp-two-col">${sideHtml(homeTeam, home, badge, coaches && coaches.home)}${sideHtml(awayTeam, away, badge, coaches && coaches.away)}</div></section>`;
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
    return `<section class="msp-section" id="muhtemel-11" data-msp-lineups aria-labelledby="msp-lineups-title"><h2 id="msp-lineups-title" class="msp-section-title">${escapeHtml(text.lineups)}</h2><div class="msp-two-col">${probableHome ? sideHtml(homeTeam, probableHome, badge, null) : empty}${probableAway ? sideHtml(awayTeam, probableAway, badge, null) : empty}</div><p class="muted-copy">${escapeHtml(text.lineupNote)}</p></section>`;
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

export function standingsSectionHtml(standings, ctx, options = {}) {
  const { locale, homeTeam, awayTeam } = ctx;
  const text = STR[locale];
  const table = standings && Array.isArray(standings.table) ? standings.table : [];
  if (!table.length) return "";
  const isSide = (row) => sameClub(row.team || row.name, homeTeam) || sameClub(row.team || row.name, awayTeam);
  const indexes = table.map((row, index) => (isSide(row) ? index : -1)).filter((index) => index >= 0);
  if (!indexes.length) return "";
  // Kompakt görünüm: iki takımın etrafı + lider. Tam tablo bağlantıyla.
  const keep = new Set();
  for (const index of indexes) for (let offset = -2; offset <= 2; offset += 1) if (table[index + offset]) keep.add(index + offset);
  keep.add(0);
  const rows = [...keep].sort((left, right) => left - right).map((index) => table[index]);
  const head = locale === "en" ? ["#", "Team", "P", "W", "D", "L", "GD", "Pts"] : ["#", "Takım", "O", "G", "B", "M", "Av", "P"];
  const title = options.post ? text.standingsPost : text.standings;
  return `<section class="msp-section" id="puan-durumu" aria-labelledby="msp-standings-title"><h2 id="msp-standings-title" class="msp-section-title">${escapeHtml(title)}${standings.league ? ` · ${escapeHtml(competitionLabel(standings.league, locale))}` : ""}</h2><div class="table-scroll"><table class="standings-table msp-standings"><thead><tr>${head.map((cell) => `<th scope="col">${escapeHtml(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row, position) => {
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

export function analysisSectionHtml(radar, prediction, ctx) {
  const { locale, homeTeam, awayTeam } = ctx;
  const text = STR[locale];
  const hasRadar = radar && (radar.home.score !== null || radar.away.score !== null);
  const percent = prediction && prediction.predictions && prediction.predictions.percent;
  const hasPrediction = percent && percent.home && percent.draw && percent.away;
  if (!hasRadar && !hasPrediction) return "";

  const radarCard = (name, side) => `<article class="card msp-radar"><h3>${escapeHtml(name)}</h3><p class="msp-radar-score">${side.score === null ? escapeHtml(locale === "en" ? "Score pending" : "Veri bekleniyor") : `<b>${escapeHtml(side.score)}</b>/100`}</p>${locale === "tr" && Array.isArray(side.components) && side.components.filter((item) => item.value !== null).length ? `<ul class="msp-radar-components">${side.components.filter((item) => item.value !== null).map((item) => `<li><span>${escapeHtml(item.label)}</span><i style="--value:${escapeHtml(Math.round(item.value))}%"><b></b></i><em>${escapeHtml(Math.round(item.value))}</em></li>`).join("")}</ul>` : ""}${locale === "tr" && side.positives && side.positives.length ? `<p class="msp-radar-note"><span>Güçlü:</span> ${escapeHtml(side.positives.slice(0, 2).join(" · "))}</p>` : ""}${locale === "tr" && side.negatives && side.negatives.length ? `<p class="msp-radar-note"><span>Dikkat:</span> ${escapeHtml(side.negatives.slice(0, 2).join(" · "))}</p>` : ""}</article>`;

  return `<section class="msp-section" id="analiz" aria-labelledby="msp-analysis-title"><h2 id="msp-analysis-title" class="msp-section-title">${escapeHtml(text.analysis)}</h2>${hasRadar ? `${locale === "tr" && radar.lead ? `<p class="msp-lead">${escapeHtml(radar.lead)}</p>` : ""}<div class="msp-two-col">${radarCard(homeTeam, radar.home)}${radarCard(awayTeam, radar.away)}</div>` : ""}${hasPrediction ? `<div class="card msp-prediction"><h3>${escapeHtml(text.providerPrediction)}</h3><div class="msp-prediction-bar" role="img" aria-label="${escapeHtml(`${homeTeam} ${percent.home} · ${text.draw} ${percent.draw} · ${awayTeam} ${percent.away}`)}"><span style="--w:${escapeHtml(percent.home)}">${escapeHtml(percent.home)}</span><span style="--w:${escapeHtml(percent.draw)}">${escapeHtml(percent.draw)}</span><span style="--w:${escapeHtml(percent.away)}">${escapeHtml(percent.away)}</span></div><p class="msp-prediction-legend"><span>${escapeHtml(homeTeam)}</span><span>${escapeHtml(text.draw)}</span><span>${escapeHtml(awayTeam)}</span></p></div>` : ""}<p class="msp-disclaimer">${escapeHtml(text.radarDisclaimer)}</p></section>`;
}

/* ------------------------------------------------------------------ */
/* MAÇ ÖNCESİ SORU-CEVAP BÖLÜMLERİ                                      */
/* ------------------------------------------------------------------ */

export function whenSectionHtml(entry, ctx) {
  const { locale, homeTeam, awayTeam, competitionName, state } = ctx;
  const text = STR[locale];
  const day = longDate(entry.kickoff, locale);
  const hour = clock(entry.kickoff);
  const past = state === "post" || state === "pending" || state === "live";
  const channel = broadcastChannel(entry);
  const competition = competitionName ? competitionLabel(competitionName, locale) : "";
  return `<section class="msp-section msp-faq" id="ne-zaman" aria-label="${escapeHtml(text.date)}">
      <article class="card msp-qa"><h2>${escapeHtml(text.whenTitle(homeTeam, awayTeam))}</h2><p>${escapeHtml(past ? text.whenBodyPast(homeTeam, awayTeam, day, competition) : text.whenBody(homeTeam, awayTeam, day, competition))}</p></article>
      <article class="card msp-qa"><h2>${escapeHtml(text.timeTitle(homeTeam, awayTeam))}</h2><p>${escapeHtml(past ? text.timeBodyPast(homeTeam, awayTeam, hour) : text.timeBody(homeTeam, awayTeam, hour))}</p></article>
      <article class="card msp-qa" id="hangi-kanalda"><h2>${escapeHtml(text.channelTitle(homeTeam, awayTeam))}</h2><p>${escapeHtml(channel ? text.channelBody(homeTeam, awayTeam, channel) : text.channelUnknown(homeTeam, awayTeam))}</p></article>
    </section>`;
}

/* ------------------------------------------------------------------ */
/* CANLI / SONUÇ BÖLÜMLERİ                                              */
/* ------------------------------------------------------------------ */

export function eventsSectionHtml(events, ctx) {
  const { locale, state } = ctx;
  const text = STR[locale];
  const title = state === "post" ? text.resultTitle : text.liveEvents;
  if (state === "post") {
    const goals = events.filter((event) => ["goal", "own-goal", "penalty"].includes(event.kind));
    const cards = events.filter((event) => ["yellow", "red", "yellow-red"].includes(event.kind));
    const subs = events.filter((event) => event.kind === "sub");
    const vars = events.filter((event) => event.kind === "var" || event.kind === "missed-penalty");
    if (!events.length) {
      return `<section class="msp-section" id="olaylar" data-msp-events aria-labelledby="msp-events-title"><h2 id="msp-events-title" class="msp-section-title">${escapeHtml(title)}</h2><p class="muted-copy" data-msp-events-note>${escapeHtml(text.noDetail)}</p></section>`;
    }
    const block = (heading, rows) => rows.length ? `<h3 class="msp-subtitle">${escapeHtml(heading)}</h3>${eventsListHtml(rows, text)}` : "";
    return `<section class="msp-section" id="olaylar" data-msp-events aria-labelledby="msp-events-title"><h2 id="msp-events-title" class="msp-section-title">${escapeHtml(title)}</h2><div data-msp-events-body>${block(text.goalsTitle, goals)}${block(text.cardsTitle, cards)}${block(text.subsTitle, subs)}${block(text.varTitle, vars)}</div></section>`;
  }
  return `<section class="msp-section" id="olaylar" data-msp-events aria-labelledby="msp-events-title"><h2 id="msp-events-title" class="msp-section-title">${escapeHtml(title)}</h2><div data-msp-events-body>${events.length ? eventsListHtml(events, text) : `<p class="muted-copy" data-msp-events-note>${escapeHtml(text.eventsPending)}</p>`}</div></section>`;
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
