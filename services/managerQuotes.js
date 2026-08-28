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

/**
 * TANINAN ROLLER.
 *
 * Rol dekoratif bir etiket değil: aynı cümle teknik direktörden gelince
 * kadro/plan beyanı, futbolcudan gelince kişisel değerlendirme olur. Okuyucu
 * bu ayrımı görmeden alıntıyı doğru tartamaz.
 *
 * Liste bilerek dar. Rol alanı BOŞSA "teknik direktör" varsayılır — bu dosya
 * yalnızca teknik direktör alıntısı taşıdığı dönemde girilmiş kayıtlar
 * bozulmasın diye korunan geriye dönük davranış. Ama rol DOLU ve tanınmıyorsa
 * ("başkan", "yetkili", "menajer") artık sessizce geçirilmiyor: tanınmayan
 * rol bir tahmindir ve kayıt reddedilir.
 */
const ROLE_LABELS = {
  manager: "Teknik direktör",
  player: "Futbolcu"
};

const ROLE_ALIASES = {
  manager: "manager",
  coach: "manager",
  "head-coach": "manager",
  "teknik direktor": "manager",
  "teknik direktör": "manager",
  player: "player",
  futbolcu: "player",
  oyuncu: "player"
};

/** Rol alanı boşsa varsayılan; doluysa tanınmak zorunda. */
const DEFAULT_ROLE = "manager";

function normalizeRoleKey(value) {
  return String(value === null || value === undefined ? "" : value)
    .trim()
    .toLocaleLowerCase("tr")
    .replace(/\s+/g, " ");
}

/**
 * @returns {{role: string}|{error: string}} Boş rol varsayılana düşer;
 *   tanınmayan rol HATA döndürür, yuvarlanmaz.
 */
function resolveRole(value) {
  const key = normalizeRoleKey(value);
  if (!key) return { role: DEFAULT_ROLE };
  const resolved = ROLE_ALIASES[key];
  if (!resolved) return { error: `tanınmayan rol: ${String(value).trim()}` };
  return { role: resolved };
}

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

  // Rol doluysa tanınmalı: uydurma bir sıfat, uydurma bir cümle kadar
  // yanıltıcıdır ("başkan şöyle dedi" diye basılan bir futbolcu alıntısı).
  const roleVerdict = resolveRole(entry.role);
  if (roleVerdict.error) errors.push(roleVerdict.error);

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

    const { role } = resolveRole(entry.role);

    quotes.push({
      speaker: text(entry.speaker),
      // `role` makine anahtarı (manager/player), `roleLabel` okuyucuya
      // gösterilen ad. Arayüzün eşleme tablosu tutması gerekmesin diye
      // ikisi de taşınıyor.
      role,
      roleLabel: ROLE_LABELS[role],
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

/**
 * EN YENİ AÇIKLAMALAR — birden çok maçtan.
 *
 * Maç sayfası tek maçın alıntısını sorar; ana sayfa "son maçlarda kim ne
 * dedi" diye sorar. İkisi de AYNI doğrulamadan geçer, yalnızca kapsam
 * değişir.
 *
 * `matchIds` verilirse yalnızca o maçlar taranır. Bu isteğe bağlı ama
 * önemli: çağıran hangi maçların gerçekten bittiğini biliyor, bu modül
 * bilmiyor. Süzgeç verilmezse depodaki her geçerli alıntı aday olur.
 *
 * @param {Object|Array} store `data/manager-quotes.json` içeriği.
 * @param {{limit?: number, matchIds?: Iterable<string>}} [options]
 * @returns {{status: "ready"|"unavailable", quotes: Array, reason?: string}}
 */
function latestQuotes(store, options = {}) {
  const raw = Array.isArray(store)
    ? store
    : (store && Array.isArray(store.quotes) ? store.quotes : []);

  const allowed = options.matchIds ? new Set(options.matchIds) : null;
  const limit = Number.isFinite(options.limit) ? Math.max(0, options.limit) : 6;

  const quotes = [];
  for (const entry of raw) {
    const matchId = text(entry && entry.matchId);
    if (allowed && !allowed.has(matchId)) continue;
    if (!validateQuote(entry).valid) continue;

    const { role } = resolveRole(entry.role);
    quotes.push({
      matchId,
      speaker: text(entry.speaker),
      role,
      roleLabel: ROLE_LABELS[role],
      team: text(entry.team),
      quote: text(entry.quote),
      at: text(entry.at),
      source: { name: text(entry.source.name), url: text(entry.source.url) }
    });
  }

  // En yeni önce: bant bir güncellik iddiası taşıyor.
  quotes.sort((left, right) => Date.parse(right.at) - Date.parse(left.at));

  if (!quotes.length) {
    return {
      status: "unavailable",
      quotes: [],
      reason: "Doğrulanmış bir maç sonu açıklaması kaydedilmedi."
    };
  }

  return { status: "ready", quotes: quotes.slice(0, limit) };
}

module.exports = {
  QUOTE_HAS_NO_EXPIRY,
  REQUIRED_FIELDS,
  ROLE_LABELS,
  DEFAULT_ROLE,
  resolveRole,
  quotesForMatch,
  latestQuotes,
  validateQuote
};
