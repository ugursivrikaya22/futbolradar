/**
 * HABER DURUMU — okura gösterilen tek etiket.
 *
 * PROBLEM. Depoda haberin "ne kadar kesin" olduğu ÜÇ AYRI yerde, üç ayrı
 * sözlükle duruyordu: `record.status` (verified/archived — yayın durumu,
 * kesinlik değil), `record.discovery.confidence` (reported/confirmed) ve
 * `scripts/sync-football-news.mjs` içindeki `lifecycleStatus()`
 * (OFFICIAL/CONFIRMED/DEVELOPING/RUMOUR/REPORTED). Sonuncusu yalnızca banda
 * yazılıyor, HABER KAYDINA hiç işlenmiyordu; bandın kendisinde de 30 kaydın
 * 13'ü `undefined` durumla duruyordu.
 *
 * Okur için sonuç şuydu: kulübün kendi duyurduğu transfer ile bir gazetenin
 * "kuliste konuşuluyor" aktarımı sayfada AYNI görünüyordu.
 *
 * ÇÖZÜM. Kesinlik tek bir yerde, tek bir sözlükle belirlenir:
 *
 *   official     Resmî        Kurumun kendi ağzı (kulüp/federasyon/UEFA/FIFA).
 *   negotiation  Görüşme      Taraflar konuşuyor; sonuç bağlanmamış.
 *   claim        İddia        Yalnızca basında; kimse doğrulamadı.
 *   reported     Haber        Güvenilir yayıncı aktarımı, çekince dili yok.
 *
 * `breaking` (Son Dakika) bunların ALTERNATİFİ DEĞİL, ÜZERİNE BİNEN BİR
 * İŞARETTİR. "Son dakika" bir haberin ne kadar doğru olduğunu söylemez,
 * ne kadar TAZE olduğunu söyler. İkisini tek listeye koymak, resmî bir
 * duyuruyu "son dakika" diye etiketleyip resmîliğini gizlemek demekti.
 * Bu yüzden ayrı alanda durur: bir haber hem `official` hem `breaking`
 * olabilir.
 *
 * KARAR SIRASI ÖNEMLİ. Kaynak kademesi metinden ÖNCE gelir. Bir gazete
 * "Resmen açıkladı!" diye başlık atabilir; başlıktaki kelime kurumu
 * konuşturmaz. Yalnızca kaydın kaynakları arasında gerçekten resmî bir
 * alan adı varsa haber `official` olur — `services/sourceTrust.js`
 * kademesine bakarak. Metin yalnızca resmî OLMAYAN haberleri birbirinden
 * ayırmak için okunur.
 */

const { TRUST_TIER, bestTrustTierOf, hasOfficialSource } = require("./sourceTrust.js");

const STATUS = Object.freeze({
  OFFICIAL: "official",
  NEGOTIATION: "negotiation",
  CLAIM: "claim",
  REPORTED: "reported"
});

/** Okura gösterilen etiketler. Tek kaynak — iki dil aynı yerden beslenir. */
const STATUS_LABELS = Object.freeze({
  [STATUS.OFFICIAL]: { tr: "Resmî", en: "Official" },
  [STATUS.NEGOTIATION]: { tr: "Görüşme", en: "In talks" },
  [STATUS.CLAIM]: { tr: "İddia", en: "Claim" },
  [STATUS.REPORTED]: { tr: "Haber", en: "Reported" }
});

const BREAKING_LABEL = Object.freeze({ tr: "Son Dakika", en: "Breaking" });

/**
 * "SON DAKİKA" BİR SÜREDİR, BİR SLOGAN DEĞİL.
 *
 * Yayıncılar bu etiketi dikkat çekmek için üç gün önceki habere de
 * basıyor. Burada etiket yalnızca SAATE bakar: eşikten eskiyse düşer.
 * Böylece sayfa kendi kendini temizler — dünkü "son dakika" bugün
 * sıradan bir haberdir ve müdahale gerekmeden öyle görünür.
 */
const BREAKING_WINDOW_MS = 3 * 60 * 60 * 1000;

/**
 * Çekince dili — haber yalnızca bir OLASILIĞI aktarıyor.
 *
 * "haberine göre" / "yazdığına göre" BİLEREK DIŞARIDA. Bunlar çekince
 * değil, KÜNYE: kaynağın kim olduğunu söylerler, haberin şüpheli
 * olduğunu değil. FutbolRadar'ın kendi özet metni her habere bu kalıbı
 * ekliyor; kalıp burada sayılınca 394 haberin 365'i "İddia" çıkmış,
 * etiket ayırt ediciliğini tamamen yitirmişti.
 */
const CLAIM_PATTERN =
  /\biddia|iddias[ıi]|söylenti|kulis|olabilir|iddia edil|öne sürül|ileri sürül|bomba iddia/i;

/** Süreç dili — taraflar konuşuyor ama iş bitmemiş. */
const NEGOTIATION_PATTERN =
  /görüşüyor|görüşme|görüşmeler|temas|masaya|teklif|pazarl[ıi]k|istiyor|gündeminde|ilgileniyor|takip ediyor|anlaşmaya yak[ıi]n|yak[ıi]n temas/i;

