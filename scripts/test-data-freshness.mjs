/**
 * VERİ TAZELİĞİ TESTLERİ.
 *
 * Bu testler bu depodaki en tehlikeli hata sınıfını korur: sağlayıcı
 * çökmüşken eski bir skorun CANLIYMIŞ GİBİ gösterilmesi. Yanlış veri değil,
 * yanlış iddia — ve okuyucu için ikisi arasında fark yok.
 *
 * `providerCache` kotayı dolduran sağlayıcı için son başarılı yanıtı servis
 * ediyor (doğru davranış), ama o işaret `apiFootballProvider` içinde
 * düşüyordu ve API yanıtı bayatlığı hiç bildirmiyordu.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { MAX_AGE_MS, assessFreshness } = require("../services/dataFreshness.js");

const NOW = Date.parse("2026-08-12T12:00:00Z");
const at = (offsetMinutes) => new Date(NOW + offsetMinutes * 60000).toISOString();

// ── 1. Kaydın kendi `staleAfter` alanı esastır ─────────────────────────────

{
  const expired = assessFreshness(
    [{ fetchedAt: at(-30), staleAfter: at(-25) }],
    { resource: "matches-live", now: NOW }
  );
  assert.equal(expired.stale, true, "geçerlilik penceresi dolmuş yanıt bayat olmalı");
  assert.equal(expired.staleSince, at(-25), "bayatlığın başladığı an bildirilmeli");

  const valid = assessFreshness(
    [{ fetchedAt: at(-30), staleAfter: at(30) }],
    { resource: "matches-live", now: NOW }
  );
  assert.equal(valid.stale, false, "penceresi süren yanıt bayat sayılmamalı");
  assert.equal(valid.staleSince, null, "bayat olmayan yanıtta başlangıç anı olmamalı");
}

// ── 2. `staleAfter` yoksa kaynak ömrü uygulanır ────────────────────────────

{
  const live = assessFreshness([{ fetchedAt: at(-10) }], { resource: "matches-live", now: NOW });
  assert.equal(live.stale, true, "on dakikalık canlı skor bayat olmalı");

  // Aynı kayıt, kadro verisi olarak bakıldığında taze: bir maçın 72. dakikası
  // beş dakika eskiyse yanlıştır, bir kadro beş saat eskiyse değildir.
  const squad = assessFreshness([{ fetchedAt: at(-10) }], { resource: "teams", now: NOW });
  assert.equal(squad.stale, false, "kaynak ömrü veri tipine göre değişmeli");
  assert.ok(MAX_AGE_MS["matches-live"] < MAX_AGE_MS.teams, "canlı ömür kadro ömründen kısa olmalı");
}

// ── 3. BİLİNMEYEN YAŞ, BAYATLIK İDDİASI DEĞİLDİR ───────────────────────────

{
  const unknown = assessFreshness([{ id: "x" }, { id: "y" }], { resource: "matches-live", now: NOW });
  assert.equal(unknown.stale, false, "zaman damgası olmayan kayıt bayat sayılmamalı");
  assert.equal(unknown.ageMs, null, "bilinmeyen yaş için sayı uydurulmamalı");
  assert.equal(unknown.sampled, 0, "örneklenen kayıt sayısı dürüst bildirilmeli");
  assert.equal(unknown.total, 2, "toplam kayıt sayısı bildirilmeli");

  assert.equal(assessFreshness([], { now: NOW }).stale, false, "boş yanıt bayat sayılmamalı");
  assert.equal(assessFreshness(null, { now: NOW }).stale, false, "bozuk girdi çökmemeli");
}

// ── 4. Karar EN TAZE kayda göre verilir ────────────────────────────────────
//
// Karışık yaşlı liste normaldir: dün oynanmış bir maçın kaydı bugün
// tazelenmez. Bayatlık ancak HİÇBİR kayıt yakın zamanda tazelenmediğinde
// vardır — o zaman tazeleme durmuş demektir.

{
  const mixed = assessFreshness(
    [{ fetchedAt: at(-6000) }, { fetchedAt: at(-1) }],
    { resource: "matches-live", now: NOW }
  );
  assert.equal(mixed.stale, false, "listede taze kayıt varsa yanıt bayat sayılmamalı");
  assert.ok(mixed.ageMs < 2 * 60 * 1000, "yaş en taze kayda göre hesaplanmalı");

  const allOld = assessFreshness(
    [{ fetchedAt: at(-6000) }, { fetchedAt: at(-5000) }],
    { resource: "matches-live", now: NOW }
  );
  assert.equal(allOld.stale, true, "hiçbir kayıt tazelenmemişse yanıt bayat olmalı");
}

// ── 5. Yedek zaman alanları ────────────────────────────────────────────────

{
  for (const field of ["lastSuccessfulSyncAt", "lastVerifiedAt", "updatedAt"]) {
    const record = { [field]: at(-1) };
    assert.equal(
      assessFreshness([record], { resource: "matches-live", now: NOW }).stale,
      false,
      `${field} alanı da tazelik kanıtı sayılmalı`
    );
  }

  // Okunamayan tarih yok sayılır, "şimdi" varsayılmaz.
  const broken = assessFreshness([{ fetchedAt: "bozuk-tarih" }], { resource: "matches-live", now: NOW });
  assert.equal(broken.sampled, 0, "okunamayan tarih örnek sayılmamalı");
  assert.equal(broken.stale, false, "okunamayan tarih bayatlık iddiası doğurmamalı");
}

// ── 6. GERÇEK DEPO ─────────────────────────────────────────────────────────

{
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const file = path.join(process.cwd(), "data", "fixture-calendar.json");
  const matches = JSON.parse(readFileSync(file, "utf8")).matches || [];

  const verdict = assessFreshness(matches, { resource: "matches" });
  assert.ok(verdict.sampled > 0, "depodaki kayıtların zaman damgası okunabilmeli");
  assert.equal(typeof verdict.stale, "boolean", "karar kesin olmalı");
  assert.equal(typeof verdict.checkedAt, "string", "değerlendirme anı bildirilmeli");
}

console.log("Veri tazeliği testleri geçti (staleAfter önceliği, kaynak ömrü, bilinmeyen yaş, en taze kayda göre karar).");
