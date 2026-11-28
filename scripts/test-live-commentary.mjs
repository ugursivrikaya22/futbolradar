#!/usr/bin/env node
/**
 * Canlı anlatım: allowlist varsayılan ret, Galatasaray-Fenerbahçe kabul,
 * metin yalnızca verilen olaydan.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const commentary = require("../services/liveCommentary.js");
const store = require("../services/liveCommentaryStore.js");

let failures = 0;
const queue = [];
function test(name, fn) {
  queue.push((async () => {
    try {
      await fn();
      console.log(`  ok  ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`  FAIL ${name}\n       ${error && error.stack || error}`);
    }
  })());
}

function fixture(home, away, leagueId, extras) {
  const extra = extras || {};
  return {
    fixture: { id: extra.id || 1584442, status: { short: extra.status || "1H" } },
    league: { id: leagueId },
    teams: {
      home: { id: home.id, name: home.name },
      away: { id: away.id, name: away.name }
    },
    goals: {
      home: extra.homeScore === undefined ? null : extra.homeScore,
      away: extra.awayScore === undefined ? null : extra.awayScore
    },
    score: {
      halftime: {
        home: extra.htHome === undefined ? null : extra.htHome,
        away: extra.htAway === undefined ? null : extra.htAway
      },
      penalty: {
        home: extra.penHome === undefined ? null : extra.penHome,
        away: extra.penAway === undefined ? null : extra.penAway
      }
    },
    events: extra.events || []
  };
}

const GS = { id: 645, name: "Galatasaray" };
const FB = { id: 611, name: "Fenerbahçe" };
const BJK = { id: 549, name: "Beşiktaş" };
const TS = { id: 998, name: "Trabzonspor" };
const KASIMPASA = { id: 1001, name: "Kasımpaşa" };
const KONYA = { id: 607, name: "Konyaspor" };

console.log("live-commentary");

test("Galatasaray-Kasımpaşa anlatımı açılmaz", () => {
  const body = commentary.respondToFixture(fixture(GS, KASIMPASA, 203, {
    events: [{ time: { elapsed: 12 }, team: { name: "Galatasaray" }, player: { name: "Osimhen" }, type: "Goal", detail: "Normal Goal" }]
  }));
  assert.equal(body.enabled, false);
  assert.equal(body.reason, "not-allowlisted");
  assert.deepEqual(body.lines, []);
  assert.equal(body.notice, undefined);
  assert.equal(commentary.sectionHtml({
    locale: "tr",
    homeTeam: "Galatasaray",
    awayTeam: "Kasımpaşa",
    homeTeamId: 645,
    awayTeamId: 1001,
    competitionId: "super-lig",
    fixtureId: "1584400"
  }), "");
});

test("Konyaspor kimliği 607 Trabzonspor sayılmaz", () => {
  assert.equal(commentary.qualify({
    homeTeam: "Konyaspor",
    awayTeam: "Galatasaray",
    homeTeamId: KONYA.id,
    awayTeamId: GS.id,
    competitionId: "super-lig"
  }).eligible, false);
});

test("Galatasaray-Fenerbahçe derbisi allowlist'te", () => {
  const decision = commentary.qualify({
    homeTeam: "Galatasaray",
    awayTeam: "Fenerbahçe",
    competitionId: "super-lig"
  });
  assert.equal(decision.eligible, true);
  assert.equal(decision.ruleId, "super-lig-big-four");

  const byId = commentary.qualify({
    homeTeamId: GS.id,
    awayTeamId: FB.id,
    providerLeagueId: 203
  });
  assert.equal(byId.eligible, true);

  const html = commentary.sectionHtml({
    locale: "tr",
    homeTeam: "Galatasaray",
    awayTeam: "Fenerbahçe",
    competitionId: "super-lig",
    fixtureId: "1584442",
    state: "post",
    reportHref: "../mac-raporu/galatasaray-fenerbahce-26-ekim-2026.html"
  });
  assert.match(html, /id="canli-anlatim"/);
  assert.match(html, /data-live-commentary/);
  assert.match(html, /data-commentary-fixture="1584442"/);
  assert.match(html, /Veri bekleniyor/);
  assert.match(html, /href="\.\.\/mac-raporu\/galatasaray-fenerbahce-26-ekim-2026\.html"/);
  assert.match(html, /Ayrıntılı maç raporu/);
  assert.doesNotMatch(html, /<title|rel="canonical"|application\/ld\+json|robots/i);
});

test("yarışma yoksa iki büyük takım da yetmez", () => {
  assert.equal(commentary.qualify({ homeTeam: "Galatasaray", awayTeam: "Fenerbahçe" }).eligible, false);
  assert.equal(commentary.qualify({
    homeTeam: "Galatasaray",
    awayTeam: "Fenerbahçe",
    competitionId: "turkiye-kupasi"
  }).eligible, false);
  assert.equal(commentary.qualify({
    homeTeam: "Galatasaray U19",
    awayTeam: "Fenerbahçe",
    competitionId: "super-lig"
  }).eligible, false);
});

test("Avrupa ligi örnekleri: Inter-Milan, Real-Barça, Bayern-Stuttgart, Arsenal-City kabul; Arsenal-Bournemouth ret", () => {
  assert.equal(commentary.qualify({ homeTeamId: 505, awayTeamId: 489, providerLeagueId: 135 }).eligible, true);
  assert.equal(commentary.qualify({ homeTeamId: 541, awayTeamId: 529, providerLeagueId: 140 }).eligible, true);
  assert.equal(commentary.qualify({ homeTeam: "Bayern München", awayTeam: "VfB Stuttgart", competitionId: "bundesliga" }).eligible, true);
  assert.equal(commentary.qualify({ homeTeam: "Arsenal", awayTeam: "Manchester City", competitionId: "premier-league" }).eligible, true);
  assert.equal(commentary.qualify({ homeTeamId: 42, awayTeamId: 35, providerLeagueId: 39 }).eligible, false);
});

test("Avrupa kupasında listeli takımın maçı açılır, iki listsiz takım açılmaz", () => {
  assert.equal(commentary.qualify({
    homeTeamId: 645,
    awayTeamId: 172,
    competitionId: "sampiyonlar-ligi",
    providerLeagueId: 2
  }).eligible, true);
  assert.equal(commentary.qualify({
    homeTeam: "Trabzonspor",
    awayTeam: "Kasımpaşa",
    homeTeamId: TS.id,
    awayTeamId: KASIMPASA.id,
    providerLeagueId: 848
  }).eligible, true);
  assert.equal(commentary.qualify({
    homeTeamId: 1001,
    awayTeamId: 1002,
    providerLeagueId: 2
  }).eligible, false);
  assert.equal(commentary.qualify({
    homeTeam: "Galatasaray",
    awayTeam: "Fenerbahçe",
    competitionId: "super-lig",
    providerLeagueId: 2
  }).eligible, false);
});

test("gol cümlesi yalnızca olaydaki oyuncu ve asistten kurulur", () => {
  const body = commentary.respondToFixture(fixture(GS, FB, 203, {
    status: "1H",
    events: [{
      time: { elapsed: 23 },
      team: { id: 645, name: "Galatasaray" },
      player: { name: "Osimhen" },
      assist: { name: "Torreira" },
      type: "Goal",
      detail: "Normal Goal"
    }]
  }));
  assert.equal(body.enabled, true);
  assert.equal(body.reason, "allowlisted");
  assert.equal(body.lines.length, 1);
  assert.equal(body.lines[0].minute, "23'");
  assert.match(body.lines[0].text, /Gol\. Galatasaray: Osimhen\./);
  assert.match(body.lines[0].text, /Asist: Torreira\./);
  assert.doesNotMatch(body.lines[0].text, /Icardi|pozisyon|harika|net bir fırsat/i);
  assert.equal(body.lines.some((row) => row.kind === "halftime"), false);
});

test("olay yokken uydurma satır yok, bekleyen maçta veri bekleniyor", () => {
  const live = commentary.buildLines({
    homeTeam: "Galatasaray",
    awayTeam: "Fenerbahçe",
    status: "1H",
    score: {},
    events: []
  });
  assert.deepEqual(live.lines, []);
  assert.equal(live.pending, true);
  assert.equal(live.notice, "Veri bekleniyor.");

  const quiet = commentary.buildLines({
    homeTeam: "Galatasaray",
    awayTeam: "Fenerbahçe",
    status: "FT",
    score: { home: null, away: null },
    events: []
  });
  assert.deepEqual(quiet.lines, []);
  assert.equal(quiet.final, true);
  assert.equal(quiet.notice, null);
});

test("devre arası özeti yalnızca ilk yarı bittiyse ve skor alandaysa yazılır", () => {
  const early = commentary.buildLines({
    homeTeam: "Galatasaray",
    awayTeam: "Beşiktaş",
    status: "1H",
    score: { home: 1, away: 0, halftimeHome: 1, halftimeAway: 0 },
    events: [{ time: { elapsed: 10 }, team: { name: "Galatasaray" }, player: { name: "Osimhen" }, type: "Goal", detail: "Normal Goal" }]
  });
  assert.equal(early.lines.some((row) => row.kind === "halftime"), false);

  const ht = commentary.buildLines({
    homeTeam: "Galatasaray",
    awayTeam: "Beşiktaş",
    status: "HT",
    score: { home: 1, away: 0, halftimeHome: 1, halftimeAway: 0 },
    events: [
      { time: { elapsed: 45, extra: 2 }, team: { name: "Beşiktaş" }, player: { name: "Rafa" }, type: "Card", detail: "Yellow Card" },
      { time: { elapsed: 10 }, team: { name: "Galatasaray" }, player: { name: "Osimhen" }, type: "Goal", detail: "Normal Goal" }
    ]
  });
  const summary = ht.lines.find((row) => row.kind === "halftime");
  assert.ok(summary);
  assert.equal(summary.text, "Devre arası. Galatasaray 1-0 Beşiktaş.");
  assert.ok(ht.lines.find((row) => row.minute === "45+2'" && /Rafa/.test(row.text)));
  assert.doesNotMatch(summary.text, /Rafa|Osimhen/);
});

test("maç sonu skoru tabeladan gelir; değişiklik ve iptal gol uydurulmaz", () => {
  const full = commentary.buildLines({
    homeTeam: "Galatasaray",
    awayTeam: "Fenerbahçe",
    status: "FT",
    score: { home: 2, away: 1, halftimeHome: 1, halftimeAway: 0 },
    events: [
      { time: { elapsed: 60 }, team: { name: "Fenerbahçe" }, player: { name: "Talisca" }, assist: { name: "Szymanski" }, type: "subst", detail: "Substitution 1" },
      { time: { elapsed: 70 }, team: { name: "Galatasaray" }, player: { name: "Icardi" }, type: "Goal", detail: "Goal cancelled" },
      { time: { elapsed: 80 }, team: { name: "Fenerbahçe" }, player: { name: "Dzeko" }, type: "Goal", detail: "Missed Penalty" }
    ]
  });
  const end = full.lines.find((row) => row.kind === "fulltime");
  assert.equal(end.text, "Maç sona erdi. Galatasaray 2-1 Fenerbahçe.");
  const sub = full.lines.find((row) => row.kind === "sub");
  assert.equal(sub.text, "Oyuncu değişikliği. Fenerbahçe: Talisca çıktı, Szymanski girdi.");
  assert.equal(full.lines.some((row) => row.kind === "goal" && /Icardi/.test(row.text)), false);
  assert.match(full.lines.find((row) => row.kind === "var").text, /iptal/);
  assert.match(full.lines.find((row) => row.kind === "missed-penalty").text, /Dzeko/);
  assert.equal(full.lines.some((row) => /fırsat|pozisyon/.test(row.text)), false);
});

test("tanınmayan olay satır açmaz", () => {
  const built = commentary.buildLines({
    homeTeam: "Inter",
    awayTeam: "AC Milan",
    status: "2H",
    score: { halftimeHome: 0, halftimeAway: 0 },
    events: [{ time: { elapsed: 50 }, team: { name: "Inter" }, type: "Chance", detail: "Big chance" }]
  });
  assert.equal(built.lines.some((row) => row.kind !== "halftime"), false);
  assert.equal(built.lines.find((row) => row.kind === "halftime").text, "Devre arası. Inter 0-0 AC Milan.");
});

test("bitmiş anlatım arşive yazılır ve geri okunur", () => {
  const file = path.join(os.tmpdir(), `live-commentary-${process.pid}.json`);
  const snapshot = commentary.respondToFixture(fixture(BJK, TS, 203, {
    id: 1584438,
    status: "FT",
    homeScore: 1,
    awayScore: 1,
    htHome: 0,
    htAway: 0
  }));
  assert.equal(snapshot.final, true);
  assert.equal(store.remember({ ...snapshot, fixtureId: "1584438" }, file), true);
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(saved.matches["1584438"].final, true);
  assert.match(saved.matches["1584438"].lines.find((row) => row.kind === "fulltime").text, /Beşiktaş 1-1 Trabzonspor/);
  assert.equal(store.remember({ enabled: true, final: false, fixtureId: "1", lines: [{ text: "uydurma" }] }, file), false);
  fs.unlinkSync(file);
});

test("istemci allowlist dışını kapatır, yalnızca canlıyken 45 sn yoklar, başlığı değiştirmez", () => {
  const source = fs.readFileSync(path.join(root, "live-commentary.js"), "utf8");
  assert.match(source, /not-allowlisted/);
  assert.match(source, /root\.hidden = true/);
  assert.match(source, /\/api\/commentary\?fixtureId=/);
  assert.match(source, /POLL_MS = 45000/);
  assert.match(source, /document\.hidden/);
  assert.doesNotMatch(source, /document\.title/);
  assert.doesNotMatch(source, /pushNotifier|serviceWorker|news-ticker/);
});

test("sayfa üretici kabuğu olayların önüne koyar ve yeni rota açmaz", () => {
  const source = fs.readFileSync(path.join(root, "scripts/generate-match-seo-pages.mjs"), "utf8");
  assert.match(source, /commentaryHtml,\s*\n\s*eventsSectionHtml/);
  assert.match(source, /live-commentary\.js/);
  assert.doesNotMatch(source, /canli-anlatim\.html/);
  const route = fs.readFileSync(path.join(root, "api/[...route].js"), "utf8");
  assert.doesNotMatch(route, /liveCommentary|commentary-allowlist/);
  const service = fs.readFileSync(path.join(root, "services/liveCommentary.js"), "utf8");
  assert.doesNotMatch(service, /require\([^)]*fixture-calendar/);
  const endpoint = fs.readFileSync(path.join(root, "api/commentary.js"), "utf8");
  assert.doesNotMatch(endpoint, /require\([^)]*fixture-calendar/);
  const allow = JSON.parse(fs.readFileSync(path.join(root, "data/commentary-allowlist.json"), "utf8"));
  assert.equal(allow.default, "deny");
  for (const rule of allow.rules) {
    if (rule.teamIds === "*") continue;
    for (const id of rule.teamIds) assert.ok(allow.teams[id], `${rule.id} kimliği teams içinde yok: ${id}`);
  }
});

test("eksik fikstür kimliği anlatım açmaz", async () => {
  const handler = require("../api/commentary.js");
  const res = {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
  await handler({ method: "GET", url: "/api/commentary", headers: {} }, res);
  assert.equal(res.body.enabled, false);
  assert.equal(res.body.reason, "not-allowlisted");
  assert.deepEqual(res.body.lines, []);
});

test("istemci derbi cümlesini basar, allowlist dışı yanıtta bölümü kapatır", async () => {
  const source = fs.readFileSync(path.join(root, "live-commentary.js"), "utf8");
  const timers = new Set();
  async function boot(payload, state) {
    const list = {
      hidden: true,
      attributes: {},
      setAttribute(key, value) { this.attributes[key] = value; },
      getAttribute(key) { return this.attributes[key] || null; },
      innerHTML: ""
    };
    const wait = { hidden: false };
    const rootEl = {
      hidden: false,
      attributes: {
        "data-commentary-fixture": "1584442",
        "data-commentary-state": state,
        "data-commentary-kickoff": new Date(Date.now() - 60 * 1000).toISOString()
      },
      getAttribute(key) { return this.attributes[key] || null; },
      querySelector(selector) {
        if (String(selector).includes("list")) return list;
        if (String(selector).includes("wait")) return wait;
        return null;
      }
    };
    const calls = [];
    const sandbox = {
      document: { hidden: false, querySelector() { return rootEl; }, addEventListener() {} },
      window: {},
      fetch(url) {
        calls.push(String(url));
        return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) });
      },
      setTimeout(fn, ms) {
        const id = setTimeout(fn, ms);
        timers.add(id);
        return id;
      },
      clearTimeout(id) {
        timers.delete(id);
        clearTimeout(id);
      },
      encodeURIComponent,
      console
    };
    sandbox.window.fetch = sandbox.fetch;
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    await new Promise((resolve) => setTimeout(resolve, 40));
    return { root: rootEl, list, wait, calls };
  }

  const denied = await boot({ enabled: false, reason: "not-allowlisted", lines: [{ id: "x", minute: "1'", kind: "goal", text: "Gol. Kasımpaşa: Birisi." }] }, "live");
  assert.equal(denied.root.hidden, true);
  assert.equal(denied.list.innerHTML, "");
  assert.deepEqual(denied.calls, ["/api/commentary?fixtureId=1584442"]);

  const allowed = await boot({
    enabled: true,
    reason: "allowlisted",
    status: "FT",
    final: true,
    lines: [{ id: "g1", minute: "23'", kind: "goal", text: "Gol. Galatasaray: Osimhen." }]
  }, "post");
  assert.equal(allowed.root.hidden, false);
  assert.match(allowed.list.innerHTML, /Gol\. Galatasaray: Osimhen\./);
  assert.equal(allowed.wait.hidden, true);
  assert.doesNotMatch(allowed.list.innerHTML, /Kasımpaşa|Birisi/);
  for (const id of timers) clearTimeout(id);
});

test("canlı yoklama önbelleğe yazılmaz, bitmiş anlatım CDN'de kalır", () => {
  const { cacheControlFor } = require("../api/_utils.js");
  assert.deepEqual(cacheControlFor("commentary-live"), { browser: "no-store", cdn: "no-store" });
  assert.match(cacheControlFor("commentary-final").cdn, /s-maxage=86400/);
});

await Promise.all(queue);

if (failures) {
  console.error(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nall passed");
