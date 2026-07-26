/**
 * ARAMA KAPSAMI TESTLERİ
 *
 * Neden: "Takım ve futbolcu ara" kutusu yalnızca data/teams.json'daki beş
 * takımı tanıyordu; Göztepe, Konyaspor gibi ligde olan takımlar sıfır sonuç
 * veriyordu. Kapsam artık TFF fikstüründen türetiliyor. Bu test, kapsamın
 * sessizce daralmasını engeller.
 *
 * Test edilen sözleşme:
 *   1. Süper Lig'in tamamı aranabilir (fikstürdeki her takım dizinde).
 *   2. Sonuç tipleri ayrı kalır: team / player / page (TKM / OYN / SYF).
 *   3. Türkçe katlama korunur: "Göztepe" = "goztepe" = "GOZTEPE".
 *   4. Uydurma yok: fikstürden türetilen takım kadro/istatistik alanı taşımaz.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { mergeSuperLigTeams, fixtureTeamNames, isFixtureOnly, sameClub } = require("../services/superLigTeams.js");

/**
 * site.js içindeki foldTurkish ile AYNI kurallar. Kopya olduğu için, kaynak
 * fonksiyonun hâlâ aynı eşlemeleri yaptığı ayrıca doğrulanır (aşağıda).
 */
function foldTurkish(value) {
  return String(value || "")
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/\s+/g, " ")
    .trim();
}

