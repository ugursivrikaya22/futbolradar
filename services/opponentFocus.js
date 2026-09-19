/**
 * RAKİP DOSYASI — TRANSFER VERİMİ, ROTASYON VE FİKSTÜR YÜKÜ (saf modül).
 *
 * Maç sonu yazısının rakibe ayrılan bölümünü besler. Bugünkü kullanım
 * Galatasaray ve Okan Buruk tartışması; ama modül kulüp adı bilmiyor —
 * hangi takım karşıdaysa onun için aynı ölçümleri kurar. Bir kulübün adını
 * koda gömmek, o kulüp hakkında önceden verilmiş bir hüküm demek olurdu.
 *
 * ── SORU: "TRANSFERLER İLK GÜNKÜ ETKİYİ KAYBEDİYOR MU?" ─────────────────
 *
 * Bu soru ancak oyuncunun İLK maçları ile SON maçları ölçülüp
 * karşılaştırılırsa cevaplanır. Cevabı `playerMatchHistory.compareWindows`
 * veriyor; bu modül yalnızca kimin karşılaştırılacağını (kulübe yeni gelen
 * oyuncular) ve elde ne kadar ölçüm olduğunu belirliyor.
 *
 * ── ÖRNEKLEM YETMEZSE TEZ KURULMAZ ──────────────────────────────────────
 *
 * `evidence.windowsAvailable` yanlışsa yazı katmanı düşüş İDDİA ETMEZ.
 * Bu, isteğin en açık maddesinin ("desteklenmiyorsa 'düşüş' denmesin")
 * kodda karşılığıdır ve bilinçli olarak bir bayrak: metin katmanının
 * kendi kararına bırakılmış bir üslup meselesi değil.
 */

const {
  compareWindows,
  passRateFrom,
  declineVerdict,
  normalize,
  num,
  playerTimeline,
  teamPlayers
} = require("./playerMatchHistory.js");

/** Pencere karşılaştırması için oyuncu başına aranan en az maç sayısı. */
const WINDOW_SIZE = 5;
const WINDOW_MINIMUM = WINDOW_SIZE * 2;

