/**
 * GÖRÜNTÜLEME KAPISI TESTLERİ
 *
 * Sözleşme:
 *   1. Başlamamış maç gösterilir — saat ve eşleşme tek başına tam bilgidir.
 *   2. Canlı ya da bitmiş maç YALNIZCA skoru varsa gösterilir.
 *   3. Başlama saati geçmiş, skoru olmayan ve durumu bilinmeyen maç GİZLENİR.
 *   4. Uydurma 0-0 basılmaz; GERÇEK 0-0 ise gösterilir (o bir skordur).
 *   5. Gizlenen her maç gerekçesiyle günlüğe yazılır.
 *   6. İstemci (app.js) aynı kuralı uygular.
 *   7. Yayımlanan sayfalarda skorsuz başlamış maç bulunmaz.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const {
  evaluateDisplayable,
  filterDisplayable,
  isDisplayableMatch,
  logHiddenMatches
} = require("../services/matchEligibility.js");

const NOW = new Date("2026-07-29T21:00:00+03:00");
const before = "2026-07-29T22:00:00+03:00";
const after = "2026-07-29T19:00:00+03:00";

const match = (extra) => ({ id: "t", homeTeam: "Ev", awayTeam: "Deplasman", ...extra });

/** Başlamamış maç her zaman görünür. */
function testUpcomingIsShown() {
  const verdict = evaluateDisplayable(match({ kickoff: before, status: "SCHEDULED" }), NOW);
  assert.equal(verdict.displayable, true);
  assert.equal(verdict.phase, "upcoming");

  // Durumu hiç yazılmamış olsa bile: henüz oynanmadı, skor beklenmiyor.
  assert.equal(isDisplayableMatch(match({ kickoff: before }), NOW), true);
}

/** Canlı maç skorsuz gösterilmez. */
function testLiveNeedsScore() {
  assert.equal(
    isDisplayableMatch(match({ kickoff: after, status: "LIVE", score: { home: 1, away: 0 } }), NOW),
    true
  );

  const verdict = evaluateDisplayable(match({ kickoff: after, status: "LIVE" }), NOW);
  assert.equal(verdict.displayable, false);
  assert.ok(verdict.reason.includes("skoru yok"), `gerekçe skoru söylemeli: ${verdict.reason}`);
}

/** Biten maç skorsuz gösterilmez. */
function testFinishedNeedsScore() {
  assert.equal(
    isDisplayableMatch(match({ kickoff: after, status: "FINISHED", score: { home: 2, away: 1 } }), NOW),
    true
  );
  assert.equal(isDisplayableMatch(match({ kickoff: after, status: "FINISHED" }), NOW), false);
  assert.equal(
    isDisplayableMatch(match({ kickoff: after, status: "FINISHED", score: { home: null, away: null } }), NOW),
    false
  );
}

/**
 * Başlamış ama durumu bilinmeyen maç: skoru varsa gösterilir (durum etiketi
 * geç gelmiş olabilir), yoksa gizlenir.
 */
function testStartedWithUnknownStatus() {
  const hidden = evaluateDisplayable(match({ kickoff: after, status: "SCHEDULED" }), NOW);
  assert.equal(hidden.displayable, false);
  assert.equal(hidden.phase, "unknown-status");
  assert.ok(hidden.reason.includes("başlama saati geçti"));

  assert.equal(
    isDisplayableMatch(match({ kickoff: after, status: "SCHEDULED", score: { home: 0, away: 1 } }), NOW),
    true
  );
}

/**
 * GERÇEK 0-0 GÖSTERİLİR.
 *
 * Kural "skorsuz maçı gizle" — "sıfır skorlu maçı gizle" değil. 0-0 bir
 * ölçümdür; onu gizlemek, sahte skor basmak kadar yanlış olurdu.
 */
function testRealGoallessDrawIsShown() {
  assert.equal(
    isDisplayableMatch(match({ kickoff: after, status: "FINISHED", score: { home: 0, away: 0 } }), NOW),
    true,
    "gerçek 0-0 gizlenmemeli"
  );
  assert.equal(
    isDisplayableMatch(match({ kickoff: after, status: "LIVE", score: { home: 0, away: 0 } }), NOW),
    true
  );
}

/** Okunamayan başlama saati bir maç kaydı değildir. */
function testInvalidKickoffIsHidden() {
  assert.equal(isDisplayableMatch(match({ kickoff: "belirsiz" }), NOW), false);
  assert.equal(isDisplayableMatch(match({}), NOW), false);
  assert.equal(isDisplayableMatch(null, NOW), false);
}

