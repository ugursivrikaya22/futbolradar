/**
 * İNGİLİZCE HUB KATALOĞU — lig ve kulüp giriş sayfalarının TEK kaynağı.
 *
 * `/en/champions-league.html`, `/en/premier-league.html`, `/en/galatasaray.html`
 * gibi sayfalar uluslararası okuyucunun Google'da ARADIĞI adreslerdir:
 * "champions league fixtures", "galatasaray fixtures results". Türkçe tarafta
 * bu yüzeyler `lig/<slug>.html` ve `<kulüp>-maclari.html` olarak zaten var;
 * burada yalnızca EŞLEME duruyor — hangi İngilizce adres hangi Türkçe sayfanın
 * karşılığı, hangi başlıkla, hangi arama terimiyle.
 *
 * Neden ayrı dosya: iki üretici (`generate-en-league-hubs.mjs`,
 * `generate-en-club-hubs.mjs`), site haritası bölücüsü ve testler AYNI listeyi
 * okumak zorunda. Liste ayrışırsa hreflang çifti tek yönlü kalır — Google'ın
 * alternate ilişkisini tamamen yok saydığı durum budur.
 *
 * BAŞLIKLAR TÜRKÇEDEN ÇEVRİLMEZ. Türkçe okuyucu "şampiyonlar ligi puan
 * durumu" arar, İngilizce okuyucu "champions league fixtures and results" —
 * başlık o amaca göre kurulur, kelimesi kelimesine çeviriye göre değil.
 */

/**
 * Lig hub'ları. `standingsId` `scripts/lib/standingsCatalog.mjs` anahtarıdır;
 * `competitionId` `data/competitions.json` anahtarı (maçları süzmek için).
 * İkisi de aynı değer olsa bile AYRI tutuluyor: kataloglar birbirinden
 * bağımsız evrilebilir ve sessiz bir eşleşme kayması burada görünür olur.
 */
export const EN_LEAGUE_HUBS = Object.freeze([
  {
    slugEn: "champions-league",
    trPath: "lig/sampiyonlar-ligi.html",
    standingsId: "sampiyonlar-ligi",
    competitionId: "sampiyonlar-ligi",
    nameEn: "Champions League",
    regionEn: "UEFA",
    title: "Champions League Fixtures, Results and Standings | FutbolRadar",
    description:
      "UEFA Champions League fixtures, live scores, results and the current league phase table — every matchday, with kick-off times and verified final scores.",
    intro:
      "Every Champions League fixture and result FutbolRadar has verified, alongside the current league phase standings."
  },
  {
    slugEn: "europa-league",
    trPath: "lig/avrupa-ligi.html",
    standingsId: "avrupa-ligi",
    competitionId: "avrupa-ligi",
    nameEn: "Europa League",
    regionEn: "UEFA",
    title: "Europa League Fixtures, Results and Table | FutbolRadar",
    description:
      "UEFA Europa League fixtures, live scores, results and standings, including every Turkish club competing in the competition this season.",
    intro:
      "Europa League fixtures, verified results and the current table, with Turkish clubs tracked throughout the competition."
  },
  {
    slugEn: "conference-league",
    trPath: "lig/konferans-ligi.html",
    standingsId: "konferans-ligi",
    competitionId: "konferans-ligi",
    nameEn: "Conference League",
    regionEn: "UEFA",
    title: "Conference League Fixtures, Results and Table | FutbolRadar",
    description:
      "UEFA Europa Conference League fixtures, live scores, results and standings, with full coverage of the Turkish clubs in the competition.",
    intro:
      "Conference League fixtures, verified results and the current table, including every Turkish side still involved."
  },
  {
    slugEn: "premier-league",
    trPath: "lig/premier-league.html",
    standingsId: "premier-league",
    competitionId: "premier-league",
    nameEn: "Premier League",
    regionEn: "England",
    title: "Premier League Live Scores, Fixtures and Standings | FutbolRadar",
    description:
      "Premier League live scores, today's fixtures, latest results and the full English top-flight table with points, goal difference and form.",
    intro:
      "Premier League fixtures, live scores and verified results, with the full English top-flight table."
  },
  {
    slugEn: "la-liga",
    trPath: "lig/la-liga.html",
    standingsId: "la-liga",
    competitionId: "la-liga",
    nameEn: "La Liga",
    regionEn: "Spain",
    title: "La Liga Fixtures, Results and Table | FutbolRadar",
    description:
      "La Liga fixtures, live scores, results and the current Spanish top-flight table with played, won, drawn, lost, goal difference and points.",
    intro:
      "La Liga fixtures, live scores and verified results, with the current Spanish top-flight table."
  },
  {
    slugEn: "serie-a",
    trPath: "lig/serie-a.html",
    standingsId: "serie-a",
    competitionId: "serie-a",
    nameEn: "Serie A",
    regionEn: "Italy",
    title: "Serie A Fixtures, Results and Table | FutbolRadar",
    description:
      "Serie A fixtures, live scores, results and the current Italian top-flight table with played, won, drawn, lost, goal difference and points.",
    intro:
      "Serie A fixtures, live scores and verified results, with the current Italian top-flight table."
  },
  {
    slugEn: "bundesliga",
    trPath: "lig/bundesliga.html",
    standingsId: "bundesliga",
    competitionId: "bundesliga",
    nameEn: "Bundesliga",
    regionEn: "Germany",
    title: "Bundesliga Fixtures, Results and Table | FutbolRadar",
    description:
      "Bundesliga fixtures, live scores, results and the current German top-flight table with played, won, drawn, lost, goal difference and points.",
    intro:
      "Bundesliga fixtures, live scores and verified results, with the current German top-flight table."
  },
  {
    slugEn: "ligue-1",
    trPath: "lig/ligue-1.html",
    standingsId: "ligue-1",
    competitionId: "ligue-1",
    nameEn: "Ligue 1",
    regionEn: "France",
    title: "Ligue 1 Fixtures, Results and Table | FutbolRadar",
    description:
      "Ligue 1 fixtures, live scores, results and the current French top-flight table with played, won, drawn, lost, goal difference and points.",
    intro:
      "Ligue 1 fixtures, live scores and verified results, with the current French top-flight table."
  },
  {
    slugEn: "super-lig",
    trPath: "lig/super-lig.html",
    standingsId: "super-lig",
    competitionId: "super-lig",
    nameEn: "Süper Lig",
    regionEn: "Turkey",
    title: "Turkish Super Lig Table, Fixtures and Results | FutbolRadar",
    description:
      "Turkish Süper Lig table, fixtures, live scores and results — Galatasaray, Fenerbahçe, Beşiktaş, Trabzonspor and every Trendyol Süper Lig club in English.",
    intro:
      "The Turkish Süper Lig in English: the full table, upcoming fixtures and verified results from every Trendyol Süper Lig matchday."
  }
]);

