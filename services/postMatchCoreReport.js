/**
 * MAÇ SONU RAPORUNUN OMURGASI — beş bölüm.
 *
 * SORUN. Rapor on beş bölüm üretiyor: özet, öne çıkan oyuncular, momentum,
 * sinyaller, istatistik, taktik, ilk yarı, ikinci yarı, kırılma anları, son
 * bölüm, bitiş türü, teknik kararlar, nihai değerlendirme, puan, sonraki maç.
 * Hepsi ölçüme dayalı ve hepsi doğru — ama on beş eşit ağırlıklı başlık bir
 * RAPOR değil, bir veri dökümüdür. Okuyucu nereden başlayacağını bilmiyor.
 *
 * ÇÖZÜM. Beş soruya indirgenmiş bir omurga:
 *
 *   1. Ne oldu?            → maç özeti
 *   2. Maç nerede döndü?   → kırılma anı
 *   3. Takımlar nasıldı?   → takım performansı
 *   4. Kim etkiledi?       → oyuncu etkisi
 *   5. Teknik direktör ne dedi? → doğrulanmış açıklama, YOKSA "veri yok"
 *
 * Omurga mevcut bölümleri YENİDEN HESAPLAMAZ; onları seçer ve sıralar.
 * Yeniden hesaplasaydı aynı veriden iki farklı sonuç çıkabilir ve sayfanın
 * iki yeri birbiriyle çelişirdi.
 *
 * "VERİ YOK" BİR BAŞARISIZLIK DEĞİL, BİR CEVAPTIR. Bölüm boş kalıyorsa
 * gerekçesi yazılır. Sağlayıcının vermediği bir istatistiği tahmin etmek ya
 * da bir teknik direktörün ağzına cümle koymak, boş bırakmaktan çok daha
 * kötüdür — ikincisi dürüst, birincisi uydurma.
 */
const { quotesForMatch } = require("./managerQuotes");

/** Bölüm sırası ekrandaki sıradır: olaydan yoruma doğru. */
const CORE_SECTIONS = Object.freeze([
  {
    key: "summary",
    title: "Maç özeti",
    question: "Ne oldu?",
    from: ["summary"]
  },
  {
    key: "turning-point",
    title: "Kırılma anı",
    question: "Maç nerede döndü?",
    from: ["turningPoints"]
  },
  {
    key: "team-performance",
    title: "Takım performansı",
    question: "İki takım nasıl oynadı?",
    // İstatistik yoksa taktik okuma devreye girer: ikisi de aynı soruyu
    // farklı kanıtla yanıtlıyor.
    from: ["statistics", "tactical"]
  },
  {
    key: "player-impact",
    title: "Oyuncu etkisi",
    question: "Sonucu kim belirledi?",
    from: ["standoutPlayers"]
  },
  {
    key: "manager-comment",
    // Bölüm artık yalnızca teknik direktör alıntısı taşımıyor: futbolcu
    // açıklamaları da aynı doğrulamadan geçip buraya giriyor. Başlık
    // "Teknik direktör yorumu" kalsaydı, altındaki futbolcu alıntısını
    // yanlış bir sıfatla sunardı. Anahtar (`manager-comment`) geriye dönük
    // uyumluluk için değişmedi — ona bağlı seçiciler ve testler var.
    title: "Maç sonu açıklamaları",
    question: "Maç sonrası kim ne dedi?",
    // Bu bölümün kaynağı ölçüm DEĞİL, kayıtlı alıntıdır. from listesi boş:
    // hiçbir hesaplanmış bölümden türetilemez.
    from: []
  }
]);

/**
 * Bölüm boşken gösterilecek tek biçimli ifade.
 *
 * "Veri yok" demiyoruz: okuyucuya sistemin durumunu değil, kendi bekleyişini
 * anlatan bir cümle daha doğru. Bölümün NEDEN boş olduğu ayrıca `reason`
 * alanında yazılır, yani bu etiket tek başına kalmaz.
 */
const NO_DATA_LABEL = "Bilgiler güncelleniyor.";

function sectionIsReady(section) {
  return Boolean(section) && section.status === "ready";
}

