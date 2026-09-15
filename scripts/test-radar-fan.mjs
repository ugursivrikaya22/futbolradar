/**
 * TARAFTAR ETKİLEŞİMİ — SÖZLEŞME TESTLERİ (anket + paylaşım).
 *
 * Faz 1'deki kuralın aynısı geçerli: ÖLÇÜLMEYEN ŞEY GÖSTERİLMEZ. Buradaki
 * iddiaların bir kısmı yine bir şeyin YOKLUĞUNU doğruluyor — sıfır oyun
 * "%0" diye basılmaması, skorsuz maçın "0-0" diye paylaşılmaması gibi.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const route = require("../server/matchPollRoute.js");
const pushRoute = require("../server/pushSubscriptionRoute.js");
const notifier = require("../services/pushNotifier.js");
const fan = require("../radar-fan.js");
const { matchFollowHtml, matchPollSectionHtml } = await import("./lib/matchSeoPage.mjs");

let checks = 0;
function ok(label, fn) {
  fn();
  checks += 1;
  if (process.env.RADAR_FAN_TEST_VERBOSE) console.log(`  ✓ ${label}`);
}

const entry = {
  slug: "gaziantep-fk-fenerbahce-14-eylul-2026",
  enSlug: "gaziantep-fk-fenerbahce-september-14-2026",
  homeTeam: "Gaziantep FK",
  awayTeam: "Fenerbahçe",
  kickoff: "2026-09-14T20:00:00+03:00"
};
const kickoffMs = Date.parse(entry.kickoff);

/* ------------------------------------------------------------------ */
/* 1. Slug doğrulaması — uç nokta girdisi                              */
/* ------------------------------------------------------------------ */

ok("geçerli slug kabul, tehlikeli girdi ret", () => {
  assert.equal(route.isSlug("gaziantep-fk-fenerbahce-14-eylul-2026"), true);
  assert.equal(route.isSlug("../../etc/passwd"), false);
  assert.equal(route.isSlug("a"), false, "çok kısa slug kabul edilmemeli");
  assert.equal(route.isSlug(""), false);
  assert.equal(route.isSlug("BÜYÜK-HARF"), false);
  assert.equal(route.isSlug("x".repeat(200)), false, "aşırı uzun slug kabul edilmemeli");
});

ok("Türkçe ve İngilizce slug AYNI maça çözülür", () => {
  const index = route.slugIndex();
  const tr = index.get(entry.slug);
  const en = index.get(entry.enSlug);
  assert.ok(tr, "Türkçe slug sicilde bulunmalı");
  assert.ok(en, "İngilizce slug sicilde bulunmalı");
  assert.equal(tr.slug, en.slug, "iki dil tek sayımı paylaşmalı");
});

ok("anket kimliği maça ve soruya bağlı", () => {
  assert.equal(route.pollId(entry, "winner"), "match:gaziantep-fk-fenerbahce-14-eylul-2026:winner");
  // İngilizce istek de kanonik slug'a yazar; ayrı bir anket açılmaz.
  assert.equal(route.pollId({ slug: entry.slug }, "next-goal"), "match:gaziantep-fk-fenerbahce-14-eylul-2026:next-goal");
});

/* ------------------------------------------------------------------ */
/* 2. Sorular                                                          */
/* ------------------------------------------------------------------ */

ok("kazanan sorusu maçın kendi takımlarıyla kurulur", () => {
  const [winner] = route.buildQuestions(entry, "tr", kickoffMs - 3600000);
  assert.equal(winner.id, "winner");
  assert.equal(winner.question, "Maçı kim kazanır?");
  assert.deepEqual(winner.options.map((option) => option.id), ["home", "draw", "away"]);
  assert.equal(winner.options[0].label, "Gaziantep FK");
  assert.equal(winner.options[2].label, "Fenerbahçe");
  assert.equal(winner.closed, false);
});