/** Süzgeç gizlenenleri gerekçesiyle döndürür ve günlüğe yazar. */
function testFilterReportsHidden() {
  const pool = [
    match({ id: "gorunur", kickoff: before, status: "SCHEDULED" }),
    match({ id: "skorsuz", kickoff: after, status: "FINISHED" }),
    match({ id: "canli", kickoff: after, status: "LIVE", score: { home: 3, away: 1 } })
  ];

  const { matches, hidden } = filterDisplayable(pool, NOW);
  assert.deepEqual(matches.map((item) => item.id), ["gorunur", "canli"]);
  assert.equal(hidden.length, 1);
  assert.equal(hidden[0].id, "skorsuz");
  assert.ok(hidden[0].reason, "gizlenen maçın gerekçesi olmalı");

  // Günlük yazımı çökmemeli ve gerekçeyi taşımalı.
  const warnings = [];
  const original = console.warn;
  console.warn = (line) => warnings.push(line);
  try {
    logHiddenMatches("test", hidden);
  } finally {
    console.warn = original;
  }
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes("match-hidden"), "günlük satırı işaretli olmalı");
  assert.ok(warnings[0].includes("skorsuz"), "günlük satırı maçı söylemeli");
}

/** İstemci (app.js) aynı kuralı uygulamalı. */
function testClientMirrorsGate() {
  const appJs = fs.readFileSync(path.join(root, "app.js"), "utf8");

  assert.ok(/function evaluateDisplayableMatch\(/.test(appJs), "app.js kapı fonksiyonu yok");
  assert.ok(/function isDisplayableMatch\(/.test(appJs), "app.js kısa biçim yok");
  assert.ok(/function filterDisplayableMatches\(/.test(appJs), "app.js süzgeci yok");

  // Aynı gerekçe metinleri: kullanıcı ve günlük iki tarafta aynı şeyi okumalı.
  for (const reason of ["canlı maçın skoru yok", "biten maçın skoru yok", "başlama saati geçti, skor yok ve durum bilinmiyor"]) {
    assert.ok(appJs.includes(reason), `app.js gerekçesi eksik: "${reason}"`);
  }
  assert.ok(appJs.includes("match-hidden"), "app.js gizlenen maçı günlüğe yazmalı");
}

/**
 * YAYIMLANAN SAYFALARDA SKORSUZ BAŞLAMIŞ MAÇ OLMAMALI.
 *
 * Kart işaretlemesinde skor alanı "–" ise ve maç başlamışsa, kapı bir yerde
 * uygulanmamış demektir.
 */
function testPublishedPagesCarryNoUnscoredStartedMatch() {
  const pages = ["index.html", "bugunun-maclari.html", "canli-skor.html", "gunluk-mac-analizleri.html"]
    .map((file) => path.join(root, file))
    .filter((file) => fs.existsSync(file));
  assert.ok(pages.length, "ön koşul: sayfalar üretilmiş olmalı");

  for (const file of pages) {
    const html = fs.readFileSync(file, "utf8");
    const name = path.relative(root, file);

    for (const card of html.match(/<article class="fixture-card[\s\S]*?<\/article>/g) || []) {
      const finished = /fixture-card-state[^"]*is-final/.test(card);
      const live = /fixture-card-state[^"]*is-live/.test(card);
      if (!finished && !live) continue;

      const scores = [...card.matchAll(/fixture-row-score">([^<]*)</g)].map((entry) => entry[1].trim());
      for (const score of scores) {
        assert.ok(
          score && score !== "–" && score !== "-",
          `${name}: başlamış maç skorsuz basılmış (skor alanı "${score}")`
        );
      }
    }
  }
}

testUpcomingIsShown();
testLiveNeedsScore();
testFinishedNeedsScore();
testStartedWithUnknownStatus();
testRealGoallessDrawIsShown();
testInvalidKickoffIsHidden();
testFilterReportsHidden();
testClientMirrorsGate();
testPublishedPagesCarryNoUnscoredStartedMatch();

console.log(
  "Match display tests passed (başlamamış gösterilir, canlı/biten skor ister, durumsuz gizlenir, " +
  "gerçek 0-0 korunur, geçersiz saat elenir, gizlenenler günlüğe yazılır, istemci eşliği, sayfa denetimi)."
);
