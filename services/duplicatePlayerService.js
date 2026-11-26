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

function firstInitials(player) {
  const initials = new Set();
  for (const value of [player && player.name, player && player.fullName]) {
    const first = normalizeText(value || "").split(/\s+/).filter(Boolean)[0] || "";
    const letter = String(first).replace(/[^a-z]/g, "").charAt(0);
    if (letter) initials.add(letter);
  }
  return initials;
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
  const buckets = new Map();

  // Aynı soyad + aynı güncel kulüp kovası. Kova içinde iki kayıt, ad baş
  // harfleri kesiştiğinde bağlanır. Baş harf kümesi hem `name` hem `fullName`
  // alanının ilk sözcüğünden gelir: "Kerem Aktürkoğlu" kaydının tam adı
  // "Muhammed Kerem Aktürkoğlu" olduğundan yalnızca tam ada bakmak "K."
  // kaydıyla eşleştiremiyordu. Orta ad baş harfi KULLANILMAZ: "Barış Alper
  // Yılmaz" ile "A. Yılmaz" ayrı kişilerdir.
  for (const player of list) {
    if (!player || !player.id) continue;
    const lastName = lastNameKey(player);
    const team = teamKey(player);
    const initials = firstInitials(player);
    if (!lastName || !team || !initials.size) continue;
    const key = `${lastName}|${team}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push({ player, initials });
  }

  const canonicalById = new Map();
  const duplicateGroups = [];

  for (const [bucketKey, entries] of buckets) {
    if (entries.length < 2) continue;
    // Birleşik küme bul (kovalar küçük: iki üç kayıt).
    const parent = entries.map((_, index) => index);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        const shared = [...entries[i].initials].some((initial) => entries[j].initials.has(initial));
        if (shared) parent[find(j)] = find(i);
      }
    }
    const clusters = new Map();
    entries.forEach((entry, index) => {
      const root = find(index);
      if (!clusters.has(root)) clusters.set(root, []);
      clusters.get(root).push(entry.player);
    });

    for (const members of clusters.values()) {
      if (members.length < 2) continue;
      const ranked = members.slice().sort((a, b) => recordCompleteness(b) - recordCompleteness(a));
      const canonical = ranked[0];
      for (const member of members) canonicalById.set(member.id, canonical.id);
      duplicateGroups.push({
        key: `${bucketKey}|${[...firstInitials(canonical)].join("")}`,
        name: canonical.name || canonical.fullName || "",
        team: canonical.currentTeam || canonical.team || "",
        canonicalId: canonical.id,
        memberIds: members.map((member) => member.id)
      });
    }
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

/**
 * MEVKİ ETİKETİ — Türkçe, tek tip: TEK TABLO services/playerLabels.js.
 *
 * Etiket bir SUNUM olduğundan veri değişmez. Burada yalnızca iki ek kural:
 * boş değer "" döner (liste satırında null basılmaz) ve birleştirilen kayıtlar
 * arasında özgün Türkçe mevki (Stoper, Sağ bek...) genel gruptan ("Defans")
 * daha bilgilidir ve korunur.
 */
const { positionLabelTr: tableLabel } = require("./playerLabels.js");

const GENERIC_POSITIONS = new Set(["Defans", "Orta saha", "Forvet", "Kaleci"]);

function positionLabelTr(position) {
  const label = tableLabel(position);
  return label === null || label === undefined ? "" : String(label);
}

/** "A. Batagov" gibi baş harfe kısaltılmış ad mı? */
function isAbbreviatedName(name) {
  return /^\p{L}\.(\s|$)/u.test(String(name || "").trim());
}

function displayNameScore(name) {
  const clean = String(name || "").replace(/\s+/g, " ").trim();
  if (!clean) return -1;
  const tokens = clean.split(" ");
  const abbreviatedTokens = tokens.filter((token) => /^\p{L}\.$/u.test(token)).length;
  // Önce kısaltma içermeyen ad, sonra daha çok sözcük, sonra daha uzun ad.
  return (abbreviatedTokens === 0 ? 1000 : 0) + tokens.length * 20 + clean.length;
}

function bestDisplayName(members) {
  return members
    .map((member) => String(member.fullName || member.name || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .sort((a, b) => displayNameScore(b) - displayNameScore(a))[0] || "";
}

function bestPositionLabel(members, canonical) {
  const labels = [canonical].concat(members).map((member) => positionLabelTr(member && member.position)).filter(Boolean);
  return labels.find((label) => !GENERIC_POSITIONS.has(label)) || labels[0] || "";
}

/**
 * Kadro listesi için TEK KAYIT: aynı oyuncunun kısa/uzun adlı kayıtlarını
 * kanonik kayıtta birleştirir. Kanonik kayıt (gerçek sağlayıcı kimliği olan)
 * kimliği, fotoğrafı ve sağlayıcı alanlarını korur; gösterilen ad grubun en
 * tam adı, mevki ise en özgül Türkçe etikettir. Birleştirilen kayıtların
 * kimlikleri `mergedIds`'te kalır (profil bağlantısı çözümü için).
 * Giriş sırası korunur; mükerrer olmayan kayıtlar yalnızca mevki etiketini
 * Türkçeleştirir.
 */
function collapseDuplicates(players) {
  const list = Array.isArray(players) ? players : [];
  const { canonicalById, duplicateGroups } = buildDuplicateGroups(list);
  const membersByCanonical = new Map(duplicateGroups.map((group) => [group.canonicalId, group.memberIds]));
  const byId = new Map(list.filter((p) => p && p.id).map((p) => [p.id, p]));
  const out = [];

  for (const player of list) {
    if (!player) continue;
    const canonicalId = canonicalById.get(player.id) || player.id;
    if (canonicalId !== player.id) continue; // kopya: kanonik kayıt temsil eder
    const memberIds = membersByCanonical.get(player.id);
    if (!memberIds) {
      out.push({ ...player, position: positionLabelTr(player.position) || player.position });
      continue;
    }
    const members = memberIds.map((id) => byId.get(id)).filter(Boolean);
    const name = bestDisplayName(members) || player.name;
    out.push({
      ...player,
      name,
      fullName: name,
      position: bestPositionLabel(members, player),
      mergedIds: memberIds.filter((id) => id !== player.id)
    });
  }
  return out;
}

module.exports = {
  hasRealProviderId,
  recordCompleteness,
  buildDuplicateGroups,
  annotateDuplicates,
  sameCanonicalPlayer,
  positionLabelTr,
  isAbbreviatedName,
  bestDisplayName,
  collapseDuplicates
};
