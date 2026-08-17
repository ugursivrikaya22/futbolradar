/**
 * SÜPER LİG'İN SAĞLAYICI KİMLİĞİ NASIL BULUNUR?
 *
 * Lig kimliği bilerek koda gömülmedi (docs/football-data-coverage.md): sabit
 * bir sayı, sağlayıcı katalogunu değiştirdiğinde ya da başka bir plana
 * geçildiğinde sessizce yanlış ligi çeker. Ama kimliğin yapılandırılmamış
 * olması da sessiz bir engeldi — anahtar eklendiği hâlde kadro senkronu
 * ikinci bir kez, bu kez hiç görünmeden duruyordu.
 *
 * Çözüm, gömmek ile elle yapılandırmak arasındaki üçüncü yol: SORMAK.
 *
 *   1. APIFOOTBALL_LEAGUE_ID tanımlıysa o kullanılır. Operatörün açık
 *      tercihi her şeyin önündedir.
 *   2. Değilse önbellek okunur (data/api-football-league.json). Kimlik
 *      sezondan sezona değişmediği için bu dosya her koşuda bir API
 *      çağrısını daha baştan gereksiz kılar.
 *   3. Değilse ve anahtar varsa sağlayıcının /leagues uç noktası sorulur,
 *      sonuç önbelleğe yazılır.
 *
 * BELİRSİZLİK HÂLİNDE TAHMİN YOK: arama tam olarak bir lig döndürmezse
 * çözümleme başarısız olur ve adaylar listelenir. Yanlış bir lig kimliği,
 * kimlik yokluğundan daha kötüdür — on sekiz takımın kadrosunu yanlış
 * ligden doldurur ve bunu doğrulanmış veri gibi yayımlar.
 *
 * ANAHTAR ASLA YAZILMAZ: bu modül hiçbir koşulda API anahtarını döndürmez,
 * loglamaz ya da önbelleğe yazmaz. Yalnızca çözülen lig kimliği basılır.
 */

const fs = require("node:fs");
const path = require("node:path");
const apiFootballProvider = require("./providers/apiFootballProvider");
const { normalizeText } = require("./matchRadarService");
const { resetLeagueCacheMemo } = require("./leagueCache");

const CACHE_PATH = path.join(process.cwd(), "data", "api-football-league.json");

/** Süper Lig'in sağlayıcıdaki adı; yazım varyantları katlanarak eşleşir. */
const TARGET_LEAGUE_NAMES = ["super lig", "superlig", "turkish super lig", "trendyol super lig"];

/** Önbellekte anahtar benzeri bir şey bulunursa dosya bozuk sayılır. */
const KEY_SHAPED = /^[a-f0-9]{32}$/i;

/** Önbellek bu kadar gün sonra sağlayıcıya yeniden doğrulatılır. */
const CACHE_REVALIDATE_DAYS = 30;

/**
 * Genişletilmiş ("super lig" içeren) aramanın ASLA seçmemesi gereken adlar.
 * Kadınlar ligi ya da U19 turnuvası da "Süper Lig" içerir; tek aday olarak
 * kalırlarsa gevşek eşleşme onları seçerdi ve on sekiz erkek A takımı yerine
 * bambaşka bir turnuvanın kadroları yayımlanırdı.
 */
const NON_SENIOR_MENS_MARKERS = [
  "kadin", "kadinlar", "women", "womens", "feminin",
  "u17", "u18", "u19", "u20", "u21", "u23",
  "genc", "gencler", "youth", "junior", "akademi", "academy",
  "kupa", "cup", "play off", "play-off", "playoff", "amator", "reserve"
];

function isSeniorMensLeague(name) {
  const folded = normalizeText(name);
  return !NON_SENIOR_MENS_MARKERS.some((marker) => folded.includes(marker));
}

