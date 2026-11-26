/**
 * Bayat veri koruması: 48 saat eşiği, "sıradaki maç" geçmişte kalmaması ve
 * sabit yazılmış eski maç bağlantılarının geri gelmemesi.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { filterUpcoming, isUpcoming, todayIstanbul } from "./lib/upcoming.mjs";

const require = createRequire(import.meta.url);
const root = process.cwd();
const { checkDataStaleness, formatStaleWarning } = require("../services/dataStaleness.js");

let failures = 0;
function expect(condition, message) {
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${message}`);
  }
}

const NOW = Date.parse("2026-11-26T12:00:00+03:00");
const hoursAgo = (h) => new Date(NOW - h * 3600000).toISOString();

// --- 48 saat eşiği ---
{
  const files = {
    "data/teams.json": [{ lastStandingsSyncedAt: hoursAgo(10) }],
    "data/league-standings.json": { "super-lig": { updatedAt: hoursAgo(47) } },
    "data/super-lig-fixtures.json": { lastVerifiedAt: hoursAgo(49) },
    "data/fixture-calendar.json": { fetchedAt: hoursAgo(480) },
    "data/super-lig-squads.json": []
  };
  const report = checkDataStaleness({ readJson: (f) => files[f], now: NOW });
  const status = Object.fromEntries(report.results.map((r) => [r.id, r.status]));
  expect(status["teams-standings"] === "fresh", "10 saatlik veri taze olmalı");
  expect(status["league-standings"] === "fresh", "47 saatlik veri taze olmalı");
  expect(status["super-lig-fixtures"] === "stale", "49 saatlik veri bayat olmalı");
  expect(status["fixture-calendar"] === "stale", "480 saatlik veri bayat olmalı");
  expect(status["super-lig-squads"] === "unknown", "zaman damgasız kaynak 'unknown' olmalı, bayat uydurulmamalı");
  expect(report.ok === false && report.stale.length === 2, "iki bayat kaynak raporlanmalı");
  const warning = formatStaleWarning(report.stale.find((r) => r.id === "fixture-calendar"));
  expect(/480 saat/.test(warning) && /20 gün/.test(warning), `uyarı yaş içermeli: ${warning}`);

  const missing = checkDataStaleness({ readJson: () => { throw new Error("yok"); }, now: NOW });
  expect(missing.ok && missing.results.every((r) => r.status === "unknown"), "okunamayan dosya çökertmemeli, 'unknown' olmalı");
}

// --- Sıradaki maç geçmişte kalmaz ---
{
  expect(todayIstanbul(NOW) === "2026-11-26", "İstanbul günü hesaplanmalı");
  expect(!isUpcoming("2026-11-07T19:00:00+03:00", NOW), "7 Kasım maçı 26 Kasım'da sıradaki sayılmamalı");
  expect(isUpcoming("2026-11-26T09:00:00+03:00", NOW), "bugünkü maç (saati geçmiş olsa da) listede kalmalı");
  expect(isUpcoming("2026-11-30T21:00:00+03:00", NOW), "gelecek maç sıradaki olmalı");
  expect(!isUpcoming(null, NOW) && !isUpcoming("bozuk", NOW), "tarihsiz kayıt sıradaki iddiası taşımamalı");
  const rows = filterUpcoming([{ date: "2026-11-03" }, { date: "2026-11-07" }, { date: "2026-12-08" }], (m) => m.date, NOW);
  expect(rows.length === 1 && rows[0].date === "2026-12-08", "yalnızca bugünden sonraki kayıt kalmalı");
}

// --- Üreticiler ortak süzgeci kullanıyor, sabit eski maç bağlantısı yok ---
{
  const evergreen = fs.readFileSync(path.join(root, "scripts/generate-evergreen-seo-pages.mjs"), "utf8");
  expect(!/galatasaray-amed-sportif-faaliyetler-7-kasim-2026/.test(evergreen), "evergreen üretici 7 Kasım Amedspor bağlantısını sabit yazmamalı");
  for (const file of ["scripts/generate-evergreen-seo-pages.mjs", "scripts/generate-gs-stuttgart-team-pages.mjs", "scripts/generate-rich-team-pages.mjs"]) {
    expect(/lib\/upcoming\.mjs/.test(fs.readFileSync(path.join(root, file), "utf8")), `${file} filterUpcoming kullanmalı`);
  }
}

// --- Zamanlama: senkron günlük, bayatlık denetimi bağlı ---
{
  const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  const daily = (vercel.crons || []).find((c) => c.path === "/api/cron/full-update");
  expect(daily && /^\d+ \d+ \* \* \*$/.test(daily.schedule), "günlük tam senkron cron'u (her gün) vercel.json'da olmalı");
  const runner = fs.readFileSync(path.join(root, "scripts/run-scheduled-update.mjs"), "utf8");
  expect(/check-data-staleness\.mjs/.test(runner), "scheduled-update bayatlık denetimini çalıştırmalı");
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/daily-health-check.yml"), "utf8");
  expect(/check-data-staleness\.mjs/.test(workflow), "sağlık kontrolü iş akışı bayatlık uyarısı içermeli");
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  expect(/check-data-staleness\.mjs/.test(pkg.scripts.postbuild), "postbuild bayatlık denetimiyle başlamalı");
}

if (failures) {
  console.error(`${failures} test failed.`);
  process.exit(1);
}
console.log("data staleness tests passed");
