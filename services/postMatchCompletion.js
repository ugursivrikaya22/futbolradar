/**
 * MAÇ SONU ANALİZİ TAMAM MI? — tek yetkili karar.
 *
 * Rapor katmanı (services/matchReportService.js) bölümleri üretir; aşama
 * katmanı (services/matchReportStages.js) boru hattının o anki durumunu
 * söyler. İkisi de "bu maçın analizi bitti mi?" sorusuna cevap VERMİYORDU.
 *
 * Aradaki fark okuyucu için belirleyici. Hazırlık maçının istatistiği hiç
 * gelmedi ve gelmeyecek; o maçın raporu elde olan her şeyi yazdıysa BİTMİŞTİR.
 * Sayfada günlerce "Kısmi rapor · veri tamamlanmadı" yazması, tamamlanmış bir
 * işi yarım gösterir ve okuyucuya beklemesi gereken bir şey olduğunu ima eder.
 *
 * DÖRT DURUM, İKİSİ BAŞARILI:
 *
 *   complete         Kapsam tam VE desteklenen her bölüm yazıldı.
 *   limited_complete Kapsam sınırlı ama desteklenen her bölüm yazıldı.
 *                    Bu bir kusur DEĞİLDİR: veri neyse o kadarı işlendi.
 *   incomplete       VERİSİ OLAN bir bölüm yazılmamış. Gerçek bir boşluk.
 *   invalid          Kayıtta çelişki var. Yayımlanmaz.
 *
 * `invalid` en ağır durum ve sessiz kalmaz: her sorun gerekçesiyle günlüğe
 * yazılır. Çelişkili bir analizi yayımlamak, hiç yayımlamamaktan kötüdür —
 * okuyucu yanlış bilgiyi doğru sanır.
 */

const {
  COVERAGE_LEVEL,
  coverageLevel,
  expectedSections,
  lineupsWithPlayers
} = require("./matchDataCoverage.js");
const {
  eventMinute,
  eventTeamName,
  goalEvents,
  isType,
  normalizeText,
  playerFromDetail
} = require("./matchEvents.js");
const { isInPlayStatus, isNotPlayedStatus, matchStatusOf, MATCH_STATUS } = require("./matchStatus.js");

const TEMPLATE = require("../templates/analysis-completion.json");

/** Tamamlanma durumları. Metinleri templates/analysis-completion.json'da. */
const COMPLETION = Object.freeze({
  COMPLETE: "complete",
  LIMITED_COMPLETE: "limited_complete",
  INCOMPLETE: "incomplete",
  INVALID: "invalid"
});

const COMPLETION_LABELS = Object.freeze(TEMPLATE.completion);

const LABEL_BY_KEY = Object.freeze(
  Object.fromEntries(Object.values(COMPLETION_LABELS).map((entry) => [entry.key, entry]))
);

/**
 * HİÇBİR MAÇTA MÜMKÜN OLMAYAN DAKİKA.
 *
 * Uzatmalı bir maç 120 dakika sürer; penaltılar dakika taşımaz. Hakem
 * uzatması en cömert hâliyle bile 120+10'u geçmez. Bunun üstündeki bir
 * dakika, veri hatasıdır — ve maç sonu analizinde "127. dakikada gol"
 * cümlesi okuyucunun güvenini tek başına bitirir.
 */
const MAX_EVENT_MINUTE = 130;

/** İlk yarının son dakikası (uzatması hariç). */
const FIRST_HALF_END = 45;

/**
 * YER TUTUCU İZLERİ.
 *
 * Bu belirteçleri taşıyan bir kimlik gerçek bir maça ait değildir; deneme
 * verisi yayına sızmış demektir. Yayımlanmadan önce yakalanmalı.
 */
const PLACEHOLDER_MARKERS = Object.freeze([
  "mock", "placeholder", "dummy", "sample", "example", "lorem", "test-", "-test",
  "demo", "yer-tutucu", "ornek-", "örnek-", "tbd", "todo"
]);

function isNumber(value) {
  return Number.isFinite(Number(value)) && value !== null && value !== "";
}

function problem(code, message) {
  return { code, message };
}

function looksLikePlaceholder(value) {
  const text = normalizeText(value);
  if (!text) return false;
  return PLACEHOLDER_MARKERS.some((marker) => text.includes(normalizeText(marker)));
}

