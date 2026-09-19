#!/usr/bin/env node
/**
 * KADRO VE DİZİLİŞ TESTLERİ — `/mac/<slug>` saha görseli.
 *
 * Saha görseli bir VERİ İDDİASIDIR: oyuncuyu bir hatta koyduğumuz anda
 * "bu takım şu dizilişle çıktı" demiş oluyoruz. Bu yüzden buradaki
 * denetimlerin çoğu çizilen şeyi değil, ÇİZİLMEYEN şeyi koruyor:
 *
 *   • koordinatı da geçerli dizilişi de olmayan kadro sahaya konmaz,
 *   • forma numarası uydurulmaz,
 *   • yedek listesi yokken boş bir kutu değil, dürüst bir not basılır,
 *   • maç başladıktan sonra "muhtemel" 11 hiç gösterilmez.
 *
 * Satır üretimi `services/matchHub.js#formationRows` ile ortak; bu dosya
 * o kuralın maç sayfasındaki KARŞILIĞINI sınar.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { lineupsSectionHtml } from "./lib/matchSeoPage.mjs";

const require = createRequire(import.meta.url);
const matchHub = require("../services/matchHub.js");

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${error.message}`);
  }
}

console.log("match-lineup-pitch");

const ctx = (extra = {}) => ({
  locale: "tr",
  base: "../",
  playerIndex: null,
  homeTeam: "Fenerbahçe",
  awayTeam: "Beşiktaş",
  state: "post",
  ...extra
});

const NAMES = ["Mert", "Aké", "Oosterwolde", "Semedo", "Škriniar", "Guendouzi", "Fred", "Kerem", "İrfan", "Bartuğ", "Talisca"];
const GRIDS = ["1:1", "2:1", "2:2", "2:3", "2:4", "3:1", "3:2", "4:1", "4:2", "4:3", "5:1"];

function griddedSide(team = "Fenerbahçe") {
  return {
    team,
    formation: "4-2-3-1",
    players: NAMES.slice(),
    startingDetails: NAMES.map((name, index) => ({ name, number: index + 1, position: null, grid: GRIDS[index] })),
    substitutes: ["Levent", "Oğuz"],
    substituteDetails: [{ name: "Levent", number: 21, position: null, grid: null }, { name: "Oğuz", number: 17, position: null, grid: null }]
  };
}

function plainSide(team = "Beşiktaş", formation = "4-3-3") {
  return { team, formation, players: "abcdefghijk".split(""), substitutes: [] };
}

const rowSizes = (html) => [...html.matchAll(/msp-pitch-row[^"]*is-(\d)"/g)].map((match) => Number(match[1]));

/* ---------------------------------------------------------------- */
/* 1. SAHA ÇİZİLİYOR                                                  */
/* ---------------------------------------------------------------- */

test("sağlayıcı koordinatıyla saha çizilir; kaleci ALTTA, forvet ÜSTTE", () => {
  const html = lineupsSectionHtml({ lineups: [griddedSide(), plainSide()] }, null, ctx());
  assert.ok(html.includes("msp-pitch"), "saha görseli basılmalı");
  // Ev sahibi 4-2-3-1: ekranda üstten alta 1-3-2-4-1.
  assert.deepEqual(rowSizes(html).slice(0, 5), [1, 3, 2, 4, 1]);
});

test("koordinat yoksa diziliş metni + oyuncu sırası kullanılır", () => {
  const html = lineupsSectionHtml({ lineups: [plainSide("Fenerbahçe", "4-2-3-1"), plainSide()] }, null, ctx());
  // 4-2-3-1 → ekranda 1-3-2-4-1; 4-3-3 → 3-3-4-1.
  assert.deepEqual(rowSizes(html), [1, 3, 2, 4, 1, 3, 3, 4, 1]);
});

test("saha ve liste BİRLİKTE basılır: biri dizilişi, diğeri numara/bağlantıyı taşır", () => {
  const html = lineupsSectionHtml({ lineups: [griddedSide(), plainSide()] }, null, ctx());
  assert.equal((html.match(/<ol class="msp-lineup-list">/g) || []).length, 2);
  assert.ok(html.includes("msp-pitch"));
});

/* ---------------------------------------------------------------- */
/* 2. SAHA ÇİZİLMİYOR — asıl korunan kural                            */
/* ---------------------------------------------------------------- */

test("koordinat ve geçerli diziliş yoksa saha ÇİZİLMEZ, yalnızca liste kalır", () => {
  // Diziliş metni yok; koordinat da yok. Oyuncuları bir hatta yerleştirmek
  // doğrulanmamış bir taktik iddiası olurdu.
  const noShape = { team: "Fenerbahçe", formation: "", players: NAMES.slice(), substitutes: [] };
  const html = lineupsSectionHtml({ lineups: [noShape, { ...plainSide(), formation: "" }] }, null, ctx());
  assert.ok(!html.includes("msp-pitch"), "dayanaksız saha basılmamalı");
  assert.ok(html.includes("msp-lineup-list"), "liste yine de basılmalı");
});

test("toplamı 10'u tutmayan diziliş metni saha çizdirmez", () => {
  // "4-4-4" on saha oyuncusu etmiyor: sağlayıcı ya da editör yanlış yazmış.
  // Sessizce bir hat uydurmaktansa saha hiç çizilmez.
  assert.equal(matchHub.formationRows(NAMES.map((name) => ({ name })), "4-4-4"), null);
  const html = lineupsSectionHtml({ lineups: [{ team: "Fenerbahçe", formation: "4-4-4", players: NAMES.slice(), substitutes: [] }, plainSide()] }, null, ctx());
  assert.equal((html.match(/msp-pitch-row/g) || []).length, 4, "yalnızca geçerli dizilişi olan takımın sahası çizilmeli");
});

