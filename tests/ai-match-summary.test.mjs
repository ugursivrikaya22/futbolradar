import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  ATTRIBUTION_EN,
  ATTRIBUTION_TR,
  attachAiMatchSummaries,
  decideAiSummary,
  eligibility,
  publishedLead,
  summaryFingerprint,
  validateAiSummary
} = require("../services/aiMatchSummary.js");

const ENABLED = {
  AI_MATCH_SUMMARY_ENABLED: "true",
  AI_GATEWAY_API_KEY: "test-key",
  AI_MATCH_SUMMARY_MODEL: "google/gemini-3.5-flash-lite"
};

function goal(minute, team, player, detail, assist) {
  const value = [player, assist ? `Asist: ${assist}` : "", detail].filter(Boolean).join(" · ");
  return { time: `${minute}'`, team: { name: team }, type: "Goal", detail, value };
}

function superLigMatch(overrides = {}) {
  return {
    id: "galatasaray-fenerbahce-2026-11-08",
    homeTeam: "Galatasaray",
    awayTeam: "Fenerbahçe",
    league: "Süper Lig",
    competition: "Süper Lig",
    kickoff: "2026-11-08T20:00:00+03:00",
    status: "FINISHED",
    providerStatus: "FT",
    venue: "RAMS Park",
    score: { home: 2, away: 1, halftimeHome: 1, halftimeAway: 0 },
    events: [
      goal(12, "Galatasaray", "Mauro Icardi", "Normal Goal", "Barış Alper Yılmaz"),
      goal(55, "Fenerbahçe", "Edin Dzeko", "Normal Goal"),
      goal(78, "Galatasaray", "Mauro Icardi", "Penalty"),
      {
        time: "40'",
        team: { name: "Fenerbahçe" },
        type: "Card",
        detail: "Yellow Card",
        value: "İsmail Yüksek · Yellow Card"
      },
      {
        time: "70'",
        team: { name: "Fenerbahçe" },
        type: "subst",
        detail: "Substitution 1",
        value: "Fred · Asist: İrfan Can Kahveci · Substitution 1"
      }
    ],
    statistics: [
      { type: "Topla oynama", home: 58, away: 42 },
      { type: "Toplam şut", home: 14, away: 9 }
    ],
    lineups: [
      { team: "Galatasaray", formation: "4-2-3-1", players: ["Fernando Muslera", "Mauro Icardi"], substitutes: [] }
    ],
    players: [
      { name: "Mauro Icardi", team: "Galatasaray", providerRating: 8.41, goals: 2 }
    ],
    ...overrides
  };
}

const VALID_TR = "Galatasaray ile Fenerbahçe arasındaki Süper Lig karşılaşması 2-1 bitti. İlk yarı 1-0 tamamlandı. Mauro Icardi 12. dakikada Barış Alper Yılmaz asistinde, Edin Dzeko 55. dakikada ve Mauro Icardi 78. dakikada penaltıdan gol attı. İsmail Yüksek 40. dakikada sarı kart gördü. Fred 70. dakikada çıktı, İrfan Can Kahveci girdi. Topla oynama 58-42, şut 14-9 ölçüldü. Mauro Icardi reytingi 8.4 oldu.";
const VALID_EN = "Galatasaray beat Fenerbahçe 2-1 in the Süper Lig. Half-time was 1-0. Mauro Icardi scored in the 12th minute, assisted by Barış Alper Yılmaz. Edin Dzeko scored in the 55th minute. Mauro Icardi scored a penalty in the 78th minute. İsmail Yüksek received a yellow card in the 40th minute. Fred was replaced by İrfan Can Kahveci in the 70th minute. Possession was 58 to 42 and shots were 14 to 9. Mauro Icardi's rating was 8.4.";

function validGenerate() {
  return async () => ({ tr: VALID_TR, en: VALID_EN, usage: { inputTokens: 900, outputTokens: 420, totalTokens: 1320 } });
}

function recordFor(match) {
  return { matchId: match.id, kickoff: match.kickoff, fingerprint: "template" };
}

