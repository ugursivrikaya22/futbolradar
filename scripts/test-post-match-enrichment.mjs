/**
 * MAÇ SONU ZENGİNLEŞTİRME TESTLERİ
 *
 * Sözleşme:
 *   • Sağlayıcı kimliği YANLIŞ maça bağlanmaz — ad tek başına yetmez, skor
 *     da uyuşmalı. Yanlış maça bağlanmak, başka bir karşılaşmanın gollerini
 *     bu maçın raporuna yazmak demek.
 *   • Yalnızca ÖLÇÜLMÜŞ alan yayımlanır; gönderilmeyen alan yamaya girmez.
 *   • Oynamamış oyuncu satır açmaz (sıfır dakika + sıfır ölçüm, "oynadı ve
 *     üretemedi" gibi okunur).
 *   • Kürasyon sağlayıcıyı ezer ve kaynağı işaretlenir.
 *   • Eksik bölüm SESSİZ KALMAZ: ne beklendiği adıyla söylenir.
 *   • Yarım çekim mevcut kaydı ezmez; kesinti kapsam olarak yazılmaz.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const enrichment = require("../services/postMatchEnrichmentService.js");

const {
  SECTION_KEYS, isCompleted, resolveProviderFixture, normalizeEvents, normalizeGoals,
  normalizeLineups, normalizeTeamStats, normalizePlayerStats, applyOverride,
  buildEnrichment, shouldReplaceEnrichment
} = enrichment;

/* ------------------------------------------------------------------ *
 * 1. TAMAMLANMIŞ MAÇ SEÇİMİ
 * ------------------------------------------------------------------ */

assert.equal(isCompleted({ status: "FINISHED" }), true);
assert.equal(isCompleted({ status: "FT" }), true);
assert.equal(isCompleted({ status: "AET" }), true);
assert.equal(isCompleted({ status: "SCHEDULED" }), false);
assert.equal(isCompleted({ status: "LIVE" }), false);
assert.equal(isCompleted({}), false);

/* ------------------------------------------------------------------ *
 * 2. SAĞLAYICI KİMLİĞİ ÇÖZÜMLEMESİ — muhafazakâr olmalı
 * ------------------------------------------------------------------ */

const curated = {
  id: "m1", homeTeam: "Göztepe", awayTeam: "Rudeš",
  status: "FINISHED", score: { home: 1, away: 1 }, kickoff: "2026-07-26T19:00:00+03:00"
};

function fixtureCandidate(id, home, away, hg, ag) {
  return { fixture: { id }, teams: { home: { name: home }, away: { name: away } }, goals: { home: hg, away: ag } };
}

// Sayısal kimlik varsa çözümlemeye hiç gidilmez.
assert.equal(
  resolveProviderFixture({ ...curated, providerId: "2542013" }, []).fixtureId,
  "2542013",
  "kayıttaki sayısal kimlik kullanılmalı"
);

// Başka sağlayıcının harfli kimliği API-Football'da kullanılamaz.
assert.equal(
  resolveProviderFixture({ ...curated, providerId: "blx8udpkfd48ndx9a93jskg0k" }, []).fixtureId,
  null,
  "harfli kimlik API-Football fikstür kimliği sayılmamalı"
);

// Ad + skor eşleşmesi → çözülür.
const resolved = resolveProviderFixture(curated, [
  fixtureCandidate(111, "Göztepe", "Rudeš", 1, 1),
  fixtureCandidate(222, "Başka", "Takım", 0, 0)
]);
assert.equal(resolved.fixtureId, "111");
assert.equal(resolved.confidence, "high");

// Ad eşleşiyor ama SKOR uyuşmuyor → bağlanmaz.
assert.equal(
  resolveProviderFixture(curated, [fixtureCandidate(111, "Göztepe", "Rudeš", 3, 0)]).fixtureId,
  null,
  "skor uyuşmadığında bağlanmamalı"
);

// Kürasyonda skor yoksa ad tek başına yetmez.
assert.equal(
  resolveProviderFixture({ ...curated, score: {} }, [fixtureCandidate(111, "Göztepe", "Rudeš", 1, 1)]).fixtureId,
  null,
  "skor olmadan tek sinyalle bağlanmamalı"
);

