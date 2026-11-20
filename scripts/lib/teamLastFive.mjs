/**
 * "<TAKIM> SON 5 MAÇ" — takım maçları sayfasındaki çapalı bölümün verisi.
 *
 * Yalnızca depodaki doğrulanmış kayıtlar: sağlayıcı takvimi
 * (data/fixture-calendar.json, kaynak API-Football) ve maç sonu rapor
 * sicili (data/post-match-reports.json). Skoru olmayan, bitmemiş ya da
 * hazırlık maçı olan kayıt listeye girmez; sonuç/gol sayısı yalnızca
 * tabeladaki skordan hesaplanır, hiçbir alan tahmin edilmez.
 *
 * Aynı maç iki kaynakta varsa (gün + iki kulüp) tek satır kalır; takvim
 * kaydı önceliklidir çünkü maç sayfası bağlantısı ondan kurulur.
 */

const FINISHED = "FINISHED";
const FRIENDLY_RE = /haz[ıi]rl[ıi]k|friendl/i;

function hasFinalScore(match) {
  const score = match && match.score;
  return Boolean(score) && score.home !== null && score.away !== null &&
    Number.isFinite(Number(score.home)) && Number.isFinite(Number(score.away));
}

function competitionOf(match) {
  return String((match && (match.league || match.competition)) || "").trim();
}

/**
 * @param {object} input
 * @param {{name:string}} input.team
 * @param {Array} input.calendar  fixture-calendar.json → matches
 * @param {Array} input.reports   post-match-reports.json → records (dosyası var olanlar)
 * @param {(a:string,b:string)=>boolean} input.sameClub
 * @param {(s:string)=>string} input.canonicalStatus
 * @param {(iso:string)=>string} input.istanbulDay
 * @param {number} [input.limit=5]
 */
export function lastFiveMatches({ team, calendar = [], reports = [], sameClub, canonicalStatus, istanbulDay, limit = 5 }) {
  const involves = (match) => sameClub(match.homeTeam, team.name) || sameClub(match.awayTeam, team.name);
  const eligible = (match) => match && match.kickoff && involves(match) &&
    canonicalStatus(match.status || match.providerStatus) === FINISHED &&
    hasFinalScore(match) && !FRIENDLY_RE.test(competitionOf(match));

  const rows = [];
  const seen = (match) => rows.some((row) => {
    if (istanbulDay(row.kickoff) !== istanbulDay(match.kickoff)) return false;
    const straight = sameClub(row.homeTeam, match.homeTeam) && sameClub(row.awayTeam, match.awayTeam);
    const swapped = sameClub(row.homeTeam, match.awayTeam) && sameClub(row.awayTeam, match.homeTeam);
    return straight || swapped;
  });
  const push = (match, origin) => {
    if (!eligible(match) || seen(match)) return;
    const home = sameClub(match.homeTeam, team.name);
    const goalsFor = Number(home ? match.score.home : match.score.away);
    const goalsAgainst = Number(home ? match.score.away : match.score.home);
    rows.push({
      kickoff: match.kickoff,
      league: competitionOf(match),
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      score: { home: Number(match.score.home), away: Number(match.score.away) },
      venue: home ? "İç saha" : "Deplasman",
      goalsFor,
      goalsAgainst,
      result: goalsFor > goalsAgainst ? "G" : goalsFor < goalsAgainst ? "M" : "B",
      origin,
      provider: origin === "calendar" ? String(match.source || "api-football") : String(match.provider || ""),
      match
    });
  };
  for (const match of calendar) push(match, "calendar");
  for (const report of reports) push(report, "report");
  return rows
    .sort((left, right) => String(right.kickoff).localeCompare(String(left.kickoff)))
    .slice(0, limit);
}

/** Satırlardan türetilen tek cümlelik bilanço; satır yoksa null. */
export function lastFiveSummary(rows, teamName) {
  if (!rows || !rows.length) return null;
  const count = (value) => rows.filter((row) => row.result === value).length;
  const scored = rows.reduce((sum, row) => sum + row.goalsFor, 0);
  const conceded = rows.reduce((sum, row) => sum + row.goalsAgainst, 0);
  return {
    played: rows.length,
    won: count("G"),
    drawn: count("B"),
    lost: count("M"),
    scored,
    conceded,
    points: count("G") * 3 + count("B"),
    sentence: `${teamName} son ${rows.length} resmî maçında ${count("G")} galibiyet, ${count("B")} beraberlik, ${count("M")} mağlubiyet aldı; ${scored} gol attı, ${conceded} gol yedi.`
  };
}

/** Tüm satırlar API-Football kaynaklı mı? (künye metni buna göre seçilir) */
export function allFromApiFootball(rows) {
  return rows.length > 0 && rows.every((row) => /api-?football/i.test(row.provider));
}

/**
 * "HANGİ TAKIM FORMDA?" SIRALAMASI — /hangi-takim-formda.html.
 *
 * Her takımın `lastFiveMatches` satırlarından (aynı hesap, aynı kaynak)
 * puan/gol bilançosu çıkarılır. Yalnızca 5 maçı tam olan takımlar sıralanır;
 * eksik olanlar "Güncelleniyor" ile sona yazılır, puanları tahmin edilmez.
 *
 * Eşitlik bozma (sayfada da aynen yazar): 1) son 5 maçtaki puan,
 * 2) son 5 maçtaki averaj (atılan − yenilen), 3) atılan gol,
 * 4) alfabetik sıra (tr).
 */
export const FORM_TIEBREAK_TEXT = "Sıralama son 5 resmî maçta toplanan puana göredir (galibiyet 3, beraberlik 1). Eşitlikte sırasıyla son 5 maçtaki averaj (atılan − yenilen), atılan gol sayısı ve takım adının alfabetik sırası belirleyicidir.";

export function rankFormTable(entries, size = 5) {
  const scored = entries.map(({ team, rows }) => {
    const summary = lastFiveSummary(rows, team.name);
    return {
      team,
      rows,
      complete: rows.length >= size,
      summary,
      goalDifference: summary ? summary.scored - summary.conceded : null,
      lastKickoff: rows.length ? rows[0].kickoff : null
    };
  });
  const complete = scored.filter((row) => row.complete).sort((a, b) =>
    (b.summary.points - a.summary.points) ||
    (b.goalDifference - a.goalDifference) ||
    (b.summary.scored - a.summary.scored) ||
    a.team.name.localeCompare(b.team.name, "tr"));
  const incomplete = scored.filter((row) => !row.complete).sort((a, b) => a.team.name.localeCompare(b.team.name, "tr"));
  complete.forEach((row, index) => { row.rank = index + 1; });
  incomplete.forEach((row) => { row.rank = null; });
  return { ranked: complete, pending: incomplete };
}
