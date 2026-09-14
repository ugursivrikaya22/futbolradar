/**
 * MAÇ DEFTERİ — oyuncu puanlarının "son 5-10 resmî maç" tabanı.
 *
 * Sezon kaydı (`data/players.json`) çoğu oyuncuda boş: kadro senkronu
 * istatistik uç noktasını çağırmıyor. Ama aynı verinin bir kısmı zaten
 * elimizde — maç arşivinde ve fikstür takviminde:
 *
 *   • `match.players[]` — sağlayıcının maç bazlı oyuncu istatistikleri
 *     (dakika, reyting, şut, pas, müdahale, ikili mücadele, kart).
 *   • `match.lineups[]` — ilk 11 ve yedekler; "oynadı mı, ilk 11 miydi"
 *     sorusunun doğrudan cevabı.
 *   • `match.events[]` — gol, asist ve kart olayları; oyuncu adı taşır.
 *
 * Bu modül üçünü tek bir oyuncu-maç defterine indirger. Defterdeki her satır
 * TEK bir maç kaydından gelir; toplamı uydurulmuş bir sezon tahmini değil,
 * sayılmış bir gerçektir.
 *
 * KAPSAM KURALI: yalnızca BİTMİŞ ve RESMÎ maçlar. Hazırlık maçları form
 * hesabına girmez — şartname "son 5-10 resmî maç" diyor ve bir hazırlık
 * maçındaki hat-trick lig formu değildir.
 */

/** Hazırlık/dostluk müsabakası kalıpları. */
const FRIENDLY_PATTERN = /friendl|hazırlık|hazirlik|club friendlies|pre-?season/i;

/** Bitmiş sayılan sağlayıcı durumları. */
const FINISHED_STATUS = new Set(["FINISHED", "FT", "AET", "PEN", "AWD", "WO"]);

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .replace(/İ/g, "i")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isFiniteNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function numberOrNull(value) {
  return isFiniteNumber(value) ? Number(value) : null;
}

function isOfficial(match) {
  if (match && match.isOfficialCompetition === false) return false;
  if (match && match.competitionType && String(match.competitionType).toLowerCase() === "friendly") return false;
  const name = String((match && (match.competition || match.league)) || "");
  return !FRIENDLY_PATTERN.test(name);
}

function isFinished(match) {
  const status = String((match && (match.status || match.providerStatus)) || "").toUpperCase();
  return FINISHED_STATUS.has(status);
}

function kickoffOf(match) {
  return (match && (match.kickoff || match.kickoffUtc || match.date)) || null;
}

/**
 * Olay satırından oyuncu adını ve (varsa) asist edenin adını çıkarır.
 *
 * Sağlayıcı biçimi: "O. Diabate · Asist: D. Goutas · Normal Goal".
 */
function parseEventValue(value) {
  const text = String(value || "");
  const parts = text.split("·").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return { player: null, assist: null };
  const player = parts[0] || null;
  const assistPart = parts.find((part) => /^asist\s*:/i.test(part) || /^assist\s*:/i.test(part));
  const assist = assistPart ? assistPart.replace(/^ass?ist\s*:\s*/i, "").trim() : null;
  return { player: player || null, assist: assist || null };
}

function ensureEntry(store, key, seed) {
  if (!store.has(key)) store.set(key, { ...seed });
  return store.get(key);
}

/**
 * Tek bir maçtan oyuncu satırlarını çıkarır.
 *
 * @returns {Map<string, object>} anahtar: providerPlayerId ya da "name:<ad>"
 */
