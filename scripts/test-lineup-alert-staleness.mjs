#!/usr/bin/env node
/**
 * RESMÎ İLK 11 KARTININ SÜRE KAPISI.
 *
 * Kapı iki üreticinin (Türkçe prerender-core-pages.mjs, İngilizce
 * generate-en-pages.mjs) ortak eşiğine bağlı ve hiçbir test onu tutmuyordu.
 * Eşik sessizce değişirse ya da bir üretici yeniden kendi kopyasını yazarsa
 * kart bir dilde kalkıp öbüründe kalır — okuyucuya maç bittikten sonra
 * "SON DAKİKA" rozetli ilk 11 göstermek tam da kaçınılan şeydi.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { LINEUP_ALERT_STALE_MS, isLineupAlertStale } from "./lib/matchCards.mjs";

const root = process.cwd();
const KICKOFF = "2026-09-14T20:00:00+03:00";
const kickoffMs = Date.parse(KICKOFF);
const at = (isoLocal) => Date.parse(isoLocal);

assert.equal(
  LINEUP_ALERT_STALE_MS,
  (2 * 60 + 15) * 60 * 1000,
  "eşik 2 saat 15 dakika olmalı (uzatmalı bir maçı kapsar, bitişten sonra kartı taşımaz)"
);

// Maç sürerken kart durur.
assert.equal(isLineupAlertStale({ kickoff: KICKOFF }, kickoffMs), false, "başlama anında kart basılmalı");
assert.equal(
  isLineupAlertStale({ kickoff: KICKOFF }, at("2026-09-14T21:55:00+03:00")),
  false,
  "90+uzatma sürerken (1 sa 55 dk) kart basılmalı"
);
assert.equal(
  isLineupAlertStale({ kickoff: KICKOFF }, at("2026-09-14T22:14:00+03:00")),
  false,
  "eşiğin bir dakika altında kart hâlâ basılmalı"
);

// Eşik dolunca düşer.
assert.equal(
  isLineupAlertStale({ kickoff: KICKOFF }, at("2026-09-14T22:16:00+03:00")),
  true,
  "eşiği geçince kart düşmeli"
);
assert.equal(
  isLineupAlertStale({ kickoff: KICKOFF }, at("2026-09-15T10:00:00+03:00")),
  true,
  "ertesi gün kart kesinlikle düşmüş olmalı"
);

// Tarihi okunamayan kayıt DÜŞÜRÜLMEZ: kaynağı olan kartı ayrıştırma
// hatası yüzünden gizlemek, süresi geçmiş kartı göstermekten farklı bir hata.
assert.equal(isLineupAlertStale({ kickoff: "" }, Date.now()), false, "boş kickoff kartı düşürmemeli");
assert.equal(isLineupAlertStale({}, Date.now()), false, "kickoff alanı olmayan kayıt düşürülmemeli");
assert.equal(isLineupAlertStale(null, Date.now()), false, "kayıt yoksa kapı hata vermemeli");

// İki üretici de kendi kopyasını yazmamalı; eşik tek yerde kalmalı.
for (const file of ["scripts/prerender-core-pages.mjs", "scripts/generate-en-pages.mjs"]) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  assert.ok(
    source.includes("isLineupAlertStale"),
    `${file} süre kapısını ortak yardımcıdan almalı`
  );
  assert.ok(
    !/const\s+LINEUP_ALERT_STALE_MS\s*=/.test(source),
    `${file} eşiğin kendi kopyasını tanımlamamalı (ortak değer scripts/lib/matchCards.mjs'de)`
  );
}

// Depodaki gerçek kayıtlar kapıdan geçebiliyor olmalı (alan adı değişirse yakalanır).
const records = JSON.parse(
  fs.readFileSync(path.join(root, "data", "official-lineup-alerts.json"), "utf8")
).records || [];
assert.ok(records.length > 0, "en az bir resmî ilk 11 kaydı olmalı");
for (const record of records) {
  assert.ok(
    Number.isFinite(Date.parse(record.kickoff || "")),
    `${record.id}: kickoff ayrıştırılabilir olmalı, yoksa süre kapısı hiç çalışmaz`
  );
  const playedLongAgo = Date.parse(record.kickoff) + LINEUP_ALERT_STALE_MS;
  assert.equal(
    isLineupAlertStale(record, playedLongAgo + 1),
    true,
    `${record.id}: eşik sonrası kayıt düşmeli`
  );
}

console.log(
  `lineup-alert-staleness OK (eşik ${LINEUP_ALERT_STALE_MS / 60000} dk, iki üretici de ortak kapıyı kullanıyor, ${records.length} kayıt denetlendi)`
);
