/**
 * Dünya futbolu bandı: besleme ayrıştırma, tekilleştirme, iddia etiketi,
 * zorunlu kaynak, beyaz liste, API-Football skoru ve kuru koşu.
 */
import assert from "node:assert/strict";
import { parseRss } from "./sync-football-news.mjs";
import {
  apiFootballScoreItems,
  buildWorldItems,
  canonicalArticleUrl,
  classifyHeadline,
  inWorldScope,
  isApiFootballMatch,
  mergeWorldItems,
  translateHeadline
} from "./lib/worldFootballTicker.mjs";
import { runWorldTicker } from "./sync-world-football-ticker.mjs";

const NOW = Date.parse("2026-11-24T12:00:00Z");

function itemXml({ title, link, date }) {
  return `<item><title><![CDATA[${title}]]></title><link>${link}</link><pubDate>${date}</pubDate></item>`;
}

const rss = `<?xml version="1.0"?><rss version="2.0"><channel>
  ${itemXml({
    title: "Chelsea want Boubacar Kamara as midfield talks continue",
    link: "https://www.bbc.co.uk/sport/football/articles/claim1?at_medium=RSS&at_campaign=rss",
    date: "Tue, 24 Nov 2026 09:00:00 GMT"
  })}
  ${itemXml({
    title: "Chelsea want Boubacar Kamara as midfield talks continue",
    link: "https://www.bbc.co.uk/sport/football/articles/claim1",
    date: "Tue, 24 Nov 2026 09:00:00 GMT"
  })}
  ${itemXml({
    title: "Arsenal beat Chelsea 2-1 in the Premier League",
    link: "https://www.bbc.co.uk/sport/football/articles/result1",
    date: "Tue, 24 Nov 2026 08:00:00 GMT"
  })}
  ${itemXml({
    title: "Real Madrid win in La Liga",
    link: "https://example.com/not-allowed",
    date: "Tue, 24 Nov 2026 08:00:00 GMT"
  })}
  ${itemXml({
    title: "Headline without a source url here today",
    link: "",
    date: "Tue, 24 Nov 2026 08:00:00 GMT"
  })}
  ${itemXml({
    title: "Tennis star wins another final in Melbourne",
    link: "https://www.bbc.co.uk/sport/tennis/final",
    date: "Tue, 24 Nov 2026 08:00:00 GMT"
  })}
</channel></rss>`;

const parsed = parseRss(rss, { id: "bbc-football", name: "BBC Sport", lang: "en" })
  .map((entry) => ({ ...entry, feed: { id: "bbc-football", name: "BBC Sport", lang: "en" } }));

assert.equal(canonicalArticleUrl("https://www.bbc.co.uk/sport/football/articles/claim1?at_medium=RSS&at_campaign=rss").includes("at_medium"), false);
assert.equal(inWorldScope("Arsenal beat Chelsea 2-1 in the Premier League"), true);
assert.equal(inWorldScope("Tennis star wins another final in Melbourne"), false);
assert.equal(inWorldScope("Fantacampionato, la top 11 della 12ª giornata di Serie A"), false);
assert.deepEqual(classifyHeadline("Chelsea want Boubacar Kamara"), { category: "transfer-rumour", confidence: "claim" });
assert.equal(classifyHeadline("Arsenal beat Chelsea 2-1 in the Premier League").confidence, "confirmed");

const built = await buildWorldItems([
  ...parsed,
  { title: "Headline without a source url here today", link: "", publishedAt: "Tue, 24 Nov 2026 08:00:00 GMT", feed: { id: "bbc-football", name: "BBC Sport", lang: "en" } }
], { nowMs: NOW, translateEnabled: false });
assert.equal(built.items.length, 2, "yinelenen adres ve elenenler düşmeli");
const claim = built.items.find((item) => item.confidence === "claim");
const result = built.items.find((item) => item.category === "post-match");
assert.ok(claim, "transfer iddiası claim olmalı");
assert.ok(claim.text.toLocaleLowerCase("tr").includes("iddia"));
assert.equal(claim.category, "transfer-rumour");
assert.equal(claim.source.name, "BBC Sport");
assert.equal(claim.source.url, "https://www.bbc.co.uk/sport/football/articles/claim1");
assert.ok(result.source.url.startsWith("https://www.bbc.co.uk/"));
assert.ok(built.rejected.some((row) => /beyaz liste/.test(row.reason)));
assert.ok(built.rejected.some((row) => /eksik/.test(row.reason)));

const merged = mergeWorldItems({
  items: [
    { id: "manual-breaking", breaking: true, text: "Elle girilen son dakika" },
    { id: "world-old", origin: "world-rss", text: "eski otomatik" }
  ]
}, built.items);
assert.equal(merged.items[0].id, "manual-breaking");
assert.ok(merged.items.every((item) => item.id !== "world-old"));
assert.ok(merged.items.some((item) => item.origin === "world-rss"));

const translated = await buildWorldItems(parsed.filter((entry) => /result1/.test(entry.link)), {
  nowMs: NOW,
  translate: async (text, source, target) => (target === "tr" ? "Arsenal, Premier Lig'de Chelsea'yi 2-1 yendi" : text)
});
assert.equal(translated.items[0].textLang, "tr");
assert.match(translated.items[0].text, /2-1/);
assert.equal(translated.items[0].en.text, "Arsenal beat Chelsea 2-1 in the Premier League");

const invented = await translateHeadline("Arsenal beat Chelsea 2-1", "en", "tr", {
  url: "https://translate.example/hook",
  fetch: async () => ({ ok: true, json: async () => ({ text: "Arsenal 9-0 kazandı ve kupa aldı" }) })
});
assert.equal(invented, null, "skor uyduran çeviri reddedilmeli");

assert.equal(isApiFootballMatch({ source: "api-football" }), true);
assert.equal(isApiFootballMatch({ source: "thesportsdb" }), false);
assert.equal(isApiFootballMatch({ providerName: "TheSportsDB", source: "api-football" }), false);

const scores = apiFootballScoreItems([
  {
    id: "live-1",
    source: "api-football",
    league: "Premier League",
    status: "LIVE",
    kickoff: "2026-11-24T10:30:00Z",
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    score: { home: 1, away: 0 }
  },
  {
    id: "old",
    source: "api-football",
    league: "Premier League",
    status: "FINISHED",
    kickoff: "2026-11-20T10:30:00Z",
    homeTeam: "Liverpool",
    awayTeam: "Everton",
    score: { home: 2, away: 2 }
  },
  {
    id: "tsdb",
    source: "thesportsdb",
    league: "Premier League",
    status: "LIVE",
    kickoff: "2026-11-24T11:00:00Z",
    homeTeam: "Milan",
    awayTeam: "Inter",
    score: { home: 0, away: 0 }
  }
], { nowMs: NOW });
assert.equal(scores.length, 1);
assert.equal(scores[0].text, "Arsenal 1-0 Chelsea");
assert.equal(scores[0].sourceName, "API-Football");
assert.equal(scores[0].provider, "api-football");

const dry = await runWorldTicker({
  now: new Date(NOW),
  feeds: [{ id: "bbc-football", name: "BBC Sport", lang: "en", url: "https://feeds.example/bbc" }],
  fetchText: async () => rss,
  previous: { items: [{ id: "manual-breaking", text: "Elle" }] },
  translateUrl: ""
});
assert.equal(dry.changed, true);
assert.equal(dry.merged.items[0].id, "manual-breaking");
assert.ok(dry.skipped.some((feed) => feed.id === "flashscore"));
assert.equal(dry.translateConfigured, false);

console.log("world-football-ticker testleri geçti");
