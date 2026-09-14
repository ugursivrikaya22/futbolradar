/**
 * CANLI KAZANMA OLASILIĞI — KASITLI OLARAK BOŞ BİR SOKET.
 * ----------------------------------------------------------------------------
 * BU DOSYA BUGÜN HİÇBİR SAYI ÜRETMİYOR. Ve bu bir eksiklik değil, istenen
 * davranışın kendisi:
 *
 *   "Ancak mevcut veri altyapımız gerçekçi bir model kurmaya yetmiyorsa BU
 *    ÖZELLİĞİ ŞİMDİ EKLEME. Sahte veya rastgele yüzde üretmek kesinlikle
 *    yasak. Kod altyapısını daha sonra gerçek model/API bağlanabilecek
 *    şekilde hazırla."
 *
 * NEDEN KAYNAK YOK — ARAŞTIRMANIN SONUCU
 * Depoda olasılık üretebilen iki şey var ve İKİSİ DE MAÇ ÖNCESİ:
 *
 *   1. `services/matchPredictionService.js` (futbolradar-match-v1) — form,
 *      ilk 11, kadro ve mekân gücünden üretiliyor. Dakika, skor ve kırmızı
 *      kart GİRDİ DEĞİL. Üstelik `freezePreMatchPrediction` ile ilk vuruşta
 *      bilerek donduruluyor: maç sırasında kayması İSTENMEMİŞ.
 *   2. API-Football `/predictions` — o da maç öncesi; sağlayıcının kendi
 *      maç öncesi modeli.
 *
 * Maç içi olasılık için ne bir besleme ne de geriye dönük test edilmiş bir
 * model var. 80. dakikada 3-0 olan bir maçta maç öncesi yüzdeyi "canlı"
 * diye göstermek, yanlış veri göstermenin en kötü biçimi olurdu — çünkü
 * sayı gerçek, iddia yalan olurdu.
 *
 * SOKET NASIL ÇALIŞIR
 * Gerçek bir kaynak bulunduğunda tek yapılacak şey `registerSource` ile onu
 * takmak; çizim katmanı hiç değişmez. Kaynak yoksa `resolveLiveWinProbability`
 * `null` döner ve yüzey bölümü hiç çizmez.
 *
 * KAYNAK DA DENETLENİR. Takılan bir kaynağın döndürdüğü her şey körü körüne
 * yayımlanmaz: üç değer de sayı olmalı, her biri 0-100 aralığında olmalı,
 * toplamı 100'e yakın olmalı, kimin ürettiği ve NE ZAMAN ürettiği yazılı
 * olmalı. Bozuk yanıt DÜZELTİLMEZ, reddedilir — sessizce onarılan bir
 * olasılık, uydurulmuş olasılıktan ayırt edilemez.
 */

"use strict";

/** Toplamın 100'den sapabileceği en fazla puan. Üstü bozuk yanıttır. */
const SUM_TOLERANCE = 1.5;

/**
 * Bir okumanın "canlı" sayılabileceği en uzun süre. Bunun ötesindeki bir
 * yüzde maçın şu anki durumunu değil, geçmişteki bir anı anlatır.
 */
const MAX_AGE_MS = 3 * 60 * 1000;

/** Takılı kaynaklar. BUGÜN BOŞ — bkz. dosya başındaki gerekçe. */
const sources = new Map();

/**
 * Gerçek bir kaynağı sisteme takar.
 *
 * @param {string} name      kaynağın adı (ekranda gösterilir)
 * @param {Function} resolve (input) => okuma | null
 */
function registerSource(name, resolve) {
  const key = String(name || "").trim();
  if (!key) throw new Error("win-probability-source-needs-a-name");
  if (typeof resolve !== "function") throw new Error("win-probability-source-needs-a-resolver");
  sources.set(key, resolve);
  return key;
}

function unregisterSource(name) {
  return sources.delete(String(name || "").trim());
}

function clearSources() {
  sources.clear();
}

