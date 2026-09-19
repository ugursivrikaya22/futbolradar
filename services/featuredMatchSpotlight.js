/**
 * ANA SAYFA MAÇ VİTRİNİ (SPOTLIGHT) — SEÇİM VE YAŞAM DÖNGÜSÜ.
 *
 * Bir kulübün maçı, maç öncesinden maç sonrasına kadar ana sayfanın en
 * üstünde tek bir kutuda öne çıkar; kutu, maçın GERÇEK bitiş düdüğünden
 * tam `dwellAfterFinishMinutes` (varsayılan 120 dk) sonra düşer. Kutunun
 * bağlandığı maç sayfası ise KALICIDIR — vitrin kapansa bile sayfa aynı
 * adreste yayında kalır ve maç sonrası aramalardan ("maç sonucu",
 * "golleri", "maç özeti") trafik almaya devam eder.
 *
 * ── NEDEN AYRI BİR MODÜL ─────────────────────────────────────────────────
 * Ana sayfadaki hero karuseli (`services/featuredMatchSelector.js`) o anın
 * en iyi maçını GÖSTERİR ama bir maçı bir kulüp adına haftalar boyu takip
 * etmez: maç öncesi geri sayım, canlı skor ve maç sonrası 2 saatlik kuyruk
 * onun sözleşmesinde yok. Vitrin bu üç evreyi tek kayıtta taşır ve yalnızca
 * yapılandırmadaki kulüpler için açılır. İkisi birbirini ezmez: karusel
 * kendi kurallarıyla çalışmaya devam eder.
 *
 * ── SAYAÇ GERÇEK DÜDÜKTEN BAŞLAR ─────────────────────────────────────────
 * "Başlama saati + 2 saat" yanlış bir kısayol: uzatmaya giden, devre arası
 * uzayan ya da ertelenen maçta kutu erken düşer. Bitiş anı bu yüzden
 * SAĞLAYICIDAN gözlenir — kayıt ilk kez FINISHED/AWARDED görüldüğünde o an
 * durum dosyasına yazılır (`observedFinishedAt`) ve bir daha değişmez.
 * Maç ertelenirse kayıt düşer; yeni tarih geldiğinde döngü baştan başlar.
 *
 * Gözlem damgası yoksa (ör. ilk koşu maç bittikten sonra yapıldıysa)
 * sağlayıcının kendi güncelleme damgası, o da yoksa başlama saati +
 * `assumedDurationMinutes` yedek olarak kullanılır. Yedek DAİMA gözlemden
 * sonra gelir; uydurma bir bitiş anı gerçek olanı ezemez.
 */

const { hasReadableScore, kickoffMs, matchState, updatedAtMs } = require("./matchStatus");

/** Vitrin maçtan en fazla bu kadar önce açılır. */
const DEFAULT_OPEN_BEFORE_HOURS = 48;

/** Bitiş düdüğünden sonra kutunun ana sayfada kalacağı süre. */
const DEFAULT_DWELL_AFTER_FINISH_MINUTES = 120;

/**
 * Sağlayıcı maçı hiç "bitti"ye çevirmezse kutunun ana sayfada sonsuza kadar
 * "canlı" kalmaması için varsayılan maç süresi (uzatma + devre arası dahil).
 * Yalnızca YEDEK yoldur; gözlenmiş bitiş anı varsa hiç kullanılmaz.
 */
const DEFAULT_ASSUMED_DURATION_MINUTES = 150;

/**
 * Bir maçın "şu anda bitti" olarak gözlenebileceği azami pencere. Başlama
 * saatinden bu kadar sonra gelen ilk "bitti" bildirimi bir gözlem değil,
 * geç açılan bir kayıttır; damga yazılmaz.
 */
const OBSERVATION_WINDOW_MS = 6 * 60 * 60 * 1000;

