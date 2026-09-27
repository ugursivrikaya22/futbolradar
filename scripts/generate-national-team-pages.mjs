#!/usr/bin/env node
/**
 * TÜRKİYE A MİLLÎ TAKIM MERKEZİ — /milli-takim ve /en/turkey-national-team
 *
 * KALICI İKİ SAYFA, DEĞİŞEN İÇERİK. Adres bir kez açılır ve bir daha
 * değişmez; yaklaşan maç, canlı skor, son sonuçlar, grup durumu, kadro ve
 * haberler her koşuda yeniden basılır. Sayfa hiçbir maç yokken de yaşar:
 * millî takımın arama talebi maç günleriyle sınırlı değil ("Türkiye milli
 * takım maçları", "milli takım kadrosu", "Türkiye grup durumu").
 *
 * ── İKİNCİ BİR MAÇ LİSTESİ TUTULMAZ ──────────────────────────────────────
 * Maçlar, sitenin GERÇEKTEN kullandığı üç kaynaktan okunur:
 *
 *   data/match-seo-pages.json   kalıcı maç sayfası sicili — ADRESİN TEK
 *                               KAYNAĞI. Slug burada kurulmaz, okunur;
 *                               ikinci bir slug kuralı yazmak, üretici bir
 *                               adres değiştirdiğinde merkezi 404'e
 *                               bağlamak olurdu.
 *   fixture-calendar + curated  en taze durum, skor ve dakika.
 *   data/national-team.json     resmî programda açıklanmış ama BAŞLAMA
 *                               SAATİ doğrulanmamış karşılaşmalar.
 *
 * Böylece millî maç, kulüp maçlarından ayrı bir boru hattına düşmez: aynı
 * eligibility kuralından, aynı kalıcı maç sayfasından, aynı canlı veri
 * altyapısından geçer (bkz. services/matchSeoPages.js#isTurkiyeNationalMatch).
 *
 * ── OLGU UYDURULMAZ ──────────────────────────────────────────────────────
 * Saat, stat, hakem, kadro, puan durumu ve skor yalnızca veri katmanında
 * varsa yazılır. Yoksa alan "Henüz açıklanmadı" der ya da bölüm hiç
 * çizilmez. Başlama saati doğrulanmamış bir maç için UYDURMA SAAT
 * BASILMAZ — satır tarihiyle listelenir, saati "açıklanmadı" olarak
 * işaretlenir ve kalıcı maç sayfası ancak saat doğrulandığında açılır.
 *
 * ── SAĞLAYICIYA EK İSTEK YOK ─────────────────────────────────────────────
 * Bu betik derleme anında yalnızca depodaki dosyaları okur. Canlı skor,
 * sayfadaki mevcut canlı veri altyapısıyla (match-center / spotlight
 * istemcisi) tazelenir; yeni bir yoklama döngüsü ya da cron kurulmaz.
 *
 * Kullanım:
 *   node scripts/generate-national-team-pages.mjs
 *   node scripts/generate-national-team-pages.mjs --check   # CI kapısı
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { siteHeader, siteFooter } from "./lib/layout.mjs";
import { ROBOTS_INDEX } from "./lib/robots.mjs";
import { newsSlug } from "./lib/newsCards.mjs";

const require = createRequire(import.meta.url);
const root = process.cwd();
const CHECK_ONLY = process.argv.includes("--check");

const {
  DOMAIN,
  absoluteUrl,
  competitionLabel,
  hreflangOf,
  htmlLang,
  ogLocale,
  routeMeta
} = require("../services/i18n.js");
const { isTurkiyeNationalMatch, trPagePath, enPagePath } = require("../services/matchSeoPages.js");
const { canonicalStatus, istanbulDay, kickoffMs, matchState, liveVerdict } = require("../services/matchStatus.js");
const { matchListSchema } = require("../services/matchSchema.js");
const { nationLabel, venueLabel } = require("../services/displayLabels.js");
const { SOURCE_LINK_REL } = require("../services/sourceLinks.js");

const ROUTE_KEY = "nationalTeam";
const PAGES = Object.freeze([
  Object.freeze({ locale: "tr", file: "milli-takim.html", counterpart: "en/turkey-national-team.html", base: "./" }),
  Object.freeze({ locale: "en", file: "en/turkey-national-team.html", counterpart: "milli-takim.html", base: "../" })
]);

/** Kaç maç listelenir. Merkez bir arşiv değil; arşive bağlantı verir. */
const UPCOMING_LIMIT = 6;
const RECENT_LIMIT = 6;
const NEWS_LIMIT = 6;

const FINISHED_STATES = new Set(["FINISHED", "AWARDED"]);
const LIVE_STATES = new Set(["LIVE", "HALFTIME", "INTERRUPTED"]);

