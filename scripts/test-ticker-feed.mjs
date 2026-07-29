/**
 * ÜST HABER BANDI TESTLERİ
 *
 * Bandın sözleşmesi:
 *   1. Yalnızca doğrulanmış kaynaklardan beslenir (canlı skor, günün maçları,
 *      maç sonucu, maç sonu açıklaması, onaylı transfer, doğrulanmış
 *      editoryal haber). Elle yazılmış/uydurma başlık girmez.
 *   2. Rozet bir iddiadır: "Canlı" ancak gerçekten canlı bir maç varsa,
 *      "Son Dakika" ancak gerçekten taze bir öğe varsa yazılır.
 *   3. Kaynak geçici olarak boşalırsa bant boşalmaz; son doğrulanmış öğeler
 *      korunur ve durum iç zaman damgasıyla kaydedilir.
 *   4. Hiç doğrulanmış kayıt yoksa bant SAHTE İÇERİKLE DOLDURULMAZ ve
 *      sayfadan da silinmez: açıkça "veri bekleniyor" der.
 *   5. Tek bir kategori bandı ele geçiremez.
 *   6. Bant kalabalıklaşmaz.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildTickerFeed, FRESH_WINDOW_HOURS, MAX_ITEMS } from "./lib/tickerFeed.mjs";
import { newsTicker } from "./lib/layout.mjs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { publishableTransfers } = require("../services/transferService.js");
const { publishableStatements } = require("../services/matchStatementService.js");

const root = process.cwd();
const STATE_FILE = path.join(root, "data", "ticker-state.json");

/** Bandı besleyen TÜM kaynak dosyaları. Biri unutulursa "kaynak boşaldı"
 *  senaryosu gerçekten boşalmaz ve test yanlış yere güven verir. */
const SOURCE_FILES = [
  "matches.json",
  "fixture-calendar.json",
  "statements.json",
  "transfers.json",
  "news.json"
];

function withTempData(mutate, run) {
  const backups = new Map();

  for (const file of SOURCE_FILES) {
    const full = path.join(root, "data", file);
    backups.set(full, fs.existsSync(full) ? fs.readFileSync(full, "utf8") : null);
  }
  const stateBackup = fs.existsSync(STATE_FILE) ? fs.readFileSync(STATE_FILE, "utf8") : null;

  try {
    mutate(SOURCE_FILES.map((file) => path.join(root, "data", file)));
    return run();
  } finally {
    for (const [full, content] of backups) {
      if (content === null) {
        if (fs.existsSync(full)) fs.unlinkSync(full);
      } else {
        fs.writeFileSync(full, content, "utf8");
      }
    }
    if (stateBackup === null) {
      if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    } else {
      fs.writeFileSync(STATE_FILE, stateBackup, "utf8");
    }
  }
}

const emptyAllSources = (files) => files.forEach((file) => fs.writeFileSync(file, "[]", "utf8"));

function testOnlyVerifiedSources() {
  const feed = buildTickerFeed();
  assert.ok(feed.items.length, "bant boş dönmemeli");

  for (const item of feed.items) {
    assert.ok(item.text && item.text.trim(), "bant öğesinin metni olmalı");
    assert.ok(item.href && item.href.trim(), "bant öğesinin bağlantısı olmalı");
    assert.ok(item.at, `"${item.text}" öğesinin zaman damgası yok`);
    assert.ok(!Number.isNaN(Date.parse(item.at)), `"${item.text}" geçersiz zaman damgası`);
    assert.ok(item.kind, `"${item.text}" öğesinin türü yok`);
    assert.ok(item.source, `"${item.text}" öğesinin kaynağı işaretlenmemiş`);
  }
}

function testNotCrowded() {
  const feed = buildTickerFeed();
  assert.ok(
    feed.items.length <= MAX_ITEMS,
    `bant en fazla ${MAX_ITEMS} öğe taşımalı, ${feed.items.length} var`
  );
  // Sınırın kendisi de bir sözleşme: kategori eklendi diye sessizce
  // yükseltilirse şerit okunmaz hale gelir.
  assert.ok(MAX_ITEMS <= 12, `bant sınırı fazla yüksek: ${MAX_ITEMS}`);
}

