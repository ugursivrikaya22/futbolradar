/**
 * TRANSFER PENCERESİ TESTLERİ.
 *
 * Transfer Radarı bandı yalnızca gerçek TFF tescil dönemi içinde
 * görünmeli; kural TEK dosyada (data/transfer-window.json) yaşamalı,
 * koda tarih gömülmemeli.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const { activeTransferWindow, isTransferWindowOpen } = require("../services/transferWindow.js");

const windows = [
  { id: "yaz", label: "Yaz", opensAt: "2026-06-22T00:00:00+03:00", closesAt: "2026-09-04T23:59:59+03:00" },
  { id: "ara", label: "Ara", opensAt: "2027-01-01T00:00:00+03:00", closesAt: "2027-02-05T23:59:59+03:00" }
];

// ── 1. Pencere içinde: açık ────────────────────────────────────────────────

{
  const now = Date.parse("2026-08-17T12:00:00+03:00");
  assert.equal(isTransferWindowOpen({ windows, now }), true, "yaz penceresi içindeki bir tarih açık sayılmalı");
  assert.equal(activeTransferWindow({ windows, now }).id, "yaz");
}

// ── 2. İki pencere arası: kapalı ────────────────────────────────────────────

{
  const now = Date.parse("2026-10-01T12:00:00+03:00");
  assert.equal(isTransferWindowOpen({ windows, now }), false, "iki pencere arasındaki tarih kapalı sayılmalı");
  assert.equal(activeTransferWindow({ windows, now }), null);
}

// ── 3. Sınırlar dahil ────────────────────────────────────────────────────

{
  const opens = Date.parse("2026-06-22T00:00:00+03:00");
  const closes = Date.parse("2026-09-04T23:59:59+03:00");
  assert.equal(isTransferWindowOpen({ windows, now: opens }), true, "açılış anı açık sayılmalı");
  assert.equal(isTransferWindowOpen({ windows, now: closes }), true, "kapanış anı hâlâ açık sayılmalı");
  assert.equal(isTransferWindowOpen({ windows, now: closes + 1000 }), false, "kapanıştan bir saniye sonrası kapalı sayılmalı");
}

// ── 4. Bozuk/eksik veri: uydurma yok, kapalı sayılır ────────────────────────

{
  assert.equal(isTransferWindowOpen({ windows: [], now: Date.now() }), false, "hiç pencere yoksa kapalı sayılmalı");
  assert.equal(
    isTransferWindowOpen({ windows: [{ id: "bozuk", opensAt: "geçersiz", closesAt: "geçersiz" }], now: Date.now() }),
    false,
    "geçersiz tarihli kayıt açık sayılmamalı"
  );
}

console.log("Transfer penceresi testleri geçti (açık/kapalı/sınır/bozuk veri).");

// ── 5. GERÇEK YAPILANDIRMA: dosya var, biçimi geçerli ───────────────────────

{
  const configPath = path.join(root, "data", "transfer-window.json");
  const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
  assert.ok(Array.isArray(raw.windows) && raw.windows.length > 0, "data/transfer-window.json en az bir pencere taşımalı");
  for (const entry of raw.windows) {
    assert.ok(entry.id && entry.label, `${entry.id || "?"}: id ve label zorunlu`);
    assert.ok(Number.isFinite(Date.parse(entry.opensAt)), `${entry.id}: opensAt geçerli bir tarih olmalı`);
    assert.ok(Number.isFinite(Date.parse(entry.closesAt)), `${entry.id}: closesAt geçerli bir tarih olmalı`);
    assert.ok(Date.parse(entry.opensAt) < Date.parse(entry.closesAt), `${entry.id}: açılış kapanıştan önce olmalı`);
  }

  // public/ aynası senkron kalmalı — iki kopya birbirinden sürüklenmemeli.
  const publicPath = path.join(root, "public", "data", "transfer-window.json");
  if (fs.existsSync(publicPath)) {
    assert.deepEqual(
      JSON.parse(fs.readFileSync(publicPath, "utf8")),
      raw,
      "public/data/transfer-window.json kök kopyayla aynı olmalı"
    );
  }

  console.log(`Gerçek transfer penceresi yapılandırması geçerli (${raw.windows.length} pencere).`);
}
