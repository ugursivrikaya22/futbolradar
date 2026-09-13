/**
 * ÖZELLİK ANAHTARLARI — YENİ YÜZEYİ KAPATABİLMEK İÇİN.
 *
 * Radar Nabzı mevcut maç sayfasının ÜSTÜNE ekleniyor. Bir aksaklıkta
 * yapılacak şey dağıtımı geri almak değil, yalnızca yeni bölümü kapatıp
 * sayfanın eski hâline dönmesini sağlamaktır: `RADAR_PULSE=off`.
 *
 * VARSAYILAN AÇIK. Kapalı varsayılan, özelliği "yazıldı ama kimse görmedi"
 * durumunda bırakır; açık varsayılan + tek değişkenle kapatma, hem yayına
 * girmesini hem de saniyeler içinde geri alınabilmesini sağlar.
 *
 * Anahtar HEM sunucuda (uç nokta hesabı atlar) HEM derlemede (sayfa
 * kabuğu hiç basılmaz) okunur; ikisi de aynı fonksiyondan.
 */

"use strict";

const OFF_VALUES = new Set(["0", "off", "false", "no", "disabled", "kapali", "kapalı"]);

function isOff(value) {
  return OFF_VALUES.has(String(value == null ? "" : value).trim().toLowerCase());
}

/** Radar Nabzı açık mı? Varsayılan açık; yalnızca açık kapatma kapatır. */
function isRadarPulseEnabled(env) {
  const source = env || process.env;
  return !isOff(source.RADAR_PULSE);
}

module.exports = {
  isOff,
  isRadarPulseEnabled
};
