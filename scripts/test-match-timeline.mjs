#!/usr/bin/env node
/**
 * CANLI MAÇ ANLATIMI TESTLERİ.
 *
 * Akış, sayfanın okuyucuya "maçta ne oldu" diyen bölümü. Oradaki bir
 * yanlış sessizce yayılır: yanlış bir koşan skor, akıştaki HER satırı
 * yanlış yapar ve hiçbir denetim uyarmaz. Aşağıdaki durumların her biri
 * gerçekten yanlış gidebilecek bir yol:
 *
 *   • kendi kalesine golünün skoru rakibe yazılmaması,
 *   • eksik olay listesinden toplanan skorun tabelayla tutmaması,
 *   • devre arası / maç sonu satırının dayanağı yokken uydurulması,
 *   • sunucunun bastığı işaretlemeyle istemcinin bastığının ayrışması,
 *   • JavaScript kapalıyken çalışmayan bir filtre düğmesi gösterilmesi.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const timeline = require("../services/matchTimeline.js");

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

console.log("match-timeline");

const SIDES = { homeTeam: "Fenerbahçe", awayTeam: "Beşiktaş" };

function goal(minute, team, detail = "Normal Goal", value = "") {
  return { time: `${minute}'`, team: { name: team }, type: "Goal", detail, value };
}

/* ---------------------------------------------------------------- */
/* 1. SINIFLANDIRMA                                                   */
/* ---------------------------------------------------------------- */

test("olay türleri sağlayıcı ve editoryal metinden doğru sınıflanır", () => {
  const kind = (type, detail) => timeline.classifyEvent({ type, detail });
  assert.equal(kind("Goal", "Normal Goal"), "goal");
  assert.equal(kind("Goal", "Own Goal"), "own-goal");
  assert.equal(kind("Goal", "Penalty"), "penalty");
  assert.equal(kind("Goal", "Missed Penalty"), "missed-penalty");
  assert.equal(kind("Card", "Yellow Card"), "yellow");
  assert.equal(kind("Card", "Red Card"), "red");
  assert.equal(kind("Card", "Second Yellow card"), "yellow-red");
  assert.equal(kind("subst", "Substitution 1"), "sub");
  assert.equal(kind("Var", "Goal cancelled"), "var");
  // Türkçe editoryal kayıt da aynı sınıfa iner.
  assert.equal(kind("Gol", "Talisca penaltıdan gol attı"), "penalty");
  assert.equal(kind("Kart", "Sarı kart gördü"), "yellow");
  // Tanınmayan kayıt DÜŞÜRÜLMEZ; "other" olarak korunur.
  assert.equal(kind("Şut", "Direkten döndü"), "other");
});

test("önemli olay kümesi: kart ve değişiklik akışın gürültüsü, gol maçın kendisi", () => {
  assert.ok(timeline.IMPORTANT_KINDS.includes("goal"));
  assert.ok(timeline.IMPORTANT_KINDS.includes("red"));
  assert.ok(timeline.IMPORTANT_KINDS.includes("var"));
  assert.ok(!timeline.IMPORTANT_KINDS.includes("yellow"));
  assert.ok(!timeline.IMPORTANT_KINDS.includes("sub"));
});

/* ---------------------------------------------------------------- */
/* 2. SIRALAMA VE DAKİKA                                              */
/* ---------------------------------------------------------------- */

test("akış dakikaya göre sıralanır; uzatma dakikası kendi dakikasından sonra gelir", () => {
  const items = timeline.buildTimeline({
    events: [goal(90, "Fenerbahçe"), goal("45+2", "Beşiktaş"), goal(45, "Fenerbahçe")]
  }, SIDES);
  assert.deepEqual(items.map((item) => item.minute), ["45'", "45+2'", "90'"]);
});

/* ---------------------------------------------------------------- */
/* 3. KOŞAN SKOR                                                      */
/* ---------------------------------------------------------------- */

test("koşan skor yalnızca tabelayla tutuyorsa yazılır", () => {
  const detail = {
    events: [goal(10, "Fenerbahçe"), goal(40, "Beşiktaş"), goal(70, "Fenerbahçe")],
    score: { home: 2, away: 1 }
  };
  const items = timeline.buildTimeline(detail, SIDES);
  assert.deepEqual(items.map((item) => item.score), ["1-0", "1-1", "2-1"]);
});

test("eksik olay listesinde HİÇBİR satıra skor yazılmaz", () => {
  // Tabela 3-1 diyor ama akışta iki gol var: ilk yarı kayıtları düşmüş.
  // Yarım doğru bir skor, hiç skor olmamasından kötüdür.
  const items = timeline.buildTimeline({
    events: [goal(10, "Fenerbahçe"), goal(40, "Beşiktaş")],
    score: { home: 3, away: 1 }
  }, SIDES);
  assert.deepEqual(items.map((item) => item.score), [undefined, undefined]);
});

