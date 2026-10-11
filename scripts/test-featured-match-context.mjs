/**
 * ÖNE ÇIKARILAN MAÇ BAĞLAMI — sözleşme testleri.
 *  1. Yalnızca bitmiş ve skoru okunabilir maçlar sayılır; h2h yalnızca iki takım.
 *  2. Özet sayılar elle hesaplanan değerle aynı.
 *  3. İstek penceresi: 72 saat önce açılır, 12 saatte bir, maç başlayınca kapanır.
 *  4. Koşu başına istek sınırı (maç başına 3) ve anahtar yokken sıfır istek.
 *  5. Veri yoksa bölüm basılmaz (uydurma alan yok).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { comparisonSectionHtml, formSectionHtml } from "./lib/matchSeoPage.mjs";

const require = createRequire(import.meta.url);
const ctxLib = require("../services/featuredMatchContext.js");
const root = process.cwd();

const raw = (id, date, home, away, hg, ag, short = "FT", league = "UEFA Champions League") => ({
  fixture: { id, date, status: { short } },
  league: { name: league },
  teams: { home: { id: home[0], name: home[1] }, away: { id: away[0], name: away[1] } },
  goals: { home: hg, away: ag }
});
const GS = [645, "Galatasaray"]; const FCB = [529, "Barcelona"]; const X = [1004, "Kasımpaşa"]; const Y = [530, "Atletico Madrid"];
const fixture = { id: "galatasaray-barcelona-2026-10-13", providerFixtureId: "999", homeTeam: "Galatasaray", awayTeam: "Barcelona", homeTeamId: "645", awayTeamId: "529", kickoff: "2026-10-13T22:00:00+03:00" };

const built = ctxLib.buildContext({
  fixture,
  h2hPayload: { response: [raw(1, "2022-03-17T20:00:00+00:00", GS, FCB, 1, 2, "FT", "UEFA Europa League"), raw(2, "2022-03-10T20:00:00+00:00", FCB, GS, 0, 0, "FT", "UEFA Europa League"), raw(3, "2026-10-13T19:00:00+00:00", GS, FCB, null, null, "NS")] },
  homeLastPayload: { response: [raw(10, "2026-10-09T17:00:00+00:00", GS, X, 3, 1, "FT", "Süper Lig"), raw(11, "2026-09-19T17:00:00+00:00", X, GS, 4, 0, "FT", "Süper Lig"), raw(12, "2026-09-30T17:00:00+00:00", GS, X, 1, 1, "PST", "Süper Lig")] },
  awayLastPayload: { response: [raw(20, "2026-10-10T17:00:00+00:00", FCB, Y, 3, 0, "FT", "La Liga"), raw(21, "2026-09-20T17:00:00+00:00", Y, FCB, 0, 0, "AET", "La Liga")] },
  fetchedAt: "2026-10-12T01:00:00.000Z"
});
assert.equal(built.h2h.length, 2, "başlamamış maç h2h'ye girmez");
assert.equal(built.last10.home.length, 2, "ertelenen (PST) maç sayılmaz");
assert.deepEqual(
  { p: built.summary.home.played, w: built.summary.home.wins, l: built.summary.home.losses, gf: built.summary.home.goalsFor, ga: built.summary.home.goalsAgainst, cs: built.summary.home.cleanSheets, fts: built.summary.home.failedToScore, gfpm: built.summary.home.goalsForPerMatch },
  { p: 2, w: 1, l: 1, gf: 3, ga: 5, cs: 0, fts: 1, gfpm: 1.5 }
);
assert.equal(built.summary.away.cleanSheets, 2);
assert.equal(built.last10.home[0].date, "2026-10-09T17:00:00+00:00", "en yeni maç önce");
// Başka takım çifti h2h listesine giremez.
const foreign = ctxLib.buildContext({ fixture, h2hPayload: { response: [raw(5, "2020-01-01T00:00:00+00:00", GS, X, 1, 0)] }, homeLastPayload: [], awayLastPayload: [], fetchedAt: "x" });
assert.equal(foreign.h2h.length, 0);
assert.equal(foreign.summary.home, null, "maç yoksa özet null — sıfır uydurulmaz");

// İstek penceresi
const kickoff = Date.parse(fixture.kickoff);
const H = 3600 * 1000;
assert.equal(ctxLib.needsFetch(null, fixture, kickoff - 80 * H).fetch, false, "72 saatten önce istek yok");
assert.equal(ctxLib.needsFetch(null, fixture, kickoff - 40 * H).fetch, true);
assert.equal(ctxLib.needsFetch({ fetchedAt: new Date(kickoff - 40 * H).toISOString() }, fixture, kickoff - 30 * H).fetch, false, "12 saat dolmadan tekrar yok");
assert.equal(ctxLib.needsFetch({ fetchedAt: new Date(kickoff - 40 * H).toISOString() }, fixture, kickoff - 27 * H).fetch, true);
assert.equal(ctxLib.needsFetch(null, fixture, kickoff + 60 * 1000).fetch, false, "maç başlayınca istek yok");

// Sayfa bölümleri
const pageCtx = { locale: "tr", homeTeam: "Galatasaray", awayTeam: "Barcelona", pageHrefFor: () => null };
const compareHtml = comparisonSectionHtml(built.summary, pageCtx);
assert.ok(compareHtml.includes('id="hucum-savunma"') && compareHtml.includes("1,50"), "TR ondalık virgül");
assert.equal(comparisonSectionHtml({ home: built.summary.home, away: null }, pageCtx), "", "tek taraf varsa bölüm yok");
assert.equal(comparisonSectionHtml(null, pageCtx), "");
assert.ok(comparisonSectionHtml(built.summary, { ...pageCtx, locale: "en" }).includes("1.50"));
const formHtml = formSectionHtml({ home: [{ result: "W", label: "a", match: { homeTeam: "Galatasaray", awayTeam: "Kasımpaşa", kickoff: "2026-10-09T20:00:00+03:00", league: "Süper Lig", score: { home: 3, away: 1 } } }], away: [], source: "provider-last10" }, pageCtx);
assert.ok(formHtml.includes("son 10 maç") && formHtml.includes("API-Football"), "sağlayıcı formu 'son 10 maç' başlığı ve kaynak notu taşır");

// Senkron betiği: kimlikleri tutan takvim + sahte sağlayıcı; istek sayısı ve anahtarsız koşu.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fmc-"));
fs.mkdirSync(path.join(temp, "data"));
fs.writeFileSync(path.join(temp, "data/featured-match-spotlight.json"), JSON.stringify({ featuredFixtures: [{ homeTeam: "Galatasaray", awayTeam: "Barcelona", date: "2026-10-13" }] }));
fs.writeFileSync(path.join(temp, "data/fixture-calendar.json"), JSON.stringify({ matches: [
  { id: fixture.id, homeTeam: "Galatasaray", awayTeam: "Barcelona", kickoff: fixture.kickoff, providerIds: { apiFootball: "999" }, homeTeamId: "645", awayTeamId: "529" },
  { id: "galatasaray-kasimpasa-2026-10-17", homeTeam: "Galatasaray", awayTeam: "Kasımpaşa", kickoff: "2026-10-17T20:00:00+03:00", providerIds: { apiFootball: "1000" }, homeTeamId: "645", awayTeamId: "1004" }
] }));
const fake = path.join(temp, "fake-provider.cjs");
fs.writeFileSync(fake, `
const fs = require("fs");
const log = ${JSON.stringify(path.join(temp, "requests.log"))};
module.exports = {
  hasConfig: () => process.env.FAKE_KEY === "1",
  providerFetch: async (p, params) => { fs.appendFileSync(log, p + " " + JSON.stringify(params) + "\\n"); return { response: [] }; }
};`);
const run = (args, env = {}) => spawnSync(process.execPath, [path.join(root, "scripts/sync-featured-match-context.mjs"), ...args], { cwd: temp, encoding: "utf8", env: { ...process.env, FEATURED_CONTEXT_PROVIDER: fake, ...env } });
const now = "--now=2026-10-12T03:00:00+03:00";
let result = run([now, "--apply"], { FAKE_KEY: "0" });
assert.equal(result.status, 0, result.stderr);
assert.ok(!fs.existsSync(path.join(temp, "requests.log")), "anahtar yokken istek yok");
assert.ok(!fs.existsSync(path.join(temp, "data/featured-match-context.json")), "anahtar yokken dosya yazılmaz");
result = run([now]);
assert.ok(/3 istek atılacaktı/.test(result.stdout), "kuru koşu yalnızca seçilmiş maç için 3 istek listeler");
assert.ok(!fs.existsSync(path.join(temp, "requests.log")));
result = run([now, "--apply"], { FAKE_KEY: "1" });
const lines = fs.readFileSync(path.join(temp, "requests.log"), "utf8").trim().split("\n");
assert.equal(lines.length, 3, "maç başına 3 istek");
assert.ok(lines[0].startsWith("/fixtures/headtohead") && lines[0].includes("645-529"));
assert.ok(!lines.some((line) => line.includes("1004")), "seçilmemiş maç için istek yok");
const stored = JSON.parse(fs.readFileSync(path.join(temp, "data/featured-match-context.json"), "utf8"));
assert.ok(stored.fixtures["999"] && stored.fixtures["999"].h2h.length === 0, "boş yanıt boş liste — uydurma satır yok");
// İkinci koşu 12 saat dolmadan istek atmaz.
run(["--now=2026-10-12T05:00:00+03:00", "--apply"], { FAKE_KEY: "1" });
assert.equal(fs.readFileSync(path.join(temp, "requests.log"), "utf8").trim().split("\n").length, 3, "12 saat kuralı");
fs.rmSync(temp, { recursive: true, force: true });

console.log("featured-match-context: tüm sözleşmeler doğrulandı.");
