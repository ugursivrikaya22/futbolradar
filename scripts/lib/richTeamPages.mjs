/**
 * ZENGİN (ELLE KAYNAKLANMIŞ) TAKIM SAYFALARI KAYDI.
 *
 * Bazı yabancı kulüplerin `/takimlar/<slug>` adresi, resmî kaynaklardan
 * derlenmiş bir veri dosyasından (data/team-pages/<slug>.json) ayrı bir
 * üreticiyle yazılır ve İNDEKSLENİR. Otomatik/şablon takım sayfası üreten
 * başka bir üretici (ör. açık PR #583'teki generate-standings-team-pages.mjs)
 * bu kayıttaki sağlayıcı kimlikleri için:
 *   - aynı slug'ı başka takıma vermemeli,
 *   - dosyayı yazmamalı (veya yazsa bile bu üretici postbuild'de sonra koşar),
 *   - noindex/sitemap kararını bu sayfa için vermemeli.
 *
 * Anahtar: API-Football takım kimliği (data/league-standings.json `id`).
 */
export const RICH_TEAM_PAGES = Object.freeze({
  "40": Object.freeze({
    slug: "liverpool",
    href: "takimlar/liverpool",
    file: "takimlar/liverpool.html",
    data: "data/team-pages/liverpool.json",
    generator: "scripts/generate-liverpool-team-page.mjs"
  })
});

export function richTeamPage(providerId) {
  return RICH_TEAM_PAGES[String(providerId)] || null;
}
