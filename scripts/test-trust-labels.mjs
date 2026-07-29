/**
 * GÜVEN ETİKETLERİ TESTLERİ
 *
 * Sözleşme:
 *   1. Söz dağarcığı kapalı: tanımsız etiket basılmaz.
 *   2. Etiket KAYITTAN türetilir, elle yazılmaz.
 *   3. Kaynağı ya da doğrulama zamanı eksik kayıt "Veri eksik" der.
 *   4. Söylenti hiçbir zaman "kesinleşti" gibi görünmez.
 *   5. Başlamış ama skorsuz maç "Skor yok" der; başlamamış maç demez.
 *   6. HTML kaçışı yapılır.
 *   7. İstemci (app.js) aynı söz dağarcığını taşır.
 *   8. Yayımlanan sayfalar tanımsız güven etiketi taşımaz.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const {
  TRUST_LABELS,
  isKnownLabel,
  matchTrustLabels,
  statementTrustLabels,
  transferTrustLabels,
  trustBadge,
  trustBadges
} = require("../services/trustLabels.js");

const NOW = new Date("2026-07-29T21:00:00+03:00");

const TRANSFER = Object.freeze({
  playerName: "Örnek Oyuncu",
  fromTeam: "A Kulübü",
  toTeam: "B Kulübü",
  type: "Bonservisiyle",
  date: "2026-07-25",
  status: "confirmed",
  sourceName: "Kulüp",
  sourceUrl: "https://ornek.org.tr/haber/1",
  sourceType: "official",
  lastVerifiedAt: "2026-07-25T12:00:00+03:00"
});

/** Söz dağarcığı kapalı. */
function testVocabularyIsClosed() {
  for (const key of ["verified", "official", "media", "rumour", "incomplete", "noScore", "transferConfirmed"]) {
    assert.ok(isKnownLabel(key), `"${key}" söz dağarcığında olmalı`);
    assert.ok(TRUST_LABELS[key].text, `"${key}" metinsiz olmamalı`);
    assert.ok(TRUST_LABELS[key].title, `"${key}" açıklamasız olmamalı`);
  }

  assert.equal(isKnownLabel("kesin"), false);
  assert.equal(trustBadge("uydurma"), "", "tanımsız etiket basılmamalı");
  assert.equal(trustBadges(["uydurma", "banko"]), "", "tanımsız etiketlerle boş kap basılmamalı");
  assert.equal(trustBadges([]), "", "boş listede kap basılmamalı");
}

/** Bahis dili söz dağarcığına sızmamalı. */
function testNoBettingLanguage() {
  for (const label of Object.values(TRUST_LABELS)) {
    const text = `${label.text} ${label.title}`.toLocaleLowerCase("tr");
    for (const term of ["banko", "kupon", "iddaa", "bahis", "oran"]) {
      assert.ok(!text.includes(term), `güven etiketinde yasak terim: "${term}" → ${label.text}`);
    }
  }
}

/** Transfer etiketi kayıttan türer. */
function testTransferLabels() {
  assert.deepEqual(transferTrustLabels(TRANSFER), ["transferConfirmed", "official"]);
  assert.deepEqual(transferTrustLabels({ ...TRANSFER, sourceType: "media" }), ["transferConfirmed", "media"]);

  // Söylenti kesinleşmiş gibi görünmez.
  const rumour = transferTrustLabels({ ...TRANSFER, status: "rumour", sourceType: "rumour" });
  assert.ok(rumour.includes("rumour"), "söylenti etiketlenmeli");
  assert.ok(!rumour.includes("transferConfirmed"), "söylenti kesinleşmiş gibi gösterilmemeli");

  // Kaynağı ya da doğrulaması eksik kayıt açıkça eksik der.
  assert.ok(transferTrustLabels({ ...TRANSFER, sourceUrl: "" }).includes("incomplete"));
  assert.ok(transferTrustLabels({ ...TRANSFER, lastVerifiedAt: "" }).includes("incomplete"));
  assert.ok(!transferTrustLabels(TRANSFER).includes("incomplete"), "tam kayıt eksik dememeli");

  assert.deepEqual(transferTrustLabels(null), ["incomplete"], "kayıt yoksa eksik denmeli");
}

