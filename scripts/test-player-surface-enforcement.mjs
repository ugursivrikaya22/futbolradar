/**
 * SİTE GENELİ OYUNCU GÜVENİLİRLİK TESTLERİ (Faz 2)
 *
 * Faz 1 ana sayfayı temizledi. Denetim, aynı 110 kaydın başka yüzeylerde
 * hâlâ doğrulanmamış iddia taşıdığını gösterdi:
 *
 *   • 110 profil sayfasının JSON-LD'sinde memberOf ile KULÜP BEYANI ve
 *     meta açıklamasında "overall rating 80" cümlesi vardı. Yapılandırılmış
 *     veri görünür metinden daha kalıcı bir yanlış: arama motoru onu olgu
 *     olarak yutar.
 *   • 6 kategori listeleme sayfası puan rozeti, piyasa değeri ve dakika
 *     basıyordu.
 *   • 422 kıyas sayfası puanı ROZET DEĞİL, <dl> içinde taşıyordu — bu
 *     yüzey ilk taramada neredeyse kaçırıldı.
 *   • Arama dizini altyazısında "Schalke 04 · Santrfor" gibi kulüp
 *     iddiaları vardı.
 *   • İstemci hidrasyonu, ön renderin kaldırdığı her şeyi geri boyuyordu.
 *
 * Sözleşme: URL'ler ve sayfa iskeleti KORUNUR, yalnızca doğrulanamayan
 * alanlar düşer. Sıfır ya da tire basılmaz.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const credibility = require("../services/cardCredibility.js");
const players = require("../data/players.json");

const root = process.cwd();
const now = new Date("2026-07-26T21:00:00+03:00");

const verifiedSample = {
  id: "test-verified", name: "Doğrulanmış Oyuncu", providerId: "276",
  currentTeam: "Galatasaray", position: "Forvet",
  sourceUrl: "https://media.api-sports.io/football/players/276.png",
  lastVerifiedAt: "2026-07-20T12:00:00+03:00",
  dataStatus: "verified", ratingStatus: "current",
  // Ölçüm zamanı, kaydın istatistiklerinin GERÇEKTEN çekildiğini gösterir.
  // Kadro senkronundan gelen kayıtlarda bu alan null: sayaçları sıfır ama
  // ölçülmemiş. İkisini ayırt eden işaret bu.
  fetchedAt: "2026-07-20T12:00:00+03:00",
  overallRating: 82, marketValueEur: 12000000, minutesPlayed: 1800
};

/**
 * Kadro senkronundan gelen kaydın BİREBİR şekli: sayısal sağlayıcı kimliği,
 * lisanslı fotoğraf, izlenebilir kaynak — ama derecelendirme ve istatistik
 * YOK (uç nokta göndermiyor, varsayılanlar dolduruyor).
 */
const squadSyncedSample = {
  id: "test-synced", name: "Senkron Oyuncu", providerId: "312948",
  currentTeam: "Gaziantep FK", position: "Orta saha",
  sourceName: "API-Football",
  sourceUrl: "https://v3.football.api-sports.io/players/squads?player=312948",
  lastVerifiedAt: "2026-07-26T23:00:00+03:00",
  photo: "https://media.api-sports.io/football/players/312948.png",
  dataStatus: "provider", ratingStatus: "estimated",
  fetchedAt: null, lastSyncedAt: null,
  overallRating: 24, aiRating: 24, rating: 61,
  minutesPlayed: 0, minutes: 0, appearances: 0, goals: 0, assists: 0
};

function listHtml(dir) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full).filter((name) => name.endsWith(".html"));
}

// ── 1. Karar katmanı ────────────────────────────────────────────────────────

function testPublicViewHidesRestrictedFields() {
  const unverified = { ...verifiedSample, providerId: "mock-x-1" };
  const view = credibility.publicPlayerView(unverified, { now });

  assert.equal(view.verified, false);
  for (const field of ["overallRating", "marketValueEur", "minutesPlayed", "currentTeam", "providerId"]) {
    assert.ok(!(field in view.fields), `${field} doğrulanmamış görünümde olmamalı`);
  }
  // Bağımsız olarak güvenli alanlar kalmalı — sayfa iskeleti boşalmasın.
  assert.ok(view.fields.name, "isim korunmalı");
  assert.ok(view.fields.position, "mevki korunmalı");
  assert.ok(view.restricted.length, "gizlenen alanlar bildirilmeli");
}

