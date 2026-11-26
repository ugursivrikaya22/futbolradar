/**
 * Oyuncu sayfası zenginleştirme: özet şeridi (yaş, uyruk, güncel kulüp, sezon
 * gol/asist/dakika, son haber) ve BOŞ BÖLÜM GİZLEME — veri yoksa bölüm ve
 * başlığı hiç basılmaz.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { renderPlayer360 } from "./lib/player360.mjs";
import { turkishPlayer360 } from "./lib/player360English.mjs";

const require = createRequire(import.meta.url);
const { buildPlayer360 } = require("../services/player360Service.js");
const { publicPlayerView } = require("../services/cardCredibility.js");
const { getPlayers } = require("../services/playerService.js");
const raw = require("../data/players.json");
const { publishableNews } = require("../services/newsFeed.js");
const newsItems = publishableNews(require("../data/news.json"));

function check(name, fn) {
  fn();
  console.log(`ok - ${name}`);
}

const build = (player, players = [], extra = {}) => turkishPlayer360(buildPlayer360({
  player, credibility: publicPlayerView(player), players, transfers: [], news: [], matches: [], archive: [], ...extra
}));

/** Başlığı olup gövdesi boş kalan bölümler. */
function emptyBodySections(html) {
  const offenders = [];
  for (const match of html.matchAll(/<section class="p360[^"]*"[^>]*data-p360-section="([^"]+)"[^>]*>([\s\S]*?)<\/section>/g)) {
    const body = match[2].replace(/<div class="p360-head">[\s\S]*?<\/div>/, "").replace(/<[^>]+>/g, "").trim();
    if (!body && !/^(links)$/.test(match[1])) offenders.push(match[1]);
  }
  return offenders;
}

check("verisi olmayan kayıtta sezon ve haber bölümü hiç basılmaz (boş başlık yok)", () => {
  const html = renderPlayer360(build({ id: "bare", name: "Boş Kayıt", position: "Defender" }), { locale: "tr" });
  assert.ok(!html.includes('data-p360-section="season"'), "boş sezon bölümü");
  assert.ok(!html.includes('data-p360-section="news"'), "boş haber bölümü");
  assert.ok(!html.includes("Son Haberler"), "boş haber başlığı");
  assert.ok(!html.includes("İstatistikleri"), "boş istatistik başlığı");
  assert.ok(!html.includes("henüz doğrulanmış bir kaynakla eşleşmedi"));
  assert.ok(!html.includes("güncel haber bulunmuyor"));
  assert.ok(!html.includes('data-p360-section="summary"'), "veri yokken özet şeridi basılmaz");
  assert.deepEqual(emptyBodySections(html), []);
});

check("özet şeridi yaş, uyruk ve kulübü taşır; sezon verisi yoksa gol/asist/dakika basılmaz", () => {
  const player = {
    id: "p-sum", name: "Özet Oyuncu", position: "Attacker", nationality: "Nigeria",
    birthDate: "2000-01-06", computedAge: 26, team: "Galatasaray", currentTeam: "Galatasaray"
  };
  const model = build(player);
  const html = renderPlayer360(model, { locale: "tr" });
  const summary = (html.match(/data-p360-section="summary">([\s\S]*?)<\/section>/) || [])[1] || "";
  assert.ok(summary, "özet şeridi yok");
  assert.match(summary, /<span>Yaş<\/span><b>26<\/b>/);
  assert.match(summary, /<span>Ülke<\/span><b>Nijerya<\/b>/);
  if (model.identity.team) assert.match(summary, /<span>Kulüp<\/span><b>Galatasaray<\/b>/);
  if (!model.seasonStats.available) assert.ok(!/<span>Gol<\/span>/.test(summary));
});

check("sezon verisi ve haber varsa şerit gol/asist/dakika ve son haberi gösterir", () => {
  const player = { id: "p-s", name: "Sezon Oyuncu", position: "Attacker", team: "Galatasaray", currentTeam: "Galatasaray", computedAge: 25 };
  const model = build(player);
  model.seasonStats = { available: true, season: "2026/27", core: [
    { key: "appearances", value: 12 }, { key: "goals", value: 5 }, { key: "assists", value: 3 }, { key: "minutes", value: 980 }
  ], positional: [] };
  model.news = { transfer: [], general: [{ title: "Sezon Oyuncu hat-trick yaptı", href: "../haber/x.html", category: "Haber", publishedAt: "2026-11-20", trustKey: "verified" }] };
  const html = renderPlayer360(model, { locale: "tr" });
  const summary = (html.match(/data-p360-section="summary">([\s\S]*?)<\/section>/) || [])[1] || "";
  for (const [label, value] of [["Maç", "12"], ["Gol", "5"], ["Asist", "3"], ["Dakika", "980"]]) {
    assert.ok(summary.includes(`<span>${label}</span><b>${value}</b>`), `${label} eksik`);
  }
  assert.ok(summary.includes("Son haber") && summary.includes("Sezon Oyuncu hat-trick yaptı"));
  assert.ok(html.includes('data-p360-section="season"'));
  assert.ok(html.includes('data-p360-section="news"'));
  assert.deepEqual(emptyBodySections(html), []);
});

check("gerçek veriden örneklem (her 5. kayıt): boş gövdeli bölüm yok; bölüm yalnızca veri varsa", () => {
  const players = getPlayers(raw);
  const offenders = [];
  let withSeason = 0;
  let withNews = 0;
  for (const player of players.filter((_, index) => index % 5 === 0)) {
    const model = build(player, players, { news: newsItems });
    const html = renderPlayer360(model, { locale: "tr" });
    const empty = emptyBodySections(html);
    if (empty.length) offenders.push(`${player.id}: ${empty.join(",")}`);
    assert.equal(html.includes('data-p360-section="season"'), Boolean(model.seasonStats.available), `${player.id}: sezon bölümü ↔ veri`);
    assert.equal(html.includes('data-p360-section="news"'), model.news.general.length > 0, `${player.id}: haber bölümü ↔ veri`);
    if (model.seasonStats.available) withSeason += 1;
    if (model.news.general.length) withNews += 1;
  }
  assert.deepEqual(offenders.slice(0, 3), []);
  console.log(`  (örneklemde sezon verili ${withSeason}, haberli ${withNews})`);
});

check("İngilizce çıktı da aynı kuralı izler", () => {
  const html = renderPlayer360(build({ id: "bare", name: "Empty Record" }), { locale: "en" });
  assert.ok(!html.includes('data-p360-section="season"') && !html.includes('data-p360-section="news"'));
  assert.deepEqual(emptyBodySections(html), []);
});
