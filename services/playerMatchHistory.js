/**
 * OYUNCU–MAÇ GEÇMİŞİ (saf modül).
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────
 *
 * "Bu oyuncu geldiği ilk maçlarda nasıldı, son maçlarda nasıl?" sorusu bu
 * depoda CEVAPLANAMIYORDU ve sebebi veri eksikliği değil, veriyi kimsenin
 * BİRİKTİRMEMESİYDİ:
 *
 *   - `data/matches.json` yalnızca dar bir pencere taşıyor; bitmiş maç
 *     birkaç gün sonra havuzdan düşüyor ve içindeki oyuncu satırları da
 *     onunla birlikte kayboluyor.
 *   - `data/players.json` yalnızca SEZON TOPLAMI tutuyor. Toplam, "ilk beş
 *     maç" ile "son beş maç" arasındaki farkı tanımı gereği gizler.
 *   - `data/historical-match-archive.json` 1.383 maç taşıyor ama hiçbirinde
 *     oyuncu satırı yok (ölçüldü: 0).
 *
 * Bu modül o boşluğu kapatıyor: her bitmiş maçın oyuncu satırları kalıcı
 * bir zaman serisine yazılıyor. Pencere karşılaştırması (ilk N maç ↔ son N
 * maç) bu seriden hesaplanıyor.
 *
 * ── ÖRNEKLEM YETMİYORSA KARŞILAŞTIRMA YAPILMAZ ──────────────────────────
 *
 * `compareWindows` yetersiz örneklemde sayı döndürmez; `sufficient: false`
 * ve sebebini döndürür. Bu kasıtlı: iki maçlık bir "ilk dönem" ile üç
 * maçlık bir "son dönem" arasındaki farkı performans düşüşü diye yazmak,
 * ölçüm değil kurgu olurdu. Yazı katmanı bu bayrağa bakıp bölümü ya
 * gerçek sayılarla yazar ya da örneklemin yetmediğini açıkça söyler.
 */

const MEASURES = Object.freeze([
  "minutes", "goals", "assists", "shots", "shotsOnTarget",
  "keyPasses", "passes", "passAccuracy", "duelsWon", "tackles",
  "saves", "dribbles", "lostBalls", "rating"
]);

/** Maç başına ortalaması alınacak kalemler. Oran/reyting alanları hariç. */
const PER_MATCH = Object.freeze([
  "minutes", "goals", "assists", "shots", "shotsOnTarget",
  "keyPasses", "passes", "duelsWon", "tackles", "saves", "dribbles", "lostBalls"
]);

/** Zaten oran olan kalemler: ortalamaları alınır, toplamları anlamsızdır. */
const AVERAGED = Object.freeze(["passAccuracy", "rating"]);

