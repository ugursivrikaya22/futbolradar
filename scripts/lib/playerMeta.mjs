/**
 * OYUNCU SAYFASI META AÇIKLAMASI — 150–160 karakter, sayfaya özgü.
 *
 * İçerik: oyuncu adı + güncel kulüp + mevki + öne çıkan istatistik. Yalnızca
 * modelde DOĞRULANMIŞ olarak duran alanlar yazılır; olmayan alan atlanır,
 * yer tutucu ya da tahmin yazılmaz (bkz. test-player-meta-placeholders).
 *
 * Uzunluk kuralı iki ölçümle korunur:
 *   • ham metin 150–160 karakter (arama sonucu kırpması 160'ta),
 *   • HTML-kaçışlı hâli de ≤ 160: scripts/normalize-meta.mjs kaçışlı
 *     öznitelik değerini sayıp 160 üstünü kırpıyor; `'` → `&#39;` (5 karakter)
 *     yüzünden kaçışlı ölçü aşılırsa metin ortadan kesilirdi. Bu yüzden
 *     şablonda kesme işareti yok ("FutbolRadar'da" yerine "FutbolRadar profilinde").
 *
 * Öncelik sırası ("öne çıkan istatistik" önde): kimlik cümlesi (zorunlu) →
 * sezon istatistiği → kariyer yolu → sayfada gerçekten bulunan bölümler.
 * Aday cümlelerin en yüksek öncelikli alt kümesi seçilir; toplam pencereye
 * düşmüyorsa sonraki en iyi alt küme denenir. Aynı ad iki kayıtta varsa
 * ayırt edici bir ek (doğum yılı, forma no) eklenir.
 */

export const META_MIN = 150;
export const META_MAX = 160;
const TAIL = "Detaylar FutbolRadar profilinde.";

const escaped = (value) => String(value)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const present = (value) => value !== null && value !== undefined && String(value).trim() !== "" &&
  !/^(-|—|–|n\/a|null|undefined|güncelleniyor|yakında|bekleniyor)$/i.test(String(value).trim());

function lowerFirst(value) {
  const text = String(value || "").trim();
  return text ? text.charAt(0).toLocaleLowerCase("tr-TR") + text.slice(1) : text;
}

/** Kimlik cümlesinin, en zengin → en yalın sıradaki sürümleri. */
function identityVariants(model) {
  const identity = model.identity || {};
  const name = identity.name;
  const team = model.verified && present(identity.team) ? String(identity.team).trim() : null;
  const nationality = present(identity.nationality) ? String(identity.nationality).trim() : null;
  const age = present(identity.age) ? String(identity.age).trim() : null;
  const position = present(identity.position) ? lowerFirst(identity.position) : null;

  const build = ({ withTeam, withNationality, withAge }) => {
    const bits = [];
    if (withNationality && nationality) bits.push(`${nationality} uyruklu`);
    if (withAge && age) bits.push(`${age} yaşındaki`);
    bits.push(position || "futbolcu");
    const noun = bits.join(" ");
    return withTeam && team
      ? `${name} kimdir? ${team} forması giyen ${noun}.`
      : `${name} kimdir? ${noun.charAt(0).toLocaleUpperCase("tr-TR")}${noun.slice(1)}.`;
  };

  const variants = [
    build({ withTeam: true, withNationality: true, withAge: true }),
    build({ withTeam: true, withNationality: false, withAge: true }),
    build({ withTeam: true, withNationality: false, withAge: false }),
    build({ withTeam: false, withNationality: true, withAge: true }),
    build({ withTeam: false, withNationality: false, withAge: false }),
    `${name} kimdir?`
  ];
  return [...new Set(variants)];
}

/**
 * Öne çıkan sezon istatistiği: yalnızca doğrulanmış (model.seasonStats) sayılar.
 * Uzun kimlik cümlesiyle sığmazsa daha kısa sürümleri denenir (dakika düşer, sonra maç).
 */
