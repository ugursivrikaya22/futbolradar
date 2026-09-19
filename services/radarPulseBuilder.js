/**
 * RADAR NABZI — MOMENTUM, SON 10 DAKİKA YORUMU VE BİRLEŞİK YÜK.
 * ----------------------------------------------------------------------------
 * `services/radarPulse.js` sayıyı üretir; bu dosya o sayının etrafındaki
 * anlatıyı üretir ve uç noktanın döndüreceği tek nesneyi kurar.
 *
 * YORUM ŞABLONDUR, MODEL DEĞİLDİR. İstenen açıktı: "LLM gerekiyorsa
 * kullanmak yerine mümkün olduğunca deterministic/template tabanlı sistem
 * oluştur." Bu yüzden burada ne bir dil modeli çağrısı ne de rastgelelik
 * var — cümle, ÖLÇÜLMÜŞ sayıların karşılaştırmasından seçilir. Aynı veri
 * her zaman aynı cümleyi üretir ve cümledeki her iddia altındaki tabloda
 * görünür.
 *
 * Veri yoksa cümle de yoktur: `null` döner ve yüzey o satırı hiç çizmez.
 */

"use strict";

const { resolveLiveWinProbability } = require("./winProbability");
const {
  attackPoints,
  clamp,
  countEvents,
  INTENSITY_REFERENCE_RATE,
  computePulse,
  normalizeEvents,
  readStats,
  toNumber,
  windowFromSamples,
  WINDOW_MINUTES,
  PULSE_VERSION
} = require("./radarPulse");

/**
 * Momentum segmentinin "sakin" ile "fırtına" arasındaki farkı göstermesi
 * için taban. 0.4 tabanı, tek taraflı ama düşük tempolu bir aralığın da
 * görünür kalmasını sağlar; kalan 0.6 tempoyla ölçeklenir.
 */
const MOMENTUM_INTENSITY_FLOOR = 0.4;

/**
 * MOMENTUM DİLİMİ — SABİT 5 DAKİKA.
 *
 * Dilimler önceden anlık görüntüler arasındaki farktan doğuyordu; genişlik
 * yoklama sıklığına bağlıydı ve okuyucu iki dilimi karşılaştıramıyordu
 * (biri 2, diğeri 7 dakikayı temsil edebiliyordu). Sabit dilimde her
 * çubuk AYNI süreyi anlatır, yani yükseklikler karşılaştırılabilir.
 *
 * 5 dakika seçildi çünkü 90 dakikayı 18 çubuğa bölüyor: telefon
 * genişliğinde okunabilen en ince kırılım. Daha dar dilim (1-2 dk) tek
 * bir kornerin bütün dilimi "tam baskı" göstermesine yol açardı.
 */
const MOMENTUM_BUCKET_MINUTES = 5;

/** Son 10 dakika yorumunun "belirgin" demesi için gereken üstünlük sayısı. */
const CLEAR_EDGE_METRICS = 3;

/**
 * MOMENTUM SERİSİ — dakika dakika baskı.
 *
 * Her segment iki ardışık anlık görüntü ARASINDAKİ farktan doğar; yani
 * gerçekten o aralıkta olan şeyi ölçer. Değer -100 (tamamen deplasman) ile
 * +100 (tamamen ev sahibi) arasındadır ve tempoyla ölçeklenir: iki tarafın
 * da birer şut attığı sakin bir aralık, tek taraflı bir kuşatmayla aynı
 * yükseklikte çizilmez.
 *
 * Anlık görüntü yoksa seri BOŞ döner. Gol ve kart işaretleri ise olay
 * akışından gelir ve maçın TAMAMINI kapsar — sunucu maçın ortasında
 * yeniden başlasa bile işaretler eksilmez.
 */
/**
 * Bir anlık görüntü çiftinin ürettiği hücum puanlarını döndürür.
 *
 * Sağlayıcı istatistiği KÜMÜLATİF: aradaki üretim ancak iki toplamın
 * farkıyla bulunur. Negatif fark (sağlayıcı düzeltmesi) sıfır sayılır —
 * "eksi korner" diye bir şey yok.
 */
function pairPoints(before, after, events) {
  const beforeStats = readStats(before.statistics);
  const afterStats = readStats(after.statistics);
  const delta = (key, side) => {
    const now = afterStats[key];
    const past = beforeStats[key];
    if (!now || !past || now[side] === null || past[side] === null) return 0;
    const difference = now[side] - past[side];
    return difference > 0 ? difference : 0;
  };

  const goals = countEvents(events, before.minute, after.minute).goals;
  const points = (side) => attackPoints({
    goals: goals[side],
    xg: delta("xg", side),
    onTarget: delta("onTarget", side),
    shots: delta("shots", side),
    corners: delta("corners", side)
  });

  return { home: points("home"), away: points("away") };
}

