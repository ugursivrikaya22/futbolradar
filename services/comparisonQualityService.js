/**
 * KARŞILAŞTIRMA VERİ KALİTESİ DENETİMİ.
 *
 * Oyuncu karşılaştırma yüzeyinin dayandığı üç veri kümesini (oyuncu, takım,
 * transfer) tek geçişte tarar ve dört sınıfta sorun toplar: yinelenen
 * oyuncu kaydı, güncelliğini yitirmiş takım kaydı, bayat transfer kaydı ve
 * fiziksel olarak imkânsız/anormal değer. Tazelik kararları
 * services/dataFreshness.js'in tanımladığı kaynak-başı ömürlerle (takım 24s,
 * transfer 12s) tutarlı — burada ikinci bir eşik icat edilmiyor.
 *
 * Çıktı admin-comparison-quality.html tarafından okunan
 * data/comparison-quality-report.json dosyasına yazılır.
 */
const { assessFreshness } = require("./dataFreshness");
const { buildDuplicateGroups } = require("./duplicatePlayerService");

function checkDuplicatePlayers(players) {
  const { duplicateGroups } = buildDuplicateGroups(players);
  return duplicateGroups.map((group) => ({
    category: "duplicate_player",
    severity: "warning",
    id: group.key,
    message: `${group.name} (${group.team}): ${group.memberIds.length} ayrı kayıt aynı oyuncuya işaret ediyor — ${group.memberIds.join(", ")}. Kanonik kayıt: ${group.canonicalId}.`,
    detail: group
  }));
}

function checkOutdatedTeams(teams, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const issues = [];

  for (const team of Array.isArray(teams) ? teams : []) {
    if (!team || !team.id) continue;
    const record = { fetchedAt: team.lastStandingsSyncedAt || team.lastProviderSeenAt || null };
    const freshness = assessFreshness([record], { resource: "teams", now });
    if (!freshness.stale) continue;

    const ageHours = freshness.ageMs === null ? null : Math.round(freshness.ageMs / 3600000);
    issues.push({
      category: "outdated_team",
      severity: "warning",
      id: team.id,
      message: ageHours === null
        ? `${team.name}: takım kaydının senkron zamanı yok, güncellik doğrulanamıyor.`
        : `${team.name}: takım kaydı ${ageHours} saattir güncellenmedi (24 saat eşiği aşıldı).`,
      detail: { teamId: team.id, ageMs: freshness.ageMs, staleSince: freshness.staleSince }
    });
  }

  return issues;
}

function checkStaleTransfers(transfers, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const issues = [];

  for (const transfer of Array.isArray(transfers) ? transfers : []) {
    if (!transfer || !transfer.id) continue;
    const freshness = assessFreshness([transfer], { resource: "transfers", now });
    if (!freshness.stale) continue;

    const ageHours = freshness.ageMs === null ? null : Math.round(freshness.ageMs / 3600000);
    issues.push({
      category: "stale_transfer",
      severity: "warning",
      id: transfer.id,
      message: ageHours === null
        ? `${transfer.playerName || transfer.id}: transfer kaydının doğrulama zamanı yok.`
        : `${transfer.playerName || transfer.id}: ${transfer.fromTeam || "?"} → ${transfer.toTeam || "?"} transferi ${ageHours} saattir doğrulanmadı (12 saat eşiği aşıldı).`,
      detail: { transferId: transfer.id, ageMs: freshness.ageMs, staleSince: freshness.staleSince }
    });
  }

  return issues;
}

function abnormalIssue(player, message) {
  return {
    category: "abnormal_value",
    severity: "error",
    id: player.id,
    message: `${player.name || player.id}: ${message}`,
    detail: { playerId: player.id }
  };
}

/**
 * Fiziksel/mantıksal olarak imkânsız değerler. Bu kontrol "doğrulanmamış"
 * ile "yanlış" arasındaki farkı gözetir: statsAreVerified() burada
 * KULLANILMAZ, çünkü amaç ölçülmemiş veriyi gizlemek değil, ölçülmüş ama
 * saçma olan veriyi yakalamaktır (ör. sağlayıcı hatası, elle giriş hatası).
 */
function checkAbnormalValues(players) {
  const issues = [];

  for (const player of Array.isArray(players) ? players : []) {
    if (!player || !player.id) continue;

    const rating = Number(player.overallRating);
    if (player.overallRating != null && (rating < 0 || rating > 100)) {
      issues.push(abnormalIssue(player, `overallRating 0-100 aralığı dışında: ${player.overallRating}.`));
    }

    const minutes = Number(player.minutesPlayed ?? player.minutes);
    const appearances = Number(player.appearances);
    if (Number.isFinite(minutes) && Number.isFinite(appearances) && appearances > 0 && minutes > appearances * 120) {
      issues.push(abnormalIssue(player, `dakika, maç başına 120 dakikayı aşıyor: ${minutes} dk / ${appearances} maç.`));
    }

    const goals = Number(player.goals);
    if (Number.isFinite(goals) && Number.isFinite(appearances) && appearances > 0 && goals > appearances * 4) {
      issues.push(abnormalIssue(player, `gol sayısı maç başına 4'ü aşıyor: ${goals} gol / ${appearances} maç.`));
    }

    const assists = Number(player.assists);
    if (Number.isFinite(assists) && Number.isFinite(appearances) && appearances > 0 && assists > appearances * 4) {
      issues.push(abnormalIssue(player, `asist sayısı maç başına 4'ü aşıyor: ${assists} asist / ${appearances} maç.`));
    }

    if (player.marketValueEur != null && Number(player.marketValueEur) < 0) {
      issues.push(abnormalIssue(player, `piyasa değeri negatif: ${player.marketValueEur}.`));
    }

    const age = Number(player.computedAge ?? player.age);
    if (Number.isFinite(age) && (age < 14 || age > 46)) {
      issues.push(abnormalIssue(player, `yaş gerçek dışı görünüyor: ${age}.`));
    }
  }

  return issues;
}

/**
 * Dört kontrolü birleştirip tek raporluk yapı üretir. Sayaçlar
 * admin-comparison-quality.html'in özet kartlarını besler.
 */
function buildComparisonQualityReport(input = {}, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const players = Array.isArray(input.players) ? input.players : [];
  const teams = Array.isArray(input.teams) ? input.teams : [];
  const transfers = Array.isArray(input.transfers) ? input.transfers : [];

  const issues = [
    ...checkDuplicatePlayers(players),
    ...checkOutdatedTeams(teams, { now }),
    ...checkStaleTransfers(transfers, { now }),
    ...checkAbnormalValues(players)
  ];

  const summary = {
    totalPlayers: players.length,
    totalTeams: teams.length,
    totalTransfers: transfers.length,
    duplicatePlayers: issues.filter((issue) => issue.category === "duplicate_player").length,
    outdatedTeams: issues.filter((issue) => issue.category === "outdated_team").length,
    staleTransfers: issues.filter((issue) => issue.category === "stale_transfer").length,
    abnormalValues: issues.filter((issue) => issue.category === "abnormal_value").length,
    totalIssues: issues.length
  };

  return {
    generatedAt: new Date(now).toISOString(),
    summary,
    issues
  };
}

module.exports = {
  checkDuplicatePlayers,
  checkOutdatedTeams,
  checkStaleTransfers,
  checkAbnormalValues,
  buildComparisonQualityReport
};