test("kendi kalesine golü RAKİBİN hanesine yazılır", () => {
  // Sağlayıcı olayı golü atan oyuncunun takımına iliştirir; skor rakibe
  // işler. Ters yazılsaydı toplam tabelayla tutmaz, koşan skor sessizce
  // hiç görünmezdi.
  const items = timeline.buildTimeline({
    events: [goal(25, "Beşiktaş", "Own Goal")],
    score: { home: 1, away: 0 }
  }, SIDES);
  assert.equal(items[0].kind, "own-goal");
  assert.equal(items[0].side, "away");
  assert.equal(items[0].score, "1-0");
});

test("takımı çözülemeyen gol koşan skoru kilitler", () => {
  const items = timeline.buildTimeline({
    events: [goal(10, "Bilinmeyen Kulüp"), goal(40, "Fenerbahçe")],
    score: { home: 1, away: 1 }
  }, SIDES);
  assert.deepEqual(items.map((item) => item.score), [undefined, undefined]);
});

/* ---------------------------------------------------------------- */
/* 4. DÜDÜK SATIRLARI                                                 */
/* ---------------------------------------------------------------- */

test("devre arası satırı yalnızca ilk yarı skoru kayıtlıysa üretilir", () => {
  const withHalf = timeline.buildTimeline({
    events: [goal(20, "Fenerbahçe")],
    score: { home: 1, away: 0, halftimeHome: 1, halftimeAway: 0 }
  }, SIDES);
  const half = withHalf.find((item) => item.kind === "halftime");
  assert.ok(half, "ilk yarı skoru varken devre arası satırı olmalı");
  assert.equal(half.score, "1-0");

  const without = timeline.buildTimeline({
    events: [goal(20, "Fenerbahçe")],
    score: { home: 1, away: 0 }
  }, SIDES);
  assert.equal(without.find((item) => item.kind === "halftime"), undefined,
    "ilk yarı skoru yokken devre arası UYDURULMAZ");
});

test("maç sonu satırı yalnızca maç bittiyse üretilir", () => {
  const detail = { events: [goal(20, "Fenerbahçe")], score: { home: 1, away: 0 } };
  assert.ok(timeline.buildTimeline(detail, { ...SIDES, finished: true }).some((item) => item.kind === "fulltime"));
  assert.ok(!timeline.buildTimeline(detail, SIDES).some((item) => item.kind === "fulltime"));
});

test("düdük satırları koşan skoru bozmaz", () => {
  const items = timeline.buildTimeline({
    events: [goal(20, "Fenerbahçe"), goal(60, "Beşiktaş")],
    score: { home: 1, away: 1, halftimeHome: 1, halftimeAway: 0 }
  }, { ...SIDES, finished: true });
  const goals = items.filter((item) => timeline.scoresGoal(item.kind));
  assert.deepEqual(goals.map((item) => item.score), ["1-0", "1-1"]);
  assert.equal(items[items.length - 1].kind, "fulltime", "maç sonu en sonda durur");
});

/* ---------------------------------------------------------------- */
/* 5. OYUNCU VE ASİST ÇIKARIMI                                        */
/* ---------------------------------------------------------------- */

test("oyuncu ve asist üç kaynak biçiminden de okunur", () => {
  const provider = timeline.buildTimeline({
    events: [goal(10, "Fenerbahçe", "Normal Goal", "Talisca · Asist: Kerem · Normal Goal")]
  }, SIDES)[0];
  assert.equal(provider.player, "Talisca");
  assert.equal(provider.assist, "Kerem");

  const rawObject = timeline.buildTimeline({
    events: [{ time: "10'", team: { name: "Fenerbahçe" }, type: "Goal", detail: "Normal Goal", player: { name: "Talisca" }, assist: { name: "Kerem" } }]
  }, SIDES)[0];
  assert.equal(rawObject.player, "Talisca");
  assert.equal(rawObject.assist, "Kerem");

  // Editoryal kayıtta ad yok, cümle var: addan ad TÜRETİLMEZ, cümle
  // olduğu gibi taşınır.
  const editorial = timeline.buildTimeline({
    events: [{ time: "37'", team: { name: "Fenerbahçe" }, type: "Gol", detail: "Talisca serbest vuruştan skoru 1-0 yaptı." }]
  }, SIDES)[0];
  assert.equal(editorial.player, "");
  assert.ok(editorial.detail.includes("serbest vuruştan"));
});

test("substitutions kaydı akışa girer ve giren/çıkan ayrı taşınır", () => {
  const items = timeline.buildTimeline({
    substitutions: [{ time: "60'", team: "Fenerbahçe", in: "Giren", out: "Çıkan" }]
  }, SIDES);
  assert.equal(items[0].kind, "sub");
  assert.equal(items[0].playerIn, "Giren");
  assert.equal(items[0].playerOut, "Çıkan");
  assert.equal(items[0].important, false);
});

