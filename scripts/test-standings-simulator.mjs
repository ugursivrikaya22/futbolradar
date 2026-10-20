#!/usr/bin/env node
/**
 * PUAN DURUMU SİMÜLATÖRÜ TESTLERİ — aritmetik, sıralama/eşitlik kuralı,
 * bölgeler, deterministik "kesin/elendi" hesabı, kalan maç çözümü ve
 * üretilen sayfa.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const sim = require("../services/standingsSimulator.js");
const live = require("../services/liveStandings.js");
const { resolveRemaining, buildSuperLigSimulator } = await import("./lib/standingsSimulatorData.mjs");
const page = await import("./generate-standings-simulator-page.mjs");

let passed = 0;
function test(name, run) {
  run();
  passed += 1;
  console.log(`  ok  ${name}`);
}

function row(id, rank, points, extra = {}) {
  const won = extra.won ?? Math.floor(points / 3);
  const drawn = extra.drawn ?? points - won * 3;
  return { id, name: id.toUpperCase(), rank, played: won + drawn + (extra.lost ?? 0), won, drawn, lost: extra.lost ?? 0, goalsFor: extra.goalsFor ?? 10, goalsAgainst: extra.goalsAgainst ?? 10, points: extra.points ?? points };
}
const find = (rows, id) => rows.find((r) => r.id === id);

test("galibiyet: ev sahibi +3, G/A işlenir, O artar", () => {
  const rows = [row("a", 1, 10), row("b", 2, 9)];
  const out = sim.simulate(rows, [{ id: "m", home: "a", away: "b" }], { m: { result: "H" } });
  const a = find(out.rows, "a");
  const b = find(out.rows, "b");
  assert.deepEqual([a.points, a.won, a.goalsFor, a.goalsAgainst, a.goalDifference, a.played], [13, 4, 11, 10, 1, 5]);
  assert.deepEqual([b.points, b.lost, b.goalsFor, b.goalsAgainst, b.played], [9, 1, 10, 11, 4]);
  assert.equal(out.applied, 1);
});

test("beraberlik varsayılan 0-0, kesin skor averajı değiştirir", () => {
  const rows = [row("a", 1, 10), row("b", 2, 9)];
  const draw = sim.simulate(rows, [{ id: "m", home: "a", away: "b" }], { m: { result: "D" } });
  assert.equal(find(draw.rows, "a").points, 11);
  assert.equal(find(draw.rows, "a").goalsFor, 10);
  const exact = sim.simulate(rows, [{ id: "m", home: "a", away: "b" }], { m: { home: 3, away: 3 } });
  assert.equal(find(exact.rows, "b").goalsFor, 13);
  assert.equal(find(exact.rows, "b").points, 10);
});

test("kesin skor 1/X/2 seçimini ezer; geçersiz skor seçime düşer", () => {
  assert.equal(sim.normalizePick({ result: "H", home: 0, away: 2 }).result, "A");
  assert.deepEqual(sim.normalizePick({ result: "D", home: 2, away: null }), { home: 0, away: 0, result: "D", exact: false });
  assert.equal(sim.normalizePick({ home: -1, away: 0 }), null);
  assert.equal(sim.normalizePick({ home: 1.5, away: 0 }), null);
  assert.equal(sim.normalizePick({ result: "Z" }), null);
});

test("sıralama: puan > averaj > atılan gol > resmî sıra (canlı tabloyla aynı kural)", () => {
  const rows = [
    row("a", 1, 10, { goalsFor: 10, goalsAgainst: 5 }),
    row("b", 2, 10, { goalsFor: 12, goalsAgainst: 7 }),
    row("c", 3, 10, { goalsFor: 8, goalsAgainst: 5 }),
    row("d", 4, 10, { goalsFor: 8, goalsAgainst: 5 })
  ];
  const out = sim.simulate(rows, [], {});
  assert.deepEqual(out.rows.map((r) => r.id), ["b", "a", "c", "d"]);
  assert.deepEqual(out.rows.map((r) => r.id), live.rankRows(rows.map((r) => ({ ...r, goalDifference: r.goalsFor - r.goalsAgainst, officialRank: r.rank }))).map((r) => r.id));
  const swapped = sim.simulate([rows[0], rows[1], { ...rows[3], rank: 3 }, { ...rows[2], rank: 4 }], [], {});
  assert.deepEqual(swapped.rows.slice(2).map((r) => r.id), ["d", "c"], "eşitlikte resmî sıra korunur");
});

test("averaj eşitliği kesin skorla bozulur", () => {
  const rows = [row("a", 1, 12), row("b", 2, 9), row("c", 3, 12, { goalsFor: 9 }), row("x", 4, 0)];
  const fx = [{ id: "1", home: "b", away: "x" }, { id: "2", home: "c", away: "a" }];
  const out = sim.simulate(rows, fx, { 1: { home: 4, away: 0 }, 2: { result: "D" } });
  assert.deepEqual(out.rows.map((r) => r.id).slice(0, 3), ["a", "c", "b"]);
  const big = sim.simulate(rows, fx, { 1: { home: 4, away: 0 }, 2: { home: 0, away: 0 } });
  assert.equal(find(big.rows, "b").rank, 3);
  const win = sim.simulate(rows, fx, { 1: { result: "H" }, 2: { home: 5, away: 1 } });
  assert.equal(win.rows[0].id, "c");
  assert.equal(find(win.rows, "c").rankChange, 2);
});

test("puan silme korunur (P < 3G+B)", () => {
  const rows = [row("a", 1, 7, { won: 3, drawn: 1, points: 7 }), row("b", 2, 6)];
  const out = sim.simulate(rows, [{ id: "m", home: "a", away: "b" }], { m: { result: "H" } });
  assert.equal(find(out.rows, "a").points, 10);
});

test("bölgeler sitedeki kuralla aynı (1 şampiyonluk, 2-4 Avrupa, son 3 küme)", () => {
  const zones = Array.from({ length: 18 }, (_, i) => sim.zoneFor(i + 1, 18));
  assert.equal(zones[0], "champion");
  assert.deepEqual(zones.slice(1, 4), ["europe", "europe", "europe"]);
  assert.deepEqual(zones.slice(15), ["relegation", "relegation", "relegation"]);
  assert.ok(zones.slice(4, 15).every((z) => z === ""));
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const source = app.match(/function homeStandingZoneClass\(rank, total\) \{[\s\S]*?\n  \}/)[0];
  const siteZone = new Function(`${source}; return homeStandingZoneClass;`)();
  const map = { " is-leader": "champion", " is-europe": "europe", " is-relegation": "relegation", "": "" };
  for (const total of [18, 20, 12]) {
    for (let rank = 1; rank <= total; rank += 1) assert.equal(sim.zoneFor(rank, total), map[siteZone(rank, total)], `${rank}/${total}`);
  }
});

test("kesin/elendi yalnızca azami puandan; eşit puan ihtimali açık kalır", () => {
  const rows = [row("a", 1, 30), row("b", 2, 24), row("c", 3, 20), row("d", 4, 5)];
  const fx = [{ id: "1", home: "a", away: "b" }, { id: "2", home: "c", away: "d" }];
  const out = sim.simulate(rows, fx, {});
  assert.equal(find(out.rows, "a").maxPoints, 33);
  assert.equal(find(out.rows, "b").maxPoints, 27);
  assert.equal(find(out.rows, "a").status.champion, "clinched", "kimse 30'a ulaşamaz");
  assert.equal(find(out.rows, "b").status.champion, "eliminated", "27 < 30");
  assert.equal(find(out.rows, "b").status.europe, "clinched");
});

test("şampiyonluk kesinleşir / elenir; eşitlik açık", () => {
  const rows = [row("a", 1, 30), row("b", 2, 26), row("c", 3, 20), row("d", 4, 5)];
  const fx = [{ id: "1", home: "b", away: "c" }];
  const out = sim.simulate(rows, fx, {});
  assert.equal(find(out.rows, "a").status.champion, "clinched");
  assert.equal(find(out.rows, "c").status.champion, "eliminated");
  assert.equal(find(out.rows, "d").status.champion, "eliminated");
  const tie = sim.simulate([row("a", 1, 29), row("b", 2, 26), row("c", 3, 20), row("d", 4, 5)], fx, {});
  assert.equal(find(tie.rows, "a").status.champion, "open");
  assert.equal(find(tie.rows, "b").status.champion, "open");
});

test("tüm maçlar belirlenince eşit puanda sıra averajla kesinleşir", () => {
  const rows = [row("a", 1, 12, { goalsFor: 12 }), row("b", 2, 9), row("c", 3, 3), row("d", 4, 1)];
  const fx = [{ id: "1", home: "b", away: "c" }];
  const open = sim.simulate(rows, fx, {});
  assert.equal(find(open.rows, "a").status.champion, "open");
  const done = sim.simulate(rows, fx, { 1: { home: 2, away: 1 } });
  assert.deepEqual(done.rows.map((r) => r.id).slice(0, 2), ["a", "b"], "12 puan eşit, averaj a lehine");
  assert.equal(find(done.rows, "a").status.champion, "clinched");
  assert.equal(find(done.rows, "b").status.champion, "eliminated");
  const big = sim.simulate(rows, fx, { 1: { home: 5, away: 0 } });
  assert.equal(big.rows[0].id, "b", "b +5 averajla öne geçer");
  assert.equal(find(big.rows, "b").status.champion, "clinched");
});

test("ilk k ve küme düşme durumu", () => {
  const rows = [30, 25, 14, 13, 10, 5].map((p, i) => row(`t${i}`, i + 1, p));
  const out = sim.simulate(rows, [{ id: "1", home: "t2", away: "t3" }, { id: "2", home: "t3", away: "t4" }], {});
  const k = (id, n) => sim.placeStatus(find(out.rows, id), out.rows, n);
  assert.equal(k("t0", 2), "clinched");
  assert.equal(k("t1", 1), "eliminated");
  assert.equal(find(out.rows, "t2").status.safety, "open");
  assert.equal(find(out.rows, "t3").status.safety, "open");
  assert.equal(find(out.rows, "t4").status.safety, "eliminated");
  assert.equal(find(out.rows, "t5").status.safety, "eliminated");
  const after = sim.simulate(rows, [{ id: "1", home: "t2", away: "t3" }, { id: "2", home: "t3", away: "t4" }], { 1: { result: "H" } });
  assert.equal(find(after.rows, "t2").status.safety, "clinched");
});

test("'Bu maçı kazansam ne olur': sıradaki seçilmemiş maç ve üç sonuç", () => {
  const rows = [row("a", 1, 10), row("b", 2, 9), row("c", 3, 9, { goalsFor: 9 })];
  const fx = [{ id: "1", home: "b", away: "a" }, { id: "2", home: "c", away: "b" }];
  const s = sim.scenarioFor(rows, fx, { 1: { result: "D" } }, "b");
  assert.equal(s.match.id, "2");
  assert.equal(s.isHome, false);
  assert.deepEqual([s.win.points, s.draw.points, s.loss.points], [13, 11, 10]);
  assert.ok(s.win.rank <= s.draw.rank && s.draw.rank <= s.loss.rank);
  assert.equal(sim.scenarioFor(rows, fx, { 1: { result: "D" }, 2: { result: "H" } }, "b"), null);
});

test("kalan maç çözümü: sayım kısıtı, tek anlamlılık, çelişki", () => {
  const ids = ["a", "b", "c"];
  const fixtures = [
    { id: "1", round: 1, home: "a", away: "b", kickoff: "2026-01-01T00:00:00Z" },
    { id: "2", round: 2, home: "b", away: "c", kickoff: "2026-01-08T00:00:00Z" },
    { id: "3", round: 3, home: "c", away: "a", kickoff: "2026-02-01T00:00:00Z" },
    { id: "4", round: 4, home: "b", away: "a", kickoff: "2026-02-08T00:00:00Z" },
    { id: "5", round: 5, home: "c", away: "b", kickoff: null },
    { id: "6", round: 6, home: "a", away: "c", kickoff: null }
  ];
  const at = Date.parse("2026-01-15T00:00:00Z");
  const played = new Map([["a", 1], ["b", 2], ["c", 1]]);
  const ok = resolveRemaining({ teamIds: ids, played, fixtures, isFinished: (m) => m.id === "1", standingsAt: at });
  assert.deepEqual(ok.remaining.map((m) => m.id), ["3", "4", "5", "6"]);
  const postponed = resolveRemaining({ teamIds: ids, played: new Map([["a", 1], ["b", 1], ["c", 0]]), fixtures, isFinished: (m) => m.id === "1", standingsAt: at });
  assert.deepEqual(postponed.remaining.map((m) => m.id), ["2", "3", "4", "5", "6"]);
  assert.ok(resolveRemaining({ teamIds: ids, played: new Map([["a", 3], ["b", 2], ["c", 1]]), fixtures, isFinished: () => false, standingsAt: at }).error);
  const four = ["a", "b", "c", "d"];
  const past = (id, home, away) => ({ id, round: 1, home, away, kickoff: "2026-01-01T00:00:00Z" });
  const ambiguous = resolveRemaining({ teamIds: four, played: new Map(four.map((t) => [t, 5])), fixtures: [past("1", "a", "b"), past("2", "c", "d"), past("3", "a", "c"), past("4", "b", "d")], isFinished: () => false, standingsAt: at });
  assert.match(ambiguous.error, /tek anlamlı değil/);
});

test("gerçek veri: Süper Lig kalan maçları her takım için oynanan + kalan = 2·(n-1)", () => {
  const result = buildSuperLigSimulator(root);
  if (!result.ok) {
    console.log(`  ..  veri reddedildi (${result.reason}); sayfa boş durum basar`);
    return;
  }
  const { rows, fixtures } = result.data;
  const per = 2 * (rows.length - 1);
  for (const r of rows) {
    const left = fixtures.filter((m) => m.home === r.id || m.away === r.id).length;
    assert.equal(r.played + left, per, r.name);
  }
  assert.equal(new Set(fixtures.map((m) => `${m.home}|${m.away}`)).size, fixtures.length, "aynı eşleşme iki kez yok");
  const out = sim.simulate(rows, fixtures.map((m, i) => ({ ...m, id: String(i) })), {});
  assert.deepEqual(out.rows.map((r) => r.id), rows.map((r) => r.id), "seçim yokken sıra resmî sırayla aynı");
  const allDraws = Object.fromEntries(fixtures.map((m) => [m.id, { result: "D" }]));
  const full = sim.simulate(rows, fixtures, allDraws);
  assert.equal(full.open, 0);
  for (const r of full.rows) {
    const official = find(rows, r.id);
    assert.equal(r.played, per, `${r.name} sezon sonu maç sayısı`);
    assert.equal(r.points, official.points + (per - official.played), `${r.name} beraberlik puanı`);
    assert.equal(r.remaining, 0);
    assert.notEqual(r.status.champion, "open", "sezon bitince durum kesin");
  }
});

test("sayfa: Türkçe meta, kanonik, gömülü veri; uydurma olasılık yok; ağ isteği yok", () => {
  const result = buildSuperLigSimulator(root);
  const html = page.renderPage(result);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.futbolradar\.com\/puan-durumu-simulator" \/>/);
  assert.match(html, /<html lang="tr">/);
  assert.match(html, /<title>Süper Lig Puan Durumu Simülatörü/);
  assert.doesNotMatch(html, /\d+\s*%|%\s*\d+/, "yüzde/olasılık metni yok");
  if (result.ok) {
    assert.match(html, /content="index,/);
    const json = JSON.parse(html.match(/<script type="application\/json" id="sim-data">([\s\S]*?)<\/script>/)[1]);
    assert.equal(json.rows.length, result.data.rows.length);
    assert.equal(json.fx.length, result.data.fixtures.length);
    assert.deepEqual(json.fx.map((f) => f[0]), result.data.fixtures.map((m) => m.id), "seçimler kalıcı maç kimliğine bağlı");
    assert.ok(json.fx.every((f) => f[4] === null || Number.isFinite(Date.parse(f[4]))), "başlama saati saat dilimli ISO");
  }
  const off = page.renderPage({ ok: false, reason: "test" });
  assert.match(off, /noindex/);
  assert.doesNotMatch(off, /sim-data|puan-durumu-simulator\.js/);
  const client = fs.readFileSync(path.join(root, "puan-durumu-simulator.js"), "utf8");
  assert.doesNotMatch(client, /fetch\(|XMLHttpRequest|sendBeacon/);
  const core = path.join(root, "standings-simulator-core.js");
  if (fs.existsSync(core)) assert.ok(fs.readFileSync(core, "utf8").endsWith(fs.readFileSync(path.join(root, "services", "standingsSimulator.js"), "utf8")), "istemci çekirdeği güncel");
});

test("yönlendirme ve zincir kaydı", () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  assert.ok(vercel.rewrites.some((r) => r.source === "/puan-durumu-simulator" && r.destination === "/puan-durumu-simulator.html"));
  assert.ok(vercel.redirects.some((r) => r.source === "/puan-durumu-simulator.html" && r.destination === "/puan-durumu-simulator"));
  assert.match(fs.readFileSync(path.join(root, "scripts", "lib", "postprocessChain.mjs"), "utf8"), /generate-standings-simulator-page\.mjs/);
});

console.log(`test-standings-simulator: ${passed} test geçti`);
