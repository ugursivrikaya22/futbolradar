"use strict";
/**
 * MAÇ SONU OTOMATİK ÖZETİ — SAF ÇEKİRDEK (ağ yok, saat yok, LLM yok).
 *
 * Girdi: `data/fixture-calendar.json` içindeki BİTMİŞ maç kaydı (saatlik iş
 * motorunun zaten çektiği ve sakladığı veri; YENİ sağlayıcı isteği yok) ve
 * maçın kalıcı `/mac/<slug>` adresi (`data/match-seo-index.json`).
 *
 * Çıktı: kalıcı `/ozet/<slug>` sayfasının ve X kuyruğu metninin tek veri
 * kaynağı olan özet kaydı. KURAL: her satır saklanan veriden gelir; alan
 * yoksa bölüm/cümle parçası ATLANIR, tahmin edilmez.
 *
 *   - Skor: score.home/away (ikisi de sayı değilse özet üretilmez).
 *   - Goller: events[] (Goal: Normal Goal / Penalty / Own Goal). Gol olayı
 *     sayısı skorla birebir tutmuyorsa (eksik/iptal edilmiş olay) gol listesi
 *     HİÇ basılmaz — skorla çelişen liste yayımlamamak için.
 *   - Önemli olaylar: kırmızı kart (Card/Red Card), penaltı (gol/kaçan).
 *   - İstatistik: statistics[] içinden yalnızca "Topla oynama", "Toplam şut",
 *     "İsabetli şut" (iki taraf da sayıysa).
 *   - Yorum: deterministik Türkçe şablon zinciri (bkz. commentSentence).
 */
const crypto = require("node:crypto");

const SITE = "https://www.futbolradar.com";
const FINISHED_STATUS = /^(FINISHED|FT|AET|PEN)$/i;
const STAT_KEYS = [
  { key: "possession", type: "Topla oynama", label: "Topla oynama", unit: "%" },
  { key: "shots", type: "Toplam şut", label: "Şut", unit: "" },
  { key: "shotsOnTarget", type: "İsabetli şut", label: "İsabetli şut", unit: "" }
];

function isNum(v) { return typeof v === "number" && Number.isFinite(v); }

function norm(s) {
  return String(s || "").toLocaleLowerCase("tr").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i").replace(/[^a-z0-9]+/g, " ").trim();
}

/** Bitmiş + iki tarafı da sayı olan skor. AWARDED (hükmen) bilerek hariç. */
function isFinished(m) {
  if (!m || !m.score || !isNum(m.score.home) || !isNum(m.score.away)) return false;
  return String(m.status || "").toUpperCase() === "FINISHED" || FINISHED_STATUS.test(String(m.providerStatus || ""));
}

function afId(m) {
  const ids = (m && m.providerIds) || {};
  return ids.apiFootball || (/api-football/i.test(String((m && (m.providerName || m.source)) || "")) ? m.providerId : null) || null;
}

/** `/mac/` sicilindeki slug (xAutopost ile aynı anahtarlar: af:/tsdb:). */
function slugFor(m, seoIndex) {
  const index = seoIndex || {};
  const ids = (m && m.providerIds) || {};
  const af = afId(m);
  return (af && index[`af:${af}`]) || (ids.theSportsDb && index[`tsdb:${ids.theSportsDb}`]) || null;
}

function parseMinute(time) {
  const match = String(time || "").match(/(\d{1,3})(?:\s*\+\s*(\d{1,2}))?/);
  if (!match) return null;
  return { base: Number(match[1]), extra: match[2] ? Number(match[2]) : null, label: match[2] ? `${match[1]}+${match[2]}` : match[1] };
}

function playerOf(e) {
  const fromValue = String(e.value || "").split("·")[0].trim();
  const name = (e.player && e.player.name) || fromValue;
  return name && !/^(Normal Goal|Penalty|Own Goal|Missed Penalty|Red Card|Yellow Card)$/i.test(name) ? name : null;
}