// Birden fazla aday aynı skorla eşleşirse belirsizlik → bağlanmaz.
assert.equal(
  resolveProviderFixture(curated, [
    fixtureCandidate(111, "Göztepe", "Rudeš", 1, 1),
    fixtureCandidate(112, "Goztepe FC", "Rudes", 1, 1)
  ]).fixtureId,
  null,
  "belirsiz eşleşmede bağlanmamalı"
);

// Takım adı varyantları (ek/kısaltma) tolere edilmeli.
assert.equal(
  resolveProviderFixture(
    { ...curated, homeTeam: "Beşiktaş", awayTeam: "Midtjylland", score: { home: 2, away: 1 } },
    [fixtureCandidate(999, "Besiktas JK", "FC Midtjylland", 2, 1)]
  ).fixtureId,
  "999",
  "ad varyantı eşleşmeli"
);

/* ------------------------------------------------------------------ *
 * 3. NORMALLEŞTİRME — yalnızca ölçülmüş alan
 * ------------------------------------------------------------------ */

const events = normalizeEvents([
  { time: { elapsed: 34 }, type: "Goal", detail: "Normal Goal", team: { name: "R" }, player: { name: "B" } },
  { time: { elapsed: 21 }, type: "Goal", detail: "Normal Goal", team: { name: "G" }, player: { name: "A" }, assist: { name: "C" } },
  { time: { elapsed: 60 }, type: "Card", detail: "Yellow Card", team: { name: "R" }, player: { name: "D" } },
  { time: { elapsed: 70 }, type: "Goal", detail: "Missed Penalty", team: { name: "G" }, player: { name: "E" } },
  { time: {}, type: "Goal" }
]);

assert.equal(events.length, 4, "dakikası olmayan olay atılmalı");
assert.deepEqual(events.map((event) => event.minute), [21, 34, 60, 70], "olaylar dakikaya göre sıralanmalı");
assert.ok(!("assist" in events[1]), "asist gönderilmediyse alan hiç yazılmamalı");
assert.equal(events[0].assist, "C", "gönderilen asist taşınmalı");

const goals = normalizeGoals(events);
assert.equal(goals.length, 2, "kart ve KAÇAN PENALTI gol sayılmamalı");

// Diziliş: ilk on bir yoksa bölüm açılmaz.
assert.equal(normalizeLineups([{ team: { name: "G" }, substitutes: [{ player: { name: "S" } }] }]).length, 0,
  "yalnızca yedek listesi diziliş sayılmamalı");

const lineups = normalizeLineups([{
  team: { name: "G" }, formation: "4-3-3",
  startXI: Array.from({ length: 11 }, (_, i) => ({ player: { name: `P${i}`, number: i + 1, pos: "M" } })),
  substitutes: [{ player: { name: "S1" } }]
}]);
assert.equal(lineups.length, 1);
assert.equal(lineups[0].startXI.length, 11);
assert.equal(lineups[0].formation, "4-3-3");
assert.ok(!("coach" in lineups[0]), "gönderilmeyen teknik sorumlu alanı yazılmamalı");

// Takım istatistiği: tek takım gelirse tablo kurulmaz.
assert.equal(normalizeTeamStats([{ team: { name: "G" }, statistics: [{ type: "Ball Possession", value: "60%" }] }]), null,
  "tek taraflı istatistik tablo kurmamalı");

const teamStats = normalizeTeamStats([
  { team: { name: "G" }, statistics: [{ type: "Ball Possession", value: "62%" }, { type: "Total Shots", value: 14 }] },
  { team: { name: "R" }, statistics: [{ type: "Ball Possession", value: "38%" }, { type: "Total Shots", value: 7 }] }
]);
assert.ok(teamStats && teamStats.statistics.length >= 2, "iki taraflı istatistik tablo kurmalı");
assert.equal(teamStats.homeTeam, "G");

// Oyuncu istatistiği: oynamamış oyuncu satır açmaz.
const playerStats = normalizePlayerStats([{
  team: { name: "G" },
  players: [
    { player: { id: 1, name: "Oynayan" }, statistics: [{ games: { minutes: 90, rating: "7.8" }, goals: { total: 1, assists: null }, shots: { total: 3 } }] },
    { player: { id: 2, name: "Yedek" }, statistics: [{ games: { minutes: 0, rating: null }, goals: { total: null } }] },
    { player: { id: 3, name: "Adsız değil ama dakikasız" }, statistics: [{ games: {} }] }
  ]
}]);
assert.equal(playerStats.length, 1);
assert.equal(playerStats[0].players.length, 1, "yalnızca oynamış oyuncu satır açmalı");
assert.equal(playerStats[0].players[0].goals, 1);
assert.ok(!("assists" in playerStats[0].players[0]), "gönderilmeyen asist alanı yazılmamalı");

