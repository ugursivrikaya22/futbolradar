#!/usr/bin/env node
/**
 * MAÇ DETAYINDAKİ GOL/ASİST KRALLIĞI — LİG VE SEZON EŞLEŞMESİ TESTİ.
 *
 * Regresyon: maç La Liga / Premier League / Serie A olsa bile sayfada
 * Süper Lig gol ve asist krallığı görünüyordu. Sebep, liderlik verisinin
 * GLOBAL tek anahtarla (`data/league-leaders.json`) saklanması ve her
 * yüzeyin o tek tabloyu basmasıydı.
 *
 * Bu test hem çözücüyü (services/competitionLeaders.js) hem de üretilmiş
 * HTML'i denetler: başlığın değişmesi YETMEZ, satırların da doğru ligden
 * gelmesi gerekir.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  ASSISTS_KIND,
  SCORERS_KIND,
  leadersCacheKey,
  resolveCompetitionIdentity,
  resolveMatchLeaders,
  seasonForKickoff
} = require("../services/competitionLeaders.js");
const { leadersSectionHtml } = await import("./lib/matchSeoPage.mjs");

const root = process.cwd();
const readJson = (relative, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
  } catch {
    return fallback;
  }
};

/* ------------------------------------------------------------------ */
/* 1. ANAHTAR BİÇİMİ                                                    */
/* ------------------------------------------------------------------ */

assert.equal(leadersCacheKey(SCORERS_KIND, "140", 2026), "topscorers:140:2026");
assert.equal(leadersCacheKey(ASSISTS_KIND, "140", 2026), "assists:140:2026");
assert.equal(leadersCacheKey(SCORERS_KIND, "", 2026), null, "ligsiz anahtar üretilmemeli");
assert.equal(leadersCacheKey(SCORERS_KIND, "140", null), null, "sezonsuz anahtar üretilmemeli");

/* ------------------------------------------------------------------ */
/* 2. LİG KİMLİĞİ: SAĞLAYICI ALANLARINDAN, TAHMİNLE DEĞİL               */
/* ------------------------------------------------------------------ */

const LEAGUES = [
  { competitionId: "super-lig", leagueId: "203" },
  { competitionId: "la-liga", leagueId: "140" },
  { competitionId: "premier-league", leagueId: "39" },
  { competitionId: "serie-a", leagueId: "135" },
  { competitionId: "bundesliga", leagueId: "78" },
  { competitionId: "ligue-1", leagueId: "61" },
  { competitionId: "sampiyonlar-ligi", leagueId: "2" },
  { competitionId: "turkiye-kupasi", leagueId: "206" }
];

for (const league of LEAGUES) {
  const identity = resolveCompetitionIdentity({ competitionId: league.competitionId, kickoff: "2026-09-13T20:00:00+03:00" });
  assert.ok(identity, `${league.competitionId}: kimlik çözülemedi`);
  assert.equal(identity.leagueId, league.leagueId, `${league.competitionId}: yanlış leagueId`);
  assert.equal(identity.season, 2026, `${league.competitionId}: yanlış sezon`);
}

// Sayısal kimlik doğrudan kayıttan okunabiliyorsa slug'a gerek yok.
assert.equal(resolveCompetitionIdentity({ providerLeagueId: "135", kickoff: "2026-09-13T20:00:00+03:00" }).leagueId, "135");
assert.equal(resolveCompetitionIdentity({ leagueId: 78, kickoff: "2026-09-13T20:00:00+03:00" }).leagueId, "78");

// Takım adı ya da sayfa metni kimlik DEĞİLDİR.
assert.equal(resolveCompetitionIdentity({ homeTeam: "Galatasaray", awayTeam: "Fenerbahçe", kickoff: "2026-09-13T20:00:00+03:00" }), null,
  "takım adından lig tahmin edilmemeli");
assert.equal(resolveCompetitionIdentity({ slugText: "super-lig-derbi", kickoff: "2026-09-13T20:00:00+03:00" }), null,
  "URL metninden lig tahmin edilmemeli");

// Slug ile sayısal kimlik çelişirse kimlik çözülmez.
assert.equal(resolveCompetitionIdentity({ competitionId: "la-liga", providerLeagueId: "203", kickoff: "2026-09-13T20:00:00+03:00" }), null,
  "çelişen kimlikte lig seçilmemeli");

