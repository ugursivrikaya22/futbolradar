#!/usr/bin/env node
/**
 * AI MAÇ MERKEZİ — SÖZLEŞME DENETİMİ.
 *
 * Bu yüzeyde sessizce bozulabilecek şeyler bellidir ve hiçbiri gözle fark
 * edilmez:
 *
 *   • Bir bileşen bir dile eklenir, diğerine eklenmez (TR/EN ayrışması).
 *   • Sözlükte bir anahtar eksik kalır; kullanıcı `undefined` görür.
 *   • Veri yokken bir bölüm yine de çizilir ve boş kutu ya da uydurma
 *     cümle ekrana düşer.
 *   • Canlı istemci kendi yoklamasını açar ve skor akışını yavaşlatır.
 *   • Sekme, JavaScript kapalıyken içeriği erişilemez hâle getirir.
 *
 * Beşi de burada mekanik olarak sınanır. Ağ gerekmez: saf kurallar
 * sentetik veriyle, kapsam denetimi üretilmiş ağaçla doğrulanır.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
  AI_STR,
  aiMatchCenterPanelHtml,
  tabsHtml,
  outcomeHtml,
  driversHtml,
  confidenceHtml,
  formHtml,
  attackDefenseHtml,
  absenceHtml,
  lineupHtml,
  h2hHtml,
  summaryHtml,
  liveShellHtml
} from "./lib/aiMatchCenter.mjs";

const require = createRequire(import.meta.url);
const { buildAiMatchCenter, THRESHOLDS, DRIVER_ORDER } = require("../services/aiMatchCenter.js");

const root = process.cwd();
const LOCALES = ["tr", "en"];
let passed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (error) {
    console.error(`  FAIL ${name}\n      ${error.message}`);
    process.exitCode = 1;
  }
}

function read(relative) {
  const full = path.join(root, relative);
  return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : "";
}

console.log("ai-match-center");

/* ------------------------------------------------------------------ */
/* 1. SÖZLÜK EŞLİĞİ — iki dil aynı anahtarları taşır                    */
/* ------------------------------------------------------------------ */

/** İç içe sözlükleri de kapsayan düz anahtar listesi. */
function flatKeys(value, prefix = "") {
  if (!value || typeof value !== "object") return [];
  return Object.keys(value).flatMap((key) => {
    const child = value[key];
    const full = prefix ? `${prefix}.${key}` : key;
    return child && typeof child === "object" && typeof child !== "function"
      ? [full, ...flatKeys(child, full)]
      : [full];
  });
}

check("sözlük: her anahtar iki dilde de var ve aynı türde", () => {
  const trKeys = flatKeys(AI_STR.tr).sort();
  const enKeys = flatKeys(AI_STR.en).sort();
  const missingInEn = trKeys.filter((key) => !enKeys.includes(key));
  const missingInTr = enKeys.filter((key) => !trKeys.includes(key));
  assert.deepEqual(missingInEn, [], `en'de eksik: ${missingInEn.join(", ")}`);
  assert.deepEqual(missingInTr, [], `tr'de eksik: ${missingInTr.join(", ")}`);

  // Tür de eşleşmeli: bir dilde metin, diğerinde fonksiyon olan anahtar
  // çağrıldığı yerde `[object Function]` basar.
  const typeAt = (dict, key) => key.split(".").reduce((node, part) => (node ? node[part] : undefined), dict);
  for (const key of trKeys) {
    assert.equal(typeof typeAt(AI_STR.tr, key), typeof typeAt(AI_STR.en, key), `tür ayrışması: ${key}`);
  }
});

check("sözlük: hiçbir dizge boş değil (ham anahtar sızmaz)", () => {
  for (const locale of LOCALES) {
    for (const key of flatKeys(AI_STR[locale])) {
      const value = key.split(".").reduce((node, part) => (node ? node[part] : undefined), AI_STR[locale]);
      if (typeof value === "string") {
        assert.ok(value.trim().length > 0, `${locale}.${key} boş`);
      }
    }
  }
});

check("sözlük: her sürücü anahtarının iki dilde etiketi ve birimi var", () => {
  for (const locale of LOCALES) {
    for (const key of DRIVER_ORDER) {
      assert.ok(AI_STR[locale].driverLabels[key], `${locale}: ${key} etiketi yok`);
      assert.ok(AI_STR[locale].driverUnits[key], `${locale}: ${key} birimi yok`);
    }
  }
});

