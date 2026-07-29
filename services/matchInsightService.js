/**
 * MAÇ İÇGÖRÜSÜ — skorun arkasındaki hikâye.
 *
 * Bir skor tek başına ne olduğunu söylemez. "2-1" bir maçın son dakikada mı
 * döndüğünü, bir tarafın oyuna hâkim olup da mı kazandığını, yoksa tek
 * pozisyonda mı bittiğini anlatmaz. İçgörü katmanı bu farkı yazar.
 *
 * NE DEĞİLDİR — bu sınırlar kuralın kendisidir:
 *
 *   • TAHMİN DEĞİL. Ne olacağını söylemez; ne OLDUĞUNU anlatır.
 *   • YORUM DEĞİL. "Hak eden taraf kazandı" gibi bir cümle kurulmaz;
 *     bu bir ölçüm değil, bir kanaattir.
 *   • ÜRETİLMİŞ METİN DEĞİL. Her cümle bir ölçüye bağlıdır ve hangi ölçüden
 *     geldiğini `basis` alanında taşır. Ölçü yoksa cümle YAZILMAZ.
 *
 * Bu son madde kritik. Bir dil modelinin eksik veriyi akıcı cümlelerle
 * doldurması, bu sitede yapılabilecek en zararlı şey olurdu: okuyucu ölçülmüş
 * bir tespitle uydurulmuş bir tespiti ayırt edemez. Bu yüzden içgörüler
 * KURALLA türetilir, serbest metinle değil.
 *
 * Veri yoksa bölüm gizlenmez: kaç cümle üretilebildiği ve NEDEN daha fazlası
 * üretilemediği açıkça yazılır.
 */

const { displayLeagueName } = require("./leagueIdentity.js");

/** Bir içgörünün gücü: kaç ölçüye dayandığı ve ne kadar ayırt edici olduğu. */
const WEIGHT = Object.freeze({
  decisive: 30,   // maçı belirleyen olay (son dakika golü, geri dönüş)
  flow: 20,       // oyunun akışı (üstünlük, dönüm anı)
  margin: 15,     // fark ve sonuç biçimi
  context: 10     // turnuva, saha, hakem gibi çerçeve
});

/** Kaç içgörü basılır. Fazlası kartı listeye çevirir. */
const MAX_INSIGHTS = 4;

/** Son dakika sayılan eşik. */
const LATE_MINUTE = 80;

/** "Farklı skor" sayılan gol farkı. */
const WIDE_MARGIN = 3;

function isNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function scoreOf(match) {
  const score = (match && match.score) || {};
  if (!isNumber(score.home) || !isNumber(score.away)) return null;
  return { home: Number(score.home), away: Number(score.away) };
}

/** Olay dakikası; "90+3" gibi uzatma dakikaları sayısal karşılığıyla döner. */
function minuteOf(event) {
  const raw = String((event && event.time) || "").match(/(\d+)(?:\s*\+\s*(\d+))?/);
  if (!raw) return null;
  return Number(raw[1]) + (raw[2] ? Number(raw[2]) : 0);
}

function normalize(value) {
  return String(value || "").toLocaleLowerCase("tr-TR").trim();
}

function eventTeam(event) {
  if (!event || !event.team) return "";
  return typeof event.team === "string" ? event.team : (event.team.name || "");
}

function isGoal(event) {
  const type = normalize(event && event.type);
  return type.includes("gol") && !type.includes("iptal");
}

function goalTimeline(match) {
  return ((match && match.events) || [])
    .filter(isGoal)
    .map((event) => ({ minute: minuteOf(event), team: eventTeam(event), detail: event.detail || "" }))
    .filter((goal) => goal.minute !== null && goal.team)
    .sort((left, right) => left.minute - right.minute);
}

function statPair(match, type) {
  const row = ((match && match.statistics) || [])
    .find((item) => normalize(item && item.type) === normalize(type));
  if (!row) return null;
  if (!isNumber(row.home) || !isNumber(row.away)) return null;
  return { home: Number(row.home), away: Number(row.away) };
}

function insight(id, weight, text, basis) {
  return { id, weight, text, basis };
}

/**
 * SON DAKİKA KARARI.
 *
 * Maçın skoru 80. dakikadan sonra değiştiyse, bu skorun en belirleyici
 * bilgisidir ve ilk cümle olmalıdır.
 */
