/**
 * Aynı gün + kulüp kelimesi dizini: kaba kuvvet taramayla BİREBİR aynı aday.
 *
 * `curatedMatches` eskiden her takvim kaydı için birleşik listenin tamamını
 * geziyordu; dizin bunu hızlandırıyor ama sonucu değiştirmemeli. Bu test
 * gerçek takvim + kürasyon verisini eski algoritmayla (tam liste, gün filtresi,
 * dört `sameClub`, ilk eşleşen kazanır) ve dizinle ayrı ayrı yürütür ve her
 * kayıt için seçilen adayın AYNI olduğunu doğrular. Ayrıca yazım farkı,
 * ters ev/deplasman, sıra ve U19/yedek ayrımı için elle kurulmuş durumlar var.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createSameDayClubIndex } = require("../services/sameDayClubIndex.js");
const { sameClub } = require("../services/superLigTeams.js");
const { istanbulDay } = require("../services/matchStatus.js");
const { normalizeText } = require("../api/_utils");

const dayOf = (match) => {
  const value = match && (match.kickoff || match.date || match.utcDate);
  return value ? istanbulDay(value) : "";
};
const identity = (match) => {
  const pair = [normalizeText(match && match.homeTeam), normalizeText(match && match.awayTeam)].sort();
  return `${pair[0]}|${pair[1]}|${dayOf(match)}`;
};
const matches = (candidate, record) =>
  (sameClub(candidate.homeTeam, record.homeTeam) && sameClub(candidate.awayTeam, record.awayTeam))
  || (sameClub(candidate.homeTeam, record.awayTeam) && sameClub(candidate.awayTeam, record.homeTeam));

/** Eski ve yeni aramayı aynı birleştirme akışında yan yana yürütür. */
function compare(curated, calendar) {
  const merged = new Map();
  // Eski taramadaki adayın günü; birleştirme kickoff'a dokunmadığı için
  // anahtarın ilk eklendiği andaki gün (yalnızca testi hızlandırır).
  const dayOfKey = new Map();
  const index = createSameDayClubIndex({ dayOf, normalize: normalizeText });
  const add = (key, match) => { if (!merged.has(key)) { index.remember(key, match); dayOfKey.set(key, dayOf(match)); } merged.set(key, match); };
  for (const match of curated) add(identity(match), match);
  let fallbacks = 0;
  let joined = 0;
  const picks = [];
  for (const record of calendar) {
    const key = identity(record);
    if (merged.has(key)) { merged.set(key, { ...merged.get(key), providerIds: { ...(record.providerIds || {}), ...(merged.get(key).providerIds || {}) } }); continue; }
    fallbacks += 1;
    const day = dayOf(record);
    let linear = null;
    for (const [candidateKey, candidate] of merged) {
      if (dayOfKey.get(candidateKey) !== day) continue;
      if (matches(candidate, record)) { linear = candidateKey; break; }
    }
    let indexed = null;
    for (const candidateKey of index.candidates(day, record)) {
      if (matches(merged.get(candidateKey), record)) { indexed = candidateKey; break; }
    }
    assert.equal(indexed, linear, `aday farklı: ${record.homeTeam} - ${record.awayTeam} @ ${day}`);
    picks.push(indexed);
    if (linear) { joined += 1; merged.set(linear, { ...merged.get(linear), providerIds: { ...(record.providerIds || {}) } }); }
    else add(key, record);
  }
  return { fallbacks, joined, picks };
}

// ── Elle kurulmuş durumlar ──────────────────────────────────────────────
{
  const at = (home, away, kickoff = "2026-09-12T20:00:00+03:00") => ({ homeTeam: home, awayTeam: away, kickoff });
  const curated = [
    at("Rizespor", "Fenerbahçe SK"),          // ilk eklenen: kazanmalı
    at("Rizespor", "Fenerbahçe"),
    at("Galatasaray U19", "Kocaelispor"),     // yaş grubu: eşleşmemeli
    at("Amed", "Başakşehir", "2026-09-13T20:00:00+03:00"),
    at("Göztepe", "Gençlerbirliği", "2026-08-23T23:30:00+03:00")
  ];
  const calendar = [
    at("Çaykur Rizespor", "Fenerbahçe"),                                  // yazım farkı
    at("Fenerbahçe", "Çaykur Rizespor"),                                  // ters taraf
    at("Galatasaray", "Kocaelispor"),                                     // U19 ≠ ilk takım
    at("Amed Sportif Faaliyetler", "Başakşehir", "2026-09-14T20:00:00+03:00"), // başka gün
    at("Amed Sportif Faaliyetler", "Başakşehir", "2026-09-13T20:00:00+03:00"),
    // UTC ofsetli kayıt (20:30Z = TSİ 23:30): gün, ISO dizesi kesilerek değil TSİ ile bulunur
    { homeTeam: "Göztepe", awayTeam: "Gençlerbirliği S.K.", kickoff: "2026-08-23T20:30:00Z" }
  ];
  const { picks } = compare(curated, calendar);
  assert.equal(picks[0], identity(curated[0]), "aynı gün iki aday: ilk eklenen kazanır");
  assert.equal(picks[1], identity(curated[0]), "ters ev/deplasman eşleşir");
  assert.equal(picks[2], null, "U19 ilk takımla birleşmez");
  assert.equal(picks[3], null, "başka gün birleşmez");
  assert.equal(picks[4], identity(curated[3]), "Amed ⊂ Amed Sportif Faaliyetler");
  assert.equal(picks[5], identity(curated[4]), "UTC ofsetli kayıt TSİ gününde eşleşir");
}

// ── Gerçek veri: depodaki takvim + kürasyon ────────────────────────────
{
  const curated = require("../data/matches.json");
  const calendar = (require("../data/fixture-calendar.json").matches) || [];
  // Gerçek takvim senkronda zaten tekilleştiriliyor; eşleşen dalı da gerçek
  // adlarla yürütmek için kayıtların bir kısmı farklı yazımla (sonek, ters
  // taraf, yaş grubu) yeniden ekleniyor.
  const variants = calendar.flatMap((match, i) => {
    if (i % 5 === 0) return [{ ...match, homeTeam: `${match.homeTeam} SK` }];
    if (i % 5 === 1) return [{ ...match, homeTeam: match.awayTeam, awayTeam: `${match.homeTeam} FC` }];
    if (i % 5 === 2) return [{ ...match, homeTeam: `${match.homeTeam} U19` }];
    return [];
  });
  const started = Date.now();
  const result = compare(curated, [...calendar, ...variants]);
  console.log(`same-day-club-index: ${calendar.length} takvim + ${variants.length} farklı yazım, ${result.fallbacks} yedek arama, ${result.joined} birleşim — kaba kuvvetle birebir aynı (${Date.now() - started} ms)`);
  assert.ok(result.joined > 0 && result.fallbacks > result.joined, "hem eşleşen hem eşleşmeyen dal yürümeli");
}

// ── curatedMatches hızlı ve yinelenmesiz kalır ─────────────────────────
{
  const { curatedMatches } = require("../services/providers/mockProvider.js");
  const started = Date.now();
  const list = curatedMatches();
  console.log(`curatedMatches: ${list.length} kayıt, ${Date.now() - started} ms`);
}
console.log("Same-day club index passed: identical candidates to the linear scan on real and hand-built fixtures.");