/** Tek bir kategori bandın tamamını dolduramaz. */
function testNoSingleCategoryDominates() {
  const feed = buildTickerFeed();
  if (feed.items.length < 3) return;

  const available = (feed.sourceReport || []).filter((entry) => entry.available > 0).length;
  if (available < 2) return;

  const bySource = new Map();
  for (const item of feed.items) {
    bySource.set(item.source, (bySource.get(item.source) || 0) + 1);
  }

  for (const [source, count] of bySource) {
    assert.ok(
      count < feed.items.length,
      `"${source}" kategorisi bandın tamamını doldurmuş (${count}/${feed.items.length})`
    );
  }
}

/**
 * Rozet bir ZAMAN İDDİASIDIR.
 *
 * Test hermetik: tek bir biten maç kaydı üzerinden çalışır. Canlı veri
 * dosyalarına bakan bir sürümü vardı ve dosyaya yeni bir sonuç eklendiğinde
 * kırılıyordu — kural değişmemiş olmasına rağmen. Ölçülen şey kuralın
 * kendisi olmalı, o günkü veri değil.
 */
function testFreshBadgeIsATimeClaim() {
  const kickoff = "2026-07-26T19:00:00+03:00";
  const withSingleResult = (now) => withTempData(
    (files) => {
      emptyAllSources(files);
      fs.writeFileSync(files[SOURCE_FILES.indexOf("matches.json")], JSON.stringify([{
        id: "tazelik-testi",
        homeTeam: "Ev Takımı",
        awayTeam: "Deplasman Takımı",
        status: "FINISHED",
        score: { home: 2, away: 1 },
        kickoff,
        lastVerifiedAt: kickoff
      }]), "utf8");
      if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    },
    () => buildTickerFeed({ now })
  );

  // Maçtan bir saat sonra: gerçekten taze.
  const fresh = withSingleResult(new Date("2026-07-26T20:00:00+03:00"));
  assert.equal(fresh.badge, "Son Dakika", "taze sonuçta rozet Son Dakika olmalı");
  assert.equal(fresh.fresh, true);

  // Aynı kayıt, tazelik penceresi geçtikten sonra: rozet sessizce nötrleşmeli,
  // "Son Dakika" iddiası sürdürülmemeli.
  const later = new Date("2026-07-26T20:00:00+03:00");
  later.setHours(later.getHours() + FRESH_WINDOW_HOURS + 6);
  const stale = withSingleResult(later);
  assert.notEqual(stale.badge, "Son Dakika", "eski içerikte Son Dakika rozeti kalmamalı");
  assert.equal(stale.fresh, false);
}

/**
 * Başlamamış maç "Son Dakika" ÜRETEMEZ.
 *
 * Bugünün programındaki bir maçın zaman damgası gelecektedir; ham yaş hesabı
 * onu "eksi saat önce" sayıp rozeti sürekli yakıyordu. Sürekli yanan rozet
 * sinyal olmaktan çıkar.
 */
function testScheduledFixtureDoesNotClaimBreakingNews() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());
  const feed = withTempData(
    (files) => {
      emptyAllSources(files);
      fs.writeFileSync(files[SOURCE_FILES.indexOf("matches.json")], JSON.stringify([{
        id: "gelecek-mac",
        homeTeam: "Ev Takımı",
        awayTeam: "Deplasman Takımı",
        status: "SCHEDULED",
        kickoff: `${today}T23:59:00+03:00`,
        time: "23:59"
      }]), "utf8");
      if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    },
    () => buildTickerFeed()
  );

  assert.ok(feed.items.some((item) => item.kind === "today"), "ön koşul: program kaydı banda girmeli");
  assert.notEqual(feed.badge, "Son Dakika", "başlamamış maç Son Dakika rozeti üretmemeli");
  assert.equal(feed.fresh, false, "gelecek tarihli kayıt tazelik iddiası doğurmamalı");
}