// Sezon maçın kendi tarihinden gelir (Avrupa: Temmuz'dan itibaren yeni sezon).
assert.equal(seasonForKickoff("2026-09-13", { id: "la-liga", country: "İspanya" }), 2026);
assert.equal(seasonForKickoff("2027-03-01", { id: "la-liga", country: "İspanya" }), 2026);
assert.equal(seasonForKickoff("2027-08-01", { id: "la-liga", country: "İspanya" }), 2027);
// Takvim yılı takvimli ligler (MLS, Brasileirão, Arjantin).
assert.equal(seasonForKickoff("2026-03-01", { id: "mls", country: "ABD" }), 2026);

/* ------------------------------------------------------------------ */
/* 3. KATI ARAMA: LİG+SEZON EŞLEŞMEZSE VERİ YOK                         */
/* ------------------------------------------------------------------ */

const row = (name, team, goals, assists, leagueId, season, slug = null) =>
  ({ rank: 1, name, team, goals, assists, leagueId, season, slug });

const fixtureStore = {
  cache: {
    "topscorers:203:2026": { competitionId: "super-lig", leagueId: "203", leagueName: "Süper Lig", season: 2026, updatedAt: "2026-09-14T06:00:00.000Z", rows: [row("V. Osimhen", "Galatasaray", 6, 2, "203", 2026)] },
    "assists:203:2026": { competitionId: "super-lig", leagueId: "203", leagueName: "Süper Lig", season: 2026, updatedAt: "2026-09-14T06:00:00.000Z", rows: [row("Janderson", "Göztepe", 0, 2, "203", 2026)] },
    "topscorers:140:2026": { competitionId: "la-liga", leagueId: "140", leagueName: "La Liga", season: 2026, updatedAt: "2026-09-14T06:00:00.000Z", rows: [row("R. Lewandowski", "Barcelona", 7, 1, "140", 2026)] },
    "assists:140:2026": { competitionId: "la-liga", leagueId: "140", leagueName: "La Liga", season: 2026, updatedAt: "2026-09-14T06:00:00.000Z", rows: [row("Lamine Yamal", "Barcelona", 2, 5, "140", 2026)] },
    "topscorers:39:2026": { competitionId: "premier-league", leagueId: "39", leagueName: "Premier League", season: 2026, updatedAt: null, rows: [row("E. Haaland", "Manchester City", 8, 0, "39", 2026)] },
    "topscorers:135:2026": { competitionId: "serie-a", leagueId: "135", leagueName: "Serie A", season: 2026, updatedAt: null, rows: [row("M. Retegui", "Atalanta", 5, 1, "135", 2026)] },
    "topscorers:78:2026": { competitionId: "bundesliga", leagueId: "78", leagueName: "Bundesliga", season: 2026, updatedAt: null, rows: [row("H. Kane", "Bayern München", 9, 2, "78", 2026)] },
    "topscorers:2:2026": { competitionId: "sampiyonlar-ligi", leagueId: "2", leagueName: "UEFA Champions League", season: 2026, updatedAt: null, rows: [row("K. Mbappé", "Real Madrid", 3, 0, "2", 2026)] }
  }
};

const leadersFor = (match) => resolveMatchLeaders(match, { store: fixtureStore });
const kickoff = "2026-09-13T20:00:00+03:00";

const superLig = leadersFor({ competitionId: "super-lig", kickoff });
assert.equal(superLig.status, "ok");
assert.equal(superLig.leagueId, "203");
assert.equal(superLig.topScorers[0].name, "V. Osimhen");
assert.equal(superLig.topAssists[0].name, "Janderson");

const laLiga = leadersFor({ competitionId: "la-liga", kickoff });
assert.equal(laLiga.status, "ok");
assert.equal(laLiga.leagueId, "140");
assert.equal(laLiga.topScorers[0].name, "R. Lewandowski", "La Liga maçında La Liga gol krallığı gelmeli");
assert.equal(laLiga.topAssists[0].name, "Lamine Yamal", "La Liga maçında La Liga asist krallığı gelmeli");
assert.ok(!laLiga.topScorers.some((entry) => entry.leagueId !== "140"), "başka ligin satırı sızmamalı");

