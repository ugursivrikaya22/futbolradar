/**
 * PUAN DURUMU KATALOĞU — tek kaynak.
 *
 * Ana sayfadaki 9 sekmeli "Puan Durumları" widget'ı, TR/EN tam puan durumu
 * sayfaları ve derleme betikleri BURADAN beslenir. Yeni bir lig ya da kupa
 * eklemek için tek yapılacak şey bu listeye bir kayıt eklemek ve
 * `TR_TAB_ORDER`/`EN_TAB_ORDER` dizilerine kimliğini yazmaktır — sekme,
 * sayfa şablonu ve veri okuma mantığının hiçbiri değişmez.
 *
 * `id` alanı `data/competitions.json` ve `data/league-standings.json`
 * anahtarlarıyla birebir aynıdır (Süper Lig hariç: o `data/teams.json`'dan
 * okunur, çünkü o dosyadaki veri daha zengin/doğrulanmış — bkz. `dataSource`).
 */

export const STANDINGS_LEAGUES = Object.freeze({
  "super-lig": {
    id: "super-lig",
    dataSource: "teams",
    nameTr: "Süper Lig",
    nameEn: "Süper Lig",
    countryTr: "Türkiye",
    countryEn: "Turkey",
    slugTr: "super-lig-puan-durumu",
    slugEn: "super-lig-standings"
  },
  "premier-league": {
    id: "premier-league",
    dataSource: "league-standings",
    nameTr: "Premier Lig",
    nameEn: "Premier League",
    countryTr: "İngiltere",
    countryEn: "England",
    slugTr: "premier-lig-puan-durumu",
    slugEn: "premier-league-standings"
  },
  "la-liga": {
    id: "la-liga",
    dataSource: "league-standings",
    nameTr: "La Liga",
    nameEn: "La Liga",
    countryTr: "İspanya",
    countryEn: "Spain",
    slugTr: "la-liga-puan-durumu",
    slugEn: "la-liga-standings"
  },
  "serie-a": {
    id: "serie-a",
    dataSource: "league-standings",
    nameTr: "Serie A",
    nameEn: "Serie A",
    countryTr: "İtalya",
    countryEn: "Italy",
    slugTr: "serie-a-puan-durumu",
    slugEn: "serie-a-standings"
  },
  "bundesliga": {
    id: "bundesliga",
    dataSource: "league-standings",
    nameTr: "Bundesliga",
    nameEn: "Bundesliga",
    countryTr: "Almanya",
    countryEn: "Germany",
    slugTr: "bundesliga-puan-durumu",
    slugEn: "bundesliga-standings"
  },
  "ligue-1": {
    id: "ligue-1",
    dataSource: "league-standings",
    nameTr: "Ligue 1",
    nameEn: "Ligue 1",
    countryTr: "Fransa",
    countryEn: "France",
    slugTr: "ligue-1-puan-durumu",
    slugEn: "ligue-1-standings"
  },
  "sampiyonlar-ligi": {
    id: "sampiyonlar-ligi",
    dataSource: "league-standings",
    nameTr: "Şampiyonlar Ligi",
    nameEn: "Champions League",
    countryTr: "UEFA",
    countryEn: "UEFA",
    slugTr: "sampiyonlar-ligi-puan-durumu",
    slugEn: "champions-league-standings"
  },
  "avrupa-ligi": {
    id: "avrupa-ligi",
    dataSource: "league-standings",
    nameTr: "Avrupa Ligi",
    nameEn: "Europa League",
    countryTr: "UEFA",
    countryEn: "UEFA",
    slugTr: "avrupa-ligi-puan-durumu",
    slugEn: "europa-league-standings"
  },
  "konferans-ligi": {
    id: "konferans-ligi",
    dataSource: "league-standings",
    nameTr: "Konferans Ligi",
    nameEn: "Conference League",
    countryTr: "UEFA",
    countryEn: "UEFA",
    slugTr: "konferans-ligi-puan-durumu",
    slugEn: "conference-league-standings"
  }
});

/**
 * TR SEKME SIRASI — görev tanımındaki sıra birebir: Süper Lig önce (yerli
 * okuyucu için varsayılan/hatırlanan sekme), sonra büyük Avrupa ligleri,
 * sonra Avrupa kupaları.
 */
export const TR_TAB_ORDER = Object.freeze([
  "super-lig",
  "premier-league",
  "la-liga",
  "serie-a",
  "bundesliga",
  "ligue-1",
  "sampiyonlar-ligi",
  "avrupa-ligi",
  "konferans-ligi"
]);

/**
 * EN SEKME SIRASI — İngilizce okuyucu önceliğine göre: önce Premier Lig ve
 * Şampiyonlar Ligi (İngilizce konuşan futbol takipçisinin en çok aradığı iki
 * yarışma), sonra La Liga/Serie A/Bundesliga, FutbolRadar'ın kendi uzmanlık
 * alanı Süper Lig, ardından Ligue 1 ve küçük Avrupa kupaları.
 */
export const EN_TAB_ORDER = Object.freeze([
  "premier-league",
  "sampiyonlar-ligi",
  "la-liga",
  "serie-a",
  "bundesliga",
  "super-lig",
  "ligue-1",
  "avrupa-ligi",
  "konferans-ligi"
]);

export function orderedLeagues(locale) {
  const order = locale === "en" ? EN_TAB_ORDER : TR_TAB_ORDER;
  return order.map((id) => STANDINGS_LEAGUES[id]);
}