/** "Canlı" rozeti yalnızca banttaki bir öğe gerçekten canlıysa yazılır. */
function testLiveBadgeIsALiveClaim() {
  const feed = buildTickerFeed();
  if (feed.badge === "Canlı") {
    assert.ok(
      feed.items.some((item) => item.kind === "live"),
      "Canlı rozeti varken bantta canlı öğe olmalı"
    );
  } else {
    assert.ok(
      !feed.items.some((item) => item.kind === "live"),
      "bantta canlı öğe varken rozet Canlı olmalı"
    );
  }
}

/** Bugünün maçları saatiyle banda girmeli — bandın en çok sorulan sorusu. */
function testTodayFixturesCarryKickoffTime() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());
  const result = withTempData(
    (files) => {
      emptyAllSources(files);
      fs.writeFileSync(files[SOURCE_FILES.indexOf("matches.json")], JSON.stringify([{
        id: "ev-deplasman-test",
        homeTeam: "Ev Takımı",
        awayTeam: "Deplasman Takımı",
        status: "SCHEDULED",
        kickoff: `${today}T21:00:00+03:00`,
        time: "21:00"
      }]), "utf8");
      if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    },
    () => buildTickerFeed()
  );

  const item = result.items.find((entry) => entry.kind === "today");
  assert.ok(item, "bugünün maçı banda girmeli");
  assert.ok(item.text.startsWith("21:00 "), `başlama saati yazılmalı: "${item.text}"`);
  assert.ok(item.text.includes("Ev Takımı - Deplasman Takımı"), "takımlar yazılmalı");
}

/** Maç sonu açıklaması: yalnızca doğrulanmış ve kaynaklı olan banda girer. */
function testStatementsEnterOnlyWhenVerified() {
  const now = new Date("2026-08-10T23:59:00+03:00");
  const result = withTempData(
    (files) => {
      emptyAllSources(files);
      fs.writeFileSync(files[SOURCE_FILES.indexOf("statements.json")], JSON.stringify({
        statements: [
          {
            id: "dogrulanmis",
            matchId: "test-maci",
            matchLabel: "Ev Takımı - Deplasman",
            speaker: "Teknik Direktör",
            role: "coach",
            team: "Ev Takımı",
            quote: "Oyuncularımın mücadelesinden memnunum.",
            publishedAt: "2026-08-10T23:40:00+03:00",
            sourceName: "Kulüp",
            sourceType: "official",
            url: "https://ornek-kulup.org.tr/haber/1",
            status: "verified"
          },
          {
            id: "taslak",
            matchId: "test-maci",
            matchLabel: "Ev Takımı - Deplasman",
            speaker: "Futbolcu",
            role: "player",
            team: "Ev Takımı",
            quote: "Bu söz henüz doğrulanmadı.",
            publishedAt: "2026-08-10T23:45:00+03:00",
            sourceName: "Kaynak",
            sourceType: "media",
            url: "https://ornek-kulup.org.tr/haber/2",
            status: "draft"
          },
          {
            id: "kaynaksiz",
            matchId: "test-maci",
            matchLabel: "Ev Takımı - Deplasman",
            speaker: "Teknik Direktör",
            role: "coach",
            team: "Deplasman",
            quote: "Kaynağı olmayan söz yayımlanmamalı.",
            publishedAt: "2026-08-10T23:50:00+03:00",
            sourceName: "Kaynak",
            sourceType: "official",
            url: "",
            status: "verified"
          }
        ]
      }), "utf8");
      if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    },
    () => buildTickerFeed({ now })
  );

  const texts = result.items.map((item) => item.text).join("\n");
  assert.ok(texts.includes("Oyuncularımın mücadelesinden memnunum."), "doğrulanmış açıklama banda girmeli");
  assert.ok(!texts.includes("Bu söz henüz doğrulanmadı."), "taslak açıklama banda girmemeli");
  assert.ok(!texts.includes("Kaynağı olmayan söz"), "kaynaksız açıklama banda girmemeli");
}

