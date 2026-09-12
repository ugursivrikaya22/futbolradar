/**
 * YAYIN HAKKI HARİTASI — EKRANA YAZILMAZ, YALNIZCA NEREYE BAKACAĞIMIZI SÖYLER.
 *
 * BU DOSYA BİR İDDİA DEĞİL, BİR ARAMA İPUCUDUR. "Süper Lig maçları beIN
 * Sports'ta yayınlanır" cümlesi turnuva düzeyinde doğru, MAÇ düzeyinde
 * eksiktir: hangi beIN kanalı (1 mi, 2 mi, 4 mü), o hafta TRT'ye açılan bir
 * karşılaşma var mı, dijital hak Tabii'de mi — bunların hiçbiri haritadan
 * çıkmaz. Bu yüzden buradaki hiçbir kanal adı doğrudan ekrana basılmaz.
 *
 * Harita tek bir işe yarar: `scripts/scan-broadcast-schedule.mjs` bir maç
 * için HANGİ yayıncının akışını okuyacağını buradan öğrenir. Kanal adı
 * ekrana ancak o yayıncının KENDİ akışında maç bulunduğunda yazılır; o
 * zaman da yazılan şey haritadaki tahmin değil, akışta okunan gerçek kanal
 * adıdır (bkz. services/broadcastSchedule.js#broadcastLabel).
 *
 * Yani zincir şu: harita → hangi akışı tarayacağız → akışta maç bulundu mu
 * → bulunduysa akıştaki kanal adı yayımlanır, bulunmadıysa "Yayın bilgisi
 * bekleniyor" kalır. Haritanın yanlış olması yanlış bilgi üretmez; yalnızca
 * boşuna ya da eksik tarama yaptırır.
 *
 * HAKLAR SEZON SEZON DEĞİŞİR. Bir yayıncı hakkı kaybettiğinde buradaki
 * girdisi eskir. Bunun tek sonucu o turnuvada taramanın boşa çıkması ve
 * sayfanın "bekleniyor" göstermesidir — sessiz bir yanlış değil, görünür
 * bir eksik. Yeni hak sahibi eklendiğinde tarama kendiliğinden düzelir.
 */

/**
 * Yayıncılar ve resmî yayın akışı adresleri.
 *
 * `match` alanı akıştan okunan bir satırın hangi kanala ait olduğunu
 * anlamak için kullanılır; `label` ise akış kanal adı vermediğinde
 * kullanılacak en dar, en güvenli addır (ör. akış "beIN SPORTS" diyorsa
 * numara uydurulmaz).
 */
const BROADCASTERS = Object.freeze({
  "bein-sports": Object.freeze({
    key: "bein-sports",
    label: "beIN Sports",
    scheduleUrl: "https://www.beinsports.com.tr/yayin-akisi",
    channelPattern: /beIN\s*SPORTS?\s*(?:HABER|MAX\s*)?(\d)?/i
  }),
  trt: Object.freeze({
    key: "trt",
    label: "TRT 1",
    scheduleUrl: "https://www.trt1.com.tr/yayin-akisi",
    channelPattern: /TRT\s*(1|SPOR(?:\s*YILDIZ)?)/i
  }),
  tabii: Object.freeze({
    key: "tabii",
    label: "Tabii",
    scheduleUrl: "https://www.tabii.com/",
    channelPattern: /tabii(?:\s*spor)?/i
  }),
  "s-sport": Object.freeze({
    key: "s-sport",
    label: "S Sport",
    scheduleUrl: "https://www.ssportplus.com/yayin-akisi",
    channelPattern: /S\s*Sport(?:\s*(?:Plus|2))?/i
  }),
  exxen: Object.freeze({
    key: "exxen",
    label: "Exxen",
    scheduleUrl: "https://www.exxen.com/",
    channelPattern: /Exxen/i
  })
});

/**
 * Turnuva → o turnuvada akışı taranacak yayıncılar.
 *
 * Sıra önemlidir: tarama listedeki ilk yayıncıdan başlar ve maçı bulan ilk
 * akış kazanır. Aynı maç iki akışta birden görünürse (TV + dijital) ikisi
 * de yayımlanır — okuyucu için "TRT 1 / Tabii" tek bir kanaldan daha
 * kullanışlıdır.
 */
const COMPETITION_RIGHTS = Object.freeze({
  "super-lig": Object.freeze(["bein-sports", "trt"]),
  "1-lig": Object.freeze(["bein-sports", "trt"]),
  "turkiye-kupasi": Object.freeze(["bein-sports", "trt", "tabii"]),
  "sampiyonlar-ligi": Object.freeze(["trt", "tabii", "s-sport"]),
  "avrupa-ligi": Object.freeze(["trt", "tabii", "s-sport"]),
  "konferans-ligi": Object.freeze(["trt", "tabii", "s-sport"]),
  "premier-league": Object.freeze(["s-sport", "bein-sports"]),
  "la-liga": Object.freeze(["s-sport"]),
  "serie-a": Object.freeze(["s-sport", "tabii"]),
  bundesliga: Object.freeze(["s-sport", "tabii"]),
  "ligue-1": Object.freeze(["s-sport", "bein-sports"])
});

/** Bu turnuvada hangi yayıncıların akışı taranacak? Bilinmiyorsa boş dizi. */
function broadcastersForCompetition(competitionId) {
  const keys = COMPETITION_RIGHTS[String(competitionId || "")] || [];
  return keys.map((key) => BROADCASTERS[key]).filter(Boolean);
}

/** Tarama yapılacak tüm yayıncılar (akış indirme adımı için tekilleştirilmiş). */
function allBroadcasters() {
  return Object.values(BROADCASTERS);
}

function findBroadcaster(key) {
  return BROADCASTERS[String(key || "")] || null;
}

module.exports = {
  BROADCASTERS,
  COMPETITION_RIGHTS,
  allBroadcasters,
  broadcastersForCompetition,
  findBroadcaster
};
