import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { resolveLeagueRegistry, selectLeague } = require("../services/leagueRegistry.js");

function league(id, name, country, type = "League") {
  return { id, name, country, type, logo: `https://logo/${id}.png`, coverage: { standings: true }, currentSeasonYear: "2026" };
}

function mockProvider({ configured = true, byCountry = {}, byId = {} } = {}) {
  return {
    getConfig() { return { season: "2026" }; },
    hasConfig() { return configured; },
    async getLeagues(query) {
      if (query && query.id !== undefined) {
        return byId[String(query.id)] || [];
      }
      if (query && query.country) {
        return byCountry[query.country] || [];
      }
      return [];
    }
  };
}

// ── Aynı isimli farklı ülke ligi: ülke ile gruplama ID olmadan asla
// yanlış lige bağlanmıyor. "Primera División" İspanya'da la-liga,
// Arjantin'de arjantin-primera — country parametresi zaten sağlayıcı
// tarafında ayırıyor, burada gevşek eşleşme testi.
{
  const leagues = [
    league("100", "Primera División", "Argentina"),
    league("101", "Primera División Women", "Argentina")
  ];
  const result = selectLeague(leagues, ["primera division"], "League");
  assert.equal(result.league.id, "100", "Kadın ligi gevşek eşleşmede elenmeli, tek erkek adayı seçilmeli");
}

// ── Belirsizlik: iki tam eşleşen aday varsa hiçbiri seçilmez.
{
  const leagues = [
    league("200", "Premier League", "England"),
    league("201", "Premier League", "Wales")
  ];
  const result = selectLeague(leagues, ["premier league"], "League");
  assert.equal(result.league, null, "Birden fazla tam eşleşen aday varsa tahmin edilmemeli");
}

// ── Bilinen ID doğrulama modu: sağlayıcı ID'yi tanıyorsa metadata dolar,
// kimlik değişmez.
{
  const provider = mockProvider({
    byId: { "203": [league("203", "Süper Lig", "Turkey")] }
  });
  const entries = [{ id: "super-lig", country: "Türkiye", type: "domestic", aliases: [], providers: { apiFootball: 203 } }];
  const { results } = await resolveLeagueRegistry({ provider, entries });
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "resolved");
  assert.equal(results[0].mode, "id-verify");
  assert.equal(results[0].leagueId, "203");
  assert.equal(results[0].coverage.standings, true);
}

// ── Bilinen ID sağlayıcıda artık yoksa (paket değişmiş vb.) uydurulmaz,
// "unavailable" döner.
{
  const provider = mockProvider({ byId: {} });
  const entries = [{ id: "super-lig", country: "Türkiye", type: "domestic", aliases: [], providers: { apiFootball: 999 } }];
  const { results } = await resolveLeagueRegistry({ provider, entries });
  assert.equal(results[0].status, "unavailable");
  assert.equal(results[0].reason, "id-not-found");
}

// ── Ad-arama modu: ID'si olmayan kayıt, ülke grubu içinde alias'larla
// bulunur; tek aday varsa çözülür.
{
  const provider = mockProvider({
    byCountry: { Turkey: [league("204", "TFF 1. Lig", "Turkey")] }
  });
  const entries = [{ id: "1-lig", name: "Trendyol 1. Lig", country: "Türkiye", type: "domestic", aliases: ["TFF 1. Lig"], providers: { apiFootball: null } }];
  const { results } = await resolveLeagueRegistry({ provider, entries });
  assert.equal(results[0].status, "resolved");
  assert.equal(results[0].mode, "name-search");
  assert.equal(results[0].leagueId, "204");
}

// ── Aynı ülkede birden fazla hedef, tek getLeagues çağrısını paylaşır
// (quota tasarrufu) — çağrı sayacıyla doğrulanır.
{
  let callCount = 0;
  const provider = {
    getConfig() { return { season: "2026" }; },
    hasConfig() { return true; },
    async getLeagues(query) {
      if (query && query.country === "Turkey") {
        callCount += 1;
        return [
          league("203", "Süper Lig", "Turkey"),
          league("204", "TFF 1. Lig", "Turkey")
        ];
      }
      return [];
    }
  };
  const entries = [
    { id: "super-lig", name: "Süper Lig", country: "Türkiye", type: "domestic", aliases: [], providers: { apiFootball: null } },
    { id: "1-lig", name: "Trendyol 1. Lig", country: "Türkiye", type: "domestic", aliases: ["TFF 1. Lig"], providers: { apiFootball: null } }
  ];
  const { results } = await resolveLeagueRegistry({ provider, entries });
  assert.equal(callCount, 1, "Aynı ülke için tek çağrı paylaşılmalı");
  assert.equal(results.find((r) => r.catalogId === "super-lig").leagueId, "203");
  assert.equal(results.find((r) => r.catalogId === "1-lig").leagueId, "204");
}

// ── Anahtar yoksa hiçbir kayıt çözülmez, hepsi "no-api-key" ile döner —
// tahmin yapılmaz.
{
  const provider = mockProvider({ configured: false });
  const entries = [{ id: "super-lig", country: "Türkiye", type: "domestic", aliases: [], providers: { apiFootball: null } }];
  const { results } = await resolveLeagueRegistry({ provider, entries });
  assert.equal(results[0].status, "unavailable");
  assert.equal(results[0].reason, "no-api-key");
}

console.log("League registry tests passed: ID verification, name-search, ambiguity guard, country-grouped quota sharing, no-key guard.");