test("eksik kadroda (11'den az, koordinatsız) saha çizilmez", () => {
  const short = { team: "Fenerbahçe", formation: "4-2-3-1", players: NAMES.slice(0, 8), substitutes: [] };
  const html = lineupsSectionHtml({ lineups: [short, plainSide()] }, null, ctx());
  assert.equal((html.match(/msp-pitch-row/g) || []).length, 4, "yalnızca deplasman sahası çizilmeli");
});

/* ---------------------------------------------------------------- */
/* 3. NUMARA, BAĞLANTI, YEDEKLER                                      */
/* ---------------------------------------------------------------- */

test("forma numarası yalnızca kayıtlıysa basılır — uydurulmaz", () => {
  const withNumbers = lineupsSectionHtml({ lineups: [griddedSide(), plainSide()] }, null, ctx());
  assert.ok(withNumbers.includes('class="msp-lineup-no">1<'), "kayıtlı numara görünmeli");

  const withoutNumbers = lineupsSectionHtml({ lineups: [plainSide("Fenerbahçe"), plainSide()] }, null, ctx());
  assert.ok(!withoutNumbers.includes("msp-lineup-no"), "numara yoksa rozet hiç basılmamalı");
});

test("yedek kulübesi AYRI blokta; liste yoksa dürüst not", () => {
  const html = lineupsSectionHtml({ lineups: [griddedSide(), plainSide()] }, null, ctx());
  assert.ok(html.includes("msp-lineup-bench-list"), "yedekler kendi listesinde olmalı");
  assert.ok(html.includes("Levent") && html.includes("Oğuz"));
  assert.ok(html.includes("Yedek listesi yayımlanmadı"), "yedeği olmayan takımda boş kutu değil, not");
});

test("yedek alanı iki adla da gelir: sağlayıcı `substitutes`, depo `bench`", () => {
  const benchNamed = { team: "Fenerbahçe", formation: "4-2-3-1", players: NAMES.slice(), bench: ["Yedek Bir"] };
  const html = lineupsSectionHtml({ lineups: [benchNamed, plainSide()] }, null, ctx());
  assert.ok(html.includes("Yedek Bir"), "`bench` alanı da okunmalı");
});

test("oyuncu sayfası varsa ad bağlantı olur, yoksa düz metin kalır", () => {
  const index = { find: (name) => (name === "Talisca" ? { id: "talisca" } : null) };
  const html = lineupsSectionHtml({ lineups: [griddedSide(), plainSide()] }, null, ctx({ playerIndex: index }));
  assert.ok(/<a href="[^"]*talisca[^"]*">Talisca<\/a>/.test(html), "profili olan oyuncu bağlantılı olmalı");
  assert.ok(html.includes(">Mert<"), "profili olmayan oyuncu düz metin kalmalı");
});

/* ---------------------------------------------------------------- */
/* 4. DURUMA GÖRE DAVRANIŞ                                            */
/* ---------------------------------------------------------------- */

test("maç öncesi muhtemel 11 de sahaya dizilir, ama 'Muhtemel' rozetiyle", () => {
  const analysis = {
    probableLineups: {
      home: { predictionStatus: "available", formation: "4-2-3-1", starters: NAMES.slice() },
      away: { predictionStatus: "available", formation: "4-3-3", starters: "abcdefghijk".split("") }
    }
  };
  const html = lineupsSectionHtml({ lineups: [] }, analysis, ctx({ state: "pre" }));
  assert.ok(html.includes("is-probable"), "tahmin rozeti görünmeli");
  assert.ok(html.includes("msp-pitch"), "muhtemel 11 de sahaya dizilebilir");
  assert.ok(html.includes("tahmindir"), "tahmin olduğu açıkça yazmalı");
});

test("maç bittikten sonra kadro yoksa tahmin GÖSTERİLMEZ", () => {
  const analysis = {
    probableLineups: { home: { predictionStatus: "available", formation: "4-2-3-1", starters: NAMES.slice() } }
  };
  for (const state of ["post", "pending"]) {
    const html = lineupsSectionHtml({ lineups: [] }, analysis, ctx({ state }));
    assert.ok(!html.includes("msp-pitch"), `${state}: saha çizilmemeli`);
    assert.ok(!html.includes("is-probable"), `${state}: tahmin rozeti olmamalı`);
    assert.ok(html.includes("verisi mevcut değil"));
  }
});

test("kalıcı bağlantı hedefleri korunur", () => {
  const official = lineupsSectionHtml({ lineups: [griddedSide(), plainSide()] }, null, ctx());
  assert.ok(official.includes('id="kadrolar"') && official.includes('id="muhtemel-11"'));
});

test("kullanıcı verisi kaçırılır — sahaya HTML enjekte edilemez", () => {
  const nasty = { team: "Fenerbahçe", formation: "4-2-3-1", players: ["<img src=x onerror=alert(1)>", ...NAMES.slice(1)], substitutes: [] };
  const html = lineupsSectionHtml({ lineups: [nasty, plainSide()] }, null, ctx());
  assert.ok(!html.includes("<img"), "oyuncu adı ham HTML olarak basılmamalı");
  assert.ok(html.includes("&lt;img"));
});

test("İngilizce kadro Türkçe etiket taşımaz", () => {
  const html = lineupsSectionHtml({ lineups: [griddedSide(), plainSide()] }, null, ctx({ locale: "en" }));
  assert.ok(html.includes("Starting XI") && html.includes("Substitutes"));
  assert.ok(!html.includes("İlk 11") && !html.includes("Yedekler"));
});

if (failures) {
  console.error(`match-lineup-pitch: ${failures} test başarısız.`);
  process.exit(1);
}
console.log("match-lineup-pitch OK");