function testFallbackKeepsLastVerified() {
  // Önce sağlıklı bir durum yazılır.
  const healthy = buildTickerFeed();
  assert.ok(healthy.items.length, "ön koşul: bant dolu olmalı");

  // Sonra tüm kaynaklar boşaltılır (geçici veri kesintisi).
  const result = withTempData(emptyAllSources, () => buildTickerFeed());

  assert.ok(result.items.length, "kaynak boşalınca bant boşalmamalı");
  assert.equal(result.usedFallback, true, "yedek kullanıldığı işaretlenmeli");
  assert.notEqual(result.badge, "Son Dakika", "yedek içerikte Son Dakika rozeti olmamalı");
  assert.deepEqual(
    result.items.map((item) => item.text),
    healthy.items.map((item) => item.text),
    "yedek, son doğrulanmış öğeleri aynen korumalı"
  );
}

function testFallbackWritesInternalTimestamp() {
  // Durum dosyası withTempData tarafından geri alındığı için, yedeğin ne
  // yazdığına kesintinin sürdüğü an içinden bakılır.
  const state = withTempData(emptyAllSources, () => {
    buildTickerFeed();
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  });

  assert.ok(state.fallbackSince, "yedek durumunda iç zaman damgası yazılmalı");
  assert.ok(!Number.isNaN(Date.parse(state.fallbackSince)), "zaman damgası geçerli olmalı");
  assert.equal(state.usedFallback, true, "durum dosyası yedek kullanımını kaydetmeli");
  assert.ok(state.fallbackReason, "yedek gerekçesi kaydedilmeli");
}

/**
 * Ne veri ne yedek: bant UYDURMAZ ve KAYBOLMAZ.
 *
 * Eskiden bu durumda `newsTicker()` boş dize döndürüyordu ve şerit sayfadan
 * tamamen siliniyordu; okuyucu için "site bozuldu" ile "veri yok" aynı
 * görünüyordu. Artık eksiklik yazıyla söylenir.
 */
function testAwaitingStateIsExplicit() {
  const feed = withTempData(
    (files) => {
      emptyAllSources(files);
      if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    },
    () => buildTickerFeed()
  );

  assert.equal(feed.items.length, 0, "doğrulanmış kayıt yokken uydurma öğe üretilmemeli");
  assert.equal(feed.awaiting, true, "bekleme durumu işaretlenmeli");
  assert.equal(feed.badge, "Veri Bekleniyor", "rozet eksikliği söylemeli");
  assert.ok(feed.note && feed.note.trim(), "bekleme gerekçesi yazılmalı");

  const html = newsTicker({ base: "./", items: feed.items, badge: feed.badge, note: feed.note });
  assert.ok(html.includes("news-ticker"), "bant sayfadan silinmemeli");
  assert.ok(html.includes("Veri Bekleniyor"), "bant eksikliği görünür biçimde yazmalı");
  assert.ok(!html.includes("news-ticker-track"), "bekleme durumunda kayan şerit çalışmamalı");
}

