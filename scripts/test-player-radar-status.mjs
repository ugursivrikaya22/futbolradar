/**
 * OYUNCU RADARI — GÜNLÜK DURUM VE "GÜNCELLEME GEREKEN" KURALI.
 *
 * Bildirilen: oyuncu radarı sayfasında "Son kontrol" eski bir tarihte donmuştu
 * ve "Güncelleme gereken" listesi zamana bakmıyordu.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..");
const { PLAYER_STALE_DAYS, STAMP_FIELDS, playerRefreshReason, summarizePlayerRadar, newestPlayerSyncAt } = require("../services/playerDataFreshness.js");

let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`ok - ${name}`); };

const NOW = Date.parse("2026-11-26T09:00:00Z");
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();

test("taze oyuncu güncelleme beklemez; sınırda (14 gün) beklemez, 15 günde bekler", () => {
  assert.equal(playerRefreshReason({ id: "a", lastUpdatedAt: daysAgo(3) }, NOW), null);
  assert.equal(playerRefreshReason({ id: "a", lastUpdatedAt: daysAgo(PLAYER_STALE_DAYS) }, NOW), null);
  assert.equal(playerRefreshReason({ id: "a", lastUpdatedAt: daysAgo(PLAYER_STALE_DAYS + 1) }, NOW), "stale-stamp");
});

test("en yeni damga sayılır; hiç damga yoksa güncelleme bekler", () => {
  assert.equal(playerRefreshReason({ lastSyncedAt: daysAgo(90), lastProviderSeenAt: daysAgo(2) }, NOW), null);
  assert.equal(playerRefreshReason({ id: "x" }, NOW), "no-stamp");
  assert.equal(playerRefreshReason({ id: "x", lastVerifiedAt: "bozuk-tarih" }, NOW), "no-stamp");
});

test("incelemeyi gerektiren dataStatus damga taze olsa da bekler", () => {
  for (const status of ["stale", "manual-review", "mock_needs_verification", "transfer_needs_monitoring", "STALE"]) {
    assert.equal(playerRefreshReason({ dataStatus: status, lastUpdatedAt: daysAgo(1) }, NOW), `status:${status.toLowerCase()}`);
  }
  assert.equal(playerRefreshReason({ dataStatus: "verified", lastUpdatedAt: daysAgo(1) }, NOW), null);
});

test("özet: sayılar, sıralama (en eski önce), senkron damgası, deterministik", () => {
  const players = [
    { id: "yeni", name: "Yeni", lastUpdatedAt: daysAgo(1) },
    { id: "eski-1", name: "Eski Bir", lastUpdatedAt: daysAgo(40) },
    { id: "eski-2", name: "Eski İki", lastUpdatedAt: daysAgo(20), currentTeam: "Takım" },
    { id: "bayrak", name: "Bayrak", dataStatus: "manual-review", lastUpdatedAt: daysAgo(2) },
    { id: "damgasiz", name: "Damgasız" }
  ];
  const summary = summarizePlayerRadar(players, new Date(NOW));
  assert.equal(summary.totalPlayers, 5);
  assert.equal(summary.needsUpdateCount, 4);
  assert.deepEqual(summary.byReason, { "stale-stamp": 2, status: 1, "no-stamp": 1 });
  assert.equal(summary.newestSyncAt, daysAgo(1));
  assert.equal(summary.checkedAt, new Date(NOW).toISOString());
  assert.deepEqual(summary.needsUpdate.map((p) => p.id), ["damgasiz", "eski-1", "eski-2", "bayrak"], "damgasız en başta, sonra en eski");
  assert.equal(JSON.stringify(summary), JSON.stringify(summarizePlayerRadar(players, new Date(NOW))));
  assert.equal(newestPlayerSyncAt([]), null);
});

test("özet: liste sınırlıdır, tam sayı korunur", () => {
  const many = Array.from({ length: 450 }, (_, i) => ({ id: `p${i}`, lastUpdatedAt: daysAgo(30) }));
  const summary = summarizePlayerRadar(many, new Date(NOW));
  assert.equal(summary.needsUpdateCount, 450);
  assert.equal(summary.needsUpdate.length, 200);
});

test("betik: günlük yazar, aynı gün/aynı içerikte dokunmaz, ertesi gün checkedAt yenilenir", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "player-radar-status-"));
  try {
    fs.mkdirSync(path.join(dir, "data"));
    fs.writeFileSync(path.join(dir, "data", "players.json"), JSON.stringify([
      { id: "a", name: "A", lastUpdatedAt: "2026-11-01T00:00:00Z" },
      { id: "b", name: "B", lastUpdatedAt: "2026-11-25T00:00:00Z" }
    ]));
    const run = (...extra) => spawnSync(process.execPath, [path.join(here, "refresh-player-radar-status.mjs"), "--apply", ...extra], { cwd: dir, encoding: "utf8" });
    const file = path.join(dir, "data", "player-radar-status.json");

    let r = run("--now=2026-11-26T06:00:00Z");
    assert.equal(r.status, 0, r.stderr);
    const first = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(first);
    assert.equal(parsed.checkedAt, "2026-11-26T06:00:00.000Z");
    assert.equal(parsed.needsUpdateCount, 1);
    assert.equal(parsed.needsUpdate[0].id, "a");

    r = run("--now=2026-11-26T18:00:00Z"); // aynı İstanbul günü
    assert.equal(fs.readFileSync(file, "utf8"), first, "aynı gün dosya değişmemeli");

    r = run("--now=2026-11-27T09:00:00Z"); // ertesi gün
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).checkedAt, "2026-11-27T09:00:00.000Z");

    // Kuru koşu yazmaz; bozuk girdide dosyaya dokunmaz.
    fs.rmSync(file);
    spawnSync(process.execPath, [path.join(here, "refresh-player-radar-status.mjs"), "--now=2026-11-28T09:00:00Z"], { cwd: dir, encoding: "utf8" });
    assert.ok(!fs.existsSync(file), "--apply yoksa yazılmamalı");
    fs.writeFileSync(path.join(dir, "data", "players.json"), "{bozuk");
    r = run();
    assert.notEqual(r.status, 0, "okunamayan oyuncu verisinde hata vermeli");
    assert.ok(!fs.existsSync(file), "bozuk girdi durum dosyası yaratmamalı");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("günlük tam koşuya bağlı ve oyuncu adımlarından SONRA", async () => {
  const { fullMaintenanceSteps } = await import("./run-scheduled-update.mjs");
  const steps = fullMaintenanceSteps(false);
  const ids = steps.map((s) => s.id);
  assert.ok(ids.includes("player-radar-status"));
  assert.equal(ids.indexOf("player-radar-status"), ids.length - 1, "tüm oyuncu adımlarından sonra koşmalı");
  const step = steps.find((s) => s.id === "player-radar-status");
  assert.equal(step.skip, undefined, "sağlayıcı yokken de koşmalı (eskimeyi görünür kılar)");
});

test("prerender: oyuncu radarı damgası kontrol zamanı + veri senkronu, ledger'a düşme yedeği var", () => {
  const src = fs.readFileSync(path.join(repo, "scripts/prerender-core-pages.mjs"), "utf8");
  assert.ok(src.includes('file === "oyuncu-radari.html" ? playerRadarStamp('));
  assert.ok(src.includes("Oyuncu verisi senkronu"));
  assert.ok(/if \(!Number\.isFinite\(checked\)\) return freshnessStamp\(fallbackFreshness\)/.test(src), "durum dosyası yoksa eski damga");
});

test("istemci kuralı servisle aynı: sabit, damga alanları ve davranış", () => {
  const app = fs.readFileSync(path.join(repo, "app.js"), "utf8");
  assert.equal(Number(/var PLAYER_STALE_DAYS = (\d+);/.exec(app)[1]), PLAYER_STALE_DAYS);
  const fields = JSON.parse(/var PLAYER_STAMP_FIELDS = (\[[^\]]*\]);/.exec(app)[1]);
  assert.deepEqual(fields, [...STAMP_FIELDS]);

  const from = app.indexOf("  function playerNeedsDataRefresh(player)");
  const to = app.indexOf("  function transferStatusBadgeHtml(player)");
  assert.ok(from > 0 && to > from, "istemci kuralı bulunamadı");
  const code = app.slice(from, to);
  const FixedDate = Object.assign(function (...a) { return new Date(...a); }, { now: () => NOW, parse: Date.parse });
  const ctx = vm.createContext({ Date: FixedDate, isFinite, Math, String, normalizeSearchText: (v) => String(v || "").toLowerCase().trim() });
  vm.runInContext(`${code}\nthis.fn = playerNeedsUpdateListing;`, ctx);
  const cases = [
    { lastUpdatedAt: daysAgo(3) }, { lastUpdatedAt: daysAgo(14) }, { lastUpdatedAt: daysAgo(15) },
    { lastSyncedAt: daysAgo(90), lastProviderSeenAt: daysAgo(2) }, {}, { lastVerifiedAt: "bozuk" },
    { dataStatus: "stale", lastUpdatedAt: daysAgo(1) }, { dataStatus: "verified", lastUpdatedAt: daysAgo(1) },
    { dataStatus: "manual-review", lastUpdatedAt: daysAgo(1) }, { lastUpdated: daysAgo(30).slice(0, 10) }
  ];
  for (const player of cases) {
    assert.equal(ctx.fn(player), playerRefreshReason(player, NOW) !== null, `ayrışma: ${JSON.stringify(player)}`);
  }
  // Kart uyarısı ve sıralama için kullanılan kural zamana BAKMAMALI.
  assert.ok(/function playerNeedsDataRefresh\(player\) \{\s*var status = normalizeSearchText\(player && player\.dataStatus\);\s*return status === "stale"/.test(app));
  assert.ok(app.includes("list.filter(playerNeedsUpdateListing).length"), "sayaç zaman kuralını kullanmalı");
  assert.ok(/signal === "needs-update"\) \{\s*return playerNeedsUpdateListing\(player\)/.test(app), "filtre zaman kuralını kullanmalı");
});

console.log(`player-radar-status: ${passed} test geçti`);