/**
 * Kulüp hub'ları — dört büyükler.
 *
 * FutbolRadar'ın uluslararası aramada FARKLILAŞABİLECEĞİ alan Türk futbolu.
 * Bu dört kulüp Avrupa kupalarında oynadıkça İngilizce arama hacmi
 * ("galatasaray fixtures", "fenerbahce transfer news") Türkçe sitenin
 * karşılayamadığı bir talep bırakıyor.
 *
 * `teamName` `data/teams.json` ve maç kayıtlarındaki adla BİREBİR aynı
 * olmalı — maç süzgeci bu ada göre çalışıyor.
 */
export const EN_CLUB_HUBS = Object.freeze([
  {
    slugEn: "galatasaray",
    trPath: "galatasaray-maclari.html",
    teamName: "Galatasaray",
    teamSlug: "galatasaray",
    title: "Galatasaray Fixtures, Results and Latest News | FutbolRadar",
    description:
      "Galatasaray fixtures, live scores, results, Süper Lig standing and the latest verified Galatasaray transfer news, in English.",
    intro:
      "Galatasaray's upcoming fixtures, verified results, league position and latest confirmed transfer activity."
  },
  {
    slugEn: "fenerbahce",
    trPath: "fenerbahce-maclari.html",
    teamName: "Fenerbahçe",
    teamSlug: "fenerbahce",
    title: "Fenerbahce Fixtures, Results and Latest News | FutbolRadar",
    description:
      "Fenerbahçe fixtures, live scores, results, Süper Lig standing and the latest verified Fenerbahce transfer news, in English.",
    intro:
      "Fenerbahçe's upcoming fixtures, verified results, league position and latest confirmed transfer activity."
  },
  {
    slugEn: "besiktas",
    trPath: "besiktas-maclari.html",
    teamName: "Beşiktaş",
    teamSlug: "besiktas",
    title: "Besiktas Fixtures, Results and Latest News | FutbolRadar",
    description:
      "Beşiktaş fixtures, live scores, results, Süper Lig standing and the latest verified Besiktas transfer news, in English.",
    intro:
      "Beşiktaş's upcoming fixtures, verified results, league position and latest confirmed transfer activity."
  },
  {
    slugEn: "trabzonspor",
    trPath: "trabzonspor-maclari.html",
    teamName: "Trabzonspor",
    teamSlug: "trabzonspor",
    title: "Trabzonspor Fixtures, Results and Latest News | FutbolRadar",
    description:
      "Trabzonspor fixtures, live scores, results, Süper Lig standing and the latest verified Trabzonspor transfer news, in English.",
    intro:
      "Trabzonspor's upcoming fixtures, verified results, league position and latest confirmed transfer activity."
  }
]);
