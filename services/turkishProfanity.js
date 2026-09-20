/**
 * KÜFÜR VE HAKARET SÜZGECİ — TÜRKÇE ODAKLI.
 * ----------------------------------------------------------------------------
 * NE YAPAR. Gönderilen metinde saldırgan kelime arar ve BULURSA YORUMU
 * REDDEDER. Maskeleme (`s**tir`) bilerek tercih edilmedi: maskelenmiş bir
 * küfür hâlâ küfürdür, okuyan kişi neyin yazıldığını anlar ve site o
 * cümleyi yayımlamış olur. Reddetmek, yazana ne olduğunu da söyler.
 *
 * ── NEDEN SUNUCUDA ───────────────────────────────────────────────────────
 * İstemcideki süzgeç bir NEZAKET katmanıdır, kapı değildir: uç noktaya
 * doğrudan istek atmak bir satırlık iş. Bu yüzden karar burada veriliyor
 * ve istemci tarafında ikinci bir liste TUTULMUYOR — liste istemciye
 * gitseydi, saldırgan için hazır bir "neyi atlatmam gerek" kılavuzu olurdu.
 *
 * ── SINIRLARI AÇIKÇA ─────────────────────────────────────────────────────
 * Bu süzgeç kelime tabanlıdır ve MÜKEMMEL DEĞİLDİR:
 *   • Liste dışı hakaret geçer. Bu yüzden "bildir" düğmesi ve moderasyon
 *     kuyruğu var — süzgeç tek savunma değil, ilk savunma.
 *   • Yaratıcı yazım (boşluk, nokta, rakam ikamesi) için metin önce
 *     sadeleştiriliyor, ama her varyant yakalanamaz.
 *   • MASUM KELİME YAKALANMAMALI. Bu yüzden eşleşme KELİME SINIRINDA
 *     yapılıyor, alt dize aramasıyla değil: "sikke", "kaleci" gibi masum
 *     kelimeler alt dize aramasıyla yanlışlıkla yakalanırdı.
 *
 * Liste kasıtlı olarak DAR: yalnızca bağlamdan bağımsız saldırgan olan
 * kelimeler. Tartışmalı/çift anlamlı kelimeler listeye alınmadı; onları
 * yakalamak yanlış pozitif üretir ve okuyucuyu haksızca susturur.
 */

"use strict";

/**
 * Rakam ve benzer harf ikameleri. Sadeleştirme sırasında geri çevrilir;
 * "s1kt1r" ile "siktir" aynı kelimeye iner.
 */
const LEET = Object.freeze({
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s"
});

/**
 * Bağlamdan bağımsız saldırgan kelimeler (kök hâlleriyle).
 *
 * Türkçe sondan eklemeli olduğu için eşleşme "kök + ek" desenine bakar:
 * `siktir`, `siktirin`, `siktirip` hepsi yakalanır. Kökün ÖNÜNE gelen
 * harfler eşleşmeyi bozar, yani "kaleci" gibi kelimeler güvende.
 */
const ROOTS = Object.freeze([
  "amcik", "amina", "aminakoyayim", "ananisikeyim", "amk", "aq",
  "bok", "gotveren", "götveren", "ibne", "orospu", "pezevenk",
  "piç", "pic", "sikeyim", "sikik", "sikim", "siktir", "siktir",
  "yarrak", "yarak", "kahpe", "serefsiz", "şerefsiz", "gerizekali",
  "salak", "aptal", "mal herif", "oç", "oc.",
  "fuck", "shit", "bitch", "asshole", "cunt"
]);

/**
 * MASUM KELİMELER — kök eşleşmesini geçersiz kılar.
 *
 * Kısa kökler (üç harfli `bok` gibi) ek alabildiği için masum kelimelerin
 * içine düşebiliyor: "bokser" bunlardan biri. Yanlışlıkla susturulan bir
 * okuyucu, kaçan bir küfürden daha büyük bir hata — bu yüzden çakışan
 * kelimeler AÇIKÇA listeleniyor, desen gevşetilmiyor.
 */
const ALLOW = Object.freeze([
  "bokser", "boksor", "boks", "bokstan",
  "sikke", "sikkeler", "sikkesi",
  "piknik", "pike", "piket"
]);

/**
 * Metni karşılaştırılabilir hâle getirir.
 *
 * Türkçe duyarlı: `toLowerCase` tek başına "İ" harfinde birleşik imli bir
 * harf üretir ve karşılaştırma sessizce başarısız olur. Ayrıca rakam
 * ikameleri geri çevrilir ve tekrar eden harfler ("siiiktir") teke iner.
 */
function fold(value) {
  let text = String(value == null ? "" : value)
    .replace(/İ/g, "i")
    .replace(/I/g, "i")
    .replace(/ı/g, "i")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

  text = text.replace(/[0134579@$]/g, (character) => LEET[character] || character);
  // Harf arasına serpiştirilen ayırıcılar ("s-i-k-t-i-r") temizlenir.
  text = text.replace(/[._\-*+]+/g, "");
  // Üçten fazla tekrar eden harf teke iner.
  text = text.replace(/(.)\1{2,}/g, "$1");
  return text;
}

/** Kökü kelime sınırında arayan desen. Ek ALINABİLİR, önek alınamaz. */
function patternFor(root) {
  const folded = fold(root).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!folded) return null;
  // (^|boşluk/noktalama) kök (ek harfleri) (sınır)
  return new RegExp(`(^|[^a-z0-9])${folded}[a-z]{0,6}([^a-z0-9]|$)`, "i");
}

const PATTERNS = ROOTS.map(patternFor).filter(Boolean);

/**
 * Metin saldırgan kelime taşıyor mu?
 *
 * @returns {{clean: boolean, matched: string|null}}
 *   `matched` YALNIZCA teşhis içindir; okuyucuya gösterilen mesajda
 *   kelimenin kendisi GEÇMEZ — site küfrü tekrar etmiş olmasın.
 */
function inspect(text) {
  let folded = ` ${fold(text)} `;

  // Masum kelimeler eşleşmeden ÖNCE çıkarılır: "bokser" cümlede kalsaydı
  // `bok` kökü onu yakalar ve okuyucu haksızca susturulurdu.
  for (const word of ALLOW) {
    const safe = fold(word).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (safe) folded = folded.replace(new RegExp(safe, "g"), " ");
  }

  for (let index = 0; index < PATTERNS.length; index += 1) {
    if (PATTERNS[index].test(folded)) {
      return { clean: false, matched: ROOTS[index] };
    }
  }
  return { clean: true, matched: null };
}

function isClean(text) {
  return inspect(text).clean;
}

module.exports = {
  ALLOW,
  ROOTS,
  fold,
  inspect,
  isClean
};
