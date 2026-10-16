#!/usr/bin/env node
/**
 * ÖZELLİK PUANLARININ YÜZEYLERİ — ÜRETİLMİŞ ÇIKTI TESTLERİ.
 *
 * Motor doğru hesaplasa bile sayfa boş kalabilir: puanlar bugüne kadar tam
 * olarak bunun için "-" görünüyordu (hesap vardı, kapı kapalıydı, statik
 * HTML'de satır hiç yoktu). Bu dosya çıktının KENDİSİNİ denetler:
 *
 *   • Karşılaştırma ve profil sayfalarında tablo SUNUCUDA basılmış mı
 *     (JavaScript çalıştırmadan görülüyor mu — SEO şartı).
 *   • Hesaplanabilir veri varken hiçbir hücrede "-" kalmış mı.
 *   • Hesaplanamayan kategori "Veri yetersiz" diyor mu (0 ya da tire değil).
 *   • Kaleci ve defans oyuncusu kendi şemalarıyla mı puanlanmış.
 *   • Mobil düzen kuralları CSS'te var mı.
 *   • schema.org düğümleri mevcut yapıyı bozmadan eklenmiş mi.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { RATING_CATEGORY_ORDER } = require("../services/playerRatingEngine.js");

const root = process.cwd();
const players = JSON.parse(fs.readFileSync(path.join(root, "data", "players.json"), "utf8"));
const ratingsFile = JSON.parse(fs.readFileSync(path.join(root, "data", "player-ratings.json"), "utf8"));
const storedRatings = ratingsFile.players || {};
const playerById = new Map(players.map((player) => [player.id, player]));

/**
 * ŞARTNAMEDEKİ TEST LİSTESİ.
 *
 * Kimlikler sabit ama testler "bu oyuncunun puanı şu olsun" DEMİYOR: veri
 * her hafta değişiyor, sabit bir sayı beklemek testi haftalık bakım yüküne
 * çevirirdi. Beklenen şey yapısal: puan hesaplanmış olmalı, 0-100 aralığında
 * olmalı ve sayfada görünmeli.
 */
const REQUIRED_SUBJECTS = [
  { id: "v-osimhen-galatasaray", label: "Victor Osimhen", group: "forward" },
  { id: "m-greenwood-fenerbahce", label: "Mason Greenwood", group: "forward" },
  { id: "i-gundogan-galatasaray", label: "Süper Lig orta saha", group: "midfielder" },
  { id: "e-elmali-galatasaray", label: "Süper Lig defans", group: "defender" },
  { id: "u-cakir-galatasaray", label: "Süper Lig kaleci", group: "goalkeeper" }
];

function comparisonFiles() {
  return fs.readdirSync(path.join(root, "karsilastirma")).filter((name) => name.endsWith(".html"));
}

function readComparison(file) {
  return fs.readFileSync(path.join(root, "karsilastirma", file), "utf8");
}

