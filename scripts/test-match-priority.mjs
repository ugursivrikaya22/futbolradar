/**
 * MAÇ ÖNCELİK PUANI TESTLERİ
 *
 * Kabul ölçütleri (istek metninden birebir):
 *   1. Ana sayfanın üst sıraları yüksek öncelikli maçları gösterir.
 *   2. Avrupa'da oynayan Türk takımları öne çıkar.
 *   3. Derbiler öne çıkar.
 *   4. Gerekçeler görünür.
 *   5. Sıralamayı YALNIZCA saat belirlemez.
 * Ek sözleşme:
 *   6. Düşük öncelikli maçlar ELENMEZ, yalnızca aşağı iner.
 *   7. Editoryal geçersiz kılma çalışır ve gerekçe üretir.
 *   8. Sıralama verisi yokken "zirve mücadelesi" İDDİA EDİLMEZ.
 *   9. İstemci (app.js) aynı katsayıları kullanır.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const {
  CLUB_POPULARITY,
  HIGH_INTEREST_THRESHOLD,
  TURKISH_BIG_FOUR,
  WEIGHTS,
  clubPopularity,
  competitionProfile,
  matchPriority,
  rankMatches,
  SPOTLIGHT
} = require("../services/matchPriorityService.js");

const NOW = new Date("2026-07-29T18:00:00+03:00");
const at = (time) => `2026-07-29T${time}:00+03:00`;

const FRIENDLY = { id: "friendly", homeTeam: "Konyaspor", awayTeam: "Ittihad Kalba", league: "Hazırlık Maçı", competitionId: "hazirlik-maci", kickoff: at("19:00"), status: "SCHEDULED" };
const UCL_TR = { id: "ucl", homeTeam: "Górnik Zabrze", awayTeam: "Fenerbahçe", league: "UEFA Şampiyonlar Ligi", competitionId: "sampiyonlar-ligi", kickoff: at("21:00"), status: "SCHEDULED" };
const DERBY = { id: "derby", homeTeam: "Galatasaray", awayTeam: "Fenerbahçe", league: "Trendyol Süper Lig", competitionId: "super-lig", kickoff: at("20:00"), status: "SCHEDULED" };
const SMALL_LEAGUE = { id: "small", homeTeam: "Çorum FK", awayTeam: "Erzurumspor FK", league: "Trendyol Süper Lig", competitionId: "super-lig", kickoff: at("17:00"), status: "SCHEDULED" };
const LIVE_FRIENDLY = { id: "live", homeTeam: "Kasımpaşa", awayTeam: "Hull City", league: "Hazırlık Maçı", competitionId: "hazirlik-maci", kickoff: at("16:00"), status: "LIVE", score: { home: 1, away: 1 } };

const rank = (list) => rankMatches(list, { now: NOW }).map((item) => item.id);
const reasonKeys = (match) => matchPriority(match, { now: NOW }).reasons.map((item) => item.key);

/**
 * CANLI MAÇ, VİTRİN BANDININ İÇİNDE EN ÜSTTE.
 *
 * ÖNCELİK DEĞİŞTİ. Eskiden canlı maç koşulsuz en üstteydi. Yeni kural, büyük
 * dörtlünün maçını turnuvası ne olursa olsun en üste alıyor — yani bant,
 * canlılığın da üstünde. Bu bilinçli bir tercih: bu siteye gelen kişi önce
 * kendi takımını arar.
 *
 * Canlılık ortadan kalkmadı, bandın İÇİNE indi: büyük dörtlü maçları kendi
 * arasında, diğerleri kendi arasında canlıyı öne alır.
 */
