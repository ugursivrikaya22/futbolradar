/**
 * SAĞLAYICI METNİNDE BOZUK KODLAMA ONARIMI (mojibake).
 *
 * Sorun: sağlayıcıdan gelen bazı oyuncu adları UTF-8 baytları Latin-1 gibi
 * çözülmüş hâlde geliyor. "Başkan" -> "BaÅkan", "Mimović" -> "MimoviÄ",
 * "İslamoğlu" -> "IÌslamoÄlu". Kayıt bir kez bu hâlde yazıldığında zarar
 * ekranla sınırlı kalmıyor: kimlik ve URL de addan türetildiği için
 * /oyuncular/b-baa-kan-trabzonspor.html gibi kalıcı ve yanlış bir adres
 * üretiliyor, site haritasına giriyor ve arama motoruna bu hâliyle
 * bildiriliyor.
 *
 * Onarım mekaniktir, tahmin değildir: bozulma tek yönlü ve tersine
 * çevrilebilir bir bayt dönüşümüdür. Metin Latin-1 olarak yeniden
 * baytlanıp UTF-8 olarak çözüldüğünde özgün ad birebir geri gelir.
 *
 * GÜVENLİK KURALI: onarım yalnızca SONUÇ GEÇERLİYSE uygulanır. Çözüm
 * değiştirme karakteri (U+FFFD) üretiyorsa ya da metin zaten temizse
 * girdiye hiç dokunulmaz. Yani bu fonksiyon hiçbir zaman sağlam bir adı
 * bozamaz; en kötü ihtimalle hiçbir şey yapmaz.
 */

// Latin-1 olarak yanlış çözülmüş UTF-8'in imzası: metin içinde tek başına
// duran Â Ã Ä Å karakterleri. Gerçek bir Türkçe/Boşnakça/Fransızca adda bu
// karakterler bu konumda bulunmaz.
const MOJIBAKE_MARKERS = /[Â-Å]/;
const REPLACEMENT_CHAR = "�";

/** Metinde bozuk kodlama imzası var mı? */
function hasMojibake(value) {
  return MOJIBAKE_MARKERS.test(String(value || ""));
}

/**
 * Bozuk kodlanmış metni onarır. Onarılamıyorsa girdiyi aynen döndürür.
 * @param {string} value
 * @returns {string}
 */
function repairMojibake(value) {
  const text = String(value ?? "");
  if (!text || !hasMojibake(text)) return text;

  let decoded;
  try {
    decoded = Buffer.from(text, "latin1").toString("utf8");
  } catch {
    return text;
  }

  // Çözüm bozuksa (değiştirme karakteri) ya da imza hâlâ duruyorsa onarım
  // başarısızdır; yanlış bir tahmini yazmaktansa girdiyi olduğu gibi bırak.
  if (!decoded || decoded.includes(REPLACEMENT_CHAR) || hasMojibake(decoded)) {
    return text;
  }

  // Unicode birleşimlerini tek koda topla: "I" + birleşen üstteki nokta
  // (U+0307) tek başına doğru görünür ama slug üretiminde ayrı harf gibi
  // davranır ve "u-ii-slamoglu" üretir. NFC bunu "İ"ye toplar.
  return decoded.normalize("NFC");
}

/**
 * Bir kaydın metin alanlarını onarır. Yalnızca verilen alanlara dokunur;
 * sayısal alanlar, kimlikler ve zaman damgaları olduğu gibi kalır.
 */
function repairRecordText(record, fields) {
  if (!record || typeof record !== "object") return record;

  let changed = false;
  const patch = {};
  for (const field of fields) {
    const value = record[field];
    if (typeof value !== "string") continue;
    const repaired = repairMojibake(value);
    if (repaired !== value) {
      patch[field] = repaired;
      changed = true;
    }
  }

  return changed ? { ...record, ...patch } : record;
}

module.exports = { hasMojibake, repairMojibake, repairRecordText };
