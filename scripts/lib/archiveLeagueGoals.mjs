/**
 * SEZON ARŞİVİ — LİG BAZLI GOL DÖKÜMÜ.
 *
 * Sezon sayfası turnuvaları yalnızca "maç / gol" sayısıyla listeliyordu. Bu
 * modül seçili turnuvalar için maç maç gol dökümünü (dakika, golcü, takım)
 * hazırlar. Kurallar:
 *
 *   • UYDURMA YOK. Gol olayı yalnızca kayıtlı olay akışından okunur
 *     (`data/historical-match-archive.json`, yoksa `data/fixture-calendar.json`).
 *     Olay yoksa maç skoruyla birlikte "Gol detayı yok" işaretlenir; skordan
 *     golcü/dakika türetilmez.
 *   • Kayıtlı gol olayı sayısı skorla tutmazsa bu da açıkça yazılır.
 *   • AYNI ETİKET, FARKLI TURNUVA. Sağlayıcı etiketi ("Premier League", "Cup",
 *     "Premier Division", "Serie A", "Championship") birden çok ülkenin
 *     turnuvasını kapsıyor. Alt gruplama yalnızca veriden yapılır: maçın
 *     sağlayıcı lig kimliği (`providerLeagueId`) ya da her iki takımın aynı
 *     etiketin tek bir kimlikli grubunda görünmesi. Hiçbiri yoksa maç
 *     "lig kimliği kayıtta yok" grubunda kalır — ülke tahmin edilmez.
 */
import fs from "node:fs";
import path from "node:path";

/**
 * Sayfa grupları. `labels` sezon arşivindeki turnuva etiketleridir; arşiv
 * tablosundaki her etiket satırı ilgili sayfaya bağlanır.
 */
export const LEAGUE_GOAL_PAGES = [
  { slug: "premier-league", title: "Premier League", labels: ["Premier League"], ambiguous: true },
  { slug: "hazirlik-maclari", title: "Hazırlık maçları (kulüpler)", labels: ["Friendlies Clubs", "Hazırlık Maçı"] },
  { slug: "premier-division", title: "Premier Division", labels: ["Premier Division"], ambiguous: true },
  { slug: "championship", title: "Championship", labels: ["Championship"], ambiguous: true },
  { slug: "kupa-cup", title: "Cup (ulusal kupalar)", labels: ["Cup"], ambiguous: true },
  { slug: "serie-a", title: "Serie A", labels: ["Serie A"], ambiguous: true },
  { slug: "tff-2-lig", title: "TFF 2. Lig", labels: ["TFF 2. Lig"] },
  { slug: "la-liga", title: "La Liga", labels: ["La Liga"] },
  { slug: "super-lig", title: "Trendyol Süper Lig", labels: ["Süper Lig"] },
  { slug: "uefa-sampiyonlar-ligi", title: "UEFA Şampiyonlar Ligi", labels: ["UEFA Champions League", "UEFA Şampiyonlar Ligi"] },
  { slug: "uefa-avrupa-ligi", title: "UEFA Avrupa Ligi", labels: ["UEFA Europa League", "Avrupa Ligi", "UEFA Avrupa Ligi"] },
  { slug: "uefa-konferans-ligi", title: "UEFA Konferans Ligi", labels: ["UEFA Europa Conference League", "UEFA Konferans Ligi"] },
  { slug: "rusya-premier-liga", title: "Rusya Premier Liga", labels: ["Premier League (Russia)"] },
  { slug: "turkiye-kupasi", title: "Türkiye Kupası", labels: ["Türkiye Kupası"] },
  // "1. Lig" etiketli 34 maçın 20 takımının tamamı "Trendyol 1. Lig" etiketli
  // maçların takımlarıyla aynı: ikisi aynı turnuva (TFF 1. Lig).
  { slug: "trendyol-1-lig", title: "Trendyol 1. Lig", labels: ["Trendyol 1. Lig", "1. Lig"] }
];

/**
 * Yalnızca takım kümesiyle doğrulanabilen, iyi bilinen API-Football lig
 * kimlikleri. Listede olmayan kimlik ülke adı verilmeden "#id" ile gösterilir.
 */