function testLiveGoesTopWithinItsBand() {
  // Büyük dörtlü yokken canlı maç hâlâ en üstte.
  const withoutBigFour = rank([FRIENDLY, SMALL_LEAGUE, LIVE_FRIENDLY]);
  assert.equal(withoutBigFour[0], "live",
    `büyük dörtlü yokken canlı maç en üstte olmalı, sıra: ${withoutBigFour.join(" > ")}`);
  assert.ok(reasonKeys(LIVE_FRIENDLY).includes("live"), "canlı maç gerekçe taşımalı");

  // Büyük dörtlü varken bant kazanır: canlı maç bandın altına iner.
  const withBigFour = rank([FRIENDLY, UCL_TR, DERBY, LIVE_FRIENDLY]);
  // Sayı yerine SABİT: bantlar değiştiğinde test kırılmasın, kural kırılsın.
  assert.equal(matchPriority(DERBY, { now: NOW }).spotlight, SPOTLIGHT.TOP);
  assert.ok(
    matchPriority(LIVE_FRIENDLY, { now: NOW }).spotlight < SPOTLIGHT.TOP,
    "canlı hazırlık maçı en üst bantta olmamalı"
  );
  assert.ok(
    withBigFour.indexOf("derby") < withBigFour.indexOf("live"),
    `büyük dörtlü maçı canlı maçın üstünde olmalı, sıra: ${withBigFour.join(" > ")}`
  );

  // Bandın içinde canlılık hâlâ belirleyici: canlı derbi, başlamamış derbinin üstünde.
  const liveDerby = { ...DERBY, id: "canli-derbi", status: "LIVE", score: { home: 1, away: 0 } };
  const upcomingBigFour = { ...UCL_TR, id: "yaklasan-buyuk" };
  const inBand = rank([upcomingBigFour, liveDerby]);
  assert.equal(inBand[0], "canli-derbi", `bant içinde canlı maç önce gelmeli, sıra: ${inBand.join(" > ")}`);
}


/**
 * BÜYÜK DÖRTLÜ HER ZAMAN EN ÜSTTE — TURNUVA NE OLURSA OLSUN.
 *
 * Puanlama tek başına bunu sağlamıyordu: turnuva ağırlığı kulüp ağırlığından
 * baskın çıkabiliyor ve bir Galatasaray hazırlık maçı, iki orta sıra takımın
 * lig maçının ALTINA düşüyordu. Sayılarla doğru, okuyucuyla yanlış.
 *
 * Bu yüzden büyük dörtlü bir AĞIRLIK değil, bir BANT. Ağırlık olsaydı
 * yeterince yüksek başka bir puan onu geçebilirdi; bant geçilemez.
 */
function testBigFourAlwaysRanksFirst() {
  const competitions = [
    "Hazırlık maçı", "Türkiye Kupası", "Trendyol Süper Lig",
    "UEFA Avrupa Ligi", "UEFA Şampiyonlar Ligi"
  ];

  // Rakipler: en ağır turnuvada ve CANLI, ama DÜNYA DEVİ DEĞİL.
  //
  // Dev maçlar bilinçli olarak dışarıda: onlar tek istisna ve ayrı testte
  // (testOnlyWorldClassGiantsAreTheException) ölçülüyor. Burada ölçülen iddia
  // "büyük dörtlü, dev olmayan her şeyin üstünde".
  const rivals = [
    { id: "ucl-canli", homeTeam: "Ajax", awayTeam: "Benfica",
      league: "UEFA Şampiyonlar Ligi", competitionId: "sampiyonlar-ligi",
      kickoff: at("21:00"), status: "LIVE", score: { home: 1, away: 1 } },
    { id: "orta-sira", homeTeam: "Göztepe", awayTeam: "Kasımpaşa",
      league: "Trendyol Süper Lig", competitionId: "super-lig",
      kickoff: at("20:00"), status: "SCHEDULED" }
  ];

  for (const club of ["Galatasaray", "Fenerbahçe", "Beşiktaş", "Trabzonspor"]) {
    for (const league of competitions) {
      const bigFour = {
        id: "buyuk", homeTeam: club, awayTeam: "Rudeš",
        league, kickoff: at("23:30"), status: "SCHEDULED"
      };
      const order = rank([...rivals, bigFour]);
      assert.equal(
        order[0], "buyuk",
        `${club} · ${league}: büyük dörtlü maçı en üstte olmalı, sıra: ${order.join(" > ")}`
      );
      assert.equal(matchPriority(bigFour, { now: NOW }).spotlight, SPOTLIGHT.TOP);
    }
  }

  // Deplasmanda olması fark etmemeli.
  const away = rank([rivals[0],
    { id: "deplasman", homeTeam: "Rudeš", awayTeam: "Beşiktaş",
      league: "Hazırlık maçı", kickoff: at("23:30"), status: "SCHEDULED" }]);
  assert.equal(away[0], "deplasman", "deplasmandaki büyük dörtlü de en üstte olmalı");

  // Bant DIŞINDA sıralama değişmemeli: bant, bandın dışını etkilemez.
  const others = rank(rivals);
  assert.equal(others[0], "orta-sira",
    "Türk takımı bandı, bant dışındaki canlı Avrupa maçının üstünde kalmalı");
}

