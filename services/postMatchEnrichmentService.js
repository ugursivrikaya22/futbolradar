/**
 * MAÇ SONU ZENGİNLEŞTİRME — bölüm bölüm, doğrulanmış alan alan.
 *
 * Maç raporu sayfaları bugüne kadar YALNIZCA kürasyonlu `data/matches.json`
 * kaydından üretiliyordu. Kürasyon doğru ama dar: dokuz tamamlanmış maçın
 * yalnızca ikisinde sağlayıcı kimliği var, oyuncu bazlı istatistik hiç yok
 * ve kapsam %44'lerde kalıyor.
 *
 * Bu modül sağlayıcıdan gelen maç sonu verisini (olaylar, dizilişler, takım
 * istatistikleri, oyuncu istatistikleri) kürasyonlu kayda BÖLÜM BÖLÜM
 * ekliyor. Üç kural, sırayla:
 *
 *   1. KÜRASYON KAZANIR. Elle doğrulanmış bir alan sağlayıcı farklı değer
 *      gönderse bile ezilmez; çakışma işaretlenir. Kürasyon, sağlayıcının
 *      yanlış olduğu bilinen durumlar için var olan manuel geçersiz kılma
 *      mekanizmasıdır.
 *   2. YALNIZCA ÖLÇÜLMÜŞ ALAN YAYIMLANIR. Sağlayıcının göndermediği alan
 *      yamaya girmez; sıfırla ya da tireyle doldurulmaz. "0 şut", sağlayıcı
 *      şut verisi göndermediğinde "şut çekmedi" gibi okunur.
 *   3. EKSİKLİK AÇIKÇA SÖYLENİR. Bölüm kısmi doluysa hangi alanların
 *      beklendiği bildirilir; boş bir bölüm sessizce gizlenmez.
 *
 * Modül SAF: ağ çağrısı yapmaz, dosya yazmaz. Ağ ve disk
 * scripts/enrich-post-match.mjs tarafında.
 */

const { canonicalizeStatistics, toNumber } = require("./matchStatisticsSchema");
const { normalizeText } = require("./matchRadarService");

const PROVIDER_NAME = "API-Football";

/** Zenginleştirilebilir bölümler ve okuyucuya görünen adları. */
const SECTIONS = [
  { key: "summary", label: "Maç özeti" },
  { key: "goals", label: "Goller" },
  { key: "events", label: "Maç olayları" },
  { key: "lineups", label: "Dizilişler" },
  { key: "teamStats", label: "Takım istatistikleri" },
  { key: "playerStats", label: "Oyuncu istatistikleri" }
];

const SECTION_KEYS = SECTIONS.map((section) => section.key);

/** Tamamlanmış sayılan maç durumları. Sadece bunlar zenginleştirilir. */
const COMPLETED_STATUSES = new Set(["FINISHED", "FT", "AET", "PEN"]);

function isCompleted(match) {
  return COMPLETED_STATUSES.has(String((match && match.status) || "").toUpperCase());
}

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

/* ------------------------------------------------------------------ *
 * SAĞLAYICI KİMLİĞİ ÇÖZÜMLEMESİ
 *
 * Kürasyonlu maçların çoğunda sağlayıcı kimliği yok. Zenginleştirme için
 * önce o kimliği bulmak gerekiyor; ama YANLIŞ maça bağlanmak, doğru maça
 * hiç bağlanmamaktan çok daha kötü: başka bir karşılaşmanın golleri ve
 * dizilişi bu maçın raporuna yazılırdı.
 *
 * Bu yüzden eşleştirme muhafazakâr: iki takım adı da eşleşmeli VE skor
 * uyuşmalı. Skor, iki farklı maçı ayırt eden en güçlü bağımsız sinyal;
 * aynı gün aynı takımların iki maçı olmaz ama ad benzerliği yanıltabilir.
 * ------------------------------------------------------------------ */