/** Maç etiketi görüntüleme kapısıyla aynı gerçeği söyler. */
function testMatchLabels() {
  const past = "2026-07-29T19:00:00+03:00";
  const future = "2026-07-29T23:00:00+03:00";

  // Başlamamış maçın skoru beklenmiyor — "Skor yok" demek yanıltıcı olurdu.
  assert.deepEqual(matchTrustLabels({ kickoff: future, status: "SCHEDULED" }, { currentTime: NOW }), []);

  // Başlamış, skoru yok.
  assert.deepEqual(matchTrustLabels({ kickoff: past, status: "FINISHED" }, { currentTime: NOW }), ["noScore"]);

  // Canlı ve skorlu.
  assert.deepEqual(
    matchTrustLabels({ kickoff: past, status: "LIVE", score: { home: 1, away: 0 } }, { currentTime: NOW }),
    ["live"]
  );

  // GERÇEK 0-0 skordur: "Skor yok" denmez.
  assert.deepEqual(
    matchTrustLabels({ kickoff: past, status: "FINISHED", score: { home: 0, away: 0 } }, { currentTime: NOW }),
    []
  );
}

function testStatementLabels() {
  assert.deepEqual(statementTrustLabels({ sourceType: "official" }), ["verified", "official"]);
  assert.deepEqual(statementTrustLabels({ sourceType: "media" }), ["verified", "media"]);
  // Yayımlanan her açıklama zaten doğrulanmış; kaynak türü ayrı bir soru.
  assert.deepEqual(statementTrustLabels({}), ["verified"]);
}

/** İşaretleme kaçışı ve okunabilirliği. */
function testMarkup() {
  const html = trustBadge("official");
  assert.ok(html.includes('data-trust="official"'), html);
  assert.ok(html.includes('class="trust-badge is-official"'), html);
  assert.ok(html.includes(TRUST_LABELS.official.text), html);
  assert.ok(html.includes("title="), "etiket açıklamasını taşımalı");

  const row = trustBadges(["transferConfirmed", "media"]);
  assert.ok(row.startsWith('<span class="trust-badges">'), row);
  assert.equal((row.match(/trust-badge /g) || []).length, 2);

  // Söz dağarcığı sabit olduğu için kaçış sessiz kalır; yine de doğrulanır.
  assert.ok(!/<script/i.test(row));
}

/** İstemci söz dağarcığı servisle birebir aynı olmalı. */
function testClientMirrorsVocabulary() {
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const block = app.match(/var TRUST_LABELS = \{([\s\S]*?)\n {2}\};/);
  assert.ok(block, "app.js güven etiketlerini tanımlamalı");

  const client = {};
  for (const [, key, text] of block[1].matchAll(/(\w+):\s*\{[^}]*?text:\s*"([^"]+)"/g)) client[key] = text;

  assert.deepEqual(
    Object.keys(client).sort(),
    Object.keys(TRUST_LABELS).sort(),
    "istemci ve servis etiket anahtarları ayrışmış"
  );
  for (const [key, label] of Object.entries(TRUST_LABELS)) {
    assert.equal(client[key], label.text, `"${key}" metni ayrışmış`);
  }

  assert.ok(/function trustBadgesHtml\(/.test(app), "app.js rozet şeridini basmalı");
  assert.ok(/function transferTrustLabels\(/.test(app), "app.js transfer etiketlerini türetmeli");
  assert.ok(/function matchTrustLabels\(/.test(app), "app.js maç etiketlerini türetmeli");
}

/** Yayımlanan sayfalarda tanımsız güven etiketi olmamalı. */
function testPublishedPagesUseKnownLabelsOnly() {
  const pages = ["index.html", "gunun-radar-bulteni.html", "transfer-radari.html"]
    .map((file) => path.join(root, file))
    .filter((file) => fs.existsSync(file));

  for (const file of pages) {
    const html = fs.readFileSync(file, "utf8");
    for (const [, key] of html.matchAll(/data-trust="([^"]+)"/g)) {
      assert.ok(isKnownLabel(key), `${path.basename(file)}: tanımsız güven etiketi "${key}"`);
    }
  }
}

const tests = [
  testVocabularyIsClosed,
  testNoBettingLanguage,
  testTransferLabels,
  testMatchLabels,
  testStatementLabels,
  testMarkup,
  testClientMirrorsVocabulary,
  testPublishedPagesUseKnownLabelsOnly
];

for (const test of tests) test();

console.log(`Trust label tests passed (${tests.length} senaryo: kapalı söz dağarcığı, bahis dili yok, ` +
  "transfer türetimi, maç türetimi, açıklama türetimi, işaretleme, istemci eşliği, sayfa denetimi).");