/** Bant içinde puan hâlâ sıralar. */
function testWithinSpotlightScoreStillOrders() {
  const order = rank([
    { id: "hazirlik", homeTeam: "Trabzonspor", awayTeam: "Rudeš",
      league: "Hazırlık maçı", kickoff: at("22:00"), status: "SCHEDULED" },
    DERBY
  ]);
  assert.equal(order[0], "derby", "bant içinde derbi hazırlık maçının üstünde olmalı");
}

/** Editoryal seçim bandın da üstünde: geçersiz kılma gerçekten geçersiz kılmalı. */
function testEditorialBeatsTheSpotlightBand() {
  const editorial = { ...FRIENDLY, id: "editor", editorialPriority: 500 };
  assert.equal(matchPriority(editorial, { now: NOW }).spotlight, SPOTLIGHT.EDITORIAL);
  assert.equal(matchPriority(DERBY, { now: NOW }).spotlight, SPOTLIGHT.TOP);
  assert.ok(SPOTLIGHT.EDITORIAL > SPOTLIGHT.TOP, "editör bandı en üstte olmalı");

  const order = rank([DERBY, editorial]);
  assert.equal(order[0], "editor", `editör seçimi büyük dörtlünün üstünde olmalı, sıra: ${order.join(" > ")}`);

  const featured = { ...FRIENDLY, id: "vitrin", featured: true };
  assert.equal(matchPriority(featured, { now: NOW }).spotlight, SPOTLIGHT.EDITORIAL);
}

/** İstemci aynı bandı aynı sırayla uygulamalı. */
function testClientMirrorsSpotlight() {
  const app = fs.readFileSync(path.join(process.cwd(), "app.js"), "utf8");
  assert.ok(/spotlight/.test(app), "app.js vitrin bandını taşımalı");
  assert.ok(
    /right\.priority\.spotlight !== left\.priority\.spotlight/.test(app),
    "istemci sıralaması bandı önce okumalı"
  );
  assert.ok(
    /if \(left\.spotlight !== right\.spotlight\) return right\.spotlight - left\.spotlight;/.test(app),
    "radar bölümü sıralaması da bandı önce okumalı"
  );
  assert.ok(/editorialPick \|\| match\.featured === true/.test(app),
    "istemci editoryal bandı tanımalı");
}


/**
 * TEK İSTİSNA: DÜNYA ÇAPI DEV MAÇ — VE RASTGELE AVRUPA MAÇI DEĞİL.
 *
 * "Rastgele Avrupa maçı Türk takımının önüne geçmeyecek" kuralı, dev maç
 * tanımının darlığında yaşıyor: İKİ TARAF DA seçkin kulüp olmalı. Real
 * Madrid'in bir eleme turu rakibiyle maçı dev maç değildir.
 */
function testOnlyWorldClassGiantsAreTheException() {
  const giant = { id: "dev", homeTeam: "Real Madrid", awayTeam: "Barcelona",
    league: "UEFA Şampiyonlar Ligi", competitionId: "sampiyonlar-ligi",
    kickoff: at("22:00"), status: "SCHEDULED" };
  const randomEuropean = { id: "rastgele", homeTeam: "Real Madrid", awayTeam: "Rudeš",
    league: "UEFA Şampiyonlar Ligi", competitionId: "sampiyonlar-ligi",
    kickoff: at("22:00"), status: "SCHEDULED" };
  const turkishInEurope = { id: "samsun", homeTeam: "Samsunspor", awayTeam: "AEK Athens",
    league: "UEFA Konferans Ligi", competitionId: "konferans-ligi",
    kickoff: at("21:00"), status: "SCHEDULED" };

  assert.equal(matchPriority(giant, { now: NOW }).spotlight, SPOTLIGHT.TOP,
    "iki tarafı da seçkin olan maç dev maçtır");
  assert.equal(matchPriority(randomEuropean, { now: NOW }).spotlight, SPOTLIGHT.NONE,
    "tek tarafı büyük olan Avrupa maçı dev maç değildir");
  assert.equal(matchPriority(turkishInEurope, { now: NOW }).spotlight, SPOTLIGHT.TURKISH,
    "Türk takımı kendi bandında olmalı");

  // RASTGELE AVRUPA MAÇI TÜRK TAKIMININ ÖNÜNE GEÇEMEZ — puanı yüksek olsa bile.
  const order = rank([randomEuropean, turkishInEurope, SMALL_LEAGUE]);
  assert.ok(
    order.indexOf("rastgele") > order.indexOf("samsun"),
    `rastgele Avrupa maçı Türk takımının önüne geçmemeli, sıra: ${order.join(" > ")}`
  );
  assert.ok(
    order.indexOf("rastgele") > order.indexOf("small"),
    `rastgele Avrupa maçı Süper Lig maçının da önüne geçmemeli, sıra: ${order.join(" > ")}`
  );

  // Dev maç istisnası çalışıyor: büyük dörtlünün hazırlık maçının üstüne çıkabilir.
  const bigFourFriendly = { id: "gs-hazirlik", homeTeam: "Galatasaray", awayTeam: "Rudeš",
    league: "Hazırlık maçı", kickoff: at("22:00"), status: "SCHEDULED" };
  const withGiant = rank([bigFourFriendly, giant]);
  assert.equal(withGiant[0], "dev", "dünya devi maçı istisna olarak öne geçebilmeli");

  // Ama büyük dörtlünün GERÇEK maçı devin üstünde kalır.
  assert.equal(rank([DERBY, giant])[0], "derby", "büyük dörtlü derbisi devin üstünde olmalı");
}