/** İngilizce karşılıkları — İngilizce akış aynı süzgeçten geçer. */
const CLAIM_PATTERN_EN =
  /\brumou?r|reportedly|claim|speculation|linked with|said to be|understood to/i;

const NEGOTIATION_PATTERN_EN =
  /in talks|negotiat|bid|offer|approach|interested in|pursuing|close to (?:a )?(?:deal|agreement)|holding talks/i;

function text(value) {
  return typeof value === "string" ? value : "";
}

/**
 * KARAR METNİ BAŞLIKTAN BAŞLAR.
 *
 * Başlık haberin iddiasını taşır; özet ve spot ise FutbolRadar'ın kendi
 * kalıp cümlelerini ("… resmî bir açıklama henüz yok", "… haberine göre")
 * taşır. İkisini tek torbada aramak, kalıp cümlelerin haberin durumunu
 * belirlemesine yol açıyordu.
 *
 * Bu yüzden önce YALNIZCA başlığa bakılır. Başlık bir şey söylüyorsa karar
 * odur. Başlık nötrse özete inilir — orada da yalnızca gerçek çekince
 * sözcükleri aranır.
 */
function decisionLayers(record) {
  if (!record) return ["", ""];
  return [
    text(record.title),
    [text(record.summary), text(record.spot)].join(" ")
  ];
}

/** Bir katmanda kalıbı arar; başlık katmanı özeti her zaman yener. */
function matchLayered(layers, ...patterns) {
  for (const layer of layers) {
    if (patterns.some((pattern) => pattern.test(layer))) return true;
  }
  return false;
}

/**
 * Haber kaydından okura gösterilecek durum.
 *
 * @returns {{status:string, label:{tr:string,en:string}, isBreaking:boolean,
 *            breakingLabel:{tr:string,en:string}, trustTier:number, reason:string}}
 */
function editorialStatusOf(record, options = {}) {
  const now = options.now ? new Date(options.now).getTime() : Date.now();
  const [title, supporting] = decisionLayers(record);
  const trustTier = bestTrustTierOf(record);

  let status;
  let reason;

  // Başlık tek başına karar verebiliyorsa özete hiç inilmez.
  const titleClaim = matchLayered([title], CLAIM_PATTERN, CLAIM_PATTERN_EN);
  const titleTalks = matchLayered([title], NEGOTIATION_PATTERN, NEGOTIATION_PATTERN_EN);
  const anyClaim = titleClaim || matchLayered([supporting], CLAIM_PATTERN, CLAIM_PATTERN_EN);
  const anyTalks = titleTalks || matchLayered([supporting], NEGOTIATION_PATTERN, NEGOTIATION_PATTERN_EN);

  if (hasOfficialSource(record)) {
    // Kurumun kendi alan adı kayıtta var — metne bakmaya gerek yok.
    status = STATUS.OFFICIAL;
    reason = "record-has-official-source";
  } else if (anyClaim) {
    // Çekince dili görüşme dilini YENER: "görüşme iddiası" bir iddiadır.
    status = STATUS.CLAIM;
    reason = titleClaim ? "claim-language" : "claim-language-supporting";
  } else if (anyTalks) {
    status = STATUS.NEGOTIATION;
    reason = titleTalks ? "negotiation-language" : "negotiation-language-supporting";
  } else if (trustTier <= TRUST_TIER.HIGH) {
    status = STATUS.REPORTED;
    reason = "trusted-publisher";
  } else {
    // Kaynağı zayıf ve dili nötr. "Haber" demek onu olduğundan güvenilir
    // gösterir; kaynaksızlık güvenilirlik değildir.
    status = STATUS.CLAIM;
    reason = "low-trust-source";
  }

  return {
    status,
    label: STATUS_LABELS[status],
    isBreaking: isBreaking(record, { now }),
    breakingLabel: BREAKING_LABEL,
    trustTier,
    reason
  };
}

/**
 * Taze mi? Yalnızca yayın saatine bakar. Tarihi okunamayan kayıt taze
 * SAYILMAZ — bilinmeyen bir zaman "şu an" değildir.
 */
function isBreaking(record, options = {}) {
  const now = options.now ? new Date(options.now).getTime() : Date.now();
  const published = Date.parse(text(record && (record.publishedAt || record.timestamp)));
  if (!Number.isFinite(published)) return false;
  const age = now - published;
  // Gelecek tarihli kayıt (besleme saat hatası) taze sayılmaz.
  if (age < 0) return false;
  return age <= BREAKING_WINDOW_MS;
}

/** Belirli bir dildeki rozet metni. */
function statusLabel(status, lang = "tr") {
  const entry = STATUS_LABELS[status] || STATUS_LABELS[STATUS.REPORTED];
  return entry[lang === "en" ? "en" : "tr"];
}

module.exports = {
  BREAKING_LABEL,
  BREAKING_WINDOW_MS,
  STATUS,
  STATUS_LABELS,
  editorialStatusOf,
  isBreaking,
  statusLabel
};
