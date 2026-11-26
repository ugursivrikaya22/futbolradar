#!/usr/bin/env node
/**
 * ELLE KAYIT ↔ SAĞLAYICI KAYDI EŞLEŞME RAPORU.
 *
 * Sorun: "Eren Elmalı", "Mason Greenwood" gibi tanınmış oyuncuların profili
 * "istatistikleri henüz doğrulanmış bir kaynakla eşleşmedi" diyordu. Neden:
 * elle girilmiş kayıt (`eren-elmali`, providerId `mock-…`) ile sağlayıcıdan
 * gelen kayıt (`e-elmali-galatasaray`, providerId 50057) aynı kişiydi ama
 * eşleşme yalnızca AD BİREBİR AYNI ise kuruluyordu; sağlayıcı "E. Elmalı"
 * yazınca bağ kurulmadı, yanına ikinci kayıt açıldı ve sağlayıcı kimliği
 * yalnızca ikizde kaldı.
 *
 * Bu betik data/players.json'daki YER TUTUCU kimlikli (mock-…) her kaydı aynı
 * takımdaki sağlayıcı kayıtlarıyla ad varyasyonlarıyla (aksan, baş harf,
 * kısa/tek ad, ters sıra — services/playerNameMatching.js) karşılaştırır ve
 * üç gruba ayırır:
 *   • eşleşen    → sağlayıcı ikizi bulundu (tek ve açık aday);
 *   • belirsiz   → birden çok aday, otomatik karar verilmez;
 *   • eşleşmeyen → nedeniyle ve inceleme ipuçlarıyla listelenir.
 *
 * BU BETİK VERİYE YAZMAZ ve sağlayıcıya istek atmaz. Kimliği elle kayda
 * bağlamak bilerek burada yapılmıyor: iki kayıt aynı providerId'yi taşıyınca
 * `validate-football-coverage` ("Duplicate providerId/slug") saatlik hattı
 * durdurur. Önce ikiz kayıtların birleştirilmesi gerekir; bu, id birleştirme
 * riski yüzünden ayrı bir veri göçü (bkz. services/duplicatePlayerService.js).
 * Gelecekteki senkronlar için bağ, kadro senkronunda kurulur
 * (squadSyncService.matchCanonicalPlayer → "name-variant+team+placeholder-provider-id").
 *
 * Çıktılar:
 *   data/player-provider-match-report.json   (makine okunur)
 *   docs/player-provider-match-report.md     (okunur özet + eşleşmeyenler)
 *
 * Kullanım:
 *   node scripts/reconcile-player-provider-matches.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { nearCandidates, pickUniqueVariant, sameTeam } = require("../services/playerNameMatching.js");

const root = process.cwd();
const PLAYERS_PATH = path.join(root, "data", "players.json");
const REPORT_JSON = path.join(root, "data", "player-provider-match-report.json");
const REPORT_MD = path.join(root, "docs", "player-provider-match-report.md");

const isPlaceholder = (player) => /^mock-/.test(String((player && player.providerId) || ""));
const isRealProvider = (player) => /^\d+$/.test(String((player && player.providerId) || ""));
const teamOf = (player) => (player && (player.currentTeam || player.team)) || "";

/**
 * Saf çekirdek: oyuncu listesini sınıflar. Dosyaya dokunmaz (testler bunu kullanır).
 * @returns {{matched: object[], ambiguous: object[], unmatched: object[], summary: object}}
 */
export function classifyPlaceholders(players) {
  const list = Array.isArray(players) ? players : [];
  const placeholders = list.filter(isPlaceholder);
  const providerRecords = list.filter(isRealProvider);

  // Aynı sağlayıcı kimliği iki elle kayda bağlanmasın.
  const claimedProviderIds = new Set();
  const matched = [];
  const ambiguous = [];
  const unmatched = [];

  for (const player of placeholders) {
    const team = teamOf(player);
    const sameTeamRecords = providerRecords.filter((record) => sameTeam(team, teamOf(record)));
    const verdict = pickUniqueVariant(player, providerRecords);
    const base = { id: player.id, name: player.name, team: team || null, dataStatus: player.dataStatus || null };

    if (verdict.match) {
      const twin = verdict.match.player;
      if (claimedProviderIds.has(String(twin.providerId))) {
        ambiguous.push({ ...base, reason: "provider-id-claimed-by-another-record", candidates: [twin.id] });
        continue;
      }
      claimedProviderIds.add(String(twin.providerId));
      matched.push({ ...base, providerId: String(twin.providerId), twinId: twin.id, twinName: twin.name, method: verdict.match.method });
      continue;
    }

    if (verdict.reason === "ambiguous") {
      ambiguous.push({
        ...base,
        reason: "multiple-candidates",
        candidates: verdict.candidates.filter((entry) => entry.strength === verdict.candidates[0].strength).map((entry) => `${entry.player.name} (${entry.player.providerId})`)
      });
      continue;
    }

    unmatched.push({
      ...base,
      // Neden: takımın sağlayıcı kadrosu depoda hiç yok (serbest oyuncu, yurt dışı
      // kulüp ...) ya da takım var ama hiçbir kayıtla ad örtüşmüyor.
      reason: sameTeamRecords.length ? "no-name-match-in-team" : "team-not-in-provider-squads",
      providerRecordsInTeam: sameTeamRecords.length,
      hints: nearCandidates(player, providerRecords)
    });
  }

  return {
    matched, ambiguous, unmatched,
    summary: {
      totalPlayers: list.length,
      placeholderRecords: placeholders.length,
      providerRecords: providerRecords.length,
      matched: matched.length,
      ambiguous: ambiguous.length,
      unmatched: unmatched.length,
      matchedByMethod: matched.reduce((acc, row) => ({ ...acc, [row.method]: (acc[row.method] || 0) + 1 }), {}),
      unmatchedByReason: unmatched.reduce((acc, row) => ({ ...acc, [row.reason]: (acc[row.reason] || 0) + 1 }), {})
    }
  };
}

