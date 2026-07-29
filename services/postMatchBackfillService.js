/**
 * 96 SAATLİK KAYAN PENCERE — maç sonu rapor kapsayıcısının saf mantığı.
 *
 * Kural: FutbolRadar'ın takip ettiği ve son 96 saat içinde TAMAMLANMIŞ
 * (FT/AET/PEN → FINISHED) her karşılaşmanın bir rapor kimliği olmalı.
 * Pencere her koşuda "şimdi"den geriye hesaplanır; sabit tarih listesi YOK.
 *
 * İki kaynak birleşir:
 *   - data/matches.json      (kürasyonlu/zengin kayıtlar)
 *   - data/fixture-calendar.json (TheSportsDB doğrulanmış sonuç takvimi)
 *
 * Kürasyonda karşılığı olmayan, penceredeki tamamlanmış takvim maçları
 * matches.json'a SAĞLAYICI KAYNAKLI asgari kayıt olarak terfi ettirilir:
 * yalnızca sağlayıcının gerçekten döndürdüğü alanlar taşınır (skor, saat,
 * lig, saha). Olay/kadro/istatistik UYDURULMAZ — kapsam kapısı bu kayıtları
 * dürüstçe "Skor Özeti" seviyesinde raporlar.
 *
 * Idempotentlik: kimlik, takım çifti + tarih üzerinden (ev/deplasman sırasına
 * duyarsız) kurulur; aynı maç ikinci kez eklenmez, koşuyu tekrarlamak yeni
 * sayfa üretmez, mevcut raporu günceller.
 */

const { normalizeText } = require("./matchRadarService");

/** Başlama vuruşundan tahmini bitişe: 90 dk + devre arası + ortalama uzatma. */
const FULL_TIME_MINUTES = 135;

const WINDOW_HOURS_DEFAULT = 96;

/** Rapor üretimine hiçbir koşulda giremeyecek durumlar. */
const EXCLUDED_STATUSES = new Set([
  "SCHEDULED", "TIMED", "POSTPONED", "CANCELLED", "LIVE", "HALFTIME",
  // Sağlayıcı kısa kodları da güvenlik için reddedilir (normalize edilmemiş
  // bir kayıt sızarsa bitmemiş maça rapor açılmasın).
  "NS", "TBD", "PST", "CANC", "ABD", "INT", "SUSP", "1H", "2H", "ET", "P", "HT", "BT"
]);