/** Sağlayıcı ve kürasyon takım adlarını karşılaştırılabilir hâle getirir. */
function teamKey(value) {
  return normalizeText(String(value || ""))
    .replace(/\b(fc|sk|ac|as|sc|cf|fk|kulubu|spor kulubu|a ?s)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function teamsMatch(left, right) {
  const a = teamKey(left);
  const b = teamKey(right);
  if (!a || !b) return false;
  if (a === b) return true;
  // Sağlayıcı adları daha uzun olabiliyor ("Besiktas JK" / "Besiktas").
  return a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a));
}

function providerScore(fixture) {
  const goals = (fixture && fixture.goals) || {};
  return { home: toNumber(goals.home), away: toNumber(goals.away) };
}

function curatedScore(match) {
  const score = (match && match.score) || {};
  return { home: toNumber(score.home), away: toNumber(score.away) };
}

/**
 * Kürasyonlu maçı sağlayıcı fikstür listesinden çözer.
 *
 * @returns {{fixtureId: string|null, confidence: string, reason: string}}
 */
function resolveProviderFixture(match, candidates) {
  const list = Array.isArray(candidates) ? candidates : [];

  // Zaten sayısal bir sağlayıcı kimliği varsa çözümlemeye gerek yok.
  // API-Football kimlikleri yalnızca rakamdır; başka sağlayıcıdan gelmiş
  // bir kimlik (ör. TheSportsDB'nin harfli kimliği) bu uç noktada
  // kullanılamaz ve çözümleme yine gerekir.
  const existing = String((match && match.providerId) || "").trim();
  if (/^\d+$/.test(existing)) {
    return { fixtureId: existing, confidence: "high", reason: "kayıtta sayısal sağlayıcı kimliği var" };
  }

  const wanted = curatedScore(match);
  const nameMatches = list.filter((fixture) => {
    const teams = (fixture && fixture.teams) || {};
    return teamsMatch(match.homeTeam, teams.home && teams.home.name) &&
      teamsMatch(match.awayTeam, teams.away && teams.away.name);
  });

  if (!nameMatches.length) {
    return { fixtureId: null, confidence: "none", reason: "sağlayıcı listesinde takım eşleşmesi yok" };
  }

  // Skor doğrulaması. Kürasyonda skor yoksa eşleştirme yapılmaz: tek
  // sinyalle (ad) bağlanmak, yanlış maça bağlanma riskini kabul etmek olur.
  if (wanted.home === null || wanted.away === null) {
    return { fixtureId: null, confidence: "none", reason: "kürasyonlu skor yok; ad tek başına yeterli değil" };
  }

  const scoreMatches = nameMatches.filter((fixture) => {
    const score = providerScore(fixture);
    return score.home === wanted.home && score.away === wanted.away;
  });

  if (scoreMatches.length === 1) {
    const fixture = scoreMatches[0].fixture || {};
    return {
      fixtureId: fixture.id ? String(fixture.id) : null,
      confidence: "high",
      reason: "takım adları ve skor eşleşti"
    };
  }

  if (scoreMatches.length > 1) {
    return { fixtureId: null, confidence: "none", reason: `belirsiz: ${scoreMatches.length} aday eşleşti` };
  }

  return { fixtureId: null, confidence: "none", reason: "takım eşleşti ama skor uyuşmadı" };
}

/* ------------------------------------------------------------------ *
 * SAĞLAYICI YÜKLERİNİN NORMALLEŞTİRİLMESİ
 *
 * Her normalleştirici yalnızca GERÇEKTEN gönderilmiş alanları taşır.
 * Eksik alan atlanır; null/0 ile doldurulmaz.
 * ------------------------------------------------------------------ */

function normalizeEvents(raw) {
  const events = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const time = (item && item.time) || {};
    const minute = toNumber(time.elapsed);
    const type = String((item && item.type) || "").trim();
    if (minute === null || !type) continue;

    const event = {
      minute,
      extraMinute: toNumber(time.extra),
      type,
      detail: String((item && item.detail) || "").trim() || null,
      team: (item && item.team && item.team.name) || null,
      player: (item && item.player && item.player.name) || null,
      assist: (item && item.assist && item.assist.name) || null
    };
    // Boş alanları taşımıyoruz: null bir "assist" satırı, asist olmadığını
    // değil asistin ölçülmediğini gösterir; ikisi karışmasın.
    for (const key of Object.keys(event)) {
      if (event[key] === null) delete event[key];
    }
    events.push(event);
  }
  return events.sort((left, right) => (left.minute - right.minute) ||
    ((left.extraMinute || 0) - (right.extraMinute || 0)));
}

