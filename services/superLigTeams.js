/**
 * SÜPER LİG TAKIM KAPSAMI
 *
 * Sitenin takım listesi iki kaynaktan birleşir:
 *
 *   1. data/teams.json — elle doğrulanmış, zengin editoryal kayıt (momentum,
 *      form, transferler). Bu dosyada yalnızca birkaç takım vardır.
 *   2. data/super-lig-fixtures.json — TFF fikstürü. Bir takımın bu sezon
 *      ligde olduğu doğrulanmış bilgidir; fikstürde adı geçen her takım
 *      gerçekten Süper Lig'dedir.
 *
 * Neden birleştirme: teams.json'da yalnızca beş takım olduğu için "Göztepe"
 * veya "Konyaspor" araması sıfır sonuç veriyordu — oysa iki takım da ligde ve
 * sitede 306 maç sayfasında adı geçiyor. Kapsamı elle 18 kayda çıkarmak yerine
 * fikstürden türetmek tek kaynak bırakır: lig kadrosu değiştiğinde liste
 * kendiliğinden güncellenir.
 *
 * ÖNEMLİ: Fikstürden türetilen takım için YALNIZCA kimlik alanları üretilir
 * (ad, lig, sezon, ülke). momentum, form, hücum/savunma gücü, stadyum, teknik
 * direktör, kadro gibi alanlar UYDURULMAZ; bu takımlarda o alanlar yoktur ve
 * arayüz ilgili bölümleri sessizce gizler.
 */

const fixtures = require("../data/super-lig-fixtures.json");
const { normalizeText } = require("../api/_utils");
const { nationKey } = require("./displayLabels");

function slug(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Fikstürde adı geçen benzersiz takımlar (doğrulanmış lig üyeliği). */
function fixtureTeamNames() {
  const names = new Set();

  for (const round of fixtures.rounds || []) {
    for (const match of round.matches || []) {
      if (match && match.homeTeam) names.add(String(match.homeTeam).trim());
      if (match && match.awayTeam) names.add(String(match.awayTeam).trim());
    }
  }

  return [...names].filter(Boolean).sort((a, b) => a.localeCompare(b, "tr"));
}

/**
 * Fikstürden türetilmiş takım kaydı. Yalnızca doğrulanabilir alanlar taşır.
 * `coverage: "fixture-only"` işareti, arayüzün veri gerektiren bölümleri
 * sessizce gizleyebilmesi için bırakılır.
 */
function fixtureOnlyTeam(name) {
  return {
    id: slug(name),
    name,
    league: fixtures.league || "Süper Lig",
    standingsSeason: fixtures.season || null,
    country: "Türkiye",
    coverage: "fixture-only",
    source: "tff-fixture",
    dataStatus: "verified-identity"
  };
}

/**
 * İki kaynak aynı kulübü FARKLI yazıyor olabilir.
 *
 * API-Football "Rizespor", TFF fikstürü "Çaykur Rizespor" diyor. Aynı kulüp.
 * Tam ad eşitliği arandığı sürece ikisi de listeye giriyor ve kullanıcı arama
 * kutusunda aynı takımı iki kez görüyor. Kadro senkronu gerçek anahtarla
 * koşana kadar teams.json'da yalnızca beş takım vardı ve çakışma hiç
 * oluşmuyordu; senkron 18 takım yazınca üç kulüp ikizlendi (Rizespor,
 * Gençlerbirliği, Amed).
 *
 * Kural: normalleştirilmiş adlardan biri diğerini KELİME SINIRINDA içeriyorsa
 * aynı kulüptür. Sınır şartı olmadan kısa bir ad alakasız bir kulübe
 * yapışabilir; en az dört karakter şartı da tek harfli parçaları eler.
 */
const MIN_CONTAINMENT_LENGTH = 4;

/**
 * Bir kulübün alt yapı/yedek takımını işaret eden ek sözcükler. "Sporting
 * CP" ⊂ "Sporting CP U19" da kelime sınırında içerilir — ama bu iki takım
 * AYNI KULÜP değil, aynı kulübün iki farklı takımıdır: aynı gün, aynı
 * rakibe karşı ayrı maçlar oynayabilirler (UEFA Youth League, ilk takımın
 * Şampiyonlar Ligi maçıyla aynı hafta oynanır). Fark yalnızca yazım değilse
 * (Rizespor/Çaykur Rizespor gibi) içerme kuralı iki gerçek maçı bir
 * karşılaşmaya birleştirir ve ilk takımın canlı skoru kaybolur.
 */
const AGE_GROUP_OR_RESERVE_SUFFIX = /(^|\s)(u1[3-9]|u2[0-3]|akademi|academy|youth|genc(ler)?|yedek|reserves?|b|ii)(\s|$)/;

// SAF FONKSİYON ÖNBELLEĞİ. `sameClub` her çağrıda düzenli ifade kuruyor ve
// /api/matches, yayın eşleştirme ve kanonik ad araması aynı ad çiftlerini
// binlerce kez soruyor. Sonuç yalnızca iki dizeye bağlı (normalizeText de
// String(value || "") üzerinden çalışıyor); sınırlı, dolunca boşalıyor.
const SAME_CLUB_MEMO = new Map();
const SAME_CLUB_MEMO_LIMIT = 50000;
const CLUB_NAME_MEMO = new Map();
function clubNameParts(value) {
  const key = String(value || "");
  if (CLUB_NAME_MEMO.has(key)) return CLUB_NAME_MEMO.get(key);
  const normalized = normalizeText(key);
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = { normalized, containment: new RegExp(`(^|\\s)${escaped}(\\s|$)`) };
  if (key.length <= 256) {
    if (CLUB_NAME_MEMO.size >= 8192) CLUB_NAME_MEMO.delete(CLUB_NAME_MEMO.keys().next().value);
    CLUB_NAME_MEMO.set(key, parts);
  }
  return parts;
}

function sameClub(left, right) {
  const memoKey = `${String(left || "")}\u0000${String(right || "")}`;
  const memo = SAME_CLUB_MEMO.get(memoKey);
  if (memo !== undefined) return memo;
  const result = sameClubUncached(left, right);
  if (SAME_CLUB_MEMO.size >= SAME_CLUB_MEMO_LIMIT) SAME_CLUB_MEMO.clear();
  SAME_CLUB_MEMO.set(memoKey, result);
  return result;
}

function sameClubUncached(left, right) {
  const leftParts = clubNameParts(left);
  const rightParts = clubNameParts(right);
  const a = leftParts.normalized;
  const b = rightParts.normalized;
  if (!a || !b) return false;
  if (a === b) return true;
  // Millî takım: "Italy" ile "İtalya" aynı takımdır.
  const nationA = nationKey(left);
  if (nationA && nationA === nationKey(right)) return true;

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length < MIN_CONTAINMENT_LENGTH) return false;
  // Kelime sınırı: "amed" ⊂ "amed sportif faaliyetler" eşleşir,
  // rastgele bir alt dize eşleşmez.
  const containment = (a.length <= b.length ? leftParts : rightParts).containment;
  if (!containment.test(longer)) return false;

  const remainder = ` ${longer.replace(containment, " ").trim()} `;
  return !AGE_GROUP_OR_RESERVE_SUFFIX.test(remainder);
}