/* ------------------------------------------------------------------ *
 * 4. KÜRASYON GEÇERSİZ KILMA
 * ------------------------------------------------------------------ */

const overrideResult = applyOverride("events", events, { events: [{ minute: 1, type: "Goal" }] });
assert.equal(overrideResult.overridden, true);
assert.equal(overrideResult.source, "curated");
assert.equal(overrideResult.value.length, 1, "kürasyon sağlayıcıyı ezmeli");

const noOverride = applyOverride("events", events, { lineups: [] });
assert.equal(noOverride.overridden, false);
assert.equal(noOverride.source, "provider");

/* ------------------------------------------------------------------ *
 * 5. BÖLÜM KURULUMU, KAPSAM ve KISMİ MESAJ
 * ------------------------------------------------------------------ */

const full = buildEnrichment(curated, {
  events: [{ time: { elapsed: 21 }, type: "Goal", detail: "Normal Goal", team: { name: "G" }, player: { name: "A" } }],
  lineups: [{ team: { name: "G" }, startXI: Array.from({ length: 11 }, (_, i) => ({ player: { name: `P${i}` } })), substitutes: [] }],
  teamStats: [
    { team: { name: "G" }, statistics: [{ type: "Ball Possession", value: "62%" }] },
    { team: { name: "R" }, statistics: [{ type: "Ball Possession", value: "38%" }] }
  ],
  playerStats: [{ team: { name: "G" }, players: [{ player: { id: 1, name: "A" }, statistics: [{ games: { minutes: 90 } }] }] }]
}, { fixtureId: "111" });

assert.equal(full.coverage, 100);
assert.equal(full.dataStatus, "complete");
assert.equal(full.partialMessage, null, "tam kapsamda kısmi mesaj olmamalı");
for (const key of SECTION_KEYS) {
  assert.equal(full.sections[key].status, "ready", `${key} dolu olmalı`);
  assert.ok(full.sections[key].provenance, `${key} köken bilgisi taşımalı`);
  assert.equal(full.sections[key].provenance.fixtureId, "111");
}

// Kısmi kapsam: eksik bölümler ADIYLA bildirilmeli.
const partial = buildEnrichment(curated, {
  events: [{ time: { elapsed: 21 }, type: "Goal", detail: "Normal Goal", team: { name: "G" } }]
}, { fixtureId: "111" });

assert.ok(partial.coverage > 0 && partial.coverage < 100);
assert.equal(partial.dataStatus, "partial");
assert.ok(partial.partialMessage, "kısmi kapsamda mesaj olmalı");
assert.ok(/Dizilişler/.test(partial.partialMessage), "eksik bölüm adıyla bildirilmeli");
assert.ok(/Oyuncu istatistikleri/.test(partial.partialMessage));
assert.equal(partial.sections.lineups.status, "awaiting");
assert.equal(partial.sections.lineups.value, null, "boş bölüm değer taşımamalı");
assert.ok(partial.sections.lineups.message, "boş bölüm sessiz kalmamalı");

// Hiç veri yok: bölümler gizlenmez, tek cümlelik açıklama basılır.
const empty = buildEnrichment(curated, {}, {});
assert.equal(empty.coverage, 0);
assert.equal(empty.dataStatus, "unavailable");
assert.ok(/henüz doğrulanmış maç sonu verisi gelmedi/.test(empty.partialMessage));

// Kürasyon müdahalesi kaynağı işaretlenmeli.
const overridden = buildEnrichment(curated, {}, {
  override: { lineups: [{ team: "G", startXI: [{ name: "A" }], substitutes: [] }] }
});
assert.equal(overridden.sections.lineups.status, "ready");
assert.equal(overridden.sections.lineups.source, "curated");
assert.equal(overridden.sections.lineups.overridden, true);
assert.ok(/kürasyon/i.test(overridden.sections.lineups.provenance.source));