/** Sunucuda basılmış tablodaki hücre metinleri. */
function ratingCells(html) {
  const section = html.match(/<section class="player-rating-compare"[\s\S]*?<\/section>/);
  if (!section) return [];
  return [...section[0].matchAll(/<b aria-label="[^"]*">([^<]*)<\/b>/g)].map((match) => match[1].trim());
}

// ── 1. VERİ ─────────────────────────────────────────────────────────────────

function testRequiredSubjectsHaveComputedScores() {
  for (const subject of REQUIRED_SUBJECTS) {
    const record = playerById.get(subject.id);
    assert.ok(record, `${subject.label} (${subject.id}) veri kümesinde yok`);

    const scores = storedRatings[subject.id];
    assert.ok(scores, `${subject.label}: hesaplanmış puan bloğu yok`);
    assert.equal(scores.status, "computed", `${subject.label}: puan bloğu hesaplanmamış`);
    assert.equal(scores.positionGroup, subject.group, `${subject.label}: mevki grubu ${scores.positionGroup}`);

    assert.equal(scores.categories.overall.status, "computed", `${subject.label}: Overall hesaplanmalı`);
    const overall = scores.categories.overall.value;
    assert.ok(Number.isFinite(overall) && overall >= 0 && overall <= 100,
      `${subject.label}: Overall ${overall} 0-100 aralığında olmalı`);

    assert.ok(record.playerRatingUpdatedAt, `${subject.label}: playerRatingUpdatedAt yok`);
    assert.equal(record.player_rating_updated_at, record.playerRatingUpdatedAt,
      `${subject.label}: snake_case ikiz alan eşleşmeli`);
    assert.ok(Number.isFinite(Date.parse(record.playerRatingUpdatedAt)),
      `${subject.label}: güncelleme damgası geçerli bir tarih olmalı`);
  }
}

function testGoalkeeperSubjectUsesGoalkeeperScheme() {
  const keeper = storedRatings["u-cakir-galatasaray"];
  assert.equal(keeper.scheme, "goalkeeper");
  assert.equal(keeper.categories.attack.status, "not-applicable", "kalecide hücum mevki dışı olmalı");
  assert.equal(keeper.categories.defense.label, "Kalecilik");
  assert.equal(keeper.categories.defense.status, "computed", "kalecinin kurtarış puanı hesaplanmalı");
}

function testDefenderSubjectIsScoredOnDefence() {
  const defender = storedRatings["e-elmali-galatasaray"];
  assert.equal(defender.categories.defense.status, "computed", "defans oyuncusunun savunma puanı hesaplanmalı");
  assert.ok(defender.categories.defense.inputs.length > 0, "savunma puanı girdileriyle birlikte taşınmalı");
}

function testCompactBlockMatchesStoredBlock() {
  // `data/players.json` kompakt, `data/player-ratings.json` tam. İkisinin
  // AYNI sayıyı söylemesi şart: istemci kompakt olanı, statik sayfa tam
  // olanı okuyor.
  let checked = 0;
  for (const [id, scores] of Object.entries(storedRatings)) {
    const record = playerById.get(id);
    if (!record || !record.ratingScores || !record.ratingScores.categories) continue;
    for (const key of RATING_CATEGORY_ORDER) {
      assert.equal(record.ratingScores.categories[key].value, scores.categories[key].value,
        `${id}/${key}: kompakt ve tam blok farklı değer taşıyor`);
      assert.equal(record.ratingScores.categories[key].status, scores.categories[key].status,
        `${id}/${key}: kompakt ve tam blok farklı durum taşıyor`);
    }
    checked += 1;
  }
  assert.ok(checked > 100, `karşılaştırılan kayıt sayısı beklenenden az: ${checked}`);
}

function testEveryComputedCategoryStaysInRange() {
  for (const [id, scores] of Object.entries(storedRatings)) {
    for (const key of RATING_CATEGORY_ORDER) {
      const category = scores.categories[key];
      if (category.status !== "computed") {
        assert.equal(category.value, null, `${id}/${key}: hesaplanmamış kategori değer taşımamalı`);
        continue;
      }
      assert.ok(Number.isFinite(category.value) && category.value >= 0 && category.value <= 100,
        `${id}/${key}: ${category.value} aralık dışında`);
      assert.ok(category.inputs.length > 0, `${id}/${key}: puan girdisiz yayımlanmamalı`);
    }
  }
}

// ── 2. KARŞILAŞTIRMA SAYFALARI ──────────────────────────────────────────────

function testFlagshipComparisonRendersBothPlayersServerSide() {
  const file = "m-greenwood-fenerbahce-vs-v-osimhen-galatasaray.html";
  const full = path.join(root, "karsilastirma", file);
  assert.ok(fs.existsSync(full), `${file} üretilmemiş`);

  const html = fs.readFileSync(full, "utf8");
  assert.ok(html.includes('class="player-rating-compare"'), "puan tablosu statik HTML'de olmalı");
  assert.ok(html.includes("Son güncelleme:"), "güncelleme tarihi basılmalı");

  for (const key of RATING_CATEGORY_ORDER) {
    const label = { overall: "Overall", form: "Form", attack: "Hücum", creativity: "Yaratıcılık",
      defense: "Savunma", discipline: "Disiplin", durability: "Süreklilik", potential: "Potansiyel" }[key];
    assert.ok(html.includes(`<span>${label}</span>`), `${label} satırı sayfada yok`);
  }

  const left = storedRatings["m-greenwood-fenerbahce"].categories.overall.value;
  const right = storedRatings["v-osimhen-galatasaray"].categories.overall.value;
  assert.ok(html.includes(`aria-label="M. Greenwood: ${left} / 100"`), "sol oyuncunun Overall değeri basılmalı");
  assert.ok(html.includes(`aria-label="V. Osimhen: ${right} / 100"`), "sağ oyuncunun Overall değeri basılmalı");
  assert.ok(html.includes('class="rating-cell is-leading"'), "yüksek değer vurgulanmalı");
  assert.ok(html.includes("rating-bar-fill"), "yatay çubuk basılmalı");
}

function testComparisonDetailShowsUnderlyingStatistics() {
  const html = readComparison("m-greenwood-fenerbahce-vs-v-osimhen-galatasaray.html");
  assert.ok(/<dt>Gol<\/dt><dd>[^<]*\d/.test(html), "Hücum açılımı gol sayısını göstermeli");
  assert.ok(/Değerlendirilen maç/.test(html), "Form açılımı kaç maça dayandığını söylemeli");
  assert.ok(/<details class="rating-row"/.test(html), "kategori detayı açılabilir olmalı");
}

function testComputableSubjectsNeverRenderADash() {
  // ŞARTNAMENİN ANA MADDESİ: hesaplanabilir veri varken "-" görünmemeli.
  const files = comparisonFiles().filter((name) =>
    REQUIRED_SUBJECTS.some((subject) => name.includes(subject.id)));
  assert.ok(files.length >= 5, `test öznelerine ait kıyas sayfası bulunamadı (${files.length})`);

  let inspected = 0;
  for (const file of files) {
    const cells = ratingCells(readComparison(file));
    if (!cells.length) continue;
    for (const cell of cells) {
      assert.notEqual(cell, "-", `${file}: puan hücresinde çıplak tire var`);
      assert.ok(cell === "Veri yetersiz" || cell === "Mevki dışı" || /^\d{1,3}$/.test(cell),
        `${file}: beklenmeyen hücre içeriği "${cell}"`);
    }
    inspected += 1;
  }
  assert.ok(inspected >= 5, `incelenen sayfa sayısı yetersiz: ${inspected}`);
}

function testNoComparisonPageDropsAComputedValue() {
  // Bir sayfada gösterilmeyen puan, veri kümesinde hesaplanmış olmamalı:
  // iki taraf ayrışırsa sayfa yine "-" gösterir hâle gelir.
  const files = comparisonFiles();
  let checked = 0;

  for (const file of files) {
    const html = readComparison(file);
    const seed = html.match(/data-compare-seed="([^"]+)"/);
    if (!seed) continue;
    const ids = seed[1].split(",");
    const computed = ids.filter((id) => storedRatings[id] && storedRatings[id].status === "computed");
    if (!computed.length) continue;

    assert.ok(html.includes('class="player-rating-compare"'),
      `${file}: hesaplanmış puan var ama tablo basılmamış`);

    for (const id of computed) {
      const record = playerById.get(id);
      const overall = storedRatings[id].categories.overall;
      if (!record || overall.status !== "computed") continue;
      assert.ok(html.includes(`aria-label="${record.name}: ${overall.value} / 100"`),
        `${file}: ${record.name} için hesaplanmış Overall sayfada yok`);
    }
    checked += 1;
    if (checked >= 400) break;
  }

  assert.ok(checked > 100, `denetlenen kıyas sayfası sayısı az: ${checked}`);
}

