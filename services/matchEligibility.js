/**
 * MAÇ YAYIN UYGUNLUĞU — tek yetkili kural.
 *
 * POLİTİKA DEĞİŞTİ. Önceki kural, eksik veriyle gelen her maçı tamamen
 * eleyordu. Sonuç, okuyucu açısından maçın HİÇ VAR OLMAMASIydı: sağlayıcı
 * bir karşılaşmanın ayrıntısını getiremediğinde fikstür de sayfadan
 * kayboluyordu ve bunun görünür hiçbir izi kalmıyordu.
 *
 * Yeni kural iki farklı soruyu ayırıyor:
 *
 *   1. Bu KARŞILAŞMA gerçek mi? (takımlar, başlama saati, onaylı kaynak)
 *      Hayırsa yayımlanmaz — uydurma fikstür üretmiyoruz.
 *   2. Ayrıntısı tam mı? (skor, durum, lig adı, doğrulama)
 *      Hayırsa fikstür YİNE DE yayımlanır, eksik alan "Veri bekleniyor"
 *      olarak işaretlenir.
 *
 * Yani bir maç artık yalnızca gerçekliği şüpheliyse elenir; verisi geç
 * geldiği için elenmez. Uydurma skor ya da uydurma analiz hiçbir durumda
 * üretilmez — eksik olan alan boş değil, AÇIKÇA "bekleniyor" gösterilir.
 *
 * Bu dosya tek karar noktasıdır. Aynı kuralı arama, canlı skor, takım
 * sayfaları, statik sayfa üreticileri ve site haritası birlikte kullanır;
 * aksi hâlde bir yerde elenen maç başka bir yerde sızar.
 *
 * Hem elenen hem eksik veriyle yayımlanan her maç iç günlüğe yazılır: veri
 * boşluğu sessiz kalmamalı.
 */

// Onaylı kaynaklar. Buraya girmeyen hiçbir kayıt yayımlanmaz — "mock" dahil.
const APPROVED_SOURCES = new Set([
  "manual_verified",
  "official_club",
  "api-football",
  "football-data",
  "thesportsdb"
]);

/**
 * KİMLİK alanları: bunlar olmadan dürüst bir fikstür satırı çizilemez.
 * Eksikse maç yayımlanmaz.
 */
const IDENTITY_FIELDS = ["homeTeam", "awayTeam", "kickoff"];

/**
 * Geriye dönük uyumluluk için korunuyor. Artık "eksikse ele" listesi değil;
 * league ve status eksikse maç yayımlanır, alan "Veri bekleniyor" olur.
 */
const REQUIRED_FIELDS = IDENTITY_FIELDS;

/** Yayın durumu: veri tamam mı, yoksa eksik alanlar mı bekleniyor. */
const PUBLISH_STATE = {
  COMPLETE: "complete",
  AWAITING_DATA: "awaiting-data"
};

/** Okuyucuya gösterilecek tek cümlelik bekleme ifadesi. */
const AWAITING_LABEL = "Veri bekleniyor";

/**
 * Başlama saatinden bu kadar saat sonra hâlâ "başlayacak" görünen bir kayıt,
 * sonucu bilinmeyen bir maçtır. Eskiden eleniyordu; artık sonucu bekleniyor
 * olarak gösteriliyor.
 */
const STALE_STATUS_HOURS = 3.5;

const FINISHED_STATUSES = new Set(["FINISHED", "FT", "AET", "PEN"]);
const LIVE_STATUSES = new Set(["LIVE", "IN_PLAY", "PAUSED", "HALFTIME", "1H", "HT", "2H", "ET", "BT", "P"]);

/**
 * Hazırlık ve alt seviye karşılaşmalar. Bu maçlar için sağlayıcının ham
 * kaydı yetmez: yayımlanmaları doğrulanmış (verified) veri gerektirir.
 * Sebep, bu kategoride sağlayıcı verisinin sık sık eksik, geç ve çelişkili
 * gelmesi — takvim kaydı maç bittikten saatler sonra hâlâ "SCHEDULED"
 * gösterebiliyor.
 */
