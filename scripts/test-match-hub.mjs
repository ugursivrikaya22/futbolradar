#!/usr/bin/env node
/**
 * MAÇ MERKEZİ TESTLERİ.
 *
 * Bu testlerin varlık nedeni tek bir kural: EKSİK VERİ UYDURULMAZ. Maç
 * sayfası okuyucuya "şu anda ne oluyor" diyen bir yüzey; oradaki bir
 * yanlış — olmayan bir kanal, hesaplanmamış bir yüzde, yanlış ligin
 * tablosu — sessizce yayılır. Aşağıdaki durumların HER BİRİ daha önce
 * gerçekten yanlış gidebilecek bir yol.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const hub = require("../services/matchHub.js");
const liveStandings = require("../services/liveStandings.js");

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

console.log("match-hub");

/* ---------------------------------------------------------------- */
/* 1. DURUM VE DAKİKA                                                 */
/* ---------------------------------------------------------------- */

test("evre kodu doğru sınıflanır", () => {
  assert.equal(hub.phaseOf({ status: "NS" }), "pre");
  assert.equal(hub.phaseOf({ status: "1H" }), "live");
  assert.equal(hub.phaseOf({ status: "HT" }), "halftime");
  assert.equal(hub.phaseOf({ providerStatus: "FT" }), "post");
  assert.equal(hub.phaseOf({ status: "PST" }), "unplayed");
  assert.equal(hub.phaseOf(null), "pre");
});

test("dakika yalnızca oynanan maçta ve yalnızca kayıtlıysa yazılır", () => {
  assert.equal(hub.minuteText({ status: "1H", minute: 37 }), "37'");
  assert.equal(hub.minuteText({ status: "2H", time: "45+2'" }), "45+2'");
  // Sağlayıcı dakika vermediyse kickoff'tan sayıp dakika ÜRETİLMEZ.
  assert.equal(hub.minuteText({ status: "1H", kickoff: "2026-09-12T18:00:00+03:00" }), null);
  // Bitmiş maçta "dakika" diye bir şey yok.
  assert.equal(hub.minuteText({ status: "FT", minute: 90 }), null);
});

/* ---------------------------------------------------------------- */
/* 2. MAÇ AKIŞI                                                       */
/* ---------------------------------------------------------------- */

test("olay türleri: VAR, kendi kalesine ve ikinci sarı gol/kırmızıya karışmaz", () => {
  assert.equal(hub.classifyEvent({ type: "Goal", detail: "Normal Goal" }), "goal");
  assert.equal(hub.classifyEvent({ type: "Goal", detail: "Own Goal" }), "own-goal");
  assert.equal(hub.classifyEvent({ type: "Gol", detail: "Kendi kalesine attı" }), "own-goal");
  assert.equal(hub.classifyEvent({ type: "Var", detail: "Goal cancelled" }), "var");
  assert.equal(hub.classifyEvent({ type: "Card", detail: "Second Yellow card" }), "second-yellow");
  assert.equal(hub.classifyEvent({ type: "Card", detail: "Red Card" }), "red");
  assert.equal(hub.classifyEvent({ type: "Card", detail: "Yellow Card" }), "yellow");
  assert.equal(hub.classifyEvent({ type: "subst", detail: "Substitution 1" }), "sub");
  assert.equal(hub.classifyEvent({ type: "Goal", detail: "Penalty" }), "penalty");
  assert.equal(hub.classifyEvent({ type: "Goal", detail: "Missed Penalty" }), "penalty-missed");
});

const timelineMatch = {
  homeTeam: "Fenerbahçe",
  awayTeam: "Galatasaray",
  status: "FT",
  score: { home: 2, away: 1 },
  events: [
    { time: "12'", team: { name: "Fenerbahçe" }, type: "Gol", detail: "Talisca skoru açtı." },
    { time: "40'", team: { name: "Galatasaray" }, type: "Sarı kart", detail: "Torreira kart gördü." },
    { time: "63'", team: { name: "Galatasaray" }, type: "Gol", detail: "Icardi eşitledi." },
    { time: "88'", team: { name: "Fenerbahçe" }, type: "Gol", detail: "Penaltı golü." }
  ],
  substitutions: [{ time: "70'", team: "Fenerbahçe", in: "Oosterwolde", out: "Fred" }]
};

