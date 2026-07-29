/**
 * RADAR SİNYALİ VE DİL KURALI TESTLERİ
 *
 * Sözleşme:
 *   1. Sinyal bir TAHMİN DEĞİL, eldeki kaydın okunuşudur. Her sinyal hangi
 *      ölçüden çıktığını (`basis`) taşır.
 *   2. Ölçü yoksa sinyal de yok: "Veri yetersiz" yazılır, sayı uydurulmaz.
 *   3. Etiketlerde bahis dili geçemez. "banko" ve "kupon" sitenin hiçbir
 *      görünür metninde bulunamaz.
 *   4. Maç kartında oran/yüzde iddiası kalmaz.
 *   5. İstemci (app.js) ile servis (matchSignalService) AYNI etiketleri
 *      kullanır; ayrışırsa kullanıcı JS yüklenmeden önce ve sonra farklı
 *      şeyler okur.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const {
  FORBIDDEN_TERMS,
  SIGNAL_LABELS,
  formPercent,
  isAllowedSignalLabel,
  matchSignal
} = require("../services/matchSignalService.js");

const form = (results) => ({ form: results.map((result) => ({ result })) });
const STRONG = { name: "Güçlü Takım", ...form(["win", "win", "win", "win", "win"]) };
const WEAK = { name: "Zayıf Takım", ...form(["loss", "loss", "loss", "loss", "draw"]) };
const EVEN_A = { name: "A Takımı", ...form(["win", "draw", "loss", "win", "draw"]) };
const EVEN_B = { name: "B Takımı", ...form(["draw", "win", "loss", "draw", "win"]) };

const scheduled = { status: "SCHEDULED", homeTeam: "A Takımı", awayTeam: "B Takımı" };

/** Her etiket dil kuralına uymalı. */
function testEveryLabelIsAllowed() {
  for (const [key, label] of Object.entries(SIGNAL_LABELS)) {
    assert.ok(isAllowedSignalLabel(label), `"${key}" etiketi yasak ifade taşıyor: ${label}`);
    assert.ok(label.trim(), `"${key}" etiketi boş olamaz`);
  }

  // Kural gerçekten çalışıyor mu — yanlış pozitif vermeyen bir denetleyici
  // hiçbir şey denetlemiyor demektir.
  for (const term of FORBIDDEN_TERMS) {
    assert.equal(isAllowedSignalLabel(`Bu ${term} bir ifade`), false, `"${term}" yakalanmalı`);
  }
}

/** Form farkı belirginse avantaj yazılır; hangi tarafta olduğu doğru olmalı. */
function testFormAdvantage() {
  const home = matchSignal(scheduled, { homeTeam: STRONG, awayTeam: WEAK });
  assert.equal(home.label, SIGNAL_LABELS.homeForm);
  assert.ok(home.basis.includes("%"), "hangi ölçüden çıktığı yazılmalı");

  const away = matchSignal(scheduled, { homeTeam: WEAK, awayTeam: STRONG });
  assert.equal(away.label, SIGNAL_LABELS.awayForm);
}

/** Fark küçükse avantaj İDDİA EDİLMEZ. */
function testBalancedFormDoesNotClaimAdvantage() {
  const signal = matchSignal(scheduled, { homeTeam: EVEN_A, awayTeam: EVEN_B });
  assert.equal(signal.label, SIGNAL_LABELS.balanced);
  assert.ok(!signal.label.includes("avantaj"), "yakın formda avantaj iddia edilmemeli");
}

/** İki takımın da gol eğilimi kayıtlıysa okunur; kayıt yoksa üretilmez. */
function testGoalTrendReadOnlyFromRecord() {
  const withTrend = matchSignal(scheduled, {
    homeTeam: { ...EVEN_A, goalTrend: "Pozitif" },
    awayTeam: { ...EVEN_B, goalTrend: "Pozitif" }
  });
  assert.equal(withTrend.label, SIGNAL_LABELS.goals);

  const oneSided = matchSignal(scheduled, {
    homeTeam: { ...EVEN_A, goalTrend: "Pozitif" },
    awayTeam: EVEN_B
  });
  assert.notEqual(oneSided.label, SIGNAL_LABELS.goals, "tek taraflı kayıttan gol eğilimi üretilmemeli");
}

