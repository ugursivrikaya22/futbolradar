#!/usr/bin/env node
/**
 * Süper Loto çekirdeği testleri. Buradaki sayılar YALNIZCA test girdisidir
 * (bellekte kalır, data/ dosyasına yazılmaz); gerçek çekiliş değildir.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildCommentary, drawShape, isValidDraw, normalizeDraws } from "./lib/superLoto.mjs";
import { drawWindow, mergeDraws, parseOfficial } from "./fetch-super-loto.mjs";
import { renderPage, structuredData } from "./generate-super-loto-page.mjs";

const T = [
  { date: "2000-01-13", numbers: [1, 2, 10, 33, 47, 60] },
  { date: "2000-01-06", numbers: [2, 5, 11, 33, 40, 59] },
  { date: "2000-01-20", numbers: [7, 8, 21, 33, 44, 52], prizes: [{ category: "6 Bilen", winners: 0, amount: null }] }
];

assert.equal(isValidDraw({ date: "2000-01-01", numbers: [1, 2, 3, 4, 5, 61] }), false, "61 geçersiz");
assert.equal(isValidDraw({ date: "2000-01-01", numbers: [1, 1, 3, 4, 5, 6] }), false, "tekrar geçersiz");
const draws = normalizeDraws(T);
assert.deepEqual(draws.map((d) => d.date), ["2000-01-20", "2000-01-13", "2000-01-06"], "yeniden eskiye");
assert.equal(drawShape([7, 8, 21, 33, 44, 52]).consecutive.length, 1);

const c = buildCommentary(draws);
assert.ok(c.paragraphs.some((p) => p.includes("ortak sayı: 33")), "önceki çekilişle ortak sayı");
assert.ok(c.paragraphs.some((p) => p.includes("devrediyor")), "devir");
assert.equal(buildCommentary([]), null, "veri yoksa yazı yok");

const parsed = parseOfficial({ data: { rakamlar: "05#12#19#33#41#58", cekilisTarihi: "20000127", bilenKisiler: [{ tur: "$6_BILEN", kisiSayisi: 0, kisiBasinaDusenIkramiye: 0 }] } }, "https://www.millipiyangoonline.com/x.json", "t");
assert.equal(parsed.length, 1);
assert.equal(parsed[0].prizes[0].category, "6 Bilen");
assert.equal(parseOfficial({ data: { rakamlar: "05#12", cekilisTarihi: "20000127" } }, "u", "t").length, 0, "eksik sayı reddedilir");
assert.equal(mergeDraws(draws, parsed).added.length, 1);
assert.equal(mergeDraws(draws, [draws[0]]).added.length, 0);

assert.equal(drawWindow(new Date("2026-10-22T17:00:00Z")), null, "Perşembe 20:00 pencere dışı");
assert.equal(drawWindow(new Date("2026-10-22T19:30:00Z")), "2026-10-22", "Perşembe 22:30");
assert.equal(drawWindow(new Date("2026-10-22T21:30:00Z")), "2026-10-22", "Cuma 00:30");
assert.equal(drawWindow(new Date("2026-10-24T10:00:00Z")), null, "Cumartesi");

const full = renderPage({ draws });
assert.match(full, /<title>Süper Loto Sonuçları/);
assert.match(full, /<h1>Süper Loto Sonuçları<\/h1>/);
assert.match(full, /Süper Loto son çekiliş kazanan numaralar/);
assert.match(full, /content="index/);
const ld = JSON.parse(structuredData(draws));
const types = ld["@graph"].map((n) => n["@type"]);
assert.deepEqual(types, ["WebPage", "BreadcrumbList", "Dataset", "ItemList"]);
assert.ok(!JSON.stringify(ld).includes("LotteryDraw"), "geçersiz şema türü yok");
const empty = renderPage({ draws: [] });
assert.match(empty, /noindex/, "boş sayfa noindex");
assert.ok(!/<ol class="loto-balls"/.test(empty), "boş sayfada sayı yok");

const real = JSON.parse(fs.readFileSync(new URL("../data/super-loto.json", import.meta.url), "utf8"));
for (const d of real.draws || []) {
  assert.ok(isValidDraw(d), `geçersiz kayıt ${d.date}`);
  assert.ok(/millipiyango|mpi\.gov\.tr/.test(d.sourceUrl || ""), `${d.date}: resmî kaynak URL'si şart`);
}
console.log("test-super-loto: tamam");
