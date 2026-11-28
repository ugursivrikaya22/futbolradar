/**
 * ANA SAYFA "TREND OYUNCULAR" KATEGORİLERİ — derleme anında, mevcut veriden.
 *
 * Üç kategori:
 *   1. GENÇ YETENEKLER   — 21 yaşından küçük (doğum tarihinden, derleme günü
 *      Europe/Istanbul takvimine göre) ve sezonda en az 200 dakika.
 *   2. SÜRPRİZ PERFORMANSLAR — son 5 resmî maçın sağlayıcı reyting ortalaması,
 *      sezon ortalamasından en az 0,5 puan yüksek.
 *   3. FORMDAKİ OYUNCULAR — son 5 resmî maçın en yüksek reyting ortalaması.
 *
 * VERİ KAYNAKLARI (yeni sağlayıcı isteği YOK):
 *   - Oyuncu kaydı, takım, yaş (birthDate), dakika/gol/asist, fotoğraf:
 *     data/players.json (API-Football kadro + oyuncu senkronu). Dakika/gol/
 *     asist yalnızca cardCredibility.publicPlayerView doğruladıysa basılır.
 *     Kadro senkronu dakikayı 0 bırakır ve kapı onu gizler. O durumda sezon
 *     dakikası aynı maç geçmişindeki ölçülmüş dakikalardan toplanır — yeni
 *     bir sayı uydurulmaz, sağlayıcının maç satırı kullanılır.
 *   - Maç başı reyting: data/player-match-history.json (API-Football
 *     /fixtures/players satırlarından biriktirilen zaman serisi).
 *
 * TANIMLAR (değiştirirken testi de güncelleyin: scripts/test-trend-player-categories.mjs):
 *   - "Resmî maç": sezon başlangıcından (SEASON_START) sonra, hazırlık/dostluk
 *     maçı olmayan, oyuncunun en az 1 dakika oynadığı ve sağlayıcı
 *     reytingi olan maç.
 *   - Sezon ortalaması: oyuncunun bu sezonki tüm reytingli resmî maçlarının
 *     ortalaması.
 *   - Son 5: tarihe göre en yeni 5 reytingli resmî maç. En az 3 maç ve
 *     toplam 180 dakika şart; yoksa oyuncu form/sürpriz kategorisine girmez.
 *   - Sürpriz: son-5 ortalaması >= sezon ortalaması + 0,5 VE son 5'in
 *     dışında en az 2 reytingli resmî maç (karşılaştırma tabanı gerçek olsun
 *     diye; aksi hâlde iki ortalama aynı maçlardan hesaplanır).
 *   - Her kategori en çok CAP (6) kart. Aynı oyuncu birden fazla kategoride
 *     ancak o kategori başka oyuncuyla dolmuyorsa görünür (önce farklılık).
 *
 * EKSİK DEĞER UYDURULMAZ: değer yoksa `null` döner, görünümde "–" basılır.
 */
const { resolvePlayerPhoto, playerPhotoAlt } = require("./playerPhotoService.js");
const { publicPlayerView } = require("./cardCredibility.js");

const RULES = Object.freeze({
  seasonStart: "2026-07-01",
  cap: 6,
  youthMaxAgeExclusive: 21,
  youthMinMinutes: 200,
  lastN: 5,
  minRatedInLastN: 3,
  minMinutesInLastN: 180,
  surpriseDelta: 0.5,
  surpriseMinBaseline: 2
});

const NON_OFFICIAL = /hazırlık|hazirlik|friendl|dostluk/i;

function num(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function istanbulDay(now) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(now instanceof Date ? now : new Date(now));
}

/** Doğum tarihinden yaş; derleme günü Europe/Istanbul takvimine göre. */
function ageOn(birthDate, now) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(birthDate || ""));
  if (!match) return null;
  const [y, m, d] = istanbulDay(now).split("-").map(Number);
  const by = Number(match[1]);
  const bm = Number(match[2]);
  const bd = Number(match[3]);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age -= 1;
  return age >= 0 && age < 60 ? age : null;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

/** providerPlayerId → tarihe göre (yeni → eski) reytingli resmî maçlar. */
function indexRatedMatches(historyRows, rules = RULES) {
  const index = new Map();
  for (const row of Array.isArray(historyRows) ? historyRows : []) {
    const id = String((row && row.providerPlayerId) || "").trim();
    if (!/^\d+$/.test(id)) continue;
    if (String(row.date || "") < rules.seasonStart) continue;
    if (NON_OFFICIAL.test(String(row.competition || ""))) continue;
    const minutes = num(row.minutes);
    const rating = num(row.rating);
    if (!(minutes > 0) || rating === null || rating <= 0 || rating > 10) continue;
    const list = index.get(id) || new Map();
    // Aynı maç iki kez gelirse (iki takvim kopyası) bir kez sayılır.
    list.set(String(row.matchId), { matchId: String(row.matchId), date: String(row.date), minutes, rating });
    index.set(id, list);
  }
  const sorted = new Map();
  for (const [id, list] of index) {
    sorted.set(id, [...list.values()].sort((a, b) => b.date.localeCompare(a.date) || a.matchId.localeCompare(b.matchId)));
  }
  return sorted;
}

