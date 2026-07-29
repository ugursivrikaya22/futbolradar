/**
 * MAÇ SONU AÇIKLAMALARI TESTLERİ
 *
 * Sözleşme:
 *   1. Yalnızca doğrulanmış ve kaynaklı söz yayımlanır. Taslak, kaynaksız,
 *      eksik alanlı ya da tanınmayan rollü kayıt hiçbir yüzeye çıkmaz.
 *   2. Söz DEĞİŞTİRİLMEZ: sayfaya kaynaktaki metnin aynısı basılır.
 *   3. Kayıt yoksa bölüm GİZLENMEZ, "veri bekleniyor" der ve sayı üretmez.
 *   4. Yapılandırılmış veriye yalnızca gerçek söz için düğüm eklenir; boş
 *      bir iddia arama motoruna yazılmaz.
 *   5. data/statements.json şema sözleşmesine uyar.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const {
  evaluateStatement,
  publishableStatements,
  readStatements,
  statementsForMatch
} = require("../services/matchStatementService.js");
const { statementsSection, statementsSchema } = require("../services/matchStatementsView.js");

const VALID = Object.freeze({
  id: "ornek-1",
  matchId: "ev-deplasman-2026-08-10",
  matchLabel: "Ev Takımı - Deplasman Takımı",
  speaker: "Teknik Direktör",
  role: "coach",
  team: "Ev Takımı",
  quote: "Oyuncularımın mücadelesinden memnunum.",
  context: "Maç sonu basın toplantısı",
  publishedAt: "2026-08-10T23:40:00+03:00",
  sourceName: "Kulüp",
  sourceType: "official",
  url: "https://ornek-kulup.org.tr/haber/1",
  status: "verified"
});

/** Kural: doğrulanmamış, kaynaksız ya da eksik kayıt yayımlanmaz. */
function testPublishRule() {
  assert.equal(evaluateStatement(VALID).publishable, true, "geçerli kayıt yayımlanabilir olmalı");

  const rejected = [
    [{ ...VALID, status: "draft" }, "taslak"],
    [{ ...VALID, status: "" }, "durumsuz"],
    [{ ...VALID, url: "" }, "kaynaksız"],
    [{ ...VALID, url: "javascript:alert(1)" }, "izlenemez bağlantı"],
    [{ ...VALID, sourceName: "" }, "kaynak adı yok"],
    [{ ...VALID, quote: "" }, "sözü yok"],
    [{ ...VALID, speaker: "" }, "konuşanı yok"],
    [{ ...VALID, matchId: "" }, "maçı yok"],
    // Okunabilir maç adı olmadan kart "hangi maçtan sonra?" sorusunu
    // cevaplayamaz; anahtarı biçimlendirip maç adı gibi sunmak tahmindir.
    [{ ...VALID, matchLabel: "" }, "okunabilir maç adı yok"],
    [{ ...VALID, sourceType: "" }, "kaynak türü yok"],
    [{ ...VALID, sourceType: "rumour" }, "söylenti alıntılanamaz"],
    [{ ...VALID, sourceType: "blog" }, "tanınmayan kaynak türü"],
    [{ ...VALID, role: "muhabir" }, "tanınmayan rol"],
    [{ ...VALID, publishedAt: "geçersiz" }, "tarihi okunamıyor"],
    [null, "kayıt yok"]
  ];

  for (const [record, label] of rejected) {
    const verdict = evaluateStatement(record);
    assert.equal(verdict.publishable, false, `${label} kayıt yayımlanmamalı`);
    assert.ok(verdict.reason, `${label} kaydın red gerekçesi yazılmalı`);
  }
}

/** Aynı söz iki kaynaktan gelebilir; iki kez yayımlanmaz. */
function testDeduplication() {
  const { statements, duplicates } = publishableStatements({
    statements: [VALID, { ...VALID, id: "ornek-2", sourceName: "Haber Kaynağı" }]
  });

  assert.equal(statements.length, 1, "aynı söz tek kez yayımlanmalı");
  assert.equal(duplicates.length, 1, "düşen kayıt raporlanmalı");
}

/** Söz yeniden yazılmaz: sayfaya kaynaktaki metnin aynısı basılır. */
function testQuoteIsNotRewritten() {
  const { statements } = publishableStatements({ statements: [VALID] });
  assert.equal(statements[0].quote, VALID.quote, "söz metni değiştirilmemeli");

  const html = statementsSection(statements);
  assert.ok(html.includes(VALID.quote), "söz sayfada birebir görünmeli");
  assert.ok(html.includes(VALID.sourceName), "kaynak adı yazılmalı");
  assert.ok(html.includes(VALID.url), "kaynak bağlantısı yazılmalı");
  assert.ok(html.includes('rel="noopener noreferrer"'), "dış bağlantı güvenli açılmalı");
}

