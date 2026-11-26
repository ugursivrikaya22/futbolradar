/**
 * OYUNCU ETİKETLERİ — MEVKİ İÇİN TEK TABLO.
 *
 * Sağlayıcı (API-Football) mevkiyi İngilizce verir: "Attacker", "Midfielder",
 * "Defender", "Goalkeeper". Kayıtların bir kısmı ise elle Türkçe yazılmış
 * ("Stoper", "Sol kanat") ve bir kısmında ASCII yazım var ("Sag kanat").
 * Türkçe sayfada görünen her mevki — hero, kimlik kartı, transfer kartı,
 * başlık, meta açıklaması, schema.org `jobTitle` — bu tablodan geçer.
 *
 * Bir mevkinin Türkçe karşılığını başka bir yerde elle yazmayın: iki tablo
 * zamanla ayrışır ve aynı oyuncu bir sayfada "Defans", ötekinde "Defender"
 * olur. Tanınmayan değer OLDUĞU GİBİ döner (uydurma çeviri yok).
 */

/** Anahtar: küçük harf, Türkçe karakterden bağımsız. */
const POSITION_TR = Object.freeze({
  // Sağlayıcının dört ana etiketi.
  goalkeeper: "Kaleci",
  defender: "Defans",
  midfielder: "Orta saha",
  attacker: "Forvet",
  forward: "Forvet",
  striker: "Forvet",
  // Ayrıntılı İngilizce etiketler.
  "centre-forward": "Santrfor",
  "center-forward": "Santrfor",
  "second striker": "İkinci forvet",
  "left winger": "Sol kanat",
  "right winger": "Sağ kanat",
  winger: "Kanat",
  "attacking midfielder": "Ofansif orta saha",
  "attacking midfield": "Ofansif orta saha",
  "central midfielder": "Merkez orta saha",
  "central midfield": "Merkez orta saha",
  "defensive midfielder": "Defansif orta saha",
  "defensive midfield": "Defansif orta saha",
  "centre-back": "Stoper",
  "center-back": "Stoper",
  "right-back": "Sağ bek",
  "left-back": "Sol bek",
  "full-back": "Bek",
  // Türkçe kayıtların ASCII yazımları.
  "sag kanat": "Sağ kanat",
  "sag bek": "Sağ bek"
});

function key(value) {
  return String(value ?? "").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

/**
 * Mevkiyi Türkçe sunum etiketine çevirir. "Santrfor / sol kanat" gibi
 * bileşik değerlerde her parça ayrı çevrilir.
 */
function positionLabelTr(value) {
  if (value === null || value === undefined || String(value).trim() === "") return value;
  const text = String(value).trim();
  const direct = POSITION_TR[key(text)];
  if (direct) return direct;
  if (text.includes("/")) {
    return text.split("/").map((part) => positionLabelTr(part)).join(" / ");
  }
  return text;
}

/** Sağlayıcının İngilizce ana etiketi mi (testler ve denetim için). */
function isEnglishPosition(value) {
  const mapped = POSITION_TR[key(value)];
  return Boolean(mapped) && mapped !== String(value).trim();
}

module.exports = { POSITION_TR, positionLabelTr, isEnglishPosition };
