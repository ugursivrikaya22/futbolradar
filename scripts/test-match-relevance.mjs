/**
 * MAÇ İLGİ PUANI TESTLERİ.
 *
 * Bu testler ana sayfada görülen somut bir durumdan doğdu: takvimdeki 314
 * maçın 183'ü kulüp hazırlık maçı, 53'ü Güney Amerika Primera División ve
 * yalnızca 9'u Süper Lig olduğu için, ilgiden bağımsız her sıralama ana
 * sayfayı Türkiye'den gelen okuyucu için anlamsız maçlarla dolduruyordu.
 * Günün üç başlığı Uruguay ve Venezuela maçlarıyla dolarken Fenerbahçe'nin
 * aynı gün oynanacak Şampiyonlar Ligi maçı listeye hiç giremiyordu.
 *
 * Buradaki testler iki şeyi korur: kademe sırasının doğruluğu ve —asıl
 * önemlisi— DURUMUN KADEMEYİ EZEMEMESİ.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const {
  MAX_TIER,
  STATE_BONUS,
  TIER,
  TIER_STEP,
  relevanceScore,
  sortByRelevance,
  stateOf,
  tierOf,
  withRelevance
} = require("../services/matchRelevance.js");

const NOW = Date.parse("2026-08-11T18:00:00Z");
const at = (offsetMinutes) => new Date(NOW + offsetMinutes * 60000).toISOString();

const match = (fields) => ({
  homeTeam: "A takımı",
  awayTeam: "B takımı",
  kickoff: at(60),
  status: "SCHEDULED",
  ...fields
});

// ── 1. Kademe sırası ───────────────────────────────────────────────────────

{
  const cases = [
    [match({ homeTeam: "Galatasaray", league: "Süper Lig", competitionId: "super-lig" }), TIER.BIG_FOUR_1],
    [match({ awayTeam: "Fenerbahçe", league: "Süper Lig", competitionId: "super-lig" }), TIER.BIG_FOUR_2],
    [match({ homeTeam: "Beşiktaş", league: "Süper Lig", competitionId: "super-lig" }), TIER.BIG_FOUR_3],
    [match({ homeTeam: "Trabzonspor", league: "Süper Lig", competitionId: "super-lig" }), TIER.BIG_FOUR_4],
    [match({ homeTeam: "Göztepe", awayTeam: "Kasımpaşa", league: "Süper Lig", competitionId: "super-lig" }), TIER.SUPER_LIG],
    [match({ homeTeam: "Real Madrid", awayTeam: "Bayern München", league: "UEFA Champions League", competitionId: "sampiyonlar-ligi" }), TIER.CHAMPIONS_LEAGUE],
    [match({ homeTeam: "Aston Villa", awayTeam: "Everton", league: "Premier League", competitionId: "premier-league" }), TIER.TOP_EUROPEAN_LEAGUE],
    [match({ homeTeam: "Deportivo Maldonado", awayTeam: "Racing Montevideo", league: "Primera División" }), TIER.OTHER_LEAGUE],
    [match({ homeTeam: "Juventus", awayTeam: "Palermo", league: "Friendlies Clubs" }), TIER.FRIENDLY]
  ];

  for (const [record, expected] of cases) {
    assert.equal(
      tierOf(record),
      expected,
      `${record.homeTeam} - ${record.awayTeam} (${record.league}) yanlış kademede`
    );
  }
}

// ── 2. Hazırlık maçı EN ALTTA, kim oynarsa oynasın ─────────────────────────

{
  // Bir Galatasaray hazırlık maçı, Fenerbahçe'nin Şampiyonlar Ligi maçının
  // önüne geçmemeli: "düşük ilgi gören hazırlık maçları" listenin sonunda.
  const galatasarayFriendly = match({ homeTeam: "Galatasaray", awayTeam: "Bir Kulüp", league: "Friendlies Clubs" });
  const fenerbahceEurope = match({ homeTeam: "Sturm Graz", awayTeam: "Fenerbahçe", league: "UEFA Champions League", competitionId: "sampiyonlar-ligi" });

  assert.equal(tierOf(galatasarayFriendly), TIER.FRIENDLY, "dört büyüğün hazırlık maçı da hazırlık maçıdır");
  assert.ok(
    relevanceScore(fenerbahceEurope, { now: NOW }) > relevanceScore(galatasarayFriendly, { now: NOW }),
    "Avrupa maçı, hazırlık maçının önünde olmalı"
  );

  // Hazırlık maçları kendi içinde Türk kulübü lehine ayrışmalı.
  const foreignFriendly = match({ homeTeam: "Graničar Đurđevac", awayTeam: "Slavonija Požega", league: "Friendlies Clubs" });
  assert.ok(
    relevanceScore(galatasarayFriendly, { now: NOW }) > relevanceScore(foreignFriendly, { now: NOW }),
    "iki hazırlık maçı arasında Türk kulübü öne gelmeli"
  );
}

// ── 3. ASIL KURAL: durum kademeyi EZEMEZ ───────────────────────────────────

{
  // İstenen kural: "LIVE maç her zaman AYNI SEVİYEDEKİ başlamamış maçtan
  // önce gelsin." Yani canlı olmak bir üst kademeye taşımaz.
  const maxStateBonus = Math.max(...Object.values(STATE_BONUS));
  assert.ok(
    maxStateBonus < TIER_STEP,
    `durum bonusu (${maxStateBonus}) kademe adımından (${TIER_STEP}) küçük olmalı, yoksa önemsiz ama canlı maç öne çıkar`
  );

  const liveMinor = match({
    homeTeam: "Caracas FC", awayTeam: "Deportivo La Guaira",
    league: "Primera División", status: "LIVE", live: true
  });
  const upcomingBigFour = match({
    homeTeam: "Galatasaray", awayTeam: "Kasımpaşa",
    league: "Süper Lig", competitionId: "super-lig", kickoff: at(180)
  });

  assert.equal(stateOf(liveMinor, NOW), "live", "canlı maç canlı sayılmalı");
  assert.ok(
    relevanceScore(upcomingBigFour, { now: NOW }) > relevanceScore(liveMinor, { now: NOW }),
    "Venezuela'daki canlı maç, başlamamış bir Galatasaray maçının önüne geçmemeli"
  );

  // Ama AYNI kademede canlı, başlamamışın önünde olmalı.
  const liveSuperLig = match({ homeTeam: "Göztepe", awayTeam: "Kasımpaşa", league: "Süper Lig", competitionId: "super-lig", status: "LIVE", live: true });
  const upcomingSuperLig = match({ homeTeam: "Eyüpspor", awayTeam: "Samsunspor", league: "Süper Lig", competitionId: "super-lig", kickoff: at(180) });
  assert.ok(
    relevanceScore(liveSuperLig, { now: NOW }) > relevanceScore(upcomingSuperLig, { now: NOW }),
    "aynı kademede canlı maç başlamamışın önünde olmalı"
  );
}

// ── 4. Sağlayıcı gecikmesi maçı düşürmemeli ────────────────────────────────

{
  // Takvim günde birkaç kez tazeleniyor; 19:08'de 18:30 maçı hâlâ
  // "SCHEDULED" görünebiliyor. "in-progress" bandı bunu karşılar.
  const started = match({ kickoff: at(-30), status: "SCHEDULED" });
  assert.equal(stateOf(started, NOW), "in-progress", "başlama saati geçmiş maç oynanıyor sayılmalı");

  const longPast = match({ kickoff: at(-300), status: "SCHEDULED" });
  assert.equal(stateOf(longPast, NOW), "finished", "pencereyi aşan maç oynanmış sayılmalı");

  assert.ok(
    STATE_BONUS["in-progress"] > STATE_BONUS.upcoming,
    "oynanmakta olan maç başlayacak maçın önünde olmalı"
  );
}

// ── 5. Sıralama VERİ KAYBETMEZ ─────────────────────────────────────────────

{
  const pool = [
    match({ homeTeam: "Graničar Đurđevac", awayTeam: "Slavonija Požega", league: "Friendlies Clubs" }),
    match({ homeTeam: "Sturm Graz", awayTeam: "Fenerbahçe", league: "UEFA Champions League", competitionId: "sampiyonlar-ligi" }),
    match({ homeTeam: "Caracas FC", awayTeam: "Deportivo La Guaira", league: "Primera División" })
  ];
  const sorted = sortByRelevance(pool, { now: NOW });

  assert.equal(sorted.length, pool.length, "sıralama hiçbir maçı elememeli — alt lig maçları listede kalır");
  assert.equal(sorted[0].awayTeam, "Fenerbahçe", "en ilgili maç başa gelmeli");
  assert.equal(sorted[sorted.length - 1].league, "Friendlies Clubs", "hazırlık maçı sona gitmeli");

  // Aynı girdi hep aynı çıktıyı vermeli.
  assert.deepEqual(
    sortByRelevance(pool, { now: NOW }).map((item) => item.homeTeam),
    sorted.map((item) => item.homeTeam),
    "sıralama kararlı olmalı"
  );

  // Girdi dizisi bozulmamalı.
  assert.equal(pool[0].homeTeam, "Graničar Đurđevac", "çağıranın dizisi değiştirilmemeli");
}

// ── 6. Damgalama kaydı bozmaz ──────────────────────────────────────────────

{
  const source = [match({ homeTeam: "Galatasaray", league: "Süper Lig", competitionId: "super-lig" })];
  const stamped = withRelevance(source, { now: NOW });

  assert.equal(typeof stamped[0].relevance, "number", "puan kayda yazılmalı");
  assert.equal(source[0].relevance, undefined, "kaynak kayıt değiştirilmemeli");
  assert.equal(stamped[0].homeTeam, "Galatasaray", "diğer alanlar korunmalı");
  assert.deepEqual(withRelevance(null), [], "bozuk girdi çökmemeli");
}

// ── 7. Puan aralığı ────────────────────────────────────────────────────────

{
  // En alttaki kademe bile negatif puan almamalı; sıralama işaret değil
  // büyüklük karşılaştırması yapıyor.
  const worst = match({ homeTeam: "X", awayTeam: "Y", league: "Friendlies Clubs", status: "" , kickoff: "" });
  assert.ok(relevanceScore(worst, { now: NOW }) >= 0, "en düşük puan negatif olmamalı");
  assert.equal(MAX_TIER, TIER.FRIENDLY, "en büyük kademe hazırlık maçı olmalı");
}

// ── 8. GERÇEK DEPO: ana sayfa artık alt lig maçlarıyla dolmamalı ───────────

{
  const calendarPath = path.join(root, "data", "fixture-calendar.json");
  if (fs.existsSync(calendarPath)) {
    const all = JSON.parse(fs.readFileSync(calendarPath, "utf8")).matches || [];
    if (all.length) {
      const top = sortByRelevance(all, { now: NOW }).slice(0, 6);
      const friendlies = top.filter((item) => tierOf(item) === TIER.FRIENDLY);
      assert.equal(
        friendlies.length,
        0,
        `en görünür altı sırada hazırlık maçı olmamalı; bulundu: ${friendlies.map((f) => `${f.homeTeam}-${f.awayTeam}`).join(", ")}`
      );
    }
  }
}

console.log("Maç ilgi puanı testleri geçti (kademe sırası, durum kademeyi ezmiyor, veri kaybı yok).");

// ── 9. ÇOK ANLAMLI LİG ADI YANLIŞ YARIŞMAYA BAĞLANMAMALI ──────────────────
//
// Depoda görülen somut hata: sağlayıcıdan "Primera División" adıyla gelen 53
// maç `competitionId: "la-liga"` damgasıyla kaydedilmiş. Bolivya'daki
// "ABB - Guabirá" karşılaşması sistemde İspanya La Liga'sı sayılıyordu —
// yani Avrupa'nın en üst kademesinde. Kayıt kendi içinde çelişiyor: kimlik
// La Liga diyor, ad "Primera División" diyor.

{
  const { classifyFixtureCompetition, resolveCompetitionId } = require("../services/competitionCatalog.js");

  const bolivian = match({
    homeTeam: "ABB", awayTeam: "Guabirá",
    league: "Primera División", competitionId: "la-liga"
  });

  assert.equal(resolveCompetitionId(bolivian), "", "çelişkili kayıtta kimlik reddedilmeli");
  assert.notEqual(
    tierOf(bolivian),
    TIER.TOP_EUROPEAN_LEAGUE,
    "Bolivya maçı Avrupa'nın en üst kademesine yerleştirilmemeli"
  );
  assert.equal(
    classifyFixtureCompetition(bolivian).includeInLeagueForm,
    false,
    "tanınmayan yarışma bir ligin formuna sayılmamalı"
  );

  // GERÇEK La Liga zarar görmemeli.
  const realLaLiga = match({
    homeTeam: "Real Madrid", awayTeam: "FC Barcelona",
    league: "La Liga", competitionId: "la-liga"
  });
  assert.equal(resolveCompetitionId(realLaLiga), "la-liga", "gerçek La Liga tanınmalı");
  assert.equal(tierOf(realLaLiga), TIER.TOP_EUROPEAN_LEAGUE, "gerçek La Liga üst kademede kalmalı");
  assert.equal(classifyFixtureCompetition(realLaLiga).includeInLeagueForm, true, "gerçek La Liga forma sayılmalı");

  // MEŞRU TAKMA AD zarar görmemeli: "Trendyol Süper Lig" ile "Süper Lig"
  // aynı yarışmadır; bu bir çelişki değil.
  const sponsored = match({
    homeTeam: "Göztepe", awayTeam: "Kasımpaşa",
    league: "Trendyol Süper Lig", competitionId: "super-lig"
  });
  assert.equal(resolveCompetitionId(sponsored), "super-lig", "sponsorlu ad meşru takma addır");
  assert.equal(tierOf(sponsored), TIER.SUPER_LIG, "Süper Lig kademesi korunmalı");

  // Kimliği hiç olmayan çok anlamlı ad da çözülmemeli.
  assert.equal(
    resolveCompetitionId(match({ league: "Primera División" })),
    "",
    "kimliksiz çok anlamlı ad çözülmemeli"
  );
}

console.log("Yarışma kimliği doğrulama testleri geçti (çok anlamlı ad yanlış lige bağlanmıyor).");
