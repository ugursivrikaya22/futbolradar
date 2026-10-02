#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const block = appSource.match(/\/\/ today-match-card-selection:start([\s\S]*?)\/\/ today-match-card-selection:end/);
assert.ok(block, "app.js içinde bugünün maç kartı seçim bloğu bulunmalı");

const { isTurkishMatch } = require("../services/turkishTeams.js");
const selectTodayMatchCards = new Function("isTurkishMatch", `
  "use strict";
  function todayInIstanbul() { return "2026-08-24"; }
  function istanbulDayOf(value) {
    if (!value) return "";
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit"
    }).format(new Date(value));
  }
  function isLiveMatch(match) {
    const status = String(match && (match.status || match.providerStatus) || "").toUpperCase();
    const score = match && match.score;
    return ["LIVE", "IN_PLAY", "PAUSED", "HALFTIME", "1H", "HT", "2H", "ET", "BT", "P"].includes(status) &&
      score && Number.isFinite(Number(score.home)) && Number.isFinite(Number(score.away));
  }
  ${block[1]}
  return selectTodayMatchCards;
`)(isTurkishMatch);

const matches = [
  { id: "yesterday", kickoff: "2026-08-23T20:00:00+03:00", homeTeam: "Galatasaray", awayTeam: "Rennes", status: "FINISHED", score: { home: 2, away: 0 } },
  { id: "tomorrow", kickoff: "2026-08-25T20:00:00+03:00", homeTeam: "Fenerbahçe", awayTeam: "Ajax", status: "SCHEDULED" },
  { id: "foreign-live", kickoff: "2026-08-24T19:00:00+03:00", homeTeam: "Ajax", awayTeam: "PSG", status: "LIVE", score: { home: 0, away: 1 } },
  { id: "turkish-live", kickoff: "2026-08-24T19:30:00+03:00", homeTeam: "Beşiktaş", awayTeam: "Roma", status: "LIVE", score: { home: 1, away: 1 } },
  { id: "foreign-upcoming", kickoff: "2026-08-24T20:00:00+03:00", homeTeam: "Rennes", awayTeam: "Venezia", status: "SCHEDULED" },
  { id: "turkish-upcoming", kickoff: "2026-08-24T21:00:00+03:00", homeTeam: "Trabzonspor", awayTeam: "Basel", status: "SCHEDULED" },
  { id: "finished-today", kickoff: "2026-08-24T14:00:00+03:00", homeTeam: "A Takımı", awayTeam: "B Takımı", status: "FINISHED", score: { home: 1, away: 0 } }
];

const selected = selectTodayMatchCards(matches, { today: "2026-08-24" });
assert.deepEqual(
  selected.map((match) => match.id),
  ["turkish-live", "foreign-live", "turkish-upcoming", "foreign-upcoming", "finished-today"],
  "yalnızca bugünün kartları kalmalı; durum bandında Türk maçı önce gelmeli"
);
assert.ok(!selected.some((match) => match.id === "yesterday"), "dünün eski kartı ana sayfada kalmamalı");
assert.ok(!selected.some((match) => match.id === "tomorrow"), "yarının maçı bugünün kartları arasına girmemeli");

const setContentBlock = appSource.match(/  function setContent\(target, html\) \{([\s\S]*?)\n  \}/);
assert.ok(setContentBlock, "setContent must be available for the midnight regression");
let today = "2026-08-24";
const setContent = new Function("todayInIstanbul", "initFeaturedCarousel", "document", "CustomEvent", `
  return function (target, html) { ${setContentBlock[1]} };
`)(() => today, () => {}, { dispatchEvent() {} }, class { constructor() {} });
const target = {
  innerHTML: "",
  dataset: { matchesDay: "2026-08-23" },
  hasAttribute: (name) => name === "data-matches-day"
};
setContent(target, "<article>Today's fixture</article>");
assert.equal(target.dataset.matchesDay, today, "client-rendered cards must replace the build-time day");
today = "2026-08-25";
setContent(target, "");
assert.equal(target.innerHTML, "", "a matchless day must clear yesterday's cards");
assert.equal(target.dataset.matchesDay, today, "empty client panels must also declare the new day");
assert.equal(target.dataset.state, "ready", "empty panels must finish hydration");
const unrelatedTarget = { dataset: {}, hasAttribute: () => false };
setContent(unrelatedTarget, "News");
assert.equal(unrelatedTarget.dataset.matchesDay, undefined, "unrelated panels must not acquire a match date");
assert.match(appSource, /setContent\(todayMatchesTarget, remainingHtml\);/, "initial hydration must render even an empty match list");
assert.doesNotMatch(appSource, /if \(remainingHtml\) setContent\(todayMatchesTarget/, "empty initial hydration must not keep stale metadata");

const enSource = fs.readFileSync(path.join(root, "scripts/generate-en-pages.mjs"), "utf8");
const todaySectionBlock = enSource.match(/function todaySection\(\) \{([\s\S]*?)\n\}/);
assert.ok(todaySectionBlock, "English fixture section must be available");
const todaySection = new Function("TODAY", "todaysMatches", "isSuperLig", "fixtureCard", "MATCH_LIST_INITIAL",
  "escapeHtml", "label", "superLigTodayStripHtml", "teams", "LOCALE", "sectionHead", `
  ${todaySectionBlock[0]}
  return todaySection();
`);
for (const day of ["2026-08-24", "2026-08-25"]) {
  for (const fixtures of [[], [{ id: "fixture" }]]) {
    const html = todaySection(day, fixtures, () => false, () => '<article class="fixture-card"></article>',
      12, (value) => value, () => "No matches", () => "", [], "en", () => "");
    assert.match(html, new RegExp(`id="todays-matches-preview" data-matches-day="${day}"`),
      "English static fixtures must retain their build day even when audited after midnight");
    assert.equal((html.match(/class="fixture-card"/g) || []).length, fixtures.length);
  }
}
const auditSource = fs.readFileSync(path.join(root, "scripts/test-clickable-browser.cjs"), "utf8");
assert.ok(auditSource.includes("en ? '#todays-matches-preview' : '[data-api-target=\"today-matches\"]'"),
  "browser audit must read the English static section's day rather than the runner clock");

console.log("home-match-cards OK (tarih filtresi + Türk takımı önceliği)");