function isFriendlyOrLowerTier(match) {
  const competition = String(match.competitionId || "").toLowerCase();
  const league = String(match.league || "").toLocaleLowerCase("tr-TR");
  return competition.includes("hazirlik") ||
    league.includes("hazırlık") ||
    league.includes("hazirlik") ||
    league.includes("friendly");
}

function isFinished(match) {
  return FINISHED_STATUSES.has(String(match.status || "").toUpperCase());
}

function isLive(match) {
  return LIVE_STATUSES.has(String(match.status || "").toUpperCase());
}

function hasNumericScore(match) {
  const score = match.score || {};
  return Number.isFinite(Number(score.home)) && score.home !== null && score.home !== "" &&
    Number.isFinite(Number(score.away)) && score.away !== null && score.away !== "";
}

/**
 * Bir maçın yayımlanıp yayımlanamayacağına ve verisinin tam olup olmadığına
 * karar verir.
 *
 * @returns {{eligible: boolean, reason: string, publishState: string,
 *   gaps: Array<{field: string, label: string}>}}
 */
function evaluateMatch(match, options = {}) {
  if (!match || typeof match !== "object") {
    return reject("kayıt yok");
  }

  // --- 1. Karşılaşma gerçek mi? Bunlar olmadan yayımlanmaz. ---

  const missingIdentity = IDENTITY_FIELDS.filter((field) => {
    const value = match[field];
    return value === null || value === undefined || String(value).trim() === "";
  });

  if (missingIdentity.length) {
    return reject(`kimlik alanı eksik: ${missingIdentity.join(", ")}`);
  }

  const kickoff = new Date(match.kickoff);
  if (Number.isNaN(kickoff.getTime())) {
    return reject("başlama saati okunamıyor");
  }

  const source = String(match.source || "").toLowerCase();
  if (!APPROVED_SOURCES.has(source)) {
    // Uydurma fikstür üretmiyoruz: kaynağı onaylı olmayan kayıt yayımlanmaz.
    return reject(`kaynak onaylı değil: ${source || "belirtilmemiş"}`);
  }

  // --- 2. Ayrıntısı tam mı? Eksikse yayımlanır, "bekleniyor" işaretlenir. ---

  const gaps = [];

  if (!String(match.league || "").trim()) {
    gaps.push({ field: "league", label: "Turnuva bilgisi bekleniyor" });
  }

  if (!String(match.status || "").trim()) {
    gaps.push({ field: "status", label: "Maç durumu bekleniyor" });
  }

  // Biten maçın skoru yoksa uydurulmaz ve maç da gizlenmez: skor alanı
  // açıkça "bekleniyor" gösterilir.
  if (isFinished(match) && !hasNumericScore(match)) {
    gaps.push({ field: "score", label: "Skor bekleniyor" });
  }

  const verified = String(match.dataStatus || "").toLowerCase() === "verified";
  if (isFriendlyOrLowerTier(match) && !verified) {
    // Hazırlık maçlarında sağlayıcı verisi sık sık geç ve eksik geliyor.
    // Eskiden bu maçlar tamamen eleniyordu; artık fikstür duruyor, ayrıntısı
    // doğrulanana kadar bekliyor olarak işaretleniyor.
    gaps.push({ field: "verification", label: "Ayrıntılar doğrulanmayı bekliyor" });
  }

  // Zaman tutarlılığı: başlama saati geçmiş ama kayıt hâlâ "başlayacak"
  // diyorsa elimizdeki veri maçın gerçek durumunu bilmiyordur. Bunu gizlemek
  // yerine söylüyoruz — okuyucu maçın oynandığını bilir, sonucun henüz
  // gelmediğini de görür.
  const now = options.now instanceof Date ? options.now : new Date();
  const hoursSinceKickoff = (now.getTime() - kickoff.getTime()) / 3600000;
  const stillPending = !isFinished(match) && !isLive(match);
  if (stillPending && hoursSinceKickoff > STALE_STATUS_HOURS) {
    gaps.push({ field: "status", label: "Sonuç bekleniyor" });
  }

  return {
    eligible: true,
    reason: "",
    publishState: gaps.length ? PUBLISH_STATE.AWAITING_DATA : PUBLISH_STATE.COMPLETE,
    gaps
  };
}