test("akış dakikaya göre sıralanır ve değişiklikler de akışa girer", () => {
  const items = hub.buildTimeline(timelineMatch);
  assert.deepEqual(items.map((item) => item.minute), ["12'", "40'", "63'", "70'", "88'"]);
  assert.equal(items[3].kind, "sub");
});

test("koşan skor yalnızca tabelayla TUTUYORSA yazılır", () => {
  const items = hub.buildTimeline(timelineMatch);
  const goals = items.filter((item) => item.score);
  assert.deepEqual(goals.map((item) => item.score), ["1-0", "1-1", "2-1"]);

  // Aynı olaylar, ama tabelada 5-1 yazıyor: olay listesi eksik demektir.
  // Bu durumda HİÇBİR satıra skor yazılmamalı — yarım doğru skor, hiç
  // skor olmamasından kötüdür.
  const mismatched = hub.buildTimeline({ ...timelineMatch, score: { home: 5, away: 1 } });
  assert.equal(mismatched.filter((item) => item.score).length, 0);
});

test("kendi kalesine golü RAKİBİN hanesine yazılır", () => {
  const items = hub.buildTimeline({
    homeTeam: "A", awayTeam: "B", status: "FT", score: { home: 1, away: 0 },
    events: [{ time: "20'", team: { name: "B" }, type: "Gol", detail: "Kendi kalesine" }]
  });
  assert.equal(hub.scoringSide(items[0]), "home");
  assert.equal(items[0].score, "1-0");
});

test("en yeni olay yalnızca CANLI maçta vurgulanır", () => {
  const live = hub.buildTimeline({ ...timelineMatch, status: "2H" });
  assert.equal(hub.latestEventIndex(live, { status: "2H" }), live.length - 1);
  assert.equal(hub.latestEventIndex(live, { status: "FT" }), null);
  assert.equal(hub.latestEventIndex([], { status: "2H" }), null);
});

/* ---------------------------------------------------------------- */
/* 3. İSTATİSTİK                                                      */
/* ---------------------------------------------------------------- */

test("yüzde birimli ölçüm yeniden oranlanmaz", () => {
  const rows = hub.statRows({
    statistics: [
      { type: "Topla oynama", home: 79, away: 21, unit: "%" },
      { type: "Pas isabeti", home: 88, away: 84, unit: "%" },
      { type: "Toplam şut", home: 15, away: 5 }
    ]
  });
  assert.equal(rows[0].homeShare, 79, "toplamı 100 olan çift kendi payını taşır");
  // 88 ve 84 toplamı 172; oranlanırsa çubuk "yarı yarıya" görünürdü.
  assert.ok(rows[1].homeShare > 50 && rows[1].homeShare < 55);
  assert.equal(rows[2].homeShare, 75);
});

test("ölçülmemiş alan elenir, 0 elenmez", () => {
  const rows = hub.statRows({
    statistics: [
      { type: "Korner", home: 0, away: 4 },
      { type: "Ofsayt", home: null, away: 2 },
      { type: "Faul", home: 11, away: undefined }
    ]
  });
  assert.deepEqual(rows.map((row) => row.type), ["Korner"]);
  assert.equal(rows[0].homeText, "0");
});

test("ölçümün yönü: alan yoksa ada bakılır, ad da bilinmiyorsa taraf VURGULANMAZ", () => {
  // Somut hata: `higherIsBetter` gelmeyen satırlarda "yüksek olan iyidir"
  // varsayılıyordu; 14 faul yapan ve sarı kart gören takım ekranda üstün
  // taraf gibi yeşile boyanıyordu.
  const rows = hub.statRows({
    statistics: [
      { type: "Faul", home: 13, away: 14 },
      { type: "Sarı kart", home: 1, away: 0 },
      { type: "Kurtarış", home: 4, away: 3 },
      { type: "Topla oynama", home: 44, away: 56, unit: "%", higherIsBetter: true },
      { type: "Ceza sahası dışından şut", home: 5, away: 6 }
    ]
  });
  const by = (name) => rows.find((row) => row.type === name);
  assert.equal(by("Faul").leader, "home", "az faul yapan taraf öndedir");
  assert.equal(by("Sarı kart").leader, "away", "az kart gören taraf öndedir");
  assert.equal(by("Kurtarış").leader, "home");
  assert.equal(by("Topla oynama").leader, "away");
  assert.equal(by("Ceza sahası dışından şut").leader, null, "yönü bilinmeyen ölçümde taraf seçilmez");
  assert.equal(hub.statDirection({ type: "Faul", higherIsBetter: true }), true, "açık alan ad tahminini ezer");
});

