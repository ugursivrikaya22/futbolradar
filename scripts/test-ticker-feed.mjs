/**
 * SON DAKİKA BANDI TESTLERİ
 *
 * Bandın sözleşmesi:
 *   1. Yalnızca doğrulanmış kaynaklardan beslenir (maç sonucu, onaylı
 *      transfer, doğrulanmış editoryal haber). Elle yazılmış/uydurma başlık
 *      girmez.
 *   2. "Son Dakika" rozeti bir zaman iddiasıdır: yalnızca gerçekten taze bir
 *      öğe varsa yazılır, yoksa nötr "Gündem" olur.
 *   3. Kaynak geçici olarak boşalırsa bant boşalmaz; son doğrulanmış öğeler
 *      korunur ve durum iç zaman damgasıyla kaydedilir.
 *   4. Bant kalabalıklaşmaz.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { buildTickerFeed, FRESH_WINDOW_HOURS } from "./lib/tickerFeed.mjs";

const require = createRequire(import.meta.url);

const root = process.cwd();
const STATE_FILE = path.join(root, "data", "ticker-state.json");

function withTempData(mutate, run) {
  // Bant DÖRT kaynaktan besleniyor. Küratörlü dosya (news-ticker.json)
  // listeye alınmazsa "tüm kaynaklar boş" senaryosu gerçekten boş olmuyor:
  // küratörlü öğeler bandı doldurmaya devam ediyor ve yedek yoluna hiç
  // girilmiyor. Kaynak eklendiğinde bu liste de büyümeli.
  const files = ["matches.json", "transfers.json", "news.json", "news-ticker.json"];
  const backups = new Map();

  for (const file of files) {
    const full = path.join(root, "data", file);
    backups.set(full, fs.existsSync(full) ? fs.readFileSync(full, "utf8") : null);
  }
  const stateBackup = fs.existsSync(STATE_FILE) ? fs.readFileSync(STATE_FILE, "utf8") : null;

  try {
    mutate(files.map((file) => path.join(root, "data", file)));
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

function testOnlyVerifiedSources() {
  const feed = buildTickerFeed();
  assert.ok(feed.items.length, "bant boş dönmemeli");

  for (const item of feed.items) {
    assert.ok(item.text && item.text.trim(), "bant öğesinin metni olmalı");
    assert.ok(item.href && item.href.trim(), "bant öğesinin bağlantısı olmalı");
    assert.ok(item.at, `"${item.text}" öğesinin zaman damgası yok`);
    assert.ok(!Number.isNaN(Date.parse(item.at)), `"${item.text}" geçersiz zaman damgası`);
  }
}

function testNotCrowded() {
  const feed = buildTickerFeed();
  assert.ok(feed.items.length <= 7, `bant en fazla 7 öğe taşımalı, ${feed.items.length} var`);
}

/**
 * AYNI HABER İKİ KEZ GÖRÜNMEZ.
 *
 * Dört kaynak aynı olaya farklı açılardan bakıyor: maç kaydı çıplak skor
 * satırı ("Inter Turku 2-0 Başakşehir"), haber kaydı ise o skorun ne anlama
 * geldiğini ("Başakşehir Avrupa'ya veda etti") yazıyor. Kelimesi kelimesine
 * karşılaştırma bu ikisini yabancı sayıyordu.
 */
function testNoDuplicateStories() {
  const feed = buildTickerFeed();

  const { tokenSet, sameStory } = require("../services/newsTicker.js");
  const tokens = feed.items.map((item) => tokenSet(item.text));

  for (let left = 0; left < tokens.length; left += 1) {
    for (let right = left + 1; right < tokens.length; right += 1) {
      assert.equal(
        sameStory(tokens[left], tokens[right]),
        false,
        `bant aynı haberi iki kez taşıyor:\n  "${feed.items[left].text}"\n  "${feed.items[right].text}"`
      );
    }
  }
}

/**
 * SIRA EDİTORYAL. Requirement'ın "önemli Türk futbolu haberleri önce" kuralı
 * bandın kendi dizilişinde de geçerli olmalı; kota hangi öğelerin gireceğini
 * belirler, SIRAYI belirlemez.
 */
function testSortedByImportance() {
  const feed = buildTickerFeed();

  for (let index = 1; index < feed.items.length; index += 1) {
    assert.ok(
      feed.items[index - 1].priority <= feed.items[index].priority,
      `bant önceliğe göre sıralı olmalı: ${feed.items[index - 1].priority} > ${feed.items[index].priority}`
    );
  }
}