function text(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

function sameTeam(left, right) {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function daysBetween(left, right) {
  const a = Date.parse(left);
  const b = Date.parse(right);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round(Math.abs(a - b) / (24 * 60 * 60 * 1000));
}


/**
 * HAZIRLIK MAÇI ROTASYON SAYMAZ.
 *
 * İlk sürüm bitmiş her maçın dizilişini sayıyordu ve Galatasaray için
 * elde tuttuğu üç dizilişin İKİSİ temmuz hazırlık maçıydı. Sonuç,
 * "ardışık iki diziliş arasında ortalama 9,5 değişiklik" gibi çarpıcı ama
 * ANLAMSIZ bir sayıydı: hazırlık maçında kadronun baştan aşağı değişmesi
 * rotasyon tercihi değil, hazırlık maçının tanımıdır. Resmî maç ile
 * hazırlık maçını aynı ortalamada toplamak, teknik direktöre yapmadığı
 * bir tercihi atfetmek olurdu.
 */
function isCompetitive(match) {
  const id = normalize(match && match.competitionId);
  const league = normalize(match && (match.league || match.competition));
  if (id.includes("hazirlik")) return false;
  return !/hazirlik|friendly|hazirlik maci|club friendlies|sezon oncesi/.test(`${id} ${league}`);
}

/** Kulübe gelen doğrulanmış transferler — en yeniden eskiye. */
function signingsFor(team, transfers, options = {}) {
  const season = text(options.season);
  const rows = (Array.isArray(transfers) ? transfers : [])
    .filter((row) => row && sameTeam(row.toTeam, team))
    // DOĞRULANMAMIŞ TRANSFER YAZIYA GİRMEZ. Bu sitede "iddia" ile
    // "resmî" ayrı şeyler; bir söylentiyi performans tartışmasının
    // öznesi yapmak ikisini karıştırmak olurdu.
    .filter((row) => text(row.status).toLowerCase() === "confirmed")
    .filter((row) => !season || text(row.season) === season);

  return rows.sort((left, right) => String(right.date).localeCompare(String(left.date)));
}

/**
 * Bu maçta ölçülen oyuncu satırı.
 *
 * Adlar sağlayıcıda kısaltılmış geliyor ("A. Batrakov"), transfer
 * kaydında tam ("Aleksey Batrakov"). Eşleştirme soyadı + baş harf
 * üzerinden yapılıyor; tutmuyorsa satır YOK sayılıyor, yaklaşık eşleşme
 * kabul edilmiyor — yanlış oyuncunun sayısını bir başkasının adının
 * altına yazmak, hiç yazmamaktan çok daha kötü.
 */
function matchRowFor(playerName, rows) {
  const full = normalize(playerName);
  if (!full) return null;
  const parts = full.split(/\s+/).filter(Boolean);
  const surname = parts[parts.length - 1];
  const initial = parts[0] ? parts[0][0] : "";

  for (const row of Array.isArray(rows) ? rows : []) {
    const candidate = normalize(row && row.name);
    if (!candidate) continue;
    if (candidate === full) return row;
    const candidateParts = candidate.split(/\s+/).filter(Boolean);
    const candidateSurname = candidateParts[candidateParts.length - 1];
    const candidateInitial = candidateParts[0] ? candidateParts[0][0] : "";
    if (candidateSurname === surname && candidateInitial === initial) return row;
  }
  return null;
}

/**
 * ROTASYON: aynı on bir mi çıkıyor?
 *
 * Ölçüt, bu kulübün ELDEKİ dizilişleri üzerinden: kaç farklı oyuncu ilk
 * 11'de başladı, kaçı her maçta başladı. Diziliş sayısı azsa sonuç yine
 * döner ama `matchesConsidered` ile birlikte — yazı katmanı örneklemi
 * okuyucuya söylemek zorunda.
 */
function rotationFor(team, pool) {
  const lineups = [];
  for (const match of Array.isArray(pool) ? pool : []) {
    if (!["FINISHED", "FT", "AET", "PEN"].includes(text(match.status).toUpperCase())) continue;
    if (/\bu(1[4-9]|2[0-3])\b/.test(normalize(match.id))) continue;
    if (!isCompetitive(match)) continue;
    const row = (Array.isArray(match.lineups) ? match.lineups : []).find((entry) => sameTeam(entry && entry.team, team));
    if (!row) continue;
    const players = (Array.isArray(row.players) ? row.players : Array.isArray(row.startXI) ? row.startXI : [])
      .map((entry) => normalize(typeof entry === "string" ? entry : entry && entry.name))
      .filter(Boolean);
    if (players.length < 11) continue;
    lineups.push({ matchId: text(match.id), date: text(match.kickoff).slice(0, 10), players, formation: text(row.formation) || null });
  }

  lineups.sort((left, right) => String(left.date).localeCompare(String(right.date)));
  if (!lineups.length) return { matchesConsidered: 0 };

  const counts = new Map();
  for (const lineup of lineups) {
    for (const player of lineup.players) counts.set(player, (counts.get(player) || 0) + 1);
  }
  const everPresent = [...counts.values()].filter((value) => value === lineups.length).length;
  const formations = [...new Set(lineups.map((row) => row.formation).filter(Boolean))];

  // Ardışık iki diziliş arasındaki ortalama değişiklik sayısı.
  let changeTotal = 0;
  let comparisons = 0;
  for (let index = 1; index < lineups.length; index += 1) {
    const previous = new Set(lineups[index - 1].players);
    const changes = lineups[index].players.filter((player) => !previous.has(player)).length;
    changeTotal += changes;
    comparisons += 1;
  }

  return {
    matchesConsidered: lineups.length,
    distinctStarters: counts.size,
    everPresent,
    formations,
    averageChanges: comparisons ? Math.round((changeTotal / comparisons) * 10) / 10 : null
  };
}

/** FİKSTÜR YÜKÜ: son 30/14 gündeki maç sayısı ve bu maç öncesi dinlenme. */
function congestionFor(team, pool, referenceIso) {
  const reference = Date.parse(referenceIso);
  if (!Number.isFinite(reference)) return null;

  const played = (Array.isArray(pool) ? pool : [])
    .filter((match) => sameTeam(match.homeTeam, team) || sameTeam(match.awayTeam, team))
    .filter((match) => !/\bu(1[4-9]|2[0-3])\b/.test(normalize(match.id)))
    .filter((match) => ["FINISHED", "FT", "AET", "PEN"].includes(text(match.status).toUpperCase()))
    // Fikstür yükü RESMÎ maçın yüküdür; hazırlık maçı bu tabloya girmez.
    .filter(isCompetitive)
    .map((match) => Date.parse(match.kickoff))
    .filter((value) => Number.isFinite(value) && value < reference)
    .sort((left, right) => right - left);

  if (!played.length) return null;
  const day = 24 * 60 * 60 * 1000;
  return {
    matches30d: played.filter((value) => reference - value <= 30 * day).length,
    matches14d: played.filter((value) => reference - value <= 14 * day).length,
    restDays: Math.round((reference - played[0]) / day)
  };
}

/**
 * Rakip dosyasının tam modeli.
 *
 * @param {object} input {team, match, pool, history, transfers, season, kickoff}
 */
function buildOpponentFocus(input = {}) {
  const team = text(input.team);
  if (!team) return null;

  const match = input.match || {};
  const matchRows = (Array.isArray(match.players) ? match.players : []).filter((row) => sameTeam(row && row.team, team));
  const lineup = (Array.isArray(match.lineups) ? match.lineups : []).find((row) => sameTeam(row && row.team, team)) || null;

  const signings = signingsFor(team, input.transfers, { season: input.season }).map((row) => {
    const name = text(row.playerName);
    const thisMatch = matchRowFor(name, matchRows);
    const seriesKey = thisMatch && thisMatch.providerPlayerId
      ? `p:${text(thisMatch.providerPlayerId)}`
      : null;
    const timeline = seriesKey ? playerTimeline(input.history, seriesKey) : [];
    const comparison = compareWindows(timeline, { size: WINDOW_SIZE, minimum: WINDOW_MINIMUM });

    return {
      name,
      date: text(row.date),
      type: text(row.type),
      fromTeam: text(row.fromTeam),
      position: text(row.position),
      fee: text(row.fee),
      daysAtClub: daysBetween(row.date, input.kickoff),
      // Bu maçta sahada mıydı, neyi ölçüldü?
      played: Boolean(thisMatch),
      started: lineup && thisMatch
        ? (Array.isArray(lineup.players) ? lineup.players : [])
            .some((entry) => normalize(typeof entry === "string" ? entry : entry && entry.name) === normalize(thisMatch.name))
        : null,
      thisMatch: thisMatch
        ? {
            minutes: num(thisMatch.minutes),
            rating: num(thisMatch.providerRating),
            goals: num(thisMatch.goals),
            assists: num(thisMatch.assists),
            shots: num(thisMatch.shots),
            shotsOnTarget: num(thisMatch.shotsOnTarget),
            passes: num(thisMatch.passes),
            // `passAccuracy` sağlayıcıda İSABETLİ PAS SAYISI; oran buradan
            // türetiliyor (bkz. trabzonsporColumnWriter.js → playerPassRate).
            accuratePasses: num(thisMatch.passAccuracy),
            passRate: passRateFrom(num(thisMatch.passAccuracy), num(thisMatch.passes)),
            duelsWon: num(thisMatch.duelsWon)
          }
        : null,
      // Zaman serisi: pencere karşılaştırması ancak buradan çıkar.
      series: { matches: timeline.length },
      comparison,
      decline: declineVerdict(comparison)
    };
  });

  const measured = signings.filter((row) => row.comparison && row.comparison.sufficient);

  return {
    team,
    manager: lineup && text(lineup.coach) ? text(lineup.coach) : null,
    formation: lineup && text(lineup.formation) ? text(lineup.formation) : null,
    signings,
    rotation: rotationFor(team, input.pool),
    congestion: congestionFor(team, input.pool, input.kickoff),
    squadSeries: teamPlayers(input.history, team).slice(0, 5),
    /**
     * KANIT DURUMU. Yazı katmanının tek bakacağı bayrak bu.
     *
     * `windowsAvailable` yanlışken düşüş tezi KURULMAZ; bunun yerine
     * ölçümün neden yapılamadığı okuyucuya açıkça yazılır.
     */
    evidence: {
      windowsAvailable: measured.length > 0,
      measuredSignings: measured.length,
      totalSignings: signings.length,
      windowSize: WINDOW_SIZE,
      required: WINDOW_MINIMUM,
      bestSeries: signings.reduce((best, row) => Math.max(best, row.series.matches), 0)
    }
  };
}

module.exports = {
  WINDOW_MINIMUM,
  isCompetitive,
  WINDOW_SIZE,
  buildOpponentFocus,
  congestionFor,
  matchRowFor,
  rotationFor,
  sameTeam,
  signingsFor
};