/** Dolu bantta her öğe tıklanabilir bir bağlantı olmalı. */
function testItemsAreClickableLinks() {
  const feed = buildTickerFeed();
  const html = newsTicker({ base: "./", items: feed.items, badge: feed.badge });

  assert.ok(html.includes('class="news-ticker-item'), "öğeler bağlantı olarak basılmalı");
  const anchors = html.match(/<a class="news-ticker-item[^"]*" href="([^"]+)"/g) || [];
  assert.ok(anchors.length >= feed.items.length, "her öğe bir bağlantı üretmeli");
  assert.ok(!/href=""/.test(html), "boş bağlantı basılmamalı");
}

function testStaleEditorialNewsIsDropped() {
  // Yayım tarihi çok eski bir haber banda girmemeli: içerik gerçek olsa bile
  // güncel akış bandında haftalar öncesinin başlığı yanıltıcıdır.
  const result = withTempData(
    (files) => {
      emptyAllSources(files);
      fs.writeFileSync(files[SOURCE_FILES.indexOf("news.json")], JSON.stringify([{
        id: "eski",
        title: "Çok eski bir başlık",
        status: "verified",
        url: "https://example.com/eski",
        publishedAt: "2026-01-01T10:00:00+03:00"
      }]), "utf8");
      if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    },
    () => buildTickerFeed({ now: new Date("2026-07-26T20:00:00+03:00") })
  );

  assert.ok(
    !result.items.some((item) => item.text === "Çok eski bir başlık"),
    "yaş sınırını aşan editoryal haber banda girmemeli"
  );
}

function testUnchangedFeedDoesNotRewriteState() {
  // Bant beş dakikada bir yeniden üretiliyor. İçerik aynıyken durum dosyası
  // yeniden yazılırsa CI her turda bir commit ve gereksiz bir dağıtım üretir.
  buildTickerFeed();
  const first = fs.readFileSync(STATE_FILE, "utf8");
  buildTickerFeed();
  const second = fs.readFileSync(STATE_FILE, "utf8");

  assert.equal(second, first, "içerik değişmediyse durum dosyası aynı kalmalı");
}

function testFallbackDoesNotRewriteWhileOutageContinues() {
  const [first, second] = withTempData(emptyAllSources, () => {
    buildTickerFeed();
    const a = fs.readFileSync(STATE_FILE, "utf8");
    buildTickerFeed();
    return [a, fs.readFileSync(STATE_FILE, "utf8")];
  });

  assert.equal(second, first, "kesinti sürerken durum dosyası her turda yeniden yazılmamalı");
}


/**
 * BÜYÜK KULÜPLER KATEGORİ İÇİNDE ÖNE GEÇER.
 *
 * Bant her kategoride yalnızca tazeliğe göre diziliyordu: aynı gün gelen iki
 * transferden hangisinin daha çok aranacağı hesaba katılmıyordu.
 */
function testBigClubsRankFirstWithinCategory() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());
  const feed = withTempData(
    (files) => {
      emptyAllSources(files);
      fs.writeFileSync(files[SOURCE_FILES.indexOf("matches.json")], JSON.stringify([
        // Küçük kulüp maçı DAHA ERKEN saatte: tazelik tek ölçüt olsaydı öne geçerdi.
        { id: "kucuk", homeTeam: "Çorum FK", awayTeam: "Erzurumspor FK", status: "SCHEDULED",
          kickoff: `${today}T18:00:00+03:00`, time: "18:00" },
        { id: "buyuk", homeTeam: "Galatasaray", awayTeam: "Fenerbahçe", status: "SCHEDULED",
          kickoff: `${today}T21:00:00+03:00`, time: "21:00" }
      ]), "utf8");
      if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    },
    () => buildTickerFeed()
  );

  const todayItems = feed.items.filter((item) => item.kind === "today");
  assert.ok(todayItems.length >= 2, "ön koşul: iki maç da banda girmeli");
  assert.ok(
    todayItems[0].text.includes("Galatasaray"),
    `büyük kulüp maçı önce gelmeli, sıra: ${todayItems.map((item) => item.text).join(" | ")}`
  );
  assert.ok(todayItems[0].weight > todayItems[1].weight, "ağırlık farkı sıralamayı açıklamalı");
}

/** Her bant öğesi bir kulüp ağırlığı taşımalı; sıralama sessiz olmamalı. */
function testEveryItemCarriesWeight() {
  for (const item of buildTickerFeed().items) {
    assert.equal(typeof item.weight, "number", `"${item.text}" ağırlık taşımıyor`);
    assert.ok(item.weight >= 0, `"${item.text}" ağırlığı negatif olamaz`);
  }
}

