#!/usr/bin/env node
/**
 * FİKSTÜR YİNELEMESİ — SÖZLEŞME DENETİMİ.
 *
 * Aynı maç iki sağlayıcıdan geliyor ve ikisi kulüp adını farklı yazıyor:
 * "Gençlerbirliği" / "Gençlerbirliği S.K.", "Rizespor" / "Çaykur Rizespor".
 * Kimlik anahtarı ham metin eşitliğine baktığı için aynı karşılaşma listeye
 * İKİ KEZ giriyordu.
 *
 * Bedeli üç yerde birden görünüyordu:
 *   • Ana sayfada ve fikstürde aynı maç iki satır.
 *   • Maç dosyası hangi kayda bağlanacağını bilemiyordu.
 *   • Sağlayıcı kimlikleri kayıtlara dağıldığı için resmî ilk 11
 *     otomasyonu (API-Football kimliğine bağlı) maçların bir kısmında
 *     hiç çalışamıyordu.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { mergeCalendarMatches, dedupeCalendarMatches } from "./sync-live-fixtures.mjs";

const require = createRequire(import.meta.url);
const { curatedMatches, resolveProviderVenue } = require("../services/providers/mockProvider.js");
const { sameClub } = require("../services/superLigTeams.js");

console.log("fixture-dedupe");

const all = curatedMatches();

const matchDate = (match) => String((match && (match.kickoff || match.date)) || "").slice(0, 10);

// ── 1. AYNI GÜN, AYNI KULÜP ÇİFTİ İKİ KEZ LİSTELENMEZ ─────────────────────
{
  const byDate = new Map();
  for (const match of all) {
    const date = matchDate(match);
    if (!date) continue;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(match);
  }

  const duplicates = [];
  for (const [date, rows] of byDate) {
    for (let i = 0; i < rows.length; i += 1) {
      for (let j = i + 1; j < rows.length; j += 1) {
        const a = rows[i];
        const b = rows[j];
        const straight = sameClub(a.homeTeam, b.homeTeam) && sameClub(a.awayTeam, b.awayTeam);
        const swapped = sameClub(a.homeTeam, b.awayTeam) && sameClub(a.awayTeam, b.homeTeam);
        if (straight || swapped) {
          duplicates.push(`${date}: "${a.homeTeam} - ${a.awayTeam}" ≡ "${b.homeTeam} - ${b.awayTeam}"`);
        }
      }
    }
  }

  assert.deepEqual(duplicates.slice(0, 5), [],
    `aynı maç birden çok kez listelenmiş:\n  ${duplicates.slice(0, 5).join("\n  ")}`);
  console.log(`  ok  ${all.length} maç, yinelenen çift yok`);
}

// ── 2. HİÇBİR SAĞLAYICI KİMLİĞİ BİRLEŞMEDE KAYBOLMAZ ──────────────────────
//
// Resmî ilk 11 otomasyonu API-Football kimliğine bağlı; yinelenen iki
// kayıttan kimlik YALNIZCA birinde olabiliyor (Gençlerbirliği - Fenerbahçe
// tam olarak böyleydi: "Gençlerbirliği" kaydında theSportsDb, "Gençlerbirliği
// S.K." kaydında apiFootball). Birleşme kimliği düşürürse özellik o maçta
// sessizce çalışmaz — hata vermez, sadece kadro hiç gelmez.
//
// Sözleşme "her maçın kimliği vardır" DEĞİL: sağlayıcı bazı maçları hiç
// kimliksiz gönderiyor ve olmayan bir kimliği uydurmak seçenek değil.
// Sözleşme şu: takvimde bulunan her kimlik, birleşmiş kayıtta da durur.
{
  const calendar = require("../data/fixture-calendar.json");
  const calendarRows = Array.isArray(calendar) ? calendar : (calendar.matches || []);
  const upcoming = calendarRows.filter((match) =>
    match && match.league === "Süper Lig" && String(match.kickoff || "") > "2026-08-14");
  assert.ok(upcoming.length > 0, "takvimde yaklaşan Süper Lig maçı bulunmalı");

  const lost = [];
  for (const source of upcoming) {
    for (const [provider, id] of Object.entries(source.providerIds || {})) {
      const merged = all.find((match) =>
        matchDate(match) === matchDate(source)
        && ((sameClub(match.homeTeam, source.homeTeam) && sameClub(match.awayTeam, source.awayTeam))
          || (sameClub(match.homeTeam, source.awayTeam) && sameClub(match.awayTeam, source.homeTeam))));
      if (!merged) continue; // yayın politikası elemiş olabilir; 1. bölümün konusu değil
      if ((merged.providerIds || {})[provider] !== id) {
        lost.push(`${source.homeTeam} - ${source.awayTeam}: ${provider}=${id}`);
      }
    }
  }

  assert.deepEqual(lost, [], `birleşmede sağlayıcı kimliği kayboldu:\n  ${lost.join("\n  ")}`);
  console.log(`  ok  takvimdeki ${upcoming.length} maçın sağlayıcı kimlikleri korundu`);
}

// ── 3. BİRLEŞME DOĞRULANMIŞ ALANI EZMEZ ───────────────────────────────────
//
// Stat adı editoryal olarak doğrulanmış bir alan. İki kayıt birleşirken
// sağlayıcının yazımı ("Eryaman Stadium") doğrulanmışın ("Eryaman Stadyumu")
// yerine geçmemeli.
//
// KURAL DOĞRUDAN SINANIR, BELİRLİ BİR MAÇ ÜZERİNDEN DEĞİL. Bu blok önce
// takvimden tek bir maçı (Gençlerbirliği - Fenerbahçe, 15.08.2026) çekip
// stadına bakıyordu. Fikstür takvimi kayan bir pencere: maç oynanıp
// pencerenin gerisine düşünce satır siliniyor ve test, kuralda hiçbir şey
// bozulmadığı hâlde "maç listede olmalı" diyerek kırılıyordu. Kuralı
// uygulayan işlev (`resolveProviderVenue`) saf ve dışa açık; ölçülecek yer
// orası.
{
  assert.equal(
    resolveProviderVenue("Eryaman Stadyumu", "Eryaman Stadium"),
    null,
    "dolu ve doğrulanmış saha, sağlayıcı yazımıyla ezilmemeli"
  );
  assert.equal(
    resolveProviderVenue(null, "Eryaman Stadium"),
    "Eryaman Stadium",
    "boş saha sağlayıcıdan doldurulmalı"
  );
  assert.equal(resolveProviderVenue("", "Rams Park"), "Rams Park");
  assert.equal(resolveProviderVenue("Rams Park Stadyumu", null), null,
    "sağlayıcı saha vermediyse dolu alan korunmalı");

  // Yayındaki listede de doğrulanmış saha boşa düşmemeli.
  const emptied = all.filter((match) => match.venueSource === "club-home-ground" && !String(match.venue || "").trim());
  assert.deepEqual(emptied, [], "türetilmiş saha boş kalamaz");
  console.log("  ok  doğrulanmış stat adı sağlayıcı yazımıyla ezilmiyor");
}

// ── 4. LİG MAÇINDA SAHA BOŞ KALMAZ ────────────────────────────────────────
//
// Sağlayıcı bazı lig maçlarını `venue: null` gönderiyor. Lig maçında ev
// sahibi kendi stadında oynar ve o stat fikstür dosyasında doğrulanmış;
// alan boş bırakılmak yerine oradan doldurulur. Hazırlık maçlarına
// UYGULANMAZ — kural orada yanlış sonuç veriyordu (yurt dışı kampı).
//
// SINANAN KURAL "SAHA BOŞ KALMAZ"DIR, "SAHA ŞU DİZEDİR" DEĞİL: bu blok önce
// tek bir maçı ve onun tam stat adını şart koşuyordu; sağlayıcı stadı kendi
// yazımıyla doldurunca da, maç takvim penceresinden düşünce de kırıldı.
// Şimdi kural takvimdeki BÜTÜN lig maçlarına uygulanıyor.
{
  const league = all.filter((match) => match.league === "Süper Lig");
  assert.ok(league.length > 0, "ön koşul: takvimde en az bir Süper Lig maçı olmalı");

  const empty = league
    .filter((match) => !String(match.venue || "").trim())
    .map((match) => `${match.homeTeam} - ${match.awayTeam} (${matchDate(match)})`);
  assert.deepEqual(empty, [], `lig maçında saha boş kalmamalı:\n  ${empty.join("\n  ")}`);

  const friendly = all.find((match) =>
    match.league !== "Süper Lig" && match.venueSource === "club-home-ground");
  assert.equal(friendly, undefined,
    `kural lig dışına sızmış: ${friendly && `${friendly.homeTeam} - ${friendly.awayTeam}`}`);
  console.log(`  ok  ${league.length} lig maçının hepsinde saha dolu`);
}

// ── 5. TAKVİMİ DOĞRUDAN OKUYAN UÇ NOKTA DA ONARILMIŞ KAYIT GÖRÜR ─────────
//
// Bu, canlıda yakalanan gerçek hatanın testi.
//
// Birleştirme yalnızca sağlayıcı katmanındaydı (`curatedMatches`), oysa
// `server/matchLineupRoute.js` takvimi DOĞRUDAN okuyor. Oradaki kayıt hâlâ
// yarımdı ve uç nokta `providerIds.apiFootball || providerId` sırasını
// izlediği için Gençlerbirliği – Fenerbahçe maçında theSportsDb kimliği
// (2527728) API-Football'a fikstür kimliği diye gidiyordu.
//
// Sonuç sessizdi: hata yok, yalnızca resmî ilk 11 o maçta HİÇ gelmiyordu —
// yani maç dosyasının en çok beklenen özelliği çalışmayacaktı. Testin
// sorduğu soru bu yüzden "kimlik var mı" değil, "DOĞRU sağlayıcının kimliği
// mi": theSportsDb kimliğini apiFootball sanmak, kimliğin hiç olmamasından
// daha kötü, çünkü sağlayıcıya boşuna gidilir.
{
  const { findFixtureById } = require("../services/fixtureCalendar.js");
  const { providerFixtureId } = require("../server/matchLineupRoute.js");
  const calendar = require("../data/fixture-calendar.json");
  const calendarRows = Array.isArray(calendar) ? calendar : (calendar.matches || []);

  // KURAL TAKVİMDEKİ BÜTÜN LİG MAÇLARINA UYGULANIR. Burası önce tek bir
  // güne (15.08.2026) sabitlenmişti; takvim kayan bir pencere olduğu için
  // o gün düştüğünde test, kuralda hiçbir şey bozulmadan kırılıyordu.
  const upcoming = calendarRows.filter((match) => match && match.league === "Süper Lig");
  assert.ok(upcoming.length > 0, "ön koşul: takvimde en az bir Süper Lig maçı olmalı");

  for (const source of upcoming) {
    const fixture = findFixtureById(calendar, source.id);
    assert.ok(fixture, `${source.id}: kayıt bulunmalı`);

    // Aynı maçın BAŞKA bir kaydında apiFootball kimliği varsa, bu kayıt da
    // onu görmeli — kimlik kayıtlar arasında bölünmüş kalamaz.
    const twin = calendarRows.find((row) => row !== source
      && matchDate(row) === matchDate(source)
      && ((sameClub(row.homeTeam, source.homeTeam) && sameClub(row.awayTeam, source.awayTeam))
        || (sameClub(row.homeTeam, source.awayTeam) && sameClub(row.awayTeam, source.homeTeam))));
    const twinApiId = twin && (twin.providerIds || {}).apiFootball;
    if (twinApiId) {
      assert.equal((fixture.providerIds || {}).apiFootball, twinApiId,
        `${source.id}: eş kaydın API-Football kimliği birleştirilmemiş`);
    }

    // Uç noktanın GERÇEKTEN kullandığı seçim sınanır — burada yeniden
    // yazılmaz. Kural: sonuç ya API-Football kimliğidir ya da hiçbir şey;
    // theSportsDb kimliği ASLA API-Football kimliği yerine geçmez.
    const ids = fixture.providerIds || {};
    const chosen = providerFixtureId(fixture);
    if (ids.theSportsDb && chosen) {
      assert.notEqual(chosen, String(ids.theSportsDb),
        `${source.id}: theSportsDb kimliği API-Football kimliği yerine kullanılıyor (${chosen})`);
    }
    if (chosen) {
      assert.equal(chosen, String(ids.apiFootball),
        `${source.id}: seçilen kimlik API-Football kimliği olmalı`);
    }
  }
  console.log(`  ok  ${upcoming.length} maçta uç nokta doğru sağlayıcı kimliğini görüyor`);

  // Uç nokta kaydı KENDİ başına aramamalı: ham arama, onarımı atlar ve hata
  // sessizce geri döner. Sözleşme kaynak düzeyinde de tutuluyor.
  const route = fs.readFileSync(new URL("../server/matchLineupRoute.js", import.meta.url), "utf8");
  assert.match(route, /findFixtureById\(loadFixtures\(\)/,
    "matchLineupRoute onarılmış kaydı okumalı (findFixtureById)");
  assert.ok(!/fixtureList\(loadFixtures\(\)\)\s*\.find/.test(route),
    "matchLineupRoute ham takvimde doğrudan arama yapmamalı");
}

// ── 6. CANLI FİKSTÜR SENKRONU HAM YAZIMLA İKİNCİ SATIR AÇMAZ ──────────────
//
// Canlıda yakalanan gerçek hata: sync-live-fixtures.mjs API-Football'un ham
// "Rizespor" yazımını hiç kanonikleştirmeden kimlik anahtarına sokuyordu,
// bu yüzden takvimde zaten "Çaykur Rizespor" kaydı varken sonraki
// senkronlar onu tanımıyor ve HER ÇALIŞTIRMADA yeni bir "Rizespor" satırı
// yazma riski taşıyordu.
{
  const existingCanonical = {
    id: "caykur-rizespor-alanyaspor-2026-09-07",
    providerIds: { theSportsDb: "2527756" },
    homeTeam: "Çaykur Rizespor",
    awayTeam: "Alanyaspor",
    kickoff: "2026-09-07T20:00:00+03:00",
    venue: "Çaykur Didi Stadyumu",
    status: "SCHEDULED",
    score: { home: null, away: null },
    source: "thesportsdb"
  };

  const incomingRaw = {
    providerId: "1584401",
    league: "Süper Lig",
    homeTeam: "Rizespor",
    awayTeam: "Alanyaspor",
    kickoff: "2026-09-07T20:00:00+03:00",
    status: "LIVE",
    score: { home: 1, away: 0 }
  };

  const result = mergeCalendarMatches([existingCanonical], [{ match: incomingRaw, detail: null }]);
  assert.equal(result.matches.length, 1,
    "ham yazımlı sağlayıcı kaydı, zaten var olan kanonik kayda BİRLEŞMELİ, ikinci satır açmamalı");
  assert.equal(result.added, 0, "bu maç zaten takvimde; 'added' artmamalı");
  assert.equal(result.updated, 1, "canlı skor/durum var olan kanonik kayda işlenmeli");
  assert.equal(result.matches[0].homeTeam, "Çaykur Rizespor", "görünen ad kanonik kalmalı");
  assert.equal(result.matches[0].score.home, 1, "canlı skor kaybolmamalı");
  assert.equal(result.matches[0].score.away, 0, "canlı skor kaybolmamalı");
  assert.equal(result.matches[0].providerIds.theSportsDb, "2527756");
  assert.equal(result.matches[0].providerIds.apiFootball, "1584401");

  // Aynı iki takım, FARKLI gün: bu bir postponement/başka fikstür olabilir,
  // yanlışlıkla aynı kayda BİRLEŞMEMELİ.
  const otherDay = mergeCalendarMatches([existingCanonical], [{
    match: { ...incomingRaw, kickoff: "2026-11-01T20:00:00+03:00" }, detail: null
  }]);
  assert.equal(otherDay.matches.length, 2, "farklı güne ait aynı takım çifti ayrı kayıt olarak kalmalı");

  console.log("  ok  sync-live-fixtures ham takım adını kanonikleştirip tekilleştiriyor");
}

// ── 7. DİSKTE ZATEN YAZILMIŞ İKİZ SATIRLAR ONARILIYOR ─────────────────────
//
// 6. bölüm YENİ gelen kaydı korur; bu bölüm sözleşmenin diğer yarısını
// sınar: takvimde önceden (bu düzeltmeden önce) iki ayrı yazımla yazılmış
// satırlar varsa, güncelleme bir daha hiç çalışmasa bile takvim kendi
// başına onarılabilmeli — data/fixture-calendar.json'daki gerçek onarım da
// bu işlevle yapıldı.
{
  const twin = [
    { id: "caykur-rizespor-alanyaspor-2026-09-07", providerIds: { theSportsDb: "2527756" }, homeTeam: "Çaykur Rizespor", awayTeam: "Alanyaspor", kickoff: "2026-09-07T20:00:00+03:00", venue: "Çaykur Didi Stadyumu", status: "SCHEDULED", score: { home: null, away: null }, source: "thesportsdb" },
    { id: "rizespor-alanyaspor-2026-09-07", providerIds: { apiFootball: "1584401" }, homeTeam: "Rizespor", awayTeam: "Alanyaspor", kickoff: "2026-09-07T20:00:00+03:00", venue: null, status: "LIVE", score: { home: 1, away: 0 }, source: "api-football" }
  ];

  const repaired = dedupeCalendarMatches(twin);
  assert.equal(repaired.matches.length, 1, "diskte zaten var olan ikiz satırlar tek satıra inmeli");
  assert.equal(repaired.merges, 1);
  assert.equal(repaired.matches[0].homeTeam, "Çaykur Rizespor");
  assert.deepEqual(repaired.matches[0].score, { home: 1, away: 0 }, "onarım ilerlemiş durumun skorunu kaybetmemeli");
  assert.equal(repaired.matches[0].venue, "Çaykur Didi Stadyumu", "doğrulanmış saha onarımda kaybolmamalı");
  assert.equal(repaired.matches[0].providerIds.theSportsDb, "2527756");
  assert.equal(repaired.matches[0].providerIds.apiFootball, "1584401");

  // Bugünkü gerçek data/fixture-calendar.json dosyasında artık bu ikiz
  // KALMAMALI — düzeltme yalnızca fonksiyonu değil, veriyi de onardı.
  const calendarPath = new URL("../data/fixture-calendar.json", import.meta.url);
  const calendar = JSON.parse(fs.readFileSync(calendarPath, "utf8"));
  const rizesporRows = calendar.matches.filter((match) =>
    sameClub(match.homeTeam, "Çaykur Rizespor") && sameClub(match.awayTeam, "Alanyaspor"));
  const fixtureDays = rizesporRows.map(match => String(match.kickoff || match.date).slice(0, 10));
  assert.equal(new Set(fixtureDays).size, fixtureDays.length,
    "Aynı gün aynı eşleşme yinelenmemeli; arşivlenen eski maçın aktif takvimde kalması gerekmez");

  console.log("  ok  diskteki hazır ikiz satırlar dedupeCalendarMatches ile tek satıra iniyor");
}

// ── 8. İSTEMCİ BİRLEŞTİRMESİ DE AYNI KURALI UYGULAR ───────────────────────
//
// app.js#mergeMatchCollections sunucudan bağımsız, tarayıcıda çalışan ayrı
// bir uygulama (bkz. app.js#loadStaticMatchSources): sunucu tarafı doğru
// birleştirse bile istemci ham JSON'ı (data/matches.json +
// data/fixture-calendar.json) doğrudan okuyup KENDİ birleştirmesini
// yapıyor. Bu blok o birleştirmeyi app.js'ten ayıklayıp gerçek hata
// senaryosuyla (canlı sonuç sağlayıcıdan geldi, statik yedek hâlâ iki
// yazımı taşıyor) çalıştırır.
{
  const appSource = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");

  function extractFunctionAt(source, startIndex) {
    let depth = 0;
    let seenOpen = false;
    let index = startIndex;
    for (; index < source.length; index += 1) {
      if (source[index] === "{") { depth += 1; seenOpen = true; }
      else if (source[index] === "}") { depth -= 1; if (seenOpen && depth === 0) { index += 1; break; } }
    }
    return source.slice(startIndex, index);
  }

  function extractFunction(source, name, occurrence = 1) {
    let index = -1;
    let from = 0;
    for (let count = 0; count < occurrence; count += 1) {
      index = source.indexOf(`function ${name}(`, from);
      if (index === -1) throw new Error(`app.js: ${name} (occurrence ${occurrence}) bulunamadı`);
      from = index + name.length + 10;
    }
    return extractFunctionAt(source, index);
  }

  // `normalizeSearchText` app.js'te İKİ KEZ tanımlanır; ikincisi
  // çalışma anında birinciyi GÖLGELER (aynı IIFE kapsamında son
  // fonksiyon bildirimi kazanır). Gerçek tarayıcı davranışıyla eşleşmesi
  // için ikisi de, aynı sırayla, dahil edilir.
  const body = [
    extractFunction(appSource, "normalizeSearchText", 1),
    extractFunction(appSource, "normalizeSearchText", 2),
    extractFunction(appSource, "istanbulDayOf"),
    extractFunction(appSource, "matchDateValue"),
    extractFunction(appSource, "sameClubName"),
    extractFunction(appSource, "matchIdentityKey"),
    extractFunction(appSource, "recordsUpdatedAt"),
    extractFunction(appSource, "mergeMatchCollections")
  ].join("\n\n") + "\nreturn { mergeMatchCollections: mergeMatchCollections };";

  const client = new Function(body)();

  const providerMatches = [
    { id: "caykur-rizespor-alanyaspor-2026-09-07", homeTeam: "Çaykur Rizespor", awayTeam: "Alanyaspor", kickoff: "2026-09-07T20:00:00+03:00", status: "LIVE", score: { home: 1, away: 0 } }
  ];
  const staticFallback = [
    { id: "caykur-rizespor-alanyaspor-2026-09-07", homeTeam: "Çaykur Rizespor", awayTeam: "Alanyaspor", kickoff: "2026-09-07T20:00:00+03:00", status: "SCHEDULED", score: null },
    { id: "rizespor-alanyaspor-2026-09-07", homeTeam: "Rizespor", awayTeam: "Alanyaspor", kickoff: "2026-09-07T20:00:00+03:00", status: "SCHEDULED", score: null }
  ];

  const merged = client.mergeMatchCollections(providerMatches, staticFallback);
  assert.equal(merged.length, 1,
    "istemci birleştirmesi de aynı maçı iki farklı yazımla iki kart olarak göstermemeli");
  assert.equal(merged[0].homeTeam, "Çaykur Rizespor");
  assert.deepEqual(merged[0].score, { home: 1, away: 0 });

  // Kontrollü eşleşme: aynı gün oynanan FARKLI bir maç yanlışlıkla
  // birleşmemeli (yalnızca benzer isim yeterli değil).
  const distinct = client.mergeMatchCollections([
    { homeTeam: "Galatasaray", awayTeam: "Fenerbahçe", kickoff: "2026-09-07T20:00:00+03:00" },
    { homeTeam: "Beşiktaş", awayTeam: "Trabzonspor", kickoff: "2026-09-07T20:00:00+03:00" }
  ], []);
  assert.equal(distinct.length, 2, "farklı maçlar yalnızca aynı gün oynandığı için birleşmemeli");

  console.log("  ok  app.js istemci birleştirmesi de kulüp adı takma eşleşmesini uyguluyor");
}

console.log("fixture-dedupe OK (8 bölüm)");