function reject(reason) {
  return { eligible: false, reason, publishState: null, gaps: [] };
}

function isPublishable(match, options) {
  return evaluateMatch(match, options).eligible;
}

/**
 * Maçı yayına hazırlar: yayın durumunu ve eksik alanları kaydın üzerine
 * yazar, böylece her yüzey (ana sayfa kartı, maç detayı, takım sayfası)
 * aynı bilgiyi görür ve kendi kuralını uydurmaz.
 */
function annotateMatch(match, options = {}) {
  const verdict = evaluateMatch(match, options);
  if (!verdict.eligible) return null;

  return {
    ...match,
    publishState: verdict.publishState,
    dataGaps: verdict.gaps,
    awaitingFields: verdict.gaps.map((gap) => gap.field)
  };
}

/**
 * Listeyi yayına hazırlar.
 *
 * `eligible` yayımlanacak maçları taşır — eksik verili olanlar DA burada,
 * yayın durumu işaretlenmiş hâlde. `excluded` yalnızca gerçekliği şüpheli
 * kayıtları taşır. `pending` ise eksik alanı olan maçların dökümü; çağıran
 * taraf bunu iç günlüğe yazar.
 */
function filterPublishable(matches, options = {}) {
  const eligible = [];
  const excluded = [];
  const pending = [];

  for (const match of Array.isArray(matches) ? matches : []) {
    const verdict = evaluateMatch(match, options);

    if (!verdict.eligible) {
      excluded.push({ id: (match && match.id) || "?", reason: verdict.reason });
      continue;
    }

    eligible.push({
      ...match,
      publishState: verdict.publishState,
      dataGaps: verdict.gaps,
      awaitingFields: verdict.gaps.map((gap) => gap.field)
    });

    if (verdict.gaps.length) {
      pending.push({
        id: (match && match.id) || "?",
        fields: verdict.gaps.map((gap) => gap.field)
      });
    }
  }

  return { eligible, excluded, pending };
}

/** İç günlük: elenen maçlar tek satırda, sayfa üreticileri ve CI için. */
function logExcluded(scope, excluded) {
  if (!excluded || !excluded.length) {
    return;
  }
  for (const item of excluded) {
    console.warn(`[futbolradar:match-excluded] scope=${scope} id=${item.id} reason="${item.reason}"`);
  }
}

/**
 * İç günlük: yayımlanan ama verisi eksik maçlar. Bunlar sayfada görünüyor,
 * o yüzden "excluded" değiller — ama boşluk sessiz kalmamalı, çünkü kalıcı
 * bir boşluk sağlayıcı tarafında bir sorunun tek işareti olabilir.
 */
function logDataGaps(scope, pending) {
  if (!pending || !pending.length) {
    return;
  }
  for (const item of pending) {
    console.warn(`[futbolradar:match-data-gap] scope=${scope} id=${item.id} awaiting="${item.fields.join(",")}"`);
  }
}

module.exports = {
  APPROVED_SOURCES,
  REQUIRED_FIELDS,
  IDENTITY_FIELDS,
  PUBLISH_STATE,
  AWAITING_LABEL,
  STALE_STATUS_HOURS,
  evaluateMatch,
  annotateMatch,
  isPublishable,
  filterPublishable,
  logExcluded,
  logDataGaps,
  isFriendlyOrLowerTier
};