/**
 * Bir bölümün okunabilir gövdesini çıkarır.
 *
 * Rapor bölümleri tek tip değil: kimi `paragraph`, kimi `entries`, kimi
 * `notes` taşıyor. Omurga bunları BİÇİMLENDİRMEZ, yalnızca hangi alanın
 * dolu olduğunu bildirir; işaretlemeyi çizen taraf karar verir.
 */
/**
 * Metin taşıyan alanlar. Liste, rapor bölümlerinin GERÇEK şekillerinden
 * çıkarıldı — varsayılan bir alan adı listesi, dolu bir bölümü boş sanıp
 * sessizce yedeğe düşürüyordu (`statistics` bölümü `readings`/`highlights`
 * taşıyor, `entries` değil).
 */
const TEXT_FIELDS = ["paragraph", "lead"];
const LIST_FIELDS = [
  "entries", "notes", "items", "players", "moments",
  "readings", "highlights", "conversion"
];

function bodyOf(section) {
  if (!sectionIsReady(section)) return null;

  const body = {};
  for (const field of TEXT_FIELDS) {
    body[field] = typeof section[field] === "string" ? section[field] : "";
  }
  for (const field of LIST_FIELDS) {
    body[field] = Array.isArray(section[field]) ? section[field] : [];
  }
  return body;
}

/** Gövdede gerçekten gösterilecek bir şey var mı? */
function hasContent(body) {
  if (!body) return false;
  if (TEXT_FIELDS.some((field) => body[field] && body[field].trim())) return true;
  return LIST_FIELDS.some((field) => body[field] && body[field].length);
}

/**
 * Beş bölümlük omurgayı üretir.
 *
 * @param {Object} report `buildMatchReport` çıktısı.
 * @param {Object} [options]
 * @param {Object} [options.quoteStore] `data/manager-quotes.json` içeriği.
 * @returns {{sections: Array, readyCount: number, total: number, complete: boolean}}
 */
function buildCoreReport(report, options = {}) {
  const source = (report && report.sections) || {};
  const sections = [];

  for (const spec of CORE_SECTIONS) {
    if (spec.key === "manager-comment") {
      const verdict = quotesForMatch(report && report.matchId, options.quoteStore || { quotes: [] });
      sections.push({
        key: spec.key,
        title: spec.title,
        question: spec.question,
        status: verdict.status,
        quotes: verdict.quotes,
        // Boşken NEDEN boş olduğu yazılır; "Veri yok" tek başına sessizlik.
        reason: verdict.status === "ready" ? "" : verdict.reason,
        noDataLabel: NO_DATA_LABEL
      });
      continue;
    }

    // İlk DOLU kaynak kullanılır. Sıra bilinçli: daha ölçülebilir olan önce.
    let picked = null;
    let pickedKey = "";
    for (const key of spec.from) {
      const candidate = source[key];
      const body = bodyOf(candidate);
      if (hasContent(body)) {
        picked = { section: candidate, body };
        pickedKey = key;
        break;
      }
    }

    if (!picked) {
      // Gerekçe kaynak bölümün kendi açıklamasından alınır — sağlayıcının
      // tam olarak neyi vermediğini söyler.
      const reasons = spec.from
        .map((key) => source[key] && source[key].reason)
        .filter(Boolean);

      sections.push({
        key: spec.key,
        title: spec.title,
        question: spec.question,
        status: "unavailable",
        reason: reasons[0] || "Bu bölüm için doğrulanmış veri sağlayıcıdan gelmedi.",
        noDataLabel: NO_DATA_LABEL
      });
      continue;
    }

    sections.push({
      key: spec.key,
      title: spec.title,
      question: spec.question,
      status: "ready",
      sourceKey: pickedKey,
      body: picked.body,
      noDataLabel: NO_DATA_LABEL
    });
  }

  const readyCount = sections.filter((section) => section.status === "ready").length;

  return {
    sections,
    readyCount,
    total: sections.length,
    // "Tam" yalnızca BEŞİ DE doluysa. Dört bölümlü bir raporu tam saymak,
    // eksik olanı görünmez kılardı.
    complete: readyCount === sections.length
  };
}

module.exports = {
  CORE_SECTIONS,
  NO_DATA_LABEL,
  buildCoreReport
};