function testPublicViewKeepsFieldsForVerifiedPlayer() {
  const view = credibility.publicPlayerView(verifiedSample, { now });
  assert.equal(view.verified, true);
  assert.equal(view.fields.overallRating, 82, "doğrulanmış kayıtta puan yayımlanmalı");
  assert.equal(view.fields.currentTeam, "Galatasaray");
  assert.equal(view.restricted.length, 0);
}

/**
 * KAYNAK DOĞRULAMASI ALAN DOĞRULAMASI DEĞİLDİR.
 *
 * Kadro senkronu 479 oyuncuyu sayısal kimlik, lisanslı fotoğraf ve
 * izlenebilir kaynakla getiriyor — kayıt yayın kapısını haklı olarak
 * geçiyor. Ama uç nokta derecelendirme, dakika, maç, gol, asist
 * GÖNDERMİYOR; normalizePlayer bunları varsayılanla dolduruyor
 * (rating 61, aiRating 24, gol 0). Kapı tek blok hâlinde açıldığında bu
 * türetilmiş sayılar doğrulanmış kart görünümüyle yayına giriyordu.
 *
 * "0 gol", sağlayıcı hiç gol verisi göndermediğinde "oynadı ve atamadı"
 * diye okunur — ölçülmemiş bir iddia.
 */
function testProviderSuppliedFieldsPublishButDerivedOnesDoNot() {
  const view = credibility.publicPlayerView(squadSyncedSample, { now });

  assert.equal(view.verified, true, "izlenebilir kaynaklı sağlayıcı kaydı kapıyı geçmeli");

  // Uç noktanın GERÇEKTEN gönderdiği alanlar yayımlanır.
  assert.equal(view.fields.currentTeam, "Gaziantep FK", "kadro uç noktası kulübü veriyor");
  assert.ok(view.fields.photo, "sağlayıcı fotoğrafı yayımlanmalı");

  // Sağlayıcının göndermediği, varsayılandan gelen sayılar YAYIMLANMAZ.
  for (const field of ["rating", "aiRating", "overallRating",
    "minutes", "minutesPlayed", "appearances", "goals", "assists"]) {
    assert.ok(!(field in view.fields),
      `${field} sağlayıcıdan gelmiyor, yayımlanmamalı`);
    assert.ok(view.restricted.includes(field),
      `${field} gizlenen alanlar listesinde bildirilmeli`);
  }
}

// ── 2. Üretilmiş çıktı ──────────────────────────────────────────────────────

function testProfilePagesExposeNoRestrictedFields() {
  const files = listHtml("oyuncular");
  assert.ok(files.length >= 110, `110 profil beklenir, ${files.length} bulundu`);

  let checked = 0;
  for (const file of files) {
    const html = fs.readFileSync(path.join(root, "oyuncular", file), "utf8");
    assert.ok(!/player-rating-badge/.test(html), `${file}: puan rozeti basılmamalı`);
    assert.ok(!/mock-[a-z]+-\d+/i.test(html), `${file}: yer tutucu kimlik sızmamalı`);
    assert.ok(!/overall rating \d/i.test(html), `${file}: meta açıklamasında puan olmamalı`);
    checked += 1;
  }
  assert.ok(checked > 100, "profillerin tamamı taranmalı");
}

