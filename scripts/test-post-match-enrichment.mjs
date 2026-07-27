/**
 * MAÇ SONU ZENGİNLEŞTİRME TESTLERİ
 *
 * Sözleşme:
 *   • Sağlayıcı kimliği YANLIŞ maça bağlanmaz — ad tek başına yetmez, skor
 *     da uyuşmalı. Yanlış maça bağlanmak, başka bir karşılaşmanın gollerini
 *     bu maçın raporuna yazmak demek.
 *   • KAYITTAKİ sayısal kimlik de kanıt değil iddiadır: sağlayıcının o
 *     tarihteki listesinde bulunmalı, takım/tarih/skor tutmalı. Tutmazsa
 *     reddedilir ve reddedilen kimliğe başka kapıdan geri dönülmez.
 *   • Yalnızca ÖLÇÜLMÜŞ alan yayımlanır; gönderilmeyen alan yamaya girmez.
 *   • Oynamamış oyuncu satır açmaz (sıfır dakika + sıfır ölçüm, "oynadı ve
 *     üretemedi" gibi okunur).
 *   • Kürasyon sağlayıcıyı ezer ve kaynağı işaretlenir.
 *   • Eksik bölüm SESSİZ KALMAZ: ne beklendiği adıyla söylenir.
 *   • Yarım çekim mevcut kaydı ezmez; kesinti kapsam olarak yazılmaz.
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const enrichment = require("../services/postMatchEnrichmentService.js");

const {
  SECTION_KEYS, isCompleted, resolveProviderFixture, datesMatch, normalizeEvents, normalizeGoals,
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

function fixtureCandidate(id, home, away, hg, ag, date = "2026-07-26T12:00:00+00:00") {
  return {
    fixture: { id, date },
    teams: { home: { name: home }, away: { name: away } },
    goals: { home: hg, away: ag }
  };
}

/* --- 2a. KAYITTAKİ SAYISAL KİMLİK KÖRÜ KÖRÜNE GÜVENİLMEZ ---------------
 *
 * `goztepe-rudes-2026-07-26` kaydında elle girilmiş `2542013` kimliği
 * sağlayıcının o tarihteki listesinde hiç yoktu; eski çözümleyici onu
 * doğrulamadan "yüksek güven" ile kabul ediyor, dört uç nokta da boş
 * dönüyor ve maç %0 kapsamla yanlış bir fikstüre bağlanmış görünüyordu.
 * Aşağıdaki dört durum o regresyonu kilitliyor.
 * ------------------------------------------------------------------- */

// (1) DOĞRU sayısal kimlik — listede var, takım/tarih/skor tutuyor → kabul.
const acceptedNumeric = resolveProviderFixture({ ...curated, providerId: "1598546" }, [
  fixtureCandidate(1598546, "Goztepe", "Rudes", 1, 1),
  fixtureCandidate(1598547, "Başka", "Takım", 0, 0)
]);
assert.equal(acceptedNumeric.fixtureId, "1598546", "doğrulanan sayısal kimlik kabul edilmeli");
assert.equal(acceptedNumeric.confidence, "high");
assert.match(acceptedNumeric.reason, /doğrulandı/, "kabul gerekçesi doğrulamaya dayanmalı");

// (2) YANLIŞ sayısal kimlik — sağlayıcının o tarihteki listesinde yok ve
//     yerine geçecek doğrulanmış aday da yok → çözülmemiş kalır.
const strayId = resolveProviderFixture({ ...curated, providerId: "2542013" }, [
  fixtureCandidate(1598999, "Başka", "Takım", 0, 0)
]);
assert.equal(strayId.fixtureId, null, "listede olmayan kayıt kimliği kabul edilmemeli");
assert.match(strayId.reason, /2542013/, "reddedilen kimlik gerekçede adıyla geçmeli");
assert.match(strayId.reason, /REDDEDİLDİ/, "reddin kendisi günlükte görünür olmalı");

// (3) YANLIŞ sayısal kimlik + doğrulanmış alternatif → alternatif seçilir,
//     reddedilen kimliğe sessizce dönülmez.
const replaced = resolveProviderFixture({ ...curated, providerId: "2542013" }, [
  fixtureCandidate(1598546, "Goztepe", "Rudes", 1, 1)
]);
assert.equal(replaced.fixtureId, "1598546", "doğrulanmış aday reddedilen kimliğin yerine geçmeli");
assert.match(replaced.reason, /2542013/, "değişimin sebebi gerekçede kalmalı");

