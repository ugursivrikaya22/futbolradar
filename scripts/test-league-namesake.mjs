#!/usr/bin/env node
/**
 * AYNI ADLI LİGLERİN AYRIMI (EMİR 1B, Görev 3) — Fransa Ligue 1 ≠ Cezayir Ligue 1.
 *
 * Kural: sağlayıcının SAYISAL lig kimliği adı ezer. Ad ("Ligue 1") ülkeyi
 * ayırt edemez: Fransa 61, Cezayir 186, Tunus 202, Fildişi Sahili 386, Senegal 403.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const catalog = require("../services/competitionCatalog.js");
const i18n = require("../services/i18n.js");
const relevance = require("../services/matchRelevance.js");
const seo = require("../services/matchSeoPages.js");
const root = process.cwd();
const read = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));

console.log("league-namesake");

const french = { league: "Ligue 1", competitionId: "ligue-1", providerLeagueId: "61", homeTeam: "Monaco", awayTeam: "Lille", kickoff: "2026-10-18T22:00:00+03:00" };
const algerian = { league: "Ligue 1", competitionId: "ligue-1", providerLeagueId: "186", homeTeam: "CR Belouizdad", awayTeam: "MC Alger", kickoff: "2026-10-18T20:00:00+03:00" };

// ── 1. Çözümleme ──────────────────────────────────────────────────────────
{
  assert.equal(catalog.resolveCompetitionId(french), "ligue-1");
  assert.equal(catalog.resolveCompetitionId({ ...french, competitionId: undefined }), "ligue-1");
  assert.equal(catalog.resolveCompetitionId(algerian), "", "Cezayir ligi Fransa Ligue 1 kimliğini ALMAZ");
  assert.equal(catalog.resolveCompetitionId({ league: "Ligue 1", providerLeagueId: "186" }), "", "kimlik varken ad tek başına karar vermez");
  assert.equal(catalog.separateCompetitionId(algerian), "ligue-1-186", "ayrı, katalogla çakışmayan kimlik");
  assert.equal(catalog.separateCompetitionId(french), "ligue-1");
  assert.equal(catalog.qualifiedLeagueName(algerian), "Ligue 1 (Algeria)");
  assert.equal(catalog.qualifiedLeagueName(french), "Ligue 1");
  assert.equal(catalog.qualifiedLeagueName({ ...algerian, providerLeagueId: "999" }), "Ligue 1", "bilinmeyen ülke uydurulmaz; yalnızca ayrı kimlik alır");
  assert.equal(catalog.qualifiedLeagueName({ ...algerian, leagueCountry: "Algeria", providerLeagueId: "999" }), "Ligue 1 (Algeria)", "sağlayıcı ülkeyi verdiyse kullanılır");
  assert.equal(catalog.qualifiedLeagueName({ league: "Ligue 1 (Algeria)", providerLeagueId: "186" }), "Ligue 1 (Algeria)", "idempotent");
  // Kimliği olmayan eski kayıt: ad eşleşmesi korunur (geriye dönük uyum).
  assert.equal(catalog.resolveCompetitionId({ league: "Ligue 1" }), "ligue-1");
  // Aynı ad sınıfındaki diğer ligler.
  assert.equal(catalog.resolveCompetitionId({ league: "Premier League", providerLeagueId: "233", competitionId: "premier-league" }), "", "Mısır Premier Ligi İngiltere değil");
  assert.equal(catalog.resolveCompetitionId({ league: "Premier League", providerLeagueId: "39" }), "premier-league");
  assert.equal(catalog.resolveCompetitionId({ league: "Bundesliga", providerLeagueId: "218", competitionId: "bundesliga" }), "", "Avusturya Bundesliga'sı Almanya değil");
  assert.equal(catalog.resolveCompetitionId({ league: "Bundesliga", providerLeagueId: "78" }), "bundesliga");
  assert.equal(catalog.resolveCompetitionId({ league: "Primera División", providerLeagueId: "140" }), "la-liga");
  assert.equal(catalog.resolveCompetitionId({ league: "Primera División", providerLeagueId: "281", competitionId: "la-liga" }), "");
  assert.equal(catalog.resolveCompetitionId({ league: "Süper Lig", providerLeagueId: "203" }), "super-lig", "Türk ligleri etkilenmez");
  console.log("  ok  sağlayıcı kimliği adı eziyor (Ligue 1, Premier League, Bundesliga, Primera División)");
}

// ── 2. Öncelik, sayfa uygunluğu ve etiketler ─────────────────────────────
{
  // Önceliği belirleyen tek kapı resolveCompetitionId: Cezayir maçı "büyük beş lig"e girmez.
  assert.equal(relevance.competitionIdOf ? relevance.competitionIdOf(algerian) : catalog.resolveCompetitionId(algerian), "");
  assert.equal(seo.evaluateEligibility({ ...french, status: "SCHEDULED" }).eligible, true, "Fransa Ligue 1 maçı sayfa alır");
  const verdict = seo.evaluateEligibility({ ...algerian, status: "SCHEDULED" });
  assert.equal(verdict.eligible, false, "Cezayir Ligue 1 maçı Fransa Ligue 1 sayfası/puan durumu almaz");
  assert.equal(i18n.competitionLabel("Ligue 1 (Algeria)", "tr"), "Ligue 1 (Cezayir)");
  assert.equal(i18n.competitionLabel("Ligue 1 (Algeria)", "en"), "Ligue 1 (Algeria)");
  assert.equal(i18n.competitionLabel("Ligue 1", "tr"), "Ligue 1", "Fransa ligi sade ad kalır");
  console.log("  ok  Cezayir ligi Fransa sayfa/öncelik kapılarından geçmiyor; etiket iki dilde ülkeli");
}

// ── 3. Depodaki veri ──────────────────────────────────────────────────────
{
  const calendar = read("data/fixture-calendar.json").matches;
  const wrong = calendar.filter((match) => match.competitionId === "ligue-1" && String(match.providerLeagueId) !== "61");
  assert.deepEqual(wrong.map((match) => `${match.id} (lig ${match.providerLeagueId})`), [], "takvimde Fransa Ligue 1 kimliğiyle kayıtlı Fransa dışı maç var");
  const algeria = calendar.filter((match) => String(match.providerLeagueId) === "186");
  assert.ok(algeria.length > 0);
  for (const match of algeria) {
    assert.equal(match.competitionId, "ligue-1-186", match.id);
    assert.equal(match.league, "Ligue 1 (Algeria)", match.id);
  }
  // Aynı sınıfın diğer üyeleri: katalog kimliği yalnızca kendi sağlayıcı kimliğine ait.
  const mismatched = calendar.filter((match) => {
    const entry = catalog.competitions.find((item) => item.id === match.competitionId);
    const expected = entry && entry.providers && entry.providers.apiFootball;
    return expected && match.providerLeagueId && String(expected) !== String(match.providerLeagueId);
  });
  assert.deepEqual(mismatched.map((match) => `${match.id}: ${match.competitionId}/${match.providerLeagueId}`).slice(0, 5), [], "katalog kimliği başka ülkenin ligine yazılmış");

  const predictions = read("data/fixture-predictions.json").predictions;
  const badPredictions = predictions.filter((item) => item.competitionId === "ligue-1" && String(item.leagueId) !== "61");
  assert.deepEqual(badPredictions.map((item) => item.fixtureId).slice(0, 5), [], "tahmin deposunda Fransa kimliğiyle Fransa dışı maç");

  const registry = read("data/match-seo-pages.json").pages.filter((page) => page.competitionId === "ligue-1");
  const standings = read("data/league-standings.json")["ligue-1"].table;
  const key = (name) => String(name).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const clubs = new Set(standings.map((row) => key(row.name || row.team)));
  const foreign = registry.filter((page) => !clubs.has(key(page.homeTeam)) && !clubs.has(key(page.awayTeam)));
  assert.deepEqual(foreign.map((page) => page.slug), [], "Ligue 1 maç sayfası sicilinde Fransa kulübü olmayan maç var");

  for (const page of registry.slice(0, 40)) {
    assert.ok(fs.existsSync(path.join(root, "mac", `${page.slug}.html`)), `${page.slug}: sicildeki sayfa dosyası yok`);
  }
  console.log(`  ok  takvim (${algeria.length} Cezayir maçı ayrı), tahminler ve sayfa sicili temiz`);
}

// ── 4. Kaldırılan sayfalar yönlendirilmiş ve ayrı raporlanmış ─────────────
{
  const report = read("data/league-identity-report.json");
  assert.ok(report.removedMatchPages.length > 0);
  const vercel = read("vercel.json");
  const sources = new Set(vercel.redirects.map((rule) => rule.source));
  for (const page of report.removedMatchPages) {
    assert.ok(!fs.existsSync(path.join(root, "mac", `${page.slug}.html`)), `${page.slug}: dosya hâlâ duruyor`);
    for (const source of [`/mac/${page.slug}`, `/mac/${page.slug}.html`, `/en/match/${page.enSlug}`, `/en/match/${page.enSlug}.html`]) {
      assert.ok(sources.has(source), `${source} için 301 yok`);
    }
  }
  console.log(`  ok  kaldırılan ${report.removedMatchPages.length} sayfa maç merkezine 301 ile yönlendirilmiş (data/league-identity-report.json)`);
}

// ── 5. Senkron yeni kaydı doğru yazar ────────────────────────────────────
{
  const { synchronizeLiveFixtures } = await import("./sync-live-fixtures.mjs");
  const incoming = [
    { id: "1", providerId: "1", league: "Ligue 1", providerLeagueId: "186", leagueCountry: "Algeria", homeTeam: "JS El Biar", awayTeam: "CR Belouizdad", kickoff: "2026-10-17T17:00:00+03:00", status: "SCHEDULED", providerStatus: "NS", score: { home: null, away: null }, fetchedAt: "2026-10-16T09:00:00Z" },
    { id: "2", providerId: "2", league: "Ligue 1", competitionId: "ligue-1", providerLeagueId: "61", homeTeam: "Monaco", awayTeam: "Lille", kickoff: "2026-10-17T22:00:00+03:00", status: "SCHEDULED", providerStatus: "NS", score: { home: null, away: null }, fetchedAt: "2026-10-16T09:00:00Z" }
  ];
  const provider = { async getFixtures(query) { return query.date === "2026-10-16" ? incoming : []; }, async getMatchDetail() { return null; }, getProviderRateLimit() { return { remaining: 100000, httpStatus: 200 }; } };
  const { output } = await synchronizeLiveFixtures({ provider, backupProvider: { getMatches: async () => [] }, mode: "hourly", now: new Date("2026-10-16T09:05:00Z"), previous: { matches: [] } });
  const dz = output.matches.find((row) => row.homeTeam === "JS El Biar");
  const fr = output.matches.find((row) => row.homeTeam === "Monaco");
  assert.equal(dz.competitionId, "ligue-1-186");
  assert.equal(dz.league, "Ligue 1 (Algeria)");
  assert.equal(fr.competitionId, "ligue-1");
  assert.equal(fr.league, "Ligue 1");
  console.log("  ok  yeni senkron: Cezayir ligue-1-186, Fransa ligue-1");
}

console.log("league-namesake: tamam");
