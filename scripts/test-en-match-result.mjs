#!/usr/bin/env node
/**
 * MAÇ SONU GÜNCELLEME ADIMI — SÖZLEŞME DENETİMİ.
 *
 * Sezon başlamadan önce takvimde tek bir lig sonucu yok; dönüşümün doğru
 * çalıştığı ancak SENTETİK sonuçlarla sınanabilir. Bu test, açılış maçını
 * (Galatasaray – Çorum FK, 14 Ağustos 21:30 TSİ) türlü kılıklarda takvime
 * sokup eşleştirme kapılarının her birini zorlar:
 *
 *   1. Doğru sonuç bağlanır; başlık "X 2-1 Y – Result" olur.
 *   2. HAZIRLIK maçı sonucu lig fikstürüne bağlanMAZ (Göztepe 2-1
 *      Trabzonspor hazırlık maçı gerçek takvimde duruyor — bu hata sınıfı
 *      gerçek).
 *   3. Ev/deplasman sırası ters kayıt (rövanş) bağlanmaz.
 *   4. Yarım skor sonuç sayılmaz.
 *   5. Tarihi doğrulanmış fikstürde farklı günün sonucu bağlanmaz.
 *   6. Tarihi atanmamış fikstürde sezon öncesi kayıt elenir.
 *   7. AET/PEN bitişleri doğru etikete çevrilir; tanınmayan kod "normal
 *      sürede" İDDİA edilmez.
 *   8. Başlık/açıklama biçimi: skor gerçek, kazanan aritmetikten.
 *
 * Ek olarak GERÇEK üretilmiş sayfalarda tutarlılık: takvimde sonucu olan
 * her fikstür sayfası Result başlığı taşımalı, olmayan hiçbiri taşımamalı.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { findFinalResult, resultTitle, resultDescription, finishKeyOf } from "./lib/enMatchResult.mjs";

const root = process.cwd();

const FIXTURE = {
  homeTeam: "Galatasaray",
  awayTeam: "Çorum FK",
  kickoff: "2026-08-14T21:30:00+03:00"
};
const UNDATED_FIXTURE = { homeTeam: "Galatasaray", awayTeam: "Çorum FK", kickoff: null };

function calendarRow(overrides = {}) {
  return {
    league: "Süper Lig",
    status: "FINISHED",
    providerStatus: "FT",
    kickoff: "2026-08-14T21:30:00+03:00",
    homeTeam: "Galatasaray",
    awayTeam: "Çorum FK",
    score: { home: 2, away: 1, halftimeHome: 1, halftimeAway: 0 },
    fetchedAt: "2026-08-15T00:05:00.000Z",
    ...overrides
  };
}

// ── 1. Doğru sonuç bağlanır ────────────────────────────────────────────────
{
  const result = findFinalResult(FIXTURE, [calendarRow()]);
  assert.ok(result, "doğrulanmış sonuç bulunmalı");
  assert.equal(result.home, 2);
  assert.equal(result.away, 1);
  assert.equal(result.halftimeHome, 1);
  assert.equal(result.finishKey, "regular");
  assert.equal(
    resultTitle(FIXTURE, result),
    "Galatasaray 2-1 Çorum FK – Result & Match Analysis | FutbolRadar"
  );
  const description = resultDescription(FIXTURE, result);
  assert.ok(description.includes("Galatasaray beat Çorum FK 2-1"), description);
  assert.ok(description.includes("Half-time: 1-0"), description);
}

// ── 2. Hazırlık maçı sonucu lig fikstürüne bağlanmaz ───────────────────────
{
  const friendly = calendarRow({ league: "Hazırlık Maçı" });
  assert.equal(findFinalResult(FIXTURE, [friendly]), null, "hazırlık maçı skoru lig sonucu sayılmamalı");
  const friendly2 = calendarRow({ league: "Friendlies Clubs" });
  assert.equal(findFinalResult(FIXTURE, [friendly2]), null);
}

// ── 3. Ev/deplasman sırası ters kayıt (rövanş) bağlanmaz ───────────────────
{
  const reversed = calendarRow({ homeTeam: "Çorum FK", awayTeam: "Galatasaray" });
  assert.equal(findFinalResult(FIXTURE, [reversed]), null, "rövanş sonucu bu fikstüre bağlanmamalı");
}

// ── 4. Yarım skor sonuç sayılmaz ───────────────────────────────────────────
{
  const partial = calendarRow({ score: { home: 2, away: null } });
  assert.equal(findFinalResult(FIXTURE, [partial]), null, "yarım skor sonuç sayılmamalı");
  const live = calendarRow({ status: "LIVE" });
  assert.equal(findFinalResult(FIXTURE, [live]), null, "devam eden maç sonuç sayılmamalı");
}

// ── 5. Tarihli fikstürde farklı günün sonucu bağlanmaz ─────────────────────
{
  const otherDay = calendarRow({ kickoff: "2026-08-15T21:30:00+03:00" });
  assert.equal(findFinalResult(FIXTURE, [otherDay]), null, "farklı günün sonucu bağlanmamalı");
  // TSİ gün sınırı: 21:30 UTC ertesi güne düşer ama TSİ aynı gündedir.
  const utcForm = calendarRow({ kickoff: "2026-08-14T18:30:00+00:00" });
  assert.ok(findFinalResult(FIXTURE, [utcForm]), "aynı an, UTC gösterimiyle de eşleşmeli");
}

// ── 6. Tarihi atanmamış fikstürde sezon öncesi kayıt elenir ────────────────
{
  const preseason = calendarRow({ kickoff: "2026-07-20T21:00:00+03:00" });
  assert.equal(
    findFinalResult(UNDATED_FIXTURE, [preseason], { seasonStart: "2026-08-14" }),
    null,
    "sezon öncesi kayıt tarihi atanmamış fikstüre bağlanmamalı"
  );
  const inSeason = calendarRow();
  assert.ok(
    findFinalResult(UNDATED_FIXTURE, [inSeason], { seasonStart: "2026-08-14" }),
    "sezon içi sonuç, tarihi atanmamış fikstüre bağlanabilmeli"
  );
}

// ── 7. Bitiş türleri ───────────────────────────────────────────────────────
{
  assert.equal(finishKeyOf("FT"), "regular");
  assert.equal(finishKeyOf("AET"), "extra-time");
  assert.equal(finishKeyOf("PEN"), "penalties");
  assert.equal(finishKeyOf("ABD"), null, "tanınmayan kod normal süre iddia etmemeli");

  const aet = findFinalResult(FIXTURE, [calendarRow({ providerStatus: "AET", score: { home: 1, away: 1 } })]);
  assert.equal(aet.finishKey, "extra-time");
  const aetDescription = resultDescription(FIXTURE, aet);
  assert.ok(aetDescription.includes("drew 1-1"), aetDescription);
  assert.ok(aetDescription.toLowerCase().includes("extra time"), aetDescription);
}

// ── 8. Deplasman galibiyeti cümlesi ────────────────────────────────────────
{
  const awayWin = findFinalResult(FIXTURE, [calendarRow({ score: { home: 0, away: 3 } })]);
  const description = resultDescription(FIXTURE, awayWin);
  assert.ok(description.includes("Çorum FK won 3-0 away at Galatasaray"), description);
}

// ── 9. Gerçek sayfalar: takvim ↔ başlık tutarlılığı ────────────────────────
//
// Sonucu takvimde OLAN her üretilmiş sayfa Result başlığı taşımalı;
// olmayan hiçbiri taşımamalı. Sezon öncesi ikinci küme 306 sayfanın
// tamamıdır ve bu denetim "yanlışlıkla sonuç basma" hatasını yakalar.
{
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const fixtures = JSON.parse(fs.readFileSync(path.join(root, "data", "super-lig-fixtures.json"), "utf8"));
  const calendar = JSON.parse(fs.readFileSync(path.join(root, "data", "fixture-calendar.json"), "utf8")).matches || [];
  const { CONFIRMED_FIXTURE_STATUSES } = require("../services/superLigFixtureService.js");
  const { normalizeText } = require("../services/matchRadarService.js");
  const slugOf = (value) => normalizeText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  let resultPages = 0;
  let previewPages = 0;
  let mismatches = 0;

  for (const round of fixtures.rounds || []) {
    for (const match of round.matches || []) {
      if (!match.homeTeam || !match.awayTeam || !CONFIRMED_FIXTURE_STATUSES.has(match.fixtureStatus)) continue;
      const file = path.join(root, "en", "match",
        `${slugOf(match.homeTeam)}-${slugOf(match.awayTeam)}-${fixtures.season}-r${String(round.round).padStart(2, "0")}.html`);
      if (!fs.existsSync(file)) continue;

      const html = fs.readFileSync(file, "utf8");
      // <title> içinde "&" kaçırılır (&amp;) — regex ham "&" ararsa sonuç
      // sayfasını asla göremez ve denetim her sayfayı "önizleme" sanır.
      const pageIsResult = /– Result &(amp;)? Match Analysis \|/.test(html);
      const expected = Boolean(findFinalResult(
        { ...match, homeTeam: match.homeTeam, awayTeam: match.awayTeam },
        calendar,
        { seasonStart: fixtures.seasonStart }
      ));

      if (pageIsResult !== expected) {
        mismatches += 1;
        if (mismatches <= 3) console.error(`  uyumsuz: ${path.basename(file)} sayfa=${pageIsResult ? "result" : "preview"} takvim=${expected ? "result" : "preview"}`);
      }
      if (pageIsResult) resultPages += 1; else previewPages += 1;
    }
  }

  assert.equal(mismatches, 0, `${mismatches} sayfa takvimle çelişiyor`);
  console.log(`  gerçek sayfalar: ${resultPages} sonuç, ${previewPages} önizleme — takvimle tutarlı`);
}

console.log("Maç sonu güncelleme adımı testleri geçti (eşleştirme kapıları, bitiş türleri, başlık/açıklama, sayfa-takvim tutarlılığı).");
