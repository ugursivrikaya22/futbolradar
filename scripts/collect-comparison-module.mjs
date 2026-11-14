/**
 * KARŞILAŞTIRMA VERİSİ — TEK SEFERLİK TOPLAMA.
 *
 * Derlemeye veya cron'a BAĞLI DEĞİLDİR. Transfermarkt herkese açık JSON
 * uçlarından (tmapi) ve profil/transfer sayfasından okur; robots.txt
 * `User-agent: * / Allow: /` (wget kapalı). Çıktı statik JSON'dur.
 *
 * Uydurma yok: alan gelmezse null kalır. Kariyer toplamları maç
 * kayıtlarının toplamıdır ve kaynak URL'si maç günlüğüdür.
 *
 * Kullanım: node scripts/collect-comparison-module.mjs
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const OUT_DIR = path.join(root, "data", "comparison-module", "players");
const RETRIEVED_AT = "2026-11-14";
const UA = "Mozilla/5.0 (compatible; FutbolRadarEditorial/1.0; +https://www.futbolradar.com)";
const API = "https://tmapi.transfermarkt.technology";

/** Öncelik sırası. İsim, kimliği doğrulamak içindir; uymayan kayıt yazılmaz. */
const WANTED = [
  ["401923", "Victor Osimhen"],
  ["541537", "Barış Alper Yılmaz"],
  ["192565", "Leroy Sané"],
  ["53622", "İlkay Gündoğan"],
  ["292199", "Uğurcan Çakır"],
  ["553469", "Gabriel Sara"],
  ["396908", "Yunus Akgün"],
  ["318077", "Lucas Torreira"],
  ["532826", "Mason Greenwood"],
  ["382528", "Kerem Aktürkoğlu"],
  ["465830", "Mattéo Guendouzi"],
  ["613725", "İsmail Yüksek"],
  ["671591", "Dorgeles Nene"],
  ["357498", "Dušan Vlahović"],
  ["144028", "Leandro Trossard"],
  ["571607", "Fabio Miretti"],
  ["683895", "Emmanuel Agbadou"],
  ["148455", "Mohamed Salah"],
  ["234509", "André Onana"],
  ["583917", "Ernest Muci"],
  ["672803", "Bertuğ Yıldırım"],
  ["358166", "Eldor Shomurodov"],
  ["861410", "Arda Güler"],
  ["845654", "Kenan Yıldız"],
  ["126414", "Hakan Çalhanoğlu"],
  ["369316", "Ferdi Kadıoğlu"],
  ["454567", "Orkun Kökçü"],
  ["340879", "Merih Demiral"],
  ["418560", "Erling Haaland"],
  ["342229", "Kylian Mbappé"],
  ["581678", "Jude Bellingham"],
  ["937958", "Lamine Yamal"],
  ["132098", "Harry Kane"],
  ["371998", "Vinicius Junior"],
  ["8198", "Cristiano Ronaldo"],
  ["28003", "Lionel Messi"],
  ["68290", "Neymar"]
];

const clubCache = new Map();
const competitionCache = new Map();

function slugify(name) {
  const map = { ş: "s", Ş: "s", ğ: "g", Ğ: "g", ü: "u", Ü: "u", ö: "o", Ö: "o", ç: "c", Ç: "c", ı: "i", İ: "i", â: "a", î: "i", û: "u", ă: "a" };
  const folded = String(name || "").replace(/[şŞğĞüÜöÖçÇıİâîûă]/g, (ch) => map[ch] || ch);
  return folded.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function lastToken(name) {
  const slug = slugify(name);
  const parts = slug.split("-").filter(Boolean);
  return parts[parts.length - 1] || slug;
}

async function getJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": UA } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

async function getText(url) {
  const response = await fetch(url, { headers: { Accept: "text/html", "User-Agent": UA } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapPool(items, limit, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  });
  if (workers.length) await Promise.all(workers);
}

async function clubOf(id) {
  const key = String(id || "");
  if (!key || key === "0") return null;
  if (clubCache.has(key)) return clubCache.get(key);
  await sleep(40);
  const data = (await getJson(`${API}/club/${key}`)).data;
  const record = {
    id: key,
    name: data.name || null,
    competitionId: data.baseDetails?.primaryCompetitionId || null
  };
  clubCache.set(key, record);
  return record;
}

async function competitionOf(id) {
  const key = String(id || "");
  if (!key) return null;
  if (competitionCache.has(key)) return competitionCache.get(key);
  await sleep(40);
  try {
    const data = (await getJson(`${API}/competition/${encodeURIComponent(key)}`)).data;
    const record = { id: key, name: data.name || null };
    competitionCache.set(key, record);
    return record;
  } catch {
    competitionCache.set(key, null);
    return null;
  }
}

function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function cardCount(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object") return 1;
  return 0;
}

function round1(value) {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 10) / 10;
}

function ageOn(birthDate, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate || "")) return null;
  const [y, m, d] = birthDate.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  let age = ty - y;
  if (tm < m || (tm === m && td < d)) age -= 1;
  return age >= 0 && age < 80 ? age : null;
}

