/**
 * DEPOLAR — yerel kuralların çıktısını buluta yazan tek katman.
 *
 * KURAL BURADA TEKRARLANMAZ. Bir maçın durumu services/matchReportStages.js'de,
 * Radar Puanı services/radarScoreService.js'de, transferin yayımlanabilirliği
 * services/transferService.js'de belirlenir. Bu dosya yalnızca o kararların
 * SONUCUNU tabloya çevirir.
 *
 * Ayrım önemli: kural iki yerde yaşarsa (bir kez serviste, bir kez SQL'e
 * yazarken) biri gevşediğinde sitede görünen ile veritabanında duran farklı
 * şeyler söyler — ve hangisinin doğru olduğu belli olmaz.
 *
 * SUPABASE KAPALIYKEN HER ŞEY ÇALIŞIR. Anahtar yoksa fonksiyonlar
 * `{ skipped: true }` döner. Depo, bulut olmadan da tam çalışmak zorunda:
 * geliştirme ve CI ortamlarında anahtar yok ve olmaması bir arıza değil.
 */

const { getServiceClient, isEnabled } = require("./serverClient.js");
const { evaluateReportStage } = require("../matchReportStages.js");
const { radarScore } = require("../radarScoreService.js");
const { matchInsights } = require("../matchInsightService.js");

/** Supabase kapalıyken çağıranın okuyacağı cevap. */
const SKIPPED = Object.freeze({ skipped: true, written: 0, reason: "Supabase yapılandırılmadı" });

/** Tek seferde gönderilecek en fazla satır. Büyük gövde zaman aşımına girer. */
const BATCH_SIZE = 200;

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Diziyi parçalara böler; her parça ayrı istek olur. */
function batches(rows, size = BATCH_SIZE) {
  const list = Array.isArray(rows) ? rows : [];
  const out = [];
  for (let index = 0; index < list.length; index += size) {
    out.push(list.slice(index, index + size));
  }
  return out;
}

async function upsertAll(table, rows, onConflict) {
  if (!isEnabled()) return SKIPPED;
  const client = getServiceClient();
  if (!client) return SKIPPED;

  let written = 0;
  for (const batch of batches(rows)) {
    if (!batch.length) continue;
    await client.from(table).upsert(batch, { onConflict, returning: false });
    written += batch.length;
  }
  return { skipped: false, written, table };
}

// ── Eşlemeler: yerel kayıt -> tablo satırı ──────────────────────────────────

function teamRow(team) {
  return {
    id: team.id,
    name: team.name,
    league: team.league || null,
    provider_id: team.providerId ? String(team.providerId) : null,
    rank: numberOrNull(team.rank),
    points: numberOrNull(team.points),
    played: numberOrNull(team.played),
    momentum: numberOrNull(team.momentum),
    form_score: numberOrNull(team.formScore),
    attack: numberOrNull(team.attack),
    defense: numberOrNull(team.defense),
    form: Array.isArray(team.form) ? team.form : [],
    is_current: team.isCurrentSuperLigTeam !== false,
    last_verified_at: toIso(team.lastProviderSeenAt),
    payload: {}
  };
}

function playerRow(player) {
  // Sağlayıcı kimliği yalnızca rakamsa yazılır: "mock-..." yer tutucular
  // veritabanına hiç girmemeli (şema kısıtı da bunu reddeder).
  const providerId = String(player.providerId || "").trim();
  return {
    id: player.id,
    name: player.name,
    full_name: player.fullName || null,
    current_team: player.currentTeam || player.team || null,
    league: player.league || null,
    position: player.position || null,
    position_group: player.positionGroup || null,
    age: numberOrNull(player.computedAge ?? player.age),
    nationality: player.nationality || null,
    provider_id: /^\d+$/.test(providerId) ? providerId : null,
    provider_name: player.providerName || null,
    minutes_played: numberOrNull(player.minutesPlayed ?? player.minutes),
    appearances: numberOrNull(player.appearances),
    goals: numberOrNull(player.goals),
    assists: numberOrNull(player.assists),
    overall_rating: numberOrNull(player.overallRating),
    market_value_eur: numberOrNull(player.marketValueEur),
    rating_status: player.ratingStatus || null,
    data_status: player.dataStatus || null,
    stats_verified_at: toIso(player.statsVerifiedAt),
    source_url: player.sourceUrl || null,
    last_verified_at: toIso(player.lastVerifiedAt || player.lastSyncedAt),
    payload: {}
  };
}