/* ------------------------------------------------------------------ */
/* SÖZLÜK — iki dil, tek yerde                                          */
/* ------------------------------------------------------------------ */

const STR = {
  tr: {
    breadcrumbHome: "Ana Sayfa",
    kicker: "Türkiye A Millî Futbol Takımı",
    h1: "Türkiye A Millî Takım",
    lead: "Türkiye A Millî Takımı'nın maç programı, canlı skoru, sonuçları, UEFA Uluslar Ligi grup durumu, kadrosu ve son gelişmeleri tek sayfada.",
    heroMeta: "Saatler Türkiye saatiyle (TSİ)",
    nextTitle: "Sıradaki maç",
    liveTitle: "Şu anda canlı",
    upcomingTitle: "Yaklaşan maçlar",
    recentTitle: "Son maçlar",
    standingsTitle: "UEFA Uluslar Ligi grup durumu",
    squadTitle: "Türkiye kadrosu",
    newsTitle: "Son millî takım haberleri",
    openMatch: "Maç sayfasını aç",
    openMatchPre: "Muhtemel 11, saat ve yayın bilgisi",
    openMatchLive: "Canlı skor ve maç anlatımı",
    openMatchPost: "Maç sonucu, goller ve istatistikler",
    noUpcoming: "Resmî programda açıklanmış yaklaşan bir millî maç bulunmuyor. Yeni maç programa düştüğünde bu bölüm kendiliğinden güncellenir.",
    noRecent: "Bu sezon için kayıtlı, tamamlanmış bir millî maç bulunmuyor.",
    noStandings: "UEFA Uluslar Ligi grup durumu henüz açıklanmadı. Tablo doğrulandığında bu bölümde yayımlanır.",
    noSquad: "Aylık kadro henüz açıklanmadı. TFF kadroyu duyurduğunda liste burada yayımlanır — tahmini kadro yazılmaz.",
    noNews: "Millî takımla ilgili doğrulanmış yeni bir haber bulunmuyor.",
    timePending: "Saat henüz açıklanmadı",
    pagePending: "Maç sayfası, başlama saati doğrulandığında açılır",
    venuePending: "Stadyum henüz açıklanmadı",
    tsi: "TSİ",
    home: "Ev sahibi",
    away: "Deplasman",
    vs: "-",
    stateLabel: { pre: "Başlamadı", live: "Canlı", post: "Tamamlandı", pending: "Sonuç bekleniyor", postponed: "Ertelendi", cancelled: "İptal edildi" },
    tableHead: ["#", "Takım", "O", "G", "B", "M", "A", "Y", "AV", "P"],
    squadHead: ["Oyuncu", "Mevki", "Kulüp"],
    sourcesTitle: "Kaynak",
    relatedTitle: "İlgili ekranlar",
    related: [
      { href: "bugunun-maclari.html", kicker: "Bugün", label: "Bugünün maçları" },
      { href: "canli-skor.html", kicker: "Canlı", label: "Canlı skor" },
      { href: "mac-takvimi.html", kicker: "Program", label: "Maç takvimi" },
      { href: "haberler.html", kicker: "Gündem", label: "Futbol haberleri" }
    ],
    dataNote: "Veri politikası: saat, kadro, hakem ve skor yalnızca doğrulanmış kaynaktan yazılır; eksik alan uydurulmaz."
  },
  en: {
    breadcrumbHome: "Home",
    kicker: "Türkiye men's national football team",
    h1: "Türkiye National Team",
    lead: "Fixtures, live scores, results, UEFA Nations League group table, squad and the latest news for the Türkiye men's national football team, all on one page.",
    heroMeta: "All times are Türkiye time (UTC+3)",
    nextTitle: "Next match",
    liveTitle: "Live now",
    upcomingTitle: "Upcoming matches",
    recentTitle: "Recent matches",
    standingsTitle: "UEFA Nations League group table",
    squadTitle: "Türkiye squad",
    newsTitle: "Latest national team news",
    openMatch: "Open the match page",
    openMatchPre: "Line-ups, kick-off time and TV",
    openMatchLive: "Live score and commentary",
    openMatchPost: "Result, goals and statistics",
    noUpcoming: "No upcoming national team fixture has been confirmed in the official programme. This section updates itself once a new match is scheduled.",
    noRecent: "No completed national team match is on record for this season.",
    noStandings: "The UEFA Nations League group table has not been published yet. It appears here once the table is verified.",
    noSquad: "The squad for this window has not been announced yet. The list appears here once TFF confirms it — a predicted squad is never published.",
    noNews: "There is no verified national team story to show right now.",
    timePending: "Kick-off time not announced yet",
    pagePending: "The match page opens once the kick-off time is confirmed",
    venuePending: "Venue not announced yet",
    tsi: "(UTC+3)",
    home: "Home",
    away: "Away",
    vs: "vs",
    stateLabel: { pre: "Not started", live: "Live", post: "Full time", pending: "Result pending", postponed: "Postponed", cancelled: "Cancelled" },
    tableHead: ["#", "Team", "P", "W", "D", "L", "GF", "GA", "GD", "Pts"],
    squadHead: ["Player", "Position", "Club"],
    sourcesTitle: "Source",
    relatedTitle: "Related screens",
    related: [
      { href: "en/todays-matches.html", kicker: "Today", label: "Today's matches" },
      { href: "en/live-football-scores.html", kicker: "Live", label: "Live scores" },
      { href: "en/matches.html", kicker: "Fixtures", label: "Match calendar" },
      { href: "en/news.html", kicker: "News", label: "Football news" }
    ],
    dataNote: "Data policy: kick-off time, squad, referee and score are only published from a verified source — a missing field is never invented."
  }
};