function normalizeGoals(events) {
  return (Array.isArray(events) ? events : [])
    .filter((event) => /goal/i.test(String(event.type || "")))
    // Kaçan penaltı bir gol değildir; sağlayıcı ikisini de "Goal" tipiyle
    // gönderip detayda ayırıyor.
    .filter((event) => !/missed penalty/i.test(String(event.detail || "")));
}

function normalizeLineups(raw) {
  const lineups = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const team = (item && item.team && item.team.name) || null;
    if (!team) continue;

    const startXI = (Array.isArray(item.startXI) ? item.startXI : [])
      .map((entry) => entry && entry.player)
      .filter(Boolean)
      .map((player) => {
        const row = { name: player.name || null, number: toNumber(player.number), position: player.pos || null };
        for (const key of Object.keys(row)) if (row[key] === null) delete row[key];
        return row;
      })
      .filter((row) => row.name);

    const substitutes = (Array.isArray(item.substitutes) ? item.substitutes : [])
      .map((entry) => entry && entry.player && entry.player.name)
      .filter(Boolean);

    // İlk on bir yoksa diziliş bölümü açılmaz: yalnızca yedek listesi
    // "diziliş" değildir.
    if (!startXI.length) continue;

    const lineup = {
      team,
      formation: (item && item.formation) || null,
      coach: (item && item.coach && item.coach.name) || null,
      startXI,
      substitutes
    };
    for (const key of ["formation", "coach"]) if (!lineup[key]) delete lineup[key];
    lineups.push(lineup);
  }
  return lineups;
}

function normalizeTeamStats(raw) {
  const rows = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const team = (item && item.team && item.team.name) || null;
    if (!team) continue;
    rows.push({ team, statistics: Array.isArray(item.statistics) ? item.statistics : [] });
  }
  if (rows.length < 2) return null;

  // Kanonik şemaya çevir: sağlayıcı adları sürüm sürüm değişiyor, site
  // tek bir isim kümesi kullanmalı.
  const [home, away] = rows;
  const merged = [];
  const homeMap = new Map(home.statistics.map((entry) => [entry.type, entry.value]));
  const awayMap = new Map(away.statistics.map((entry) => [entry.type, entry.value]));
  for (const type of new Set([...homeMap.keys(), ...awayMap.keys()])) {
    merged.push({ type, home: homeMap.get(type), away: awayMap.get(type) });
  }

  const { statistics } = canonicalizeStatistics(merged);
  // Her iki tarafı da ölçülmemiş satırlar düşer: tek taraflı bir satır
  // karşılaştırma tablosunda okunamaz.
  const usable = (statistics || []).filter((row) => hasValue(row.home) || hasValue(row.away));
  if (!usable.length) return null;

  return { homeTeam: home.team, awayTeam: away.team, statistics: usable };
}

/** Oyuncu satırında yayımlanabilir sayılan ölçümler. */
const PLAYER_STAT_FIELDS = [
  ["minutes", (games) => toNumber(games.minutes)],
  ["rating", (games) => toNumber(games.rating)],
  ["position", (games) => games.position || null]
];

