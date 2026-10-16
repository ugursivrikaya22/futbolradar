"use strict";

/**
 * OTOMATİK HABER İNDEKS KURALI.
 *
 * Keşif hattı (Sporx / Google News beslemeleri → `discovery` alanı) bir
 * manşetten {takım, oyuncu, olay türü} çıkarıp şablonla ~400 karakterlik bir
 * haber yazar: "X'in haberine göre Y çevresinde Z'ye dair bir açıklama
 * aktarıldı. Bu bilgi şu ana kadar yalnızca basında yer aldı…". Metin dürüst
 * ve kaynaklı ama TÜM kayıtlarda aynı cümle iskeleti: yüzlerce sayfa, her biri
 * ~400 karakter, aralarında yalnızca ad değişiyor.
 *
 * Arama motoru açısından bu "ölçekli, özgün değer katmayan sayfa" kalıbıdır
 * ve site genelinin kalite sinyalini aşağı çeker. Google News ilkeleri de
 * otomatik üretilmiş içeriği haber haritasına kabul etmez.
 *
 * KURAL (muhafazakâr): `discovery` kaydı taşıyan ve gövdesi
 * `THIN_BODY_CHARS`ın altında kalan haber
 *   • `noindex,follow` alır (sayfa AÇIK kalır, bağlantılar izlenir),
 *   • site haritasına ve Google News haritasına GİRMEZ.
 * Gövdesi eşiği aşan (editör ya da analiz eklenmiş) kayıt kendiliğinden
 * indekslenebilir olur — kural iki yönlü, tek seferlik temizlik değil.
 *
 * Eşik tek yerde. Gevşetmek ya da kuralı kapatmak için `THIN_BODY_CHARS`ı 0
 * yapmak yeterli.
 */

const THIN_BODY_CHARS = 800;

function bodyChars(article) {
  const body = article && Array.isArray(article.body) ? article.body : [];
  return body.join(" ").length;
}

/** Otomatik keşif kaynaklı ve özgün analiz içermeyen (ince) haber mi? */
function isThinAutomatedNews(article, threshold = THIN_BODY_CHARS) {
  if (!article || !article.discovery) return false;
  return bodyChars(article) < threshold;
}

module.exports = { THIN_BODY_CHARS, bodyChars, isThinAutomatedNews };