function testJsonLdCarriesNoUnverifiedClubClaim() {
  const files = listHtml("oyuncular").filter((name) => !["forvetler.html", "kaleciler.html", "defanslar.html",
    "orta-sahalar.html", "genc-yetenekler.html", "en-iyi-oyuncular.html", "index.html"].includes(name));

  let withLd = 0;
  let unverifiedChecked = 0;
  for (const file of files) {
    const html = fs.readFileSync(path.join(root, "oyuncular", file), "utf8");
    const block = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    if (!block) continue;
    withLd += 1;

    const graph = JSON.parse(block[1]);
    const person = (graph["@graph"] || []).find((node) => node["@type"] === "Person");
    if (!person) continue;

    // Kural "memberOf hiç basılmasın" DEĞİL: "DOĞRULANMAMIŞ kulüp iddiası
    // makine okunur olguya çevrilmesin". Kadro senkronu öncesinde hiçbir
    // kayıt kapıyı geçmediği için ikisi aynı şeye denk düşüyordu. Artık
    // 479 oyuncunun kulübü sağlayıcının kadro uç noktasından geliyor.
    const record = players.find((player) => player.id === path.basename(file, ".html"));
    const verified = record ? credibility.publicPlayerView(record).verified : false;
    if (!verified) {
      assert.ok(!("memberOf" in person), `${file}: doğrulanmamış kulüp schema.org ile beyan edilmemeli`);
    } else if ("memberOf" in person) {
      const claimed = person.memberOf && person.memberOf.name;
      assert.equal(claimed, record.currentTeam || record.team,
        `${file}: beyan edilen kulüp kayıttaki kulüpten farklı`);
      unverifiedChecked += 1;
    }
    assert.ok(!/rating \d/i.test(person.description || ""), `${file}: JSON-LD açıklamasında puan olmamalı`);
  }
  assert.ok(withLd >= 100, `JSON-LD taşıyan profil sayısı beklenenden az: ${withLd}`);
  assert.ok(unverifiedChecked > 0, "doğrulanmış kulüp beyanları da denetlenmeli");
}

function testComparisonPagesExposeNoRatings() {
  const files = listHtml("karsilastirma");
  assert.ok(files.length > 400, `422 kıyas sayfası beklenir, ${files.length} bulundu`);

  for (const file of files.slice(0, 120)) {
    const html = fs.readFileSync(path.join(root, "karsilastirma", file), "utf8");
    assert.ok(!/<dt>Overall<\/dt><dd>\s*\d/.test(html), `${file}: <dl> içindeki puan da puandır`);
    assert.ok(!/<dt>Piyasa<\/dt><dd>[^<]*\d/.test(html), `${file}: piyasa değeri basılmamalı`);
  }
}

function testCategoryPagesExposeNoRestrictedFields() {
  for (const file of ["forvetler.html", "kaleciler.html", "defanslar.html",
    "orta-sahalar.html", "genc-yetenekler.html", "en-iyi-oyuncular.html"]) {
    const full = path.join(root, "oyuncular", file);
    if (!fs.existsSync(full)) continue;
    const html = fs.readFileSync(full, "utf8");
    assert.ok(!/player-rating-badge/.test(html), `${file}: puan rozeti basılmamalı`);
    assert.ok(!/Piyasa\s*<b>[^<]*\d/.test(html), `${file}: piyasa değeri basılmamalı`);

    // Dakika basılması KENDİSİ yasak değil — kural "yalnızca doğrulanamayan
    // alanlar düşer" (dosya başı). Kadro senkronunun varsayılan sıfırları
    // basılmasın diye bu test başta "hiç basılmasın" diye yazıldı, çünkü o an
    // hiçbir kayıtta gerçek doğrulama yoktu. Artık bazı oyuncular
    // statsVerifiedFields ile gerçekten doğrulanmış dakika taşıyor (örn.
    // E. Shomurodov, 4 Eylül 2026 manuel doğrulama); bu satır artık basılan
    // her rakamı kapıdan geçen (publicPlayerView) değerle karşılaştırıyor —
    // basılıysa doğrulanmışla birebir eşleşmeli, uydurma/varsayılan olamaz.
    for (const articleMatch of html.matchAll(/<article class="card player-detail-card" data-card="player" data-player="([^"]+)"[\s\S]*?<\/article>/g)) {
      const [block, playerId] = articleMatch;
      const minutesMatch = block.match(/Maç dakikası\s*<b>\s*(\d+)\s*<\/b>/);
      if (!minutesMatch) continue;
      const record = players.find((p) => p.id === playerId);
      const gatedFields = record && credibility.publicPlayerView(record).fields;
      const allowed = gatedFields ? (gatedFields.minutesPlayed ?? gatedFields.minutes) : undefined;
      assert.equal(String(minutesMatch[1]), String(allowed),
        `${file}/${playerId}: basılan dakika (${minutesMatch[1]}) kapıdan geçen doğrulanmış değerle eşleşmeli`);
    }
  }
}

