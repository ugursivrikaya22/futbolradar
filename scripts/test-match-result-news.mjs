import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { buildMatchResultNews, ineligibleReason } from "./lib/matchResultNews.mjs";

const require = createRequire(import.meta.url);
const { publishableNews } = require("../services/newsFeed.js");

const NOW = Date.parse("2026-10-14T12:00:00+03:00");
const base = {
  matchId: "galatasaray-barcelona-2026-10-13", fixtureId: "1635666",
  kickoff: "2026-10-13T22:00:00+03:00", status: "FINISHED", providerStatus: "FT", finishType: "regular",
  competition: "Şampiyonlar Ligi", homeTeam: "Galatasaray", awayTeam: "Barcelona", venue: "Rams Park",
  score: { home: 1, away: 4 }, turkish: true, turkishTeam: "Galatasaray", dataStatus: "complete",
  dataSources: { events: { present: true } }, analysisGeneratedAt: "2026-10-13T23:45:13.496Z",
  seo: { path: "mac-raporu/galatasaray-barcelona-2026-10-13.html" },
  digest: {
    headline: "Barcelona, Galatasaray'ı 4-1 yendi",
    paragraph: "Golleri 28. dakikada A (Galatasaray), 43. dakikada B (Barcelona), 50. dakikada C (Barcelona), 53. dakikada D (Barcelona), 65. dakikada E (Barcelona) kaydetti."
  }
};
const opts = { now: NOW, reportExists: () => true };
const run = (record, existing = []) => buildMatchResultNews([record], existing, opts);

// 1) Uygun kayıt → kaynaklı, tarihli, doğru kategorili haber; yayımlanabilir.
{
  const { added } = run(base);
  assert.equal(added.length, 1);
  const a = added[0];
  assert.equal(a.category, "Şampiyonlar Ligi");
  assert.equal(a.title, "Galatasaray 1–4 Barcelona: Şampiyonlar Ligi maç sonucu");
  assert.equal(a.status, "verified");
  assert.match(a.publishedAt, /^2026-10-13T23:45:13/);
  assert.ok(a.sources.length === 1 && /^https:\/\/www\.futbolradar\.com\/mac-raporu\//.test(a.sources[0].url), "kaynak bağlantısı");
  assert.ok(a.body.join(" ").includes("Kaynak ve tarih"), "kaynak ve tarih gövdede");
  assert.equal(publishableNews([a]).length, 1, "sayfası üretilebilir olmalı");
}

// 2) Tekilleştirme: aynı maç ikinci kez eklenmez (kimlik, fixture, elle haber, ikinci çalıştırma).
{
  const first = run(base).added;
  assert.equal(run(base, first).added.length, 0, "ikinci çalıştırma yeni kayıt eklememeli");
  assert.equal(run(base, [{ id: "x", liveMatchNews: "1635666" }]).added.length, 0, "elle haber varsa atla");
  assert.equal(run(base, [{ id: "y", matchFixtureId: "1635666" }]).added.length, 0);
  const twin = { ...base, matchId: "galatasaray-barcelona-2026-10-13-b", fixtureId: "9999" };
  assert.equal(buildMatchResultNews([base, twin], [], opts).added.length, 1, "sağlayıcı kopyası tek haber");
  // Kopyalar UTC gece yarısının iki yanında üretilse de tek haber (aynı çalıştırma ve sonraki çalıştırma).
  const early = { ...base, analysisGeneratedAt: "2026-10-13T23:50:00Z", generatedAt: "2026-10-13T23:50:00Z" };
  const late = { ...twin, analysisGeneratedAt: "2026-10-14T00:20:00Z", generatedAt: "2026-10-14T00:20:00Z" };
  assert.equal(buildMatchResultNews([early, late], [], opts).added.length, 1, "gece yarısı kopyası aynı çalıştırmada tek haber");
  const firstRun = buildMatchResultNews([early], [], opts).added;
  assert.equal(firstRun.length, 1);
  assert.equal(buildMatchResultNews([late], firstRun, opts).added.length, 0, "gece yarısı kopyası sonraki çalıştırmada eklenmemeli");
  const legacy = firstRun.map(({ kickoffDay: _drop, ...rest }) => rest);
  assert.equal(buildMatchResultNews([late], legacy, opts).added.length, 0, "kickoffDay alanı olmayan eski kayıtta gün etiketiyle eşleşmeli");
}

// 3) Boş/hatalı/yanlış kayıtlar habere dönüşmez.
const bad = {
  "bitmemiş": { ...base, status: "SCHEDULED", providerStatus: "NS" },
  "hükmen": { ...base, status: "AWARDED", providerStatus: "AWD" },
  "uzatma/penaltı": { ...base, finishType: "penalties" },
  "gelecek": { ...base, kickoff: "2026-10-20T22:00:00+03:00" },
  "skor yok": { ...base, score: { home: null, away: null } },
  "olay verisi yok": { ...base, dataStatus: "minimal", dataSources: { events: { present: false } } },
  "özet yok": { ...base, digest: {} },
  "gol dizisi skorla tutmuyor": { ...base, score: { home: 1, away: 3 } },
  "rapor sayfası yok": null,
  "kapsam dışı": { ...base, competition: "3. Lig - Group 1" },
  "Türk takımı yok": { ...base, turkish: false },
  "pencere dışı": { ...base, kickoff: "2026-09-01T22:00:00+03:00" }
};
for (const [name, record] of Object.entries(bad)) {
  if (record === null) {
    assert.equal(buildMatchResultNews([base], [], { now: NOW, reportExists: () => false }).added.length, 0, name);
  } else {
    assert.equal(run(record).added.length, 0, `${name}: haber çıkmamalı`);
  }
}
assert.equal(ineligibleReason(base, opts), null);

// 4) Kategoriler yarışmadan gelir.
for (const competition of ["Süper Lig", "Avrupa Ligi", "Konferans Ligi", "Türkiye Kupası"]) {
  assert.equal(run({ ...base, competition, matchId: `m-${competition}`, fixtureId: competition }).added[0].category, competition);
}
// İki Türk takımı: team alanı ev sahibi.
assert.equal(run({ ...base, competition: "Süper Lig", turkishTeam: "Galatasaray & Fenerbahçe" }).added[0].team, "Galatasaray");

console.log("match-result-news testleri geçti (kaynak+tarih, tekilleştirme, hatalı kayıt elemesi, kategori).");