function sideOf(e, m) {
  const team = norm(e.team && e.team.name);
  if (team && team === norm(m.homeTeam)) return "home";
  if (team && team === norm(m.awayTeam)) return "away";
  return null;
}

function teamLabel(side, m, e) {
  if (side === "home") return m.homeTeam;
  if (side === "away") return m.awayTeam;
  return (e.team && e.team.name) || null;
}

function extractEvents(m) {
  const goals = []; const redCards = []; const penalties = [];
  for (const e of Array.isArray(m.events) ? m.events : []) {
    if (!e) continue;
    const type = String(e.type || "").toLowerCase();
    const detail = String(e.detail || "").toLowerCase();
    const minute = parseMinute(e.time);
    // Penaltı atışları (uzatma sonrası seri) maç golü değildir.
    if (minute && minute.base > 120) continue;
    const side = sideOf(e, m);
    const base = { minute: minute ? minute.label : null, player: playerOf(e), side, team: teamLabel(side, m, e) };
    if (type === "goal") {
      if (detail === "missed penalty") { penalties.push({ ...base, outcome: "missed" }); continue; }
      const kind = detail === "penalty" ? "penalty" : detail === "own goal" ? "own-goal" : detail === "normal goal" ? "normal" : null;
      if (!kind) continue;
      goals.push({ ...base, kind });
      if (kind === "penalty") penalties.push({ ...base, outcome: "scored" });
    } else if (type === "card" && /red card|second yellow/.test(detail)) {
      redCards.push({ ...base, secondYellow: /second yellow/.test(detail) });
    }
  }
  return { goals, redCards, penalties };
}

function extractStats(m) {
  const rows = Array.isArray(m.statistics) ? m.statistics : [];
  const out = {};
  for (const def of STAT_KEYS) {
    const row = rows.find((r) => r && r.type === def.type);
    if (!row) continue;
    const home = Number(row.home); const away = Number(row.away);
    if (row.home === null || row.away === null || row.home === "" || row.away === "" || !Number.isFinite(home) || !Number.isFinite(away)) continue;
    out[def.key] = { home, away, label: def.label, unit: def.unit };
  }
  return out;
}

/**
 * GALİBİYET GOLÜ (futboldaki yerleşik tanım): kazanan takımın, rakibin
 * maç sonu gol sayısını aştığı gol — yani kazananın (kaybedenin golü + 1).
 * golü. Gol listesi skorla tutarlı değilse çağrılmaz.
 */
function decisiveGoal(goals, winner, loserGoals) {
  const own = goals.filter((g) => g.side === winner);
  return own[loserGoals] || null;
}

function pct(n) { return `%${n}`; }

/**
 * BİR CÜMLELİK MAÇ YORUMU — deterministik şablonlar. Yalnızca özetin kendi
 * alanlarını kullanır; Türkçe ek uydurmamak için takım adları ek almaz.
 */
