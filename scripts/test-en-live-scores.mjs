/**
 * İNGİLİZCE CANLI SKOR KANCASI.
 *
 * Türkçe sayfalar app.js ile `?live=all` yoklar. İngilizce sayfalar app.js
 * yüklemez; kanca (`data-live-source`, `data-api-target="live-score"`) ve
 * etiketler `en-live-scores.js` üzerinden gelir. Ana sayfa listesi, fetchedAt
 * 150 saniyeden eski diye canlı skoru gizlemez.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";

const root = process.cwd();
// İstemcinin "oynanıyor" kümesi sunucunun kanonik sözlüğüne karşı denetlenir.
const { LIVE_STATES, STATUS_VOCABULARY, canonicalStatus } = createRequire(import.meta.url)("../services/matchStatus.js");

const { liveTickerBlock } = await import("./lib/liveScoresTicker.mjs");

const sample = [{
  league: "Süper Lig",
  homeTeam: "A",
  awayTeam: "B",
  homeScore: 1,
  awayScore: 0,
  minuteOrStatus: "12'",
  href: "mac-detay.html?id=1"
}];

// ── 1. EN bant canlı kancayı ?live=all ile basar ──────────────────────────
{
  const en = liveTickerBlock(sample, { locale: "en", live: true, keepEmpty: true, base: "../" });
  assert.match(en, /data-api-target="live-scores-ticker"/);
  assert.match(en, /data-live-source="\/api\/matches\?live=all"/);
  assert.doesNotMatch(en, /status=live/);
  assert.match(en, /data-live-empty-text="No live matches at the moment\."/);

  const tr = liveTickerBlock(sample, { locale: "tr", live: true, keepEmpty: true });
  assert.match(tr, /data-live-source="\/api\/matches\?status=live"/, "TR live kabuğu status=live damgasında kalmalı");
  assert.match(tr, /Şu anda canlı maç yok\./);

  const trStatic = liveTickerBlock(sample, { locale: "tr", keepEmpty: true });
  assert.match(trStatic, /data-source="static"/);
  assert.doesNotMatch(trStatic, /data-live-source/, "TR iç sayfa bandı statik kalmalı");
}

// ── 2. Üreticiler EN için live:true ve canlı sayfa kancasını basar ────────
{
  const enGenerator = fs.readFileSync(path.join(root, "scripts", "generate-en-pages.mjs"), "utf8");
  const ticker = enGenerator.match(/function liveScoresTicker\(\) \{[\s\S]*?\n\}/);
  assert.ok(ticker, "liveScoresTicker bulunmalı");
  assert.match(ticker[0], /live:\s*true/, "EN bant live:true ile basılmalı");

  const page = enGenerator.match(/function liveScoresPage\(\) \{[\s\S]*?\n\}/);
  assert.ok(page, "liveScoresPage bulunmalı");
  assert.match(page[0], /data-api-target="live-score"/);
  assert.match(page[0], /data-matches-day=/);
  assert.match(page[0], /filterScoredMatches\(todaysMatches\)/);

  const layout = fs.readFileSync(path.join(root, "scripts", "apply-shared-layout.mjs"), "utf8");
  assert.match(layout, /live:\s*locale === "en"/, "paylaşılan yerleşim canlı kancayı yalnızca EN sayfalara açmalı");
}

// ── 3. EN istemci etiketleri ve hafif uç ──────────────────────────────────
{
  const client = fs.readFileSync(path.join(root, "en-live-scores.js"), "utf8");
  assert.match(client, /live:\s*"Live"/);
  assert.match(client, /pageEmpty:\s*"No live matches right now\."/);
  assert.match(client, /ht:\s*"HT"/);
  assert.match(client, /ft:\s*"FT"/);
  assert.match(client, /LIVE_URL = "\/api\/matches\?live=all"/);
  assert.match(client, /fetch\(LIVE_URL/);
  assert.doesNotMatch(client, /\/api\/matches\?status=live/);
  assert.match(client, /localeOf\(\) !== "en"/, "Türkçe sayfada bu betik yoklama yapmamalı");
  assert.match(client, /Canlı/, "TR yedek dizisi app.js ile aynı kalmalı");
  assert.match(client, /Şu anda canlı maç yok\./);

  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  assert.match(app, /Şu anda canlı maç yok\./);
  assert.match(app, /LIVE: "Canlı"/);
}

// ── 4. Ana sayfa: eski fetchedAt canlı skoru gizlemez; ilk istek hafif ───
{
  const source = fs.readFileSync(path.join(root, "daily-fixtures-en.js"), "utf8");
  const block = source.match(/\/\/ en-home-live:start([\s\S]*?)\/\/ en-home-live:end/);
  assert.ok(block, "ana sayfa canlı kararı işaretli olmalı");
  assert.doesNotMatch(block[1], /150000/, "150 saniyelik fetchedAt kapısı kalkmalı");
  assert.match(source, /\/api\/matches\?live=all/);
  assert.match(source, /payloadIsLiveFeed/);

  const context = { Date, Number, String, isFinite, Object };
  vm.createContext(context);
  vm.runInContext(block[1] + "\nthis.homeKeepsLiveRow = homeKeepsLiveRow;\nthis.liveMinuteLabel = liveMinuteLabel;\nthis.isLiveStatus = isLiveStatus;\nthis.payloadIsLiveFeed = payloadIsLiveFeed;\nthis.PLAYING_TOKENS = PLAYING_TOKENS;\nthis.STOPPAGE_TOKENS = STOPPAGE_TOKENS;", context);

  const now = Date.parse("2026-10-05T10:00:00+03:00");
  const stale = {
    status: "LIVE",
    kickoff: "2026-10-05T09:30:00+03:00",
    fetchedAt: new Date(now - 10 * 60 * 1000).toISOString(),
    minute: 23,
    score: { home: 1, away: 0 }
  };
  assert.equal(context.homeKeepsLiveRow(stale, now), true, "10 dakikalık fetchedAt canlı satırı gizlememeli");
  assert.equal(context.liveMinuteLabel(stale), "23'");
  assert.equal(context.liveMinuteLabel({ status: "HT", minute: null }), "HT");
  assert.equal(context.liveMinuteLabel({ status: "FT" }), "FT");
  assert.equal(context.liveMinuteLabel({ status: "LIVE" }), "Live");

  const expired = { ...stale, kickoff: "2026-10-05T06:00:00+03:00" };
  assert.equal(context.homeKeepsLiveRow(expired, now), false, "maç penceresi dolmuş LIVE satırı listede kalmamalı");

  assert.match(source, /label: liveMinuteLabel\(row\)/, "bayat canlı kart son bilinen dakika/durumu yazmalı");

  // ── 4b. "OYNANIYOR" TEK TANIM VE SUNUCUYLA AYNI ───────────────────────────
  //
  // Dosyada iki ayrı liste vardı (kartlar için homeLiveStatus, sayaç için
  // isLiveStatus) ve ayrışmışlardı. Artık tek işlev var; kümesi sunucunun
  // LIVE_STATES sözlüğünden (services/matchStatus.js) sapamaz.
  assert.equal((source.match(/function isLiveStatus\(/g) || []).length, 1, "tek isLiveStatus tanımı olmalı");
  assert.doesNotMatch(source, /homeLiveStatus/, "ikinci canlı listesi geri gelmemeli");
  assert.equal((source.match(/'IN_PLAY'/g) || []).length, 1, "canlı kodları tek yerde yazılmalı (phaseOf dahil aynı kümeyi kullanır)");
  assert.equal((source.match(/'SUSP'/g) || []).length, 1, "kesinti kodları tek yerde yazılmalı");

  // İstemci durum jetonunu boşluk/tire → alt çizgi ile normalleştirir (statusTokens).
  const clientToken = (key) => key.toUpperCase().replace(/[\s-]+/g, "_");
  const serverLive = Object.keys(STATUS_VOCABULARY).filter((key) => LIVE_STATES.has(STATUS_VOCABULARY[key]));
  const clientLive = [...context.PLAYING_TOKENS, ...context.STOPPAGE_TOKENS];
  assert.deepEqual([...clientLive].sort(), serverLive.map(clientToken).sort(), "istemcinin canlı kümesi sunucunun LIVE_STATES sözlüğüyle birebir aynı olmalı");
  assert.deepEqual([...context.STOPPAGE_TOKENS].sort(), Object.keys(STATUS_VOCABULARY).filter((key) => STATUS_VOCABULARY[key] === "INTERRUPTED").sort(), "kesinti kodları sunucunun INTERRUPTED kümesi");
  assert.equal(new Set(clientLive).size, clientLive.length, "canlı kümesinde tekrar olmamalı");
  for (const key of Object.keys(STATUS_VOCABULARY)) {
    assert.equal(context.isLiveStatus(clientToken(key)), LIVE_STATES.has(canonicalStatus(key)), `${key}: istemci ile sunucu "oynanıyor" kararında ayrışıyor`);
  }
  assert.equal(context.isLiveStatus(""), false);
  assert.equal(context.isLiveStatus("UNKNOWN"), false);

  // Kesintiye uğramış maç oynanıyor sayılır: satır ana sayfada kalır ve hafif
  // canlı akış "tam gün verisi" sanılmaz (sanılsaydı derleme zamanı kartları silinirdi).
  const suspended = { status: "INTERRUPTED", providerStatus: "SUSP", kickoff: "2026-10-05T09:00:00+03:00", score: { home: 0, away: 0 } };
  assert.equal(context.homeKeepsLiveRow(suspended, now), true, "kesintiye uğramış maç canlı satır olarak kalmalı");
  assert.equal(context.homeKeepsLiveRow({ ...suspended, kickoff: "2026-10-05T06:00:00+03:00" }, now), false, "maç penceresi dolmuş kesinti satırı kalmamalı");
  assert.equal(context.homeKeepsLiveRow({ status: "IN_PLAY", kickoff: "2026-10-05T09:30:00+03:00" }, now), true);
  assert.equal(context.payloadIsLiveFeed([stale, suspended]), true, "kesintili maç içeren akış hâlâ canlı akıştır");
  assert.equal(context.payloadIsLiveFeed([stale, { status: "PAUSED" }, { providerStatus: "BT" }]), true);
  assert.equal(context.payloadIsLiveFeed([stale, { status: "SCHEDULED" }]), false, "karışık veri tam gündür");
  assert.equal(context.payloadIsLiveFeed([stale, { status: "FINISHED" }]), false);
}

// ── 5. Basılmış İngilizce sayfalar kancayı taşır; TR ana sayfa aynı kalır ─
{
  for (const file of ["en/index.html", "en/live-football-scores.html", "en/todays-matches.html", "en/standings.html"]) {
    const html = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(html, /data-live-source="\/api\/matches\?live=all"/, `${file} canlı kaynağı taşımalı`);
    assert.match(html, /en-live-scores\.js/, `${file} EN canlı istemcisini yüklemeli`);
    assert.doesNotMatch(html, /data-live-source="\/api\/matches\?status=live"/, `${file} ağır status sorgusunu kullanmamalı`);
  }
  const live = fs.readFileSync(path.join(root, "en", "live-football-scores.html"), "utf8");
  assert.match(live, /data-api-target="live-score"/);
  assert.match(live, /data-matches-day="\d{4}-\d{2}-\d{2}"/);

  const tr = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(tr, /data-live-source="\/api\/matches\?status=live"/, "TR ana sayfa damgası değişmemeli");
  assert.doesNotMatch(tr, /en-live-scores\.js/);
}

console.log("en-live-scores OK");