const FINISHED_STATES = new Set(["FINISHED", "AWARDED"]);
const LIVE_STATES = new Set(["LIVE", "HALFTIME", "INTERRUPTED"]);
const OFF_STATES = new Set(["POSTPONED", "CANCELLED", "ABANDONED"]);

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** Türkçe karakterleri de kapsayan karşılaştırma anahtarı. */
function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .replace(/İ/g, "i")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Kayıt, yapılandırmadaki kulüplerden birine mi ait? */
function involvesTeam(match, teams) {
  const wanted = (Array.isArray(teams) ? teams : []).map(normalizeName).filter(Boolean);
  if (!wanted.length || !match) return false;

  const sides = [match.homeTeam, match.awayTeam].map(normalizeName).filter(Boolean);
  return sides.some((side) => wanted.some((team) => side === team || side.startsWith(`${team} `) || side.endsWith(` ${team}`)));
}

/** Kayıttaki hangi taraf vitrinin kulübü? */
function spotlightSideOf(match, teams) {
  const wanted = (Array.isArray(teams) ? teams : []).map(normalizeName).filter(Boolean);
  const home = normalizeName(match && match.homeTeam);
  const away = normalizeName(match && match.awayTeam);
  const hit = (side) => wanted.some((team) => side === team || side.startsWith(`${team} `) || side.endsWith(` ${team}`));

  if (hit(home)) return "home";
  if (hit(away)) return "away";
  return "";
}

/** Vitrinin kulübü karşısındaki rakip. Başlıklarda "Rakip + Beşiktaş" için. */
function opponentOf(match, teams) {
  const side = spotlightSideOf(match, teams);
  if (side === "home") return (match && match.awayTeam) || "";
  if (side === "away") return (match && match.homeTeam) || "";
  return "";
}

/**
 * Vitrin evresi. `matchState` sağlayıcı kodlarını kanonikleştirir; buradaki
 * eşleme yalnızca kutunun anlatımını (geri sayım / canlı / sonuç) seçer.
 */
function phaseOf(match, nowMs, options) {
  const settings = withDefaults(options);
  const state = matchState(match);
  if (OFF_STATES.has(state)) return state === "POSTPONED" ? "postponed" : "cancelled";
  if (FINISHED_STATES.has(state)) return "post";
  if (LIVE_STATES.has(state)) return "live";

  const kickoff = kickoffMs(match);
  if (kickoff == null) return "pre";

  // Saat geçmiş ama sağlayıcı hâlâ "programlandı" diyor: uydurma bir canlı
  // skor yazmak yerine "başlamak üzere" bandında kalınır. Kutu skor değil,
  // "maç başlıyor" der; skor yalnızca sağlayıcı bildirince yazılır.
  if (nowMs >= kickoff && nowMs < kickoff + settings.assumedDurationMs) return "in-progress";
  if (nowMs >= kickoff + settings.assumedDurationMs) return "post";
  return "pre";
}

function withDefaults(options) {
  const config = options || {};
  const openBeforeHours = Number.isFinite(config.openBeforeHours) ? config.openBeforeHours : DEFAULT_OPEN_BEFORE_HOURS;
  const dwellMinutes = Number.isFinite(config.dwellAfterFinishMinutes)
    ? config.dwellAfterFinishMinutes
    : DEFAULT_DWELL_AFTER_FINISH_MINUTES;
  const assumedMinutes = Number.isFinite(config.assumedDurationMinutes)
    ? config.assumedDurationMinutes
    : DEFAULT_ASSUMED_DURATION_MINUTES;

  return {
    teams: Array.isArray(config.teams) ? config.teams : [],
    openBeforeMs: Math.max(0, openBeforeHours) * HOUR,
    dwellMs: Math.max(0, dwellMinutes) * MINUTE,
    assumedDurationMs: Math.max(0, assumedMinutes) * MINUTE
  };
}

/**
 * BİTİŞ DÜDÜĞÜ ANI.
 *
 * Sıra kasıtlı: gözlenmiş damga → sağlayıcının güncelleme damgası →
 * başlama saati + varsayılan süre. İlk ikisi gerçeğe dayanır; üçüncüsü
 * yalnızca sağlayıcı sessiz kaldığında kutunun sonsuza kadar açık
 * kalmasını önler.
 */