function listSources() {
  return [...sources.keys()];
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Bir kaynağın okumasını denetler ve normalleştirir.
 *
 * Reddetme sebebiyle birlikte döner: sessiz bir `null`, takılan kaynağın
 * neden görünmediğini araştırmayı imkânsız kılardı.
 *
 * @returns {{ok: true, value: object} | {ok: false, reason: string}}
 */
function normalizeReading(raw, options) {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "no-reading" };

  const home = toNumber(raw.home);
  const draw = toNumber(raw.draw);
  const away = toNumber(raw.away);
  if (home === null || draw === null || away === null) {
    return { ok: false, reason: "incomplete" };
  }
  if ([home, draw, away].some((value) => value < 0 || value > 100)) {
    return { ok: false, reason: "out-of-range" };
  }

  const sum = home + draw + away;
  if (Math.abs(sum - 100) > SUM_TOLERANCE) {
    // Toplamı tutmayan bir üçlü, olasılık değildir. Ölçeklendirip
    // "düzeltmek" bozuk veriyi sağlam gibi göstermek olurdu.
    return { ok: false, reason: "sum-mismatch" };
  }

  const source = String(raw.source || "").trim();
  if (!source) return { ok: false, reason: "no-source" };

  const asOf = raw.asOf ? Date.parse(raw.asOf) : NaN;
  if (!Number.isFinite(asOf)) return { ok: false, reason: "no-timestamp" };

  const now = (options && Number.isFinite(options.now)) ? options.now : Date.now();
  const maxAge = (options && Number.isFinite(options.maxAgeMs)) ? options.maxAgeMs : MAX_AGE_MS;
  if (now - asOf > maxAge) return { ok: false, reason: "stale" };

  // MAÇ ÖNCESİ MODEL CANLI OKUMA OLARAK KABUL EDİLMEZ.
  // `futbolradar-match-v1` ilk vuruşta donduruluyor; onu canlı diye
  // yayımlamak bu dosyanın var oluş sebebine aykırı.
  if (raw.preMatch === true) return { ok: false, reason: "pre-match-source" };

  // Yuvarlama sonrası toplam tam 100 olsun: ekranda "%34 %33 %34 = %101"
  // görünmesin. Sapma en büyük paya yazılır.
  const rounded = [Math.round(home), Math.round(draw), Math.round(away)];
  const drift = 100 - rounded.reduce((total, value) => total + value, 0);
  if (drift !== 0) {
    let largest = 0;
    for (let index = 1; index < rounded.length; index += 1) {
      if (rounded[index] > rounded[largest]) largest = index;
    }
    rounded[largest] += drift;
  }

  return {
    ok: true,
    value: {
      home: rounded[0],
      draw: rounded[1],
      away: rounded[2],
      source,
      asOf: new Date(asOf).toISOString()
    }
  };
}

/**
 * Canlı kazanma olasılığını çözer.
 *
 * Takılı kaynak yoksa — BUGÜNKÜ DURUM — `null` döner ve hiçbir şey
 * çizilmez. Birden fazla kaynak varsa ilk GEÇERLİ okuma kazanır; sıra
 * takılma sırasıdır.
 */
function resolveLiveWinProbability(input, options) {
  if (!sources.size) return null;

  for (const [name, resolve] of sources) {
    let raw = null;
    try {
      raw = resolve(input);
    } catch (error) {
      // Bir kaynağın patlaması diğerlerini ve maç detayını etkilemez.
      continue;
    }
    const normalized = normalizeReading(raw, options);
    if (normalized.ok) return { ...normalized.value, sourceKey: name };
  }

  return null;
}

/** Teşhis: hangi kaynaklar takılı, özellik neden kapalı? */
function describeState() {
  return {
    sources: listSources(),
    active: sources.size > 0,
    note: sources.size
      ? "Canlı olasılık takılı kaynaktan geliyor."
      : "Canlı olasılık kaynağı yok; bölüm çizilmiyor (maç öncesi model canlı sayılmaz)."
  };
}

module.exports = {
  MAX_AGE_MS,
  SUM_TOLERANCE,
  clearSources,
  describeState,
  listSources,
  normalizeReading,
  registerSource,
  resolveLiveWinProbability,
  unregisterSource
};
