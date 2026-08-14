#!/usr/bin/env node
/**
 * RAPOR OLAY OKUMA — SÖZLEŞME DENETİMİ.
 *
 * Maç olayları siteye İKİ FARKLI BİÇİMDE giriyor ve ikisi aynı alanları
 * aynı anlamda kullanmıyor:
 *
 *   • KÜRASYONLU kayıt — `type: "Gol"`, `detail`: Türkçe cümle
 *     ("Anderson Talisca serbest vuruştan skoru 1-0 yaptı.")
 *   • SAĞLAYICI kaydı — `type: "Goal"`, `detail: "Normal Goal"`,
 *     oyuncu `value` alanında ("V. Osimhen · Asist: L. Torreira · Normal Goal")
 *
 * Rapor servisi yalnızca birinciyi biliyordu. Sonuç canlıda 167 sayfada
 * görünüyordu: golcü adı yerine "Normal Goal" yazıyordu ve sağlayıcıdan
 * gelen kırmızı kartlar kırılma anları listesine hiç girmiyordu.
 *
 * Bu test iki biçimi de sıkıştırıyor.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildMatchReport } = require("../services/matchReportService.js");

console.log("report-events");

/** Sağlayıcı biçiminde bir maç: alanlar apiFootballProvider'ın yazdığı gibi. */
const providerMatch = {
  id: "test-provider",
  homeTeam: "Galatasaray",
  awayTeam: "Çorum FK",
  league: "Süper Lig",
  venue: "Rams Park",
  kickoff: "2026-08-14T21:30:00+03:00",
  status: "FINISHED",
  providerStatus: "FT",
  score: { home: 2, away: 2, halftimeHome: null, halftimeAway: null },
  events: [
    { time: "32'", team: { name: "Galatasaray" }, type: "Card", detail: "Yellow Card", value: "Y. Akgun · Yellow Card" },
    { time: "54'", team: { name: "Galatasaray" }, type: "Goal", detail: "Normal Goal", value: "V. Osimhen · Asist: L. Torreira · Normal Goal" },
    { time: "59'", team: { name: "Çorum FK" }, type: "Goal", detail: "Normal Goal", value: "A. Kyziridis · Asist: Fredy · Normal Goal" },
    { time: "70'", team: { name: "Çorum FK" }, type: "Card", detail: "Red Card", value: "A. Kyziridis · Red Card" },
    { time: "90'", team: { name: "Galatasaray" }, type: "Goal", detail: "Normal Goal", value: "V. Osimhen · Asist: Gabriel Sara · Normal Goal" }
  ],
  statistics: []
};

/** Kürasyonlu biçim: eski kayıtlar böyle ve bozulmamalı. */
const curatedMatch = {
  ...providerMatch,
  id: "test-curated",
  events: [
    { time: "37'", team: { name: "Galatasaray" }, type: "Gol", detail: "Victor Osimhen ceza sahasından skoru 1-0 yaptı." },
    { time: "70'", team: { name: "Çorum FK" }, type: "Kırmızı kart", detail: "Alexandros Kyziridis ikinci sarıdan kırmızı kart gördü." }
  ]
};

// ── 1. GOLCÜ ADI OLAYIN TÜRÜ DEĞİLDİR ─────────────────────────────────────
//
// Kırmızı çizgi: sayfada "Normal Goal" adında bir oyuncu görünemez.
{
  const report = buildMatchReport(providerMatch);
  const text = JSON.stringify(report);

  assert.ok(!/Normal Goal/.test(text), "raporda ham \"Normal Goal\" metni kalmamalı");
  assert.ok(!/Red Card|Yellow Card/.test(text), "raporda ham İngilizce kart etiketi kalmamalı");
  assert.match(text, /Osimhen/, "golcü adı raporda geçmeli");
}

// ── 2. ÖZET CÜMLESİ GERÇEK GOLCÜYÜ ANAR ───────────────────────────────────
{
  const report = buildMatchReport(providerMatch);
  const summary = report.sections.summary || {};
  assert.equal(summary.status, "ready");
  assert.match(summary.paragraph, /Osimhen/, `özet golcüyü anmalı: ${summary.paragraph}`);
  assert.match(summary.paragraph, /54\. dakikada/, "gol dakikası özete girmeli");
  assert.ok(!/doğrulanmadı/.test(summary.paragraph),
    "goller okunabiliyorken 'doğrulanmadı' denmemeli");
}

// ── 3. SAĞLAYICIDAN GELEN KIRMIZI KART KIRILMA ANIDIR ─────────────────────
//
// Ağırlık yalnızca Türkçe "kırmızı" terimine bakıyordu; "Red Card" 10 puan
// yerine 1 puan alıp listeden eleniyordu.
{
  const report = buildMatchReport(providerMatch);
  const points = report.sections.turningPoints || {};
  assert.equal(points.status, "ready", "kırılma anları üretilmeli");

  const labels = (points.moments || []).map((row) => `${row.minute} ${row.type} ${row.detail}`);
  assert.ok(labels.some((row) => /Kırmızı kart/.test(row)),
    `kırmızı kart kırılma anlarında olmalı: ${labels.join(" | ")}`);
  assert.ok(labels.some((row) => /70'/.test(row)), "kırmızı kart dakikası doğru olmalı");
  assert.ok(labels.some((row) => /Gol/.test(row) && /Osimhen/.test(row)),
    `gol satırı golcüyü göstermeli: ${labels.join(" | ")}`);

  // Etiketler TÜRKÇE: sayfa Türkçe ve okuyucu "Goal · Normal Goal" görmemeli.
  for (const moment of points.moments || []) {
    assert.ok(!/^(Goal|Card|subst)$/i.test(moment.type), `çevrilmemiş tür: ${moment.type}`);
  }
}

// ── 4. KÜRASYONLU BİÇİM BOZULMADI ─────────────────────────────────────────
{
  const report = buildMatchReport(curatedMatch);
  const text = JSON.stringify(report);
  assert.match(text, /Victor Osimhen/, "kürasyonlu cümleden ad hâlâ okunmalı");

  const labels = (report.sections.turningPoints.moments || []).map((row) => `${row.type} ${row.detail}`);
  assert.ok(labels.some((row) => /Kırmızı kart/.test(row)), "kürasyonlu kırmızı kart korunmalı");
}

// ── 5. OYUNCU ADI ÇIKARILAMIYORSA UYDURULMAZ ──────────────────────────────
{
  const anonymous = {
    ...providerMatch,
    id: "test-anonymous",
    events: [{ time: "12'", team: { name: "Galatasaray" }, type: "Goal", detail: "Normal Goal", value: "" }]
  };
  const report = buildMatchReport(anonymous);
  const text = JSON.stringify(report);
  assert.ok(!/Normal Goal/.test(text), "ad yoksa olay türü ad yerine geçmemeli");
  // Golcüsüz cümle kurulmalı: takım anılır, isim uydurulmaz.
  assert.match(report.sections.summary.paragraph, /Galatasaray/);
}

console.log("report-events OK (5 bölüm)");