function matchRow(match) {
  const score = match.score || {};
  const home = numberOrNull(score.home);
  const away = numberOrNull(score.away);
  // Şema yarım skoru reddediyor; burada da tam ya da hiç gönderiyoruz.
  const complete = home !== null && away !== null;

  return {
    id: match.id,
    provider_id: match.providerId ? String(match.providerId) : null,
    competition_id: match.competitionId || null,
    league: match.league || null,
    season: match.season || null,
    stage: match.stage || null,
    kickoff: toIso(match.kickoff),
    finished_at: toIso(match.finishedAt),
    venue: match.venue || null,
    city: match.city || null,
    referee: match.referee || null,
    home_team: match.homeTeam,
    away_team: match.awayTeam,
    status: match.status || null,
    home_score: complete ? home : null,
    away_score: complete ? away : null,
    halftime_home: complete ? numberOrNull(score.halftimeHome) : null,
    halftime_away: complete ? numberOrNull(score.halftimeAway) : null,
    events: Array.isArray(match.events) ? match.events : [],
    statistics: Array.isArray(match.statistics) ? match.statistics : [],
    lineups: Array.isArray(match.lineups) ? match.lineups : [],
    data_status: match.dataStatus || null,
    last_verified_at: toIso(match.lastVerifiedAt),
    payload: {}
  };
}

function transferRow(transfer) {
  return {
    id: transfer.id,
    player_id: transfer.playerId || null,
    player_name: transfer.playerName,
    from_team: transfer.fromTeam || null,
    to_team: transfer.toTeam || null,
    league: transfer.league || null,
    position: transfer.position || null,
    transfer_type: transfer.type || null,
    fee: transfer.fee || null,
    fee_eur: numberOrNull(transfer.feeEur),
    transfer_date: transfer.date || null,
    season: transfer.season || null,
    status: transfer.status || "unknown",
    source_type: transfer.sourceType || null,
    source_name: transfer.sourceName || null,
    source_url: transfer.sourceUrl || null,
    last_verified_at: toIso(transfer.lastVerifiedAt),
    note: transfer.note || null,
    payload: {}
  };
}

/**
 * MAÇ RAPORU SATIRI — hızlı rapor ve tam analiz aynı satırda.
 *
 * Durum services/matchReportStages.js'den olduğu gibi alınır. Şemadaki CHECK
 * kısıtı aynı beş değeri tanıyor; ikisi ayrışırsa yazma başarısız olur ve bu
 * İYİDİR: sessizce bilinmeyen bir durum saklamaktansa gürültülü başarısızlık.
 */
function matchReportRow(match, report, options = {}) {
  const stage = evaluateReportStage({
    sections: (report && report.sections) || {},
    match,
    now: options.now
  });
  const insight = matchInsights(match, { limit: 1 });
  const coverage = stage.coverage;

  return {
    match_id: match.id,
    status: stage.status.key,
    stage: stage.stage,
    // Hızlı rapor: skor ve takımlar biliniyorsa her zaman var.
    quick_headline: (report && report.sections && report.sections.summary
      && report.sections.summary.headline) || insight.headline || null,
    quick_summary: (report && report.sections && report.sections.summary
      && report.sections.summary.paragraph) || null,
    quick_ready_at: coverage.core.complete ? toIso(options.now || new Date()) : null,
    // Tam analiz: yalnızca gerçekten hazırsa damgalanır.
    deep_summary: stage.status.key === "full-ready"
      ? ((report && report.sections && report.sections.tactical && report.sections.tactical.summary) || null)
      : null,
    deep_sections: (report && report.sections) || {},
    deep_ready_at: stage.status.key === "full-ready" ? toIso(options.now || new Date()) : null,
    core_complete: coverage.core.complete,
    extended_ready: coverage.extended.ready,
    extended_total: coverage.extended.total,
    coverage: coverage.overall,
    minutes_since_full_time: stage.ageMinutes === null ? null : Math.round(stage.ageMinutes),
    generated_at: toIso(options.now || new Date())
  };
}

