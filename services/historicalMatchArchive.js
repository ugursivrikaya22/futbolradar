const { isAnalyzableMatch, isUnplayedStatus } = require("./matchStatus");
const { nationKey } = require("./displayLabels");

const COVERAGE = Object.freeze({ FULL: "FULL", STANDARD: "STANDARD", LIMITED: "LIMITED" });
const WORKFLOW = Object.freeze({ COMPLETE: "complete", LIMITED: "limited_complete", REVIEW: "needs_manual_review" });

function text(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

function number(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
}

function teamKey(value) {
  // Millî takım "Italy" / "İtalya" gibi iki dilde gelebiliyor; aynı maç iki
  // kimlik almasın diye ülke adı tek anahtara indirilir.
  const nation = nationKey(value);
  if (nation) return nation;
  return text(value).toLocaleLowerCase("tr-TR")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i").replace(/[^a-z0-9]+/g, "");
}

function istanbulDay(value) {
  const raw = text(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(date);
}

function hasScore(match) {
  const score = match && match.score;
  return Boolean(score) && number(score.home) !== null && number(score.away) !== null;
}

function matchId(match) {
  return text(match && (match.id || match.matchId || match.slug || match.fixtureId));
}

function identity(match) {
  return [teamKey(match && match.homeTeam), teamKey(match && match.awayTeam), istanbulDay(match && (match.kickoff || match.date)), teamKey(match && (match.competition || match.league))].join("|");
}

function providerResponseStatus(response) {
  const rows = Array.isArray(response) ? response : (response && (response.response || response.data));
  if (!Array.isArray(rows) || !rows.length) return { ok: false, reason: "provider-empty-response" };
  return { ok: true, rows };
}

function verifyProviderIdentity(match, providerFixture) {
  const candidate = providerFixture && (providerFixture.fixture ? {
    homeTeam: providerFixture.teams && providerFixture.teams.home && providerFixture.teams.home.name,
    awayTeam: providerFixture.teams && providerFixture.teams.away && providerFixture.teams.away.name,
    kickoff: providerFixture.fixture.date,
    competition: providerFixture.league && providerFixture.league.name,
    score: providerFixture.goals
  } : providerFixture);
  if (!candidate || teamKey(match.homeTeam) !== teamKey(candidate.homeTeam) || teamKey(match.awayTeam) !== teamKey(candidate.awayTeam)) return { ok: false, reason: "team-mismatch" };
  if (istanbulDay(match.kickoff || match.date) !== istanbulDay(candidate.kickoff || candidate.date)) return { ok: false, reason: "date-mismatch" };
  if (text(match.competition || match.league) && text(candidate.competition || candidate.league) && teamKey(match.competition || match.league) !== teamKey(candidate.competition || candidate.league)) return { ok: false, reason: "competition-mismatch" };
  if (hasScore(match) && hasScore(candidate) && (number(match.score.home) !== number(candidate.score.home) || number(match.score.away) !== number(candidate.score.away))) return { ok: false, reason: "score-mismatch" };
  return { ok: true, reason: "team-date-competition-score-verified" };
}

function details(match) {
  const events = Array.isArray(match.events) ? match.events : [];
  const lineups = Array.isArray(match.lineups) ? match.lineups : [];
  const statistics = Array.isArray(match.statistics) ? match.statistics : [];
  const players = Array.isArray(match.players) ? match.players : [];
  const substitutions = Array.isArray(match.substitutions) ? match.substitutions : [];
  return {
    competition: Boolean(text(match.competition || match.league)), season: Boolean(text(match.season)), kickoff: Boolean(text(match.kickoff || match.date)),
    teams: Boolean(text(match.homeTeam) && text(match.awayTeam)), finalScore: hasScore(match), halfTime: number(match.score && (match.score.halftimeHome ?? match.score.halfTimeHome)) !== null && number(match.score && (match.score.halftimeAway ?? match.score.halfTimeAway)) !== null,
    venue: Boolean(text(match.venue)), referee: Boolean(text(match.referee)), status: isAnalyzableMatch(match), events: events.length > 0,
    cards: events.some((event) => /kart/i.test(text(event && event.type))), substitutions: substitutions.length > 0,
    lineups: lineups.length > 0, formations: lineups.some((lineup) => text(lineup && lineup.formation)), teamStatistics: statistics.length > 0,
    playerStatistics: players.length > 0, coaches: Boolean(match.coaches && (match.coaches.home || match.coaches.away))
  };
}

function classify(match) {
  const completeness = details(match);
  if (!completeness.teams || !completeness.kickoff || !completeness.status || !completeness.finalScore) {
    return { coverageLevel: null, workflowState: WORKFLOW.REVIEW, reason: "Doğrulanmış tamamlanma kimliği veya nihai skor eksik." };
  }
  const supporting = [completeness.events, completeness.lineups, completeness.teamStatistics, completeness.playerStatistics].filter(Boolean).length;
  if (completeness.events && completeness.lineups && completeness.teamStatistics) return { coverageLevel: COVERAGE.FULL, workflowState: WORKFLOW.COMPLETE, reason: "Skor, olaylar, kadrolar ve takım istatistikleri doğrulandı." };
  if (supporting >= 2) return { coverageLevel: COVERAGE.STANDARD, workflowState: WORKFLOW.COMPLETE, reason: "Nihai skor ve birden fazla maç ayrıntısı doğrulandı." };
  return { coverageLevel: COVERAGE.LIMITED, workflowState: WORKFLOW.LIMITED, reason: "Yalnızca temel doğrulanmış maç bilgileri mevcut." };
}

function normalized(match, source) {
  const score = match && match.score || {};
  return {
    id: matchId(match), homeTeam: text(match && match.homeTeam), awayTeam: text(match && match.awayTeam), kickoff: text(match && (match.kickoff || match.date)),
    // Keep source identity through report -> archive -> report round trips.
    // A local URL/slug is not a substitute for the provider's fixture ID.
    ...(match && (match.providerId || match.fixtureId) ? { providerId: String(match.providerId || match.fixtureId) } : {}),
    ...(match && match.providerIds && typeof match.providerIds === "object" && !Array.isArray(match.providerIds) ? { providerIds: { ...match.providerIds } } : {}),
    competition: text(match && (match.competition || match.league)), league: text(match && match.league), season: text(match && match.season) || null,
    status: text(match && (match.status || match.providerStatus)).toUpperCase(), providerStatus: text(match && match.providerStatus) || null,
    score: hasScore(match) ? { home: number(score.home), away: number(score.away), halftimeHome: number(score.halftimeHome ?? score.halfTimeHome), halftimeAway: number(score.halftimeAway ?? score.halfTimeAway) } : null,
    venue: text(match && match.venue) || null, referee: text(match && match.referee) || null,
    events: Array.isArray(match && match.events) ? match.events : [], substitutions: Array.isArray(match && match.substitutions) ? match.substitutions : [],
    lineups: Array.isArray(match && match.lineups) ? match.lineups : [], statistics: Array.isArray(match && match.statistics) ? match.statistics : [], players: Array.isArray(match && match.players) ? match.players : [],
    coaches: match && match.coaches || null, reportPage: text(match && (match.reportUrl || (match.seo && match.seo.path))) || (matchId(match) ? `mac-raporu/${matchId(match)}.html` : null),
    manualAnalysis: match && match.analysis ? match.analysis : null, source, lastVerifiedAt: text(match && (match.lastVerifiedAt || match.lastSuccessfulSyncAt || match.fetchedAt || match.analysisUpdatedAt)) || null
  };
}

function priority(source) { return source === "manual" ? 3 : source === "fixture-calendar" ? 2 : source === "report" ? 1 : 0; }

function buildArchive({ sources, previous, now }) {
  const grouped = new Map();
  const rejected = [];
  // Sağlayıcının SONRADAN "oynanmadı" dediği maçlar (iptal/erteleme): arşivde
  // daha önce bitmiş görünen kayıt bu bilgiyle geri çekilir.
  const unplayed = new Map();
  for (const entry of sources || []) {
    for (const raw of entry.records || []) {
      const match = normalized(raw, entry.name);
      if (!isAnalyzableMatch(match)) {
        if (isUnplayedStatus(match) && match.homeTeam && match.awayTeam && istanbulDay(match.kickoff)) {
          const info = { status: match.status, providerStatus: match.providerStatus };
          unplayed.set(identity(match), info);
          // Kayıt kimliğiyle de eşleşir: ertelenen maçın başlama günü değişince
          // (Şili K - Bolivya K: 12 → 13 Ekim) kimlik anahtarı tutmaz.
          if (match.id) unplayed.set(`id:${match.id}`, info);
        }
        continue;
      }
      const key = identity(match);
      if (!match.homeTeam || !match.awayTeam || !istanbulDay(match.kickoff)) { rejected.push({ id: match.id, source: entry.name, reason: "incomplete-identity" }); continue; }
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(match);
    }
  }
  const priorByKey = new Map((previous && previous.records || []).map((record) => [record.identity, record]));
  const records = [];
  for (const [key, candidates] of grouped) {
    candidates.sort((a, b) => priority(b.source) - priority(a.source));
    const primary = candidates[0];
    const scores = new Set(candidates.filter((item) => item.score).map((item) => `${item.score.home}-${item.score.away}`));
    const prior = priorByKey.get(key);
    const match = { ...primary };
    for (const candidate of candidates.slice(1)) {
      for (const field of ["events", "substitutions", "lineups", "statistics", "players"]) if (!match[field].length && candidate[field].length) match[field] = candidate[field];
      for (const field of ["venue", "referee", "coaches", "lastVerifiedAt"]) if (!match[field] && candidate[field]) match[field] = candidate[field];
    }
    // Elle yazılmış yorum geçmiş arşivde zaten `match` altında saklanmış
    // olabilir. Kaynak penceresinden düşen bir maçta bu yorumun kaybolması,
    // arşivin kalıcılık sözleşmesini bozar.
    if (prior && (prior.manualAnalysis || (prior.match && prior.match.manualAnalysis))) {
      match.manualAnalysis = prior.manualAnalysis || prior.match.manualAnalysis;
    }
    const result = scores.size > 1 ? { coverageLevel: null, workflowState: WORKFLOW.REVIEW, reason: "Kaynaklar arasında nihai skor uyuşmazlığı var." } : classify(match);
    records.push({ identity: key, canonicalId: primary.id || key, match, manualAnalysis: match.manualAnalysis || null, completeness: details(match), ...result, sources: candidates.map((item) => ({ name: item.source, id: item.id || null, lastVerifiedAt: item.lastVerifiedAt })), lastVerifiedAt: candidates.map((item) => item.lastVerifiedAt).filter(Boolean).sort().at(-1) || null, archivedAt: prior && prior.archivedAt || now });
  }
  // ARŞİV KÜÇÜLMEZ: KAYNAKLARDAN DÜŞEN MAÇ TAŞINIR.
  //
  // Yukarıdaki döngü çıktıyı YALNIZCA bu koşuda `grouped` edilen kaynaklardan
  // kuruyordu; `previous` sadece `manualAnalysis` ve `archivedAt` için
  // okunuyordu. Sonuç: bir maç `matches.json`, fikstür takvimi ve rapor
  // deposunun ÜÇÜNDEN birden düştüğünde arşivden de siliniyordu.
  //
  // Bu, arşivin varlık sebebini ortadan kaldırıyor. Arşiv rapor üretecine
  // havuz olarak geri besleniyor; kalıcı olmazsa kaybı önlediği düşünülen
  // zincir tek bir başarısız koşudan sonra kopuyor: rapor deposu maçı
  // düşürüyor, sonraki arşivleme onu artık hiçbir kaynakta bulamıyor ve
  // kalıcı kayıt da gidiyor.
  //
  // Bu yüzden önceki arşivde olup bu koşunun kaynaklarında görünmeyen her
  // kayıt OLDUĞU GİBİ taşınır. Kayıt zaten tam biçimli (identity, match,
  // coverageLevel, sources, archivedAt); yeniden sınıflandırmaya gerek yok
  // ve yeniden sınıflandırmak yanlış olurdu — elimizde o maça dair yeni bir
  // kaynak yok, yalnızca en son bilinen hâli var.
  for (const [key, prior] of priorByKey) {
    if (grouped.has(key)) continue;
    if (!prior || !prior.match) continue;
    // Kimlik hesabı değiştiyse (ör. "Italy" → "italya") eski anahtarlı kayıt
    // artık bu koşuda gruplanan bir maçın kopyasıdır; taşınmaz.
    if (grouped.has(identity(prior.match))) continue;
    const retraction = unplayed.get(key) || unplayed.get(identity(prior.match)) || unplayed.get(`id:${prior.match.id}`);
    if (retraction && ["CANCELLED", "POSTPONED"].includes(retraction.status) && prior.match.status !== retraction.status) {
      // GERİ ÇEKİLEN SONUÇ. Sağlayıcı artık iptal/erteleme diyor: eski skor
      // nihai sonuç olarak sunulamaz. Silinmez (arşiv küçülmez); denetim izi
      // `retractedResult` olarak kalır, kayıt incelemeye alınır.
      const { score, status, providerStatus } = prior.match;
      records.push({
        ...prior,
        match: { ...prior.match, status: retraction.status, providerStatus: retraction.providerStatus, score: null, retractedResult: prior.match.retractedResult || { status, providerStatus, score, retractedAt: now } },
        coverageLevel: null,
        workflowState: WORKFLOW.REVIEW,
        reason: "Sağlayıcı sonucu geri çekti (iptal/erteleme); nihai sonuç yok.",
        retracted: true,
        carriedForward: true
      });
      continue;
    }
    records.push({ ...prior, carriedForward: true });
  }

  records.sort((a, b) => String(b.match.kickoff).localeCompare(String(a.match.kickoff)) || a.canonicalId.localeCompare(b.canonicalId));
  return { records, rejected };
}

module.exports = { COVERAGE, WORKFLOW, buildArchive, classify, details, hasScore, identity, istanbulDay, providerResponseStatus, verifyProviderIdentity };
