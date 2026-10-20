#!/usr/bin/env node
// Ana sayfa maç kartı önceliği: sentetik fikstürlerle PSG/Barcelona tipi
// büyük maçların görünür pencerede kaldığını, alt kademe maçları geçtiğini
// ve Türk maçlarının düşmediğini doğrular. Ağ isteği yapmaz.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const priority = require("../services/homeMatchPriority.js");
const { isTurkishMatch } = require("../services/turkishTeams.js");

const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const block = appSource.match(/\/\/ today-match-card-selection:start([\s\S]*?)\/\/ today-match-card-selection:end/);
assert.ok(block, "app.js seçim bloğu bulunmalı");
assert.match(block[1], new RegExp(`HOME_PIN_COUNT = ${priority.PIN_COUNT};`), "app.js PIN_COUNT modülle aynı olmalı");
assert.match(block[1], new RegExp(`HOME_PIN_MIN_SCORE = ${priority.PIN_MIN_SCORE};`), "app.js PIN_MIN_SCORE modülle aynı olmalı");

const select = new Function("isTurkishMatch", `
  "use strict";
  function todayInIstanbul() { return "2026-10-20"; }
  function istanbulDayOf(value) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
  }
  function isLiveMatch(match) {
    return ["LIVE", "1H", "2H", "HT"].includes(String(match.status || "").toUpperCase()) && match.score;
  }
  function featuredIsLiveMatch(match) { return isLiveMatch(match); }
  ${block[1]}
  return selectTodayMatchCards;
`)(isTurkishMatch);

// --- Puan kuralları
const score = (m) => priority.homePriorityScore(m);
const psgBarca = { league: "UEFA Champions League", homeTeam: "Paris Saint Germain", awayTeam: "Barcelona" };
const youth = { league: "UEFA Youth League", homeTeam: "PSG U19", awayTeam: "Barcelona U19" };
const lowTier = { league: "Primera División", country: "Venezuela", homeTeam: "Caracas", awayTeam: "Zamora" };
assert.ok(score(psgBarca) > score(lowTier), "UCL PSG–Barcelona alt kademe maçı geçmeli");
assert.ok(score(youth) < score(lowTier), "U19 maçı kulüp adıyla popülerlik almamalı");
assert.ok(score({ league: "Premier League", providerLeagueId: 39, homeTeam: "Arsenal", awayTeam: "Fulham" }) >
  score({ league: "Eredivisie", homeTeam: "Utrecht", awayTeam: "Twente" }), "ilk 5 lig + popüler takım diğer Avrupa liginin üstünde");
assert.equal(priority.leagueKeyOf({ league: "CAF Champions League", providerLeagueId: 12 }), "other", "CAF Şampiyonlar Ligi UEFA sayılmamalı");
assert.ok(priority.isDerby({ homeTeam: "Real Madrid", awayTeam: "FC Barcelona" }), "El Clásico derbi sayılmalı");
const standings = { x: { table: [{ team: "Alpha", rank: 1 }, { team: "Beta", rank: 2 }, { team: "Gamma", rank: 9 }] } };
assert.ok(priority.isTopOfTable({ homeTeam: "Alpha", awayTeam: "Beta" }, standings), "zirve maçı tanınmalı");
assert.ok(!priority.isTopOfTable({ homeTeam: "Alpha", awayTeam: "Gamma" }, standings));
assert.ok(!priority.isTopOfTable({ homeTeam: "Alpha", awayTeam: "Beta" }, null), "veri yoksa bonus yok");