/** Üç UEFA turnuvası da kapsamda ve tam adıyla gösterilmeli. */
function testUefaCompetitionsAreCoveredAndNamed() {
  const { displayLeagueName, isUefaCompetitionName } = require("../services/leagueIdentity.js");

  const expected = {
    "UEFA Şampiyonlar Ligi": ["Şampiyonlar Ligi", "UEFA Champions League", "sampiyonlar-ligi"],
    "UEFA Avrupa Ligi": ["Avrupa Ligi", "UEFA Europa League", "avrupa-ligi"],
    "UEFA Konferans Ligi": ["Konferans Ligi", "UEFA Conference League", "konferans-ligi"]
  };

  for (const [display, variants] of Object.entries(expected)) {
    for (const variant of variants) {
      assert.equal(displayLeagueName(variant), display,
        `"${variant}" arayüzde "${display}" olarak gösterilmeli`);
      assert.equal(isUefaCompetitionName(variant), true);
    }
    // Turnuva ağırlıklandırmada da tanınmalı; tanınmazsa sıralamaya giremez.
    assert.ok(
      competitionProfile({ league: display }).weight > 0,
      `${display} turnuva ağırlığı taşımalı`
    );
  }

  // Süper Lig kapsamda ve kendi adıyla.
  assert.equal(displayLeagueName("Süper Lig"), "Trendyol Süper Lig");
}

/** Derbi öne çıkar ve gerekçesi yazılır. */
function testDerbyIsSurfaced() {
  const order = rank([FRIENDLY, SMALL_LEAGUE, DERBY]);
  assert.equal(order[0], "derby", `derbi en üstte olmalı, sıra: ${order.join(" > ")}`);
  assert.ok(reasonKeys(DERBY).includes("derby"), "derbi gerekçesi yazılmalı");

  // Dört büyüğün TAMAMI derbi tarafı sayılmalı.
  for (const club of TURKISH_BIG_FOUR) {
    assert.ok(CLUB_POPULARITY[club] >= 95, `${club} en üst ilgi katmanında olmalı`);
  }
}

/** Avrupa'da Türk takımı öne çıkar. */
function testTurkishSideInEuropeIsSurfaced() {
  const order = rank([FRIENDLY, SMALL_LEAGUE, UCL_TR]);
  assert.equal(order[0], "ucl", `Avrupa maçı en üstte olmalı, sıra: ${order.join(" > ")}`);
  assert.ok(
    reasonKeys(UCL_TR).includes("turkishInEurope"),
    "Avrupa'da Türk takımı gerekçesi yazılmalı"
  );

  // Türk tarafı olmayan bir Avrupa maçı bu gerekçeyi ALMAMALI.
  const foreignTie = { ...UCL_TR, id: "foreign", homeTeam: "Ajax", awayTeam: "Benfica" };
  assert.ok(
    !reasonKeys(foreignTie).includes("turkishInEurope"),
    "Türk tarafı yokken bu gerekçe üretilmemeli"
  );
}

/**
 * SAAT TEK BAŞINA BELİRLEMEZ.
 *
 * En erken maç (17:00) en düşük öncelikli olduğunda listenin başında
 * olmamalı; en geç maç (21:00) yüksek öncelikliyse yukarı çıkmalı.
 */
