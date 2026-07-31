/**
 * TEKNİK DİREKTÖR YORUMLARI — küratörlü, kaynaklı, ASLA ÜRETİLMEYEN.
 *
 * NEDEN AYRI VE NEDEN BU KADAR DAR.
 *
 * Bu depodaki maç sonu raporunun her bölümü ÖLÇÜMDEN türetilir: goller olay
 * akışından, momentum dakikalardan, kırılma anları skor değişimlerinden.
 * Ölçümden türetilen bir cümle yanlışsa hesap yanlıştır ve düzeltilir.
 *
 * Alıntı böyle değildir. Bir teknik direktörün ağzına cümle koymak, hesap
 * hatası değil UYDURMADIR. Model "muhtemelen böyle demiştir" diye bir cümle
 * üretebilir ve cümle akıcı, inandırıcı, tamamen sahte olur. Bu yüzden bu
 * modül tek bir şey yapar: DAHA ÖNCE KAYDEDİLMİŞ, KAYNAĞI GÖSTERİLEN bir
 * alıntıyı bulur ve döndürür.
 *
 * Bulamazsa "veri yok" der. Boş bırakmak, uydurmanın tek doğru alternatifi.
 *
 * ÖZETLENMEZ, KISALTILMAZ. Alıntı metni kayıtta ne ise odur. Bir cümleyi
 * kısaltmak anlamını değiştirebilir ("kötü oynamadık ama" → "kötü oynamadık")
 * ve kısaltılmış alıntı hâlâ tırnak içinde görünür.
 */

const REQUIRED_FIELDS = ["matchId", "speaker", "team", "quote"];

/** Bir alıntı bu kadar süre sonra da geçerlidir: söylendiği an sabittir. */
const QUOTE_HAS_NO_EXPIRY = true;

function text(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

/**
 * Tek bir alıntı kaydını doğrular.
 *
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateQuote(entry) {
  const errors = [];

  if (!entry || typeof entry !== "object") {
    return { valid: false, errors: ["kayıt nesne değil"] };
  }

  for (const field of REQUIRED_FIELDS) {
    if (!text(entry[field])) errors.push(`${field} yok`);
  }

  const source = entry.source || {};
  if (!text(source.name)) errors.push("source.name yok");
  const url = text(source.url);
  if (!url) errors.push("source.url yok");
  else if (!/^https?:\/\//i.test(url)) errors.push(`source.url http(s) olmalı: ${url}`);

  // Zaman damgası zorunlu: "maçtan sonra söyledi" iddiası doğrulanabilir
  // olmalı. Maç öncesi verilmiş bir demeç maç sonu raporuna giremez.
  const at = text(entry.at);
  if (!at) errors.push("at (zaman damgası) yok");
  else if (Number.isNaN(Date.parse(at))) errors.push(`geçersiz zaman damgası: ${at}`);

  return { valid: errors.length === 0, errors };
}

/**
 * Bir maçın teknik direktör yorumlarını döndürür.
 *
 * @param {string} matchId Maç kimliği.
 * @param {Object|Array} store `data/manager-quotes.json` içeriği.
 * @returns {{status: "ready"|"unavailable", quotes: Array, reason?: string}}
 *   Kayıt yoksa `unavailable` ve GEREKÇE. Uydurma alıntı ASLA üretilmez.
 */
function quotesForMatch(matchId, store) {
  const id = text(matchId);
  const raw = Array.isArray(store)
    ? store
    : (store && Array.isArray(store.quotes) ? store.quotes : []);

  if (!id) {
    return { status: "unavailable", quotes: [], reason: "Maç kimliği yok." };
  }

  const rejected = [];
  const quotes = [];

  for (const entry of raw) {
    if (text(entry && entry.matchId) !== id) continue;

    const verdict = validateQuote(entry);
    if (!verdict.valid) {
      rejected.push({ speaker: text(entry && entry.speaker) || "(isimsiz)", errors: verdict.errors });
      continue;
    }

    quotes.push({
      speaker: text(entry.speaker),
      role: text(entry.role) || "Teknik direktör",
      team: text(entry.team),
      // Metin OLDUĞU GİBİ taşınır; kısaltma anlam değiştirebilir.
      quote: text(entry.quote),
      at: text(entry.at),
      source: { name: text(entry.source.name), url: text(entry.source.url) }
    });
  }

  if (!quotes.length) {
    return {
      status: "unavailable",
      quotes: [],
      rejected,
      // Gerekçe okuyucuya gösterilecek metnin ta kendisi: bölüm boş kalmaz,
      // NEDEN boş olduğunu söyler.
      reason: rejected.length
        ? "Bu maç için kayıtlı teknik direktör açıklaması doğrulanamadı."
        : "Bu maç için doğrulanmış teknik direktör açıklaması kaydedilmedi."
    };
  }

  return { status: "ready", quotes, rejected };
}

module.exports = {
  QUOTE_HAS_NO_EXPIRY,
  REQUIRED_FIELDS,
  quotesForMatch,
  validateQuote
};
