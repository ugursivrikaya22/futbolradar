/**
 * MAÇ SONU OTOMATİK ÖZETİ — kalıcı maç sayfasının "Maç özeti" bölümü (#ozet).
 *
 * Tamamen deterministik: aynı girdi her derlemede aynı metni üretir. Dil
 * modeli, ücretli servis ya da ek istek YOK; girdiler maç sayfasının zaten
 * çizdiği verilerdir:
 *   • tabeladaki skor (ilk yarı skoru varsa o da),
 *   • services/matchTimeline.js'in ürettiği olay akışı (gol, penaltı,
 *     kendi kalesine gol, kart, kaçan penaltı),
 *   • iki taraflı takım istatistikleri (topla oynama, şut, isabetli şut, xG).
 *
 * UYDURMA YOK:
 *   • Golcü listesi yalnızca olay akışındaki gol sayısı tabeladaki skorla
 *     birebir tutuyorsa yazılır (matchTimeline koşan skoru yalnızca bu
 *     durumda iliştirir). Tutmuyorsa "Güncelleniyor".
 *   • Kaçan penaltı gol sayılmaz.
 *   • İstatistik yoksa analiz cümlesi kurulmaz; "Güncelleniyor" yazılır.
 *   • Yorum/görüş yok (köşe yazıları ayrı bir iş); yalnızca veriden çıkan
 *     olgu cümleleri.
 */

const GOAL_KINDS = new Set(["goal", "penalty", "own-goal"]);
const PENDING = "Güncelleniyor";

function isNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeKey(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** "45+1'" → "45+1. dakikada"; dakika yoksa "maçın bir bölümünde". */
function minuteText(item) {
  const raw = String((item && item.minute) || "").replace(/'+$/, "");
  return raw ? `${raw}. dakikada` : "maçın bir bölümünde";
}

function minuteValue(item) {
  return typeof item.sort === "number" ? item.sort : null;
}

/** İki taraflı istatistik satırı; yoksa null. */
function statPair(statistics, ...names) {
  const wanted = names.map(normalizeKey);
  const row = (statistics || []).find((entry) => entry && wanted.includes(normalizeKey(entry.type)) && isNumber(entry.home) && isNumber(entry.away));
  return row ? { home: Number(row.home), away: Number(row.away) } : null;
}

function formatNumber(value, decimals = 0) {
  return Number(value).toLocaleString("tr-TR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/**
 * @param {object} input
 * @param {string} input.homeTeam görünen ad
 * @param {string} input.awayTeam görünen ad
 * @param {{home:number, away:number, halftimeHome?:number, halftimeAway?:number}} input.score
 * @param {Array} input.timeline normalizeEvents(...) çıktısı
 * @param {Array} input.statistics iki taraflı istatistik satırları
 * @returns {null | {lead:string, goals:string, cards:string, missedPenalties:string|null, analysis:string[], facts:object}}
 */
export function buildPostMatchSummary({ homeTeam, awayTeam, score, timeline = [], statistics = [] }) {
  if (!score || !isNumber(score.home) || !isNumber(score.away)) return null;
  const home = Number(score.home);
  const away = Number(score.away);
  const name = { home: homeTeam, away: awayTeam };
  const winnerSide = home > away ? "home" : away > home ? "away" : null;
  const loserSide = winnerSide === "home" ? "away" : winnerSide === "away" ? "home" : null;

  // ---- Sonuç cümlesi ------------------------------------------------------
  const lead = [
    `${homeTeam} – ${awayTeam} maçı ${home}-${away} sona erdi.`,
    winnerSide ? `${name[winnerSide]} sahadan galip ayrıldı.` : "Puanlar paylaşıldı.",
    isNumber(score.halftimeHome) && isNumber(score.halftimeAway) ? `İlk yarı ${Number(score.halftimeHome)}-${Number(score.halftimeAway)} tamamlandı.` : ""
  ].filter(Boolean).join(" ");

  // ---- Goller -------------------------------------------------------------
  const goalItems = timeline.filter((item) => GOAL_KINDS.has(item.kind));
  // matchTimeline koşan skoru YALNIZCA akıştaki goller tabelayla tutuyorsa
  // yazar; bu, golcü listesinin güvenilir olduğunun tek işaretidir.
  const reconciled = goalItems.length === home + away && goalItems.every((item) => typeof item.score === "string");
  const scoringTeam = (item) => {
    if (item.kind === "own-goal") return item.side === "home" ? awayTeam : item.side === "away" ? homeTeam : "";
    return name[item.side] || item.team || "";
  };
  const goalLine = (item) => {
    const tag = item.kind === "penalty" ? " (pen.)" : item.kind === "own-goal" ? " (k.k.)" : "";
    return `${item.minute || "-"} ${item.player || "Oyuncu bilgisi güncelleniyor"}${tag} (${scoringTeam(item)})`;
  };
  let goals;
  if (home + away === 0) goals = "Gol yok.";
  else if (reconciled) goals = goalItems.map(goalLine).join(", ") + ".";
  else goals = PENDING;

  // ---- Kartlar ------------------------------------------------------------
  const cardItems = timeline.filter((item) => ["yellow", "red", "yellow-red"].includes(item.kind));
  const reds = cardItems.filter((item) => item.kind === "red" || item.kind === "yellow-red");
  const yellowCount = (side) => cardItems.filter((item) => item.kind === "yellow" && item.side === side).length;
  let cards;
  if (!timeline.some((item) => item.kind && !["whistle", "halftime", "fulltime", "ft", "ht"].includes(item.kind))) {
    cards = PENDING;
  } else {
    const parts = [];
    if (reds.length) parts.push(`Kırmızı kart: ${reds.map((item) => `${item.minute || "-"} ${item.player || "oyuncu bilgisi güncelleniyor"}${item.kind === "yellow-red" ? " (ikinci sarı)" : ""} (${name[item.side] || item.team || ""})`).join(", ")}.`);
    parts.push(`Sarı kart: ${homeTeam} ${yellowCount("home")}, ${awayTeam} ${yellowCount("away")}.`);
    cards = parts.join(" ");
  }
  const missed = timeline.filter((item) => item.kind === "missed-penalty");
  const missedPenalties = missed.length
    ? missed.map((item) => `${item.minute || "-"} ${item.player || "oyuncu bilgisi güncelleniyor"} (${name[item.side] || item.team || ""})`).join(", ") + "."
    : null;

  // ---- Veriye dayalı analiz ----------------------------------------------
  const analysis = [];
  if (reconciled && goalItems.length) {
    const first = goalItems[0];
    const firstSide = first.kind === "own-goal" ? (first.side === "home" ? "away" : "home") : first.side;
    if (firstSide && name[firstSide]) {
      if (winnerSide === firstSide) analysis.push(`İlk golü ${minuteText(first)} ${name[firstSide]} buldu ve maçı kazandı.`);
      else if (winnerSide) analysis.push(`İlk golü ${name[firstSide]} attı ama maçı geriden gelen ${name[winnerSide]} kazandı.`);
      else analysis.push(`İlk golü ${name[firstSide]} attı, karşılaşma beraberlikle bitti.`);
    }
    // Sonucu son dakikalarda değiştiren gol (85. dakika ve sonrası).
    const last = goalItems[goalItems.length - 1];
    const lastMinute = minuteValue(last);
    if (lastMinute !== null && lastMinute >= 85 && goalItems.length >= 1) {
      const before = goalItems.length > 1 ? goalItems[goalItems.length - 2].score : "0-0";
      const [bh, ba] = String(before).split("-").map(Number);
      const outcome = (h, a) => (h > a ? "home" : a > h ? "away" : "draw");
      if (outcome(bh, ba) !== outcome(home, away)) {
        analysis.push(`Sonucu belirleyen gol ${minuteText(last)} geldi (${last.player || "oyuncu bilgisi güncelleniyor"}, ${scoringTeam(last)}).`);
      }
    }
  }
  for (const item of reds) {
    if (item.side && name[item.side]) analysis.push(`${name[item.side]}, ${minuteText(item).replace(/dakikada$/, "dakikadan")} itibaren 10 kişi oynadı.`);
  }
  const possession = statPair(statistics, "Topla oynama", "Ball Possession");
  const shots = statPair(statistics, "Toplam şut", "Total Shots");
  const onTarget = statPair(statistics, "İsabetli şut", "Shots on Goal");
  const xg = statPair(statistics, "Gol beklentisi (xG)", "expected_goals");
  const statBits = [];
  if (possession) statBits.push(`topla oynamada %${formatNumber(possession.home)}-%${formatNumber(possession.away)}`);
  if (shots) statBits.push(`toplam şutta ${formatNumber(shots.home)}-${formatNumber(shots.away)}`);
  if (onTarget) statBits.push(`isabetli şutta ${formatNumber(onTarget.home)}-${formatNumber(onTarget.away)}`);
  if (xg) statBits.push(`gol beklentisinde (xG) ${formatNumber(xg.home, 2)}-${formatNumber(xg.away, 2)}`);
  if (statBits.length) {
    analysis.push(`İstatistikte (${homeTeam} önce) ${statBits.join(", ")}.`);
    if (winnerSide && possession && possession[winnerSide] < possession[loserSide]) {
      analysis.push(`${name[winnerSide]} topa daha az sahip olduğu maçı kazandı.`);
    }
    if (xg && winnerSide && xg[winnerSide] < xg[loserSide]) {
      analysis.push(`Gol beklentisinde önde olan taraf ${name[loserSide]} idi; skor bu tabloyu yansıtmadı.`);
    }
  } else if (analysis.length) {
    analysis.push("Takım istatistikleri güncelleniyor.");
  }
  if (!analysis.length) analysis.push(PENDING);

  return {
    lead,
    goals,
    cards,
    missedPenalties,
    analysis,
    facts: { reconciled, goalCount: goalItems.length, cardCount: cardItems.length, hasStats: statBits.length > 0 }
  };
}

/** "Maç özeti" bölümü — mevcut bölümle aynı çapa (#ozet) ve başlık kimliği. */
export function postMatchSummarySectionHtml(summary, { title = "Maç özeti", reportHref = null, reportLabel = "Ayrıntılı maç raporu", credit = "Veri: API-Football" } = {}) {
  if (!summary) return "";
  const row = (label, value) => `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`;
  return `<section class="msp-section" id="ozet" aria-labelledby="msp-summary-title" data-auto-summary>` +
    `<h2 id="msp-summary-title" class="msp-section-title">${escapeHtml(title)}</h2>` +
    `<div class="card msp-summary">` +
    `<p>${escapeHtml(summary.lead)}</p>` +
    row("Goller", summary.goals) +
    row("Kartlar", summary.cards) +
    (summary.missedPenalties ? row("Kaçan penaltı", summary.missedPenalties) : "") +
    row("Analiz", summary.analysis.join(" ")) +
    `<p class="muted-copy"><small>${escapeHtml(credit)} · Özet, maç verisinden otomatik derlenir; yorum içermez.</small></p>` +
    `</div>` +
    (reportHref ? `<p class="msp-more"><a class="detail-link" href="${escapeHtml(reportHref)}">${escapeHtml(reportLabel)}</a></p>` : "") +
    `</section>`;
}
