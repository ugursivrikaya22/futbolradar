/**
 * Meta açıklamada yer tutucu vaat yok: "yayımlanır", "tahmini", "yakında",
 * "published once…" gibi cümleler arama sonucunda görünmemeli. Doğrulanmış
 * veri yoksa açıklama yalnızca adı taşır ve sayfa noindex'tir.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { player360Description } from "./lib/player360.mjs";
import { turkishPlayer360 } from "./lib/player360English.mjs";
import { playerPageIsIndexable } from "./lib/playerIndexing.mjs";

const require = createRequire(import.meta.url);
const { buildPlayer360 } = require("../services/player360Service.js");
const { publicPlayerView } = require("../services/cardCredibility.js");
const { getPlayers } = require("../services/playerService.js");
const raw = require("../data/players.json");

const PLACEHOLDER = /yayımlan|tahmini|yakında|bekleniyor|güncelleniyor|doğrulanmış sağlayıcı|published once|estimate|verified provider|coming soon/i;

function check(name, fn) {
  fn();
  console.log(`ok - ${name}`);
}

const build = (player, players = []) => buildPlayer360({
  player, credibility: publicPlayerView(player), players, transfers: [], news: [], matches: [], archive: []
});

check("hiç verisi olmayan kayıtta TR/EN açıklama yer tutucu içermez ve sayfa noindex", () => {
  const bare = { id: "bare-1", name: "Boş Kayıt" };
  const model = turkishPlayer360(build(bare));
  const tr = player360Description(model, { locale: "tr" });
  const en = player360Description(model, { locale: "en" });
  assert.ok(!PLACEHOLDER.test(tr), tr);
  assert.ok(!PLACEHOLDER.test(en), en);
  assert.equal(tr, "Boş Kayıt kimdir? — FutbolRadar'da.");
  assert.equal(playerPageIsIndexable({ model }), false);
});

check("gerçek oyuncu örnekleminde (her 5. kayıt) açıklama yer tutucu içermez", () => {
  const players = getPlayers(raw);
  const sample = players.filter((_, index) => index % 5 === 0);
  assert.ok(sample.length > 100);
  const offenders = [];
  for (const player of sample) {
    const model = turkishPlayer360(build(player, players));
    for (const locale of ["tr", "en"]) {
      const description = player360Description(model, { locale });
      if (PLACEHOLDER.test(description)) offenders.push(`${player.id} [${locale}]: ${description}`);
    }
  }
  assert.deepEqual(offenders.slice(0, 3), [], `${offenders.length} açıklamada yer tutucu var`);
});

check("kaynaklı bölümü olmayan doğrulanmış kayıt noindex, kaynaklı bölümlü indeksli", () => {
  const players = getPlayers(raw);
  let thin = 0;
  let rich = 0;
  for (const player of players.filter((_, index) => index % 5 === 0)) {
    const model = build(player, players);
    if (playerPageIsIndexable({ model })) rich += 1; else thin += 1;
  }
  assert.ok(thin > 0 && rich > 0, `thin=${thin} rich=${rich}`);
});