const KNOWN_PROVIDER_LEAGUES = {
  39: "İngiltere Premier League",
  40: "İngiltere Championship",
  135: "İtalya Serie A",
  140: "İspanya La Liga",
  203: "Türkiye Süper Lig",
  204: "Türkiye 1. Lig",
  205: "Türkiye 2. Lig",
  235: "Rusya Premier Liga"
};

const SCORING_DETAILS = new Set(["Normal Goal", "Penalty", "Own Goal"]);

function text(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

/** Bir olay gol mü? Kaçan penaltı gol sayılmaz. */
export function isScoringEvent(event) {
  if (!event) return false;
  const type = text(event.type);
  if (type === "Goal") return SCORING_DETAILS.has(text(event.detail));
  return type === "Gol";
}

/** Olayı ekranda gösterilecek yapıya çevirir; eksik alan boş bırakılır. */
export function normalizeGoalEvent(event) {
  const minute = text(event.time);
  const team = text(event.team && event.team.name);
  if (text(event.type) === "Goal") {
    const parts = text(event.value).split(" · ").map((part) => part.trim()).filter(Boolean);
    const player = parts[0] && parts[0] !== text(event.detail) ? parts[0] : "";
    const assistPart = parts.find((part) => /^Asist:/.test(part));
    return {
      minute: minute && minute !== "-" ? minute : "",
      team,
      player,
      assist: assistPart ? assistPart.replace(/^Asist:\s*/, "") : "",
      kind: text(event.detail) === "Penalty" ? "Penaltı" : text(event.detail) === "Own Goal" ? "Kendi kalesine" : "",
      note: ""
    };
  }
  // Manuel editoryal kayıt: golcü serbest metnin içinde. Metin olduğu gibi
  // gösterilir, ad ayıklanmaz.
  return { minute: minute && minute !== "-" ? minute : "", team, player: "", assist: "", kind: "", note: text(event.detail) };
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

/**
 * Olay kaynaklarını yükler. Büyük dosyalar bir kez okunur; yalnızca gerekli
 * maç kimlikleri için küçük bir harita tutulur.
 */
export function loadEventSources(root, wantedIds) {
  const historical = readJson(path.join(root, "data", "historical-match-archive.json"), { records: [] });
  const calendar = readJson(path.join(root, "data", "fixture-calendar.json"), { matches: [] });
  const byId = new Map();
  for (const record of historical.records || []) {
    const match = record && record.match;
    if (!match || !wantedIds.has(match.id)) continue;
    byId.set(match.id, {
      events: Array.isArray(match.events) ? match.events : [],
      eventSource: match.source === "manual" ? "manual" : "api-football",
      origin: match.source || null,
      providerIds: match.providerIds || null,
      sourceUrls: Array.isArray(match.sourceUrls) ? match.sourceUrls : []
    });
  }
  const leagueIdByMatch = new Map();
  const teamsByLabelLeague = new Map(); // label -> Map(leagueId -> Set(team))
  const unapproved = new Set();
  for (const match of calendar.matches || []) {
    if (!match) continue;
    const leagueId = text(match.providerLeagueId);
    if (leagueId) {
      const label = text(match.league);
      if (!teamsByLabelLeague.has(label)) teamsByLabelLeague.set(label, new Map());
      const map = teamsByLabelLeague.get(label);
      if (!map.has(leagueId)) map.set(leagueId, new Set());
      map.get(leagueId).add(text(match.homeTeam));
      map.get(leagueId).add(text(match.awayTeam));
    }
    if (!wantedIds.has(match.id)) continue;
    if (leagueId) leagueIdByMatch.set(match.id, leagueId);
    if (/thesportsdb/i.test(text(match.source))) unapproved.add(match.id);
    const existing = byId.get(match.id);
    const calendarEvents = Array.isArray(match.events) ? match.events : [];
    if ((!existing || !existing.events.some(isScoringEvent)) && calendarEvents.some(isScoringEvent)) {
      byId.set(match.id, { ...(existing || {}), events: calendarEvents, eventSource: "api-football", origin: text(match.source) || "api-football" });
    }
  }
  return {
    byId,
    leagueIdByMatch,
    teamsByLabelLeague,
    unapproved,
    freshness: {
      historicalUpdatedAt: historical.updatedAt || null,
      calendarFetchedAt: calendar.fetchedAt || null
    }
  };
}

/** Maçın alt grubu: kimlik doğrudan ya da takım kümesinden; aksi halde null. */
function subgroupFor(match, sources, suffixTeams) {
  const direct = sources.leagueIdByMatch.get(match.id);
  if (direct) return { key: `id:${direct}`, method: "provider-id" };
  const candidates = [];
  const byLeague = sources.teamsByLabelLeague.get(match.league);
  if (byLeague) {
    for (const [leagueId, teams] of byLeague) {
      if (teams.has(match.homeTeam) && teams.has(match.awayTeam)) candidates.push(`id:${leagueId}`);
    }
  }
  for (const [label, teams] of suffixTeams) {
    if (teams.has(match.homeTeam) && teams.has(match.awayTeam)) candidates.push(`label:${label}`);
  }
  if (candidates.length === 1) return { key: candidates[0], method: "team-set" };
  return null;
}

export function subgroupLabel(key) {
  if (!key) return "Lig kimliği kayıtta yok";
  if (key.startsWith("id:")) {
    const id = key.slice(3);
    return KNOWN_PROVIDER_LEAGUES[id] ? `${KNOWN_PROVIDER_LEAGUES[id]} (API-Football #${id})` : `API-Football lig #${id} (ülke bilgisi kayıtta yok)`;
  }
  return key.slice(6);
}

/** Tek bir sayfa grubunun maç ve gol dökümü. */
export function buildLeagueGoalPage(page, seasonMatches, sources) {
  const labels = new Set(page.labels);
  const matches = seasonMatches.filter((match) => labels.has(match.league));

  // "Premier League (Belarus)" gibi ülke ekli etiketler, ekisiz etiketteki
  // maçları ayırmak için takım kümesi verir.
  const suffixTeams = new Map();
  for (const label of page.labels) {
    for (const match of seasonMatches) {
      if (!match.league.startsWith(`${label} (`)) continue;
      if (!suffixTeams.has(match.league)) suffixTeams.set(match.league, new Set());
      suffixTeams.get(match.league).add(match.homeTeam);
      suffixTeams.get(match.league).add(match.awayTeam);
    }
  }

  const rows = matches.map((match) => {
    const info = sources.byId.get(match.id) || { events: [], eventSource: null };
    const goals = info.events.filter(isScoringEvent).map(normalizeGoalEvent);
    const scoreGoals = Number(match.score.home) + Number(match.score.away);
    // Alt gruplama yalnızca aynı adı birden çok turnuvaya veren etiketlerde.
    const group = page.ambiguous ? subgroupFor(match, sources, suffixTeams) : null;
    let status;
    if (scoreGoals === 0) status = "goalless";
    else if (!goals.length) status = "missing";
    else if (goals.length === scoreGoals) status = "complete";
    else status = "mismatch";
    return {
      match,
      goals,
      scoreGoals,
      status,
      group: group ? group.key : null,
      groupMethod: group ? group.method : null,
      eventSource: goals.length ? info.eventSource : null,
      origin: info.origin || null,
      unapproved: sources.unapproved.has(match.id),
      sourceUrls: info.sourceUrls || []
    };
  }).sort((left, right) => String(right.match.kickoff).localeCompare(String(left.match.kickoff)));

  const withGoals = rows.filter((row) => row.scoreGoals > 0);
  const stats = {
    matches: rows.length,
    archiveGoals: rows.reduce((sum, row) => sum + row.scoreGoals, 0),
    goalEvents: rows.reduce((sum, row) => sum + row.goals.length, 0),
    matchesWithGoals: withGoals.length,
    missingDetail: withGoals.filter((row) => row.status === "missing").length,
    mismatch: withGoals.filter((row) => row.status === "mismatch").length,
    completeDetail: withGoals.filter((row) => row.status === "complete").length,
    withAnyDetail: withGoals.filter((row) => row.goals.length > 0).length,
    unapproved: rows.filter((row) => row.unapproved).length,
    lastVerifiedAt: rows.map((row) => row.match.lastVerifiedAt).filter(Boolean).sort().pop() || null,
    byLabel: page.labels.map((label) => ({ label, matches: rows.filter((row) => row.match.league === label).length }))
  };
  return { page, rows, stats };
}