test("istatistik yoksa satır da yok", () => {
  assert.deepEqual(hub.statRows({}), []);
  assert.deepEqual(hub.primaryStatRows({ statistics: [] }), []);
});

/* ---------------------------------------------------------------- */
/* 4. KADRO VE DİZİLİŞ                                                */
/* ---------------------------------------------------------------- */

test("yedek kulübesi iki alan adından da okunur", () => {
  const providerShape = hub.lineupSides({
    homeTeam: "A", awayTeam: "B",
    lineups: [{ team: "A", players: ["P1"], substitutes: ["S1", "S2"] }]
  });
  assert.deepEqual(providerShape[0].bench.map((p) => p.name), ["S1", "S2"]);

  const curatedShape = hub.lineupSides({
    homeTeam: "A", awayTeam: "B",
    lineups: [{ team: "A", players: ["P1"], bench: ["S9"] }]
  });
  assert.deepEqual(curatedShape[0].bench.map((p) => p.name), ["S9"]);
});

test("forma numarası ve mevki ayrıntı listesinden gelir, yoksa null kalır", () => {
  const sides = hub.lineupSides({
    homeTeam: "A", awayTeam: "B",
    lineups: [{
      team: "A",
      players: ["Mert Günok"],
      startingDetails: [{ name: "Mert Günok", number: 1, position: "G", grid: "1:1" }]
    }, {
      team: "B",
      players: ["Bilinmeyen Oyuncu"]
    }]
  });
  assert.equal(sides[0].starters[0].number, 1);
  assert.equal(sides[0].starters[0].position, "G");
  assert.equal(sides[0].hasNumbers, true);
  assert.equal(sides[1].starters[0].number, null, "numara uydurulmaz");
  assert.equal(sides[1].hasNumbers, false);
});

test("diziliş görseli: grid koordinatı varsa satırlara ayrılır", () => {
  const players = [
    { name: "GK", grid: "1:1" },
    { name: "RB", grid: "2:1" }, { name: "CB1", grid: "2:2" },
    { name: "CB2", grid: "2:3" }, { name: "LB", grid: "2:4" },
    { name: "DM1", grid: "3:1" }, { name: "DM2", grid: "3:2" },
    { name: "AM1", grid: "4:1" }, { name: "AM2", grid: "4:2" }, { name: "AM3", grid: "4:3" },
    { name: "ST", grid: "5:1" }
  ];
  const rows = hub.formationRows(players, "4-2-3-1");
  assert.deepEqual(rows.map((row) => row.length), [1, 4, 2, 3, 1]);
  assert.equal(rows[1][0].name, "RB", "sütun sırası korunur");
});

test("diziliş görseli: koordinat yoksa diziliş metninden kurulur", () => {
  const players = Array.from({ length: 11 }, (_, index) => ({ name: `P${index}` }));
  const rows = hub.formationRows(players, "4-4-2");
  assert.deepEqual(rows.map((row) => row.length), [1, 4, 4, 2]);
});

test("diziliş çözülemiyorsa saha ÇİZİLMEZ", () => {
  // Ne koordinat ne de geçerli bir diziliş metni var: tahmine dayalı bir
  // saha çizmek, doğrulanmamış bir taktik iddiası yayımlamak olurdu.
  assert.equal(hub.formationRows(Array.from({ length: 11 }, (_, i) => ({ name: `P${i}` })), null), null);
  assert.equal(hub.formationRows(Array.from({ length: 11 }, (_, i) => ({ name: `P${i}` })), "4-4-3"), null);
  assert.equal(hub.formationRows([{ name: "tek" }], "4-4-2"), null);
});

/* ---------------------------------------------------------------- */
/* 5. PUAN DURUMU VE "BU SKORLA"                                      */
/* ---------------------------------------------------------------- */

const store = JSON.parse(fs.readFileSync(path.join(root, "data", "league-standings.json"), "utf8"));

test("tablo maçın kendi liginden seçilir", () => {
  const scope = hub.resolveStandingsScope({ competitionId: "la-liga", league: "LaLiga" }, store);
  assert.equal(scope.status, "ok");
  assert.equal(scope.competitionId, "la-liga");
  assert.ok(scope.table.length > 0);
});