function finalWhistleAt(match, nowMs, options, observedFinishedAt) {
  const settings = withDefaults(options);
  const phase = phaseOf(match, nowMs, settings);
  if (phase !== "post") return null;

  const observed = Date.parse(observedFinishedAt || "");
  if (Number.isFinite(observed)) return observed;

  const updated = updatedAtMs(match);
  const kickoff = kickoffMs(match);

  // Sağlayıcı damgası yalnızca makul bir aralıktaysa güvenilir: maçtan önce
  // ya da günler sonra atılmış bir damga bitiş anı değildir.
  if (Number.isFinite(updated) && kickoff != null && updated > kickoff && updated <= kickoff + 6 * HOUR) {
    return updated;
  }

  if (kickoff != null) return kickoff + settings.assumedDurationMs;
  return null;
}

/** Kutunun ana sayfadan düşeceği an (bitiş + bekleme süresi). */
function removeAt(match, nowMs, options, observedFinishedAt) {
  const settings = withDefaults(options);
  const whistle = finalWhistleAt(match, nowMs, settings, observedFinishedAt);
  if (whistle == null) return null;
  return whistle + settings.dwellMs;
}

/**
 * İSTEMCİ İÇİN EN GEÇ DÜŞME ANI.
 *
 * Derleme saatlik koşuyor; kutu maç bitiminden tam 2 saat sonra düşsün diye
 * işaretleme kendi son kullanma damgasını taşır. Maç henüz bitmemişse
 * gerçek düdük bilinmiyordur: istemciye "en kötü ihtimalle şu ana kadar"
 * sınırı verilir (başlama + varsayılan süre + bekleme). Sağlayıcı bitişi
 * bildirince bir sonraki koşu damgayı gerçek düdüğe çeker.
 */
function clientExpiryAt(match, nowMs, options, observedFinishedAt) {
  const settings = withDefaults(options);
  const exact = removeAt(match, nowMs, settings, observedFinishedAt);
  if (exact != null) return { at: exact, exact: true };

  const kickoff = kickoffMs(match);
  if (kickoff == null) return { at: null, exact: false };
  return { at: kickoff + settings.assumedDurationMs + settings.dwellMs, exact: false };
}

/**
 * Kutunun bu an için yayına uygun olup olmadığı.
 * Ertelenen maç vitrinde KALIR: "ertelendi" bilgisi okuyucunun o an aradığı
 * şeydir. Sayaç yeni tarih geldiğinde gerçek düdükten başlar.
 */
function isOpen(match, nowMs, options, observedFinishedAt) {
  const settings = withDefaults(options);
  const kickoff = kickoffMs(match);
  if (kickoff == null) return false;
  if (nowMs < kickoff - settings.openBeforeMs) return false;

  const phase = phaseOf(match, nowMs, settings);
  if (phase === "cancelled") return false;
  if (phase === "postponed") return true;
  if (phase !== "post") return true;

  const closes = removeAt(match, nowMs, settings, observedFinishedAt);
  return closes == null ? false : nowMs <= closes;
}

const PHASE_RANK = { live: 0, "in-progress": 1, pre: 2, postponed: 3, post: 4 };

/**
 * Vitrine girecek maç. Aynı anda birden çok aday varsa evre sırası
 * (canlı > başlıyor > yaklaşan > ertelenmiş > biten), eşitlikte başlama
 * saatine yakınlık kazanır. Aynı maçın birden çok kaydı varsa (kürasyonlu
 * + sağlayıcı) en ilerideki durum ve okunabilir skor taşıyan kayıt seçilir.
 */
function selectSpotlight(matches, options) {
  const settings = withDefaults(options);
  const now = Number.isFinite(options && options.nowMs) ? options.nowMs : Date.now();
  const observed = (options && options.observed) || {};

  const byKey = new Map();
  for (const match of Array.isArray(matches) ? matches : []) {
    if (!match || !involvesTeam(match, settings.teams)) continue;
    const kickoff = kickoffMs(match);
    if (kickoff == null) continue;

    const key = match.id || `${normalizeName(match.homeTeam)}|${normalizeName(match.awayTeam)}|${String(match.kickoff || match.date || "").slice(0, 10)}`;
    const current = byKey.get(key);
    if (!current || betterRecord(match, current)) byKey.set(key, match);
  }

  const candidates = [...byKey.values()]
    .filter((match) => isOpen(match, now, settings, observed[match.id]))
    .map((match) => ({
      match,
      phase: phaseOf(match, now, settings),
      distance: Math.abs((kickoffMs(match) || 0) - now)
    }))
    .sort((left, right) => (PHASE_RANK[left.phase] - PHASE_RANK[right.phase]) || (left.distance - right.distance));

  return candidates.length ? candidates[0].match : null;
}