function seasonSentences(model) {
  const stats = model.seasonStats;
  if (!stats || !stats.available) return [];
  const byKey = new Map((stats.core || []).map((row) => [row.key, row.value]));
  const label = model.season || stats.season || "Bu sezon";
  const part = (key, text) => (byKey.has(key) ? text(byKey.get(key)) : null);
  const full = [part("appearances", (v) => `${v} maçta`), part("goals", (v) => `${v} gol`), part("assists", (v) => `${v} asist`), part("minutes", (v) => `${v} dakika`)];
  const noMinutes = [full[0], full[1], full[2]];
  const noMatches = [full[1], full[2]];
  const variants = [full, noMinutes, noMatches, [full[1]], [full[2]], [full[3]]]
    .map((pieces) => pieces.filter(Boolean))
    .filter((pieces) => pieces.length)
    .map((pieces) => `${label} sezonunda ${pieces.join(", ")}.`);
  return [...new Set(variants)];
}

function careerSentence(model, careerClubList) {
  const stints = model.career && model.career.stints;
  if (!model.career || !model.career.available || !Array.isArray(stints) || stints.length < 2) return null;
  const clubs = careerClubList(stints, {
    locale: "tr", currentTeam: model.verified ? model.identity.team : null, excludeCurrent: true
  }).slice(0, 3);
  return clubs.length ? `Kariyer: ${clubs.join(", ")}.` : null;
}

/** Sayfada GERÇEKTEN bulunan bölümlerin özeti — sırayla ve ağırlıklı. */
function sectionSentences(model) {
  const list = [];
  if (model.matchLog && model.matchLog.available) list.push("Son maçları, dakikaları ve kartları.");
  if (model.availability && model.availability.available) list.push("Sakatlık ve ceza durumu.");
  if (model.news && ((model.news.general || []).length || (model.news.transfer || []).length)) list.push("Son haberler ve transfer gelişmeleri.");
  if (model.transfers && model.transfers.available) list.push("Transfer geçmişi.");
  if (model.compare && model.compare.available) list.push("Benzer oyuncularla karşılaştırma.");
  // Her sayfada bulunan kimlik kartının doğru, yer tutucu olmayan kısa tarifleri;
  // farklı uzunlukları sayesinde 150–160 penceresi hemen her kimlik cümlesiyle tutar.
  // Her biri YALNIZCA kartta gerçekten o alan varsa eklenir.
  const identity = model.identity || {};
  const has = (value) => present(value);
  if (has(identity.team) && has(identity.position) && model.verified) list.push("Kulüp ve mevki bilgisi.");
  if (has(identity.age) && has(identity.nationality)) list.push("Yaş ve uyruk bilgisi.");
  if (has(identity.shirtNumber) || has(identity.birthDate)) list.push("Forma numarası ve doğum tarihi.");
  if (has(identity.height) || has(identity.preferredFoot)) list.push("Boy ve ayak bilgisi.");
  list.push("Kimlik kartı ve kulüp bilgileri.");
  list.push("Mevki, yaş ve uyruk bilgileri.");
  list.push("Oyuncu profili.");
  list.push("Kimlik kartı.");
  return list;
}

function lengthsOk(text) {
  return text.length >= META_MIN && text.length <= META_MAX && escaped(text).length <= META_MAX;
}

function fitsMax(text) {
  return text.length <= META_MAX && escaped(text).length <= META_MAX;
}

/**
 * @param {object} model buildPlayer360 çıktısı (turkishPlayer360'tan geçmiş)
 * @param {{careerClubList: Function, distinguisher?: string|null}} deps
 */