test("lig çözülemiyorsa Süper Lig'e DÜŞÜLMEZ", () => {
  const scope = hub.resolveStandingsScope({ league: "Bilinmeyen Kupa" }, store);
  assert.equal(scope.status, "unavailable");
  assert.equal(scope.reason, "unknown-competition");
  assert.equal(scope.table, undefined);
});

test("bu skorla: canlı maç tabloya geçici olarak işlenir", () => {
  const table = [
    { id: "1", team: "A", rank: 1, played: 5, won: 4, drawn: 0, lost: 1, goalsFor: 10, goalsAgainst: 4, goalDifference: 6, points: 12 },
    { id: "2", team: "B", rank: 2, played: 5, won: 3, drawn: 2, lost: 0, goalsFor: 9, goalsAgainst: 5, goalDifference: 4, points: 11 }
  ];
  const scope = { status: "ok", competitionId: "test-ligi", league: "Test Ligi", table };
  const detail = {
    id: "m1", homeTeam: "B", awayTeam: "A", homeTeamId: "2", awayTeamId: "1",
    league: "Test Ligi", competitionId: "test-ligi", status: "2H", score: { home: 2, away: 0 }
  };

  const projected = hub.projectStandings(scope, detail, liveStandings);
  assert.equal(projected.applied, true);
  const top = projected.rows[0];
  assert.equal(top.team, "B", "2-0 önde olan B geçici olarak zirveye çıkar");
  assert.equal(top.points, 14);
  assert.equal(top.rankChange, 1);
});

test("bu skorla: maç başlamadıysa ya da skor yoksa tablo oynatılmaz", () => {
  const scope = { status: "ok", competitionId: "x", league: "X", table: [{ id: "1", team: "A", rank: 1, points: 3 }] };
  assert.equal(hub.projectStandings(scope, { status: "NS", score: {} }, liveStandings).applied, false);
  assert.equal(hub.projectStandings(scope, { status: "2H", score: {} }, liveStandings).reason, "no-score");
  // Çekirdek yüklenemediyse resmî tablo olduğu gibi kalır.
  assert.equal(hub.projectStandings(scope, { status: "2H", score: { home: 1, away: 0 } }, null).reason, "core-missing");
});

test("tablo dilimi iki takımı da mutlaka içerir", () => {
  const table = Array.from({ length: 18 }, (_, index) => ({
    team: `T${index + 1}`, rank: index + 1, played: 5, points: 40 - index
  }));
  const slice = hub.focusRows(table, { homeTeam: "T3", awayTeam: "T15" }, 1);
  const names = slice.map((row) => row.team);
  assert.ok(names.includes("T3") && names.includes("T15"));
  assert.ok(names.includes("T1"), "zirve bağlam için kalır");
  assert.equal(slice.find((row) => row.team === "T3").side, "home");
  assert.equal(slice.find((row) => row.team === "T15").side, "away");
});

/* ---------------------------------------------------------------- */
/* 6. TAHMİN                                                          */
/* ---------------------------------------------------------------- */

test("tahmin yalnızca sunucunun çözdüğü kayıttan gelir", () => {
  assert.equal(hub.preMatchPrediction({}), null, "kayıt yoksa tahmin de yok");
  assert.equal(hub.preMatchPrediction({ homeForm: 8, awayForm: 4 }), null, "formdan yüzde TÜRETİLMEZ");

  const model = hub.preMatchPrediction({
    homeTeam: "A", awayTeam: "B",
    probability: { home: 50, draw: 25, away: 25, source: "api-football", title: "Sağlayıcı tahmini" }
  });
  assert.equal(model.home + model.draw + model.away, 100);
  assert.equal(model.source, "api-football");
});

test("canlı kazanma olasılığı: kaynak yoksa, bozuksa ya da toplamı tutmuyorsa çizilmez", () => {
  assert.equal(hub.liveWinProbability({}), null);
  assert.equal(hub.liveWinProbability({ liveWinProbability: { home: 50, draw: 30, away: 20 } }), null, "kaynaksız okuma reddedilir");
  assert.equal(hub.liveWinProbability({ liveWinProbability: { home: 70, draw: 30, away: 20, source: "x" } }), null, "toplamı 100 değil");
  const ok = hub.liveWinProbability({ liveWinProbability: { home: 60, draw: 25, away: 15, source: "gerçek-model", asOf: "2026-09-12T18:30:00Z" } });
  assert.deepEqual([ok.home, ok.draw, ok.away], [60, 25, 15]);
});

