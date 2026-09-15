/**
 * MODEL GİRDİLERİNİ DOĞRULANMIŞ YEREL VERİDEN KURAR.
 *
 * FutbolRadar modeli sağlayıcıya İSTEK ATMADAN çalışır: bitmiş maçların
 * skorları (takvim + kalıcı arşiv), lig tablosu ve sakat/cezalı listesi
 * zaten depoda. Model bu yüzden kotadan bağımsızdır ve kota bittiğinde
 * bile her maçta bir tahmin üretilebilir.
 *
 * ---------------------------------------------------------------------
 * KİMLİK ÖNCE, İSİM SONRA
 * ---------------------------------------------------------------------
 * Takım eşleştirmesi önce sağlayıcı kimliğiyle (`homeTeamId`), sonra
 * normalleştirilmiş adla, en son bulanık kulüp eşleştirmesiyle
 * (`sameClub`) yapılır. Sıra önemli: "Real Madrid" ile "Real Madrid
 * Castilla"yı ayıran şey addaki fark değil, kimliktir. Bulanık eşleşme
 * en sona bırakılır ve sonucu ÖNBELLEKLENİR — aksi hâlde 600 fikstür ×
 * binlerce ad karşılaştırması derlemeyi dakikalarca uzatır.
 *
 * ---------------------------------------------------------------------
 * YALNIZCA MAÇTAN ÖNCEKİ MAÇLAR
 * ---------------------------------------------------------------------
 * Bir fikstürün girdisi, o fikstürün BAŞLAMA ANINDAN ÖNCE oynanmış
 * maçlarla sınırlıdır. Geçmişe dönük üretilen bir tahmin, sonradan
 * oynanmış maçları görürse "tahmin" olmaktan çıkar; doğruluk ölçümü de
 * (data/prediction-performance.json) anlamsızlaşır.
 */

const { normalizeText } = require("./matchRadarService");
const { sameClub } = require("./superLigTeams");
const model = require("./fixtureProbabilityModel");

const H2H_LIMIT = 5;
/** Model girdisi için taranan en fazla maç (takım başına, en yeniden eskiye). */
const HISTORY_LIMIT = 20;

function isFiniteNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function hasScore(match) {
  return Boolean(match && match.score) && isFiniteNumber(match.score.home) && isFiniteNumber(match.score.away);
}

function nameKey(value) {
  return normalizeText(value || "").replace(/\s+/g, " ").trim();
}