/**
 * Anlık görüntü çiftlerini SABİT 5 DAKİKALIK dilimlere dağıtır.
 *
 * Bir çift birden çok dilime taşabilir (yoklama seyrekse): üretim,
 * çiftin her dilimde geçirdiği süreyle ORANTILI bölünür. Bu bir tahmin
 * değil, ölçülmüş toplamın zamana eşit dağıtılmasıdır ve dilim sınırının
 * nereye düştüğünden bağımsız aynı toplamı verir.
 *
 * ÖLÇÜLMEYEN DİLİM HİÇ ÜRETİLMEZ. Anlık görüntüyle kapsanmayan dakikalar
 * için dilim yazılsaydı, okuyucu "o dakikalarda baskı yoktu" diye okurdu;
 * doğrusu "o dakikalar ölçülmedi". Yüzey kapsanmayan bölgeyi taralı
 * çiziyor (bkz. radar-pulse.js#momentumHtml).
 */
function bucketSegments(samples, events) {
  const buckets = new Map();
  const touch = (index) => {
    if (!buckets.has(index)) {
      buckets.set(index, {
        from: index * MOMENTUM_BUCKET_MINUTES,
        to: (index + 1) * MOMENTUM_BUCKET_MINUTES,
        home: 0,
        away: 0,
        measuredMinutes: 0
      });
    }
    return buckets.get(index);
  };

  for (let index = 1; index < samples.length; index += 1) {
    const before = samples[index - 1];
    const after = samples[index];
    const span = after.minute - before.minute;
    if (span <= 0) continue;

    const points = pairPoints(before, after, events);
    const firstBucket = Math.floor(before.minute / MOMENTUM_BUCKET_MINUTES);
    const lastBucket = Math.floor(Math.max(before.minute, after.minute - 1e-9) / MOMENTUM_BUCKET_MINUTES);

    for (let bucket = firstBucket; bucket <= lastBucket; bucket += 1) {
      const start = Math.max(before.minute, bucket * MOMENTUM_BUCKET_MINUTES);
      const finish = Math.min(after.minute, (bucket + 1) * MOMENTUM_BUCKET_MINUTES);
      const overlap = finish - start;
      if (overlap <= 0) continue;
      const ratio = overlap / span;
      const row = touch(bucket);
      row.home += points.home * ratio;
      row.away += points.away * ratio;
      row.measuredMinutes += overlap;
    }
  }

  return [...buckets.values()]
    .sort((left, right) => left.from - right.from)
    .map((row) => {
      const total = row.home + row.away;
      if (total <= 0) return { from: row.from, to: row.to, value: 0, quiet: true };
      const share = row.home / total;
      const minutes = row.measuredMinutes > 0 ? row.measuredMinutes : MOMENTUM_BUCKET_MINUTES;
      const intensity = clamp(total / minutes / INTENSITY_REFERENCE_RATE, 0, 1);
      const scale = MOMENTUM_INTENSITY_FLOOR + (1 - MOMENTUM_INTENSITY_FLOOR) * intensity;
      return {
        from: row.from,
        to: row.to,
        value: Math.round((share - 0.5) * 2 * 100 * scale),
        quiet: false
      };
    });
}

function buildMomentum(input) {
  const source = input || {};
  const events = Array.isArray(source.events) ? source.events : [];
  const samples = (Array.isArray(source.samples) ? source.samples : [])
    .filter((sample) => sample && Number.isFinite(sample.minute))
    .sort((left, right) => left.minute - right.minute);
  const minute = Number.isFinite(source.minute) ? source.minute : null;

  const segments = bucketSegments(samples, events);

  // İŞARETLER OLAY AKIŞINDAN — anlık görüntüden bağımsız, maçın tamamı.
  const markers = events
    .filter((event) => ["goal", "penalty", "own-goal", "red", "yellow-red", "missed-penalty", "var"].includes(event.kind))
    .map((event) => ({
      minute: event.minute,
      kind: event.kind === "own-goal" || event.kind === "penalty" ? "goal" : event.kind,
      rawKind: event.kind,
      side: event.scoringSide || event.side || "",
      player: event.player || "",
      team: event.team || ""
    }));

  return {
    // Dilim genişliği artık sabit; yüzey eksende bunu yazabilir.
    resolutionMinutes: segments.length ? MOMENTUM_BUCKET_MINUTES : null,
    segments,
    markers,
    coverage: segments.length
      ? { fromMinute: segments[0].from, toMinute: segments[segments.length - 1].to }
      : null,
    // Seri maçın başından beri kesintisiz mi? Sunucu maç ortasında ısınmışsa
    // değildir ve yüzey bunu söyler.
    complete: Boolean(segments.length && segments[0].from <= 1 && minute !== null && segments[segments.length - 1].to >= minute - 2)
  };
}