test("valid model text passes and keeps the attribution constant", () => {
  const gate = eligibility(superLigMatch());
  assert.equal(gate.ok, true);
  assert.equal(gate.facts.goals.length, 3);
  assert.equal(gate.facts.goals[2].penalty, true);
  assert.equal(gate.facts.goals[0].assist, "Barış Alper Yılmaz");
  assert.equal(gate.facts.cards[0].player, "İsmail Yüksek");
  assert.equal(gate.facts.substitutions[0].off, "Fred");
  assert.equal(gate.facts.substitutions[0].on, "İrfan Can Kahveci");
  assert.equal(gate.facts.playerRatings[0].rating, 8.4);
  const verdict = validateAiSummary({ tr: VALID_TR, en: VALID_EN }, gate.facts);
  assert.deepEqual(verdict.errors, []);
  assert.equal(ATTRIBUTION_TR, "FutbolRadar özeti, veriler API-Football");
  assert.equal(ATTRIBUTION_EN, "FutbolRadar summary, data from API-Football");
});

test("wrong score and invented scorer are rejected", () => {
  const facts = eligibility(superLigMatch()).facts;
  const wrongScore = validateAiSummary({
    tr: VALID_TR.replace("2-1", "3-0"),
    en: VALID_EN.replace("2-1", "3-0")
  }, facts);
  assert.equal(wrongScore.ok, false);
  assert.ok(wrongScore.errors.some((error) => error.includes("score") || error.includes("missing_score")));

  const invented = validateAiSummary({
    tr: `${VALID_TR} Victor Osimhen gol attı.`,
    en: `${VALID_EN} Victor Osimhen scored the winner.`
  }, facts);
  assert.equal(invented.ok, false);
  assert.ok(invented.errors.some((error) => error.startsWith("en:invented_scorer") || error.startsWith("tr:invented_scorer") || error.includes("unknown_name")));
});

test("quotes, injuries and coach comments are rejected", () => {
  const facts = eligibility(superLigMatch()).facts;
  const quoted = validateAiSummary({ tr: `${VALID_TR} "Müthiş maç" dedi.`, en: VALID_EN }, facts);
  assert.ok(quoted.errors.some((error) => error.includes("quote")));
  const injured = validateAiSummary({ tr: VALID_TR, en: `${VALID_EN} A player was injured.` }, facts);
  assert.ok(injured.errors.some((error) => error.includes("injury")));
  const coach = validateAiSummary({ tr: `${VALID_TR} Teknik direktör konuşmadı.`, en: VALID_EN }, facts);
  assert.ok(coach.errors.some((error) => error.includes("coach")));
});

test("trigger skips live, non-league, awarded and thin matches", () => {
  assert.equal(eligibility({ ...superLigMatch(), status: "LIVE", providerStatus: "2H" }).reason, "not_final");
  assert.equal(eligibility({ ...superLigMatch(), league: "Premier League", competition: "Premier League" }).reason, "not_super_lig");
  assert.equal(eligibility({ ...superLigMatch(), status: "AWARDED", providerStatus: "WO" }).reason, "awarded");
  assert.equal(eligibility({
    ...superLigMatch(),
    score: { home: 0, away: 0 },
    events: [],
    statistics: [],
    lineups: [],
    players: []
  }).reason, "insufficient_data");
  assert.equal(eligibility({
    ...superLigMatch(),
    score: { home: 2, away: 0 },
    events: [goal(10, "Galatasaray", "Mauro Icardi", "Normal Goal")]
  }).reason, "goal_count_mismatch");
  assert.equal(eligibility({
    ...superLigMatch(),
    score: { home: 1, away: 0 },
    events: [goal(10, "Galatasaray", "", "Normal Goal")]
  }).reason, "missing_scorer");
});