/**
 * KÜRATÖRLÜ GÜNDEME YER AYRILIR.
 *
 * "Gündem" bandın asıl işi. Maç sonuçları bandı tek başına doldurduğunda
 * resmî açıklamalar, sakatlıklar ve maç programları hiç görünmüyordu.
 */
function testCuratedAgendaHasRoom() {
  const feed = buildTickerFeed();
  const curated = feed.items.filter((item) => item.source === "curated");

  assert.ok(
    curated.length >= 1,
    "küratörlü gündem bantta temsil edilmeli (data/news-ticker.json boşsa bu test veri eksikliğini gösterir)"
  );
}

function testFreshBadgeIsATimeClaim() {
  // Taze içerik: rozet "Son Dakika".
  const fresh = buildTickerFeed({ now: new Date("2026-08-01T14:20:00+03:00") });
  assert.equal(fresh.badge, "Son Dakika", "taze içerikte rozet Son Dakika olmalı");
  assert.equal(fresh.fresh, true);

  // Aynı veri, çok ileri bir tarihten bakıldığında artık taze değil:
  // rozet sessizce nötrleşmeli, "Son Dakika" iddiası sürdürülmemeli.
  const later = new Date("2026-08-01T14:20:00+03:00");
  later.setHours(later.getHours() + FRESH_WINDOW_HOURS + 6);
  const stale = buildTickerFeed({ now: later });
  assert.notEqual(stale.badge, "Son Dakika", "eski içerikte Son Dakika rozeti kalmamalı");
  assert.equal(stale.fresh, false);
}

function testFallbackKeepsLastVerified() {
  // Önce sağlıklı bir durum yazılır.
  const healthy = buildTickerFeed();
  assert.ok(healthy.items.length, "ön koşul: bant dolu olmalı");

  // Sonra tüm kaynaklar boşaltılır (geçici veri kesintisi).
  const result = withTempData(
    (files) => files.forEach((file) => fs.writeFileSync(file, "[]", "utf8")),
    () => buildTickerFeed()
  );

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
  const state = withTempData(
    (files) => files.forEach((file) => fs.writeFileSync(file, "[]", "utf8")),
    () => {
      buildTickerFeed();
      return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    }
  );

  assert.ok(state.fallbackSince, "yedek durumunda iç zaman damgası yazılmalı");
  assert.ok(!Number.isNaN(Date.parse(state.fallbackSince)), "zaman damgası geçerli olmalı");
  assert.equal(state.usedFallback, true, "durum dosyası yedek kullanımını kaydetmeli");
  assert.ok(state.fallbackReason, "yedek gerekçesi kaydedilmeli");
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
  const [first, second] = withTempData(
    (files) => files.forEach((file) => fs.writeFileSync(file, "[]", "utf8")),
    () => {
      buildTickerFeed();
      const a = fs.readFileSync(STATE_FILE, "utf8");
      buildTickerFeed();
      return [a, fs.readFileSync(STATE_FILE, "utf8")];
    }
  );

  assert.equal(second, first, "kesinti sürerken durum dosyası her turda yeniden yazılmamalı");
}

/**
 * YEDEK LİSTE "ESKİ AMA DOĞRU" TAŞIR, "TARİHİ GEÇMİŞ" TAŞIMAZ.
 *
 * Yedeğin varlık sebebi kesinti anında gerçek bir başlık gösterebilmek.
 * Tarihi geçmiş bir maç duyurusu ise eski değil, YANLIŞ: "5 Ağustos'ta
 * oynanacak" satırı 20 Ağustos'ta okuyucuyu yanıltır.
 */
function testFallbackDropsExpiredAnnouncements() {
  const result = withTempData(
    (files) => {
      files.forEach((file) => fs.writeFileSync(file, "[]", "utf8"));
      fs.writeFileSync(STATE_FILE, JSON.stringify({
        items: [
          {
            label: "Maç programı",
            text: "Tarihi geçmiş duyuru",
            href: "https://example.com/gecmis",
            at: "2026-08-01T10:00:00+03:00",
            expiresAt: "2026-08-05T23:59:59+03:00"
          },
          {
            label: "Resmî açıklama",
            text: "Süresiz geçerli açıklama",
            href: "https://example.com/gecerli",
            at: "2026-08-01T10:00:00+03:00"
          }
        ],
        generatedAt: "2026-08-01T07:00:00.000Z",
        fresh: true,
        usedFallback: false
      }, null, 2), "utf8");
    },
    () => buildTickerFeed({ now: new Date("2026-08-20T12:00:00+03:00") })
  );

  assert.equal(result.usedFallback, true, "kaynak boşken yedek devreye girmeli");
  assert.deepEqual(
    result.items.map((item) => item.text),
    ["Süresiz geçerli açıklama"],
    "yedekte tarihi geçmiş duyuru gösterilmemeli"
  );
}