const MONTHS = {
  tr: ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
};
const WEEKDAYS = {
  tr: ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
};

/* ------------------------------------------------------------------ */
/* YARDIMCILAR                                                          */
/* ------------------------------------------------------------------ */

function escapeHtml(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function readJson(relative, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
  } catch {
    return fallback;
  }
}

/**
 * Gün etiketi, ISO damgasının KENDİ saat diliminden okunur. Yeniden
 * hesaplamak derleme makinesinin saat dilimine bağlı olurdu ve Vercel'de
 * UTC'ye kayardı (aynı tuzak scripts/lib/featuredMatchSpotlight.mjs
 * içinde de not edilmiş).
 */
function dayLabel(dayIso, locale) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dayIso || ""))) return "";
  const [year, month, date] = dayIso.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, date)).getUTCDay();
  if (locale === "en") return `${WEEKDAYS.en[weekday]}, ${date} ${MONTHS.en[month - 1]} ${year}`;
  return `${date} ${MONTHS.tr[month - 1]} ${year} ${WEEKDAYS.tr[weekday]}`;
}

/** "…T21:45:00+03:00" → "21:45". Damgada saat yoksa boş döner. */
function clockOf(kickoff) {
  const found = /T(\d{2}:\d{2})/.exec(String(kickoff || ""));
  return found ? found[1] : "";
}

function scoreOf(record) {
  const score = record && record.score;
  if (!score) return null;
  const home = score.home;
  const away = score.away;
  if (home === null || home === undefined || away === null || away === undefined) return null;
  if (!Number.isFinite(Number(home)) || !Number.isFinite(Number(away))) return null;
  return { home: Number(home), away: Number(away) };
}

/* ------------------------------------------------------------------ */
/* 1. MAÇ LİSTESİ                                                       */
/* ------------------------------------------------------------------ */

const config = readJson("data/national-team.json", {}) || {};
const registry = readJson("data/match-seo-pages.json", { pages: [] });
const registryPages = Array.isArray(registry.pages) ? registry.pages : [];

/**
 * En taze durum/skor kaynağı. Sicil kaydı adresi ve maç olgularını taşır;
 * takvim/kürasyon kaydı yalnızca durumu, skoru ve dakikayı ileri taşır —
 * `generate-featured-match-spotlight.mjs` ile AYNI desen.
 */
function freshRecords() {
  const calendar = readJson("data/fixture-calendar.json", { matches: [] });
  const fixtures = Array.isArray(calendar) ? calendar : (calendar && calendar.matches) || [];
  let curated = [];
  try {
    curated = require("../services/providers/mockProvider.js").allCuratedMatchesUnfiltered();
  } catch {
    curated = [];
  }
  return [...fixtures, ...(Array.isArray(curated) ? curated : [])];
}

function stateRank(record) {
  const state = matchState(record);
  if (FINISHED_STATES.has(state)) return 4;
  if (LIVE_STATES.has(state)) return 3;
  if (state === "POSTPONED" || state === "CANCELLED" || state === "ABANDONED") return 2;
  if (state === "SCHEDULED") return 1;
  return 0;
}

const freshByIdentity = new Map();
for (const record of freshRecords()) {
  if (!isTurkiyeNationalMatch(record)) continue;
  const day = istanbulDay(record.kickoff || record.date);
  if (!day) continue;
  const key = `${day}|${String(record.homeTeam || "")}|${String(record.awayTeam || "")}`;
  const current = freshByIdentity.get(key);
  if (!current || stateRank(record) >= stateRank(current)) freshByIdentity.set(key, record);
}