test("feature stays off without the flag, key or model", async () => {
  const match = superLigMatch();
  const calls = { n: 0 };
  const generate = async () => { calls.n += 1; return { tr: VALID_TR, en: VALID_EN }; };
  const base = { records: [recordFor(match)], matches: [match], previous: [], generate };

  const disabled = await attachAiMatchSummaries({ ...base, env: {} });
  assert.equal(disabled.stats.reason, "disabled");
  assert.equal(calls.n, 0);
  assert.equal(disabled.records[0].aiSummary, undefined);

  const noKey = await attachAiMatchSummaries({
    ...base,
    env: { AI_MATCH_SUMMARY_ENABLED: "true", AI_MATCH_SUMMARY_MODEL: "google/gemini-3.5-flash-lite" }
  });
  assert.equal(noKey.stats.reason, "missing_api_key");
  assert.equal(calls.n, 0);

  const noModel = await attachAiMatchSummaries({
    ...base,
    env: { AI_MATCH_SUMMARY_ENABLED: "1", AI_GATEWAY_API_KEY: "test-key" }
  });
  assert.equal(noModel.stats.reason, "missing_model");
  assert.equal(calls.n, 0);

  const kept = await attachAiMatchSummaries({
    records: [recordFor(match)],
    matches: [match],
    previous: [{
      matchId: match.id,
      aiSummary: {
        status: "ready",
        matchId: match.id,
        fingerprint: summaryFingerprint(eligibility(match).facts),
        tr: VALID_TR,
        en: VALID_EN,
        attribution: ATTRIBUTION_TR
      }
    }],
    env: {},
    generate
  });
  assert.equal(calls.n, 0);
  assert.equal(kept.records[0].aiSummary.tr, VALID_TR);
  assert.equal(publishedLead(kept.records[0], "tr").attribution, ATTRIBUTION_TR);
});

test("a finished Süper Lig match is summarised once per match id and fingerprint", async () => {
  const match = superLigMatch();
  let calls = 0;
  const generate = async () => {
    calls += 1;
    return { tr: VALID_TR, en: VALID_EN, usage: { inputTokens: 800, outputTokens: 500, totalTokens: 1300 } };
  };
  let previous = [];
  let records = [recordFor(match)];
  for (let poll = 0; poll < 5; poll += 1) {
    const result = await attachAiMatchSummaries({
      records,
      matches: [match],
      previous,
      env: ENABLED,
      generate,
      generatedAt: "2026-11-08T22:00:00.000Z"
    });
    records = result.records;
    previous = result.records.map((record) => ({ ...record, aiSummary: record.aiSummary }));
  }
  assert.equal(calls, 1);
  const summary = records[0].aiSummary;
  assert.equal(summary.status, "ready");
  assert.equal(summary.matchId, match.id);
  assert.equal(summary.fingerprint, summaryFingerprint(eligibility(match).facts));
  assert.equal(summary.attribution, ATTRIBUTION_TR);
  assert.equal(summary.tr, VALID_TR);
  assert.equal(summary.en, VALID_EN);
  assert.equal(summary.usage.totalTokens, 1300);
  assert.equal(publishedLead(records[0], "tr").attribution, ATTRIBUTION_TR);
  assert.equal(publishedLead(records[0], "en").body, VALID_EN);
});

test("a changed fingerprint asks the model again and a mismatch falls back to the template", async () => {
  const match = superLigMatch();
  let calls = 0;
  const generate = async () => {
    calls += 1;
    if (calls === 1) return { tr: VALID_TR.replaceAll("2-1", "9-0"), en: VALID_EN.replaceAll("2-1", "9-0") };
    return { tr: VALID_TR, en: VALID_EN };
  };
  const first = await attachAiMatchSummaries({
    records: [recordFor(match)],
    matches: [match],
    previous: [],
    env: ENABLED,
    generate
  });
  assert.equal(first.records[0].aiSummary.status, "fallback");
  assert.equal(first.records[0].aiSummary.reason, "validation_mismatch");
  assert.equal(first.records[0].aiSummary.tr, undefined);
  assert.equal(publishedLead(first.records[0], "tr"), null);

  const again = await attachAiMatchSummaries({
    records: [recordFor(match)],
    matches: [match],
    previous: first.records,
    env: ENABLED,
    generate
  });
  assert.equal(calls, 1, "aynı parmak izi doğrulama reddinden sonra tekrar sorulmamalı");
  assert.equal(again.records[0].aiSummary.status, "fallback");

  const changed = superLigMatch({ venue: "Another Ground" });
  const retried = await attachAiMatchSummaries({
    records: [recordFor(changed)],
    matches: [changed],
    previous: again.records,
    env: ENABLED,
    generate
  });
  assert.equal(calls, 2);
  assert.equal(retried.records[0].aiSummary.status, "ready");
  assert.notEqual(summaryFingerprint(eligibility(match).facts), summaryFingerprint(eligibility(changed).facts));
});

