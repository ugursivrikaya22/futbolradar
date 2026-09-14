#!/usr/bin/env node
/**
 * YAYIN KANALI ÇÖZÜMLEME TESTLERİ.
 *
 * Bu testin var oluş nedeni somut: `/mac/konyaspor-trabzonspor-12-eylul-2026`
 * sayfasının başlığı "…Hangi Kanalda?" diye soruyor, gövdesinde ise "Yayın
 * kanalı: Henüz açıklanmadı" yazıyordu. Okuyucu aramadan o vaatle gelip
 * cevabı bulamayınca geri dönüyor.
 *
 * Çözüm dört katmanlı bir sıra — ve KORUNMASI GEREKEN ŞEY SIRANIN KENDİSİ.
 * Katmanlar yer değiştirirse hata sessiz olur: sayfa yine bir kanal
 * gösterir, ama yanlışını. En tehlikelisi lig varsayılanının maça özel
 * kaydı ezmesi olurdu.
 *
 * İkinci koruma: lig varsayılanı "kaynağını saklamamalı". Sayfada
 * "Lig yayın hakkına göre; kanal değişikliği olabilir" notuyla çıkıyor;
 * `source: "league"` o notun tek tetikleyicisi. Kaynak etiketi kaybolursa
 * site, genel bir bilgiyi o maça özel doğrulanmış bilgiymiş gibi gösterir —
 * deponun "tahmin yazmıyoruz" ilkesinin ihlali.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const { resolveBroadcast, resolveBroadcastWith, broadcastChannel } = require("../services/broadcastSchedule.js");

console.log("yayin-kanallari");

const failures = [];
function check(name, run) {
  try {
    run();
    console.log("  ok ", name);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    console.log("  FAIL", name);
  }
}

/** Konyaspor - Trabzonspor, 12 Eylül 2026 — görevin çıkış noktası. */
const match = Object.freeze({
  homeTeam: "Konyaspor",
  awayTeam: "Trabzonspor",
  kickoff: "2026-09-12T20:00:00+03:00",
  league: "Süper Lig"
});

const mapping = Object.freeze({
  varsayilan: { "Süper Lig": ["LIG KANALI"] },
  maclar: { "konyaspor-trabzonspor-12-eylul-2026": ["MAC KANALI"] }
});

check("1) maça özel kayıt sağlayıcıyı da lig varsayılanını da ezer", () => {
  const resolved = resolveBroadcastWith({ ...match, broadcast: { turkey: "SAGLAYICI" } }, mapping);
  assert.equal(resolved.channel, "MAC KANALI");
  assert.equal(resolved.source, "match");
});

check("2) maça özel kayıt yoksa sağlayıcı lig varsayılanını ezer", () => {
  const resolved = resolveBroadcastWith({ ...match, homeTeam: "Göztepe", broadcast: { turkey: "SAGLAYICI" } }, mapping);
  assert.equal(resolved.channel, "SAGLAYICI");
  assert.equal(resolved.source, "provider");
});

check("3) ikisi de yoksa lig varsayılanı devreye girer ve kaynağını söyler", () => {
  const resolved = resolveBroadcastWith({ ...match, homeTeam: "Göztepe" }, mapping);
  assert.equal(resolved.channel, "LIG KANALI");
  assert.equal(resolved.source, "league", "not yalnızca bu etikete bakarak basılıyor");
});

check("4) hiçbiri yoksa kanal uydurulmaz", () => {
  const resolved = resolveBroadcastWith({ ...match, homeTeam: "Aberdeen", awayTeam: "Rangers", league: "Scottish Premiership" }, mapping);
  assert.equal(resolved.channel, "");
  assert.equal(resolved.source, "");
});

check("5) tek ad da liste de kabul edilir", () => {
  const single = resolveBroadcastWith({ ...match, homeTeam: "Göztepe" }, { varsayilan: { "Süper Lig": "TEK KANAL" }, maclar: {} });
  assert.deepEqual(single.channels, ["TEK KANAL"]);
  const many = resolveBroadcastWith({ ...match, homeTeam: "Göztepe" }, { varsayilan: { "Süper Lig": ["A", "B"] }, maclar: {} });
  assert.equal(many.channel, "A, B");
});

check("6) kesin kanal (`broadcastChannel`) lig varsayılanını TAŞIMAZ", () => {
  // Notu gösteremeyen yüzeyler ve JSON-LD `BroadcastEvent` bu fonksiyonu
  // okuyor; oraya notsuz bir lig varsayılanı düşerse kesin bilgi gibi okunur.
  assert.equal(broadcastChannel({ ...match, homeTeam: "Göztepe" }), "");
  assert.equal(broadcastChannel({ ...match, homeTeam: "Göztepe", broadcast: { turkey: "SAGLAYICI" } }), "SAGLAYICI");
});

check("7) data/yayin-kanallari.json geçerli ve beklenen şekilde", () => {
  const file = path.join(root, "data", "yayin-kanallari.json");
  assert.ok(fs.existsSync(file), "eşleme dosyası bulunmalı");
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const key of ["varsayilan", "maclar"]) {
    assert.ok(parsed[key] && typeof parsed[key] === "object" && !Array.isArray(parsed[key]), `${key} bir nesne olmalı`);
  }
  // Kanal adı uydurulmaz: dosyadaki her değer ya dize ya dize listesi.
  for (const [key, value] of [...Object.entries(parsed.varsayilan), ...Object.entries(parsed.maclar)]) {
    const list = Array.isArray(value) ? value : [value];
    assert.ok(list.length > 0, `${key}: boş kayıt yazılmaz, kayıt hiç açılmaz`);
    for (const channel of list) {
      assert.equal(typeof channel, "string", `${key}: kanal adı dize olmalı`);
      assert.ok(channel.trim().length > 0, `${key}: boş kanal adı`);
    }
  }
});

check("8) depodaki eşleme boşken davranış eskisiyle birebir aynı", () => {
  // İskelet boş: bu değişiklik hiçbir sayfada yeni bir kanal göstermiyor.
  // Kanal adlarını dosyaya elle giren kişi ne yazarsa o çıkar.
  assert.equal(resolveBroadcast(match).source, "");
  assert.equal(resolveBroadcast({ ...match, broadcast: { turkey: "SAGLAYICI" } }).source, "provider");
});

if (failures.length) {
  console.error(`\nyayin-kanallari FAILED (${failures.length}):`);
  for (const line of failures) console.error(`  - ${line}`);
  process.exit(1);
}
console.log("yayin-kanallari OK");
