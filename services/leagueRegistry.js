/**
 * ÇOK-LİGLİ REGISTRY: services/leagueResolver.js'in Süper Lig için kullandığı
 * "sor, tahmin etme, önbellekle" desenini data/competitions.json'daki HER
 * kayda genelleştirir.
 *
 * İki mod, kayda göre otomatik seçilir:
 *
 *   1. Kayıtta zaten sayısal bir apiFootball ID'si varsa (super-lig,
 *      şampiyonlar ligi vb. — üretimde hâlihazırda çalışan legacy ID'ler)
 *      o kimlik `/leagues?id=` ile DOĞRULANIR: sağlayıcı gerçekten böyle bir
 *      lig biliyor mu, coverage/logo/güncel sezon nedir. Kimliğin kendisi
 *      değiştirilmez — yalnızca metadata'sı tazelenir.
 *   2. Kayıtta apiFootball ID'si yoksa (yeni eklenen genişleme ligleri)
 *      ülkeye göre gruplanmış `/leagues?country=` sorgusu içinde ad/alias
 *      eşleşmesiyle ARANIR. Tek aday varsa çözülür; sıfır ya da birden
 *      fazla adayda ÇÖZÜLMEZ — leagueResolver.js'teki aynı kural: yanlış
 *      bir kimlik, kimliğin hiç olmamasından daha kötüdür.
 *
 * Aynı ülkede birden fazla hedef varsa (ör. Türkiye: Süper Lig + 1. Lig +
 * TFF 2./3. Lig + Türkiye Kupası) o ülke için TEK `/leagues` çağrısı
 * paylaşılır — quota tasarrufu.
 */

const apiFootballProvider = require("./providers/apiFootballProvider");
const { normalizeText } = require("./matchRadarService");
const { isSeniorMensLeague } = require("./leagueResolver");
const { competitions: catalog } = require("./competitionCatalog");

/** Katalogdaki Türkçe ülke adından API-Football'un beklediği İngilizce ada. */
const COUNTRY_MAP = {
  "Türkiye": "Turkey",
  "İngiltere": "England",
  "İspanya": "Spain",
  "İtalya": "Italy",
  "Almanya": "Germany",
  "Fransa": "France",
  "Hollanda": "Netherlands",
  "Portekiz": "Portugal",
  "Belçika": "Belgium",
  "İskoçya": "Scotland",
  "Suudi Arabistan": "Saudi Arabia",
  "ABD": "USA",
  "Brezilya": "Brazil",
  "Arjantin": "Argentina",
  "UEFA": null,
  "Uluslararası": null
};

const TYPE_MAP = { domestic: "League", cup: "Cup" };

function providerCountryFor(entry) {
  if (Object.prototype.hasOwnProperty.call(COUNTRY_MAP, entry.country)) {
    return COUNTRY_MAP[entry.country];
  }
  return null;
}

function providerTypeFor(entry) {
  return TYPE_MAP[entry.type] || null;
}

function nameCandidatesFor(entry) {
  const names = [entry.name, ...(entry.aliases || [])].filter(Boolean);
  return [...new Set(names.map((name) => normalizeText(name)))];
}

/**
 * Bir ülke grubu içinden tek bir hedefi seçer. leagueResolver.js'teki
 * selectSuperLig ile aynı iki aşamalı kural: tam eşleşme → gevşek eşleşme,
 * her aşamada TAM OLARAK BİR aday şart.
 */
function selectLeague(leagues, nameCandidates, providerType) {
  const all = leagues || [];
  const typeMatches = (league) => !providerType || normalizeText(league.type) === normalizeText(providerType);

  const exact = all.filter((league) => nameCandidates.includes(normalizeText(league.name)) && typeMatches(league));
  if (exact.length === 1) return { league: exact[0], candidates: exact, matched: true };
  if (exact.length > 1) return { league: null, candidates: exact, matched: true };

  const loose = all.filter((league) =>
    nameCandidates.some((name) => normalizeText(league.name).includes(name)) &&
    typeMatches(league) &&
    (providerType !== "League" || isSeniorMensLeague(league.name)));
  if (loose.length === 1) return { league: loose[0], candidates: loose, matched: true };
  if (loose.length > 1) return { league: null, candidates: loose, matched: true };

  const fallback = all.filter(typeMatches);
  return { league: null, candidates: fallback.length ? fallback : all, matched: false };
}

function toRegistryLeague(league) {
  return {
    leagueId: league.id,
    leagueName: league.name,
    country: league.country,
    logo: league.logo || null,
    coverage: league.coverage || null,
    currentSeasonYear: league.currentSeasonYear || null
  };
}