/** İki kayıttan hangisi daha ileri? Durum önce, sonra okunabilir skor. */
function betterRecord(candidate, current) {
  const rank = (match) => {
    const state = matchState(match);
    if (FINISHED_STATES.has(state)) return 4;
    if (LIVE_STATES.has(state)) return 3;
    if (OFF_STATES.has(state)) return 2;
    if (state === "SCHEDULED") return 1;
    return 0;
  };

  const candidateRank = rank(candidate);
  const currentRank = rank(current);
  if (candidateRank !== currentRank) return candidateRank > currentRank;
  return hasReadableScore(candidate) && !hasReadableScore(current);
}

/**
 * Durum dosyasının bir sonraki hâli. Bitmiş bir maç ilk kez görüldüğünde
 * damga yazılır; VAR OLAN DAMGA HİÇ DEĞİŞMEZ (aynı maç için ikinci bir
 * "bitti" bildirimi sayacı yeniden başlatamaz). Maç yeniden canlıya ya da
 * ertelenmiş duruma dönerse (uzatma bildirimi geç gelen sağlayıcılar,
 * ertelenen karşılaşmalar) damga silinir ve sayaç gerçek düdüğü bekler.
 */
function nextObservedState(previous, match, nowMs) {
  const state = { ...(previous || {}) };
  if (!match || !match.id) return state;

  const canonical = matchState(match);
  if (FINISHED_STATES.has(canonical)) {
    // GÖZLEM PENCERESİ DIŞINDA DAMGA YAZILMAZ.
    //
    // İlk koşu maç bittikten günler sonra yapılırsa "şimdi bitti" damgası
    // GERÇEK DIŞI olur ve sayacı bugüne çeker: haftalar önce oynanmış bir
    // maç, ana sayfada yeniden iki saatlik vitrine girerdi. Damga yalnızca
    // maçın gerçekten bitmiş olabileceği aralıkta (başlama saati ile
    // başlama + `OBSERVATION_WINDOW_MS` arası) yazılır; dışarıdaysa damga
    // hiç yazılmaz ve `finalWhistleAt` sağlayıcı damgasına ya da
    // başlama + varsayılan süre tavanına düşer.
    const kickoff = kickoffMs(match);
    const observable = kickoff == null || (nowMs >= kickoff && nowMs <= kickoff + OBSERVATION_WINDOW_MS);
    if (!state[match.id] && observable) state[match.id] = new Date(nowMs).toISOString();
    return state;
  }

  // Maç yeniden oynanıyor ya da ertelendi: önceki bitiş damgası artık
  // geçerli değil.
  if (LIVE_STATES.has(canonical) || OFF_STATES.has(canonical) || canonical === "SCHEDULED") {
    delete state[match.id];
  }
  return state;
}

/** Durum dosyasında artık hiçbir maça karşılık gelmeyen damgaları at. */
function pruneObservedState(state, nowMs, maxAgeDays = 30) {
  const out = {};
  const cutoff = nowMs - maxAgeDays * 24 * HOUR;
  for (const [id, stamp] of Object.entries(state || {})) {
    const parsed = Date.parse(stamp);
    if (Number.isFinite(parsed) && parsed >= cutoff) out[id] = stamp;
  }
  return out;
}

module.exports = {
  DEFAULT_ASSUMED_DURATION_MINUTES,
  OBSERVATION_WINDOW_MS,
  DEFAULT_DWELL_AFTER_FINISH_MINUTES,
  DEFAULT_OPEN_BEFORE_HOURS,
  clientExpiryAt,
  finalWhistleAt,
  involvesTeam,
  isOpen,
  nextObservedState,
  normalizeName,
  opponentOf,
  phaseOf,
  pruneObservedState,
  removeAt,
  selectSpotlight,
  spotlightSideOf,
  withDefaults
};
