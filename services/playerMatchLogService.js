/**
 * OYUNCU MAÇ GÜNLÜĞÜ — "Son Maçlar" bölümünün TEK kaynağı.
 *
 * Bu servis YENİ VERİ ÜRETMEZ. Elimizde zaten iki gerçek kayıt var:
 *
 *   • data/matches.json                     — editöryel/sağlayıcı maç kayıtları
 *   • data/historical-match-archive.json    — arşivlenmiş bitmiş maçlar
 *
 * İkisi de kadro (`lineups`) ve olay (`events`) taşıyor. Bir oyuncunun son
 * maçları bu iki kayıttan TÜRETİLİR: ilk 11'de miydi, kaçıncı dakikada
 * oyuna girdi/çıktı, gol/asist/kart aldı mı.
 *
 * ÜÇ SERT KURAL — hepsi "uydurma yok" ilkesinin doğrudan sonucu:
 *
 *   1. KANIT YOKSA SATIR YOK. Kadroda adı geçmeyen ve hiçbir olayda
 *      görünmeyen oyuncu için o maç listelenmez. "Oynamadı" da denmez:
 *      kadro verisi olmayan bir maçta oynamadığını BİLMİYORUZ.
 *
 *   2. DAKİKA TÜRETİLİR, UYDURULMAZ. Yalnızca iki uç da bilindiğinde
 *      basılır (ilk 11 + oyundan çıkış dakikası, ya da oyuna giriş
 *      dakikası). Maçta hiç `subst` olayı yoksa ilk 11'deki oyuncunun
 *      90 dakika oynadığı VARSAYILMAZ — dakika alanı boş kalır.
 *
 *   3. KULÜP EŞLEŞMESİ ZORUNLU. Yalnızca soyadına bakmak, aynı soyadı
 *      taşıyan iki oyuncuyu birbirine karıştırır. Eşleşme için oyuncunun
 *      kulübünün maçın taraflarından biri olması şart.
 *
 * AD EŞLEŞTİRME. Üç yazım aynı anda dolaşımda:
 *   kayıt "V. Osimhen" · kadro "V. Osimhen" · olay "Victor Osimhen"
 * Bu yüzden karşılaştırma soyadı + ilk harf üzerinden yapılır; aksanlar ve
 * Türkçe harfler normalize edilir. Belirsizlik (aynı kulüpte aynı soyadı +
 * aynı ilk harf) durumunda eşleşme REDDEDİLİR — yanlış oyuncuya gol yazmak,
 * hiç satır göstermemekten kötüdür.
 */

const DIACRITICS = /[̀-ͯ]/g;

/** Aksan, Türkçe harf ve noktalama farklarını siler. */
function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .replace(/ı/g, "i")
    .replace(/İ/g, "i")
    .replace(/ş/gi, "s")
    .replace(/ğ/gi, "g")
    .replace(/ç/gi, "c")
    .replace(/ö/gi, "o")
    .replace(/ü/gi, "u")
    .replace(/ø/gi, "o")
    .replace(/đ|ð/gi, "d")
    .replace(/ł/gi, "l")
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Ad öneki sayılan, soyadı olmayan parçacıklar. */
const NAME_PARTICLES = new Set(["de", "da", "di", "do", "dos", "del", "della", "van", "von",
  "der", "den", "el", "al", "la", "le", "bin", "ibn", "mc", "mac", "st"]);

/**
 * Bir adı eşleştirilebilir anahtara indirger.
 *
 * @returns {{surname: string, initial: string, tokens: string[]} | null}
 */
function nameKey(value) {
  const normalized = normalizeName(value);
  if (!normalized) return null;

  const tokens = normalized.split(" ").filter(Boolean);
  if (!tokens.length) return null;

  // Soyadı: sondan başlayarak ilk "parçacık olmayan" öbek. "van Dijk" →
  // "van dijk" olarak bütün tutulur, "dijk" diye kırpılmaz.
  let index = tokens.length - 1;
  const surnameParts = [tokens[index]];
  while (index - 1 >= 1 && NAME_PARTICLES.has(tokens[index - 1])) {
    index -= 1;
    surnameParts.unshift(tokens[index]);
  }

  const surname = surnameParts.join(" ");
  const initial = tokens.length > surnameParts.length ? tokens[0][0] : "";

  return { surname, initial, tokens };
}

/**
 * İki ad aynı kişiyi mi gösteriyor?
 *
 * Soyadı birebir eşleşmeli. İlk harf yalnızca İKİSİ DE biliniyorsa
 * karşılaştırılır: "Osimhen" (kadroda tek ad) ile "V. Osimhen" eşleşir,
 * ama "V. Osimhen" ile "K. Osimhen" eşleşmez.
 */