/**
 * Zaten sayısal bir kimliği olan kaydı `/leagues?id=` ile doğrular.
 * Kimliği DEĞİŞTİRMEZ — yalnızca hâlâ geçerli olduğunu ve metadata'sını
 * teyit eder. Sağlayıcı bu kimliği tanımıyorsa kayıt "unavailable" döner;
 * mevcut ID'ye elle dokunulmaz (üretimde çalışan bir değeri sessizce
 * silmemek için).
 */
async function verifyKnownId(provider, entry) {
  const idValue = entry.providers.apiFootball;
  let leagues = [];
  try {
    leagues = await provider.getLeagues({ id: idValue });
  } catch (error) {
    return {
      catalogId: entry.id,
      status: "unavailable",
      reason: error && error.code ? `provider-error:${error.code}` : "provider-error",
      candidates: []
    };
  }

  const match = leagues.find((league) => String(league.id) === String(idValue));
  if (!match) {
    return {
      catalogId: entry.id,
      status: "unavailable",
      reason: "id-not-found",
      candidates: []
    };
  }

  return {
    catalogId: entry.id,
    status: "resolved",
    mode: "id-verify",
    ...toRegistryLeague(match)
  };
}

/**
 * ID'si olmayan bir kaydı ülke grubu içinde ad/alias eşleşmesiyle arar.
 * `leaguesByCountry` çağıran tarafından paylaşılır — aynı ülkede birden
 * fazla hedef, aynı `/leagues` sonucunu yeniden kullanır.
 */
function resolveByNameSearch(entry, leaguesForCountry) {
  const nameCandidates = nameCandidatesFor(entry);
  const providerType = providerTypeFor(entry);
  const { league, candidates, matched } = selectLeague(leaguesForCountry, nameCandidates, providerType);

  if (!league) {
    return {
      catalogId: entry.id,
      status: "unavailable",
      reason: matched ? "ambiguous-match" : "no-match",
      candidates: candidates.map((item) => ({ id: item.id, name: item.name, country: item.country, type: item.type }))
    };
  }

  return {
    catalogId: entry.id,
    status: "resolved",
    mode: "name-search",
    ...toRegistryLeague(league)
  };
}

/**
 * Katalogdaki her kaydı bağımsız çözer. Biri belirsiz/eksik kalırsa
 * diğerleri etkilenmez — sonuç listesi her zaman `catalog.length` uzunlukta.
 *
 * @returns {Promise<{resolvedAt: string, results: Array}>}
 */
async function resolveLeagueRegistry(options = {}) {
  const provider = options.provider || apiFootballProvider;
  const entries = options.entries || catalog;
  const config = provider.getConfig();
  const season = options.season || config.season;

  if (!provider.hasConfig()) {
    return {
      resolvedAt: null,
      results: entries.map((entry) => ({ catalogId: entry.id, status: "unavailable", reason: "no-api-key", candidates: [] }))
    };
  }

  const idEntries = entries.filter((entry) => entry.providers && entry.providers.apiFootball !== null && entry.providers.apiFootball !== undefined);
  const searchEntries = entries.filter((entry) => !idEntries.includes(entry));

  const idResults = await Promise.all(idEntries.map((entry) => verifyKnownId(provider, entry)));

  // Ülkeye göre grupla: her benzersiz ülke için tek `/leagues` çağrısı.
  const countryGroups = new Map();
  for (const entry of searchEntries) {
    const providerCountry = providerCountryFor(entry);
    const key = providerCountry || "__no-country__";
    if (!countryGroups.has(key)) countryGroups.set(key, []);
    countryGroups.get(key).push(entry);
  }

  const searchResults = [];
  for (const [key, groupEntries] of countryGroups) {
    const providerCountry = key === "__no-country__" ? null : key;
    let leagues = [];
    try {
      leagues = providerCountry
        ? await provider.getLeagues({ country: providerCountry, season })
        : [];
    } catch (error) {
      const reason = error && error.code ? `provider-error:${error.code}` : "provider-error";
      groupEntries.forEach((entry) => searchResults.push({ catalogId: entry.id, status: "unavailable", reason, candidates: [] }));
      continue;
    }

    if (!leagues.length && providerCountry) {
      // Sezon daraltması boş dönebilir (bazı paketler sezon listesini eksik
      // verir) — Süper Lig çözümlemesindeki aynı ikinci deneme.
      try {
        leagues = await provider.getLeagues({ country: providerCountry });
      } catch {
        leagues = [];
      }
    }

    groupEntries.forEach((entry) => searchResults.push(resolveByNameSearch(entry, leagues)));
  }

  return {
    resolvedAt: new Date().toISOString(),
    results: [...idResults, ...searchResults]
  };
}

module.exports = {
  COUNTRY_MAP,
  TYPE_MAP,
  selectLeague,
  resolveLeagueRegistry
};
