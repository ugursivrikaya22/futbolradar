/**
 * MOMENTUM ÖLÇÜMLERİNİN KALICI ARŞİVİ.
 * ----------------------------------------------------------------------------
 * NEDEN VAR. `services/livePulseStore.js` anlık görüntüleri SÜREÇ İÇİNDE
 * tutuyor ve bu bilinçli bir sınırdı: "son 10 dakika" paneli pencere
 * kaybolduğunda yalnızca gizleniyordu, ürün bozulmuyordu.
 *
 * MOMENTUM GRAFİĞİ O SINIRA SIĞMIYOR. "Son 10 dakika" tek bir pencere;
 * momentum ise maçın BAŞINDAN o ana kadarki bütün dilimlerdir. Sunucusuz
 * ortamda her yeni işlev örneği depoyu sıfırdan başlatıyor, yani grafik
 * pratikte hep birkaç dilimden ibaret kalıyor ve okuyucu 90 dakikalık bir
 * maçın 10 dakikasını görüyordu. Dilimlerin maç boyunca birikmesi için
 * ölçümlerin örnek ömründen UZUN yaşaması gerekiyor.
 *
 * ── YAZMA MALİYETİ SINIRLI ───────────────────────────────────────────────
 * Kalıcı depoya geçmemenin asıl gerekçesi "her yoklamada yazma"ydı ve o
 * gerekçe hâlâ geçerli. Bu yüzden yazma, yoklama sayısına değil MAÇIN
 * DAKİKASINA bağlı: satır `(fixture_id, minute)` üzerinde tekil ve yalnızca
 * deponun YENİ bir görüntü eklediği anda yazılıyor (bkz.
 * livePulseStore#recordSampleWithOutcome). Aynı dakikayı yüz okuyucu
 * yoklasa da yazma sayısı değişmiyor: 90 dakikalık maçta üst sınır ~90
 * satır, okuyucu sayısından bağımsız.
 *
 * ── OKUMA BİR KEZ ────────────────────────────────────────────────────────
 * Arşiv, işlev örneği o maçı ilk kez gördüğünde okunuyor ve süreç içi
 * depoya besleniyor; sonraki yoklamalar bellekten sürüyor.
 *
 * ── HATA SAYFAYI BOZMAZ ──────────────────────────────────────────────────
 * Arşiv YARDIMCI bir katman. Supabase yapılandırılmamışsa ya da istek
 * patlarsa buradaki hiçbir işlev dışarı hata sızdırmaz; momentum grafiği
 * eskisi gibi yalnızca süreç içi ölçümlerle (yani daha kısa) çizilir.
 * Sessizlik burada doğru davranış: okuyucunun maç sayfası, bir teşhis
 * katmanı yüzünden düşmemeli.
 */

"use strict";

const TABLE = "live_pulse_samples";

/** Bir maç için geri okunan en fazla satır — deponun kendi sınırıyla aynı. */
const MAX_ROWS_PER_FIXTURE = 48;

/**
 * Supabase katmanı yalnızca gerektiğinde yüklenir.
 *
 * `services/supabase/client.js` tarayıcıda görülürse KASITLI olarak
 * patlıyor. Bu dosya sunucuda çalışıyor ama üstteki `require` zinciri
 * derleme araçlarınca izlenebildiği için bağımlılık tembel tutuluyor:
 * yapılandırma yoksa istemci modülü hiç açılmıyor.
 */
let cachedClient = null;
let cachedEnv = null;

function layer() {
  if (!cachedEnv) cachedEnv = require("./supabase/env");
  if (!cachedEnv.isConfigured()) return null;
  if (!cachedClient) cachedClient = require("./supabase/client");
  return cachedClient;
}

function isConfigured() {
  try {
    return Boolean(layer());
  } catch (error) {
    return false;
  }
}

function fixtureKey(fixtureId) {
  return String(fixtureId == null ? "" : fixtureId).trim();
}