function testTimeAloneDoesNotDominate() {
  const order = rank([SMALL_LEAGUE, FRIENDLY, UCL_TR]);
  const byTime = [SMALL_LEAGUE, FRIENDLY, UCL_TR]
    .slice()
    .sort((left, right) => String(left.kickoff).localeCompare(String(right.kickoff)))
    .map((item) => item.id);

  assert.notDeepEqual(order, byTime, "sıralama saf saat sıralamasıyla aynı olmamalı");
  assert.equal(order[0], "ucl", "en geç ama en önemli maç başa gelmeli");
}

/** Düşük öncelikli maçlar elenmez, yalnızca aşağı iner. */
function testLowPriorityStaysVisible() {
  const input = [FRIENDLY, UCL_TR, DERBY, SMALL_LEAGUE, LIVE_FRIENDLY];
  const order = rank(input);
  assert.equal(order.length, input.length, "hiçbir maç elenmemeli");
  assert.ok(order.includes("friendly"), "düşük öncelikli maç listede kalmalı");
  assert.equal(order[order.length - 1], "friendly", "en düşük öncelikli maç en altta olmalı");
}

/** Editoryal geçersiz kılma çalışır ve gerekçe üretir. */
function testEditorialOverride() {
  const featured = { ...FRIENDLY, id: "featured", featured: true };
  assert.ok(
    matchPriority(featured, { now: NOW }).score > matchPriority(FRIENDLY, { now: NOW }).score,
    "featured işareti puanı yükseltmeli"
  );
  assert.ok(reasonKeys(featured).includes("editorial"), "editör gerekçesi yazılmalı");

  const weighted = { ...FRIENDLY, id: "weighted", editorialPriority: 500 };
  const order = rank([weighted, UCL_TR, DERBY]);
  assert.equal(order[0], "weighted", "yeterince yüksek editoryal öncelik başa alabilmeli");
}

/**
 * SIRALAMA YOKSA ZİRVE MÜCADELESİ İDDİA EDİLMEZ.
 *
 * `teams.json` sezon başında `rank: null` taşıyor. Olmayan bir sıralamadan
 * "zirve mücadelesi" etiketi üretmek, ölçmediğimiz şeyi iddia etmek olurdu.
 */
function testNoStandingsClaimWithoutStandings() {
  const preseason = [
    { name: "Galatasaray", rank: null },
    { name: "Fenerbahçe", rank: null }
  ];
  const keys = matchPriority(DERBY, { now: NOW, teams: preseason }).reasons.map((item) => item.key);
  assert.ok(!keys.includes("titleRace"), "sıralama yokken zirve mücadelesi yazılmamalı");
  assert.ok(!keys.includes("relegationRace"), "sıralama yokken düşme hattı yazılmamalı");

  // Sıralama VARSA bileşen devreye girer.
  const ranked = [
    { name: "Galatasaray", rank: 1 },
    { name: "Fenerbahçe", rank: 2 },
    { name: "Beşiktaş", rank: 3 },
    { name: "Trabzonspor", rank: 4 }
  ];
  const withStandings = matchPriority(DERBY, { now: NOW, teams: ranked }).reasons.map((item) => item.key);
  assert.ok(withStandings.includes("titleRace"), "sıralama varken zirve mücadelesi yazılmalı");
}

/** Her yüksek puanlı maç bir gerekçe taşımalı; sessiz sıralama olmaz. */
function testHighScoreAlwaysExplains() {
  for (const match of [UCL_TR, DERBY, LIVE_FRIENDLY]) {
    const priority = matchPriority(match, { now: NOW });
    assert.ok(priority.primaryReason, `${match.id}: yüksek puanlı maç gerekçesiz olamaz`);
    assert.ok(priority.primaryReason.label.trim(), `${match.id}: gerekçe etiketi boş`);
  }

  // Eşik üstünde ama özel bağlamı olmayan maç da bir şey söylemeli.
  const generic = { ...SMALL_LEAGUE, id: "generic", homeTeam: "Real Madrid", awayTeam: "Barcelona", league: "La Liga", competitionId: "la-liga" };
  const priority = matchPriority(generic, { now: NOW });
  if (priority.score >= HIGH_INTEREST_THRESHOLD) {
    assert.ok(priority.primaryReason, "eşik üstündeki maç gerekçesiz kalmamalı");
  }
}

