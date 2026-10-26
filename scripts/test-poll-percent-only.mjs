// Anket sonuçlarında YALNIZCA YÜZDE görünür: katılımcı / oy sayısı metni yok.
// Kaynak JS'de sayım metni basan kalıplar ve sunucu yanıtında ham sayı aranır.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const forbidden = [/futbolsever oy kullandı/, /football fans have voted/, /Toplam \{total\} oy/, /\{total\} votes/,
  /pollTotalText/, /row\.votes\) \+ " " \+ esc\(text\.votes\)/, /question\.total\) \+ " "/,
  /formatCount\(row\.votes\)/, /poll\.total \+ " "/];
for (const file of ["site.js", "public/site.js", "radar-fan.js", "public/radar-fan.js", "services/homePoll.js"]) {
  const src = fs.readFileSync(file, "utf8");
  for (const pattern of forbidden) assert.ok(!pattern.test(src), `${file}: sayım metni kalıbı bulundu ${pattern}`);
}
assert.equal(fs.readFileSync("radar-fan.js", "utf8"), fs.readFileSync("public/radar-fan.js", "utf8"), "public/radar-fan.js senkron değil");

const { presentTally } = require("../server/matchPollRoute.js");
const out = presentTally({ a: 3, b: 1 }, { options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] });
assert.equal(out.hasVotes, true);
assert.ok(!("total" in out), "toplam sayı dönmemeli");
assert.ok(out.results.every((row) => !("votes" in row)), "satırda oy sayısı olmamalı");
assert.deepEqual(out.results.map((row) => row.percent), [75, 25]);
console.log("poll-percent-only: tamam");
