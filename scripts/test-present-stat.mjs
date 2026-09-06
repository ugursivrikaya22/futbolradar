/**
 * presentStat() TESTLERİ — "SIFIR UYDURMA" KAPISI.
 *
 * Oyuncu/takım/maç sayfalarında eksik bir istatistik (şut, xG, pas isabeti
 * gibi) 0 olarak basılıyordu: sağlayıcı hiç veri göndermediğinde de kutu
 * "0" yazıyordu, tıpkı gerçekten 0 çekmiş bir oyuncu gibi. presentStat() bu
 * ayrımı tek bir yerde çözer: eksik/geçersiz değer için null (çağıran satırı
 * hiç çizmez), sağlayıcı gerçekten 0 gönderdiyse "0" döner.
 *
 * app.js ve app-compare.js aynı fonksiyonu birebir taşıyor (tarayıcı
 * paketleri ayrı, ortak modül yok); bu test ikisinin de aynı sözleşmeyi
 * uyguladığını doğrular — biri güncellenip diğeri unutulursa burada patlar.
 */

import assert from "node:assert/strict";
import fs from "node:fs";

function extractFunction(source, name, fileLabel) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.ok(start > -1, `${fileLabel}: ${name} tanımlı olmalı`);

  // Fonksiyon gövdesini basit brace-sayımıyla bul; iç içe fonksiyon
  // ifadeleri (presentStat'ta yok) sorun çıkarmaz.
  let depth = 0;
  let bodyStart = -1;
  let end = -1;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") {
      if (depth === 0) bodyStart = i;
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0 && bodyStart !== -1) {
        end = i + 1;
        break;
      }
    }
  }
  assert.ok(end > -1, `${fileLabel}: ${name} gövdesi kapanmıyor`);

  const src = source.slice(start, end);
  return new Function(`return ${src}`)();
}

function loadPresentStat(filePath, fileLabel) {
  const source = fs.readFileSync(new URL(filePath, import.meta.url), "utf8");
  return extractFunction(source, "presentStat", fileLabel);
}

function testHidesMissingValues(presentStat, fileLabel) {
  assert.equal(presentStat(null), null, `${fileLabel}: null gizlenmeli`);
  assert.equal(presentStat(undefined), null, `${fileLabel}: undefined gizlenmeli`);
  assert.equal(presentStat(""), null, `${fileLabel}: boş string gizlenmeli`);
  assert.equal(presentStat(NaN), null, `${fileLabel}: NaN gizlenmeli`);
  assert.equal(presentStat("veri yok"), null, `${fileLabel}: sayıya çevrilemeyen metin gizlenmeli`);
}

function testShowsRealValues(presentStat, fileLabel) {
  assert.equal(presentStat(0), "0", `${fileLabel}: gerçek 0 basılmalı`);
  assert.equal(presentStat(6), "6", `${fileLabel}: gerçek 6 basılmalı`);
  assert.equal(presentStat("6"), "6", `${fileLabel}: string olarak gelen sayı da basılmalı`);
  assert.equal(presentStat(2.5), "2.5", `${fileLabel}: ondalıklı gerçek değer basılmalı`);
}

const targets = [
  { path: "../app.js", label: "app.js" },
  { path: "../app-compare.js", label: "app-compare.js" }
];

for (const target of targets) {
  const presentStat = loadPresentStat(target.path, target.label);
  testHidesMissingValues(presentStat, target.label);
  testShowsRealValues(presentStat, target.label);
}

console.log("presentStat tests passed (app.js + app-compare.js: null gizlenir, 0 ve 6 basılır).");