/**
 * "YÜKSEK İLGİ" ETİKETİ — kuralın kendisi, eşiği değil.
 *
 * Denetim (2026-07): bu kuralın testi yalnızca HIGH_INTEREST_THRESHOLD
 * sabitini doğruluyordu; "Yüksek ilgi" dizesi hiçbir test dosyasında
 * geçmiyordu ve tek ilgili iddia `if (priority.score >= ...)` bloğunun
 * içindeydi. Koşullu bir iddia, koşul hiç gerçekleşmediğinde de "geçer" —
 * yani kuralı koruyormuş gibi görünüp korumaz.
 *
 * Bu senaryo kuralın İKİ YÖNÜNÜ de kurguyla sabitliyor: eşik üstünde ve başka
 * gerekçesi olmayan maç bu etiketi ALIR, eşik altındaki maç ALMAZ (gerekçe
 * uydurulmaz).
 */
function testHighInterestLabelIsActuallyPrinted() {
  // Bilerek seçilmiş kurgu: iki tanınmış kulüp ama ikisi de "dünya devi"
  // eşiğinin altında, Türk takımı yok, derbi yok, canlı değil, editör
  // seçimi değil — geriye tek bir gerekçe kalmalı.
  const anonymousBigMatch = {
    id: "yuksek-ilgi", homeTeam: "Juventus", awayTeam: "Napoli",
    league: "UEFA Şampiyonlar Ligi", competitionId: "sampiyonlar-ligi",
    kickoff: at("21:00"), status: "SCHEDULED"
  };

  const priority = matchPriority(anonymousBigMatch, { now: NOW });
  assert.ok(
    priority.score >= HIGH_INTEREST_THRESHOLD,
    `ön koşul: kurgu eşiğin üstünde olmalı (puan ${priority.score}, eşik ${HIGH_INTEREST_THRESHOLD})`
  );
  assert.equal(priority.reasons.length, 1, `başka gerekçe olmamalı: ${JSON.stringify(priority.reasons)}`);
  assert.equal(priority.reasons[0].key, "highInterest");
  assert.equal(priority.reasons[0].label, "Yüksek ilgi");
  assert.equal(priority.primaryReason.label, "Yüksek ilgi");

  // Eşiğin ALTINDA gerekçe UYDURULMAZ: boş gerekçe, yanlış gerekçeden iyidir.
  const quiet = { ...anonymousBigMatch, id: "sessiz", league: "Hazırlık Maçı", competitionId: "hazirlik-maci" };
  const quietPriority = matchPriority(quiet, { now: NOW });
  assert.ok(quietPriority.score < HIGH_INTEREST_THRESHOLD, "ön koşul: kurgu eşiğin altında olmalı");
  assert.deepEqual(quietPriority.reasons, [], "eşik altındaki maça gerekçe uydurulmamalı");
  assert.equal(quietPriority.primaryReason, null);

  // Gerçek gerekçesi olan maç bu etiketi ALMAZ: "Yüksek ilgi" bir yedek, bir
  // ek değil. Derbi hem eşiğin üstünde hem de kendi gerekçesini taşır.
  const derby = matchPriority(DERBY, { now: NOW });
  assert.ok(
    !derby.reasons.some((reason) => reason.key === "highInterest"),
    "gerekçesi olan maça ayrıca 'Yüksek ilgi' yazılmamalı"
  );
}

/** Turnuva ağırlıkları doğru sırada olmalı. */
function testCompetitionWeightOrder() {
  const ucl = competitionProfile({ competitionId: "sampiyonlar-ligi", league: "UEFA Şampiyonlar Ligi" }).weight;
  const uel = competitionProfile({ competitionId: "avrupa-ligi", league: "UEFA Avrupa Ligi" }).weight;
  const superLig = competitionProfile({ competitionId: "super-lig", league: "Trendyol Süper Lig" }).weight;
  const friendly = competitionProfile({ competitionId: "hazirlik-maci", league: "Hazırlık Maçı" }).weight;

  assert.ok(ucl > uel, "Şampiyonlar Ligi, Avrupa Ligi'nden ağır olmalı");
  assert.ok(uel > friendly, "Avrupa Ligi, hazırlık maçından ağır olmalı");
  assert.ok(superLig > friendly, "Süper Lig, hazırlık maçından ağır olmalı");
  assert.equal(
    competitionProfile({ competitionId: "super-lig", league: "Süper Lig" }).weight,
    superLig,
    "lig adı varyantı aynı ağırlığı vermeli"
  );
}

