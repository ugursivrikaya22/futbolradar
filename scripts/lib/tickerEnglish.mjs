/**
 * TRANSFER RADARI — İNGİLİZCE ÖĞE METNİ.
 *
 * Türkçe bant cümlesi (`data/ticker.json` `text`) İngilizce ana sayfada
 * olduğu gibi basılmaz. Çeviri bu dosyada yapılır; ücretli bir çeviri
 * servisi veya model çağrısı yoktur.
 *
 *   1. Editör `en.text` yazdıysa o cümle basılır. Kaynağın söylediğinden
 *      fazlası yazılmaz; oyuncu ve kulüp adları Türkçe cümledeki gibi kalır.
 *   2. `en.text` yoksa cümle kalıp sözlüğünden geçer. Yeni bir söylenti
 *      veya pencere notu da aynı kalıba uyduğu sürece İngilizce basılır.
 *   3. Çıktıda Türkçe işlev sözcüğü kalırsa öğe İngilizce banda girmez.
 *      Yarım cümle yayımlanmaz.
 */
import { findTurkish } from "./turkish-detector.mjs";

const MONTHS = Object.freeze([
  ["Ocak", "January"],
  ["Şubat", "February"],
  ["Mart", "March"],
  ["Nisan", "April"],
  ["Mayıs", "May"],
  ["Haziran", "June"],
  ["Temmuz", "July"],
  ["Ağustos", "August"],
  ["Eylül", "September"],
  ["Ekim", "October"],
  ["Kasım", "November"],
  ["Aralık", "December"]
]);

/**
 * Tam kalıplar, uzundan kısaya uygulanır. Kısa işlev sözcükleri yalnızca
 * harf sınırında değişir; İngilizce bir kelimenin içine girmez.
 * @type {Array<[RegExp, string]>}
 */