ok("İngilizce sorular İngilizce kurulur", () => {
  const [winner, second] = route.buildQuestions(entry, "en", kickoffMs - 3600000);
  assert.equal(winner.question, "Who wins this match?");
  assert.equal(winner.options[1].label, "Draw");
  assert.equal(second.question, "Who scores the next goal?");
  assert.equal(second.options[2].label, "No more goals");
});

ok("ikinci soru yapılandırmadan gelir ve değiştirilebilir", () => {
  const config = require("../data/match-poll-questions.json");
  assert.ok(config.default && config.default.id, "varsayılan ikinci soru tanımlı olmalı");
  assert.ok(config.matches && typeof config.matches === "object", "maça özel ezme noktası bulunmalı");
  const [, second] = route.buildQuestions(entry, "tr", kickoffMs - 3600000);
  assert.equal(second.id, config.default.id);
  assert.equal(second.options.length, 3, "ev + deplasman + nötr");
});

ok("maç bitince kazanan sorusu KAPANIR", () => {
  const during = route.buildQuestions(entry, "tr", kickoffMs + 60 * 60000);
  assert.equal(during[0].closed, false, "maç sürerken açık kalmalı");
  const after = route.buildQuestions(entry, "tr", kickoffMs + route.WINNER_CLOSES_AFTER_MS + 1000);
  assert.equal(after[0].closed, true, "sonucu bilerek oy vermek anketin anlamını bozar");
});

ok("seçeneği olmayan soru yayımlanmaz", () => {
  // Takımsız bir kayıtta 'optionsFrom: teams' etiket üretemez.
  const questions = route.buildQuestions({ slug: "x-y-1-ocak-2026", kickoff: entry.kickoff }, "tr", kickoffMs);
  const second = questions[1];
  if (second) {
    assert.ok(second.options.every((option) => option.label), "etiketsiz seçenek basılmamalı");
  }
});

/* ------------------------------------------------------------------ */
/* 3. Sayım sunumu                                                     */
/* ------------------------------------------------------------------ */

const winnerQuestion = route.buildQuestions(entry, "tr", kickoffMs - 3600000)[0];

ok("yüzdeler ve lider doğru hesaplanır", () => {
  const tally = route.presentTally({ home: 20, draw: 37, away: 81 }, winnerQuestion);
  assert.equal(tally.total, 138);
  assert.equal(tally.results[0].optionId, "away");
  assert.equal(tally.results[0].percent, 59);
  assert.equal(tally.results[0].isLeader, true);
  assert.equal(tally.results[1].isLeader, false);
});

ok("beraberlikte lider işareti verilmez", () => {
  const tally = route.presentTally({ home: 10, away: 10 }, winnerQuestion);
  assert.equal(tally.results.every((row) => !row.isLeader), true,
    "eşitken birini 'önde' göstermek veride olmayan bir sıra uydurmaktır");
});

ok("geçersiz seçenek satırı sayıma girmez", () => {
  // Soru değişmiş olabilir; depoda kalan eski seçenek toplamı şişirmemeli.
  const tally = route.presentTally({ away: 10, "eski-secenek": 999 }, winnerQuestion);
  assert.equal(tally.total, 10);
  assert.equal(tally.results.length, 1);
});

ok("oy yoksa sayım boştur", () => {
  const tally = route.presentTally({}, winnerQuestion);
  assert.equal(tally.total, 0);
  assert.deepEqual(tally.results, []);
});

/* ------------------------------------------------------------------ */
/* 4. İstemci — anket çizimi                                           */
/* ------------------------------------------------------------------ */

const baseQuestion = {
  id: "winner",
  question: "Maçı kim kazanır?",
  closed: false,
  alreadyVoted: false,
  choice: null,
  total: 0,
  results: [],
  options: [
    { id: "home", label: "Gaziantep FK" },
    { id: "draw", label: "Beraberlik" },
    { id: "away", label: "Fenerbahçe" }
  ]
};