/** Bilinmeyen kulüp maçı elenmez, yalnızca taban puan alır. */
function testUnknownClubStillScores() {
  assert.ok(clubPopularity("Bilinmeyen SK") > 0, "bilinmeyen kulüp sıfır puan almamalı");
  const unknown = { ...FRIENDLY, id: "unknown", homeTeam: "Bilinmeyen SK", awayTeam: "Başka SK" };
  assert.ok(matchPriority(unknown, { now: NOW }).score > 0, "bilinmeyen kulüp maçı puanlanmalı");
}

/** İstemci (app.js) aynı katsayıları kullanmalı. */
function testClientMirrorsWeights() {
  const appJs = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const block = appJs.match(/var PRIORITY_CONFIG = (\{[\s\S]*?\});\n/);
  assert.ok(block, "app.js içinde öncelik yapılandırması bulunamadı");

  let client;
  assert.doesNotThrow(() => { client = JSON.parse(block[1]); }, "app.js yapılandırması geçerli JSON olmalı");

  assert.deepEqual(client.weights, { ...WEIGHTS }, "app.js ve servis katsayıları ayrışmış");
  assert.deepEqual(client.bigFour, [...TURKISH_BIG_FOUR], "dört büyük listesi ayrışmış");
  assert.equal(client.threshold, HIGH_INTEREST_THRESHOLD, "yüksek ilgi eşiği ayrışmış");
  assert.deepEqual(client.clubs, { ...CLUB_POPULARITY }, "kulüp ilgi tablosu ayrışmış");
}

/** Ana sayfanın üst sıraları gerçekten yüksek öncelikli olmalı. */
function testHomepageTopSlotsArePrioritised() {
  const homepage = path.join(root, "index.html");
  if (!fs.existsSync(homepage)) return;
  const html = fs.readFileSync(homepage, "utf8");

  const slot = html.match(/<!-- prerender:today-top-matches:start -->([\s\S]*?)<!-- prerender:today-top-matches:end -->/);
  if (!slot) return;

  const cards = slot[1].match(/<article class="fixture-card[\s\S]*?<\/article>/g) || [];
  if (cards.length < 2) return; // Tek maçlı günde sıralama iddiası test edilemez.

  // İlk kart bir gerekçe taşımalı ya da hiçbiri taşımamalı; gerekçesi olan
  // bir kart, gerekçesizin ALTINDA kalmamalı.
  const hasReason = cards.map((card) => /fixture-priority is-/.test(card));
  const firstWithout = hasReason.indexOf(false);
  const lastWith = hasReason.lastIndexOf(true);
  if (firstWithout !== -1 && lastWith !== -1) {
    assert.ok(
      lastWith < firstWithout,
      "gerekçeli maç, gerekçesiz maçın altında kalmamalı (öncelik sıralaması uygulanmamış)"
    );
  }
}

testLiveGoesTopWithinItsBand();
testBigFourAlwaysRanksFirst();
testWithinSpotlightScoreStillOrders();
testEditorialBeatsTheSpotlightBand();
testClientMirrorsSpotlight();
testOnlyWorldClassGiantsAreTheException();
testUefaCompetitionsAreCoveredAndNamed();
testDerbyIsSurfaced();
testTurkishSideInEuropeIsSurfaced();
testTimeAloneDoesNotDominate();
testLowPriorityStaysVisible();
testEditorialOverride();
testNoStandingsClaimWithoutStandings();
testHighScoreAlwaysExplains();
testHighInterestLabelIsActuallyPrinted();
testCompetitionWeightOrder();
testUnknownClubStillScores();
testClientMirrorsWeights();
testHomepageTopSlotsArePrioritised();

console.log(
  "Match priority tests passed (canlı üstte, derbi öne çıkar, Avrupa'da Türk takımı öne çıkar, " +
  "saat tek başına belirlemez, düşük öncelik elenmez, editoryal geçersiz kılma, sıralamasız iddia yok, " +
  "gerekçe zorunluluğu, turnuva ağırlıkları, bilinmeyen kulüp, istemci eşliği, ana sayfa denetimi, " +
  "büyük dörtlü bandı, bant içi sıralama, editoryal geçersiz kılma bandı, istemci bant eşliği)."
);
