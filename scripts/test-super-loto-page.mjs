import assert from "node:assert/strict";
const m = await import("./generate-super-loto-page.mjs");
const empty = m.renderPage([]);
assert.match(empty, /<title>Süper Loto Sonuçları \| futbolradar\.com<\/title>/);
assert.match(empty, /<h1>Süper Loto Sonuçları<\/h1>/);
assert.match(empty, /rel="canonical" href="https:\/\/www\.futbolradar\.com\/super-loto-sonuclari"/);
assert.match(empty, /name="robots" content="noindex/);
assert.match(empty, /Güncelleniyor/);
assert.doesNotMatch(empty, /ItemList/);
assert.doesNotMatch(empty, /LotteryDraw/);
assert.equal(m.validDraws({ draws: [{ date: "2026-10-22", numbers: [1, 2, 3, 4, 5, 6] }] }).length, 0, "kaynaksız veri reddedilmeli");
assert.equal(m.validDraws({ source: "x", draws: [{ date: "2026-10-22", numbers: [1, 1, 3, 4, 5, 61] }] }).length, 0);
const fixture = [{ date: "2026-10-22", numbers: [1, 2, 3, 4, 5, 6], sourceUrl: m.OFFICIAL_SOURCE }]; // test fikstürü, gerçek çekiliş değil
const full = m.renderPage(m.validDraws({ source: m.OFFICIAL_SOURCE, draws: fixture }));
assert.doesNotMatch(full, /noindex/);
assert.match(full, /"@type":"ItemList"/);
assert.match(full, /"@type":"BreadcrumbList"/);
console.log("super-loto-page: tüm denetimler geçti");
