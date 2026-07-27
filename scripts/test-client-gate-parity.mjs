/**
 * İSTEMCİ / SUNUCU KAPI EŞİTLİĞİ
 *
 * Son denetimin bulduğu kaçak tam olarak buradaydı ve statik HTML denetimi
 * onu göremiyordu:
 *
 *   Ön render (services/cardCredibility.js) kadro senkronundan gelen 479
 *   kaydın derecesini ve sayaçlarını doğru biçimde gizliyordu. Ama app.js
 *   içindeki istemci kopyası yalnızca KAYIT kapısını taşıyordu, ALAN
 *   kapısını değil. JS yüklendiği anda istemci aynı kayıtları ham olarak
 *   yeniden basıyordu: rozette overallRating 34 (ratingStatus "estimated"),
 *   "Gol 0", "Dakika 0", dolu bir radar.
 *
 *   audit-player-surfaces.mjs temiz rapor veriyordu çünkü yalnızca diskteki
 *   HTML'i okuyor; kaçak yalnızca hidrasyondan sonra vardı.
 *
 * Kural iki yerde yaşadığı sürece ayrışabilir. Bu test ayrışmayı yapısal
 * olarak imkânsız kılar: istemci bloğunu app.js'ten SÖKÜP ÇALIŞTIRIR ve
 * gerçek veri kümesinin tamamı üzerinde sunucu modülüyle karşılaştırır.
 * Yorum okumaz, dize aramaz — iki uygulamayı da koşturur.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const credibility = require("../services/cardCredibility.js");
const players = require("../data/players.json");

const root = process.cwd();
const START = "// --- CLIENT-CREDIBILITY-GATE:start ---";
const END = "// --- CLIENT-CREDIBILITY-GATE:end ---";

const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const start = appSource.indexOf(START);
const end = appSource.indexOf(END);

assert.ok(start > -1, `app.js "${START}" işaretini taşımalı`);
assert.ok(end > start, `app.js "${END}" işaretini taşımalı`);

const clientBlock = appSource.slice(start, end + END.length);

/**
 * Blok kendi kendine yeter olmalı: dışarıdan tek bir yardımcı bile
 * kullanırsa burada ReferenceError ile düşer ve bu, kapının app.js'in geri
 * kalanına dolanmaya başladığının erken işaretidir.
 */
const sandbox = vm.createContext({});
vm.runInContext(
  `${clientBlock}\nthis.gate = { isPublishablePlayerCard, clientRatingIsVerified, clientStatsAreVerified, clientFieldIsPublishable, verifiedField, verifiedNumber };`,
  sandbox
);
const gate = sandbox.gate;

let checked = 0;

// 1. KAYIT KAPISI: iki uygulama aynı kayıtları geçirmeli.
for (const player of players) {
  const serverVerdict = credibility.evaluatePlayerCard(player).publishable;
  const clientVerdict = gate.isPublishablePlayerCard(player);
  assert.equal(
    clientVerdict,
    serverVerdict,
    `kayıt kapısı ayrıştı: ${player.id} sunucu=${serverVerdict} istemci=${clientVerdict}`
  );
  checked += 1;
}

// 2. ALAN KAPISI: her kısıtlı alan için iki uygulama aynı kararı vermeli.
//    Asıl kaçak buradaydı; en pahalı döngü de bu yüzden burada.
for (const player of players) {
  for (const field of credibility.RESTRICTED_FIELDS) {
    const serverAllows = credibility.restrictedFieldIsPublishable(player, field);
    const clientAllows = gate.clientFieldIsPublishable(player, field);
    assert.equal(
      clientAllows,
      serverAllows,
      `alan kapısı ayrıştı: ${player.id}.${field} sunucu=${serverAllows} istemci=${clientAllows}`
    );
  }
}

// 3. DERECE ve SAYAÇ yardımcıları da birebir aynı olmalı.
for (const player of players) {
  assert.equal(
    gate.clientRatingIsVerified(player),
    credibility.ratingIsVerified(player),
    `derece doğrulaması ayrıştı: ${player.id}`
  );
  assert.equal(
    gate.clientStatsAreVerified(player),
    credibility.statsAreVerified(player),
    `istatistik doğrulaması ayrıştı: ${player.id}`
  );
}