/* ---------------------------------------------------------------- */
/* 7. YAYIN                                                           */
/* ---------------------------------------------------------------- */

test("yayın kanalı yoksa 'açıklanmadı' durumu döner, kanal TAHMİN EDİLMEZ", () => {
  assert.equal(hub.broadcastInfo({}).state, "unannounced");
  assert.equal(hub.broadcastInfo({ broadcast: { turkey: "" } }).state, "unannounced");
  assert.equal(hub.broadcastInfo({ broadcast: "Açıklanmadı" }).state, "unannounced");
  // Süper Lig maçı diye bir kanal varsayılmaz.
  assert.equal(hub.broadcastInfo({ league: "Süper Lig", competitionId: "super-lig" }).channels.length, 0);

  const known = hub.broadcastInfo({ broadcast: { turkey: "beIN Sports 1 / TRT Spor" } });
  assert.equal(known.state, "known");
  assert.deepEqual(known.channels, ["beIN Sports 1", "TRT Spor"]);
});

/* ---------------------------------------------------------------- */
/* 8. HABER BAĞLAMA                                                   */
/* ---------------------------------------------------------------- */

const newsFixtures = [
  { title: "Fenerbahçe'de Talisca sakatlandı", team: "Fenerbahçe", publishedAt: "2026-09-11T10:00:00Z", slug: "a" },
  { title: "Galatasaray - Fenerbahçe derbisinin hakemi belli oldu", team: "Galatasaray", publishedAt: "2026-09-11T12:00:00Z", slug: "b" },
  { title: "Süper Lig'de haftanın programı", team: null, category: "Süper Lig", publishedAt: "2026-09-11T09:00:00Z", slug: "c" },
  { title: "Beşiktaş transferde sona geldi", team: "Beşiktaş", publishedAt: "2026-09-11T09:00:00Z", slug: "d" }
];

test("yalnızca takım adı geçen haberler bağlanır; lig adı tek başına yetmez", () => {
  const match = {
    homeTeam: "Galatasaray", awayTeam: "Fenerbahçe", league: "Süper Lig",
    kickoff: "2026-09-12T21:00:00+03:00"
  };
  const linked = hub.relatedNews(match, newsFixtures, { limit: 10 });
  const slugs = linked.map((item) => item.slug);
  assert.deepEqual(slugs, ["b", "a"], "iki takımı da anan haber önce gelir");
  assert.ok(!slugs.includes("c"), "yalnızca lig adı geçen haber doldurma sayılır");
  assert.ok(!slugs.includes("d"), "ilgisiz takım bağlanmaz");
});

test("maçtan çok uzak tarihli haber bağlanmaz", () => {
  const match = { homeTeam: "Fenerbahçe", awayTeam: "X", kickoff: "2027-05-01T21:00:00+03:00" };
  assert.deepEqual(hub.relatedNews(match, newsFixtures, {}), []);
});

/* ---------------------------------------------------------------- */
/* 9. MAÇ SONU ÖZETİ                                                  */
/* ---------------------------------------------------------------- */

test("özet yalnızca maç bittiğinde açılır", () => {
  assert.equal(hub.postMatchSummary({ ...timelineMatch, status: "2H" }, {}), null);
  const summary = hub.postMatchSummary(timelineMatch, {});
  assert.equal(summary.finalScore, "2 - 1");
  assert.equal(summary.winner.side, "home");
  // Sarı kart "önemli olay" değil; gol ve penaltı golü öyle.
  assert.deepEqual(summary.keyEvents.map((item) => item.minute), ["12'", "63'", "88'"]);
});

test("puan etkisi: puan skordan, sıra yalnızca tablodan", () => {
  const drawImpact = hub.pointsImpact({ homeTeam: "A", awayTeam: "B", score: { home: 1, away: 1 } }, null);
  assert.equal(drawImpact.home.points, 1);
  assert.equal(drawImpact.home.rank, null, "tablo yoksa sıra iddia edilmez");
  assert.equal(drawImpact.ranked, false);

  const ranked = hub.pointsImpact(
    { homeTeam: "A", awayTeam: "B", score: { home: 3, away: 0 } },
    { applied: true, rows: [{ team: "A", rank: 1, rankChange: 2 }, { team: "B", rank: 9, rankChange: -1 }] }
  );
  assert.equal(ranked.home.points, 3);
  assert.equal(ranked.home.rank, 1);
  assert.equal(ranked.ranked, true);
});

