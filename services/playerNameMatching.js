/**
 * OYUNCU ADI VARYASYONLARI — ELLE KAYIT İLE SAĞLAYICI KAYDINI EŞLEME.
 *
 * Kadro senkronu bir sağlayıcı satırını elle girilmiş kayda yalnızca AD
 * BİREBİR AYNI ise bağlıyordu (squadSyncService.matchCanonicalPlayer).
 * Sağlayıcı adı ise çoğunlukla kısa gelir:
 *
 *   "Eren Elmalı"   ↔ "E. Elmalı"       (baş harf + soyisim)
 *   "Mason Greenwood" ↔ "M. Greenwood"
 *   "Ederson Santana de Moraes" ↔ "Ederson"  (tek ad)
 *   "Hyeon-gyu Oh"  ↔ "Oh Hyeon-gyu"     (ters sıra, tire)
 *   "Uğurcan Çakır" ↔ "Ugurcan Cakir"    (aksan / Türkçe karakter)
 *
 * Eşleşme bulunamayınca senkron elle kayda DOKUNMAYIP yanına yeni bir
 * sağlayıcı kaydı yazıyordu; böylece aynı kişi iki kayıt oldu ve elle
 * kaydın sayfası "istatistikleri henüz doğrulanmış bir kaynakla eşleşmedi"
 * diyordu (sağlayıcı kimliği yalnızca ikizde vardı).
 *
 * Bu modül YALNIZCA ad karşılaştırır. Karar kuralları çağıranda:
 *   • aynı takım şart (ad tek başına yetmez),
 *   • aday TEK olmalı (birden çoksa eşleşme uydurulmaz),
 *   • sağlayıcı kimliği başka bir kayda bağlı olmamalı.
 * Yanlış birleştirme, hiç birleştirmemekten daha kötüdür.
 */

const SPECIAL_LETTERS = Object.freeze({
  "ı": "i", "ß": "ss", "ø": "o", "đ": "d", "ð": "d", "ł": "l", "æ": "ae", "œ": "oe", "þ": "th"
});

