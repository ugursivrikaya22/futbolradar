/**
 * KIYAS EŞLERİ — TEK KAYNAK.
 *
 * Bir oyuncu profilinden hangi dört kıyas sayfasına bağlanılacağı ve hangi
 * kıyas sayfalarının ÜRETİLECEĞİ aynı sorunun iki yüzü. Bu mantık üç yerde
 * ayrı ayrı duruyordu:
 *
 *   • scripts/generate-player-comparison-pages.mjs — sayfaları ÜRETEN
 *   • scripts/generate-player-profile-pages.mjs    — linkleri BASAN
 *   • Futbolcu 360 kıyas bölümü                    — yeni yüzey
 *
 * Üçü aynı listeyi üretmek ZORUNDA: profil sayfası, üretilmemiş bir kıyas
 * sayfasına bağlandığı anda 404 verir. Nitekim 360 bölümü kendi eş listesini
 * kurduğunda tam olarak bu oldu — derleme doğrulaması yüzlerce
 * "missing local target" bildirdi.
 *
 * Bu yüzden liste burada, bir kez hesaplanır. Sıralama ölçütünü değiştirmek
 * isteyen tek bir yeri değiştirir ve üç yüzey birlikte hareket eder.
 */

const { sameCanonicalPlayer } = require("./duplicatePlayerService.js");

function playerCurrentTeam(player) {
  return (player && (player.currentTeam || player.team)) || "Takım bilgisi yakında";
}

function playerRating(player) {
  return Number((player && (player.overallRating || player.aiRating || player.rating)) || 0);
}

function playerPositionGroup(player) {
  const source = `${(player && player.positionGroup) || ""} ${(player && player.position) || ""}`.toLocaleLowerCase("tr-TR");

  if (source.includes("kaleci") || source.includes("goal")) return "kaleci";
  if (source.includes("def") || source.includes("stoper") || source.includes("bek") || source.includes("savun")) return "defans";
  if (source.includes("orta") || source.includes("mid")) return "orta saha";
  if (source.includes("wing") || source.includes("kanat") || source.includes("forvet") || source.includes("santrfor") || source.includes("striker")) return "forvet";
  return "diger";
}

/**
 * `playerPositionGroup` bir ANAHTAR döndürür ("diger" karşılaştırmalarda
 * eşleştirme için ASCII kalmalı); okura gösterilen metin için bu etiketi kullan.
 */
function positionGroupLabel(group) {
  return group === "diger" ? "diğer" : group;
}

/** İki kimlik her zaman aynı sırada — tek bir adres, kopya URL yok. */
function comparisonSlug(leftId, rightId) {
  return [leftId, rightId].sort().join("-vs-");
}

/**
 * EDİTORYAL KIYASLAR — YAYIMLANMIŞ ADRESLERİNİ KORUR.
 *
 * Bu çiftler elle seçildi ve adresleri ana sayfa, gol krallığı ve oyuncu
 * radarı gibi sayfalardan bağlantılı. Kimlikler kopya kayıtlara ait
 * (kadro senkronu öncesinden kalma); çift artık kanonik kayıtlarla
 * kuruluyor ama ADRES değişmiyor — yayımlanmış bir URL'i yeniden yazmak
 * o bağlantıları kırar.
 */
const EDITORIAL_PAIRS = Object.freeze([
  ["mauro-icardi", "edin-dzeko", "Süper Lig gol tehdidi"],
  ["kerem-akturkoglu", "semih-kilicsoy", "Yükselen yerli hücum profili"],
  ["ugurcan-cakir", "abdulkerim-bardakci", "Savunma güveni"],
  ["sebastian-szymanski", "gedson-fernandes", "Orta saha etki kıyaslaması"],
  ["edin-dzeko", "semih-kilicsoy", "Tecrübe ve genç hücum profili"],
  // Gol krallığı, asist krallığı ve derbi radarındaki elle yazılmış
  // bağlantılar. 26 Kasım'daki kopya birleştirmesinden sonra
  // "kerem-akturkoglu" kanoniğe çözülüyor; bu üç adres listede olmadığı
  // için artık üretilmiyordu ve QA kırık bağlantıda derlemeyi durduruyordu.
  ["edin-dzeko", "kerem-akturkoglu", "Bitiricilik kıyası"],
  ["kerem-akturkoglu", "sebastian-szymanski", "Servis ve bitiricilik"],
  ["kerem-akturkoglu", "mauro-icardi", "Kanat üretimi ve bitiricilik"]
]);

function canonicalIdOf(player) {
  return (player && (player.canonicalId || player.id)) || "";
}

