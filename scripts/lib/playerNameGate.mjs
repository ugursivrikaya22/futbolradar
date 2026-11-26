/**
 * BOZUK ADLI OYUNCU SAYFASI İNDEKS KAPISI.
 *
 * `services/playerNameReview.js` sıra bozukluğu şüphesi olan adları bulur
 * (ör. "Sami Bircan Ahmet" = Ahmet Sami Bircan). Burası o kararı sayfa
 * üreticilerine taşır: şüpheli ad `noindex,follow` basılır ve site
 * haritasından kendiliğinden çıkar.
 *
 * KAPI KENDİ KENDİNİ AÇAR. Karar her koşuda veriden yeniden hesaplanır:
 *   • ad düzeltildiğinde (kadro senkronu doğru adı getirdiğinde) şüphe
 *     kalkar ve sayfa `index,follow`a döner;
 *   • ad doğruysa editör `data/player-name-cleared.json`a {id, name}
 *     ekler (ad değişirse onay geçersizleşir ve ad yeniden incelenir).
 *
 * Ad OTOMATİK yeniden yazılmaz: URL ve kimlik bozulmasın diye yalnızca
 * öneri üretilir (bkz. `data/player-name-review.json`).
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { reviewPlayerName } = require("../../services/playerNameReview.js");

let cache = null;

function readJson(root, rel, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
  } catch {
    return fallback;
  }
}

function context(root) {
  if (cache && cache.root === root) return cache;
  const players = readJson(root, "data/players.json", []);
  const official = readJson(root, "data/official-squad-identity.json", { teams: [] });
  const cleared = readJson(root, "data/player-name-cleared.json", { cleared: [] });
  cache = {
    root,
    players: Array.isArray(players) ? players : [],
    officialNames: (official.teams || []).flatMap((team) => (team.players || []).map((p) => p.name)),
    cleared: new Set((cleared.cleared || []).map((row) => `${row.id}::${row.name}`))
  };
  return cache;
}

/** Testlerin ve audit betiğinin veriyi yeniden okuyabilmesi için. */
export function resetPlayerNameGate() {
  cache = null;
}

/** Bir oyuncunun adı inceleme bekliyor mu? (Onaylanmışsa hayır.) */
export function reviewForPlayer(player, root = process.cwd()) {
  const ctx = context(root);
  const result = reviewPlayerName(player, { officialNames: ctx.officialNames, peers: ctx.players });
  const cleared = ctx.cleared.has(`${player.id}::${player.fullName || player.name}`);
  return { ...result, cleared, blocking: result.blocking && !cleared };
}

/** Sayfa üreticilerinin kullandığı kapı: true → `noindex,follow`. */
export function playerNameNeedsReview(player, root = process.cwd()) {
  return Boolean(player) && reviewForPlayer(player, root).blocking;
}

/** Tüm oyuncular için inceleme listesi (blokaj + bilgi notları). */
export function buildNameReviewReport(root = process.cwd()) {
  const ctx = context(root);
  const rows = [];
  for (const player of ctx.players) {
    const review = reviewForPlayer(player, root);
    if (!review.flagged) continue;
    rows.push({
      id: player.id,
      name: player.fullName || player.name,
      team: player.currentTeam || player.team || null,
      dataStatus: player.dataStatus || null,
      noindex: review.blocking,
      cleared: review.cleared,
      reasons: review.reasons,
      notes: review.notes,
      suggestion: review.suggestion
    });
  }
  rows.sort((a, b) => Number(b.noindex) - Number(a.noindex) || String(a.team).localeCompare(String(b.team), "tr") || a.id.localeCompare(b.id));
  return rows;
}
