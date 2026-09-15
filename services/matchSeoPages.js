/**
 * MAÇ SEO SAYFALARI — KALICI URL SİCİLİ VE SLUG KURALI.
 *
 * Her SEO değeri taşıyan karşılaşmanın maç öncesi, maç sırası ve maç sonrası
 * aynı adreste yaşayan TEK sayfası vardır:
 *
 *   TR  /mac/fenerbahce-besiktas-5-eylul-2026
 *   EN  /en/match/fenerbahce-besiktas-september-5-2026
 *
 * Adres, sayfa ilk kez üretildiği anda `data/match-seo-pages.json` içine
 * yazılır ve BİR DAHA DEĞİŞMEZ. Maç ertelense, takvimden düşse ya da
 * sağlayıcı kaydı pencereden çıksa bile sicildeki satır kalır; bittikten
 * sonra kalıcı "maç sonucu" sayfası olarak yaşamaya devam eder.
 *
 * Bu modül CommonJS: hem derleme script'leri (createRequire) hem de API
 * fonksiyonları (`api/matches.js`) aynı kuralı okur. Sunucu tarafında sicilin
 * tamamı değil, yalnızca küçük arama dizini (`data/match-seo-index.json`)
 * yüklenir.
 */

const fs = require("node:fs");
const path = require("node:path");
const { normalizeText } = require("../api/_utils");
const { canonicalStatus, istanbulDay, kickoffMs, LIVE_GRACE_MS } = require("./matchStatus.js");
const { resolveCompetitionId, findCompetition, isAmbiguousCompetitionName } = require("./competitionCatalog.js");
const { sameClub, fixtureTeamNames } = require("./superLigTeams.js");

const DOMAIN = "https://www.futbolradar.com";
const REGISTRY_PATH = path.join(__dirname, "..", "data", "match-seo-pages.json");
const INDEX_PATH = path.join(__dirname, "..", "data", "match-seo-index.json");
const REGISTRY_VERSION = 1;

/**
 * İNDEKSLENEBİLİR YARIŞMALAR — data/competitions.json `id` alanı.
 *
 * Google'a binlerce anlamsız maç sayfası gönderilmez: yalnızca aranan
 * yarışmalar sicile girer. Türkiye A Millî Takımı maçları yarışmadan
 * bağımsız olarak kabul edilir (bkz. `isTurkiyeNationalMatch`).
 */
const INDEXABLE_COMPETITION_IDS = Object.freeze([
  "super-lig",
  "1-lig",
  "turkiye-kupasi",
  "sampiyonlar-ligi",
  "avrupa-ligi",
  "konferans-ligi",
  "premier-league",
  "la-liga",
  "serie-a",
  "bundesliga",
  "ligue-1"
]);

