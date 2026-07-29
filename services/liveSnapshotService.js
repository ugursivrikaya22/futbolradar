/**
 * CANLI ANLIK GÖRÜNTÜ DEPOSU — ölçülmüş momentumun tek veri kaynağı.
 *
 * Beş dakikalık canlı senkron döngüsü (sync-match-results) oynanan bir maçın
 * sağlayıcı detayını her çektiğinde, KÜMÜLATİF istatistiklerden beş dakikalık
 * kova başına EN FAZLA BİR anlık görüntü buraya yazılır. Maç sonrası momentum,
 * ardışık görüntülerin FARKLARINDAN hesaplanır; böylece "ölçülmüş canlı baskı"
 * etiketi yalnızca gerçekten ölçüm yapılmış maçlarda kullanılabilir.
 *
 * KURALLAR:
 *   - Dakika ve en az bir sayısal istatistik yoksa görüntü YAZILMAZ; boş veya
 *     uydurma kova üretilmez.
 *   - Aynı beş dakikalık kovaya ikinci yazım yapılmaz (idempotent döngü).
 *   - Depo yalnızca eklemeli: bitmiş maçın görüntüleri değiştirilmez.
 *
 * Dosya G/Ç bilinçli olarak BURADA DEĞİL: bu modül saf veri dönüşümüdür,
 * okuma/yazma çağıran betiğe aittir (test edilebilirlik).
 */

const { normalizeText } = require("./matchRadarService");

/** Kova genişliği (dakika). */
const BUCKET_MINUTES = 5;

/** Ölçülmüş momentum bölümlerinin okunduğu aralık etiketleri. */
function bucketOf(minute) {
  return Math.floor(minute / BUCKET_MINUTES) * BUCKET_MINUTES;
}

function statNumber(statistics, aliases, side) {
  const wanted = aliases.map((alias) => normalizeText(alias));
  const row = (Array.isArray(statistics) ? statistics : [])
    .find((item) => wanted.includes(normalizeText(item.type)));
  const value = row && row[side];
  const number = parseFloat(String(value == null ? "" : value).replace("%", "").replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

const TRACKED = Object.freeze({
  totalShots: ["Toplam şut", "Total Shots"],
  shotsOnTarget: ["İsabetli şut", "Shots on Goal", "Shots on Target"],
  shotsInsideBox: ["Ceza sahası içi şut", "Shots insidebox", "Shots Inside Box"],
  corners: ["Korner", "Corner Kicks"],
  possession: ["Topla oynama", "Ball Possession"],
  accuratePasses: ["İsabetli pas", "Passes accurate", "Accurate Passes"],
  saves: ["Kaleci kurtarışı", "Goalkeeper Saves"],
  cards: ["Sarı kart", "Yellow Cards"]
});

/**
 * Sağlayıcı detayından tek bir anlık görüntü çıkarır. Ölçü yoksa null:
 * eksik veri sıfıra çevrilmez.
 */
function snapshotFrom(detail, nowIso) {
  const minute = Number(detail && detail.minute);
  if (!Number.isFinite(minute) || minute <= 0) return null;

  const stats = {};
  let measured = 0;
  for (const [key, aliases] of Object.entries(TRACKED)) {
    const home = statNumber(detail.statistics, aliases, "home");
    const away = statNumber(detail.statistics, aliases, "away");
    if (home === null && away === null) continue;
    stats[key] = { home, away };
    measured += 1;
  }
  if (!measured) return null;

  const score = detail.score || {};
  return {
    minute,
    bucket: bucketOf(minute),
    at: nowIso,
    score: {
      home: Number.isFinite(Number(score.home)) ? Number(score.home) : null,
      away: Number.isFinite(Number(score.away)) ? Number(score.away) : null
    },
    stats
  };
}

/**
 * Depoya idempotent yazım: aynı kovaya ikinci görüntü eklenmez.
 * Dönüş: güncellenen girdi ya da (yazım olmadıysa) null.
 */
function recordSnapshot(store, match, detail, nowIso) {
  const snapshot = snapshotFrom(detail, nowIso);
  if (!snapshot) return null;

  const entry = store[match.id] || {
    matchId: match.id,
    providerId: match.providerId || null,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    buckets: []
  };
  if (entry.buckets.some((bucket) => bucket.bucket === snapshot.bucket)) return null;

  entry.buckets = [...entry.buckets, snapshot].sort((left, right) => left.minute - right.minute);
  entry.updatedAt = nowIso;
  store[match.id] = entry;
  return entry;
}

function snapshotEntryFor(store, match) {
  if (!store || !match) return null;
  return store[match.id] || null;
}

/**
 * Ardışık kümülatif görüntülerden aralık farkları. Her satır iki görüntü
 * arasındaki ÖLÇÜLMÜŞ değişimi taşır; okuma yapılamayan aralık atlanır.
 */
function measuredIntervals(entry) {
  const buckets = entry && Array.isArray(entry.buckets) ? entry.buckets : [];
  const rows = [];
  for (let i = 1; i < buckets.length; i += 1) {
    const prev = buckets[i - 1];
    const curr = buckets[i];
    const deltas = {};
    let measured = 0;
    for (const key of Object.keys(TRACKED)) {
      const prevStat = prev.stats[key];
      const currStat = curr.stats[key];
      if (!prevStat || !currStat) continue;
      const home = currStat.home !== null && prevStat.home !== null ? currStat.home - prevStat.home : null;
      const away = currStat.away !== null && prevStat.away !== null ? currStat.away - prevStat.away : null;
      if (home === null && away === null) continue;
      deltas[key] = { home, away };
      measured += 1;
    }
    if (!measured) continue;
    rows.push({
      from: prev.minute,
      to: curr.minute,
      label: `${prev.minute}'-${curr.minute}'`,
      deltas
    });
  }
  return rows;
}

/**
 * Aralık başına hangi takımın ölçülebilir baskısı fazlaydı? Basit ve
 * belgeli bir formül: şut/isabet/korner farklarının toplamı. Possession
 * kümülatif YÜZDE olduğu için farkı baskı sayımına katılmaz.
 */
function pressureReading(intervalRow) {
  const keys = ["totalShots", "shotsOnTarget", "shotsInsideBox", "corners"];
  let home = 0;
  let away = 0;
  let measured = 0;
  for (const key of keys) {
    const delta = intervalRow.deltas[key];
    if (!delta) continue;
    if (delta.home !== null) home += Math.max(0, delta.home);
    if (delta.away !== null) away += Math.max(0, delta.away);
    measured += 1;
  }
  if (!measured) return null;
  return { label: intervalRow.label, home, away };
}

module.exports = {
  BUCKET_MINUTES,
  TRACKED,
  snapshotFrom,
  recordSnapshot,
  snapshotEntryFor,
  measuredIntervals,
  pressureReading
};
