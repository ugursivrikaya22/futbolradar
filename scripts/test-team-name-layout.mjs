/**
 * TAKIM ADI YERLEŞİM TESTLERİ — dikey harf yığılmasına karşı.
 *
 * Hata neydi: `.hero > *` kuralı mobilde `overflow-wrap: anywhere` veriyor,
 * bu özellik miras alınıyor ve kahramanın içindeki skor tablosuna kadar
 * iniyordu. Takım sütunu bir sözcükten dar kaldığında uzun adlar her harften
 * bölünüp alt alta diziliyordu. Testler bu sınıf hatanın geri gelmesini
 * engeller: kural metnine değil, kuralın SONUCUNA bakarlar.
 *
 * Sözleşme:
 *   1. Takım adı taşıyan her yüzey "guard" bloğunda adı geçer.
 *   2. Guard sözcük içi bölünmeyi kapatır ve yatay yazım kipini sabitler.
 *   3. Hiçbir kural takım adına dikey yazım kipi ya da `break-all` vermez.
 *   4. Her takım adı ya tek satır + üç nokta ya da en fazla iki satırdır.
 *   5. Üretilen sayfalar takım adlarını guard kapsamındaki öğelere basar.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const css = fs.readFileSync(path.join(root, "page.css"), "utf8");

const GUARD_MARKER = "team-name-guard";
const TEAM_NAME_SELECTORS = [
  ".fixture-row-name",
  ".featured-fixture-team strong",
  ".trend-card-head strong",
  ".live-score-team-name",
  ".home-score-teams strong",
  ".pma-team",
  ".team-card h3"
];

/** Guard bloğu: işaretten dosya sonuna kadar olan bölüm. */
function guardBlock() {
  const index = css.indexOf(GUARD_MARKER);
  assert.notEqual(index, -1, `page.css: "${GUARD_MARKER}" bloğu kaybolmuş`);
  return css.slice(index);
}

function testEveryTeamNameSurfaceIsGuarded() {
  const block = guardBlock();
  for (const selector of TEAM_NAME_SELECTORS) {
    assert.ok(
      block.includes(selector),
      `page.css: "${selector}" takım adı güvencesi dışında kalmış`
    );
  }
}

function testGuardDisablesIntraWordBreaking() {
  const block = guardBlock();
  for (const declaration of [
    "overflow-wrap: normal",
    "word-break: normal",
    "hyphens: none",
    "writing-mode: horizontal-tb"
  ]) {
    assert.ok(block.includes(declaration), `page.css: güvence "${declaration}" kuralını kaybetmiş`);
  }
}

/**
 * Takım adına dikey yazım kipi ya da harf harf bölme veren HİÇBİR kural
 * olmamalı. Dosyanın tamamı taranır: guard doğru yazılmış olsa bile başka
 * bir yerde daha sonra gelen bir kural onu ezebilir.
 */
function testNoRuleStacksTeamNamesVertically() {
  const forbidden = [
    { pattern: /writing-mode:\s*vertical/gi, label: "writing-mode: vertical-*" },
    { pattern: /word-break:\s*break-all/gi, label: "word-break: break-all" }
  ];

  for (const { pattern, label } of forbidden) {
    let match;
    while ((match = pattern.exec(css)) !== null) {
      // Kuralın ait olduğu seçici bloğunu bul: en yakın önceki "{" öncesi metin.
      const before = css.slice(0, match.index);
      const braceIndex = before.lastIndexOf("{");
      const selectorStart = Math.max(
        before.lastIndexOf("}", braceIndex),
        before.lastIndexOf("*/", braceIndex)
      );
      const selector = before.slice(selectorStart + 1, braceIndex);

      for (const teamSelector of TEAM_NAME_SELECTORS) {
        const leaf = teamSelector.split(" ").pop();
        assert.ok(
          !selector.includes(leaf) || leaf === "strong" || leaf === "h3",
          `page.css: "${label}" kuralı takım adı seçicisine (${selector.trim()}) uygulanmış`
        );
      }
    }
  }
}

function testTeamNamesAreEllipsisOrTwoLineClamped() {
  const block = guardBlock();

  // Tek satır + üç nokta yolu.
  assert.ok(block.includes("text-overflow: ellipsis"), "tek satır yolu üç nokta kırpması içermeli");
  assert.ok(block.includes("white-space: nowrap"), "tek satır yolu satır sarmayı kapatmalı");

  // En fazla iki satır yolu.
  assert.ok(block.includes("-webkit-line-clamp: 2"), "çok satır yolu iki satırla sınırlı olmalı");
  assert.ok(block.includes("line-clamp: 2"), "standart line-clamp de yazılmalı");
  assert.ok(block.includes("-webkit-box-orient: vertical"), "line-clamp için kutu yönelimi gerekli");
}

/**
 * `min-width: auto` (ızgara/esnek varsayılanı) adı kırpmak yerine sütunu
 * genişletir; kart taşar ve mobilde yatay kaydırma doğar.
 */
function testFlexAndGridParentsCanShrink() {
  const block = guardBlock();
  for (const parent of [".fixture-row", ".featured-fixture-team", ".featured-fixture-board", ".trend-card-head", ".pma-score"]) {
    assert.ok(block.includes(parent), `page.css: "${parent}" kabı küçülebilir olarak işaretlenmemiş`);
  }
  assert.ok(block.includes("min-width: 0"), "kaplar min-width: 0 almalı");
}

/**
 * Kahraman panosu, tanıtım metninin agresif sarma kuralından muaf tutulmalı;
 * hatanın kök nedeni buydu.
 */
function testHeroFeaturedOptsOutOfAggressiveWrapping() {
  const block = guardBlock();
  assert.ok(
    /\.hero-featured[\s\S]{0,200}overflow-wrap:\s*normal/.test(block),
    "page.css: kahraman panosu `overflow-wrap: anywhere` mirasından çıkarılmamış"
  );
}

/** Üretilen sayfalar takım adlarını gerçekten guard kapsamındaki öğelere basıyor mu? */
function testRenderedPagesUseGuardedElements() {
  const indexPath = path.join(root, "index.html");
  if (!fs.existsSync(indexPath)) return;
  const html = fs.readFileSync(indexPath, "utf8");

  assert.ok(html.includes('class="fixture-row-name"'), "index.html: maç satırı takım adı sınıfını kullanmalı");
  assert.ok(
    /<div class="featured-fixture-team">[\s\S]*?<strong>/.test(html),
    "index.html: kahraman panosu takım adını <strong> içinde basmalı"
  );
}

testEveryTeamNameSurfaceIsGuarded();
testGuardDisablesIntraWordBreaking();
testNoRuleStacksTeamNamesVertically();
testTeamNamesAreEllipsisOrTwoLineClamped();
testFlexAndGridParentsCanShrink();
testHeroFeaturedOptsOutOfAggressiveWrapping();
testRenderedPagesUseGuardedElements();

console.log("Team name layout tests passed (no vertical stacking, ellipsis or two-line clamp, shrinkable containers).");
