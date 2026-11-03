/** İzlerken skor: kayıt doğrulama, sayfa şablonu, canlı panel ve CSP testleri. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { watchPageHtml, matchWatchCard } from "./lib/youtubeWatchPage.mjs";

const require = createRequire(import.meta.url);
const yt = require("../services/youtubeWatch.js");
const client = require("../youtube-watch.js");
let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`ok - ${name}`); };

const valid = {
  slug: "galatasaray-fenerbahce-2026-2027-r10", youtubeId: "dQw4w9WgXcQ", homeTeam: "Galatasaray", awayTeam: "Fenerbahçe",
  kickoff: "2026-11-01T20:00:00+03:00", providerId: "1234567", channelName: "Örnek Resmi Kanal",
  channelUrl: "https://www.youtube.com/@ornekresmi", source: "yayinci", matchPath: "/mac/galatasaray-fenerbahce-2026-2027-r10.html"
};

test("geçerli kayıt kabul edilir", () => { assert.equal(yt.normalizeEntry(valid).entry.youtubeId, "dQw4w9WgXcQ"); });
test("geçersiz kayıtlar düşer", () => {
  for (const bad of [{ youtubeId: "short" }, { youtubeId: "dQw4w9WgXcQ\"><script>" }, { channelUrl: "https://evil.example/@x" }, { source: "fan" }, { kickoff: "yarın" }, { slug: "Bad Slug" }, { matchPath: "javascript:alert(1)" }, { providerId: "abc" }]) {
    assert.ok(yt.normalizeEntry({ ...valid, ...bad }).error, JSON.stringify(bad));
  }
});
test("yinelenen slug ve boş liste", () => {
  const { entries, errors } = yt.loadEntries({ streams: [valid, valid, { slug: "x" }] });
  assert.equal(entries.length, 1); assert.equal(errors.length, 2);
  assert.deepEqual(yt.loadEntries({}).entries, []);
});
test("depodaki data/youtube-watch.json geçerli ve hatasız", () => {
  const store = JSON.parse(fs.readFileSync("data/youtube-watch.json", "utf8"));
  assert.equal(yt.loadEntries(store).errors.length, 0);
});
test("embed yalnızca youtube-nocookie", () => {
  assert.match(yt.embedUrl(valid.youtubeId), /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/);
  assert.equal(client.iframeSrc("bad"), "");
  assert.throws(() => yt.embedUrl("bad"));
});

const entry = yt.normalizeEntry(valid).entry;
const cfg = { ...entry, watchUrl: yt.watchUrl(entry.youtubeId) };
const kickoff = Date.parse(entry.kickoff);
test("sayfa: tıkla-yükle facade, iframe yok, yapılandırma gömülü", () => {
  const html = watchPageHtml(entry, null, kickoff - 3600000);
  assert.ok(html.includes("data-ytw-facade"));
  assert.ok(!/<iframe/i.test(html), "iframe ilk yüklemede olmamalı");
  assert.ok(html.includes('id="yt-watch-config"'));
  assert.ok(html.includes("MAÇ ÖNCESİ"));
  assert.ok(!html.includes("Yayını tekrar izle"));
  assert.ok(html.includes('lang="tr"'));
});
test("sayfa: bitmiş maçta final skor + arşiv linki", () => {
  const html = watchPageHtml(entry, { home: 2, away: 1 }, kickoff + 7200000);
  assert.ok(html.includes("MAÇ SONU")); assert.ok(html.includes("2 – 1"));
  assert.ok(html.includes("Yayını tekrar izle")); assert.ok(html.includes("https://www.youtube.com/watch?v=dQw4w9WgXcQ"));
});
test("maç sayfası kartı yalnızca kayıt varsa", () => {
  assert.equal(matchWatchCard(null), "");
  assert.ok(matchWatchCard(entry).includes("../izle/galatasaray-fenerbahce-2026-2027-r10.html"));
});
test("akış eşleşmesi: kimlik, sonra takım adı; başka maç eşleşmez", () => {
  assert.ok(client.findMatch([{ providerId: "1234567" }], cfg));
  assert.ok(client.findMatch([{ id: "x", homeTeam: "GALATASARAY", awayTeam: "Fenerbahce" }], { ...cfg, providerId: null }));
  assert.equal(client.findMatch([{ providerId: "9", homeTeam: "Beşiktaş", awayTeam: "Trabzonspor" }], cfg), null);
});
test("canlı paket: skor, dakika, gol; olaysız paket golleri silmez", () => {
  const live = { providerId: "1234567", status: "2H", minute: 67, homeTeamId: "645", awayTeamId: "611", score: { home: 1, away: 0 }, events: [{ type: "Goal", detail: "Normal Goal", time: "23", teamId: "645" }] };
  let s = client.apply({}, live, cfg, kickoff + 4000000);
  assert.equal(client.mode(s, cfg, kickoff + 4000000), "live");
  let html = client.panelHtml(s, cfg, kickoff + 4000000);
  assert.ok(html.includes("🔴 CANLI") && html.includes("1 – 0") && html.includes("67′") && html.includes("23′") && html.includes("Galatasaray"));
  s = client.apply(s, { ...live, minute: 70, events: [] }, cfg, kickoff + 4200000);
  assert.equal(s.goals.length, 1);
  s = client.apply(s, { ...live, status: "FT", score: { home: 1, away: 1 } }, cfg, kickoff + 6800000);
  html = client.panelHtml(s, cfg, kickoff + 6800000);
  assert.ok(html.includes("MAÇ SONU") && html.includes("1 – 1") && html.includes("Yayını tekrar izle"));
});
test("kaçan penaltı gol sayılmaz, devre arası etiketi", () => {
  assert.equal(client.goalsFrom({ events: [{ type: "Goal", detail: "Missed Penalty" }] }, cfg).length, 0);
  assert.ok(client.panelHtml({ status: "HT", score: { home: 0, away: 0 } }, cfg, kickoff + 2900000).includes("Devre arası"));
});
test("veri gelmeyen eski yayın arşiv moduna düşer", () => {
  assert.equal(client.mode({}, cfg, kickoff + 4 * 3600000), "archive");
  assert.ok(client.panelHtml({}, cfg, kickoff + 4 * 3600000).includes("Yayını tekrar izle"));
});
test("panel HTML kaçışlı", () => {
  assert.ok(!client.panelHtml({ goals: [{ time: "1", side: "home", player: "<img onerror=x>" }] }, cfg, kickoff + 100).includes("<img"));
});
test("CSP yalnızca youtube-nocookie çerçevesine izin verir", () => {
  const v = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
  const csp = v.headers.flatMap((h) => h.headers).find((h) => h.key === "Content-Security-Policy").value;
  assert.match(csp, /frame-src https:\/\/www\.youtube-nocookie\.com;/);
  assert.ok(!/frame-src[^;]*\*/.test(csp));
});
test("service worker yabancı kökenleri yakalamaz", () => {
  assert.ok(fs.readFileSync("sw.js", "utf8").includes("if (url.origin !== self.location.origin) return;"));
});
console.log(`\n${passed} youtube-watch tests passed`);