/** Sayfa hâli: pre / live / post / pending / postponed / cancelled. */
function viewStateOf(entry) {
  const status = canonicalStatus(entry.status || entry.providerStatus);
  const score = scoreOf(entry);
  if (status === "POSTPONED") return "postponed";
  if (status === "CANCELLED" || status === "ABANDONED") return "cancelled";
  if (FINISHED_STATES.has(status) && score) return "post";

  // CANLI İDDİASININ TEK KAPISI `liveVerdict` (services/matchStatus.js).
  //
  // Ham durumu okumak yetmiyor: depoda sağlayıcının canlıya çevirip bir
  // daha hiç güncellemediği kayıtlar birikiyor (25 Eylül Türkiye - France
  // kaydı iki gün boyunca "LIVE 0-0" kaldı). Bu merkez açılırken o kayıt
  // "şu anda canlı" diye basılacaktı — yanlış veri değil, yanlış İDDİA.
  // `liveVerdict` gün, başlama saati ve veri tazeliği kapılarını birlikte
  // uygular; kapıdan geçmeyen kayıt canlı sayılmaz ve aşağıda "sonuç
  // bekleniyor" olur.
  if (liveVerdict(entry).live) return "live";

  const kickoff = kickoffMs(entry);
  if (kickoff === null) return "pre";
  if (kickoff > Date.now()) return "pre";
  // Saat geçmiş ama sağlayıcı hâlâ sessiz: uydurma skor yazmak yerine
  // "sonuç bekleniyor" denir.
  return FINISHED_STATES.has(status) ? "post" : "pending";
}

/** Sicil kaydı + en taze durum. Adres HER ZAMAN sicilden gelir. */
function matchViewFrom(entry) {
  const day = istanbulDay(entry.kickoff);
  const key = `${day}|${entry.homeTeam}|${entry.awayTeam}`;
  const fresh = freshByIdentity.get(key);
  const merged = { ...entry };
  if (fresh && stateRank(fresh) >= stateRank(entry)) {
    merged.status = fresh.status || merged.status;
    merged.providerStatus = fresh.providerStatus || merged.providerStatus;
    merged.minute = fresh.minute ?? merged.minute;
    const freshScore = scoreOf(fresh);
    if (freshScore) merged.score = { ...merged.score, ...fresh.score };
  }

  return {
    kind: "page",
    day,
    kickoff: merged.kickoff,
    homeTeam: merged.homeTeam,
    awayTeam: merged.awayTeam,
    league: merged.league || "",
    stage: merged.round || null,
    venue: merged.venue || null,
    score: scoreOf(merged),
    minute: merged.minute || null,
    state: viewStateOf(merged),
    status: canonicalStatus(merged.status || merged.providerStatus),
    live: liveVerdict(merged).live,
    trPath: trPagePath(merged.slug).replace(/\.html$/, ""),
    enPath: merged.enSlug ? enPagePath(merged.enSlug).replace(/\.html$/, "") : ""
  };
}

const pageMatches = registryPages
  .filter((entry) => entry && entry.slug && entry.kickoff && isTurkiyeNationalMatch(entry))
  .map(matchViewFrom);

/**
 * SAATİ DOĞRULANMAMIŞ PROGRAM SATIRLARI.
 *
 * Resmî programda açıklanmış ama başlama saati henüz doğrulanmamış
 * karşılaşmalar. Uydurma bir saatle kalıcı sayfa açmak yerine satır
 * tarihiyle listelenir. Aynı gün için saatli bir kayıt (dolayısıyla bir
 * maç sayfası) göründüğü an bu satır kendiliğinden düşer — iki kaynak
 * aynı maçı iki kez göstermez.
 */
const pageDays = new Set(pageMatches.map((match) => match.day));
const announcedMatches = (Array.isArray(config.announcedProgram) ? config.announcedProgram : [])
  .filter((row) => row && row.date && row.homeTeam && row.awayTeam && !row.kickoff)
  .filter((row) => !pageDays.has(row.date))
  .map((row) => ({
    kind: "announced",
    day: row.date,
    kickoff: null,
    homeTeam: row.homeTeam,
    awayTeam: row.awayTeam,
    league: row.league || "",
    stage: row.stage || null,
    venue: row.venue || null,
    score: null,
    minute: null,
    state: "pre",
    status: "SCHEDULED",
    live: false,
    trPath: "",
    enPath: "",
    sourceUrl: row.sourceUrl || null
  }));

const todayIso = istanbulDay(new Date().toISOString()) || "";
const allMatches = [...pageMatches, ...announcedMatches];

const liveMatches = allMatches.filter((match) => match.state === "live");
const upcoming = allMatches
  .filter((match) => match.state !== "live" && (match.state === "pre" || match.state === "postponed") && match.day >= todayIso)
  .sort((left, right) => String(left.day).localeCompare(String(right.day)))
  .slice(0, UPCOMING_LIMIT);
const recent = allMatches
  .filter((match) => match.state === "post" || match.state === "pending")
  .sort((left, right) => String(right.day).localeCompare(String(left.day)))
  .slice(0, RECENT_LIMIT);

