/**
 * ANA SAYFA EDİTORYAL ÖNCELİK TESTLERİ
 *
 * Sözleşme:
 *   1. Türk takımı olan maç HER ZAMAN kahraman alanını alır — hazırlık maçı
 *      olsa, rakip küresel bir dev olsa bile.
 *   2. Türk takımlı maçlar arasında canlı olan önce gelir.
 *   3. Türk takımı hiç yoksa küresel devlerin maçı öne çıkar.
 *   4. Sağlayıcının döndürdüğü sıra sonucu DEĞİŞTİRMEZ.
 *   5. Tarayıcı ikizi (app.js) ile sunucu listesi birebir aynıdır.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const priority = require("../services/editorialPriority.js");
const { fixtureTeamNames } = require("../services/superLigTeams.js");

const match = (homeTeam, awayTeam, status, kickoff, extra) => ({
  homeTeam,
  awayTeam,
  status,
  kickoff,
  ...(extra || {})
});

function testEverySuperLigTeamIsRecognised() {
  const missing = fixtureTeamNames().filter((name) => !priority.isTurkishTeam(name));
  assert.deepEqual(missing, [], `Süper Lig takımları tanınmalı, eksik: ${missing.join(", ")}`);
}

/** Alt dize araması yanlış takımları Türk sayıyordu; sözcük eşleşmesi şart. */
function testForeignTeamsAreNotMistakenForTurkish() {
  const foreign = [
    "Sporting CP", "Sport Recife", "Spartak Trnava", "Rudeš", "Osijek",
    "Hull City", "Venezia", "AEK Athens", "Górnik Zabrze", "Inter Turku",
    "FC Midtjylland", "Al-Sadd", "Ittihad Kalba", "Eintracht Frankfurt",
    "RAAL La Louvière", "Romania"
  ];
  for (const name of foreign) {
    assert.equal(priority.isTurkishTeam(name), false, `"${name}" Türk takımı sayılmamalı`);
  }
}

function testProviderSpellingsStillMatch() {
  for (const name of [
    "Fenerbahce SK", "Besiktas JK", "İstanbul Başakşehir FK", "Caykur Rizespor",
    "Galatasaray A.Ş.", "Trabzonspor AŞ", "Gaziantep FK", "Türkiye"
  ]) {
    assert.equal(priority.isTurkishTeam(name), true, `"${name}" Türk takımı olarak tanınmalı`);
  }
}

function testGlobalTopClubDetection() {
  for (const name of [
    "Real Madrid", "FC Barcelona", "Bayern Munich", "Manchester City",
    "Paris Saint-Germain", "AS Roma", "FC Porto", "AC Milan", "Borussia Dortmund"
  ]) {
    assert.equal(priority.isGlobalTopClub(name), true, `"${name}" küresel dev sayılmalı`);
  }
  for (const name of ["Inter Turku", "Romania", "Venezia", "Hull City", "Osijek"]) {
    assert.equal(priority.isGlobalTopClub(name), false, `"${name}" küresel dev sayılmamalı`);
  }
}

function testLiveTurkishMatchWinsTheHero() {
  const list = [
    match("Real Madrid", "Barcelona", "LIVE", "2026-07-30T19:00:00+03:00"),
    match("FC Midtjylland", "Beşiktaş", "LIVE", "2026-07-30T20:00:00+03:00"),
    match("Trabzonspor", "Al-Sadd", "SCHEDULED", "2026-07-30T18:30:00+03:00")
  ];
  const hero = priority.selectHeroMatch(list);
  assert.equal(hero.awayTeam, "Beşiktaş", "canlı Türk takımı maçı kahraman olmalı");
}

/** "Hazırlık maçı bile olsa" kuralının doğrudan testi. */
function testTurkishFriendlyBeatsGlobalTopClubFixture() {
  const list = [
    match("Real Madrid", "Bayern Munich", "SCHEDULED", "2026-07-30T21:00:00+03:00", { league: "UEFA Şampiyonlar Ligi" }),
    match("Göztepe", "Rudeš", "SCHEDULED", "2026-07-30T22:00:00+03:00", { league: "Hazırlık Maçı" })
  ];
  const hero = priority.selectHeroMatch(list);
  assert.equal(hero.homeTeam, "Göztepe", "Türk takımının hazırlık maçı küresel dev maçını geçmeli");
}

function testGlobalTopClubWinsOnlyWhenNoTurkishMatchExists() {
  const list = [
    match("Osijek", "Rudeš", "SCHEDULED", "2026-07-30T18:00:00+03:00"),
    match("Real Madrid", "Barcelona", "SCHEDULED", "2026-07-30T21:00:00+03:00")
  ];
  const hero = priority.selectHeroMatch(list);
  assert.equal(hero.homeTeam, "Real Madrid", "Türk takımı yoksa küresel dev öne çıkmalı");
}

function testLiveBeatsUpcomingWithinTheSameGroup() {
  const list = [
    match("Konyaspor", "Hull City", "SCHEDULED", "2026-07-30T18:00:00+03:00"),
    match("Samsunspor", "AEK Athens", "LIVE", "2026-07-30T21:00:00+03:00")
  ];
  assert.equal(priority.selectHeroMatch(list).homeTeam, "Samsunspor");
}

function testFinishedTurkishMatchRanksBelowUpcomingTurkishMatch() {
  const list = [
    match("Galatasaray", "Venezia", "FINISHED", "2026-07-27T21:00:00+03:00"),
    match("Trabzonspor", "Al-Sadd", "SCHEDULED", "2026-07-30T18:30:00+03:00")
  ];
  assert.equal(priority.selectHeroMatch(list).homeTeam, "Trabzonspor");
}

