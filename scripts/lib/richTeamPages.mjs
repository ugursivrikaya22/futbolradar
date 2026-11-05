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
 * Slug'lar PR #583 standingsTeamRegistry ile aynı kanonik adresleri kullanır.
 */
export const RICH_TEAM_PAGES = Object.freeze({
  "40": Object.freeze({
    slug: "liverpool",
    href: "takimlar/liverpool",
    file: "takimlar/liverpool.html",
    data: "data/team-pages/liverpool.json",
    generator: "scripts/generate-rich-team-pages.mjs"
  }),
  "529": Object.freeze({
    slug: "barcelona",
    href: "takimlar/barcelona",
    file: "takimlar/barcelona.html",
    data: "data/team-pages/barcelona.json",
    generator: "scripts/generate-rich-team-pages.mjs"
  }),
  "530": Object.freeze({
    slug: "atletico-madrid",
    href: "takimlar/atletico-madrid",
    file: "takimlar/atletico-madrid.html",
    data: "data/team-pages/atletico-madrid.json",
    generator: "scripts/generate-rich-team-pages.mjs"
  }),
  "541": Object.freeze({
    slug: "real-madrid",
    href: "takimlar/real-madrid",
    file: "takimlar/real-madrid.html",
    data: "data/team-pages/real-madrid.json",
    generator: "scripts/generate-rich-team-pages.mjs"
  })
});

export function richTeamPage(providerId) {
  return RICH_TEAM_PAGES[String(providerId)] || null;
}

export function richTeamPageBySlug(slug) {
  return Object.values(RICH_TEAM_PAGES).find((e) => e.slug === slug) || null;
}