ok("oy verilmemişse seçenek düğmeleri çizilir", () => {
  const html = fan.questionHtml(baseQuestion, "tr");
  assert.equal((html.match(/data-fan-vote/g) || []).length, 3);
  assert.equal(html.includes("fan-poll-results"), false, "oy vermeden sonuç gösterilmez");
});

ok("oy verilmişse sonuç çizilir ve kendi oyu işaretlenir", () => {
  const html = fan.questionHtml({
    ...baseQuestion,
    alreadyVoted: true,
    choice: "away",
    total: 138,
    results: [
      { optionId: "away", label: "Fenerbahçe", votes: 81, percent: 59, isLeader: true },
      { optionId: "home", label: "Gaziantep FK", votes: 20, percent: 14, isLeader: false }
    ]
  }, "tr");
  assert.equal(html.includes("data-fan-vote"), false, "oy verdikten sonra düğme kalmamalı");
  assert.match(html, /is-mine/);
  assert.match(html, /%59/);
});

ok("sıfır oyda yüzde BASILMAZ", () => {
  const html = fan.questionHtml({ ...baseQuestion, alreadyVoted: true, total: 0, results: [] }, "tr");
  assert.equal(/%\d/.test(html), false, "'%0' ölçülmüş bir oran değil, boş kümenin yanlış okunuşudur");
  assert.match(html, /Henüz oy yok/);
});

ok("kapalı soruda düğme yok, durum yazılı", () => {
  const html = fan.questionHtml({ ...baseQuestion, closed: true, total: 0 }, "tr");
  assert.equal(html.includes("data-fan-vote"), false);
  assert.match(html, /Bu soru kapandı/);
});

ok("anket HTML kaçışı yapar", () => {
  const html = fan.questionHtml({
    ...baseQuestion,
    question: "<img src=x onerror=alert(1)>",
    options: [{ id: "a", label: "<script>bad()</script>" }, { id: "b", label: "ok" }]
  }, "tr");
  assert.equal(html.includes("<script>"), false);
  assert.equal(html.includes("<img src=x"), false);
});

/* ------------------------------------------------------------------ */
/* 5. İstemci — paylaşım                                               */
/* ------------------------------------------------------------------ */

const names = { home: "Galatasaray", away: "Beşiktaş" };
const liveDetail = {
  minute: 73,
  score: { home: 2, away: 1 },
  radarPulse: {
    pulse: { home: 81, away: 39 },
    timeline: [{ kind: "goal", minute: 73, player: "Osimhen" }]
  }
};

ok("paylaşım metni istenen biçimde kurulur", () => {
  const text = fan.shareText({ detail: liveDetail, names, locale: "tr" });
  const lines = text.split("\n").filter(Boolean);
  assert.equal(lines[0], "GOOOL! 🔥");
  assert.equal(lines[1], "Galatasaray 2–1 Beşiktaş");
  assert.equal(lines[2], "Osimhen 73'");
  assert.equal(lines[3], "Radar Nabzı:");
  assert.equal(lines[4], "Galatasaray 81");
  assert.equal(lines[5], "Beşiktaş 39");
  assert.equal(lines[6], "FutbolRadar");
});

ok("skor yoksa skor UYDURULMAZ", () => {
  const text = fan.shareText({ detail: { score: { home: null, away: null } }, names, locale: "tr" });
  assert.equal(/\d+–\d+/.test(text), false, "'0-0' diye bir skor icat edilmemeli");
  assert.match(text, /Galatasaray – Beşiktaş/);
});

ok("nabız hesaplanmamışsa nabız satırı yazılmaz", () => {
  const text = fan.shareText({
    detail: { score: { home: 1, away: 0 }, radarPulse: { pulse: null, timeline: [] } },
    names, locale: "tr"
  });
  assert.equal(text.includes("Radar Nabzı"), false);
  assert.match(text, /Galatasaray 1–0 Beşiktaş/);
});