/** Ölçü yoksa sinyal de yok. */
function testInsufficientData() {
  const none = matchSignal(scheduled, {});
  assert.equal(none.label, SIGNAL_LABELS.insufficient);
  assert.ok(!/\d/.test(none.label), "veri yokken etikette sayı olmamalı");

  // İki maçlık seri "form" saymaz: üç maçın altında avantaj çıkarılmaz.
  const thin = matchSignal(scheduled, {
    homeTeam: { name: "A", ...form(["win", "win"]) },
    awayTeam: { name: "B", ...form(["loss", "loss"]) }
  });
  assert.equal(thin.label, SIGNAL_LABELS.insufficient, "iki maçlık seriden avantaj çıkarılmamalı");

  assert.equal(formPercent(null), null, "kayıt yoksa yüzde null olmalı");
  assert.equal(formPercent({ form: [] }), null, "boş seri yüzde üretmemeli");
}

/** Canlı ve biten maçta durum kaydından okunur. */
function testStatusDrivenSignals() {
  const live = matchSignal({ ...scheduled, status: "LIVE" }, { homeTeam: STRONG, awayTeam: WEAK });
  assert.equal(live.label, SIGNAL_LABELS.live);
  assert.equal(live.tone, "live");

  const finished = matchSignal({ ...scheduled, status: "FINISHED" }, {});
  assert.equal(finished.label, SIGNAL_LABELS.finished);

  const reported = matchSignal({ ...scheduled, status: "FINISHED" }, { analysisReady: true });
  assert.equal(reported.label, SIGNAL_LABELS.ready);
}

/** Her sinyal kökenini taşır. */
function testEverySignalCarriesItsBasis() {
  const cases = [
    matchSignal(scheduled, { homeTeam: STRONG, awayTeam: WEAK }),
    matchSignal(scheduled, { homeTeam: EVEN_A, awayTeam: EVEN_B }),
    matchSignal(scheduled, {}),
    matchSignal({ ...scheduled, status: "LIVE" }, {}),
    matchSignal({ ...scheduled, status: "FINISHED" }, { analysisReady: true })
  ];

  for (const signal of cases) {
    assert.ok(signal.basis && signal.basis.trim(), `"${signal.label}" sinyalinin kökeni yazılmamış`);
    assert.ok(signal.tone, `"${signal.label}" sinyalinin tonu yok`);
    assert.ok(isAllowedSignalLabel(signal.label), `"${signal.label}" dil kuralını ihlal ediyor`);
  }
}

/**
 * İSTEMCİ-SERVİS EŞLİĞİ.
 *
 * app.js aynı kuralı tarayıcıda uyguluyor. İki taraf ayrışırsa kullanıcı
 * sayfa yüklenirken bir etiket, JS çalıştıktan sonra başka bir etiket görür.
 */
function testClientLabelsMatchService() {
  const appJs = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const block = appJs.match(/var SIGNAL_LABELS = \{([\s\S]*?)\};/);
  assert.ok(block, "app.js içinde SIGNAL_LABELS bulunamadı");

  const clientLabels = {};
  for (const [, key, value] of block[1].matchAll(/(\w+):\s*"([^"]+)"/g)) {
    clientLabels[key] = value;
  }

  assert.deepEqual(
    clientLabels,
    { ...SIGNAL_LABELS },
    "app.js ve matchSignalService etiketleri ayrışmış"
  );
}

/**
 * MAÇ KARTINDA ORAN YOK.
 *
 * Kartta "Tahmini kazanma · Ev %54" yazan bir çubuk vardı; yüzde bir
 * olasılık iddiasıdır ve kartta oran gibi okunuyordu.
 */
function testCardsCarryNoOdds() {
  const appJs = fs.readFileSync(path.join(root, "app.js"), "utf8");

  // Yorum satırında geçmesi serbest — değişikliğin GEREKÇESİ orada yazılı.
  // Yasak olan, kullanıcıya BASILAN metin: `>Tahmini kazanma<` yalnızca
  // üretilen işaretlemede oluşur.
  assert.ok(!/>\s*Tahmini kazanma\s*</.test(appJs), "maç kartı tahmini kazanma oranı basmamalı");
  assert.ok(!appJs.includes("fixtureProbabilityHtml"), "olasılık çubuğu üreticisi kaldırılmalı");
  assert.ok(!appJs.includes('class="fixture-bar"'), "kartta olasılık çubuğu basılmamalı");

  for (const file of ["index.html", "bugunun-maclari.html", "canli-skor.html"]) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    const html = fs.readFileSync(full, "utf8");
    assert.ok(!html.includes("Tahmini kazanma"), `${file}: kartlarda oran kalmamalı`);
    assert.ok(!html.includes('class="fixture-bar"'), `${file}: olasılık çubuğu kalmamalı`);
  }

  const homepage = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.ok(homepage.includes("fixture-signal"), "kartlarda radar sinyali bulunmalı");
}