test("sonraki maçlar yalnızca gerçek fikstür kaydından listelenir", () => {
  assert.deepEqual(hub.nextMatches(timelineMatch, [], Date.parse("2026-09-12T23:00:00+03:00")), []);
  const next = hub.nextMatches(
    { ...timelineMatch, id: "m0", kickoff: "2026-09-12T21:00:00+03:00" },
    [
      { id: "m9", homeTeam: "Kasımpaşa", awayTeam: "Fenerbahçe", kickoff: "2026-09-20T18:00:00+03:00" },
      { id: "m8", homeTeam: "Galatasaray", awayTeam: "Rizespor", kickoff: "2026-09-19T18:00:00+03:00" }
    ],
    Date.parse("2026-09-12T23:00:00+03:00")
  );
  assert.equal(next.length, 2);
  assert.equal(next[0].opponent, "Kasımpaşa");
  assert.equal(next[0].home, false, "deplasman maçı doğru işaretlenir");
});

/* ---------------------------------------------------------------- */
/* 10. PAYLAŞILABİLİR KARTLAR                                         */
/* ---------------------------------------------------------------- */

test("kart yalnızca dayandığı veri varsa üretilir", () => {
  assert.deepEqual(hub.shareCards({ homeTeam: "A", awayTeam: "B", status: "NS", score: {} }, {}), []);

  const cards = hub.shareCards({
    ...timelineMatch,
    lineups: [{ team: "Fenerbahçe", formation: "4-2-3-1", players: ["P1"] }]
  }, {});
  const kinds = cards.map((card) => card.kind);
  assert.deepEqual(kinds, ["lineup", "goal", "fulltime"]);
  assert.equal(cards[2].meta.score, "2 - 1");
});

test("maç sonu kartı bitmemiş maçta üretilmez", () => {
  const cards = hub.shareCards({ ...timelineMatch, status: "2H" }, {});
  assert.ok(!cards.some((card) => card.kind === "fulltime"));
});

/* ---------------------------------------------------------------- */
/* 11. SEO                                                            */
/* ---------------------------------------------------------------- */