function namesMatch(left, right) {
  if (!left || !right) return false;
  if (left.surname !== right.surname) {
    // Tek kelimelik takma adlar ("Juan", "Rhaldney", "Janderson") soyadı
    // alanına düşer; bu durumda tam dizge eşleşmesi de kabul edilir.
    if (left.tokens.length === 1 || right.tokens.length === 1) {
      return left.tokens.join(" ") === right.tokens.join(" ");
    }
    return false;
  }
  if (left.initial && right.initial && left.initial !== right.initial) return false;
  return true;
}

/** Takım adlarını gevşek karşılaştırır ("Göztepe" ↔ "Goztepe A.Ş."). */
function teamsMatch(left, right) {
  const a = normalizeName(left);
  const b = normalizeName(right);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

/** "45+2'" → 45. Ekstra dakika taban dakikaya katlanmaz. */
function parseMinute(value) {
  const match = /(\d+)/.exec(String(value ?? ""));
  if (!match) return null;
  const minute = Number(match[1]);
  return Number.isFinite(minute) ? minute : null;
}

/**
 * Olay `value` alanı "Oyuncu · Asist: Diğer · Detay" biçiminde geliyor.
 * `subst` olaylarında ilk ad OYUNDAN ÇIKAN, ikinci ad OYUNA GİREN.
 */
function splitEventNames(event) {
  const raw = String((event && event.value) || "");
  const parts = raw.split("·").map((part) => part.trim()).filter(Boolean);
  const primary = parts[0] || "";
  const assistPart = parts.find((part) => /^asist\s*:/i.test(part) || /^assist\s*:/i.test(part));
  const secondary = assistPart ? assistPart.replace(/^(asist|assist)\s*:\s*/i, "").trim() : "";
  return { primary, secondary };
}

const GOAL_TYPES = /^(goal|gol)$/i;
const CARD_TYPES = /^(card|kart|sarı kart|sari kart|kırmızı kart|kirmizi kart)$/i;

function isOwnGoal(event) {
  return /own\s*goal|kendi kalesine/i.test(String((event && event.detail) || ""));
}

function isMissedPenalty(event) {
  return /missed\s*penalty|kaçan penaltı|kacan penalti/i.test(String((event && event.detail) || ""));
}

function cardColour(event) {
  const haystack = `${(event && event.detail) || ""} ${(event && event.value) || ""} ${(event && event.type) || ""}`;
  if (/red\s*card|kırmızı|kirmizi/i.test(haystack)) return "red";
  if (/yellow\s*card|sarı|sari/i.test(haystack)) return "yellow";
  return null;
}

/** Maç kaydını (matches.json ya da arşiv) tek bir şekle indirger. */
function normalizeMatchRecord(record) {
  const match = record && record.match ? record.match : record;
  if (!match || typeof match !== "object") return null;

  const home = match.homeTeam && typeof match.homeTeam === "object" ? match.homeTeam.name : match.homeTeam;
  const away = match.awayTeam && typeof match.awayTeam === "object" ? match.awayTeam.name : match.awayTeam;
  if (!home || !away) return null;

  const score = match.score || {};
  return {
    id: match.id || match.canonicalId || null,
    kickoff: match.kickoff || match.date || null,
    league: match.league || match.competition || null,
    stage: match.stage || null,
    homeTeam: String(home),
    awayTeam: String(away),
    homeScore: score.home !== null && score.home !== undefined && score.home !== "" && Number.isFinite(Number(score.home)) ? Number(score.home) : null,
    awayScore: score.away !== null && score.away !== undefined && score.away !== "" && Number.isFinite(Number(score.away)) ? Number(score.away) : null,
    status: match.status || null,
    lineups: Array.isArray(match.lineups) ? match.lineups : [],
    events: Array.isArray(match.events) ? match.events : []
  };
}

function isFinished(match) {
  const status = String(match.status || "").toUpperCase();
  if (status && !/FINISH|FT|ENDED|MAÇ SONU|PLAYED/i.test(status)) return false;
  return match.homeScore !== null && match.awayScore !== null;
}

/**
 * AYNI KİŞİNİN İKİ YAZIMI, İKİ KİŞİ DEĞİLDİR.
 *
 * Bir maçta aynı oyuncu üç ayrı yazımla geçebilir: kadroda "A. Maxim",
 * gol olayında "Alexandru Maxim", kart olayında yine kısaltılmış hâli. Ham
 * bir "birden fazla eşleşme varsa belirsizdir" sayımı bunların HEPSİNİ
 * ayrı kişi sayıp eşleşmeyi reddediyordu — ve tam da en çok olaya karışan,
 * yani sayfada en çok anlatacak şeyi olan oyuncular eleniyordu.
 *
 * Doğru ölçüt: eşleşen yazımlar birbiriyle BAĞDAŞMAZ mı? "A." ile
 * "Alexandru" bağdaşır (biri diğerinin kısaltması); "Alexandru" ile
 * "Andrei" bağdaşmaz — aynı kulüpte aynı soyadını taşıyan iki ayrı kişi
 * demektir ve o zaman eşleşme reddedilir.
 */
function firstNamesConflict(left, right) {
  const a = left.tokens.length > 1 ? left.tokens[0] : "";
  const b = right.tokens.length > 1 ? right.tokens[0] : "";
  if (!a || !b) return false;
  return !(a.startsWith(b) || b.startsWith(a));
}

function isAmbiguousWithin(names, key) {
  const variants = [];
  const seen = new Set();
  for (const name of names) {
    const candidate = nameKey(name);
    if (!candidate || !namesMatch(candidate, key)) continue;
    const signature = candidate.tokens.join(" ");
    if (seen.has(signature)) continue;
    seen.add(signature);
    variants.push(candidate);
  }

  for (let i = 0; i < variants.length; i += 1) {
    for (let j = i + 1; j < variants.length; j += 1) {
      if (firstNamesConflict(variants[i], variants[j])) return true;
    }
  }
  return false;
}

/** Maçtaki tüm ad geçişleri — belirsizlik denetimi için. */
function allNamesIn(match, teamName) {
  const names = [];
  for (const lineup of match.lineups) {
    if (teamName && !teamsMatch(lineup.team, teamName)) continue;
    names.push(...(lineup.players || []), ...(lineup.substitutes || []));
  }
  for (const event of match.events) {
    if (teamName && event.team && !teamsMatch(event.team.name || event.team, teamName)) continue;
    const { primary, secondary } = splitEventNames(event);
    if (primary) names.push(primary);
    if (secondary) names.push(secondary);
  }
  return names;
}

/**
 * Tek maç için oyuncu satırı.
 *
 * @returns {object|null} Kanıt yoksa null.
 */
function buildAppearance(match, player, key) {
  const playerTeams = [player.currentTeam, player.team].filter(Boolean);
  const side = playerTeams.some((name) => teamsMatch(name, match.homeTeam))
    ? "home"
    : playerTeams.some((name) => teamsMatch(name, match.awayTeam))
      ? "away"
      : null;
  if (!side) return null;

  const teamName = side === "home" ? match.homeTeam : match.awayTeam;
  if (isAmbiguousWithin(allNamesIn(match, teamName), key)) return null;

  const lineup = match.lineups.find((entry) => teamsMatch(entry.team, teamName)) || null;
  const started = Boolean(lineup && (lineup.players || []).some((name) => namesMatch(nameKey(name), key)));
  const onBench = Boolean(lineup && (lineup.substitutes || []).some((name) => namesMatch(nameKey(name), key)));

  let goals = 0;
  let assists = 0;
  let yellow = 0;
  let red = 0;
  let subbedOnAt = null;
  let subbedOffAt = null;
  let touchedByEvent = false;

  for (const event of match.events) {
    const eventTeam = event.team && (event.team.name || event.team);
    if (eventTeam && !teamsMatch(eventTeam, teamName)) continue;

    const { primary, secondary } = splitEventNames(event);
    const isPrimary = namesMatch(nameKey(primary), key);
    const isSecondary = namesMatch(nameKey(secondary), key);
    if (!isPrimary && !isSecondary) continue;

    const type = String(event.type || "");
    const minute = parseMinute(event.time);

    if (/^subst/i.test(type)) {
      touchedByEvent = true;
      if (isPrimary) subbedOffAt = minute;
      if (isSecondary) subbedOnAt = minute;
      continue;
    }

    if (GOAL_TYPES.test(type)) {
      if (isMissedPenalty(event)) { touchedByEvent = true; continue; }
      if (isPrimary && !isOwnGoal(event)) { goals += 1; touchedByEvent = true; }
      if (isSecondary) { assists += 1; touchedByEvent = true; }
      continue;
    }

    if (CARD_TYPES.test(type) || /kart|card/i.test(type)) {
      if (!isPrimary) continue;
      const colour = cardColour(event);
      if (colour === "red") red += 1;
      else if (colour === "yellow") yellow += 1;
      touchedByEvent = true;
    }
  }

  // KURAL 1: kanıt yoksa satır yok.
  if (!started && !touchedByEvent && !(onBench && subbedOnAt !== null)) return null;

  // An event stream may be incomplete. Another player's substitution does
  // not prove this player stayed on for 90 minutes or that the match lasted 90.
  let minutes = null;
  if (started && subbedOffAt !== null) minutes = subbedOffAt;
  else if (subbedOnAt !== null && subbedOffAt !== null) minutes = Math.max(0, subbedOffAt - subbedOnAt);

  const goalsFor = side === "home" ? match.homeScore : match.awayScore;
  const goalsAgainst = side === "home" ? match.awayScore : match.homeScore;
  const result = goalsFor === null || goalsAgainst === null
    ? null
    : goalsFor > goalsAgainst ? "win" : goalsFor < goalsAgainst ? "loss" : "draw";

  return {
    matchId: match.id,
    kickoff: match.kickoff,
    league: match.league,
    side,
    team: teamName,
    opponent: side === "home" ? match.awayTeam : match.homeTeam,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    scoreLine: match.homeScore === null || match.awayScore === null
      ? null
      : `${match.homeScore}-${match.awayScore}`,
    result,
    started: started ? true : subbedOnAt !== null ? false : null,
    subbedOnAt,
    subbedOffAt,
    minutes,
    goals,
    assists,
    yellowCards: yellow,
    redCards: red
  };
}

/**
 * Bir oyuncunun son maçları — en yeni en üstte.
 *
 * @param {object} player
 * @param {{matches?: any[], archive?: any[], limit?: number}} options
 * @returns {{appearances: object[], totals: object, evidence: {matchesScanned: number}}}
 */
function buildPlayerMatchLog(player, options = {}) {
  const empty = {
    appearances: [],
    totals: { matches: 0, starts: 0, goals: 0, assists: 0, yellowCards: 0, redCards: 0, minutes: null },
    evidence: { matchesScanned: 0 }
  };
  if (!player || !player.name) return empty;

  const key = nameKey(player.fullName && player.fullName.length > player.name.length ? player.fullName : player.name)
    || nameKey(player.name);
  if (!key) return empty;

  const sources = []
    .concat(Array.isArray(options.matches) ? options.matches : [])
    .concat(Array.isArray(options.archive) ? options.archive : []);

  const seen = new Set();
  const rows = [];
  for (const record of sources) {
    const match = normalizeMatchRecord(record);
    if (!match || !match.id || seen.has(match.id)) continue;
    seen.add(match.id);
    if (!isFinished(match)) continue;

    const appearance = buildAppearance(match, player, key);
    if (appearance) rows.push(appearance);
  }

  rows.sort((left, right) => String(right.kickoff || "").localeCompare(String(left.kickoff || "")));
  const limited = Number.isFinite(options.limit) ? rows.slice(0, options.limit) : rows;

  const totals = rows.reduce((acc, row) => ({
    matches: acc.matches + 1,
    starts: acc.starts + (row.started ? 1 : 0),
    goals: acc.goals + row.goals,
    assists: acc.assists + row.assists,
    yellowCards: acc.yellowCards + row.yellowCards,
    redCards: acc.redCards + row.redCards,
    minutes: row.minutes === null ? acc.minutes : (acc.minutes || 0) + row.minutes
  }), { matches: 0, starts: 0, goals: 0, assists: 0, yellowCards: 0, redCards: 0, minutes: null });

  return { appearances: limited, totals, evidence: { matchesScanned: seen.size } };
}

/**
 * KADRODAKİ ADI OYUNCU KAYDINA BAĞLAR — maç sayfasından profile giden yol.
 *
 * Maç kadrosunda "L. Gugeshashvili" yazıyor; hangi kayda gittiğini bilmeden
 * bağlantı basmak, okuyucuyu yanlış oyuncunun sayfasına götürür. Bu yüzden
 * aynı eşleştirici ve aynı sertlik geçerli:
 *
 *   • KULÜP ŞARTI. Yalnızca o maçta o takımın kadrosunda olan kayıtlar
 *     aday. Takım adı verilmezse eşleşme hiç denenmez.
 *   • TEK ADAY ŞARTI. Birden fazla kayıt eşleşiyorsa (aynı kulüpte aynı
 *     soyadı) `null` döner: bağlantı basılmaz. Yanlış profile giden bir
 *     bağlantı, bağlantısız bir isimden kötüdür.
 *
 * @returns {object|null} Eşleşen oyuncu kaydı ya da null.
 */
function resolvePlayerByName(name, teamName, players) {
  const key = nameKey(name);
  if (!key || !teamName || !Array.isArray(players)) return null;

  const candidates = players.filter((player) => {
    const club = player && (player.currentTeam || player.team);
    if (!club || !teamsMatch(club, teamName)) return false;
    return namesMatch(nameKey(player.fullName && player.fullName.length > player.name.length
      ? player.fullName
      : player.name), key);
  });

  return candidates.length === 1 ? candidates[0] : null;
}

module.exports = {
  buildPlayerMatchLog,
  resolvePlayerByName,
  namesMatch,
  nameKey,
  normalizeName,
  normalizeMatchRecord,
  parseMinute,
  splitEventNames,
  teamsMatch
};