/**
 * BAHİS DİLİ YASAĞI — site geneli.
 *
 * "banko" ve "kupon" tek anlamlı bahis terimleridir ve hiçbir görünür
 * metinde bulunamaz. "garanti"/"kesin" ise futbol dilinde meşru kullanımlara
 * sahip ("kesin transfer", "garanti bonservis bedeli", "kesin sonuç vaadi
 * DEĞİLDİR" gibi feragatler); bu yüzden tek kelime olarak değil, İDDİA
 * KALIPLARI olarak yasaklanır.
 */
const BANNED_WORDS = [/\bbanko\b/i, /\bkupon(u|lar|ları)?\b/i];
const BANNED_CLAIMS = [
  /garanti(li)?\s+(kazan|sonuç|maç|skor)/i,
  /kesin\s+(kazan|banko|skor tahmini)/i,
  /\bbanko\s+maç\b/i,
  /kazanç\s+garanti/i
];

function testNoBettingLanguageOnPages() {
  // Kök sayfaların TAMAMI + üretilen maç sayfalarından örnek. Denetim
  // seçilmiş bir listeyle sınırlı kalsaydı, yeni eklenen bir sayfa kuralın
  // dışında kalırdı.
  const pages = [
    ...fs.readdirSync(root).filter((file) => file.endsWith(".html")).map((file) => path.join(root, file)),
    ...listGenerated("mac", 40),
    ...listGenerated("mac-raporu", 40),
    ...listGenerated("oyuncular", 40)
  ];

  assert.ok(pages.length >= 60, "ön koşul: denetlenecek sayfalar üretilmiş olmalı");

  for (const file of pages) {
    const html = fs.readFileSync(file, "utf8");
    const name = path.relative(root, file);

    for (const pattern of BANNED_WORDS) {
      assert.ok(!pattern.test(html), `${name}: yasak bahis terimi bulundu (${pattern})`);
    }
    for (const pattern of BANNED_CLAIMS) {
      assert.ok(!pattern.test(html), `${name}: bahis iddiası kalıbı bulundu (${pattern})`);
    }
  }
}

function listGenerated(relative, limit) {
  const dir = path.join(root, relative);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith(".html"))
    .sort()
    .slice(0, limit)
    .map((file) => path.join(dir, file));
}

/** SEO başlığı ve açıklaması da aynı kurala tabidir. */
function testSeoMetadataIsClean() {
  const pages = fs.readdirSync(root)
    .filter((file) => file.endsWith(".html"))
    .map((file) => path.join(root, file));

  for (const file of pages) {
    const html = fs.readFileSync(file, "utf8");
    const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || "";
    const description = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || "";
    const name = path.relative(root, file);

    for (const field of [["başlık", title], ["açıklama", description]]) {
      for (const pattern of [...BANNED_WORDS, ...BANNED_CLAIMS, /\bgaranti\b/i, /\bkesin\b/i]) {
        assert.ok(
          !pattern.test(field[1]),
          `${name}: meta ${field[0]} bahis dili taşıyor (${pattern}) — "${field[1]}"`
        );
      }
    }
  }
}

testEveryLabelIsAllowed();
testFormAdvantage();
testBalancedFormDoesNotClaimAdvantage();
testGoalTrendReadOnlyFromRecord();
testInsufficientData();
testStatusDrivenSignals();
testEverySignalCarriesItsBasis();
testClientLabelsMatchService();
testCardsCarryNoOdds();
testNoBettingLanguageOnPages();
testSeoMetadataIsClean();

console.log(
  "Match signal tests passed (dil kuralı, form avantajı, denge, gol eğilimi, veri yetersiz, " +
  "durum sinyalleri, köken zorunluluğu, istemci-servis eşliği, oransız kart, bahis dili yasağı)."
);