function normalizePlayerStats(raw) {
  const teams = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const team = (item && item.team && item.team.name) || null;
    if (!team) continue;

    const players = [];
    for (const entry of Array.isArray(item.players) ? item.players : []) {
      const player = (entry && entry.player) || {};
      const stat = (Array.isArray(entry.statistics) && entry.statistics[0]) || {};
      const games = stat.games || {};
      const goals = stat.goals || {};
      const shots = stat.shots || {};
      const passes = stat.passes || {};
      const duels = stat.duels || {};
      const cards = stat.cards || {};

      const name = player.name || null;
      if (!name) continue;

      const row = { name, providerId: player.id ? String(player.id) : null };
      for (const [key, read] of PLAYER_STAT_FIELDS) {
        const value = read(games);
        if (value !== null && value !== undefined) row[key] = value;
      }

      const measures = {
        goals: toNumber(goals.total),
        assists: toNumber(goals.assists),
        shots: toNumber(shots.total),
        shotsOnTarget: toNumber(shots.on),
        passes: toNumber(passes.total),
        passAccuracy: toNumber(passes.accuracy),
        duelsWon: toNumber(duels.won),
        yellowCards: toNumber(cards.yellow),
        redCards: toNumber(cards.red)
      };
      for (const [key, value] of Object.entries(measures)) {
        if (value !== null) row[key] = value;
      }

      for (const key of Object.keys(row)) if (row[key] === null) delete row[key];

      // OYNAMAMIŞ OYUNCU SATIRI AÇMAZ. minutes 0 olan bir satır, tamamı
      // sıfır ölçümlerle birlikte "oynadı ve üretemedi" gibi okunur.
      if (!(Number(row.minutes) > 0)) continue;
      players.push(row);
    }

    if (players.length) teams.push({ team, players });
  }
  return teams.length ? teams : null;
}

/* ------------------------------------------------------------------ *
 * KÜRASYON GEÇERSİZ KILMA (manuel yönetici müdahalesi)
 *
 * `data/match-enrichment-overrides.json` bir maç için bölüm bazında
 * elle girilmiş değer taşıyabilir. Bu değer sağlayıcıyı EZER ve kaynağı
 * "curated" olarak işaretlenir — okuyucuya ve denetime hangi bölümün
 * insan eliyle konduğu görünür.
 *
 * Sağlayıcı hatalı veri gönderdiğinde (yanlış gol dakikası, eksik oyuncu)
 * tek çözüm budur; alternatif, yanlış veriyi yayımlamak olurdu.
 * ------------------------------------------------------------------ */
function applyOverride(sectionKey, providerValue, override) {
  const manual = override && override[sectionKey];
  if (manual === undefined || manual === null) {
    return { value: providerValue, source: providerValue ? "provider" : null, overridden: false };
  }
  return { value: manual, source: "curated", overridden: true };
}

/* ------------------------------------------------------------------ *
 * BÖLÜM KURULUMU
 * ------------------------------------------------------------------ */

function sectionIsFilled(key, value) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") {
    if (key === "teamStats") return Array.isArray(value.statistics) && value.statistics.length > 0;
    return Object.keys(value).length > 0;
  }
  return hasValue(value);
}

/**
 * Bir maç için tüm bölümleri, köken bilgisiyle birlikte kurar.
 *
 * @param {object} match kürasyonlu maç kaydı
 * @param {object} bundle {events, lineups, teamStats, playerStats} ham sağlayıcı yükleri
 * @param {object} options {override, observedAt, fixtureId, resolution}
 */