export function playerMetaDescription(model, { careerClubList, distinguisher = null }) {
  const rest = [];
  const career = careerSentence(model, careerClubList);
  if (career) rest.push(career);
  rest.push(...sectionSentences(model));
  if (distinguisher) rest.unshift(distinguisher);

  const identities = identityVariants(model);
  const seasons = seasonSentences(model);

  // Aday: her (sezon sürümü | yok) × kimlik sürümü için en iyi alt küme.
  // Seçim sırası: sezon istatistiği var mı → zengin kimlik (kulüp, mevki, yaş,
  // uyruk) → kalan cümlelerin önceliği → zengin sezon sürümü.
  let best = null;
  const options = [...seasons, null];
  options.forEach((seasonText, seasonIndex) => {
    identities.forEach((identity, identityIndex) => {
      if (!fitsMax(`${identity} ${TAIL}`)) return;
      const sentences = seasonText ? [seasonText, ...rest] : rest;
      const found = searchSubset(identity, sentences);
      if (!found) return;
      const hasSeason = seasonText && found.chosen.includes(seasonText) ? 1 : 0;
      const key = [hasSeason, -identityIndex, found.score, -seasonIndex];
      if (!best || compareKeys(key, best.key) > 0) best = { key, text: found.text };
    });
  });
  if (best) return best.text;

  // Pencereye düşen alt küme yok: en yalın kimlik + kuyruk, kelime sınırında doldurulur.
  const base = `${identities.at(-1)} ${TAIL}`;
  const filler = ["Kimlik kartı", "mevki", "yaş", "uyruk", "kulüp", "kariyer", "ve", "profil", "bilgileri."];
  let text = base;
  for (const word of filler) {
    const next = text.replace(` ${TAIL}`, ` ${word} ${TAIL}`);
    if (!fitsMax(next)) break;
    text = next;
    if (text.length >= META_MIN) break;
  }
  return text;
}

function compareKeys(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

/**
 * Öncelik sırasını koruyan en iyi alt küme. Cümleler öncelik sırasıyla dizilir;
 * "içer, sonra çıkar" sırasıyla derinlik öncelikli aranır, pencereye düşen İLK
 * kombinasyon en yüksek öncelikli olandır. Kalan en çok uzunluk ve alt sınır
 * budaması aramayı küçük tutar.
 */
function searchSubset(identity, sentences) {
  const items = sentences.slice(0, 16);
  const fixed = identity.length + 1 + TAIL.length; // kimlik + boşluk + kuyruk
  const cost = items.map((sentence) => sentence.length + 1);
  const suffix = new Array(items.length + 1).fill(0);
  for (let index = items.length - 1; index >= 0; index -= 1) suffix[index] = suffix[index + 1] + cost[index];

  const chosen = [];
  let result = null;
  const visit = (index, total) => {
    if (result) return;
    if (total > META_MAX) return;
    if (total + suffix[index] < META_MIN) return;
    if (index === items.length) {
      const text = [identity, ...chosen, TAIL].join(" ");
      if (lengthsOk(text)) {
        const picked = chosen.slice();
        // Öncelik ağırlığı: baştaki cümle sonrakilerin toplamından ağır (ama
        // DFS zaten en yüksek öncelikliyi ilk bulur; skor adaylar arası kıyas içindir).
        const score = picked.reduce((sum, sentence) => sum + 2 ** (items.length - items.indexOf(sentence)), 0);
        result = { text, chosen: picked, score };
      }
      return;
    }
    chosen.push(items[index]);
    visit(index + 1, total + cost[index]);
    chosen.pop();
    visit(index + 1, total);
  };
  visit(0, fixed);
  return result;
}

/**
 * Sayfalar arası BENZERSİZLİK. Aynı adı taşıyan iki kayıt aynı açıklamayı
 * üretirse ikincisine ayırt edici bir cümle eklenir (doğum yılı, forma no,
 * son çare sıra numarası). `seen`, üretici koşusu boyunca paylaşılan kümedir.
 */
export function uniquePlayerMetaDescription(model, deps, seen) {
  const identity = model.identity || {};
  const year = /^(\d{4})/.exec(String(identity.birthDate || ""));
  const distinguishers = [
    null,
    year ? `Doğum yılı ${year[1]}.` : null,
    present(identity.shirtNumber) ? `Forma numarası ${String(identity.shirtNumber).trim()}.` : null
  ].filter((value, index) => index === 0 || value);

  for (const distinguisher of distinguishers) {
    const text = playerMetaDescription(model, { ...deps, distinguisher });
    if (!seen.has(text)) {
      seen.add(text);
      return text;
    }
  }
  for (let ordinal = 2; ordinal < 50; ordinal += 1) {
    const text = playerMetaDescription(model, { ...deps, distinguisher: `Profil ${ordinal}.` });
    if (!seen.has(text)) {
      seen.add(text);
      return text;
    }
  }
  const text = playerMetaDescription(model, deps);
  seen.add(text);
  return text;
}