function table(rows, columns) {
  const head = `| ${columns.map((column) => column.label).join(" | ")} |`;
  const rule = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${columns.map((column) => String(column.get(row) ?? "—").replace(/\|/g, "\\|")).join(" | ")} |`);
  return [head, rule, ...body].join("\n");
}

export function renderReportMarkdown(report) {
  const { summary } = report;
  const reasonText = {
    "team-not-in-provider-squads": "Takımın sağlayıcı kadrosu depoda yok (serbest oyuncu / yurt dışı kulüp / kapsam dışı lig)",
    "no-name-match-in-team": "Takım var, ama hiçbir sağlayıcı kaydıyla ad örtüşmüyor"
  };
  const hintText = {
    "name-matches-other-team": "ad örtüşüyor ama takım farklı",
    "shares-name-part-same-team": "aynı takımda ad parçası ortak, kişi farklı olabilir"
  };
  const lines = [
    "# Oyuncu ↔ sağlayıcı eşleştirme raporu",
    "",
    `Üretildi: ${report.generatedAt} · \`scripts/reconcile-player-provider-matches.mjs\``,
    "",
    "Yer tutucu (`mock-…`) kimlikli elle kayıtlar, aynı takımdaki sağlayıcı kayıtlarıyla ad varyasyonlarıyla (aksan, baş harf, kısa/tek ad, ters sıra) karşılaştırıldı.",
    "",
    "> **Bu rapor veriye yazmaz.** \"Eşleşen\", sağlayıcı ikizinin bulunduğu anlamına gelir; kimlik henüz elle kayda bağlı değil. Aynı `providerId`'yi iki kayda birden yazmak `validate-football-coverage` doğrulamasını kırar, bu yüzden önce ikiz kayıtların birleştirilmesi gerekir.",
    "",
    "## Özet",
    "",
    `- Toplam oyuncu kaydı: **${summary.totalPlayers}** (yer tutucu: ${summary.placeholderRecords}, sağlayıcı: ${summary.providerRecords})`,
    `- Sağlayıcı ikizi bulunan (eşleşen): **${summary.matched}** ${Object.entries(summary.matchedByMethod).map(([k, v]) => `${k}: ${v}`).join(", ")}`,
    `- Belirsiz (otomatik bağlanmadı): **${summary.ambiguous}**`,
    `- Eşleşmeyen: **${summary.unmatched}**`,
    "",
    "## Eşleşmeyen oyuncular",
    "",
    summary.unmatched
      ? table(report.unmatched, [
          { label: "Oyuncu", get: (row) => row.name },
          { label: "Takım", get: (row) => row.team },
          { label: "Durum", get: (row) => row.dataStatus },
          { label: "Neden", get: (row) => reasonText[row.reason] || row.reason },
          { label: "Takımdaki sağlayıcı kaydı", get: (row) => row.providerRecordsInTeam },
          { label: "İnceleme ipucu (bağlanmadı)", get: (row) => (row.hints || []).map((hint) => `${hint.name} · ${hint.team} · ${hintText[hint.note] || hint.note}`).join("; ") || null }
        ])
      : "_Eşleşmeyen oyuncu yok._",
    ""
  ];
  if (summary.ambiguous) {
    lines.push("## Belirsiz (elle karar gerekir)", "", table(report.ambiguous, [
      { label: "Oyuncu", get: (row) => row.name },
      { label: "Takım", get: (row) => row.team },
      { label: "Neden", get: (row) => row.reason },
      { label: "Adaylar", get: (row) => (row.candidates || []).join("; ") }
    ]), "");
  }
  lines.push("## Eşleşenler (sağlayıcı ikizi bulunan)", "", table(report.matched, [
    { label: "Elle kayıt", get: (row) => `${row.name} (\`${row.id}\`)` },
    { label: "Sağlayıcı kaydı", get: (row) => `${row.twinName} (\`${row.twinId}\`)` },
    { label: "Sağlayıcı kimliği", get: (row) => row.providerId },
    { label: "Yöntem", get: (row) => row.method }
  ]), "");
  return `${lines.join("\n")}\n`;
}

function main() {
  const nowArg = (process.argv.find((arg) => arg.startsWith("--now=")) || "").slice(6);
  const generatedAt = nowArg || new Date().toISOString();
  const players = JSON.parse(fs.readFileSync(PLAYERS_PATH, "utf8"));
  const report = { schemaVersion: 1, generatedAt, ...classifyPlaceholders(players) };

  fs.writeFileSync(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`);
  fs.mkdirSync(path.dirname(REPORT_MD), { recursive: true });
  fs.writeFileSync(REPORT_MD, renderReportMarkdown(report));

  const { summary } = report;
  console.log(`player-provider-match: ${summary.placeholderRecords} yer tutucu kayıt → ${summary.matched} eşleşti, ${summary.ambiguous} belirsiz, ${summary.unmatched} eşleşmedi`);
  console.log(`Rapor: ${path.relative(root, REPORT_JSON)}, ${path.relative(root, REPORT_MD)} (players.json'a yazılmaz)`);
}

import { fileURLToPath } from "node:url";
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