function parseNationality(html) {
  const span = html.match(/<span[^>]*itemprop="nationality"[^>]*>([\s\S]{0,500}?)<\/span>/i);
  if (!span) return null;
  const text = span[1].replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  return text || null;
}

function parseWeightKg(html) {
  const match = html.match(/Weight:\s*<\/span>\s*<span[^>]*>\s*([^<]+)/i);
  if (!match) return null;
  const kg = match[1].replace(/\s+/g, " ").trim();
  const number = kg.match(/(\d{2,3}(?:[.,]\d+)?)/);
  if (!number) return null;
  const value = Number(number[1].replace(",", "."));
  if (!Number.isFinite(value) || value < 40 || value > 150) return null;
  return value;
}

function parseYouth(html) {
  const block = html.match(/Youth clubs<\/h2>\s*<div class="content">\s*([^<]+)/i);
  if (!block) return [];
  const raw = block[1].replace(/\s+/g, " ").trim();
  if (!raw || /^-?$/.test(raw)) return [];
  return raw.split(/\s*,\s*/).map((part) => {
    const match = part.match(/^(.*?)\s*\((\d{2})\/(\d{4})-(\d{2})\/(\d{4})\)\s*$/);
    if (!match) return { club: part.trim() || null, from: null, until: null, raw: part.trim() };
    return {
      club: match[1].trim(),
      from: `${match[3]}-${match[2]}`,
      until: `${match[5]}-${match[4]}`,
      raw: part.trim()
    };
  }).filter((row) => row.club);
}

function normalizeClubName(name) {
  return slugify(name || "");
}