/* ------------------------------------------------------------------ */
/* 2. MOTOR — VERİ YOKSA BİLEŞEN DE YOK                                 */
/* ------------------------------------------------------------------ */

check("motor: girdi yokken hiçbir bileşen üretilmez", () => {
  const model = buildAiMatchCenter({});
  assert.equal(model.available, false, "boş girdide panel açılmamalı");
  assert.equal(model.outcome, null);
  assert.equal(model.confidence, null);
  assert.deepEqual(model.drivers, []);
  assert.equal(model.form, null);
  assert.equal(model.absence, null);
  assert.equal(model.lineup, null);
  assert.equal(model.attackDefense, null);
  assert.equal(model.h2h, null);
  assert.equal(model.coverage.present.length, 0);
});

check("motor: tek taraflı ölçüm sürücü doğurmaz", () => {
  // Yalnızca ev sahibinin hücum gücü biliniyor: karşılaştırma yapılamaz.
  const model = buildAiMatchCenter({
    modelPrediction: { inputs: { home: { attackStrength: 1.4 }, away: {} } }
  });
  assert.deepEqual(model.drivers.map((driver) => driver.key), [], "eksik tarafla sürücü üretilmemeli");
});

check("motor: eksik BİLDİRİMİ yoksa 'eksik yok' iddia edilmez", () => {
  const model = buildAiMatchCenter({ absences: { home: null, away: null } });
  assert.equal(model.absence, null, "bildirim yokluğu, eksik yokluğu olarak yazılmamalı");
});

check("motor: sürücü eşikleri belgelenen ölçekten okunur", () => {
  const strong = buildAiMatchCenter({
    modelPrediction: {
      inputs: {
        home: { attackStrength: 1.4, defenseStrength: 0.8 },
        away: { attackStrength: 1.4 - THRESHOLDS.strength.strong, defenseStrength: 0.8 }
      }
    }
  });
  const attack = strong.drivers.find((driver) => driver.key === "attack");
  assert.equal(attack.strength, "strong");
  assert.equal(attack.lean, "home");

  // Savunmada DÜŞÜK sayı iyidir: eşit hücumda savunması iyi olan öne geçer.
  const defense = strong.drivers.find((driver) => driver.key === "defense");
  assert.equal(defense.strength, "balanced", "iki savunma eşitken sürücü dengeli olmalı");

  const balanced = buildAiMatchCenter({
    modelPrediction: { inputs: { home: { attackStrength: 1 }, away: { attackStrength: 1.01 } } }
  });
  assert.equal(balanced.drivers.find((driver) => driver.key === "attack").strength, "balanced");
});

check("motor: savunmada düşük sayı üstünlük sayılır", () => {
  const model = buildAiMatchCenter({
    modelPrediction: { inputs: { home: { defenseStrength: 0.7 }, away: { defenseStrength: 1.3 } } }
  });
  const defense = model.drivers.find((driver) => driver.key === "defense");
  assert.equal(defense.lean, "home", "az gol yiyen taraf lehine okunmalı");
  assert.equal(defense.strength, "strong");
});

check("motor: maç bitince kazanma olasılığı taşınmaz", () => {
  // Bitmiş maçta jeneratör zaten `null` olasılık geçirir; motor da
  // yüzdesiz çalışabilmeli ve özetini skordan kurabilmeli.
  const model = buildAiMatchCenter({ state: "post", result: { home: 2, away: 1 }, forms: { home: [{ result: "W", label: "x" }] } });
  assert.equal(model.outcome, null);
  assert.deepEqual(model.summary.result, { home: 2, away: 1 });
});

check("motor: hiç sürücü ölçülmediyse 'başa baş' iddia edilmez", () => {
  // Ölçülmüş girdi yokken "dengeli maç" demek, ölçmediğimiz bir şey
  // hakkında hüküm vermektir; özet o durumda yalnızca skoru yazar.
  const nothing = buildAiMatchCenter({ state: "post", result: { home: 3, away: 2 } });
  assert.equal(nothing.drivers.length, 0);
  assert.equal(nothing.summary.balanced, false, "ölçüm yokken başa baş denmemeli");

  // Ölçüldü ve gerçekten fark yoksa, bunu söylemek veriye dayanır.
  const measured = buildAiMatchCenter({
    modelPrediction: { inputs: { home: { attackStrength: 1 }, away: { attackStrength: 1.01 } } }
  });
  assert.ok(measured.drivers.length > 0);
  assert.equal(measured.summary.balanced, true, "ölçülüp fark çıkmadıysa başa baş denebilir");
});

