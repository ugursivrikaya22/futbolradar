/**
 * RADAR SİNYALİ — maç kartındaki tek satırlık okuma.
 *
 * Kart üzerinde eskiden "Tahmini kazanma · Ev %54" yazan bir çubuk vardı.
 * Yüzde, bir olasılık İDDİASIDIR ve maç kartında oran gibi okunuyordu;
 * dahası çoğu maçta hiç ölçülmemişti. Yerine geçen sinyal bir tahmin değil,
 * ELDEKİ KAYDIN OKUNUŞUDUR: hangi ölçüden çıktığı `basis` alanında yazılıdır.
 *
 * ── DİL KURALI ──────────────────────────────────────────────────────────────
 * Sinyal yalnızca analiz diliyle konuşur. Sonuç vaadi, oran, yüzde ya da
 * bahis çağrışımı taşıyan ifade ÜRETİLMEZ. FORBIDDEN_TERMS listesindeki
 * kelimeler hiçbir etikette geçemez; scripts/test-match-signal.mjs bunu her
 * koşuda doğrular. Yeni bir etiket eklerken listeyi gevşetmek değil,
 * etiketi değiştirmek doğru olandır.
 *
 * ── ÖLÇÜ YOKSA SİNYAL DE YOK ────────────────────────────────────────────────
 * Veri yetmiyorsa "Veri yetersiz" yazılır. Bu bir kusur itirafı değil,
 * ölçümün kendisi: okuyucu neyin bilindiğini ve neyin bilinmediğini görür.
 */

/** Hiçbir sinyal etiketinde geçemeyecek kelimeler. */
const FORBIDDEN_TERMS = Object.freeze([
  "banko", "kupon", "garanti", "kesin", "iddaa", "bahis", "oran", "tahmin"
]);

/** Üretilebilecek etiketlerin tamamı. Liste dışı etiket üretilmez. */
const SIGNAL_LABELS = Object.freeze({
  homeForm: "Form avantajı ev sahibinde",
  awayForm: "Form avantajı deplasmanda",
  goals: "Gol eğilimi yüksek",
  balanced: "Form dengesi yakın",
  ready: "Analiz hazır",
  live: "Maç sürüyor",
  finished: "Maç tamamlandı",
  insufficient: "Veri yetersiz"
});

/** Form farkının "avantaj" sayılması için gereken en küçük puan farkı. */
const FORM_EDGE_POINTS = 20;

/** Form okuması için gereken en az maç sayısı. */
const MIN_FORM_MATCHES = 3;

const LIVE_STATUSES = ["LIVE", "IN_PLAY", "1H", "2H", "HT", "HALFTIME", "ET"];
const FINISHED_STATUSES = ["FINISHED", "FT", "AET", "PEN"];

function normalize(value) {
  return String(value || "").toLocaleLowerCase("tr").trim();
}

/**
 * Son maçlardan kazanılan puanın yüzdesi. Kayıt yoksa null döner — sıfır
 * DEĞİL: "form kaydı yok" ile "hiç puan almamış" aynı şey değildir.
 */
function formPercent(team) {
  const form = team && Array.isArray(team.form) ? team.form : null;
  if (!form || form.length < MIN_FORM_MATCHES) return null;

  const earned = form.reduce((total, entry) => {
    const result = normalize(entry && (entry.result || entry.label));
    if (result === "win" || result === "g") return total + 3;
    if (result === "draw" || result === "b") return total + 1;
    return total;
  }, 0);

  return Math.round((earned / (form.length * 3)) * 100);
}

function hasPositiveGoalTrend(team) {
  return normalize(team && team.goalTrend) === "pozitif";
}

/**
 * Maçın radar sinyali.
 *
 * @param {object} match  Maç kaydı (status, homeTeam, awayTeam, analysisPage)
 * @param {{homeTeam?: object, awayTeam?: object, analysisReady?: boolean}} context
 *        Takım kayıtları data/teams.json'dan; `analysisReady` maç için
 *        yayımlanmış bir analiz/rapor sayfası olup olmadığıdır.
 * @returns {{key: string, label: string, basis: string, tone: string}}
 */