function commentSentence(s) {
  const { home, away } = s.score;
  const H = s.homeTeam; const A = s.awayTeam;
  const st = s.stats || {};
  const reds = s.events.redCards || [];
  if (home === away) {
    if (home === 0) {
      if (st.shotsOnTarget) return `${H} ile ${A} arasındaki maç golsüz sona erdi; isabetli şutlarda tablo ${st.shotsOnTarget.home}-${st.shotsOnTarget.away} oldu.`;
      return `${H} ile ${A} arasındaki maç golsüz sona erdi.`;
    }
    const last = s.goalsConsistent ? s.events.goals[s.events.goals.length - 1] : null;
    if (last && last.player && last.minute && last.kind !== "own-goal") return `${H} ile ${A} ${home}-${away} berabere kaldı; eşitliği getiren son gol ${last.minute}. dakikada ${last.player} imzasını taşıdı.`;
    if (st.possession) return `${H} ile ${A} ${home}-${away} berabere kaldı; topla oynamada oran ${pct(st.possession.home)}-${pct(st.possession.away)} oldu.`;
    return `${H} ile ${A} ${home}-${away} berabere kaldı.`;
  }
  const w = home > away ? "home" : "away";
  const l = w === "home" ? "away" : "home";
  const W = w === "home" ? H : A; const L = w === "home" ? A : H;
  // Skor kazananın bakışıyla yazılır ("2-1 kazandı"); deplasman galibiyeti belirtilir.
  const scoreText = `${Math.max(home, away)}-${Math.min(home, away)}`;
  const where = w === "away" ? "deplasmanda " : "";
  const margin = Math.abs(home - away);
  const loserReds = reds.filter((r) => r.side === l).length;
  let clause = null;
  if (st.possession && st.possession[w] < st.possession[l]) clause = `topla oynamada ${pct(st.possession[w])} ile geride kalmasına rağmen kazandı`;
  else if (st.shotsOnTarget && st.shotsOnTarget[w] > st.shotsOnTarget[l]) clause = `isabetli şutta ${st.shotsOnTarget[w]}-${st.shotsOnTarget[l]} üstünlük kurarak kazandı`;
  else if (loserReds > 0) clause = `rakibinin kırmızı kart gördüğü maçı kazandı`;
  if (margin >= 3) return `${W}, ${where}${L} karşısında ${scoreText} biten maçta ${margin} farklı galibiyet aldı.`;
  const decisive = s.goalsConsistent ? decisiveGoal(s.events.goals, w, s.score[l]) : null;
  if (decisive && decisive.player && decisive.minute && decisive.kind !== "own-goal") {
    return `${W}, ${where}${L} karşısında ${scoreText} kazandı; galibiyeti getiren gol ${decisive.minute}. dakikada ${decisive.player} imzasını taşıdı.`;
  }
  if (clause) return `${W}, ${where}${L} karşısında ${scoreText} biten maçta ${clause}.`;
  return `${W}, ${where}${L} karşısında ${scoreText} kazandı.`;
}

function dataHash(obj) {
  return crypto.createHash("sha256").update(JSON.stringify(obj)).digest("hex").slice(0, 16);
}

/** Bitmiş maçtan özet kaydı. Bitmemiş / skorsuz / slugsuz maç → null. */
function buildSummary(m, { slug } = {}) {
  if (!slug || !isFinished(m) || !m.homeTeam || !m.awayTeam || !Number.isFinite(Date.parse(m.kickoff))) return null;
  const events = extractEvents(m);
  const totalGoals = m.score.home + m.score.away;
  const sideCount = (side) => events.goals.filter((g) => g.side === side).length;
  const goalsConsistent = events.goals.length === totalGoals && sideCount("home") === m.score.home && sideCount("away") === m.score.away;
  const score = { home: m.score.home, away: m.score.away };
  if (isNum(m.score.halftimeHome) && isNum(m.score.halftimeAway)) { score.halftimeHome = m.score.halftimeHome; score.halftimeAway = m.score.halftimeAway; }
  const core = {
    slug,
    matchId: m.id || null,
    afId: afId(m),
    league: m.league || null,
    round: m.round != null && m.round !== "" ? m.round : null,
    kickoff: m.kickoff,
    venue: m.venue && !/^açıklanmadı$/i.test(String(m.venue).trim()) ? m.venue : null,
    referee: m.referee || null,
    homeTeam: m.homeTeam,
    awayTeam: m.awayTeam,
    providerStatus: m.providerStatus || null,
    score,
    goalsConsistent,
    // Skorla tutarsız gol listesi yayımlanmaz (bkz. dosya başı).
    events: { goals: goalsConsistent ? events.goals : [], redCards: events.redCards, penalties: goalsConsistent ? events.penalties : events.penalties.filter((p) => p.outcome === "missed") },
    stats: extractStats(m)
  };
  core.comment = commentSentence(core);
  core.hash = dataHash(core);
  return core;
}

