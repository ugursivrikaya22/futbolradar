"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { pollRowsFrom } = require("../services/supabase/pollRows.js");
const raw = require("../data/home-polls.json");
const teams = require("../data/teams.json");

test("iki dilli soru/alt başlık '[object Object]' olarak yazılmaz", () => {
  const { polls } = pollRowsFrom(raw, { teams });
  assert.ok(polls.length >= 2);
  for (const row of polls) {
    for (const key of ["question_tr", "question_en", "subtitle_tr", "subtitle_en"]) {
      assert.equal(typeof row[key], "string", `${row.id}.${key} dize olmalı`);
      assert.ok(!row[key].includes("[object"), `${row.id}.${key}: ${row[key]}`);
    }
  }
  const top4 = polls.find((row) => row.id === "super-lig-2026-2027-ilk-dort");
  assert.equal(top4.question_tr, "Bu Sezon Süper Lig'i İlk 4'te Kim Bitirir?");
  assert.equal(top4.question_en, "Who Will Finish in the Süper Lig Top 4 This Season?");
});

test("optionSource super-lig-teams seçenekleri poll_options satırına dönüşür", () => {
  const { options } = pollRowsFrom(raw, { teams });
  const rows = options.filter((row) => row.poll_id === "super-lig-2026-2027-ilk-dort");
  assert.ok(rows.length >= 2, "seçenek üretilmeli");
  assert.ok(rows.every((row) => typeof row.label_tr === "string" && !row.label_tr.includes("[object")));
  const list = Array.isArray(teams) ? teams : teams.teams;
  const ids = new Set(list.map((team) => String(team.id || "")));
  assert.ok(rows.every((row) => row.team_id === null || ids.has(row.team_id)), "team_id teams kimliği olmalı");
});

test("eski düz dize + questionEn biçimi korunur", () => {
  const { polls } = pollRowsFrom([{ id: "x", question: "Soru?", questionEn: "Q?", startsAt: "2026-01-01T00:00:00Z", endsAt: "2026-02-01T00:00:00Z" }]);
  assert.equal(polls[0].question_tr, "Soru?");
  assert.equal(polls[0].question_en, "Q?");
});

test("dosyada olmayan anket için satır üretilmez", () => {
  const { polls, options } = pollRowsFrom(raw, { teams });
  const manual = "match:galatasaray-fenerbahce-26-ekim-2026:winner";
  assert.ok(!polls.some((row) => row.id === manual));
  assert.ok(!options.some((row) => row.poll_id === manual));
});
