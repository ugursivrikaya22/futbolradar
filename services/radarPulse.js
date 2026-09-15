/**
 * RADAR NABZI — "MAÇIN ANLIK BASKI DENGESİ".
 * ----------------------------------------------------------------------------
 * Bu modül SAF hesaplama yapar: ağ çağrısı yok, saat okuması yok (zaman
 * çağıranın verdiği), rastgelelik yok. Aynı girdi her zaman aynı çıktıyı
 * verir — bir skorun neden 76 çıktığı geriye doğru izlenebilsin diye.
 *
 * EN KRİTİK KURAL: SAĞLAYICI ÖLÇMEDİYSE ÜRETME.
 * Bir istatistik gelmiyorsa o FAKTÖR HESABA HİÇ GİRMEZ; sıfır sayılmaz,
 * tahmin edilmez, ortalamayla doldurulmaz. "0 korner" ile "korner verisi
 * yok" farklı şeylerdir ve bu fark çıktıya kadar taşınır. Yeterli faktör
 * yoksa nabız `null` döner ve yüzey bölümü gizler.
 *
 * RADAR NABZI BİR KAZANMA TAHMİNİ DEĞİLDİR. Ölçtüğü tek şey, maçın SON
 * bölümünde hangi takımın daha çok hücum üretimi yaptığıdır. Bu yüzden
 * başlık "Maçın Anlık Baskı Dengesi"dir ve çıktı hiçbir yerde olasılık,
 * oran ya da tahmin olarak etiketlenmez.
 *
 * NEDEN İKİ AYRI SAYI (76 ve 41, toplamı 100 değil):
 * Nabız bir PAY DEĞİL, ŞİDDET ölçüsüdür. İki tarafın da bastığı açık bir
 * maçta iki sayı da yüksek, iki tarafın da beklediği bir maçta iki sayı da
 * düşük olur. Yalnızca payı gösterseydik (70-30 gibi) sakin bir maçtaki
 * küçük bir üstünlük, fırtına gibi bir maçtaki aynı üstünlükle aynı
 * görünürdü — oysa okuyucunun ekranda aradığı fark tam olarak budur.
 */

"use strict";

/** Çıktı sürümü: hesap değişirse artar; kayıtlı örnekler ayırt edilebilsin. */
const PULSE_VERSION = 3;

/** "Son 10 dakika" penceresinin uzunluğu. */
const WINDOW_MINUTES = 10;

/**
 * Pencere en az bu kadar dakikayı kapsamalı. Daha kısa bir aralığın farkı
 * gürültüdür: iki yoklama arasında geçen 40 saniyelik fark "son 10 dakika"
 * diye sunulamaz.
 */
const MIN_WINDOW_MINUTES = 4;

/** Nabzın yayımlanması için gereken en az faktör sayısı. */
const MIN_FACTORS = 2;

/** Yüksek güven için gereken faktör sayısı VE gerçek bir zaman penceresi. */
const HIGH_CONFIDENCE_FACTORS = 5;

/** Olay taramasının üst sınırı: 90 + uzatmalar + penaltılar. */
const MAX_MATCH_MINUTE = 200;

/**
 * FAKTÖR AĞIRLIKLARI.
 *
 * Şart açıktı: "Son 5–10 dakikalık veriler genel maç istatistiklerinden daha
 * yüksek ağırlığa sahip olsun." Bu yüzden aynı ölçü iki kez listelenir ve
 * pencere sürümü maç geneli sürümünün yaklaşık üç katı ağırlık taşır.
 *
 * TEHLİKELİ ATAK BU LİSTEDE YOK. İstenmişti ama API-Football
 * `/fixtures/statistics` bu ölçüyü döndürmüyor; olmayan veriyi tahmin
 * etmektense faktörü hiç koymamak doğru olan.
 */
const WEIGHTS = Object.freeze({
  windowGoals: 3.5,
  windowXg: 3.0,
  windowOnTarget: 3.0,
  windowShots: 2.0,
  windowCorners: 1.2,
  windowPossessionShift: 1.0,
  matchXg: 1.0,
  matchOnTarget: 1.0,
  matchShots: 0.7,
  matchPossession: 0.5,
  matchCorners: 0.4,
  redCardEdge: 1.5,
  scoreline: 0.8
});