function kickoffMs(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Bitmiş maç havuzunu takım kimliği ve adına göre indeksler.
 * Aynı maç iki kaynaktan gelebilir (takvim + arşiv); kimlik anahtarıyla
 * tekilleştirilir, yoksa aynı sonuç forma iki kez sayılırdı.
 */
function buildMatchIndex(matches) {
  const byId = new Map();
  const byName = new Map();
  const seen = new Set();
  const names = [];

  const push = (map, key, match) => {
    if (!key) return;
    const list = map.get(key);
    if (list) list.push(match);
    else map.set(key, [match]);
  };

  for (const match of (Array.isArray(matches) ? matches : [])) {
    if (!hasScore(match) || !match.homeTeam || !match.awayTeam) continue;
    const identity = [
      nameKey(match.homeTeam),
      nameKey(match.awayTeam),
      String(match.kickoff || "").slice(0, 10)
    ].join("|");
    if (seen.has(identity)) continue;
    seen.add(identity);

    push(byId, match.homeTeamId ? String(match.homeTeamId) : null, match);
    push(byId, match.awayTeamId ? String(match.awayTeamId) : null, match);
    const homeKey = nameKey(match.homeTeam);
    const awayKey = nameKey(match.awayTeam);
    if (homeKey && !byName.has(homeKey)) names.push(homeKey);
    if (awayKey && !byName.has(awayKey)) names.push(awayKey);
    push(byName, homeKey, match);
    push(byName, awayKey, match);
  }

  return { byId, byName, names };
}

/** Lig tablosu satırını kimlik → ad sırasıyla bulur. */
function findStandingsRow(standings, competitionId, teamId, teamName) {
  const entry = standings && competitionId ? standings[competitionId] : null;
  const table = entry && Array.isArray(entry.table) ? entry.table : [];
  if (!table.length) return null;
  if (teamId) {
    const byId = table.find((row) => String(row.providerId || row.id || "") === String(teamId));
    if (byId) return byId;
  }
  const key = nameKey(teamName);
  const byName = table.find((row) => nameKey(row.team || row.name) === key);
  if (byName) return byName;
  return table.find((row) => sameClub(row.team || row.name, teamName)) || null;
}

function standingsTeamCount(standings, competitionId) {
  const entry = standings && competitionId ? standings[competitionId] : null;
  return entry && Array.isArray(entry.table) ? entry.table.length : null;
}

/** Sakat/cezalı listesinden bildirilmiş eksik sayısı. Liste yoksa null. */
function availabilityFor(squadStatuses, teamId, teamName) {
  const teams = squadStatuses && Array.isArray(squadStatuses.teams) ? squadStatuses.teams : [];
  if (!teams.length) return null;
  const row = teams.find((team) => {
    if (teamId && Array.isArray(team.absences) && team.absences.some((absence) => String(absence.teamId || "") === String(teamId))) return true;
    return sameClub(team.team, teamName);
  });
  if (!row) return null;
  // "Şüpheli" oyuncu kesin eksik değildir; yalnızca sakat/cezalı sayılır.
  const unavailable = Array.isArray(row.absences)
    ? row.absences.filter((absence) => ["injured", "suspended"].includes(String(absence.status || "").toLowerCase())).length
    : isFiniteNumber(row.absenceCount) ? Number(row.absenceCount) : 0;
  return { unavailableCount: unavailable, reportedAt: squadStatuses.updatedAt || null };
}

/**
 * Model motoru. Veri dosyaları bir kez okunur, indeksler bir kez kurulur;
 * her fikstür için yalnızca arama yapılır.
 *
 * @param {object} options
 * @param {Array}  options.finishedMatches  skoru olan bitmiş maçlar
 * @param {object} [options.standings]      data/league-standings.json
 * @param {object} [options.squadStatuses]  data/squad-statuses.json
 */
function createProbabilityEngine(options = {}) {
  const index = buildMatchIndex(options.finishedMatches);
  const standings = options.standings || null;
  const squadStatuses = options.squadStatuses || null;
  const aliasCache = new Map();
  const baselineCache = new Map();

  /** Bir takımın maçları: kimlik → ad → bulanık ad (önbellekli). */
  function matchesForTeam(teamId, teamName) {
    const collected = [];
    if (teamId && index.byId.has(String(teamId))) collected.push(...index.byId.get(String(teamId)));
    const key = nameKey(teamName);
    if (key && index.byName.has(key)) collected.push(...index.byName.get(key));

    if (!collected.length && key) {
      let aliases = aliasCache.get(key);
      if (!aliases) {
        aliases = index.names.filter((candidate) => candidate !== key && sameClub(candidate, teamName));
        aliasCache.set(key, aliases);
      }
      for (const alias of aliases) collected.push(...(index.byName.get(alias) || []));
    }

    const unique = [];
    const seen = new Set();
    for (const match of collected) {
      const identity = `${nameKey(match.homeTeam)}|${nameKey(match.awayTeam)}|${String(match.kickoff || "").slice(0, 10)}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      unique.push(match);
    }
    return unique;
  }

  function beforeKickoff(matches, kickoff) {
    const limit = kickoffMs(kickoff);
    if (limit === null) return matches;
    return matches.filter((match) => {
      const played = kickoffMs(match.kickoff);
      return played !== null && played < limit;
    });
  }

  /** Havuzdaki tüm bitmiş maçlar, kimlikle tekilleştirilmiş. */
  function uniquePool(competitionId, cutoffMs) {
    const unique = [];
    const seen = new Set();
    for (const list of index.byName.values()) {
      for (const match of list) {
        if (competitionId && String(match.competitionId || "") !== String(competitionId)) continue;
        if (cutoffMs !== null && cutoffMs !== undefined) {
          const played = kickoffMs(match.kickoff);
          if (played === null || played >= cutoffMs) continue;
        }
        const identity = `${nameKey(match.homeTeam)}|${nameKey(match.awayTeam)}|${String(match.kickoff || "").slice(0, 10)}`;
        if (seen.has(identity)) continue;
        seen.add(identity);
        unique.push(match);
      }
    }
    return unique;
  }

  /**
   * Ligin kendi gol ortalamaları — lig başına bir kez hesaplanır.
   *
   * Az maçlı lig kendi ortalamasına terk edilmez: 25 maçlık bir Avrupa
   * kupası örneklemi "maç başına 1.96 ev sahibi golü" gibi gerçek dışı
   * bir taban üretip λ'yı şişiriyordu. Taban, HAVUZUN TAMAMININ
   * ortalamasına örneklem büyüklüğüne göre çekilir.
   */
  function baselinesFor(competitionId, kickoff) {
    // TABAN DA MAÇTAN ÖNCESİNE BAKAR. Kesim olmadan, fikstürden SONRA
    // oynanmış maçlar lig ortalamasına karışıyordu; geçmişe dönük üretilen
    // bir tahmin, o gün bilinmeyen sonuçları görmüş oluyordu.
    const cutoff = kickoffMs(kickoff);
    const suffix = cutoff === null ? "" : `|${new Date(cutoff).toISOString().slice(0, 10)}`;
    const globalKey = `__all__${suffix}`;
    const key = `${competitionId || "__all__"}${suffix}`;
    if (baselineCache.has(key)) return baselineCache.get(key);

    if (!baselineCache.has(globalKey)) {
      baselineCache.set(globalKey, model.leagueBaselines(uniquePool(null, cutoff)));
    }
    const globalBaseline = baselineCache.get(globalKey);
    if (key === globalKey) return globalBaseline;

    const result = model.leagueBaselines(uniquePool(competitionId, cutoff), { fallback: globalBaseline });
    baselineCache.set(key, result);
    return result;
  }

  function teamMatcher(teamId, teamName) {
    const key = nameKey(teamName);
    return (candidate) => {
      const candidateKey = nameKey(candidate);
      if (!candidateKey) return false;
      if (candidateKey === key) return true;
      return sameClub(candidate, teamName);
    };
  }

  /**
   * Bir fikstür için FutbolRadar model tahmini. Veri yetersizse `null`
   * döner ve sebebi `lastReason` üzerinden okunabilir.
   */
  function modelFor(fixture) {
    if (!fixture || !fixture.homeTeam || !fixture.awayTeam) {
      return { prediction: null, reason: "fixture-incomplete" };
    }

    const homeMatches = beforeKickoff(matchesForTeam(fixture.homeTeamId, fixture.homeTeam), fixture.kickoff).slice(0, HISTORY_LIMIT);
    const awayMatches = beforeKickoff(matchesForTeam(fixture.awayTeamId, fixture.awayTeam), fixture.kickoff).slice(0, HISTORY_LIMIT);

    const isHomeTeam = teamMatcher(fixture.homeTeamId, fixture.homeTeam);
    const isAwayTeam = teamMatcher(fixture.awayTeamId, fixture.awayTeam);

    const homeProfile = model.buildTeamProfile({
      matches: homeMatches,
      isTeam: isHomeTeam,
      venue: "home",
      teamName: fixture.homeTeam,
      standingsRow: findStandingsRow(standings, fixture.competitionId, fixture.homeTeamId, fixture.homeTeam)
    });
    const awayProfile = model.buildTeamProfile({
      matches: awayMatches,
      isTeam: isAwayTeam,
      venue: "away",
      teamName: fixture.awayTeam,
      standingsRow: findStandingsRow(standings, fixture.competitionId, fixture.awayTeamId, fixture.awayTeam)
    });

    const h2hMatches = homeMatches.filter((match) =>
      (isHomeTeam(match.homeTeam) && isAwayTeam(match.awayTeam)) ||
      (isAwayTeam(match.homeTeam) && isHomeTeam(match.awayTeam))
    ).slice(0, H2H_LIMIT);

    const prediction = model.computeModelProbabilities({
      home: homeProfile,
      away: awayProfile,
      h2h: model.h2hSignal(h2hMatches, isHomeTeam),
      baselines: baselinesFor(fixture.competitionId, fixture.kickoff),
      teamCount: standingsTeamCount(standings, fixture.competitionId),
      availability: {
        home: availabilityFor(squadStatuses, fixture.homeTeamId, fixture.homeTeam),
        away: availabilityFor(squadStatuses, fixture.awayTeamId, fixture.awayTeam)
      }
    });

    if (!prediction) {
      // Model artık takım geçmişi olmadan da turnuvanın ÖLÇÜLMÜŞ taban
      // oranlarıyla çalışıyor (bkz. DATA_BASIS). Buraya düşmenin tek
      // anlamlı sebebi kaldı: ortada ölçülecek bitmiş maç yok, yani
      // taban da varsayım. O durumda gösterilecek gerçek sayı yoktur.
      const reason = homeProfile.overall.played === 0 && awayProfile.overall.played === 0
        ? "no-measured-baseline"
        : "insufficient-team-data";
      return { prediction: null, reason };
    }
    return { prediction, reason: null };
  }

  return { modelFor, matchesForTeam, baselinesFor };
}

module.exports = {
  createProbabilityEngine,
  buildMatchIndex,
  findStandingsRow,
  availabilityFor,
  hasScore,
  nameKey
};