ok("gol yoksa kutlama başlığı atılmaz", () => {
  const text = fan.shareText({
    detail: { minute: 20, score: { home: 0, away: 0 }, radarPulse: { pulse: { home: 40, away: 45 }, timeline: [] } },
    names, locale: "tr"
  });
  assert.equal(text.includes("GOOOL"), false);
  assert.match(text, /Galatasaray 0–0 Beşiktaş/);
});

ok("İngilizce paylaşım İngilizce", () => {
  const text = fan.shareText({ detail: liveDetail, names, locale: "en" });
  assert.match(text, /GOAL!/);
  assert.match(text, /Live Match Pulse:/);
  assert.equal(text.includes("Radar Nabzı"), false);
});

ok("paylaşım hedefleri istenen dört kanalı kapsar", () => {
  const targets = fan.shareTargets("mesaj", "https://www.futbolradar.com/mac/x");
  assert.deepEqual(targets.map((target) => target.id), ["x", "whatsapp", "facebook"]);
  for (const target of targets) {
    assert.match(target.href, /^https:\/\//, "hedef https olmalı");
    assert.ok(target.href.includes(encodeURIComponent("https://www.futbolradar.com/mac/x")) ||
      target.href.includes(encodeURIComponent("mesaj")), "hedef içeriği taşımalı");
  }
  // Dördüncü kanal (bağlantı kopyala) düğmesi HTML'de üretilir.
  const html = fan.shareHtml({ detail: liveDetail, names, locale: "tr", url: "https://www.futbolradar.com/mac/x" });
  assert.match(html, /data-fan-share-copy/);
});

ok("paylaşım bağlantısı yoksa satır çizilmez", () => {
  assert.equal(fan.shareHtml({ detail: liveDetail, names, locale: "tr", url: "" }), "");
});

ok("paylaşım HTML kaçışı yapar", () => {
  const html = fan.shareHtml({
    detail: liveDetail,
    names: { home: '"><script>x</script>', away: "B" },
    locale: "tr",
    url: "https://www.futbolradar.com/mac/x"
  });
  assert.equal(html.includes("<script>"), false);
});

/* ------------------------------------------------------------------ */
/* 6. Sayfa kabuğu                                                     */
/* ------------------------------------------------------------------ */

ok("anket kabuğu iki dilde de gizli doğar", () => {
  for (const [locale, slug] of [["tr", entry.slug], ["en", entry.enSlug]]) {
    const html = matchPollSectionHtml({ locale, pollSlug: slug });
    assert.ok(html.includes("data-match-poll"), `${locale}: kanca`);
    assert.ok(html.includes("hidden"), `${locale}: depo kapalıysa yer kaplamamalı`);
    assert.ok(html.includes(slug), `${locale}: kendi slug'ını taşımalı`);
  }
});

ok("slug yoksa anket kabuğu hiç basılmaz", () => {
  assert.equal(matchPollSectionHtml({ locale: "tr" }), "");
});

ok("bayatlık tuzağı tekrarlanmadı: hata satırı display atayan sınıf taşımaz", () => {
  // `.data-empty { display: grid }` `hidden` niteliğini eziyordu (Faz 1).
  const html = matchPollSectionHtml({ locale: "tr", pollSlug: entry.slug });
  const error = html.match(/<p class="([^"]*)" data-fan-poll-error hidden>/);
  assert.ok(error, "hata satırı bulunmalı");
  assert.equal(error[1].includes("data-empty"), false);
});

/* ------------------------------------------------------------------ */
/* 7. BU MAÇI TAKİP ET — abonelik anahtarı                             */
/* ------------------------------------------------------------------ */