/**
 * RADAR PUANI SATIRI.
 *
 * Puan NULL olabilir ve bu kasıtlı: hiçbir bileşen ölçülemediğinde sıfır
 * yazmak "önemsiz maç" demek olurdu. Şema da bunu zorluyor (kapsam sıfırsa
 * puan NULL olmak zorunda).
 */
function radarScoreRow(match, options = {}) {
  const result = radarScore(match, options);
  const pick = (id) => {
    const component = result.components.find((item) => item.id === id);
    return component && component.measured ? component.value : null;
  };

  return {
    match_id: match.id,
    score: result.score,
    coverage: result.coverage,
    confidence: result.confidence,
    importance: pick("importance"),
    score_status: pick("scoreStatus"),
    data_coverage: pick("coverage"),
    surprise_bonus: pick("surprise"),
    components: result.components,
    reasons: result.reasons,
    computed_at: toIso(options.now || new Date())
  };
}

/**
 * VERİ KAPSAMI GÜNLÜĞÜ SATIRI.
 *
 * Depoda bu bilgi console.warn ile akıyor ve koşu bitince kayboluyor.
 * Kalıcı olması şunu mümkün kılıyor: "bu boşluk üç haftadır mı var, yoksa
 * bugün mü oluştu?"
 */
function coverageLogRow(entry) {
  return {
    scope: entry.scope,
    entity_type: entry.entityType || "match",
    entity_id: entry.entityId || null,
    missing_field: entry.missingField || null,
    reason: entry.reason,
    severity: entry.severity || "info",
    payload: entry.payload || {}
  };
}

// ── Yazma yüzeyi ────────────────────────────────────────────────────────────

const saveTeams = (teams) => upsertAll("teams", (teams || []).map(teamRow), "id");
const savePlayers = (players) => upsertAll("players", (players || []).map(playerRow), "id");
const saveMatches = (matches) => upsertAll("matches", (matches || []).map(matchRow), "id");
const saveTransfers = (transfers) => upsertAll("transfers", (transfers || []).map(transferRow), "id");

const saveMatchReports = (entries, options) =>
  upsertAll("match_reports", (entries || []).map(({ match, report }) =>
    matchReportRow(match, report, options)), "match_id");

const saveRadarScores = (matches, options) =>
  upsertAll("radar_scores", (matches || []).map((match) => radarScoreRow(match, options)), "match_id");

const saveCoverageLogs = async (entries) => {
  if (!isEnabled()) return SKIPPED;
  const client = getServiceClient();
  if (!client) return SKIPPED;

  // Günlük satırları eklenir, güncellenmez: her gözlem kendi zamanının kaydı.
  let written = 0;
  for (const batch of batches((entries || []).map(coverageLogRow))) {
    if (!batch.length) continue;
    await client.from("data_coverage_logs").insert(batch, { returning: false });
    written += batch.length;
  }
  return { skipped: false, written, table: "data_coverage_logs" };
};

const saveAnalysisRules = (registry) => {
  const rules = (registry && registry.rules) || [];
  return upsertAll("analysis_rules", rules.map((rule) => ({
    id: rule.id,
    domain: rule.domain,
    title: rule.title,
    statement: rule.statement,
    rationale: rule.rationale || null,
    module: rule.module,
    entry: rule.entry || null,
    thresholds: rule.thresholds || [],
    vocabulary: rule.vocabulary || [],
    test_path: rule.test || null,
    surfaces: rule.surfaces || [],
    registry_version: (registry && registry.version) || null,
    synced_at: new Date().toISOString()
  })), "id");
};

/** Takılı maçlar: hedef boş liste. */
async function readStuckMatches() {
  if (!isEnabled()) return { skipped: true, matches: [] };
  const client = getServiceClient();
  if (!client) return { skipped: true, matches: [] };
  const rows = await client.from("stuck_matches").select({ limit: 50 });
  return { skipped: false, matches: rows };
}

module.exports = {
  BATCH_SIZE,
  SKIPPED,
  batches,
  coverageLogRow,
  matchReportRow,
  matchRow,
  playerRow,
  radarScoreRow,
  readStuckMatches,
  saveAnalysisRules,
  saveCoverageLogs,
  saveMatchReports,
  saveMatches,
  savePlayers,
  saveRadarScores,
  saveTeams,
  saveTransfers,
  teamRow,
  transferRow
};
