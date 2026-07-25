/**
 * Yerel maç kayıtlarını sağlayıcı fikstürleriyle eşleştirir.
 *
 * Eşleşme yalnızca aynı gün oynanan ve HER İKİ takım adı da yeterince
 * benzeyen fikstürlerde kurulur. Yanlış eşleşme, bir maçın istatistiklerini
 * başka bir maça yazmak demek olduğu için eşik yüksek tutulur ve belirsiz
 * durumlarda eşleştirme yapılmaz ("ambiguous" döner).
 */

/** Kulüp adlarında anlam taşımayan, kaynaktan kaynağa değişen ekler. */
const NOISE_TOKENS = new Set([
  "fc", "sk", "ac", "as", "sc", "cf", "afc", "if", "bk", "nk", "hk", "fk",
  "spor", "kulubu", "kulubü", "club", "calcio", "cd", "ud", "rc", "ss", "us",
  "1907", "jk", "gsk", "aek", "sv", "vfb", "vfl", "tsv", "bsc"
]);

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ş/g, "s")
    .replace(/ç/g, "c")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Ad, anlamlı sözcüklerine ayrılır; kulüp ekleri atılır. */
function tokens(name) {
  return normalizeText(name)
    .split(" ")
    .filter((token) => token && !NOISE_TOKENS.has(token));
}

/** 0-1 arası ad benzerliği: sözcük kesişimi + tam/parça eşleşme payı. */
function nameSimilarity(left, right) {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.length || !b.length) return 0;

  const setB = new Set(b);
  let hits = 0;
  for (const token of a) {
    if (setB.has(token)) {
      hits += 1;
      continue;
    }
    // "besiktas" ile "besiktasjk" gibi bitişik yazımlar
    if (b.some((other) => other.length > 3 && token.length > 3 && (other.startsWith(token) || token.startsWith(other)))) {
      hits += 0.85;
    }
  }
  return hits / Math.max(a.length, b.length);
}

function dateKey(value) {
  return String(value || "").slice(0, 10);
}

/**
 * Tek bir maç için aday fikstürleri puanlar.
 * Dönen `status`:
 *   matched   — tek bir aday eşiği geçti
 *   ambiguous — birden fazla aday yakın puanla eşiği geçti
 *   none      — eşiği geçen aday yok
 */
function matchFixture(match, candidates, options) {
  const minScore = (options && options.minScore) || 0.8;
  const margin = (options && options.margin) || 0.15;
  const targetDate = dateKey(match.kickoff || match.date);

  const scored = (candidates || [])
    .filter((candidate) => dateKey(candidate.kickoff || candidate.date) === targetDate)
    .map((candidate) => {
      const direct = Math.min(
        nameSimilarity(match.homeTeam, candidate.homeTeam),
        nameSimilarity(match.awayTeam, candidate.awayTeam)
      );
      // Kaynaklar nötr sahalı maçlarda ev/deplasman tarafını ters verebiliyor.
      const swapped = Math.min(
        nameSimilarity(match.homeTeam, candidate.awayTeam),
        nameSimilarity(match.awayTeam, candidate.homeTeam)
      );
      return { candidate, score: Math.max(direct, swapped), swapped: swapped > direct };
    })
    .filter((row) => row.score > 0)
    .sort((left, right) => right.score - left.score);

  if (!scored.length || scored[0].score < minScore) {
    return { status: "none", score: scored.length ? scored[0].score : 0, candidate: null };
  }

  if (scored.length > 1 && scored[0].score - scored[1].score < margin) {
    return { status: "ambiguous", score: scored[0].score, candidate: null, rivals: scored.slice(0, 2) };
  }

  return {
    status: "matched",
    score: scored[0].score,
    candidate: scored[0].candidate,
    sidesSwapped: scored[0].swapped
  };
}

module.exports = { normalizeText, tokens, nameSimilarity, matchFixture };