check("motor: ikili rekabet 2 maçtan az örneklemde sürücü olmaz", () => {
  const thin = buildAiMatchCenter({ modelPrediction: { inputs: { h2h: { sampleSize: 1, averageGoalDifference: 2 } } } });
  assert.equal(thin.drivers.find((driver) => driver.key === "h2h"), undefined);
  const enough = buildAiMatchCenter({ modelPrediction: { inputs: { h2h: { sampleSize: 3, averageGoalDifference: 1.5 } } } });
  assert.equal(enough.drivers.find((driver) => driver.key === "h2h").lean, "home");
});

/* ------------------------------------------------------------------ */
/* 3. ÇİZİM — İKİ DİL AYNI BİLEŞENLERİ ÜRETİR                           */
/* ------------------------------------------------------------------ */

/** Gerçekçi, tam dolu bir okuma: her bileşenin verisi var. */
function fullModel() {
  return buildAiMatchCenter({
    state: "pre",
    probability: { source: "futbolradar_model", probabilities: { home: 52, draw: 26, away: 22 }, confidence: 68 },
    modelPrediction: {
      confidence: 68,
      expectedGoals: { home: 1.8, away: 1.1 },
      inputs: {
        baselineStatus: "computed",
        rankDelta: 0.4,
        h2h: { sampleSize: 4, averageGoalDifference: 0.75 },
        home: { matches: 12, venueMatches: 6, attackStrength: 1.3, defenseStrength: 0.8, formDelta: 0.5, rank: 2, pointsPerGame: 2.1, cleanSheetRate: 0.5, winRate: 0.66, absences: 2 },
        away: { matches: 11, venueMatches: 5, attackStrength: 0.9, defenseStrength: 1.2, formDelta: -0.3, rank: 9, pointsPerGame: 1.2, cleanSheetRate: 0.2, winRate: 0.33, absences: 4 }
      }
    },
    forms: {
      home: [{ result: "W", label: "A 2-0 B" }, { result: "D", label: "C 1-1 A" }],
      away: [{ result: "L", label: "B 0-3 D" }]
    },
    absences: {
      home: { count: 2, players: [{ name: "Oyuncu Bir", status: "injured" }] },
      away: { count: 4, players: [{ name: "Player Two", status: "suspended" }] }
    },
    lineups: {
      home: { status: "predicted", formation: "4-2-3-1", count: 11, missingKeyPlayers: ["Kilit Oyuncu"] },
      away: { status: "official", formation: "4-4-2", count: 11, missingKeyPlayers: [] }
    },
    h2h: {
      entries: [{ date: "2026-03-01T18:00:00+03:00", homeTeam: "Ev", awayTeam: "Dep", homeGoals: 2, awayGoals: 1 }],
      homeWins: 1, draws: 0, awayWins: 0
    }
  });
}

const ctxFor = (locale, extra = {}) => ({
  locale,
  state: "pre",
  homeTeam: "Ev Takımı",
  awayTeam: "Away Team",
  sourceLabel: "⚡ Model",
  shortDate: () => "1 Mart 2026",
  ...extra
});

check("çizim: dolu okumada iki dil AYNI bileşen kümesini basar", () => {
  const model = fullModel();
  const blocksOf = (html) => [...html.matchAll(/class="ai-block ([a-z0-9-]+)"/g)].map((match) => match[1]).sort();
  const tr = blocksOf(aiMatchCenterPanelHtml(model, ctxFor("tr")));
  const en = blocksOf(aiMatchCenterPanelHtml(model, ctxFor("en")));
  assert.ok(tr.length >= 9, `beklenen bileşenler çizilmedi: ${tr.join(", ")}`);
  assert.deepEqual(tr, en, "TR ve EN farklı bileşen kümesi üretti");
});

