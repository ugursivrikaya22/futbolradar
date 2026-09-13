/**
 * CANLI MAÇ ANLIK GÖRÜNTÜ DEPOSU — "son 10 dakika" verisinin kaynağı.
 * ----------------------------------------------------------------------------
 * NEDEN VAR. API-Football `/fixtures/statistics` KÜMÜLATİF döndürür: maçın
 * başından o ana kadarki toplam. "Son 10 dakikada 5 şut" diye bir alan
 * sağlayıcıda YOKTUR ve hiçbir tek istekle alınamaz. Tek dürüst yol, aynı
 * maçın iki farklı andaki toplamını saklayıp farkını almaktır.
 *
 * Bu depo o iki anı tutar. Sağlayıcıya FAZLADAN TEK BİR İSTEK bile
 * atmaz: yanıtı zaten alınmış olan maç detayından geçerken kopyalar.
 *
 * SÜREÇ İÇİ VE GEÇİCİ. Sunucusuz ortamda sıcak örnek boyunca yaşar, yeni
 * örnekte sıfırlanır. Bu bir eksiklik değil, bilinçli sınır: kalıcı depo
 * (Supabase/Redis) her yoklamada yazma maliyeti getirirdi ve pencere
 * kaybolduğunda ürün bozulmuyor — yalnızca "Son 10 Dakika" paneli, veri
 * yeniden birikene kadar GİZLENİYOR. Yanlış veri göstermektense panelin
 * bir süre görünmemesi tercih edildi.
 *
 * Kalıcı depoya geçilmek istenirse değiştirilecek tek yer burasıdır:
 * `recordSample`/`getSamples` sözleşmesi aynı kaldığı sürece hesaplama
 * katmanı hiç bilmez.
 */

"use strict";

/** Bir maç için saklanan en fazla anlık görüntü. 90+ dakika / 3 dk ≈ 40. */
const MAX_SAMPLES_PER_FIXTURE = 48;

/** Aynı anda izlenen en fazla maç. Bellek sınırı. */
const MAX_FIXTURES = 60;

/** Bir maç kaydının dokunulmadan yaşayabileceği süre (uzatma + devre arası). */
const FIXTURE_TTL_MS = 4 * 60 * 60 * 1000;

/**
 * İki anlık görüntü arasındaki en küçük dakika farkı. Sağlayıcı dakikayı
 * ilerletmeden gelen yanıt YENİ BİR ÖLÇÜM DEĞİLDİR; kaydetmek pencereyi
 * aynı dakikanın kopyalarıyla doldurur ve farkı sıfırlardı.
 */
const MIN_MINUTE_STEP = 1;

/** Depoya yazılan istatistikler — hesabın okuduğu ölçüler. */
const KEPT_STAT_TYPES = new Set([
  "topla oynama", "ball possession", "possession",
  "toplam sut", "total shots",
  "isabetli sut", "shots on goal", "shots on target",
  "isabetsiz sut", "shots off goal", "shots off target",
  "engellenen sut", "blocked shots",
  "korner", "corner kicks", "corners",
  "gol beklentisi (xg)", "expected_goals", "expected goals",
  "kurtaris", "goalkeeper saves", "saves",
  "ceza sahasi icinden sut", "shots insidebox"
]);

function foldKey(value) {
  return String(value == null ? "" : value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .replace(/[\s_-]+/g, " ")
    .trim()
    .toLowerCase();
}

const store = new Map();

function pruneExpired(now) {
  for (const [key, entry] of store) {
    if (now - entry.touchedAt > FIXTURE_TTL_MS) store.delete(key);
  }
  while (store.size > MAX_FIXTURES) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
  }
}

/** Yalnızca hesabın kullandığı satırları taşır; bellek küçük kalsın. */
function compactStatistics(statistics) {
  return (Array.isArray(statistics) ? statistics : [])
    .filter((row) => row && row.type && KEPT_STAT_TYPES.has(foldKey(row.type)))
    .map((row) => ({ type: row.type, home: row.home, away: row.away }));
}