/* ------------------------------------------------------------------ */
/* 2. GRUP DURUMU, KADRO, HABER                                         */
/* ------------------------------------------------------------------ */

const competitionId = (config.competition && config.competition.id) || "uefa-uluslar-ligi";
const standingsStore = readJson("data/league-standings.json", {});

/**
 * Tablo önce SAĞLAYICI deposundan okunur (sync-league-standings.mjs bir
 * sonraki günlük koşuda yazar), yoksa doğrulanmış elle giriş kullanılır.
 * İkisi de yoksa bölüm "henüz açıklanmadı" der — uydurma tablo çizilmez.
 */
function standingsRows() {
  const fromStore = standingsStore && standingsStore[competitionId];
  const table = fromStore && Array.isArray(fromStore.table) ? fromStore.table : [];
  if (table.length) return table;
  const manual = config.groupStandings && Array.isArray(config.groupStandings.rows) ? config.groupStandings.rows : [];
  return manual;
}

function squadPlayers() {
  const squad = config.squad || {};
  return Array.isArray(squad.players) ? squad.players.filter((player) => player && player.name) : [];
}

/**
 * Haberler yalnızca DOĞRULANMIŞ ve sayfası gerçekten üretilmiş kayıtlardan.
 * Kural `scripts/lib/newsCards.mjs#readVerifiedTeamNews` ile aynı; burada
 * ayrı bir süzgeç yazılmasının tek sebebi başlığın millî takım odağı:
 * `team` alanı "Türkiye" olan kayıtlar.
 *
 * İNGİLİZCE SAYFADA TÜRKÇE HABER LİSTELENMEZ: `data/news.json` Türkçe
 * yüzeyin deposu, İngilizce yüzeyin karşılığı `data/news-en.json`. İki
 * dili karıştırmak "İngilizce sayfada Türkçe içerik gösterme" kuralını
 * ihlal ederdi (bkz. scripts/test-en-language-purity.mjs).
 */
function newsItems(locale) {
  const file = locale === "en" ? "data/news-en.json" : "data/news.json";
  const payload = readJson(file, []);
  const articles = Array.isArray(payload) ? payload : (payload.items || payload.news || []);
  const teamNames = new Set(["türkiye", "turkiye", "turkey", "milli takım", "millî takım"]);

  return articles
    .filter((article) => article
      && teamNames.has(String(article.team || "").toLocaleLowerCase("tr-TR"))
      && String(article.status || "").toLowerCase() === "verified"
      && Array.isArray(article.body) && article.body.some((line) => String(line || "").trim())
      && newsSlug(article.slug || article.id || article.title))
    .sort((left, right) => String(right.publishedAt || "").localeCompare(String(left.publishedAt || "")))
    .slice(0, NEWS_LIMIT)
    .map((article) => ({
      title: article.title || "",
      slug: newsSlug(article.slug || article.id || article.title),
      publishedAt: article.publishedAt || "",
      summary: (Array.isArray(article.body) ? article.body.find((line) => String(line || "").trim()) : "") || ""
    }));
}

/* ------------------------------------------------------------------ */
/* 3. İŞARETLEME                                                        */
/* ------------------------------------------------------------------ */

function matchHref(match, page) {
  const target = page.locale === "en" && match.enPath ? match.enPath : match.trPath;
  return target ? `${page.base}${target}` : "";
}

function ctaLabel(match, text) {
  if (match.state === "live") return text.openMatchLive;
  if (match.state === "post") return text.openMatchPost;
  if (match.state === "pre") return text.openMatchPre;
  return text.openMatch;
}

/**
 * SKOR YALNIZCA DOĞRULANMIŞ HÂLDE BASILIR.
 *
 * `pending` (başlama saati geçti, sağlayıcı nihai sonucu bildirmedi) bir
 * skor hâli DEĞİL. Depoda o maçın tazelenmemiş canlı anlık görüntüsü
 * duruyor olabilir — 25 Eylül Türkiye-France kaydı iki gün boyunca
 * "LIVE 0-0" kaldı. Kartta "Sonuç bekleniyor" yazıp altına 0-0 basmak,
 * aynı kutuda iki çelişkili iddia demek olurdu: sonucu bilmediğimizi
 * söyleyip sonucu yazmak. O yüzden skor yalnızca `live` ve `post`
 * hâllerinde görünür; `pending` kartı başlama saatini gösterir.
 */
