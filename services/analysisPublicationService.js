const crypto = require("node:crypto");

const MAJOR_TURKISH = new Map([
  ["galatasaray", 100], ["fenerbahce", 96], ["besiktas", 92], ["trabzonspor", 88], ["turkiye", 84], ["türkiye", 84]
]);
const EUROPEAN = /sampiyonlar ligi|champions league|avrupa ligi|europa league|conference/i;

function text(value) { return String(value == null ? "" : value).trim(); }
function slug(value) { return text(value).toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
function teams(record) { return [text(record.homeTeam), text(record.awayTeam)].filter(Boolean); }
function score(record) { return record.score && Number.isFinite(record.score.home) && Number.isFinite(record.score.away) ? `${record.score.home}-${record.score.away}` : null; }
function isMajorTurkish(record) { return teams(record).some((team) => MAJOR_TURKISH.has(slug(team))); }

function coverageScore(record) {
  let value = 0;
  for (const team of teams(record)) value = Math.max(value, MAJOR_TURKISH.get(slug(team)) || 0);
  if (record.turkish && value < 60) value = 60;
  if (EUROPEAN.test(text(record.competition || record.league))) value += 22;
  const result = score(record);
  if (result) value += 18;
  const events = Number(record.availability && record.availability.events) || 0;
  const stats = Number(record.availability && record.availability.statistics) || 0;
  if (events) value += 10;
  if (stats) value += 8;
  if (events >= 4) value += 6;
  if (record.coverageGrade === "full") value += 10;
  return Math.min(100, value);
}

function contentTypes(record) {
  const types = ["full-time"];
  const digest = record.digest || {};
  if (isMajorTurkish(record)) types.push("short-summary");
  if (isMajorTurkish(record) && digest.tactical && digest.tactical.status !== "unavailable") types.push("tactical");
  if (isMajorTurkish(record) && digest.keyPlayers && digest.keyPlayers.status === "ready") types.push("player-performance");
  if ((EUROPEAN.test(text(record.competition || record.league)) || isMajorTurkish(record)) && digest.turningPoints && digest.turningPoints.moments && digest.turningPoints.moments.length) types.push("key-moments");
  return types;
}

function formatLabel(type) {
  return ({ "full-time": "Maç sonu analizi", tactical: "Taktik analiz", "player-performance": "Oyuncu performans raporu", "key-moments": "Kritik anlar", "short-summary": "Kısa maç yorumu" })[type] || "Maç analizi";
}

function facts(record) {
  const digest = record.digest || {};
  const result = score(record);
  const headline = text(digest.headline) || (result ? `${record.homeTeam} ${result} ${record.awayTeam}` : "Doğrulanmış maç değerlendirmesi");
  const verdict = text(digest.paragraph) || (result ? `${record.homeTeam} ile ${record.awayTeam} arasındaki maç ${result} sonuçlandı.` : "Ayrıntılı skor bilgisi doğrulanmadı.");
  return { headline, verdict, turningPoint: text(digest.turningPoints && digest.turningPoints.moments && digest.turningPoints.moments[0] && digest.turningPoints.moments[0].detail) || null, bestPlayer: digest.keyPlayers && digest.keyPlayers.players && digest.keyPlayers.players[0] || null };
}

function publication(record, type, previous) {
  const result = score(record);
  const data = facts(record);
  const title = `${record.homeTeam} ${result || ""} ${record.awayTeam}: ${formatLabel(type)}`.replace(/\s+/g, " ").trim();
  const id = `${record.matchId}:${type}`;
  const signature = crypto.createHash("sha1").update(JSON.stringify({ id, record: record.fingerprint, type, data })).digest("hex").slice(0, 16);
  const quality = Math.min(100, 42 + (result ? 18 : 0) + (data.verdict ? 15 : 0) + (data.turningPoint ? 10 : 0) + (data.bestPlayer ? 8 : 0) + (type === "full-time" ? 8 : 0));
  const confidence = Math.min(100, 35 + Number(record.coveragePercent || 0));
  const status = quality >= (isMajorTurkish(record) ? 78 : 75) ? "published" : quality >= 60 ? "draft" : "rejected";
  const existing = previous && previous.get(id);
  return {
    id, matchId: record.matchId, contentType: type, title, slug: slug(`${record.slug || record.matchId}-${type}`), summary: data.verdict,
    matchStory: data.verdict, tacticalAnalysis: type === "tactical" ? (record.digest.tactical.notes || []).join(" ") || null : null,
    keyMoments: record.digest.turningPoints && record.digest.turningPoints.moments || [], bestPlayer: data.bestPlayer ? { name: data.bestPlayer.name, reason: data.bestPlayer.contribution || "Doğrulanmış maç olayı." } : null,
    managerDecisions: record.digest.coaching && record.digest.coaching.notes || [], statisticalInsights: (record.digest.analysis || []).flatMap((section) => section.readings || []).slice(0, 4),
    turningPoint: data.turningPoint, winningFactor: record.digest.finalAssessment && record.digest.finalAssessment.closing || null,
    seoTitle: `${title} | FutbolRadar`, seoDescription: text(data.verdict).slice(0, 155), keywords: [record.homeTeam, record.awayTeam, record.competition || record.league, formatLabel(type)].filter(Boolean),
    relatedEntities: { teams: teams(record), players: data.bestPlayer ? [data.bestPlayer.name] : [], competition: record.competition || record.league || "" },
    qualityScore: quality, confidenceScore: confidence, sourceDataTimestamp: record.analysisUpdatedAt || record.generatedAt || null,
    coverageScore: coverageScore(record), status, canonicalUrl: `https://www.futbolradar.com/mac-raporu/${record.slug || record.matchId}.html`, reportUrl: record.reportUrl,
    sourceSignature: signature, publishedAt: existing && existing.sourceSignature === signature ? existing.publishedAt : (status === "published" ? new Date().toISOString() : null), updatedAt: new Date().toISOString()
  };
}

function validate(publication, record) {
  const errors = [];
  if (!publication.matchId || !publication.contentType || !publication.slug) errors.push("zorunlu kimlik alanı eksik");
  if (!score(record)) errors.push("doğrulanmış nihai skor yok");
  if (!publication.summary || publication.summary.length < 24) errors.push("özet yeterince bilgi taşımıyor");
  if (!publication.seoTitle || !publication.seoDescription) errors.push("SEO alanı eksik");
  if (publication.summary.includes("xG") && !(record.digest && record.digest.analysis || []).some((s) => /xg/i.test(JSON.stringify(s)))) errors.push("doğrulanmamış xG iddiası");
  return { ok: !errors.length, errors };
}

function buildPublications(records, previous) {
  const byId = new Map((previous || []).map((item) => [item.id, item]));
  const usedSlugs = new Set(); const publications = []; const queue = [];
  for (const record of (records || []).slice().sort((a, b) => coverageScore(b) - coverageScore(a))) {
    for (const type of contentTypes(record)) {
      const item = publication(record, type, byId);
      const check = validate(item, record);
      if (usedSlugs.has(item.slug)) { queue.push({ matchId: record.matchId, type, reason: "duplicate-slug" }); continue; }
      usedSlugs.add(item.slug);
      if (!check.ok) { queue.push({ matchId: record.matchId, type, reason: check.errors.join("; ") }); continue; }
      publications.push(item);
    }
  }
  return { publications, queue };
}
module.exports = { buildPublications, contentTypes, coverageScore, slug, validate };