/**
 * ŞİDDET REFERANSI — dakikada üretilen "hücum puanı".
 *
 * 1.8 puan/dakika, on dakikada 5 şut + 3 isabet + 0.7 xG + 3 korner üreten
 * bir takıma denk gelir; yani gerçekten kuşatma altındaki bir kaleye. Bu
 * seviye 100'e karşılık gelir, üstü kırpılır.
 */
const INTENSITY_REFERENCE_RATE = 1.8;

/** Şiddet puanı katsayıları. Gol en ağır, çünkü baskının kanıtlanmış hâli. */
const INTENSITY_POINTS = Object.freeze({
  goal: 4,
  xg: 6,
  onTarget: 2,
  shot: 1,
  corner: 1
});

/** Nabzın payı ile şiddeti arasındaki denge. Toplamı 1 olmak zorunda. */
const SHARE_WEIGHT = 0.6;
const INTENSITY_WEIGHT = 0.4;

/** Kanonik istatistik adları (services/matchStatisticsSchema.js) + İngilizce eşleri. */
const STAT_ALIASES = Object.freeze({
  possession: ["Topla oynama", "Ball Possession", "Possession"],
  shots: ["Toplam şut", "Total Shots"],
  onTarget: ["İsabetli şut", "Shots on Goal", "Shots on Target"],
  corners: ["Korner", "Corner Kicks", "Corners"],
  xg: ["Gol beklentisi (xG)", "expected_goals", "Expected Goals"],
  saves: ["Kurtarış", "Goalkeeper Saves", "Saves"],
  offTarget: ["İsabetsiz şut", "Shots off Goal", "Shots off Target"],
  blocked: ["Engellenen şut", "Blocked Shots"],
  insideBox: ["Ceza sahası içinden şut", "Shots insidebox"]
});

