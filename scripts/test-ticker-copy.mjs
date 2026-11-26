/**
 * SON DAKİKA BANDI — takım adı dili ve kelime sınırında kısaltma.
 *
 * Bildirilen: "Italy 3-1 Türkiye" (iki takım iki ayrı dilde) ve kompakt bantta
 * "Basın ...R" gibi kelime ortasından kesilmiş metin.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { shortenTickerText, COMPACT_TICKER_TEXT_LIMIT, newsTicker, tickerFeedPayload } from "./lib/layout.mjs";
import { apiFootballScoreItems } from "./lib/worldFootballTicker.mjs";

const require = createRequire(import.meta.url);
const { nationLabelTr } = require("../services/displayLabels.js");
let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`ok - ${name}`); };

test("millî takım adı Türkçeleşir, kulüp adına dokunulmaz", () => {
  assert.equal(nationLabelTr("Italy"), "İtalya");
  assert.equal(nationLabelTr("italy"), "İtalya");
  assert.equal(nationLabelTr("Iceland"), "İzlanda", "I harfi Türkçe kuralıyla küçültülmemeli");
  assert.equal(nationLabelTr("Ireland"), "İrlanda");
  assert.equal(nationLabelTr("Türkiye"), "Türkiye");
  assert.equal(nationLabelTr("Turkey"), "Türkiye");
  assert.equal(nationLabelTr("İtalya"), "İtalya", "zaten Türkçe olan değişmez");
  for (const club of ["Beşiktaş", "Arsenal", "Borussia Dortmund", "Real Madrid", ""]) {
    assert.equal(nationLabelTr(club), club);
  }
});

test("API-Football skor öğesi: TR bandında Türkçe, EN bandında kayıttaki ad", () => {
  const kickoff = "2026-11-24T10:30:00Z";
  const nowMs = Date.parse(kickoff) + 3600 * 1000;
  const rows = [{
    id: "x1", source: "api-football", homeTeam: "Italy", awayTeam: "Türkiye",
    league: "Premier League", status: "LIVE", kickoff, score: { home: 3, away: 1 }
  }];
  const tr = apiFootballScoreItems(rows, { nowMs, locale: "tr" });
  const en = apiFootballScoreItems(rows, { nowMs, locale: "en" });
  assert.equal(tr.length, 1, "TR satırı üretilmeli (test boş geçmesin)");
  assert.equal(en.length, 1);
  assert.equal(tr[0].text, "İtalya 3-1 Türkiye");
  assert.equal(en[0].text, "Italy 3-1 Türkiye");
});

test("tickerFeed maç öğeleri takım adını Türkçeleştirir (kaynak denetimi)", () => {
  const src = fs.readFileSync("scripts/lib/tickerFeed.mjs", "utf8");
  assert.ok(!src.includes("text: `${match.homeTeam} ${match.score.home}"), "ham homeTeam basılmamalı");
  assert.equal((src.match(/nationLabelTr\(match\.homeTeam\)/g) || []).length, 2, "canlı ve sonuç öğesi");
});

test("shortenTickerText: sınırı aşmayan metin aynen döner", () => {
  assert.equal(shortenTickerText("Italy 3-1 Türkiye"), "Italy 3-1 Türkiye");
  assert.equal(shortenTickerText("a".repeat(COMPACT_TICKER_TEXT_LIMIT)), "a".repeat(COMPACT_TICKER_TEXT_LIMIT));
});

test("shortenTickerText: kelime sınırında keser, sınırı aşmaz, kelime bölmez", () => {
  const text = "Fotomaç'ın Takvim'e dayandırdığı iddiaya göre Fenerbahçe devre arasında Archie Brown ve Nene'yi satacak, Kante ve Mosquera için girişim yapacak";
  const short = shortenTickerText(text);
  assert.ok(short.length <= COMPACT_TICKER_TEXT_LIMIT, `${short.length} > limit`);
  assert.ok(short.endsWith("…"));
  const body = short.slice(0, -1);
  assert.ok(text.startsWith(body), "metnin başı korunmalı");
  assert.ok(text[body.length] === " " || text[body.length] === ",", `kelime ortasında kesildi: "${short}"`);
  assert.ok(!/[,;:\-–—\s]…$/u.test(short), "sarkan noktalama kalmamalı");
  // Kesilmiş görünen eski örnek: tek harflik "R" kuyruğu olmamalı.
  assert.ok(!/\s\S…$/u.test(short) || text.includes(` ${short.slice(-2, -1)} `), "tek harflik artık kalmamalı");
});

test("shortenTickerText: çok uzun tek sözcük ve boşluk normalleşmesi", () => {
  assert.equal(shortenTickerText("Süper   Lig  haftası"), "Süper Lig haftası");
  assert.equal(shortenTickerText("x".repeat(200), 50), "x".repeat(200), "bölünecek sözcük yoksa metin kesilmeden döner");
  assert.equal(shortenTickerText("kısa metin sonra çok uzun bir metin devam ediyor", 20), "kısa metin sonra…");
});

test("kompakt bant başlığı kısaltılır, tam metin aria-label'da kalır; tam bant kısaltılmaz", () => {
  const long = "Galatasaray ".repeat(20).trim();
  const compact = newsTicker({ base: "./", compact: true, badge: "Son Dakika", items: [{ text: long, href: "haber/x" }] });
  assert.ok(compact.includes('class="news-ticker-text"'));
  assert.ok(compact.includes("…</span>"), "başlık kısaltılmış olmalı");
  assert.ok(compact.includes(`aria-label="${long}"`), "tam metin erişilebilirlik etiketinde");
  const full = newsTicker({ base: "./", compact: false, badge: "Son Dakika", items: [{ text: long, href: "haber/x" }] });
  assert.ok(full.includes(`>${long}</span>`), "kayan tam bant kısaltılmaz");
});

test("istemci veri yükü: kısaltılmış metin + fullText", () => {
  const long = "Beşiktaş ".repeat(30).trim();
  const p = tickerFeedPayload({ tr: { badge: "Son Dakika", items: [{ text: long, href: "haber/x" }, { text: "Kısa", href: "haber/y" }] } });
  assert.ok(p.tr.items[0].text.length <= COMPACT_TICKER_TEXT_LIMIT && p.tr.items[0].text.endsWith("…"));
  assert.equal(p.tr.items[0].fullText, long);
  assert.equal(p.tr.items[1].fullText, undefined, "kısa metinde fullText yok");
});

test("CSS: kompakt bantta etiket/rozet/kaynak kırpılmaz, başlık kelime sınırında kesilir", () => {
  const css = fs.readFileSync("page.css", "utf8");
  assert.ok(/\.news-ticker-compact \.news-ticker-item > \.news-ticker-text\s*\{[^}]*-webkit-line-clamp:\s*1/.test(css), "başlık line-clamp ile kesilmeli");
  assert.ok(!/\.news-ticker-compact \.news-ticker-item > span\s*\{[^}]*text-overflow/.test(css), "her span'e text-overflow uygulanmamalı");
  const site = fs.readFileSync("site.js", "utf8");
  assert.ok(site.includes('make("span", "news-ticker-text", item.text)'), "istemci de aynı sınıfı basmalı");
});

console.log(`ticker copy: ${passed} test geçti`);
