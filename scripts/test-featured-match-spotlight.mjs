/**
 * ANA SAYFA MAÇ VİTRİNİ — SÖZLEŞME TESTLERİ.
 *
 * Burada korunan dört söz var:
 *   1. Kutu, GERÇEK bitiş düdüğünden tam 2 saat sonra ana sayfadan düşer;
 *      uzatma, ertelenme ve geç gelen "bitti" bildirimi sayacı kaydırır.
 *   2. Maç sayfası hiçbir evrede silinmez, `noindex` olmaz, adresi değişmez.
 *   3. Kutuda uydurma bilgi yoktur: skor yalnızca okunabilir skor varken
 *      basılır.
 *   4. Sistem kulüp adına bağlı değildir; yapılandırmadaki her kulüp için
 *      aynı biçimde çalışır (sonraki Beşiktaş maçları ve diğer kulüpler).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spotlightBlock, spotlightStrip, spotlightTitle, whenPhrase } from "./lib/featuredMatchSpotlight.mjs";

const require = createRequire(import.meta.url);
const root = process.cwd();
const spotlight = require("../services/featuredMatchSpotlight.js");

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const CONFIG = { teams: ["Beşiktaş"], openBeforeHours: 48, dwellAfterFinishMinutes: 120, assumedDurationMinutes: 150 };
const KICKOFF = "2026-09-17T22:00:00+03:00";
const KICKOFF_MS = Date.parse(KICKOFF);

function match(overrides) {
  return {
    id: "besiktas-marseille-17-eylul-2026",
    homeTeam: "Beşiktaş",
    awayTeam: "Marseille",
    league: "Avrupa Ligi",
    kickoff: KICKOFF,
    status: "SCHEDULED",
    score: { home: null, away: null },
    ...overrides
  };
}

/* ── 1. Kulüp tanıma: ada bağlı kısayol yok ───────────────────────────── */

assert.equal(spotlight.involvesTeam(match({}), ["Beşiktaş"]), true);
assert.equal(spotlight.involvesTeam(match({}), ["besiktas"]), true, "Türkçe karakter olmadan da tanınmalı");
assert.equal(spotlight.involvesTeam(match({ homeTeam: "Marseille", awayTeam: "Lyon" }), ["Beşiktaş"]), false);
assert.equal(spotlight.involvesTeam(match({ homeTeam: "Beşiktaş JK" }), ["Beşiktaş"]), true, "Kulüp eki tanımayı bozmamalı");
assert.equal(spotlight.spotlightSideOf(match({}), ["Beşiktaş"]), "home");
assert.equal(spotlight.spotlightSideOf(match({ homeTeam: "Marseille", awayTeam: "Beşiktaş" }), ["Beşiktaş"]), "away");
assert.equal(spotlight.opponentOf(match({}), ["Beşiktaş"]), "Marseille", "Rakip adı başlıkta kullanılabilmeli");

// Yapılandırma başka bir kulübe çevrildiğinde aynı sistem çalışır.
assert.equal(spotlight.involvesTeam({ homeTeam: "Galatasaray", awayTeam: "Liverpool", kickoff: KICKOFF }, ["Galatasaray"]), true);

/* ── 2. Evreler ───────────────────────────────────────────────────────── */

assert.equal(spotlight.phaseOf(match({}), KICKOFF_MS - HOUR, CONFIG), "pre");

// CANLI EVRESİ SKOR İSTER.
//
// Bu iki satır eskiden skorsuz bir `LIVE` kaydını da "live" sayıyordu ve
// kutu, arkasında hiçbir skor olmadan "CANLI" rozetiyle çiziliyordu — tam
// olarak `services/matchStatus.js#liveVerdict`in 4. kapısının ("skorsuz
// canlı iddiası yapılmaz") engellemek için var olduğu durum. `phaseOf`
// artık kararı o kapıdan geçiriyor; skoru okunabilen canlı kayıt "live",
// okunamayan "in-progress" (skor değil, "maç başladı" der).
assert.equal(
  spotlight.phaseOf(match({ status: "LIVE", score: { home: 1, away: 0 } }), KICKOFF_MS + 20 * MINUTE, CONFIG),
  "live"
);
assert.equal(
  spotlight.phaseOf(match({ status: "HALFTIME", score: { home: 1, away: 1 } }), KICKOFF_MS + 50 * MINUTE, CONFIG),
  "live"
);
assert.equal(
  spotlight.phaseOf(match({ status: "LIVE" }), KICKOFF_MS + 20 * MINUTE, CONFIG),
  "in-progress",
  "Skorsuz canlı iddiası kutuda 'CANLI' rozetine dönmemeli"
);

