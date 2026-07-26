/**
 * OYUNCU FOTOĞRAFLARI — tek yetkili kural.
 *
 * Fotoğraf yalnızca LİSANSLI kaynaktan gelir: API-Football aboneliğinin
 * kendi medya sunucusu (media.api-sports.io). Sağlayıcı bu adresleri
 * yanıtlarında zaten döndürüyor; gösterilmeleri aboneliğin kapsamında.
 *
 * KAZIMA YOK, LİSANSSIZ GÖRSEL YOK. Host beyaz listesi tek geçit: başka bir
 * alan adından gelen değer, veri dosyasında dursa bile kullanılmaz. Kural
 * "kaynağı iyi görünüyorsa al" değil, "listede yoksa alma".
 *
 * KİMLİKTEN ADRES ÜRETME: sağlayıcı fotoğraf alanını boş bıraksa bile
 * oyuncunun API-Football kimliğinden adres üretilebilir. Ama YALNIZCA gerçek
 * bir sağlayıcı kimliğinden. Bu depodaki mevcut kayıtların kimlikleri
 * "mock-icardi-9" gibi yer tutuculardır; bunlardan adres üretmek ya kırık
 * görsel ya da daha kötüsü BAŞKA bir oyuncunun fotoğrafı demek olurdu.
 * Bu yüzden yalnızca tamamen rakamdan oluşan kimlikler kabul edilir.
 *
 * EKSİKSE YER TUTUCU: fotoğraf yoksa uydurulmaz, boş kutu da bırakılmaz —
 * oyuncunun baş harfleri gösterilir. Görsel kimliği olmayan bir oyuncu
 * sayfada eksik değil, sade görünür.
 */

/** Fotoğraf çekilebilecek tek host. Liste bilerek dar. */
const ALLOWED_PHOTO_HOSTS = new Set(["media.api-sports.io"]);

/** API-Football medya adresi kalıbı. */
const PROVIDER_PHOTO_BASE = "https://media.api-sports.io/football/players";

/** Gerçek sağlayıcı kimliği yalnızca rakamdır; "mock-..." kabul edilmez. */
const PROVIDER_ID_PATTERN = /^\d+$/;

function isAllowedPhotoUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== "https:") return false;
    return ALLOWED_PHOTO_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

/** Oyuncunun sağlayıcı kimliği gerçek mi (yer tutucu değil mi)? */
function providerPhotoId(player) {
  const candidate = String((player && (player.providerId || player.playerId)) || "").trim();
  return PROVIDER_ID_PATTERN.test(candidate) ? candidate : "";
}

function playerInitials(player) {
  const name = String((player && player.name) || "").trim();
  if (!name) return "FR";
  return name.split(/\s+/).slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toLocaleUpperCase("tr-TR") || "FR";
}

/**
 * Fotoğrafı çözer.
 *
 * @returns {{url: string, source: "provider"|"derived"|"placeholder",
 *   isPlaceholder: boolean, initials: string}}
 */
function resolvePlayerPhoto(player) {
  const initials = playerInitials(player);

  // 1. Sağlayıcının döndürdüğü adres — beyaz listeden geçmek zorunda.
  const stored = player && player.photo;
  if (stored && isAllowedPhotoUrl(stored)) {
    return { url: String(stored), source: "provider", isPlaceholder: false, initials };
  }

  // 2. Gerçek sağlayıcı kimliğinden türet.
  const id = providerPhotoId(player);
  if (id) {
    return { url: `${PROVIDER_PHOTO_BASE}/${id}.png`, source: "derived", isPlaceholder: false, initials };
  }

  // 3. Yer tutucu: uydurma görsel yok.
  return { url: "", source: "placeholder", isPlaceholder: true, initials };
}

/**
 * Erişilebilir alternatif metin.
 *
 * Boş alt (alt="") görseli süs ilan eder ve ekran okuyucu onu atlar. Oyuncu
 * fotoğrafı süs değil, içeriğin parçası: kimin kartına baktığını söyler.
 */
function playerPhotoAlt(player, context) {
  const name = String((player && player.name) || "").trim() || "Oyuncu";
  const team = String((player && (player.currentTeam || player.team)) || "").trim();
  if (context) return `${name} — ${context}`;
  return team ? `${name}, ${team} oyuncu fotoğrafı` : `${name} oyuncu fotoğrafı`;
}

module.exports = {
  ALLOWED_PHOTO_HOSTS,
  PROVIDER_PHOTO_BASE,
  isAllowedPhotoUrl,
  providerPhotoId,
  playerInitials,
  resolvePlayerPhoto,
  playerPhotoAlt
};
