/**
 * BOZUK OYUNCU ADI TESPİTİ.
 *
 * Sağlayıcı (API-Football) kadro uç noktası Türk oyuncuların adını bazen
 * "Soyad Ad Ad" ya da "Ad Soyad Ad" biçiminde döndürür: "Ahmet Sami Bircan"
 * → "Sami Bircan Ahmet". Aynı oyuncunun transfer satırında ise "Bircan Ahmet
 * Sami" gelir. Ad sayfa başlığına, URL'ye ve kimdir cümlesine girdiği için
 * yanlış sıralı ad hem okura hem aramaya yanlış görünür.
 *
 * Kesin doğruyu yalnızca resmî kulüp kadrosu söyler; o yoksa elimizde
 * SEZGİSEL kurallar var. Bu yüzden çıktı bir HÜKÜM değil, İNCELEME
 * ADAYIDIR: aday sayfa düzeltilene (ya da bir editör adı doğrulayıp
 * `data/player-name-cleared.json`a ekleyene) kadar `noindex,follow` basılır.
 * Aday olmak adı değiştirmez — URL ve kimlik bozulmasın diye ad otomatik
 * yeniden yazılmaz, yalnızca ÖNERİ üretilir.
 *
 * ENGELLEYEN kurallar (sayfa noindex olur):
 *   official-order        resmî kadro adıyla aynı sözcükler, farklı sıra (kesin; öneri verir)
 *   given-name-last       3+ sözcük, son sözcük yaygın Türkçe verilen ad, ilk değil
 *                         ("Coskun Tosun Mustafa" → Mustafa Coşkun Tosun)
 *   given-surname-given   "Samet Kalkan Mehmet": verilen ad + soyad + verilen ad
 *   strict-given-last     2+ sözcük, son sözcük neredeyse hiç soyad olmayan bir ad
 *   duplicate-permutation aynı takımda, aynı sözcüklerin başka sıralamasıyla ikinci kayıt
 *
 * BİLGİ kuralları (rapora girer, sayfayı etkilemez):
 *   whitespace            çift boşluk / baş-son boşluk
 *   transfer-permutation  transfer satırında aynı sözcüklerin başka sıralaması (kanıt/öneri)
 *
 * 2 sözcüklü adlarda ("Batuhan Yavuz", "Berke Baran") "son sözcük verilen ad"
 * kuralı KULLANILMAZ: soyad olarak da yaygın, yanlış alarm üretir.
 * Editörce doğrulanmış kayıtlar (`verified`, `manually_verified`) yalnızca
 * resmî kadro kuralına tabidir.
 */

const TR_FOLD = { "ç": "c", "ğ": "g", "ı": "i", "ö": "o", "ş": "s", "ü": "u", "â": "a", "î": "i", "û": "u", "é": "e", "è": "e", "ï": "i" };