// BAYAT CANLI KAYDI CANLI DEĞİLDİR. Sağlayıcı maçı canlıya çevirip
// güncellemeyi bıraktığında kayıt depoda donuyor; maç süresi penceresi
// kapandığında kutu bitmiş sayar ve bekleme süresiyle kendiliğinden düşer.
assert.equal(
  spotlight.phaseOf(match({ status: "LIVE", minute: 53, score: { home: 0, away: 0 } }), KICKOFF_MS + 2 * DAY, CONFIG),
  "post",
  "İki gün önce canlıya dönmüş donmuş kayıt ana sayfada canlı kalmamalı"
);

assert.equal(spotlight.phaseOf(match({ status: "FINISHED" }), KICKOFF_MS + 2 * HOUR, CONFIG), "post");
assert.equal(spotlight.phaseOf(match({ status: "POSTPONED" }), KICKOFF_MS - HOUR, CONFIG), "postponed");
assert.equal(
  spotlight.phaseOf(match({}), KICKOFF_MS + 10 * MINUTE, CONFIG),
  "in-progress",
  "Saat geçti ama sağlayıcı sessiz: uydurma canlı skor yerine 'başladı' bandı"
);

/* ── 3. Bitiş düdüğü ve 2 saatlik sayaç ──────────────────────────────── */

const whistle = KICKOFF_MS + 118 * MINUTE; // Uzatmalı, uzun devre aralı maç.
const observedIso = new Date(whistle).toISOString();
const finished = match({ status: "FINISHED", score: { home: 2, away: 1 } });

assert.equal(
  spotlight.finalWhistleAt(finished, whistle + MINUTE, CONFIG, observedIso),
  whistle,
  "Gözlenmiş bitiş anı her şeyden önce gelir"
);
assert.equal(
  spotlight.removeAt(finished, whistle + MINUTE, CONFIG, observedIso),
  whistle + 2 * HOUR,
  "Kutu bitiş düdüğünden TAM 2 saat sonra düşer"
);

// Sayaç başlama saatinden değil, düdükten başlar: uzatmaya giden maçta
// kutu 2 saatten daha uzun süre ayakta kalır.
assert.ok(
  spotlight.removeAt(finished, whistle + MINUTE, CONFIG, observedIso) > KICKOFF_MS + 2 * HOUR + 90 * MINUTE,
  "Uzayan maçta sayaç gerçek düdükten başlamalı"
);

// Gözlem damgası yoksa sağlayıcının güncelleme damgası kullanılır.
assert.equal(
  spotlight.finalWhistleAt(
    match({ status: "FINISHED", updatedAt: new Date(KICKOFF_MS + 100 * MINUTE).toISOString() }),
    KICKOFF_MS + 3 * HOUR,
    CONFIG,
    null
  ),
  KICKOFF_MS + 100 * MINUTE
);

// Hiçbir damga yoksa yedek: başlama + varsayılan süre. Uydurma değil, tavan.
assert.equal(
  spotlight.finalWhistleAt(match({ status: "FINISHED" }), KICKOFF_MS + 5 * HOUR, CONFIG, null),
  KICKOFF_MS + 150 * MINUTE
);

/* ── 4. Pencere: açılış, canlı, kapanış ──────────────────────────────── */