const PHRASES = [
  [/([A-Za-zÀ-ÿÇĞİÖŞÜçğıöşü0-9 .&]+?)'(?:nün|nın|nun|ın|in|un|ün) ([^']+?)'(?:a|e|ya|ye) dayandırdığı iddiaya göre/giu,
    "According to a $1 report citing $2,"],
  [/([A-Za-zÀ-ÿÇĞİÖŞÜçğıöşü0-9 .&]+?)'(?:nün|nın|nun|ın|in|un|ün) aktardığı iddiaya göre/giu,
    "According to a claim carried by $1,"],
  [/([A-Za-zÀ-ÿÇĞİÖŞÜçğıöşü0-9 .&]+?)'(?:nün|nın|nun|ın|in|un|ün) iddiasına göre/giu,
    "$1 claims"],
  [/transfer tescil yasağı getirdi/giu, "imposed a transfer registration ban"],
  [/transfer yasağı listesinde/giu, "on the transfer ban list"],
  [/yaz transfer dönemi/giu, "the summer transfer window"],
  [/ara transfer dönemi/giu, "the mid-season transfer window"],
  [/teknik direktörlüğüne/giu, "as head coach of"],
  [/A Millî Takım/gu, "the senior national team"],
  [/sözleşme imzalanacak/giu, "a contract will be signed"],
  [/teklif yapmayı planlıyor/giu, "plans to make a bid"],
  [/teklifleri değerlendirecek/giu, "will consider offers"],
  [/teklifleri geri çevirdi/giu, "turned down the offers"],
  [/resmi teklif hazırlıyor/giu, "is preparing an official bid"],
  [/henüz ikna değil/giu, "is not yet convinced"],
  [/yakın temasta olduğu belirtilen/giu, "who is said to be in close contact with"],
  [/ve üzeri/giu, "or more"],
  [/devre arasında yollarını ayırmaya hazırlanıyor/giu, "are preparing to part ways in the winter break with"],
  [/devre arasında/giu, "in the winter break"],
  [/sözleşmesinden çıkmaya çalışacak/giu, "will try to end the contract of"],
  [/sözleşmesi sezon sonunda bitecek/giu, "whose contract ends at the end of the season"],
  [/menajeriyle görüşmelere başlayacak/giu, "will open talks with the agent of"],
  [/yeni sözleşme önermek için düğmeye bastı/giu, "have decided to offer a new contract to"],
  [/ile ilgileniyor/giu, "are interested in"],
  [/ilgilendiği/giu, "who are interested in"],
  [/de talip/giu, "are also interested"],
  [/talip oldu/giu, "have made an approach for"],
  [/(?<![\p{L}])talip(?![\p{L}])/giu, "are interested in"],
  [/ocakta bırakmayacak/giu, "will not let leave in January"],
  [/yazın harekete geçecek/giu, "will move in the summer"],
  [/bonservisini almak istiyor/giu, "want to buy the registration of"],
  [/bonservisi ödemeye hazır olduğu yazıldı/giu, "it was written that they are ready to pay the fee"],
  [/anlaşma yok/giu, "there is no agreement"],
  [/yeniden gündemine aldı/giu, "have put back on their agenda"],
  [/gündemine aldı/giu, "have added to their agenda"],
  [/daha fazla süre bulması için/giu, "so he can get more playing time"],
  [/kiralık göndermeyi planlıyor/giu, "plan to send on loan"],
  [/planında yer almayan/giu, "who is not in the plans of"],
  [/temas bekleniyor/giu, "contact is expected"],
  [/skor katkısı veremeyen/giu, "who has not contributed a goal or assist"],
  [/devam etmeye sıcak bakmıyor/giu, "are not keen to continue with"],
  [/görüşme yapılacak/giu, "talks will be held with"],
  [/İspanyol stoperi/giu, "Spanish centre-back"],
  [/pazarlık ediyor/giu, "are negotiating with"],
  [/indirim talep etti/giu, "asked for a reduction"],
  [/talep ediyor/giu, "are asking"],
  [/bordo-mavili yönetim/giu, "the Trabzonspor board"],
  [/(?<![\p{L}])milyon euroluk(?![\p{L}])/giu, "million euro"],
  [/(?<![\p{L}])milyon euro(?![\p{L}])/giu, "million euro"],
  [/(?<![\p{L}])milyon Euro(?![\p{L}])/gu, "million euro"],
  [/(?<![\p{L}])Euro'luk(?![\p{L}])/gu, "euro"],
  [/(?<![\p{L}])en az(?![\p{L}])/giu, "at least"],
  [/(?<![\p{L}])bu sezon(?![\p{L}])/giu, "this season"],
  [/(?<![\p{L}])yaşındaki(?![\p{L}])/giu, "-year-old"],
  [/(?<![\p{L}])kiralamak(?![\p{L}])/giu, "to loan"],
  [/(?<![\p{L}])satacak(?![\p{L}])/giu, "will sell"],
  [/(?<![\p{L}])istiyor(?![\p{L}])/giu, "want"],
  [/(?<![\p{L}])kapandı(?![\p{L}])/giu, "closed"],
  [/(?<![\p{L}])geçerli(?![\p{L}])/giu, "effective"],
  [/(?<![\p{L}])getirdi(?![\p{L}])/giu, "appointed"],
  [/(?<![\p{L}])dönem(?![\p{L}])/giu, "window"],
  [/(?<![\p{L}])yıllık(?![\p{L}])/giu, "-year"],
  [/(?<![\p{L}])beklenti(?![\p{L}])/giu, "the expectation is"],
  [/(?<![\p{L}])ocakta(?![\p{L}])/giu, "in January"],
  [/(?<![\p{L}])maçta(?![\p{L}])/giu, "matches"],
  [/(?<![\p{L}])Resmî:/gu, "Official:"],
  [/(?<![\p{L}])Süper Lig'de(?![\p{L}])/gu, "In the Süper Lig"],
  [/(?<![\p{L}])Premier Lig(?![\p{L}])/gu, "the Premier League"],
  [/(?<![\p{L}'])yeni bir stoper(?![\p{L}])/giu, "a new centre-back"],
  [/(?<![\p{L}'])yeni(?![\p{L}])/giu, "new"],
  [/(?<![\p{L}'])bir(?![\p{L}])/giu, "a"],
  [/(?<![\p{L}'])stoper(?![\p{L}])/giu, "centre-back"],
  [/(?<![\p{L}'])için(?![\p{L}])/giu, "for"],
  [/(?<![\p{L}'])ile(?![\p{L}])/giu, "with"],
  [/(?<![\p{L}'])ve(?![\p{L}])/giu, "and"],
  [/(?<![\p{L}'])de(?![\p{L}])/giu, "also"],
  [/(?<![\p{L}'])da(?![\p{L}])/giu, "also"]
];

const SUFFIXES = /(?<=[\p{L}\d])'(?:dan|den|tan|ten|da|de|nın|nin|nun|nün|ın|in|un|ün|yı|yi|yu|yü|ya|ye|a|e|ı|i|u|ü|la|le)/giu;

function translateDates(text) {
  let next = text;
  for (const [tr, en] of MONTHS) {
    const pattern = new RegExp(`(\\d{1,2})\\s+${tr}(?:\\s+(\\d{4}))?(?:'(?:da|de|dan|den|ta|te))?`, "gu");
    next = next.replace(pattern, (_match, day, year) => (year ? `${day} ${en} ${year}` : `${day} ${en}`));
  }
  return next;
}

function tidy(text) {
  return text
    .replace(SUFFIXES, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s+–\s+/g, " – ")
    .replace(/ -year-old/g, "-year-old")
    .replace(/(\d+) -year/g, "$1-year")
    .trim();
}

/** Kalıp çıktısındaki bilinen söz dizimini İngilizce cümle sırasına çeker. */
function polish(text) {
  return text
    .replace(/In the Süper Lig the summer transfer window (\d+ \w+ \d+) closed/g, "In the Süper Lig, the summer transfer window closed on $1")
    .replace(/the summer transfer window (\d+ \w+ \d+) closed/g, "the summer transfer window closed on $1")
    .replace(/FIFA, (.+?) (\d+ \w+ \d+) effective (\d+) window imposed a transfer registration ban/g, "FIFA imposed a $3-window transfer registration ban on $1, effective from $2")
    .replace(/Official: TFF, the senior national team as head coach of (.+?) appointed; (\d+)-year a contract will be signed/g, "Official: the TFF appointed $1 as head coach of the senior national team; a $2-year contract will be signed")
    .replace(/^1\. Lig (.+?) also FIFA on the transfer ban list$/g, "$1, from the 1. Lig, are also on FIFA's transfer ban list");
}

/**
 * Türkçe bant cümlesinin kalıp çevirisi. Oyuncu ve kulüp adları kalır.
 * @param {string} text
 * @returns {string}
 */
export function translateTickerText(text) {
  let next = translateDates(String(text || "").trim());
  for (const [pattern, replacement] of PHRASES) next = next.replace(pattern, replacement);
  return polish(tidy(next));
}

/**
 * İngilizce bantta basılacak metin. `en.text` varsa o kullanılır.
 * Çeviri Türkçe işlev sözcüğü bırakırsa boş döner.
 * @param {object} item
 * @returns {string}
 */
export function englishTickerText(item) {
  const curated = item && item.en && String(item.en.text || "").trim();
  const candidate = curated || translateTickerText(item && item.text);
  if (!candidate || findTurkish(candidate, { limit: 1 }).length) return "";
  return candidate;
}

/** İngilizce bant öğesi. Metin çevrilemezse null. */
export function englishTickerItem(item) {
  const text = englishTickerText(item);
  if (!text) return null;
  return { ...item, text };
}