/** providerPlayerId → bu sezondaki resmî maç dakikası (reyting şartı yok). */
function indexSeasonMinutes(historyRows, rules = RULES) {
  const totals = new Map();
  const seen = new Set();
  for (const row of Array.isArray(historyRows) ? historyRows : []) {
    const id = String((row && row.providerPlayerId) || "").trim();
    const matchId = String((row && row.matchId) || "").trim();
    if (!/^\d+$/.test(id) || !matchId) continue;
    if (String(row.date || "") < rules.seasonStart) continue;
    if (NON_OFFICIAL.test(String(row.competition || ""))) continue;
    const minutes = num(row.minutes);
    if (!(minutes > 0)) continue;
    const key = `${id}:${matchId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    totals.set(id, (totals.get(id) || 0) + minutes);
  }
  return totals;
}

function ratingSummary(rows, rules = RULES) {
  const all = Array.isArray(rows) ? rows : [];
  const last = all.slice(0, rules.lastN);
  const lastMinutes = last.reduce((sum, row) => sum + row.minutes, 0);
  const seasonAvg = all.length ? round1(mean(all.map((row) => row.rating))) : null;
  const lastEligible = last.length >= rules.minRatedInLastN && lastMinutes >= rules.minMinutesInLastN;
  const lastAvg = lastEligible ? round1(mean(last.map((row) => row.rating))) : null;
  return {
    seasonAvg,
    seasonRated: all.length,
    lastAvg,
    lastRated: last.length,
    lastMinutes,
    baseline: Math.max(0, all.length - last.length)
  };
}

function toCard(player, summary, now, options) {
  const view = publicPlayerView(player, { trend: true, ...(options.viewOptions || {}) });
  const photo = resolvePlayerPhoto({ ...player, photo: view.fields.photo || null, providerId: player.providerId });
  const publishedMinutes = num(view.fields.minutesPlayed ?? view.fields.minutes);
  const historyMinutes = num(options.historyMinutes);
  const minutes = publishedMinutes !== null
    ? publishedMinutes
    : (historyMinutes !== null && historyMinutes > 0 ? historyMinutes : null);
  return {
    id: player.id,
    name: player.name,
    team: view.fields.currentTeam || view.fields.team || null,
    age: ageOn(player.birthDate, now),
    minutes,
    goals: num(view.fields.goals),
    assists: num(view.fields.assists),
    seasonRating: summary.seasonAvg,
    seasonRated: summary.seasonRated,
    lastRating: summary.lastAvg,
    lastRated: summary.lastRated,
    photoUrl: photo.isPlaceholder ? "" : photo.url,
    photoAlt: playerPhotoAlt({ name: player.name, team: view.fields.currentTeam || view.fields.team }),
    initials: photo.initials
  };
}

/**
 * @param {object} input
 * @param {Array} input.players   doğrulanmış oyuncu havuzu (filterPlayerCards kept)
 * @param {Array} input.history   data/player-match-history.json rows
 * @param {Date|string|number} input.now  derleme anı
 * @param {(player)=>boolean} [input.hasProfile]  profil sayfası var mı
 */
function computeTrendCategories(input, rules = RULES) {
  const now = input.now || new Date();
  const hasProfile = typeof input.hasProfile === "function" ? input.hasProfile : () => true;
  const rated = indexRatedMatches(input.history, rules);
  const seasonMinutes = indexSeasonMinutes(input.history, rules);
  const options = { viewOptions: input.viewOptions || {} };

  const pool = [];
  const seen = new Set();
  for (const player of Array.isArray(input.players) ? input.players : []) {
    if (!player || !player.id || seen.has(player.id)) continue;
    if (!hasProfile(player)) continue;
    seen.add(player.id);
    const providerId = String(player.providerId || "");
    const summary = ratingSummary(rated.get(providerId) || [], rules);
    pool.push(toCard(player, summary, now, {
      ...options,
      historyMinutes: seasonMinutes.get(providerId) ?? null
    }));
  }

  const byName = (a, b) => String(a.name).localeCompare(String(b.name), "tr");
  const young = pool
    .filter((card) => card.age !== null && card.age < rules.youthMaxAgeExclusive
      && card.minutes !== null && card.minutes >= rules.youthMinMinutes)
    .sort((a, b) => (b.seasonRating ?? -1) - (a.seasonRating ?? -1) || b.minutes - a.minutes || byName(a, b));

  const form = pool
    .filter((card) => card.lastRating !== null)
    .sort((a, b) => b.lastRating - a.lastRating || b.lastRated - a.lastRated || byName(a, b));

  const surprise = pool
    .filter((card) => {
      if (card.lastRating === null || card.seasonRating === null) return false;
      const summary = { baseline: card.seasonRated - card.lastRated };
      return summary.baseline >= rules.surpriseMinBaseline
        && round1(card.lastRating - card.seasonRating) >= rules.surpriseDelta;
    })
    .map((card) => ({ ...card, delta: round1(card.lastRating - card.seasonRating) }))
    .sort((a, b) => b.delta - a.delta || b.lastRating - a.lastRating || byName(a, b));

  // ÖNCE FARKLILIK: kategoriler sırayla doldurulur; zaten gösterilen oyuncu
  // ancak kategori başka adayla dolmuyorsa tekrar alınır.
  const used = new Set();
  function pick(list) {
    const fresh = list.filter((card) => !used.has(card.id));
    const chosen = fresh.slice(0, rules.cap);
    if (chosen.length < rules.cap) {
      for (const card of list) {
        if (chosen.length >= rules.cap) break;
        if (!chosen.includes(card)) chosen.push(card);
      }
    }
    chosen.forEach((card) => used.add(card.id));
    return chosen;
  }

  return {
    rules,
    builtFor: istanbulDay(now),
    categories: {
      young: pick(young),
      surprise: pick(surprise),
      form: pick(form)
    },
    coverage: {
      pool: pool.length,
      withSeasonRating: pool.filter((card) => card.seasonRating !== null).length,
      withLastN: pool.filter((card) => card.lastRating !== null).length
    }
  };
}

module.exports = { RULES, ageOn, istanbulDay, indexRatedMatches, indexSeasonMinutes, ratingSummary, computeTrendCategories };