check("çizim: her bölüm işlevi veri yokken BOŞ DİZE döner", () => {
  for (const locale of LOCALES) {
    const ctx = ctxFor(locale);
    assert.equal(outcomeHtml(null, ctx), "");
    assert.equal(driversHtml([], ctx), "");
    assert.equal(confidenceHtml(null, ctx), "");
    assert.equal(formHtml(null, ctx), "");
    assert.equal(attackDefenseHtml(null, ctx), "");
    assert.equal(absenceHtml(null, ctx), "");
    assert.equal(lineupHtml(null, ctx), "");
    assert.equal(h2hHtml(null, ctx), "");
    assert.equal(summaryHtml(null, ctx), "");
    // Canlı kabuk yalnızca maç öncesi ve canlı sayfada basılır.
    assert.equal(liveShellHtml({ ...ctx, state: "post" }), "");
    assert.ok(liveShellHtml({ ...ctx, state: "live" }).includes("ai-live"));
  }
});

check("çizim: veri yokken panel dürüst bir not basar, boş kutu basmaz", () => {
  for (const locale of LOCALES) {
    const html = aiMatchCenterPanelHtml(buildAiMatchCenter({}), ctxFor(locale));
    assert.ok(html.includes("data-empty"), "boş durumda dürüst not bekleniyor");
    assert.ok(html.includes(AI_STR[locale].empty));
    assert.ok(!html.includes("ai-outcome"), "veri yokken yüzde çizilmemeli");
    assert.ok(!/undefined|NaN|\[object/.test(html), "ham değer sızmış");
  }
});

check("çizim: hiçbir dilde ham değer (undefined/NaN) sızmıyor", () => {
  const model = fullModel();
  for (const locale of LOCALES) {
    const html = aiMatchCenterPanelHtml(model, ctxFor(locale));
    assert.ok(!/undefined|NaN|\[object Object\]/.test(html), `${locale}: ham değer sızmış`);
  }
});

check("çizim: güven ham yüzdesi ekrana yazılmaz, düzey adı yazılır", () => {
  const model = fullModel();
  for (const locale of LOCALES) {
    const html = confidenceHtml(model.confidence, ctxFor(locale));
    assert.ok(html.includes(AI_STR[locale].confidenceLevels[model.confidence.level]), "düzey adı olmalı");
    assert.ok(!/data-ai-confidence-score/.test(html), "ham güven yüzdesi basılmamalı");
  }
});

check("çizim: canlı maçta yüzdeler 'maç öncesi okuma' diye etiketlenir", () => {
  const model = fullModel();
  for (const locale of LOCALES) {
    const html = outcomeHtml(model.outcome, ctxFor(locale, { state: "live" }));
    assert.ok(html.includes(AI_STR[locale].livePreReading), "canlıda maç öncesi uyarısı olmalı");
  }
});

check("çizim: sayı biçimi dile göre değişir (TR virgül, EN nokta)", () => {
  const model = fullModel();
  assert.ok(attackDefenseHtml(model.attackDefense, ctxFor("tr")).includes("1,30"), "TR ondalık ayracı virgül olmalı");
  assert.ok(attackDefenseHtml(model.attackDefense, ctxFor("en")).includes("1.30"), "EN ondalık ayracı nokta olmalı");
});

/* ------------------------------------------------------------------ */
/* 4. SEKME — JS'SİZ ÇALIŞIR, İÇERİK DOM'DA KALIR                       */
/* ------------------------------------------------------------------ */

check("sekme: radyo + label kalıbı, paneller <section> olarak basılır", () => {
  const html = tabsHtml([
    { id: "mac", label: "Maç", panel: "<p>maç</p>", checked: true },
    { id: "ai", label: "AI", badge: "PRO", panel: "<p>ai</p>" }
  ], { locale: "tr" });
  assert.ok(html.includes('type="radio"'), "seçim radyo ile yapılmalı (JS'siz çalışsın)");
  assert.ok(html.includes('role="tablist"') && (html.match(/role="tab"/g) || []).length === 2);
  // CSS `section:nth-of-type(n)` ile seçtiği için paneller <section> olmalı.
  assert.equal((html.match(/<section class="ai-tab-panel"/g) || []).length, 2, "paneller <section> olmalı");
  assert.ok(html.includes("<p>maç</p>") && html.includes("<p>ai</p>"), "iki panelin içeriği de DOM'da kalmalı");
  assert.ok(!html.includes("hidden"), "panel `hidden` ile kaldırılmamalı — SSR içeriği erişilebilir kalsın");
  assert.ok(html.indexOf('type="radio"') < html.indexOf('class="ai-tablist"'), "radyolar kardeş seçici için önce gelmeli");
});

check("sekme: tek panel verilirse sekme kabuğu kurulmaz", () => {
  const html = tabsHtml([{ id: "mac", label: "Maç", panel: "<p>tek</p>" }], { locale: "tr" });
  assert.equal(html, "<p>tek</p>", "tek bölümde gereksiz sekme çizilmemeli");
});

/* ------------------------------------------------------------------ */
/* 5. STİL DOSYASI — KAPANMAMIŞ BLOK YOK                                */
/* ------------------------------------------------------------------ */

check("page.css: kapanmamış kural yok (sessiz stil yutulması)", () => {
  // NEDEN BU TEST VAR: bir kuralın kapanış süslü parantezi düşerse CSS
  // ayrıştırıcısı ondan SONRAKİ bütün bildirimleri o açık bloğun içine
  // yutar ve dosyanın geri kalanı hiç uygulanmaz. Hata mesajı yoktur,
  // sayfa açılır, yalnızca stiller sessizce kaybolur — bu depoda tam
  // olarak bu oldu ve ~1000 satırlık kuyruk (canlı puan durumu rozetleri
  // dahil) uygulanmıyordu. Gözle bulunmaz, testle bulunur.
  const css = read("page.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const open = (css.match(/\{/g) || []).length;
  const close = (css.match(/\}/g) || []).length;
  assert.equal(open - close, 0, `${open - close} kural kapanmamış — sonraki tüm stiller yutulur`);
});

check("page.css: AI Maç Merkezi blokları dosyada ve kök bağlamda", () => {
  const css = read("page.css");
  for (const selector of [".ai-tab-panel", ".ai-tablist", ".ai-block", ".ai-outcome-bar", ".ai-why-row", ".ai-live-prob"]) {
    assert.ok(css.includes(selector), `${selector} kuralı yok`);
  }
  // Mobil öncelikli: tek sütun kuralı medya sorgusunun DIŞINDA olmalı.
  const gridIndex = css.indexOf(".ai-grid { display: grid;");
  const desktopIndex = css.indexOf("@media (min-width: 720px)", gridIndex);
  assert.ok(gridIndex > 0 && desktopIndex > gridIndex, "ızgara tanımı masaüstü sorgusundan önce gelmeli (mobil öncelikli)");
});

/* ------------------------------------------------------------------ */
/* 5. CANLI İSTEMCİ — YENİ YOKLAMA AÇMAZ                                */
/* ------------------------------------------------------------------ */

check("canlı istemci: kendi ağ isteğini atmaz, mevcut olaya abone olur", () => {
  const source = read("ai-match-center.js");
  assert.ok(source, "ai-match-center.js yok");
  assert.ok(source.includes('addEventListener("futbolradar:match-detail"'), "mevcut yayına abone olmalı");
  // Tek bir istek ya da zamanlayıcı bile skor akışına yük bindirir.
  assert.ok(!/\bfetch\s*\(/.test(source), "kendi fetch'ini açmamalı");
  assert.ok(!/XMLHttpRequest|EventSource|navigator\.sendBeacon/.test(source), "kendi bağlantısını açmamalı");
  assert.ok(!/setInterval\s*\(/.test(source), "kendi yoklama döngüsünü kurmamalı");
  assert.ok(source.includes("requestIdleCallback"), "çizim boşta zamana ertelenmeli");
});

check("canlı istemci: skordan kazanma olasılığı TÜRETMEZ", () => {
  const source = read("ai-match-center.js");
  // Tek meşru kaynak sunucuda denetlenmiş radarPulse.winProbability'dir.
  assert.ok(source.includes("winProbability"), "soket okunmalı");
  assert.ok(source.includes("1.5"), "toplam denetimi (100±1.5) istemcide de yapılmalı");
  assert.ok(!/poisson|elo|expScore|Math\.exp\s*\(/i.test(source), "istemcide olasılık modeli kurulmamalı");
});

check("canlı istemci: skor yolu boyandıktan sonra çalışır (passive abone)", () => {
  const source = read("ai-match-center.js");
  assert.ok(source.includes("{ passive: true }"), "dinleyici passive olmalı");
  const center = read("match-center.js");
  assert.ok(center.includes("futbolradar:match-detail"), "yayın match-center.js'de olmalı");
  // Yayın render()'ın SONUNDA: skor önce boyanır, abone sonra çalışır.
  assert.ok(center.indexOf("renderPulse(detail, status)") < center.indexOf('CustomEvent("futbolradar:match-detail"'),
    "olay, skor çizimi bittikten sonra yayınlanmalı");
});

/* ------------------------------------------------------------------ */
/* 6. ÜRETİLMİŞ AĞAÇ — TR VE EN SAYFALAR BİREBİR AYNI KAPSAMI TAŞIR      */
/* ------------------------------------------------------------------ */

const seo = require("../services/matchSeoPages.js");
const registry = seo.loadRegistry();
const pages = Array.isArray(registry.pages) ? registry.pages : [];

check("üretilmiş ağaç: her maç sayfasında AI sekmesi ve PRO rozeti var", () => {
  assert.ok(pages.length, "sicil boş");
  let checked = 0;
  for (const entry of pages.slice(0, 40)) {
    for (const [locale, relative] of [["tr", seo.trPagePath(entry.slug)], ["en", seo.enPagePath(entry.enSlug)]]) {
      const html = read(relative);
      if (!html) continue;
      checked += 1;
      assert.ok(html.includes("data-ai-match-center"), `${relative}: AI paneli yok`);
      assert.ok(html.includes('id="msp-tab-ai"'), `${relative}: AI sekmesi yok`);
      assert.ok(html.includes(AI_STR[locale].tabAi), `${relative}: sekme etiketi yok`);
      assert.ok(html.includes(AI_STR[locale].title), `${relative}: panel başlığı yok`);
      assert.ok(html.includes(AI_STR[locale].proFree), `${relative}: PRO ücretsiz notu yok`);
      assert.ok(html.includes("ai-match-center.js"), `${relative}: canlı istemci yüklenmiyor`);
    }
  }
  assert.ok(checked > 0, "hiçbir üretilmiş sayfa okunamadı");
});

check("üretilmiş ağaç: TR ve EN sayfa AYNI AI bileşenlerini taşır", () => {
  const blocksOf = (html) => [...html.matchAll(/class="ai-block ([a-z0-9-]+)"/g)].map((match) => match[1]).sort().join(",");
  let compared = 0;
  const mismatches = [];
  for (const entry of pages) {
    const tr = read(seo.trPagePath(entry.slug));
    const en = read(seo.enPagePath(entry.enSlug));
    if (!tr || !en) continue;
    compared += 1;
    if (blocksOf(tr) !== blocksOf(en)) mismatches.push(entry.slug);
  }
  assert.ok(compared > 100, `karşılaştırılan sayfa az: ${compared}`);
  assert.deepEqual(mismatches.slice(0, 5), [], `${mismatches.length} maçta TR/EN bileşenleri ayrıştı`);
});

check("üretilmiş ağaç: AI panelinde sabit piksel genişlik yok (mobil güvenlik)", () => {
  for (const entry of pages.slice(0, 30)) {
    for (const relative of [seo.trPagePath(entry.slug), seo.enPagePath(entry.enSlug)]) {
      const html = read(relative);
      if (!html) continue;
      const panel = html.slice(html.indexOf("data-ai-match-center"));
      assert.ok(!/style="[^"]*width:\s*\d{3,}px/.test(panel), `${relative}: AI panelinde sabit px genişlik`);
      // Barların genişliği yalnızca yüzde olabilir.
      for (const match of panel.matchAll(/style="width:([^"]+)"/g)) {
        assert.match(match[1], /^\d+(\.\d+)?%$/, `${relative}: bar genişliği yüzde olmalı (${match[1]})`);
      }
    }
  }
});

check("üretilmiş ağaç: bitmiş maçta kazanma olasılığı gösterilmiyor", () => {
  let seen = 0;
  for (const entry of pages) {
    const relative = seo.trPagePath(entry.slug);
    const html = read(relative);
    if (!html || !html.includes('data-msp-state="post"')) continue;
    seen += 1;
    const panel = html.slice(html.indexOf("data-ai-match-center"));
    assert.ok(!panel.includes("ai-outcome"), `${relative}: bitmiş maçta yüzde basılmış`);
    if (seen > 40) break;
  }
  assert.ok(seen > 0, "bitmiş maç sayfası bulunamadı");
});

console.log(`ai-match-center: ${passed} denetim geçti`);