function readIndex() {
  const file = path.join(root, "search-index.json");
  assert.ok(fs.existsSync(file), "search-index.json üretilmemiş");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** site.js'teki eşleştirmenin sadeleştirilmiş karşılığı. */
function search(index, query) {
  const needle = foldTurkish(query);
  return index.filter((entry) => foldTurkish(entry.title).includes(needle));
}

const ZORUNLU_TAKIMLAR = [
  "Galatasaray",
  "Fenerbahçe",
  "Beşiktaş",
  "Trabzonspor",
  "Göztepe",
  "Konyaspor"
];

function testFixtureCoverage() {
  const names = fixtureTeamNames();
  assert.equal(names.length, 18, `Süper Lig'de 18 takım bekleniyor, ${names.length} bulundu`);

  const curated = JSON.parse(fs.readFileSync(path.join(root, "data", "teams.json"), "utf8"));
  const merged = mergeSuperLigTeams(curated);
  assert.equal(merged.length, 18, "birleşik takım listesi 18 olmalı");

  // Editoryal kayıt türetilmiş kimliğin üzerine yazılmamalı.
  const gs = merged.find((team) => team.name === "Galatasaray");
  assert.ok(gs, "Galatasaray birleşik listede yok");
  assert.equal(isFixtureOnly(gs), false, "editoryal takım fixture-only sayılmamalı");
  assert.ok(gs.momentum, "editoryal takımın momentum verisi korunmalı");

  // Göztepe "sıfır sonuç" şikâyetinin kaynağıydı: aranabilir KALMALI.
  // Ama artık fixture-only olduğu VARSAYILMIYOR — kadro senkronu gerçek
  // anahtarla koştuğunda Göztepe kürasyonlu kayda dönüşüyor ve bu istenen
  // sonuç. Sabit örnek seçmek, veri gelince testi kırıyordu.
  const goztepe = merged.find((team) => team.name === "Göztepe");
  assert.ok(goztepe, "Göztepe birleşik listede yok");

  // Asıl sözleşme: fikstürden türetilen HER takım uydurma veri taşımamalı.
  const INVENTABLE = ["momentum", "form", "attack", "defense", "venue", "coach", "rank", "points"];
  for (const team of merged.filter(isFixtureOnly)) {
    for (const field of INVENTABLE) {
      assert.equal(
        team[field],
        undefined,
        `${team.name}: fikstürden türetilen takımda "${field}" alanı üretilmemeli`
      );
    }
  }
}

/**
 * Aynı kulüp iki kaynakta farklı yazıldığında listeye BİR kez girmeli.
 *
 * REGRESYON: Kadro senkronu API-Football adlarını yazıyor ("Rizespor"),
 * fikstür TFF adlarını taşıyor ("Çaykur Rizespor"). Tam ad eşitliği arandığı
 * sürece ikisi de listeye giriyordu ve arama kutusunda aynı takım iki kez
 * görünüyordu. Senkron 18 takım yazana kadar (teams.json'da beş takım vardı)
 * çakışma hiç oluşmadığı için sorun görünmüyordu.
 */
function testProviderAndFixtureNamesDoNotDuplicateClubs() {
  const PROVIDER_NAMES = [
    "Galatasaray", "Fenerbahçe", "Beşiktaş", "Trabzonspor", "Samsunspor",
    "Başakşehir", "Konyaspor", "Göztepe", "Alanyaspor", "Gençlerbirliği S.K.",
    "Kasımpaşa", "Rizespor", "Erzurumspor FK", "Gaziantep FK", "Amed",
    "Eyüpspor", "Çorum FK", "Kocaelispor"
  ];
  const synced = PROVIDER_NAMES.map((name) => ({ name, isCurrentSuperLigTeam: true }));
  const merged = mergeSuperLigTeams(synced);

  assert.equal(merged.length, 18,
    `sağlayıcı adlarıyla birleşen liste 18 olmalı, ${merged.length} bulundu ` +
    `(fazlalar: ${merged.map((t) => t.name).filter((n) => !PROVIDER_NAMES.includes(n)).join(", ")})`);

  // Farklı yazımlar aynı kulüp sayılmalı; alakasız kulüpler ayrı kalmalı.
  assert.ok(sameClub("Rizespor", "Çaykur Rizespor"));
  assert.ok(sameClub("Gençlerbirliği S.K.", "Gençlerbirliği"));
  assert.ok(sameClub("Amed", "Amed Sportif Faaliyetler"));
  assert.ok(!sameClub("Konyaspor", "Kasımpaşa"));
  assert.ok(!sameClub("Göztepe", "Gaziantep FK"));
  // Kısa/genel parça alakasız kulübe yapışmamalı.
  assert.ok(!sameClub("Spor", "Konyaspor"));
  assert.ok(!sameClub("FK", "Gaziantep FK"));
}

function testIndexContainsEveryTeam() {
  const index = readIndex();
  const teams = index.filter((entry) => entry.type === "team");
  assert.equal(teams.length, 18, `dizinde 18 takım bekleniyor, ${teams.length} var`);

  // Ad EŞİTLİĞİ değil, aynı kulüp olması aranıyor: kadro senkronu sağlayıcı
  // adını yazınca ("Rizespor") fikstür adı ("Çaykur Rizespor") dizinde birebir
  // bulunmuyor — ama kulüp aranabilir durumda ve istenen bu.
  for (const name of fixtureTeamNames()) {
    assert.ok(
      teams.some((entry) => sameClub(entry.title, name)),
      `"${name}" arama dizininde yok`
    );
  }
}

function testRequiredTeamsAreSearchable() {
  const index = readIndex();

  for (const name of ZORUNLU_TAKIMLAR) {
    for (const query of [name, foldTurkish(name), name.toLocaleUpperCase("tr")]) {
      const hits = search(index, query);
      assert.ok(
        hits.some((entry) => entry.type === "team" && entry.title === name),
        `"${query}" araması "${name}" takımını bulamadı`
      );
    }
  }
}

function testResultTypesStaySeparated() {
  const index = readIndex();
  const badges = { team: "TKM", player: "OYN", page: "SYF" };

  for (const entry of index) {
    assert.ok(badges[entry.type], `bilinmeyen sonuç tipi: ${entry.type}`);
    assert.equal(
      entry.badge,
      badges[entry.type],
      `${entry.title}: ${entry.type} tipi ${badges[entry.type]} rozeti taşımalı`
    );
  }

  assert.ok(index.some((entry) => entry.type === "team"), "takım sonucu yok");
  assert.ok(index.some((entry) => entry.type === "player"), "oyuncu sonucu yok");
  assert.ok(index.some((entry) => entry.type === "page"), "sayfa sonucu yok");
}

/** Katlama kuralları site.js ile aynı kalmalı — kopya sessizce kaymamalı. */
function testTurkishFoldingMatchesSource() {
  const source = fs.readFileSync(path.join(root, "site.js"), "utf8");
  assert.ok(source.includes("function foldTurkish"), "site.js içinde foldTurkish yok");

  for (const [from, to] of [["ı", "i"], ["ş", "s"], ["ğ", "g"], ["ü", "u"], ["ö", "o"], ["ç", "c"]]) {
    assert.ok(
      source.includes(`.replace(/${from}/g, "${to}")`),
      `site.js foldTurkish "${from}" -> "${to}" eşlemesini kaybetmiş`
    );
  }

  assert.equal(foldTurkish("Göztepe"), "goztepe");
  assert.equal(foldTurkish("GÖZTEPE"), "goztepe");
  assert.equal(foldTurkish("Beşiktaş"), "besiktas");
  assert.equal(foldTurkish("Çaykur Rizespor"), "caykur rizespor");
  assert.equal(foldTurkish("Gençlerbirliği"), "genclerbirligi");
}

testFixtureCoverage();
testProviderAndFixtureNamesDoNotDuplicateClubs();
testIndexContainsEveryTeam();
testRequiredTeamsAreSearchable();
testResultTypesStaySeparated();
testTurkishFoldingMatchesSource();

console.log("Search coverage tests passed (18 Süper Lig takımı, sağlayıcı/fikstür ad uzlaşması, tip ayrımı, Türkçe katlama).");
