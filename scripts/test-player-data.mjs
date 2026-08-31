import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const {
  getPlayerBySlug,
  getPlayers,
  mergePlayerWithProvider,
  normalizePlayer,
  updatePlayerTransfer,
  validatePlayerData
} = require("../services/playerService.js");
const players = JSON.parse(fs.readFileSync(path.join(root, "data", "players.json"), "utf8"));
const transfers = JSON.parse(fs.readFileSync(path.join(root, "data", "transfers.json"), "utf8"));

const kerem = getPlayerBySlug("kerem-akturkoglu", players, { atDate: "2026-07-13" });
const ugurcan = getPlayerBySlug("ugurcan-cakir", players, { atDate: "2026-07-13" });
const dzeko = getPlayerBySlug("edin-dzeko", players, { atDate: "2026-07-13" });
const icardi = getPlayerBySlug("mauro-icardi", players, { atDate: "2026-07-16" });

assert.equal(kerem.currentTeam, "Fenerbahçe");
assert.equal(kerem.currentTeamId, "fenerbahce");
assert.equal(ugurcan.currentTeam, "Galatasaray");
assert.equal(dzeko.currentTeam, "Schalke 04");
assert.match(dzeko.league, /Bundesliga/i);
assert.equal(icardi.currentTeam, "Serbest oyuncu");
assert.equal(icardi.transferHistory.at(-1).toTeam, "Serbest oyuncu");
assert.ok(transfers.length >= 10, "confirmed transfer feed must contain the current transfer window");
assert.ok(transfers.every((transfer) => transfer.status === "confirmed"), "rumours must not enter the confirmed transfer feed");
assert.ok(transfers.some((transfer) => transfer.playerName === "Lesley Ugochukwu" && transfer.toTeam === "Galatasaray"));
assert.ok(transfers.some((transfer) => transfer.playerName === "Leandro Trossard" && transfer.toTeam === "Beşiktaş"));
assert.ok(transfers.some((transfer) => transfer.playerName === "Vedat Muriqi" && transfer.toTeam === "Fenerbahçe"));

const minimal = { id: "test-player", name: "Test Player", currentTeam: "Test SK", position: "Forvet", rating: 70 };
assert.deepEqual(normalizePlayer(minimal), normalizePlayer(minimal), "normalization must not create clock-based values");

const moved = updatePlayerTransfer(players, {
  playerSlug: "kerem-akturkoglu",
  toTeam: "Test Spor",
  league: "Test Lig",
  date: "2026-07-13",
  source: "manual"
}, "2026-07-13");
const movedKerem = getPlayerBySlug("kerem-akturkoglu", moved, { atDate: "2026-07-13" });
assert.equal(movedKerem.currentTeam, "Test Spor");
assert.equal(movedKerem.currentTeamId, "test-spor");
assert.ok(movedKerem.formerTeams.includes("Fenerbahçe"));
assert.equal(movedKerem.transferHistory.at(-1).toTeam, "Test Spor");
assert.equal(movedKerem.lastUpdatedAt, "2026-07-13");
assert.ok(validatePlayerData(moved, { enforceKnownTransfers: false }).ok, "transfer update must preserve a valid player collection");

assert.throws(
  () => updatePlayerTransfer(players, { playerSlug: "missing-player", toTeam: "Test Spor" }, "2026-07-13"),
  /Oyuncu bulunamadi/,
  "missing players must not result in a silent successful transfer"
);
assert.throws(
  () => updatePlayerTransfer(players, {
    playerSlug: "kerem-akturkoglu",
    fromTeam: "Yanlis Takim",
    toTeam: "Test Spor",
    date: "2026-07-13"
  }, "2026-07-13"),
  /currentTeam ile uyusmuyor/,
  "conflicting source clubs must require an explicit override"
);
assert.throws(
  () => updatePlayerTransfer(players, {
    playerSlug: "kerem-akturkoglu",
    toTeam: "Test Spor",
    date: "2020-01-01"
  }, "2026-07-13"),
  /son kayittan eski/,
  "backdated transfers must not silently replace the current club"
);

const incomplete = normalizePlayer({
  id: "incomplete-player",
  name: "Eksik Oyuncu",
  currentTeam: "Test SK",
  position: "Forvet",
  staleAfter: "2026-01-01T00:00:00Z"
}, { atDate: "2026-07-13" });
assert.equal(incomplete.stats.goals, null, "missing goals must stay unknown");
assert.equal(incomplete.stats.minutesPlayed, null, "missing minutes must stay unknown");
assert.equal(incomplete.isStale, true, "expired player records must be marked stale");
assert.equal(incomplete.needsReview, true, "expired player records must require review");