/**
 * Ve yedekte gösterilecek doğru başlık kalmadıysa bant BOŞ kalır: yanlış bir
 * başlık, boş bant'tan kötüdür.
 */
function testFallbackPrefersEmptyOverWrong() {
  const result = withTempData(
    (files) => {
      files.forEach((file) => fs.writeFileSync(file, "[]", "utf8"));
      fs.writeFileSync(STATE_FILE, JSON.stringify({
        items: [{
          label: "Maç programı",
          text: "Tarihi geçmiş duyuru",
          href: "https://example.com/gecmis",
          at: "2026-08-01T10:00:00+03:00",
          expiresAt: "2026-08-05T23:59:59+03:00"
        }],
        generatedAt: "2026-08-01T07:00:00.000Z",
        fresh: true,
        usedFallback: false
      }, null, 2), "utf8");
    },
    () => buildTickerFeed({ now: new Date("2026-08-20T12:00:00+03:00") })
  );

  assert.equal(result.items.length, 0, "yalnızca tarihi geçmiş öğe varsa bant boş kalmalı");
}

/**
 * Kesinleşmemiş öğenin ÇEKİNCESİ yedekte de korunmalı. Rozet düşerse
 * kesinti anında bir basın aktarımı doğrulanmış haber gibi görünür.
 */
function testFallbackKeepsConfidenceBadges() {
  const healthy = buildTickerFeed();
  const unconfirmed = healthy.items.filter((item) => item.confidenceBadge);

  if (!unconfirmed.length) return; // Bugünkü veride kesinleşmemiş öğe yoksa sınanacak bir şey yok.

  const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  for (const item of unconfirmed) {
    const stored = state.items.find((row) => row.text === item.text);
    assert.ok(stored, `"${item.text}" durum dosyasına yazılmalı`);
    assert.equal(stored.confidenceBadge, item.confidenceBadge, "çekince rozeti yedekte korunmalı");
    assert.ok(stored.sourceName, "kaynak adı yedekte korunmalı");
    assert.ok(stored.at, "zaman damgası yedekte korunmalı");
  }
}

function testStaleEditorialNewsIsDropped() {
  // Yayım tarihi çok eski bir haber banda girmemeli: içerik gerçek olsa bile
  // "Son Dakika" bandında haftalar öncesinin başlığı yanıltıcıdır.
  const result = withTempData(
    (files) => {
      const [matches, transfers, news] = files;
      fs.writeFileSync(matches, "[]", "utf8");
      fs.writeFileSync(transfers, "[]", "utf8");
      fs.writeFileSync(news, JSON.stringify([{
        id: "eski",
        title: "Çok eski bir başlık",
        status: "verified",
        url: "https://example.com/eski",
        publishedAt: "2026-01-01T10:00:00+03:00"
      }]), "utf8");
      if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    },
    () => buildTickerFeed({ now: new Date("2026-08-01T14:20:00+03:00") })
  );

  assert.ok(
    !result.items.some((item) => item.text === "Çok eski bir başlık"),
    "yaş sınırını aşan editoryal haber banda girmemeli"
  );
}

testOnlyVerifiedSources();
testNotCrowded();
testNoDuplicateStories();
testSortedByImportance();
testCuratedAgendaHasRoom();
testFreshBadgeIsATimeClaim();
testFallbackKeepsLastVerified();
testFallbackDropsExpiredAnnouncements();
testFallbackPrefersEmptyOverWrong();
testFallbackKeepsConfidenceBadges();
testFallbackWritesInternalTimestamp();
testStaleEditorialNewsIsDropped();
testUnchangedFeedDoesNotRewriteState();
testFallbackDoesNotRewriteWhileOutageContinues();

console.log("Ticker feed tests passed (doğrulanmış kaynak, tekleştirme, editoryal sıra, gündem kotası, tazelik rozeti, yedek koruma, yedekte tarih ve çekince denetimi, yaş sınırı).");