// (4) Listede VAR ama başka bir karşılaşma (takımlar tutmuyor) → reddedilir.
const wrongTeams = resolveProviderFixture({ ...curated, providerId: "777" }, [
  fixtureCandidate(777, "Trabzonspor", "Rudes", 1, 1)
]);
assert.equal(wrongTeams.fixtureId, null, "takımı tutmayan kayıt kimliği kabul edilmemeli");
assert.match(wrongTeams.reason, /takım adları uyuşmuyor/);

// (5) Listede var, takımlar tutuyor ama TARİH başka gün → reddedilir.
const wrongDate = resolveProviderFixture({ ...curated, providerId: "778" }, [
  fixtureCandidate(778, "Goztepe", "Rudes", 1, 1, "2026-08-02T12:00:00+00:00")
]);
assert.equal(wrongDate.fixtureId, null, "tarihi tutmayan kayıt kimliği kabul edilmemeli");
assert.match(wrongDate.reason, /tarih uyuşmuyor/);

// (6) Listede var, takım+tarih tutuyor ama SKOR başka → reddedilir.
const wrongScore = resolveProviderFixture({ ...curated, providerId: "779" }, [
  fixtureCandidate(779, "Goztepe", "Rudes", 3, 0)
]);
assert.equal(wrongScore.fixtureId, null, "skoru tutmayan kayıt kimliği kabul edilmemeli");
assert.match(wrongScore.reason, /skor uyuşmuyor/);

// (7) Aday listesi hiç yoksa kimlik ne kabul ne mahkûm edilir; çağıran
//     tarafın listeyi çekip yeniden çözmesi gerektiği söylenir.
const unverifiable = resolveProviderFixture({ ...curated, providerId: "1598546" }, []);
assert.equal(unverifiable.fixtureId, null, "doğrulanmadan kimlik döndürülmemeli");
assert.match(unverifiable.reason, /aday listesi yok/);

// (8) Kürasyonda skor yoksa takım+tarih ile kabul edilir ama güven düşer.
const noCuratedScore = resolveProviderFixture(
  { ...curated, providerId: "1598546", score: {} },
  [fixtureCandidate(1598546, "Goztepe", "Rudes", 1, 1)]
);
assert.equal(noCuratedScore.fixtureId, "1598546");
assert.equal(noCuratedScore.confidence, "medium", "skorla çapraz kontrol edilemeyen kimlik 'high' olmamalı");

// Tarih toleransı: gece yarısını aşan başlama saatleri UTC gününde bir gün
// öncesine düşebiliyor; iki gün fark artık aynı karşılaşma değildir.
assert.equal(datesMatch("2026-07-26T00:30:00+03:00", "2026-07-25T21:30:00+00:00"), true);
assert.equal(datesMatch("2026-07-26", "2026-07-26T12:00:00+00:00"), true);
assert.equal(datesMatch("2026-07-26", "2026-07-28T12:00:00+00:00"), false);
assert.equal(datesMatch("", "2026-07-26T12:00:00+00:00"), false, "tarih yoksa doğrulama geçmemeli");