/* ------------------------------------------------------------------ *
 * 6. YAZMA GÜVENLİĞİ — yarım çekim mevcut kaydı ezmez
 * ------------------------------------------------------------------ */

assert.equal(shouldReplaceEnrichment(null, full).replace, true, "ilk kayıt yazılmalı");
assert.equal(shouldReplaceEnrichment(full, partial).replace, false, "kapsam düşüşü reddedilmeli");
assert.equal(shouldReplaceEnrichment(partial, full).replace, true, "kapsam artışı yazılmalı");
assert.equal(shouldReplaceEnrichment(full, full).replace, true, "eşit kapsam yazılmalı");
assert.equal(
  shouldReplaceEnrichment(full, overridden).replace,
  true,
  "kürasyon müdahalesi kapsamı bilinçli düşürebilir"
);

/* ------------------------------------------------------------------ *
 * 7. KOŞU BETİĞİ SÖZLEŞMESİ
 * ------------------------------------------------------------------ */

const runner = fs.readFileSync(path.join(root, "scripts", "enrich-post-match.mjs"), "utf8");
assert.ok(/reportMissingProviderConfig/.test(runner), "anahtar yoksa adıyla bildirilmeli");
assert.ok(/process\.exitCode = 1/.test(runner), "eksik yapılandırma çıkış kodunu düşürmeli");
assert.ok(/fetchWithCache/.test(runner), "sağlayıcı çağrıları önbellekten geçmeli");
assert.ok(/shouldReplaceEnrichment/.test(runner), "yazma öncesi güvenlik kapısı çağrılmalı");
assert.ok(/failedFetches === endpoints\.length/.test(runner), "tam kesinti kapsam olarak yazılmamalı");
assert.ok(/coverage === 100/.test(runner), "tam kapsamlı kayıt için sağlayıcıya tekrar gidilmemeli");
assert.ok(/getFixturePlayers/.test(runner), "oyuncu istatistiği uç noktası çağrılmalı");

/* ------------------------------------------------------------------ *
 * 8. SAĞLAYICI UÇ NOKTALARI
 * ------------------------------------------------------------------ */

const provider = require("../services/providers/apiFootballProvider.js");
for (const method of ["getFixtureEvents", "getLineups", "getFixtureStatistics", "getFixturePlayers", "getFixturesByDate"]) {
  assert.equal(typeof provider[method], "function", `${method} dışa aktarılmalı`);
}
await assert.rejects(() => provider.getFixturePlayers({}), /fixtureId/, "fixtureId olmadan çağrı reddedilmeli");
await assert.rejects(() => provider.getFixturesByDate({}), /date/, "date olmadan çağrı reddedilmeli");

/* ------------------------------------------------------------------ *
 * 9. GEÇERSİZ KILMA DOSYASI ve SAYFA ENTEGRASYONU
 * ------------------------------------------------------------------ */

const overridesPath = path.join(root, "data", "match-enrichment-overrides.json");
assert.ok(fs.existsSync(overridesPath), "kürasyon geçersiz kılma dosyası bulunmalı");
const overrides = JSON.parse(fs.readFileSync(overridesPath, "utf8"));
assert.ok(Array.isArray(overrides._readme), "geçersiz kılma dosyası kullanım notu taşımalı");

const pageGenerator = fs.readFileSync(path.join(root, "scripts", "generate-post-match-pages.mjs"), "utf8");
assert.ok(/enrichmentSections\(match\.id\)/.test(pageGenerator), "rapor sayfası zenginleştirme bölümlerini basmalı");
assert.ok(/data-partial-coverage/.test(pageGenerator), "kısmi kapsam mesajı sayfada işaretlenmeli");
assert.ok(/post-match-provenance/.test(pageGenerator), "köken satırı basılmalı");
assert.ok(/match-enrichment\.json/.test(pageGenerator), "sayfa üreticisi zenginleştirme deposunu okumalı");

console.log(`OK maç sonu zenginleştirme · ${SECTION_KEYS.length} bölüm · ` +
  "kimlik çözümlemesi (skor doğrulamalı), ölçülmüş alan süzgeci, kürasyon geçersiz kılma, " +
  "kısmi mesaj, yazma güvenliği, kesinti ayrımı");
