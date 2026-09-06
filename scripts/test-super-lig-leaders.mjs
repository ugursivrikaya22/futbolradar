import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { normalizeLeagueLeaderEntry } = require("../services/providers/apiFootballProvider.js");
const { buildLeagueLeaders } = require("./sync-super-lig-leaders.mjs");

function topscorersItem({ id, name, team, league = "Süper Lig", goals, assists, appearances = 10, minutes = 900, logo = null }) {
  return {
    player: { id, name, photo: null },
    statistics: [
      {
        team: { id: 900, name: team, logo },
        league: { id: 203, name: league, season: 2026 },
        games: { appearences: appearances, minutes },
        goals: { total: goals, assists }
      }
    ]
  };
}

function mockProvider(topscorers, topassists) {
  return {
    getConfig() { return { season: 2026 }; },
    hasConfig() { return true; },
    async getTopScorers() { return topscorers.map(normalizeLeagueLeaderEntry); },
    async getTopAssists() { return topassists.map(normalizeLeagueLeaderEntry); }
  };
}

const resolvedLeague = { status: "resolved", leagueId: "203", source: "env", leagueName: "Süper Lig", reason: null, candidates: [] };

// ── Ligin kendisiyle sorgulanan uç nokta zaten Süper Lig'dendir; ikinci bir
// doğrulama katmanı (isSuperLigRow) yine de yanlışlıkla sızan bir satırı eler.
{
  const scorers = [
    topscorersItem({ id: 1, name: "A. Golcü", team: "Galatasaray", goals: 6, assists: 2 }),
    topscorersItem({ id: 2, name: "B. Yabancı", team: "Some Club", league: "UEFA Europa League", goals: 9, assists: 0 })
  ];
  const result = await buildLeagueLeaders({ provider: mockProvider(scorers, []), leagueResolution: resolvedLeague, players: [] });
  assert.equal(result.topScorers.length, 1, "Süper Lig dışı satır elenmeli");
  assert.equal(result.topScorers[0].name, "A. Golcü");
  assert.equal(result.diagnostics.rejectedNonSuperLigScorers, 1);
}

// ── Sezon içi takım değiştiren oyuncu tek satırda toplanır, ikiye bölünmez.
{
  const transferredPlayer = {
    player: { id: 5, name: "C. Transfer", photo: null },
    statistics: [
      { team: { id: 1, name: "Eski Takım" }, league: { id: 203, name: "Süper Lig" }, games: { appearences: 4, minutes: 300 }, goals: { total: 2, assists: 1 } },
      { team: { id: 2, name: "Yeni Takım" }, league: { id: 203, name: "Süper Lig" }, games: { appearences: 6, minutes: 500 }, goals: { total: 3, assists: 0 } }
    ]
  };
  const result = await buildLeagueLeaders({ provider: mockProvider([transferredPlayer], []), leagueResolution: resolvedLeague, players: [] });
  assert.equal(result.topScorers.length, 1, "Transfer olan oyuncu tek satır olmalı");
  assert.equal(result.topScorers[0].goals, 5, "Gol sayısı iki kulüp bloğunun toplamı olmalı");
  assert.equal(result.topScorers[0].team, "Yeni Takım", "Güncel kulüp (son blok) gösterilmeli");
}

// ── Sıralama gol sayısına göre azalandır; eşitlikte daha az dakika oynayan öne alınır.
{
  const scorers = [
    topscorersItem({ id: 10, name: "Düşük Verim", team: "X", goals: 4, assists: 0, minutes: 900 }),
    topscorersItem({ id: 11, name: "Yüksek Verim", team: "Y", goals: 4, assists: 0, minutes: 300 }),
    topscorersItem({ id: 12, name: "Lider", team: "Z", goals: 7, assists: 0, minutes: 800 })
  ];
  const result = await buildLeagueLeaders({ provider: mockProvider(scorers, []), leagueResolution: resolvedLeague, players: [] });
  assert.deepEqual(result.topScorers.map((row) => row.name), ["Lider", "Yüksek Verim", "Düşük Verim"]);
  assert.deepEqual(result.topScorers.map((row) => row.rank), [1, 2, 3]);
}

// ── 0 gol/asistli oyuncu tabloya girmez (uydurma satır yok).
{
  const scorers = [topscorersItem({ id: 20, name: "Sıfır Gol", team: "X", goals: 0, assists: 0 })];
  const result = await buildLeagueLeaders({ provider: mockProvider(scorers, []), leagueResolution: resolvedLeague, players: [] });
  assert.equal(result.topScorers.length, 0);
}

// ── Yerel players.json kaydı varsa slug/foto oradan tamamlanır (profil bağlantısı için).
{
  const scorers = [topscorersItem({ id: 30, name: "Slug'lu Oyuncu", team: "Galatasaray", goals: 3, assists: 1 })];
  const localPlayers = [{ id: "slug-lu-oyuncu-galatasaray", providerId: "30", name: "Slug'lu Oyuncu", photo: "https://example.com/p.png" }];
  const result = await buildLeagueLeaders({ provider: mockProvider(scorers, []), leagueResolution: resolvedLeague, players: localPlayers });
  assert.equal(result.topScorers[0].slug, "slug-lu-oyuncu-galatasaray");
}

// ── Lig kimliği çözülemezse (anahtar yok / belirsiz) sessizce boş dönmez, hata verir.
{
  await assert.rejects(
    () => buildLeagueLeaders({ provider: mockProvider([], []), leagueResolution: { status: "unavailable", reason: "no-api-key" }, players: [] }),
    /Süper Lig identity is unavailable/
  );
}

console.log("Süper Lig leaders tests passed: league filter, transfer merge, sort/tiebreak, no-fake-zero-row, local slug backfill, league-id guard.");