/** Aksanı, Türkçe karakterleri ve noktalamayı atar; küçük harf, tek boşluk. */
function foldName(value) {
  return String(value ?? "")
    .replace(/İ/g, "i")
    .toLocaleLowerCase("en-US")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[ıßøđðłæœþ]/g, (ch) => SPECIAL_LETTERS[ch] || ch)
    .replace(/[.'’`´]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function nameTokens(value) {
  return foldName(value).split(" ").filter(Boolean);
}

/**
 * Kulüp adı eklerini ve sponsor önlerini atar: "Gençlerbirliği S.K." ↔
 * "Gençlerbirliği", "Çaykur Rizespor" ↔ "Rizespor", "Corendon Alanyaspor" ↔
 * "Alanyaspor", "İstanbul Başakşehir" ↔ "Başakşehir FK". Yalnızca tam sözcük
 * atılır ("istanbulspor" gibi gerçek bir ad korunur); atınca ad boş kalıyorsa
 * hiçbiri atılmaz.
 */
const TEAM_NOISE = new Set([
  "sk", "fk", "as", "a", "s", "jk", "kulubu", "spor", "futbol",
  "caykur", "corendon", "aytemiz", "medipol", "istanbul", "ikas", "atakas", "yukatel", "rams", "bitexen"
]);
function foldTeam(value) {
  const tokens = foldName(value).split(" ").filter(Boolean);
  const kept = tokens.filter((token) => !TEAM_NOISE.has(token));
  return (kept.length ? kept : tokens).join(" ");
}

function sameTeam(left, right) {
  const a = foldTeam(left);
  const b = foldTeam(right);
  return Boolean(a) && a === b;
}

const STRENGTH = Object.freeze({ exact: 4, "token-set": 3, "initial-surname": 3, "initial-token-set": 3, "token-subset": 2 });

/**
 * Baş harfler, uzun tarafın AD sözcüklerinin başıyla SIRAYLA ve baştan
 * örtüşmeli. Sağlayıcı "A. Yılmaz" yazdığında "Barış Alper Yılmaz"ı orta
 * adıyla (Alper) eşleştirmemek için atlama yapılmaz: ilk baş harf ilk ada
 * aittir.
 */
function initialsFit(initials, givenNames) {
  if (initials.length > givenNames.length) return false;
  return initials.every((initial, index) => givenNames[index][0] === initial);
}

/** Baştaki tek harflik sözcükler (baş harfler) ile geri kalan sözcükler. */
function splitInitials(tokens) {
  let count = 0;
  while (count < tokens.length && tokens[count].length === 1) count += 1;
  return { initials: tokens.slice(0, count), rest: tokens.slice(count) };
}

/**
 * İki ad aynı kişiyi gösteriyor olabilir mi?
 * @returns {{method: string, strength: number} | null}
 */
function compareNames(left, right) {
  const a = nameTokens(left);
  const b = nameTokens(right);
  if (!a.length || !b.length) return null;

  const hit = (method) => ({ method, strength: STRENGTH[method] });
  if (a.join(" ") === b.join(" ")) return hit("exact");

  // Aynı sözcükler, farklı sıra ("Oh Hyeon-gyu" / "Hyeon-gyu Oh").
  if (a.length >= 2 && a.length === b.length && [...a].sort().join(" ") === [...b].sort().join(" ")) return hit("token-set");

  // "E. Elmalı" ↔ "Eren Elmalı", "B. A. Yılmaz" ↔ "Barış Alper Yılmaz",
  // "T. Jabol-Folcarelli" ↔ "Tim Jabol-Folcarelli" (çok sözcüklü soyisim),
  // "N. Dorgeles" ↔ "Dorgeles Nene" (ters sıra).
  for (const [short, long] of [[a, b], [b, a]]) {
    const { initials, rest } = splitInitials(short);
    if (!initials.length || !rest.length || long.length <= rest.length) continue;
    const tail = long.slice(long.length - rest.length);
    if (rest.every((token, index) => token === tail[index])) {
      const given = long.slice(0, long.length - rest.length);
      if (given.every((token) => token.length > 1) && initialsFit(initials, given)) return hit("initial-surname");
    }
    if (rest.every((token) => long.includes(token))) {
      const remaining = long.filter((token) => !rest.includes(token));
      if (remaining.length && remaining.every((token) => token.length > 1) && initialsFit(initials, remaining)) return hit("initial-token-set");
    }
  }

  // Tek ad ya da kısa ad: "Talisca" ↔ "Anderson Talisca", "Ederson" ↔ "Ederson Santana de Moraes".
  // Tek sözcüklü bir ad yalnızca uzunsa (≥4) ve karşı taraf çok sözcüklüyse sayılır:
  // "Ali" gibi kısa bir ad, aynı takımdaki her "Ali X" ile eşleşmesin.
  for (const [short, long] of [[a, b], [b, a]]) {
    if (short.some((token) => token.length < 2)) continue;
    if (short.length >= long.length) continue;
    if (short.length === 1 && (short[0].length < 4 || long.length < 2)) continue;
    if (short.every((token) => long.includes(token))) return hit("token-subset");
  }

  return null;
}

/**
 * `target` için aynı takımdaki ad-varyasyonu adayları (en güçlüden zayıfa).
 * @param {object} target     elle girilmiş kayıt
 * @param {object[]} pool     sağlayıcı kayıtları
 */
function findVariantCandidates(target, pool) {
  const team = target && (target.currentTeam || target.team);
  const found = [];
  for (const candidate of Array.isArray(pool) ? pool : []) {
    if (!candidate || candidate === target || candidate.id === target.id) continue;
    if (!sameTeam(team, candidate.currentTeam || candidate.team)) continue;
    const verdict = compareNames(target.name, candidate.name);
    if (verdict) found.push({ player: candidate, method: verdict.method, strength: verdict.strength });
  }
  return found.sort((x, y) => y.strength - x.strength);
}

/**
 * Tek ve açık eşleşme: en güçlü yöntemde tek aday. Aynı güçte birden çok
 * aday ya da daha zayıf yöntemle çakışma varsa null (belirsiz).
 */
function pickUniqueVariant(target, pool) {
  const candidates = findVariantCandidates(target, pool);
  if (!candidates.length) return { match: null, reason: "no-variant", candidates };
  const top = candidates[0].strength;
  const best = candidates.filter((entry) => entry.strength === top);
  if (best.length !== 1) return { match: null, reason: "ambiguous", candidates };
  return { match: best[0], reason: null, candidates };
}

/**
 * EŞLEŞMEYEN KAYIT İÇİN İNCELEME İPUCU — bağlanmaz, yalnızca rapora girer.
 * Başka takımda ad örtüşen kayıtlar (transfer ya da yanlış takım bilgisi
 * olabilir) ve aynı takımda yalnızca soyisim örtüşenler (farklı kişi de
 * olabilir). İnsan karar verir.
 */
function nearCandidates(target, pool, limit = 3) {
  const team = target && (target.currentTeam || target.team);
  const surname = nameTokens(target && target.name).filter((token) => token.length >= 4);
  const hints = [];
  for (const candidate of Array.isArray(pool) ? pool : []) {
    if (!candidate || candidate.id === target.id) continue;
    const candidateTeam = candidate.currentTeam || candidate.team;
    const nameHit = compareNames(target.name, candidate.name);
    const sameClub = sameTeam(team, candidateTeam);
    if (nameHit && !sameClub) {
      hints.push({ id: candidate.id, name: candidate.name, team: candidateTeam || null, providerId: candidate.providerId || null, note: "name-matches-other-team" });
    } else if (!nameHit && sameClub && nameTokens(candidate.name).some((token) => surname.includes(token))) {
      hints.push({ id: candidate.id, name: candidate.name, team: candidateTeam || null, providerId: candidate.providerId || null, note: "shares-name-part-same-team" });
    }
  }
  return hints.sort((x, y) => (x.note === y.note ? 0 : x.note === "name-matches-other-team" ? -1 : 1)).slice(0, limit);
}

module.exports = {
  compareNames,
  nearCandidates,
  findVariantCandidates,
  foldName,
  foldTeam,
  nameTokens,
  pickUniqueVariant,
  sameTeam
};