/** Aksan ve büyük/küçük harf farkını eleyen anahtar. */
function foldKey(value) {
  return String(value == null ? "" : value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .replace(/[\s_-]+/g, " ")
    .trim()
    .toLowerCase();
}

/** "58%" → 58, "1,54" → 1.54, null/"" → null. Uydurma sıfır yok. */
function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace("%", "").replace(",", ".").trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * İstatistik satırlarını `{ shots: {home, away}, ... }` biçimine çevirir.
 * Sağlayıcının vermediği ölçü anahtarı HİÇ oluşturmaz.
 */
function readStats(statistics) {
  const rows = Array.isArray(statistics) ? statistics : [];
  const index = new Map();
  for (const row of rows) {
    if (!row || !row.type) continue;
    index.set(foldKey(row.type), row);
  }

  const out = {};
  for (const [key, aliases] of Object.entries(STAT_ALIASES)) {
    let row = null;
    for (const alias of aliases) {
      const found = index.get(foldKey(alias));
      if (found) { row = found; break; }
    }
    if (!row) continue;
    const home = toNumber(row.home);
    const away = toNumber(row.away);
    if (home === null && away === null) continue;
    out[key] = { home, away };
  }
  return out;
}

/** Dakika metnini sayıya çevirir: "73'" → 73, "45+2'" → 45 (uzatma ayrı). */
function eventMinute(value) {
  const found = String(value == null ? "" : value).match(/(\d+)(?:\s*\+\s*(\d+))?/);
  if (!found) return null;
  const base = Number(found[1]);
  if (!Number.isFinite(base)) return null;
  return base + (Number(found[2]) || 0);
}

function eventTeamName(event) {
  if (!event) return "";
  if (typeof event.team === "string") return event.team;
  return (event.team && event.team.name) || "";
}

/** Takım adını ev/deplasman tarafına eşler; kısmi ad farklarını tolere eder. */
function sideOf(teamName, homeName, awayName) {
  const key = foldKey(teamName);
  if (!key) return "";
  const home = foldKey(homeName);
  const away = foldKey(awayName);
  if (!home && !away) return "";
  if (key === home) return "home";
  if (key === away) return "away";
  if (home && (home.indexOf(key) === 0 || key.indexOf(home) === 0)) return "home";
  if (away && (away.indexOf(key) === 0 || key.indexOf(away) === 0)) return "away";
  return "";
}

const GOAL_TYPES = new Set(["goal", "gol"]);

/** Olayı sınıflandırır: gol / kırmızı / sarı / değişiklik / VAR / diğer. */
function classifyEvent(event) {
  const type = foldKey(event && event.type);
  const detail = foldKey(event && event.detail);
  if (GOAL_TYPES.has(type)) {
    if (detail.indexOf("missed") !== -1) return "missed-penalty";
    if (detail.indexOf("own") !== -1) return "own-goal";
    if (detail.indexOf("penalty") !== -1) return "penalty";
    return "goal";
  }
  if (type === "var") return "var";
  if (type === "card" || type.indexOf("kart") !== -1) {
    if (detail.indexOf("second yellow") !== -1) return "yellow-red";
    if (detail.indexOf("red") !== -1 || detail.indexOf("kirmizi") !== -1) return "red";
    return "yellow";
  }
  if (type.indexOf("subst") !== -1 || type.indexOf("degisik") !== -1) return "sub";
  return "other";
}

/** Skora yazılan olaylar: kendi kalesine gol RAKİBİN hanesine yazılır. */
function scoringSideOf(event, homeName, awayName) {
  const kind = classifyEvent(event);
  if (kind !== "goal" && kind !== "penalty" && kind !== "own-goal") return "";
  const side = sideOf(eventTeamName(event), homeName, awayName);
  if (!side) return "";
  if (kind === "own-goal") return side === "home" ? "away" : "home";
  return side;
}

/**
 * Olay akışını normalleştirir. Dakikası okunamayan olay DIŞARIDA kalır —
 * zaman çizelgesine "bilinmeyen dakika" satırı koymak, olmayan bir bilgiyi
 * varmış gibi göstermenin başka bir biçimi olurdu.
 */
function normalizeEvents(events, homeName, awayName) {
  return (Array.isArray(events) ? events : [])
    .map((event) => {
      if (!event) return null;
      const minute = eventMinute(event.time);
      if (minute === null) return null;
      const kind = classifyEvent(event);
      const parts = String(event.value || "")
        .split(" · ")
        .map((part) => part.trim())
        .filter(Boolean);
      const assistPart = parts.filter((part) => /^(asist|assist)\s*:/i.test(part))[0] || "";
      const detailKey = foldKey(event.detail);
      const player = parts.length && !/^(asist|assist)\s*:/i.test(parts[0]) && foldKey(parts[0]) !== detailKey
        ? parts[0]
        : "";
      return {
        minute,
        time: String(event.time || "").replace(/'+$/, ""),
        kind,
        side: sideOf(eventTeamName(event), homeName, awayName),
        scoringSide: scoringSideOf(event, homeName, awayName),
        team: eventTeamName(event),
        player,
        assist: assistPart.replace(/^(asist|assist)\s*:\s*/i, ""),
        detail: String(event.detail || "")
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.minute - right.minute);
}

/** Belirli bir dakika aralığındaki olayları sayar. */
function countEvents(events, fromMinute, toMinute) {
  const tally = {
    goals: { home: 0, away: 0 },
    reds: { home: 0, away: 0 },
    yellows: { home: 0, away: 0 },
    bigChances: { home: 0, away: 0 }
  };
  for (const event of Array.isArray(events) ? events : []) {
    if (event.minute <= fromMinute || event.minute > toMinute) continue;
    if (event.scoringSide) tally.goals[event.scoringSide] += 1;
    if ((event.kind === "red" || event.kind === "yellow-red") && event.side) tally.reds[event.side] += 1;
    if (event.kind === "yellow" && event.side) tally.yellows[event.side] += 1;
    // Kaçan penaltı ölçülmüş bir büyük pozisyondur; xG olmayan maçta bile
    // gerçek veridir.
    if (event.kind === "missed-penalty" && event.side) tally.bigChances[event.side] += 1;
  }
  return tally;
}

/**
 * PENCERE FARKI — "son 10 dakika" burada doğar.
 *
 * Sağlayıcı KÜMÜLATİF istatistik döndürür (maçın başından beri toplam).
 * "Son 10 dakika" verisi sağlayıcıda YOKTUR; yalnızca iki zaman noktasının
 * farkından türetilebilir. Bu yüzden sunucu düzenli anlık görüntü tutar ve
 * bu fonksiyon en yeni görüntü ile pencereye en uygun eski görüntüyü
 * çıkarır.
 *
 * Uygun eski görüntü yoksa `null` döner — ve panel gizlenir. Maç geneli
 * istatistiğini "son 10 dakika" diye sunmak, istenen tek şeyin (yanlış
 * canlı veri göstermemek) tam karşıtı olurdu.
 */
function windowFromSamples(samples, options) {
  const list = (Array.isArray(samples) ? samples : [])
    .filter((sample) => sample && Number.isFinite(sample.minute))
    .sort((left, right) => left.minute - right.minute);
  if (list.length < 2) return null;

  const windowMinutes = (options && Number.isFinite(options.windowMinutes))
    ? options.windowMinutes
    : WINDOW_MINUTES;
  const minSpan = (options && Number.isFinite(options.minWindowMinutes))
    ? options.minWindowMinutes
    : MIN_WINDOW_MINUTES;

  const latest = list[list.length - 1];
  const target = latest.minute - windowMinutes;

  // Hedefe eşit ya da ondan eski görüntülerin EN YENİSİ; yoksa en eski
  // görüntü (pencere kısalır ama yine de gerçek bir aralıktır).
  let baseline = null;
  for (const sample of list) {
    if (sample === latest) break;
    if (sample.minute <= target) baseline = sample;
  }
  if (!baseline) baseline = list[0];
  if (baseline === latest) return null;

  const spanMinutes = latest.minute - baseline.minute;
  if (spanMinutes < minSpan) return null;

  const latestStats = readStats(latest.statistics);
  const baseStats = readStats(baseline.statistics);

  const metrics = {};
  // Kümülatif sayaçlar farkla okunur.
  for (const key of ["shots", "onTarget", "corners", "xg", "offTarget", "blocked", "insideBox", "saves"]) {
    const now = latestStats[key];
    const before = baseStats[key];
    if (!now || !before) continue;
    const home = now.home === null || before.home === null ? null : now.home - before.home;
    const away = now.away === null || before.away === null ? null : now.away - before.away;
    if (home === null && away === null) continue;
    // Sağlayıcı düzeltmesi sayacı geri alabilir; negatif fark ölçüm değil,
    // düzeltmedir ve pencereye yazılmaz.
    if ((home !== null && home < 0) || (away !== null && away < 0)) continue;
    metrics[key] = {
      home: home === null ? null : Number(home.toFixed(key === "xg" ? 2 : 0)),
      away: away === null ? null : Number(away.toFixed(key === "xg" ? 2 : 0))
    };
  }

  // Topla oynama YÜZDEDİR, kümülatif sayaç değil: farkı "kayma" olarak taşınır.
  if (latestStats.possession && baseStats.possession) {
    const now = latestStats.possession;
    const before = baseStats.possession;
    if (now.home !== null && before.home !== null) {
      metrics.possessionShift = {
        home: Number((now.home - before.home).toFixed(1)),
        away: now.away !== null && before.away !== null ? Number((now.away - before.away).toFixed(1)) : null
      };
      metrics.possession = { home: now.home, away: now.away };
    }
  }

  return {
    fromMinute: baseline.minute,
    toMinute: latest.minute,
    spanMinutes,
    requestedMinutes: windowMinutes,
    exact: spanMinutes >= windowMinutes - 1,
    metrics,
    sampleCount: list.length
  };
}

/** İki değerden pay üretir. Toplam 0 ise bilgi yoktur → null. */
function shareOf(home, away) {
  if (home === null || home === undefined || away === null || away === undefined) return null;
  const total = home + away;
  if (!Number.isFinite(total) || total <= 0) return null;
  return clamp(home / total, 0, 1);
}

/** Hücum puanı — şiddet ölçüsünün ham girdisi. */
function attackPoints(values) {
  const goals = Number(values.goals) || 0;
  const xg = Number(values.xg) || 0;
  const onTarget = Number(values.onTarget) || 0;
  const shots = Number(values.shots) || 0;
  const corners = Number(values.corners) || 0;
  return (
    goals * INTENSITY_POINTS.goal +
    xg * INTENSITY_POINTS.xg +
    onTarget * INTENSITY_POINTS.onTarget +
    shots * INTENSITY_POINTS.shot +
    corners * INTENSITY_POINTS.corner
  );
}

/**
 * RADAR NABZI.
 *
 * @returns {null|{home:number, away:number, confidence:string, factors:Array,
 *                 windowMinutes:number|null, version:number}}
 *   Yeterli ÖLÇÜLMÜŞ faktör yoksa null.
 */
function computePulse(input) {
  const source = input || {};
  const stats = readStats(source.statistics);
  const window = source.window || null;
  const windowMetrics = (window && window.metrics) || {};
  // OLAYLAR NORMALLEŞTİRİLMİŞ GELMELİ — ama gelmediğinde SESSİZCE
  // YOK SAYILMAMALI. Ham sağlayıcı olayında `kind`/`side` yoktur ve
  // `countEvents` onları hiç göremez: kırmızı kart ve gol faktörleri
  // sessizce düşerdi. Sessiz kayıp, yanlış sayı kadar kötü — o yüzden
  // burada biçim denetleniyor ve gerekiyorsa normalleştirme yapılıyor.
  const rawEvents = Array.isArray(source.events) ? source.events : [];
  const normalized = rawEvents.every((event) => event && typeof event.kind === "string" && Number.isFinite(event.minute));
  const events = normalized
    ? rawEvents
    : normalizeEvents(rawEvents, source.homeTeam, source.awayTeam);
  const minute = Number.isFinite(source.minute) ? source.minute : null;

  const factors = [];
  const addFactor = (key, weight, home, away) => {
    const share = shareOf(home, away);
    if (share === null) return;
    factors.push({ key, weight, share, home, away });
  };

  // 1) PENCERE FAKTÖRLERİ — en ağır olanlar.
  const windowSpan = window ? window.spanMinutes : null;
  const windowGoals = windowSpan && minute !== null
    ? countEvents(events, minute - windowSpan, minute).goals
    : null;
  if (windowGoals) addFactor("windowGoals", WEIGHTS.windowGoals, windowGoals.home, windowGoals.away);
  if (windowMetrics.xg) addFactor("windowXg", WEIGHTS.windowXg, windowMetrics.xg.home, windowMetrics.xg.away);
  if (windowMetrics.onTarget) addFactor("windowOnTarget", WEIGHTS.windowOnTarget, windowMetrics.onTarget.home, windowMetrics.onTarget.away);
  if (windowMetrics.shots) addFactor("windowShots", WEIGHTS.windowShots, windowMetrics.shots.home, windowMetrics.shots.away);
  if (windowMetrics.corners) addFactor("windowCorners", WEIGHTS.windowCorners, windowMetrics.corners.home, windowMetrics.corners.away);
  if (windowMetrics.possessionShift && windowMetrics.possessionShift.home !== null) {
    // Kayma yüzde PUANIDIR: +10 puanlık artış tam üstünlük sayılmaz, 0.5'ten
    // 1'e doğru yumuşak bir kayma üretir.
    const shift = clamp(0.5 + windowMetrics.possessionShift.home / 20, 0, 1);
    factors.push({
      key: "windowPossessionShift",
      weight: WEIGHTS.windowPossessionShift,
      share: shift,
      home: windowMetrics.possessionShift.home,
      away: windowMetrics.possessionShift.away
    });
  }

  // 2) MAÇ GENELİ FAKTÖRLERİ — pencere yoksa tek dayanak, varsa destek.
  if (stats.xg) addFactor("matchXg", WEIGHTS.matchXg, stats.xg.home, stats.xg.away);
  if (stats.onTarget) addFactor("matchOnTarget", WEIGHTS.matchOnTarget, stats.onTarget.home, stats.onTarget.away);
  if (stats.shots) addFactor("matchShots", WEIGHTS.matchShots, stats.shots.home, stats.shots.away);
  if (stats.possession) addFactor("matchPossession", WEIGHTS.matchPossession, stats.possession.home, stats.possession.away);
  if (stats.corners) addFactor("matchCorners", WEIGHTS.matchCorners, stats.corners.home, stats.corners.away);

  // 3) BAĞLAM — kırmızı kart ve skor.
  // Maçın TAMAMINDAKİ kırmızılar: uzatma dakikaları da dahil olsun diye
  // üst sınır dakikadan bağımsız geniş tutulur.
  const allReds = countEvents(events, -1, MAX_MATCH_MINUTE).reds;
  if (allReds.home !== allReds.away) {
    // Rakibi eksik kalan taraf lehine; "kart gören" değil "fazla oyuncusu olan"
    // baskı kurabilir.
    factors.push({
      key: "redCardEdge",
      weight: WEIGHTS.redCardEdge,
      share: allReds.home > allReds.away ? 0 : 1,
      home: allReds.home,
      away: allReds.away
    });
  }

  const score = source.score || {};
  const homeScore = toNumber(score.home);
  const awayScore = toNumber(score.away);
  if (homeScore !== null && awayScore !== null && homeScore !== awayScore) {
    // Skor küçük ağırlıklı: önde olmak baskı kurmak değildir, ama maçın
    // mevcut durumunun bir parçasıdır ve istenen faktörler arasındaydı.
    factors.push({
      key: "scoreline",
      weight: WEIGHTS.scoreline,
      share: homeScore > awayScore ? 1 : 0,
      home: homeScore,
      away: awayScore
    });
  }

  if (factors.length < MIN_FACTORS) return null;

  const totalWeight = factors.reduce((sum, factor) => sum + factor.weight, 0);
  if (totalWeight <= 0) return null;
  const homeShare = factors.reduce((sum, factor) => sum + factor.weight * factor.share, 0) / totalWeight;

  // ŞİDDET: pencere varsa pencereden, yoksa maç genelinden dakikaya bölünerek.
  let intensityHome = null;
  let intensityAway = null;
  if (window && windowSpan > 0) {
    const goals = windowGoals || { home: 0, away: 0 };
    const points = (side) => attackPoints({
      goals: goals[side],
      xg: windowMetrics.xg ? windowMetrics.xg[side] : 0,
      onTarget: windowMetrics.onTarget ? windowMetrics.onTarget[side] : 0,
      shots: windowMetrics.shots ? windowMetrics.shots[side] : 0,
      corners: windowMetrics.corners ? windowMetrics.corners[side] : 0
    });
    intensityHome = clamp(points("home") / windowSpan / INTENSITY_REFERENCE_RATE, 0, 1);
    intensityAway = clamp(points("away") / windowSpan / INTENSITY_REFERENCE_RATE, 0, 1);
  } else if (minute !== null && minute > 0) {
    const played = Math.max(minute, 1);
    const allGoals = countEvents(events, -1, minute).goals;
    const points = (side) => attackPoints({
      goals: allGoals[side],
      xg: stats.xg ? stats.xg[side] : 0,
      onTarget: stats.onTarget ? stats.onTarget[side] : 0,
      shots: stats.shots ? stats.shots[side] : 0,
      corners: stats.corners ? stats.corners[side] : 0
    });
    intensityHome = clamp(points("home") / played / INTENSITY_REFERENCE_RATE, 0, 1);
    intensityAway = clamp(points("away") / played / INTENSITY_REFERENCE_RATE, 0, 1);
  }

  // Şiddet ölçülemiyorsa yalnızca pay taşınır; ağırlık payın tamamına geçer.
  const blend = (share, intensity) => intensity === null
    ? share * 100
    : (SHARE_WEIGHT * share + INTENSITY_WEIGHT * intensity) * 100;

  const home = Math.round(clamp(blend(homeShare, intensityHome), 0, 100));
  const away = Math.round(clamp(blend(1 - homeShare, intensityAway), 0, 100));

  const windowFactorCount = factors.filter((factor) => factor.key.indexOf("window") === 0).length;
  const confidence = factors.length >= HIGH_CONFIDENCE_FACTORS && windowFactorCount >= 2
    ? "high"
    : windowFactorCount >= 1 || factors.length >= HIGH_CONFIDENCE_FACTORS
      ? "medium"
      : "low";

  return {
    home,
    away,
    confidence,
    windowMinutes: windowSpan,
    factors: factors.map((factor) => ({ key: factor.key, weight: factor.weight, share: Number(factor.share.toFixed(3)) })),
    version: PULSE_VERSION
  };
}

module.exports = {
  MAX_MATCH_MINUTE,
  PULSE_VERSION,
  WINDOW_MINUTES,
  MIN_WINDOW_MINUTES,
  MIN_FACTORS,
  WEIGHTS,
  INTENSITY_REFERENCE_RATE,
  attackPoints,
  classifyEvent,
  clamp,
  computePulse,
  countEvents,
  eventMinute,
  foldKey,
  normalizeEvents,
  readStats,
  shareOf,
  sideOf,
  toNumber,
  windowFromSamples
};
