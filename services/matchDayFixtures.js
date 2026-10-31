/**
 * BUGÜNÜN SÜPER LİG MAÇLARI — maç günü hatırlatması için.
 *
 * Yalnızca `data/super-lig-fixtures.json`daki, TARİHİ RESMÎ OLARAK
 * KESİNLEŞMİŞ (`fixtureStatus: "confirmed-date"`) ve henüz oynanmamış
 * (`SCHEDULED`) maçlar. Saat/tarih uydurulmaz: kickoff yoksa maç atlanır.
 * Gün sınırı Europe/Istanbul'a göre.
 */
const path = require("path");
const fs = require("fs");
const { sameClub } = require("./superLigTeams");
const { teamIdForName } = require("./teamIdentity");

function istanbulDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function istanbulTime(value) {
  return new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

/**
 * `require` ile (fs değil): Vercel paket izleyicisi dosyayı catch-all
 * işlevin paketine bu sayede kesin olarak koyar.
 */
function loadFixtures(root) {
  try {
    if (root) return JSON.parse(fs.readFileSync(path.join(root, "data", "super-lig-fixtures.json"), "utf8"));
    // eslint-disable-next-line global-require
    return require("../data/super-lig-fixtures.json");
  } catch (error) {
    return null;
  }
}

/** Takım adını `teams.json` kimliğine çevirir; sağlayıcı adı farklıysa (ör. "Çaykur Rizespor") kulüp eşleştirmesine düşer. */
function resolveTeamId(name, teams) {
  const direct = teamIdForName(name, teams);
  if (direct) return direct;
  const hit = (teams || []).find((team) => team && team.isCurrentSuperLigTeam !== false && sameClub(team.name, name));
  return hit ? String(hit.id) : null;
}

function todaysMatches({ today = istanbulDate(), fixtures = loadFixtures(), teams = [] } = {}) {
  const rounds = (fixtures && Array.isArray(fixtures.rounds)) ? fixtures.rounds : [];
  const out = [];
  for (const round of rounds) {
    for (const match of round.matches || []) {
      if (!match || !match.kickoff || match.fixtureStatus !== "confirmed-date") continue;
      if (match.status && match.status !== "SCHEDULED") continue;
      if (Number.isNaN(Date.parse(match.kickoff)) || istanbulDate(match.kickoff) !== today) continue;
      out.push({
        id: match.id,
        round: round.round,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        kickoff: match.kickoff,
        time: istanbulTime(match.kickoff),
        venue: match.venue || null,
        homeTeamId: resolveTeamId(match.homeTeam, teams),
        awayTeamId: resolveTeamId(match.awayTeam, teams)
      });
    }
  }
  return out.sort((a, b) => a.kickoff.localeCompare(b.kickoff));
}

module.exports = { istanbulDate, istanbulTime, loadFixtures, resolveTeamId, todaysMatches };