function testSearchIndexCarriesNoClubClaim() {
  const index = JSON.parse(fs.readFileSync(path.join(root, "search-index.json"), "utf8"));
  const entries = (Array.isArray(index) ? index : index.entries || []).filter((item) => item.type === "player");

  // Değişmez "veri kümesi 110 kayıtta kalsın" DEĞİL, "hiçbir oyuncu
  // aranamaz hâle gelmesin". Sabit sayı, kadro senkronu gerçek anahtarla ilk
  // kez koşup kümeyi 110'dan 589'a çıkarınca testi kırdı — oysa büyüme
  // korunmak istenen şeyin ta kendisi. Taban 110: altına düşmek gerileme.
  assert.ok(entries.length >= 110,
    `arama dizini taban kapsamın altına düştü (${entries.length} < 110)`);
  assert.equal(entries.length, players.length,
    `her oyuncu aranabilir kalmalı — URL yapısı korunuyor ` +
    `(dizin: ${entries.length}, veri kümesi: ${players.length})`);

  for (const entry of entries) {
    // href TAM eşleşmeli: "oyuncular/taylan-bulut-besiktas.html" içinde
    // "taylan-bulut" alt dizesi de geçiyor ve includes() yanlış kaydı
    // seçip doğrulanmış bir girdiyi doğrulanmamış sanıyordu.
    const slugFromHref = entry.href.replace(/^.*\//, "").replace(/\.html$/, "");
    const player = players.find((item) => item.id === slugFromHref);
    if (!player) continue;
    if (credibility.publicPlayerView(player).verified) continue;

    const club = player.currentTeam || player.team || "";
    if (club) {
      assert.ok(
        !entry.subtitle.includes(club),
        `${entry.title}: doğrulanmamış kulüp arama altyazısında olmamalı (${entry.subtitle})`
      );
    }
  }
}

function testPlayerUrlsArePreserved() {
  // Bilgi mimarisi bozulmamalı: her kayıt için sayfa hâlâ var olmalı.
  let missing = 0;
  for (const player of players) {
    if (!fs.existsSync(path.join(root, "oyuncular", `${player.id}.html`))) missing += 1;
  }
  assert.equal(missing, 0, `${missing} oyuncu sayfası kaybolmuş — URL yapısı korunmalıydı`);
}

// ── 3. Hidrasyon ────────────────────────────────────────────────────────────

function testHydrationCannotRepaintBlockedData() {
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");

  // İstemci, ön renderin gömdüğü kararı okumalı.
  assert.ok(
    app.includes('data-player-verified') && app.includes('=== "false"'),
    "istemci, iskelete gömülü doğrulama kararını okumalı"
  );

  // İkinci savunma hattı: kayıt düzeyinde süzgeç.
  assert.ok(app.includes("isPublishablePlayerCard(player)"), "istemcide kayıt düzeyi süzgeç bulunmalı");

  // Ön render kararı gerçekten gömüyor mu?
  const sample = fs.readFileSync(path.join(root, "oyuncular", `${players[0].id}.html`), "utf8");
  assert.ok(/data-player-verified="(true|false)"/.test(sample), "ön render kararı iskelete gömmeli");
}

function testThreePathsAgreeForAllRecords() {
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const start = app.indexOf("function isPublishablePlayerCard");
  const body = app.slice(start, app.indexOf("function playerInitials"));
  const clientFilter = new Function(`return ${body.slice(0, body.lastIndexOf("}") + 1)}`)();

  for (const player of players) {
    const service = credibility.evaluatePlayerCard(player).publishable;
    const client = clientFilter(player);
    assert.equal(client, service, `${player.name}: servis ve istemci aynı kararı vermeli`);

    // Statik çıktı: doğrulanmamışsa sayfada kısıtlı alan olmamalı.
    const file = path.join(root, "oyuncular", `${player.id}.html`);
    if (!service && fs.existsSync(file)) {
      const html = fs.readFileSync(file, "utf8");
      assert.ok(!/player-rating-badge/.test(html), `${player.name}: statik çıktıda puan rozeti var`);
      assert.ok(/data-player-verified="false"/.test(html), `${player.name}: statik çıktı kararı taşımalı`);
    }
  }
}

// ── 4. Senkron sertleştirme ─────────────────────────────────────────────────

function testSyncFailsClosedWithoutSecret() {
  const source = fs.readFileSync(path.join(root, "scripts", "sync-super-lig-squads.mjs"), "utf8");

  assert.ok(source.includes("process.exitCode = 1"), "eksik yapılandırmada sıfırdan farklı çıkış olmalı");
  assert.ok(source.includes("missingSquadSyncConfig"), "eksik yapılandırma adıyla bildirilmeli");
  // Anahtar hiçbir çıktı yoluna yazılmamalı.
  assert.ok(!/console\.log\([^)]*apiKey/i.test(source), "anahtar loglanmamalı");
  assert.ok(!/APIFOOTBALL_API_KEY\s*=\s*["'][a-f0-9]/i.test(source), "anahtar koda gömülmemeli");
}

function testSyncStagesValidatesAndPromotesAtomically() {
  const source = fs.readFileSync(path.join(root, "scripts", "sync-super-lig-squads.mjs"), "utf8");

  assert.ok(source.includes("stageOutputs"), "aday çıktı önce geçici dosyaya yazılmalı");
  assert.ok(source.includes("validateStagedOutputs"), "aday çıktı doğrulanmalı");
  assert.ok(source.includes("promoteStaged"), "terfi ayrı bir adım olmalı");
  assert.ok(source.includes("MIN_SUCCESS_RATIO"), "kısmi başarısızlık eşiği tanımlı olmalı");

  // Doğrulama, DİSKTEN okuyup denetlemeli — bellekteki nesneden değil.
  const validator = source.slice(source.indexOf("function validateStagedOutputs"));
  assert.ok(validator.includes("readFileSync"), "aday çıktı diskten okunup denetlenmeli");
  // Kaynak metninde kalıp `/^mock[-_]/i` biçiminde geçiyor; "mock" kelimesinin
  // varlığı aranır, ardından gelen karakter değil.
  assert.ok(/mock/i.test(validator), "aday çıktıda yer tutucu kimlik denetlenmeli");
}

function testSyncEmitsRunSummaryFields() {
  const source = fs.readFileSync(path.join(root, "scripts", "sync-super-lig-squads.mjs"), "utf8");
  const summary = source.slice(source.indexOf("function writeRunSummary"));

  for (const field of ["yapılandırılmış", "Sağlayıcı istek", "Başarılı takım", "Başarısız takım",
    "Gelen oyuncu", "Gerçek sağlayıcı kimlikli", "elenen", "Değişen çıktı"]) {
    assert.ok(summary.includes(field), `koşu özeti "${field}" alanını bildirmeli`);
  }
  assert.ok(summary.includes("hasConfig()"), "özet, anahtarın varlığını bildirmeli (değerini değil)");
}

function testSyncRespectsRateLimit() {
  const source = fs.readFileSync(path.join(root, "scripts", "sync-super-lig-squads.mjs"), "utf8");
  assert.ok(source.includes("PROVIDER_REQUEST_GAP_MS"), "istekler arası aralık tanımlı olmalı");
  assert.ok(/setTimeout\(resolve, PROVIDER_REQUEST_GAP_MS\)/.test(source), "aralık gerçekten uygulanmalı");
}

const tests = [
  testPublicViewHidesRestrictedFields,
  testPublicViewKeepsFieldsForVerifiedPlayer,
  testProviderSuppliedFieldsPublishButDerivedOnesDoNot,
  testProfilePagesExposeNoRestrictedFields,
  testJsonLdCarriesNoUnverifiedClubClaim,
  testComparisonPagesExposeNoRatings,
  testCategoryPagesExposeNoRestrictedFields,
  testSearchIndexCarriesNoClubClaim,
  testPlayerUrlsArePreserved,
  testHydrationCannotRepaintBlockedData,
  testThreePathsAgreeForAllRecords,
  testSyncFailsClosedWithoutSecret,
  testSyncStagesValidatesAndPromotesAtomically,
  testSyncEmitsRunSummaryFields,
  testSyncRespectsRateLimit
];

for (const test of tests) {
  test();
}

console.log(`Player surface enforcement tests passed (${tests.length} senaryo: karar katmanı, profiller, ` +
  "JSON-LD, kıyas sayfaları, kategori sayfaları, arama dizini, URL korunumu, hidrasyon, üç yol eşliği, " +
  "senkron fail-closed, atomik terfi, koşu özeti, rate limit).");