test("model errors retry later and do not publish a body", async () => {
  const match = superLigMatch();
  let calls = 0;
  const generate = async () => {
    calls += 1;
    throw new Error("gateway timeout AI_GATEWAY_API_KEY=secret");
  };
  const first = await attachAiMatchSummaries({
    records: [recordFor(match)],
    matches: [match],
    previous: [],
    env: ENABLED,
    generate
  });
  assert.equal(first.records[0].aiSummary.status, "pending_retry");
  assert.equal(first.records[0].aiSummary.tr, undefined);
  assert.equal(first.records[0].aiSummary.error.includes("secret"), false);
  const second = await attachAiMatchSummaries({
    records: [recordFor(match)],
    matches: [match],
    previous: first.records,
    env: ENABLED,
    generate
  });
  assert.equal(calls, 2);
  assert.equal(second.records[0].aiSummary.status, "pending_retry");
  assert.equal(decideAiSummary(match, second.records[0], null).action, "generate");
});

test("per-run cap defers extra matches and a later run continues", async () => {
  const matches = [0, 1, 2].map((index) => superLigMatch({
    id: `super-lig-${index}`,
    kickoff: `2026-11-0${8 - index}T20:00:00+03:00`,
    venue: `Ground ${index}`
  }));
  let calls = 0;
  const generate = async () => {
    calls += 1;
    return { tr: VALID_TR, en: VALID_EN };
  };
  const records = matches.map(recordFor);
  const first = await attachAiMatchSummaries({
    records,
    matches,
    previous: [],
    env: { ...ENABLED, AI_MATCH_SUMMARY_MAX_PER_RUN: "1" },
    generate
  });
  assert.equal(calls, 1);
  assert.equal(first.stats.generated, 1);
  assert.equal(first.stats.deferred, 2);
  assert.equal(records.filter((record) => record.aiSummary && record.aiSummary.status === "ready").length, 1);

  const second = await attachAiMatchSummaries({
    records,
    matches,
    previous: records,
    env: { ...ENABLED, AI_MATCH_SUMMARY_MAX_PER_RUN: "1" },
    generate
  });
  assert.equal(calls, 2);
  assert.equal(second.stats.reused, 1);
  assert.equal(second.stats.generated, 1);
});

test("different match ids are not deduped against each other", async () => {
  const home = superLigMatch();
  const away = superLigMatch({
    id: "besiktas-trabzonspor-2026-11-09",
    homeTeam: "Beşiktaş",
    awayTeam: "Trabzonspor",
    kickoff: "2026-11-09T19:00:00+03:00"
  });
  let calls = 0;
  const generate = async ({ facts }) => {
    calls += 1;
    const tr = VALID_TR
      .replaceAll("Galatasaray", facts.homeTeam)
      .replaceAll("Fenerbahçe", facts.awayTeam);
    const en = VALID_EN
      .replaceAll("Galatasaray", facts.homeTeam)
      .replaceAll("Fenerbahçe", facts.awayTeam);
    return { tr, en };
  };
  const result = await attachAiMatchSummaries({
    records: [recordFor(home), recordFor(away)],
    matches: [home, away],
    previous: [],
    env: ENABLED,
    generate
  });
  assert.equal(calls, 2);
  assert.equal(result.records[0].aiSummary.status, "ready");
  assert.equal(result.records[1].aiSummary.status, "ready");
  assert.notEqual(result.records[0].aiSummary.fingerprint, result.records[1].aiSummary.fingerprint);
});

test("the summary module does not publish columns or hook the live poll", () => {
  const source = fs.readFileSync(new URL("../services/aiMatchSummary.js", import.meta.url), "utf8");
  assert.equal(/require\(["'][^"']*column/.test(source), false);
  assert.equal(/require\(["'][^"']*kose/.test(source), false);
  assert.equal(/require\(["'][^"']*liveScoreStream/.test(source), false);
  assert.equal(publishedLead({ aiSummary: { status: "fallback", tr: "x", en: "y" } }, "tr"), null);
});