ok("takip anahtarı doğrulanır: uydurma maç kabul edilmez", () => {
  const teams = require("../data/teams.json");
  const teamId = String(teams[0].id);
  const { loadRegistry } = require("../services/matchSeoPages.js");
  const withId = loadRegistry().pages.find((page) => page && page.providerIds && page.providerIds.apiFootball);
  assert.ok(withId, "sicilde sağlayıcı kimlikli bir maç bulunmalı");

  assert.equal(pushRoute.isFollowKey(teamId), true, "takım takibi çalışmalı");
  assert.equal(pushRoute.isFollowKey(`match:${withId.providerIds.apiFootball}`), true, "gerçek maç takibi çalışmalı");
  // Doğrulanmayan anahtar, asla bildirim almayacak kayıtlarla depoyu
  // doldurur ve okuyucuya izin verdirip sessizce hiçbir şey göndermemek olur.
  assert.equal(pushRoute.isFollowKey("match:999999999"), false, "olmayan maç reddedilmeli");
  assert.equal(pushRoute.isFollowKey("match:../../etc"), false, "enjeksiyon reddedilmeli");
  assert.equal(pushRoute.isFollowKey("rastgele-metin"), false);
  assert.equal(pushRoute.isFollowKey(""), false);
});

ok("takip düğmesi yalnızca sağlayıcı kimliği olan maçta basılır", () => {
  assert.match(matchFollowHtml({ locale: "tr", followFixtureId: "1584408", pollSlug: entry.slug }),
    /data-match-follow-id="1584408"/);
  assert.equal(matchFollowHtml({ locale: "tr", followFixtureId: "" }), "",
    "kimliksiz maçta takip aboneliği yazılamaz, düğme de basılmaz");
});

ok("takip kabuğu gizli doğar", () => {
  const html = matchFollowHtml({ locale: "tr", followFixtureId: "1584408", pollSlug: entry.slug });
  assert.match(html, /hidden/, "push mümkün değilse düğme hiç görünmemeli");
});

/* ------------------------------------------------------------------ */
/* 8. Bildirim yükleri                                                 */
/* ------------------------------------------------------------------ */

const notifyMatch = {
  id: "1",
  providerId: "1575165",
  homeTeam: "1. FC Köln",
  awayTeam: "Werder Bremen",
  kickoff: "2026-09-12T19:30:00+03:00",
  minute: 67,
  score: { home: 1, away: 1 }
};

ok("istenen bildirim türlerinin hepsi yük üretir", () => {
  for (const type of ["kickoff", "goal", "halftime", "fulltime", "red-card"]) {
    const payload = notifier.buildPayload({ type, side: "home", match: notifyMatch });
    assert.ok(payload, `${type}: yük üretilmeli`);
    assert.ok(payload.title && payload.body, `${type}: başlık ve gövde dolu olmalı`);
    assert.ok(payload.tag, `${type}: etiket olmalı (aynı olay iki kez düşmesin)`);
  }
});

ok("bildirim maçın KENDİ sayfasına gider", () => {
  const payload = notifier.buildPayload({ type: "goal", side: "home", match: notifyMatch });
  assert.match(payload.url, /^\/mac\//, "okuyucu maçı listede yeniden aramak zorunda kalmamalı");
});

ok("ikinci kırmızı kart birincinin bildirimini ezmez", () => {
  const first = notifier.buildPayload({ type: "red-card", match: { ...notifyMatch, minute: 55 } });
  const second = notifier.buildPayload({ type: "red-card", match: { ...notifyMatch, minute: 78 } });
  assert.notEqual(first.tag, second.tag);
});

ok("bilinmeyen olay türü yük üretmez", () => {
  assert.equal(notifier.buildPayload({ type: "corner", match: notifyMatch }), null);
});

ok("maç takibi öneki takım kimlikleriyle çakışmaz", () => {
  const teams = require("../data/teams.json");
  assert.equal(notifier.MATCH_FOLLOW_PREFIX, "match:");
  for (const team of teams) {
    assert.equal(String(team.id).startsWith(notifier.MATCH_FOLLOW_PREFIX), false,
      `takım kimliği '${team.id}' maç önekiyle çakışmamalı`);
  }
});

console.log(`Taraftar etkileşimi: ${checks} kontrol geçti.`);