function testComparisonSchemaCarriesRatingsWithoutBreakingExistingNodes() {
  const html = readComparison("m-greenwood-fenerbahce-vs-v-osimhen-galatasaray.html");
  const block = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(block, "JSON-LD bloğu yok");

  const graph = JSON.parse(block[1])["@graph"];
  assert.ok(graph.some((node) => node["@type"] === "WebPage"), "mevcut WebPage düğümü korunmalı");
  assert.ok(graph.some((node) => node["@type"] === "BreadcrumbList"), "mevcut BreadcrumbList düğümü korunmalı");

  const persons = graph.filter((node) => node["@type"] === "Person");
  assert.equal(persons.length, 2, "iki oyuncu için Person düğümü beklenir");
  for (const person of persons) {
    assert.ok(Array.isArray(person.additionalProperty) && person.additionalProperty.length,
      `${person.name}: puanlar additionalProperty olarak taşınmalı`);
    for (const property of person.additionalProperty) {
      assert.equal(property["@type"], "PropertyValue");
      assert.equal(typeof property.value, "number", `${person.name}/${property.name}: değer sayı olmalı`);
      assert.ok(property.value >= 0 && property.value <= 100);
    }
  }
}

function testComparisonDescriptionMentionsTheScores() {
  const html = readComparison("m-greenwood-fenerbahce-vs-v-osimhen-galatasaray.html");
  const description = html.match(/<meta name="description" content="([^"]+)"/);
  assert.ok(description, "meta açıklaması yok");
  assert.ok(/overall \d+/i.test(description[1]),
    "arama sonucunda görünmesi için açıklama hesaplanmış Overall değerini taşımalı");
}

// ── 3. PROFİL SAYFALARI ─────────────────────────────────────────────────────

