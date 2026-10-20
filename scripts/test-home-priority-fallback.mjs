#!/usr/bin/env node
// /api/matches erişilemediğinde (statik JSON yedeği) öncelik puanının
// data/home-priority.json üzerinden kartlara ulaştığını ve PSG–Barcelona
// tipi büyük maçın görünür 12 kartta sabit kaldığını doğrular. Ağ yok.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { buildHomePriorityMap } from "./build-home-priority.mjs";

const require = createRequire(import.meta.url);
const { isTurkishMatch } = require("../services/turkishTeams.js");
const app = fs.readFileSync(path.join(process.cwd(), "app.js"), "utf8");
const pick = (name) => {
  const m = app.match(new RegExp(`// ${name}:start([\\s\\S]*?)// ${name}:end`));
  assert.ok(m, `app.js içinde ${name} bloğu bulunmalı`);
  return m[1];
};
assert.match(app, /DATA_ROOT \+ "home-priority\.json"/, "statik yedek home-priority.json okumalı");
assert.match(app, /attachStaticHomePriority\(mergeMatchCollections\(/, "yedek kayıtlarına puan eklenmeli");

const api = new Function("isTurkishMatch", `
  "use strict";
  function todayInIstanbul() { return "2026-10-20"; }
  function istanbulDayOf(v) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(v)); }
  function isLiveMatch(m) { return String(m.status).toUpperCase() === "LIVE" && !!m.score; }
  function featuredIsLiveMatch(m) { return isLiveMatch(m); }
  ${pick("static-home-priority")}
  ${pick("today-match-card-selection")}
  return { attachStaticHomePriority, selectTodayMatchCards };
`)(isTurkishMatch);

// Statik yedek: puansız kayıtlar (sağlayıcı alanı yok).
const fixtures = [];
for (let i = 0; i < 30; i += 1) {
  const hour = String(13 + Math.floor(i / 4)).padStart(2, "0");
  fixtures.push({ id: `low-${i}`, kickoff: `2026-10-20T${hour}:00:00+03:00`, league: "Primera División", homeTeam: `Low${i}A`, awayTeam: `Low${i}B`, status: "SCHEDULED" });
}
fixtures.push(
  { id: "psg-barca", kickoff: "2026-10-20T22:00:00+03:00", league: "Şampiyonlar Ligi", homeTeam: "Paris Saint Germain", awayTeam: "Barcelona", status: "SCHEDULED" },
  { id: "tr-cup", kickoff: "2026-10-20T23:00:00+03:00", league: "UEFA Conference League", homeTeam: "Samsunspor", awayTeam: "Rapid Wien", status: "SCHEDULED" },
  { id: "eski-gun", kickoff: "2026-10-18T22:00:00+03:00", league: "Şampiyonlar Ligi", homeTeam: "Real Madrid", awayTeam: "Juventus", status: "FINISHED" }
);
// 10 canlı alt kademe maç: pencerenin çoğunu doldurur (canlı önde UX'i).
for (let i = 0; i < 10; i += 1) {
  fixtures.push({ id: `live-${i}`, kickoff: "2026-10-20T11:30:00+03:00", league: "Primera División", homeTeam: `L${i}A`, awayTeam: `L${i}B`, status: "LIVE", score: { home: 0, away: 0 } });
}
const now = Date.parse("2026-10-20T12:00:00+03:00");

const map = buildHomePriorityMap(fixtures, { now: new Date(now) });
assert.deepEqual(map.days, ["2026-10-20", "2026-10-21"]);
assert.ok(map.scores["psg-barca"] >= 95, "PSG–Barcelona sabitleme eşiğini geçmeli");
assert.ok(!("eski-gun" in map.scores), "pencere dışı gün puanlanmamalı");
// Dosyaya yazılıp okunmuş gibi JSON gidiş-dönüşü.
const scores = JSON.parse(JSON.stringify(map)).scores;

const withoutFile = api.selectTodayMatchCards(fixtures.map((m) => ({ ...m })), { today: "2026-10-20", nowMs: now });
assert.ok(!withoutFile.slice(0, 12).some((m) => m.id === "psg-barca"), "dosyasız yedek eski saat sırasına döner (karşılaştırma)");

const attached = api.attachStaticHomePriority(fixtures, scores);
assert.equal(fixtures[0].homePriority, undefined, "girdi kayıtları değiştirilmemeli");
const visible = api.selectTodayMatchCards(attached, { today: "2026-10-20", nowMs: now }).slice(0, 12).map((m) => m.id);
assert.ok(visible.includes("psg-barca"), "yedek modda PSG–Barcelona görünür 12 kartta sabit kalmalı");
assert.ok(visible.includes("tr-cup"), "Türk maçı görünür pencereden düşmemeli");
assert.ok(visible[0].startsWith("live-"), "canlı maçlar önde kalmalı");

// API puanı varsa üzerine yazılmaz; bozuk girdi güvenli.
assert.equal(api.attachStaticHomePriority([{ id: "x", homePriority: 7 }], { x: 99 })[0].homePriority, 7);
assert.deepEqual(api.attachStaticHomePriority([{ id: "y" }], null), [{ id: "y" }]);

console.log("home-priority-fallback OK (statik yedekte PSG–Barcelona sabit, Türk maçı korundu)");