const TR_MONTHS = Object.freeze(["ocak", "subat", "mart", "nisan", "mayis", "haziran", "temmuz", "agustos", "eylul", "ekim", "kasim", "aralik"]);
const EN_MONTHS = Object.freeze(["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]);

const NATIONAL_TEAM_NAMES = new Set(["turkiye", "turkey", "turkiye a milli takimi", "turkiye milli takimi"]);

/** "Fenerbahçe" → "fenerbahce"; "Çaykur Rizespor" → "caykur-rizespor". */
function slugify(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Türkiye saatine göre {year, month(1-12), day}. Geçersiz tarihte null. */
function istanbulDateParts(value) {
  const day = istanbulDay(value);
  if (!day) return null;
  const [year, month, date] = day.split("-").map((part) => Number(part));
  if (!year || !month || !date) return null;
  return { year, month, day: date };
}

/**
 * SÜPER LİG KULÜP ADI KANONİKLEŞTİRME.
 *
 * Sağlayıcı "Rizespor" der, TFF fikstürü "Çaykur Rizespor". Slug ve kimlik
 * her zaman fikstürdeki resmî ada göre kurulur; böylece aynı maç iki farklı
 * yazımla iki sayfa açmaz.
 */
let fixtureNameCache = null;
function canonicalTeamName(name) {
  const value = String(name || "").trim();
  if (!value) return "";
  if (!fixtureNameCache) fixtureNameCache = fixtureTeamNames();
  const exact = fixtureNameCache.find((candidate) => normalizeText(candidate) === normalizeText(value));
  if (exact) return exact;
  const similar = fixtureNameCache.find((candidate) => sameClub(candidate, value));
  return similar || value;
}

function trSlugFor(homeTeam, awayTeam, kickoff) {
  const parts = istanbulDateParts(kickoff);
  if (!parts) return null;
  return `${slugify(canonicalTeamName(homeTeam))}-${slugify(canonicalTeamName(awayTeam))}-${parts.day}-${TR_MONTHS[parts.month - 1]}-${parts.year}`;
}

function enSlugFor(homeTeam, awayTeam, kickoff) {
  const parts = istanbulDateParts(kickoff);
  if (!parts) return null;
  return `${slugify(canonicalTeamName(homeTeam))}-${slugify(canonicalTeamName(awayTeam))}-${EN_MONTHS[parts.month - 1]}-${parts.day}-${parts.year}`;
}

function trPagePath(slug) {
  return `mac/${slug}.html`;
}

function enPagePath(enSlug) {
  return `en/match/${enSlug}.html`;
}

/** Kanonik adres UZANTISIZDIR; `vercel.json` rewrite'ı dosyaya çözer. */
function trPageUrl(slug) {
  return `${DOMAIN}/mac/${slug}`;
}

function enPageUrl(enSlug) {
  return `${DOMAIN}/en/match/${enSlug}`;
}

/** Aynı kulüp çifti + aynı TSİ günü = aynı maç. Ev/deplasman sırası korunur. */
function identityOf(match) {
  if (!match || !match.homeTeam || !match.awayTeam) return null;
  const day = istanbulDay(match.kickoff);
  if (!day) return null;
  return `${slugify(canonicalTeamName(match.homeTeam))}|${slugify(canonicalTeamName(match.awayTeam))}|${day}`;
}

function isTurkiyeNationalMatch(match) {
  if (!match) return false;
  return [match.homeTeam, match.awayTeam].some((name) => NATIONAL_TEAM_NAMES.has(normalizeText(name)));
}

/**
 * Bir kaydın sicile girip giremeyeceğine karar verir.
 *
 * Reddetme nedenleri açıkça döner: eksik kimlik, tanınmayan/öncelik dışı
 * yarışma, hazırlık maçı. İptal/erteleme sicile girmeye engel DEĞİLDİR —
 * sayfa açıldıysa kalır, yalnızca `noindex` olur (bkz. `isIndexableEntry`).
 */
function evaluateEligibility(match) {
  if (!match || !match.homeTeam || !match.awayTeam) return { eligible: false, reason: "missing-teams" };
  if (!istanbulDay(match.kickoff)) return { eligible: false, reason: "missing-kickoff" };
  if (isTurkiyeNationalMatch(match)) return { eligible: true, reason: "national-team", competitionId: resolveCompetitionId(match) || "milli-takim" };

  const competitionId = resolveCompetitionId(match);
  if (!competitionId) return { eligible: false, reason: "unknown-competition" };
  if (!INDEXABLE_COMPETITION_IDS.includes(competitionId)) return { eligible: false, reason: "low-priority-competition", competitionId };

  // ÇOK ANLAMLI LİG ADI ("Premier League" Mısır'da da var, "Serie A"
  // Brezilya'da da). Kayıt sağlayıcının sayısal lig kimliğini taşıyorsa o
  // kimlik katalogla eşleşmek ZORUNDA; taşımıyorsa ve ad çok anlamlıysa
  // sicile ALINMAZ — Mısır liginin maçını Premier League diye indekslemek
  // yanlış bilgi yayınlamaktır.
  const competition = findCompetition(competitionId);
  const expectedProviderId = competition && competition.providers && competition.providers.apiFootball;
  const providerLeagueId = match.providerLeagueId;
  if (providerLeagueId !== undefined && providerLeagueId !== null && providerLeagueId !== "") {
    if (expectedProviderId && String(expectedProviderId) !== String(providerLeagueId)) {
      return { eligible: false, reason: "provider-league-mismatch", competitionId };
    }
  } else if (isAmbiguousCompetitionName(match.league) && !(match.providerIds && match.providerIds.apiFootball && match.competitionId && !isAmbiguousCompetitionName(match.competitionId))) {
    return { eligible: false, reason: "ambiguous-competition-unverified", competitionId };
  }
  return { eligible: true, reason: "priority-competition", competitionId };
}

const STATE_RANK = Object.freeze({ UNKNOWN: 0, SCHEDULED: 1, LIVE: 2, HALFTIME: 2, INTERRUPTED: 2, POSTPONED: 3, CANCELLED: 3, ABANDONED: 3, AWARDED: 4, FINISHED: 4 });

/**
 * SAYFA DURUMU — başlık, şema ve gövde bu değere göre seçilir.
 *
 *   pre        başlamadı (kickoff gelecekte ya da yeni geçti, sinyal yok)
 *   live       sağlayıcı canlı diyor ve skor okunabilir
 *   post       tamamlandı / hükmen sonuçlandı, nihai skor var
 *   pending    başlama saati uzun süre önce geçti, nihai sonuç doğrulanmadı
 *   postponed  ertelendi
 *   cancelled  iptal / tatil edildi
 */
function pageStateOf(entry, nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const status = canonicalStatus(entry && (entry.status || entry.providerStatus));
  const score = entry && entry.score;
  const hasScore = Boolean(score) && score.home !== null && score.home !== undefined && score.away !== null && score.away !== undefined;
  const kickoff = kickoffMs(entry);

  if (status === "POSTPONED") return "postponed";
  if (status === "CANCELLED" || status === "ABANDONED") return "cancelled";
  if ((status === "FINISHED" || status === "AWARDED") && hasScore) return "post";
  if (["LIVE", "HALFTIME", "INTERRUPTED"].includes(status) && hasScore && kickoff !== null && now - kickoff <= LIVE_GRACE_MS) return "live";
  if (kickoff === null) return "pre";
  if (kickoff > now) return "pre";
  if (now - kickoff <= LIVE_GRACE_MS) return "pre";
  return "pending";
}

/** İptal/erteleme ya da eksik kimlik: sayfa kalır ama arama motoruna sunulmaz. */
function isIndexableEntry(entry, nowMs) {
  if (!entry || !entry.slug || !entry.homeTeam || !entry.awayTeam || !entry.kickoff) return false;
  if (entry.indexable === false) return false;
  const state = pageStateOf(entry, nowMs);
  return state !== "cancelled" && state !== "postponed";
}

function readJsonSafe(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function loadRegistry() {
  const parsed = readJsonSafe(REGISTRY_PATH, null);
  const pages = parsed && Array.isArray(parsed.pages) ? parsed.pages : [];
  return { version: REGISTRY_VERSION, updatedAt: (parsed && parsed.updatedAt) || null, pages };
}

function saveRegistry(registry) {
  const pages = (registry.pages || []).slice().sort((left, right) =>
    String(left.kickoff || "").localeCompare(String(right.kickoff || "")) || String(left.slug).localeCompare(String(right.slug)));
  const payload = `${JSON.stringify({ version: REGISTRY_VERSION, updatedAt: new Date().toISOString(), pageCount: pages.length, pages }, null, 2)}\n`;
  fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
  fs.writeFileSync(REGISTRY_PATH, payload, "utf8");
  return pages.length;
}

/**
 * ÇALIŞMA ZAMANI DİZİNİ — API ve ön-render için küçük arama tablosu.
 *
 *   { "af:1584397": "fenerbahce-besiktas-5-eylul-2026",
 *     "id:fenerbahce|besiktas|2026-09-05": "…", "tsdb:2527752": "…" }
 */
function buildIndex(registry) {
  const index = {};
  for (const entry of registry.pages || []) {
    if (!entry || !entry.slug) continue;
    const ids = entry.providerIds || {};
    if (ids.apiFootball) index[`af:${ids.apiFootball}`] = entry.slug;
    if (ids.theSportsDb) index[`tsdb:${ids.theSportsDb}`] = entry.slug;
    if (entry.identity) index[`id:${entry.identity}`] = entry.slug;
  }
  return index;
}

function saveIndex(registry) {
  const index = buildIndex(registry);
  const payload = `${JSON.stringify(index)}\n`;
  const previous = fs.existsSync(INDEX_PATH) ? fs.readFileSync(INDEX_PATH, "utf8") : null;
  if (previous !== payload) fs.writeFileSync(INDEX_PATH, payload, "utf8");
  return Object.keys(index).length;
}

let indexCache = null;
function loadIndex() {
  if (indexCache) return indexCache;
  // `require` ile okunur: Vercel fonksiyon paketleyicisi JSON bağımlılığını
  // statik izleyip pakete alır; dosya yoksa (ilk kurulum) boş dizin döner.
  try {
    // eslint-disable-next-line global-require
    const parsed = require("../data/match-seo-index.json");
    indexCache = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    indexCache = {};
  }
  return indexCache;
}

function resetIndexCache() {
  indexCache = null;
}

/**
 * Bir maç kaydının (sağlayıcı, takvim, editoryal) SEO sayfası slug'ı.
 * Bulunamazsa null — var olmayan bir adres ASLA üretilmez.
 */
function slugForMatch(match, index) {
  if (!match) return null;
  const table = index || loadIndex();
  const ids = match.providerIds || {};
  const apiFootballId = ids.apiFootball
    || (String(match.providerName || match.source || "").toLowerCase().includes("api-football") ? match.providerId : null);
  if (apiFootballId && table[`af:${apiFootballId}`]) return table[`af:${apiFootballId}`];
  if (ids.theSportsDb && table[`tsdb:${ids.theSportsDb}`]) return table[`tsdb:${ids.theSportsDb}`];
  const identity = identityOf(match);
  if (identity && table[`id:${identity}`]) return table[`id:${identity}`];
  return null;
}

/**
 * Maç listesine `matchPage` damgalar: sitenin "bu maça git" bağlantıları
 * (`services/matchProgram.js#matchDetailPath`, `app.js#matchDetailHref`,
 * günlük manşetler, haber bandı) bu alanı `analysisPage`den ÖNCE okur.
 *
 * `analysisPage` alanına BİLEREK yazılmaz: o alan editoryal analiz sayfasının
 * yoludur ve `services/matchReportService.js` maç raporunu o yola YAZAR —
 * damgalansaydı rapor üreticisi kalıcı maç sayfasının adresine rapor
 * dosyası basardı. Ayrı alan, ayrı sorumluluk.
 */
/**
 * TR SLUG → EN SAYFA YOLU.
 *
 * Eşleme `data/en-route-map.json` içinde zaten var (hreflang enjeksiyonu ve
 * dil düğmesi aynı dosyayı okuyor); burada yalnızca TERSİNE çevrilmiş, adres
 * başına O(1) bir tablo kuruluyor.
 *
 * TEMBEL YÜKLENİR. Dosya 190 KB'ın üzerinde ve Türkçe yüzeyin ona hiç
 * ihtiyacı yok; her `/api/matches` çağrısında ayrıştırmak, İngilizce
 * okuyucu hiç gelmese bile her soğuk başlangıca bedel yazardı. Tablo
 * yalnızca İngilizce yol İSTENDİĞİNDE kurulur ve örnek boyunca saklanır.
 */
let enSlugTableCache = null;

function enSlugTable() {
  if (enSlugTableCache) return enSlugTableCache;
  enSlugTableCache = new Map();
  try {
    // eslint-disable-next-line global-require
    const routes = require("../data/en-route-map.json");
    for (const entry of Object.values(routes || {})) {
      if (!entry || entry.kind !== "match-seo" || !entry.tr || !entry.en) continue;
      const trSlug = String(entry.tr).replace(/^mac\//, "").replace(/\.html$/, "");
      const enSlug = String(entry.en).replace(/^en\/match\//, "").replace(/\.html$/, "");
      if (trSlug && enSlug) enSlugTableCache.set(trSlug, enSlug);
    }
  } catch {
    // Eşleme dosyası yoksa İngilizce yol damgalanmaz; Türkçe yol bozulmaz.
  }
  return enSlugTableCache;
}

function resetEnSlugTable() {
  enSlugTableCache = null;
}

/**
 * @param {object[]} matches
 * @param {object}   [index]            maç → slug tablosu (test için)
 * @param {object}   [options]          { includeEn: boolean }
 */
function withMatchPages(matches, index, options) {
  if (!Array.isArray(matches)) return [];
  const table = index || loadIndex();
  const includeEn = Boolean(options && options.includeEn);
  return matches.map((match) => {
    if (!match || typeof match !== "object" || match.matchPage) return match;
    const slug = slugForMatch(match, table);
    if (!slug) return match;
    const stamped = { ...match, matchPage: trPagePath(slug).replace(/\.html$/, ""), matchPageUrl: trPageUrl(slug) };
    if (includeEn) {
      const enSlug = enSlugTable().get(slug);
      // İngilizce sayfası ÜRETİLMEMİŞ maça İngilizce bağlantı verilmez:
      // olmayan bir adrese göndermektense alan hiç yazılmaz ve tüketici
      // Türkçe sayfaya düşer.
      if (enSlug) {
        stamped.matchPageEn = enPagePath(enSlug).replace(/\.html$/, "");
        stamped.matchPageEnUrl = enPageUrl(enSlug);
      }
    }
    return stamped;
  });
}

/** İngilizce yüzey için aynı damga (`en/match/<slug>`). */
function enPathForMatch(match, registryPages) {
  const slug = slugForMatch(match);
  if (!slug) return null;
  const entry = (registryPages || []).find((row) => row.slug === slug);
  return entry && entry.enSlug ? enPagePath(entry.enSlug).replace(/\.html$/, "") : null;
}

function competitionNameFor(competitionId, fallback) {
  const competition = competitionId ? findCompetition(competitionId) : null;
  return (competition && competition.name) || fallback || "";
}

module.exports = {
  resetEnSlugTable,
  DOMAIN,
  EN_MONTHS,
  INDEXABLE_COMPETITION_IDS,
  INDEX_PATH,
  REGISTRY_PATH,
  STATE_RANK,
  TR_MONTHS,
  buildIndex,
  canonicalTeamName,
  competitionNameFor,
  enPagePath,
  enPageUrl,
  enPathForMatch,
  enSlugFor,
  evaluateEligibility,
  identityOf,
  isIndexableEntry,
  isTurkiyeNationalMatch,
  istanbulDateParts,
  loadIndex,
  loadRegistry,
  pageStateOf,
  resetIndexCache,
  saveIndex,
  saveRegistry,
  slugForMatch,
  slugify,
  trPagePath,
  trPageUrl,
  trSlugFor,
  withMatchPages
};
