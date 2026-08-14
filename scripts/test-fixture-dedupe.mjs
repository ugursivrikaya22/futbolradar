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
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { curatedMatches } = require("../services/providers/mockProvider.js");
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
{
  const genclerbirligi = all.find((match) =>
    sameClub(match.homeTeam, "Gençlerbirliği") && sameClub(match.awayTeam, "Fenerbahçe"));
  assert.ok(genclerbirligi, "Gençlerbirliği - Fenerbahçe maçı listede olmalı");
  const venue = genclerbirligi.venue || "";
  assert.equal(venue, "Eryaman Stadyumu",
    `doğrulanmış stat adı sağlayıcı yazımıyla ezilmiş: ${venue}`);
  console.log(`  ok  stat adı korundu: ${venue}`);
}

// ── 4. LİG MAÇINDA SAHA BOŞ KALMAZ ────────────────────────────────────────
//
// Sağlayıcı bazı lig maçlarını `venue: null` gönderiyor. Lig maçında ev
// sahibi kendi stadında oynar ve o stat fikstür dosyasında doğrulanmış;
// alan boş bırakılmak yerine oradan doldurulur. Hazırlık maçlarına
// UYGULANMAZ — kural orada yanlış sonuç veriyordu (yurt dışı kampı).
{
  const kasimpasa = all.find((match) =>
    sameClub(match.homeTeam, "Kasımpaşa") && sameClub(match.awayTeam, "Trabzonspor")
    && matchDate(match) === "2026-08-15");
  assert.ok(kasimpasa, "Kasımpaşa - Trabzonspor maçı listede olmalı");
  assert.equal(kasimpasa.venue, "Recep Tayyip Erdoğan Stadyumu",
    `lig maçında saha doldurulmamış: ${JSON.stringify(kasimpasa.venue)}`);
  assert.equal(kasimpasa.venueSource, "club-home-ground",
    "türetilmiş saha, kaynağı belli olacak şekilde işaretlenmeli");

  const friendly = all.find((match) =>
    match.league !== "Süper Lig" && match.venueSource === "club-home-ground");
  assert.equal(friendly, undefined,
    `kural lig dışına sızmış: ${friendly && `${friendly.homeTeam} - ${friendly.awayTeam}`}`);
  console.log(`  ok  saha ev sahibinin stadından dolduruldu: ${kasimpasa.venue}`);
}

console.log("fixture-dedupe OK (4 bölüm)");