/** Kanonik çift anahtarı — hangi kayıtla gelindiğinden bağımsız. */
function canonicalPairKey(left, right) {
  return [canonicalIdOf(left), canonicalIdOf(right)].sort().join("::");
}

/**
 * KIYAS ADRESİ TEK KAYNAKTAN.
 *
 * Üç yüzey de (kıyas sayfası üreticisi, profil sayfasındaki statik
 * bağlantılar, Futbolcu 360 kıyas bölümü) aynı adresi hesaplamak zorunda.
 * Editoryal istisnayı yalnızca üretici bilseydi, diğer ikisi türetilmiş
 * slug'a bağlanır ve o sayfa hiç üretilmediği için 404 verirdi.
 *
 * @param {object[]} allPlayerRecords kopya kayıtlar DAHİL tam liste
 * @param {object[]} [pool] kıyas havuzu (kopyasız); verilirse üreticinin ilk-gelen slug'u döner
 */
function createComparisonSlugResolver(allPlayerRecords, pool) {
  const byId = new Map((Array.isArray(allPlayerRecords) ? allPlayerRecords : []).map((row) => [row.id, row]));
  const editorialSlugByPair = new Map();

  for (const [leftId, rightId] of EDITORIAL_PAIRS) {
    const left = byId.get(leftId);
    const right = byId.get(rightId);
    if (!left || !right) continue;
    editorialSlugByPair.set(canonicalPairKey(left, right), comparisonSlug(leftId, rightId));
  }

  const base = function baseSlugForPair(left, right) {
    return editorialSlugByPair.get(canonicalPairKey(left, right))
      || comparisonSlug(left.id, right.id);
  };
  if (!Array.isArray(pool)) return base;

  // ÜRETİCİNİN İLK-GELEN KURALI.
  //
  // Kıyas üreticisi çifti KİMLİĞİYLE (kanonik çift anahtarı) tekilleştirir;
  // aynı anahtara ikinci bir kayıt çiftiyle gelinirse ilk slug kazanır ve
  // ikinci slug'da sayfa üretilmez. Taze veride iki havuz kaydı aynı
  // canonicalId'yi taşıyınca profil, kendi kimliğinden türettiği ve hiç
  // üretilmeyen slug'a bağlanıyordu (12 Ekim tam derlemesi: abdullah-celik,
  // mamadou-thiam). Havuz verilirse çözücü, üreticinin gezme sırasını
  // (editoryal çiftler, sonra havuzdaki her oyuncunun kıyas eşleri) aynen
  // izleyip anahtar başına İLK slug'u döndürür.
  const firstSlugByPair = new Map();
  const claim = (left, right) => {
    if (!left || !right || left.id === right.id || sameCanonicalPlayer(left, right)) return;
    const key = canonicalPairKey(left, right);
    if (!firstSlugByPair.has(key)) firstSlugByPair.set(key, base(left, right));
  };
  for (const [leftId, rightId] of EDITORIAL_PAIRS) {
    const resolve = (id) => {
      const record = byId.get(id);
      if (!record) return null;
      return pool.find((player) => player.id === (record.canonicalId || record.id)) || null;
    };
    claim(resolve(leftId), resolve(rightId));
  }
  for (const player of pool) {
    for (const item of profileCompareCandidates(player, pool)) claim(player, item.player);
  }
  const resolver = function slugForPair(left, right) {
    return firstSlugByPair.get(canonicalPairKey(left, right)) || base(left, right);
  };
  // Üreticinin bu havuzla GERÇEKTEN yazacağı slug kümesi. Profil yüzeyleri
  // (özellikle önceki koşudan korunan EN sayfaları) yalnızca bu kümedeki
  // kıyas sayfalarına bağlanabilir; geri kalanı 404 demektir.
  resolver.generatedSlugs = new Set(firstSlugByPair.values());
  return resolver;
}

function comparePeerScore(primary, candidate) {
  if (!primary || !candidate || primary.id === candidate.id) return -1;
  // Aynı gerçek oyuncunun iki kaydı (mock + sağlayıcı senkronu) birbiriyle
  // "karşılaştırılmaz" — bu, oyuncunun kendisiyle kıyaslanması demektir.
  if (sameCanonicalPlayer(primary, candidate)) return -1;

  const sameRole = playerPositionGroup(primary) === playerPositionGroup(candidate) ? 44 : 0;
  const sameLeague = primary.league && candidate.league && primary.league === candidate.league ? 16 : 0;
  const differentTeam = playerCurrentTeam(primary) !== playerCurrentTeam(candidate) ? 10 : 0;
  const ratingCloseness = Math.max(0, 26 - Math.abs(playerRating(primary) - playerRating(candidate)));
  const marketDelta = Math.abs(Number(primary.marketValueEur || 0) - Number(candidate.marketValueEur || 0)) / 1000000;
  const marketCloseness = Math.max(0, 12 - marketDelta / 3);

  return sameRole + sameLeague + differentTeam + ratingCloseness + marketCloseness;
}