// 4. verifiedField, publicPlayerView'ın açtığı alan kümesiyle uyuşmalı.
//    publicPlayerView kapıyı geçemeyen kayıtta hiçbir kısıtlı alan
//    yayımlamaz; istemci de yayımlamamalı.
for (const player of players) {
  const view = credibility.publicPlayerView(player);
  for (const field of credibility.RESTRICTED_FIELDS) {
    const published = Object.prototype.hasOwnProperty.call(view.fields, field);
    const clientValue = gate.verifiedField(player, field);
    assert.equal(
      clientValue !== undefined,
      published,
      `yayımlanan alan kümesi ayrıştı: ${player.id}.${field} sunucu=${published} istemci=${clientValue !== undefined}`
    );
  }
}

// 5. SENTETİK KÖŞE DURUMLARI — gerçek veri kümesi bugün her yolu gezmiyor.
//    Ölçüm gelmeye başladığında hangi yolun açılacağını burada sabitliyoruz.
const syntheticCases = [
  {
    label: "sağlayıcı ölçümü + köken damgası → derece açılır",
    player: {
      id: "s1", name: "Ölçülmüş", providerId: "1001",
      sourceUrl: "https://v3.football.api-sports.io/players?id=1001",
      lastVerifiedAt: new Date().toISOString(),
      dataStatus: "provider", ratingStatus: "provider",
      ratingVerifiedAt: new Date().toISOString(), ratingSource: "API-Football",
      overallRating: 7.4, appearances: 12, minutes: 980
    }
  },
  {
    label: "köken damgası YOK → 'provider' dizesi tek başına derece açmaz",
    player: {
      id: "s2", name: "Damgasız", providerId: "1002",
      sourceUrl: "https://v3.football.api-sports.io/players?id=1002",
      lastVerifiedAt: new Date().toISOString(),
      dataStatus: "provider", ratingStatus: "provider",
      overallRating: 7.4
    }
  },
  {
    label: "kadro senkronu kaydı (türetilmiş derece, sıfır sayaç) → hepsi kapalı",
    player: {
      id: "s3", name: "Senkron", providerId: "1003",
      sourceUrl: "https://v3.football.api-sports.io/players/squads?player=1003",
      lastVerifiedAt: new Date().toISOString(),
      dataStatus: "provider", ratingStatus: "estimated",
      overallRating: 34, goals: 0, minutes: 0, appearances: 0
    }
  },
  {
    label: "mock kimlik → kayıt kapısı reddeder",
    player: {
      id: "s4", name: "Mock", providerId: "mock-forvet-1",
      sourceUrl: "https://example.invalid/p", lastVerifiedAt: new Date().toISOString(),
      dataStatus: "provider", ratingStatus: "current", overallRating: 88
    }
  }
];

for (const testCase of syntheticCases) {
  const { player, label } = testCase;
  assert.equal(
    gate.isPublishablePlayerCard(player),
    credibility.evaluatePlayerCard(player).publishable,
    `kayıt kapısı ayrıştı (${label})`
  );
  for (const field of credibility.RESTRICTED_FIELDS) {
    assert.equal(
      gate.clientFieldIsPublishable(player, field),
      credibility.restrictedFieldIsPublishable(player, field),
      `alan kapısı ayrıştı (${label}) alan=${field}`
    );
  }
  checked += 1;
}

// Sentetik beklentiler ayrıca ADIYLA sabitlenir: iki taraf birlikte
// bozulursa eşitlik testi sessiz kalırdı.
assert.equal(credibility.ratingIsVerified(syntheticCases[0].player), true, "ölçülmüş derece açılmalı");
assert.equal(credibility.ratingIsVerified(syntheticCases[1].player), false, "damgasız 'provider' derece açmamalı");
assert.equal(credibility.ratingIsVerified(syntheticCases[2].player), false, "türetilmiş derece açılmamalı");
assert.equal(credibility.statsAreVerified(syntheticCases[2].player), false, "sıfır sayaç ölçüm sayılmamalı");
assert.equal(credibility.evaluatePlayerCard(syntheticCases[3].player).publishable, false, "mock kimlik reddedilmeli");

console.log(`OK istemci/sunucu kapı eşitliği · ${players.length} kayıt · ` +
  `${credibility.RESTRICTED_FIELDS.length} kısıtlı alan · ${checked} kapı kontrolü`);
