/**
 * "RESMEN" KAPISI — RESMÎLİK İDDİASI KAYNAKSIZ YAYIMLANMAZ.
 *
 * Başlıktaki "resmen" (EN: "officially") okura kurumun konuştuğunu söyler.
 * Bir gazete bu kelimeyi atabilir; haberi yayımlayan biz isek kelimenin
 * arkasında kurumun kendi ağzı olmalı. Kural: başlıkta resmîlik iddiası
 * varsa kayıt (1) en az bir kaynak bağlantısı taşımalı VE (2) bağlantılardan
 * biri resmî ağız olmalı (kulüp sitesi, KAP, federasyon, UEFA/FIFA —
 * services/sourceTrust.js kademe 1). Haber ajansı tek başına yetmez: "resmen
 * açıkladı" cümlesinin öznesi kurumdur.
 *
 * Bu modül kaynağın DOĞRU söyleyip söylemediğini bilmez; yalnızca iddianın
 * arkasında doğru türde bir kaynak olup olmadığını denetler. Saf; ağ yok.
 */
const { hasOfficialSource, sourceUrlsOf } = require("./sourceTrust.js");

// "resmen" / "officially" — sözcük sınırıyla ("resmenlik" gibi türevleri yakalamaz).
const OFFICIAL_CLAIM = /(^|[^\p{L}])(resmen|officially)(?![\p{L}])/iu;

function titlesOf(article) {
  const en = (article && article.en) || {};
  return [
    article && article.title,
    article && article.seo && article.seo.metaTitle,
    en.title,
    en.seo && en.seo.metaTitle
  ].filter((value) => typeof value === "string" && value.trim());
}

/** Başlık metni resmîlik iddiası taşıyor mu? */
function claimsOfficial(title) {
  return OFFICIAL_CLAIM.test(String(title || "").replace(/İ/g, "i"));
}

/** Haber kaydının herhangi bir başlık alanı resmîlik iddiası taşıyor mu? */
function articleClaimsOfficial(article) {
  return titlesOf(article).some(claimsOfficial);
}

/**
 * @returns {{claims: boolean, ok: boolean, reason: string}}
 *   ok=false → yayımlanmamalı. claims=false → kural uygulanmaz.
 */
function officialClaimCheck(article) {
  if (!articleClaimsOfficial(article)) return { claims: false, ok: true, reason: "" };
  if (!sourceUrlsOf(article).some((url) => /^https?:\/\//i.test(url))) {
    return { claims: true, ok: false, reason: "başlık \"resmen\" diyor ama kaynak bağlantısı yok" };
  }
  if (!hasOfficialSource(article)) {
    return { claims: true, ok: false, reason: "başlık \"resmen\" diyor ama kaynaklar arasında resmî ağız (kulüp/KAP/federasyon/UEFA) yok" };
  }
  return { claims: true, ok: true, reason: "" };
}

module.exports = { OFFICIAL_CLAIM, claimsOfficial, articleClaimsOfficial, officialClaimCheck };