// --- Kart seçimi: 30 erken saatli alt kademe maç + akşam büyük maçlar
const now = Date.parse("2026-10-20T12:00:00+03:00");
const fixtures = [];
for (let i = 0; i < 30; i += 1) {
  const hour = String(13 + Math.floor(i / 4)).padStart(2, "0");
  fixtures.push({ id: `low-${i}`, kickoff: `2026-10-20T${hour}:00:00+03:00`, league: "Primera División", homeTeam: `Low${i}A`, awayTeam: `Low${i}B`, status: "SCHEDULED" });
}
fixtures.push(
  { id: "psg-barca", kickoff: "2026-10-20T22:00:00+03:00", league: "UEFA Champions League", homeTeam: "Paris Saint Germain", awayTeam: "Barcelona", status: "SCHEDULED" },
  { id: "real-juve", kickoff: "2026-10-20T22:00:00+03:00", league: "UEFA Champions League", homeTeam: "Real Madrid", awayTeam: "Juventus", status: "SCHEDULED" },
  { id: "tr-europe", kickoff: "2026-10-20T23:00:00+03:00", league: "UEFA Conference League", homeTeam: "Samsunspor", awayTeam: "Rapid Wien", status: "SCHEDULED" },
  { id: "low-live", kickoff: "2026-10-20T11:30:00+03:00", league: "Primera División", homeTeam: "LiveA", awayTeam: "LiveB", status: "LIVE", score: { home: 0, away: 0 } }
);
const stamped = priority.withHomePriority(fixtures);
const ordered = select(stamped, { today: "2026-10-20", nowMs: now });
const visible = ordered.slice(0, 12).map((m) => m.id);
assert.ok(visible.includes("psg-barca"), "PSG–Barcelona görünür 12 kartta olmalı");
assert.ok(visible.includes("real-juve"), "Real Madrid–Juventus görünür 12 kartta olmalı");
assert.ok(visible.includes("tr-europe"), "Türk takımının maçı düşmemeli");
assert.equal(visible[0], "low-live", "canlı maç önde kalmalı (mevcut UX)");
assert.ok(visible.indexOf("tr-europe") < visible.indexOf("psg-barca"), "Türk maçı aynı grupta önce gelmeye devam etmeli");
assert.ok(visible.indexOf("psg-barca") < visible.indexOf("low-0"), "PSG–Barcelona alt kademe maçlardan önce gelmeli");
assert.equal(ordered.length, fixtures.length, "hiçbir maç elenmemeli");

// Sabitleme: pencere Türk maçlarıyla dolu olsa bile büyük maç girer ama Türk maçı çıkmaz.
const crowded = [];
for (let i = 0; i < 12; i += 1) crowded.push({ id: `low-${i}`, kickoff: "2026-10-20T13:00:00+03:00", league: "Primera División", homeTeam: `X${i}`, awayTeam: `Y${i}`, status: "LIVE", score: { home: 0, away: 0 } });
crowded.push({ id: "tr", kickoff: "2026-10-20T14:00:00+03:00", league: "UEFA Europa League", homeTeam: "Fenerbahçe", awayTeam: "Ajax", status: "SCHEDULED" });
crowded.push({ id: "psg-barca", kickoff: "2026-10-20T22:00:00+03:00", league: "UEFA Champions League", homeTeam: "Paris Saint Germain", awayTeam: "Barcelona", status: "SCHEDULED" });
const pinnedOrder = select(priority.withHomePriority(crowded), { today: "2026-10-20", nowMs: now }).slice(0, 12).map((m) => m.id);
assert.ok(pinnedOrder.includes("psg-barca"), "sabitlenen büyük maç canlı alt kademe maçlarla dolu pencereye girmeli");

// Puansız (statik yedek) kayıtlarda eski saat sırası korunur.
const legacy = select(fixtures.slice(0, 5), { today: "2026-10-20", nowMs: now }).map((m) => m.id);
assert.deepEqual(legacy, ["low-0", "low-1", "low-2", "low-3", "low-4"]);

// Modül düzeyindeki placePinned de Türk maçını korur.
const cmp = (a, b) => b.homePriority - a.homePriority;
const mod = priority.placePinned(
  [{ id: "t", homePriority: 1, homeTeam: "Galatasaray", awayTeam: "X" }, { id: "a", homePriority: 2 }, { id: "big", homePriority: 150 }],
  [], 2, cmp, (m) => m.id === "t");
assert.equal(mod.length, 3);

console.log("home-match-priority OK (PSG/Barcelona sabitlendi, Türk maçları korundu)");