function scoreLineHtml(match, text) {
  const scoreIsClaimable = match.state === "live" || match.state === "post";
  if (match.score && scoreIsClaimable) {
    const minute = match.state === "live" && match.minute ? `<span class="ntp-minute"><i class="live-pulse" aria-hidden="true"></i>${escapeHtml(String(match.minute).replace(/'+$/, ""))}'</span>` : "";
    return `<p class="ntp-score">${escapeHtml(match.score.home)}<span aria-hidden="true">-</span>${escapeHtml(match.score.away)}${minute}</p>`;
  }
  const clock = clockOf(match.kickoff);
  return `<p class="ntp-kickoff">${clock ? `${escapeHtml(clock)} ${escapeHtml(text.tsi)}` : escapeHtml(text.timePending)}</p>`;
}

function matchCardHtml(match, page, options = {}) {
  const text = STR[page.locale];
  const href = matchHref(match, page);
  const league = match.league ? competitionLabel(match.league, page.locale) : "";
  const stage = typeof match.stage === "string"
    ? match.stage
    : (match.stage && match.stage[page.locale]) || "";
  const venue = match.venue ? venueLabel(match.venue, page.locale) : "";
  // İngilizce sayfada ülke adı İngilizce görünür ("İtalya" → "Italy").
  // Bağlandığı maç sayfası da aynı adı basıyor (generate-match-seo-pages
  // içindeki `ctx.homeTeam`), böylece merkez ile maç sayfası ayrışmıyor.
  const homeName = nationLabel(match.homeTeam, page.locale);
  const awayName = nationLabel(match.awayTeam, page.locale);

  const meta = [
    league,
    stage,
    dayLabel(match.day, page.locale)
  ].filter(Boolean).map((value) => `<span>${escapeHtml(value)}</span>`).join("");

  // Adres yoksa (saati doğrulanmamış program satırı) bağlantı YAZILMAZ;
  // okuyucuya neden olmadığı söylenir.
  const action = href
    ? `<a class="ntp-card-action" href="${escapeHtml(href)}">${escapeHtml(ctaLabel(match, text))} <span aria-hidden="true">→</span></a>`
    : `<p class="ntp-card-note">${escapeHtml(text.pagePending)}</p>`;

  return `<article class="card ntp-card ntp-card--${escapeHtml(match.state)}${options.featured ? " ntp-card--featured" : ""}">
            <p class="ntp-card-meta">${meta}<span class="ntp-state">${escapeHtml(text.stateLabel[match.state] || "")}</span></p>
            <h3 class="ntp-card-teams"><span>${escapeHtml(homeName)}</span> <em>${escapeHtml(text.vs)}</em> <span>${escapeHtml(awayName)}</span></h3>
            ${scoreLineHtml(match, text)}
            <p class="ntp-card-venue">${escapeHtml(venue || text.venuePending)}</p>
            ${action}
          </article>`;
}

function sectionHtml({ id, title, body, note }) {
  return `      <section class="ntp-section" id="${escapeHtml(id)}" aria-labelledby="${escapeHtml(id)}-title">
        <div class="section-head"><div class="section-title"><h2 id="${escapeHtml(id)}-title">${escapeHtml(title)}</h2></div></div>
${note ? `        <p class="ntp-note">${escapeHtml(note)}</p>\n` : ""}${body}
      </section>`;
}

function emptyStateHtml(message) {
  return `        <div class="data-empty" data-card="empty-state"><span>${escapeHtml(message)}</span></div>`;
}

function matchGridHtml(matches, page, options = {}) {
  if (!matches.length) return "";
  return `        <div class="grid ntp-grid">${matches.map((match) => matchCardHtml(match, page, options)).join("")}</div>`;
}

function standingsHtml(page) {
  const text = STR[page.locale];
  const rows = standingsRows();
  if (!rows.length) return emptyStateHtml(text.noStandings);

  const head = text.tableHead.map((label) => `<th scope="col">${escapeHtml(label)}</th>`).join("");
  const body = rows.map((row) => `<tr>
              <td>${escapeHtml(row.rank ?? "")}</td>
              <th scope="row">${escapeHtml(row.team || row.name || "")}</th>
              <td>${escapeHtml(row.played ?? 0)}</td>
              <td>${escapeHtml(row.won ?? 0)}</td>
              <td>${escapeHtml(row.drawn ?? 0)}</td>
              <td>${escapeHtml(row.lost ?? 0)}</td>
              <td>${escapeHtml(row.goalsFor ?? 0)}</td>
              <td>${escapeHtml(row.goalsAgainst ?? 0)}</td>
              <td>${escapeHtml(row.goalDifference ?? 0)}</td>
              <td><b>${escapeHtml(row.points ?? 0)}</b></td>
            </tr>`).join("");

  return `        <div class="standings-table-wrap"><table class="ntp-table">
          <caption class="sr-only">${escapeHtml(text.standingsTitle)}</caption>
          <thead><tr>${head}</tr></thead>
          <tbody>${body}</tbody>
        </table></div>`;
}

