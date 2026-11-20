#!/usr/bin/env node
/**
 * MAÇ SONU OTOMATİK ÖZETİ — odak testi (scripts/lib/postMatchSummary.mjs).
 *
 * Özet deterministik ve yalnızca veriden: golcüler olay akışı tabelayla
 * tutarsa yazılır, kaçan penaltı gol sayılmaz, kendi kalesine gol rakibe
 * yazılır, istatistik yoksa "Güncelleniyor". Ayrıca üreticinin özeti yalnızca
 * TR + bitmiş + API-Football kayıtlı maçta açtığı doğrulanır.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { buildPostMatchSummary, postMatchSummarySectionHtml } from "./lib/postMatchSummary.mjs";

const require = createRequire(import.meta.url);
const matchTimeline = require("../services/matchTimeline.js");
const root = process.cwd();
let passed = 0;
const check = (name, fn) => { fn(); passed += 1; console.log(`ok - ${name}`); };

const ev = (time, team, type, detail, value) => ({ time, team: { name: team }, type, detail, value });
const timelineFor = (detail, homeTeam, awayTeam) => matchTimeline.buildTimeline(detail, { homeTeam, awayTeam, locale: "tr", finished: true });

// Göztepe 2-4 Gaziantep FK (7 Eylül 2026) olay biçimi: kaçan penaltı
// sağlayıcıda "Goal / Missed Penalty" olarak geliyor.
const goztepe = {
  score: { home: 2, away: 4 },
  events: [
    ev("5'", "Gaziantep FK", "Goal", "Normal Goal", "Halil Dervisoglu · Normal Goal"),
    ev("10'", "Gaziantep FK", "Goal", "Normal Goal", "Myenty Abena · Normal Goal"),
    ev("31'", "Göztepe", "Goal", "Missed Penalty", "Novatus Miroshi · Missed Penalty"),
    ev("34'", "Gaziantep FK", "Goal", "Normal Goal", "Kacper Kozłowski · Normal Goal"),
    ev("45+1'", "Gaziantep FK", "Goal", "Normal Goal", "Kacper Kozłowski · Normal Goal"),
    ev("51'", "Göztepe", "Goal", "Normal Goal", "Juan Santos · Normal Goal"),
    ev("72'", "Göztepe", "Card", "Red Card", "Ogun Bayrak · Red Card"),
    ev("76'", "Gaziantep FK", "Card", "Yellow Card", "Trivante Stewart · Yellow Card"),
    ev("90+3'", "Göztepe", "Goal", "Penalty", "Juan Santos · Penalty")
  ],
  statistics: [
    { type: "Topla oynama", home: 49, away: 51 },
    { type: "Toplam şut", home: 19, away: 13 },
    { type: "İsabetli şut", home: 4, away: 6 }
  ]
};

check("golcüler tabelayla tutuyor; kaçan penaltı gol sayılmıyor", () => {
  const summary = buildPostMatchSummary({ homeTeam: "Göztepe", awayTeam: "Gaziantep FK", score: goztepe.score, timeline: timelineFor(goztepe, "Göztepe", "Gaziantep FK"), statistics: goztepe.statistics });
  assert.equal(summary.facts.reconciled, true);
  assert.equal(summary.facts.goalCount, 6);
  assert.ok(!summary.goals.includes("Miroshi"), "kaçan penaltı golcü listesine girmemeli");
  assert.match(summary.missedPenalties, /31' Novatus Miroshi \(Göztepe\)/);
  assert.match(summary.goals, /^5' Halil Dervisoglu \(Gaziantep FK\), 10' Myenty Abena/);
  assert.match(summary.goals, /90\+3' Juan Santos \(pen\.\) \(Göztepe\)\.$/);
  assert.equal(summary.lead, "Göztepe – Gaziantep FK maçı 2-4 sona erdi. Gaziantep FK sahadan galip ayrıldı.");
  assert.match(summary.cards, /Kırmızı kart: 72' Ogun Bayrak \(Göztepe\)\./);
  assert.match(summary.cards, /Sarı kart: Göztepe 0, Gaziantep FK 1\./);
  assert.ok(summary.analysis.includes("İlk golü 5. dakikada Gaziantep FK buldu ve maçı kazandı."));
  assert.ok(summary.analysis.includes("Göztepe, 72. dakikadan itibaren 10 kişi oynadı."));
  assert.ok(summary.analysis.some((line) => line.includes("topla oynamada %49-%51, toplam şutta 19-13, isabetli şutta 4-6")));
});

check("olay akışı skorla tutmuyorsa golcü yazılmaz → Güncelleniyor", () => {
  const detail = { score: { home: 2, away: 1 }, events: [ev("12'", "Galatasaray", "Goal", "Normal Goal", "Victor Osimhen · Normal Goal")] };
  const summary = buildPostMatchSummary({ homeTeam: "Galatasaray", awayTeam: "Fenerbahçe", score: detail.score, timeline: timelineFor(detail, "Galatasaray", "Fenerbahçe"), statistics: [] });
  assert.equal(summary.goals, "Güncelleniyor");
  assert.equal(summary.facts.reconciled, false);
  assert.ok(!summary.analysis.some((line) => line.includes("İlk golü")), "tutarsız akıştan analiz kurulmaz");
});

check("hiç olay ve istatistik yoksa tüm alanlar Güncelleniyor; skor yine yazılır", () => {
  const summary = buildPostMatchSummary({ homeTeam: "Galatasaray", awayTeam: "Fenerbahçe", score: { home: 2, away: 1, halftimeHome: 1, halftimeAway: 0 }, timeline: timelineFor({ score: { home: 2, away: 1, halftimeHome: 1, halftimeAway: 0 } }, "Galatasaray", "Fenerbahçe"), statistics: [] });
  assert.equal(summary.lead, "Galatasaray – Fenerbahçe maçı 2-1 sona erdi. Galatasaray sahadan galip ayrıldı. İlk yarı 1-0 tamamlandı.");
  assert.equal(summary.goals, "Güncelleniyor");
  assert.equal(summary.cards, "Güncelleniyor");
  assert.deepEqual(summary.analysis, ["Güncelleniyor"]);
});

check("kendi kalesine gol rakip hanesine; geç belirleyici gol; geriden gelme", () => {
  const detail = {
    score: { home: 2, away: 1 },
    events: [
      ev("20'", "Trabzonspor", "Goal", "Normal Goal", "Paul Onuachu · Normal Goal"),
      ev("60'", "Trabzonspor", "Goal", "Own Goal", "Stefan Savić · Own Goal"),
      ev("88'", "Kasımpaşa", "Goal", "Normal Goal", "Haris Hajradinović · Normal Goal")
    ]
  };
  const summary = buildPostMatchSummary({ homeTeam: "Kasımpaşa", awayTeam: "Trabzonspor", score: detail.score, timeline: timelineFor(detail, "Kasımpaşa", "Trabzonspor"), statistics: [] });
  assert.equal(summary.facts.reconciled, true);
  assert.match(summary.goals, /60' Stefan Savić \(k\.k\.\) \(Kasımpaşa\)/);
  assert.ok(summary.analysis.includes("İlk golü Trabzonspor attı ama maçı geriden gelen Kasımpaşa kazandı."));
  assert.ok(summary.analysis.includes("Sonucu belirleyen gol 88. dakikada geldi (Haris Hajradinović, Kasımpaşa)."));
  assert.ok(summary.analysis.includes("Takım istatistikleri güncelleniyor."));
});

check("0-0: 'Gol yok.'; skorsuz kayıt özet üretmez", () => {
  const summary = buildPostMatchSummary({ homeTeam: "A", awayTeam: "B", score: { home: 0, away: 0 }, timeline: [], statistics: [] });
  assert.equal(summary.goals, "Gol yok.");
  assert.match(summary.lead, /Puanlar paylaşıldı\./);
  assert.equal(buildPostMatchSummary({ homeTeam: "A", awayTeam: "B", score: { home: null, away: null } }), null);
});

check("bölüm HTML: #ozet çapası, künye, kaçışlı metin", () => {
  const html = postMatchSummarySectionHtml(
    { lead: "A <b> 1-0", goals: "Gol yok.", cards: "Güncelleniyor", missedPenalties: null, analysis: ["Güncelleniyor"] },
    { reportHref: "../mac-raporu/a-b.html" }
  );
  assert.match(html, /<section class="msp-section" id="ozet" aria-labelledby="msp-summary-title" data-auto-summary>/);
  assert.match(html, /Veri: API-Football/);
  assert.ok(html.includes("A &lt;b&gt; 1-0"));
  assert.ok(!html.includes("<b>"));
  assert.ok(html.includes('href="../mac-raporu/a-b.html"'));
  assert.equal(postMatchSummarySectionHtml(null), "");
});

check("üretici: yalnızca TR + bitmiş + editoryal özet yok + API-Football kaydı", () => {
  const src = fs.readFileSync(path.join(root, "scripts", "generate-match-seo-pages.mjs"), "utf8");
  assert.match(src, /const autoSummary = locale === "tr" && state === "post" && !detail\.summary && fromApiFootball && hasScore\(entry\.score\)/);
  assert.match(src, /autoSummary\s*\? postMatchSummarySectionHtml\(/);
  const lib = fs.readFileSync(path.join(root, "scripts", "lib", "postMatchSummary.mjs"), "utf8");
  assert.doesNotMatch(lib, /fetch\(|openai|anthropic|process\.env/i, "dil modeli / ağ / ortam değişkeni yok");
  assert.doesNotMatch(lib, /iddaa|bahis|oran/i, "bahis içeriği yok");
});

console.log(`test-post-match-auto-summary: ${passed} kontrol geçti`);
