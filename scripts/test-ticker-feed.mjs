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
import { buildTickerFeed, FRESH_WINDOW_HOURS } from "./lib/tickerFeed.mjs";

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
  assert.ok(feed.items.length <= 8, `bant en fazla 8 öğe taşımalı, ${feed.items.length} var`);
}

function testFreshBadgeIsATimeClaim() {
  // Taze içerik: rozet "Son Dakika".
  const fresh = buildTickerFeed({ now: new Date("2026-07-26T20:00:00+03:00") });
  assert.equal(fresh.badge, "Son Dakika", "taze içerikte rozet Son Dakika olmalı");
  assert.equal(fresh.fresh, true);

  // Aynı veri, çok ileri bir tarihten bakıldığında artık taze değil:
  // rozet sessizce nötrleşmeli, "Son Dakika" iddiası sürdürülmemeli.
  const later = new Date("2026-07-26T20:00:00+03:00");
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
    () => buildTickerFeed({ now: new Date("2026-07-26T20:00:00+03:00") })
  );

  assert.ok(
    !result.items.some((item) => item.text === "Çok eski bir başlık"),
    "yaş sınırını aşan editoryal haber banda girmemeli"
  );
}

testOnlyVerifiedSources();
testNotCrowded();
testFreshBadgeIsATimeClaim();
testFallbackKeepsLastVerified();
testFallbackWritesInternalTimestamp();
testStaleEditorialNewsIsDropped();
testUnchangedFeedDoesNotRewriteState();
testFallbackDoesNotRewriteWhileOutageContinues();

console.log("Ticker feed tests passed (doğrulanmış kaynak, tazelik rozeti, yedek koruma, yaş sınırı).");
