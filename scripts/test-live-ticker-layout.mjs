import assert from "node:assert/strict";
import { liveScoreTicker, turkeyFootballTicker } from "./lib/layout.mjs";

const live = liveScoreTicker({
  base: "./",
  items: [{ label: "Canlı", text: "Trabzonspor 1-0 Rakip FK", href: "canli-skor.html#tr-1" }]
});
assert.match(live, /data-live-score-ticker/);
assert.match(live, /CANLI SKOR/);
assert.match(live, /--ticker-duration:32s/);

const agenda = turkeyFootballTicker({
  base: "./",
  items: [{ label: "Resmî açıklama", text: "Kulüp açıklaması", href: "haberler.html" }]
});
assert.match(agenda, /TÜRKİYE FUTBOL GÜNDEMİ/);
assert.match(agenda, /--ticker-duration:96s/);

const empty = liveScoreTicker({ base: "./", items: [] });
assert.match(empty, /data-live-score-ticker/);
assert.match(empty, /Doğrulanmış canlı skor verisi bekleniyor/);

console.log("Live ticker layout tests passed (shared marker, speeds, verified fallback).");