function testProfilePagesCarryTheRatingCard() {
  const directories = ["futbolcu", "oyuncular"];
  const found = new Map();

  for (const directory of directories) {
    const dir = path.join(root, directory);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".html"))) {
      const html = fs.readFileSync(path.join(dir, file), "utf8");
      if (!html.includes("player-rating-card")) continue;
      found.set(`${directory}/${file}`, html);
    }
  }

  assert.ok(found.size >= 100, `puan kartı taşıyan profil sayısı beklenenden az: ${found.size}`);

  const [, sample] = [...found.entries()][0];
  assert.ok(sample.includes("Son güncelleme:"), "profil kartı güncelleme tarihini göstermeli");
  assert.ok(sample.includes("rating-bar-fill"), "profil kartı çubuk göstermeli");
  assert.ok(!/>\s*-\s*<\/b>/.test(sample.match(/<section class="player-rating-card[\s\S]*?<\/section>/)[0]),
    "profil kartında çıplak tire olmamalı");
}

function testProfileSchemaCarriesRatings() {
  const dir = path.join(root, "futbolcu");
  const file = fs.readdirSync(dir).find((name) => {
    const html = fs.readFileSync(path.join(dir, name), "utf8");
    return html.includes("player-rating-card");
  });
  assert.ok(file, "puan kartı taşıyan bir profil bulunamadı");

  const html = fs.readFileSync(path.join(dir, file), "utf8");
  const block = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  const graph = JSON.parse(block[1])["@graph"];
  const person = graph.find((node) => node["@type"] === "Person");
  assert.ok(person, "Person düğümü korunmalı");
  assert.ok(Array.isArray(person.additionalProperty) && person.additionalProperty.length,
    "profil Person düğümü puanları taşımalı");
  assert.ok(graph.some((node) => node["@type"] === "BreadcrumbList"), "breadcrumb bozulmamalı");
}

// ── 4. GÖRÜNÜM ──────────────────────────────────────────────────────────────

function testStylesheetCoversDesktopAndMobile() {
  const css = fs.readFileSync(path.join(root, "page.css"), "utf8");
  for (const rule of [".player-rating-compare", ".rating-row-grid", ".rating-bar-fill",
    ".rating-cell.is-leading", ".rating-cell.is-empty", ".rating-detail-grid", ".compare-row-rating"]) {
    assert.ok(css.includes(rule), `${rule} kuralı CSS'te yok`);
  }

  const mobile = css.slice(css.indexOf(".player-rating-compare"));
  assert.ok(/@media \(max-width: 640px\)[\s\S]*\.rating-row-grid/.test(mobile),
    "mobil düzen kuralı yok — tablo dar ekranda bozulur");

  // Yayın kopyası da güncel olmalı; aksi hâlde tablo stilsiz görünür.
  const published = fs.readFileSync(path.join(root, "public", "page.css"), "utf8");
  assert.ok(published.includes(".player-rating-compare"), "public/page.css senkronlanmamış");
}

function testClientBundleReadsComputedScores() {
  for (const file of ["app.js", "app-compare.js"]) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.ok(source.includes("compareRatingRowHtml"), `${file}: puan satırı çizici yok`);
    assert.ok(source.includes("ratingScoreCategory"), `${file}: hesaplanmış blok okunmuyor`);
    assert.ok(source.includes("Veri yetersiz"), `${file}: eksik ölçüm etiketi yok`);
  }
}

const tests = [
  testRequiredSubjectsHaveComputedScores,
  testGoalkeeperSubjectUsesGoalkeeperScheme,
  testDefenderSubjectIsScoredOnDefence,
  testCompactBlockMatchesStoredBlock,
  testEveryComputedCategoryStaysInRange,
  testFlagshipComparisonRendersBothPlayersServerSide,
  testComparisonDetailShowsUnderlyingStatistics,
  testComputableSubjectsNeverRenderADash,
  testNoComparisonPageDropsAComputedValue,
  testComparisonSchemaCarriesRatingsWithoutBreakingExistingNodes,
  testComparisonDescriptionMentionsTheScores,
  testProfilePagesCarryTheRatingCard,
  testProfileSchemaCarriesRatings,
  testStylesheetCoversDesktopAndMobile,
  testClientBundleReadsComputedScores
];

let failed = 0;
for (const test of tests) {
  try {
    test();
    console.log(`  ✓ ${test.name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${test.name}\n    ${error.message}`);
  }
}

if (failed) {
  console.error(`\nplayer-rating-surfaces: ${failed} test başarısız`);
  process.exit(1);
}
console.log(`\nplayer-rating-surfaces: ${tests.length} test geçti`);
