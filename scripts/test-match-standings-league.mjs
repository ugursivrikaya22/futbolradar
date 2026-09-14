#!/usr/bin/env node
/**
 * MAÇ SAYFASI PUAN DURUMU — DOĞRU LİG, DOĞRU SEZON.
 *
 * Bu testin varlık nedeni somut bir hata: maç detay yüzeylerinde puan
 * durumu, maçın ligine bakılmaksızın Türkiye Süper Lig tablosuna
 * düşebiliyordu. Burada iki şey birden doğrulanıyor:
 *
 *   1. ÇÖZÜMLEYİCİ (services/standingsResolver.js) — tabloyu yalnızca
 *      maçın `competitionId`'sinden seçiyor mu, sezonu denetliyor mu,
 *      kupada/bilinmeyen yarışmada Süper Lig'e düşüyor mu.
 *   2. ÜRETİLEN HTML — her maç sayfasının puan durumu bölümü hangi ligi
 *      ilan ediyorsa TABLODAKİ TAKIMLAR da o lige mi ait. Yalnızca başlığı
 *      doğru olup tablosu başka lige ait bir sayfa bu adımda düşer.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const {
  resolveStandingsForMatch,
  seasonYearForKickoff,
  standingsCacheKey
} = require("../services/standingsResolver.js");
const { sameClub } = require("../services/superLigTeams.js");

const standings = JSON.parse(fs.readFileSync(path.join(root, "data", "league-standings.json"), "utf8"));

/* ---------------------------------------------------------------- */
/* 1. ÇÖZÜMLEYİCİ                                                     */
/* ---------------------------------------------------------------- */

function testLeagueMatchesItsOwnTable() {
  const cases = [
    ["super-lig", "Süper Lig", "Galatasaray"],
    ["la-liga", "LaLiga", "Barcelona"],
    ["premier-league", "Premier League", "Arsenal"],
    ["serie-a", "Serie A", "Inter"],
    ["bundesliga", "Bundesliga", "Bayern München"],
    ["ligue-1", "Ligue 1", "Marseille"],
    ["1-lig", "Trendyol 1. Lig", null],
    ["sampiyonlar-ligi", "UEFA Champions League", "Real Madrid"]
  ];
  for (const [competitionId, league, expectTeam] of cases) {
    const resolved = resolveStandingsForMatch(
      { competitionId, league, kickoff: "2026-09-12T21:00:00+03:00" },
      { store: standings }
    );
    assert.equal(resolved.status, "ok", `${competitionId} tablosu gelmeli`);
    assert.equal(resolved.competitionId, competitionId, `${competitionId} kimliği korunmalı`);
    assert.ok(resolved.table.length > 0, `${competitionId} tablosu boş olmamalı`);
    if (expectTeam) {
      assert.ok(
        resolved.table.some((row) => sameClub(row.team || row.name, expectTeam)),
        `${competitionId} tablosunda ${expectTeam} bulunmalı — gelen tablo başka lige ait`
      );
    }
    // Hiçbir yabancı YEREL lig maçı Süper Lig tablosunu almamalı. (Avrupa
    // kupalarında Türk kulüpleri kendi lig aşaması tablosunda yer alır,
    // bu beklenen durumdur.)
    if (competitionId !== "super-lig" && !competitionId.endsWith("-ligi")) {
      assert.ok(
        !resolved.table.some((row) => sameClub(row.team || row.name, "Galatasaray")),
        `${competitionId} için Süper Lig tablosu döndü`
      );
    }
  }
}

function testKnockoutCupHasNoTable() {
  const resolved = resolveStandingsForMatch(
    { competitionId: "turkiye-kupasi", league: "Türkiye Kupası", kickoff: "2026-10-28T20:00:00+03:00" },
    { store: standings }
  );
  assert.equal(resolved.status, "unavailable");
  assert.equal(resolved.reason, "knockout");
  assert.equal(resolved.table.length, 0, "kupa maçında tablo basılmamalı");
}

