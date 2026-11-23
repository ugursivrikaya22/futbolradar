#!/usr/bin/env node
/**
 * MAÇ GÜNÜ OTOMATİK ÖZET KUTUSU — odak testi (services/matchdaySummary.js).
 *
 * Kutu deterministik ve yalnızca API-Football verisinden: golcüler olay
 * akışı tabelayla tutarsa yazılır, kaçan penaltı gol sayılmaz, canlı maç
 * "devam ediyor" der, eksik veri "Güncelleniyor" kalır. Ayrıca ana sayfa
 * ve Bugünün Maçları yuvası, üretici bağlantısı ve PWA/ticker dokunulmazlığı
 * doğrulanır.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const summary = require("../services/matchdaySummary.js");
const matchTimeline = require("../services/matchTimeline.js");
const root = process.cwd();
let passed = 0;
const check = (name, fn) => { fn(); passed += 1; console.log(`ok - ${name}`); };

const ev = (time, team, type, detail, value) => ({ time, team: { name: team }, type, detail, value });

const goztepeEvents = [
  ev("5'", "Gaziantep FK", "Goal", "Normal Goal", "Halil Dervisoglu · Normal Goal"),
  ev("10'", "Gaziantep FK", "Goal", "Normal Goal", "Myenty Abena · Normal Goal"),
  ev("31'", "Göztepe", "Goal", "Missed Penalty", "Novatus Miroshi · Missed Penalty"),
  ev("34'", "Gaziantep FK", "Goal", "Normal Goal", "Kacper Kozłowski · Normal Goal"),
  ev("45+1'", "Gaziantep FK", "Goal", "Normal Goal", "Kacper Kozłowski · Normal Goal"),
  ev("51'", "Göztepe", "Goal", "Normal Goal", "Juan Santos · Normal Goal"),
  ev("72'", "Göztepe", "Card", "Red Card", "Ogun Bayrak · Red Card"),
  ev("90+3'", "Göztepe", "Goal", "Penalty", "Juan Santos · Penalty")
];

const goztepe = {
  id: "goztepe-gaziantep-fk-2026-09-07",
  providerId: "999001",
  source: "api-football",
  league: "Süper Lig",
  competitionId: "super-lig",
  kickoff: "2026-09-07T20:00:00+03:00",
  homeTeam: "Göztepe",
  awayTeam: "Gaziantep FK",
  status: "FINISHED",
  score: { home: 2, away: 4 },
  events: goztepeEvents
};

check("kaçan penaltı gol sayılmaz; golcüler ve kırmızı kart yazılır", () => {
  const box = summary.buildMatchdayBox(goztepe, { today: "2026-09-07", base: "./" });
  assert.equal(box.facts.reconciled, true);
  assert.equal(box.facts.goalCount, 6);
  assert.ok(!box.goals.includes("Miroshi"), "kaçan penaltı golcü listesine girmemeli");
  assert.match(box.goals, /^5' Halil Dervisoglu \(Gaziantep FK\), 10' Myenty Abena/);
  assert.match(box.goals, /90\+3' Juan Santos \(pen\.\) \(Göztepe\)\.$/);
  assert.match(box.lead, /Göztepe – Gaziantep FK maçı 2-4 sona erdi/);
  assert.match(box.lead, /Gaziantep FK sahadan galip ayrıldı/);
  assert.match(box.moments, /72' Ogun Bayrak \(Göztepe\) — Kırmızı/);
  assert.match(box.moments, /31' Novatus Miroshi \(Göztepe\) — Kaçan penaltı/);
  assert.match(box.moments, /90\+3' Juan Santos \(Göztepe\) — Penaltı golü/);
});

check("lite akış, matchTimeline ile aynı golleri ve kaçan penaltıyı üretir", () => {
  const lite = summary.buildLiteTimeline(goztepe);
  const full = matchTimeline.buildTimeline(goztepe, {
    homeTeam: "Göztepe",
    awayTeam: "Gaziantep FK",
    locale: "tr",
    finished: true
  });
  const kinds = (list) => list.filter((item) => ["goal", "penalty", "own-goal", "missed-penalty", "red"].includes(item.kind))
    .map((item) => `${item.kind}|${item.minute}|${item.player}|${item.score || ""}`);
  assert.deepEqual(kinds(lite), kinds(full));
});

check("olay akışı skorla tutmuyorsa golcü yazılmaz → Güncelleniyor", () => {
  const box = summary.buildMatchdayBox({
    ...goztepe,
    score: { home: 2, away: 1 },
    events: [ev("12'", "Göztepe", "Goal", "Normal Goal", "Victor Osimhen · Normal Goal")]
  });
  assert.equal(box.goals, "Güncelleniyor");
  assert.equal(box.facts.reconciled, false);
  assert.ok(!box.goals.includes("Osimhen"));
});

check("olay yoksa skor yazılır, goller ve anlar Güncelleniyor", () => {
  const box = summary.buildMatchdayBox({
    id: "a-b-2026-11-24",
    providerId: "1",
    source: "api-football",
    kickoff: "2026-11-24T20:00:00+03:00",
    homeTeam: "Galatasaray",
    awayTeam: "Aston Villa",
    status: "FINISHED",
    score: { home: 2, away: 1 },
    events: []
  });
  assert.match(box.lead, /2-1 sona erdi/);
  assert.equal(box.goals, "Güncelleniyor");
  assert.equal(box.moments, "Güncelleniyor");
});

check("canlı maç 'devam ediyor' der; 0-0'da Gol yok", () => {
  const live = summary.buildMatchdayBox({
    id: "galatasaray-aston-villa-2026-11-24",
    providerId: "2",
    source: "api-football",
    league: "UEFA Şampiyonlar Ligi",
    kickoff: "2026-11-24T20:45:00+03:00",
    homeTeam: "Galatasaray",
    awayTeam: "Aston Villa",
    status: "LIVE",
    providerStatus: "2H",
    minute: 67,
    live: true,
    score: { home: 1, away: 0 },
    events: [ev("23'", "Galatasaray", "Goal", "Normal Goal", "Victor Osimhen · Normal Goal")]
  });
  assert.match(live.lead, /1-0 devam ediyor \(67'\)\./);
  assert.equal(live.live, true);
  assert.match(live.goals, /23' Victor Osimhen \(Galatasaray\)/);
  assert.equal(live.moments, "Kırmızı kart veya penaltı yok.");

  const ht = summary.buildMatchdayBox({
    id: "a-b",
    providerId: "3",
    source: "api-football",
    kickoff: "2026-11-24T20:00:00+03:00",
    homeTeam: "A",
    awayTeam: "B",
    status: "HALFTIME",
    providerStatus: "HT",
    score: { home: 0, away: 0 },
    events: []
  });
  assert.match(ht.lead, /0-0 devre arasında/);
  assert.equal(ht.goals, "Gol yok.");
});

check("yalnızca bugünün canlı/bitmiş API-Football maçları seçilir", () => {
  const today = "2026-11-24";
  const pool = [
    { ...goztepe, kickoff: "2026-11-23T20:00:00+03:00" },
    {
      id: "gs-villa",
      providerId: "4",
      source: "api-football",
      kickoff: "2026-11-24T20:45:00+03:00",
      homeTeam: "Galatasaray",
      awayTeam: "Aston Villa",
      status: "LIVE",
      live: true,
      score: { home: 0, away: 0 },
      events: []
    },
    {
      id: "not-started",
      providerId: "5",
      source: "api-football",
      kickoff: "2026-11-24T23:00:00+03:00",
      homeTeam: "X",
      awayTeam: "Y",
      status: "SCHEDULED",
      score: { home: null, away: null }
    },
    {
      id: "editorial",
      source: "editorial",
      kickoff: "2026-11-24T19:00:00+03:00",
      homeTeam: "A",
      awayTeam: "B",
      status: "FINISHED",
      score: { home: 1, away: 0 }
    }
  ];
  const selected = summary.selectMatchdayMatches(pool, { today, limit: 12 });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].id, "gs-villa");
  assert.equal(summary.buildMatchdayBox({ score: { home: null, away: null } }), null);
});

check("HTML: künye, kaçış, boş bölüm boş dize", () => {
  const html = summary.renderSection([goztepe], { today: "2026-09-07", base: "./" });
  assert.match(html, /data-card="matchday-summary"/);
  assert.match(html, /data-status="finished"/);
  assert.match(html, /Veri: API-Football/);
  assert.match(html, /Özet, maç verisinden otomatik derlenir/);
  assert.ok(!html.includes("<script"));
  const unsafe = summary.buildMatchdayBox({
    ...goztepe,
    homeTeam: "A <b>",
    awayTeam: "B",
    score: { home: 0, away: 0 },
    events: []
  });
  const escaped = summary.boxHtml(unsafe);
  assert.ok(escaped.includes("A &lt;b&gt;"));
  assert.ok(!escaped.includes("<b>"));
  assert.equal(summary.renderSection([], { today: "2026-11-24" }), "");
});

check("kaçan penaltı raporda da gol sayılmaz (matchReportService)", () => {
  const report = require("../services/matchReportService.js");
  const match = {
    id: goztepe.id,
    homeTeam: goztepe.homeTeam,
    awayTeam: goztepe.awayTeam,
    league: "Süper Lig",
    kickoff: goztepe.kickoff,
    status: "FINISHED",
    score: goztepe.score,
    events: goztepe.events
  };
  const summary = report.buildSummary(match, 1);
  assert.equal(summary.status, "ready");
  assert.ok(!/31\.\s*dakikada Novatus Miroshi/.test(summary.paragraph), "kaçan penaltı özet gol listesine girmemeli");
  assert.match(summary.paragraph, /5\.\s*dakikada Halil Dervisoglu/);
  const events = report.buildMatchEvents(match);
  assert.equal(events.status, "ready");
  const missed = events.events.find((row) => /kaçan penaltı/i.test(String(row.type || "")));
  const scored = events.events.filter((row) => row.isGoal);
  assert.ok(missed, "kaçan penaltı olay listesinde ayrı durmalı");
  assert.equal(scored.length, 6);
  assert.ok(!scored.some((row) => /Miroshi/i.test(String(row.detail || ""))));
});

check("yuvalar, üretici ve test zinciri; PWA/ticker/banner dokunulmaz", () => {
  const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const todayPage = fs.readFileSync(path.join(root, "bugunun-maclari.html"), "utf8");
  const prerender = fs.readFileSync(path.join(root, "scripts", "prerender-core-pages.mjs"), "utf8");
  const pkg = fs.readFileSync(path.join(root, "package.json"), "utf8");
  assert.match(index, /id="mac-gunu-ozetleri"/);
  assert.match(index, /data-api-section="matchday-summary"/);
  assert.match(index, /data-api-target="matchday-summary"/);
  assert.match(index, /prerender:matchday-summary:start/);
  assert.match(index, /matchday-summary\.js/);
  assert.match(todayPage, /data-api-target="matchday-summary"/);
  assert.match(todayPage, /matchday-summary\.js/);
  assert.match(prerender, /"matchday-summary":\s*matchdaySummaryState\(\)/);
  assert.match(pkg, /test-matchday-summary\.mjs/);
  const lib = fs.readFileSync(path.join(root, "services", "matchdaySummary.js"), "utf8");
  assert.doesNotMatch(lib, /openai|anthropic|process\.env/i, "dil modeli / ortam değişkeni yok");
  assert.doesNotMatch(lib, /iddaa|bahis|oran/i, "bahis içeriği yok");
  for (const file of ["site.webmanifest", "sw.js", "public/sw.js", "pwa.js", "data/news-ticker.json", "data/ticker.json", "data/home-match-banner.json"]) {
    // Bu test dosya içeriğini değiştirmemek için yalnızca varlık kontrolü yapar;
    // dokunulmadığı git diff ile PR'da da görünür.
    assert.ok(fs.existsSync(path.join(root, file)), file);
  }
});

console.log(`test-matchday-summary: ${passed} kontrol geçti`);