/** Bir ölçüde hangi taraf önde: "home" | "away" | "" (eşit/veri yok). */
function leaderOf(metric) {
  if (!metric) return "";
  const home = metric.home;
  const away = metric.away;
  if (home === null || home === undefined || away === null || away === undefined) return "";
  if (home === away) return "";
  return home > away ? "home" : "away";
}

const COMMENT_TEXT = Object.freeze({
  tr: {
    clear: "{team} son {minutes} dakikada belirgin şekilde baskıyı artırdı.",
    slight: "{team} son {minutes} dakikada daha etkili görünüyor.",
    balanced: "Son {minutes} dakikada iki takım da net bir üstünlük kuramadı.",
    goal: "{team} son {minutes} dakikada {goals} gol buldu.",
    goalBoth: "Son {minutes} dakikada iki takım da gol buldu.",
    quiet: "Son {minutes} dakikada kayda değer bir hücum üretimi ölçülmedi."
  },
  en: {
    clear: "{team} have clearly raised the pressure in the last {minutes} minutes.",
    slight: "{team} look sharper over the last {minutes} minutes.",
    balanced: "Neither side has taken control in the last {minutes} minutes.",
    goal: "{team} scored {goals} in the last {minutes} minutes.",
    goalBoth: "Both sides scored in the last {minutes} minutes.",
    quiet: "No meaningful attacking output was measured in the last {minutes} minutes."
  }
});

/**
 * SON 10 DAKİKA YORUMU — şablondan, ölçümden.
 *
 * Karar tamamen sayısaldır: kaç ölçüde hangi taraf önde. Üç ya da daha çok
 * ölçüde önde olan taraf "belirgin", iki ölçüde önde olan "daha etkili"
 * sayılır. Hiçbir ölçüde fark yoksa cümle dengeyi söyler. Hiç ölçü yoksa
 * cümle YOKTUR (null) — çünkü söylenecek ölçülmüş bir şey de yoktur.
 */
function buildWindowComment(input) {
  const source = input || {};
  const window = source.window;
  if (!window || !window.metrics) return null;
  const locale = source.locale === "en" ? "en" : "tr";
  const text = COMMENT_TEXT[locale];
  const names = source.names || {};
  const minutes = window.spanMinutes;
  const goals = source.windowGoals || { home: 0, away: 0 };

  const metrics = window.metrics;
  const ranked = ["onTarget", "xg", "shots", "corners"]
    .map((key) => leaderOf(metrics[key]))
    .filter(Boolean);

  const homeLead = ranked.filter((side) => side === "home").length;
  const awayLead = ranked.filter((side) => side === "away").length;

  const fill = (template, values) => Object.keys(values).reduce(
    (out, key) => out.split(`{${key}}`).join(String(values[key])),
    template
  );

  // Gol, üstünlüğün en güçlü kanıtı: varsa cümle onunla başlar.
  if (goals.home > 0 && goals.away > 0) {
    return fill(text.goalBoth, { minutes });
  }
  if (goals.home > 0 || goals.away > 0) {
    const side = goals.home > 0 ? "home" : "away";
    const count = goals[side];
    return fill(text.goal, {
      team: names[side] || (side === "home" ? "Ev sahibi" : "Deplasman"),
      minutes,
      goals: locale === "en" ? (count === 1 ? "once" : `${count} times`) : count
    });
  }

  if (!ranked.length) {
    // Ölçü var ama iki tarafta da hareket yok: bu da bir bilgi.
    const measured = ["onTarget", "xg", "shots", "corners"].some((key) => metrics[key]);
    return measured ? fill(text.quiet, { minutes }) : null;
  }

  if (homeLead === awayLead) return fill(text.balanced, { minutes });

  const side = homeLead > awayLead ? "home" : "away";
  const lead = Math.max(homeLead, awayLead);
  const template = lead >= CLEAR_EDGE_METRICS ? text.clear : text.slight;
  return fill(template, {
    team: names[side] || (side === "home" ? "Ev sahibi" : "Deplasman"),
    minutes
  });
}

/** Oyuncu kartında gösterilecek ölçüler — hepsi sağlayıcıdan gelir. */
const PLAYER_STAT_KEYS = ["goals", "assists", "shots", "keyPasses"];

/**
 * MAÇIN ÖNE ÇIKAN OYUNCULARI — SAĞLAYICININ DERECESİYLE.
 *
 * KENDİ DERECEMİZİ ÜRETMİYORUZ. İstek açıktı: "Veri sağlayıcı oyuncu rating
 * sağlamıyorsa kendi keyfi rating sistemimizi şimdilik oluşturma." Bu yüzden
 * sıralama YALNIZCA `providerRating` taşıyan oyuncular arasında yapılır;
 * derecesi olmayan oyuncu listeye hiç girmez ve gol/şut sayısından bir
 * derece TÜRETİLMEZ.
 *
 * Derece kaynağıyla birlikte taşınır (`ratingSource`) — ekranda kimin
 * ölçtüğü söylenebilsin diye.
 */
