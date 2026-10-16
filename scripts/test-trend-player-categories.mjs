#!/usr/bin/env node
/**
 * TREND OYUNCU KATEGORİLERİ — hesap kuralları + yayımlanan ana sayfa.
 *
 * 1. Kurallar (services/trendPlayerCategories.js) sentetik girdiyle:
 *    yaş Europe/Istanbul gününe göre, U21 + 200 dk, sürpriz tanımı,
 *    kategori sınırı, önce farklılık, eksik değer null.
 * 2. Yayımlanan TR ve EN ana sayfa bloğu: her kart var olan bir profile
 *    bağlanıyor, U21 kartları gerçekten <21 yaş ve >=200 dk, uydurma sıfır
 *    reyting yok, kategori başına en çok 6 kart, sekmeler erişilebilir.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { renderTrendCategoryTabs, MISSING } from "./lib/trendPlayerCategoriesHtml.mjs";

const require = createRequire(import.meta.url);
const root = process.cwd();
const { RULES, ageOn, computeTrendCategories, ratingSummary, indexRatedMatches } = require("../services/trendPlayerCategories.js");

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL ${name}\n       ${error.message}`);
  }
}

console.log("trend-player-categories");

/* --- 1. Kurallar ---------------------------------------------------- */
check("yaş derleme gününe göre Europe/Istanbul takviminde hesaplanır", () => {
  // 2026-10-09T21:30Z = İstanbul'da 10 Ekim 00:30. Doğum günü 10 Ekim.
  assert.equal(ageOn("2005-10-10", "2026-10-09T21:30:00Z"), 21);
  assert.equal(ageOn("2005-10-10", "2026-10-09T20:30:00Z"), 20);
  assert.equal(ageOn("", "2026-10-09T20:30:00Z"), null);
  assert.equal(ageOn("bilinmiyor", "2026-10-09T20:30:00Z"), null);
});

// Şablon: güvenilirlik kapısından (filterPlayerCards trend) geçen GERÇEK bir
// kayıt. Kimlik/yaş/dakika alanları ezilir; kural hesabı sınanır, kapının
// kendisi değil. Dakika ezilirken doğrulama işareti korunur.
const { filterPlayerCards } = require("../services/cardCredibility.js");
const templatePlayer = filterPlayerCards(JSON.parse(fs.readFileSync(path.join(root, "data", "players.json"), "utf8")), { trend: true })
  .kept.find((player) => Number(player.minutes) > 0 && /^\d+$/.test(String(player.providerId || "")));
assert.ok(templatePlayer, "şablon için doğrulanmış oyuncu kaydı bulunamadı");
const verified = (extra) => ({
  ...JSON.parse(JSON.stringify(templatePlayer)),
  statsVerifiedFields: undefined,
  photo: null,
  ...extra
});

function rows(id, ratings, start = 1) {
  return ratings.map((rating, index) => ({
    providerPlayerId: String(id), matchId: `m${id}-${index}`,
    date: `2026-09-${String(start + index).padStart(2, "0")}`,
    competition: "Süper Lig", minutes: 90, rating
  }));
}

check("hazırlık maçı ve sezon öncesi maç reytinge girmez", () => {
  const index = indexRatedMatches([
    { providerPlayerId: "1", matchId: "a", date: "2026-07-14", competition: "Hazırlık Maçı", minutes: 90, rating: 9 },
    { providerPlayerId: "1", matchId: "b", date: "2026-06-30", competition: "Süper Lig", minutes: 90, rating: 9 },
    { providerPlayerId: "1", matchId: "c", date: "2026-08-10", competition: "Süper Lig", minutes: 0, rating: 9 },
    { providerPlayerId: "1", matchId: "d", date: "2026-08-11", competition: "Süper Lig", minutes: 90, rating: 7 }
  ]);
  assert.deepEqual((index.get("1") || []).map((row) => row.matchId), ["d"]);
});