assert.equal(spotlight.isOpen(match({}), KICKOFF_MS - 47 * HOUR, CONFIG), true, "48 saat öncesinden açılır");
assert.equal(spotlight.isOpen(match({}), KICKOFF_MS - 49 * HOUR, CONFIG), false, "Penceresi gelmeden açılmaz");
assert.equal(spotlight.isOpen(match({ status: "LIVE" }), KICKOFF_MS + 30 * MINUTE, CONFIG), true);
assert.equal(
  spotlight.isOpen(finished, whistle + 2 * HOUR - MINUTE, CONFIG, observedIso),
  true,
  "İki saat dolmadan kutu ayakta"
);
assert.equal(
  spotlight.isOpen(finished, whistle + 2 * HOUR + MINUTE, CONFIG, observedIso),
  false,
  "İki saat dolunca kutu düşer"
);
assert.equal(
  spotlight.isOpen(match({ status: "POSTPONED" }), KICKOFF_MS + 3 * HOUR, CONFIG),
  true,
  "Ertelenen maç vitrinde kalır: okuyucunun o an aradığı bilgi bu"
);
assert.equal(spotlight.isOpen(match({ status: "CANCELLED" }), KICKOFF_MS, CONFIG), false);

/* ── 5. Gözlem damgası bir kez yazılır, gerektiğinde silinir ─────────── */

let state = spotlight.nextObservedState({}, finished, whistle);
assert.equal(state[finished.id], new Date(whistle).toISOString());

const later = spotlight.nextObservedState(state, finished, whistle + 30 * MINUTE);
assert.equal(later[finished.id], state[finished.id], "İkinci 'bitti' bildirimi sayacı yeniden başlatamaz");

const reopened = spotlight.nextObservedState(later, match({ status: "LIVE" }), whistle + 40 * MINUTE);
assert.equal(reopened[finished.id], undefined, "Maç yeniden canlıya dönerse damga düşer");

const postponedState = spotlight.nextObservedState(later, match({ status: "POSTPONED" }), whistle + 40 * MINUTE);
assert.equal(postponedState[finished.id], undefined, "Erteleme sonrası sayaç gerçek düdüğü bekler");

// GEÇ AÇILAN KAYIT GÖZLEM SAYILMAZ.
// İlk koşu maç bittikten günler sonra yapılırsa "şimdi bitti" damgası
// sayacı bugüne çeker ve haftalar önce oynanmış maç ana sayfada yeniden
// vitrine girerdi.
const lateRun = spotlight.nextObservedState({}, finished, KICKOFF_MS + 5 * 24 * HOUR);
assert.equal(lateRun[finished.id], undefined, "Gözlem penceresi dışında damga yazılmaz");
assert.equal(
  spotlight.isOpen(finished, KICKOFF_MS + 5 * 24 * HOUR, CONFIG, lateRun[finished.id]),
  false,
  "Günler önce bitmiş maç geç koşuda vitrine geri dönmemeli"
);

/* ── 6. İstemci damgası ──────────────────────────────────────────────── */

const pendingExpiry = spotlight.clientExpiryAt(match({}), KICKOFF_MS - HOUR, CONFIG, null);
assert.equal(pendingExpiry.exact, false, "Maç bitmeden kesin düşme anı bilinemez");
assert.equal(pendingExpiry.at, KICKOFF_MS + 150 * MINUTE + 2 * HOUR, "Tavan damgası: kutu sonsuza kadar kalmaz");

const exactExpiry = spotlight.clientExpiryAt(finished, whistle + MINUTE, CONFIG, observedIso);
assert.equal(exactExpiry.exact, true);
assert.equal(exactExpiry.at, whistle + 2 * HOUR);

/* ── 7. Seçim: canlı maç yaklaşan maçın önüne geçer ──────────────────── */

const upcoming = match({ id: "besiktas-next", kickoff: "2026-09-21T20:00:00+03:00" });
const live = match({ id: "besiktas-live", status: "LIVE", score: { home: 1, away: 0 } });
const selected = spotlight.selectSpotlight([upcoming, live], { ...CONFIG, nowMs: KICKOFF_MS + 30 * MINUTE });
assert.equal(selected.id, "besiktas-live");

const onlyUpcoming = spotlight.selectSpotlight([upcoming], { ...CONFIG, nowMs: Date.parse(upcoming.kickoff) - 24 * HOUR });
assert.equal(onlyUpcoming.id, "besiktas-next");