function readCache(cachePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Önbellek yalnızca aynı ülke için ve gerçekten bir kimlik taşıyorsa
 * geçerlidir. Sezon kasıtlı olarak kontrol edilmez: lig kimliği sezondan
 * sezona değişmez, sezonu şart koşmak her temmuzda gereksiz bir çağrı
 * doğururdu.
 */
function cacheIsUsable(cache, country, now = new Date()) {
  if (!cache || !cache.leagueId) return false;
  if (KEY_SHAPED.test(String(cache.leagueId))) return false;
  if (cache.country && normalizeText(cache.country) !== normalizeText(country)) return false;

  // Önbellek süresiz güvenilmez. Yanlış çözülmüş bir kimlik commit edilirse
  // depoya kalıcı olarak donardı; yeniden doğrulama penceresi, hatanın en
  // kötü ihtimalle bir ay içinde kendiliğinden düzelmesini sağlar. Doğru
  // kimlik zaten aynı sonucu döndürür, maliyeti ayda bir çağrıdır.
  const resolvedAt = Date.parse(cache.resolvedAt);
  if (!Number.isNaN(resolvedAt)) {
    const ageDays = (now.getTime() - resolvedAt) / 86400000;
    if (ageDays > CACHE_REVALIDATE_DAYS) return false;
  }

  return true;
}

function writeCache(cachePath, entry) {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  const tempPath = `${cachePath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(entry, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, cachePath);
}

/**
 * Katalogdan Süper Lig'i seçer; emin olamazsa hiçbir şey seçmez.
 *
 * İki aşama: önce bilinen adlarla tam eşleşme, tutmazsa "super lig" geçen
 * adlar. İkinci aşama, sponsor adı değiştiğinde ("Trendyol Süper Lig" gibi)
 * kurulumun elle müdahale beklemeden çalışmasını sağlar.
 *
 * Her iki aşamada da kural aynı: TAM OLARAK BİR aday varsa seçilir, birden
 * fazlaysa seçilmez. Genişletilmiş arama "kadınlar" ya da "genç" ligini de
 * getirebilir — o durumda iki aday çıkar ve çözümleme durur, yanlışını
 * seçmez.
 */
function selectSuperLig(leagues) {
  const all = leagues || [];

  const exact = all.filter((league) => TARGET_LEAGUE_NAMES.includes(normalizeText(league.name)));
  if (exact.length === 1) return { league: exact[0], candidates: exact, matched: true };
  if (exact.length > 1) return { league: null, candidates: exact, matched: true };

  // Gevşek eşleşme yalnızca erkek A takımı liglerinde arar: kadınlar ve
  // altyapı turnuvaları tek aday olarak kalsa bile seçilmez.
  const loose = all.filter((league) =>
    normalizeText(league.name).includes("super lig") && isSeniorMensLeague(league.name));
  if (loose.length === 1) return { league: loose[0], candidates: loose, matched: true };
  if (loose.length > 1) return { league: null, candidates: loose, matched: true };

  // Hiç eşleşme yok. Operatöre gösterilecek makul aday kümesi, ülkenin lig
  // tipindeki turnuvalarıdır.
  const fallbackCandidates = all.filter((league) => normalizeText(league.type) === "league");
  return {
    league: null,
    candidates: fallbackCandidates.length ? fallbackCandidates : all,
    matched: false
  };
}

/**
 * Lig kimliğini çözer.
 *
 * @returns {Promise<{status: "resolved"|"unavailable", leagueId: string|null,
 *   source: "env"|"cache"|"provider"|null, leagueName: string|null,
 *   reason: string|null, candidates: Array}>}
 */
async function resolveSuperLigLeagueId(options = {}) {
  const provider = options.provider || apiFootballProvider;
  const cachePath = options.cachePath || CACHE_PATH;
  const config = provider.getConfig();
  const country = options.country || config.country || "Turkey";
  const season = options.season || config.season;

  if (config.leagueId) {
    return {
      status: "resolved",
      leagueId: String(config.leagueId),
      source: "env",
      leagueName: null,
      reason: null,
      candidates: []
    };
  }

  const cache = readCache(cachePath);
  if (cacheIsUsable(cache, country)) {
    return {
      status: "resolved",
      leagueId: String(cache.leagueId),
      source: "cache",
      leagueName: cache.leagueName || null,
      reason: null,
      candidates: []
    };
  }

  if (!provider.hasConfig()) {
    return {
      status: "unavailable",
      leagueId: null,
      source: null,
      leagueName: null,
      reason: "no-api-key",
      candidates: []
    };
  }

  let leagues = [];
  try {
    leagues = await provider.getLeagues({ country, season, type: "League" });

    // type/season daraltması ligi tamamen dışarıda bırakabilir (bazı
    // planlarda sezon listesi eksik döner). Dar sorgu boş dönerse sadece
    // ülkeyle bir kez daha sorulur — bu, "katalogda yok" teşhisini
    // "sorgumuz fazla dardı"dan ayırmanın tek yolu.
    if (!leagues.length) {
      leagues = await provider.getLeagues({ country });
    }
  } catch (error) {
    return {
      status: "unavailable",
      leagueId: null,
      source: null,
      leagueName: null,
      // Hata mesajı sağlayıcıdan gelir ve anahtar içermez; kod ayrıca
      // teşhis için taşınır.
      reason: error && error.code ? `provider-error:${error.code}` : "provider-error",
      candidates: []
    };
  }

  const { league, candidates, matched } = selectSuperLig(leagues);

  if (!league) {
    return {
      status: "unavailable",
      leagueId: null,
      source: null,
      leagueName: null,
      // "İsim tuttu ama birden fazla" ile "hiç tutmadı" farklı sorunlardır:
      // ilki operatörden seçim ister, ikincisi genellikle paket kısıtıdır.
      reason: matched ? "ambiguous-match" : "no-match",
      candidates: candidates.map((item) => ({ id: item.id, name: item.name, country: item.country }))
    };
  }

  // Sağlayıcı katmanı önbelleği süreç içinde hatırlıyor; yeni değer aynı
  // süreçte hemen görünsün diye bellek sıfırlanır.
  resetLeagueCacheMemo();
  writeCache(cachePath, {
    leagueId: league.id,
    leagueName: league.name,
    country: league.country || country,
    resolvedForSeason: String(season || ""),
    resolvedAt: new Date().toISOString(),
    source: "api-football:/leagues",
    note: "Otomatik çözüldü. APIFOOTBALL_LEAGUE_ID tanımlanırsa bu dosya yok sayılır."
  });

  return {
    status: "resolved",
    leagueId: String(league.id),
    source: "provider",
    leagueName: league.name,
    reason: null,
    candidates: []
  };
}

module.exports = {
  CACHE_PATH,
  CACHE_REVALIDATE_DAYS,
  TARGET_LEAGUE_NAMES,
  resolveSuperLigLeagueId,
  selectSuperLig,
  cacheIsUsable,
  isSeniorMensLeague
};