function lateDecider(match, goals, score) {
  if (goals.length < 1) return null;
  const last = goals[goals.length - 1];
  if (last.minute < LATE_MINUTE) return null;

  // Son gol skoru DEĞİŞTİRDİ mi? Beraberliği bozduysa ya da eşitlediyse evet.
  const before = goals.slice(0, -1).reduce(
    (tally, goal) => {
      if (normalize(goal.team) === normalize(match.homeTeam)) tally.home += 1;
      else tally.away += 1;
      return tally;
    },
    { home: 0, away: 0 }
  );

  const wasLevel = before.home === before.away;
  const isLevel = score.home === score.away;

  if (wasLevel && !isLevel) {
    return insight("late-winner", WEIGHT.decisive,
      `Skoru ${last.minute}. dakikada ${last.team} belirledi; o ana kadar taraflar eşitti.`,
      `Gol akışı · son gol ${last.minute}'`);
  }
  if (!wasLevel && isLevel) {
    return insight("late-equaliser", WEIGHT.decisive,
      `${last.team} ${last.minute}. dakikada eşitliği yakaladı ve maç beraberlikle bitti.`,
      `Gol akışı · son gol ${last.minute}'`);
  }
  return null;
}

/**
 * GERİ DÖNÜŞ.
 *
 * Bir taraf geride düşüp sonra öne geçtiyse, skorun arkasındaki hikâye budur.
 */
function comeback(match, goals, score) {
  if (goals.length < 2 || score.home === score.away) return null;

  const winner = score.home > score.away ? match.homeTeam : match.awayTeam;
  let home = 0;
  let away = 0;
  let winnerTrailed = false;
  let trailingMinute = null;

  for (const goal of goals) {
    if (normalize(goal.team) === normalize(match.homeTeam)) home += 1;
    else away += 1;

    const winnerIsHome = normalize(winner) === normalize(match.homeTeam);
    const winnerGoals = winnerIsHome ? home : away;
    const otherGoals = winnerIsHome ? away : home;
    if (winnerGoals < otherGoals && !winnerTrailed) {
      winnerTrailed = true;
      trailingMinute = goal.minute;
    }
  }

  if (!winnerTrailed) return null;
  return insight("comeback", WEIGHT.decisive,
    `${winner} ${trailingMinute}. dakikada geriye düştüğü maçı çevirdi.`,
    "Gol akışı · skor sırası");
}

/**
 * OYUNUN AKIŞI.
 *
 * Topa sahip olma ve şut sayısı ölçülmüşse, üstünlüğün skora yansıyıp
 * yansımadığı skorun en anlamlı bağlamıdır.
 */
function flowRead(match, score) {
  const possession = statPair(match, "Topla oynama");
  const shots = statPair(match, "Toplam şut");
  if (!possession && !shots) return null;

  const homeAhead = score.home > score.away;
  const awayAhead = score.away > score.home;

  if (possession) {
    const gap = possession.home - possession.away;
    const dominant = gap > 0 ? match.homeTeam : match.awayTeam;
    const dominantWon = (gap > 0 && homeAhead) || (gap < 0 && awayAhead);

    if (Math.abs(gap) >= 20) {
      return dominantWon
        ? insight("flow-converted", WEIGHT.flow,
          `${dominant} topa %${Math.round(Math.max(possession.home, possession.away))} sahip olduğu maçı kazandı.`,
          `Topla oynama ${possession.home}-${possession.away}`)
        : insight("flow-unconverted", WEIGHT.flow,
          `${dominant} topa %${Math.round(Math.max(possession.home, possession.away))} sahip oldu ama skoru buna çeviremedi.`,
          `Topla oynama ${possession.home}-${possession.away}`);
    }
  }

  if (shots) {
    const gap = shots.home - shots.away;
    if (Math.abs(gap) >= 6) {
      const dominant = gap > 0 ? match.homeTeam : match.awayTeam;
      const dominantWon = (gap > 0 && homeAhead) || (gap < 0 && awayAhead);
      return insight(dominantWon ? "shots-converted" : "shots-unconverted", WEIGHT.flow,
        dominantWon
          ? `${dominant} ${Math.max(shots.home, shots.away)} şutla baskıyı skora çevirdi.`
          : `${dominant} ${Math.max(shots.home, shots.away)} şut çekti ama sonucu alamadı.`,
        `Toplam şut ${shots.home}-${shots.away}`);
    }
  }

  return null;
}