/**
 * Anlık görüntüyü kaydeder ve maçın tüm görüntülerini döndürür.
 *
 * Kaydetmeme koşulları (hepsi sessiz, hata değil):
 *   • fixtureId yok — hangi maç olduğu bilinmiyor.
 *   • dakika yok — devre arası/başlamamış; zaman ekseni kurulamaz.
 *   • istatistik yok — farkı alınacak bir şey yok.
 *   • dakika ilerlememiş — yeni ölçüm değil (ama skor/istatistik
 *     TAZELENİR: son görüntü her zaman en güncel toplamı taşımalı).
 */
function recordSample(fixtureId, sample) {
  const key = String(fixtureId == null ? "" : fixtureId).trim();
  if (!key) return [];

  const now = (sample && Number.isFinite(sample.now)) ? sample.now : Date.now();
  pruneExpired(now);

  let entry = store.get(key);
  if (!entry) {
    entry = { samples: [], touchedAt: now };
    store.set(key, entry);
  } else {
    // Sıcak anahtarı sona taşı — yaklaşık LRU.
    store.delete(key);
    store.set(key, entry);
  }
  entry.touchedAt = now;

  // `Number(null) === 0` OLDUĞU İÇİN ham Number() yetmez. Devre arasında
  // sağlayıcı dakikayı `null` döndürüyor; ham dönüşüm onu 0. DAKİKA diye
  // kaydeder ve pencere, maçın başlangıcını taban alan sahte bir aralığa
  // dönüşürdü — "son 10 dakika" diye maçın tamamını göstermek tam olarak
  // kaçınılan hata.
  const rawMinute = sample && sample.minute;
  const minute = rawMinute === null || rawMinute === undefined || rawMinute === ""
    ? NaN
    : Number(rawMinute);
  const statistics = compactStatistics(sample && sample.statistics);
  if (!Number.isFinite(minute) || minute < 0 || !statistics.length) {
    return entry.samples.slice();
  }

  const record = {
    minute,
    at: (sample && sample.at) || new Date(now).toISOString(),
    statistics,
    score: (sample && sample.score) ? { home: sample.score.home, away: sample.score.away } : null
  };

  const last = entry.samples[entry.samples.length - 1];
  if (last && minute - last.minute < MIN_MINUTE_STEP) {
    // Aynı dakikanın yeni yanıtı: en güncel toplamı taşıması için ÜZERİNE
    // yazılır, ikinci bir görüntü olarak eklenmez.
    entry.samples[entry.samples.length - 1] = record;
    return entry.samples.slice();
  }

  // Sağlayıcı dakikayı geri aldıysa (düzeltme) eski görüntüler geçersizdir.
  if (last && minute < last.minute) {
    entry.samples = [record];
    return entry.samples.slice();
  }

  entry.samples.push(record);
  if (entry.samples.length > MAX_SAMPLES_PER_FIXTURE) {
    entry.samples.splice(0, entry.samples.length - MAX_SAMPLES_PER_FIXTURE);
  }
  return entry.samples.slice();
}

function getSamples(fixtureId) {
  const key = String(fixtureId == null ? "" : fixtureId).trim();
  const entry = key ? store.get(key) : null;
  return entry ? entry.samples.slice() : [];
}

function forget(fixtureId) {
  store.delete(String(fixtureId == null ? "" : fixtureId).trim());
}

function reset() {
  store.clear();
}

function stats() {
  return {
    fixtures: store.size,
    samples: Array.from(store.values()).reduce((sum, entry) => sum + entry.samples.length, 0)
  };
}

module.exports = {
  FIXTURE_TTL_MS,
  MAX_FIXTURES,
  MAX_SAMPLES_PER_FIXTURE,
  MIN_MINUTE_STEP,
  compactStatistics,
  forget,
  getSamples,
  recordSample,
  reset,
  stats
};
