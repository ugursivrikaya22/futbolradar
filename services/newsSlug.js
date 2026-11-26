/**
 * HABER ADRESİ (SLUG) — OKUNUR, BAŞLIKTAN TÜRETİLİR.
 *
 * Otomatik üretilen haberlerin adresi "besiktas-adali-960ce1d5" gibiydi:
 * takım + özne + kaynak adresinden türetilmiş 8 karakterlik özet kodu. Kod
 * okuyucuya ve arama motoruna bir şey söylemiyor; iç bağlantı metinleri de
 * ("Haber: besiktas adali 960ce1d5") bu yüzden okunmaz görünüyordu.
 *
 * Yeni kural: adres haberin Türkçe başlığından gelir. Çakışma olursa önce
 * yayın tarihi (YYYY-AA-GG), sonra sıra numarası eklenir; özet kodu hiçbir
 * zaman eklenmez. Saf fonksiyonlar; dosya/ağ erişimi yok.
 */
const HASH_SUFFIX = /-[0-9a-f]{8}$/;
const MAX_SLUG_LENGTH = 90;

/** Eski biçim: sonu 8 onaltılık karakterle biten slug. */
function isHashedSlug(slug) {
  return HASH_SUFFIX.test(String(slug || ""));
}

function slugify(value) {
  return String(value || "")
    // Kesme işaretleri sözcüğü bölmesin: "Beşiktaş'ta" → "besiktasta".
    .replace(/['’`´]/g, "")
    .replace(/İ/g, "i")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Sözcük sınırında keser; yarım sözcük bırakmaz. */
function truncateSlug(slug, max = MAX_SLUG_LENGTH) {
  if (slug.length <= max) return slug;
  const cut = slug.slice(0, max);
  const lastDash = cut.lastIndexOf("-");
  return (lastDash > max * 0.5 ? cut.slice(0, lastDash) : cut).replace(/-+$/, "");
}

function dayOf(value) {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value || ""));
  return match ? match[1] : "";
}

/**
 * @param {string} title  haberin Türkçe başlığı
 * @param {{taken?: Set<string>|string[], publishedAt?: string, fallback?: string}} [options]
 *   taken: kullanılmış slug'lar (çakışma denetimi)
 */
function readableSlug(title, { taken = [], publishedAt = "", fallback = "haber" } = {}) {
  const used = taken instanceof Set ? taken : new Set(taken);
  const base = truncateSlug(slugify(title)) || fallback;
  if (!used.has(base)) return base;
  const day = dayOf(publishedAt);
  if (day) {
    const dated = `${truncateSlug(base, MAX_SLUG_LENGTH - 11)}-${day}`;
    if (!used.has(dated)) return dated;
  }
  for (let n = 2; n < 1000; n += 1) {
    const numbered = `${truncateSlug(base, MAX_SLUG_LENGTH - 4)}-${n}`;
    if (!used.has(numbered)) return numbered;
  }
  throw new Error(`Okunur slug üretilemedi: ${title}`);
}

module.exports = { HASH_SUFFIX, MAX_SLUG_LENGTH, isHashedSlug, slugify, truncateSlug, readableSlug };