function isNumber(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function windowFor(nowMs, hours = WINDOW_HOURS_DEFAULT) {
  return { startMs: nowMs - hours * 60 * 60 * 1000, endMs: nowMs };
}

/** Tamamlanma anı sağlayıcıda yok; başlama + tam maç süresi ile kestirilir. */
function estimatedEndMs(match) {
  const kickoff = Date.parse(match && match.kickoff ? match.kickoff : "");
  if (!Number.isFinite(kickoff)) return null;
  return kickoff + FULL_TIME_MINUTES * 60 * 1000;
}

function isFinished(match) {
  const status = String((match && match.status) || "").toUpperCase();
  if (EXCLUDED_STATUSES.has(status)) return false;
  return status === "FINISHED" || ["FT", "AET", "PEN"].includes(status);
}

/**
 * Pencere uygunluğu: bitmiş + doğrulanmış skorlu + tahmini bitişi pencere
 * içinde. Skorsuz "bitmiş" kayıt rapor kimliği alamaz — skor uydurulmaz.
 */
function isEligible(match, window) {
  if (!isFinished(match)) return false;
  const score = match && match.score;
  if (!score || !isNumber(score.home) || !isNumber(score.away)) return false;
  const endMs = estimatedEndMs(match);
  if (endMs === null) return false;
  return endMs >= window.startMs && endMs <= window.endMs;
}

function matchDateOnly(match) {
  return String((match && match.kickoff) || "").slice(0, 10);
}

/**
 * Ev/deplasman sırasına DUYARSIZ kimlik: kaynaklar tarafları farklı
 * sıralayabildiği için sıralı anahtar aynı maçı iki kez geçirirdi.
 */
function identityOf(match) {
  const pair = [normalizeText(match && match.homeTeam), normalizeText(match && match.awayTeam)].sort();
  return `${pair[0]}|${pair[1]}|${matchDateOnly(match)}`;
}

/**
 * Takvimdeki tamamlanmış maçları kürasyon listesine terfi ettirir.
 * Mevcut kayıtlara ASLA dokunulmaz; yalnızca eksik olanlar eklenir.
 */
function promoteCalendarFixtures(curated, calendarMatches, window, nowIso) {
  const known = new Set((curated || []).map(identityOf));
  const additions = [];
  const skipped = [];

  for (const fixture of calendarMatches || []) {
    if (!isFinished(fixture)) {
      skipped.push({ id: fixture.id || identityOf(fixture), reason: `durum uygun değil (${fixture.status})` });
      continue;
    }
    if (!isEligible(fixture, window)) {
      skipped.push({ id: fixture.id || identityOf(fixture), reason: "96 saatlik pencere dışında ya da skor doğrulanmadı" });
      continue;
    }
    const identity = identityOf(fixture);
    if (known.has(identity)) {
      skipped.push({ id: fixture.id || identity, reason: "kürasyonlu kayıt zaten var (idempotent atlama)" });
      continue;
    }
    known.add(identity);

    // Yalnızca sağlayıcının GERÇEKTEN döndürdüğü alanlar. Analiz, olay,
    // kadro ve istatistik alanları bilinçli olarak boş: kapsam kapısı bu
    // kaydı "Skor Özeti" olarak etiketler ve sayfa dizine kapalı kalır.
    additions.push({
      id: fixture.id || identity.replace(/[^a-z0-9|-]+/g, "-").replace(/\|/g, "-"),
      providerId: fixture.providerId || null,
      providerIds: fixture.providerIds || undefined,
      competitionId: fixture.competitionId || null,
      league: fixture.league || null,
      kickoff: fixture.kickoff,
      time: fixture.time || null,
      venue: fixture.venue || null,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      status: "FINISHED",
      score: {
        home: Number(fixture.score.home),
        away: Number(fixture.score.away)
      },
      lineups: [],
      substitutions: [],
      events: [],
      statistics: [],
      prediction: null,
      source: fixture.source || "thesportsdb",
      sourceName: "TheSportsDB doğrulanmış sonuç kaydı",
      sourceUrls: Array.isArray(fixture.sourceUrls) ? fixture.sourceUrls : [],
      fetchedAt: nowIso,
      lastVerifiedAt: nowIso,
      dataStatus: "provider",
      confidence: 0.6,
      needsReview: false
    });
  }

  return { additions, skipped };
}

/**
 * Koşunun yapılandırılmış yürütme raporu — zamanlanmış işin dönüş sözleşmesi.
 */
function buildExecutionReport({ window, curated, calendar, promotion, providerCalls, notes }) {
  const curatedEligible = (curated || []).filter((match) => isEligible(match, window));
  return {
    windowStart: new Date(window.startMs).toISOString(),
    windowEnd: new Date(window.endMs).toISOString(),
    windowHours: Math.round((window.endMs - window.startMs) / 3600000),
    curatedEligible: curatedEligible.map((match) => match.id),
    calendarDiscovered: (calendar || []).length,
    promoted: promotion.additions.map((match) => match.id),
    skipped: promotion.skipped,
    providerCalls: providerCalls || { used: 0, cacheHits: 0, batches: 0, remaining: null },
    notes: notes || []
  };
}

module.exports = {
  WINDOW_HOURS_DEFAULT,
  FULL_TIME_MINUTES,
  EXCLUDED_STATUSES,
  windowFor,
  estimatedEndMs,
  isFinished,
  isEligible,
  identityOf,
  promoteCalendarFixtures,
  buildExecutionReport
};