// Doğrulama yordamı tek başına da doğru cevap vermeli (kürasyon araçları
// bu yüklemi doğrudan kullanacak).
assert.equal(
  enrichment.verifyFixtureAgainstMatch(curated, fixtureCandidate(1598546, "Goztepe", "Rudes", 1, 1)).ok,
  true
);
assert.equal(
  enrichment.verifyFixtureAgainstMatch(curated, fixtureCandidate(1598546, "Goztepe", "Rudes", 2, 0)).ok,
  false
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

/* --- 7a. KURU KOŞU HİÇBİR ŞEY YAZMAZ ---------------------------------
 *
 * İki ayrı kanıt: (a) yazma çağrısının kaynak kodda dry-run kapısının
 * ARKASINDA durduğu, (b) betiği gerçekten çalıştırınca data/ altındaki
 * hiçbir dosyanın değişmediği. (b) burada yalnızca anahtarsız yolu
 * kanıtlıyor — anahtarlı kuru koşu GitHub Actions'ta doğrulanıyor.
 * ------------------------------------------------------------------- */

assert.equal(/apply:\s*false/.test(runner), true, "--apply varsayılan olarak kapalı olmalı");
const dryGuardAt = runner.indexOf("if (!args.apply)");
const writeAt = runner.indexOf("atomicWrite(ENRICHMENT_PATH");
assert.ok(dryGuardAt > -1, "dry-run kapısı bulunmalı");
assert.ok(writeAt > dryGuardAt, "yazma çağrısı dry-run kapısının arkasında olmalı");
assert.equal(
  (runner.match(/atomicWrite\(ENRICHMENT_PATH/g) || []).length,
  1,
  "tek bir yazma noktası olmalı; ikinci bir çıkış kapıyı atlatabilir"
);

const dataDir = path.join(root, "data");
function snapshotData() {
  return fs.readdirSync(dataDir).sort().map((name) => {
    const filePath = path.join(dataDir, name);
    if (!fs.statSync(filePath).isFile()) return `${name}:dir`;
    return `${name}:${crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`;
  }).join("\n");
}

const beforeRun = snapshotData();
const dryRun = spawnSync(process.execPath, [path.join(root, "scripts", "enrich-post-match.mjs")], {
  cwd: root,
  encoding: "utf8",
  // Anahtarı kasten VERMİYORUZ: bu testin işi ağ değil, yazma güvenliği.
  env: { ...process.env, APIFOOTBALL_API_KEY: "", API_FOOTBALL_KEY: "", RAPIDAPI_KEY: "" }
});
assert.equal(snapshotData(), beforeRun, "kuru koşu data/ altında hiçbir dosyayı değiştirmemeli");
assert.equal(dryRun.status, 1, "anahtar yokken çıkış kodu düşmeli");
assert.ok(/APIFOOTBALL_API_KEY/.test(dryRun.stdout + dryRun.stderr), "eksik yapılandırma adıyla bildirilmeli");

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

/* ------------------------------------------------------------------ *
 * 10. KÜRASYONLU KİMLİK, SAĞLAYICI TARAFINDAN ÇÖZÜLENLE ÇELİŞEMEZ
 *
 * `goztepe-rudes-2026-07-26` kaydı iki kimlik taşıyordu: elle girilmiş
 * eski `providerId: "2542013"` ve backfill adımının sağlayıcıdan çözüp
 * yazdığı `providerIds.apiFootball: "1598546"`. İkisi çelişiyordu ve
 * çelişki hiçbir yerde alarm üretmiyordu — zenginleştirme eski alanı
 * okuyup boş bir fikstüre bağlanıyor, kayıt "%0 kapsam" diye
 * görünüyordu.
 *
 * `withProviderId` çakışan bir değeri ASLA ezmediği için isim alanlı
 * kimlik sağlayıcı doğrulamasının kalıcı kaydıdır. Eski alan ondan
 * sapıyorsa sapan taraf eski alandır. Bu tek iddia, düzeltilen kimliğin
 * sessizce geri dönmesini engelliyor.
 * ------------------------------------------------------------------ */

const { isApiFootballId } = require("../services/providerIdentityService.js");
const curatedMatches = JSON.parse(fs.readFileSync(path.join(root, "data", "matches.json"), "utf8"));

assert.deepEqual(
  curatedMatches
    .filter((match) => isApiFootballId(match.providerId) &&
      match.providerIds && match.providerIds.apiFootball &&
      String(match.providerIds.apiFootball) !== String(match.providerId))
    .map((match) => `${match.id}: providerId=${match.providerId} ≠ providerIds.apiFootball=${match.providerIds.apiFootball}`),
  [],
  "kürasyonlu providerId, sağlayıcıdan çözülmüş providerIds.apiFootball ile çelişemez"
);

/**
 * SAYFA RENDER ENTEGRASYONU BU DEĞİŞİKLİĞE DAHİL DEĞİL.
 *
 * Bu PR yalnızca KURU KOŞU doğrulamasını main'e taşıyor: iş akışı adımı ve
 * onu çalıştırmak için gereken en küçük bağımlılık kümesi. Rapor
 * sayfalarına zenginleştirme bölümlerini basan generate-post-match-pages
 * değişikliği ayrı bir değişiklikte gelecek — bu yüzden ona ait iddialar
 * burada YOK. Testin, göndermediği bir şeyi doğruladığını iddia etmemesi
 * gerekiyor.
 */

console.log(`OK maç sonu zenginleştirme · ${SECTION_KEYS.length} bölüm · ` +
  "kimlik çözümlemesi (kayıttaki kimlik dahil takım+tarih+skor doğrulamalı), " +
  "ölçülmüş alan süzgeci, kürasyon geçersiz kılma, kısmi mesaj, " +
  "yazma güvenliği (kuru koşuda sıfır yazma), kesinti ayrımı");
