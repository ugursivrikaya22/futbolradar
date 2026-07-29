/**
 * MAÇ SONRASI DERİN ANALİZ ÇEKİRDEĞİ — 96 saatlik kayan pencere sistemi.
 *
 * Bu modül mevcut rapor hattının (matchReportService + postMatchIntelligence)
 * ÜZERİNE oturur, onu kopyalamaz. Üç yeni sorumluluğu var:
 *
 *   1. VERİ KAPSAMI KAPISI — her tamamlanmış maç için 0-100 arası ağırlıklı
 *      bir kapsam puanı ve ondan türeyen analiz seviyesi:
 *        80-100  deep       "Derin Analiz"
 *        50-79   standard   "Standart Analiz"
 *        20-49   limited    "Sınırlı Analiz"
 *         0-19   score-only "Skor Özeti"
 *      Eşik tutmayan rapor hiçbir koşulda "Derin Analiz" etiketi alamaz.
 *
 *   2. MOMENTUM TÜRÜ AYRIMI — dakika bazlı canlı anlık görüntü yoksa momentum
 *      "olay bazlı"dır ve bu açıkça yazılır; yeterli yoğunlukta beş dakikalık
 *      anlık görüntü birikmişse "ölçülmüş canlı veri" moduna geçilir. Olay
 *      bazlı momentum ASLA ölçülmüş baskı gibi sunulmaz.
 *
 *   3. TAKTİK DEĞİŞİKLİK MOTORU — oyuncu değişikliği, kırmızı kart ve o anki
 *      skor durumundan İHTİYATLI çıkarımlar üretir. Her çıkarım kanıtını,
 *      güven düzeyini ve ölçülmüş mü / çıkarsanmış mı olduğunu taşır. Veri
 *      kanıtlamadıkça yeni diziliş şekli İDDİA EDİLMEZ.
 *
 * UYDURMA YOK: xG, topa sahip olma, şut, oyuncu puanı, diziliş, teknik
 * direktör, seyirci, toplam skor gibi hiçbir değer burada üretilmez; yalnızca
 * kayıtta ölçülü olarak var olan veri okunur. Eksik alan sıfıra çevrilmez,
 * "sınırlama" olarak raporlanır.
 */

const { normalizeText } = require("./matchRadarService");

// ── Kapsam ağırlıkları ──────────────────────────────────────────────────────
// Toplam 100. Oyuncu bazlı maç istatistiği sağlayıcı zenginleştirmesinden
// gelir (data/match-enrichment.json); kürasyonlu kayıtta yoksa o 25 puan
// alınamaz — bu bilinçli: oyuncu verisi olmayan rapor "derin" sayılmaz.
const COVERAGE_WEIGHTS = Object.freeze({
  resultMeta: 10,
  events: 20,
  lineups: 20,
  teamStats: 25,
  playerStats: 25
});

const LEVELS = Object.freeze([
  { level: "deep", label: "Derin Analiz", min: 80, indexable: true },
  { level: "standard", label: "Standart Analiz", min: 50, indexable: true },
  { level: "limited", label: "Sınırlı Analiz", min: 20, indexable: false },
  { level: "score-only", label: "Skor Özeti", min: 0, indexable: false }
]);

