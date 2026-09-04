import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { findEuropeanOpponents, selectOpponentCandidate, UEFA_CLUB_COMPETITION_IDS } = require("../services/internationalOpponentService.js");

const root = process.cwd();

function match({ home, away, competitionId, kickoff, status = "FT", id }) {
  return { id: id || `${home}-${away}-${kickoff}`, homeTeam: home, awayTeam: away, competitionId, kickoff, status };
}

const KNOWN_TURKISH_TEAMS = ["Fenerbahçe", "Beşiktaş", "Galatasaray", "Trabzonspor"];

// ── Rakip bulma: yalnızca bir tarafı bilinen bir Türk kulübü olan UEFA maçları ─
{
  const matches = [
    match({ home: "Fenerbahçe", away: "Górnik Zabrze", competitionId: "sampiyonlar-ligi", kickoff: "2026-07-21T20:00:00Z" }),
    match({ home: "Górnik Zabrze", away: "Fenerbahçe", competitionId: "sampiyonlar-ligi", kickoff: "2026-07-29T20:00:00Z" }),
    match({ home: "Beşiktaş", away: "FC Midtjylland", competitionId: "avrupa-ligi", kickoff: "2026-07-23T20:00:00Z" }),
    // Türk ligi maçı — UEFA turnuvası değil, dahil edilmemeli.
    match({ home: "Fenerbahçe", away: "Beşiktaş", competitionId: "super-lig", kickoff: "2026-09-05T20:00:00Z" }),
    // Hazırlık maçı — dahil edilmemeli.
    match({ home: "Fenerbahçe", away: "AC Monza", competitionId: "hazirlik-maci", kickoff: "2026-07-10T20:00:00Z" })
  ];

  const opponents = findEuropeanOpponents({ matches, knownTeamNames: KNOWN_TURKISH_TEAMS });
  const names = opponents.map((o) => o.opponentName).sort();
  assert.deepEqual(names, ["FC Midtjylland", "Górnik Zabrze"], "yalnızca gerçek UEFA rakipleri bulunmalı");

  const zabrze = opponents.find((o) => o.opponentName === "Górnik Zabrze");
  assert.equal(zabrze.fixtures.length, 2, "iki maçlık averaj tek rakip altında toplanmalı (rövanş dahil)");
  assert.equal(zabrze.fixtures[0].turkishTeam, "Fenerbahçe");
}

// ── İki Türk kulübü karşı karşıyaysa (Süper Lig) UEFA süzgecinden geçse bile atlanır ─
{
  const matches = [
    match({ home: "Fenerbahçe", away: "Beşiktaş", competitionId: "sampiyonlar-ligi", kickoff: "2026-07-21T20:00:00Z" })
  ];
  const opponents = findEuropeanOpponents({ matches, knownTeamNames: KNOWN_TURKISH_TEAMS });
  assert.equal(opponents.length, 0, "iki tarafı da bilinen bir maçta rakip aranmaz");
}

// ── İptal/ertelenmiş maçlar rakip aramaya girmez ───────────────────────────
{
  const matches = [
    match({ home: "Fenerbahçe", away: "Górnik Zabrze", competitionId: "sampiyonlar-ligi", kickoff: "2026-07-21T20:00:00Z", status: "PST" })
  ];
  const opponents = findEuropeanOpponents({ matches, knownTeamNames: KNOWN_TURKISH_TEAMS });
  assert.equal(opponents.length, 0, "ertelenmiş maçtan rakip çıkarılmaz");
}

// ── Aday seçimi: TAHMİN YOK — tam eşleşme yoksa ya da birden fazlaysa seçilmez ─
{
  const exactOne = selectOpponentCandidate([{ id: 1, name: "Górnik Zabrze" }, { id: 2, name: "Górnik II" }], "Górnik Zabrze");
  assert.equal(exactOne.team.id, 1, "tam isim eşleşmesi tek adaysa seçilmeli");

  const ambiguous = selectOpponentCandidate([{ id: 1, name: "Górnik Zabrze" }, { id: 2, name: "Górnik Zabrze" }], "Górnik Zabrze");
  assert.equal(ambiguous.team, null, "aynı isimde birden fazla tam eşleşme varsa tahmin edilmez");
  assert.equal(ambiguous.candidates.length, 2);

  const noMatch = selectOpponentCandidate([{ id: 1, name: "Legia Warszawa" }, { id: 2, name: "Wisła Kraków" }], "Górnik Zabrze");
  assert.equal(noMatch.team, null, "tam eşleşme yoksa ve birden fazla farklı aday varsa seçilmez");

  const singleFuzzy = selectOpponentCandidate([{ id: 1, name: "Górnik Zabrze S.A." }], "Górnik Zabrze");
  assert.equal(singleFuzzy.team.id, 1, "arama zaten tek bir farklı-yazımlı aday döndürdüyse o seçilir");

  const empty = selectOpponentCandidate([], "Bilinmeyen Takım");
  assert.equal(empty.team, null, "hiç aday yoksa seçilmez");
  assert.equal(empty.matched, false);
}

console.log(`FutbolRadar international opponent tests passed (${UEFA_CLUB_COMPETITION_IDS.size} UEFA competition IDs recognized)`);

// ── Sağlayıcı yapılandırması yokken senkron güvenle atlanmalı, çökmemeli ────
//
// Eksik yapılandırma bir çöküş değildir ama sync-super-lig-squads.mjs ile
// aynı sözleşmeyi taşır: çıkış kodu 1 (CI'da fark edilsin diye), dosyaya
// hiçbir şey yazılmaz. execFileSync bu yüzden 1'i BEKLENEN bir sonuç olarak
// ele almalı, çöküş gibi fırlatmamalı.
{
  let output;
  try {
    output = execFileSync(process.execPath, [path.join(root, "scripts", "sync-international-opponents.mjs"), "--dry-run"], {
      encoding: "utf8",
      env: { ...process.env, APIFOOTBALL_API_KEY: "", API_FOOTBALL_API_KEY: "", APISPORTS_API_KEY: "", API_SPORTS_API_KEY: "" }
    });
  } catch (error) {
    assert.equal(error.status, 1, "yapılandırma eksikken çıkış kodu 1 olmalı");
    output = error.stdout;
  }
  assert.match(output, /APIFOOTBALL_API_KEY/, "eksik anahtar adıyla bildirilmeli");
  assert.match(output, /Hiçbir dosya yazılmadı/, "yapılandırma yokken hiçbir dosya yazılmamalı");
}

console.log("FutbolRadar sync-international-opponents config-guard test passed");
