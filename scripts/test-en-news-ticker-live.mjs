/**
 * İNGİLİZCE HABER BANDINDA CANLI SKOR — satır üretimi testleri.
 *
 * `en-live-scores.js` mevcut `?live=all` yanıtından İngilizce "Headlines"
 * bandına `news-ticker-item` biçiminde canlı maç satırı ekler. Burada:
 *  - yalnızca API-Football yanıtı + iki tarafta sayı olan skor + canlı durum
 *    satır üretir (uydurma skor ve yanlış atıf yok),
 *  - canlı maç yoksa hiç satır yok (boş/yanıltıcı satır basılmaz),
 *  - canlı satır sınırı haber satırlarından bağımsızdır,
 *  - Türkçe sayfalar ve PWA dosyaları bu değişiklikten etkilenmez.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = process.cwd();
const client = fs.readFileSync(path.join(root, "en-live-scores.js"), "utf8");
const block = client.match(/\/\/ en-live-core:start([\s\S]*?)\/\/ en-live-core:end/);
assert.ok(block, "canlı satır çekirdeği işaretli olmalı");

function load(lang) {
  const context = {
    Date, Number, String, Array, JSON, isFinite, Math,
    document: { documentElement: { getAttribute: () => lang } }
  };
  vm.createContext(context);
  vm.runInContext(block[1] + "\nthis.newsLiveRows = newsLiveRows;\nthis.fromApiFootball = fromApiFootball;\nthis.NEWS_LIVE_LIMIT = NEWS_LIVE_LIMIT;", context);
  return context;
}

const en = load("en");
const now = Date.parse("2026-11-24T21:30:00+03:00");
const live = {
  id: "fx-1",
  providerIds: { apiFootball: 1501 },
  status: "LIVE",
  minute: 41,
  league: "UEFA Champions League",
  kickoff: "2026-11-24T20:45:00+03:00",
  homeTeam: { name: "Galatasaray" },
  awayTeam: { name: "Aston Villa" },
  score: { home: 1, away: 0 }
};
const payload = (data, extra = {}) => ({ ok: true, source: "api-football", data, ...extra });

// 1. Biçim: "Ev 1-0 Dep · dakika · lig", atıf aria'da.
{
  const rows = en.newsLiveRows(payload([live]), now);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].text, "Galatasaray 1-0 Aston Villa · 41' · UEFA Champions League");
  assert.equal(rows[0].href, "/en/match-detail.html?fixtureId=1501");
  assert.match(rows[0].aria, /^Live: Galatasaray 1-0 Aston Villa/);
  assert.match(rows[0].aria, /Data: API-Football$/);
}

// 2. Devre arası / dakika yok → durum etiketi; dakika uydurulmaz.
{
  const ht = { ...live, status: "HT", minute: null };
  assert.equal(en.newsLiveRows(payload([ht]), now)[0].text, "Galatasaray 1-0 Aston Villa · HT · UEFA Champions League");
  const noMinute = { ...live, minute: undefined, league: "" };
  assert.equal(en.newsLiveRows(payload([noMinute]), now)[0].text, "Galatasaray 1-0 Aston Villa · Live");
}

// 3. Uydurma skor / canlı olmayan / pencere dışı maç satır üretmez.
{
  const noScore = { ...live, score: { home: null, away: 0 } };
  const notStarted = { ...live, status: "NS" };
  const finished = { ...live, status: "FT" };
  const expired = { ...live, kickoff: "2026-11-24T17:00:00+03:00" };
  const noTeam = { ...live, awayTeam: { name: "" } };
  assert.deepEqual(Array.from(en.newsLiveRows(payload([noScore, notStarted, finished, expired, noTeam]), now)), []);
}

// 4. Atıf doğru olmalı: API-Football dışı ya da hatalı yanıt → satır yok.
{
  assert.equal(en.newsLiveRows(payload([live], { source: "mock" }), now).length, 0);
  assert.equal(en.newsLiveRows(payload([live], { source: "thesportsdb-daily" }), now).length, 0);
  assert.equal(en.newsLiveRows(payload([live], { source: "FutbolRadar API", meta: { provider: "api-football" } }), now).length, 1);
  assert.equal(en.newsLiveRows({ ok: false, source: "api-football", data: [live] }, now).length, 0);
  assert.equal(en.newsLiveRows(null, now).length, 0);
  assert.equal(en.newsLiveRows(payload([]), now).length, 0, "canlı maç yoksa boş satır basılmaz");
}

// 5. Canlı satırların kendi sınırı var (haber satırları sayılmaz).
{
  const many = Array.from({ length: 20 }, (_, i) => ({ ...live, id: `fx-${i}`, providerIds: { apiFootball: 2000 + i } }));
  const rows = en.newsLiveRows(payload(many), now);
  assert.equal(rows.length, en.NEWS_LIVE_LIMIT);
  assert.ok(en.NEWS_LIVE_LIMIT <= 8);
}

// 6. İstemci: yalnızca tam (kayan) İngilizce bant; kompakt bant site.js'e kalır.
{
  assert.match(client, /\.news-ticker\[data-shared-layout="ticker"\]:not\(\.news-ticker-compact\)/);
  assert.match(client, /news-ticker-item news-ticker-item--live/);
  assert.match(client, /Data: API-Football/);
  assert.match(client, /data-live-ticker/);
  assert.match(client, /localeOf\(\) !== "en"/, "Türkçe sayfada betik çalışmamalı");
  assert.doesNotMatch(client, /news-ticker\.json|data\/ticker\.json/, "kayan yazı veri dosyalarına dokunulmaz");
  assert.doesNotMatch(client, /serviceWorker|caches\./, "PWA/önbellek mantığına dokunulmaz");
}

// 7. İngilizce ana sayfa tam bandı ve istemciyi taşır; TR ana sayfa yüklemez.
{
  const home = fs.readFileSync(path.join(root, "en", "index.html"), "utf8");
  assert.match(home, /<div class="news-ticker" data-shared-layout="ticker"/);
  assert.match(home, /en-live-scores\.js\?v=[0-9a-f]{8}/);
  const tr = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.doesNotMatch(tr, /en-live-scores\.js/);
}

console.log("en-news-ticker-live OK");