function matchSignal(match, context = {}) {
  const status = String((match && match.status) || "").toUpperCase();
  const home = context.homeTeam || null;
  const away = context.awayTeam || null;
  const analysisReady = Boolean(context.analysisReady || (match && match.analysisPage));

  if (LIVE_STATUSES.includes(status)) {
    return {
      key: "live",
      label: SIGNAL_LABELS.live,
      basis: "Maç durumu doğrulanmış kayıttan okundu.",
      tone: "live"
    };
  }

  if (FINISHED_STATUSES.includes(status)) {
    return analysisReady
      ? {
        key: "ready",
        label: SIGNAL_LABELS.ready,
        basis: "Bu karşılaşma için yayımlanmış maç raporu var.",
        tone: "ready"
      }
      : {
        key: "finished",
        label: SIGNAL_LABELS.finished,
        basis: "Maç durumu doğrulanmış kayıttan okundu.",
        tone: "neutral"
      };
  }

  const homeForm = formPercent(home);
  const awayForm = formPercent(away);

  // KARŞILAŞTIRMA İÇİN İKİSİ DE GEREKLİ. Tek takımın formunu bilmek bir form
  // sinyali üretmeye yetmez: "avantaj" bir farktır, farkın da iki ucu olur.
  // Bu yüzden taraflardan HERHANGİ BİRİNİN kaydı MIN_FORM_MATCHES'e
  // ulaşmıyorsa bu blok atlanır ve sinyal "Veri yetersiz" olur.
  if (homeForm !== null && awayForm !== null) {
    const gap = homeForm - awayForm;

    if (Math.abs(gap) >= FORM_EDGE_POINTS) {
      const homeAdvantage = gap > 0;
      return {
        key: homeAdvantage ? "homeForm" : "awayForm",
        label: homeAdvantage ? SIGNAL_LABELS.homeForm : SIGNAL_LABELS.awayForm,
        basis: `Son ${Math.min(home.form.length, away.form.length)} maç puan oranı: ${home.name || match.homeTeam} %${homeForm}, ${away.name || match.awayTeam} %${awayForm}.`,
        tone: "form"
      };
    }

    if (hasPositiveGoalTrend(home) && hasPositiveGoalTrend(away)) {
      return {
        key: "goals",
        label: SIGNAL_LABELS.goals,
        basis: "İki takımın da kayıtlı gol eğilimi pozitif.",
        tone: "goals"
      };
    }

    return {
      key: "balanced",
      label: SIGNAL_LABELS.balanced,
      basis: `Son maç puan oranları birbirine yakın: %${homeForm} - %${awayForm}.`,
      tone: "neutral"
    };
  }

  if (analysisReady) {
    return {
      key: "ready",
      label: SIGNAL_LABELS.ready,
      basis: "Bu karşılaşma için yayımlanmış maç öncesi analiz sayfası var.",
      tone: "ready"
    };
  }

  return {
    key: "insufficient",
    label: SIGNAL_LABELS.insufficient,
    basis: "Form okuması için iki takımın da doğrulanmış kaydı gerekiyor; en az biri henüz oluşmadı.",
    tone: "awaiting"
  };
}

/** Etiketin dil kuralına uyup uymadığı. Test ve QA bunu çağırır. */
function isAllowedSignalLabel(label) {
  const text = normalize(label);
  return !FORBIDDEN_TERMS.some((term) => text.includes(term));
}

module.exports = {
  FORBIDDEN_TERMS,
  FORM_EDGE_POINTS,
  MIN_FORM_MATCHES,
  SIGNAL_LABELS,
  formPercent,
  isAllowedSignalLabel,
  matchSignal
};