function buildTopPlayers(players, options) {
  const limit = (options && Number.isFinite(options.limit)) ? options.limit : 5;
  const rows = (Array.isArray(players) ? players : [])
    .filter((player) => player && player.name && Number.isFinite(Number(player.providerRating)))
    .map((player) => {
      const row = {
        name: player.name,
        team: player.team || "",
        rating: Number(player.providerRating),
        ratingSource: player.ratingSource || null
      };
      // Ölçülmeyen alan HİÇ oluşturulmaz; "0 asist" ile "asist verisi yok"
      // farklı şeylerdir ve çizim katmanı bu farkı okuyor.
      for (const key of PLAYER_STAT_KEYS) {
        const value = Number(player[key]);
        if (Number.isFinite(value) && value > 0) row[key] = value;
      }
      return row;
    })
    .sort((left, right) => right.rating - left.rating || left.name.localeCompare(right.name, "tr"))
    .slice(0, Math.max(0, limit));

  return rows;
}

/**
 * UÇ NOKTANIN DÖNDÜRDÜĞÜ TEK NESNE.
 *
 * Sağlayıcı detayını + sunucunun tuttuğu anlık görüntüleri alır, nabzı,
 * pencereyi, momentumu ve yorumu üretir. Hiçbir alan uydurulmaz: hesaplanamayan
 * her alan `null` döner ve istemci o parçayı çizmez.
 */
function buildRadarPulse(input) {
  const source = input || {};
  const detail = source.detail || {};
  const homeName = detail.homeTeam || source.homeTeam || "";
  const awayName = detail.awayTeam || source.awayTeam || "";
  const events = normalizeEvents(detail.events, homeName, awayName);
  // Aynı `Number(null) === 0` tuzağı: devre arasında dakika `null` gelir ve
  // ham dönüşüm onu 0 yapar. 0. dakika, pencere ve olay sayımının tamamını
  // kaydırırdı. `toNumber` boş değeri null olarak taşır.
  const minute = toNumber(detail.minute);
  const samples = Array.isArray(source.samples) ? source.samples : [];

  const window = windowFromSamples(samples, {
    windowMinutes: source.windowMinutes || WINDOW_MINUTES
  });

  const windowGoals = window && minute !== null
    ? countEvents(events, minute - window.spanMinutes, minute).goals
    : null;

  const pulse = computePulse({
    statistics: detail.statistics,
    window,
    events,
    minute,
    score: detail.score
  });

  const momentum = buildMomentum({ events, samples, minute });

  const comment = window
    ? buildWindowComment({
      window,
      windowGoals: windowGoals || { home: 0, away: 0 },
      names: { home: homeName, away: awayName },
      locale: source.locale
    })
    : null;

  return {
    version: PULSE_VERSION,
    minute,
    pulse,
    window: window
      ? {
        fromMinute: window.fromMinute,
        toMinute: window.toMinute,
        spanMinutes: window.spanMinutes,
        requestedMinutes: window.requestedMinutes,
        exact: window.exact,
        metrics: window.metrics,
        goals: windowGoals || { home: 0, away: 0 },
        comment
      }
      : null,
    momentum,
    timeline: events,
    // Derecesi olmayan maçta boş dizi döner ve yüzey bölümü hiç çizmez.
    topPlayers: buildTopPlayers(detail.players),
    // CANLI KAZANMA OLASILIĞI — BUGÜN HER ZAMAN null.
    //
    // Takılı gerçek bir kaynak yok (bkz. services/winProbability.js: maç
    // öncesi model canlı okuma sayılmıyor). Alan yine de taşınıyor ki
    // istemci "kaynak yok" ile "özellik hiç yok"u ayırt edebilsin ve
    // gerçek bir besleme takıldığında çizim katmanı hiç değişmesin.
    winProbability: resolveLiveWinProbability({
      minute,
      score: detail.score,
      status: detail.status || detail.providerStatus,
      homeTeam: homeName,
      awayTeam: awayName,
      fixtureId: detail.fixtureId || detail.providerId || detail.id
    }),
    sampleCount: samples.length
  };
}

module.exports = {
  CLEAR_EDGE_METRICS,
  PLAYER_STAT_KEYS,
  buildTopPlayers,
  MOMENTUM_BUCKET_MINUTES,
  MOMENTUM_INTENSITY_FLOOR,
  buildMomentum,
  buildRadarPulse,
  buildWindowComment,
  leaderOf
};