/**
 * SKORSUZ CANLI MAÇ BANDA GİRMEZ.
 *
 * Bant ile sayfa listeleri aynı kapıdan geçmeli; ayrışsalardı bantta görünen
 * bir maç sayfada bulunamazdı.
 */
function testTickerHidesLiveMatchWithoutScore() {
  const feed = withTempData(
    (files) => {
      emptyAllSources(files);
      fs.writeFileSync(files[SOURCE_FILES.indexOf("matches.json")], JSON.stringify([{
        id: "skorsuz-canli",
        homeTeam: "Galatasaray",
        awayTeam: "Fenerbahçe",
        status: "LIVE",
        kickoff: "2026-07-29T19:00:00+03:00",
        lastVerifiedAt: "2026-07-29T20:00:00+03:00"
      }]), "utf8");
      if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    },
    () => buildTickerFeed({ now: new Date("2026-07-29T20:30:00+03:00") })
  );

  assert.ok(
    !feed.items.some((item) => item.kind === "live"),
    "skoru olmayan maç bantta canlı olarak listelenmemeli"
  );
}

/**
 * GÜNÜN BÜLTENİ AYNI KAYNAKLARDAN BESLENİR.
 *
 * Sayfa yalnızca bağlantı listesiydi: adı "bülten" ama içinde o güne ait
 * hiçbir veri yoktu. Üç bölüm de bantla aynı servislerden gelmeli, aksi
 * hâlde bülten ile bant farklı şeyler söylerdi.
 */
function testDailyBulletinIsDataDriven() {
  const file = path.join(root, "gunun-radar-bulteni.html");
  if (!fs.existsSync(file)) return;
  const html = fs.readFileSync(file, "utf8");

  for (const slot of ["bulletin-matches", "bulletin-transfers", "bulletin-statements"]) {
    assert.ok(html.includes(`data-api-target="${slot}"`), `bültende ${slot} yuvası yok`);
    assert.ok(
      html.includes(`<!-- prerender:${slot}:start -->`),
      `${slot} yuvası derleme sırasında doldurulmamış`
    );
  }

  // Doğrulanmış transfer varsa bültende de görünmeli.
  const { transfers } = publishableTransfers();
  if (transfers.length) {
    assert.ok(
      html.includes(transfers[0].playerName),
      `en yeni doğrulanmış transfer bültende görünmüyor: ${transfers[0].playerName}`
    );
  }

  // Açıklama yoksa bölüm gizlenmez, açıkça bekliyor der.
  const { statements } = publishableStatements();
  if (!statements.length) {
    assert.ok(
      /Doğrulanmış açıklama bekleniyor/.test(html),
      "açıklama yokken bülten bekleme cümlesi yazmalı"
    );
  } else {
    assert.ok(html.includes(statements[0].speaker), "doğrulanmış açıklama bültende görünmeli");
  }
}

testOnlyVerifiedSources();
testNotCrowded();
testNoSingleCategoryDominates();
testFreshBadgeIsATimeClaim();
testScheduledFixtureDoesNotClaimBreakingNews();
testLiveBadgeIsALiveClaim();
testTodayFixturesCarryKickoffTime();
testStatementsEnterOnlyWhenVerified();
testItemsAreClickableLinks();
testStaleEditorialNewsIsDropped();
testAwaitingStateIsExplicit();
testFallbackKeepsLastVerified();
testFallbackWritesInternalTimestamp();
testUnchangedFeedDoesNotRewriteState();
testFallbackDoesNotRewriteWhileOutageContinues();
testBigClubsRankFirstWithinCategory();
testEveryItemCarriesWeight();
testTickerHidesLiveMatchWithoutScore();
testDailyBulletinIsDataDriven();

console.log(
  "Ticker feed tests passed (doğrulanmış kaynak, kategori kotası, canlı/tazelik rozeti, " +
  "bugünün maçları, maç sonu açıklamaları, tıklanabilirlik, veri bekleniyor durumu, yedek koruma, " +
  "kulüp ağırlığı, skorsuz canlı maç yasağı, günün bülteni veri bağı)."
);
