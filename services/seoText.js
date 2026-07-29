/**
 * SEO METİN BÜTÇELERİ — tek kaynak.
 *
 * Arama sonucunda başlık yaklaşık 60-65 karakterden, açıklama 155-160
 * karakterden sonra kesiliyor. Kesilen bir başlık yalnızca kırpılmış
 * görünmüyor; sondaki bilgi (lig adı, marka) HİÇ görünmüyor ve okuyucu
 * yarım bir cümle okuyor.
 *
 * Sabit bir kalıp bu sorunu çözmez: "Amed Sportif Faaliyetler" ile "Göztepe"
 * aynı kalıpta çok farklı uzunluklar üretir. Çözüm bir BÜTÇE — sığdığı kadar
 * bilgi, önem sırasına göre.
 *
 * Kural: anahtar kelime her zaman BAŞTA kalır, ek bilgi sığdığı kadar eklenir.
 */

/** Arama sonucunda kesilmeden görünen üst sınır. */
const TITLE_BUDGET = 65;

/** Meta açıklaması üst sınırı. */
const DESCRIPTION_BUDGET = 158;

/**
 * Verilen adaylardan bütçeye sığan İLKİNİ döndürür.
 *
 * Adaylar önem sırasına göre verilir: en zengini başta, en sadesi sonda.
 * Hiçbiri sığmazsa son aday döner — o da uzunsa kırpılmaz, çünkü son aday
 * zaten çekirdek bilgidir ve kırpmak onu anlamsızlaştırır.
 *
 * @param {Array<string|null>} candidates
 * @param {number} [budget]
 */
function fitTitle(candidates, budget = TITLE_BUDGET) {
  const list = (Array.isArray(candidates) ? candidates : [])
    .filter((candidate) => typeof candidate === "string" && candidate.trim());
  if (!list.length) return "";
  return list.find((candidate) => candidate.length <= budget) || list[list.length - 1];
}

/**
 * Açıklama: künye cümlesi + ayrıntı.
 *
 * Ayrıntı tek bir metin YA DA uzundan kısaya sıralı adaylar olabilir. Tek
 * metinle çalışan ilk sürüm, ayrıntı bütçeyi bir iki karakterle aştığında
 * onu tamamen düşürüyordu: 57 karşılaştırma sayfası 59 karakterlik tek
 * cümleye iniyor ve arama sonucunda bomboş görünüyordu. Adaylar arasından
 * SIĞAN EN UZUNU seçilir; hiçbiri sığmazsa künye tek başına kalır.
 *
 * @param {string} lead Zorunlu künye cümlesi
 * @param {string|Array<string>} [detail] Ayrıntı ya da uzundan kısaya adaylar
 * @param {number} [budget]
 */
function fitDescription(lead, detail = "", budget = DESCRIPTION_BUDGET) {
  const head = String(lead || "").trim();
  if (!head) return "";

  const candidates = (Array.isArray(detail) ? detail : [detail])
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  for (const tail of candidates) {
    const full = `${head} ${tail}`;
    if (full.length <= budget) return full;
  }

  if (head.length <= budget) return head;
  return `${head.slice(0, budget - 3).replace(/[\s,;:]+$/, "")}...`;
}

module.exports = { DESCRIPTION_BUDGET, TITLE_BUDGET, fitDescription, fitTitle };