check("son 5 için en az 3 maç ve 180 dakika şart", () => {
  const two = ratingSummary([{ rating: 8, minutes: 90, date: "b" }, { rating: 8, minutes: 90, date: "a" }]);
  assert.equal(two.lastAvg, null);
  const short = ratingSummary([1, 2, 3].map((i) => ({ rating: 8, minutes: 30, date: String(i) })));
  assert.equal(short.lastAvg, null);
});

check("sürpriz: son-5 >= sezon + 0,5 ve son 5 dışında en az 2 maç", () => {
  const players = [
    verified({ id: "a", name: "A", providerId: "11", birthDate: "1995-01-01", minutes: 600, minutesPlayed: 600 }),
    verified({ id: "b", name: "B", providerId: "12", birthDate: "1995-01-01", minutes: 600, minutesPlayed: 600 }),
    verified({ id: "c", name: "C", providerId: "13", birthDate: "1995-01-01", minutes: 600, minutesPlayed: 600 })
  ];
  const history = [
    ...rows(11, [6.0, 6.0, 6.0, 8.0, 8.0, 8.0, 8.0, 8.0]), // sezon 7.3, son5 8.0 → sürpriz
    ...rows(12, [7.0, 7.0, 7.0, 7.0, 7.0, 7.0, 7.0, 7.0]), // fark yok
    ...rows(13, [5.0, 8.0, 8.0, 8.0, 8.0, 8.0])            // son 5 dışında 1 maç → taban yok
  ];
  const result = computeTrendCategories({ players, history, now: "2026-10-10T00:00:00Z" });
  assert.deepEqual(result.categories.surprise.map((card) => card.id), ["a"]);
});

check("U21 kategorisi <21 yaş ve >=200 dk; dakikası doğrulanmamış genç girmez", () => {
  const players = [
    verified({ id: "y1", name: "Y1", providerId: "21", birthDate: "2006-05-01", minutes: 250, minutesPlayed: 250 }),
    verified({ id: "y2", name: "Y2", providerId: "22", birthDate: "2006-05-01", minutes: 150, minutesPlayed: 150 }),
    verified({ id: "y3", name: "Y3", providerId: "23", birthDate: "2005-01-01", minutes: 900, minutesPlayed: 900 }),
    verified({ id: "y4", name: "Y4", providerId: "24", birthDate: "2007-01-01", minutes: null, minutesPlayed: null })
  ];
  const result = computeTrendCategories({ players, history: [], now: "2026-10-10T00:00:00Z" });
  assert.deepEqual(result.categories.young.map((card) => card.id), ["y1"]);
});

check("kategori en çok 6 kart; önce farklılık, gerekirse tekrar", () => {
  const players = Array.from({ length: 9 }, (_, i) => verified({
    id: `p${i}`, name: `P${i}`, providerId: String(100 + i), birthDate: "2006-01-01", minutes: 400, minutesPlayed: 400
  }));
  const history = players.flatMap((player, i) => rows(100 + i, [7 + i / 10, 7 + i / 10, 7 + i / 10]));
  const result = computeTrendCategories({ players, history, now: "2026-10-10T00:00:00Z" });
  assert.equal(result.categories.young.length, RULES.cap);
  assert.equal(result.categories.form.length, RULES.cap);
  const youngIds = new Set(result.categories.young.map((card) => card.id));
  const fresh = result.categories.form.filter((card) => !youngIds.has(card.id));
  assert.equal(fresh.length, 3, "önce gösterilmemiş 3 oyuncu, sonra tekrar");
});

check("eksik değer '–' basılır, 0 uydurulmaz", () => {
  const result = { categories: { young: [{ id: "x", name: "X", team: null, age: 19, minutes: 300, goals: null, assists: null, seasonRating: null, lastRating: null, photoUrl: "", photoAlt: "X", initials: "X" }], surprise: [], form: [] } };
  const html = renderTrendCategoryTabs(result, "tr", () => "./futbolcu/x");
  assert.ok(html.includes(`Gol <b>${MISSING}</b>`));
  assert.ok(html.includes(`Asist <b>${MISSING}</b>`));
  assert.ok(html.includes(`Sezon reytingi <b>${MISSING}</b>`));
  assert.ok(!/player-rating-badge/.test(html), "reyting yoksa rozet basılmaz");
});