for (const [competitionId, expected] of [["premier-league", "E. Haaland"], ["serie-a", "M. Retegui"], ["bundesliga", "H. Kane"], ["sampiyonlar-ligi", "K. Mbappé"]]) {
  const result = leadersFor({ competitionId, kickoff });
  assert.equal(result.status, "ok", `${competitionId}: veri bulunmalı`);
  assert.equal(result.topScorers[0].name, expected, `${competitionId}: yanlış gol kralı`);
  // Asist verisi olmayan ligde BOŞ kalır, Süper Lig asistlerine düşmez.
  assert.deepEqual(result.topAssists, [], `${competitionId}: asist verisi uydurulmamalı`);
}

// Verisi olmayan turnuva (Türkiye Kupası): Süper Lig'e DÜŞMEZ.
const cup = leadersFor({ competitionId: "turkiye-kupasi", kickoff });
assert.equal(cup.status, "no-data");
assert.equal(cup.leagueId, "206");
assert.deepEqual(cup.topScorers, []);
assert.deepEqual(cup.topAssists, []);

// Ligue 1: depoda anahtar yok → veri yok, Süper Lig tablosu değil.
const ligue1 = leadersFor({ competitionId: "ligue-1", kickoff });
assert.equal(ligue1.status, "no-data");
assert.deepEqual(ligue1.topScorers, []);

// Sezon eşleşmesi: 2027/28 maçı 2026/27 tablosunu göstermez.
const nextSeason = leadersFor({ competitionId: "la-liga", kickoff: "2027-09-13T20:00:00+03:00" });
assert.equal(nextSeason.season, 2027);
assert.equal(nextSeason.status, "no-data", "başka sezonun tablosu gösterilmemeli");

// Lig çözülemeyen kayıt: yine Süper Lig'e düşülmez.
const unknown = leadersFor({ homeTeam: "A", awayTeam: "B", kickoff });
assert.equal(unknown.status, "unknown-league");
assert.deepEqual(unknown.topScorers, []);

/* ------------------------------------------------------------------ */
/* 4. İŞARETLEME: BAŞLIK DA VERİ DE AYNI LİGDEN                         */
/* ------------------------------------------------------------------ */

const ctx = { locale: "tr", base: "../" };
const laLigaHtml = leadersSectionHtml(laLiga, ctx);
assert.ok(laLigaHtml.includes('data-league-id="140"'), "bölüm lig kimliğini taşımalı");
assert.ok(laLigaHtml.includes("R. Lewandowski"), "La Liga gol kralı basılmalı");
assert.ok(!/Osimhen|Janderson/.test(laLigaHtml), "Süper Lig satırı La Liga bölümüne sızmamalı");
assert.ok(!/Süper Lig/.test(laLigaHtml), "La Liga bölümünde Süper Lig başlığı olmamalı");

const cupHtml = leadersSectionHtml(cup, ctx);
assert.ok(cupHtml.includes("Bu turnuva için gol/asist liderliği verisi henüz mevcut değil."),
  "veri yoksa dürüst mesaj gösterilmeli");
assert.ok(!/Osimhen/.test(cupHtml), "veri yokken başka ligin tablosu basılmamalı");

const enHtml = leadersSectionHtml(laLiga, { locale: "en", base: "../../" });
assert.ok(enHtml.includes("R. Lewandowski"));
assert.ok(!/Osimhen/.test(enHtml));

/* ------------------------------------------------------------------ */
/* 5. ÜRETİLMİŞ SAYFALAR                                                */
/* ------------------------------------------------------------------ */

const registry = readJson("data/match-seo-pages.json", { pages: [] });
const pages = Array.isArray(registry.pages) ? registry.pages : [];
assert.ok(pages.length > 0, "maç sicili boş olmamalı");

const SECTION_RE = /<section class="msp-section msp-leaders"[^>]*>[\s\S]*?<\/section>/;
const LEAGUE_ID_RE = /data-league-id="(\d+)"/;
const COMPETITION_RE = /data-competition="([a-z0-9-]+)"/;

let checked = 0;
const seenCompetitions = new Set();
const missingLinks = [];