test("başlık ve açıklama maçın evresine göre değişir", () => {
  const pre = hub.seoMeta({ homeTeam: "A", awayTeam: "B", league: "Süper Lig", status: "NS", score: {} });
  assert.match(pre.title, /Hangi Kanalda/);

  const live = hub.seoMeta({ homeTeam: "A", awayTeam: "B", status: "2H", minute: 55, score: { home: 1, away: 0 } });
  assert.match(live.title, /CANLI/);
  assert.match(live.description, /55'/);

  const post = hub.seoMeta({ homeTeam: "A", awayTeam: "B", status: "FT", score: { home: 2, away: 1 } });
  assert.match(post.title, /maç sonucu 2-1/);
});

test("yapılandırılmış veri yalnızca kayıtlı alanları taşır", () => {
  const node = hub.structuredData({
    homeTeam: "Fenerbahçe", awayTeam: "Galatasaray", league: "Süper Lig",
    kickoff: "2026-09-12T21:00:00+03:00", status: "NS", score: {},
    broadcast: { turkey: "beIN Sports 1" }
  }, { url: "https://www.futbolradar.com/mac-detay.html?id=x" });

  assert.equal(node["@type"], "SportsEvent");
  assert.equal(node.eventStatus, "https://schema.org/EventScheduled");
  assert.equal(node.homeTeam.name, "Fenerbahçe");
  assert.equal(node.broadcastOfEvent[0].name, "beIN Sports 1");
  assert.equal(node.location, undefined, "stat kaydı yoksa location yazılmaz");

  const postponed = hub.structuredData(
    { homeTeam: "A", awayTeam: "B", kickoff: "2026-09-12T21:00:00+03:00", status: "PST" }, {}
  );
  assert.equal(postponed.eventStatus, "https://schema.org/EventPostponed");
  assert.equal(hub.structuredData({ homeTeam: "A", awayTeam: "B" }, {}), null, "kickoff yoksa şema yok");
});

/* ---------------------------------------------------------------- */
/* 12. ÜRETİLMİŞ KOPYALAR VE SAYFA BAĞLANTISI                         */
/* ---------------------------------------------------------------- */

test("tarayıcı kopyası kaynağıyla aynı", () => {
  execFileSync(process.execPath, [path.join(root, "scripts", "build-match-hub-client.mjs"), "--check"], { stdio: "pipe" });
});

test("haber dizini güncel ve gövde taşımıyor", () => {
  execFileSync(process.execPath, [path.join(root, "scripts", "build-match-news-index.mjs"), "--check"], { stdio: "pipe" });
  const index = JSON.parse(fs.readFileSync(path.join(root, "data", "match-news-index.json"), "utf8"));
  assert.ok(index.items.length > 0);
  assert.equal(index.items[0].body, undefined, "gövde dizine girmemeli — dosya bu yüzden hafif");
});

test("maç detay sayfası katmanı doğru sırayla yükler", () => {
  // VARLIK DAMGASINA TOLERANSLI. Derleme zinciri (`inject-asset-version`)
  // her başvuruya `?v=<hash>` ekliyor; damgayı görmeyen bir arama,
  // derlenmiş bir çalışma kopyasında "betik sayfaya bağlı değil" diye
  // düşüyordu — testin kendi kusuru, sayfanın değil.
  const html = fs.readFileSync(path.join(root, "mac-detay.html"), "utf8");
  const at = (name) => html.search(new RegExp(name.replace(".", "\\.") + '(\\?v=[a-f0-9]+)?"'));
  const core = at("match-hub-core.js");
  const ui = at("match-hub.js");
  const app = at("app.js");
  assert.ok(core > -1 && ui > -1, "maç merkezi betikleri sayfaya bağlı olmalı");
  assert.ok(app > -1, "app.js sayfaya bağlı olmalı");
  assert.ok(core < ui, "çekirdek arayüzden önce yüklenmeli");
  assert.ok(ui < app, "katman app.js'ten önce tanımlanmalı");
  assert.match(html, /match-hub\.css/);
});

test("app.js genişletme noktaları yerinde", () => {
  const source = fs.readFileSync(path.join(root, "app.js"), "utf8");
  for (const key of ["scoreboard", "timeline", "stats", "lineups", "standings", "prediction", "broadcast", "news", "summary", "share"]) {
    assert.ok(source.includes(`mdSlot("${key}"`), `${key} bölümü için genişletme noktası yok`);
  }
  assert.ok(source.includes("function paintMatchDetail"), "çizim sonrası kancası yok");
  assert.ok(source.includes("function matchDetailPollInterval"), "duruma göre yoklama aralığı yok");
  assert.ok(source.includes("group.substitutes"), "yedek kulübesi yedek alan adını okumalı");
});

/* ---------------------------------------------------------------- */
/* 13. YOKLAMA DİSİPLİNİ                                              */
/* ---------------------------------------------------------------- */

test("yoklama aralığı: bitmiş ve uzaktaki maçta istek atılmaz", () => {
  const source = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const body = source.slice(
    source.indexOf("function matchDetailPollInterval"),
    source.indexOf("function initMatchDetailPolling")
  );
  const run = new Function("LIVE_MATCH_FAST_POLL_MS", "MATCH_DETAIL_POLL_MS", `${body}; return matchDetailPollInterval;`)(15000, 15000);

  assert.equal(run({ status: "FINISHED" }), 0, "bitmiş maç yoklanmaz");
  assert.equal(run({ status: "PST" }), 0, "ertelenen maç yoklanmaz");
  assert.equal(run({ status: "1H" }), 15000, "canlı maç hızlı yoklanır");
  assert.equal(run({ status: "NS", kickoff: new Date(Date.now() + 26 * 3600 * 1000).toISOString() }), 0,
    "yarın oynanacak maç için istek atılmaz");
  assert.ok(run({ status: "NS", kickoff: new Date(Date.now() + 20 * 60 * 1000).toISOString() }) > 15000,
    "başlamaya yakın maç yavaş yoklanır");
  assert.equal(run({ status: "NS", kickoff: new Date(Date.now() - 60 * 1000).toISOString() }), 15000,
    "başlama saati geçtiyse ilk düdük için hızlanır");
});

if (failures) {
  console.error(`match-hub: ${failures} test başarısız.`);
  process.exit(1);
}
console.log("match-hub OK");