function fold(value) {
  return String(value || "")
    .replace(/İ/g, "i")
    .replace(/I/g, "ı")
    .toLowerCase()
    .replace(/[çğıöşüâîûéèï]/g, (ch) => TR_FOLD[ch] || ch)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[-.’']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokensOf(name) {
  const text = fold(name);
  return text ? text.split(" ") : [];
}

/**
 * Yaygın Türkçe ERKEK verilen adlar (katlanmış). Bilerek yalnızca ad olarak
 * çok baskın olanlar: "Can", "Kerem", "Ali" gibi soyad olarak da geçenler son
 * sözcük kuralında yalnızca ilk sözcük verilen ad DEĞİLSE işaretler.
 */
const GIVEN_NAMES = new Set(`
abdullah abdulkadir abdulkerim abdurrahman adem adnan ahmet akin ali berhan alparslan alper altay arda arif atakan
baris berat berk berkay bilal bora bulent burak burhan can cem cemal cengiz cihan deniz
dogukan efe ege emin emir emirhan emre enes eray eren erdem erdinc erhan erkan ersin ertugrul eyup
fatih ferdi furkan gokhan gokay guray halil hakan hamza harun hasan huseyin ibrahim ilhan ilker ilyas ismail
kaan kadir kagan kamil kazim kemal kenan kerem kerim koray kutay kutlay levent mahmut mehmet melih mert mesut
metin muhammed muhammet mustafa murat musa nazim necati nuri oguz oguzhan okan oktay onur orhan orkun osman
ozan ozgur omer ramazan recep rida ridvan sabri sadi salih samet selim semih serdar serkan sinan sukru tahir
talha tarik taylan tayyip tolga tolgay tugay tuncay turgut umut umit utku volkan yagiz yasin yigit
yildiray yunus yusuf zafer ziya
`.split(/\s+/).filter(Boolean));

/** Soyad olarak neredeyse hiç görülmeyen adlar: 2 sözcükte bile son sırada olmaları şüpheli. */
const STRICT_GIVEN_LAST = new Set(["ahmet", "mehmet", "mustafa", "omer", "ibrahim", "ismail", "hasan", "huseyin", "osman", "mahmut"]);
/** Arapça/yabancı ilk sözcükler: "Mohamed Ali" gibi adlarda son sözcük soyaddır. */
const FOREIGN_FIRST_OK = new Set(["mohamed", "mohammed", "muhammad", "ahmed", "abdel", "abdul", "sheikh", "al", "el", "ben", "ould"]);

const VERIFIED = new Set(["verified", "manually_verified"]);

/** Baş harfli ("A. E. Isik") adlarda sıra çıkarımı yapılmaz. */
function hasInitial(raw) {
  return String(raw || "").split(/\s+/).some((token) => /^[A-ZÇĞİÖŞÜ]\.?$/u.test(token));
}

function sameWordsDifferentOrder(left, right) {
  if (left.length !== right.length || left.length < 2) return false;
  if (left.join(" ") === right.join(" ")) return false;
  return [...left].sort().join(" ") === [...right].sort().join(" ");
}

const BLOCKING = new Set(["official-order", "given-name-last", "given-surname-given", "strict-given-last", "duplicate-permutation"]);

/**
 * @param {object} player
 * @param {{ officialNames?: string[], peers?: object[] }} [context]
 * @returns {{ flagged: boolean, blocking: boolean, reasons: string[], notes: string[], suggestion: string|null }}
 */
function reviewPlayerName(player, context = {}) {
  const name = String((player && (player.fullName || player.name)) || "");
  const tokens = tokensOf(name);
  const reasons = [];
  const notes = [];
  let suggestion = null;
  const verified = VERIFIED.has(player && player.dataStatus);

  if (/\s{2,}/.test(name) || /^[\s\u00a0]|[\s\u00a0]$/.test(name)) notes.push("whitespace");

  for (const official of context.officialNames || []) {
    if (sameWordsDifferentOrder(tokens, tokensOf(official))) {
      reasons.push("official-order");
      suggestion = official;
      break;
    }
  }

  const teams = new Set();
  for (const row of Array.isArray(player && player.transferHistory) ? player.transferHistory : []) {
    for (const side of [row.fromTeam, row.toTeam]) if (side) teams.add(String(side));
  }
  for (const label of teams) {
    if (sameWordsDifferentOrder(tokens, tokensOf(label))) {
      notes.push("transfer-permutation");
      if (!suggestion && tokens.length >= 3) suggestion = label;
      break;
    }
  }

  if (!verified && tokens.length >= 2 && !hasInitial(name) && !FOREIGN_FIRST_OK.has(tokens[0])) {
    const first = tokens[0];
    const last = tokens[tokens.length - 1];
    if (tokens.length === 3 && GIVEN_NAMES.has(first) && GIVEN_NAMES.has(last) && !GIVEN_NAMES.has(tokens[1])) {
      reasons.push("given-surname-given");
    } else if (tokens.length >= 3 && GIVEN_NAMES.has(last) && !GIVEN_NAMES.has(first)) {
      reasons.push("given-name-last");
    } else if (STRICT_GIVEN_LAST.has(last) && !GIVEN_NAMES.has(first)) {
      reasons.push("strict-given-last");
    }
  }

  if (!verified) {
    for (const peer of context.peers || []) {
      if (!peer || peer === player || peer.id === player.id) continue;
      if ((peer.currentTeam || peer.team) !== (player.currentTeam || player.team)) continue;
      if (sameWordsDifferentOrder(tokens, tokensOf(peer.fullName || peer.name))) {
        reasons.push("duplicate-permutation");
        break;
      }
    }
  }

  const blocking = reasons.some((reason) => BLOCKING.has(reason));
  return { flagged: blocking || notes.length > 0, blocking, reasons, notes, suggestion };
}

module.exports = { GIVEN_NAMES, fold, tokensOf, reviewPlayerName, sameWordsDifferentOrder };