for (const page of pages) {
  const relative = path.join("mac", `${page.slug}.html`);
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) continue;
  const html = fs.readFileSync(file, "utf8");
  const section = (html.match(SECTION_RE) || [])[0];
  if (!section) continue;
  checked += 1;

  const identity = resolveCompetitionIdentity(page);
  const leagueId = (section.match(LEAGUE_ID_RE) || [])[1] || null;
  const competitionId = (section.match(COMPETITION_RE) || [])[1] || null;

  if (identity) {
    assert.equal(leagueId, identity.leagueId, `${relative}: bölümün ligi maçın liginden farklı`);
    assert.equal(competitionId, identity.competitionId, `${relative}: bölümün yarışması maçın yarışmasından farklı`);
    assert.ok(section.includes(`data-season="${identity.season}"`), `${relative}: bölümün sezonu maçın sezonundan farklı`);
    seenCompetitions.add(identity.competitionId);
  }

  const hasRows = section.includes("msp-leaders-list");
  if (hasRows) {
    // Veri basılan sayfada lig kimliği ZORUNLU: kimliksiz tablo, eski
    // "global tek tablo" davranışının geri geldiği anlamına gelir.
    assert.ok(leagueId, `${relative}: liderlik tablosu lig kimliği olmadan basılmış`);
    const store = require("../services/competitionLeaders.js").readStore({});
    const scorers = store.cache[`topscorers:${leagueId}:${identity ? identity.season : ""}`];
    const assists = store.cache[`assists:${leagueId}:${identity ? identity.season : ""}`];
    assert.ok(scorers || assists, `${relative}: basılan tablonun lig+sezon anahtarı depoda yok`);
    // Basılan ilk satır, o lig+sezon anahtarının kendi ilk satırı olmalı.
    const firstScorer = scorers && scorers.rows[0] ? scorers.rows[0].name : null;
    if (firstScorer) assert.ok(section.includes(firstScorer), `${relative}: tablo kendi liginin verisini basmıyor`);
    for (const href of section.match(/href="\.\.\/([^"]+)"/g) || []) {
      const target = href.slice('href="../'.length, -1).split("#")[0].split("?")[0];
      if (!target.endsWith(".html")) continue;
      if (!fs.existsSync(path.join(root, target))) missingLinks.push(`${relative} → ${target}`);
    }
  } else {
    assert.ok(section.includes("Bu turnuva için gol/asist liderliği verisi henüz mevcut değil."),
      `${relative}: veri yokken beklenen mesaj yok`);
  }

  // EN eşdeğeri aynı kurala tabi.
  const enRelative = path.join("en", "match", `${page.enSlug}.html`);
  if (page.enSlug && fs.existsSync(path.join(root, enRelative))) {
    const enHtmlPage = fs.readFileSync(path.join(root, enRelative), "utf8");
    const enSection = (enHtmlPage.match(SECTION_RE) || [])[0];
    if (enSection && identity) {
      assert.ok(enSection.includes(`data-league-id="${identity.leagueId}"`), `${enRelative}: EN bölümün ligi farklı`);
    }
  }
}

assert.ok(checked > 50, `liderlik bölümü taşıyan sayfa sayısı beklenenden az (${checked})`);
assert.deepEqual(missingLinks, [], `kırık oyuncu/lig bağlantısı: ${missingLinks.slice(0, 5).join(", ")}`);

// Süper Lig DIŞINDAKİ hiçbir sayfada Süper Lig krallık satırı olmamalı.
const superLigStore = require("../services/competitionLeaders.js").readStore({});
const superLigNames = [
  ...((superLigStore.cache["topscorers:203:2026"] || { rows: [] }).rows),
  ...((superLigStore.cache["assists:203:2026"] || { rows: [] }).rows)
].map((entry) => entry.name).filter(Boolean);

let leaked = 0;
for (const page of pages) {
  if (page.competitionId === "super-lig") continue;
  const file = path.join(root, "mac", `${page.slug}.html`);
  if (!fs.existsSync(file)) continue;
  const section = (fs.readFileSync(file, "utf8").match(SECTION_RE) || [])[0];
  if (!section || !section.includes("msp-leaders-list")) continue;
  if (superLigNames.some((name) => section.includes(name))) leaked += 1;
}
assert.equal(leaked, 0, `${leaked} Süper Lig dışı sayfada Süper Lig krallık satırı var`);

const expectedCompetitions = ["super-lig", "la-liga", "premier-league", "serie-a", "bundesliga", "sampiyonlar-ligi"];
const covered = expectedCompetitions.filter((id) => seenCompetitions.has(id));
assert.ok(covered.length >= 5, `test kapsamı dar: yalnızca ${covered.join(", ")}`);

console.log(`Match leaders tests passed: ${checked} maç sayfası, ${seenCompetitions.size} yarışma; lig+sezon anahtarı, Süper Lig fallback yok, bağlantılar sağlam.`);
