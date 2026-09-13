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
function buildMomentum(input) {
  const source = input || {};
  const events = Array.isArray(source.events) ? source.events : [];
  const samples = (Array.isArray(source.samples) ? source.samples : [])
    .filter((sample) => sample && Number.isFinite(sample.minute))
    .sort((left, right) => left.minute - right.minute);
  const minute = Number.isFinite(source.minute) ? source.minute : null;

  const segments = [];
  for (let index = 1; index < samples.length; index += 1) {
    const before = samples[index - 1];
    const after = samples[index];
    const span = after.minute - before.minute;
    if (span <= 0) continue;

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

    const home = points("home");
    const away = points("away");
    const total = home + away;
    if (total <= 0) {
      segments.push({ from: before.minute, to: after.minute, value: 0, quiet: true });
      continue;
    }
    const share = home / total;
    const intensity = clamp(total / span / INTENSITY_REFERENCE_RATE, 0, 1);
    const scale = MOMENTUM_INTENSITY_FLOOR + (1 - MOMENTUM_INTENSITY_FLOOR) * intensity;
    segments.push({
      from: before.minute,
      to: after.minute,
      value: Math.round((share - 0.5) * 2 * 100 * scale),
      quiet: false
    });
  }

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
    resolutionMinutes: segments.length
      ? Math.max(1, Math.round(segments.reduce((sum, segment) => sum + (segment.to - segment.from), 0) / segments.length))
      : null,
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
    sampleCount: samples.length
  };
}

module.exports = {
  CLEAR_EDGE_METRICS,
  MOMENTUM_INTENSITY_FLOOR,
  buildMomentum,
  buildRadarPulse,
  buildWindowComment,
  leaderOf
};
