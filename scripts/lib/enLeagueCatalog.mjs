/**
 * İNGİLİZCE LİG KATALOĞU — elle yazılmış adlar ve adresler.
 *
 * İki İngilizce üretici (`generate-en-league-pages.mjs`,
 * `generate-en-league-statistics-pages.mjs`) ve bu sayfalara bağlantı veren
 * istatistik merkezi (`generate-en-pages.mjs`) aynı tabloyu okur. Bağlantı
 * veren ile sayfayı yazan ayrı tablolardan beslenseydi, birine eklenen lig
 * ötekinde olmayan bir sayfaya bağlantı üretir ve kırık bağlantı denetimi
 * yayını durdururdu.
 *
 * Karşılığı burada olmayan yarışma için İngilizce sayfa ÜRETİLMEZ: Türkçe
 * ad İngilizce sayfaya taşınmaz.
 */

/** Yarışma kimliği → İngilizce adres, ad ve ülke. Elle yazılmıştır. */
export const EN_LEAGUE_PAGES = Object.freeze({
  "super-lig": { slug: "super-lig", name: "Süper Lig", country: "Turkey" },
  "1-lig": { slug: "turkish-first-league", name: "Turkish First League", country: "Turkey" },
  "tff-2-lig": { slug: "turkish-second-league", name: "Turkish Second League", country: "Turkey" },
  "tff-3-lig": { slug: "turkish-third-league", name: "Turkish Third League", country: "Turkey" },
  "turkiye-kupasi": { slug: "turkish-cup", name: "Turkish Cup", country: "Turkey" },
  "sampiyonlar-ligi": { slug: "champions-league", name: "Champions League", country: "UEFA" },
  "avrupa-ligi": { slug: "europa-league", name: "Europa League", country: "UEFA" },
  "konferans-ligi": { slug: "conference-league", name: "Conference League", country: "UEFA" },
  "uefa-uluslar-ligi": { slug: "nations-league", name: "UEFA Nations League", country: "UEFA" },
  "premier-league": { slug: "premier-league", name: "Premier League", country: "England" },
  "la-liga": { slug: "la-liga", name: "La Liga", country: "Spain" },
  "serie-a": { slug: "serie-a", name: "Serie A", country: "Italy" },
  bundesliga: { slug: "bundesliga", name: "Bundesliga", country: "Germany" },
  "ligue-1": { slug: "ligue-1", name: "Ligue 1", country: "France" },
  championship: { slug: "championship", name: "Championship", country: "England" },
  eredivisie: { slug: "eredivisie", name: "Eredivisie", country: "Netherlands" },
  "primeira-liga": { slug: "primeira-liga", name: "Primeira Liga", country: "Portugal" },
  "belcika-pro-ligi": { slug: "belgian-pro-league", name: "Belgian Pro League", country: "Belgium" },
  "scottish-premiership": { slug: "scottish-premiership", name: "Scottish Premiership", country: "Scotland" },
  "saudi-pro-league": { slug: "saudi-pro-league", name: "Saudi Pro League", country: "Saudi Arabia" },
  mls: { slug: "mls", name: "MLS", country: "United States" },
  brasileirao: { slug: "brasileirao", name: "Brazil Série A", country: "Brazil" },
  "arjantin-primera": { slug: "argentina-primera-division", name: "Argentina Primera División", country: "Argentina" }
});

/** Lig kimliği → İngilizce ad ve adres. Elle yazılmıştır. */
export const EN_STAT_LEAGUES = Object.freeze({
  "premier-league": { name: "Premier League", slug: "premier-league-statistics" },
  "la-liga": { name: "La Liga", slug: "la-liga-statistics" },
  "serie-a": { name: "Serie A", slug: "serie-a-statistics" },
  bundesliga: { name: "Bundesliga", slug: "bundesliga-statistics" },
  "ligue-1": { name: "Ligue 1", slug: "ligue-1-statistics" },
  "sampiyonlar-ligi": { name: "Champions League", slug: "champions-league-statistics" }
});