function squadHtml(page) {
  const text = STR[page.locale];
  const players = squadPlayers();
  if (!players.length) return emptyStateHtml(text.noSquad);

  const head = text.squadHead.map((label) => `<th scope="col">${escapeHtml(label)}</th>`).join("");
  const body = players.map((player) => `<tr>
              <th scope="row">${escapeHtml(player.name)}</th>
              <td>${escapeHtml(player.position || "")}</td>
              <td>${escapeHtml(player.club || "")}</td>
            </tr>`).join("");

  return `        <div class="standings-table-wrap"><table class="ntp-table">
          <caption class="sr-only">${escapeHtml(text.squadTitle)}</caption>
          <thead><tr>${head}</tr></thead>
          <tbody>${body}</tbody>
        </table></div>`;
}

function newsHtml(page) {
  const text = STR[page.locale];
  const items = newsItems(page.locale);
  if (!items.length) return emptyStateHtml(text.noNews);

  const prefix = page.locale === "en" ? "en/news" : "haber";
  return `        <div class="grid ntp-news-grid">${items.map((item) => `<article class="card ntp-news">
            <h3><a href="${escapeHtml(`${page.base}${prefix}/${item.slug}`)}">${escapeHtml(item.title)}</a></h3>
            ${item.summary ? `<p>${escapeHtml(String(item.summary).slice(0, 190))}</p>` : ""}
          </article>`).join("")}</div>`;
}

function relatedHtml(page) {
  const text = STR[page.locale];
  return `      <section class="source-strip" aria-label="${escapeHtml(text.relatedTitle)}">
        ${text.related.map((link) => `<div><span>${escapeHtml(link.kicker)}</span><b><a href="${escapeHtml(`${page.base}${link.href}`)}">${escapeHtml(link.label)}</a></b></div>`).join("\n        ")}
      </section>`;
}

function sourcesHtml(page) {
  const text = STR[page.locale];
  const sources = Array.isArray(config.sources) ? config.sources.filter((row) => row && row.url && row.label) : [];
  if (!sources.length) return "";
  return `      <section class="ntp-sources" aria-label="${escapeHtml(text.sourcesTitle)}">
        <p>${escapeHtml(text.dataNote)}</p>
        <p>${sources.map((source) => `<a href="${escapeHtml(source.url)}" target="_blank" rel="${SOURCE_LINK_REL}">${escapeHtml(source.label)}</a>`).join(" · ")}</p>
      </section>`;
}

/* ------------------------------------------------------------------ */
/* 4. ŞEMA                                                              */
/* ------------------------------------------------------------------ */

function schemaFor(page) {
  const text = STR[page.locale];
  const url = absoluteUrl(page.file);
  const meta = routeMeta(ROUTE_KEY, page.locale);

  const schedule = [...liveMatches, ...upcoming, ...recent]
    .filter((match) => match.trPath)
    .map((match) => ({
      homeTeam: nationLabel(match.homeTeam, page.locale),
      awayTeam: nationLabel(match.awayTeam, page.locale),
      kickoff: match.kickoff,
      league: match.league,
      venue: match.venue,
      status: match.status,
      score: match.score,
      matchPage: page.locale === "en" && match.enPath ? match.enPath : match.trPath
    }));

  const list = matchListSchema(schedule, {
    name: `${text.h1} — ${text.upcomingTitle}`,
    locale: page.locale,
    urlFor: (match) => (match.matchPage ? `${DOMAIN}/${String(match.matchPage).replace(/^\//, "")}` : "")
  });

  return [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      "@id": url,
      url,
      name: meta.title,
      description: meta.description,
      inLanguage: page.locale === "en" ? "en" : "tr-TR",
      isPartOf: { "@type": "WebSite", name: "FutbolRadar", url: `${DOMAIN}/` },
      about: {
        "@type": "SportsTeam",
        name: page.locale === "en" ? "Türkiye national football team" : "Türkiye A Millî Futbol Takımı",
        sport: "Football"
      }
    },
    list,
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: text.breadcrumbHome, item: absoluteUrl(page.locale === "en" ? "en/index.html" : "index.html") },
        { "@type": "ListItem", position: 2, name: text.h1, item: url }
      ]
    }
  ].filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* 5. SAYFA                                                             */
/* ------------------------------------------------------------------ */