// ── Mevki grubu: sağlayıcının İngilizce sözcükleri de tanınmalı ────────────
//
// "Defender" hiçbir kalıba uymadığı için varsayılan gruba ("forward")
// düşüyordu ve 526 güncel oyuncunun 165'i — ligin defans hattı — forvet
// sayılıyordu. Grup yalnızca etiket değil: puan ağırlıkları, sıralama
// sayfaları ve radar grafikleri buna bakıyor. Kapı burada.
const POSITION_GROUP_CASES = [
  ["Goalkeeper", "goalkeeper"], ["Kaleci", "goalkeeper"],
  ["Defender", "defender"], ["Stoper", "defender"], ["Sağ bek", "defender"], ["Centre Back", "defender"],
  ["Midfielder", "midfielder"], ["Merkez orta saha", "midfielder"], ["Ön libero", "midfielder"],
  ["Attacker", "forward"], ["Santrfor", "forward"], ["Forvet", "forward"],
  ["Sol kanat", "winger"], ["Sağ kanat", "winger"]
];

for (const [position, expected] of POSITION_GROUP_CASES) {
  assert.equal(
    normalizePlayer({ id: `pos-${expected}-${position}`, name: "Mevki Testi", currentTeam: "Test SK", position }).positionGroup,
    expected,
    `"${position}" mevkisi ${expected} grubuna düşmeli`
  );
}

// Tanınmayan mevki SESSİZCE bir gruba atanmamalı: hatayı gizleyen şey
// tam olarak "bilinmeyeni forvet say" davranışıydı.
assert.equal(
  normalizePlayer({ id: "pos-unknown", name: "Mevki Testi", currentTeam: "Test SK", position: "Bilinmeyen Rol" }).positionGroup,
  "unknown",
  "tanınmayan mevki bir gruba varsayılmamalı"
);

// Dosyada saklanan eski/yanlış grup, mevkiden türetilen doğru grubu ezmemeli.
assert.equal(
  normalizePlayer({
    id: "pos-stale-group",
    name: "Mevki Testi",
    currentTeam: "Test SK",
    position: "Defender",
    positionGroup: "forward"
  }).positionGroup,
  "defender",
  "kayıtta duran eski grup, mevkiden türetilen grubu ezmemeli"
);

// Gerçek veri: bir ligin defans hattı forvetlerden kalabalık olamaz ama
// forvet sayısının defans sayısını KATLAMASI da yapısal bir hatadır.
{
  const current = getPlayers(JSON.parse(fs.readFileSync(path.join(root, "data", "players.json"), "utf8")))
    .filter((player) => player.isCurrentSuperLigPlayer);
  const defenders = current.filter((player) => player.positionGroup === "defender").length;
  const forwards = current.filter((player) => ["forward", "winger"].includes(player.positionGroup)).length;
  assert.ok(defenders > 0, "güncel kadrolarda defans oyuncusu bulunmalı");
  assert.ok(
    defenders >= forwards * 0.5,
    `defans/forvet dağılımı gerçekçi değil (defans ${defenders}, forvet ${forwards}) — mevki eşlemesi bozulmuş olabilir`
  );
}

// Sağlayıcı eksik transfer girdisi döndürdüğünde (date veya toTeam yok)
// bu girdiler birleştirme sırasında süzülmeli; validasyon geçmeli.
{
  const base = normalizePlayer({ id: "test-enrich", name: "Test Player", currentTeam: "Test SK", position: "Forvet", rating: 70 });
  const providerWithIncomplete = {
    id: "test-enrich",
    name: "Test Player",
    currentTeam: "Test SK",
    transferHistory: [
      { date: null, toTeam: null, fromTeam: null },       // tarih ve hedef yok — süzülmeli
      { date: "2025-07-01", toTeam: null, fromTeam: "Eski FK" }, // hedef yok — süzülmeli
      { date: "2024-07-01", toTeam: "Test SK", fromTeam: "Eski FK" } // geçerli — kalmalı
    ]
  };
  const merged = mergePlayerWithProvider(base, providerWithIncomplete, "api-football");
  assert.ok(
    merged.transferHistory.every((t) => t.date && t.toTeam),
    "eksik date veya toTeam içeren sağlayıcı transfer girdileri birleştirmede süzülmeli"
  );
  assert.equal(
    merged.transferHistory.length, 1,
    "yalnızca geçerli (tam) sağlayıcı transfer girdisi eklenmeli"
  );
}

console.log("FutbolRadar player data tests passed");