/** Aynı gruptaki yaklaşan maçlarda en yakın saat, tamamlananlarda en yeni. */
function testTimeTieBreak() {
  const upcoming = priority.sortByEditorialPriority([
    match("Beşiktaş", "A", "SCHEDULED", "2026-07-30T21:00:00+03:00"),
    match("Fenerbahçe", "B", "SCHEDULED", "2026-07-30T18:00:00+03:00")
  ]);
  assert.equal(upcoming[0].homeTeam, "Fenerbahçe", "yaklaşan maçta en yakın saat önce gelmeli");

  const finished = priority.sortByEditorialPriority([
    match("Beşiktaş", "A", "FINISHED", "2026-07-14T21:00:00+03:00"),
    match("Fenerbahçe", "B", "FINISHED", "2026-07-27T21:00:00+03:00")
  ]);
  assert.equal(finished[0].homeTeam, "Fenerbahçe", "tamamlanan maçta en yeni önce gelmeli");
}

/** Sağlayıcı sırası sonucu etkilememeli: her permütasyon aynı kahramanı vermeli. */
function testProviderOrderCannotOverrideEditorialPriority() {
  const base = [
    match("Real Madrid", "Barcelona", "LIVE", "2026-07-30T19:00:00+03:00"),
    match("Inter Turku", "Başakşehir", "SCHEDULED", "2026-07-30T19:00:00+03:00"),
    match("Osijek", "Rudeš", "LIVE", "2026-07-30T17:00:00+03:00")
  ];

  const permutations = [
    [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]
  ];
  for (const order of permutations) {
    const hero = priority.selectHeroMatch(order.map((index) => base[index]));
    assert.equal(
      hero.awayTeam, "Başakşehir",
      `sıra ${order.join("")} için kahraman değişmemeli`
    );
  }
}

function testEmptyAndMalformedInput() {
  assert.equal(priority.selectHeroMatch([]), null);
  assert.equal(priority.selectHeroMatch(null), null);
  assert.doesNotThrow(() => priority.sortByEditorialPriority([{}, { homeTeam: null }]));
}

/**
 * Tarayıcı ikizi ile sunucu listesi birebir aynı olmalı; ayrışırsa sayfa ilk
 * boyamada bir maçı, JS çalıştıktan sonra başka bir maçı gösterir.
 */
function testClientTwinListsStayInSync() {
  const source = fs.readFileSync(path.join(root, "app.js"), "utf8");

  const readList = (name) => {
    const marker = `var ${name} = [`;
    const start = source.indexOf(marker);
    assert.notEqual(start, -1, `app.js: "${name}" listesi kaybolmuş`);
    const end = source.indexOf("];", start);
    return source.slice(start + marker.length, end)
      .split(",")
      .map((line) => line.trim())
      .filter((line) => line.startsWith('"'))
      .map((line) => line.replace(/^"|"$/g, ""));
  };

  assert.deepEqual(
    readList("TURKISH_CLUB_NAMES"), priority.TURKISH_CLUB_NAMES,
    "app.js ve services/editorialPriority.js Türk kulüp listeleri ayrışmış"
  );
  assert.deepEqual(
    readList("GLOBAL_TOP_CLUBS"), priority.GLOBAL_TOP_CLUBS,
    "app.js ve services/editorialPriority.js küresel dev listeleri ayrışmış"
  );
  assert.deepEqual(
    readList("TURKISH_NATIONAL_TEAM_NAMES"), priority.TURKISH_NATIONAL_TEAM_NAMES,
    "millî takım adları ayrışmış"
  );

  for (const hook of ["sortByEditorialPriority", "matchEditorialRank", "hasTurkishTeam", "hasGlobalTopClub"]) {
    assert.ok(source.includes(hook), `app.js: "${hook}" işlevi kaybolmuş`);
  }
  assert.ok(
    /var ordered = sortByEditorialPriority\(list\);/.test(source),
    "app.js: kahraman maçı hâlâ editoryal önceliğe göre seçilmeli"
  );
}

/** Statik üretici de aynı seçiciyi kullanmalı. */
function testPrerenderUsesTheSameSelector() {
  const source = fs.readFileSync(path.join(root, "scripts", "prerender-core-pages.mjs"), "utf8");
  assert.ok(source.includes('require("../services/editorialPriority.js")'), "prerender editoryal önceliği içe aktarmalı");
  assert.ok(source.includes("selectHeroMatch(todayList)"), "prerender kahraman maçını editoryal seçiciyle bulmalı");
}

testEverySuperLigTeamIsRecognised();
testForeignTeamsAreNotMistakenForTurkish();
testProviderSpellingsStillMatch();
testGlobalTopClubDetection();
testLiveTurkishMatchWinsTheHero();
testTurkishFriendlyBeatsGlobalTopClubFixture();
testGlobalTopClubWinsOnlyWhenNoTurkishMatchExists();
testLiveBeatsUpcomingWithinTheSameGroup();
testFinishedTurkishMatchRanksBelowUpcomingTurkishMatch();
testTimeTieBreak();
testProviderOrderCannotOverrideEditorialPriority();
testEmptyAndMalformedInput();
testClientTwinListsStayInSync();
testPrerenderUsesTheSameSelector();

console.log("Editorial priority tests passed (Turkish teams first incl. friendlies, live before upcoming, global top clubs as fallback, provider order ignored).");