async function buildPlayer(id, expectedName) {
  const profileUrlApi = `${API}/player/${id}`;
  const player = (await getJson(profileUrlApi)).data;
  const actual = player.name || "";
  if (lastToken(actual) !== lastToken(expectedName) && !slugify(actual).includes(lastToken(expectedName))) {
    throw new Error(`kimlik uyuşmadı: beklendi ${expectedName}, geldi ${actual}`);
  }

  const relative = player.relativeUrl || "";
  const profilePage = relative.startsWith("/") ? `https://www.transfermarkt.com${relative}` : null;
  const transfersPage = profilePage ? profilePage.replace("/profil/", "/transfers/") : `https://www.transfermarkt.com/-/transfers/spieler/${id}`;
  await sleep(150);
  const html = await getText(transfersPage);
  const nationality = parseNationality(html);
  const weightKg = parseWeightKg(html);
  const youth = parseYouth(html);

  const current = (player.clubAssignments || []).find((row) => row.type === "current") || null;
  const club = current ? await clubOf(current.clubId) : null;
  const league = club?.competitionId ? await competitionOf(club.competitionId) : null;
  const heightM = num(player.attributes?.height);
  const heightCm = heightM == null ? null : (heightM < 3 ? Math.round(heightM * 100) : Math.round(heightM));
  const birthDate = player.lifeDates?.isDateOfBirthUnknown ? null : (player.lifeDates?.dateOfBirth || null);

  await sleep(150);
  const performance = (await getJson(`https://www.transfermarkt.com/ceapi/performance-game/${id}`)).data;
  const matchesRaw = Array.isArray(performance?.performance) ? performance.performance : [];

  const clubIds = new Set();
  const competitionIds = new Set();
  for (const row of matchesRaw) {
    const info = row.clubsInformation || {};
    if (info.opponent?.clubId) clubIds.add(String(info.opponent.clubId));
    if (info.club?.clubId) clubIds.add(String(info.club.clubId));
    if (row.statistics?.generalStatistics?.primaryClubId) clubIds.add(String(row.statistics.generalStatistics.primaryClubId));
    if (row.gameInformation?.competitionId) competitionIds.add(String(row.gameInformation.competitionId));
  }

  await sleep(150);
  const historyPayload = (await getJson(`${API}/transfer/history/player/${id}`)).data;
  const transfers = Array.isArray(historyPayload?.history?.terminated) ? historyPayload.history.terminated : [];
  for (const transfer of transfers) {
    if (transfer.transferDestination?.clubId) clubIds.add(String(transfer.transferDestination.clubId));
    if (transfer.transferSource?.clubId) clubIds.add(String(transfer.transferSource.clubId));
    if (transfer.transferDestination?.competitionId) competitionIds.add(String(transfer.transferDestination.competitionId));
  }
  if (club?.id) clubIds.add(club.id);

  await mapPool([...clubIds], 6, async (clubId) => {
    try { await clubOf(clubId); } catch { clubCache.set(clubId, null); }
  });
  await mapPool([...competitionIds], 4, async (competitionId) => {
    await competitionOf(competitionId);
  });

  const matches = matchesRaw.map((row) => {
    const info = row.gameInformation || {};
    const clubs = row.clubsInformation || {};
    const stats = row.statistics || {};
    const general = stats.generalStatistics || {};
    const goals = stats.goalStatistics || {};
    const cards = stats.cardStatistics || {};
    const time = stats.playingTimeStatistics || {};
    const opponentId = clubs.opponent?.clubId ? String(clubs.opponent.clubId) : null;
    const ownClubId = general.primaryClubId ? String(general.primaryClubId) : (clubs.club?.clubId ? String(clubs.club.clubId) : null);
    const competitionId = info.competitionId ? String(info.competitionId) : null;
    const date = (info.date?.dateTimeUTC || "").slice(0, 10) || null;
    const played = (num(time.playedMinutes) || 0) > 0 || general.participationState === "played";
    return {
      date,
      competitionId,
      competition: competitionCache.get(competitionId)?.name || null,
      clubId: ownClubId,
      opponentClubId: opponentId,
      opponent: opponentId ? (clubCache.get(opponentId)?.name || null) : null,
      played,
      started: time.isStarting === true,
      minutes: num(time.playedMinutes),
      goals: num(goals.goalsScoredTotal),
      assists: num(goals.assists),
      yellow: cardCount(cards.yellowCardGross) || cardCount(cards.yellowCard),
      red: cardCount(cards.redCard) + cardCount(cards.yellowRedCard),
      teamGoals: num(clubs.club?.goalsTotal),
      opponentGoals: num(clubs.opponent?.goalsTotal),
      shirtNumber: num(general.shirtNumber),
      passes: num(stats.distributionStatistics?.passes),
      passesReached: num(stats.distributionStatistics?.passesReached),
      tackles: num(stats.duelStatistics?.tackles),
      saves: num(goals.scoringGoalkeeperSaves)
    };
  }).filter((row) => row.date);

  matches.sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0);

  const playedRows = matches.filter((row) => row.played);
  const sum = (rows, key) => rows.reduce((total, row) => total + (row[key] || 0), 0);
  const passes = sum(matches, "passes");
  const passesReached = sum(matches, "passesReached");
  const seasonMap = new Map();
  for (const row of playedRows) {
    const key = `${row.date.slice(0, 4)}|${row.competitionId || ""}`;
    // Sezon kimliği maç tarihinden değil kaynak sezonundan gelsin: tarih yılı
    // devre arası sezonu böler. competition satırında season yok; date yılını
    // kullanmak YANLIŞ olur. Aşağıda ham kayıttan seasonId okunur.
    seasonMap.set(key, true);
  }

  const seasons = [];
  const seasonBucket = new Map();
  for (const row of matchesRaw) {
    const info = row.gameInformation || {};
    const time = row.statistics?.playingTimeStatistics || {};
    const general = row.statistics?.generalStatistics || {};
    const played = (num(time.playedMinutes) || 0) > 0 || general.participationState === "played";
    if (!played) continue;
    const season = info.season?.display || null;
    const competitionId = info.competitionId ? String(info.competitionId) : null;
    const key = `${season || "?"}|${competitionId || ""}`;
    if (!seasonBucket.has(key)) {
      seasonBucket.set(key, {
        season,
        seasonId: num(info.seasonId),
        competitionId,
        competition: competitionCache.get(competitionId)?.name || null,
        appearances: 0,
        goals: 0,
        assists: 0,
        minutes: 0,
        yellowCards: 0,
        redCards: 0
      });
    }
    const bucket = seasonBucket.get(key);
    const goals = row.statistics?.goalStatistics || {};
    const cards = row.statistics?.cardStatistics || {};
    bucket.appearances += 1;
    bucket.goals += num(goals.goalsScoredTotal) || 0;
    bucket.assists += num(goals.assists) || 0;
    bucket.minutes += num(time.playedMinutes) || 0;
    bucket.yellowCards += cardCount(cards.yellowCardGross) || cardCount(cards.yellowCard);
    bucket.redCards += cardCount(cards.redCard) + cardCount(cards.yellowRedCard);
  }
  for (const bucket of seasonBucket.values()) seasons.push(bucket);
  seasons.sort((a, b) => (b.seasonId || 0) - (a.seasonId || 0) || String(a.competition).localeCompare(String(b.competition)));

  const orderedTransfers = transfers.slice().sort((a, b) => String(a.details?.date || "").localeCompare(String(b.details?.date || "")));
  const stints = [];
  for (let index = 0; index < orderedTransfers.length; index += 1) {
    const transfer = orderedTransfers[index];
    const next = orderedTransfers[index + 1] || null;
    const destId = transfer.transferDestination?.clubId ? String(transfer.transferDestination.clubId) : null;
    const clubRecord = destId ? clubCache.get(destId) : null;
    const competitionId = transfer.transferDestination?.competitionId ? String(transfer.transferDestination.competitionId) : (clubRecord?.competitionId || null);
    const from = (transfer.details?.date || "").slice(0, 10) || null;
    const until = next ? ((next.details?.date || "").slice(0, 10) || null) : null;
    const type = transfer.typeDetails?.type || null;
    const clubName = clubRecord?.name || null;
    const loanSpell = type === "ACTIVE_LOAN_TRANSFER" || type === "LOAN" || type === "LOAN_TRANSFER";
    const shirts = new Set();
    for (const match of matches) {
      if (!from || !match.date || match.clubId !== destId) continue;
      if (match.date < from) continue;
      if (until && match.date >= until) continue;
      if (match.shirtNumber != null) shirts.add(match.shirtNumber);
    }
    const competitionName = (competitionId && competitionCache.get(competitionId)?.name) || null;
    const youthByLabel = /(?:\bU1[0-9]\b|\bU2[0-3]\b|Youth|Junior)/i.test(`${clubName || ""} ${competitionName || ""}`);
    const youthByDates = youth.some((row) => {
      if (!clubName || normalizeClubName(row.club) !== normalizeClubName(clubName) || !row.from || !from) return false;
      const start = from.slice(0, 7);
      const end = (until || "9999-99").slice(0, 7);
      return start < (row.until || "9999-99") && end > row.from;
    });
    stints.push({
      club: clubName,
      clubId: destId,
      from,
      until: next ? until : null,
      seasonJoined: transfer.details?.season?.display || null,
      seasonLeft: next?.details?.season?.display || null,
      transferType: type,
      isLoan: type ? loanSpell : null,
      level: youthByLabel || youthByDates ? "youth" : null,
      shirtNumbers: shirts.size ? [...shirts].sort((a, b) => a - b) : null,
      competition: competitionName
    });
  }

  const coveredYouth = new Set(stints.map((stint) => normalizeClubName(stint.club)));
  for (const row of youth) {
    if (coveredYouth.has(normalizeClubName(row.club))) continue;
    stints.unshift({
      club: row.club,
      clubId: null,
      from: row.from,
      until: row.until,
      seasonJoined: null,
      seasonLeft: null,
      transferType: null,
      isLoan: null,
      level: "youth",
      shirtNumbers: null,
      competition: null
    });
  }

  const last5 = playedRows.slice(0, 5).map((row) => ({
    date: row.date,
    competition: row.competition,
    opponent: row.opponent,
    minutes: row.minutes,
    goals: row.goals,
    assists: row.assists,
    yellow: row.yellow,
    red: row.red,
    teamGoals: row.teamGoals,
    opponentGoals: row.opponentGoals
  }));

  const performanceSource = `https://www.transfermarkt.com/ceapi/performance-game/${id}`;
  const transferSource = `${API}/transfer/history/player/${id}`;

  return {
    slug: slugify(actual),
    transfermarktId: String(id),
    name: actual,
    retrievedAt: RETRIEVED_AT,
    identity: {
      sourceUrl: profileUrlApi,
      profileUrl: profilePage,
      retrievedAt: RETRIEVED_AT,
      name: actual,
      birthDate,
      ageYears: ageOn(birthDate, RETRIEVED_AT),
      heightCm,
      weightKg,
      preferredFoot: player.attributes?.preferredFoot?.name || null,
      position: player.attributes?.position?.name || null,
      positionGroup: player.attributes?.positionGroup || null,
      nationality,
      nationalitySourceUrl: nationality ? transfersPage : null,
      club: club?.name || null,
      clubId: club?.id || null,
      league: league?.name || null,
      leagueId: league?.id || null,
      shirtNumber: num(current?.shirtNumber)
    },
    career: {
      sourceUrl: performanceSource,
      retrievedAt: RETRIEVED_AT,
      appearances: playedRows.length,
      goals: sum(playedRows, "goals"),
      assists: sum(playedRows, "assists"),
      minutes: sum(playedRows, "minutes"),
      yellowCards: sum(playedRows, "yellow"),
      redCards: sum(playedRows, "red"),
      derived: true
    },
    seasons: {
      sourceUrl: performanceSource,
      retrievedAt: RETRIEVED_AT,
      rows: seasons
    },
    technical: {
      sourceUrl: performanceSource,
      retrievedAt: RETRIEVED_AT,
      passAccuracy: passes > 0 ? round1((100 * passesReached) / passes) : null,
      passes: passes > 0 ? passes : null,
      passesReached: passes > 0 ? passesReached : null,
      dribbles: null,
      dispossessed: null,
      tackles: matches.some((row) => row.tackles != null) ? sum(matches, "tackles") : null,
      saves: matches.some((row) => row.saves != null) ? sum(matches, "saves") : null,
      xg: null,
      xa: null
    },
    last5: {
      sourceUrl: performanceSource,
      retrievedAt: RETRIEVED_AT,
      rows: last5
    },
    matches: {
      sourceUrl: performanceSource,
      retrievedAt: RETRIEVED_AT,
      rows: matches.map((row) => ({
        date: row.date,
        competition: row.competition,
        opponent: row.opponent,
        minutes: row.played ? row.minutes : row.minutes,
        goals: row.goals,
        assists: row.assists,
        yellow: row.yellow,
        red: row.red,
        played: row.played,
        teamGoals: row.teamGoals,
        opponentGoals: row.opponentGoals
      }))
    },
    careerClubs: {
      sourceUrl: transferSource,
      pageUrl: transfersPage,
      youthSourceUrl: youth.length ? transfersPage : null,
      retrievedAt: RETRIEVED_AT,
      stints
    }
  };
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const index = [];
const failures = [];
for (const [id, expected] of WANTED) {
  const preset = fs.readdirSync(OUT_DIR).find((name) => name.endsWith(".json") && fs.readFileSync(path.join(OUT_DIR, name), "utf8").includes(`"transfermarktId":"${id}"`));
  if (preset) {
    const player = JSON.parse(fs.readFileSync(path.join(OUT_DIR, preset), "utf8"));
    index.push({ slug: player.slug, name: player.name, club: player.identity.club, league: player.identity.league, positionGroup: player.identity.positionGroup });
    process.stderr.write(`skip ${player.slug}\n`);
    continue;
  }
  try {
    process.stderr.write(`collect ${expected} (${id})\n`);
    const player = await buildPlayer(id, expected);
    const file = path.join(OUT_DIR, `${player.slug}.json`);
    fs.writeFileSync(file, `${JSON.stringify(player)}\n`);
    index.push({
      slug: player.slug,
      name: player.name,
      club: player.identity.club,
      league: player.identity.league,
      positionGroup: player.identity.positionGroup
    });
    process.stderr.write(`  ok ${player.slug} ${player.identity.club} / ${player.identity.nationality} apps=${player.career.appearances} stints=${player.careerClubs.stints.length}\n`);
  } catch (error) {
    failures.push({ id, expected, error: error.message });
    process.stderr.write(`  FAIL ${expected}: ${error.message}\n`);
  }
}

fs.writeFileSync(path.join(root, "data", "comparison-module", "index.json"), `${JSON.stringify({
  retrievedAt: RETRIEVED_AT,
  source: "Transfermarkt tmapi + public player/transfer pages",
  players: index,
  failures
}, null, 2)}\n`);
console.log(`wrote ${index.length} players, ${failures.length} failures`);
if (index.length < 30) process.exit(1);
