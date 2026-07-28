/**
 * MAÇ SONU AÇIKLAMALARI TESTLERİ
 *
 * Bu içerik sağlayıcıdan gelmiyor; tamamen editoryal ve uydurma riskinin en
 * yüksek olduğu yer. Bir istatistiği yanlış yazmak sayı hatasıdır; bir
 * insanın ağzına söylemediği cümleyi koymak başka bir şeydir.
 *
 * Sözleşme:
 *   1. Atıfsız alıntı yayımlanmaz: kişi, rol, takım, alıntı ve İZLENEBİLİR
 *      kaynak bağlantısı zorunlu.
 *   2. `status` açıkça "verified" değilse kayıt geçmez (varsayılan: geçme).
 *   3. Bilinmeyen rol yuvarlanmaz, kayıt elenir.
 *   4. Maç bitmediyse "maç sonu açıklaması" yayımlanmaz.
 *   5. Doğrulanmış açıklama yoksa bölüm GİZLENMEZ, "Kaynaklardan bekleniyor"
 *      yazar.
 *   6. İstemci (app.js) ile servis aynı kuralı uygular; ön renderde elenen
 *      alıntıyı hidrasyon geri basamaz.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  AWAITING_LABEL,
  ROLE_LABELS,
  evaluateStatement,
  publishableStatements,
  statementTickerItems,
  truncateQuote
} = require("../services/matchStatementsService.js");

const FINISHED_MATCH = {
  id: "test-mac-2026-07-27",
  status: "FINISHED",
  kickoff: "2026-07-27T21:00:00+03:00",
  homeTeam: "Galatasaray",
  awayTeam: "Venezia"
};

const VALID = {
  person: "Test Teknik Direktör",
  role: "manager",
  team: "Galatasaray",
  quote: "Maçın tamamında istediğimiz tempoyu bulamadık.",
  sourceName: "Test Kaynak",
  sourceUrl: "https://example.com/haber",
  publishedAt: "2026-07-27T23:57:00+03:00",
  status: "verified"
};

function withStatements(statements, overrides = {}) {
  return { ...FINISHED_MATCH, ...overrides, statements };
}

// --- 1. Geçerli kayıt yayımlanır ---
{
  const result = publishableStatements(withStatements([VALID]));
  assert.equal(result.statements.length, 1, "geçerli açıklama yayımlanmalı");
  assert.equal(result.awaiting, false, "yayımlanan açıklama varken beklemede olmamalı");

  const [statement] = result.statements;
  for (const field of ["person", "role", "team", "quote", "sourceName", "sourceUrl"]) {
    assert.ok(statement[field], `${field} taşınmalı`);
  }
  assert.equal(statement.roleLabel, ROLE_LABELS.manager, "rol okunur etiketiyle taşınmalı");
}

// --- 2. Atıf zinciri kopuksa yayımlanmaz ---
{
  const cases = [
    [{ ...VALID, sourceUrl: "" }, "kaynak bağlantısı olmayan"],
    [{ ...VALID, sourceUrl: "kaynak-yok" }, "izlenebilir olmayan (http olmayan) bağlantılı"],
    [{ ...VALID, sourceName: "" }, "kaynak adı olmayan"],
    [{ ...VALID, person: "" }, "kişisi olmayan"],
    [{ ...VALID, team: "" }, "takımı olmayan"],
    [{ ...VALID, quote: "" }, "alıntısı olmayan"]
  ];

  for (const [statement, label] of cases) {
    const result = publishableStatements(withStatements([statement]));
    assert.equal(result.statements.length, 0, `${label} açıklama yayımlanmamalı`);
    assert.equal(result.excluded.length, 1, `${label} açıklama gerekçesiyle elenmiş olmalı`);
    assert.ok(result.excluded[0].reason, "eleme gerekçesi yazılmalı");
  }
}

// --- 3. Doğrulanmamış kayıt geçmez; varsayılan yayımlamamaktır ---
{
  for (const status of ["", "pending", "rumour", "draft", undefined]) {
    const result = publishableStatements(withStatements([{ ...VALID, status }]));
    assert.equal(result.statements.length, 0, `status "${status}" yayımlanmamalı`);
  }
}

// --- 4. Bilinmeyen rol yuvarlanmaz ---
{
  for (const role of ["yetkili", "başkan", "menajer", "", null]) {
    const verdict = evaluateStatement({ ...VALID, role });
    assert.equal(verdict.ok, false, `bilinmeyen rol "${role}" kabul edilmemeli`);
  }

  // Tanınan yazım varyantları kabul edilir.
  for (const [role, expected] of [["Teknik Direktör", "manager"], ["futbolcu", "player"], ["coach", "manager"]]) {
    const verdict = evaluateStatement({ ...VALID, role });
    assert.equal(verdict.ok, true, `"${role}" tanınmalı`);
    assert.equal(verdict.statement.role, expected, `"${role}" -> ${expected} çözümlenmeli`);
  }
}

// --- 5. Maç bitmediyse açıklama yayımlanmaz ---
{
  for (const status of ["SCHEDULED", "LIVE", "HT", "POSTPONED"]) {
    const result = publishableStatements(withStatements([VALID], { status }));
    assert.equal(result.statements.length, 0, `"${status}" durumundaki maçta açıklama yayımlanmamalı`);
    assert.equal(result.awaiting, true, `"${status}" durumunda bölüm beklemede olmalı`);
  }
}

// --- 6. Tekrarlanan alıntı bir kez görünür ---
{
  const result = publishableStatements(withStatements([VALID, { ...VALID }]));
  assert.equal(result.statements.length, 1, "aynı kişinin aynı alıntısı tekrarlanmamalı");
  assert.equal(result.excluded.length, 1, "tekrar elenmiş olarak kaydedilmeli");
}

// --- 7. Hiç açıklama yoksa bölüm gizlenmez, beklemede olur ---
{
  const result = publishableStatements(withStatements([]));
  assert.equal(result.awaiting, true, "açıklama yokken beklemede olmalı");
  assert.equal(result.awaitingLabel, "Kaynaklardan bekleniyor", "bekleme metni sözleşmedeki gibi olmalı");
  assert.equal(AWAITING_LABEL, "Kaynaklardan bekleniyor", "servis sabiti sözleşmedeki metni taşımalı");
}

// --- 8. Bant alıntıyı kelime ortasından kesmez ---
{
  const long = `${"kelime ".repeat(40)}son`;
  const short = truncateQuote(long);
  assert.ok(short.length <= 125, "bant alıntısı kısaltılmalı");
  assert.ok(short.endsWith("…"), "kısaltılan alıntı üç nokta ile bitmeli");
  assert.ok(!/\s…$/.test(short), "üç noktadan önce boşluk kalmamalı");
  assert.equal(truncateQuote("Kısa alıntı."), "Kısa alıntı.", "sığan alıntı kırpılmamalı");

  // Kelime ortasından kesilmemeli: kırpılan metin, orijinalin tam kelimeyle
  // biten bir ön eki olmalı.
  const stem = short.slice(0, -1);
  assert.ok(long.startsWith(stem), "kırpılan metin orijinalin ön eki olmalı");
  assert.ok(
    long.charAt(stem.length) === " " || stem.length === 120,
    "kırpma tam kelimede durmalı"
  );
}

// --- 9. Bant yalnızca bitmiş maçlardan beslenir ve bağlantı üretir ---
{
  const upcoming = withStatements([VALID], { id: "gelecek", status: "SCHEDULED", kickoff: "2026-08-01T21:00:00+03:00" });
  const feed = statementTickerItems([upcoming, withStatements([VALID])], {
    limit: 5,
    href: (match) => `mac-raporu/${match.id}.html`
  });

  assert.equal(feed.items.length, 1, "yalnızca bitmiş maçın açıklaması banda girmeli");
  assert.equal(feed.items[0].href, `mac-raporu/${FINISHED_MATCH.id}.html`, "bant öğesi maç sayfasına bağlanmalı");
  assert.ok(feed.items[0].attribution.includes(ROLE_LABELS.manager), "bant öğesi rolü göstermeli");
  assert.ok(feed.items[0].attribution.includes("Galatasaray"), "bant öğesi takımı göstermeli");
  assert.ok(feed.items[0].sourceUrl, "bant öğesi kaynağını taşımalı");
}

// --- 10. İstemci (app.js) servisle aynı kuralı uygular ---
{
  const app = fs.readFileSync("app.js", "utf8");

  assert.ok(
    app.includes(`"${AWAITING_LABEL}"`),
    `app.js bekleme metnini servisle aynı yazmalı ("${AWAITING_LABEL}")`
  );
  assert.ok(app.includes("function publishableStatements"), "istemcide açıklama süzgeci bulunmalı");

  const start = app.indexOf("function publishableStatements");
  const body = app.slice(start, start + 2200);

  // Aynı zorunlu alanlar ve aynı kapılar istemcide de olmalı.
  for (const needle of ["sourceUrl", "sourceName", "verified", "statementRole"]) {
    assert.ok(body.includes(needle), `istemci süzgeci "${needle}" kontrolünü içermeli`);
  }
  assert.ok(/https\?:\\\/\\\//.test(body) || body.includes("^https?:"), "istemci izlenebilir kaynak bağlantısı aramalı");

  for (const role of Object.keys(ROLE_LABELS)) {
    assert.ok(app.includes(`${role}: "${ROLE_LABELS[role]}"`), `istemci "${role}" rol etiketini servisle aynı yazmalı`);
  }
}

// --- 11. Depodaki veri: yayımlanan her alıntının kaynağı var ---
{
  const matches = JSON.parse(fs.readFileSync("data/matches.json", "utf8"));
  let published = 0;

  for (const match of matches) {
    const result = publishableStatements(match);
    for (const statement of result.statements) {
      assert.ok(/^https?:\/\//.test(statement.sourceUrl), `${match.id}: yayımlanan alıntının kaynağı izlenebilir olmalı`);
      assert.ok(statement.person && statement.team && statement.quote, `${match.id}: zorunlu alanlar dolu olmalı`);
      assert.ok(ROLE_LABELS[statement.role], `${match.id}: rol tanınan bir değer olmalı`);
      published += 1;
    }
  }

  assert.ok(published > 0, "en az bir doğrulanmış açıklama veri kümesinde bulunmalı");
}

// --- 12. Üretilen sayfa asla sessizce boş kalmaz ---
{
  const reportDir = "mac-raporu";
  const files = fs.existsSync(reportDir) ? fs.readdirSync(reportDir).filter((file) => file.endsWith(".html")) : [];
  assert.ok(files.length, "ön koşul: maç raporu sayfaları üretilmiş olmalı");

  for (const file of files) {
    const html = fs.readFileSync(`${reportDir}/${file}`, "utf8");
    assert.ok(html.includes('data-card="match-statements"'), `${file}: kayan şerit basılmalı`);
    assert.ok(html.includes('id="rapor-aciklama"'), `${file}: tam liste bölümü basılmalı`);

    const hasCards = html.includes("statement-card");
    const hasAwaiting = html.includes(AWAITING_LABEL);
    assert.ok(hasCards || hasAwaiting, `${file}: ya alıntı ya bekleme metni olmalı, sessiz boşluk olmamalı`);
  }

  const home = fs.readFileSync("index.html", "utf8");
  assert.ok(home.includes('data-card="match-statements"'), "ana sayfada kayan şerit bulunmalı");
}

console.log("Match statements tests passed (atıfsız alıntı geçmez, doğrulanmamış geçmez, rol yuvarlanmaz, maç bitmeden yayımlanmaz, tekrar elenir, bekleme metni, istemci-servis eşliği, üretilen sayfa boş kalmaz).");