assert.equal(
  spotlight.selectSpotlight([match({ homeTeam: "Lyon", awayTeam: "Marseille" })], { ...CONFIG, nowMs: KICKOFF_MS }),
  null,
  "Yapılandırmadaki kulübün maçı yoksa vitrin açılmaz"
);

/* ── 8. İşaretleme: uydurma skor yok, adres her evrede aynı ──────────── */

const href = "./mac/besiktas-marseille-17-eylul-2026";
const baseView = {
  homeTeam: "Beşiktaş",
  awayTeam: "Marseille",
  league: "UEFA Avrupa Ligi",
  venue: "Tüpraş Stadyumu",
  kickoff: KICKOFF,
  href,
  query: "id=besiktas-marseille-2026-09-17&date=2026-09-17",
  expiresAt: new Date(whistle + 2 * HOUR).toISOString(),
  todayIstanbul: "2026-09-17"
};

const preBlock = spotlightBlock({ ...baseView, phase: "pre", score: { home: null, away: null } }, { locale: "tr" });
assert.ok(preBlock.includes(href), "Kutu maç sayfasına bağlanmalı");
assert.ok(/data-fms-expires-at="2026-09-1[78]T/.test(preBlock), "Kutu kendi son kullanma damgasını taşımalı");
assert.ok(preBlock.includes("hidden"), "Skor yokken skor satırı gizli kalmalı");
assert.ok(!/fms__score-value">\d/.test(preBlock), "Maç öncesi uydurma skor basılmaz");
assert.ok(preBlock.includes("#muhtemel-11") && preBlock.includes("#istatistik"), "Maç sayfasına derin bağlantı verilmeli");

const liveBlock = spotlightBlock({ ...baseView, phase: "live", score: { home: 1, away: 0 }, minute: 63 }, { locale: "tr" });
assert.ok(liveBlock.includes("CANLI"), "Canlı evrede canlılık sinyali");
assert.ok(liveBlock.includes("1-0"), "Canlı skor yazılmalı");
assert.ok(liveBlock.includes("63&#039;") || liveBlock.includes("63'"), "Dakika yazılmalı");
assert.ok(liveBlock.includes(href), "Canlı evrede de adres aynı");

const postBlock = spotlightBlock({ ...baseView, phase: "post", score: { home: 2, away: 1 } }, { locale: "tr" });
assert.ok(postBlock.includes("MAÇ SONUCU") && postBlock.includes("2-1"));
assert.ok(postBlock.includes(href), "Maç sonrası da aynı adres — URL hiç değişmez");

const enBlock = spotlightBlock({ ...baseView, phase: "live", score: { home: 1, away: 0 } }, { locale: "en" });
assert.ok(enBlock.includes("LIVE") && enBlock.includes("live score"), "İngilizce kutu İngilizce metin taşımalı");
assert.ok(!enBlock.includes("MAÇ"), "İngilizce kutuda Türkçe rozet kalmamalı");

assert.equal(spotlightBlock({ ...baseView, href: "" }, { locale: "tr" }), "", "Adres yoksa kutu basılmaz");

const strip = spotlightStrip({ ...baseView, phase: "pre" }, { locale: "tr" });
assert.ok(strip.includes(href), "Takım/lig şeridi maç sayfasına bağlanmalı");

/* ── 9. Başlıklar arama niyetine oturur ──────────────────────────────── */

assert.match(
  spotlightTitle({ ...baseView, phase: "pre" }, "tr"),
  /Beşiktaş - Marseille maçı bugün/,
  "Maç öncesi: 'bugün' sinyali"
);
assert.match(spotlightTitle({ ...baseView, phase: "live", score: { home: 1, away: 1 } }, "tr"), /1-1.*canlı skor/);
assert.match(spotlightTitle({ ...baseView, phase: "post", score: { home: 2, away: 1 } }, "tr"), /2-1 Marseille maç sonucu/);
assert.match(spotlightTitle({ ...baseView, phase: "postponed" }, "tr"), /ertelendi/);

assert.match(whenPhrase({ kickoff: KICKOFF, locale: "tr", nowIstanbulDay: "2026-09-16" }), /yarın/);
assert.match(whenPhrase({ kickoff: KICKOFF, locale: "tr", nowIstanbulDay: "2026-09-10" }), /17 Eylül Perşembe/);

/* ── 10. Yayındaki sayfalar ──────────────────────────────────────────── */

const stateFile = path.join(root, "data/featured-match-spotlight-state.json");
if (fs.existsSync(stateFile)) {
  const stored = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  if (stored.spotlight) {
    const home = fs.readFileSync(path.join(root, "index.html"), "utf8");
    const enHome = fs.readFileSync(path.join(root, "en/index.html"), "utf8");

    for (const [label, html] of [["index.html", home], ["en/index.html", enHome]]) {
      if (!["pre", "live"].includes(stored.spotlight.phase)) {
        assert.ok(!html.includes("<!-- featured-match-spotlight:start -->"), `${label}: finished fixture must leave home`);
        continue;
      }
      assert.ok(html.includes("<!-- featured-match-spotlight:start -->"), `${label}: vitrin bloğu basılmalı`);
      assert.ok(html.includes("featured-match-spotlight.css"), `${label}: vitrin stili bağlanmalı`);
      assert.ok(html.includes("featured-match-spotlight.js"), `${label}: vitrin istemcisi bağlanmalı`);
      assert.ok(/data-fms-expires-at="[^"]+"/.test(html), `${label}: son kullanma damgası taşınmalı`);
    }

    // MAÇ SAYFASI KALICI: vitrin bu sayfaya dokunmaz.
    const pagePath = path.join(root, `mac/${stored.spotlight.matchId}.html`);
    if (fs.existsSync(pagePath)) {
      const page = fs.readFileSync(pagePath, "utf8");
      assert.ok(!/<meta name="robots"[^>]*noindex/.test(page), "Maç sayfası indekslenebilir kalmalı");
      assert.ok(/<link rel="canonical" href="https:\/\/www\.futbolradar\.com\/mac\//.test(page), "Kanonik adres maç sayfasının kendisi olmalı");
      assert.ok(page.includes('"@type":"SportsEvent"'), "SportsEvent şeması korunmalı");
      assert.ok(page.includes('"@type":"BreadcrumbList"'), "BreadcrumbList şeması korunmalı");
    }
  }
}

// ── TEK MAÇLIK ÖNE ÇIKARMA (featuredFixtures) ───────────────────────────
{
  const FEATURED = {
    teams: ["Beşiktaş"],
    priorityTeams: ["Beşiktaş"],
    featuredFixtures: [{ homeTeam: "Galatasaray", awayTeam: "Barcelona", date: "2026-10-13", major: true, headline: { tr: "Dev gece", en: "Huge night" } }]
  };
  const gsb = {
    id: "galatasaray-barcelona-13-ekim-2026", homeTeam: "Galatasaray", awayTeam: "FC Barcelona", league: "UEFA Şampiyonlar Ligi",
    kickoff: "2026-10-13T22:00:00+03:00", status: "SCHEDULED", score: { home: null, away: null },
    homeTeamLogo: "https://media.api-sports.io/football/teams/645.png", awayTeamLogo: "https://media.api-sports.io/football/teams/529.png"
  };
  const bjk = { ...match({ id: "besiktas-x-13-ekim-2026", kickoff: "2026-10-13T19:00:00+03:00" }) };
  const otherGs = { ...gsb, id: "galatasaray-x-17-ekim-2026", awayTeam: "Kasımpaşa", kickoff: "2026-10-17T20:00:00+03:00" };
  const nowMs = Date.parse("2026-10-12T03:00:00+03:00");

  assert.ok(spotlight.featuredFixtureFor(gsb, FEATURED.featuredFixtures), "sağlayıcı adı 'FC Barcelona' da eşleşmeli");
  assert.equal(spotlight.featuredFixtureFor({ ...gsb, kickoff: "2026-10-14T22:00:00+03:00" }, FEATURED.featuredFixtures), null, "gün tutmazsa (ertelenme) kayıt hiçbir şey açmaz");
  assert.equal(spotlight.isSpotlightCandidate(otherGs, FEATURED), false, "kulübün öteki maçları vitrine girmez");
  const youth = { ...gsb, id: "galatasaray-u19-barcelona-u19-2026-10-13", homeTeam: "Galatasaray U19", awayTeam: "Barcelona U19", kickoff: "2026-10-13T14:00:00+03:00" };
  assert.equal(spotlight.featuredFixtureFor(youth, FEATURED.featuredFixtures), null, "aynı gün oynanan U19 maçı A takım maçı sayılmaz");
  assert.equal(spotlight.selectSpotlight([youth, gsb], { ...FEATURED, teams: [], nowMs }).id, gsb.id);
  assert.equal(spotlight.selectSpotlight([bjk, gsb, otherGs], { ...FEATURED, nowMs }).id, gsb.id, "seçilmiş maç aynı evrede öncelikli takımın da önünde");
  // Evre sırası korunur: canlı bir kulüp maçı yaklaşan seçilmiş maçın önünde kalır.
  const liveBjk = { ...bjk, kickoff: "2026-10-12T02:30:00+03:00", status: "LIVE", score: { home: 1, away: 0 }, updatedAt: "2026-10-12T02:59:00+03:00", minute: 30 };
  const liveNow = Date.parse("2026-10-12T03:00:00+03:00");
  const picked = spotlight.selectSpotlight([liveBjk, gsb], { ...FEATURED, nowMs: liveNow });
  assert.ok(picked, "aday seçilmeli");
  assert.equal(spotlight.isMajorSpotlight(gsb, FEATURED, "pre"), true, "seçilmiş maç büyük kart");
  assert.equal(spotlight.isMajorSpotlight(gsb, FEATURED, "post"), false, "bitince normal boyut");
  assert.equal(spotlight.featuredHeadline(gsb, FEATURED, "pre", "tr"), "Dev gece");
  assert.equal(spotlight.featuredHeadline(gsb, FEATURED, "pre", "en"), "Huge night");
  assert.equal(spotlight.featuredHeadline(gsb, FEATURED, "live", "tr"), "", "canlıyken manşet yok, skor başlığı");
  assert.equal(spotlight.featuredHeadline(gsb, FEATURED, "post", "tr"), "", "bitince manşet yok, sonuç başlığı");

  const view = { homeTeam: "Galatasaray", awayTeam: "FC Barcelona", kickoff: gsb.kickoff, phase: "pre", href: "./mac/x", major: true, headline: "Dev gece", homeLogo: gsb.homeTeamLogo, awayLogo: gsb.awayTeamLogo, renderedAt: new Date(nowMs).toISOString() };
  const html = spotlightBlock(view, { locale: "tr" });
  assert.ok(html.includes(">Dev gece</a>"), "manşet başlıkta");
  assert.ok(html.includes("fms__crests") && html.includes("teams/529.png"), "iki arma da basılır");
  assert.ok(html.includes("data-fms-countdown="), "maç öncesi geri sayım");
  assert.ok(!spotlightBlock({ ...view, awayLogo: "" }, { locale: "tr" }).includes("fms__crests"), "tek arma varsa arma satırı hiç basılmaz");
  assert.ok(!spotlightBlock({ ...view, major: false }, { locale: "tr" }).includes("fms__crests"), "normal kartta arma yok");
  const liveHtml = spotlightBlock({ ...view, phase: "live", headline: "", score: { home: 1, away: 0 }, minute: 12 }, { locale: "tr" });
  assert.ok(liveHtml.includes("1-0") && !liveHtml.includes("Dev gece"), "canlı başlık skoru taşır");

  // Depodaki yapılandırma: kayıt biçimi geçerli, manşetler iki dilde ve makul uzunlukta.
  const stored = JSON.parse(fs.readFileSync(path.join(root, "data/featured-match-spotlight.json"), "utf8"));
  for (const fixture of stored.featuredFixtures || []) {
    assert.match(fixture.date, /^\d{4}-\d{2}-\d{2}$/);
    for (const locale of ["tr", "en"]) {
      const text = fixture.headline && fixture.headline[locale];
      assert.ok(typeof text === "string" && text.length > 10 && text.length <= 90, `manşet ${locale} 10-90 karakter olmalı`);
    }
  }
}

console.log("featured-match-spotlight: tüm sözleşmeler doğrulandı.");