/* --- 2. Yayımlanan ana sayfalar ------------------------------------ */
function block(file) {
  const html = fs.readFileSync(path.join(root, file), "utf8");
  const start = html.indexOf("data-trend-player-tabs");
  assert.ok(start > 0, `${file}: trend kategori bloğu yok`);
  const end = html.indexOf('class="trend-category-source"', start);
  return html.slice(start, end);
}

function metric(card, label) {
  const match = card.match(new RegExp(`<span>${label} <b>([^<]*)</b></span>`));
  return match ? match[1] : null;
}

for (const [file, locale, resolveHref] of [
  ["index.html", "tr", (href) => `${href.replace(/^\.\//, "")}.html`],
  // `/en` eğik çizgisiz sunulduğundan en/index.html'deki bağlantılar kök mutlak
  // yazılır (scripts/lib/servedLinks.mjs); ikisi de dosya yoluna çevrilir.
  ["en/index.html", "en", (href) => (href.startsWith("/") ? href.slice(1) : `en/${href.replace(/^\.\//, "")}`)]
]) {
  const labels = locale === "tr"
    ? { age: "Yaş", minutes: "Dakika", rating: "Sezon reytingi" }
    : { age: "Age", minutes: "Minutes", rating: "Season rating" };

  check(`${file}: üç sekme, erişilebilir bağlar`, () => {
    const b = block(file);
    const tabs = b.match(/<label class="standings-tabs__label"[^>]*role="tab"[^>]*>/g) || [];
    assert.equal(tabs.length, 3);
    for (const id of ["young", "surprise", "form"]) {
      assert.ok(b.includes(`id="trend-player-tab-${id}"`), `${id} radyosu`);
      assert.ok(b.includes(`aria-controls="trend-player-panel-${id}"`), `${id} aria-controls`);
      assert.ok(b.includes(`id="trend-player-panel-${id}" role="tabpanel" aria-labelledby="trend-player-tablabel-${id}"`), `${id} paneli`);
    }
  });

  check(`${file}: kartlar var olan profile bağlanıyor, kategori başına <= ${RULES.cap}`, () => {
    const b = block(file);
    for (const id of ["young", "surprise", "form"]) {
      const panel = b.slice(b.indexOf(`id="trend-player-panel-${id}"`)).split("</section>")[0];
      const cards = panel.match(/<article class="card player-detail-card trend-category-card"[\s\S]*?<\/article>/g) || [];
      assert.ok(cards.length <= RULES.cap, `${id}: ${cards.length} kart`);
      for (const card of cards) {
        const href = (card.match(/class="detail-link" href="([^"]+)"/) || [])[1];
        assert.ok(href, "profil bağlantısı yok");
        if (locale === "tr") assert.match(href, /^\.\/futbolcu\/[a-z0-9-]+$/, href);
        assert.ok(fs.existsSync(path.join(root, resolveHref(href))), `${href} hedefi yok`);
        const img = card.match(/<img [^>]*>/);
        if (img) {
          assert.match(img[0], /loading="lazy"/);
          assert.match(img[0], /alt="[^"]+"/);
          assert.match(img[0], /src="https:\/\/media\.api-sports\.io\//);
        }
        const rating = metric(card, labels.rating);
        assert.ok(rating === MISSING || /^\d+[.,]\d$/.test(rating), `reyting biçimi: ${rating}`);
        assert.ok(rating === MISSING || Number(rating.replace(",", ".")) > 0, "uydurma sıfır reyting");
        if (id === "young") {
          const age = Number(metric(card, labels.age));
          const minutes = Number(metric(card, labels.minutes));
          assert.ok(Number.isFinite(age) && age < 21, `U21 kartında yaş ${metric(card, labels.age)}`);
          assert.ok(Number.isFinite(minutes) && minutes >= 200, `U21 kartında dakika ${metric(card, labels.minutes)}`);
        }
      }
    }
  });
}

if (failures) {
  console.error(`\ntrend-player-categories: ${failures} denetim düştü.`);
  process.exit(1);
}
console.log("\ntrend-player-categories: tüm denetimler geçti.");