/** Sayfada en az bir ölçülmüş bölüm (gol listesi / olay / istatistik) var mı? */
function hasSubstance(s) {
  return Boolean(s && ((s.events.goals.length || s.events.redCards.length || s.events.penalties.length) || Object.keys(s.stats || {}).length || (s.score.home + s.score.away === 0)));
}

/**
 * Kalıcı sicili günceller: takvimdeki her bitmiş + `/mac/` sayfalı maç için
 * özet yeniden hesaplanır; içerik değişmediyse kayıt (ve updatedAt) aynı
 * kalır. Takvimden düşen maçın özeti SİLİNMEZ (kalıcı sayfa).
 */
function updateRegistry(registry, calendar, seoIndex, { now = new Date() } = {}) {
  const prev = (registry && registry.summaries) || {};
  const next = { ...prev };
  const added = []; const changed = [];
  const matches = Array.isArray(calendar) ? calendar : (calendar && Array.isArray(calendar.matches) ? calendar.matches : []);
  for (const m of matches) {
    const slug = slugFor(m, seoIndex);
    const s = buildSummary(m, { slug });
    if (!s) continue;
    const old = prev[slug];
    if (old && old.hash === s.hash) continue;
    const stamp = now.toISOString();
    next[slug] = { ...s, generatedAt: old ? old.generatedAt : stamp, updatedAt: stamp };
    (old ? changed : added).push(slug);
  }
  return { registry: { version: 1, summaries: next }, added, changed };
}

function sortedSummaries(registry) {
  return Object.values((registry && registry.summaries) || {}).sort((a, b) => Date.parse(b.kickoff) - Date.parse(a.kickoff) || a.slug.localeCompare(b.slug));
}

function summaryUrl(slug) { return `${SITE}/ozet/${slug}`; }

function scoreLine(s) { return `${s.homeTeam} ${s.score.home}-${s.score.away} ${s.awayTeam}`; }

/** schema.org SportsEvent + BreadcrumbList (@graph). Eksik alan yazılmaz. */
function jsonLd(s) {
  const url = summaryUrl(s.slug);
  const team = (name) => ({ "@type": "SportsTeam", name });
  const event = {
    "@type": "SportsEvent",
    name: scoreLine(s),
    url,
    description: `Maç sonucu: ${scoreLine(s)}. ${s.comment}`,
    startDate: s.kickoff,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    sport: "Football",
    ...(s.venue ? { location: { "@type": "Place", name: s.venue } } : {}),
    homeTeam: team(s.homeTeam),
    awayTeam: team(s.awayTeam),
    competitor: [team(s.homeTeam), team(s.awayTeam)],
    ...(s.league ? { superEvent: { "@type": "SportsOrganization", name: s.league } } : {}),
    // Sonuç bilgisi: schema.org'da SportsEvent için resmî "skor" alanı yok;
    // sonuç ad/açıklamada ve takım başına gol sayısı olarak PropertyValue ile verilir.
    additionalProperty: [
      { "@type": "PropertyValue", name: `${s.homeTeam} gol`, value: s.score.home },
      { "@type": "PropertyValue", name: `${s.awayTeam} gol`, value: s.score.away }
    ],
    subjectOf: { "@type": "WebPage", url: `${SITE}/mac/${s.slug}` },
    inLanguage: "tr"
  };
  const crumbs = {
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Ana Sayfa", item: `${SITE}/` },
      { "@type": "ListItem", position: 2, name: "Maç Merkezi", item: `${SITE}/mac-merkezi.html` },
      { "@type": "ListItem", position: 3, name: `${s.homeTeam} - ${s.awayTeam} maç özeti`, item: url }
    ]
  };
  return { "@context": "https://schema.org", "@graph": [event, crumbs] };
}

module.exports = {
  SITE, STAT_KEYS,
  isFinished, afId, slugFor, parseMinute, extractEvents, extractStats, decisiveGoal,
  commentSentence, buildSummary, hasSubstance, updateRegistry, sortedSummaries,
  summaryUrl, scoreLine, jsonLd
};
