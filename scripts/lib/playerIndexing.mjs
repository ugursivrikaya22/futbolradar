/**
 * OYUNCU PROFİLİ İNDEKS KAPISI — Türkçe ve İngilizce için TEK TANIM.
 *
 * Bir oyuncu sayfasının indekslenip indekslenmeyeceği, sayfada gerçekten
 * KAYNAKLI bir içerik bölümü olup olmadığına bağlıdır: sezon istatistiği,
 * maç günlüğü, kariyer, transfer, haber, madalya ya da kadro durumu. Hiçbiri
 * yoksa sayfa yalnızca ad + mevkiden ibarettir ve `noindex,follow` basılır.
 *
 * Bu karar eskiden yalnızca Türkçe üreticide (`generate-player-profile-pages`)
 * yaşıyordu; İngilizce üretici ise sayfayı yalnızca `view.verified === true`
 * ise indeksliyordu. Sonuç: aynı oyuncunun Türkçe profili indekslenirken
 * İngilizce eşi, AYNI kaynaklı bölümlere sahip olduğu hâlde `noindex` kalıyordu
 * (164 çift) ve Türkçe sayfanın hreflang'ı indekslenmeyen bir sayfaya
 * bakıyordu. İki üretici de artık bu tek işlevi kullanır; ikisinin ayrışması
 * `scripts/test-en-player-indexing.mjs` ile denetlenir.
 *
 * `model`, `buildPlayer360(...)` çıktısıdır (iki dilde de aynı servis).
 */
export function hasSubstantivePlayerContent(model) {
  if (!model) return false;
  const rows = (block) => Boolean(block && (block.available || (Array.isArray(block.rows) && block.rows.length) || (Array.isArray(block.items) && block.items.length)));
  return Boolean(
    (model.profileEvidence && model.profileEvidence.matches.length > 0) ||
    (model.seasonStats && model.seasonStats.available) ||
    (model.matchLog && model.matchLog.available) ||
    rows(model.career) || rows(model.transfers) ||
    Boolean(model.news && ((model.news.transfer || []).length || (model.news.general || []).length)) ||
    rows(model.honours) || (model.availability && model.availability.available)
  );
}

/**
 * İNDEKS KARARI — Türkçe ve İngilizce üretici AYNI işlevi çağırır.
 *
 * `verified` (kulüp/kimlik doğrulaması) TEK BAŞINA indeks gerekçesi DEĞİLDİR:
 * doğrulanmış ama yalnızca kimlik + biyografi taşıyan sayfa (kaynaklı sezon,
 * maç, kariyer, transfer, haber, madalya ya da kadro durumu bölümü yok) ince
 * içeriktir ve `noindex,follow` alır; site haritasına da girmez. Aktif tescil
 * penceresindeki kesinleşmiş transfer ise başlı başına kaynaklı bir içeriktir.
 *
 * @param {{model: object, hasRecentTransfer?: boolean}} input
 */
export function playerPageIsIndexable({ model, hasRecentTransfer = false }) {
  return Boolean(hasRecentTransfer) || hasSubstantivePlayerContent(model);
}