/**
 * Dakikayı sayıya çevirir — `Number(null) === 0` TUZAĞINA DÜŞMEDEN.
 *
 * Ham `Number()` devre arasında sağlayıcının döndürdüğü `null` dakikayı
 * 0. DAKİKA diye okur ve maçın başına sahte bir ölçüm yazardı; momentum
 * grafiğinin ilk dilimi o sahte ölçümden doğardı.
 * `services/livePulseStore.js#recordSampleWithOutcome` aynı korumayı
 * taşıyor; arşivin de taşıması gerekiyor, çünkü yazma yolu oradan geçse
 * de okuma yolu doğrudan veritabanından geliyor.
 */
function minuteOf(value) {
  if (value === null || value === undefined || value === "") return NaN;
  const minute = Number(value);
  return Number.isFinite(minute) ? minute : NaN;
}

/**
 * Arşiv satırını deponun anladığı biçime çevirir.
 *
 * `statistics` ve `score` jsonb sütunlarda duruyor; okunan şey bizim
 * yazdığımız biçim olduğu için dönüşüm yok, yalnızca tür doğrulaması var.
 * Bozuk satır düşürülür — yarım bir görüntü farkı bozardı.
 */
function toSample(row) {
  if (!row) return null;
  const minute = minuteOf(row.minute);
  if (!Number.isFinite(minute) || minute < 0) return null;
  const statistics = Array.isArray(row.statistics) ? row.statistics : null;
  if (!statistics || !statistics.length) return null;
  return {
    minute,
    at: row.captured_at || null,
    statistics,
    score: row.score && typeof row.score === "object" ? row.score : null
  };
}

/**
 * Bir maçın arşivlenmiş ölçümleri, dakikaya göre artan.
 *
 * Hata durumunda BOŞ dizi döner: çağıran "arşiv yok" ile "arşiv patladı"
 * arasında farklı davranmıyor, ikisinde de yalnızca süreç içi ölçümlerle
 * devam ediyor.
 */
async function loadSamples(fixtureId) {
  const key = fixtureKey(fixtureId);
  if (!key) return [];
  const client = (() => {
    try {
      return layer();
    } catch (error) {
      return null;
    }
  })();
  if (!client) return [];

  try {
    const rows = await client.select(TABLE, {
      columns: "minute,captured_at,statistics,score",
      filters: { fixture_id: `eq.${key}` },
      order: "minute.asc",
      limit: MAX_ROWS_PER_FIXTURE
    });
    return rows.map(toSample).filter(Boolean);
  } catch (error) {
    return [];
  }
}

/**
 * Tek bir ölçümü arşive yazar.
 *
 * `(fixture_id, minute)` tekil olduğu için aynı dakikanın ikinci yazması
 * satırı günceller, yenisini açmaz. Dönüş değeri yalnızca teşhis içindir;
 * çağıran başarısızlıkta hiçbir şey yapmaz.
 */
async function saveSample(fixtureId, sample) {
  const key = fixtureKey(fixtureId);
  if (!key || !sample) return { written: 0, skipped: "missing-input" };
  const minute = minuteOf(sample.minute);
  const statistics = Array.isArray(sample.statistics) ? sample.statistics : [];
  if (!Number.isFinite(minute) || minute < 0 || !statistics.length) {
    return { written: 0, skipped: "incomplete-sample" };
  }

  const client = (() => {
    try {
      return layer();
    } catch (error) {
      return null;
    }
  })();
  if (!client) return { written: 0, skipped: "not-configured" };

  try {
    await client.upsert(TABLE, [{
      fixture_id: key,
      minute: Math.round(minute),
      captured_at: sample.at || new Date().toISOString(),
      statistics,
      score: sample.score || null
    }], "fixture_id,minute");
    return { written: 1 };
  } catch (error) {
    return { written: 0, skipped: "write-failed" };
  }
}

module.exports = {
  MAX_ROWS_PER_FIXTURE,
  TABLE,
  isConfigured,
  loadSamples,
  minuteOf,
  saveSample,
  toSample
};