function text(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

function num(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  if (typeof value === "boolean") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .toLowerCase()
    .trim();
}

/**
 * Oyuncunun kalıcı anahtarı.
 *
 * Sağlayıcı kimliği varsa O kullanılır: ad yazımı sağlayıcı sürümleri
 * arasında değişiyor ("A. Bakasetas" / "Anastasios Bakasetas") ve ada
 * dayanan bir anahtar aynı oyuncunun geçmişini ikiye bölerdi. Kimlik
 * yoksa ad + takım birlikte anahtar olur.
 */
function playerKey(row) {
  const providerId = text(row && row.providerPlayerId);
  if (providerId) return `p:${providerId}`;
  const name = normalize(row && row.name);
  const team = normalize(row && row.team);
  return name ? `n:${name}@${team}` : "";
}

function isFinished(match) {
  return ["FINISHED", "FT", "AET", "PEN"].includes(text(match && match.status).toUpperCase());
}


/**
 * OYUNCU PAS İSABETİ — BİRİM TAHMİN EDİLMEZ.
 *
 * Sağlayıcının oyuncu satırındaki `passAccuracy` alanı iki farklı anlamda
 * gelebiliyor ve alan adı ikisinde de aynı:
 *   - İSABETLİ PAS SAYISI (API-Football oyuncu dökümü; ölçüldü: Rafael
 *     Leão 13 pas / 11 isabet, kaleci 38 pas / 24 isabet),
 *   - hazır YÜZDE (sezon toplamı tutan `data/players.json` şekli).
 *
 * İlk sürüm birimi SAYIYA BAKARAK tahmin ediyordu: "isabet toplamı
 * aşamaz" kuralı. Kural yanlış ayırıyor — 90 pas atmış bir oyuncunun
 * hazır %82 değeri de bu testi geçer ve %91'e çevrilirdi. Yani tahmin,
 * düzeltmeye çalıştığı hatanın aynısını başka bir yerde üretiyordu.
 *
 * Artık birim KÖKENDEN okunuyor:
 *   - `source` api-football ise değer sayıdır, oran toplamdan türetilir;
 *   - toplam pas hiç yoksa ve değer 0–100 aralığındaysa zaten yüzdedir;
 *   - ikisi de tutmuyorsa ORAN ÜRETİLMEZ (null). Bilinmeyen birimden
 *     yüzde uydurmaktansa o cümleyi hiç kurmamak doğru.
 */
const COUNT_SEMANTICS_SOURCES = new Set(["api-football", "apifootball"]);

function passRateFrom(accurate, total, options = {}) {
  if (accurate === null || accurate === undefined) return null;
  const source = normalize(options.source);

  if (COUNT_SEMANTICS_SOURCES.has(source)) {
    if (total === null || total === undefined || !(total > 0)) return null;
    if (accurate > total) return null;
    return Math.round((accurate / total) * 100);
  }

  // Kökeni bilinmiyor: yalnızca toplam pas hiç ölçülmemişse değer yüzde
  // sayılabilir. Toplam varsa birim belirsizdir ve oran üretilmez.
  if (total === null || total === undefined) {
    return accurate >= 0 && accurate <= 100 ? Math.round(accurate) : null;
  }
  return null;
}

/** İlk 11'de başlayanların adları — diziliş varsa. */
function startersOf(match, team) {
  const lineup = (Array.isArray(match && match.lineups) ? match.lineups : [])
    .find((row) => row && normalize(row.team) === normalize(team));
  if (!lineup) return null;
  const players = Array.isArray(lineup.players) ? lineup.players : Array.isArray(lineup.startXI) ? lineup.startXI : [];
  return new Set(players.map((entry) => normalize(typeof entry === "string" ? entry : entry && entry.name)).filter(Boolean));
}

/**
 * Bitmiş bir maçtan oyuncu satırları.
 *
 * Oynamamış oyuncu satır açmaz: `minutes` 0 olan bir kayıt, sıfır
 * ölçümleriyle birlikte "oynadı ve üretemedi" gibi okunur ve ortalamaları
 * aşağı çeker.
 */
function matchRowsFrom(match) {
  if (!isFinished(match)) return [];
  const players = Array.isArray(match && match.players) ? match.players : [];
  if (!players.length) return [];

  const date = text(match.kickoff).slice(0, 10);
  const rows = [];
  const starterCache = new Map();

  for (const entry of players) {
    const name = text(entry && entry.name);
    const team = text(entry && entry.team);
    if (!name || !team) continue;
    const minutes = num(entry.minutes);
    if (!(minutes > 0)) continue;

    if (!starterCache.has(team)) starterCache.set(team, startersOf(match, team));
    const starters = starterCache.get(team);

    const row = {
      key: playerKey(entry),
      name,
      team,
      providerPlayerId: text(entry.providerPlayerId) || null,
      matchId: text(match.id),
      date,
      competition: text(match.league) || text(match.competition) || "",
      opponent: normalize(match.homeTeam) === normalize(team) ? text(match.awayTeam) : text(match.homeTeam),
      home: normalize(match.homeTeam) === normalize(team),
      position: text(entry.position) || null,
      // Diziliş yoksa `started` YAZILMAZ. `false` yazmak "yedek başladı"
      // iddiasıdır; ölçülmemişle ölçülmüş karışmasın.
      started: starters ? starters.has(normalize(name)) : null
    };

    for (const measure of MEASURES) {
      const source = measure === "rating" ? entry.providerRating : entry[measure];
      const value = num(source);
      if (value !== null) row[measure] = value;
    }

    // ORAN TÜRETİLİR, SAYI KARIŞTIRILMAZ. Sağlayıcının `passAccuracy`
    // alanı isabetli pas SAYISI; pencere karşılaştırmasında yüzde gibi
    // ortalaması alınırsa anlamsız bir sayı çıkar.
    if (row.passAccuracy !== undefined) {
      const rate = passRateFrom(row.passAccuracy, num(row.passes), { source: entry.source });
      if (rate === null) delete row.passAccuracy;
      else {
        if (num(row.passes) > 0 && row.passAccuracy <= row.passes) row.accuratePasses = row.passAccuracy;
        row.passAccuracy = rate;
      }
    }

    if (!row.key) continue;
    rows.push(row);
  }

  return rows;
}

/**
 * Satırları depoya katar. Aynı (oyuncu, maç) ikilisi bir kez durur;
 * yeniden çekilen maç eski satırı GÜNCELLER (sağlayıcı dökümü tamamlamış
 * olabilir), çoğaltmaz.
 */
function mergeHistory(store, rows) {
  const existing = Array.isArray(store && store.rows) ? store.rows : [];
  const index = new Map(existing.map((row) => [`${row.key}|${row.matchId}`, row]));
  let added = 0;
  let updated = 0;

  for (const row of Array.isArray(rows) ? rows : []) {
    const id = `${row.key}|${row.matchId}`;
    if (index.has(id)) {
      const before = JSON.stringify(index.get(id));
      const merged = { ...index.get(id), ...row };
      if (JSON.stringify(merged) !== before) updated += 1;
      index.set(id, merged);
    } else {
      index.set(id, row);
      added += 1;
    }
  }

  const next = [...index.values()].sort((left, right) =>
    String(left.date).localeCompare(String(right.date)) || String(left.key).localeCompare(String(right.key)));

  return { rows: next, added, updated };
}

/** Bir oyuncunun tarih sırasına dizilmiş maçları. */
function playerTimeline(store, key) {
  return (Array.isArray(store && store.rows) ? store.rows : [])
    .filter((row) => row && row.key === key)
    .sort((left, right) => String(left.date).localeCompare(String(right.date)));
}

/** Takımın oyuncu anahtarları (en çok oynayandan aza). */
function teamPlayers(store, team) {
  const totals = new Map();
  for (const row of Array.isArray(store && store.rows) ? store.rows : []) {
    if (!row || normalize(row.team) !== normalize(team)) continue;
    const current = totals.get(row.key) || { key: row.key, name: row.name, matches: 0, minutes: 0 };
    current.matches += 1;
    current.minutes += num(row.minutes) || 0;
    current.name = row.name;
    totals.set(row.key, current);
  }
  return [...totals.values()].sort((left, right) => right.minutes - left.minutes);
}

function aggregate(rows) {
  const out = { matches: rows.length };
  /**
   * ORTALAMA, ÖLÇÜLMÜŞ MAÇ SAYISINA BÖLÜNÜR — MAÇ SAYISINA DEĞİL.
   *
   * İlk sürüm toplamı `rows.length`e bölüyordu. Sağlayıcı bir maçta
   * `shots` göndermediyse o maç ölçümden düşüyor ama BÖLEN düşmüyordu;
   * yani eksik ölçüm sessizce SIFIR sayılıyordu. Bunun bedeli doğrudan bu
   * modülün var oluş sebebine çarpıyor: ilk pencerede dökümü tam, son
   * pencerede yarım gelen bir oyuncu, hiçbir şey değişmemiş olsa bile
   * "düşüşte" görünürdü. Yani eksik veri, üretilmiş bir tez hâline
   * gelirdi.
   *
   * `measured` alanı kaç maçın gerçekten ölçüldüğünü taşıyor; yazı
   * katmanı isterse örneklemi okuyucuya söyleyebilsin.
   */
  for (const measure of PER_MATCH) {
    const values = rows.map((row) => num(row[measure])).filter((value) => value !== null);
    if (!values.length) continue;
    const total = values.reduce((sum, value) => sum + value, 0);
    out[measure] = Math.round((total / values.length) * 100) / 100;
    out.measured = out.measured || {};
    out.measured[measure] = values.length;
  }
  for (const measure of AVERAGED) {
    const values = rows.map((row) => num(row[measure])).filter((value) => value !== null);
    if (!values.length) continue;
    const total = values.reduce((sum, value) => sum + value, 0);
    out[measure] = Math.round((total / values.length) * 100) / 100;
  }
  const started = rows.map((row) => row.started).filter((value) => value === true || value === false);
  if (started.length) {
    out.startShare = Math.round((started.filter(Boolean).length / started.length) * 100);
  }
  return out;
}

/**
 * İLK N MAÇ ↔ SON N MAÇ.
 *
 * Pencereler ÇAKIŞMAZ: toplam maç sayısı 2N'in altındaysa karşılaştırma
 * yapılmaz. Çakışan pencereler aynı maçı hem "ilk dönem" hem "son dönem"
 * diye sayar ve farkı yapay olarak küçültür — yani sonuç, sorunun
 * cevabı değil ölçüm yönteminin artığı olurdu.
 */
function compareWindows(timeline, options = {}) {
  const size = Number.isFinite(options.size) ? options.size : 5;
  const minimum = Number.isFinite(options.minimum) ? options.minimum : size * 2;
  const rows = Array.isArray(timeline) ? timeline : [];

  if (rows.length < minimum) {
    return {
      sufficient: false,
      sampleSize: rows.length,
      required: minimum,
      reason: `ölçülmüş maç sayısı ${rows.length}; karşılaştırma için en az ${minimum} gerekiyor`
    };
  }

  const first = aggregate(rows.slice(0, size));
  const last = aggregate(rows.slice(-size));
  const deltas = {};
  for (const measure of [...PER_MATCH, ...AVERAGED]) {
    if (first[measure] === undefined || last[measure] === undefined) continue;
    deltas[measure] = Math.round((last[measure] - first[measure]) * 100) / 100;
  }

  return {
    sufficient: true,
    sampleSize: rows.length,
    size,
    firstWindow: first,
    lastWindow: last,
    deltas,
    firstDate: rows[0].date,
    lastDate: rows[rows.length - 1].date
  };
}

/**
 * Düşüş var mı? — TEK BİR KALEME BAKILMAZ.
 *
 * Bir oyuncunun tek bir kaleminin gerilemesi gürültüdür. "Düşüş" demek
 * için üretim kalemlerinin ÇOĞUNLUĞUNUN aynı yöne gitmesi aranıyor ve
 * eşik yüzdelik: küçük mutlak farklar (0,1 şut) düşüş sayılmıyor.
 */
function declineVerdict(comparison, options = {}) {
  if (!comparison || !comparison.sufficient) return { verdict: "insufficient" };
  const threshold = Number.isFinite(options.threshold) ? options.threshold : 0.2;
  const watched = ["goals", "assists", "shots", "shotsOnTarget", "keyPasses", "duelsWon", "dribbles", "rating", "minutes"];

  let down = 0;
  let up = 0;
  const moved = [];

  for (const measure of watched) {
    const before = comparison.firstWindow[measure];
    const after = comparison.lastWindow[measure];
    if (before === undefined || after === undefined || !(Math.abs(before) > 0)) continue;
    const change = (after - before) / Math.abs(before);
    if (change <= -threshold) { down += 1; moved.push({ measure, change: Math.round(change * 100), direction: "down", before, after }); }
    else if (change >= threshold) { up += 1; moved.push({ measure, change: Math.round(change * 100), direction: "up", before, after }); }
  }

  const verdict = down >= 3 && down > up ? "decline"
    : up >= 3 && up > down ? "improvement"
    : "stable";

  return { verdict, down, up, moved };
}

module.exports = {
  AVERAGED,
  passRateFrom,
  MEASURES,
  PER_MATCH,
  aggregate,
  compareWindows,
  declineVerdict,
  isFinished,
  matchRowsFrom,
  mergeHistory,
  normalize,
  num,
  playerKey,
  playerTimeline,
  teamPlayers
};