function buildEnrichment(match, bundle = {}, options = {}) {
  const observedAt = options.observedAt || new Date().toISOString();
  const override = options.override || null;

  const events = normalizeEvents(bundle.events);
  const derived = {
    summary: null, // özet metni rapor katmanında üretiliyor; burada köken taşınır
    goals: normalizeGoals(events),
    events,
    lineups: normalizeLineups(bundle.lineups),
    teamStats: normalizeTeamStats(bundle.teamStats),
    playerStats: normalizePlayerStats(bundle.playerStats)
  };

  // Özet, gol listesi doluysa sağlayıcı verisinden türetilebilir sayılır.
  derived.summary = derived.goals.length || derived.events.length ? { basis: "events" } : null;

  const sections = {};
  let filled = 0;

  for (const { key, label } of SECTIONS) {
    const applied = applyOverride(key, derived[key], override);
    const isFilled = sectionIsFilled(key, applied.value);
    if (isFilled) filled += 1;

    sections[key] = {
      key,
      label,
      status: isFilled ? "ready" : "awaiting",
      value: isFilled ? applied.value : null,
      source: isFilled ? (applied.source || "provider") : null,
      overridden: applied.overridden,
      // Eksik bölüm SESSİZ KALMAZ: neyin beklendiği adıyla söylenir.
      message: isFilled
        ? null
        : `${label} için sağlayıcıdan doğrulanmış veri gelmedi. Veri ulaştığında bu bölüm otomatik dolar.`,
      provenance: isFilled
        ? {
          source: applied.source === "curated" ? "FutbolRadar kürasyon" : PROVIDER_NAME,
          observedAt,
          fixtureId: options.fixtureId || null
        }
        : null
    };
  }

  const coverage = Math.round((filled / SECTION_KEYS.length) * 100);

  return {
    matchId: match && match.id,
    fixtureId: options.fixtureId || null,
    resolution: options.resolution || null,
    sections,
    filledSections: filled,
    totalSections: SECTION_KEYS.length,
    coverage,
    // Eşikler rapor katmanıyla aynı doktrini izliyor.
    dataStatus: coverage >= 70 ? "complete" : coverage > 0 ? "partial" : "unavailable",
    observedAt,
    // Kısmi kapsamda okuyucuya gösterilecek tek cümle.
    partialMessage: coverage === 100
      ? null
      : partialMessage(sections)
  };
}

/**
 * Kısmi veri mesajı — hangi bölümlerin beklendiğini ADIYLA söyler.
 *
 * "Bazı veriler eksik" demek okuyucuya bilgi vermiyor; hangi bölümün
 * neden boş olduğunu bilmek, sayfanın bozuk mu yoksa veri mi beklediğini
 * ayırt etmesini sağlıyor.
 */
function partialMessage(sections) {
  const missing = SECTION_KEYS
    .filter((key) => sections[key] && sections[key].status !== "ready")
    .map((key) => sections[key].label);

  if (!missing.length) return null;
  if (missing.length === SECTION_KEYS.length) {
    return "Bu maç için sağlayıcıdan henüz doğrulanmış maç sonu verisi gelmedi. " +
      "Veri ulaştığında rapor otomatik olarak genişler.";
  }

  return `Şu bölümler için doğrulanmış veri bekleniyor: ${missing.join(", ")}. ` +
    "Eksik veriler tahminle doldurulmuyor; sağlayıcıdan geldiğinde bölüm otomatik açılır.";
}

/**
 * Yazma güvenliği: yarım bir çekim mevcut zenginleştirmeyi EZMEZ.
 *
 * Kadro ve istatistik senkronundaki doktrinin aynısı. Sağlayıcı geçici
 * olarak boş döndüğünde, elde daha dolu bir kayıt varken onu silmek
 * "güncelleme" değil kayıptır.
 */
function shouldReplaceEnrichment(previous, next) {
  if (!previous) return { replace: true, reason: "ilk kayıt" };
  if (!next) return { replace: false, reason: "yeni kayıt yok" };
  if (next.filledSections >= previous.filledSections) {
    return { replace: true, reason: "kapsam korundu veya arttı" };
  }
  // Kürasyon müdahalesi kapsamı bilinçli olarak azaltabilir.
  const manualSections = Object.values(next.sections || {}).filter((section) => section.overridden).length;
  if (manualSections > 0) {
    return { replace: true, reason: "kürasyon müdahalesi var" };
  }
  return {
    replace: false,
    reason: `kapsam düştü (${previous.filledSections} → ${next.filledSections})`
  };
}

module.exports = {
  SECTIONS,
  SECTION_KEYS,
  PROVIDER_NAME,
  isCompleted,
  teamsMatch,
  resolveProviderFixture,
  normalizeEvents,
  normalizeGoals,
  normalizeLineups,
  normalizeTeamStats,
  normalizePlayerStats,
  applyOverride,
  buildEnrichment,
  partialMessage,
  shouldReplaceEnrichment
};