/**
 * Editoryal/senkronlanmış kayıtlar + fikstürden türetilenler. Aynı takım her
 * iki kaynakta varsa elde olan kayıt kazanır: doğrulanmış veri, türetilmiş
 * kimliğin üzerine yazılmaz.
 */
function mergeSuperLigTeams(curatedTeams) {
  const merged = [];
  const known = [];

  for (const team of Array.isArray(curatedTeams) ? curatedTeams : []) {
    if (!team || !team.name) continue;
    known.push(team.name);
    merged.push(team);
  }

  for (const name of fixtureTeamNames()) {
    if (known.some((existing) => sameClub(existing, name))) continue;
    known.push(name);
    merged.push(fixtureOnlyTeam(name));
  }

  return merged;
}

/** Bu takım yalnızca fikstürden mi biliniyor (kadro/istatistik yok)? */
function isFixtureOnly(team) {
  return Boolean(team && team.coverage === "fixture-only");
}

/**
 * Kulübün DOĞRULANMIŞ iç saha stadı.
 *
 * Kaynak, fikstür dosyasının elle doğrulanmış takım listesidir; yalnızca
 * `status: "confirmed"` kayıtları okunur. Bu bir tahmin değil, editoryal
 * olarak onaylanmış bir alan — dosyada yoksa `null` döner ve arayüz sahayı
 * hiç göstermez. Uydurulmuş bir stat adı, boş bir alandan çok daha kötüdür.
 *
 * Neden gerekli: sağlayıcı takvimi bazı lig maçlarında `venue: null`
 * gönderiyor (ör. Kasımpaşa - Trabzonspor, 15.08.2026). Saha bilgisi aslında
 * biliniyor — ev sahibinin kendi stadı — ama maç kaydında yok.
 */
function confirmedHomeVenue(teamName) {
  for (const team of fixtures.teams || []) {
    if (!team || team.status !== "confirmed") continue;
    if (!sameClub(team.name, teamName)) continue;
    const venue = String(team.venue || "").trim();
    return venue || null;
  }
  return null;
}

module.exports = {
  fixtureTeamNames,
  sameClub,
  fixtureOnlyTeam,
  mergeSuperLigTeams,
  isFixtureOnly,
  confirmedHomeVenue,
  slug
};
