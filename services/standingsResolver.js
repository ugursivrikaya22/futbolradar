/**
 * PUAN DURUMU ÇÖZÜMLEYİCİSİ — BİR MAÇ, BİR LİG, BİR SEZON.
 *
 * Bir maç sayfasının hangi tabloyu göstereceğine TEK yerden karar verilir.
 * Kural üç maddeden ibaret ve istisnası yok:
 *
 *   1. Tablo YALNIZCA maçın kendi yarışma kimliğinden (`competitionId`)
 *      seçilir. Takım adına, sayfa adresine ya da metne bakılmaz.
 *   2. Tablonun sezonu maçın sezonuyla aynı olmak zorundadır. 2026/27
 *      maçının altında 2025/26 tablosu durmaz.
 *   3. Veri yoksa HİÇBİR tablo gösterilmez. Özellikle Süper Lig tablosu
 *      yedek/varsayılan DEĞİLDİR: "super-lig" yalnızca maç gerçekten Süper
 *      Lig maçıysa çözülür.
 *
 * Kupa (Türkiye Kupası, FA Cup, Copa del Rey...) gibi eleme usulü
 * yarışmalarda tablo kavramı yoktur; çözümleyici `reason: "knockout"` ile
 * "veri yok" döner ve çağıran taraf alanı dürüst bir not ile doldurur.
 * Avrupa kupalarında lig aşaması tablosu (36 takım) tam olarak bu ligin
 * kendi tablosudur — Süper Lig'e düşürülmez.
 *
 * Bu modül CommonJS: derleme betikleri (createRequire) ve API fonksiyonları
 * aynı kuralı okur, ikisi asla ayrışmaz.
 */

const fs = require("node:fs");
const path = require("node:path");
const { findCompetition, resolveCompetitionId } = require("./competitionCatalog.js");

const ROOT = path.join(__dirname, "..");
const STANDINGS_PATH = path.join(ROOT, "data", "league-standings.json");

/**
 * Avrupa sezonu Temmuz'da başlar: 2026-08-31 → "2026", 2027-05-10 → "2026".
 * Sağlayıcı (API-Football) sezonu da bu yıl numarasıyla adlandırır, bu
 * yüzden karşılaştırma tek biçim üzerinden yapılır.
 */
function seasonYearForKickoff(kickoff) {
  const time = Date.parse(kickoff || "");
  if (!Number.isFinite(time)) return null;
  const date = new Date(time);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  return String(month >= 7 ? year : year - 1);
}

/** "2026" → "2026/27". Görsel etiket; karşılaştırmada kullanılmaz. */
function seasonLabel(season) {
  const start = Number(season);
  if (!Number.isFinite(start)) return null;
  return `${start}/${String((start + 1) % 100).padStart(2, "0")}`;
}

/** Kayıtta hangi biçimde yazılmış olursa olsun ("2026", 2026, "2026/27") yıl. */
function normalizeSeason(value) {
  if (value === null || value === undefined || value === "") return null;
  const match = String(value).match(/\d{4}/);
  return match ? match[0] : null;
}

/**
 * ÖNBELLEK ANAHTARI — lig VE sezon her zaman içinde. Global bir "standings"
 * anahtarı bir ligin tablosunu başka bir maç sayfasına taşırdı; bu fonksiyon
 * o hatayı yapısal olarak imkânsız kılar.
 */
function standingsCacheKey(leagueId, seasonId) {
  return `standings:${leagueId || "unknown"}:${seasonId || "unknown"}`;
}

let storeCache = null;
function loadStore() {
  if (storeCache) return storeCache;
  try {
    storeCache = JSON.parse(fs.readFileSync(STANDINGS_PATH, "utf8"));
  } catch {
    storeCache = {};
  }
  return storeCache;
}

/** Yalnızca testler için: enjekte edilen mağazayı sıfırlar. */
function resetStoreCache() {
  storeCache = null;
}

/**
 * Yarışmanın tablo üretip üretmediği. `data/competitions.json`'daki
 * `coverage.standings` sağlayıcının kendi beyanı: eleme usulü kupalarda
 * `false` gelir. Kayıt tanınmıyorsa tip üzerinden karar verilir.
 */
function competitionHasTable(competition) {
  if (!competition) return false;
  if (competition.coverage && typeof competition.coverage.standings === "boolean") {
    return competition.coverage.standings;
  }
  return competition.type !== "cup" && competition.type !== "friendly";
}

/**
 * @param {object} match  competitionId / league / providerLeagueId / kickoff taşıyan kayıt
 * @param {object} [options]
 * @param {object} [options.store]   data/league-standings.json içeriği (test/enjeksiyon)
 * @param {string} [options.season]  maçın sezonu; verilmezse kickoff'tan türetilir
 * @returns {{
 *   status: "ok"|"unavailable",
 *   reason: string|null,
 *   competitionId: string|null,
 *   competitionName: string|null,
 *   season: string|null,
 *   seasonLabel: string|null,
 *   cacheKey: string,
 *   table: Array,
 *   updatedAt: string|null,
 *   league: string|null
 * }}
 */
function resolveStandingsForMatch(match, options = {}) {
  const store = options.store || loadStore();
  const competitionId = resolveCompetitionId(match || {}) || null;
  const competition = competitionId ? findCompetition(competitionId) : null;
  const season = normalizeSeason(options.season) || seasonYearForKickoff(match && match.kickoff);

  const base = {
    status: "unavailable",
    reason: null,
    competitionId,
    competitionName: (competition && competition.name) || (match && match.league) || null,
    season,
    seasonLabel: seasonLabel(season),
    cacheKey: standingsCacheKey(competitionId, season),
    table: [],
    updatedAt: null,
    league: null
  };

  // Yarışma çözülemediyse tablo DA seçilemez. Buradaki en tehlikeli hata
  // "bilinmiyorsa Süper Lig göster" olurdu; o yüzden açıkça geri dönülür.
  if (!competitionId) return { ...base, reason: "unknown-competition" };
  if (!competitionHasTable(competition)) return { ...base, reason: "knockout" };

  const entry = store && store[competitionId];
  const table = entry && Array.isArray(entry.table) ? entry.table : [];
  if (!table.length) return { ...base, reason: "no-data" };

  // Sezon denetimi: kayıtta sezon yazmıyorsa (eski senkron çıktısı) tablo
  // reddedilmez — yanlış sezon iddiası ile "sezon bilinmiyor" farklı şeyler.
  const tableSeason = normalizeSeason(entry.season);
  if (season && tableSeason && tableSeason !== season) {
    return { ...base, reason: "season-mismatch" };
  }

  return {
    ...base,
    status: "ok",
    reason: null,
    season: tableSeason || season,
    seasonLabel: seasonLabel(tableSeason || season),
    cacheKey: standingsCacheKey(competitionId, tableSeason || season),
    table,
    updatedAt: entry.updatedAt || null,
    league: entry.league || (competition && competition.name) || null
  };
}

module.exports = {
  competitionHasTable,
  normalizeSeason,
  resetStoreCache,
  resolveStandingsForMatch,
  seasonLabel,
  seasonYearForKickoff,
  standingsCacheKey
};