/**
 * Golün hangi takıma yazılacağı.
 *
 * DEPO SÖZLEŞMESİ: `event.team` GOLÜN YAZILDIĞI takımdır — kendi kalesine
 * gollerde bile. Konyaspor - Hull City kaydında 52. dakikadaki kendi kalesine
 * gol `team: "Hull City"` taşıyor, çünkü skoru Hull City'nin lehine değiştiren
 * odur.
 *
 * Sezgi bunun tersini söylüyor ("kendi kalesine golü atan takım kimse olay
 * onundur") ve bu fonksiyon tam olarak o sezgiyi bir kez uyguladığı için
 * dürüst bir kaydı "gol sayısı skoru aşıyor" diye geçersiz saydı. Sözleşme
 * services/matchReportService.js içinde de yaşıyor: özet, kendi kalesine
 * gollerde takım adını hiç yazmaz ki okuyucu golü o takımın bir oyuncusunun
 * attığını sanmasın.
 */
function scoringTeamOf(event) {
  return eventTeamName(event);
}

/**
 * ANALİZ DOĞRULAMASI.
 *
 * Her denetim "kayıt kendi içinde tutarlı mı?" sorusunu sorar; hiçbiri dış
 * kaynağa gitmez. Denetimlerin çoğu ANCAK ÖN KOŞULU VARSA çalışır: örneğin
 * gol/devre tutarlılığı yalnızca olay akışı tamsa denetlenir, çünkü eksik
 * bir akışta "goller devre skoruyla uyuşmuyor" demek eksikliği çelişki gibi
 * gösterirdi.
 *
 * @returns {{ok: boolean, problems: Array<{code: string, message: string}>}}
 */