/** Maç kimliğine göre süzme; başka maçın sözü sızmamalı. */
function testStatementsForMatch() {
  const prepared = publishableStatements({
    statements: [
      VALID,
      { ...VALID, id: "baska-mac", matchId: "baska-mac-2026-08-11", quote: "Başka maçın sözü." }
    ]
  });

  const mine = statementsForMatch(VALID.matchId, { prepared });
  assert.equal(mine.length, 1, "yalnızca ilgili maçın sözü dönmeli");
  assert.equal(mine[0].quote, VALID.quote);
  assert.equal(statementsForMatch("", { prepared }).length, 0, "kimliksiz sorgu boş dönmeli");
  assert.equal(statementsForMatch("hic-olmayan", { prepared }).length, 0);
}

/**
 * Kayıt yoksa bölüm GİZLENMEZ.
 *
 * Bölümü kaldırmak okuyucuya "böyle bir şey yok" demek olurdu; doğru cümle
 * "henüz doğrulanmış bir kaydımız yok". Ve boş bölüm SAYI TAŞIMAZ:
 * "0 açıklama" bir ölçüm iddiasıdır.
 */
function testAwaitingSectionIsHonest() {
  const html = statementsSection([], { matchLabel: "Ev Takımı - Deplasman Takımı" });

  assert.ok(html.includes("Maç Sonu Açıklamaları"), "başlık korunmalı");
  assert.ok(html.includes("bekleniyor"), "eksiklik açıkça yazılmalı");
  assert.ok(html.includes("Ev Takımı - Deplasman Takımı"), "hangi maç olduğu yazılmalı");
  assert.ok(!/\b0 (açıklama|söz)\b/.test(html), "boş bölüm sayı iddia etmemeli");
  assert.ok(!html.includes("blockquote"), "söz yokken alıntı kutusu basılmamalı");
}

/** Yapılandırılmış veri yalnızca gerçek söz için üretilir. */
function testSchemaOnlyForRealQuotes() {
  assert.deepEqual(statementsSchema([], "https://ornek/x.html"), [], "söz yokken düğüm üretilmemeli");

  const { statements } = publishableStatements({ statements: [VALID] });
  const nodes = statementsSchema(statements, "https://ornek/x.html");
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0]["@type"], "Quotation");
  assert.equal(nodes[0].text, VALID.quote);
  assert.equal(nodes[0].citation, VALID.url);
}

/** HTML kaçışı: söz metni sayfaya ham enjekte edilmemeli. */
function testHtmlIsEscaped() {
  const { statements } = publishableStatements({
    statements: [{ ...VALID, quote: '<script>alert("x")</script> & devamı' }]
  });
  const html = statementsSection(statements);

  assert.ok(!html.includes("<script>alert"), "söz içindeki etiket kaçırılmalı");
  assert.ok(html.includes("&lt;script&gt;"), "kaçırılmış hâli basılmalı");
}

/** Depo dosyası şemaya uymalı ve uydurma söz taşımamalı. */
function testRepositoryFileContract() {
  const file = path.join(root, "data", "statements.json");
  assert.ok(fs.existsSync(file), "data/statements.json bulunmalı");

  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.ok(Array.isArray(parsed.statements), "statements dizisi olmalı");
  assert.ok(Array.isArray(parsed._readme) && parsed._readme.length, "kullanım notu korunmalı");

  // Dosyadaki HER kayıt yayın kuralından geçmeli: kurala uymayan bir kayıt
  // sessizce elenip görünmez olmamalı, depo düzeyinde hata sayılmalı.
  for (const record of readStatements()) {
    const verdict = evaluateStatement(record);
    assert.equal(
      verdict.publishable,
      true,
      `data/statements.json içindeki "${record && record.id}" kaydı kurala uymuyor — ${verdict.reason}`
    );
  }
}

/** Üretilen maç sayfalarında bölüm gerçekten yer almalı. */
function testSectionReachesGeneratedPages() {
  const surfaces = [
    ...listHtml(path.join(root, "mac-raporu")),
    ...listHtml(path.join(root, "mac")).slice(0, 5)
  ];

  assert.ok(surfaces.length, "ön koşul: üretilmiş maç sayfası olmalı");

  for (const file of surfaces) {
    const html = fs.readFileSync(file, "utf8");
    assert.ok(
      html.includes("Maç Sonu Açıklamaları"),
      `${path.relative(root, file)}: Maç Sonu Açıklamaları bölümü eksik`
    );
  }
}

function listHtml(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith(".html"))
    .sort()
    .map((file) => path.join(dir, file));
}

testPublishRule();
testDeduplication();
testQuoteIsNotRewritten();
testStatementsForMatch();
testAwaitingSectionIsHonest();
testSchemaOnlyForRealQuotes();
testHtmlIsEscaped();
testRepositoryFileContract();
testSectionReachesGeneratedPages();

console.log(
  "Match statement tests passed (yayın kuralı, tekilleştirme, söz bütünlüğü, maç süzme, " +
  "veri bekleniyor durumu, yapılandırılmış veri, HTML kaçışı, depo sözleşmesi, sayfa entegrasyonu)."
);
