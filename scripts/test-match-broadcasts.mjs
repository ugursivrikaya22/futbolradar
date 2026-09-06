#!/usr/bin/env node
/**
 * TÜRK TAKIMLARININ MAÇ YAYIN BİLGİSİ — SÖZLEŞME DENETİMİ.
 *
 * Ağsız çalışır: sağlayıcı adaptörleri her testte ENJEKTE EDİLEN sahte
 * `fetchImpl`/HTML ile çağrılır, gerçek beIN/TRT sunucusuna hiç istek
 * gitmez (bkz. scripts/test-supabase-layer.mjs'in aynı disiplini).
 *
 * NE SINANIYOR VE NEDEN
 *  1. Takım adı normalizasyonu ("GALATASARAY A.Ş." / "Galatasaray SK" aynı
 *     kulüp) — ayrı bir sistem KURULMADI, services/superLigTeams.js#sameClub
 *     zaten bu sorunun cevabı; burada o cevabın hâlâ doğru çalıştığı sınanır.
 *  2. Kürasyonlu yayın bilgisi ASLA ezilmiyor.
 *  3. Eşleşme home+away+tarih İLE kurulur; yalnızca takım adına bakarak
 *     yanlış maça kanal atanmıyor.
 *  4. Sağlayıcı adaptörleri (bein/trt) ağ hatasında ya da beklenmedik
 *     HTML'de ÇÖKMÜYOR, boş/kısmi sonuçle devam ediyor.
 *  5. Aynı takım çiftinin gün içindeki TEKRAR yayını, CANLI yayınla
 *     karıştırılmıyor (saat toleransı).
 *  6. `mergeBroadcastRecords`: manuel kayda dokunmuyor, eşleşmeyen maçta
 *     eski doğru kaydı SİLMİYOR, değişen kanalı doğru sayıyor.
 *  7. Supabase normalizasyonu eksik/bozuk alanı satırın tamamını
 *     düşürüyor, tanınmayan `confidence` NULL'a düşüyor.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const { attachBroadcastInfo, findBroadcastRecord, isSameFixture, curatedChannel } = require("../services/matchBroadcasts.js");
const { htmlToLines, parseFixtureLine, parseTurkishDateHeader, findChannelNear } = require("../services/broadcastProviders/htmlText.js");
const { candidatesForChannel, fetchBeinBroadcastSchedule, CHANNELS } = require("../services/broadcastProviders/beinBroadcastProvider.js");
const { extractCandidates, fetchTrtBroadcastSchedule } = require("../services/broadcastProviders/trtBroadcastProvider.js");
const { fetchFallbackBroadcastSchedule } = require("../services/broadcastProviders/fallbackBroadcastProvider.js");
const normalize = require("../services/supabase/normalize.js");

console.log("match-broadcasts");

// ── 1. TAKIM ADI NORMALİZASYONU — sameClub üzerinden ────────────────────
{
  const fixture = { homeTeam: "Galatasaray", awayTeam: "Fenerbahçe", kickoff: "2026-09-06T20:00:00+03:00" };

  assert.ok(
    isSameFixture(fixture, { homeTeam: "GALATASARAY A.Ş.", awayTeam: "FENERBAHÇE A.Ş.", matchDate: "2026-09-06" }),
    "kurumsal ekli isimler (A.Ş.) aynı kulüp sayılmalı"
  );
  assert.ok(
    isSameFixture(fixture, { homeTeam: "Galatasaray SK", awayTeam: "Fenerbahce", matchDate: "2026-09-06" }),
    "SK eki ve aksansız yazım (Fenerbahce) aynı kulüp sayılmalı"
  );
  assert.ok(
    isSameFixture(fixture, { homeTeam: "Fenerbahçe", awayTeam: "Galatasaray", matchDate: "2026-09-06" }),
    "ev/deplasman ters yazılmış olsa bile aynı maç sayılmalı (tarafsız saha senaryosu)"
  );
  assert.equal(
    isSameFixture(fixture, { homeTeam: "Galatasaray", awayTeam: "Fenerbahçe", matchDate: "2026-09-13" }),
    false,
    "aynı takımlar ama FARKLI tarih aynı maç sayılmamalı"
  );
  assert.equal(
    isSameFixture(fixture, { homeTeam: "Galatasaray", awayTeam: "Beşiktaş", matchDate: "2026-09-06" }),
    false,
    "bir taraf yanlışsa (Beşiktaş ≠ Fenerbahçe) eşleşmemeli"
  );
  console.log("  ok  takım adı normalizasyonu: A.Ş./SK/aksansız yazım aynı kulüp, yanlış tarih/taraf eşleşmiyor");
}

// ── 2. KÜRASYONLU VERİ ASLA EZİLMİYOR ────────────────────────────────────
{
  const records = [{ fixtureId: "gs-fb-2026-09-06", homeTeam: "Galatasaray", awayTeam: "Fenerbahçe", matchDate: "2026-09-06", broadcaster: "TRT 1" }];

  const curated = { id: "gs-fb-2026-09-06", homeTeam: "Galatasaray", awayTeam: "Fenerbahçe", kickoff: "2026-09-06T20:00:00+03:00", broadcast: { turkey: "S Sport Plus" } };
  assert.equal(curatedChannel(curated), "S Sport Plus");
  const untouched = attachBroadcastInfo(curated, records);
  assert.equal(untouched.broadcast.turkey, "S Sport Plus", "kürasyonlu kanal otomatik bulunanla DEĞİŞTİRİLMEMELİ");

  const empty = { id: "gs-fb-2026-09-06", homeTeam: "Galatasaray", awayTeam: "Fenerbahçe", kickoff: "2026-09-06T20:00:00+03:00" };
  const filled = attachBroadcastInfo(empty, records);
  assert.equal(filled.broadcast.turkey, "TRT 1", "boş alan otomatik bulunan kanalla doldurulmalı");
  assert.equal(empty.broadcast, undefined, "orijinal nesne mutasyona uğramamalı (yeni nesne dönmeli)");

  const noRecord = { id: "baska-mac", homeTeam: "Trabzonspor", awayTeam: "Konyaspor", kickoff: "2026-09-06T20:00:00+03:00" };
  assert.equal(attachBroadcastInfo(noRecord, records), noRecord, "eşleşen kayıt yoksa maç DEĞİŞTİRİLMEDEN dönmeli");
  console.log("  ok  kürasyonlu yayın bilgisi otomatik sistem tarafından asla ezilmiyor");
}

// ── 3. EŞLEŞME TAKIM+TARİH İLE — yalnızca isimle yanlış maça atanmıyor ──
{
  const records = [{ fixtureId: "x", homeTeam: "Galatasaray", awayTeam: "Fenerbahçe", matchDate: "2026-09-06", broadcaster: "beIN SPORTS 1" }];
  const sameNamesDifferentDate = { id: "y", homeTeam: "Galatasaray", awayTeam: "Fenerbahçe", kickoff: "2027-01-01T20:00:00+03:00" };
  assert.equal(findBroadcastRecord(sameNamesDifferentDate, records), null, "aynı takımlar ama farklı sezon/tarihte kanal atanmamalı");

  const idMatch = { id: "x", homeTeam: "Galatasaray A.Ş.", awayTeam: "Fenerbahçe A.Ş.", kickoff: "2026-09-06T20:00:00+03:00" };
  assert.equal(findBroadcastRecord(idMatch, records).broadcaster, "beIN SPORTS 1", "fixture id eşleşmesi takım yazım farkına rağmen bulunmalı");
  console.log("  ok  eşleşme home+away+tarih ile kurulur; yalnızca isim benzerliği yanlış maça kanal atamıyor");
}

// ── 4. beIN ADAPTÖRÜ — gerçek sayfa yapısı (streaming-content_time/_program) ──
{
  const fakeHtml = `
    <tr><td><span class="streaming-content_time__abc123">17:00</span><span class="streaming-content_program__def456">Kasımpaşa - Amed SF</span></td></tr>
    <tr><td><span class="streaming-content_time__abc123">19:00</span><span class="streaming-content_program__def456">beIN Süper Lig</span></td></tr>
    <tr><td><span class="streaming-content_time__abc123">20:00</span><span class="streaming-content_program__def456">Trabzonspor - Gençlerbirliği</span></td></tr>
  `;
  const candidates = candidatesForChannel(fakeHtml, CHANNELS[0], "2026-09-06");
  assert.equal(candidates.length, 2, "'beIN Süper Lig' gibi program adları gerçek fikstür sayılmamalı");
  assert.deepEqual(
    candidates.map((c) => `${c.homeTeam} - ${c.awayTeam} @ ${c.time}`),
    ["Kasımpaşa - Amed SF @ 17:00", "Trabzonspor - Gençlerbirliği @ 20:00"]
  );
  assert.equal(candidates[0].broadcaster, "beIN SPORTS 1");
  assert.equal(candidates[0].confidence, "official");
  console.log("  ok  beIN adaptörü gerçek sayfa yapısından (time/program span çifti) fikstür çıkarıyor");
}

// ── 5. SAĞLAYICI DAYANIKLILIĞI — ağ hatası/bozuk HTML sistemi çökertmiyor ──
{
  const throwingFetch = async () => { throw new Error("network-down"); };
  const beinResult = await fetchBeinBroadcastSchedule({ fetchImpl: throwingFetch, now: new Date("2026-09-06T00:00:00Z") });
  assert.equal(beinResult.ok, false, "tüm kanallar başarısız olursa ok=false dönmeli, fırlatmamalı");
  assert.deepEqual(beinResult.matches, []);
  assert.ok(beinResult.error, "hata mesajı taşınmalı");

  const trtResult = await fetchTrtBroadcastSchedule({ fetchImpl: throwingFetch, now: new Date("2026-09-06T00:00:00Z") });
  assert.equal(trtResult.ok, false);
  assert.deepEqual(trtResult.matches, []);

  // Bozuk/beklenmedik HTML: fırlatmaz, yalnızca boş sonuç döner.
  const garbledFetch = async () => ({ ok: true, text: async () => "<html><body>???</body></html>" });
  const trtGarbled = await fetchTrtBroadcastSchedule({ fetchImpl: garbledFetch });
  assert.equal(trtGarbled.ok, true);
  assert.deepEqual(trtGarbled.matches, [], "tanınmayan yapı YANLIŞ bir kanal uydurmak yerine boş sonuç vermeli");
  console.log("  ok  bein/trt adaptörleri ağ hatasında ve bozuk HTML'de çökmüyor, boş/kısmi sonuçle devam ediyor");
}

// ── 6. TRT ADAPTÖRÜ — Türkçe tarih başlığı + kanal yakınlığı ────────────
{
  const fakeHtml = `
    <div>6 Eylül Pazar</div>
    <div>Galatasaray - Fenerbahçe</div>
    <div>TRT 1 canlı yayın</div>
  `;
  const lines = htmlToLines(fakeHtml);
  const dateHeader = parseTurkishDateHeader(lines[0], new Date("2026-09-01T00:00:00Z"));
  assert.equal(dateHeader, "2026-09-06");

  const fixture = parseFixtureLine("Galatasaray - Fenerbahçe");
  assert.deepEqual(fixture, { home: "Galatasaray", away: "Fenerbahçe" });
  assert.equal(parseFixtureLine("beIN Süper Lig"), null, "tire içermeyen program adı fikstür sayılmamalı");

  const channel = findChannelNear(lines, 1, [{ pattern: /trt\s*1\b/i, label: () => "TRT 1" }], 2);
  assert.equal(channel, "TRT 1");

  const candidates = extractCandidates(lines, new Date("2026-09-01T00:00:00Z"));
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].broadcaster, "TRT 1");
  assert.equal(candidates[0].date, "2026-09-06");
  console.log("  ok  TRT adaptörü Türkçe tarih başlığını çözüyor ve yakın kanal adını doğru eşliyor");
}

// ── 7. YEDEK SAĞLAYICI — yalnızca zaten bilinen kanalı devşiriyor ───────
{
  const fixtures = [
    { homeTeam: "A", awayTeam: "B", kickoff: "2026-09-06T20:00:00+03:00", broadcast: { turkey: "S Sport Plus" } },
    { homeTeam: "C", awayTeam: "D", kickoff: "2026-09-06T20:00:00+03:00" }
  ];
  const result = await fetchFallbackBroadcastSchedule(fixtures);
  assert.equal(result.ok, true);
  assert.equal(result.matches.length, 1, "kanalı olmayan maç için aday üretilmemeli");
  assert.equal(result.matches[0].confidence, "derived");
  console.log("  ok  yedek sağlayıcı yalnızca zaten bilinen kanalı taşıyor, uydurmuyor");
}

// ── 8. ORKESTRATÖR — kapsam, saat toleransı, birleştirme ────────────────
{
  const orchestrator = await import("./sync-match-broadcasts.mjs");
  const { selectUpcomingTurkishMatches, pickOfficialCandidate, mergeBroadcastRecords } = orchestrator;

  // 8a. Kapsam: Süper Lig maçı içeride, alakasız yabancı lig maçı dışarıda,
  // pencerenin dışındaki (9 gün sonraki) maç dışarıda.
  const now = new Date("2026-09-06T00:00:00+03:00");
  const pool = [
    { id: "sl-1", homeTeam: "Trabzonspor", awayTeam: "Gençlerbirliği", kickoff: "2026-09-06T20:00:00+03:00", competitionId: "super-lig" },
    { id: "foreign-1", homeTeam: "Real Madrid", awayTeam: "Barcelona", kickoff: "2026-09-06T22:00:00+03:00", competitionId: "la-liga" },
    { id: "too-far", homeTeam: "Galatasaray", awayTeam: "Beşiktaş", kickoff: "2026-09-20T20:00:00+03:00", competitionId: "super-lig" },
    { id: "finished", homeTeam: "Fenerbahçe", awayTeam: "Beşiktaş", kickoff: "2026-09-06T15:00:00+03:00", status: "FINISHED", score: { home: 1, away: 0 } }
  ];
  const upcoming = selectUpcomingTurkishMatches(pool, { now, days: 8 });
  const ids = upcoming.map((m) => m.id);
  assert.ok(ids.includes("sl-1"), "Süper Lig maçı kapsamda olmalı");
  assert.ok(!ids.includes("foreign-1"), "Türk takımı içermeyen yabancı lig maçı kapsam dışı kalmalı");
  assert.ok(!ids.includes("too-far"), "8 günlük pencerenin dışındaki maç dışarıda kalmalı");
  assert.ok(!ids.includes("finished"), "bitmiş maç yayın taramasına girmemeli");

  // 8b. Kanal önceliği: Avrupa kupası maçında TRT, iç saha maçında beIN önce denenir.
  const europeanFixture = { homeTeam: "Galatasaray", awayTeam: "Liverpool", kickoff: "2026-09-06T22:00:00+03:00", competitionId: "sampiyonlar-ligi" };
  const domesticFixture = { homeTeam: "Galatasaray", awayTeam: "Beşiktaş", kickoff: "2026-09-06T20:00:00+03:00", competitionId: "super-lig" };
  const bein = [{ homeTeam: "Galatasaray", awayTeam: "Liverpool", date: "2026-09-06", time: "22:00", broadcaster: "beIN SPORTS 1" }];
  const trt = [{ homeTeam: "Galatasaray", awayTeam: "Liverpool", date: "2026-09-06", time: "22:00", broadcaster: "TRT 1" }];
  assert.equal(pickOfficialCandidate(europeanFixture, bein, trt).broadcaster, "TRT 1", "UEFA kupası maçında TRT önce denenmeli");
  assert.equal(pickOfficialCandidate(domesticFixture, [], []), null, "hiçbir kaynakta yoksa null dönmeli");

  // 8c. Saat toleransı: aynı takım çifti günde iki kez geçiyorsa (tekrar +
  // canlı), fikstürün bilinen saatine YAKIN olan seçilmeli.
  const replayAndLive = [
    { homeTeam: "Kocaelispor", awayTeam: "Samsunspor", date: "2026-09-06", time: "07:30", broadcaster: "beIN SPORTS 2 (tekrar)" },
    { homeTeam: "Kocaelispor", awayTeam: "Samsunspor", date: "2026-09-06", time: "20:01", broadcaster: "beIN SPORTS 2" }
  ];
  const liveFixture = { homeTeam: "Kocaelispor", awayTeam: "Samsunspor", kickoff: "2026-09-06T20:00:00+03:00" };
  assert.equal(pickOfficialCandidate(liveFixture, replayAndLive, []).broadcaster, "beIN SPORTS 2", "sabah tekrarı değil, akşamki CANLI slot seçilmeli");

  console.log("  ok  orkestratör kapsamı doğru (Süper Lig + Avrupa kupası), kanal önceliği ve saat toleransı çalışıyor");

  // 8d. mergeBroadcastRecords: manuel kayda dokunma, eşleşmeyeni silme, değişimi say.
  const existing = [
    { fixtureId: "manual-1", homeTeam: "Galatasaray", awayTeam: "Fenerbahçe", matchDate: "2026-09-06T20:00:00+03:00", broadcaster: "Admin Override Kanalı", isManual: true },
    { fixtureId: "stale-1", homeTeam: "Beşiktaş", awayTeam: "Trabzonspor", matchDate: "2026-09-06T20:00:00+03:00", broadcaster: "beIN SPORTS 1", isManual: false },
    { fixtureId: "changed-1", homeTeam: "Konyaspor", awayTeam: "Alanyaspor", matchDate: "2026-09-06T20:00:00+03:00", broadcaster: "TRT 1", isManual: false }
  ];
  const fixtures = [
    { id: "manual-1", homeTeam: "Galatasaray", awayTeam: "Fenerbahçe", kickoff: "2026-09-06T20:00:00+03:00" },
    { id: "stale-1", homeTeam: "Beşiktaş", awayTeam: "Trabzonspor", kickoff: "2026-09-06T20:00:00+03:00" },
    { id: "changed-1", homeTeam: "Konyaspor", awayTeam: "Alanyaspor", kickoff: "2026-09-06T20:00:00+03:00" },
    { id: "new-1", homeTeam: "Göztepe", awayTeam: "Kayserispor", kickoff: "2026-09-06T20:00:00+03:00" }
  ];
  const resolvers = {
    "manual-1": { broadcaster: "SIZINTI Kanalı" }, // manuel kayıt için bulunsa bile KULLANILMAMALI
    "stale-1": null, // bu koşuda kaynakta bulunamadı → eski kayıt KORUNMALI
    "changed-1": { broadcaster: "beIN SPORTS 3", sourceName: "beIN SPORTS Türkiye", confidence: "official" },
    "new-1": { broadcaster: "TRT Spor", sourceName: "TRT", confidence: "official" }
  };
  const merge = mergeBroadcastRecords(existing, fixtures, (fixture) => resolvers[fixture.id] || null, { nowIso: "2026-09-05T06:00:00Z" });

  const byId = new Map(merge.records.map((r) => [r.fixtureId, r]));
  assert.equal(byId.get("manual-1").broadcaster, "Admin Override Kanalı", "isManual=true kayda otomatik sistem ASLA dokunmamalı");
  assert.equal(byId.get("stale-1").broadcaster, "beIN SPORTS 1", "eşleşme bulunamayınca eski doğru kayıt SİLİNMEMELİ");
  assert.equal(byId.get("changed-1").broadcaster, "beIN SPORTS 3", "yeni bulunan kanal eskisinin üzerine yazmalı");
  assert.equal(byId.get("new-1").broadcaster, "TRT Spor", "yeni maç için kayıt eklenmeli");
  assert.equal(merge.counters.manualSkipped, 1);
  assert.equal(merge.counters.changed, 2, "yalnızca gerçekten değişen/yeni kayıtlar sayılmalı (changed-1, new-1)");
  assert.equal(merge.counters.unmatched, 1, "stale-1 eşleşmedi diye sayılmalı ama SİLİNMEMELİ");
  console.log("  ok  mergeBroadcastRecords: manuel kayıt dokunulmaz, eşleşmeyen eski kayıt korunur, değişim doğru sayılır");
}

// ── 9. SUPABASE NORMALİZASYONU ───────────────────────────────────────────
{
  const row = normalize.matchBroadcast({
    fixtureId: "gs-fb-2026-09-06", homeTeam: "Galatasaray", awayTeam: "Fenerbahçe",
    matchDate: "2026-09-06T20:00:00+03:00", broadcaster: "beIN SPORTS 1", confidence: "official"
  });
  assert.equal(row.fixture_id, "gs-fb-2026-09-06");
  assert.equal(row.country, "TR", "ülke varsayılanı TR olmalı");
  assert.equal(row.confidence, "official");

  assert.equal(normalize.matchBroadcast({ homeTeam: "Galatasaray", awayTeam: "Fenerbahçe" }), null, "fixtureId/tarih eksikse satır YAZILMAMALI");

  const unknownConfidence = normalize.matchBroadcast({
    fixtureId: "x", homeTeam: "A", awayTeam: "B", matchDate: "2026-09-06T20:00:00+03:00", confidence: "kesinlikle-emin"
  });
  assert.equal(unknownConfidence.confidence, null, "tanınmayan güven seviyesi NULL'a düşmeli, uydurulmamalı");
  console.log("  ok  normalize.matchBroadcast: eksik alan satırı düşürüyor, tanınmayan confidence NULL'a düşüyor");
}

console.log("match-broadcasts: tüm denetimler geçti.");