function extractMatchRows(match) {
  const rows = new Map();
  const matchId = (match && (match.id || match.matchId)) || null;
  const kickoff = kickoffOf(match);
  const competition = (match && (match.competition || match.league)) || null;
  const label = matchId ? String(matchId) : competition || "";

  const seed = { matchId, kickoff, competition, label, played: false, started: false };

  const keyFor = (providerPlayerId, name) => {
    const id = String(providerPlayerId || "").trim();
    if (/^\d+$/.test(id)) return `pid:${id}`;
    const normalized = normalizeName(name);
    return normalized ? `name:${normalized}` : null;
  };

  // 1. Sağlayıcı maç istatistikleri — en zengin kaynak.
  for (const player of (match && match.players) || []) {
    const key = keyFor(player.providerPlayerId, player.name);
    if (!key) continue;
    const minutes = numberOrNull(player.minutes);
    const row = ensureEntry(rows, key, seed);
    row.name = row.name || player.name || null;
    row.providerPlayerId = player.providerPlayerId || row.providerPlayerId || null;
    row.team = player.team || row.team || null;
    row.position = player.position || row.position || null;
    if (minutes !== null) {
      row.minutes = minutes;
      row.played = minutes > 0;
    }
    // Sağlayıcı reytingi 0 gelirse bu bir ölçüm değil, boşluğun varsayılanı.
    const rating = numberOrNull(player.providerRating);
    if (rating !== null && rating > 0) row.rating = rating;
    for (const field of ["goals", "assists", "shots", "shotsOnTarget", "passes", "tackles",
      "interceptions", "blocks", "duelsWon", "duelsTotal", "saves", "keyPasses",
      "yellowCards", "redCards", "foulsCommitted"]) {
      const value = numberOrNull(player[field]);
      // Oyuncu sahaya çıkmadıysa alanların hepsi 0 gelir; ölçüm sayılmaz.
      if (value === null || (minutes !== null && minutes <= 0)) continue;
      row[field] = value;
    }
    const accuracy = numberOrNull(player.passAccuracy);
    if (accuracy !== null && accuracy > 0) row.passAccuracy = accuracy;
  }

  // 2. Kadro listeleri — oynadı/ilk 11 bilgisi.
  for (const lineup of (match && match.lineups) || []) {
    const team = lineup && lineup.team ? lineup.team : null;
    const starting = Array.isArray(lineup && lineup.startingDetails) && lineup.startingDetails.length
      ? lineup.startingDetails.map((item) => item && item.name)
      : (lineup && lineup.players) || [];
    for (const name of starting) {
      const key = keyFor(null, name);
      if (!key) continue;
      const row = ensureEntry(rows, key, seed);
      row.name = row.name || name;
      row.team = row.team || team;
      row.started = true;
      row.played = true;
    }
    const bench = Array.isArray(lineup && lineup.substituteDetails) && lineup.substituteDetails.length
      ? lineup.substituteDetails.map((item) => item && item.name)
      : (lineup && lineup.substitutes) || [];
    for (const name of bench) {
      const key = keyFor(null, name);
      if (!key) continue;
      const row = ensureEntry(rows, key, seed);
      row.name = row.name || name;
      row.team = row.team || team;
      // Yedek kulübesinde olmak oynamak değildir; oynadığı yalnızca oyuna
      // girdiğini gösteren bir olayla ya da dakika kaydıyla kanıtlanır.
      if (row.played === undefined) row.played = false;
    }
  }

  // 3. Olaylar — gol, asist, kart ve oyuna giriş.
  for (const event of (match && match.events) || []) {
    const type = String((event && event.type) || "").toLowerCase();
    const detail = String((event && event.detail) || "").toLowerCase();
    const { player, assist } = parseEventValue(event && event.value);
    const teamName = event && event.team && event.team.name ? event.team.name : null;

    if (player) {
      const key = keyFor(null, player);
      if (key) {
        const row = ensureEntry(rows, key, seed);
        row.name = row.name || player;
        row.team = row.team || teamName;
        if (type === "goal" && !detail.includes("missed")) {
          // Kendi kalesine gol oyuncunun hücum üretimi değildir.
          if (!detail.includes("own")) row.goals = (row.goals || 0) + 1;
          row.played = true;
        } else if (type === "card") {
          if (detail.includes("yellow")) row.yellowCards = (row.yellowCards || 0) + 1;
          if (detail.includes("red")) row.redCards = (row.redCards || 0) + 1;
          row.played = true;
        } else if (type === "subst") {
          // Sağlayıcı yedek değişikliklerinde "oyuna giren" adı ilk sırada,
          // "çıkan" ise asist alanında taşınır.
          row.played = true;
        }
      }
    }

    if (assist && type === "goal") {
      const key = keyFor(null, assist);
      if (key) {
        const row = ensureEntry(rows, key, seed);
        row.name = row.name || assist;
        row.team = row.team || teamName;
        row.assists = (row.assists || 0) + 1;
        row.played = true;
      }
    }
  }

  for (const row of rows.values()) {
    if (row.played === undefined) row.played = false;
  }

  return rows;
}