function validateAnalysis({ match, report } = {}) {
  const problems = [];

  if (!match || typeof match !== "object") {
    return { ok: false, problems: [problem("match-missing", "Maç kaydı yok.")] };
  }

  // --- Kimlik ---
  const id = String(match.id || "").trim();
  if (!id) {
    problems.push(problem("identity-missing", "Maç kimliği boş."));
  }
  if (report && String(report.matchId || "") !== id) {
    problems.push(problem(
      "identity-mismatch",
      `Rapor başka bir maça bağlı: rapor "${report.matchId}", kayıt "${id}".`
    ));
  }
  for (const [field, value] of [["id", match.id], ["providerId", match.providerId],
    ["homeTeam", match.homeTeam], ["awayTeam", match.awayTeam]]) {
    if (value && looksLikePlaceholder(value)) {
      problems.push(problem("placeholder-identity", `Yer tutucu değer yayına sızmış: ${field}="${value}".`));
    }
  }

  // --- Takımlar ---
  const home = String(match.homeTeam || "").trim();
  const away = String(match.awayTeam || "").trim();
  if (!home || !away) {
    problems.push(problem("teams-missing", "Ev sahibi ya da deplasman takımı boş."));
  } else if (normalizeText(home) === normalizeText(away)) {
    problems.push(problem("teams-identical", `Aynı takım iki tarafta da yazılı: "${home}".`));
  }

  // --- Turnuva ve tarih ---
  if (!String(match.league || "").trim()) {
    problems.push(problem("competition-missing", "Turnuva adı boş."));
  }
  if (Number.isNaN(Date.parse(match.kickoff || match.date || ""))) {
    problems.push(problem("date-unreadable", `Başlama saati okunamıyor: "${match.kickoff || match.date || ""}".`));
  }

  // --- Durum ---
  const status = matchStatusOf(match);
  if (isInPlayStatus(status)) {
    problems.push(problem("status-in-play", "Oynanmakta olan maça maç sonu analizi yazılamaz."));
  }
  if (isNotPlayedStatus(status)) {
    problems.push(problem(
      "status-not-played",
      `Sahada tamamlanmamış maça analiz yazılamaz (durum: ${status}).`
    ));
  }

  // --- Skor ---
  const score = match.score || {};
  if (!isNumber(score.home) || !isNumber(score.away)) {
    problems.push(problem("score-missing", "Kesin skor yok."));
  } else if (Number(score.home) < 0 || Number(score.away) < 0) {
    problems.push(problem("score-negative", `Negatif skor: ${score.home}-${score.away}.`));
  }

  const events = Array.isArray(match.events) ? match.events : [];

  // --- Kronoloji ---
  for (const event of events) {
    const minute = eventMinute(event);
    if (minute !== null && minute > MAX_EVENT_MINUTE) {
      problems.push(problem(
        "impossible-minute",
        `Maç bitiminden sonrası için olay kaydı: ${minute}. dakika ("${event.type || "olay"}").`
      ));
    }
  }

  // --- Yinelenen olay ---
  const seenEvents = new Set();
  for (const event of events) {
    const key = [String(event.time || ""), normalizeText(eventTeamName(event)),
      normalizeText(event.type), normalizeText(event.detail)].join("|");
    if (seenEvents.has(key)) {
      problems.push(problem(
        "duplicate-event",
        `Aynı olay iki kez kayıtlı: ${event.time || "?"} ${event.type || "olay"}.`
      ));
    }
    seenEvents.add(key);
  }

  // --- Gol sayısı skoru aşamaz ---
  const goals = goalEvents(match);
  if (isNumber(score.home) && isNumber(score.away)) {
    const tally = { home: 0, away: 0 };
    for (const event of goals) {
      const team = scoringTeamOf(event);
      if (normalizeText(team) === normalizeText(home)) tally.home += 1;
      else if (normalizeText(team) === normalizeText(away)) tally.away += 1;
    }
    if (tally.home > Number(score.home) || tally.away > Number(score.away)) {
      problems.push(problem(
        "goal-count-exceeds-score",
        `Olay akışındaki gol sayısı skoru aşıyor: akış ${tally.home}-${tally.away}, skor ${score.home}-${score.away}.`
      ));
    }

    /**
     * DEVRE SKORU TUTARLILIĞI — yalnızca akış TAMSA denetlenir.
     *
     * Akıştaki gol sayısı final skora eşitse elimizde eksiksiz bir gol
     * kronolojisi var demektir; o zaman ilk yarıda atılanların toplamı devre
     * skoruna eşit olmak ZORUNDA. Akış eksikse bu denetim çalışmaz: eksik
     * veriyi çelişki diye raporlamak, dürüst bir kaydı geçersiz yapardı.
     */
    const feedComplete = tally.home === Number(score.home) && tally.away === Number(score.away);
    const halftimeKnown = isNumber(score.halftimeHome) && isNumber(score.halftimeAway);
    const allTimed = goals.every((event) => eventMinute(event) !== null);
    if (feedComplete && halftimeKnown && allTimed && goals.length) {
      const firstHalf = { home: 0, away: 0 };
      for (const event of goals) {
        const minute = eventMinute(event);
        // "45+2" olayı ilk yarıya aittir: eventMinute onu 47 yapar, bu yüzden
        // ham dakika alanının başındaki sayıya bakılır.
        const rawMinute = Number(String(event.time || "").match(/(\d+)/)?.[1]);
        const inFirstHalf = Number.isFinite(rawMinute) ? rawMinute <= FIRST_HALF_END : minute <= FIRST_HALF_END;
        if (!inFirstHalf) continue;
        const team = scoringTeamOf(event);
        if (normalizeText(team) === normalizeText(home)) firstHalf.home += 1;
        else if (normalizeText(team) === normalizeText(away)) firstHalf.away += 1;
      }
      if (firstHalf.home !== Number(score.halftimeHome) || firstHalf.away !== Number(score.halftimeAway)) {
        problems.push(problem(
          "halftime-mismatch",
          `İlk yarı golleri devre skoruyla uyuşmuyor: akış ${firstHalf.home}-${firstHalf.away}, ` +
          `devre ${score.halftimeHome}-${score.halftimeAway}.`
        ));
      }
    }
  }

  // --- Oyuncu yanlış takıma yazılmış mı? ---
  const squads = lineupsWithPlayers(match);
  if (squads.length >= 2) {
    const squadOf = new Map();
    for (const squad of squads) {
      for (const player of squad.players || []) {
        squadOf.set(normalizeText(player), squad.team);
      }
    }
    for (const event of events) {
      // Yalnızca atıfı tartışmasız olan olaylar denetlenir. "Kurtarış"ta
      // metinde önce şutu çeken oyuncu geçer, kaleci sonra; kendi kalesine
      // gollerde ise adı geçen oyuncu rakip takımdandır.
      const ownGoal = /kendi kalesine/i.test(String(event.detail || ""));
      if (ownGoal || !isType(event, "gol", "kırmızı", "sarı")) continue;
      const player = playerFromDetail(event.detail);
      const team = eventTeamName(event);
      if (!player || !team) continue;
      const listedTeam = squadOf.get(normalizeText(player));
      if (listedTeam && normalizeText(listedTeam) !== normalizeText(team)) {
        problems.push(problem(
          "player-wrong-team",
          `"${player}" olayda ${team} adına yazılmış ama kadroda ${listedTeam} oyuncusu.`
        ));
      }
    }
  }

  // --- Momentum ile metin çelişiyor mu? ---
  const momentum = report && report.sections && report.sections.momentum;
  if (momentum && momentum.status === "ready" && goals.length) {
    const earliest = goals
      .map((event) => ({ event, minute: eventMinute(event) }))
      .filter((item) => item.minute !== null)
      .sort((left, right) => left.minute - right.minute)[0];
    const claim = (momentum.readings || []).find((line) => /İlk gol/.test(line));
    if (earliest && claim) {
      const team = eventTeamName(earliest.event);
      if (team && !normalizeText(claim).includes(normalizeText(team))) {
        problems.push(problem(
          "momentum-contradiction",
          `Momentum okuması ilk golü başka takıma yazıyor: "${claim}" (akışta ilk gol ${team}).`
        ));
      }
    }
  }

  return { ok: problems.length === 0, problems };
}