function isNumber(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function statRow(match, aliases) {
  const wanted = aliases.map((alias) => normalizeText(alias));
  return (Array.isArray(match.statistics) ? match.statistics : [])
    .find((row) => wanted.includes(normalizeText(row.type))) || null;
}

function statPair(match, aliases) {
  const row = statRow(match, aliases);
  if (!row || !isNumber(row.home) || !isNumber(row.away)) return null;
  return { home: Number(row.home), away: Number(row.away), label: row.type, unit: row.unit || "" };
}

// ── 1. Veri kapsamı kapısı ──────────────────────────────────────────────────

/**
 * Ağırlıklı kapsam puanı. `extras.playerStats` sağlayıcı zenginleştirme
 * kaydından gelir (oyuncu bazlı istatistik bölümü hazır mı) — kürasyonlu
 * maç kaydının kendisinde oyuncu bazlı satır bulunmaz.
 */
function assessCoverage(match, extras = {}) {
  const breakdown = {};

  // Sonuç ve künye: skor + başlama saati + iki takım + lig.
  const hasResult = String(match.status || "").toUpperCase() === "FINISHED" &&
    match.score && isNumber(match.score.home) && isNumber(match.score.away);
  const metaBits = [match.kickoff, match.homeTeam, match.awayTeam, match.league].filter(Boolean).length;
  breakdown.resultMeta = hasResult ? Math.round(COVERAGE_WEIGHTS.resultMeta * clamp01(metaBits / 4)) : 0;

  // Olay akışı: dakikalı olay sayısına göre ölçeklenir (5 olay = tam puan).
  const timedEvents = (Array.isArray(match.events) ? match.events : [])
    .filter((event) => event && event.time && (event.type || event.detail)).length;
  breakdown.events = Math.round(COVERAGE_WEIGHTS.events * clamp01(timedEvents / 5));

  // İlk 11 + diziliş: taraf başına 10 puan (kadro 7, diziliş 3).
  let lineupPoints = 0;
  const lineups = Array.isArray(match.lineups) ? match.lineups : [];
  for (const side of [match.homeTeam, match.awayTeam]) {
    const lineup = lineups.find((row) => row && normalizeText(row.team) === normalizeText(side));
    if (lineup && Array.isArray(lineup.players) && lineup.players.length >= 10) {
      lineupPoints += 7;
      if (lineup.formation) lineupPoints += 3;
    }
  }
  breakdown.lineups = Math.min(COVERAGE_WEIGHTS.lineups, lineupPoints);

  // Takım istatistikleri: 8 ölçülü satır = tam puan.
  const statRows = (Array.isArray(match.statistics) ? match.statistics : [])
    .filter((row) => row && isNumber(row.home) && isNumber(row.away)).length;
  breakdown.teamStats = Math.round(COVERAGE_WEIGHTS.teamStats * clamp01(statRows / 8));

  // Oyuncu bazlı istatistik: yalnızca sağlayıcı destekliyse.
  breakdown.playerStats = extras.playerStats ? COVERAGE_WEIGHTS.playerStats : 0;

  const score = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  return { score: Math.max(0, Math.min(100, score)), breakdown };
}

function levelFor(score) {
  const found = LEVELS.find((entry) => score >= entry.min) || LEVELS[LEVELS.length - 1];
  return { level: found.level, label: found.label, indexable: found.indexable };
}

/** Skor özeti ve sınırlı raporlar dizine girmez: düşük değerli SEO sayfası üretilmez. */
function robotsFor(level) {
  return level === "deep" || level === "standard" ? "index,follow" : "noindex,follow";
}

/**
 * Güven düzeyi kapsamdan AYRI bir eksen: kapsam "ne kadar veri var" sorusu,
 * güven "bu veri ne kadar doğrulanmış" sorusudur.
 */
function confidenceFor(match, coverageScore) {
  const verified = match.dataStatus === "verified" || match.source === "manual_verified";
  const sourced = Array.isArray(match.sourceUrls) && match.sourceUrls.length > 0;
  if (verified && sourced && coverageScore >= 50) {
    return { level: "yüksek", reason: "Elle doğrulanmış kayıt, kaynak bağlantılı ve kapsam yeterli." };
  }
  if ((verified || sourced) && coverageScore >= 20) {
    return { level: "orta", reason: "Kayıt doğrulanmış ancak kapsam veya kaynak zinciri eksik." };
  }
  return { level: "düşük", reason: "Yalnızca sağlayıcı skoru; ayrıntı verisi doğrulanmadı." };
}

/** Eksik veri blokları okuyucuya açıkça yazılır — hiçbir eksik gizlenmez. */
function limitationsFor(match, coverage, extras = {}) {
  const items = [];
  const { breakdown } = coverage;

  if (breakdown.events < COVERAGE_WEIGHTS.events) {
    items.push(breakdown.events === 0
      ? "Dakikalı olay akışı (gol, kart, değişiklik) bu maç için doğrulanamadı."
      : "Olay akışı kısmi; bazı dakikalar doğrulanmış kayıtta yer almıyor.");
  }
  if (breakdown.lineups < COVERAGE_WEIGHTS.lineups) {
    items.push(breakdown.lineups === 0
      ? "Başlangıç kadroları ve dizilişler doğrulanmış kayıtta yok."
      : "Kadro bilgisi kısmi; en az bir tarafın dizilişi doğrulanamadı.");
  }
  if (breakdown.teamStats < COVERAGE_WEIGHTS.teamStats) {
    items.push(breakdown.teamStats === 0
      ? "Takım istatistikleri (şut, topa sahip olma, pas) bu maç için alınamadı."
      : "Takım istatistiklerinin bir bölümü eksik; yalnızca ölçülen satırlar gösteriliyor.");
  }
  if (!breakdown.playerStats) {
    items.push("Oyuncu bazlı maç istatistikleri sağlayıcıdan alınamadı; oyuncu etki okuması gol/kart olaylarıyla sınırlı.");
  }
  if (!statPair(match, ["Gol beklentisi (xG)", "expected_goals", "Expected Goals"])) {
    items.push("Sağlayıcı destekli xG verisi yok; şut kalitesi xG üzerinden yorumlanmıyor ve xG hesaplanmıyor.");
  }
  if ((extras.snapshotCount || 0) < MIN_MEASURED_BUCKETS) {
    items.push("Dakika bazlı canlı baskı ölçümü kaydedilmedi; momentum olay akışından türetiliyor.");
  }
  return items;
}

// ── 2. Momentum türü ────────────────────────────────────────────────────────

/** Ölçülmüş momentum için gereken en az beş dakikalık anlık görüntü sayısı. */
const MIN_MEASURED_BUCKETS = 6;

const EVENT_MOMENTUM_NOTE =
  "Dakika bazlı canlı baskı verisi bulunmadığı için momentum; gol, kart, " +
  "oyuncu değişikliği ve skor kırılmalarından oluşturulmuştur.";

/**
 * `snapshots`: services/liveSnapshotService.js deposundaki maç girdisi
 * (yoksa null). Yoğunluk yetersizse otomatik olarak olay bazlı moda düşülür.
 */
function momentumModeFor(match, snapshotEntry) {
  const buckets = snapshotEntry && Array.isArray(snapshotEntry.buckets) ? snapshotEntry.buckets : [];
  if (buckets.length >= MIN_MEASURED_BUCKETS) {
    return {
      mode: "measured",
      label: "Momentum türü: Ölçülmüş canlı veri",
      note: `Maç sırasında ${buckets.length} adet beş dakikalık kümülatif istatistik anlık görüntüsü kaydedildi; ` +
        "baskı okuması ardışık görüntülerin farklarından hesaplanıyor.",
      bucketCount: buckets.length
    };
  }
  return {
    mode: "event",
    label: "Momentum türü: Olay bazlı",
    note: EVENT_MOMENTUM_NOTE,
    bucketCount: buckets.length
  };
}

// ── 3. Taktik değişiklik motoru ─────────────────────────────────────────────

const ATTACK_GROUPS = new Set(["forward", "winger"]);
const DEFENCE_GROUPS = new Set(["defender", "goalkeeper"]);

function parseMinute(value) {
  const match = String(value || "").match(/^(\d+)(?:\+(\d+))?/);
  if (!match) return null;
  return Number(match[1]) + (match[2] ? Number(match[2]) / 100 : 0);
}

/** O dakikadaki skor durumu, dakikalı gol olaylarından yeniden kurulur. */
function scoreStateAt(match, minute) {
  let home = 0;
  let away = 0;
  for (const event of Array.isArray(match.events) ? match.events : []) {
    if (!/gol/i.test(String(event.type || "")) || /iptal/i.test(String(event.type || ""))) continue;
    const eventMinute = parseMinute(event.time);
    if (eventMinute === null || eventMinute > minute) continue;
    const team = event.team && (event.team.name || event.team);
    if (normalizeText(team) === normalizeText(match.homeTeam)) home += 1;
    else if (normalizeText(team) === normalizeText(match.awayTeam)) away += 1;
  }
  return { home, away };
}

function positionOf(name, playersByName) {
  if (!playersByName) return null;
  return playersByName.get(normalizeText(name)) || null;
}

/**
 * Skor durumuna göre taraf etiketi: değişikliği yapan takım o anda önde mi,
 * geride mi, berabere mi?
 */
function standingFor(team, match, state) {
  const isHome = normalizeText(team) === normalizeText(match.homeTeam);
  const own = isHome ? state.home : state.away;
  const other = isHome ? state.away : state.home;
  if (own > other) return "önde";
  if (own < other) return "geride";
  return "berabere";
}

/**
 * Tek bir oyuncu değişikliğinden ihtiyatlı çıkarım. Kesin diziliş iddiası
 * YOK; yalnızca rol gruplarından ve skor durumundan olası amaç yazılır.
 */
function interpretSubstitution(sub, match, playersByName, snapshotEntry) {
  const minute = parseMinute(sub.time);
  const state = minute === null ? null : scoreStateAt(match, minute);
  const inPlayer = positionOf(sub.in, playersByName);
  const outPlayer = positionOf(sub.out, playersByName);
  const evidence = [
    `${sub.time} ${sub.team}: ${sub.in} girdi, ${sub.out} çıktı.`
  ];
  let purpose = null;
  let confidence = "düşük";

  if (state) {
    const standing = standingFor(sub.team, match, state);
    evidence.push(`Değişiklik anında skor ${state.home}-${state.away} (${sub.team} ${standing}).`);

    if (inPlayer && outPlayer) {
      const inGroup = inPlayer.positionGroup;
      const outGroup = outPlayer.positionGroup;
      evidence.push(`Rol verisi: ${sub.in} (${inPlayer.position || inGroup}), ${sub.out} (${outPlayer.position || outGroup}).`);
      confidence = "orta";

      if (ATTACK_GROUPS.has(inGroup) && DEFENCE_GROUPS.has(outGroup)) {
        purpose = standing === "geride"
          ? "Geride olan takımın savunma oyuncusu yerine hücumcu alması, daha riskli bir yapıya yöneldiğine işaret ediyor."
          : "Savunma oyuncusu yerine hücumcu alınması, hücum yükünü artırma muhtemel amacına işaret ediyor.";
      } else if (DEFENCE_GROUPS.has(inGroup) && ATTACK_GROUPS.has(outGroup)) {
        purpose = standing === "önde"
          ? "Önde olan takımın hücumcu yerine savunma oyuncusu alması, skoru koruma muhtemel amacına işaret ediyor."
          : "Hücumcu yerine savunma oyuncusu alınması, oyunun kontrolünü sağlamlaştırma muhtemel amacına işaret ediyor.";
      } else if (inGroup === "winger" && outGroup === "midfielder") {
        purpose = "Merkez orta saha yerine kanat oyuncusu alınması, oyunu genişletme muhtemel amacına işaret ediyor.";
      } else if (inGroup === "midfielder" && ATTACK_GROUPS.has(outGroup) && standing === "önde") {
        purpose = "Önde olan takımın hücumcu yerine orta saha alması, top kontrolüyle skoru koruma muhtemel amacına işaret ediyor.";
      } else if (inGroup === outGroup) {
        purpose = "Aynı rol grubunda tazeleme; oyun planında köklü bir değişikliğe dair veri yok.";
        confidence = "orta";
      }
    }
  }

  if (!purpose) {
    purpose = "Değişikliğin taktik amacı eldeki rol ve skor verisiyle kesinleştirilemiyor.";
    confidence = inPlayer && outPlayer ? confidence : "düşük";
  }

  // Ölçülmüş etki yalnızca anlık görüntü varsa yazılır; "sonradan gol geldi,
  // demek ki işe yaradı" çıkarımı bilinçli olarak YOK.
  let measuredEffect = "Değişiklik sonrası baskı değişimi verilerle kesinleştirilemiyor (canlı anlık görüntü yok).";
  let type = "inferred";
  if (snapshotEntry && Array.isArray(snapshotEntry.buckets) && minute !== null) {
    const before = snapshotEntry.buckets.filter((b) => b.minute >= minute - 10 && b.minute < minute);
    const after = snapshotEntry.buckets.filter((b) => b.minute >= minute && b.minute <= minute + 10);
    if (before.length && after.length) {
      type = "measured";
      measuredEffect = "Değişiklik öncesi ve sonrası beş dakikalık ölçümler karşılaştırıldı; ayrıntı momentum bölümünde.";
      evidence.push(`Ölçüm penceresi: değişiklikten önce ${before.length}, sonra ${after.length} anlık görüntü.`);
    }
  }

  return {
    minute: sub.time,
    team: sub.team,
    change: `${sub.in} girdi, ${sub.out} çıktı`,
    likelyPurpose: purpose,
    measuredEffect,
    evidence,
    confidence,
    type
  };
}

function interpretRedCard(event, match) {
  const minute = parseMinute(event.time);
  const state = minute === null ? null : scoreStateAt(match, minute);
  const team = event.team && (event.team.name || event.team);
  const evidence = [`${event.time} ${team}: kırmızı kart — ${event.detail || "ayrıntı doğrulanmadı"}.`];
  if (state) evidence.push(`Kart anında skor ${state.home}-${state.away}.`);
  return {
    minute: event.time,
    team,
    change: "Kırmızı kart — takım 10 kişi kaldı",
    likelyPurpose: "Eksik kalan takımın daha alçak bir savunma bloğuna çekilmesi muhtemel; kesin yapı verilerle doğrulanamıyor.",
    measuredEffect: "Sayısal eksikliğin baskıya etkisi canlı ölçüm olmadan kesinleştirilemiyor.",
    evidence,
    confidence: "orta",
    type: "inferred"
  };
}

/**
 * Maçın taktik değişiklik listesi. Girdi yoksa boş dizi döner — bölüm hiç
 * basılmaz, boş başlık üretilmez.
 */
function tacticalChangesFor(match, options = {}) {
  const { playersByName = null, snapshotEntry = null } = options;
  const changes = [];

  const subs = Array.isArray(match.substitutions) ? match.substitutions : [];
  const halftimeSubs = subs.filter((sub) => parseMinute(sub.time) !== null && parseMinute(sub.time) <= 46);
  const halftimeByTeam = new Map();
  for (const sub of halftimeSubs) {
    halftimeByTeam.set(sub.team, (halftimeByTeam.get(sub.team) || 0) + 1);
  }

  for (const [team, count] of halftimeByTeam) {
    if (count >= 2) {
      changes.push({
        minute: "46'",
        team,
        change: `Devre arasında ${count} oyuncu değişikliği`,
        likelyPurpose: "Devre arasında birden fazla değişiklik, başlangıç planının en azından kısmen terk edildiğine işaret ediyor.",
        measuredEffect: "İkinci yarı etkisi ayrı ölçüm olmadan kesinleştirilemiyor.",
        evidence: halftimeSubs.filter((sub) => sub.team === team).map((sub) => `${sub.time} ${sub.in} ⇄ ${sub.out}`),
        confidence: "orta",
        type: "inferred"
      });
    }
  }

  for (const sub of subs) {
    changes.push(interpretSubstitution(sub, match, playersByName, snapshotEntry));
  }

  for (const event of Array.isArray(match.events) ? match.events : []) {
    if (/kırmızı/i.test(String(event.type || ""))) {
      changes.push(interpretRedCard(event, match));
    }
  }

  return changes;
}

// ── 4. Sonuç oyunu yansıttı mı? ─────────────────────────────────────────────

/**
 * Skor ile ölçülmüş üstünlük göstergelerini karşılaştırır. En az şut ve
 * isabet verisi olmadan hüküm ÜRETİLMEZ (null döner).
 */
function resultVsPerformanceFor(match) {
  const shots = statPair(match, ["Toplam şut", "Total Shots"]);
  const onTarget = statPair(match, ["İsabetli şut", "Shots on Goal", "Shots on Target"]);
  if (!shots || !onTarget || !match.score || !isNumber(match.score.home) || !isNumber(match.score.away)) {
    return null;
  }

  const possession = statPair(match, ["Topla oynama", "Ball Possession"]);
  const saves = statPair(match, ["Kaleci kurtarışı", "Goalkeeper Saves"]);
  const home = Number(match.score.home);
  const away = Number(match.score.away);
  const evidence = [
    `Skor ${home}-${away}; toplam şut ${shots.home}-${shots.away}, isabet ${onTarget.home}-${onTarget.away}.`
  ];
  if (possession) evidence.push(`Topa sahip olma %${possession.home} - %${possession.away}.`);
  if (saves) evidence.push(`Kaleci kurtarışı ${saves.home}-${saves.away}.`);

  const shotEdge = onTarget.home - onTarget.away;
  const scoreEdge = home - away;
  let verdict;
  if ((scoreEdge > 0 && shotEdge > 0) || (scoreEdge < 0 && shotEdge < 0) || (scoreEdge === 0 && Math.abs(shotEdge) <= 1)) {
    verdict = "Skor, isabetli şut üstünlüğüyle aynı yönde: sonuç sahadaki ölçülebilir üstünlüğü büyük ölçüde yansıtıyor.";
  } else if (scoreEdge === 0) {
    verdict = "Beraberliğe rağmen isabetli şut dengesi bir tarafa eğiliyor: ölçümler, skorun anlattığından daha üstün bir taraf olduğuna işaret ediyor.";
  } else {
    verdict = "Skor ile isabetli şut üstünlüğü ters yönde: sonuç, ölçülen baskı dağılımının doğal karşılığı değil; bitiricilik ve kaleci katkısı belirleyici olmuş görünüyor.";
  }
  if (saves && Math.max(saves.home, saves.away) >= 4) {
    const keeperSide = saves.home > saves.away ? match.homeTeam : match.awayTeam;
    evidence.push(`${keeperSide} kalecisinin kurtarış hacmi skoru dar tutan ölçülebilir etkenlerden.`);
  }

  return { verdict, evidence };
}

// ── 5. Görünürlük önceliği ──────────────────────────────────────────────────
// Popülerlik RAPOR ÜRETİMİNİ asla belirlemez; yalnızca liste sırasını
// belirler. Küçük sayı = önce gösterilir.

const COMPETITION_PRIORITY = [
  { match: /şampiyonlar ligi|champions league/i, rank: 2, label: "Şampiyonlar Ligi" },
  { match: /avrupa ligi|europa league/i, rank: 3, label: "Avrupa Ligi" },
  { match: /konferans|conference/i, rank: 4, label: "Konferans Ligi" },
  { match: /süper lig|super lig/i, rank: 5, label: "Süper Lig" },
  { match: /premier league|la liga|laliga|bundesliga|serie a|ligue 1/i, rank: 6, label: "Büyük Avrupa ligi" },
  { match: /hazırlık|friendly/i, rank: 8, label: "Hazırlık maçı" }
];

function displayPriorityFor(match, turkishTeams) {
  const involvesTurkish = [match.homeTeam, match.awayTeam].some((team) =>
    (turkishTeams || []).some((name) => normalizeText(name) === normalizeText(team)));
  if (involvesTurkish) return { rank: 1, label: "Türk takımı" };

  const league = String(match.league || "");
  for (const entry of COMPETITION_PRIORITY) {
    if (entry.match.test(league)) return { rank: entry.rank, label: entry.label };
  }
  return { rank: 7, label: "Takip edilen diğer turnuva" };
}

/** Liste sırası: önce öncelik sınıfı, sınıf içinde en yeni maç. */
function sortForDisplay(entries) {
  return [...entries].sort((left, right) =>
    left.priority.rank - right.priority.rank ||
    String(right.match.kickoff || "").localeCompare(String(left.match.kickoff || "")));
}

// ── 6. Normalize model ──────────────────────────────────────────────────────

/**
 * Spesifikasyondaki normalize rapor modeli. Mevcut şemaları DEĞİŞTİRMEZ;
 * kürasyonlu kayıttan türetilmiş, üst katmanların (sayfa üreticisi, uç
 * nokta) ortak okuduğu görünümdür.
 */
function buildDeepModel(match, options = {}) {
  const {
    enrichment = null,
    snapshotEntry = null,
    playersByName = null,
    turkishTeams = [],
    now = null
  } = options;

  const playerStatsReady = Boolean(
    enrichment && enrichment.sections && enrichment.sections.playerStats &&
    enrichment.sections.playerStats.status === "ready"
  );
  const coverage = assessCoverage(match, {
    playerStats: playerStatsReady,
    snapshotCount: snapshotEntry && snapshotEntry.buckets ? snapshotEntry.buckets.length : 0
  });
  const level = levelFor(coverage.score);
  const confidence = confidenceFor(match, coverage.score);
  const momentum = momentumModeFor(match, snapshotEntry);
  const limitations = limitationsFor(match, coverage, {
    snapshotCount: snapshotEntry && snapshotEntry.buckets ? snapshotEntry.buckets.length : 0
  });

  const dateStamp = String(match.kickoff || "").slice(0, 10);
  return {
    fixtureId: match.providerId || match.id,
    matchId: match.id,
    slug: `${normalizeText(match.homeTeam).replace(/[^a-z0-9]+/g, "-")}-${normalizeText(match.awayTeam).replace(/[^a-z0-9]+/g, "-")}-${dateStamp}`,
    status: String(match.status || "").toUpperCase(),
    kickoffAt: match.kickoff || null,
    analysis: {
      level: level.level,
      levelLabel: level.label,
      indexable: level.indexable,
      coverageScore: coverage.score,
      coverageBreakdown: coverage.breakdown,
      confidence: confidence.level,
      confidenceReason: confidence.reason,
      momentum,
      tacticalChanges: tacticalChangesFor(match, { playersByName, snapshotEntry }),
      resultVsPerformance: resultVsPerformanceFor(match),
      limitations
    },
    priority: displayPriorityFor(match, turkishTeams),
    dataAsOf: match.lastVerifiedAt || match.fetchedAt || null,
    generatedAt: now,
    analysisVersion: 1
  };
}

// ── 7. Yayın günlüğü (Article tarihleri) ────────────────────────────────────

/**
 * datePublished raporun İLK üretim anıdır ve değişmez (geri tarihleme yok);
 * dateModified yalnızca içerik özeti (hash) değiştiğinde ilerler. Günlük
 * girdisi yerinde güncellenir, sayfada kullanılacak tarih çifti döner.
 */
function publishDatesFor(log, seoPath, hash, nowIso) {
  const existing = log[seoPath];
  if (!existing) {
    log[seoPath] = { firstPublishedAt: nowIso, lastModifiedAt: nowIso, contentHash: hash };
  } else if (existing.contentHash !== hash) {
    log[seoPath] = { ...existing, lastModifiedAt: nowIso, contentHash: hash };
  }
  return {
    datePublished: log[seoPath].firstPublishedAt,
    dateModified: log[seoPath].lastModifiedAt
  };
}

/** data/players.json listesini isim → {position, positionGroup} sözlüğüne çevirir. */
function playersByNameIndex(players) {
  const index = new Map();
  for (const player of Array.isArray(players) ? players : []) {
    if (!player || !player.name) continue;
    index.set(normalizeText(player.name), {
      position: player.position || null,
      positionGroup: player.positionGroup || null
    });
  }
  return index;
}

module.exports = {
  COVERAGE_WEIGHTS,
  MIN_MEASURED_BUCKETS,
  EVENT_MOMENTUM_NOTE,
  assessCoverage,
  levelFor,
  robotsFor,
  confidenceFor,
  limitationsFor,
  momentumModeFor,
  tacticalChangesFor,
  resultVsPerformanceFor,
  displayPriorityFor,
  sortForDisplay,
  buildDeepModel,
  playersByNameIndex,
  publishDatesFor,
  scoreStateAt,
  parseMinute
};