function uniqueCompareCandidates(list) {
  const used = new Set();
  return list.filter((item) => {
    if (!item || !item.player || used.has(item.player.id)) return false;
    used.add(item.player.id);
    return true;
  });
}

/**
 * Bir oyuncunun dört kıyas eşi.
 *
 * Dört farklı okuma açısı, sonra genel bir yedek liste: kimi oyuncu için
 * dört ölçütün bir kısmı aynı adaya işaret eder, boş kalan yer en yüksek
 * puanlı adaylarla doldurulur — böylece her profil dört bağlantı taşır.
 *
 * @returns {{label: string, note: string, player: object}[]}
 */
/**
 * BELLEKTE TUTULUR — AYNI LİSTE BİR KOŞUDA ONLARCA KEZ İSTENİYOR.
 *
 * Hesap, 806 kayıtlık diziyi oyuncu başına dört kez sıralıyor. Profil
 * üreticisi (statik kıyas linkleri), Futbolcu 360 kıyas bölümü ve kıyas
 * sayfası üreticisi aynı listeyi ayrı ayrı istediğinde derleme dakikalarca
 * uzuyordu.
 *
 * Anahtar, oyuncu listesinin KİMLİĞİ (WeakMap) + oyuncu kimliği: farklı bir
 * liste geçilirse önbellek paylaşılmaz, yani sonuç her zaman verilen
 * listeye ait kalır.
 */
const candidateCache = new WeakMap();

function profileCompareCandidates(player, players) {
  if (!player || !Array.isArray(players)) return [];

  let byPlayer = candidateCache.get(players);
  if (!byPlayer) {
    byPlayer = new Map();
    candidateCache.set(players, byPlayer);
  }
  if (byPlayer.has(player.id)) return byPlayer.get(player.id);

  const result = computeCompareCandidates(player, players);
  byPlayer.set(player.id, result);
  return result;
}

function computeCompareCandidates(player, players) {
  const candidates = (Array.isArray(players) ? players : [])
    .filter((candidate) => candidate.id !== player.id && !sameCanonicalPlayer(player, candidate));

  const bestPeer = candidates.slice().sort((a, b) => comparePeerScore(player, b) - comparePeerScore(player, a))[0];
  const sameRole = candidates
    .filter((candidate) => playerPositionGroup(candidate) === playerPositionGroup(player))
    .sort((a, b) => playerRating(b) - playerRating(a))[0];
  const closeRating = candidates
    .slice()
    .sort((a, b) => Math.abs(playerRating(player) - playerRating(a)) - Math.abs(playerRating(player) - playerRating(b)))[0];
  const transferRead = candidates
    .filter((candidate) => Array.isArray(candidate.transferHistory) && candidate.transferHistory.length)
    .sort((a, b) => Number(b.marketValueEur || 0) - Number(a.marketValueEur || 0))[0];

  const baseLinks = uniqueCompareCandidates([
    { label: "Akıllı eşleşme", player: bestPeer, note: "Rol, rating ve piyasa yakınlığı" },
    { label: "Aynı rol kıyası", player: sameRole, note: `${positionGroupLabel(playerPositionGroup(player))} profili` },
    { label: "Rating sınavı", player: closeRating, note: "Overall farkını oku" },
    { label: "Transfer okuma", player: transferRead, note: "Güncel takım ve piyasa değeri" }
  ]);
  const fallbackLinks = candidates
    .slice()
    .sort((a, b) => playerRating(b) - playerRating(a))
    .map((candidate) => ({ label: "Radar alternatifi", player: candidate, note: "Profil trafiği ve kıyas akışı" }));

  return uniqueCompareCandidates(baseLinks.concat(fallbackLinks)).slice(0, 4);
}

module.exports = {
  EDITORIAL_PAIRS,
  canonicalPairKey,
  comparePeerScore,
  comparisonSlug,
  createComparisonSlugResolver,
  playerCurrentTeam,
  playerPositionGroup,
  positionGroupLabel,
  playerRating,
  profileCompareCandidates,
  uniqueCompareCandidates
};