/** SONUCUN BİÇİMİ: fark, gol yememe, gol sessizliği. */
function marginRead(match, goals, score) {
  const margin = Math.abs(score.home - score.away);

  if (margin >= WIDE_MARGIN) {
    const winner = score.home > score.away ? match.homeTeam : match.awayTeam;
    return insight("wide-margin", WEIGHT.margin,
      `${winner} maçı ${margin} gol farkıyla bitirdi.`,
      `Skor ${score.home}-${score.away}`);
  }

  if (score.home === 0 && score.away === 0) {
    return insight("goalless", WEIGHT.margin,
      "Karşılaşma gol sesi çıkmadan tamamlandı.",
      `Skor ${score.home}-${score.away}`);
  }

  if (margin > 0 && Math.min(score.home, score.away) === 0) {
    const winner = score.home > score.away ? match.homeTeam : match.awayTeam;
    return insight("clean-sheet", WEIGHT.margin,
      `${winner} kalesini gole kapatarak kazandı.`,
      `Skor ${score.home}-${score.away}`);
  }

  if (goals.length >= 5) {
    return insight("high-scoring", WEIGHT.margin,
      `Maçta ${goals.length} gol görüldü.`,
      `Gol akışı · ${goals.length} gol`);
  }

  return null;
}

/** ÇERÇEVE: turnuva ve saha. En zayıf içgörü; yalnızca yer kalırsa girer. */
function contextRead(match) {
  const league = displayLeagueName(match && match.league, "");
  if (!league) return null;

  const venue = match && match.venue && match.venue !== "Açıklanmadı" ? match.venue : null;
  return insight("context", WEIGHT.context,
    venue ? `${league} karşılaşması ${venue} sahasında oynandı.` : `${league} karşılaşması.`,
    venue ? "Turnuva ve saha kaydı" : "Turnuva kaydı");
}

/**
 * Maçın içgörüleri.
 *
 * @returns {{status: string, insights: Array, headline: string|null,
 *   reason: string, measuredFrom: Array<string>}}
 */
function matchInsights(match, options = {}) {
  const limit = Number.isFinite(options.limit) ? Math.max(1, options.limit) : MAX_INSIGHTS;
  const score = scoreOf(match);

  if (!score) {
    return {
      status: "unavailable",
      insights: [],
      headline: null,
      reason: "Karşılaşmanın doğrulanmış skoru henüz ulaşmadı; içgörü üretilmiyor.",
      measuredFrom: []
    };
  }

  const goals = goalTimeline(match);
  const measuredFrom = [];
  if (goals.length) measuredFrom.push("gol akışı");
  if (((match && match.statistics) || []).length) measuredFrom.push("maç istatistikleri");

  const candidates = [
    lateDecider(match, goals, score),
    comeback(match, goals, score),
    flowRead(match, score),
    marginRead(match, goals, score),
    contextRead(match)
  ].filter(Boolean);

  // Aynı kimlikten iki cümle basılmaz; en ağır olan kazanır.
  const seen = new Set();
  const insights = candidates
    .sort((left, right) => right.weight - left.weight)
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .slice(0, limit);

  if (!insights.length) {
    return {
      status: "unavailable",
      insights: [],
      headline: null,
      reason: "Skor dışında ölçülmüş veri yok; skorun arkasındaki hikâye için olay akışı ya da istatistik bekleniyor.",
      measuredFrom
    };
  }

  // Yalnızca skordan türeyen bir cümle varsa bu "kısmi" bir okumadır: olay
  // akışı ve istatistik gelmeden hikâye tamamlanmaz.
  const status = goals.length || ((match && match.statistics) || []).length ? "ready" : "partial";

  return {
    status,
    insights,
    headline: insights[0].text,
    reason: status === "partial"
      ? "Bu okuma yalnızca skora dayanıyor; olay akışı ve istatistik geldiğinde genişleyecek."
      : "",
    measuredFrom
  };
}

/**
 * KART İÇİN TEK CÜMLE.
 *
 * Maç kartında bir satırlık yer var. En ağır içgörü seçilir; hiçbiri yoksa
 * boş dize DEĞİL, null döner — çağıran satırı hiç çizmez. Kartta boş bir
 * satır bırakmak, orada bir şey olması gerektiğini ima eder.
 */
function matchInsightLine(match, options = {}) {
  const result = matchInsights(match, { ...options, limit: 1 });
  return result.insights.length ? result.insights[0].text : null;
}

module.exports = {
  LATE_MINUTE,
  MAX_INSIGHTS,
  WEIGHT,
  WIDE_MARGIN,
  matchInsightLine,
  matchInsights
};