/**
 * Maç kaynaklarından oyuncu defterini kurar.
 *
 * @param {object} options
 * @param {Array} [options.archive] historical-match-archive.json kayıtları
 * @param {Array} [options.fixtures] fixture-calendar.json maçları
 * @param {number} [options.limitPerPlayer] oyuncu başına tutulacak maç sayısı
 * @returns {{byProviderId: Map, byName: Map, matchCount: number}}
 */
function buildPlayerMatchLedger(options) {
  const settings = options || {};
  const limit = Number(settings.limitPerPlayer) > 0 ? Number(settings.limitPerPlayer) : 15;
  const byProviderId = new Map();
  const byName = new Map();
  const seenMatches = new Set();
  let matchCount = 0;

  const consume = (match) => {
    if (!match || !isFinished(match) || !isOfficial(match)) return;
    const id = String((match.id || match.matchId || "") || "");
    if (id && seenMatches.has(id)) return;
    if (id) seenMatches.add(id);
    matchCount += 1;

    for (const [key, row] of extractMatchRows(match)) {
      if (!row.played) continue;
      const target = key.startsWith("pid:") ? byProviderId : byName;
      const bucketKey = key.slice(key.indexOf(":") + 1);
      if (!target.has(bucketKey)) target.set(bucketKey, []);
      target.get(bucketKey).push(row);
      // Sağlayıcı kimliği bilinen satır ADIYLA da aranabilsin: sezon kaydında
      // sağlayıcı kimliği olmayan oyuncular ada göre eşleşiyor.
      if (key.startsWith("pid:") && row.name) {
        const nameKey = normalizeName(row.name);
        if (nameKey) {
          if (!byName.has(nameKey)) byName.set(nameKey, []);
          byName.get(nameKey).push(row);
        }
      }
    }
  };

  for (const record of settings.archive || []) {
    consume(record && record.match ? record.match : record);
  }
  for (const match of settings.fixtures || []) {
    consume(match);
  }

  const sortAndTrim = (store) => {
    for (const [key, rows] of store) {
      rows.sort((a, b) => {
        const left = Date.parse(a.kickoff || "") || 0;
        const right = Date.parse(b.kickoff || "") || 0;
        return right - left;
      });
      // Aynı maç iki kaynaktan da gelmiş olabilir; maç kimliğiyle tekilleştir.
      const unique = [];
      const seen = new Set();
      for (const row of rows) {
        const identity = row.matchId || `${row.kickoff}|${row.competition}`;
        if (seen.has(identity)) continue;
        seen.add(identity);
        unique.push(row);
      }
      store.set(key, unique.slice(0, limit));
    }
  };

  sortAndTrim(byProviderId);
  sortAndTrim(byName);

  return { byProviderId, byName, matchCount };
}

/** Bir oyuncunun defter satırlarını döndürür (en yeni önce). */
function ledgerFor(ledger, player) {
  if (!ledger || !player) return [];
  const providerId = String(player.providerId || player.provider_id || "").trim();
  if (/^\d+$/.test(providerId) && ledger.byProviderId.has(providerId)) {
    return ledger.byProviderId.get(providerId);
  }

  const candidates = [player.name, player.fullName];
  for (const candidate of candidates) {
    const key = normalizeName(candidate);
    if (key && ledger.byName.has(key)) return ledger.byName.get(key);
  }

  return [];
}

module.exports = {
  buildPlayerMatchLedger,
  extractMatchRows,
  isOfficial,
  isFinished,
  ledgerFor,
  normalizeName,
  parseEventValue
};