/**
 * TAMAMLANMA DURUMU.
 *
 * @param {{match: object, report: object}} params
 * @returns {{status: string, label: object, level: string, levelLabel: object,
 *            expected: string[], missing: string[], delivered: string[],
 *            problems: Array<object>, inventory: object}}
 */
function evaluateCompletion({ match, report } = {}) {
  const coverage = coverageLevel(match);
  const validation = validateAnalysis({ match, report });

  const expected = expectedSections(match);
  const sections = (report && report.sections) || {};

  /**
   * BÖLÜM "YAZILDI" SAYILMANIN ÖLÇÜSÜ: unavailable OLMAMASI.
   *
   * "partial" bir kusur değil, bir dürüstlük: bölüm elindeki veriyle ne
   * söylenebiliyorsa onu söylemiş demektir. Yalnızca "unavailable" gerçek
   * bir boşluktur — bölüm hiçbir şey yazamamıştır.
   */
  const delivered = expected.filter((key) => sections[key] && sections[key].status !== "unavailable");
  const missing = expected.filter((key) => !sections[key] || sections[key].status === "unavailable");

  if (!validation.ok) {
    return {
      status: COMPLETION.INVALID,
      label: COMPLETION_LABELS.invalid,
      level: coverage.level,
      levelLabel: coverage.label,
      expected,
      delivered,
      missing,
      problems: validation.problems,
      inventory: coverage.inventory
    };
  }

  if (missing.length) {
    return {
      status: COMPLETION.INCOMPLETE,
      label: COMPLETION_LABELS.incomplete,
      level: coverage.level,
      levelLabel: coverage.label,
      expected,
      delivered,
      missing,
      problems: [],
      inventory: coverage.inventory
    };
  }

  const complete = coverage.level === COVERAGE_LEVEL.FULL;
  return {
    status: complete ? COMPLETION.COMPLETE : COMPLETION.LIMITED_COMPLETE,
    label: complete ? COMPLETION_LABELS.complete : COMPLETION_LABELS.limitedComplete,
    level: coverage.level,
    levelLabel: coverage.label,
    expected,
    delivered,
    missing,
    problems: [],
    inventory: coverage.inventory
  };
}

/** Durum anahtarından etiket. Bilinmeyen anahtar uydurulmaz. */
function completionLabel(key) {
  return LABEL_BY_KEY[String(key || "")] || null;
}

/** Başarılı sayılan durumlar: yayımlanabilir analiz. */
function isPublishableCompletion(status) {
  return status === COMPLETION.COMPLETE || status === COMPLETION.LIMITED_COMPLETE;
}

/** İç günlük: geçersiz ya da eksik analiz sessizce geçmesin. */
function logCompletionIssues(scope, entries) {
  for (const item of entries || []) {
    if (isPublishableCompletion(item.status)) continue;
    const detail = item.status === COMPLETION.INVALID
      ? (item.problems || []).map((row) => row.code).join(", ")
      : (item.missing || []).join(", ");
    console.warn(
      `[futbolradar:analysis-completion] scope=${scope} id=${item.id} status=${item.status} detail="${detail}"`
    );
  }
}

module.exports = {
  COMPLETION,
  COMPLETION_LABELS,
  FIRST_HALF_END,
  MAX_EVENT_MINUTE,
  MATCH_STATUS,
  PLACEHOLDER_MARKERS,
  completionLabel,
  evaluateCompletion,
  isPublishableCompletion,
  logCompletionIssues,
  looksLikePlaceholder,
  validateAnalysis
};