/* ---------------------------------------------------------------- */
/* 6. ÇİZİM                                                           */
/* ---------------------------------------------------------------- */

test("liste TERS KRONOLOJİK basılır; istenirse artan sıra da verilir", () => {
  const items = timeline.buildTimeline({
    events: [goal(10, "Fenerbahçe"), goal(80, "Beşiktaş")]
  }, SIDES);
  const desc = timeline.timelineListHtml(items, { locale: "tr" });
  assert.ok(desc.indexOf("80&#039;") < desc.indexOf("10&#039;"), "en yeni olay üstte olmalı");
  const asc = timeline.timelineListHtml(items, { locale: "tr", order: "asc" });
  assert.ok(asc.indexOf("10&#039;") < asc.indexOf("80&#039;"));
});

test("her satır diffleme kimliği taşır — animasyon bütün listeye vurmasın", () => {
  const items = timeline.buildTimeline({ events: [goal(10, "Fenerbahçe")] }, SIDES);
  const html = timeline.timelineListHtml(items, { locale: "tr" });
  assert.ok(html.includes('data-event-id="goal|10|fenerbahce|"'));
});

test("filtre çubuğu hidden doğar ve filtrelenecek bir şey yoksa hiç basılmaz", () => {
  const mixed = timeline.buildTimeline({
    events: [goal(10, "Fenerbahçe"), { time: "20'", team: { name: "Beşiktaş" }, type: "Card", detail: "Yellow Card" }]
  }, SIDES);
  const bar = timeline.timelineFilterHtml(mixed, { locale: "tr" });
  assert.ok(bar.includes("hidden"), "JS bağlanmadan düğme gösterilmez");
  assert.ok(bar.includes('data-msp-filter="key"') && bar.includes('data-msp-filter="all"'));

  // Her olayın önemli olduğu maçta "sadece önemliler" hiçbir şeyi
  // değiştirmez; çubuk basılmaz.
  const allKey = timeline.buildTimeline({ events: [goal(10, "Fenerbahçe")] }, SIDES);
  assert.equal(timeline.timelineFilterHtml(allKey, { locale: "tr" }), "");
});

test("önemli olaylar is-key sınıfı taşır — filtre CSS ile çalışır", () => {
  const items = timeline.buildTimeline({
    events: [goal(10, "Fenerbahçe"), { time: "20'", team: { name: "Beşiktaş" }, type: "Card", detail: "Yellow Card" }]
  }, SIDES);
  const html = timeline.timelineListHtml(items, { locale: "tr" });
  assert.ok(/class="msp-event is-goal is-home is-key"/.test(html));
  assert.ok(/class="msp-event is-yellow is-away"/.test(html), "sarı kart önemli sayılmaz");
});

test("boş akışta liste değil, dürüst bir açıklama basılır", () => {
  const body = timeline.timelineBodyHtml([], { locale: "tr" });
  assert.ok(!body.includes("<ol"));
  assert.ok(body.includes("data-msp-events-note"));
  assert.ok(timeline.timelineBodyHtml([], { locale: "tr", emptyText: "Özel metin" }).includes("Özel metin"));
});

test("kullanıcı verisi kaçırılır — akışa HTML enjekte edilemez", () => {
  const items = timeline.buildTimeline({
    events: [{ time: "10'", team: { name: "<img src=x onerror=alert(1)>" }, type: "Goal", detail: "Normal Goal" }]
  }, SIDES);
  const html = timeline.timelineListHtml(items, { locale: "tr" });
  assert.ok(!html.includes("<img"), "takım adı ham HTML olarak basılmamalı");
  assert.ok(html.includes("&lt;img"));
});

test("İngilizce akış Türkçe etiket taşımaz", () => {
  const items = timeline.buildTimeline({ events: [goal(10, "Fenerbahçe")] }, { ...SIDES, locale: "en" });
  const html = timeline.timelineListHtml(items, { locale: "en" });
  assert.ok(html.includes("<em>Goal</em>"));
  assert.ok(!html.includes("Gol<"));
});

/* ---------------------------------------------------------------- */
/* 7. TEK KAYNAK KAPISI                                               */
/* ---------------------------------------------------------------- */

test("tarayıcı kopyası kaynağıyla güncel", () => {
  // Kopya elle düzenlenirse ya da kaynak değişip yeniden üretilmezse,
  // maç sürerken çizilen akışla sunucunun bastığı akış ayrışır.
  execFileSync(process.execPath, ["scripts/build-match-timeline-client.mjs", "--check"], { stdio: "pipe" });
});

if (failures) {
  console.error(`match-timeline: ${failures} test başarısız.`);
  process.exit(1);
}
console.log("match-timeline OK");