function pageHtml(page) {
  const text = STR[page.locale];
  const meta = routeMeta(ROUTE_KEY, page.locale);
  const canonical = absoluteUrl(page.file);
  const counterpartUrl = absoluteUrl(page.counterpart);
  const trUrl = page.locale === "en" ? counterpartUrl : canonical;
  const enUrl = page.locale === "en" ? canonical : counterpartUrl;

  const featured = liveMatches[0] || upcoming[0] || null;
  const featuredSection = featured
    ? sectionHtml({
      id: "sonraki-mac",
      title: featured.state === "live" ? text.liveTitle : text.nextTitle,
      body: matchGridHtml([featured], page, { featured: true })
    })
    : "";

  const restUpcoming = upcoming.filter((match) => match !== featured);
  const body = [
    featuredSection,
    sectionHtml({
      id: "yaklasan-maclar",
      title: text.upcomingTitle,
      body: restUpcoming.length ? matchGridHtml(restUpcoming, page) : emptyStateHtml(text.noUpcoming)
    }),
    sectionHtml({ id: "son-maclar", title: text.recentTitle, body: recent.length ? matchGridHtml(recent, page) : emptyStateHtml(text.noRecent) }),
    sectionHtml({ id: "puan-durumu", title: text.standingsTitle, body: standingsHtml(page) }),
    sectionHtml({ id: "kadro", title: text.squadTitle, body: squadHtml(page) }),
    sectionHtml({ id: "haberler", title: text.newsTitle, body: newsHtml(page) }),
    relatedHtml(page),
    sourcesHtml(page)
  ].filter(Boolean).join("\n");

  const schema = schemaFor(page).map((node) => `<script type="application/ld+json">${JSON.stringify(node).replace(/</g, "\\u003c")}</script>`).join("\n    ");

  return `<!doctype html>
<html lang="${htmlLang(page.locale)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(meta.title)}</title>
    <meta name="description" content="${escapeHtml(meta.description)}" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <link rel="alternate" hreflang="${hreflangOf("en")}" href="${escapeHtml(enUrl)}" />
    <link rel="alternate" hreflang="${hreflangOf("tr")}" href="${escapeHtml(trUrl)}" />
    <link rel="alternate" hreflang="x-default" href="${escapeHtml(trUrl)}" />
    <meta name="robots" content="${ROBOTS_INDEX}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="${ogLocale(page.locale)}" />
    <meta property="og:locale:alternate" content="${ogLocale(page.locale === "en" ? "tr" : "en")}" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta property="og:title" content="${escapeHtml(meta.title)}" />
    <meta property="og:description" content="${escapeHtml(meta.description)}" />
    <meta property="og:image" content="${DOMAIN}/assets/og-image.png" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(meta.title)}" />
    <meta name="twitter:description" content="${escapeHtml(meta.description)}" />
    <meta name="twitter:image" content="${DOMAIN}/assets/og-image.png" />
    <link rel="icon" href="${page.base}favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="${page.base}site.webmanifest" />
    <link rel="stylesheet" href="${page.base}page.css" />
    ${schema}
  </head>
  <body class="subpage">
    ${siteHeader({ base: page.base, locale: page.locale, altHref: page.counterpart })}
    <main class="container">
      <nav class="breadcrumb" aria-label="${escapeHtml(text.breadcrumbHome)}"><a href="${page.base}${page.locale === "en" ? "en/index.html" : "index.html"}">${escapeHtml(text.breadcrumbHome)}</a><span>/</span><span>${escapeHtml(text.h1)}</span></nav>
      <section class="hero">
        <div class="hero-row">
          <div>
            <span class="eyebrow">${escapeHtml(text.kicker)}</span>
            <h1>${escapeHtml(text.h1)}</h1>
            <p class="lead">${escapeHtml(text.lead)}</p>
          </div>
          <span class="hero-meta">${escapeHtml(text.heroMeta)}</span>
        </div>
      </section>
${body}
    </main>
    ${siteFooter({ base: page.base, locale: page.locale })}
    <script src="${page.base}site.js" defer></script>
  </body>
</html>
`;
}

/* ------------------------------------------------------------------ */
/* 6. YAZ                                                               */
/* ------------------------------------------------------------------ */

const problems = [];
let written = 0;

for (const page of PAGES) {
  const html = pageHtml(page);
  for (const target of [page.file, `public/${page.file}`]) {
    const absolute = path.join(root, target);
    const existing = fs.existsSync(absolute) ? fs.readFileSync(absolute, "utf8") : null;
    if (existing === html) continue;
    if (CHECK_ONLY) {
      problems.push(`${target}: millî takım sayfası güncel değil`);
      continue;
    }
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, html, "utf8");
    written += 1;
  }
}

if (problems.length) {
  console.error("national-team-pages FAILED:");
  problems.forEach((line) => console.error(`  - ${line}`));
  process.exitCode = 1;
} else if (CHECK_ONLY) {
  console.log("national-team-pages: sayfalar güncel.");
} else {
  console.log(`[national-team] ${written} dosya yazıldı — canlı=${liveMatches.length} yaklaşan=${upcoming.length} son=${recent.length} (saati doğrulanmamış program satırı: ${announcedMatches.length}).`);
}