function testUnknownCompetitionNeverFallsBackToSuperLig() {
  const resolved = resolveStandingsForMatch(
    { league: "Primera División", homeTeam: "ABB", awayTeam: "Guabirá", kickoff: "2026-09-12T21:00:00+03:00" },
    { store: standings }
  );
  assert.equal(resolved.status, "unavailable");
  assert.equal(resolved.reason, "unknown-competition");
  assert.equal(resolved.table.length, 0, "tanınmayan yarışmada Süper Lig'e düşülmemeli");
}

function testSeasonMustMatch() {
  const store = { "la-liga": { league: "La Liga", season: "2025", table: [{ rank: 1, team: "Barcelona", points: 12 }] } };
  const stale = resolveStandingsForMatch(
    { competitionId: "la-liga", league: "La Liga", kickoff: "2026-09-12T21:00:00+03:00" },
    { store }
  );
  assert.equal(stale.status, "unavailable");
  assert.equal(stale.reason, "season-mismatch", "2026/27 maçına 2025/26 tablosu verilmemeli");

  const current = resolveStandingsForMatch(
    { competitionId: "la-liga", league: "La Liga", kickoff: "2025-09-12T21:00:00+03:00" },
    { store }
  );
  assert.equal(current.status, "ok", "aynı sezonda tablo gelmeli");
}

function testSeasonBoundaryAndCacheKey() {
  assert.equal(seasonYearForKickoff("2026-08-31T20:00:00Z"), "2026", "Ağustos yeni sezondur");
  assert.equal(seasonYearForKickoff("2027-05-10T20:00:00Z"), "2026", "Mayıs hâlâ aynı sezondur");
  assert.equal(seasonYearForKickoff("2026-06-10T20:00:00Z"), "2025", "Haziran önceki sezondur");
  // Anahtar lig VE sezon taşımalı; global "standings" anahtarı bir ligin
  // tablosunu başka bir maç sayfasına taşırdı.
  assert.equal(standingsCacheKey("la-liga", "2026"), "standings:la-liga:2026");
  assert.notEqual(standingsCacheKey("la-liga", "2026"), standingsCacheKey("super-lig", "2026"));
  assert.notEqual(standingsCacheKey("la-liga", "2026"), standingsCacheKey("la-liga", "2025"));
}

function testEveryStandingsRecordDeclaresSeason() {
  for (const [id, entry] of Object.entries(standings)) {
    assert.ok(entry.season, `data/league-standings.json → ${id} kaydında sezon yok`);
  }
}

/* ---------------------------------------------------------------- */
/* 2. ÜRETİLEN SAYFALAR                                               */
/* ---------------------------------------------------------------- */

/** Takım adı → o takımın göründüğü lig kimlikleri. */
function teamLeagueIndex() {
  const index = new Map();
  for (const [id, entry] of Object.entries(standings)) {
    for (const row of entry.table || []) {
      const name = String(row.team || row.name || "").trim().toLowerCase();
      if (!name) continue;
      if (!index.has(name)) index.set(name, new Set());
      index.get(name).add(id);
    }
  }
  return index;
}

const SECTION_RE = /id="puan-durumu"[^>]*data-standings-league="([^"]*)"[^>]*data-standings-season="([^"]*)"[^>]*data-standings-state="([^"]*)"/;

