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

console.log("fixture-dedupe OK (5 bölüm)");
