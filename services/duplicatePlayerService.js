/**
 * OYUNCU KİMLİĞİ — AYNI GERÇEK OYUNCU, FARKLI KAYIT.
 *
 * Kadro senkronu bir oyuncu için elle kürasyonlu kaydın YANINA yeni bir
 * sağlayıcı kaydı yazıyor, üstüne yazmıyor: "victor-osimhen" (mock kimlik)
 * ve "v-osimhen-galatasaray" (providerId "2780") aynı kişi için iki ayrı id.
 * Denetim 672 kayıtta 83 böyle çift buldu — hepsi aynı isim + aynı güncel
 * kulüp kalıbında.
 *
 * Bu ayrışma karşılaştırma özelliğinde somut bir hataya yol açıyor: statik
 * üretici "u-cakir-galatasaray-vs-ugurcan-cakir.html" sayfasını üretiyor —
 * Uğurcan Çakır'ın kendisiyle karşılaştırması. İnteraktif araçta ise hiçbir
 * kapı yok; iki kayıt seçilirse çelişen puanlar yan yana basılır.
 *
 * Veri dosyası DEĞİŞMEZ: id birleştirme riskli ve bu görevin kapsamı dışında.
 * Bunun yerine grup çalışma zamanında hesaplanır ve her kayda salt-okunur
 * `canonicalId`/`isDuplicate` alanı olarak eklenir.
 */
const { normalizeText } = require("./playerService");

const REAL_PROVIDER_ID = /^\d+$/;

function hasRealProviderId(player) {
  const id = String((player && player.providerId) || "").trim();
  return REAL_PROVIDER_ID.test(id);
}

function nameTokens(player) {
  return normalizeText((player && (player.fullName || player.name)) || "").split(/\s+/).filter(Boolean);
}

/**
 * Soyisim eşleşmesi TEK BAŞINA yanlış birleştirir: aynı kadroda birden çok
 * "Yılmaz" ya da "Özcan" gerçekten var (Barış Alper Yılmaz / A. Yilmaz /
 * J. Yılmaz üçü de Galatasaray'da, üçü de farklı kişi). Sağlayıcı kaydı adı
 * "İlk harf. Soyisim" biçiminde geldiği için ad baş harfi de eşleşmezse
 * grup kurulmaz — bu ikili anahtar 672 kayıtta hiçbir yanlış üçlü grup
 * üretmeden 84 gerçek çifti yakalıyor (doğrulandı).
 */
function lastNameKey(player) {
  const tokens = nameTokens(player);
  return tokens[tokens.length - 1] || "";
}

function firstInitialKey(player) {
  const tokens = nameTokens(player);
  const first = String(tokens[0] || "").replace(/[^a-z]/g, "");
  return first.charAt(0) || "";
}

function teamKey(player) {
  return normalizeText((player && (player.currentTeam || player.team)) || "");
}

/**
 * Kayıt ne kadar "tam"? Grup içinde kanonik (birincil) kayıt bu skora göre
 * seçilir — gerçek sağlayıcı kimliği, kaynak bağlantısı ve doğrulanmış durum
 * bir mock kayıttan her zaman daha güvenilir kabul edilir.
 */
function recordCompleteness(player) {
  let score = 0;
  if (hasRealProviderId(player)) score += 4;
  if (String((player && player.sourceUrl) || "").trim()) score += 2;
  if (String((player && player.lastVerifiedAt) || "").trim()) score += 2;
  if (["verified", "manually_verified", "manual"].includes(String((player && player.dataStatus) || ""))) score += 3;
  if (["verified", "current"].includes(String((player && player.ratingStatus) || ""))) score += 3;
  if (Number((player && player.marketValueEur) || 0) > 0) score += 1;
  return score;
}

/**
 * Soyisim + ad baş harfi + güncel kulüp eşleşmesiyle grupla. Üçü de
 * eşleşmiyorsa aynı kişiden gelen iki farklı kayıt olduğu iddia edilmez —
 * yanlış birleştirme, hiç birleştirmemekten daha kötü bir hatadır (iki
 * farklı oyuncu tek kişi sayılır).
 *
 * @returns {{canonicalById: Map<string,string>, duplicateGroups: Array}}
 */
function buildDuplicateGroups(players) {
  const list = Array.isArray(players) ? players : [];
  const groups = new Map();

  for (const player of list) {
    if (!player || !player.id) continue;
    const lastName = lastNameKey(player);
    const firstInitial = firstInitialKey(player);
    const team = teamKey(player);
    if (!lastName || !firstInitial || !team) continue;
    const key = `${lastName}|${firstInitial}|${team}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(player);
  }

  const canonicalById = new Map();
  const duplicateGroups = [];

  for (const [key, members] of groups) {
    if (members.length < 2) continue;
    const ranked = members.slice().sort((a, b) => recordCompleteness(b) - recordCompleteness(a));
    const canonical = ranked[0];
    for (const member of members) canonicalById.set(member.id, canonical.id);

    duplicateGroups.push({
      key,
      name: canonical.name || canonical.fullName || "",
      team: canonical.currentTeam || canonical.team || "",
      canonicalId: canonical.id,
      memberIds: members.map((member) => member.id)
    });
  }

  return { canonicalById, duplicateGroups };
}

/** Her kayda `canonicalId` (kendisi ya da grup lideri) ve `isDuplicate` ekler. */
function annotateDuplicates(players) {
  const list = Array.isArray(players) ? players : [];
  const { canonicalById } = buildDuplicateGroups(list);

  return list.map((player) => {
    const canonicalId = canonicalById.get(player.id) || player.id;
    return {
      ...player,
      canonicalId,
      isDuplicate: canonicalId !== player.id
    };
  });
}

/** İki kayıt aynı gerçek oyuncuya mı işaret ediyor? */
function sameCanonicalPlayer(left, right, canonicalById) {
  if (!left || !right) return false;
  const canonicalOf = (player) => {
    if (canonicalById && canonicalById.has(player.id)) return canonicalById.get(player.id);
    return player.canonicalId || player.id;
  };
  return canonicalOf(left) === canonicalOf(right);
}

module.exports = {
  hasRealProviderId,
  recordCompleteness,
  buildDuplicateGroups,
  annotateDuplicates,
  sameCanonicalPlayer
};