function testGeneratedMatchPagesShowTheirOwnLeague() {
  const dirs = [path.join(root, "mac"), path.join(root, "en", "match")];
  const index = teamLeagueIndex();
  let checked = 0;
  let withTable = 0;

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".html"))) {
      const html = fs.readFileSync(path.join(dir, file), "utf8");
      const section = html.match(SECTION_RE);
      if (!section) continue;
      checked += 1;
      const [, leagueId, season, state] = section;
      if (state !== "ok") {
        // Veri yoksa dürüst not basılır; tablo basılmaz.
        assert.ok(
          /Bu turnuva için güncel puan durumu verisi henüz mevcut değil\.|Standings data for this competition is not available yet\./.test(html),
          `${file}: veri yokken açıklama notu yok`
        );
        assert.ok(!/class="standings-table msp-standings"/.test(html), `${file}: veri yokken tablo basılmış`);
        continue;
      }
      withTable += 1;
      assert.ok(leagueId, `${file}: tablo var ama lig kimliği ilan edilmemiş`);
      assert.ok(season, `${file}: tablo var ama sezon ilan edilmemiş`);

      const start = html.indexOf('id="puan-durumu"');
      const body = html.slice(start, html.indexOf("</section>", start));
      const names = [...body.matchAll(/<td>([^<0-9][^<]{1,40})<\/td>/g)].map((row) => row[1].trim().toLowerCase());
      const known = names.map((name) => index.get(name)).filter(Boolean);
      assert.ok(known.length > 0, `${file}: tablodaki takımların hiçbiri tanınmıyor`);
      // Satırların en az biri ilan edilen ligde OLMALI ve hiçbir satır
      // yalnızca başka bir lige ait OLMAMALI.
      for (let i = 0; i < known.length; i += 1) {
        assert.ok(
          known[i].has(leagueId),
          `${file}: "${names[i]}" satırı ilan edilen ${leagueId} ligine ait değil`
        );
      }
    }
  }

  assert.ok(checked > 100, `beklenenden az maç sayfası denetlendi (${checked})`);
  assert.ok(withTable > 100, `beklenenden az sayfada tablo var (${withTable})`);
  console.log(`  ${checked} maç sayfası denetlendi, ${withTable} tanesinde tablo var.`);
}

/**
 * Süper Lig tablosu YALNIZCA Süper Lig maçlarında görünmeli. Bu, hatanın
 * ta kendisini hedefleyen denetim: yabancı bir ligin maç sayfasında Türk
 * kulüplerinden oluşan bir tablo varsa test düşer.
 */
function testSuperLigTableOnlyOnSuperLigPages() {
  const marker = ["Konyaspor", "Kasımpaşa", "Göztepe"];
  const dirs = [path.join(root, "mac"), path.join(root, "en", "match")];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".html"))) {
      const html = fs.readFileSync(path.join(dir, file), "utf8");
      const section = html.match(SECTION_RE);
      if (!section || section[3] !== "ok") continue;
      const start = html.indexOf('id="puan-durumu"');
      const body = html.slice(start, html.indexOf("</section>", start));
      if (!marker.some((name) => body.includes(name))) continue;
      assert.equal(section[1], "super-lig", `${file}: Süper Lig tablosu ${section[1]} maçında gösteriliyor`);
    }
  }
}

/** Süper Lig hafta sayfalarındaki mini tablo da ligini ilan etmeli. */
function testRoundPagesDeclareTheirLeague() {
  const dir = path.join(root, "mac");
  let checked = 0;
  for (const file of fs.readdirSync(dir).filter((name) => /-\d{4}-\d{4}-r\d{2}\.html$/.test(name))) {
    const html = fs.readFileSync(path.join(dir, file), "utf8");
    if (!html.includes("match-mini-standings")) continue;
    checked += 1;
    assert.ok(
      /data-standings-league="super-lig" data-standings-season="\d{4}"/.test(html),
      `${file}: mini puan durumu kartı lig/sezon ilan etmiyor`
    );
  }
  assert.ok(checked > 0, "hafta sayfası bulunamadı");
}

testLeagueMatchesItsOwnTable();
testKnockoutCupHasNoTable();
testUnknownCompetitionNeverFallsBackToSuperLig();
testSeasonMustMatch();
testSeasonBoundaryAndCacheKey();
testEveryStandingsRecordDeclaresSeason();
testGeneratedMatchPagesShowTheirOwnLeague();
testSuperLigTableOnlyOnSuperLigPages();
testRoundPagesDeclareTheirLeague();

console.log("FutbolRadar maç puan durumu lig eşleştirme testleri geçti");
